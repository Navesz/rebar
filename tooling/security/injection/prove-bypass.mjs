// prove-bypass — agent-bypass-invocation: the tables, the matchers and the
// places that decide the verdict.
//
//   node --test tooling/security/injection/prove-bypass.mjs
//
// Every flag and binary name below is assembled at runtime. This file is
// tracked, rebar's own run reads it raw, and prove-table.mjs holds every
// exported table against it: one flag written out here would be
// a permanent finding against the repository that ships the rule.
//
// The incident shapes are rebuilt from the write-ups (StepSecurity's map of
// the Nx s1ngularity postinstall; the Amazon Q 1.84.0 line), because the
// measured corpora hold zero true positives to borrow from. With this engine,
// on 2026-09-13: rebar, rebar-site and bookkeep give 0 findings over their
// index, and their four node_modules trees give 0 over 76,718 text files read
// from disk (the prototype's matcher, before the strong/ambiguous split, had 2
// false positives there, both ported below). Measured again the same day after
// a CLI name assigned to a variable, a key in any letter case, the raw members
// of package.json and the entry node resolves were added: still 0 findings, and
// the two node_modules trees read in 43 s and 41 s.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

import {
  BINARIOS_DE_AGENTE,
  FLAGS_AMBIGUAS,
  FLAGS_FORTES,
  PARES_DE_FLAG,
  checarBypass,
  varrerCodigo,
  varrerShell,
} from './bypass.mjs'
import { ACOES_DE_AGENTE } from './workflow.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const TABELAS = { FLAGS_FORTES, FLAGS_AMBIGUAS, PARES_DE_FLAG, BINARIOS_DE_AGENTE, ACOES_DE_AGENTE }
const LINHAS = { FLAGS_FORTES, FLAGS_AMBIGUAS, PARES_DE_FLAG, BINARIOS_DE_AGENTE }
const TODAS = [...FLAGS_FORTES, ...FLAGS_AMBIGUAS, ...PARES_DE_FLAG, ...BINARIOS_DE_AGENTE]

// ───────────────────────────────────────────────────── the assembled vocabulary

const j = (...partes) => partes.join('')
const D = j('-', '-')
const CL = j('cla', 'ude')
const GE = j('gem', 'ini')
const CO = j('cod', 'ex')
const CP = j('copi', 'lot')
const CU = j('cursor-', 'agent')
const QC = j('q', ' ', 'chat')
const PACOTE_CL = j('@anthropic-ai/', CL, '-code')
const SKIP = j(D, 'dangerously-', 'skip-', 'permissions')
const FRACA = j(D, 'allow-', 'dangerously-', 'skip-', 'permissions')
const SEM_FREIO = j(D, 'yo', 'lo')
const SEM_APROVACAO = j(D, 'dangerously-', 'bypass-', 'approvals-', 'and-', 'sandbox')
const CONFIA = j(D, 'trust-', 'all-', 'tools')
const TUDO_CP = j(D, 'allow-', 'all-', 'tools')
const MODO = j(D, 'permission-', 'mode')
const VALOR_MODO = j('bypass', 'Permissions')
const SANDBOX = j(D, 'sand', 'box')
const SEM_SANDBOX = j('danger-', 'full-', 'access')
const SEM_PERGUNTA = j(D, 'no-', 'interactive')
const AUTO_CODEX = j(D, 'full-', 'auto')
const Y = j('-', 'y')
const A = j('-', 'a')
const F = j('-', 'f')
const ENV_CP = j('COPILOT_', 'ALLOW_', 'ALL')

// ─────────────────────────────────────────────────────────────── temp repos

const SEM_CONFIG = join(tmpdir(), 'rebar-prove-bypass-gitconfig-inexistente')
const AMBIENTE = {
  ...process.env,
  GIT_CONFIG_GLOBAL: SEM_CONFIG,
  GIT_CONFIG_SYSTEM: SEM_CONFIG,
  GIT_TERMINAL_PROMPT: '0',
}

function git(dir, argumentos, entrada) {
  const r = spawnSync('git', argumentos, {
    cwd: dir,
    input: entrada,
    env: AMBIENTE,
    windowsHide: true,
    encoding: 'buffer',
  })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`git ${argumentos[0]}: ${String(r.stderr)}`)
  return String(r.stdout).trim()
}

/**
 * One `git init` for the whole file, copied into every repository (as
 * prove-control.mjs does). It lives in os.tmpdir(), the volume of the copies,
 * because the config git init writes records that file system's detection.
 */
let MOLDE = null
function molde() {
  if (!MOLDE) {
    MOLDE = mkdtempSync(join(tmpdir(), 'rebar-prove-bypass-molde-'))
    process.once('exit', () => rmSync(MOLDE, { recursive: true, force: true }))
    git(MOLDE, ['init', '--quiet'])
  }
  return join(MOLDE, '.git')
}

/**
 * A repository whose files exist ONLY in the index, the way prove.mjs builds a
 * `gerados` side: every blob in the object store, then one update-index.
 * `arquivos` maps a path to its text, or to { symlink } for a mode 120000 entry.
 *
 * On Windows a git spawn costs about 50 ms. With an init per repository, a
 * hash-object per blob and the four git calls of lerRepo, whose result
 * checarBypass never reads, git spawns took 70 of this file's 72 s (measured
 * on 2026-09-13). So the init is copied (molde), and each blob is written here
 * as the loose object git itself writes (zlib of `blob <size>\0<bytes>`, named
 * by its SHA-1), which leaves one update-index as the only git call.
 */
function repo(arquivos) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-prove-bypass-'))
  cpSync(molde(), join(dir, '.git'), { recursive: true })
  const entradas = Object.entries(arquivos)
  if (entradas.length === 0) return dir
  const registros = entradas.map(([caminho, conteudo]) => {
    const link = conteudo !== null && typeof conteudo === 'object'
    const bytes = Buffer.from(link ? conteudo.symlink : conteudo, 'utf8')
    const objeto = Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, 'utf8'), bytes])
    const oid = createHash('sha1').update(objeto).digest('hex')
    const pasta = join(dir, '.git', 'objects', oid.slice(0, 2))
    mkdirSync(pasta, { recursive: true })
    writeFileSync(join(pasta, oid.slice(2)), deflateSync(objeto))
    return `${link ? '120000' : '100644'} ${oid}\t${caminho}\0`
  })
  git(dir, ['update-index', '-z', '--add', '--index-info'], Buffer.from(registros.join('')))
  return dir
}

const oidDe = (dir, caminho) => git(dir, ['rev-parse', `:${caminho}`])

function veredito(arquivos, ajuste) {
  const dir = repo(arquivos)
  try {
    if (ajuste) ajuste(dir)
    // checarBypass reads `dir` alone: its index and its allowlist.
    return checarBypass({ dir }, TABELAS)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * A gh-aw lock file as the compiler writes it (all 24 of the corpora): the
 * header, and `activation` and `agent` jobs with the agent needing the
 * activation. `passo` is the agent step, as a run command or as YAML lines.
 */
const estruturaDeLock = (cabecalho, comando, passoYaml) =>
  `${cabecalho}name: agent\non: push\njobs:\n  activation:\n    runs-on: ubuntu-latest\n` +
  '    steps:\n      - run: echo\n  agent:\n    needs: activation\n    runs-on: ubuntu-latest\n' +
  `    steps:\n${passoYaml || `      - run: ${comando}\n`}`

const reprova = (v) => typeof v === 'string'
const avisa = (v) => v !== null && typeof v === 'object' && typeof v.nota === 'string'
const pacote = (scripts) => JSON.stringify({ name: 'x', version: '1.0.0', scripts }, null, 2)

// ─────────────────────────────────────────────────────────────── the tables

test('every table has rows of [RegExp, explicacao, verificadoEm]', () => {
  for (const [nome, tabela] of Object.entries(LINHAS)) {
    assert.ok(tabela.length > 0, `${nome} is empty`)
    for (const row of tabela) {
      assert.equal(row.length, 3, `${nome}: ${row[1]}`)
      assert.ok(row[0] instanceof RegExp)
      assert.match(row[1], /^[a-z][a-z0-9-]*( \(warning only\))?: \S/)
      assert.equal(
        row[2],
        '2026-09-12',
        `${nome}: ${row[1]} carries the date the sources were read`,
      )
    }
  }
  assert.equal(FLAGS_FORTES.filter(([, e]) => e.includes('(warning only)')).length, 1)
})

test('no table matches its own explanations, the raw engine or this proof', () => {
  // The artifact indexes the explanations and prove-table.mjs holds every table
  // against these files. A match is a rule that accuses the repository shipping it.
  const explicacoes = TODAS.map(([, e]) => e).join('\n')
  const textos = {
    explicacoes,
    'bypass.mjs': readFileSync(join(AQUI, 'bypass.mjs'), 'utf8'),
    'prove-bypass.mjs': readFileSync(join(AQUI, 'prove-bypass.mjs'), 'utf8'),
  }
  for (const [nome, texto] of Object.entries(textos)) {
    const culpados = TODAS.filter(([re]) => new RegExp(re.source, 'm').test(texto))
    assert.deepEqual(
      culpados.map(([, e]) => e),
      [],
      `${nome} matches a table row — assemble the word`,
    )
  }
})

test('a quoted binary name in data is not a binary: the artifact and sibling engines stay clean', () => {
  // mcp/rules.generated.json lists pattern words one per line as JSON strings,
  // and mcp-launch.mjs labels clients with a plain quoted id. Neither starts a
  // program, and a binary row that matched them would fail prove-table.
  const dados = [
    `        "literais": [\n          "${CL}",\n          "${CO}",\n          "${GE}"\n        ]`,
    `  { sufixo: '.mcp.json', cliente: '${CL}', chave: 'mcpServers' },`,
    `      if (s.cliente === '${GE}' && s.bruto.trust === true) {`,
    `    const ${CL} = entradaDe(indice, 'CLAUDE.md')`,
  ].join('\n')
  assert.deepEqual(
    BINARIOS_DE_AGENTE.filter(([re]) => new RegExp(re.source, 'm').test(dados)).map(([, e]) => e),
    [],
  )
})

// ─────────────────────────────────────────── casos-flags.mjs, ported (14 of 14)

const CASOS = [
  [
    'the s1ngularity map: binary and flag in separate literals',
    'codigo',
    `const cliChecks = {\n  ${CL}: { cmd: '${CL}', args: ['${SKIP}', '-p', PROMPT] },\n` +
      `  ${GE}: { cmd: '${GE}', args: ['${SEM_FREIO}', '-p', PROMPT] },\n` +
      `  q: { cmd: 'q', args: ['chat', '${CONFIA}', '${SEM_PERGUNTA}', PROMPT] },\n}`,
    [`2 ${CL} forte`, `3 ${GE} ambigua`, '4 amazon-q forte'],
  ],
  [
    'the Amazon Q line: unquoted inside a call',
    'codigo',
    `childProcess.exec(q ${CONFIA} ${SEM_PERGUNTA} "\${PROMPT}")`,
    ['1 amazon-q forte'],
  ],
  [
    'an ambiguous flag far from any binary',
    'codigo',
    `const opts = ['${SEM_FREIO}']\n\n\n\n\nrun(opts)`,
    [],
  ],
  ['a package runner asked not to prompt', 'shell', `npx ${Y} create-next-app`, []],
  ['the Gemini short switch next to its binary', 'shell', `${GE} ${Y} -p "x"`, [`1 ${GE} ambigua`]],
  ['short switches of grep and ls', 'shell', `grep -q foo file && ls ${A}`, []],
  ['npm install forced', 'shell', `npm install ${D}force`, []],
  ['cursor-agent forced', 'shell', `${CU} -p ${F} "x"`, [`1 ${CU} ambigua`]],
  ['codex never asking', 'shell', `${CO} exec ${A} never "x"`, [`1 ${CO} ambigua`]],
  ['codex with no sandbox', 'shell', `${CO} ${SANDBOX} ${SEM_SANDBOX} "x"`, [`1 ${CO} ambigua`]],
  ['claude permission mode with =', 'shell', `${CL} ${MODO}=${VALOR_MODO} -p x`, [`1 ${CL} forte`]],
  ['an env var read is not a flag', 'codigo', `if (process.env.${ENV_CP}) {}`, []],
  ['the Windows .cmd shim', 'shell', `${CL}.cmd ${SKIP} -p x`, [`1 ${CL} forte`]],
  ['through npx and the package name', 'shell', `npx ${PACOTE_CL} ${SKIP} -p x`, [`1 ${CL} forte`]],
]

for (const [nome, modo, texto, esperado] of CASOS) {
  test(`casos-flags: ${nome}`, () => {
    const achados = (modo === 'codigo' ? varrerCodigo : varrerShell)(texto, TABELAS)
    assert.deepEqual(
      achados.map((a) => `${a.linha} ${a.id} ${a.forca}`),
      esperado,
    )
  })
}

test('the window is 3 lines: 3 away counts, 4 away does not', () => {
  const com = (vazias) =>
    `const o = { cmd: '${GE}',\n${'  x: 1,\n'.repeat(vazias)}  args: ['${SEM_FREIO}'] }`
  assert.deepEqual(
    varrerCodigo(com(2), TABELAS).map((a) => `${a.linha} ${a.id}`),
    [`4 ${GE}`],
  )
  assert.deepEqual(varrerCodigo(com(3), TABELAS), [])
})

test('matching is linear: many binaries and a foreign switch on one line', () => {
  // Run whole, a row's lazy gap rescans the rest of the line from every binary:
  // measured before the engine split the rows, 20,000 copies on a 140 KB line
  // took 7.8 s, and an 8 MiB agent file would have held the gate for hours.
  const linha = `${GE} ${F} `.repeat(200_000)
  const inicio = performance.now()
  assert.deepEqual(varrerShell(linha, TABELAS), [])
  assert.deepEqual(varrerCodigo(linha, TABELAS, { guarda: false }), [])
  const ms = performance.now() - inicio
  assert.ok(ms < 5000, `${Math.round(ms)} ms for 2 MB`)
})

test('never matched: full-auto, no-interactive, print, and the Copilot env var name', () => {
  // full-auto is sandboxed (and codex exec dropped it on 2026-07-30); the
  // no-interactive switch only means "no user input"; print is headless mode.
  const linhas = [
    `${CO} exec ${AUTO_CODEX} "fix it"`,
    `${QC} ${SEM_PERGUNTA} "x"`,
    `${CL} -p "summarize"`,
    `${CP} -p x && echo ${ENV_CP}`,
    `${ENV_CP}=1 ${CP} -p x`,
  ]
  for (const l of linhas) assert.deepEqual(varrerShell(l, TABELAS), [], l)
})

test('the weak switch only warns, and only strong rows need no binary', () => {
  assert.deepEqual(
    varrerShell(`echo ${FRACA}`, TABELAS).map((a) => a.forca),
    ['fraca'],
  )
  assert.deepEqual(varrerShell(`echo ${SEM_FREIO}`, TABELAS), [])
})

test('Agent SDK option strings accuse in code', () => {
  const ts = `const r = query({ prompt, options: { permissionMode: '${VALOR_MODO}' } })`
  const py = `opts = Options(${j('allow_', 'dangerously_', 'skip_', 'permissions')}=True)`
  assert.deepEqual(
    varrerCodigo(`${ts}\n${py}`, TABELAS).map((a) => `${a.linha} ${a.forca}`),
    ['1 forte', '2 forte'],
  )
  // The type union that lists the mode is not an option set to it.
  assert.deepEqual(varrerCodigo(`type M = 'default' | '${VALOR_MODO}'`, TABELAS), [])
})

// ─────────────────────────────────────────── the two measured false positives

test('gsap: a minified line with a lone short switch stays silent', () => {
  // MotionPathHelper.min.js, one 44 KB line: `(a=-a,o=-o)` next to other
  // one-letter names. The line guard is what keeps a binary on such a line
  // from pairing with that switch; the short form of the same line fires.
  const trecho = `Math.abs(n-e)<Math.PI/2&&(a=${A},o=-o),h[l]=((h[r]+o*i)*c|0)/c`
  const comBinario = `spawn('${QC}');${trecho}`
  const minificada = `${'var v=0;'.repeat(130)}${comBinario}`
  assert.ok(minificada.length > 1000)
  assert.deepEqual(varrerCodigo(`!function(q){${trecho}}(0)`, TABELAS), [])
  assert.deepEqual(varrerCodigo(minificada, TABELAS), [])
  assert.equal(varrerCodigo(comBinario, TABELAS).length, 1, 'without the guard it would fire')
})

test('next detect-agent: reading the Copilot env var stays silent', () => {
  const texto =
    `function d(){if(process.env.COPILOT_MODEL||process.env.${ENV_CP}||` +
    'process.env.COPILOT_GITHUB_TOKEN){return{isAgent:true,agent:{name:f}}}}'
  assert.deepEqual(varrerCodigo(texto, TABELAS), [])
  assert.equal(
    veredito({ 'node_modules/next/dist/compiled/@vercel/detect-agent/index.js': texto }),
    null,
  )
})

// ─────────────────────────────────────────────────────── the places, end to end

test('a lifecycle script fails; the same text in an ordinary script only warns', () => {
  const v = veredito({ 'package.json': pacote({ postinstall: `${CL} ${SKIP} -p hi` }) })
  assert.ok(reprova(v), JSON.stringify(v))
  assert.match(v, /package\.json:\d+:\d+ \S+ .*lifecycle script postinstall/)
  for (const flag of [SKIP, D + 'dangerously'])
    assert.ok(!v.includes(flag), 'the flag is never echoed')
  assert.ok(avisa(veredito({ 'package.json': pacote({ lint: `${CL} ${SKIP} -p hi` }) })))
})

test('a lifecycle script that calls another script makes that one a lifecycle script', () => {
  const v = veredito({
    'package.json': pacote({ postinstall: 'npm run setup', setup: `${GE} ${Y} -p x` }),
  })
  assert.ok(reprova(v), JSON.stringify(v))
  assert.match(v, /script setup called by lifecycle script postinstall/)
})

test('the file a lifecycle script starts is read with the code window', () => {
  const t = `const bin = '${GE}'\nconst p = process.argv[2]\nspawnSync(bin, ['${SEM_FREIO}', '-p', p])\n`
  const rodado = veredito({
    'package.json': pacote({ postinstall: 'node scripts/t.js' }),
    'scripts/t.js': t,
  })
  assert.ok(reprova(rodado), JSON.stringify(rodado))
  assert.match(rodado, /scripts\/t\.js:3:1 /)
  const soLint = veredito({
    'package.json': pacote({ lint: 'node scripts/t.js' }),
    'scripts/t.js': t,
  })
  assert.ok(avisa(soLint), JSON.stringify(soLint))
})

test('a lifecycle script that names its file the way node resolves it still starts that file', () => {
  // Measured: `node scripts/t` runs scripts/t.js and `node scripts` runs
  // scripts/index.js, with and without "type": "module". Only the exact path
  // was followed, and the file dropped from a failure to a warning.
  const t = `const bin = '${GE}'\nconst p = process.argv[2]\nspawnSync(bin, ['${SEM_FREIO}', '-p', p])\n`
  for (const [comando, arquivo] of [
    ['node scripts/t', 'scripts/t.js'],
    ['node ./scripts/t', 'scripts/t.cjs'],
    ['node scripts', 'scripts/index.js'],
    ['node scripts/', 'scripts/index.mjs'],
    ['tsx scripts/t', 'scripts/t.ts'],
  ]) {
    const v = veredito({ 'package.json': pacote({ postinstall: comando }), [arquivo]: t })
    assert.ok(reprova(v), `${comando} -> ${arquivo}: ${JSON.stringify(v)}`)
    assert.ok(v.includes(`${arquivo}:3:1 `), v)
  }
  // A folder whose package.json names its main.
  const principal = veredito({
    'package.json': pacote({ postinstall: 'node tools/agent' }),
    'tools/agent/package.json': JSON.stringify({ name: 'agent', main: 'lib/run' }),
    'tools/agent/lib/run.js': t,
  })
  assert.ok(reprova(principal), JSON.stringify(principal))
  assert.match(principal, /tools\/agent\/lib\/run\.js:3:1 /)
  // A shell never adds an extension: `sh scripts/t` with only t.sh tracked runs nothing.
  const semExtensao = veredito({
    'package.json': pacote({ postinstall: 'sh scripts/t' }),
    'scripts/t.sh': `#!/bin/sh\n${GE} ${SEM_FREIO} -p x\n`,
  })
  assert.ok(avisa(semExtensao), JSON.stringify(semExtensao))
})

test('the name of the CLI kept in a variable opens the code window, a comparison does not', () => {
  // The Nx map kept the binary and its switch in separate literals; here the
  // binary sits in a variable a process call takes by name, or under a key in
  // another letter case. The prototype's token rule opened the window for all.
  const formas = [
    `const tool = '${GE}'\nconst flags = ['${SEM_FREIO}', '-p', 'echo']\nrequire('child_process').spawnSync(tool, flags)\n`,
    `const TOOL = "${GE}"; const flags = ['${SEM_FREIO}']\nspawnSync(TOOL, flags)\n`,
    `const o = { Command: '${GE}', args: ['${SEM_FREIO}', '-p', 'echo'] }\n`,
    `tool = "${GE}"\nsubprocess.run([tool, "${SEM_FREIO}", "-p", "echo"])\n`,
  ]
  for (const texto of formas) {
    assert.equal(varrerCodigo(texto, TABELAS).length, 1, texto)
    const v = veredito({
      'package.json': pacote({ postinstall: 'node scripts/t.js' }),
      'scripts/t.js': texto,
    })
    assert.ok(reprova(v), `${texto}: ${JSON.stringify(v)}`)
  }
  // Comparing a value with the name starts nothing: with the switch on another
  // line, no window opens.
  for (const comparacao of [
    `if (cli === '${GE}') {\n  args.push('${SEM_FREIO}')\n}`,
    `if (cli !== '${GE}')\n  args = ['${SEM_FREIO}']`,
    `const ok = cli == '${GE}'\nconst flag = '${SEM_FREIO}'`,
    `const ok = n <= '${GE}'\nconst flag = '${SEM_FREIO}'`,
  ]) {
    assert.deepEqual(varrerCodigo(comparacao, TABELAS), [], comparacao)
  }
})

test('package.json outside scripts: hook managers fail, any other member warns, nothing twice', () => {
  const comando = `${CL} ${SKIP} -p echo`
  const obj = (o) => JSON.stringify({ name: 'x', version: '1.0.0', ...o }, null, 2)
  // simple-git-hooks and husky before v5 install these strings as git hooks.
  const simples = veredito({
    'package.json': obj({ 'simple-git-hooks': { 'post-checkout': comando } }),
  })
  assert.ok(reprova(simples), JSON.stringify(simples))
  assert.match(simples, /git hook post-checkout in simple-git-hooks/)
  const husky = veredito({ 'package.json': obj({ husky: { hooks: { 'pre-commit': comando } } }) })
  assert.ok(reprova(husky), JSON.stringify(husky))
  assert.match(husky, /git hook pre-commit in husky/)
  // The file a hook command starts is started by that hook.
  const arquivo = veredito({
    'package.json': obj({ 'simple-git-hooks': { 'pre-push': 'bash scripts/check.sh' } }),
    'scripts/check.sh': `${CL} ${SKIP} -p "check"\n`,
  })
  assert.ok(reprova(arquivo), JSON.stringify(arquivo))
  assert.match(arquivo, /scripts\/check\.sh:1:\d+ .*started by git hook pre-push/)
  // Any other member is text nothing starts: a warning, as in any other JSON.
  const config = veredito({ 'package.json': obj({ config: { agent: comando } }) })
  assert.ok(avisa(config), JSON.stringify(config))
  assert.match(config.nota, /text nothing starts on its own/)
  // A script is judged once, as a script, never again as raw text.
  const script = veredito({ 'package.json': pacote({ lint: comando }) })
  assert.ok(avisa(script), JSON.stringify(script))
  assert.match(script.nota, /^1 agent CLI invocation /)
  assert.doesNotMatch(script.nota, /text nothing starts/)
  const ciclo = veredito({ 'package.json': pacote({ postinstall: comando }) })
  assert.ok(reprova(ciclo) && !ciclo.includes('warning'), ciclo)
})

test('a package.json re-encoded on checkout runs the lifecycle script checkout wrote', () => {
  // working-tree-encoding: the index blob is CJK text; npm reads the ASCII on disk.
  const texto = pacote({ postinstall: `${CL} ${SKIP} -p hi` })
  const par = texto.length % 2 ? `${texto}\n` : texto
  const noIndice = Buffer.from(par, 'latin1').toString('utf16le')
  const v = veredito({
    '.gitattributes': 'package.json working-tree-encoding=UTF-16LE\n',
    'package.json': noIndice,
  })
  assert.ok(reprova(v), JSON.stringify(v))
  assert.match(v, /lifecycle script postinstall, as checked out/)
})

test('a nested package resolves its script path from its own folder', () => {
  const v = veredito({
    'packages/a/package.json': pacote({ prepare: 'bash ./tools/x.sh' }),
    'packages/a/tools/x.sh': `#!/bin/sh\n${CO} exec ${SANDBOX} ${SEM_SANDBOX} "go"\n`,
  })
  assert.ok(reprova(v), JSON.stringify(v))
  assert.match(v, /packages\/a\/tools\/x\.sh:2:/)
})

test('an agent file fails even inside a fence; a doc warns only inside the fence', () => {
  const cerca = `# Setup\n\n\`\`\`sh\n${GE} ${Y} -p "set it up"\n\`\`\`\n`
  assert.ok(reprova(veredito({ 'AGENTS.md': cerca })))
  assert.ok(avisa(veredito({ 'docs/guide.md': cerca })))
  const prosa = `# Setup\n\nRun ${GE} ${Y} when you trust the folder.\n`
  assert.equal(veredito({ 'docs/guide.md': prosa }), null)
  assert.ok(reprova(veredito({ 'AGENTS.md': prosa })))
})

test('git hooks fail: husky, a hooks folder with a hook name', () => {
  const corpo = `#!/bin/sh\n${CL} ${SKIP} -p "review"\n`
  assert.ok(reprova(veredito({ '.husky/pre-commit': corpo })))
  assert.ok(reprova(veredito({ 'tooling/hooks/commit-msg': corpo })))
  // The same body in a folder named hooks under a name git never runs.
  assert.ok(avisa(veredito({ 'tooling/hooks/notes': corpo })))
})

test('a hook that is a symlink is judged at the link path', () => {
  const v = veredito({
    '.husky/pre-push': { symlink: '../scripts/check.sh' },
    'scripts/check.sh': `${CL} ${SKIP} -p "check"\n`,
  })
  assert.ok(reprova(v), JSON.stringify(v))
  assert.match(v, /\.husky\/pre-push:1:/)
})

test('a folder-open task with the flag on its own line is read through its JSON', () => {
  const tarefa = (runOptions) =>
    JSON.stringify(
      {
        version: '2.0.0',
        tasks: [{ label: 'agent', type: 'shell', command: GE, args: [Y, '-p', 'x'], runOptions }],
      },
      null,
      2,
    )
  const v = veredito({ '.vscode/tasks.json': tarefa({ runOn: 'folderOpen' }) })
  assert.ok(reprova(v), JSON.stringify(v))
  assert.match(v, /task run on folder open/)
  assert.equal(veredito({ '.vscode/tasks.json': tarefa({ runOn: 'default' }) }), null)
})

test('devcontainer lifecycle commands and agent hook commands fail, and so do the files they start', () => {
  const dev = JSON.stringify({ postCreateCommand: [CO, SANDBOX, SEM_SANDBOX] }, null, 2)
  assert.ok(reprova(veredito({ '.devcontainer/py/devcontainer.json': dev })))
  const settings = JSON.stringify(
    {
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'bash scripts/start.sh' }] }] },
    },
    null,
    2,
  )
  const v = veredito({
    '.claude/settings.json': settings,
    'scripts/start.sh': `${CP} ${TUDO_CP} -p "x"\n`,
  })
  assert.ok(reprova(v), JSON.stringify(v))
  assert.match(v, /scripts\/start\.sh:1:\d+ .*started by agent hook command/)
})

test('workflows fail, gh-aw lock files warn, and full-auto is no bypass', () => {
  const passo = (comando) =>
    `name: agent\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${comando}\n`
  assert.ok(
    reprova(veredito({ '.github/workflows/agent.yml': passo(`${CO} exec ${SEM_FREIO} "x"`) })),
  )
  assert.equal(
    veredito({ '.github/workflows/agent.yml': passo(`${CO} exec ${AUTO_CODEX} "x"`) }),
    null,
  )
  const cabecalho = '# This file was automatically generated by gh-aw. DO NOT EDIT.\n#\n'
  const lock = estruturaDeLock(cabecalho, `${CO} exec ${SEM_APROVACAO} "x"`)
  assert.ok(avisa(veredito({ '.github/workflows/agent.lock.yml': lock })))
  // The header alone makes no lock file: review finding 1 pasted it, with a
  // roles comment, above a plain workflow, and the switch fell to a warning.
  const falso = `${cabecalho}# GH_AW_REQUIRED_ROLES: "admin"\n${passo(`${CO} exec ${SEM_APROVACAO} "x"`)}`
  assert.ok(reprova(veredito({ '.github/workflows/agent.lock.yml': falso })))
  assert.ok(reprova(veredito({ '.github/workflows/agent.yml': lock })))
  // A workflow outside the root folder GitHub runs is ordinary text.
  assert.ok(
    avisa(
      veredito({ 'examples/.github/workflows/agent.yml': passo(`${CO} exec ${SEM_FREIO} "x"`) }),
    ),
  )
})

test('a command split by a backslash continuation or a folded YAML scalar is one command', () => {
  // Each shape splits the CLI name and its ambiguous switch over two physical
  // lines; the shell (and GitHub, for a folded `run: >`) runs them as one.
  const cabeca = 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n'
  const continuado = veredito({
    '.github/workflows/ci.yml': `${cabeca}      - run: |\n          ${GE} \\\n            ${SEM_FREIO} -p "echo"\n`,
  })
  assert.ok(reprova(continuado), JSON.stringify(continuado))
  assert.match(continuado, /\.github\/workflows\/ci\.yml:7:11 \S+ .*\(workflow\)/)

  const crlf = veredito({
    '.github/workflows/ci.yml': `${cabeca}      - run: |\r\n          ${GE} \\\r\n            ${SEM_FREIO} -p "echo"\r\n`,
  })
  assert.ok(reprova(crlf), JSON.stringify(crlf))

  const dobrado = veredito({
    '.github/workflows/ci.yml': `${cabeca}      - run: >\n          ${GE}\n          ${SEM_FREIO} -p "echo"\n`,
  })
  assert.ok(reprova(dobrado), JSON.stringify(dobrado))
  assert.match(dobrado, /ci\.yml:7:11 /)

  const plano = veredito({
    '.github/workflows/ci.yml': `${cabeca}      - run: ${GE}\n          ${SEM_FREIO} -p "echo"\n`,
  })
  assert.ok(reprova(plano), JSON.stringify(plano))

  const cerca = veredito({
    'AGENTS.md': `# a\n\n\`\`\`sh\n${GE} \\\n  ${SEM_FREIO} -p "echo"\n\`\`\`\n`,
  })
  assert.ok(reprova(cerca), JSON.stringify(cerca))

  const script = veredito({
    'package.json': pacote({ postinstall: 'sh scripts/t.sh' }),
    'scripts/t.sh': `#!/bin/sh\n${GE} \\\n  ${SEM_FREIO} -p "echo"\n`,
  })
  assert.ok(reprova(script), JSON.stringify(script))
  assert.match(script, /scripts\/t\.sh:2:1 /)

  // An even run of backslashes is a literal backslash and ends the line; a
  // literal block keeps its line breaks; separate folded paragraphs stay apart.
  assert.deepEqual(varrerShell(`${GE} \\\\\n${SEM_FREIO}\n`, TABELAS), [])
  assert.equal(
    veredito({
      '.github/workflows/ci.yml': `${cabeca}      - run: |\n          ${GE}\n          ${SEM_FREIO} -p "echo"\n`,
    }),
    null,
  )
  assert.equal(
    veredito({
      '.github/workflows/ci.yml': `${cabeca}      - run: >\n          ${GE}\n\n          ${SEM_FREIO} -p "echo"\n`,
    }),
    null,
  )
})

test('an agent file re-encoded on checkout is also read as the checkout holds it', () => {
  // working-tree-encoding: the index holds UTF-8 whose code units are pairs of
  // ASCII bytes, so the diff shows CJK text and the disk holds the command.
  const comando = `# a\n\n\`\`\`sh\n${CL} ${SKIP} -p "hi"\n\`\`\`\n`
  const par = comando.length % 2 ? `${comando} ` : comando
  const noIndice = Buffer.from(par, 'latin1').toString('utf16le')
  assert.equal(varrerShell(noIndice, TABELAS).length, 0, 'the index text holds no switch')
  const v = veredito({
    '.gitattributes': 'AGENTS.md working-tree-encoding=UTF-16LE\n',
    'AGENTS.md': noIndice,
  })
  assert.ok(reprova(v), JSON.stringify(v))
  assert.match(v, /AGENTS\.md:4:\d+ \S+ .*agent file, as checked out/)
  // A lower-case pattern reaches AGENTS.md on a checkout that ignores case, so
  // it is judged that way on every clone. Measured before: with
  // core.ignorecase=false (a Linux clone) the attribute was unspecified and
  // the rule passed.
  for (const ignorarCaixa of ['false', 'true']) {
    const caixa = veredito(
      { '.gitattributes': 'agents.md working-tree-encoding=UTF-16LE\n', 'AGENTS.md': noIndice },
      (dir) => git(dir, ['config', 'core.ignorecase', ignorarCaixa]),
    )
    assert.ok(reprova(caixa), `core.ignorecase=${ignorarCaixa}: ${JSON.stringify(caixa)}`)
    assert.match(caixa, /agent file, as checked out/)
  }
})

test('code nothing starts only warns, and a comment runs nothing', () => {
  const codigo = `import { spawn } from 'node:child_process'\nspawn('${CL}', ['${SKIP}'])\n`
  assert.ok(avisa(veredito({ 'src/a.mjs': codigo })))
  assert.equal(veredito({ 'src/a.mjs': `// spawn('${CL}', ['${SKIP}'])\nexport {}\n` }), null)
})

test('the allowlist exempts by file and blob; a stale entry and a malformed line are reported', () => {
  const arquivos = { 'package.json': pacote({ postinstall: `${CL} ${SKIP} -p hi` }) }
  const entrada = (dir) =>
    JSON.stringify({
      regra: 'agent-bypass-invocation',
      motivo: 'the maintainer runs this on purpose',
      arquivo: 'package.json',
      oid: oidDe(dir, 'package.json'),
    })
  const escrever = (dir, texto) => {
    const oid = git(dir, ['hash-object', '-w', '--no-filters', '--stdin'], Buffer.from(texto))
    git(dir, ['update-index', '--add', '--cacheinfo', `100644,${oid},.rebar-injection-allowlist`])
  }
  const aceito = veredito(arquivos, (dir) => escrever(dir, `${entrada(dir)}\n`))
  assert.ok(avisa(aceito), JSON.stringify(aceito))
  assert.match(aceito.nota, /no CODEOWNERS entry owns it/)
  const obsoleta = veredito({ 'README.md': '# x\n' }, (dir) =>
    escrever(
      dir,
      `${JSON.stringify({ regra: 'agent-bypass-invocation', motivo: 'old', arquivo: 'gone.js', oid: '0'.repeat(40) })}\n`,
    ),
  )
  assert.ok(avisa(obsoleta), JSON.stringify(obsoleta))
  assert.match(
    obsoleta.nota,
    /1 allowlist entry for agent-bypass-invocation no longer matches a finding/,
  )
  const quebrada = veredito(arquivos, (dir) => escrever(dir, `${entrada(dir)}\n{ not json\n`))
  assert.ok(reprova(quebrada), JSON.stringify(quebrada))
  assert.match(quebrada, /is malformed, so it exempts nothing/)
  assert.match(quebrada, /lifecycle script postinstall/)
})

test('an unparseable package.json runs no script and is read as plain text', () => {
  const v = veredito({ 'package.json': `{ "scripts": { "postinstall": "${CL} ${SKIP}" }, }` })
  assert.ok(avisa(v), JSON.stringify(v))
})

// ───────────────────────────────── round 3: spellings and places that slipped

test('a switch written right before a shell operator is still the switch', () => {
  // The shell ends a word at `&`, `>` and `<` and hands the switch on unchanged.
  // Before, all three shapes passed with no note, in a postinstall and in AGENTS.md.
  const formas = [
    `${CL} -p hi ${SKIP}&`,
    `${CL} -p hi ${SKIP}>/dev/null`,
    `${CL} ${SKIP}<prompt.txt`,
    `${GE} -p hi ${Y}&`,
    `${GE} ${Y}>out.txt -p hi`,
  ]
  for (const comando of formas) {
    const ciclo = veredito({ 'package.json': pacote({ postinstall: comando }) })
    assert.ok(reprova(ciclo), `postinstall ${comando}: ${JSON.stringify(ciclo)}`)
    const agente = veredito({ 'AGENTS.md': `# a\n\n${comando}\n` })
    assert.ok(reprova(agente), `AGENTS.md ${comando}: ${JSON.stringify(agente)}`)
  }
  // A redirection's `&` joins nothing; a background `&` ends the command.
  assert.equal(varrerShell(`${GE} ${Y} 2>&1`, TABELAS).length, 1)
  assert.equal(varrerShell(`${GE} -p x &>log ${Y}`, TABELAS).length, 1)
  assert.deepEqual(varrerShell(`${GE} -p x & echo ${Y}`, TABELAS), [])
})

test('the file a lifecycle script runs is found past an option and its value', () => {
  // Measured: the preload module was taken as the entry, found untracked, and
  // scripts/t.js fell to a warning.
  const t = `const bin = '${GE}'\nconst p = process.argv[2]\nspawnSync(bin, ['${SEM_FREIO}', '-p', p])\n`
  for (const comando of [
    'node -r dotenv/config scripts/t.js',
    'node --import tsx scripts/t.js',
    'node --require=dotenv/config scripts/t.js',
    'node --stack-size 4000 scripts/t.js',
    'node scripts/t.js > install.log 2>&1',
  ]) {
    const v = veredito({ 'package.json': pacote({ postinstall: comando }), 'scripts/t.js': t })
    assert.ok(reprova(v), `${comando}: ${JSON.stringify(v)}`)
    assert.ok(v.includes('scripts/t.js:3:1 '), v)
  }
  // The file after a tracked entry is its argument, not a second entry.
  const argumento = veredito({
    'package.json': pacote({ postinstall: 'node scripts/setup.js docs/notes.sh' }),
    'scripts/setup.js': 'console.log(1)\n',
    'docs/notes.sh': `${GE} ${SEM_FREIO} -p x\n`,
  })
  assert.ok(avisa(argumento), JSON.stringify(argumento))
})

test('what a git hook, a devcontainer or a folder-open task starts by name fails too', () => {
  const setup = pacote({ setup: `${GE} ${Y} -p x` })
  const huskyScript = veredito({ '.husky/pre-commit': 'npm run setup\n', 'package.json': setup })
  assert.ok(reprova(huskyScript), JSON.stringify(huskyScript))
  assert.match(huskyScript, /script setup called by git hook \.husky\/pre-commit/)

  const t = `const bin = '${GE}'\nconst p = process.argv[2]\nspawnSync(bin, ['${SEM_FREIO}', '-p', p])\n`
  const huskyArquivo = veredito({ '.husky/pre-commit': 'node scripts/t.js\n', 'scripts/t.js': t })
  assert.ok(reprova(huskyArquivo), JSON.stringify(huskyArquivo))
  assert.match(huskyArquivo, /scripts\/t\.js:3:1 .*started by git hook \.husky\/pre-commit/)

  const dev = JSON.stringify({ image: 'x', postCreateCommand: 'npm run setup' }, null, 2)
  const devcontainer = veredito({ '.devcontainer/devcontainer.json': dev, 'package.json': setup })
  assert.ok(reprova(devcontainer), JSON.stringify(devcontainer))
  assert.match(devcontainer, /script setup called by devcontainer postCreateCommand/)

  const tarefa = JSON.stringify({
    version: '2.0.0',
    tasks: [
      { label: 's', type: 'shell', command: 'npm run setup', runOptions: { runOn: 'folderOpen' } },
    ],
  })
  const tarefas = veredito({ '.vscode/tasks.json': tarefa, 'package.json': setup })
  assert.ok(reprova(tarefas), JSON.stringify(tarefas))
  assert.match(tarefas, /script setup called by task run on folder open/)

  // A package.json in a subfolder is the one its own folder's hook reaches first.
  const aninhado = veredito({
    'packages/a/.githooks/pre-push': 'yarn setup\n',
    'packages/a/package.json': setup,
  })
  assert.ok(reprova(aninhado), JSON.stringify(aninhado))
  // Nothing calls it: still a warning.
  assert.ok(avisa(veredito({ '.husky/pre-commit': 'npm test\n', 'package.json': setup })))
})

test('a git hook reaches a package script through runner options, a full path and another command', () => {
  // Backlog 5. Measured on main: every form in the first list passed with only a
  // warning, because a regular expression read the options as the script name
  // or missed a runner behind a path; `npm run ai` itself failed.
  const ai = `${GE} ${Y} -p x`
  const raiz = pacote({ ai, lint: 'eslint .' })
  for (const linha of [
    'npm run ai',
    'npm run --silent ai',
    'npm run -s ai',
    'npm run --if-present ai',
    'npm --prefix . run ai',
    'npm --prefix=. run ai',
    '/usr/local/bin/npm run ai',
    'npm.cmd run ai',
    'pnpm -s ai',
    'npx --no -- npm run ai',
    'cross-env CI=1 npm run ai',
    'bun run --silent ai',
    // pnpm -w is --workspace-root, a switch: the script is the root's.
    'pnpm -w run ai',
    'pnpm -w ai',
  ]) {
    const v = veredito({ '.husky/pre-commit': `${linha}\n`, 'package.json': raiz })
    assert.ok(reprova(v), `${linha}: ${JSON.stringify(v)}`)
    assert.match(v, /script ai called by git hook \.husky\/pre-commit/, linha)
  }
  // A workspace or a folder option points at another package.json, by folder
  // or by name.
  const membro = JSON.stringify({ name: '@acme/x', version: '1.0.0', scripts: { ai } }, null, 2)
  const espaco = {
    'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }),
    'packages/x/package.json': membro,
  }
  for (const linha of [
    'npm -w packages/x run ai',
    'npm --workspace=@acme/x run ai',
    'npm --prefix packages/x run ai',
    'pnpm --filter @acme/x run ai',
    'pnpm -C packages/x ai',
    'yarn workspace @acme/x run ai',
    'yarn --cwd packages/x ai',
    'bun --filter @acme/x run ai',
  ]) {
    const v = veredito({ ...espaco, '.husky/pre-commit': `${linha}\n` })
    assert.ok(reprova(v), `${linha}: ${JSON.stringify(v)}`)
    assert.ok(v.includes('packages/x/package.json:'), `${linha}: ${v}`)
  }
  // pnpm's workspace root is the folder of pnpm-workspace.yaml.
  const pnpmRaiz = veredito({
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'package.json': raiz,
    'packages/x/package.json': pacote({ lint: 'eslint .' }),
    'packages/x/.githooks/pre-push': 'pnpm -w run ai\n',
  })
  assert.ok(reprova(pnpmRaiz), JSON.stringify(pnpmRaiz))
  // A hook-manager string in package.json with an option still calls its own script.
  const simples = veredito({
    'package.json': JSON.stringify(
      { name: 'x', scripts: { ai }, 'simple-git-hooks': { 'pre-commit': 'npm run --silent ai' } },
      null,
      2,
    ),
  })
  assert.ok(reprova(simples), JSON.stringify(simples))
  assert.match(simples, /script ai called by git hook pre-commit in simple-git-hooks/)
  // The controls: another script is called, or no script name at all.
  const lint = veredito({ '.husky/pre-commit': 'npm run --silent lint\n', 'package.json': raiz })
  assert.ok(avisa(lint), JSON.stringify(lint))
  const semNome = veredito({ '.husky/pre-commit': 'npm run --silent\n', 'package.json': raiz })
  assert.ok(avisa(semNome), JSON.stringify(semNome))
  // A workspace option that names another package does not call the root's script.
  const outro = veredito({
    ...espaco,
    'package.json': JSON.stringify({ name: 'root', private: true, scripts: { ai } }),
    'packages/x/package.json': pacote({ lint: 'eslint .' }),
    '.husky/pre-commit': 'npm -w packages/x run ai\n',
  })
  assert.ok(avisa(outro), JSON.stringify(outro))
})

test('a script called inside a subshell, a command substitution or a quoted sh -c body is followed', () => {
  // Measured on the first cut of the runner-option parser: the shell words kept
  // `(npm` and `ai)` glued, so 12 of 26 hook lines that main's regular
  // expression followed passed with a warning, in hooks, lifecycle scripts,
  // hook-manager strings, folder-open tasks and devcontainer commands alike.
  const ai = `${GE} ${Y} -p x`
  const raiz = pacote({ ai, lint: 'eslint .' })
  for (const linha of [
    '(npm run ai)',
    'x=$(npm run ai)',
    'echo "$(npm run ai)"',
    '(cd . && npm run ai)',
    'if [ -f x ]; then (npm run ai); fi',
    'cat <(npm run ai)',
    'echo $(echo $(npm run ai))',
    "sh -c 'x;npm run ai'",
    "sh -c 'npm run --silent ai'",
    'x=`npm run ai`',
  ]) {
    const v = veredito({ '.husky/pre-commit': `${linha}\n`, 'package.json': raiz })
    assert.ok(reprova(v), `${linha}: ${JSON.stringify(v)}`)
    assert.match(v, /script ai called by git hook \.husky\/pre-commit/, linha)
  }
  const ciclo = veredito({ 'package.json': pacote({ ai, postinstall: '(cd . && npm run ai)' }) })
  assert.ok(reprova(ciclo), JSON.stringify(ciclo))
  const simples = veredito({
    'package.json': JSON.stringify(
      { name: 'x', scripts: { ai }, 'simple-git-hooks': { 'pre-commit': 'x=$(npm run ai)' } },
      null,
      2,
    ),
  })
  assert.ok(reprova(simples), JSON.stringify(simples))
  const tarefa = JSON.stringify({
    version: '2.0.0',
    tasks: [
      { label: 's', type: 'shell', command: '(npm run ai)', runOptions: { runOn: 'folderOpen' } },
    ],
  })
  const tarefas = veredito({ '.vscode/tasks.json': tarefa, 'package.json': raiz })
  assert.ok(reprova(tarefas), JSON.stringify(tarefas))
  const dev = JSON.stringify({ image: 'x', postCreateCommand: '(npm run ai)' })
  const devcontainer = veredito({ '.devcontainer/devcontainer.json': dev, 'package.json': raiz })
  assert.ok(reprova(devcontainer), JSON.stringify(devcontainer))
  // The controls: another script in a subshell, and a folder option inside it.
  const lint = veredito({ '.husky/pre-commit': '(npm run lint)\n', 'package.json': raiz })
  assert.ok(avisa(lint), JSON.stringify(lint))
  const outro = veredito({
    'package.json': JSON.stringify({ name: 'root', private: true, scripts: { ai } }),
    'packages/x/package.json': pacote({ lint: 'eslint .' }),
    '.husky/pre-commit': 'x=$(npm --prefix packages/x run ai)\n',
  })
  assert.ok(avisa(outro), JSON.stringify(outro))
})

test('spellings the target parsers accept: short groups, yargs camelCase, argparse prefixes', () => {
  const QW = j('qw', 'en')
  const AI = j('ai', 'der')
  const MODO_GE = j(D, 'approval', 'Mode')
  const SEMPRE = j(D, 'yes-', 'always')
  // yargs expands a group of short options; the rule needs the letter, not the word.
  for (const comando of [
    `${GE} ${j('-', 'yp')} hi`,
    `${GE} ${j('-', 'sy')}`,
    `${GE} ${j('-', 'ys')} -p hi`,
    `${GE} ${j('-', 'dy')}`,
    `${QW} ${j('-', 'sy')}`,
    `${GE} ${MODO_GE} ${j('yo', 'lo')}`,
    `${GE} ${MODO_GE}=${j('yo', 'lo')}`,
    `${AI} ${SEMPRE.slice(0, -1)}`,
    `${AI} ${SEMPRE.slice(0, -6)}`,
    `${AI} ${j(D, 'y')}`,
    `${CU} ${j('-', 'pf')} "x"`,
  ]) {
    const v = veredito({ 'package.json': pacote({ postinstall: comando }) })
    assert.ok(reprova(v), `${comando}: ${JSON.stringify(v)}`)
    assert.equal(varrerShell(comando, TABELAS).length, 1, comando)
  }
  const agente = veredito({ 'AGENTS.md': `# a\n\n${GE} ${j('-', 'yp')} hi\n` })
  assert.ok(reprova(agente), JSON.stringify(agente))
  // No such letter, another CLI, a longer word, and commander's refusal of camelCase.
  for (const comando of [
    `${GE} ${j('-', 'dp')} hi`,
    `npx ${j('-', 'yp')} create-next-app`,
    `${AI} ${j(D, 'yes', 'terday')}`,
    `${AI} ${SEMPRE}x`,
    `${CL} ${j(D, 'dangerously', 'Skip', 'Permissions')} -p hi`,
  ]) {
    assert.deepEqual(varrerShell(comando, TABELAS), [], comando)
    assert.equal(veredito({ 'package.json': pacote({ postinstall: comando }) }), null, comando)
  }
})

// ─────────────────────────────────────────── round 4: quotes, preloads, arity

test('a quoted prompt is one argument: its dashed words are no short switch', () => {
  // Measured before: each of these failed a workflow or an AGENTS.md, because a
  // word of the prompt matched a short-switch group of the CLI in front of it.
  // The shell hands the whole quoted prompt over as one argument.
  const passo = (comando) =>
    `name: r\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${comando}\n`
  const honestos = [
    `${QC} ${SEM_PERGUNTA} "run ls ${j('-', 'la')} and summarize"`,
    `${CU} -p "explain the ${j('-', 'fsanitize')} options" --output-format text`,
    `${GE} -p "why does find ${j('-', 'type')} d miss links"`,
    `${GE} -p 'why does find ${j('-', 'type')} d miss links'`,
    `${CU} -p "never run rm ${j('-', 'rf')}"`,
    `${CO} exec "summarize https://example.com/?a=1&b=2"`,
    `${GE} -p "a \\"quoted ${j('-', 'type')}\\" word"`,
  ]
  for (const comando of honestos) {
    assert.deepEqual(varrerShell(comando, TABELAS), [], comando)
  }
  // One repository for every shape: each command in a workflow and in the
  // postinstall of a package of its own, and in a Markdown code span of AGENTS.md.
  const lugares = {
    'AGENTS.md': `# a\n\nUse \`${CU} -p "never run rm ${j('-', 'rf')}"\` to review.\n`,
  }
  honestos.forEach((comando, i) => {
    lugares[`.github/workflows/r${i}.yml`] = passo(comando)
    lugares[`p${i}/package.json`] = pacote({ postinstall: comando })
  })
  assert.equal(veredito(lugares), null)
  // The switch itself, quoted or grouped, and a string that holds the whole
  // command (a JS call, a JSON value, a code span), still count.
  for (const comando of [
    `${GE} "${j('-', 'yp')}" hi`,
    `${GE} -p "list" ${j('-', 'yp')}`,
    `${CU} '${F}' -p "x"`,
  ]) {
    assert.equal(varrerShell(comando, TABELAS).length, 1, comando)
  }
  assert.ok(reprova(veredito({ 'AGENTS.md': `# a\n\nUse \`${CU} ${F} -p "x"\` to review.\n` })))
  assert.equal(varrerCodigo(`execSync('${GE} ${j('-', 'yp')} hi')\n`, TABELAS).length, 1)
  assert.equal(varrerCodigo(`execSync('${GE} -p "find ${j('-', 'type')} d"')\n`, TABELAS).length, 0)
  assert.equal(varrerShell(`{"cmd": "${GE} ${j('-', 'yp')} hi"}`, TABELAS).length, 1)
  assert.equal(varrerShell(`{"cmd": "${GE} -p \\"find ${j('-', 'type')}\\""}`, TABELAS).length, 0)
  assert.equal(varrerCodigo(`spawn('${GE}', ['${j('-', 'yp')}', 'hi'])\n`, TABELAS).length, 1)
  // Reading the quotes keeps the match linear: 100,000 binaries, each with a
  // quoted prompt whose dashed word is refused, on one 2.6 MB line.
  const linha = `${CU} -p "rm ${j('-', 'rf')}" `.repeat(100_000)
  const inicio = performance.now()
  assert.deepEqual(varrerShell(linha, TABELAS), [])
  assert.deepEqual(varrerCodigo(`'${linha}'`, TABELAS, { guarda: false }), [])
  const ms = performance.now() - inicio
  assert.ok(ms < 5000, `${Math.round(ms)} ms`)
})

test('a separator inside quotes does not cut the command in two', () => {
  // Measured before: the `&` of a quoted URL, and a quoted `;`, cut the binary
  // from the switch after them, and the workflow and the postinstall passed.
  const passo = (comando) =>
    `name: r\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${comando}\n`
  const lugares = {}
  const comandos = [
    `${CO} exec "summarize https://example.com/?a=1&b=2" ${SEM_FREIO}`,
    `${CO} exec "summarize a;b" ${SEM_FREIO}`,
    `${CO} exec 'see a|b' ${SEM_FREIO}`,
    `${GE} -p "fix a&b" ${Y}`,
    `${CO} exec "see https://x/?a=1&b=2" ${A} never`,
  ]
  comandos.forEach((comando, i) => {
    assert.equal(varrerShell(comando, TABELAS).length, 1, comando)
    lugares[`.github/workflows/r${i}.yml`] = passo(comando)
    lugares[`p${i}/package.json`] = pacote({ postinstall: comando })
  })
  const v = veredito(lugares)
  assert.ok(reprova(v), JSON.stringify(v))
  assert.match(v, /^10 agent CLI invocations with approval turned off: /)
  comandos.forEach((comando, i) => {
    assert.ok(v.includes(`.github/workflows/r${i}.yml:7:`), `${comando}: ${v}`)
    assert.ok(v.includes(`p${i}/package.json:5:`), `${comando}: ${v}`)
  })
  // Unquoted, the same separators still cut: the switch belongs to another command.
  assert.deepEqual(varrerShell(`${GE} -p x & echo ${Y}`, TABELAS), [])
  assert.deepEqual(varrerShell(`${CO} exec a; echo ${SEM_FREIO}`, TABELAS), [])
  // Inside a string that holds the command, its own separators cut it.
  assert.deepEqual(varrerShell(`bash -c "${GE} -p x; echo ${Y}"`, TABELAS), [])
})

test('the module a preload option loads is a file the lifecycle script runs, and the entry still is', () => {
  // Measured before: `node -r ./scripts/t.js`, `--import` and `--require=` left
  // scripts/t.js a warning, because the preload value was skipped as an option's
  // value and only the entry was followed.
  const t = `const bin = '${GE}'\nconst p = process.argv[2]\nspawnSync(bin, ['${SEM_FREIO}', '-p', p])\n`
  // One package per spelling, each with its own copy of the file.
  const comandos = [
    'node -r ./scripts/t.js other.js',
    'node -r ./scripts/t.js',
    'node --require ./scripts/t.js -e 0',
    'node --require=./scripts/t.js other.js',
    'node --import ./scripts/t.js dist/app.js',
    'node --import=./scripts/t.js dist/app.js',
    'node --loader ./scripts/t.js dist/app.js',
    'node --experimental-loader=./scripts/t.js dist/app.js',
    'tsx -r ./scripts/t dist/app.ts',
  ]
  const pacotes = {}
  comandos.forEach((comando, i) => {
    pacotes[`p${i}/package.json`] = pacote({ postinstall: comando })
    pacotes[`p${i}/scripts/t.js`] = t
  })
  const v = veredito(pacotes)
  assert.ok(reprova(v), JSON.stringify(v))
  comandos.forEach((comando, i) => {
    assert.ok(v.includes(`p${i}/scripts/t.js:3:1 `), `${comando}: ${v}`)
  })
  // Both the preload and the entry are followed.
  const ambos = veredito({
    'package.json': pacote({ postinstall: 'node -r ./scripts/pre.js scripts/t.js' }),
    'scripts/pre.js': t,
    'scripts/t.js': t,
  })
  assert.ok(reprova(ambos), JSON.stringify(ambos))
  assert.match(ambos, /^2 agent CLI invocations /)
  assert.ok(ambos.includes('scripts/pre.js:3:1 ') && ambos.includes('scripts/t.js:3:1 '), ambos)
  // An ordinary script that preloads it only warns, as before.
  const lint = veredito({
    'package.json': pacote({ lint: 'node -r ./scripts/t.js x.js' }),
    'scripts/t.js': t,
  })
  assert.ok(avisa(lint), JSON.stringify(lint))
})

test('after an option of unknown arity, the next word runs only when it is a tracked program', () => {
  const t = `const bin = '${GE}'\nconst p = process.argv[2]\nspawnSync(bin, ['${SEM_FREIO}', '-p', p])\n`
  // Measured before: the untracked build was skipped and its tracked argument,
  // a text file, was judged as the file the lifecycle script runs.
  const argumento = veredito({
    'package.json': pacote({ postinstall: 'node --inspect dist/build.js docs/prompt.txt' }),
    'docs/prompt.txt': `run ${GE} ${SEM_FREIO}\n`,
  })
  assert.ok(avisa(argumento), JSON.stringify(argumento))
  // A tracked program after the unknown option's possible value still runs.
  for (const comando of [
    'node --inspect dist/build.js scripts/t.js',
    'node --stack-size 4000 scripts/t',
  ]) {
    const v = veredito({ 'package.json': pacote({ postinstall: comando }), 'scripts/t.js': t })
    assert.ok(reprova(v), `${comando}: ${JSON.stringify(v)}`)
  }
  // An option with a separate value (measured with Node 24.13) is not the entry:
  // before, `src` resolved to src/index.js and scripts/t.js was never followed.
  const vigia = veredito({
    'package.json': pacote({ postinstall: 'node --watch-path src scripts/t.js' }),
    'src/index.js': 'console.log(1)\n',
    'scripts/t.js': t,
  })
  assert.ok(reprova(vigia), JSON.stringify(vigia))
  assert.ok(vigia.includes('scripts/t.js:3:1 '), vigia)
})

test('a redirection glued to the file word still names the file', () => {
  // Measured before: `scripts/t.js>/dev/null` stayed one word that named nothing
  // tracked, and the file fell to a warning.
  const t = `const bin = '${GE}'\nconst p = process.argv[2]\nspawnSync(bin, ['${SEM_FREIO}', '-p', p])\n`
  const comandos = [
    'node scripts/t.js>/dev/null',
    'node -r dotenv/config scripts/t.js>/dev/null',
    'node scripts/t.js&>install.log',
    'node scripts/t.js 2>/dev/null',
    'node scripts/t.js>>"install log.txt"',
    'node "scripts/t.js"<input.txt',
  ]
  const pacotes = {
    'sh/package.json': pacote({ postinstall: './scripts/t.sh>/dev/null' }),
    'sh/scripts/t.sh': `#!/bin/sh\n${GE} ${SEM_FREIO} -p x\n`,
  }
  comandos.forEach((comando, i) => {
    pacotes[`p${i}/package.json`] = pacote({ postinstall: comando })
    pacotes[`p${i}/scripts/t.js`] = t
  })
  const v = veredito(pacotes)
  assert.ok(reprova(v), JSON.stringify(v))
  comandos.forEach((comando, i) => {
    assert.ok(v.includes(`p${i}/scripts/t.js:3:1 `), `${comando}: ${v}`)
  })
  assert.match(v, /sh\/scripts\/t\.sh:2:\d+ \S+ .*started by lifecycle script postinstall/)
})

// ─────────────────────────────────── round 5: the quotes of the shell that runs it

test('quotes are read the way the shell that runs the line reads them', () => {
  // Measured before: one backslash-escape reading with the backtick as a quote,
  // for every place, hid each of these switches inside a quoted prompt, and the
  // workflow, the PowerShell script and the step passed with no note. In
  // PowerShell the backtick escapes and a backslash is literal; in a POSIX
  // shell `$'...'` takes backslash escapes and a backtick substitutes words.
  const CRASE = String.fromCharCode(96)
  const BARRA = String.fromCharCode(92)
  const passo = (runner, comando, { shell = '', defaults = '' } = {}) =>
    `name: r\non: push\n${defaults}jobs:\n  a:\n    runs-on: ${runner}\n    steps:\n` +
    `      - ${shell ? `shell: ${shell}\n        ` : ''}run: ${comando}\n`
  const escapada = `${GE} -p "don${CRASE}"t stop" ${Y} -m "x"`
  const pasta = `${GE} -p "C:${BARRA}temp${BARRA}" ${Y} -m "x"`
  const hostis = {
    // windows-* with no shell runs pwsh.
    '.github/workflows/w0.yml': passo('windows-latest', escapada),
    '.github/workflows/w1.yml': passo('ubuntu-latest', escapada, { shell: 'pwsh' }),
    '.github/workflows/w2.yml': passo('windows-latest', `${CU} -p "a${CRASE}"b" ${F} -m "x"`),
    '.github/workflows/w3.yml': passo('ubuntu-latest', pasta, {
      defaults: 'defaults:\n  run:\n    shell: powershell\n',
    }),
    // An unknown runner reads with both shells.
    '.github/workflows/w4.yml': passo('${{ matrix.os }}', pasta),
    '.github/workflows/w5.yml': passo('ubuntu-latest', `${GE} -p $'don${BARRA}'t' ${Y} -m 'x'`),
    '.github/workflows/w6.yml': passo(
      'ubuntu-latest',
      `${GE} ${CRASE}printf -- ${Y}${CRASE} -p hi`,
    ),
    'package.json': pacote({ postinstall: 'pwsh scripts/run.ps1' }),
    'scripts/run.ps1': `${pasta}\n`,
  }
  const v = veredito(hostis)
  assert.ok(reprova(v), JSON.stringify(v))
  assert.match(v, /^8 agent CLI invocations with approval turned off: /)
  for (let i = 0; i < 7; i++) {
    assert.match(v, new RegExp(`\\.github/workflows/w${i}\\.yml:\\d+:14 `), `w${i}: ${v}`)
  }
  assert.ok(v.includes('scripts/run.ps1:1:1 '), v)

  // The honest side keeps passing under each model: a doubled quote inside a
  // PowerShell string, an escaped quote and a substitution inside POSIX double
  // quotes, a Markdown code span and a JS template string.
  const honestos = {
    '.github/workflows/h0.yml': passo('windows-latest', `${GE} -p 'don''t rm ${j('-', 'rf')}'`),
    '.github/workflows/h1.yml': passo(
      'windows-latest',
      `${GE} -p "run ${CRASE}"ls ${j('-', 'la')}${CRASE}" now"`,
    ),
    '.github/workflows/h2.yml': passo(
      'ubuntu-latest',
      `${GE} -p "say ${BARRA}"hi ${j('-', 'yes')}${BARRA}" to me"`,
    ),
    '.github/workflows/h3.yml': passo(
      'ubuntu-latest',
      `${GE} -p "on ${CRASE}date ${j('-', 'u')}${CRASE} ${j('-', 'la')}"`,
    ),
    'AGENTS.md': `# a\n\nUse ${CRASE}${CU} -p "never run rm ${j('-', 'rf')}"${CRASE} to review.\n`,
    'p/package.json': pacote({ postinstall: 'node scripts/a.mjs' }),
    'p/scripts/a.mjs': `execSync(${CRASE}${GE} -p "find ${j('-', 'type')} d"${CRASE})\n`,
  }
  assert.equal(veredito(honestos), null)

  // The models themselves, with no repository.
  const comando = `${GE} -p "C:${BARRA}x${BARRA}" ${Y} x"`
  assert.deepEqual(varrerShell(comando, TABELAS, { dialetos: 'posix' }), [])
  assert.equal(varrerShell(comando, TABELAS, { dialetos: 'pwsh' }).length, 1)
  assert.equal(varrerShell(comando, TABELAS, { dialetos: ['posix', 'pwsh'] }).length, 1)
  assert.equal(varrerCodigo(`${comando}\n`, TABELAS, { dialetos: 'pwsh' }).length, 1)
  const crase = `${GE} ${CRASE}echo ${Y}${CRASE} -p hi`
  assert.deepEqual(varrerShell(crase, TABELAS), [])
  assert.equal(varrerShell(crase, TABELAS, { dialetos: 'posix' }).length, 1)
  assert.throws(() => varrerShell(comando, TABELAS, { dialetos: 'cmd' }), /unknown quote model/)
})

test('a shell option that takes a value is not the script the shell runs', () => {
  // Measured before: `pipefail`, `errexit` and `extglob` were taken as the entry,
  // named nothing tracked, and the extensionless script fell to a warning, while
  // `bash -e scripts/hook` failed.
  const script = `#!/bin/sh\n${GE} ${SEM_FREIO} -p x\n`
  const comandos = [
    'bash -o pipefail scripts/hook',
    'sh -o errexit scripts/hook',
    'bash -O extglob scripts/hook',
    'bash -eo pipefail scripts/hook',
    'bash +o posix scripts/hook',
    'bash --rcfile .bashrc scripts/hook',
    // An option the list lacks: the next word runs when it is an extensionless file.
    'zsh --unknown-option value scripts/hook',
  ]
  const pacotes = {}
  comandos.forEach((comando, i) => {
    pacotes[`p${i}/package.json`] = pacote({ postinstall: comando })
    pacotes[`p${i}/scripts/hook`] = script
    pacotes[`p${i}/.bashrc`] = 'x=1\n'
  })
  const v = veredito(pacotes)
  assert.ok(reprova(v), JSON.stringify(v))
  assert.match(v, /^7 agent CLI invocations with approval turned off: /)
  comandos.forEach((comando, i) => {
    assert.ok(v.includes(`p${i}/scripts/hook:2:1 `), `${comando}: ${v}`)
  })
})

test('not applicable only when git tracks no text', () => {
  assert.deepEqual(veredito({}), { na: 'no tracked text file' })
  const binario = String.fromCharCode(0, 1, 2, 3)
  assert.deepEqual(veredito({ 'img/a.bin': binario }), { na: 'no tracked text file' })
})

// ─────────────────────── Codex config overrides and the vendor actions' inputs

const CONFIG_SANDBOX = j('sandbox', '_mode')
const CONFIG_PERFIL = j('default', '_permissions')
const CONFIG_APROVACAO = j('approval', '_policy')

test('a Codex config override that takes the sandbox away fails, in every spelling Codex reads (backlog 12)', () => {
  // `-c key=value` overrides a key of the Codex config for one run
  // (codex-rs config_override.rs). Measured before: every spelling passed in a
  // postinstall, the Nx shape, while `-s` with the same value failed.
  const grafias = [
    `-c ${CONFIG_SANDBOX}=${SEM_SANDBOX}`,
    `--config ${CONFIG_SANDBOX}="${SEM_SANDBOX}"`,
    `--config '${CONFIG_SANDBOX}="${SEM_SANDBOX}"'`,
    `--config=${CONFIG_SANDBOX}=${SEM_SANDBOX}`,
    `-c '${CONFIG_SANDBOX} = "${SEM_SANDBOX}"'`,
    // A TOML string inside a double-quoted shell string: `sh -c "... \"v\""`.
    `-c ${CONFIG_SANDBOX}=\\"${SEM_SANDBOX}\\"`,
    `-c profiles.ci.${CONFIG_SANDBOX}=${SEM_SANDBOX}`,
    `-c ${CONFIG_PERFIL}=:${SEM_SANDBOX}`,
    // clap takes a short option value glued, and codex trims the key (review finding 12).
    `-c${CONFIG_SANDBOX}=${SEM_SANDBOX}`,
    `-c ' ${CONFIG_SANDBOX}=${SEM_SANDBOX}'`,
  ]
  for (const grafia of grafias) {
    const v = veredito({ 'package.json': pacote({ postinstall: `${CO} exec ${grafia} x` }) })
    assert.ok(reprova(v), `${grafia}: ${JSON.stringify(v)}`)
    assert.match(v, /codex runs with no sandbox at all \(lifecycle script postinstall\)/)
  }
  // The never-ask approval value is Codex's documented default for exec, which
  // has no approval option: over 1,590 repositories that row only failed one
  // SKILL.md documenting it. A model override, an echo and a quoted prompt that
  // mentions the switch stay silent too.
  for (const silencio of [
    `${CO} exec -c ${CONFIG_APROVACAO}=never x`,
    `${CO} exec -c model=o3 x`,
    `echo ${CONFIG_SANDBOX}=${SEM_SANDBOX}`,
    `${CO} exec "use -c ${CONFIG_SANDBOX}=${SEM_SANDBOX}"`,
    `${CO} exec --config${CONFIG_SANDBOX}=${SEM_SANDBOX} x`,
  ]) {
    assert.equal(veredito({ 'package.json': pacote({ postinstall: silencio }) }), null, silencio)
  }
})

test('the approval inputs of the Codex and Claude actions are read as the command they run (backlog 11)', () => {
  const ACAO_CODEX = j('openai/', CO, '-action@v1')
  const ACAO_CLAUDE = j('anthropics/', CL, '-code-action@v1')
  const workflow = (uses, com, { cabecalho = '', ancora = false } = {}) =>
    `${cabecalho}name: agent\non: push\n${ancora ? `x-pin: &pin ${uses}\n` : ''}jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n` +
    `      - uses: ${ancora ? '*pin' : uses}\n        with:\n${com
      .map((linha) => `          ${linha}`)
      .join('\n')}\n`
  const w = (texto) => veredito({ '.github/workflows/agent.yml': texto })

  const sandbox = w(workflow(ACAO_CODEX, [`sandbox: ${SEM_SANDBOX}`]))
  assert.ok(reprova(sandbox), JSON.stringify(sandbox))
  assert.match(
    sandbox,
    /agent\.yml:9:11 codex runs with no sandbox at all \(codex action input in \.github\/workflows\/agent\.yml\)/,
  )
  const lock = veredito({
    '.github/workflows/agent.lock.yml': estruturaDeLock(
      '# This file was automatically generated by gh-aw. DO NOT EDIT.\n',
      null,
      `      - uses: ${ACAO_CODEX}\n        with:\n          sandbox: ${SEM_SANDBOX}\n`,
    ),
  })
  assert.ok(avisa(lock), JSON.stringify(lock))
  assert.ok(
    avisa(
      veredito({
        'tools/agent/action.yml': `runs:\n  using: composite\n  steps:\n    - uses: ${ACAO_CODEX}\n      with:\n        sandbox: ${SEM_SANDBOX}\n`,
      }),
    ),
  )
  assert.ok(reprova(w(workflow(ACAO_CODEX, [`permission-profile: ':${SEM_SANDBOX}'`]))))
  // An alias hides nothing: the uses is read through it.
  assert.ok(reprova(w(workflow(ACAO_CODEX, [`sandbox: ${SEM_SANDBOX}`], { ancora: true }))))

  // codex-args: the bypass switch counts where the action lets it through.
  assert.ok(reprova(w(workflow(ACAO_CODEX, [`codex-args: '["${SEM_FREIO}"]'`]))))
  assert.equal(
    w(workflow(ACAO_CODEX, [`codex-args: '["${SEM_FREIO}"]'`, "permission-profile: ':workspace'"])),
    null,
  )
  // Its own sandbox choice is appended after codex-args, so a config override
  // there changes nothing under the default drop-sudo strategy.
  assert.equal(
    w(
      workflow(ACAO_CODEX, [
        'sandbox: workspace-write',
        `codex-args: '["-c","${CONFIG_SANDBOX}=${SEM_SANDBOX}"]'`,
      ]),
    ),
    null,
  )

  const modo = (valor) => `{"permissions":{"defaultMode":"${valor}"}}`
  assert.ok(reprova(w(workflow(ACAO_CLAUDE, [`settings: '${modo(VALOR_MODO)}'`]))))
  assert.ok(reprova(w(workflow(ACAO_CLAUDE, ['settings: |', `  ${modo(VALOR_MODO)}`]))))
  assert.equal(w(workflow(ACAO_CLAUDE, [`settings: '${modo(j('accept', 'Edits'))}'`])), null)
  // claude_args reaches the CLI, whose --settings takes inline JSON (review finding 10).
  const argumentos = j(CL, '_args')
  const comSettings = w(
    workflow(ACAO_CLAUDE, [
      `${argumentos}: >-`,
      `  ${D}settings '${modo(VALOR_MODO)}' ${D}max-turns 3`,
    ]),
  )
  assert.ok(reprova(comSettings), JSON.stringify(comSettings))
  assert.match(comSettings, /claude action input in \.github\/workflows\/agent\.yml/)
  assert.ok(
    reprova(w(workflow(ACAO_CLAUDE, [`${argumentos}: ${D}settings='${modo(VALOR_MODO)}'`]))),
  )
  assert.equal(
    w(workflow(ACAO_CLAUDE, [`${argumentos}: ${D}settings '${modo(j('accept', 'Edits'))}'`])),
    null,
  )
  assert.equal(w(workflow(ACAO_CLAUDE, [`${argumentos}: ${D}settings .claude/ci.json`])), null)
})

test('a missing table breaks the rule instead of running blind', () => {
  const dir = repo({ 'README.md': '# x\n' })
  try {
    assert.throws(
      () => checarBypass({ dir }, { ...TABELAS, PARES_DE_FLAG: undefined }),
      /PARES_DE_FLAG is missing/,
    )
    assert.throws(
      () => checarBypass({ dir }, { ...TABELAS, ACOES_DE_AGENTE: undefined }),
      /table ACOES_DE_AGENTE is missing or empty/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
