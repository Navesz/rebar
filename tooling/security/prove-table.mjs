// THE INVARIANT THAT KEEPS THE DETECTOR FROM DETECTING ITSELF
//
// `disabled-defense` used to fail rebar itself with NINE findings, and eight of
// them were the detection table finding itself: each entry kept the literal
// twice, once in the regular expression and once, in plain text, in the readable
// message beside it. The message was what matched.
//
// The measurement that pointed at the fix: the regular expression AS WRITTEN in
// the source does not match itself, because where real code has a space the
// source has `\s*`, two characters and neither of them a space. Only the message
// matched. So the printed literal now comes from the MATCH, which is where it
// should have come from all along: the text in the audited file, not a copy
// typed here. One pattern was left, `@csrf` plus `_exempt`, the only one with no
// `\s` in the middle, so its source carried its own target; it is assembled in
// pieces, the same idiom as the split token in tooling/secret/prove-scan.mjs.
//
// ─────────────────────────────── eleven tables now, and a reader with no mercy
//
// Until the prompt-injection rules this file held one table, DESLIGAM, against
// the comment-stripped text of the two files that could carry it. The injection
// families brought ten more tables (engines and tables in `./injection/*.mjs`,
// re-exported by name from index.mjs), and a stricter reader: those rules read
// every tracked blob RAW, through the index, with no proof root, template root
// or .rebarignore to hide anything. A table word spelled in a comment of a
// family source, in a README, or in the JSDoc that `mcp/generate.mjs` copies
// into `mcp/rules.generated.json`, is a finding against rebar itself, and a
// sample of the attack in every repository that vendors a copy.
//
// So every export of index.mjs shaped like a table is found here the same way
// the generator finds it (a non-empty array of `[RegExp, string, ...]` rows),
// and each is held against what its OWN rule reads:
//
//   the six text tables   (the agent binaries and flags, the terminal escapes,
//                         the MCP server markers) are patterns run over tracked
//                         text, so they are held against the raw text of
//                         index.mjs, texto-seguro.mjs, every file in
//                         ./injection/, the prove-*.mjs beside this file,
//                         tooling/security/README.md, the three root READMEs,
//                         and mcp/rules.generated.json read whole;
//   the four key tables   (the config keys and variable names agent-config-exec
//                         matches, the runners and shell signs mcp-server-launch
//                         matches) are whole-string matchers, anchored at both
//                         ends with no multiline flag, run over one parsed key or
//                         one launch command at a time. Over a whole file such a
//                         row can only match a file that is nothing but the key,
//                         so the raw test proves nothing for them and passed by
//                         vacuity: 63 rows did (measured). Prose that names a key
//                         is no finding of those rules. What is proved instead is
//                         the shape that makes that true, so a row loosened into
//                         a text search fails here and has to move to the text
//                         group; and test (f) of prove-injection.mjs runs both
//                         rules on rebar itself. A multiline flag is no fix:
//                         measured, the shell signs then matched 25 of the 26
//                         targets;
//   DESLIGAM             the comment-stripped code of index.mjs and of this
//                         file, which is all `disabled-defense` ever reads. It
//                         reads no JSON and no Markdown, and a case `why` in the
//                         artifact quotes one of its literals on purpose.
//
// Measured when this was written: zero matches on every target, once the
// escape-shaped colour helper of index.mjs was replaced by `node:util`.
//
//   node --test tooling/security/prove-table.mjs

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { semComentarioNemImport } from '../rebar-check/index.mjs'
import * as MODULO from './index.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const ler = (...partes) => readFileSync(join(...partes), 'utf8')

/** The same predicate as tabelasDePadrao in mcp/generate.mjs, so both see the same tables. */
const TABELAS = Object.entries(MODULO).filter(
  ([, valor]) =>
    Array.isArray(valor) &&
    valor.length > 0 &&
    valor.every(
      (e) =>
        Array.isArray(e) && e.length >= 2 && e[0] instanceof RegExp && typeof e[1] === 'string',
    ),
)
const DESLIGAM = MODULO.DESLIGAM
const INJECAO = TABELAS.filter(([nome]) => nome !== 'DESLIGAM')

/** The injection tables whose rows match one parsed key or one launch command, whole. */
const CHAVE = [
  'CHAVES_QUE_EXECUTAM',
  'EXECUTORES_REMOTOS',
  'SINAIS_DE_SHELL',
  'VARIAVEIS_PERIGOSAS',
]
const DE_CHAVE = INJECAO.filter(([nome]) => CHAVE.includes(nome))
const DE_TEXTO = INJECAO.filter(([nome]) => !CHAVE.includes(nome))
const inteira = (padrao) =>
  padrao.source.startsWith('^') && padrao.source.endsWith('$') && !padrao.flags.includes('m')

/** Every table name the rules consult today. A table that stops being exported is caught here. */
const ESPERADAS = [
  'BINARIOS_DE_AGENTE',
  'CHAVES_QUE_EXECUTAM',
  'DESLIGAM',
  'ESCAPES_DE_CONTROLE',
  'EXECUTORES_REMOTOS',
  'FLAGS_AMBIGUAS',
  'FLAGS_FORTES',
  'MARCADORES_DE_SERVIDOR',
  'PARES_DE_FLAG',
  'SINAIS_DE_SHELL',
  'VARIAVEIS_PERIGOSAS',
]

/** [label, text] pairs the injection rules would read raw from rebar. */
function alvosCrus() {
  const injecao = readdirSync(join(AQUI, 'injection'))
    .filter((f) => f.endsWith('.mjs'))
    .sort()
    .map((f) => [`tooling/security/injection/${f}`, ler(AQUI, 'injection', f)])
  const provas = readdirSync(AQUI)
    .filter((f) => /^prove-.*\.mjs$/.test(f))
    .sort()
    .map((f) => [`tooling/security/${f}`, ler(AQUI, f)])
  const readmes = readdirSync(RAIZ)
    .filter((f) => /^README.*\.md$/.test(f))
    .sort()
    .map((f) => [f, ler(RAIZ, f)])
  return [
    ['tooling/security/index.mjs', ler(AQUI, 'index.mjs')],
    ['tooling/security/texto-seguro.mjs', ler(AQUI, 'texto-seguro.mjs')],
    ...injecao,
    ...provas,
    ['tooling/security/README.md', ler(AQUI, 'README.md')],
    ...readmes,
    ['mcp/rules.generated.json', ler(RAIZ, 'mcp', 'rules.generated.json')],
  ]
}

test('the tables are exported and none is empty: without this the rest passes by vacuity', () => {
  assert.deepEqual(TABELAS.map(([nome]) => nome).sort(), ESPERADAS)
  assert.ok(DESLIGAM.length >= 8, `DESLIGAM has ${DESLIGAM.length} row(s)`)
})

test('NO EXPLANATION CARRIES A LITERAL ANY PATTERN LOOKS FOR', () => {
  // The root cause of the eight of 2026-09-07, now across every table: an
  // explanation is printed into CI logs, `--json` and MCP answers, and the
  // artifact indexes all of them. One that matched a row of ANY table would make
  // the output of one rule a finding of another.
  const explicacoes = TABELAS.flatMap(([nome, tabela]) => tabela.map(([, e]) => [nome, e]))
  const culpados = []
  for (const [nome, tabela] of TABELAS) {
    for (const [padrao] of tabela) {
      for (const [dona, explicacao] of explicacoes) {
        if (padrao.test(explicacao)) {
          culpados.push(`${nome} ${padrao} matches "${explicacao}" (${dona})`)
        }
      }
    }
  }
  assert.deepEqual(
    culpados,
    [],
    'an explanation repeats what a pattern hunts. The second column is the EXPLANATION; the ' +
      'text found comes from the match.',
  )
})

test('the injection tables split into a text group and a key group, none left out', () => {
  assert.deepEqual(DE_CHAVE.map(([nome]) => nome).sort(), [...CHAVE].sort())
  assert.equal(DE_TEXTO.length + DE_CHAVE.length, INJECAO.length)
  assert.ok(DE_TEXTO.length >= 6, `${DE_TEXTO.length} text table(s)`)
})

test('EVERY ROW OF A KEY TABLE IS WHOLE-STRING, AND NO ROW OF A TEXT TABLE IS', () => {
  // The raw test below cannot fail for a whole-string row, so for the four key
  // tables this shape is what is held: a row that starts searching free text
  // fails here and its table moves to the text group, where the raw test reads
  // it. A whole-string row in a text table would pass the raw test by vacuity.
  const soltas = DE_CHAVE.flatMap(([nome, tabela]) =>
    tabela.filter(([p]) => !inteira(p)).map(([p]) => `${nome} ${p}`),
  )
  assert.deepEqual(
    soltas,
    [],
    'a key-table row searches free text: move its table to the text group',
  )
  const vazias = DE_TEXTO.flatMap(([nome, tabela]) =>
    tabela.filter(([p]) => inteira(p)).map(([p]) => `${nome} ${p}`),
  )
  assert.deepEqual(
    vazias,
    [],
    'a text-table row matches only a whole file, so it proves nothing raw',
  )
})

test('THE TEXT TABLES MATCH NOTHING REBAR TRACKS ABOUT THEM, READ RAW', () => {
  // Raw and not comment-stripped: hidden-unicode and control-bytes read every
  // blob whole, the JSDoc of a rule is copied verbatim into the artifact, and
  // the injection rules honour no exclusion (no proof root, template root or
  // .rebarignore). Stripping here would forgive what the rules will not.
  const achados = []
  for (const [rotulo, texto] of alvosCrus()) {
    for (const [nome, tabela] of DE_TEXTO) {
      for (const [padrao, explicacao] of tabela) {
        if (padrao.test(texto)) achados.push(`${nome} "${explicacao}" matches ${rotulo}`)
      }
    }
  }
  assert.deepEqual(
    achados,
    [],
    'a table of the injection rules matches a file rebar tracks. Assemble the word from pieces ' +
      'in code, describe it by vendor and effect in prose, and never quote it in a rule JSDoc: ' +
      'excluding the file only moves the sample into every copy of rebar.',
  )
})

test('DESLIGAM stays clean over the code it reads: index.mjs and this proof, comments out', () => {
  // The consequence, measured the way the rule measures: comments out, which is
  // what `codigo()` does before judging any tree. This was red for weeks with
  // nobody looking, because the `security` step ran the module's PROOFS and never
  // the ruler against the repository. The `security-self` step runs it now.
  for (const arquivo of ['index.mjs', 'prove-table.mjs']) {
    const visto = semComentarioNemImport(ler(AQUI, arquivo))
    const achados = DESLIGAM.filter(([padrao]) => padrao.test(visto))
    assert.deepEqual(
      achados.map(([p]) => p.source),
      [],
      `the security ruler finds itself in tooling/security/${arquivo}. A pattern whose literal ` +
        'appears raw in the source accuses every repository that holds a copy of the ruler; ' +
        'assemble it in pieces, like the `@csrf` + `_exempt` of the table.',
    )
  }
})
