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

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Cliente, textoDa } from '../../mcp/src/cliente-jsonrpc.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const MODELO = join(AQUI, 'arquivos', 'mcp-rebar.mjs')
const CURTO = process.argv.includes('--curto')

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

titulo(falhas ? `${falhas} FALHA(S)` : 'everything passed')
process.exit(falhas ? 1 : 0)
