// The gate testing itself.
//
// WHY THIS FILE EXISTS, and why it is not a facade test. The rebar ruler has a
// `testes` rule that only asks whether a test file exists, and satisfying it
// with an `assert.ok(true)` would be trivial. That is exactly the fraud the
// `ui-falso` rule exists to catch in another shape: the apparatus without the
// thing.
//
// What it measures is the one invariant this repository cannot lose without
// warning: the gate's pieces are still in place. Deleting the .gitattributes,
// removing the hook, dropping the `verificar` script from package.json — each of
// those slips past unnoticed in a big diff and only shows up months later, as
// CRLF noise or as a committed secret. Here they go red on the spot.
//
// Runs on Node's built-in, without a single dependency: node --test testes/

import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

// fileURLToPath, not .pathname: on Windows the pathname comes as "/C:/Users/...".
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const ler = (rel) => readFileSync(join(RAIZ, rel), 'utf8')
const tem = (rel) => existsSync(join(RAIZ, rel))

test('the gate files are in place', () => {
  for (const arquivo of [
    '.editorconfig',
    '.gitattributes',
    '.rebar-coauthors',
    '.github/workflows/verificar.yml',
    '.github/dependabot.yml',
    '.githooks/pre-commit',
    '.githooks/commit-msg',
    '.githooks/install.mjs',
    'LICENSE',
    'NOTICE',
    'README.md',
    'AGENTS.md',
    '.mcp.json',
    // The remote gate is a PAIR: the record of what the branch protection has to
    // be, and the script that asks GitHub and compares. Deleting either one is
    // the cheapest way to make `npm run verificar` stop asking — which is
    // exactly the silence the pair was written to end.
    '.rebar/portao-remoto.json',
    '.rebar/portao-remoto.mjs',
    '.rebar/check-links.mjs',
  ]) {
    assert.ok(tem(arquivo), `missing: ${arquivo}`)
  }
})

// ────────────────────────────────────────────────── the remote gate, offline
//
// WHY THIS TEST RUNS WITHOUT NETWORK AND WITHOUT `gh`. The branch protection is
// the one demand of this project that lives on GitHub's servers, so the check
// that asks about it needs a token and can only WARN when it cannot ask. That
// leaves a hole nobody would see: delete the record, and the whole subject goes
// quiet on every machine that has no token — including CI.
//
// So the FILE is guarded here, in `npm test`, offline, on both systems. And with
// it the one fact that cannot be allowed to drift: the check names.
//
// The names GitHub matches a required status check by are the workflow's job
// name with the matrix expanded. They live in the workflow. The record keeps a
// written-down COPY of them so a human can read it with no network — and this is
// the gate that keeps the copy honest. Without it, renaming the matrix leaves a
// ruleset requiring a context no workflow produces: a gate that waits forever
// for a check nobody runs, with everything else green.
test('the remote gate record is readable, and its checks match the workflow', async () => {
  const registro = JSON.parse(ler('.rebar/portao-remoto.json'))
  assert.equal(typeof registro.esquema, 'number', 'the record has no `esquema`')
  assert.ok(registro.estado, 'the record has no `estado`')
  assert.ok(registro.exigido, 'the record has no `exigido` — there is nothing to demand')
  assert.ok(Array.isArray(registro.exigido.checks), '`exigido.checks` is not a list')
  assert.ok(registro.exigido.checks.length > 0, '`exigido.checks` is empty — it demands no CI')

  // Imported, not reimplemented: the expansion of a matrix into check names is
  // the checker's job, and a second implementation here would be a second thing
  // to get wrong.
  const { checksDoFluxo } = await import(
    pathToFileURL(join(RAIZ, '.rebar', 'portao-remoto.mjs')).href
  )
  const doFluxo = checksDoFluxo(ler('.github/workflows/verificar.yml'), registro.exigido.job)

  // Compared as SETS: the order of a matrix is not a promise, and a test that
  // fails on a reordering is a test people learn to ignore.
  assert.deepEqual(
    [...registro.exigido.checks].sort(),
    [...doFluxo].sort(),
    'the record demands checks the workflow does not produce (or stopped demanding one it does)',
  )
})

// ─────────────────────────────────────── this project's MCP, and its freshness
//
// THIS PROJECT KEEPS NO COPY OF THE RULES, and that is the decision, not an
// oversight. It has an MCP SERVER of its own — `.rebar/mcp.mjs`, zero
// dependencies — and that server recites nothing from inside itself: every
// answer is DERIVED from this project's files on disk, at call time. There is no
// artifact to regenerate, so there is no freshness gate to build.
//
// The bad consequence, and there are two, is that both break SILENTLY. A
// `.mcp.json` pointing at a file that does not exist shows up in the AI client
// as a gray line nobody reads. And a server that recites the rule after the file
// enforcing it is gone sounds exactly like a gate in force. In both the agent
// carries on WITHOUT KNOWING, which is the class of defect this whole repository
// exists not to repeat.
//
// So the four tests below measure, in this order: that the `.mcp.json` points at
// something that exists; that what it points at does not corrupt the protocol
// channel; that the server actually COMES UP, does the handshake and publishes
// the five tools `AGENTS.md` tells the agent to call; and that it answers
// DESARMADA instead of reciting a rule with no guard. They run in `npm test`,
// inside `npm run verificar`, inside CI, on both systems, and WITHOUT NETWORK.

/** The server path is READ from `.mcp.json`, never repeated here. */
function lancadorDeclarado() {
  const conf = JSON.parse(ler('.mcp.json'))
  const servidor = conf?.mcpServers?.rebar
  assert.ok(servidor, '.mcp.json does not declare the `rebar` server')
  const alvo = (servidor.args || []).find((a) => a.endsWith('.mjs'))
  assert.ok(alvo, '.mcp.json declares the `rebar` server without pointing at any .mjs')
  return alvo
}

test('the .mcp.json points at a server that exists', () => {
  const conf = JSON.parse(ler('.mcp.json'))
  // `node` and not `npx`: on Windows `npx` is `npx.cmd`, a batch script, and the
  // MCP client starts the server WITHOUT a shell — it would be ENOENT on every
  // Windows machine and on no Linux one. It is the defect that killed the
  // previous project, and it comes back the moment someone "simplifies" this file.
  assert.equal(conf.mcpServers.rebar.command, 'node', '.mcp.json has to call `node`')
  const alvo = lancadorDeclarado()
  assert.ok(tem(alvo), `.mcp.json points at ${alvo}, which is not on disk`)
})

test('the server writes to stdout by ONE path only, and it is the JSON-RPC one', () => {
  // The MCP stdio transport is pure JSON-RPC on stdout. A line of prose there
  // does not become a warning: it becomes a malformed message, and the client
  // drops the session without saying why. A forgotten debug `console.log` is the
  // easiest way to break this, and the hardest to diagnose afterwards.
  //
  // The ruler is NOT "zero writes to stdout" — the server has to write, it is its
  // channel. It is "one write only", concentrated in the send function, so that
  // there is no second place prose could come out of.
  const fonte = ler(lancadorDeclarado())
  const escritas = (fonte.match(/process\.stdout\.write/g) || []).length
  // `assert.equal` on the number, and not `assert.doesNotMatch` on the text: the
  // second dumps the WHOLE file into the output when it fails, and the message
  // that matters gets buried. The ruler has to be readable at the moment it shuts.
  assert.equal(escritas, 1, `the server has ${escritas} writes to stdout; there must be exactly 1`)
  assert.ok(
    !/console\.log/.test(fonte),
    'there is a console.log in the server, and that corrupts the JSON-RPC',
  )
  assert.ok(fonte.includes('github:Navesz/rebar'), 'the server does not name the published ruler')
})

/**
 * Starts a project's MCP server, does the handshake and calls tools.
 *
 * WITHOUT NETWORK and without a dependency: the server reads the disk and
 * nothing else. That is what separates this proof from the previous one — the
 * old version of this file was a launcher that called
 * `npx github:Navesz/rebar --mcp`, and that chain exited 2 on every machine,
 * always, because the MCP SDK lives in a package separate from rebar that `npx`
 * never installs. A proof that needs network is a proof that does not run in a
 * client's CI.
 */
function conversarComOMcp(raizProjeto, chamadas) {
  const conf = JSON.parse(readFileSync(join(raizProjeto, '.mcp.json'), 'utf8'))
  const s = conf.mcpServers.rebar
  const pedidos = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'portao', version: '0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ...chamadas.map((c, i) => ({
      jsonrpc: '2.0',
      id: 10 + i,
      method: 'tools/call',
      params: { name: c.name, arguments: c.args || {} },
    })),
  ]
  // Everything at once into stdin and the pipe closes: the server processes line
  // by line and exits on `end`. There is no waiting on the clock, so the test is
  // neither slow nor flaky on a loaded machine.
  const r = spawnSync(s.command, s.args, {
    cwd: raizProjeto,
    input: pedidos.map((p) => JSON.stringify(p)).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 30_000,
  })
  const linhas = (r.stdout || '').split('\n').filter((l) => l.trim())
  const respostas = linhas.map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      // Prose in the protocol channel is THE defect this server cannot have. It
      // becomes a named failure, and not a raw JSON.parse blowing up.
      assert.fail(`the server wrote prose to stdout, which is the JSON-RPC channel: ${l}`)
    }
  })
  return { r, respostas }
}

test('the MCP server comes up from .mcp.json, handshakes and answers the tools', () => {
  // WHY THIS TEST EXECUTES, instead of only reading the file. A server that never
  // ran is exactly what rebar's requirement nº 5 complains about: code on disk
  // that no machine executed — and an MCP that does not come up shows up in the
  // client as a gray line nobody reads.
  const { r, respostas } = conversarComOMcp(RAIZ, [
    { name: 'rebar_regras' },
    { name: 'rebar_verificar' },
  ])

  const ini = respostas.find((m) => m.id === 1)
  assert.ok(ini?.result, `the handshake did not come back: ${r.stderr}`)
  assert.equal(ini.result.serverInfo.name, 'rebar')
  assert.ok(ini.result.capabilities?.tools, 'the server does not announce the `tools` capability')
  // The instructions are the only text that reaches the agent without it calling
  // anything. If they do not order the ruler to be called, the server comes up
  // and teaches nobody — which is the defect this whole file exists not to repeat.
  assert.match(
    ini.result.instructions,
    /rebar_regras/,
    'the instructions do not order rebar_regras to be called',
  )

  const lista = respostas.find((m) => m.id === 2)
  const nomes = (lista?.result?.tools || []).map((t) => t.name)
  // The names are a contract with AGENTS.md: it is what tells the agent to call them.
  for (const esperado of [
    'rebar_regras',
    'rebar_porque',
    'rebar_decidir',
    'rebar_portao',
    'rebar_verificar',
  ]) {
    assert.ok(
      nomes.includes(esperado),
      `the server does not publish \`${esperado}\`, which AGENTS.md orders to be called`,
    )
  }

  const regras = respostas.find((m) => m.id === 10)
  const texto = regras?.result?.content?.[0]?.text || ''
  // The strings below are RULE IDS, not prose — they stay as they are written in
  // the ruler. Translating one here stops the match without failing anything.
  assert.ok(
    texto.includes('conteudo-fora-do-codigo'),
    'rebar_regras says nothing about where the content lives',
  )
  assert.ok(
    texto.includes('placeholder-barra-o-build'),
    'rebar_regras says nothing about the build that fails on the placeholder',
  )
  assert.ok(
    texto.includes('segredo-nao-entra-no-commit'),
    'rebar_regras says nothing about the secret blocked at the commit',
  )
  assert.ok(
    texto.includes('coautoria-e-de-humano'),
    'rebar_regras says nothing about AI co-authorship',
  )
  assert.ok(texto.includes('pilha-fechada'), 'rebar_regras says nothing about the stack')

  assert.ok(respostas.find((m) => m.id === 11)?.result, 'rebar_verificar did not answer')
})

test('the MCP server answers DESARMADA instead of reciting a rule with no guard', () => {
  // THE INVERSE CASE, and it is what gives the one above its value. An answer
  // that recites the rule always — including when the file enforcing it was
  // deleted — is worse than silence: it sounds like a rule in force, and the
  // agent goes on trusting a gate that no longer exists.
  //
  // The mutation is made on a COPY in tmpdir, never in this repository.
  //
  // `DESARMADA` and `Avise o usuário` below stay Portuguese: they are the
  // literal state string and the literal warning the MCP server emits, matched
  // verbatim. Translating them here stops the match without failing anything.
  const copia = mkdtempSync(join(tmpdir(), 'rebar-mcp-mutado-'))
  mkdirSync(join(copia, '.rebar'), { recursive: true })
  writeFileSync(join(copia, '.mcp.json'), ler('.mcp.json'), 'utf8')
  writeFileSync(join(copia, '.rebar', 'mcp.mjs'), ler(lancadorDeclarado()), 'utf8')
  // Minimal package.json: the project exists, and none of the files that enforce
  // the rules were copied. That is the mutation.
  writeFileSync(join(copia, 'package.json'), '{"name":"mutado"}\n', 'utf8')

  const { respostas } = conversarComOMcp(copia, [{ name: 'rebar_regras' }])
  const texto = respostas.find((m) => m.id === 10)?.result?.content?.[0]?.text || ''
  assert.match(
    texto,
    /DESARMADA/,
    'the server recited the rules in a project with no file that enforces them',
  )
  assert.match(
    texto,
    /Avise o usuário/,
    'the server does not order the user to be warned when the gate is unarmed',
  )
})

test('AGENTS.md orders the rules derived, and repeats none', () => {
  const agents = ler('AGENTS.md')
  assert.match(agents, /npx --yes github:Navesz\/rebar \./, 'AGENTS.md has no derived ruler')
  assert.match(agents, /\.mcp\.json/, 'AGENTS.md does not mention the MCP pointer')
  // Comparison by text, and not by a regex built on the spot: the path has a dot
  // and a slash, and a badly escaped regex here would match by accident and prove
  // nothing.
  const alvo = lancadorDeclarado()
  assert.ok(agents.includes(alvo), `AGENTS.md does not cite ${alvo}, which .mcp.json executes`)
})

test('AGENTS.md speaks of this project, and not only of the framework', () => {
  // WHY THIS TEST. `shadcn create` hands over a 5-line AGENTS.md in English that
  // only warns about a Next breaking change. It crosses all 22 rebar-check rules
  // without touching one — `idioma-unico` only reads CODE comments, and `readme`
  // only looks at the README. The original forensics catalogued "AGENTS.md
  // missing or boilerplate only" with frequency 5 in 6. Without this test,
  // undoing the gate's decision lights up nothing.
  const agents = ler('AGENTS.md')
  assert.match(agents, /<!-- rebar:agentes -->/, 'AGENTS.md did not go through the gate')
  // The two anchors the decision promised: where the agent is sent to read, and
  // where the allowlist is that says it does not sign the commit.
  assert.match(agents, /README\.md/, 'AGENTS.md does not point at the README')
  assert.match(agents, /\.rebar-coauthors/, 'AGENTS.md does not point at the co-author allowlist')
  // `português do Brasil` stays Portuguese: it is the phrase AGENTS.md itself
  // uses to declare the project language, and the project language IS Brazilian
  // Portuguese. Translating the pattern makes it match nothing.
  assert.match(agents, /português do Brasil/i, 'AGENTS.md does not declare the project language')
})

test('the shadcn block in AGENTS.md stays intact, if it came', () => {
  // Third-party information about the Next version installed HERE. It ages with
  // Next and is not ours to rewrite; the gate pulls it out by the markers and
  // puts it back. If the block exists, it has to be closed — half a block is a
  // block truncated by the rewrite, and that is the defect this test hunts.
  const agents = ler('AGENTS.md')
  const abre = agents.includes('BEGIN:nextjs-agent-rules')
  const fecha = agents.includes('END:nextjs-agent-rules')
  assert.equal(abre, fecha, 'the `nextjs-agent-rules` block was left half-written in AGENTS.md')
  if (abre) {
    assert.match(
      agents,
      /node_modules\/next\/dist\/docs/,
      'the shadcn block lost its content in the rewrite',
    )
  }
})

test('the line ending is normalized to LF', () => {
  const attrs = ler('.gitattributes')
  assert.match(attrs, /^\*\s+text=auto\s+eol=lf$/m, '.gitattributes without `* text=auto eol=lf`')
  // Both hooks are read by /bin/sh. CRLF in the shebang makes the interpreter not
  // be found, and the error message does not say so.
  assert.match(attrs, /\.githooks\/pre-commit\s+text\s+eol=lf/)
  assert.match(attrs, /\.githooks\/commit-msg\s+text\s+eol=lf/)
})

test('package.json declares what CI invokes', () => {
  const pkg = JSON.parse(ler('package.json'))
  const scripts = pkg.scripts || {}
  for (const nome of ['verificar', 'typecheck', 'test', 'build']) {
    assert.ok(scripts[nome], `package.json without a \`${nome}\` script`)
  }
  // rebar's `ci-gateia` rule demands that CI REACH what the repository has. CI
  // runs one command only, `npm run verificar`; if this script stops chaining the
  // others, CI starts passing without having looked.
  // `format-check`, `links`, `secret` and `portao-remoto` are in this list for a
  // measured reason: rebar charges itself for 23 steps and the projects it
  // generated ran 6. The gravest of the four is `secret` — the hook scans only
  // what is STAGED and vanishes with `--no-verify`, so until it entered the
  // chain a credential committed that way reached main with the CI green.
  for (const nome of [
    'format-check',
    'lint',
    'typecheck',
    'test',
    'links',
    'secret',
    'portao-remoto',
  ]) {
    if (!scripts[nome]) continue
    // Inside a template literal, `\b` is the BACKSPACE character, not the word
    // boundary — the regex becomes /<bs>lint<bs>/ and never matches. It cost a
    // red run to show up, and it is exactly the kind of defect only execution
    // finds: the code reads right and does something else. A plain string, with
    // the backslash doubled, is the fix.
    assert.match(
      scripts.verificar,
      new RegExp('\\b' + nome + '\\b'),
      `the \`verificar\` script does not reach \`${nome}\``,
    )
  }
})

test('the Apache license comes with the NOTICE', () => {
  assert.match(ler('LICENSE'), /Apache License/)
  assert.ok(ler('NOTICE').trim().length > 0, 'empty NOTICE')
})

test('the co-author allowlist has at least one human', () => {
  const linhas = ler('.rebar-coauthors')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  assert.ok(linhas.length >= 1, '.rebar-coauthors with no identity at all')
  assert.ok(
    linhas.every((l) => /@/.test(l)),
    'every allowlist line needs an e-mail — the e-mail is what gets compared',
  )
})

test('the site exports static, which is what GitHub Pages publishes', () => {
  // §12.2 of the plan settled it: the `site` preset is Next App Router with
  // output:"export". Without this `next build` generates a server, and Pages
  // publishes an empty folder — a failure that only shows at deploy, never at
  // build.
  const config = ler('next.config.ts')
  assert.match(config, /output:\s*['"]export['"]/, 'next.config.ts without output: "export"')
  assert.match(
    config,
    /unoptimized:\s*true/,
    'next.config.ts without images.unoptimized — the optimizer requires a server',
  )
})
