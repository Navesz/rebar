// THE PROOF OF `semComentario` — the function six rules trust.
//
// It decides what the rules SEE. Until 2026-09-06 it was two regex
// substitutions with no notion of a string at all, and nothing in this
// repository exercised it on its own: it was proved sideways, through the cases
// of the rules that use it, and the rules' cases carry no string with a block
// opener inside because nobody writes a fixture thinking about the comment
// stripper.
//
// WHAT IT GOT WRONG, measured across the 139 source files of this repository: 9
// had code erased, and the worst was `new/gate/aplicar.mjs`, with 1,181 tokens
// outside the exam. The cause is one documentation line inside a template —
// quoted verbatim below, and it stays in Portuguese because it is the exact
// source line that broke it (`new/gate/aplicar.mjs`):
//
//   | conteúdo | `conteudo/*.json`, validado no build | §12.3 |
//
// The `/` followed by `*` in there opened a block comment that only closed at
// the `*` `/` of the next JSDoc, a hundred lines below — and everything in
// between vanished from the audit. One of the six consumers is the SECURITY
// rule.
//
// THE ACCEPTANCE RULE of these cases: only the comment branch may erase. Every
// case below that is not a comment demands the text BACK, whole.
//
//   node --test tooling/rebar-check/prove-strip.mjs

import assert from 'node:assert/strict'
import test from 'node:test'

import { semComentario } from './index.mjs'

/** The tokens left over, which is what the rules see. */
const vistos = (t) => (semComentario(t).match(/[A-Za-z_$][\w$]*|\d+/g) ?? []).join(' ')

// Slash and asterisk assembled at runtime: writing the literal sequence here
// would close this file's own comment, which is the very blindness under test.
const ABRE = '/' + '*'
const FECHA = '*' + '/'

test('a line comment goes out', () => {
  assert.equal(vistos('const a = 1 // segredo aqui\nconst b = 2'), 'const a 1 const b 2')
})

test('a block comment goes out, and the line breaks stay', () => {
  const t = `const a = 1\n${ABRE}\numa\nnota\n${FECHA}\nconst b = 2`
  assert.equal(vistos(t), 'const a 1 const b 2')
  // Without preserving the break, every rule that counts lines starts pointing at the wrong one.
  assert.equal(semComentario(t).split('\n').length, t.split('\n').length)
})

test('`https://` does not become a comment — it is the `:` that holds, and it holds outside quotes', () => {
  // It really does arrive like this: `ci-gates` assembles the body of the shell
  // scripts in package.json and passes it through here with no quote at all.
  assert.match(semComentario('curl https://exemplo.com/rota --fail'), /exemplo\.com\/rota --fail/)
})

test('A BLOCK OPENER INSIDE A STRING DOES NOT SWALLOW THE CODE AFTER IT', () => {
  // It is the defect, in the exact form it happened in the generator — and the
  // JSDoc at the end is part of the case, not decoration: the old regex only
  // erased when there was a block closer ahead for it to reach. In a real file
  // there always is, because every file around here is full of JSDoc. Without
  // the last line the case passes on BOTH implementations and proves nothing —
  // measured, and that is what happened the first time it was written.
  const t = [
    `const doc = 'conteudo${ABRE}.json, validado no build'`,
    'const cfg = { rejectUnauthorized: false }',
    "const token = 'ghp_naoDeveriaSumir'",
    `${ABRE}* Um JSDoc qualquer, cem linhas abaixo. ${FECHA}`,
    'function f() {}',
  ].join('\n')
  const saida = semComentario(t)
  assert.match(saida, /rejectUnauthorized: false/)
  assert.match(saida, /ghp_naoDeveriaSumir/)
  // And the JSDoc at the end still goes out, which is the function's job.
  assert.doesNotMatch(saida, /cem linhas abaixo/)
})

test('`//` inside a string does not eat the rest of the line', () => {
  assert.match(semComentario(`const g = 'src//dupla' + segredo`), /src\/\/dupla.*segredo/)
})

test('an unclosed string contaminates ONE line, never the file', () => {
  // An orphan quote happens in shell bodies and in loose text. The limit is the line.
  const t = "echo don't\nconst achavel = 1"
  assert.match(semComentario(t), /achavel/)
})

test('template: the inside is code again, and a comment in there goes out', () => {
  const t = 'const s = `antes ${ x /* nota */ + 1 } depois`\nconst d = 2'.replace(
    '/* nota */',
    `${ABRE} nota ${FECHA}`,
  )
  const saida = semComentario(t)
  assert.doesNotMatch(saida, /nota/)
  assert.match(saida, /antes/)
  assert.match(saida, /depois/)
  assert.match(saida, /const d = 2/)
})

test('a nested template comes back to the right body', () => {
  const t = 'const s = `a ${ `b ${ c } d` } e`\nconst f = 3'
  // The order `a b c d e` is what proves the nesting: if the inner backtick
  // closed the outer template, the `e` would turn into template body and the
  // `const f` would slip out of place.
  assert.equal(vistos(t), 'const s a $ b $ c d e const f 3')
})

test('a regular expression with a quote inside does not open a string', () => {
  // `/["\']/` is common in this repository. If the quote inside opened a string,
  // it would swallow up to the next quote in the file.
  const t = 'const RE = /["\']/\nconst depois = 42'
  assert.match(semComentario(t), /depois = 42/)
})

test('division is not confused with a regular expression', () => {
  // `a / b` followed by `/` on the line below: if the first `/` opened a regex,
  // it would consume up to the next one — and eat `b` along with it.
  const t = 'const m = total / parcelas\nconst n = outro / divisor'
  assert.equal(vistos(t), 'const m total parcelas const n outro divisor')
})

test('`return /x/` is a regular expression, despite the letter before it', () => {
  assert.equal(
    vistos('function f() { return /a"b/ }\nconst z = 9'),
    'function f return a b const z 9',
  )
})

test('a character class with a slash inside does not close the regular expression', () => {
  const t = 'const RE = /[/]x/\nconst depois = 7'
  assert.match(semComentario(t), /depois = 7/)
})

test('no code disappears: what is not a comment comes back whole', () => {
  // The mother assertion. A file with no comment at all has to come out identical.
  const t = [
    "const url = 'https://a.b/c'",
    'const re = /["\']|[/]/g',
    'const tpl = `x ${ y } z`',
    'const div = a / b / c',
    'const obj = { rejectUnauthorized: false }',
  ].join('\n')
  assert.equal(semComentario(t), t)
})
