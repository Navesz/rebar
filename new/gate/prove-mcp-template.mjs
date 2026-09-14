#!/usr/bin/env node
// THE FIRST BEHAVIOR PROOF OF THE MCP THE GENERATOR WRITES.
//
// Why it exists. `new/gate/arquivos/mcp-rebar.mjs` has more than 800 lines and
// goes into every generated project as `.rebar/mcp.mjs`. Until 2026-09-06
// nothing ran it: the `syntax` step checked that it PARSES, `generator-map`
// checked that it is EMITTED, and neither of the two checked that it ANSWERS. It
// is exactly the hole that left `rebar new` broken for six commits with the
// gate 15/15 green — the gate proved the tooling and never the product.
//
// WHAT GETS PROVED HERE, and it is the most expensive question this MCP answers:
// is the gate of this project armed?
//
// `core.hooksPath` is a free string. Git writes it down checking nothing:
//
//   $ git config core.hooksPath .hooks-que-nunca-existiram   # exits 0, silent
//   $ git commit ...                                          # no hook runs
//
// Whoever reads only the value concludes "armed" and answers the agent that the
// gate is closed while it stands wide open — which is worse than not knowing,
// because it is what makes the agent stop asking. There are five states, and
// each one is a case below.
//
//   node new/gate/prove-mcp-template.mjs           shows the exchanges
//   node new/gate/prove-mcp-template.mjs --curto   only the verdict
//
// `--curto` keeps its Portuguese name: `verify.config.mjs` passes that exact
// flag on the `mcp-template` step. Rename it and the flag stops being read, and
// the gate report fills up with the whole JSON-RPC exchange.

import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { Cliente, textoDa } from '../../mcp/src/cliente-jsonrpc.mjs'
import * as CANONICO from '../../tooling/security/texto-seguro.mjs'
import { conferirTabela } from './modelos-mcp.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const MODELO = join(AQUI, 'arquivos', 'mcp-rebar.mjs')
const CURTO = process.argv.includes('--curto')
const cp = (n) => String.fromCodePoint(n)
const BARRA = String.fromCharCode(92)
const COMMIT_A = 'a'.repeat(40)

let falhas = 0
const titulo = (t) => console.log(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`)
const ok = (t) => console.log(`  ok   ${t}`)
// The `FALHA` prefix stays in Portuguese: it is a contract with
// `verify.config.mjs`, whose `mcp-template` step pulls the failures out with
// `extrair: /^\s*FALHA/`. Rename it and every failure line disappears from the
// gate report while the step still exits 1 — a red step with nothing to read.
const falhou = (t) => {
  falhas++
  console.log(`  FALHA ${t}`)
}

/**
 * A generated project, minimal but real: a real repository, hooks on disk, and
 * the template COPIED — not imported. Importing would read the file from here
 * and prove the wrong path; what goes to the user is the copy.
 */
function montarProjeto() {
  const base = mkdtempSync(join(tmpdir(), 'rebar-mcp-'))

  // Global and system configuration out of the way: a `core.hooksPath` on the
  // machine running this proof would decide the result of the five cases. A
  // genuinely empty file, because `/dev/null` does not exist on Windows.
  const vazio = join(base, 'git-config-vazio')
  writeFileSync(vazio, '', 'utf8')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: vazio, GIT_CONFIG_SYSTEM: vazio }
  const git = (...args) =>
    execFileSync('git', args, { cwd: base, encoding: 'utf8', env, windowsHide: true }).trim()

  git('init', '-q')
  git('config', 'user.email', 'prova@rebar.local')
  git('config', 'user.name', 'prova')

  const pkg = {
    name: 'projeto-de-prova',
    scripts: { verificar: 'npm run lint && npm run build', lint: 'echo lint', build: 'echo build' },
  }
  writeFileSync(join(base, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

  mkdirSync(join(base, '.githooks'), { recursive: true })
  for (const h of ['pre-commit', 'commit-msg']) {
    writeFileSync(join(base, '.githooks', h), '#!/bin/sh\nexit 0\n', 'utf8')
  }
  for (const m of ['scan-secret.mjs', 'check-message.mjs']) {
    writeFileSync(join(base, '.githooks', m), '// prova\n', 'utf8')
  }
  writeFileSync(join(base, '.rebar-coauthors'), 'humano@exemplo.com\n', 'utf8')

  // The folder for CASE D: it exists, and it is not the project's.
  mkdirSync(join(base, 'outros-hooks'), { recursive: true })

  mkdirSync(join(base, '.rebar'), { recursive: true })
  const servidor = join(base, '.rebar', 'mcp.mjs')
  copyFileSync(MODELO, servidor)

  return { base, servidor, env, git }
}

/** Asks the project's MCP for the state of the gate, and returns the hooks block. */
async function estadoDoPortao(projeto) {
  const c = new Cliente(projeto.servidor, { cwd: projeto.base, curto: CURTO })
  try {
    await c.apresentar('prova-do-modelo')
    const r = await c.pedir('tools/call', { name: 'rebar_portao', arguments: {} })
    const t = textoDa(r)
    if (!t) throw new Error('rebar_portao returned no text')
    return JSON.parse(t).hooks_de_git
  } finally {
    await c.fechar()
  }
}

/**
 * One whole conversation with a copy of the server, synchronously: every request
 * goes into stdin at once, the pipe closes, and the server exits after answering
 * what was in flight. `env` reaches the server, which the Cliente above cannot
 * pass. Returns the answers by id and the wall time.
 */
function conversar(base, chamadas, { env = process.env } = {}) {
  const pedidos = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...chamadas.map((c, i) => ({
      jsonrpc: '2.0',
      id: 10 + i,
      method: 'tools/call',
      params: { name: c.name, arguments: c.args || {} },
    })),
  ]
  const inicio = Date.now()
  const r = spawnSync(process.execPath, [join(base, '.rebar', 'mcp.mjs')], {
    cwd: base,
    env,
    input: `${pedidos.map((p) => JSON.stringify(p)).join('\n')}\n`,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  })
  const respostas = new Map()
  for (const linha of (r.stdout || '').split('\n').filter((l) => l.trim())) {
    const m = JSON.parse(linha)
    respostas.set(m.id, m)
  }
  return { respostas, ms: Date.now() - inicio, stderr: r.stderr }
}

const texto = (m) => m?.result?.content?.[0]?.text ?? ''

/** A second project, apart from the one the five hook cases mutate. */
function projetoSimples({ sentinela, site, fluxo, pacote } = {}) {
  const p = montarProjeto()
  if (pacote) writeFileSync(join(p.base, 'package.json'), `${JSON.stringify(pacote, null, 2)}\n`)
  if (sentinela !== undefined || site !== undefined) {
    mkdirSync(join(p.base, 'conteudo'), { recursive: true })
  }
  if (sentinela !== undefined) {
    writeFileSync(
      join(p.base, 'conteudo', 'esquema.ts'),
      `export const SENTINELA = ${sentinela}\nexport const outro = 1\n`,
    )
  }
  if (site !== undefined) writeFileSync(join(p.base, 'conteudo', 'site.json'), JSON.stringify(site))
  if (fluxo !== undefined) {
    mkdirSync(join(p.base, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(p.base, '.github', 'workflows', 'verificar.yml'), fluxo)
  }
  return p
}

const apagar = (p) =>
  rmSync(p.base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })

/** Every code point of the three canonical tables, tested one by one. */
const inseguro = (s) =>
  [...String(s)].some((ch) => {
    const c = ch.codePointAt(0)
    return (
      CANONICO.naFaixa(c, CANONICO.CONTROLES) ||
      CANONICO.naFaixa(c, CANONICO.IGNORAVEIS) ||
      CANONICO.naFaixa(c, CANONICO.ESCAPAR_TAMBEM)
    )
  })

/** Every string leaf and key of a JSON value. */
function folhas(v, saida = []) {
  if (typeof v === 'string') saida.push(v)
  else if (Array.isArray(v)) v.forEach((x) => folhas(x, saida))
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      saida.push(k)
      folhas(x, saida)
    }
  }
  return saida
}

const projeto = montarProjeto()

// THE REGEXES BELOW THAT MATCH `porque_nao` STAY IN PORTUGUESE — all three of
// them. They match the reason strings that `new/gate/arquivos/mcp-rebar.mjs`
// produces: `is not configured`, `does NOT exist on disk`, `and not to
// .githooks/`. Translating them here does not translate the server; it only
// breaks the match, and then every case passes for the wrong reason.
try {
  // ── case A: the freshly made clone. No hook armed, and that is the normal one.
  titulo('A · no core.hooksPath — the state of someone who has just cloned')
  let h = await estadoDoPortao(projeto)
  if (h.armado !== false) falhou(`said armado=${h.armado} with no core.hooksPath at all`)
  else if (!/is not configured/.test(h.porque_nao ?? ''))
    falhou(`unarmed, but the reason does not say it is missing configuration: ${h.porque_nao}`)
  else ok(`armado=false · ${h.porque_nao}`)

  // ── case B: really installed. It is the only one allowed to say yes.
  titulo('B · core.hooksPath = .githooks — really installed')
  projeto.git('config', 'core.hooksPath', '.githooks')
  h = await estadoDoPortao(projeto)
  if (h.armado !== true) falhou(`said armado=${h.armado} with the gate installed: ${h.porque_nao}`)
  else ok(`armado=true · core.hooksPath=${h.core_hooksPath}`)

  // ── case C: THE DEFECT. It points at what does not exist, and git says nothing.
  titulo('C · core.hooksPath to a folder that does not exist — git accepts it and runs nothing')
  projeto.git('config', 'core.hooksPath', '.hooks-que-nunca-existiram')
  h = await estadoDoPortao(projeto)
  if (h.armado !== false)
    falhou(
      'said armado=true with core.hooksPath pointing at nothing — it is the wide-open gate ' +
        'being announced as closed, which is what makes the agent stop asking',
    )
  else if (!/does NOT exist on disk/.test(h.porque_nao ?? ''))
    falhou(`unarmed, but did not say the destination does not exist: ${h.porque_nao}`)
  else ok(`armado=false · ${h.porque_nao}`)

  // ── case D: it points at a folder that EXISTS, and it is another one.
  titulo('D · core.hooksPath to ANOTHER existing folder — git runs the hooks from there')
  projeto.git('config', 'core.hooksPath', 'outros-hooks')
  h = await estadoDoPortao(projeto)
  if (h.armado !== false)
    falhou(
      'said armado=true with core.hooksPath on another folder — the hooks of this project are ' +
        'on disk and git executes the ones from over there',
    )
  else if (!/and not to \.githooks\//.test(h.porque_nao ?? ''))
    falhou(`unarmed, but did not say it is another folder: ${h.porque_nao}`)
  else ok(`armado=false · ${h.porque_nao}`)

  // ── case E: the ABSOLUTE path of the right folder is the right folder.
  //    Without this, a fix that only compared strings would pass the four above
  //    and fail whoever installed with an absolute path — a false positive,
  //    which costs more than an absent rule.
  titulo('E · absolute core.hooksPath pointing at .githooks — it is the same folder')
  projeto.git('config', 'core.hooksPath', join(projeto.base, '.githooks'))
  h = await estadoDoPortao(projeto)
  if (h.armado !== true)
    falhou(`said armado=false for the absolute path of the right folder: ${h.porque_nao}`)
  else ok(`armado=true · ${h.core_hooksPath}`)
} finally {
  // `maxRetries` because the antivirus and the Windows indexer hold a handle for
  // a few milliseconds after the process exits.
  rmSync(projeto.base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

// ─────────────────────────────────────────────── the sentinel, read with a guard
//
// The real line of the site preset, built with the backslash from its char code
// so this file holds no escape the security tables could read as a sample.
const SENTINELA_REAL = `/${BARRA}bTROQUE-[A-Z-]{3,}/`

for (const generico of ['/.*/', '/(?:)/']) {
  titulo(`F · a generic SENTINELA ${generico} is refused, and no real value comes back`)
  const p = projetoSimples({
    sentinela: generico,
    site: { nome: 'Pizzaria do Zé', email: 'TROQUE-PELO-EMAIL-REAL' },
  })
  try {
    const { respostas } = conversar(p.base, [{ name: 'rebar_verificar' }])
    const t = texto(respostas.get(10))
    const v = JSON.parse(t || '{}')
    if (v.placeholders_pendentes?.length) {
      falhou(
        `${generico} reported ${v.placeholders_pendentes.length} placeholder(s) instead of refusing`,
      )
    } else if (!(v.reprovas || []).some((x) => /matches ordinary content/.test(x))) {
      falhou(
        `${generico} was not refused as matching ordinary content: ${JSON.stringify(v.reprovas)}`,
      )
    } else if (t.includes('Pizzaria do Zé')) {
      falhou(`${generico}: the real business name came back in the answer`)
    } else ok(`refused · ${v.reprovas.find((x) => /ordinary/.test(x))}`)
  } finally {
    apagar(p)
  }
}

{
  titulo('F2 · the real sentinel followed by a // comment still finds the one placeholder')
  const p = projetoSimples({
    sentinela: `${SENTINELA_REAL} // the build fails on it`,
    site: { nome: 'TROQUE-PELO-NOME-DO-NEGOCIO', email: 'contato@empresa.com.br' },
  })
  try {
    const v = JSON.parse(
      texto(conversar(p.base, [{ name: 'rebar_verificar' }]).respostas.get(10)) || '{}',
    )
    const n = v.placeholders_pendentes?.length
    if (n !== 1) {
      falhou(`expected exactly 1 pending placeholder, got ${n} (${JSON.stringify(v.reprovas)})`)
    } else ok(`1 pending · ${v.placeholders_pendentes[0].campo}`)
  } finally {
    apagar(p)
  }
}

{
  // Two catastrophic patterns: the first also matches a canary, so it is
  // refused before any field; the second matches no canary, so only the time
  // limit on the field itself can stop it (measured: cut at 57-59 ms).
  for (const [sentinela, valor, esperado] of [
    ['/^(a+)+$/', `${'a'.repeat(34)}!`, /over 50 ms|ordinary content/],
    ['/^(x+x+)+y$/', 'x'.repeat(32), /over 50 ms/],
  ]) {
    titulo(`F3 · a catastrophic SENTINELA ${sentinela} answers in seconds, refused`)
    const p = projetoSimples({ sentinela, site: { nome: valor } })
    try {
      const { respostas, ms } = conversar(p.base, [{ name: 'rebar_verificar' }])
      const v = JSON.parse(texto(respostas.get(10)) || '{}')
      if (ms >= 5000) falhou(`the answer took ${ms} ms`)
      else if (!(v.reprovas || []).some((x) => esperado.test(x))) {
        falhou(`not refused: ${JSON.stringify(v.reprovas)}`)
      } else ok(`${ms} ms · refused`)
    } finally {
      apagar(p)
    }
  }
}

// ─────────────────────────────────────────────── repository text is escaped
{
  titulo('G · invisible and control characters from the project come back as <U+XXXX>')
  const ZW = cp(0x200b)
  // U+001B built by arithmetic, so no escaped ESC is spelled in this file.
  const ESC = String.fromCodePoint(0x1a + 1)
  const p = projetoSimples({
    sentinela: SENTINELA_REAL,
    site: {
      [`chave${cp(0x202e)}x`]: 'TROQUE-PELO-EMAIL-REAL',
      nome: `TROQUE-PELO-NOME${cp(0xe0041)}${cp(0xe0042)}`,
    },
    pacote: {
      name: `p${ZW}`,
      scripts: {
        verificar: `npm run lint && npm run li${ZW}nt`,
        lint: `echo ${ESC}[8m`,
        [`li${ZW}nt`]: 'echo ok',
      },
    },
  })
  try {
    p.git('config', 'core.hooksPath', `x${ZW}`)
    const { respostas } = conversar(p.base, [
      { name: 'rebar_verificar' },
      { name: 'rebar_regras' },
      { name: 'rebar_portao' },
    ])
    const textos = [10, 11, 12].map((id) => texto(respostas.get(id)))
    const jsons = [
      JSON.parse(textos[0] || 'null'),
      JSON.parse(textos[1].slice(textos[1].indexOf('\n[') + 1) || 'null'),
      JSON.parse(textos[2] || 'null'),
    ]
    const sujas = jsons.flatMap((j) => folhas(j)).filter(inseguro)
    const crus = textos.filter((t) => inseguro(t.split('\n').join('')))
    const tudo = textos.join('\n')
    const faltam = ['<U+202E>', '<U+E0041>', '<U+200B>', '<U+001B>'].filter(
      (r) => !tudo.includes(r),
    )
    if (textos.some((t) => !t)) falhou('a tool did not answer')
    else if (sujas.length)
      falhou(`${sujas.length} JSON string(s) still hold a raw unsafe code point`)
    else if (crus.length) falhou(`${crus.length} answer(s) hold a raw unsafe code point`)
    else if (faltam.length) falhou(`the escaped labels are missing: ${faltam.join(', ')}`)
    else if (!jsons[0].dados || !jsons[2].dados) falhou('an object answer does not carry `dados`')
    else ok('no raw unsafe code point in three answers · every label present')
  } finally {
    apagar(p)
  }
}

// ─────────────────────────────────────────── the ruler runs only a pinned commit
const PINOS_RUINS = [
  ['no workflow', undefined],
  ['unpinned git spec', 'jobs:\n  a:\n    steps:\n      - run: npx --yes github:Navesz/rebar .\n'],
  [
    'git spec with a commit (npm 10 refuses it)',
    `jobs:\n  a:\n    steps:\n      - run: npx --yes github:Navesz/rebar#${COMMIT_A} .\n`,
  ],
  [
    'two different commits',
    'jobs:\n  a:\n    steps:\n' +
      `      - run: npx --yes https://codeload.github.com/Navesz/rebar/tar.gz/${COMMIT_A} .\n` +
      `      - run: npx --yes -p https://codeload.github.com/Navesz/rebar/tar.gz/${'b'.repeat(40)} rebar-security .\n`,
  ],
  [
    // One pinned line does not vouch for the workflow: the other step still
    // runs whatever rebar's default branch holds.
    'a pinned tarball next to an unpinned step',
    'jobs:\n  a:\n    steps:\n' +
      `      - run: npx --yes https://codeload.github.com/Navesz/rebar/tar.gz/${COMMIT_A} .\n` +
      '      - run: npx --yes -p github:Navesz/rebar rebar-security .\n',
  ],
  [
    'the generator marker in place of the commit',
    'jobs:\n  a:\n    steps:\n      - run: npx --yes https://codeload.github.com/Navesz/rebar/tar.gz/TROQUE-PELO-COMMIT-DO-REBAR .\n',
  ],
]
for (const [rotulo, fluxo] of PINOS_RUINS) {
  titulo(`H · regua:true refuses without spawning · ${rotulo}`)
  const p = projetoSimples({ fluxo })
  try {
    const { respostas, ms } = conversar(p.base, [
      { name: 'rebar_verificar', args: { regua: true } },
    ])
    const v = JSON.parse(texto(respostas.get(10)) || '{}')
    const campos = [v.regua_do_rebar, v.regua_de_seguranca]
    const motivo = /pins no rebar commit|unpinned|different rebar commits/
    if (
      !campos.every((c) => c && c.rodou === false && c.comando === null && motivo.test(c.motivo))
    ) {
      falhou(`did not refuse both rulers: ${JSON.stringify(campos)}`)
    } else if (ms >= 3000) falhou(`the refusal took ${ms} ms — something ran`)
    else ok(`${ms} ms · ${campos[0].motivo}`)
  } finally {
    apagar(p)
  }
}

{
  titulo('H2 · one commit pinned twice is the command both rulers are named with')
  const url = `https://codeload.github.com/Navesz/rebar/tar.gz/${COMMIT_A}`
  const p = projetoSimples({
    fluxo:
      '# a comment naming github:Navesz/rebar is not a line that runs\n' +
      `jobs:\n  a:\n    steps:\n      - run: npx --yes ${url} .\n` +
      `      - run: npx --yes -p ${url} rebar-security .\n`,
  })
  try {
    const v = JSON.parse(
      texto(conversar(p.base, [{ name: 'rebar_portao' }]).respostas.get(10)) || '{}',
    )
    if (!String(v.regua_do_rebar).includes(`tar.gz/${COMMIT_A} .`)) {
      falhou(`regua_do_rebar is not the pinned tarball: ${v.regua_do_rebar}`)
    } else if (!String(v.regua_de_seguranca).includes(`-p ${url} rebar-security`)) {
      falhou(`regua_de_seguranca is not the pinned tarball: ${v.regua_de_seguranca}`)
    } else ok(v.regua_de_seguranca)
  } finally {
    apagar(p)
  }
}

// ─────────────────────────────────────── the git in the project root never runs
{
  titulo('H3 · a git planted in the project root, and on PATH, is never executed')
  const p = projetoSimples({})
  const marca = join(p.base, 'planted-git-ran')
  try {
    // The real git is told the hooks are armed, so only the real git can answer
    // `armado: true`. The planted one is inert: on Windows a copy of
    // whoami.exe, which refuses `config --get core.hooksPath` and exits 1 — the
    // server would then read "not configured"; on POSIX a script whose only
    // effect is a marker file. (A hard link to node.exe was tried first: the
    // running node locks every link to its image, and the cleanup failed with
    // EPERM.)
    p.git('config', 'core.hooksPath', '.githooks')
    if (process.platform === 'win32') {
      const inerte = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe')
      copyFileSync(inerte, join(p.base, 'git.exe'))
    } else {
      writeFileSync(join(p.base, 'git'), `#!/bin/sh\necho x > "${marca}"\nexit 1\n`)
      chmodSync(join(p.base, 'git'), 0o755)
    }
    const env = { ...p.env, PATH: `${p.base}${delimiter}${process.env.PATH || ''}` }
    delete env.NoDefaultCurrentDirectoryInExePath
    const v = JSON.parse(
      texto(conversar(p.base, [{ name: 'rebar_portao' }], { env }).respostas.get(10)) || '{}',
    )
    if (existsSync(marca)) falhou('the planted git ran')
    else if (v.hooks_de_git?.armado !== true) {
      falhou(`the real git was not the one asked: ${v.hooks_de_git?.porque_nao}`)
    } else ok('the planted git did not run · the real one answered armado=true')
  } finally {
    apagar(p)
  }
}

// ──────────────────────────────── the project's .npmrc never reaches the rulers
{
  titulo("H4 · the project's .npmrc is not read by the npx that runs the rulers")
  // npm reads the .npmrc of the folder it starts in, and `node-options` there
  // loaded project code inside both pinned rulers (measured on 2026-09-13).
  // Offline, with an empty cache and a commit no cache holds, npx fails in
  // about 3 s and runs nothing, but it has already read its config: a
  // `logs-dir` inside the project is the evidence. Measured against the
  // previous template: 2 log files landed in the project; against this one,
  // none.
  const url = `https://codeload.github.com/Navesz/rebar/tar.gz/${'c'.repeat(40)}`
  const p = projetoSimples({
    fluxo:
      `jobs:\n  a:\n    steps:\n      - run: npx --yes ${url} .\n` +
      `      - run: npx --yes -p ${url} rebar-security .\n`,
  })
  const logs = join(p.base, 'npm-logs-plantado')
  const cache = mkdtempSync(join(tmpdir(), 'rebar-mcp-npm-cache-'))
  try {
    writeFileSync(join(p.base, '.npmrc'), `logs-dir=${logs.split(BARRA).join('/')}\n`)
    const env = { ...p.env, npm_config_offline: 'true', npm_config_cache: cache }
    const { respostas, ms } = conversar(
      p.base,
      [{ name: 'rebar_verificar', args: { regua: true } }],
      { env },
    )
    const v = JSON.parse(texto(respostas.get(10)) || '{}')
    if (existsSync(logs))
      falhou(`npm read the project's .npmrc: ${readdirSync(logs).length} log(s) in the project`)
    else if (v.regua_do_rebar?.rodou !== false || v.regua_de_seguranca?.rodou !== false) {
      falhou(
        `offline with an empty cache, a ruler claims it ran: ${JSON.stringify(v.regua_do_rebar)}`,
      )
    } else ok(`${ms} ms · npx started outside the project, and its .npmrc was never read`)
  } finally {
    apagar(p)
    rmSync(cache, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
}

// ──────────────────────────────────────────────────── the source of the template
{
  titulo('I · the template source: no shell, both rulers, one stdout write, no generator marker')
  const fonte = readFileSync(MODELO, 'utf8')
  const escritas = (fonte.match(/process\.stdout\.write/g) || []).length
  if (/\bshell\s*:/.test(fonte)) falhou('the template passes a `shell:` option')
  else if (!/rodarRegua\(\[[^\]]*'rebar-security'/.test(fonte)) {
    falhou('rebar_verificar no longer runs rebar-security')
  } else if (escritas !== 1 || /console\.log/.test(fonte)) {
    falhou(`stdout writes: ${escritas}, console logging present: ${/console\.log/.test(fonte)}`)
  } else if (fonte.includes('{{commit-do-rebar}}')) {
    falhou(
      'the template carries the generator commit marker — every generated blob would be unique',
    )
  } else if (!fonte.includes('github:Navesz/rebar')) {
    // The three published sites assert this substring on the file they copy.
    falhou('the template lost the `github:Navesz/rebar` substring the sites assert')
  } else ok('no shell · both rulers · 1 stdout write · no marker')
}

// ───────────────────────────────────────────────────────── the sanitizer copy
{
  titulo('J · the sanitizer block equals tooling/security/texto-seguro.mjs')
  const fonte = readFileSync(MODELO, 'utf8')
  const a = fonte.indexOf('// @texto-seguro:inicio')
  const b = fonte.indexOf('// @texto-seguro:fim')
  const DIVERGIU =
    'the sanitizer copy in mcp-rebar.mjs diverged from tooling/security/texto-seguro.mjs'
  if (a === -1 || b <= a) falhou(`${DIVERGIU} (markers not found)`)
  else {
    const bloco = fonte.slice(a, b)
    const copia = vm.runInContext(
      `${bloco}\n;({ IGNORAVEIS, CONTROLES, ESCAPAR_TAMBEM, naFaixa, escaparSaida })`,
      vm.createContext({}),
      { timeout: 5000 },
    )
    // JSON and not deepStrictEqual: the arrays come from another realm, and
    // their prototypes differ even when every number is equal.
    const tabelas = ['IGNORAVEIS', 'CONTROLES', 'ESCAPAR_TAMBEM']
    const tabelaDiferente = tabelas.find(
      (n) => JSON.stringify(copia[n]) !== JSON.stringify(CANONICO[n]),
    )
    const funcaoDiferente = ['naFaixa', 'escaparSaida'].find(
      (n) => copia[n].toString() !== CANONICO[n].toString(),
    )
    const pontos = new Set()
    for (let c = 0; c < 0x30000; c++) pontos.add(c)
    for (let c = 0x30000; c <= 0x10ffff; c += 97) pontos.add(c)
    for (const n of tabelas) {
      for (const [ini, fim] of CANONICO[n]) {
        for (const c of [ini - 1, ini, ini + 1, fim - 1, fim, fim + 1]) {
          if (c >= 0 && c <= 0x10ffff) pontos.add(c)
        }
      }
    }
    let diferencas = 0
    for (const c of pontos) {
      const s = `a${cp(c)}b`
      if (copia.escaparSaida(s) !== CANONICO.escaparSaida(s)) diferencas++
    }
    if (tabelaDiferente) falhou(`${DIVERGIU} (table ${tabelaDiferente})`)
    else if (funcaoDiferente) falhou(`${DIVERGIU} (source of ${funcaoDiferente})`)
    else if (diferencas) falhou(`${DIVERGIU} (${diferencas} code point(s) escaped differently)`)
    else ok(`tables and sources equal · ${pontos.size} code points escaped alike`)
  }
}

// ─────────────────────────────────────────────────────── the version table
{
  titulo('K · the version table knows the template on disk and every version in history')
  const diferencas = conferirTabela(RAIZ)
  if (diferencas.length) {
    falhou(
      'template changed without the table: run node new/gate/modelos-mcp.mjs --escrever and ' +
        `commit tooling/security/injection/modelos-mcp.json together (${diferencas.join(' · ')})`,
    )
  } else ok('fresh')
}

{
  // Measured by review on 2026-09-13: the previous check tolerated any entry it
  // could not find in history, so a hand-added sha256 with an invented blob and
  // commit passed this step, and mcp-integrity then accepted those bytes.
  titulo('K2 · an entry nothing in history proves, or a derived field edited by hand, is stale')
  const tabela = JSON.parse(
    readFileSync(join(RAIZ, 'tooling', 'security', 'injection', 'modelos-mcp.json'), 'utf8'),
  )
  const forjada = structuredClone(tabela)
  forjada.versoes.splice(forjada.versoes.length - 1, 0, {
    ...forjada.versoes[0],
    sha256: 'e'.repeat(64),
    blob: 'b'.repeat(40),
    desde: 'c'.repeat(40),
  })
  const aliviada = structuredClone(tabela)
  aliviada.versoes[0].recusada = null
  const a = conferirTabela(RAIZ, { texto: JSON.stringify(forjada) })
  const b = conferirTabela(RAIZ, { texto: JSON.stringify(aliviada) })
  if (!a.some((d) => /nothing proves rebar shipped those bytes/.test(d))) {
    falhou(`a forged entry was not reported: ${JSON.stringify(a)}`)
  } else if (!b.some((d) => /recusada is null/.test(d))) {
    falhou(`version 1 un-refused by hand was not reported: ${JSON.stringify(b)}`)
  } else ok(`${a.length} and ${b.length} difference(s) reported`)
}

titulo(falhas ? `${falhas} FALHA(S)` : 'everything passed')
process.exit(falhas ? 1 : 0)
