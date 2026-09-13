// THE OUTPUT SANITIZER, PROVED ALONE
//
// tooling/security/texto-seguro.mjs decides what the rulers may print raw. It
// sits between a repository that may be hostile and two readers that cannot see
// invisible text: a person in a terminal and an agent reading an MCP answer. If
// its table drifts, nothing turns red on its own, because a missing range does
// not throw: a zero-width character simply goes out again.
//
// So this file locks three things.
//   1. The ignorable table equals Unicode's own property on the running Node.
//      The table is literal ON PURPOSE (CI runs Node 22, local runs Node 24), and
//      this is the one place `\p{}` is allowed to have a say.
//   2. Every table is sorted and disjoint, which the binary search relies on:
//      an unsorted range makes `naFaixa` answer false for a code point it holds.
//   3. The printed form: what gets escaped, what stays, and how the cut behaves.
//
// Every input is built at runtime with String.fromCodePoint, so this file holds
// no raw invisible character and no control spelled as an escape.
//
//   node --test tooling/security/injection/prove-texto-seguro.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { describe } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CONTROLES, ESCAPAR_TAMBEM, IGNORAVEIS, escaparSaida, naFaixa } from '../texto-seguro.mjs'

const FONTE = fileURLToPath(new URL('../texto-seguro.mjs', import.meta.url))
const cp = (...n) => String.fromCodePoint(...n)
const hex = (n) => `0x${n.toString(16)}`
const TABELAS = { IGNORAVEIS, CONTROLES, ESCAPAR_TAMBEM }

describe('the tables', () => {
  test('IGNORAVEIS equals \\p{Default_Ignorable_Code_Point} over the whole code space', () => {
    // Walks every code point once and rebuilds the ranges the property matches,
    // so a failure prints the range that differs, not 4174 booleans.
    const propriedade = /\p{Default_Ignorable_Code_Point}/u
    const faixas = []
    for (let n = 0; n <= 0x10ffff; n++) {
      if (!propriedade.test(cp(n))) continue
      const ultima = faixas[faixas.length - 1]
      if (ultima && ultima[1] === n - 1) ultima[1] = n
      else faixas.push([n, n])
    }
    assert.deepEqual(
      IGNORAVEIS.map(([a, b]) => `${hex(a)}-${hex(b)}`),
      faixas.map(([a, b]) => `${hex(a)}-${hex(b)}`),
      `the literal table drifted from Node ${process.versions.node} (Unicode ` +
        `${process.versions.unicode}); regenerate it from the UCD, never from \\p{}`,
    )
    const total = IGNORAVEIS.reduce((soma, [a, b]) => soma + b - a + 1, 0)
    assert.equal(total, 4174, 'UCD 17.0.0 lists 4174 default-ignorable code points')
  })

  test('every range is well formed, sorted and disjoint, inside each table and across them', () => {
    const todas = []
    for (const [nome, faixas] of Object.entries(TABELAS)) {
      assert.ok(faixas.length > 0, `${nome} is empty, and everything below passes by vacuity`)
      for (const [i, faixa] of faixas.entries()) {
        assert.equal(faixa.length, 2, `${nome}[${i}] is not a [first, last] pair`)
        const [a, b] = faixa
        assert.ok(Number.isInteger(a) && Number.isInteger(b), `${nome}[${i}] is not integers`)
        assert.ok(
          a >= 0 && b <= 0x10ffff && a <= b,
          `${nome}[${i}] ${hex(a)}-${hex(b)} is inverted`,
        )
        if (i > 0) {
          assert.ok(
            a > faixas[i - 1][1],
            `${nome}[${i}] ${hex(a)} does not come after ${hex(faixas[i - 1][1])}: ` +
              'the binary search in naFaixa needs sorted, disjoint ranges',
          )
        }
        todas.push([a, b, nome])
      }
    }
    todas.sort((x, y) => x[0] - y[0])
    for (let i = 1; i < todas.length; i++) {
      assert.ok(
        todas[i][0] > todas[i - 1][1],
        `${todas[i][2]} ${hex(todas[i][0])} overlaps ${todas[i - 1][2]} ${hex(todas[i - 1][1])}`,
      )
    }
  })

  test('naFaixa answers at both edges of every range, and just outside them', () => {
    for (const [nome, faixas] of Object.entries(TABELAS)) {
      const linear = (n) => faixas.some(([a, b]) => n >= a && n <= b)
      for (const [a, b] of faixas) {
        for (const n of [a - 1, a, a + 1, b - 1, b, b + 1]) {
          if (n < 0 || n > 0x10ffff) continue
          assert.equal(naFaixa(n, faixas), linear(n), `${nome}: naFaixa(${hex(n)}) is wrong`)
        }
      }
    }
    assert.equal(naFaixa(0x41, []), false, 'an empty table holds nothing')
  })
})

describe('escaparSaida', () => {
  test('ESCAPES · zero width space, tag letter, ESC, line feed and a lone surrogate', () => {
    const casos = [
      [0x200b, '<U+200B>'],
      [0xe0041, '<U+E0041>'],
      [0x1b, '<U+001B>'],
      [0x0a, '<U+000A>'],
      [0xd800, '<U+D800>'],
    ]
    for (const [n, esperado] of casos) {
      // A lone surrogate cannot come from String.fromCodePoint as a pair; built
      // this way it is one UTF-16 unit, which is how a broken name arrives.
      const entrada = `a${n >= 0xd800 && n <= 0xdfff ? String.fromCharCode(n) : cp(n)}b`
      assert.equal(escaparSaida(entrada), `a${esperado}b`, `${hex(n)} went out raw`)
    }
  })

  test('ESCAPES · the rest of every table: TAB, CR, DEL, C1, separators, private use, annotations', () => {
    const casos = [0x09, 0x0d, 0x7f, 0x85, 0x9b, 0x2028, 0x2029, 0x202e, 0x2066, 0xe000, 0xfff9]
    for (const n of [...casos, 0xfe0f, 0xfeff, 0x3164, 0xf0000, 0x10fffd, 0xdfff]) {
      const entrada = n >= 0xd800 && n <= 0xdfff ? String.fromCharCode(n) : cp(n)
      const saida = escaparSaida(entrada)
      assert.match(saida, /^<U\+[0-9A-F]{4,6}>$/, `${hex(n)} gave ${JSON.stringify(saida)}`)
      assert.equal(Number.parseInt(saida.slice(3, -1), 16), n, `${hex(n)} got the wrong label`)
    }
  })

  test('LEAVES · warning sign, e with acute, Arabic meem, an emoji pair and plain ASCII', () => {
    const limpo = `${cp(0x26a0)} ${cp(0xe9)} ${cp(0x645)} ${cp(0x1f600)} src/app/page.tsx:12:5`
    assert.equal(escaparSaida(limpo), limpo)
  })

  test('the output holds no control character and no ignorable code point, whatever the input', () => {
    // Every code point of all three tables at once, plus the ones that must
    // survive, in one string: the result must be printable on one line.
    let entrada = ''
    for (const faixas of Object.values(TABELAS)) {
      for (const [a, b] of faixas) {
        for (const n of new Set([a, Math.floor((a + b) / 2), b])) {
          entrada += n >= 0xd800 && n <= 0xdfff ? String.fromCharCode(n) : cp(n)
        }
      }
    }
    entrada += cp(0x26a0, 0xe9, 0x645)
    const saida = escaparSaida(entrada, { limite: Infinity })
    const sujos = [...saida]
      .map((ch) => ch.codePointAt(0))
      .filter((n) => naFaixa(n, CONTROLES) || naFaixa(n, IGNORAVEIS) || naFaixa(n, ESCAPAR_TAMBEM))
    assert.deepEqual(sujos.map(hex), [], 'a code point from the tables survived the escaping')
    assert.ok(saida.endsWith(cp(0x26a0, 0xe9, 0x645)), 'visible text was escaped too')
  })

  test('the cut · counts code points, names what it left out, and never splits a label', () => {
    assert.equal(escaparSaida('abcdef', { limite: 4 }), 'abcd…(+2)')
    assert.equal(escaparSaida('abcd', { limite: 4 }), 'abcd', 'nothing to cut, no suffix')
    assert.equal(escaparSaida('x'.repeat(201)), `${'x'.repeat(200)}…(+1)`, 'the default is 200')

    // An emoji is two UTF-16 units and one code point: it counts once and is
    // never cut in half.
    const emojis = cp(0x1f600).repeat(5)
    assert.equal(escaparSaida(emojis, { limite: 3 }), `${cp(0x1f600).repeat(3)}…(+2)`)

    // `<U+200B>` is 8 code points. With room for 5 it goes out whole or not at
    // all: a partial `<U+20` would read as another code point.
    const rotulado = escaparSaida(`ab${cp(0x200b)}cd`, { limite: 5 })
    assert.equal(rotulado, 'ab…(+10)')
    assert.equal(escaparSaida(`ab${cp(0x200b)}cd`, { limite: 10 }), 'ab<U+200B>…(+2)')
  })
})

describe('the source of texto-seguro.mjs', () => {
  const texto = readFileSync(FONTE, 'utf8')

  test('holds no raw character from its own tables, other than line feeds', () => {
    // It is copied next to the MCP server and read by the injection rules like
    // any tracked file. A sanitizer that carries what it removes fails them.
    const achados = []
    for (const [i, ch] of [...texto].entries()) {
      const n = ch.codePointAt(0)
      if (n === 0x0a) continue
      if (naFaixa(n, CONTROLES) || naFaixa(n, IGNORAVEIS) || naFaixa(n, ESCAPAR_TAMBEM)) {
        achados.push(`${hex(n)} at ${i}`)
      }
    }
    assert.deepEqual(achados, [])
  })

  test('spells no control as an escape, and imports nothing', () => {
    // Built by concatenation, so this proof does not carry the spellings it
    // looks for. The escaped-form heuristic reads files next to server code,
    // and the MCP copy of this file lives in exactly such a folder.
    const barra = String.fromCharCode(0x5c)
    const grafias = ['x1b', 'x9b', 'u001b', 'u009b', 'u{1b}', 'u{9b}', '033'].map((g) => barra + g)
    const minusculo = texto.toLowerCase()
    assert.deepEqual(
      grafias.filter((g) => minusculo.includes(g)),
      [],
      'texto-seguro.mjs spells a control character as an escape: use the hex tables',
    )
    assert.doesNotMatch(texto, /^\s*import\b/m, 'texto-seguro.mjs must stay free of imports')
  })
})
