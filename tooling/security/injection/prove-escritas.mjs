// MIXED-SCRIPT-TOKEN, PROVED AGAINST THE LETTERS IT NAMES
//
// tooling/security/injection/escritas.mjs decides whether a URL host, a URL
// segment, a package name or an agent config identifier mixes writing systems,
// from the literal ranges in escritas-tabelas.mjs. These tests pin the table
// against the running Node where that Node has the same Unicode, the resolved
// script set with its CJK allowance, the punycode decoder against RFC 3492, the
// URL splitter, and what the rule reads and prints.
//
// No raw non-ASCII character is in this file, and no mixed-script URL either:
// a punycode host is ASCII and would be a finding of this very rule against
// rebar, so every such fixture is assembled at run time.
//
//   node --test tooling/security/injection/prove-escritas.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'

import { ESCRITAS_DE_LETRA, LISTADOS_EM_EXTENSOES } from './escritas-tabelas.mjs'
import {
  checarMixedScript,
  decodificarPunycode,
  escritaMista,
  escritasDe,
  tokensDeUrl,
  urlsDe,
} from './escritas.mjs'
import { NOME_DA_ALLOWLIST } from './reader.mjs'

const cp = (...n) => String.fromCodePoint(...n)
const B = String.fromCharCode(92)
/** `https://` assembled, so no URL literal of a mixed host sits in this source. */
const WEB = 'https' + '://'
const PUNY = 'xn' + '--'

// ----------------------------------------------------------- temp repositories

const criados = []
after(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})
const SEM_CONFIG = join(tmpdir(), 'rebar-prove-escritas-gitconfig-inexistente')
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
    windowsHide: true,
  })
  if (r.status !== 0) throw new Error(`git ${argumentos.join(' ')}: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}
function repositorio(arquivos) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-escritas-'))
  criados.push(dir)
  git(dir, ['init', '-q'])
  const linhas = Object.entries(arquivos).map(([caminho, texto]) => {
    const oid = git(dir, ['hash-object', '-w', '--no-filters', '--stdin'], texto)
    return `100644 ${oid}\t${caminho}\0`
  })
  git(dir, ['update-index', '-z', '--add', '--index-info'], linhas.join(''))
  return dir
}

// ================================================================ the table

describe('the script table', () => {
  test('sorted, disjoint, inclusive ranges of four-letter codes', () => {
    let fim = -1
    for (const [a, b, s] of ESCRITAS_DE_LETRA) {
      assert.ok(a > fim && b >= a, `range ${a.toString(16)}-${b.toString(16)}`)
      assert.match(s, /^[A-Z][a-z]{3}( [A-Z][a-z]{3})*$/)
      assert.ok(!/Zyyy|Zinh|Zzzz/.test(s), s)
      fim = b
    }
    assert.equal(ESCRITAS_DE_LETRA.length, 779)
  })

  test('outside the code points ScriptExtensions 17.0 lists, it equals Alphabetic and Script on a Unicode 16.0 Node', (t) => {
    if (process.versions.unicode !== '16.0') {
      t.skip(`this Node has Unicode ${process.versions.unicode}; the table was generated from 16.0`)
      return
    }
    const nomes = new Set(ESCRITAS_DE_LETRA.flatMap((f) => f[2].split(' ')))
    const sc = []
    for (const n of nomes) {
      try {
        sc.push([n, new RegExp(`^${B}p{sc=${n}}$`, 'u')])
      } catch {
        // a script of Unicode 17.0 only, which this Node cannot name
      }
    }
    const alfabetico = new RegExp(`^${B}p{Alphabetic}$`, 'u')
    const listado = (c) => LISTADOS_EM_EXTENSOES.some(([a, b]) => c >= a && c <= b)
    const diferentes = []
    let ultimo = null
    for (let c = 0; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue
      if (listado(c)) continue
      const s = String.fromCodePoint(c)
      let esperado = null
      if (alfabetico.test(s)) {
        if (!ultimo || !ultimo[1].test(s)) ultimo = sc.find(([, re]) => re.test(s)) || null
        esperado = ultimo ? ultimo[0] : null
      }
      if (escritasDe(c) !== esperado && diferentes.length < 5)
        diferentes.push([c.toString(16), escritasDe(c), esperado])
    }
    assert.deepEqual(diferentes, [])
  })
})

// ======================================================= the resolved script set

describe('escritaMista', () => {
  test('recall: the lookalike cases, each naming the letter of the minority script', () => {
    assert.equal(escritaMista(`${cp(0x581)}ithub.com`), 0x581)
    assert.equal(escritaMista(`p${cp(0x430)}ypal.com`), 0x430)
    assert.equal(escritaMista(`g${cp(0x3bf)}ogle`), 0x3bf)
    assert.equal(escritaMista(`${cp(0x441)}${cp(0x3bf)}`), 0x3bf)
    assert.equal(escritaMista(`10k${cp(0x3a9)}`), 0x3a9)
  })

  test('one script, or Latin with Japanese, Chinese or Korean writing, is not mixed', () => {
    assert.equal(escritaMista(cp(0x43f, 0x440, 0x438, 0x432, 0x435, 0x442)), null)
    assert.equal(escritaMista(`relat${cp(0xf3)}rio`), null)
    assert.equal(escritaMista(cp(0x6771, 0x4eac)), null)
    assert.equal(escritaMista(`abc${cp(0x6771, 0x3072, 0x30ab)}`), null)
    assert.equal(escritaMista(`abc${cp(0xd55c, 0x6f22)}`), null)
    assert.equal(escritaMista('plain-ascii.example'), null)
  })

  test('Latin with two of the CJK writings at once is mixed', () => {
    assert.equal(escritaMista(`a${cp(0x3072)}${cp(0xd55c)}`), 0x3072)
  })

  test('a lone lookalike among digits and punctuation is not mixed: a documented limit', () => {
    assert.equal(escritaMista(`1${cp(0x585)}`), null)
  })
})

// ================================================================= punycode

describe('decodificarPunycode', () => {
  test('RFC 3492 section 7.1 samples, and a Latin label', () => {
    const casos = [
      [
        'egbpdaj6bu4bxfgehfvwxn',
        cp(
          0x644,
          0x64a,
          0x647,
          0x645,
          0x627,
          0x628,
          0x62a,
          0x643,
          0x644,
          0x645,
          0x648,
          0x634,
          0x639,
          0x631,
          0x628,
          0x64a,
          0x61f,
        ),
      ],
      [
        'ihqwcrb4cv8a8dqg056pqjye',
        cp(0x4ed6, 0x4eec, 0x4e3a, 0x4ec0, 0x4e48, 0x4e0d, 0x8bf4, 0x4e2d, 0x6587),
      ],
      ['3B-ww4c5e180e575a65lsy2b', `3${cp(0x5e74)}B${cp(0x7d44, 0x91d1, 0x516b, 0x5148, 0x751f)}`],
      ['-> $1.00 <--', '-> $1.00 <-'],
      ['mnchen-3ya', `m${cp(0xfc)}nchen`],
      ['pypal-4ve', `p${cp(0x430)}ypal`],
    ]
    for (const [entrada, esperado] of casos)
      assert.equal(decodificarPunycode(entrada), esperado, entrada)
  })

  test('invalid input is null, never a guess', () => {
    for (const entrada of ['zz!', '-', '99999999999', `${cp(0xe9)}-abc`, 'a-b!'])
      assert.equal(decodificarPunycode(entrada), null, entrada)
  })
})

// ===================================================================== URLs

describe('urlsDe and tokensDeUrl', () => {
  test('trailing punctuation, user and port are not the host; segments are percent-decoded', () => {
    const texto = `See ${WEB}user@Example.com:8080/a%20b/c?q=1#f, then git@host.example:o/r.git.`
    const [web, scp] = urlsDe(texto)
    assert.equal(web.host, 'Example.com')
    assert.equal(web.indiceDoHost, texto.indexOf('Example'))
    assert.deepEqual(
      tokensDeUrl(web).map((t) => [t.tipo, t.token]),
      [
        ['url host', 'Example.com'],
        ['url path', 'a'],
        ['url path', 'b'],
        ['url path', 'c'],
        ['url path', 'q'],
        ['url path', '1'],
        ['url path', 'f'],
      ],
    )
    assert.equal(scp.host, 'host.example')
    assert.equal(urlsDe(`[x](${WEB}Example.org:3000/p).`)[0].host, 'Example.org')
    // A malformed escape stays as written instead of throwing, then splits on its punctuation.
    assert.deepEqual(
      tokensDeUrl(urlsDe(`${WEB}a.example/%E0%A4%A`)[0]).map((t) => t.token),
      ['a.example', 'E0', 'A4', 'A'],
    )
  })

  test('punycode labels are decoded and the host is one token, positioned at the first encoded label', () => {
    const texto = `go ${WEB}www.${PUNY}pypal-4ve.com/x`
    const [u] = urlsDe(texto)
    assert.equal(u.host, `www.p${cp(0x430)}ypal.com`)
    assert.equal(tokensDeUrl(u)[0].indice, texto.indexOf(PUNY))
    // An invalid label stays raw, and raw ASCII is no mix.
    assert.equal(urlsDe(`${WEB}${PUNY}zz!.com`)[0].host.startsWith(PUNY), true)
  })

  test('a label longer than DNS allows is not decoded, and a 200,000-letter one does not break the ruler', () => {
    // 59 letters after the prefix fit a 63-octet label; one more does not.
    assert.equal(decodificarPunycode(`${'a'.repeat(58)}-`), 'a'.repeat(58))
    assert.equal(decodificarPunycode(`${'a'.repeat(59)}-`), null)
    // Decoded, this label overflowed the stack: mixed-script-token broke and
    // rebar-security exited 127 without --heuristics.
    const longo = `${PUNY}${'a'.repeat(200000)}-`
    assert.equal(urlsDe(`see ${WEB}${longo}.example/`)[0].host, `${longo}.example`)
  })

  test('user@host:path is found from each @, exactly where the pattern it replaces matched', () => {
    // The pattern the first engine ran, kept here as the reference.
    const ANTIGO =
      /(?<![^\s"'`(<[{=,])[^\s"'`<>@:/()[\]{}]+@([^\s"'`<>@:/()[\]{},;]+\.[^\s"'`<>@:/()[\]{},;.]+):(?!\/\/)[^\s"'`<>]+/g
    // Addresses assembled from edge pieces: 594 matches in 568 of these 4,000
    // strings, the rest near misses (no dot, a trailing dot, `://`, a `;` host).
    let semente = 20260914
    const um = (lista) => {
      semente = (semente * 48271) % 2147483647
      return lista[semente % lista.length]
    }
    const JUNTA = ['', ' ', '(', 'x', '=', ',', ':', '/', '"', '>', '@', 'a.b', '\n']
    const USUARIO = ['', 'git', 'a,b', 'x=y', '1.2', 'u-v', ':u']
    const HOST = ['h.io', 'h.', '.h', 'h', 'a.b.c', 'h;x.y', 'h,i.j', 'h.i/']
    const SEPARA = [':', ':', ':/' + '/', '']
    const CAMINHO = ['p', '', 'p q', 'p@q.r:s', '/r', 'x>']
    const sorteadas = []
    for (let n = 0; n < 4000; n++) {
      let s = ''
      for (let k = 0, partes = 1 + (n % 3); k < partes; k++)
        s += um(JUNTA) + um(USUARIO) + '@' + um(HOST) + um(SEPARA) + um(CAMINHO) + um(JUNTA)
      sorteadas.push(s)
    }
    const fixas = ['git@host.example:o/r.git', 'x,y@a.b:c d=e@f.g:h', 'a@b.c:d@e.f:g', '(u@h.io:p)']
    for (const s of [...fixas, ...sorteadas]) {
      const esperado = [...s.matchAll(ANTIGO)].map((m) => [
        m.index,
        m.index + m[0].indexOf('@') + 1,
      ])
      assert.deepEqual(
        urlsDe(s).map((u) => [u.indice, u.indiceDoHost]),
        esperado,
        JSON.stringify(s),
      )
    }
  })

  test('linear on what JSON.stringify writes for a vector of numbers', () => {
    // The pattern retried every comma of the run: 32 s here on the first engine
    // for 301 KB with no address at all, 57.6 s for an honest 318 KB bundle.
    let x = 1
    const vetor = Array.from({ length: 32000 }, () => {
      x = (x * 48271) % 2147483647
      return Number(((x / 2147483647) * 2 - 1).toFixed(6))
    })
    const casos = {
      vetor: JSON.stringify({ model: 'probe', embedding: vetor }),
      arrobas: `${'1,'.repeat(100000)}@`.repeat(3),
      pontuacao: `${WEB}x.example/${','.repeat(200000)}a`,
    }
    for (const [nome, texto] of Object.entries(casos)) {
      const t0 = performance.now()
      for (const u of urlsDe(texto)) tokensDeUrl(u)
      assert.ok(performance.now() - t0 < 5000, nome)
    }
  })
})

// ================================================================= the rule

describe('checarMixedScript over the index', () => {
  const NONCE = 'qzvkxjwbnmrt'

  test('URLs in any file, manifests and agent config are judged; the message names the minority letter and never the token', () => {
    const dir = repositorio({
      'README.md': `# x\n\nThe fix: ${WEB}${cp(0x581)}ithub.com/o/${NONCE}/pull/1\n`,
      'requirements.txt': `# pinned\nrequ${cp(0x435)}sts==2.0\nflask>=3\n`,
      'pyproject.toml': `[project]\nname = "app"\ndependencies = ["dj${cp(0x430)}ngo>=5"]\n`,
      '.vscode/settings.json': `{ "servers": { "id": "g${cp(0x456)}thub-${NONCE}" } }\n`,
      'docs/prose.md': `A 10 k${cp(0x3a9)} resistor and ${cp(0x394)}E of 2.\n`,
    })
    const motivo = checarMixedScript({ dir })
    assert.equal(typeof motivo, 'string')
    assert.ok(!motivo.includes(NONCE), motivo)
    assert.match(motivo, /^4 token\(s\) mixing writing systems: /)
    assert.match(motivo, /README\.md:3:18 url host mixes writing systems at <U\+0581>/)
    assert.match(motivo, /requirements\.txt:2:1 package name mixes writing systems at <U\+0435>/)
    assert.match(motivo, /pyproject\.toml:3:\d+ package name mixes writing systems at <U\+0430>/)
    assert.match(
      motivo,
      /\.vscode\/settings\.json:1:\d+ config value mixes writing systems at <U\+0456>/,
    )
    assert.ok(!motivo.includes('prose.md'), 'prose is never judged')
  })

  test('the allowlist accepts a file by blob id; with nothing to judge the rule is not applicable', () => {
    const arquivos = {
      'package.json': `{ "name": "app", "dependencies": { "re${cp(0x430)}ct": "npm:re${cp(0x430)}ct@1" } }\n`,
      '.github/CODEOWNERS': `/${NOME_DA_ALLOWLIST} @owner\n`,
    }
    const sem = repositorio(arquivos)
    // The key and its alias sit at one position with one letter: one item.
    assert.match(
      checarMixedScript({ dir: sem }),
      /^1 token\(s\) mixing writing systems: package\.json:1:\d+ package name/,
    )
    const oid = git(sem, ['ls-files', '-s', '--', 'package.json']).split(' ')[1]
    const linha = JSON.stringify({
      regra: 'mixed-script-token',
      arquivo: 'package.json',
      oid,
      motivo: 'reviewed',
    })
    assert.equal(
      checarMixedScript({ dir: repositorio({ ...arquivos, [NOME_DA_ALLOWLIST]: `${linha}\n` }) }),
      null,
    )
    assert.deepEqual(checarMixedScript({ dir: repositorio({ 'notes.txt': 'no address\n' }) }), {
      na: 'no URL, package manifest or agent config tracked',
    })
  })

  test('a manifest npm reads is judged even past the strict reader, and a tracked manifest is never not applicable', () => {
    let fundo = 0
    for (let k = 0; k < 513; k++) fundo = [fundo]
    const nome = `lod${cp(0x430)}sh`
    // 513 levels: the strict reader refuses, npm and JSON.parse do not. Before,
    // this manifest judged no name and the verdict was na, "no package manifest".
    const dir = repositorio({
      'package.json': JSON.stringify({ name: 'app', dependencies: { [nome]: '1.0.0' }, x: fundo }),
    })
    assert.match(
      checarMixedScript({ dir }),
      /^1 token\(s\) mixing writing systems: package\.json \(package name\) package name mixes writing systems at <U\+0430>/,
    )
    assert.equal(checarMixedScript({ dir: repositorio({ 'package.json': '{}\n' }) }), null)
  })
})
