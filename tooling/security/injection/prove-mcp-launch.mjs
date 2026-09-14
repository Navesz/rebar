// THE MCP LAUNCH RULE, PROVED AGAINST THE LAUNCHES IT EXISTS TO STOP
//
// tooling/security/injection/mcp-launch.mjs decides which MCP servers a
// versioned config may start. Three things here would fail in silence if they
// drifted: the fingerprint (an entry that stops matching after a harmless key
// reorder teaches people to delete entries; one that keeps matching after an
// args change accepts a different program), the template launch (without it,
// rebar-site, assay and navesz-portfolio go red on their next CI), and the
// checks no allowlist entry may exempt.
//
// Every repository is built in os.tmpdir() with INDEX-ONLY entries (hash-object
// plus update-index --index-info), the way the proof runner builds `gerados`.
// Every special character is built at runtime, so this file holds no raw
// invisible or control character.
//
//   node --test tooling/security/injection/prove-mcp-launch.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CONTROLES, IGNORAVEIS, naFaixa } from '../texto-seguro.mjs'
import {
  EXECUTORES_REMOTOS,
  SINAIS_DE_SHELL,
  arquivosReferenciados,
  checarMcpLaunch,
  classificarLancamento,
  especNpm,
  impressaoDeLancamento,
  lancamentoCanonico,
  mcpRemoteAbaixo,
} from './mcp-launch.mjs'

const criados = []
after(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, maxRetries: 3, force: true })
})

const TABELAS = { EXECUTORES_REMOTOS, SINAIS_DE_SHELL }
const MOLDE = fileURLToPath(new URL('../../../new/gate/arquivos/mcp.json', import.meta.url))
const AUSENTE = new URL('./there-is-no-template-here.json', import.meta.url)
const NUL = String.fromCodePoint(0)
const HEX40 = 'ab'.repeat(20)
const HEX64 = 'cd'.repeat(32)

// ───────────────────────────────────────────────────────── temp repositories

// The machine's git config never decides what these repositories hold: no
// system or global file (Git for Windows ships core.autocrlf=true in its
// system config, which rewrote CRLF blobs to LF before the rule saw them) and
// no excludes file. The same isolation prove-injection.mjs uses.
const SEM_CONFIG = join(tmpdir(), 'rebar-prove-mcp-launch-gitconfig-inexistente')
const AMBIENTE = {
  ...process.env,
  GIT_CONFIG_GLOBAL: SEM_CONFIG,
  GIT_CONFIG_SYSTEM: SEM_CONFIG,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.excludesFile',
  GIT_CONFIG_VALUE_0: SEM_CONFIG,
  GIT_AUTHOR_NAME: 'proof',
  GIT_AUTHOR_EMAIL: 'proof@example.invalid',
  GIT_COMMITTER_NAME: 'proof',
  GIT_COMMITTER_EMAIL: 'proof@example.invalid',
}

function git(dir, argumentos, entrada) {
  const r = spawnSync('git', ['-c', 'core.protectNTFS=false', ...argumentos], {
    cwd: dir,
    input: typeof entrada === 'string' ? Buffer.from(entrada, 'utf8') : entrada,
    encoding: 'buffer',
    env: AMBIENTE,
    maxBuffer: 1 << 30,
    windowsHide: true,
  })
  if (r.status !== 0) throw new Error(`git ${argumentos.join(' ')}: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

/**
 * A fresh repository whose index holds `arquivos`: { caminho: conteudo }, where
 * conteudo is a string, a Buffer, or { symlink: target }. Blob bytes are staged
 * in a sibling temp folder, never in the repository's working tree.
 */
function repositorio(arquivos) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-mcp-launch-'))
  criados.push(dir)
  git(dir, ['init', '-q'])
  const lista = Object.entries(arquivos)
  if (!lista.length) return dir
  const pasta = mkdtempSync(join(tmpdir(), 'rebar-mcp-launch-blobs-'))
  criados.push(pasta)
  const caminhos = lista.map(([, conteudo], k) => {
    const arquivo = join(pasta, String(k))
    const bytes =
      conteudo && typeof conteudo === 'object' && !Buffer.isBuffer(conteudo)
        ? Buffer.from(conteudo.symlink, 'utf8')
        : Buffer.from(conteudo)
    writeFileSync(arquivo, bytes)
    return arquivo
  })
  const oids = git(
    dir,
    ['hash-object', '-w', '--no-filters', '--stdin-paths'],
    `${caminhos.join('\n')}\n`,
  ).split('\n')
  const linhas = lista.map(([caminho, conteudo], k) => {
    const modo =
      conteudo && typeof conteudo === 'object' && !Buffer.isBuffer(conteudo) ? '120000' : '100644'
    return `${modo} ${oids[k]}\t${caminho}${NUL}`
  })
  git(dir, ['update-index', '-z', '--add', '--index-info'], linhas.join(''))
  return dir
}

const checar = (dir, extra = {}) => checarMcpLaunch({ dir }, { ...TABELAS, ...extra })
const json = (valor) => `${JSON.stringify(valor, null, 2)}\n`
const entrada = (arquivo, servidor, lancamento, motivo = 'accepted in a proof') =>
  JSON.stringify({
    regra: 'mcp-server-launch',
    motivo,
    arquivo,
    servidor,
    sha256: impressaoDeLancamento(lancamento),
  })

// ═══════════════════════════════════════════════════════════════ the tables

describe('the tables', () => {
  test('every row is [RegExp, explanation] with exactly one named group', () => {
    for (const [nome, tabela] of Object.entries(TABELAS)) {
      assert.ok(tabela.length >= 4, `${nome} has ${tabela.length} rows`)
      for (const [padrao, explicacao] of tabela) {
        assert.ok(padrao instanceof RegExp && typeof explicacao === 'string' && explicacao.trim())
        assert.ok(!padrao.global && !padrao.sticky, `${padrao} keeps state between tests`)
        const grupos = padrao.source.match(/\(\?<[A-Za-z]+>/g) || []
        assert.equal(grupos.length, 1, `${padrao} needs exactly one named group`)
      }
    }
  })

  test('no row matches its own explanation or the raw text of the files that define it', () => {
    // The rows are anchored and tested against short single-line keys built
    // from an argv, so they cannot match whole file text. This locks that: a
    // row loosened into a free-text search would accuse these very files.
    const fontes = ['./mcp-launch.mjs', './prove-mcp-launch.mjs'].map((f) =>
      readFileSync(new URL(f, import.meta.url), 'utf8'),
    )
    for (const tabela of Object.values(TABELAS)) {
      for (const [padrao, explicacao] of tabela) {
        assert.equal(padrao.test(explicacao), false, `${padrao} matches its own explanation`)
        for (const fonte of fontes)
          assert.equal(padrao.test(fonte), false, `${padrao} matches a source`)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════ fingerprint

describe('the fingerprint', () => {
  const a = { command: 'node', args: ['srv.mjs', '--x'], env: { B: '2', A: '1' }, cwd: 'tools' }

  test('does not move when keys are reordered, at the top or nested', () => {
    const b = { cwd: 'tools', env: { A: '1', B: '2' }, args: ['srv.mjs', '--x'], command: 'node' }
    assert.equal(impressaoDeLancamento(a), impressaoDeLancamento(b))
    assert.match(impressaoDeLancamento(a), /^[0-9a-f]{64}$/)
  })

  test('moves when anything that decides what runs changes', () => {
    const base = impressaoDeLancamento(a)
    for (const outro of [
      { ...a, args: ['srv.mjs'] },
      { ...a, args: ['--x', 'srv.mjs'] },
      { ...a, env: { A: '1', B: '3' } },
      { ...a, cwd: 'other' },
      { ...a, type: 'sse' },
      { ...a, envFile: '.env.local' },
      { ...a, headersHelper: 'echo proof' },
    ]) {
      assert.notEqual(impressaoDeLancamento(outro), base, JSON.stringify(outro))
    }
  })

  test('ignores fields that do not change the launch, and infers the type', () => {
    assert.equal(
      impressaoDeLancamento({ ...a, timeout: 5000, description: 'x' }),
      impressaoDeLancamento(a),
    )
    assert.equal(lancamentoCanonico({ command: 'node' }).type, 'stdio')
    assert.equal(lancamentoCanonico({ url: 'https://mcp.example.invalid' }).type, 'http')
    assert.equal(
      impressaoDeLancamento({ command: 'node' }),
      impressaoDeLancamento({ type: 'stdio', command: 'node' }),
    )
    assert.deepEqual(Object.keys(lancamentoCanonico({ args: [], command: 'x' })), [
      'type',
      'command',
      'args',
    ])
  })
})

// ═══════════════════════════════════════════════════════════════ classifier

describe('the classifier', () => {
  // The self-test vectors of the phase-1 classifier prototype.
  // Each expectation lists the shell and exec-flag labels first, then every
  // downloaded package with whether it is pinned. Three expectations differ from
  // the prototype, on purpose: `server-filesystem@2025.8.21` is pinned (the
  // prototype's vector was wrong, it is an exact version); `npx -c` and
  // `npm run` carry the exec-flag label the rule defines, where the
  // prototype said shell and nothing; and the mcp-remote finding is locked in
  // its own test below. Pins are not reported by the rule (phase 2), but the
  // parser that phase will use is locked here.
  const vetores = [
    [['node', '.rebar/mcp.mjs'], []],
    [['npx', '-y', '@modelcontextprotocol/server-filesystem', '.'], ['pacote-remoto:false']],
    [
      ['npx', '-y', '@modelcontextprotocol/server-filesystem@2025.8.21', '.'],
      ['pacote-remoto:true'],
    ],
    [['npx', '-y', 'some-server@1.2.3'], ['pacote-remoto:true']],
    [['npx', '-y', 'some-server@^1.2.3'], ['pacote-remoto:false']],
    [['npx', '-y', 'some-server@latest'], ['pacote-remoto:false']],
    [['npx', '--yes', 'github:owner/repo', '.'], ['pacote-remoto:false']],
    [['npx', '--yes', 'github:owner/repo#main', '.'], ['pacote-remoto:false']],
    [['npx', '--yes', 'github:owner/repo#semver:^1.0.0'], ['pacote-remoto:false']],
    [['npx', '--yes', 'github:owner/repo#4727d357ea'], ['pacote-remoto:false']],
    [['npx', '--yes', `github:owner/repo#${HEX40}`], ['pacote-remoto:true']],
    [['npx', '--yes', '-p', `github:owner/repo#${HEX40}`, 'bin-name', '.'], ['pacote-remoto:true']],
    [['npx', 'owner/repo'], ['pacote-remoto:false']],
    [['npx', './local-bin.js'], []],
    [['npx', '-c', 'echo hi'], ['exec-flag']],
    [
      ['cmd', '/c', 'npx', '-y', 'some-server@1.2.3'],
      ['shell', 'pacote-remoto:true'],
    ],
    [['npx', 'mcp-remote', 'https://example.invalid/sse'], ['pacote-remoto:false']],
    [['npx', 'mcp-remote@0.1.16', 'https://example.invalid/sse'], ['pacote-remoto:true']],
    [['uvx', 'mcp-server-fetch'], ['pacote-remoto:false']],
    [['uvx', 'mcp-server-fetch@1.2.3'], ['pacote-remoto:true']],
    [['uvx', '--from', 'mcp-server-fetch==1.2.3', 'mcp-server-fetch'], ['pacote-remoto:true']],
    [['uvx', '--from', `git+https://github.com/o/r@${HEX40}`, 'x'], ['pacote-remoto:true']],
    [['uvx', '--from', 'git+https://github.com/o/r@v1.0', 'x'], ['pacote-remoto:false']],
    [['pnpm', 'dlx', 'some-server'], ['pacote-remoto:false']],
    [['yarn', 'dlx', 'some-server@1.0.0'], ['pacote-remoto:true']],
    [['bunx', 'some-server'], ['pacote-remoto:false']],
    [['docker', 'run', '-i', '--rm', 'ghcr.io/o/img:latest'], ['imagem-remota:false']],
    [['docker', 'run', '-i', '--rm', `ghcr.io/o/img@sha256:${HEX64}`], ['imagem-remota:true']],
    [
      ['bash', '-c', 'npx -y some-server'],
      ['shell', 'pacote-remoto:false'],
    ],
    [['npm', 'run', 'dev'], ['exec-flag']],
  ]

  const resumo = (argv) => {
    const c = classificarLancamento(argv, TABELAS)
    const saida = c.rotulos.filter((r) => r === 'shell' || r === 'exec-flag')
    for (const x of c.execucoes) {
      for (const p of x.pacotes) {
        if (!p.remoto) continue
        saida.push(`${x.familia === 'imagem' ? 'imagem-remota' : 'pacote-remoto'}:${p.fixado}`)
      }
    }
    return saida
  }

  for (const [argv, esperado] of vetores) {
    test(argv.join(' '), () => assert.deepEqual(resumo(argv), esperado))
  }

  test('labels: local, remote-package, shell and exec-flag', () => {
    const rotulos = (argv) => classificarLancamento(argv, TABELAS).rotulos
    assert.deepEqual(rotulos(['node', '.rebar/mcp.mjs']), ['local'])
    assert.deepEqual(rotulos(['npx', './local-bin.js']), ['local'])
    assert.deepEqual(rotulos(['npx', 'some-server@1.2.3']), ['remote-package'])
    assert.deepEqual(rotulos(['bash', '-lc', 'node srv.mjs']), ['shell'])
    assert.deepEqual(rotulos(['pwsh', '-Command', 'node srv.mjs']), ['shell'])
    assert.deepEqual(rotulos(['node', 'srv.mjs', 'a && b']), ['shell'])
    assert.deepEqual(rotulos(['node', 'srv.mjs', `a${String.fromCodePoint(10)}b`]), ['shell'])
    assert.deepEqual(rotulos(['npm', 'run', 'dev']), ['exec-flag'])
    assert.deepEqual(rotulos(['npm', 'exec', 'some-server']), ['remote-package', 'exec-flag'])
    assert.deepEqual(rotulos(['env', 'A=1', 'npx', 'some-server']), ['remote-package'])
    assert.deepEqual(rotulos(['C:\\tools\\CMD.EXE', '/C', 'npx some-server']), [
      'remote-package',
      'shell',
    ])
  })

  test('especNpm tells local, git, tarball and registry specs apart', () => {
    assert.equal(especNpm('./x').remoto, false)
    assert.equal(especNpm('file:../x').remoto, false)
    assert.equal(especNpm('github:o/r').tipo, 'git')
    assert.equal(especNpm('https://example.invalid/x.tgz').tipo, 'tarball')
    assert.equal(especNpm('@scope/name@1.0.0').nome, '@scope/name')
  })

  test('mcp-remote below 0.1.16, unversioned or ranged below, is named', () => {
    for (const w of ['mcp-remote', 'mcp-remote@0.1.15', 'mcp-remote@0.0.5', 'mcp-remote@latest']) {
      assert.equal(mcpRemoteAbaixo(w), true, w)
    }
    for (const w of [
      'mcp-remote@0.1.16-beta.1',
      '--package=mcp-remote@0.1.1',
      'node_modules/.bin/mcp-remote',
    ]) {
      assert.equal(mcpRemoteAbaixo(w), true, w)
    }
    for (const w of [
      'mcp-remote@0.1.16',
      'mcp-remote@^0.1.16',
      'mcp-remote@1.0.0',
      '@acme/mcp-remote',
    ]) {
      assert.equal(mcpRemoteAbaixo(w), false, w)
    }
    for (const w of ['https://example.invalid/mcp-remote', 'mcp-remote-client', 'my-mcp-remote']) {
      assert.equal(mcpRemoteAbaixo(w), false, w)
    }
  })

  test('mcp-remote below 0.1.16 as a registry tarball or a git spec is named', () => {
    // Measured before: neither spelling was recognised, so a fingerprint
    // allowlisted the CVE version.
    for (const w of [
      'https://registry.npmjs.org/mcp-remote/-/mcp-remote-0.1.10.tgz',
      './vendor/mcp-remote-0.1.15.tgz',
      'github:geelen/mcp-remote#v0.1.10',
      'github:geelen/mcp-remote',
      'geelen/mcp-remote#semver:0.1.12',
      'git+https://github.com/geelen/mcp-remote.git#main',
      `git+ssh://git@github.com/geelen/mcp-remote.git#${HEX40}`,
    ]) {
      assert.equal(mcpRemoteAbaixo(w), true, w)
    }
    for (const w of [
      'https://registry.npmjs.org/mcp-remote/-/mcp-remote-0.1.16.tgz',
      'github:geelen/mcp-remote#v0.1.16',
      'git+https://github.com/geelen/mcp-remote-fork.git#v0.1.10',
      'github:acme/other-server#v0.1.10',
    ]) {
      assert.equal(mcpRemoteAbaixo(w), false, w)
    }
  })

  test('mcp-remote behind an npm alias, or in any URL a runner resolves, needs a provable version', () => {
    // Measured before: a .tar.gz tarball, a GitHub archive or codeload link, a
    // repository URL with a ref and an alias of 0.1.10 were all accepted by an
    // allowlist fingerprint.
    const comoPacote = { comoPacote: true }
    for (const w of [
      'alias@npm:mcp-remote@0.1.10',
      '@acme/proxy@npm:mcp-remote',
      '--package=x@npm:mcp-remote@^0.1.2',
    ]) {
      assert.equal(mcpRemoteAbaixo(w), true, w)
      assert.equal(mcpRemoteAbaixo(w, comoPacote), true, w)
    }
    for (const w of [
      'https://registry.npmjs.org/mcp-remote/-/mcp-remote-0.1.10.tar.gz',
      'https://github.com/geelen/mcp-remote#v0.1.10',
      'https://github.com/geelen/mcp-remote',
      'https://github.com/geelen/mcp-remote/archive/refs/tags/v0.1.10.tar.gz',
      'https://github.com/geelen/mcp-remote/archive/main.zip',
      'https://codeload.github.com/geelen/mcp-remote/tar.gz/v0.1.10',
      `https://codeload.github.com/geelen/mcp-remote/tar.gz/${HEX40}`,
      'ssh://git@github.com/geelen/mcp-remote.git',
      'https://example.invalid/mcp-remote',
    ]) {
      assert.equal(mcpRemoteAbaixo(w, comoPacote), true, w)
    }
    for (const w of [
      'alias@npm:mcp-remote@0.1.16',
      'https://registry.npmjs.org/mcp-remote/-/mcp-remote-0.1.16.tar.gz',
      'https://github.com/geelen/mcp-remote#v0.1.16',
      'https://github.com/geelen/mcp-remote/archive/refs/tags/v0.1.18.tar.gz',
      'https://codeload.github.com/geelen/mcp-remote/tar.gz/v0.1.16',
      'https://github.com/acme/mcp-remote-fork#v0.1.10',
      'https://mcp-remote.example.invalid/sse',
      'alias@npm:other-proxy@0.1.10',
    ]) {
      assert.equal(mcpRemoteAbaixo(w, comoPacote), false, w)
    }
  })
})

// ═══════════════════════════════════════════════════ the rule over a repository

describe('the implicit launch is the template of the running rebar', () => {
  const molde = readFileSync(MOLDE)

  test('the template .mcp.json passes with no allowlist', () => {
    assert.equal(checar(repositorio({ '.mcp.json': molde })), null)
  })

  test('the same launch with keys reordered still passes, since the fingerprint is canonical', () => {
    const valor = JSON.parse(molde.toString('utf8'))
    const [nome, s] = Object.entries(valor.mcpServers)[0]
    const invertido = Object.fromEntries(Object.entries(s).reverse())
    assert.equal(
      checar(repositorio({ '.mcp.json': json({ mcpServers: { [nome]: invertido } }) })),
      null,
    )
  })

  test('without the template file (a vendored checker) the same launch needs an entry', () => {
    const saida = checar(repositorio({ '.mcp.json': molde }), { molde: AUSENTE })
    assert.equal(typeof saida, 'string')
    assert.match(saida, /\[local\] fingerprint sha256:[0-9a-f]{64}/)
  })

  test('a template launch with one more arg is a different launch', () => {
    const valor = JSON.parse(molde.toString('utf8'))
    for (const s of Object.values(valor.mcpServers)) s.args = [...(s.args || []), '--proof']
    assert.equal(typeof checar(repositorio({ '.mcp.json': json(valor) })), 'string')
  })
})

describe('not applicable', () => {
  test('no config tracked', () => {
    assert.deepEqual(checar(repositorio({ 'README.md': '# proof\n' })), {
      na: 'no MCP server configuration tracked',
    })
  })

  test('a settings file without a servers key, and an empty servers object', () => {
    const dir = repositorio({ '.gemini/settings.json': json({ theme: 'x' }) })
    assert.deepEqual(checar(dir), { na: 'no MCP server configuration tracked' })
    const vazio = repositorio({ '.mcp.json': json({ mcpServers: {} }) })
    assert.deepEqual(checar(vazio), { na: 'the tracked MCP configuration declares no server' })
  })
})

describe('launches that need an entry', () => {
  const remoto = { type: 'http', url: 'https://mcp.example.invalid/private-path' }

  test('a remote url fails with its label and fingerprint, and never prints the url', () => {
    const saida = checar(repositorio({ '.mcp.json': json({ mcpServers: { docs: remoto } }) }))
    assert.equal(typeof saida, 'string')
    assert.ok(saida.includes('.mcp.json:3:5 server docs [remote-url] fingerprint sha256:'), saida)
    assert.ok(saida.includes(impressaoDeLancamento(remoto)), saida)
    assert.ok(!saida.includes('example.invalid'), 'the url text leaked into the output')
  })

  test('the command text is never printed either', () => {
    const s = { command: 'node', args: ['private-script-name.mjs'] }
    const saida = checar(repositorio({ '.mcp.json': json({ mcpServers: { x: s } }) }))
    assert.ok(!saida.includes('private-script-name'), saida)
  })

  test('an allowlist entry accepts the exact launch, and a CODEOWNERS nota says who guards it', () => {
    const s = { command: 'npx', args: ['--yes', 'some-server@1.2.3'] }
    const config = json({ mcpServers: { fetch: s } })
    const linha = entrada('.mcp.json', 'fetch', s)
    const aceito = checar(
      repositorio({ '.mcp.json': config, '.rebar-injection-allowlist': `${linha}\n` }),
    )
    assert.equal(typeof aceito, 'object')
    assert.match(aceito.nota, /1 MCP launch accepted by \.rebar-injection-allowlist/)

    const guardado = checar(
      repositorio({
        '.mcp.json': config,
        '.rebar-injection-allowlist': `# accepted launches\n${linha}\n`,
        '.github/CODEOWNERS': '.rebar-injection-allowlist @owner-proof\n',
      }),
    )
    assert.equal(guardado, null)
  })

  test('the entry matches the launch, not the name: other args fail and the entry is stale', () => {
    const aceito = { command: 'npx', args: ['--yes', 'some-server@1.2.3'] }
    const trocado = { command: 'npx', args: ['--yes', 'some-server@1.2.4'] }
    const saida = checar(
      repositorio({
        '.mcp.json': json({ mcpServers: { fetch: trocado } }),
        '.rebar-injection-allowlist': `${entrada('.mcp.json', 'fetch', aceito)}\n`,
      }),
    )
    assert.equal(typeof saida, 'string')
    assert.match(saida, /\[remote-package\]/)
    assert.match(
      saida,
      /1 \.rebar-injection-allowlist entry for mcp-server-launch matches no current launch/,
    )
  })

  test('a stale entry alone is a nota', () => {
    const saida = checar(
      repositorio({
        '.mcp.json': readFileSync(MOLDE),
        '.rebar-injection-allowlist': `${entrada('.mcp.json', 'gone', { command: 'node' })}\n`,
      }),
    )
    assert.match(
      saida.nota,
      /^1 \.rebar-injection-allowlist entry for mcp-server-launch matches no/,
    )
  })

  test('shell launches are labelled and still exemptable', () => {
    const s = { command: 'bash', args: ['-c', 'echo proof'] }
    const config = json({ mcpServers: { sh: s } })
    assert.match(checar(repositorio({ '.mcp.json': config })), /\[shell\]/)
    const aceito = checar(
      repositorio({
        '.mcp.json': config,
        '.rebar-injection-allowlist': `${entrada('.mcp.json', 'sh', s)}\n`,
      }),
    )
    assert.equal(typeof aceito.nota, 'string')
  })

  test('VS Code servers in JSONC with a comment and a trailing comma are read', () => {
    const texto =
      '{\n  // proof\n  "servers": {\n    "local": { "command": "node", "args": ["srv.mjs"], },\n  },\n}\n'
    const saida = checar(repositorio({ '.vscode/mcp.json': texto }))
    assert.match(saida, /^1 MCP launch finding: \.vscode\/mcp\.json:4:5 server local \[local\]/)
  })

  test('VS Code servers of a dev container and a workspace file are read, and one launch has one fingerprint', () => {
    // Backlog 13: these gave na before. The dev container section is the one
    // the VS Code MCP docs name (51 of 194 search hits, 7 in a subfolder); the
    // workspace one is what mcpResourceScannerService.ts reads for a workspace.
    const shell = { command: 'bash', args: ['-c', 'echo proof'] }
    const subpasta = checar(
      repositorio({
        '.devcontainer/py/devcontainer.json': `{\n  // a JSONC comment\n  "customizations": { "vscode": { "mcp": { "servers": { "sh": ${JSON.stringify(shell)} } } } },\n}\n`,
      }),
    )
    assert.match(subpasta, /\.devcontainer\/py\/devcontainer\.json:3:\d+ server sh \[shell\]/)

    const remoto = { type: 'http', url: 'https://mcp.example.invalid/x' }
    const workspace = checar(
      repositorio({
        'app.code-workspace': json({
          folders: [],
          settings: { mcp: { servers: { docs: remoto } } },
        }),
      }),
    )
    assert.match(workspace, /app\.code-workspace:\d+:\d+ server docs \[remote-url\]/)

    // The same launch in the four places hashes alike, so one reviewed launch
    // needs no second review when it moves between them.
    const impressoes = [
      ['.mcp.json', json({ mcpServers: { sh: shell } })],
      ['.vscode/mcp.json', json({ servers: { sh: shell } })],
      [
        '.devcontainer.json',
        json({ customizations: { vscode: { mcp: { servers: { sh: shell } } } } }),
      ],
      ['w.code-workspace', json({ settings: { mcp: { servers: { sh: shell } } } })],
    ].map(
      ([caminho, texto]) =>
        /sha256:([0-9a-f]{64})/.exec(checar(repositorio({ [caminho]: texto })))[1],
    )
    assert.equal(new Set(impressoes).size, 1, impressoes.join(' '))
    assert.equal(impressoes[0], impressaoDeLancamento(shell))
  })

  test('the keys VS Code does not read for a folder or a workspace stay unread', () => {
    // A top-level `mcp` of a workspace file: the scanner reads only settings.mcp.
    const topo = repositorio({
      'w.code-workspace': json({ mcp: { servers: { x: { command: 'bash', args: ['-c', 'x'] } } } }),
    })
    assert.deepEqual(checar(topo), { na: 'no MCP server configuration tracked' })
    // The older `mcp` key of a folder's .vscode/settings.json: VS Code migrates it
    // only from user settings (mcpMigration.ts), so a folder's copy starts nothing.
    const antigo = repositorio({
      '.vscode/settings.json': json({
        mcp: { servers: { x: { command: 'bash', args: ['-c', 'x'] } } },
      }),
    })
    assert.deepEqual(checar(antigo), { na: 'no MCP server configuration tracked' })
    // A dev container that never mentions MCP is no server config, even broken.
    const quebrado = repositorio({ '.devcontainer/devcontainer.json': '{ "image": ' })
    assert.deepEqual(checar(quebrado), { na: 'no MCP server configuration tracked' })
  })

  test('Codex mcp_servers tables in TOML are read', () => {
    const texto = '[mcp_servers.fetch]\ncommand = "uvx"\nargs = ["mcp-server-fetch"]\n'
    const saida = checar(repositorio({ '.codex/config.toml': texto }))
    assert.match(saida, /\.codex\/config\.toml:1:14 server fetch \[remote-package\]/)
    const s = { command: 'uvx', args: ['mcp-server-fetch'] }
    const aceito = checar(
      repositorio({
        '.codex/config.toml': texto,
        '.rebar-injection-allowlist': `${entrada('.codex/config.toml', 'fetch', s)}\n`,
      }),
    )
    assert.equal(typeof aceito.nota, 'string')
  })

  test('a config behind a directory symlink is judged under the path the client opens', () => {
    const saida = checar(
      repositorio({
        'cfg/mcp.json': json({ mcpServers: { x: remoto } }),
        '.cursor': { symlink: 'cfg' },
      }),
    )
    assert.match(saida, /\.cursor\/mcp\.json:3:5 server x \[remote-url\]/)
  })

  test('a server name with an invisible character is printed escaped', () => {
    const nome = `do${String.fromCodePoint(0x200b)}cs`
    const saida = checar(repositorio({ '.mcp.json': json({ mcpServers: { [nome]: remoto } }) }))
    assert.ok(saida.includes('server do<U+200B>cs '), saida)
    for (const ch of saida) {
      const cp = ch.codePointAt(0)
      assert.ok(!naFaixa(cp, IGNORAVEIS) && !naFaixa(cp, CONTROLES), `raw U+${cp.toString(16)}`)
    }
  })
})

describe('findings no entry can exempt', () => {
  const comEntrada = (arquivo, servidores, extra = {}) => {
    const linhas = Object.entries(servidores).map(([nome, s]) => entrada(arquivo, nome, s))
    return repositorio({
      [arquivo]: json({ mcpServers: servidores }),
      '.rebar-injection-allowlist': `${linhas.join('\n')}\n`,
      ...extra,
    })
  }
  const naoIsenta = (saida, motivo) => {
    assert.equal(typeof saida, 'string', JSON.stringify(saida))
    assert.match(saida, motivo)
    assert.match(saida, /\(not exemptable\)/)
  }

  test('trust: true in the Gemini settings, allowlisted or not', () => {
    const s = { command: 'node', args: ['srv.mjs'], trust: true }
    naoIsenta(checar(comEntrada('.gemini/settings.json', { x: s })), /trust: true/)
    const semTrust = { command: 'node', args: ['srv.mjs'], trust: false }
    assert.equal(typeof checar(comEntrada('.gemini/settings.json', { x: semTrust })).nota, 'string')
  })

  test('a command read from the environment', () => {
    const s = { command: '${PROOF_BIN}', args: ['srv.mjs'] }
    naoIsenta(checar(comEntrada('.mcp.json', { x: s })), /resolved from the environment/)
  })

  test('mcp-remote below 0.1.16, also through a shell wrapper', () => {
    const velho = { command: 'npx', args: ['mcp-remote@0.1.15', 'https://mcp.example.invalid/sse'] }
    naoIsenta(checar(comEntrada('.mcp.json', { x: velho })), /CVE-2025-6514/)
    const embrulhado = {
      command: 'cmd',
      args: ['/c', 'npx mcp-remote https://mcp.example.invalid/sse'],
    }
    naoIsenta(checar(comEntrada('.mcp.json', { x: embrulhado })), /CVE-2025-6514/)
    const novo = { command: 'npx', args: ['mcp-remote@0.1.16', 'https://mcp.example.invalid/sse'] }
    assert.equal(typeof checar(comEntrada('.mcp.json', { x: novo })).nota, 'string')
    for (const espec of [
      'https://registry.npmjs.org/mcp-remote/-/mcp-remote-0.1.10.tgz',
      'github:geelen/mcp-remote#v0.1.10',
      'https://registry.npmjs.org/mcp-remote/-/mcp-remote-0.1.10.tar.gz',
      'https://github.com/geelen/mcp-remote#v0.1.10',
      'https://github.com/geelen/mcp-remote/archive/refs/tags/v0.1.10.tar.gz',
      'https://codeload.github.com/geelen/mcp-remote/tar.gz/v0.1.10',
      'alias@npm:mcp-remote@0.1.10',
    ]) {
      const s = { command: 'npx', args: ['-y', espec, 'https://mcp.example.invalid/sse'] }
      naoIsenta(checar(comEntrada('.mcp.json', { x: s })), /CVE-2025-6514/)
    }
    const porPacote = {
      command: 'npm',
      args: [
        'exec',
        '--package=https://codeload.github.com/geelen/mcp-remote/tar.gz/main',
        '--',
        'mcp-remote',
      ],
    }
    naoIsenta(checar(comEntrada('.mcp.json', { x: porPacote })), /CVE-2025-6514/)
    // A proven version is exemptable, and a server URL that only mentions the
    // name is not a package spec.
    for (const espec of [
      'https://codeload.github.com/geelen/mcp-remote/tar.gz/v0.1.16',
      'alias@npm:mcp-remote@0.1.16',
    ]) {
      const s = { command: 'npx', args: ['-y', espec, 'https://mcp.example.invalid/sse'] }
      assert.equal(typeof checar(comEntrada('.mcp.json', { x: s })).nota, 'string', espec)
    }
    const proxy = {
      command: 'node',
      args: ['proxy.mjs', 'https://corp.example.invalid/mcp-remote/sse'],
    }
    assert.equal(typeof checar(comEntrada('.mcp.json', { x: proxy })).nota, 'string')
  })

  test('a package runner next to a tracked registry override or node_modules/.bin', () => {
    const s = { command: 'npx', args: ['@acme/server@1.2.3'] }
    const registro = 'registry=https://registry.example.invalid/\n'
    naoIsenta(checar(comEntrada('.mcp.json', { x: s }, { '.npmrc': registro })), /\.npmrc changes/)
    naoIsenta(
      checar(
        comEntrada(
          '.mcp.json',
          { x: s },
          { '.npmrc': '@acme:registry=https://r.example.invalid/\n' },
        ),
      ),
      /\.npmrc changes/,
    )
    naoIsenta(
      checar(
        comEntrada(
          '.mcp.json',
          { x: s },
          { '.yarnrc.yml': 'npmRegistryServer: "https://r.example.invalid"\n' },
        ),
      ),
      /\.yarnrc\.yml changes/,
    )
    naoIsenta(
      checar(
        comEntrada(
          '.mcp.json',
          { x: s },
          { 'bunfig.toml': '[install]\nregistry = "https://r.example.invalid"\n' },
        ),
      ),
      /bunfig\.toml changes/,
    )
    naoIsenta(
      checar(comEntrada('.mcp.json', { x: s }, { 'node_modules/.bin/server': '#!/bin/sh\n' })),
      /node_modules\/\.bin\/server changes/,
    )
    // A runner-free launch is untouched.
    const local = { command: 'node', args: ['srv.mjs'] }
    assert.equal(
      typeof checar(comEntrada('.mcp.json', { x: local }, { '.npmrc': registro })).nota,
      'string',
    )
  })

  test('only an override that changes where THIS launch resolves its package is unexemptable', () => {
    // Measured before: the public default registry, a company scope unrelated to
    // the launched package, and a nested package's .npmrc that a launch from the
    // root never reads all made an allowlisted npx server unexemptable, with the
    // same message as a real override.
    const aceito = (
      arquivos,
      servidor = { command: 'npx', args: ['-y', '@playwright/mcp@0.0.40'] },
    ) => {
      const saida = checar(comEntrada('.mcp.json', { x: servidor }, arquivos))
      assert.equal(
        typeof saida?.nota,
        'string',
        `${JSON.stringify(arquivos)}: ${JSON.stringify(saida)}`,
      )
    }
    const semEscopo = { command: 'npx', args: ['-y', 'mcp-server-foo@1.2.3'] }
    // The public default registries point the runner at the default, not away.
    aceito({ '.npmrc': 'registry=https://registry.npmjs.org/\nsave-exact=true\n' })
    aceito({ '.npmrc': 'registry = "https://registry.npmjs.org"\r\n' }, semEscopo)
    aceito({ '.yarnrc.yml': 'npmRegistryServer: "https://registry.yarnpkg.com"\n' })
    aceito({ 'bunfig.toml': '[install]\nregistry = "https://registry.npmjs.org/"\n' })
    aceito({ '.npmrc': '@playwright:registry=https://registry.npmjs.org/\n' })
    // A scope counts only for a package of that scope, an alias resolved.
    aceito({ '.npmrc': '@acme:registry=https://npm.pkg.github.com\n' })
    aceito({ '.npmrc': '@modelcontextprotocol:registry=https://r.example.invalid/\n' }, semEscopo)
    aceito({
      '.yarnrc.yml': 'npmScopes:\n  acme:\n    npmRegistryServer: "https://r.example.invalid"\n',
    })
    const escopoDoPacote = { '.npmrc': '@playwright:registry=https://r.example.invalid/\n' }
    naoIsenta(
      checar(
        comEntrada(
          '.mcp.json',
          { x: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.40'] } },
          escopoDoPacote,
        ),
      ),
      /\.npmrc changes/,
    )
    const apelido = { command: 'npx', args: ['-y', 'pw@npm:@Playwright/mcp@0.0.40'] }
    naoIsenta(checar(comEntrada('.mcp.json', { x: apelido }, escopoDoPacote)), /\.npmrc changes/)
    const escopoBun = {
      'bunfig.toml': '[install.scopes]\nplaywright = { url = "https://r.example.invalid" }\n',
    }
    naoIsenta(
      checar(
        comEntrada(
          '.mcp.json',
          { x: { command: 'bunx', args: ['@playwright/mcp@0.0.40'] } },
          escopoBun,
        ),
      ),
      /bunfig\.toml changes/,
    )
    // Only the root and the folder the launch starts in: a nested package's
    // .npmrc is not read by a launch from the root.
    const aninhado = { 'packages/ui/.npmrc': 'registry=https://r.example.invalid/\n' }
    aceito(aninhado)
    naoIsenta(
      checar(
        comEntrada(
          '.mcp.json',
          { x: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.40'], cwd: 'packages/ui' } },
          aninhado,
        ),
      ),
      /packages\/ui\/\.npmrc changes/,
    )
    naoIsenta(
      checar(
        comEntrada(
          'packages/ui/.mcp.json',
          { x: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.40'] } },
          aninhado,
        ),
      ),
      /packages\/ui\/\.npmrc changes/,
    )
    // A real override of the registry an unscoped launch uses stays unexemptable,
    // and so does one that points a default-looking host somewhere else.
    naoIsenta(
      checar(
        comEntrada(
          '.mcp.json',
          { x: semEscopo },
          { '.npmrc': 'registry=https://registry.npmjs.org.evil.invalid/\n' },
        ),
      ),
      /\.npmrc changes/,
    )
    naoIsenta(
      checar(comEntrada('.mcp.json', { x: semEscopo }, { '.npmrc': 'registry=${NPM_REGISTRY}\n' })),
      /\.npmrc changes/,
    )
  })

  test('.npmrc is read the way npm reads it: quoted keys, arrays, sections, comments, variables', () => {
    // Backlog 16. Measured with npm 11.6.2 `npm config get` over a project
    // .npmrc (ini@5.0.0 decode): every naoIsenta row below sets the registry
    // npx resolves from, and on main each one PASSED with the launch
    // allowlisted; every aceito row leaves the default, and on main the first
    // three FAILED with no entry able to exempt them.
    const pw = { command: 'npx', args: ['-y', '@playwright/mcp@0.0.40'] }
    const semEscopo = { command: 'npx', args: ['-y', 'mcp-server-foo@1.2.3'] }
    const comNpmrc = (npmrc, servidor = semEscopo) =>
      checar(comEntrada('.mcp.json', { x: servidor }, { '.npmrc': npmrc }))
    for (const npmrc of [
      '"registry"=https://r.example.invalid/\n',
      "'registry' = https://r.example.invalid/\n",
      'registry[]=https://r.example.invalid/\n',
      'registry=http://registry.npmjs.org/\n',
      'registry=//registry.npmjs.org/\n',
      // npm expands ${NAME?} to nothing when NAME is unset, in keys too.
      '${REBAR_PROOF_UNSET?}registry=https://r.example.invalid/\n',
      'regi${REBAR_PROOF_UNSET?}stry=https://r.example.invalid/\n',
      // A variable left as written may hold any text, so the key may be registry.
      '${REBAR_PROOF_UNSET}registry=https://r.example.invalid/\n',
    ]) {
      naoIsenta(comNpmrc(npmrc), /\.npmrc changes/)
    }
    for (const npmrc of [
      '"@playwright:registry"=https://r.example.invalid/\n',
      '@playwright${REBAR_PROOF_UNSET?}:registry=https://r.example.invalid/\n',
    ]) {
      naoIsenta(comNpmrc(npmrc, pw), /\.npmrc changes/)
    }
    naoIsenta(
      checar(
        comEntrada(
          '.mcp.json',
          { x: semEscopo },
          { '.yarnrc.yml': 'npmRegistryServer: "http://registry.yarnpkg.com"\n' },
        ),
      ),
      /\.yarnrc\.yml changes/,
    )
    const aceito = (npmrc) => {
      const saida = comNpmrc(npmrc)
      assert.equal(
        typeof saida?.nota,
        'string',
        `${JSON.stringify(npmrc)}: ${JSON.stringify(saida)}`,
      )
    }
    aceito('registry=https://registry.npmjs.org/ ; public\n')
    aceito('registry=https://registry.npmjs.org/#x\n')
    aceito('REGISTRY=https://r.example.invalid/\n')
    aceito('[x]\nregistry=https://r.example.invalid/\n')
    aceito('"registry" = "https://registry.npmjs.org/"\n')
    // A variable whose literal ends can never spell a registry key, and one escaped.
    aceito('//${NPM_HOST}/:_authToken=${NPM_TOKEN}\n')
    aceito(
      `${String.fromCharCode(92)}${'${REBAR_PROOF_UNSET?}'}registry=https://r.example.invalid/\n`,
    )
  })

  test('.npmrc that names another config file is an override: userconfig and globalconfig', () => {
    // Measured with npm 11.6.2: a project .npmrc holding only
    // `userconfig=./cfg/npmrc` made `npm config get registry` print the
    // registry of cfg/npmrc, and `globalconfig=` did the same. On main and on
    // the first cut of this branch the allowlisted launch passed.
    const semEscopo = { command: 'npx', args: ['-y', 'mcp-server-foo@1.2.3'] }
    const outro = { 'cfg/npmrc': 'registry=https://u.example.invalid/\n' }
    for (const npmrc of [
      'userconfig=./cfg/npmrc\n',
      'globalconfig=./cfg/npmrc\n',
      '"userconfig"=./cfg/npmrc\n',
      'user${REBAR_PROOF_UNSET?}config=./cfg/npmrc\n',
      '${REBAR_PROOF_UNSET}config=./cfg/npmrc\n',
    ]) {
      naoIsenta(
        checar(comEntrada('.mcp.json', { x: semEscopo }, { '.npmrc': npmrc, ...outro })),
        /\.npmrc changes/,
      )
    }
    // Keys are case-sensitive: npm ignored USERCONFIG.
    const maiusculo = checar(
      comEntrada('.mcp.json', { x: semEscopo }, { '.npmrc': 'USERCONFIG=./cfg/npmrc\n', ...outro }),
    )
    assert.equal(typeof maiusculo?.nota, 'string', JSON.stringify(maiusculo))
  })

  test('a global option before the runner subcommand still reaches the registry override', () => {
    // Measured: `pnpm --silent dlx` (pnpm 11.16) and `npm --loglevel=warn exec`
    // run the runner. Read as contiguous words they matched no runner row, so an
    // allowlist entry exempted the launch.
    const registro = { '.npmrc': 'registry=https://registry.example.invalid/\n' }
    for (const args of [
      ['--silent', 'dlx', '@acme/mcp'],
      ['-C', 'tools', 'dlx', '@acme/mcp'],
      ['--dir', 'tools', '--silent', 'dlx', '@acme/mcp'],
      ['-w', 'dlx', '@acme/mcp'],
    ]) {
      const s = { command: 'pnpm', args }
      naoIsenta(checar(comEntrada('.mcp.json', { x: s }, registro)), /\.npmrc changes/)
    }
    // A runner named by an absolute path with a space is one path to a client that
    // spawns without a shell. Measured before: split into words it was [local],
    // and the override check never ran on the allowlisted launch.
    const barra = String.fromCharCode(92)
    for (const command of [
      ['C:', 'Program Files', 'nodejs', 'npx.cmd'].join(barra),
      'C:/Program Files/nodejs/npx.cmd',
      '/opt/my tools/bin/npx',
    ]) {
      const espacado = { command, args: ['-y', 'mcp-server-foo@1.2.3'] }
      naoIsenta(checar(comEntrada('.mcp.json', { x: espacado }, registro)), /\.npmrc changes/)
      const semOverride = checar(
        repositorio({ '.mcp.json': json({ mcpServers: { x: espacado } }) }),
      )
      assert.match(semOverride, /\[remote-package\]/, command)
    }
    const npm = { command: 'npm', args: ['--loglevel=warn', 'exec', '--', '@acme/mcp'] }
    naoIsenta(checar(comEntrada('.mcp.json', { x: npm }, registro)), /\.npmrc changes/)
    const npmValor = { command: 'npm', args: ['--loglevel', 'warn', 'exec', '@acme/mcp'] }
    naoIsenta(checar(comEntrada('.mcp.json', { x: npmValor }, registro)), /\.npmrc changes/)
    // A script run after global options is still no runner.
    const script = { command: 'npm', args: ['--silent', 'run', 'dev'] }
    assert.equal(typeof checar(comEntrada('.mcp.json', { x: script }, registro)).nota, 'string')
    assert.deepEqual(
      classificarLancamento(['pnpm', '--silent', 'dlx', 'x@1.0.0'], TABELAS).rotulos,
      ['remote-package'],
    )
  })

  test('a duplicate key, an unparseable file and a malformed allowlist line', () => {
    const duplicado =
      '{\n  "mcpServers": {\n    "x": { "command": "node" },\n    "x": { "command": "python" }\n  }\n}\n'
    naoIsenta(
      checar(repositorio({ '.mcp.json': duplicado })),
      /\.mcp\.json:4:5 duplicate key \/mcpServers\/x/,
    )
    naoIsenta(checar(repositorio({ '.cursor/mcp.json': '{ "mcpServers": ' })), /cannot be parsed/)
    naoIsenta(
      checar(
        repositorio({
          '.mcp.json': readFileSync(MOLDE),
          '.rebar-injection-allowlist': '{"regra": 1}\n',
        }),
      ),
      /\.rebar-injection-allowlist:1:1 /,
    )
  })

  test('a config git reads through an attribute that hides it from review', () => {
    naoIsenta(
      checar(
        repositorio({ '.mcp.json': readFileSync(MOLDE), '.gitattributes': '.mcp.json -diff\n' }),
      ),
      /cannot be trusted as read \(semDiff\)/,
    )
  })
})

describe('arquivosReferenciados', () => {
  test('resolves command and args from the project folder, cwd and inline shells', () => {
    const dir = repositorio({
      '.mcp.json': json({
        mcpServers: {
          a: { command: 'node', args: ['server/a.mjs'] },
          b: { command: 'bash', args: ['-c', 'node ./server/b.mjs --port 1'] },
          c: { command: 'node', args: ['c.mjs'], cwd: 'server' },
        },
      }),
      'pkg/.vscode/mcp.json': json({
        servers: {
          d: { command: 'node', args: ['${workspaceFolder}/d.mjs', '--config=conf/d.json'] },
        },
      }),
      'server/a.mjs': 'export {}\n',
      'server/b.mjs': 'export {}\n',
      'server/c.mjs': 'export {}\n',
      'pkg/d.mjs': 'export {}\n',
      'pkg/conf/d.json': '{}\n',
    })
    assert.deepEqual(
      arquivosReferenciados(dir).map((x) => `${x.caminho} <- ${x.arquivo}#${x.servidor}`),
      [
        'pkg/conf/d.json <- pkg/.vscode/mcp.json#d',
        'pkg/d.mjs <- pkg/.vscode/mcp.json#d',
        'server/a.mjs <- .mcp.json#a',
        'server/b.mjs <- .mcp.json#b',
        'server/c.mjs <- .mcp.json#c',
      ],
    )
  })
})
