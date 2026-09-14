// THE PIN RULE, PROVED AGAINST THE SPELLINGS THAT RUN A MOVING TARGET
//
// tooling/security/injection/unpinned-exec.mjs fails a git or tarball package
// that a workflow, an MCP config, a package script or an agent instruction runs
// without a commit id. Three things would fail in silence if they drifted: the
// pin test (a branch read as a commit lets the default branch run; the commit
// tarball read as unpinned fails the one spelling npm 10 runs, measured on
// 2026-09-13), the readers (a quoted or folded `run:` scalar hid the runner
// from a line reader, measured), and the scope (prose judged would fail rebar's
// own README, whose quick start runs rebar unpinned on 5 lines).
//
// Every repository is built in os.tmpdir() with INDEX-ONLY entries, the way the
// proof runner builds `gerados`.
//
//   node --test tooling/security/injection/prove-unpinned-exec.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after, describe } from 'node:test'

import {
  EXECUTORES_REMOTOS,
  SINAIS_DE_SHELL,
  classificarLancamento,
  impressaoDeLancamento,
} from './mcp-launch.mjs'
import { ATALHOS_NPM, CHAVES_COM_VALOR_NPM, CHAVES_SEM_VALOR_NPM } from './opcoes-npm.mjs'
import { checarUnpinnedExec, fixacao, palavrasPosix, segmentosDeComando } from './unpinned-exec.mjs'

const criados = []
after(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, maxRetries: 3, force: true })
})

const TABELAS = { EXECUTORES_REMOTOS, SINAIS_DE_SHELL }
const NUL = String.fromCodePoint(0)
const LF = String.fromCharCode(10)
const BARRA = String.fromCharCode(92)
const A40 = 'a'.repeat(40)
const CRASE = String.fromCharCode(96)
const CERCA = CRASE.repeat(3)

// The machine's git config never decides what these repositories hold.
const SEM_CONFIG = join(tmpdir(), 'rebar-prove-unpinned-exec-gitconfig-inexistente')
const AMBIENTE = {
  ...process.env,
  GIT_CONFIG_GLOBAL: SEM_CONFIG,
  GIT_CONFIG_SYSTEM: SEM_CONFIG,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.excludesFile',
  GIT_CONFIG_VALUE_0: SEM_CONFIG,
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

/** A fresh repository whose INDEX holds `arquivos` ({ caminho: texto }); nothing on disk. */
function repositorio(arquivos) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-unpinned-'))
  criados.push(dir)
  git(dir, ['init', '-q'])
  const lista = Object.entries(arquivos)
  if (!lista.length) return dir
  const pasta = mkdtempSync(join(tmpdir(), 'rebar-unpinned-blobs-'))
  criados.push(pasta)
  const caminhos = lista.map(([, texto], k) => {
    const arquivo = join(pasta, String(k))
    writeFileSync(arquivo, Buffer.from(texto, 'utf8'))
    return arquivo
  })
  const oids = git(
    dir,
    ['hash-object', '-w', '--no-filters', '--stdin-paths'],
    `${caminhos.join(LF)}${LF}`,
  ).split(LF)
  const linhas = lista.map(([caminho], k) => `100644 ${oids[k]}\t${caminho}${NUL}`)
  git(dir, ['update-index', '-z', '--add', '--index-info'], linhas.join(''))
  return dir
}

const checar = (arquivos) => checarUnpinnedExec({ dir: repositorio(arquivos) }, TABELAS)
const linhas = (...l) => `${l.join(LF)}${LF}`
const fluxo = (...run) =>
  linhas('on: push', 'jobs:', '  a:', '    runs-on: ubuntu-latest', '    steps:', ...run)

// ─────────────────────────────────────────────────────────────── the pin test

describe('fixacao: which specs are a commit, which run a moving target, which are not judged', () => {
  const npm = (espec) => {
    const x = classificarLancamento(['npx', '--yes', espec], TABELAS).execucoes[0]
    return fixacao(x.pacotes[0], x.familia)
  }
  const uvx = (espec) => {
    const x = classificarLancamento(['uvx', '--from', espec, 'ferramenta'], TABELAS).execucoes[0]
    return fixacao(x.pacotes[0], x.familia)
  }
  const VETORES = [
    ['github:o/r', npm, false],
    ['github:o/r#main', npm, false],
    ['github:o/r#0123456', npm, false],
    ['github:o/r#semver:^1', npm, false],
    [`github:o/r#${A40}`, npm, true],
    ['o/r', npm, false],
    [`o/r#${A40}`, npm, true],
    [`git+https://github.com/o/r.git#${A40}`, npm, true],
    [`https://codeload.github.com/o/r/tar.gz/${A40}`, npm, true],
    ['https://codeload.github.com/o/r/tar.gz/main', npm, false],
    [`http://codeload.github.com/o/r/tar.gz/${A40}`, npm, false],
    [`https://github.com/o/r/archive/${A40}.tar.gz`, npm, true],
    ['https://registry.npmjs.org/prettier/-/prettier-3.9.6.tgz', npm, true],
    ['https://example.invalid/p.tgz', npm, false],
    [`https://github.com/o/r#${A40}`, npm, true],
    ['https://github.com/o/r#main', npm, false],
    ['prettier', npm, null],
    ['@s/p@1.2.3', npm, null],
    ['./x', npm, null],
    [`git+https://github.com/o/r@${A40}`, uvx, true],
    ['git+https://github.com/o/r', uvx, false],
    [`git+ssh://git@github.com/o/r@${A40}`, uvx, true],
    ['git+ssh://git@github.com/o/r@main', uvx, false],
  ]
  for (const [espec, via, esperado] of VETORES) {
    test(`${via === uvx ? 'uvx --from ' : 'npx '}${espec} -> ${esperado}`, () => {
      assert.equal(via(espec), esperado)
    })
  }
})

// ─────────────────────────────────────────────────────────────── the readers

describe('the command segmenter', () => {
  test('cuts at operators outside quotes, joins continuations, stops at a comment', () => {
    assert.deepEqual(
      segmentosDeComando(
        `a && npx github:o/r . ${BARRA}${LF}  --x # github:o/r${LF}# npx github:o/r${LF}b; c | d`,
      ),
      ['a', 'npx github:o/r .    --x', 'b', 'c', 'd'],
    )
    assert.deepEqual(segmentosDeComando('bash -c "npx github:o/r . && echo #x"'), [
      'bash -c "npx github:o/r . && echo #x"',
    ])
  })
})

describe('workflows', () => {
  const unpinned = (texto) => checar({ '.github/workflows/ci.yml': texto })

  test('a plain run step with an unpinned git spec fails, position and hash but no spec text', () => {
    const r = unpinned(fluxo('      - run: npx --yes github:o/r .'))
    assert.equal(typeof r, 'string')
    assert.match(
      r,
      /\.github\/workflows\/ci\.yml:6:\d+ npm-family runner, git spec with no commit ref sha256:[0-9a-f]{12} len:10/,
    )
    assert.ok(!r.includes('github:o/r'), r)
  })

  test('a commented line and a trailing comment are not commands', () => {
    assert.equal(
      unpinned(
        fluxo(
          '      # - run: npx --yes github:o/r .',
          `      - run: echo ok # npx github:o/r`,
          `      - run: npx --yes https://codeload.github.com/o/r/tar.gz/${A40} .`,
        ),
      ),
      null,
    )
  })

  test('a block scalar, a continuation and a chained command are read', () => {
    const r = unpinned(
      fluxo(
        '      - run: |',
        '          echo a',
        `          npm ci ${BARRA}`,
        '            && npx github:o/r .',
      ),
    )
    assert.equal(typeof r, 'string', String(r))
    assert.match(r, /1 remote execution/)
  })

  test('a quoted scalar and a folded scalar are read (a line reader missed both, measured)', () => {
    assert.equal(typeof unpinned(fluxo('      - run: "npx --yes github:o/r ."')), 'string')
    assert.equal(
      typeof unpinned(fluxo('      - run: >', '          npx --yes', '          github:o/r .')),
      'string',
    )
  })

  test('a shell wrapper is unwrapped, and -p names the package', () => {
    assert.equal(typeof unpinned(fluxo(`      - run: bash -c "npx github:o/r ."`)), 'string')
    assert.equal(
      typeof unpinned(fluxo('      - run: npx --yes -p github:Navesz/rebar rebar-security .')),
      'string',
    )
  })

  test('the exact line the published sites now run passes', () => {
    assert.equal(
      unpinned(
        fluxo(
          '      - run: npx --yes https://codeload.github.com/Navesz/rebar/tar.gz/134f1126e65758781f962681b2e01a7b753c1689 .',
        ),
      ),
      null,
    )
  })

  test('a workflow the YAML subset cannot parse is still read line by line', () => {
    const r = unpinned(linhas('jobs: &x', '  a:', '    steps:', '      - run: npx github:o/r .'))
    assert.equal(typeof r, 'string', String(r))
  })
})

describe('MCP configs', () => {
  test('an unpinned server fails even when mcp-server-launch accepts its fingerprint', () => {
    const servidor = { command: 'npx', args: ['-y', 'github:o/servidor'] }
    const allowlist =
      JSON.stringify({
        regra: 'mcp-server-launch',
        motivo: 'reviewed in a proof',
        arquivo: '.mcp.json',
        servidor: 'x',
        sha256: impressaoDeLancamento(servidor),
      }) + LF
    const r = checar({
      '.mcp.json': JSON.stringify({ mcpServers: { x: servidor } }, null, 2),
      '.rebar-injection-allowlist': allowlist,
    })
    assert.equal(typeof r, 'string', String(r))
    assert.match(r, /\.mcp\.json:\d+:\d+ npm-family runner/)
  })

  test('the same server by commit passes', () => {
    const servidor = { command: 'npx', args: ['-y', `github:o/servidor#${A40}`] }
    assert.equal(checar({ '.mcp.json': JSON.stringify({ mcpServers: { x: servidor } }) }), null)
  })
})

describe('agent instruction files', () => {
  const FENCE = linhas(CERCA + 'sh', 'npx --yes github:o/r .', CERCA)

  test('a fence in AGENTS.md fails', () => {
    assert.equal(typeof checar({ 'AGENTS.md': linhas('# x', '', FENCE) }), 'string')
  })

  test('an inline code span in AGENTS.md fails', () => {
    assert.equal(
      typeof checar({ 'AGENTS.md': `Run ${CRASE}npx github:o/r .${CRASE} first.${LF}` }),
      'string',
    )
  })

  test('copilot instructions and a cursor rule are instruction files', () => {
    assert.equal(typeof checar({ '.github/copilot-instructions.md': FENCE }), 'string')
    assert.equal(typeof checar({ '.cursor/rules/x.mdc': FENCE }), 'string')
  })

  test('a file CLAUDE.md imports is an instruction file too', () => {
    const r = checar({ 'CLAUDE.md': linhas('See @docs/setup.md'), 'docs/setup.md': FENCE })
    assert.equal(typeof r, 'string', String(r))
    assert.match(r, /docs\/setup\.md:/)
  })

  test('the same fence in a README, next to a pinned workflow, is prose and passes', () => {
    assert.equal(
      checar({
        'README.md': FENCE,
        '.github/workflows/ci.yml': fluxo(
          `      - run: npx --yes https://codeload.github.com/o/r/tar.gz/${A40} .`,
        ),
      }),
      null,
    )
  })

  test('a plain sentence without code formatting is not read (documented limit)', () => {
    assert.equal(checar({ 'AGENTS.md': linhas('Run npx github:o/r . before you start.') }), null)
  })
})

describe('package scripts', () => {
  test('a nested package.json script fails', () => {
    const r = checar({
      'packages/x/package.json': JSON.stringify({ scripts: { regua: 'npx --yes github:o/r .' } }),
    })
    assert.match(String(r), /packages\/x\/package\.json:1:\d+ npm-family runner/)
  })

  test('an unparseable package.json is skipped: npm runs none of its scripts', () => {
    assert.deepEqual(checar({ 'package.json': '{ "scripts": { "a": "npx github:o/r" ' }), {
      na: 'no workflow, MCP config, package script or agent instruction file tracked',
    })
  })

  test('a registry package by version is not judged', () => {
    assert.equal(
      checar({ 'package.json': JSON.stringify({ scripts: { a: 'npx some-package@1.2.3 .' } }) }),
      null,
    )
  })
})

describe('the verdict', () => {
  test('nothing to read is not applicable', () => {
    assert.deepEqual(checar({ LICENSE: 'Apache' }), {
      na: 'no workflow, MCP config, package script or agent instruction file tracked',
    })
  })

  test('a malformed allowlist line fails this rule too, not exemptable', () => {
    const r = checar({ LICENSE: 'Apache', '.rebar-injection-allowlist': `not json${LF}` })
    assert.match(String(r), /\.rebar-injection-allowlist:1:\d+ .*\(not exemptable\)/)
  })
})

// ──────────────────────────────── spellings the first reader let through
//
// Each of these passed the rule on 2026-09-13 (review reproduction, index-only
// repositories) while npm resolved the default branch of the repository.

describe('spellings npm reads as git or as a branch tarball (npm-package-arg, npm 11.6.2)', () => {
  const npm = (espec) => {
    const x = classificarLancamento(['npx', '--yes', espec], TABELAS).execucoes[0]
    return fixacao(x.pacotes[0], x.familia)
  }
  const VETORES = [
    ['foo@github:o/r', false],
    ['@s/p@github:o/r', false],
    ['GITHUB:o/r', false],
    ['Github:o/r#main', false],
    ['git@github.com:o/r.git', false],
    ['ssh://git@github.com/o/r.git', false],
    ['git+HTTPS://github.com/o/r.git', false],
    ['HTTPS://codeload.github.com/o/r/tar.gz/main', false],
    [`foo@github:o/r#${A40}`, true],
    [`git@github.com:o/r.git#${A40}`, true],
    [`github:o/r#${A40}::path:packages/x`, true],
    [`HTTPS://CODELOAD.github.com/o/r/tar.gz/${A40}`, true],
    ['foo@1.2.3', null],
    ['foo@npm:bar@1.0.0', null],
    ['foo@latest', null],
  ]
  for (const [espec, esperado] of VETORES) {
    test(`npx ${espec} -> ${esperado}`, () => assert.equal(npm(espec), esperado))
  }
})

describe('what stood between the runner and the rule', () => {
  const run = (comando) => checar({ '.github/workflows/ci.yml': fluxo(`      - run: ${comando}`) })
  const U = 'github:o/r'
  const ASPA = String.fromCharCode(39)

  test('a transparent prefix in front of the runner (timeout, time, exec, command, sudo, nice, VAR=1)', () => {
    for (const prefixo of [
      'timeout 600',
      'timeout -k 5 600',
      'time',
      'exec',
      'command',
      'sudo -u ci',
      'nice -n 5',
      'CI=1',
      'nohup nice timeout 9 env A=1',
    ]) {
      assert.equal(typeof run(`${prefixo} npx --yes ${U} .`), 'string', prefixo)
    }
  })

  test('cross-env in a package script and corepack in front of pnpm dlx', () => {
    const scripts = { a: `cross-env CI=1 npx ${U} .` }
    assert.equal(typeof checar({ 'package.json': JSON.stringify({ scripts }) }), 'string')
    assert.equal(typeof run(`corepack pnpm dlx ${U}`), 'string')
  })

  test('a backslash and ANSI-C quoting that bash removes before npx sees the word', () => {
    const ansi = (texto) => `$${ASPA}${texto}${ASPA}`
    assert.deepEqual(
      palavrasPosix(`npx gith${BARRA}ub:o/r ${ansi(U)} ${ansi(`${BARRA}x67ithub:o/r`)}`),
      ['npx', U, U, U],
    )
    assert.equal(typeof run(`npx --yes gith${BARRA}ub:o/r .`), 'string')
    assert.equal(typeof run(`npx --yes ${ansi(U)} .`), 'string')
  })

  test('an npm option that takes a value does not turn its value into the package', () => {
    for (const opcao of [
      '--omit dev',
      '--script-shell bash',
      '--node-options --no-warnings',
      '--tag latest',
      '-w web',
    ]) {
      assert.equal(typeof run(`npx --yes ${opcao} ${U} .`), 'string', opcao)
    }
    const servidor = { command: 'npx', args: ['-y', '--omit', 'dev', U] }
    const config = JSON.stringify({ mcpServers: { x: servidor } })
    assert.equal(typeof checar({ '.mcp.json': config }), 'string')
  })

  test('the words after the package are its arguments, not packages', () => {
    assert.equal(run('npx --yes prettier --check src/index.ts'), null)
    assert.equal(run('npx --no-install eslint src/a.js'), null)
  })
})

describe("the npm option table is the running npm's own definitions", () => {
  const raizes = [
    join(dirname(process.execPath), 'node_modules', 'npm'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm'),
  ]
  const raiz = raizes.find((r) => existsSync(join(r, 'bin', 'npx-cli.js')))

  test('every switch, value option and shorthand of this npm is in opcoes-npm.mjs', (t) => {
    if (!raiz) return t.skip('no npm next to this node')
    const exigir = createRequire(join(raiz, 'package.json'))
    const { definitions, shorthands } = exigir('@npmcli/config/lib/definitions')
    const faltam = []
    for (const [chave, { type }] of Object.entries(definitions)) {
      const semValor = type === Boolean || (Array.isArray(type) && type.includes(Boolean))
      const tabela = semValor ? CHAVES_SEM_VALOR_NPM : CHAVES_COM_VALOR_NPM
      if (!tabela.has(chave)) faltam.push(`${chave} (${semValor ? 'switch' : 'takes a value'})`)
    }
    for (const [curta, expansao] of Object.entries(shorthands)) {
      if (JSON.stringify(ATALHOS_NPM[curta]) !== JSON.stringify(expansao)) faltam.push(`-${curta}`)
    }
    assert.deepEqual(faltam, [], `npm at ${raiz} has options opcoes-npm.mjs does not know`)
  })

  test('npx-cli.js is the loop pacotesComoNpx ports (same in npm 10.9.3, 10.9.4, 11.6.2, 12.0.2)', (t) => {
    if (!raiz) return t.skip('no npm next to this node')
    const texto = readFileSync(join(raiz, 'bin', 'npx-cli.js'), 'utf8').replace(/\r\n/g, LF)
    assert.equal(
      createHash('sha256').update(texto).digest('hex'),
      '237adf8f3747cad8b9b62fcfd0d9c8d509a64e550337707f55100afcb79e8900',
      `npm at ${raiz} ships another npx-cli.js: port its loop to pacotesComoNpx, then update this hash`,
    )
  })
})

describe('Markdown containers in agent instruction files', () => {
  const U = 'npx --yes github:o/r .'
  const falha = (texto) => assert.equal(typeof checar({ 'AGENTS.md': texto }), 'string', texto)

  test('a fence indented inside a list item (4 spaces, and under a two-digit marker)', () => {
    falha(linhas('# x', '', '1. Check:', '', `    ${CERCA}bash`, `    ${U}`, `    ${CERCA}`))
    falha(linhas('# x', '', '10. Check:', '', `    ${CERCA}`, `    ${U}`, `    ${CERCA}`))
  })

  test('a fence inside a blockquote, an indented code block, a code span across a line break', () => {
    falha(linhas('# x', '', `> ${CERCA}bash`, `> ${U}`, `> ${CERCA}`))
    falha(linhas('# x', '', 'Run this:', '', `    ${U}`))
    falha(linhas('# x', '', `Run ${CRASE}npx --yes`, `github:o/r .${CRASE} now.`))
  })
})

describe('what is not a command', () => {
  test('a workflow with an anchor reads run values only: a comment body passes, an aliased run fails', () => {
    const comentario = linhas(
      'on: push',
      'jobs:',
      '  a:',
      '    runs-on: &os ubuntu-latest',
      '    steps:',
      '      - uses: peter-evans/create-or-update-comment@v4',
      '        with:',
      '          body: |',
      '            npx --yes github:someone/tool#feature',
      '  b:',
      '    runs-on: *os',
      '    steps:',
      '      - run: echo ok',
    )
    assert.equal(checar({ '.github/workflows/ci.yml': comentario }), null)
    const alias = linhas(
      'on: push',
      'x-cmd: &cmd npx --yes github:o/r .',
      'jobs:',
      '  a:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: *cmd',
    )
    assert.match(String(checar({ '.github/workflows/ci.yml': alias })), /ci\.yml:2:\d+ npm-family/)
  })

  test('a here-document written to a file is data; one fed to a shell is commands', () => {
    const doc = (abre) =>
      fluxo(
        '      - run: |',
        `          ${abre}`,
        '          npx github:someone/tool',
        '          FIM',
      )
    const fim = "'FIM'"
    assert.equal(checar({ '.github/workflows/ci.yml': doc(`cat > NOTES.md <<${fim}`) }), null)
    assert.equal(
      checar({ '.github/workflows/ci.yml': doc('cat <<FIM >> "$GITHUB_STEP_SUMMARY"') }),
      null,
    )
    assert.equal(typeof checar({ '.github/workflows/ci.yml': doc(`bash <<${fim}`) }), 'string')
    assert.equal(typeof checar({ '.github/workflows/ci.yml': doc('cat <<FIM | sh') }), 'string')
  })

  test('a commit spelled through a variable fails with its own kind, not as a branch', () => {
    const r = checar({
      '.github/workflows/ci.yml': fluxo(
        '      - run: npx --yes https://codeload.github.com/o/r/tar.gz/${REBAR} .',
      ),
    })
    assert.match(String(r), /reference built from a variable/)
    assert.doesNotMatch(String(r), /tarball not addressed by a commit/)
  })
})
