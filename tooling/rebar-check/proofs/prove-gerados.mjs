// THE `gerados` FIELD OF prove.mjs, PROVED WITH A CHECKER THAT HIDES NOTHING
//
// The injection rules of rebar-security prove themselves with cases whose target
// exists only in a git index: a file name with a zero-width code point, a blob
// with raw terminal bytes, a symlink, two names that differ only in case, a
// commit message kept byte for byte. If prove.mjs stopped building one of those,
// the rule's `fail` side would run on a repository without the defect and the
// case would say whatever the rest of the repository says. Some of those sides
// would still match by luck.
//
// So the runner is proved here on its own, against a stub checker written at
// runtime into os.tmpdir(). Each stub rule asks git ONE exact question about the
// assembled repository (is this path there, byte for byte? is this blob exactly
// these bytes? is this mode 120000?), so a side matches only when the runner
// built exactly what the case declared. The real rules are not involved: a
// broken rule must not be able to turn this red, and a broken runner must not be
// able to hide behind a lenient rule.
//
// Four things are locked:
//   1. every kind of entry reaches the index exactly, with nothing on disk, and
//      a side with no folder is a side;
//   2. taking `gerados` and `mensagemBase64` away makes those same fail sides
//      diverge, so (1) cannot pass by vacuity;
//   3. a malformed block is refused before any fixture is built, and the path it
//      echoes is escaped;
//   4. a path git drops with a warning and exit 0 makes the side malformed
//      instead of producing a verdict about another repository.
//
// Every invisible or control input is built at runtime (String.fromCodePoint,
// Buffer.from), so this file holds none of them raw.
//
//   node --test tooling/rebar-check/proofs/prove-gerados.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after, describe } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CONTROLES, IGNORAVEIS, naFaixa } from '../../security/texto-seguro.mjs'

const PROVE = fileURLToPath(new URL('./prove.mjs', import.meta.url))
const cp = (...n) => String.fromCodePoint(...n)
const ZWSP = cp(0x200b)
const BEL = cp(0x07)
const bytes = (...partes) =>
  Buffer.concat(partes.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'utf8'))))
const b64 = (...partes) => bytes(...partes).toString('base64')

// What the stub compares against, in hex, handed to it in a JSON file so the stub
// source stays a plain function with no value spliced into it.
const ESPERADO = {
  nome: bytes('docs/no', ZWSP, 'tes', BEL, '.md').toString('hex'),
  // "a", ESC "[8m", CR LF, and a byte that is not UTF-8 at all: autocrlf, a
  // text filter or a UTF-8 round trip each change at least one of them.
  blob: Buffer.from([0x61, 0x1b, 0x5b, 0x38, 0x6d, 0x0d, 0x0a, 0xff]).toString('hex'),
  // Trailing spaces and blank lines are what git's default cleanup removes, so
  // only a verbatim commit keeps these bytes.
  mensagem: bytes('um', ZWSP, '  \n\n\n').toString('hex'),
}

/**
 * The stub checker. It is serialized with Function.prototype.toString into a
 * .cjs file, so it runs with `require` and its own folder as arguments and must
 * not close over anything in this module.
 *
 * It speaks the executor contract prove.mjs reads: an unknown rule prints
 * `disponíveis: <ids>` to stderr and exits 2; a known one prints one evaluation
 * in `--json` and exits 1 only on reprovou.
 */
function checadorFalso(require, pasta) {
  const { spawnSync: rodar } = require('node:child_process')
  const { existsSync, readFileSync } = require('node:fs')
  const { join: juntar } = require('node:path')
  const esperado = JSON.parse(readFileSync(juntar(pasta, 'esperado.json'), 'utf8'))
  const args = process.argv.slice(2)
  const regra = (args.find((a) => a.startsWith('--rule=')) || '').slice('--rule='.length)
  const alvo = args.filter((a) => !a.startsWith('-')).pop()

  const git = (...a) => {
    const r = rodar('git', a, { cwd: alvo, encoding: 'buffer', windowsHide: true })
    return r.status === 0 ? r.stdout : null
  }
  const entradas = () => {
    const bruto = git('ls-files', '-s', '-z') || Buffer.alloc(0)
    const saida = []
    for (let i = 0; i < bruto.length;) {
      let fim = bruto.indexOf(0, i)
      if (fim === -1) fim = bruto.length
      const linha = bruto.subarray(i, fim)
      i = fim + 1
      const tab = linha.indexOf(9)
      if (tab === -1) continue
      const [modo, oid] = linha.subarray(0, tab).toString('latin1').split(' ')
      saida.push({ modo, oid, caminho: linha.subarray(tab + 1) })
    }
    return saida
  }
  const blob = (oid) => git('cat-file', 'blob', oid) || Buffer.alloc(0)
  const achou = (predicado) => (entradas().some(predicado) ? 'reprovou' : 'passou')

  const REGRAS = {
    'nome-exato': () => achou((e) => e.caminho.toString('hex') === esperado.nome),
    'blob-exato': () => achou((e) => blob(e.oid).toString('hex') === esperado.blob),
    link: () => achou((e) => e.modo === '120000' && blob(e.oid).toString('latin1') === 'AGENTS.md'),
    executavel: () => achou((e) => e.modo === '100755'),
    colisao: () => {
      const nomes = entradas().map((e) => e.caminho.toString('utf8').toLowerCase())
      return new Set(nomes).size < nomes.length ? 'reprovou' : 'passou'
    },
    mensagem: () => {
      const commit = git('cat-file', 'commit', 'HEAD')
      if (!commit) return 'passou'
      const corpo = commit.subarray(commit.indexOf('\n\n') + 2)
      return corpo.toString('hex') === esperado.mensagem ? 'reprovou' : 'passou'
    },
    'fora-do-disco': () => {
      if (!entradas().some((e) => e.caminho.toString('latin1') === 'g.txt')) return 'passou'
      return existsSync(juntar(alvo, 'g.txt')) ? 'reprovou' : 'na'
    },
    'ignore-global': () => achou((e) => e.caminho.toString('latin1') === '.claude/settings.json'),
    vazio: () =>
      !entradas().length && !git('rev-parse', '--verify', '--quiet', 'HEAD') ? 'na' : 'passou',
  }

  if (!REGRAS[regra]) {
    console.error('disponíveis: ' + Object.keys(REGRAS).join(', '))
    process.exit(2)
  }
  const estado = REGRAS[regra]()
  console.log(JSON.stringify([{ resultados: [{ id: regra, estado, motivo: '' }] }]))
  process.exit(estado === 'reprovou' ? 1 : 0)
}

const RAIZ = mkdtempSync(join(tmpdir(), 'rebar-prove-gerados-'))
after(() => rmSync(RAIZ, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

const CHECADOR = join(RAIZ, 'checador.cjs')
writeFileSync(CHECADOR, `(${checadorFalso.toString()})(require, __dirname)\n`)
writeFileSync(join(RAIZ, 'esperado.json'), JSON.stringify(ESPERADO))

// A global git ignore that hides `.claude/`, the setup measured to drop fixtures
// before SEM_IGNORE_GLOBAL existed. XDG_CONFIG_HOME is where git looks for it
// when no config names a core.excludesFile.
const XDG = join(RAIZ, 'xdg')
mkdirSync(join(XDG, 'git'), { recursive: true })
writeFileSync(join(XDG, 'git', 'ignore'), '.claude/\n')

function escreverCasos(pasta, casos) {
  for (const [id, { estaticos = {}, ...caso }] of Object.entries(casos)) {
    const dir = join(pasta, id)
    mkdirSync(dir, { recursive: true })
    const corpo = { rule: id.split('__')[0], why: `prove-gerados: ${id}`, ...caso }
    writeFileSync(join(dir, 'caso.json'), `${JSON.stringify(corpo, null, 2)}\n`)
    for (const [rel, texto] of Object.entries(estaticos)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), texto)
    }
  }
}

function provar(nome, casos) {
  const pasta = join(RAIZ, nome)
  escreverCasos(pasta, casos)
  const r = spawnSync(process.execPath, [PROVE, `--checker=${CHECADOR}`, `--cases=${pasta}`], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, XDG_CONFIG_HOME: XDG, NO_COLOR: '1' },
  })
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` }
}

/** The cases of locks 1 and 2. `semGerados` builds the version with the field taken away. */
function casosBons({ semGerados = false } = {}) {
  const g = (lista) => (semGerados ? [] : lista)
  return {
    'nome-exato': {
      pass: { gerados: [{ caminho: 'docs/notes.md', texto: '# notes\n' }] },
      fail: {
        gerados: g([{ caminhoBase64: b64('docs/no', ZWSP, 'tes', BEL, '.md'), texto: 'x\n' }]),
      },
    },
    'blob-exato': {
      pass: { gerados: [{ caminho: 'notes.txt', texto: 'a\n' }] },
      fail: {
        gerados: g([
          { caminho: 'notes.txt', base64: Buffer.from(ESPERADO.blob, 'hex').toString('base64') },
        ]),
      },
    },
    link: {
      // The same bytes as a plain file: only the mode tells the two sides apart.
      pass: { gerados: [{ caminho: 'CLAUDE.md', texto: 'AGENTS.md' }] },
      fail: { gerados: g([{ caminho: 'CLAUDE.md', symlink: 'AGENTS.md' }]) },
    },
    executavel: {
      pass: { gerados: [{ caminho: 'run.sh', texto: 'echo ok\n' }] },
      fail: { gerados: g([{ caminho: 'run.sh', texto: 'echo ok\n', modo: '100755' }]) },
    },
    colisao: {
      pass: { gerados: [{ caminho: 'AGENTS.md', texto: 'a\n' }] },
      fail: {
        gerados: g([
          { caminho: 'AGENTS.md', texto: 'a\n' },
          { caminho: 'agents.md', texto: 'b\n' },
        ]),
      },
    },
    mensagem: {
      pass: { gerados: [], commits: [{ mensagem: 'plain', autor: 'Prova <prova@rebar.local>' }] },
      fail: {
        gerados: [],
        commits: [
          semGerados
            ? { mensagem: 'plain', autor: 'Prova <prova@rebar.local>' }
            : { mensagemBase64: b64('um', ZWSP, '  \n\n\n'), autor: 'Prova <prova@rebar.local>' },
        ],
      },
    },
    // The pass side has NO folder and expects `na`: the entry is in the index
    // and not on disk. The fail side is a static file, which is on both.
    'fora-do-disco': {
      pass: { estado: 'na', gerados: g([{ caminho: 'g.txt', texto: 'g\n' }]) },
      fail: {},
      estaticos: { 'fail/g.txt': 'g\n' },
    },
    'ignore-global': {
      estaticos: { 'pass/README.md': '# x\n', 'fail/.claude/settings.json': '{}\n' },
    },
    vazio: {
      pass: { estado: 'na', gerados: [], commits: [] },
      fail: { estado: 'na', gerados: [], commits: [] },
    },
  }
}

describe('prove.mjs builds `gerados` into the index, exactly', () => {
  test('the global ignore file used here really hides .claude/ from plain git', () => {
    // Without this the `ignore-global` case could pass on a machine where git
    // never reads XDG_CONFIG_HOME, and prove nothing about the neutralization.
    const dir = join(RAIZ, 'sonda-xdg')
    mkdirSync(dir, { recursive: true })
    const semConfig = join(RAIZ, 'config-inexistente')
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: XDG,
      GIT_CONFIG_GLOBAL: semConfig,
      GIT_CONFIG_SYSTEM: semConfig,
    }
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir, env }).status, 0)
    const r = spawnSync('git', ['check-ignore', '-q', '.claude/settings.json'], { cwd: dir, env })
    assert.equal(
      r.status,
      0,
      'git did not read the XDG ignore file, so the ignore-global case is vacuous',
    )
  })

  test('every declared entry reaches the index byte for byte, and a side needs no folder', () => {
    const casos = casosBons()
    const r = provar('bons', casos)
    const n = Object.keys(casos).length
    assert.equal(r.codigo, 0, r.saida)
    assert.match(r.saida, new RegExp(`${n} of ${n} case\\(s\\) matched`), r.saida)
  })

  test('taking gerados and mensagemBase64 away makes those fail sides diverge', () => {
    const r = provar('sem-gerados', casosBons({ semGerados: true }))
    // nome-exato, blob-exato, link, executavel, colisao, mensagem: their fail
    // side now observes passou. fora-do-disco loses its pass entry and observes
    // passou where it declared na. ignore-global and vazio do not use the field.
    assert.equal(r.codigo, 1, r.saida)
    assert.match(r.saida, /2 of 9 case\(s\) matched {2}· {2}7 diverged/, r.saida)
  })
})

describe('prove.mjs refuses a malformed `gerados` before building anything', () => {
  test('each violation is named, the case is malformed, and the echo is escaped', () => {
    const entrada = (extra) => ({ caminho: 'a.txt', texto: 'a\n', ...extra })
    const lado = (gerados) => ({ pass: { gerados: [] }, fail: { gerados } })
    const casos = {
      'vazio__texto-nao-ascii': lado([entrada({ texto: `caf${cp(0xe9)}\n` })]),
      'vazio__dois-caminhos': lado([entrada({ caminhoBase64: b64('b.txt') })]),
      'vazio__nenhum-conteudo': lado([{ caminho: 'a.txt' }]),
      'vazio__base64-torto': lado([{ caminho: 'a.txt', base64: 'a$b' }]),
      'vazio__ponto-ponto': lado([{ caminhoBase64: b64('x/', ZWSP, '/../y'), texto: '' }]),
      'vazio__ponto-git': lado([entrada({ caminho: '.GIT/config' })]),
      'vazio__barra-inicial': lado([entrada({ caminho: '/a.txt' })]),
      vazio__nul: lado([{ caminhoBase64: b64('a', Buffer.from([0]), 'b'), texto: '' }]),
      vazio__longo: lado([entrada({ caminho: 'a'.repeat(4097) })]),
      vazio__repetido: lado([entrada(), entrada()]),
      'vazio__pasta-e-arquivo': lado([entrada({ caminho: 'a' }), entrada({ caminho: 'a/b' })]),
      vazio__estatico: { ...lado([entrada()]), estaticos: { 'fail/a.txt': 'a\n' } },
      'vazio__modo-no-link': lado([{ caminho: 'l', symlink: 'a', modo: '100755' }]),
      'vazio__modo-torto': lado([entrada({ modo: '100600' })]),
      'vazio__chave-estranha': lado([entrada({ mode: '100755' })]),
      vazio__lista: { pass: { gerados: [] }, fail: { gerados: { 'a.txt': { texto: 'a' } } } },
      vazio__demais: lado(Array.from({ length: 201 }, (_, i) => entrada({ caminho: `f${i}` }))),
      'vazio__duas-mensagens': {
        pass: { gerados: [] },
        fail: {
          gerados: [],
          commits: [{ mensagem: 'm', mensagemBase64: b64('m'), autor: 'P <p@x>' }],
        },
      },
      'vazio__sem-pasta': { pass: { gerados: [] } },
    }
    const r = provar('malformados', casos)
    assert.equal(r.codigo, 2, r.saida)
    const n = Object.keys(casos).length
    assert.match(
      r.saida,
      new RegExp(`0 of ${n} case\\(s\\) matched {2}· {2}${n} malformed`),
      r.saida,
    )
    for (const trecho of [
      'fail.gerados[0].texto takes printable ASCII, LF and TAB only — use base64',
      'fail.gerados[0] needs exactly one of "caminho" or "caminhoBase64"',
      'fail.gerados[0] needs exactly one of "texto", "base64" or "symlink"',
      'fail.gerados[0].base64 is not base64 that round-trips',
      'fail.gerados[0] (x/<U+200B>/../y) has a "." or ".." segment',
      'fail.gerados[0] (.GIT/config) has a ".git" segment',
      'fail.gerados[0] (/a.txt) is not relative with single "/" separators (empty segment)',
      'has a NUL byte, which ends a path in the index format',
      'has 4097 bytes — at most 4096',
      'fail.gerados[1] (a.txt) repeats the path of fail.gerados[0]',
      'fail.gerados[1] sits under fail.gerados[0], which is a file',
      'fail.gerados[0] (a.txt) is also a static file of fail/',
      'fail.gerados[0].modo is not allowed with symlink — a link is always 120000',
      'fail.gerados[0].modo only takes "100644" or "100755", got "100600"',
      'fail.gerados[0] has unknown key(s) "mode"',
      '"fail.gerados" has to be a list of entries',
      '"fail.gerados" has 201 entries — at most 200',
      'fail.commits[0] has both "mensagem" and "mensagemBase64" — exactly one',
      'the folder fail/ is missing',
    ]) {
      assert.ok(r.saida.includes(trecho), `missing from the output: ${trecho}\n${r.saida}`)
    }
    // The echo of a hostile path must not carry the code points it is made of.
    const cru = [...r.saida].filter((ch) => {
      const n = ch.codePointAt(0)
      return (naFaixa(n, CONTROLES) && ch !== '\n') || naFaixa(n, IGNORAVEIS)
    })
    assert.deepEqual(cru, [], 'the runner printed a raw control or invisible code point')
  })

  test('a path git drops with exit 0 makes the side malformed, not a verdict', () => {
    // git refuses a `.gitmodules` symlink in verify_path on every platform and
    // says so only with "Ignoring path" and exit 0 (measured on git
    // 2.55.0.windows.2 with core.protectNTFS off).
    const r = provar('descartado', {
      vazio: {
        pass: { estado: 'na', gerados: [], commits: [] },
        fail: { estado: 'na', gerados: [{ caminho: '.gitmodules', symlink: 'x' }], commits: [] },
      },
    })
    assert.equal(r.codigo, 2, r.saida)
    assert.ok(r.saida.includes('gerados: git dropped .gitmodules'), r.saida)
  })
})
