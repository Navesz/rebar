// THE PROMPT-INJECTION RULES, PROVED AS ONE GATE STEP
//
// rebar-security gained six rules that look for known prompt-injection
// signatures in what git tracks: hidden Unicode, terminal controls, agent
// settings that run commands, MCP server launches, agent CLIs started with their
// approval switch off, and escaped controls in MCP server source. Their engines
// live in `./injection/`, one file per family, and each family has its own
// node:test file. The proof runner learned to build index-only fixtures for them
// (`gerados` in tooling/rebar-check/proofs/prove.mjs), and that runner has its
// own test too.
//
// The gate runs all of it as ONE step (`security-injection` in
// verify.config.mjs): one step and not ten, because they fail for the same
// reason from the gate's point of view (the injection module changed
// behaviour) and each test already names its own family. The step hands every
// proof file to one `node --test` call, and this file imports none of them: a
// file imported here runs inside this process, in series with everything else,
// which is how the step once took 198 s of its 5 min. Given each file, `node
// --test` runs one process per file, in parallel.
//
// This file keeps a lock on the order of the six rules in index.mjs, a lock on
// the step itself (it still names every proof file, and every step that starts
// the checker still requires every engine the checker imports), and the three
// tests no single family can own, because they judge the rules together:
//
//   (d) what rebar GENERATES passes them. Generated projects run rebar-security
//       unpinned in CI, so an injection rule that failed the generated AGENTS.md
//       or `.mcp.json` would turn every downstream CI red on the day it merged.
//   (e) the proof cases do not smuggle a real agent file into rebar's own tree.
//       Claude Code loads nested instruction files on demand, so a static
//       AGENTS.md fixture under a case folder would instruct the agents that
//       work on rebar; that is why those fixtures exist only in `gerados`.
//   (f) rebar passes its own injection rules, heuristics included, with no
//       warning. The rules honour no exclusion (no proof root, no template
//       root, no .rebarignore), so this is the only thing keeping rebar's
//       sources, tables and generated artifact from becoming samples of what the
//       tables hunt.
//
// It also proves `--sugerir-allowlist`, which reads what five engines record
// and prints it as allowlist lines: no single family owns that output either.
//
// Every temp repository is built under os.tmpdir() with INDEX-ONLY entries
// (hash-object plus update-index), the way the proof runner builds `gerados`.
//
//   node --test tooling/security/prove-injection.mjs          (this file alone)
//   node tooling/verify/verify.mjs --step=security-injection  (the whole step)

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import test, { after, describe } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { moldeAgents } from '../../new/gate/aplicar.mjs'
import { REGRAS } from './index.mjs'
import { alvoDeConfig } from './injection/agent-config.mjs'
import { FORMAS_DE_CHAVE, MOTIVO_A_ESCREVER, tipoDoCaminho } from './injection/reader.mjs'

const RAIZ = fileURLToPath(new URL('../../', import.meta.url))
const CLI = fileURLToPath(new URL('./index.mjs', import.meta.url))
const MOLDE_MCP = fileURLToPath(new URL('../../new/gate/arquivos/mcp.json', import.meta.url))

/** The six rule ids this file is about, in the order index.mjs declares them. */
const INJECAO = [
  'hidden-unicode',
  'control-bytes',
  'agent-config-exec',
  'mcp-server-launch',
  'agent-bypass-invocation',
  'mcp-ansi-escape',
]

const criados = []
after(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})

// The user's global and system git config stay out of every temp repository: a
// global `core.autocrlf` or ignore file would change what the index holds, and
// the verdict would then be about this machine instead of the fixture. The same
// isolation prove.mjs uses for `gerados`: a config path that does not exist is
// an empty config to git.
const SEM_CONFIG = join(tmpdir(), 'rebar-injection-gitconfig-inexistente')
const AMBIENTE = {
  ...process.env,
  GIT_CONFIG_GLOBAL: SEM_CONFIG,
  GIT_CONFIG_SYSTEM: SEM_CONFIG,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.excludesFile',
  GIT_CONFIG_VALUE_0: SEM_CONFIG,
  NO_COLOR: '1',
}

function git(dir, argumentos, entrada, ambiente = AMBIENTE) {
  const r = spawnSync('git', ['-c', 'core.protectNTFS=false', ...argumentos], {
    cwd: dir,
    input: entrada,
    encoding: 'buffer',
    env: ambiente,
    maxBuffer: 1 << 30,
    windowsHide: true,
  })
  if (r.error) throw new Error(`git ${argumentos.join(' ')}: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`git ${argumentos.join(' ')}: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

/** A fresh repository whose INDEX holds `arquivos` ([{ caminho, bytes }]); nothing on disk. */
function repositorio(arquivos) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-injection-'))
  criados.push(dir)
  git(dir, ['init', '-q'])
  const linhas = arquivos.map(({ caminho, bytes }) => {
    // --no-filters: the blob is these bytes, whatever the attributes say.
    const oid = git(dir, ['hash-object', '-w', '--no-filters', '--stdin'], bytes)
    return `100644 ${oid}\t${caminho}\0`
  })
  git(dir, ['update-index', '-z', '--add', '--index-info'], Buffer.from(linhas.join(''), 'utf8'))
  return dir
}

/**
 * rebar-security --json over `dir`, parsed. Exit 0 and 1 are verdicts; anything
 * else is not. A temp repository runs with the isolated git config; rebar itself
 * runs with the caller's environment, the way the `security-self` step runs it.
 */
function seguranca(dir, ambiente, ...opcoes) {
  const r = spawnSync(process.execPath, [CLI, '--json', ...opcoes, dir], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: ambiente,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  assert.ok(
    r.status === 0 || r.status === 1,
    `rebar-security exited ${r.status} over ${dir}: ${String(r.stderr).trim()}`,
  )
  const [avaliacao] = JSON.parse(r.stdout)
  assert.ok(!avaliacao.erro, `rebar-security refused ${dir}: ${avaliacao.erro}`)
  return avaliacao.resultados
}

/** One line per result that is not a clean pass or not applicable, for the failure message. */
const sujos = (resultados) =>
  resultados
    .filter((x) => !['passou', 'na'].includes(x.estado) || x.nota)
    .map(
      (x) =>
        `${x.id}: ${x.estado}${x.motivo ? ` · ${x.motivo}` : ''}${x.nota ? ` · ⚠ ${x.nota}` : ''}`,
    )

describe('the six injection rules, judged together', () => {
  test('index.mjs declares the six injection rules, in order, after hardcoded-secret', () => {
    // Without this, a rule that left REGRAS would make (d) and (f) pass by
    // vacuity: --rule=<id> exits 2 and a missing id has no result to judge.
    const ids = REGRAS.map((r) => r.id)
    const depois = ids.slice(ids.indexOf('hardcoded-secret') + 1)
    assert.deepEqual(depois, INJECAO)
  })

  test('(d) what rebar generates passes every injection rule, heuristics included', () => {
    // The generated AGENTS.md and `.mcp.json` exactly as `rebar new` writes
    // them. The template launch is accepted only because the running rebar
    // ships it, and no rule maps template paths to generated ones: the
    // files are judged under the paths they have in a generated project.
    const dir = repositorio([
      { caminho: 'AGENTS.md', bytes: Buffer.from(moldeAgents('proof', null), 'utf8') },
      { caminho: '.mcp.json', bytes: readFileSync(MOLDE_MCP) },
    ])
    const vistos = []
    for (const id of INJECAO) {
      const resultados = seguranca(dir, AMBIENTE, '--heuristics', `--rule=${id}`)
      assert.equal(resultados.length, 1, `--rule=${id} ran ${resultados.length} rule(s)`)
      vistos.push(...resultados)
    }
    // No warning either: a ⚠ on every generated project's CI is a line nobody
    // can act on, and a warning nobody acts on teaches people to skip them.
    assert.deepEqual(sujos(vistos), [])
    // The template launch is judged, not skipped: mcp-server-launch must have
    // read a server, so it cannot be `na` here.
    assert.equal(vistos.find((x) => x.id === 'mcp-server-launch').estado, 'passou')
  })

  test('(e) no proof case tracks an agent file, and every caso.json is printable ASCII', () => {
    // Tracked, or about to be: the new cases of a change are untracked until it
    // is committed, and a fixture must be refused before it lands, not after.
    const listados = git(
      RAIZ,
      [
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'tooling/security/proofs/cases',
      ],
      undefined,
      process.env,
    )
      .split('\0')
      .filter(Boolean)
    const presentes = [...new Set(listados)].filter((rel) => existsSync(join(RAIZ, rel)))
    assert.ok(presentes.length > 0, 'no file listed under tooling/security/proofs/cases')

    const lados = presentes.filter((rel) =>
      /^tooling\/security\/proofs\/cases\/[^/]+\/(pass|fail)\//.test(rel),
    )
    const agentes = lados.filter(
      (rel) => tipoDoCaminho(rel) === 'agente' || alvoDeConfig(rel) !== null,
    )
    assert.deepEqual(
      agentes,
      [],
      'a case folder tracks a file an agent reads or obeys. Move it into the side\'s "gerados" ' +
        '(written only to the index of the assembled repository), and delete the file.',
    )

    const casos = presentes.filter((rel) =>
      /^tooling\/security\/proofs\/cases\/[^/]+\/caso\.json$/.test(rel),
    )
    assert.ok(casos.length > 0, 'no caso.json found')
    const foraDoAscii = []
    for (const rel of casos) {
      const bytes = readFileSync(join(RAIZ, rel))
      const k = bytes.findIndex((b) => b !== 0x0a && (b < 0x20 || b > 0x7e))
      if (k >= 0) foraDoAscii.push(`${rel} byte ${k} is 0x${bytes[k].toString(16)}`)
    }
    // Printable ASCII keeps every hidden or control code point out of the case
    // files themselves: those exist only as base64 or caminhoBase64, which no
    // rule decodes, so hidden-unicode and control-bytes pass on rebar's own
    // proofs without any exemption.
    assert.deepEqual(foraDoAscii, [])
  })

  test('(f) rebar passes its own injection rules, heuristics included, with no warning', () => {
    const resultados = seguranca(RAIZ, process.env, '--heuristics').filter((x) =>
      INJECAO.includes(x.id),
    )
    assert.deepEqual(
      resultados.map((x) => x.id),
      INJECAO,
    )
    assert.deepEqual(
      sujos(resultados),
      [],
      'these rules read the INDEX: a fix that is only in the working tree does ' +
        'not count until it is staged, and in CI the index is the commit',
    )
  })
})

// ─────────────────────────────────────────────────────── --sugerir-allowlist

/** rebar-security with raw arguments over a temp repository: { status, stdout, stderr }. */
function cli(...argumentos) {
  const r = spawnSync(process.execPath, [CLI, ...argumentos], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: AMBIENTE,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  return { status: r.status, stdout: String(r.stdout), stderr: String(r.stderr) }
}

describe('--sugerir-allowlist', () => {
  const cp = (...n) => String.fromCodePoint(...n)
  const ESC = cp(0x1b)
  const J = (o) => `${JSON.stringify(o, null, 2)}\n`
  // Assembled: the agent CLI and its approval switch, like prove-bypass.mjs does.
  const AGENTE = ['gem', 'ini'].join('')
  const SWITCH = ['--', 'yo', 'lo'].join('')
  const arquivos = [
    // control-bytes: a concealing colour sequence in a note.
    { caminho: 'notes.txt', bytes: Buffer.from(`a${ESC}[8mhidden${ESC}[28m\n`, 'utf8') },
    // hidden-unicode: a zero-width space in a file name.
    { caminho: `docs/no${cp(0x200b)}tes.md`, bytes: Buffer.from('# notes\n', 'utf8') },
    // agent-config-exec: a rule that approves every npx command.
    {
      caminho: '.claude/settings.json',
      bytes: Buffer.from(J({ permissions: { allow: [`${['Ba', 'sh'].join('')}(npx *)`] } })),
    },
    // mcp-server-launch: a package launch nobody accepted.
    {
      caminho: '.mcp.json',
      bytes: Buffer.from(
        J({
          mcpServers: { docs: { command: 'npx', args: ['-y', '@example-proof/docs-mcp@1.2.3'] } },
        }),
      ),
    },
    // agent-bypass-invocation: a postinstall that starts an agent with approval off.
    {
      caminho: 'package.json',
      bytes: Buffer.from(J({ name: 'x', scripts: { postinstall: `${AGENTE} -p x ${SWITCH}` } })),
    },
  ]
  const QUATRO = [
    'control-bytes',
    'agent-config-exec',
    'mcp-server-launch',
    'agent-bypass-invocation',
  ]
  // One rule per run, as test (d) does: hardcoded-secret reads the disk, and an
  // index-only repository breaks it.
  const injecao = (dir) =>
    INJECAO.flatMap((id) => seguranca(dir, AMBIENTE, '--heuristics', `--rule=${id}`))
  const estados = (dir) => Object.fromEntries(injecao(dir).map((x) => [x.id, x.estado]))

  test('prints one exact, escaped line per exemptable finding; the placeholder exempts nothing; a motivo does', () => {
    const dir = repositorio(arquivos)
    const r = cli('--sugerir-allowlist', dir)
    assert.equal(r.status, 0, r.stderr)
    // Printable ASCII and LF only: a raw U+200B would reach the terminal or the
    // agent that runs this, which is what escaparSaida prevents everywhere else.
    const fora = [...r.stdout].filter((ch) => ch !== '\n' && (ch < ' ' || ch > '~'))
    assert.deepEqual(fora, [], 'the output carries a code point outside printable ASCII')
    const [cabecalho, ...linhas] = r.stdout.trimEnd().split('\n')
    assert.match(
      cabecalho,
      /^# 5 line\(s\) for \.rebar-injection-allowlist\. Replace every motivo /,
    )
    assert.match(cabecalho, /the reader refuses the placeholder/)
    const objetos = linhas.map((l) => JSON.parse(l))
    assert.deepEqual(
      objetos.map((o) => o.regra),
      [
        'hidden-unicode',
        'control-bytes',
        'agent-config-exec',
        'mcp-server-launch',
        'agent-bypass-invocation',
      ],
    )
    for (const o of objetos) {
      const campos = Object.keys(o)
      assert.equal(campos[0], 'regra')
      assert.equal(campos[campos.length - 1], 'motivo')
      assert.equal(o.motivo, MOTIVO_A_ESCREVER)
      const forma = campos.slice(1, -1)
      assert.ok(
        FORMAS_DE_CHAVE.some((f) => f.join() === forma.join()),
        `${forma.join('+')} is not a key shape, in its order`,
      )
    }
    // The name came out escaped as JSON, and decodes back to the real path.
    assert.ok(r.stdout.includes(`docs/no${String.fromCharCode(92)}u200btes.md`), r.stdout)
    assert.equal(objetos[0].arquivo, `docs/no${cp(0x200b)}tes.md`)
    assert.deepEqual(Object.keys(objetos[2]), ['regra', 'arquivo', 'ponteiro', 'sha256', 'motivo'])
    assert.equal(objetos[2].ponteiro, '/permissions/allow/0')

    // Pasted as printed: every injection rule fails on the placeholder.
    const colado = repositorio([
      ...arquivos,
      { caminho: '.rebar-injection-allowlist', bytes: Buffer.from(r.stdout, 'utf8') },
    ])
    const comMarca = injecao(colado)
    for (const x of comMarca) {
      assert.equal(x.estado, 'reprovou', `${x.id}: ${x.estado}`)
      assert.match(x.motivo, /placeholder/, x.id)
    }
    // A second run names the malformed lines, and still suggests every key.
    const deNovo = cli('--sugerir-allowlist', colado)
    assert.equal(deNovo.status, 0, deNovo.stderr)
    assert.match(
      deNovo.stdout,
      /^# 5 line\(s\) .* 5 malformed line\(s\) in the allowlist: fix them first\./,
    )

    // With a reason a person wrote, the four rules whose finding it was pass.
    const editado = r.stdout.replaceAll(MOTIVO_A_ESCREVER, 'reviewed in the proof')
    const aceito = repositorio([
      ...arquivos,
      { caminho: '.rebar-injection-allowlist', bytes: Buffer.from(editado, 'utf8') },
    ])
    const depois = estados(aceito)
    for (const id of QUATRO) assert.equal(depois[id], 'passou', `${id}: ${depois[id]}`)
    // hidden-unicode passes too: the only finding was the name, and its entry is valid.
    assert.equal(depois['hidden-unicode'], 'passou')
    // Nothing left to suggest.
    assert.match(cli('--sugerir-allowlist', aceito).stdout, /^# 0 line\(s\) /)
  })

  test('a key already in the allowlist is not suggested again, even while another line is malformed', () => {
    const dir = repositorio(arquivos)
    const [, ...linhas] = cli('--sugerir-allowlist', dir).stdout.trimEnd().split('\n')
    // One line edited, the other four left as printed: the placeholders make the
    // allowlist malformed, so agent-config-exec and agent-bypass-invocation
    // release nothing and record their findings again.
    const [primeira, ...resto] = linhas
    const meio = [primeira.replace(MOTIVO_A_ESCREVER, 'reviewed in the proof'), ...resto].join('\n')
    const parcial = repositorio([
      ...arquivos,
      { caminho: '.rebar-injection-allowlist', bytes: Buffer.from(`${meio}\n`, 'utf8') },
    ])
    const r = cli('--sugerir-allowlist', parcial)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^# 4 line\(s\) .* 4 malformed line\(s\)/)
    assert.ok(!r.stdout.includes(primeira.slice(0, 40)), r.stdout)
  })

  test('a key longer than 4096 characters is counted, not printed; --rule narrows; wrong calls exit 2', () => {
    // A 300-character path is printed: the first cut withheld every key over
    // 200 characters, though the reader accepts any length.
    const medio = `docs/${'b'.repeat(300)}${cp(0x200b)}.md`
    const longo = `docs/${'a'.repeat(4100)}${cp(0x200b)}.md`
    const dir = repositorio([
      { caminho: longo, bytes: Buffer.from('# x\n', 'utf8') },
      { caminho: medio, bytes: Buffer.from('# y\n', 'utf8') },
      arquivos[0],
    ])
    const r = cli('--sugerir-allowlist', dir)
    assert.equal(r.status, 0, r.stderr)
    assert.match(
      r.stdout,
      /^# 2 line\(s\) .* 1 finding\(s\) with a key longer than 4096 characters: write that line by hand\.\n/,
    )
    assert.ok(!r.stdout.includes('a'.repeat(4100)), 'the long name was printed')
    const barra = String.fromCharCode(92)
    assert.ok(r.stdout.includes(`"arquivo":"docs/${'b'.repeat(300)}${barra}u200b.md"`), r.stdout)
    const soUma = cli('--sugerir-allowlist', '--rule=hidden-unicode', dir)
    assert.match(soUma.stdout, /^# 1 line\(s\) .* 1 finding\(s\) with a key longer/)

    const comJson = cli('--json', '--sugerir-allowlist', dir)
    assert.equal(comJson.status, 2)
    assert.match(comJson.stderr, /--sugerir-allowlist takes one repository and no --json/)
    assert.equal(cli('--sugerir-allowlist', dir, dir).status, 2)
    assert.equal(cli('--sugerir-allowlist').status, 2)
    const inexistente = cli('--sugerir-allowlist', join(dir, 'nao-existe'))
    assert.equal(inexistente.status, 2)
    assert.match(inexistente.stderr, /path does not exist/)
  })
})

// ─────────────────────────────────────────────────────────────── the step

/** The steps of verify.config.mjs, by name. */
async function passos() {
  const config = await import(pathToFileURL(join(RAIZ, 'verify.config.mjs')).href)
  return new Map((config.default ?? []).map((p) => [p.nome, p]))
}

/**
 * Every file under tooling/security that `tooling/security/index.mjs` loads
 * through static relative imports and re-exports, followed to the end. Only
 * statements whose bindings are names, braces and `*` count: `export const x =`
 * never reaches the `from` of a later line.
 */
function importadosPeloChecker() {
  const vistos = new Set()
  const pendentes = ['tooling/security/index.mjs']
  const declaracao = /^(?:import|export)\s+(?:[\w$*{}\s,]+?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm
  while (pendentes.length) {
    const rel = pendentes.pop()
    if (vistos.has(rel)) continue
    vistos.add(rel)
    const fonte = readFileSync(join(RAIZ, rel), 'utf8')
    for (const m of fonte.matchAll(declaracao)) {
      const alvo = posix.normalize(posix.join(posix.dirname(rel), m[1]))
      if (alvo.startsWith('tooling/security/')) pendentes.push(alvo)
    }
  }
  return [...vistos].sort()
}

describe('the security-injection step', () => {
  test('it hands every proof file to node --test, and this file imports none of them', async () => {
    // One file imported by another runs inside that process, in series: that
    // is how ~500 tests took 198 s of a 5 min limit. Each file given to
    // `node --test` gets its own process, and they run in parallel.
    const passo = (await passos()).get('security-injection')
    assert.ok(passo, 'verify.config.mjs has no security-injection step')
    const [executavel, modo, ...resto] = passo.comando
    assert.equal(executavel, process.execPath)
    assert.equal(modo, '--test')
    const opcoes = resto.filter((a) => a.startsWith('--'))
    const arquivos = resto.filter((a) => !a.startsWith('--'))

    // Without an explicit concurrency `node --test` runs availableParallelism() - 1
    // files at once, which is ONE on a 2-core machine: measured, the step was
    // then killed at its 5 min limit, slower than all the tests in one process.
    // A fixed number in the command, and not one computed on this machine,
    // because mcp/generate.mjs publishes the command as it is written.
    const concorrencia = opcoes.map((a) => /^--test-concurrency=(\d+)$/.exec(a)).find(Boolean)
    assert.ok(concorrencia, `the step sets no --test-concurrency: ${opcoes.join(' ')}`)
    assert.equal(Number(concorrencia[1]), arquivos.length, 'every proof file runs at once')

    const familias = readdirSync(join(RAIZ, 'tooling/security/injection'))
      .filter((nome) => /^prove-.+\.mjs$/.test(nome))
      .map((nome) => `tooling/security/injection/${nome}`)
    const esperados = [
      ...familias,
      'tooling/rebar-check/proofs/prove-gerados.mjs',
      'tooling/security/prove-injection.mjs',
    ].sort()
    assert.deepEqual([...arquivos].sort(), esperados, 'a proof file is missing from the step')
    for (const arquivo of arquivos) {
      assert.ok(passo.exige.includes(arquivo), `${arquivo} runs in the step and is not in exige`)
    }

    const proprio = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    const importados = [
      ...proprio.matchAll(/^import\s+(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/gm),
    ]
      .map((m) => m[1])
      .filter((de) => /(?:^|\/)prove-[^/]+\.mjs$/.test(de))
    assert.deepEqual(importados, [], 'an imported proof file runs in series inside this process')
  })

  test('every step that starts the checker requires every engine the checker imports', async () => {
    // A step without an engine in `exige` starts the checker, node dies with
    // ERR_MODULE_NOT_FOUND, and the gate reports a repository that FAILED (1)
    // with a hint about a finding, instead of tooling that DID NOT RUN (127).
    const carregados = importadosPeloChecker()
    assert.ok(carregados.includes('tooling/security/injection/bypass.mjs'), carregados.join(', '))
    assert.ok(carregados.includes('tooling/security/texto-seguro.mjs'), carregados.join(', '))
    const todos = await passos()
    for (const nome of ['security', 'security-table', 'security-injection', 'security-self']) {
      const passo = todos.get(nome)
      assert.ok(passo, `verify.config.mjs has no ${nome} step`)
      const faltam = carregados.filter((rel) => !(passo.exige ?? []).includes(rel))
      assert.deepEqual(faltam, [], `${nome} starts the checker without requiring these files`)
    }
  })
})
