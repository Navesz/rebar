// HIDDEN-UNICODE, PROVED AGAINST THE STANDARD AND AGAINST THE ATTACKS
//
// tooling/security/injection/unicode.mjs decides which invisible code points
// fail, warn or pass. Three kinds of evidence pin it here:
//
//   - the whole Unicode 17.0 emoji standard: every RGI ZWJ, keycap, flag and tag
//     sequence of emoji-17.mjs, under every file type, gives zero findings. An
//     exception that is one character too strict fails here before it fails a
//     real README;
//   - the synthetic verdicts of a phase-1 prototype, plus the
//     decisions taken after it (the keycap rule, the
//     strict soft hyphen, lone surrogates, noncharacters);
//   - the rule end to end, over repositories whose entries exist ONLY in the git
//     index (hash-object plus update-index --index-info, the way the proof runner
//     builds `gerados`): names, symlink targets, commit messages, format escapes,
//     frontmatter, reading problems and every branch of the allowlist.
//
// Every special character is built at runtime from a number, so this file holds
// no raw invisible, bidi, tag or control character. \p{} appears here and only
// here: the engine decides with literal tables, and this file checks
// those tables against the running Node.
//
//   node --test tooling/security/injection/prove-unicode.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'

import { CONTROLES, IGNORAVEIS, naFaixa } from '../texto-seguro.mjs'
import * as EMOJI from './emoji-17.mjs'
import { NOME_DA_ALLOWLIST, decodificarBlob } from './reader.mjs'
import * as TABELAS from './unicode-tabelas.mjs'
import { EXT_PICT } from './unicode-tabelas.mjs'
import { checarHiddenUnicode, classificar } from './unicode.mjs'

const cp = (...n) => String.fromCodePoint(...n)
const unidade = (n) => String.fromCharCode(n)
const codigosDeTag = (s) => [...s].map((ch) => 0xe0000 + ch.charCodeAt(0))
const tags = (s) => cp(...codigosDeTag(s))
const ASPAS = unidade(0x22)
const CRASE = unidade(0x60)
const BARRA = unidade(0x5c)
const TIPOS = ['agente', 'codigo', 'prosa', 'dados', 'nome', 'commit']

/** 'limpo' when nothing warns or fails, else the worst verdict. */
function pior(texto, tipo, opcoes) {
  const achados = classificar(texto, tipo, opcoes)
  if (achados.some((a) => a.veredito === 'reprova')) return 'reprova'
  if (achados.some((a) => a.veredito === 'avisa')) return 'avisa'
  return 'limpo'
}
const motivos = (texto, tipo, opcoes) =>
  classificar(texto, tipo, opcoes)
    .filter((a) => a.veredito !== 'isento')
    .map((a) => `${a.veredito}:${a.motivo}`)

// ═══════════════════════════════════════════════════════════════ the tables

describe('the literal tables', () => {
  test('every table is sorted, disjoint and inclusive, which naFaixa needs', () => {
    const conferir = (nome, faixas) => {
      let anterior = -1
      for (const [inicio, fim] of faixas) {
        assert.ok(Number.isInteger(inicio) && Number.isInteger(fim), `${nome}: not integers`)
        assert.ok(inicio <= fim, `${nome}: [${inicio}, ${fim}] is reversed`)
        assert.ok(inicio > anterior, `${nome}: ranges overlap or are out of order at ${inicio}`)
        assert.ok(fim <= 0x10ffff, `${nome}: past U+10FFFF`)
        anterior = fim
      }
    }
    for (const [nome, valor] of Object.entries(TABELAS)) {
      if (nome === 'JUNCAO') {
        assert.equal(valor.length, 33, 'the 33 joining scripts of the prototype')
        for (const [escrita, faixas] of valor) conferir(`JUNCAO ${escrita}`, faixas)
      } else conferir(nome, valor)
    }
  })

  test('EXT_PICT is Unicode 17.0 Extended_Pictographic: this Node at 17+, a subset before', () => {
    // Unicode 17.0 took 689 non-emoji symbols out of the property (measured on
    // Node 24.13, Unicode 16.0: 3537 code points there, 2848 in the 17.0 file).
    // Before 17 the table may only be SMALLER than the running Node's property,
    // never larger; from 17 on the two must be equal.
    const re = /^\p{Extended_Pictographic}$/u
    const maior = Number(String(process.versions.unicode || '0').split('.')[0]) >= 17
    let naTabela = 0
    let soNoNode = 0
    for (let c = 0; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue
      const tabela = naFaixa(c, EXT_PICT)
      const node = re.test(cp(c))
      if (tabela) naTabela++
      assert.ok(!tabela || node, `U+${c.toString(16)} is in the table and not in this Node`)
      if (node && !tabela) soNoNode++
    }
    assert.equal(naTabela, 2848)
    if (maior) assert.equal(soNoNode, 0, 'from Unicode 17 on the table equals the property')
  })

  test('EMOJI_MODIFIER, WHITE_SPACE and NAO_CARACTERES equal the running Node (stable properties)', () => {
    const iguais = (faixas, re, nome) => {
      for (let c = 0; c <= 0x10ffff; c++) {
        if (c >= 0xd800 && c <= 0xdfff) continue
        if (naFaixa(c, faixas) !== re.test(cp(c)))
          assert.fail(`${nome} differs at U+${c.toString(16)}`)
      }
    }
    iguais(TABELAS.EMOJI_MODIFIER, /^\p{Emoji_Modifier}$/u, 'EMOJI_MODIFIER')
    iguais(TABELAS.WHITE_SPACE, /^\p{White_Space}$/u, 'WHITE_SPACE')
    iguais(TABELAS.NAO_CARACTERES, /^\p{Noncharacter_Code_Point}$/u, 'NAO_CARACTERES')
  })

  test('the engine and its data files hold no candidate code point at all', () => {
    // The rule reads rebar itself with no exemption, so its own sources must
    // come out with zero findings of ANY verdict, and the two generated data
    // files must be plain printable ASCII.
    for (const arquivo of [
      'unicode.mjs',
      'unicode-tabelas.mjs',
      'emoji-17.mjs',
      'prove-unicode.mjs',
    ]) {
      const texto = readFileSync(new URL(arquivo, import.meta.url), 'utf8')
      const todos = classificar(texto, 'codigo', { conteudo: true })
      assert.deepEqual(todos, [], `${arquivo} holds a candidate code point`)
    }
    for (const arquivo of ['unicode-tabelas.mjs', 'emoji-17.mjs']) {
      const texto = readFileSync(new URL(arquivo, import.meta.url), 'utf8')
      const fora = [...texto].find((ch) => {
        const c = ch.codePointAt(0)
        return c !== 0x0a && (c < 0x20 || c > 0x7e)
      })
      assert.equal(fora, undefined, `${arquivo} is not printable ASCII plus LF`)
    }
  })
})

// ═════════════════════════════════════════════════════ the emoji standard

describe('every RGI sequence of Unicode 17.0 is exempt', () => {
  for (const [nome, lista] of Object.entries(EMOJI)) {
    test(`${nome}: ${lista.length} sequences, zero findings under every type`, () => {
      assert.ok(lista.length > 0)
      for (const sequencia of lista) {
        const texto = `a ${cp(...sequencia)} b`
        for (const tipo of TIPOS) {
          const achados = motivos(texto, tipo)
          if (achados.length) {
            assert.fail(`${sequencia.map((c) => c.toString(16)).join(' ')} [${tipo}]: ${achados}`)
          }
        }
      }
    })
  }
})

// ═════════════════════════════════════════════════════ synthetic verdicts

describe('the synthetic verdicts of the prototype', () => {
  // [name, text, tipo, expected]. The prototype's 'instrucao' is the reader's
  // 'agente'; every verdict is the one the prototype measured. Its report counts
  // 45 cases and its file holds 46; all 46 are here, in the file's order.
  const casos = [
    [
      'family emoji',
      cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466),
      'agente',
      'limpo',
    ],
    ['Scotland flag', cp(0x1f3f4, ...codigosDeTag('gbsct'), 0xe007f), 'agente', 'limpo'],
    [
      'non-RGI subdivision flag shape',
      cp(0x1f3f4, ...codigosDeTag('ustx'), 0xe007f),
      'prosa',
      'reprova',
    ],
    ['keycap one', cp(0x31, 0xfe0f, 0x20e3), 'agente', 'limpo'],
    ['heart on fire', cp(0x2764, 0xfe0f, 0x200d, 0x1f525), 'agente', 'limpo'],
    ['technologist medium skin', cp(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb), 'agente', 'limpo'],
    ['check mark text style', cp(0x2714, 0xfe0e), 'codigo', 'limpo'],
    ['ten tags in a row', `x${tags('zzzzzzzzzz')}`, 'prosa', 'reprova'],
    ['one lone tag', `x${cp(0xe0041)}y`, 'prosa', 'reprova'],
    ['language tag', cp(0xe0001), 'prosa', 'reprova'],
    ['hangul filler as identifier', `const ${cp(0x3164)} = 1`, 'codigo', 'reprova'],
    ['halfwidth filler', `a${cp(0xffa0)}`, 'prosa', 'reprova'],
    [
      'VS run after pipe (os-info-checker shape)',
      `|${cp(0xe0100, 0xe0101, 0xe0102, 0xe0103)}`,
      'codigo',
      'reprova',
    ],
    [
      'VS1-16 run after backtick (GlassWorm shape)',
      `${CRASE}${cp(0xfe00, 0xfe01, 0xfe02)}${CRASE}`,
      'codigo',
      'reprova',
    ],
    ['single VS16 after ASCII letter', `a${cp(0xfe0f)}`, 'prosa', 'reprova'],
    ['double VS16 after emoji', cp(0x1f600, 0xfe0f, 0xfe0f), 'prosa', 'reprova'],
    ['IVS after Han in prose', cp(0x845b, 0xe0100), 'prosa', 'avisa'],
    ['IVS after Han in code', cp(0x845b, 0xe0100), 'codigo', 'reprova'],
    ['IVS after Han in instruction', cp(0x845b, 0xe0100), 'agente', 'reprova'],
    [
      'invisible times/plus alternation',
      `a${cp(0x2062, 0x2064, 0x2062, 0x2062, 0x2064, 0x2064, 0x2062, 0x2064)}`,
      'prosa',
      'reprova',
    ],
    ['ZWSP inside word', `ab${cp(0x200b)}cd`, 'prosa', 'reprova'],
    ['ZWJ between ASCII letters', `ab${cp(0x200d)}cd`, 'prosa', 'reprova'],
    [
      'Persian ZWNJ (mi + khaham)',
      cp(0x0645, 0x06cc, 0x200c, 0x062e, 0x0648, 0x0627, 0x0647, 0x0645),
      'prosa',
      'limpo',
    ],
    // The prototype failed it; strict mode now keeps one joiner between two
    // letters of the same joining script, which Persian cannot be written without.
    ['Persian ZWNJ in instruction file', cp(0x0645, 0x06cc, 0x200c, 0x062e), 'agente', 'limpo'],
    [
      'Devanagari half form KA VIRAMA ZWJ SSA',
      cp(0x0915, 0x094d, 0x200d, 0x0937),
      'prosa',
      'limpo',
    ],
    ['Devanagari ZWNJ after virama', cp(0x0915, 0x094d, 0x200c, 0x0937), 'codigo', 'limpo'],
    ['ZWNJ run in Arabic', cp(0x0645, 0x200c, 0x200c, 0x062e), 'prosa', 'reprova'],
    [
      'RLM in Hebrew line',
      cp(0x05e9, 0x05dc, 0x05d5, 0x05dd, 0x20, 0x31, 0x200f),
      'prosa',
      'limpo',
    ],
    ['RLM in ASCII line', `abc${cp(0x200f)}def`, 'prosa', 'reprova'],
    [
      'RLO unpaired in code comment (Trojan Source shape)',
      `// x ${cp(0x202e)} y`,
      'codigo',
      'reprova',
    ],
    ['paired RLI..PDI in Arabic prose', cp(0x0645, 0x2067, 0x0627, 0x2069), 'prosa', 'avisa'],
    ['paired RLI..PDI in ASCII prose', `a${cp(0x2067)}b${cp(0x2069)}`, 'prosa', 'reprova'],
    ['soft hyphen inside a word', `Silben${cp(0x00ad)}trennung`, 'prosa', 'avisa'],
    ['soft hyphen run', `ab${cp(0x00ad, 0x00ad)}cd`, 'prosa', 'reprova'],
    ['ZWNBSP mid-file', `a${cp(0xfeff)}b`, 'codigo', 'reprova'],
    ['Mongolian FVS after Mongolian letter', cp(0x1820, 0x180b), 'prosa', 'limpo'],
    ['Mongolian FVS after ASCII', `a${cp(0x180b)}`, 'prosa', 'reprova'],
    ['braille blank', `a${cp(0x2800)}b`, 'prosa', 'avisa'],
    ['private use', `a${cp(0xe000)}b`, 'codigo', 'avisa'],
    ['reserved FFF0', `a${cp(0xfff0)}`, 'prosa', 'reprova'],
    ['emoji ZWJ into letter', `${cp(0x1f600, 0x200d)}a`, 'prosa', 'reprova'],
    [
      'single ZWJ as a whole string literal in code',
      `if (c === ${ASPAS}${cp(0x200d)}${ASPAS}) x()`,
      'codigo',
      'avisa',
    ],
    [
      'two invisibles as a whole string literal in code',
      `const s = ${CRASE}${cp(0xfe00, 0xfe01)}${CRASE}`,
      'codigo',
      'reprova',
    ],
    [
      'single ZWJ literal in instruction file stays reprova',
      `x ${ASPAS}${cp(0x200d)}${ASPAS}`,
      'agente',
      'reprova',
    ],
    [
      'VS16 after reserved ExtPict code point (future emoji)',
      cp(0x1faff, 0xfe0f),
      'prosa',
      'limpo',
    ],
    ['name with LRM', `docs/a${cp(0x200e)}.md`, 'nome', 'reprova'],
  ]

  test('none of the prototype cases was dropped', () => assert.equal(casos.length, 46))
  for (const [nome, texto, tipo, esperado] of casos) {
    test(`${nome} [${tipo}] -> ${esperado}`, () => {
      assert.equal(pior(texto, tipo), esperado, motivos(texto, tipo).join(', '))
    })
  }
})

describe('the decisions taken after the prototype', () => {
  const casos = [
    // A digit takes a selector only as a keycap.
    ['digit and selector, no keycap mark', `1${cp(0xfe0f)}`, 'prosa', 'reprova'],
    ['keycap hash', `#${cp(0xfe0f, 0x20e3)}`, 'agente', 'limpo'],
    ['keycap with two selectors', `2${cp(0xfe0f, 0xfe0f, 0x20e3)}`, 'prosa', 'reprova'],
    ['text-style selector after a pictograph', cp(0x1f600, 0xfe0e), 'agente', 'limpo'],
    // Unicode 17.0 took the chess symbols out of Extended_Pictographic.
    ['selector after a chess symbol', cp(0x2654, 0xfe0f), 'prosa', 'reprova'],
    // Tags: only the exact RGI runs.
    [
      'black flag, 20 tags, cancel tag',
      cp(0x1f3f4, ...codigosDeTag('gbsctgbsctgbsctgbsct'), 0xe007f),
      'prosa',
      'reprova',
    ],
    [
      'Scotland flag with a tag after the cancel tag',
      cp(0x1f3f4, ...codigosDeTag('gbsct'), 0xe007f, 0xe0061),
      'prosa',
      'reprova',
    ],
    ['tags without the black flag', cp(...codigosDeTag('gbsct'), 0xe007f), 'prosa', 'reprova'],
    // The rest of the fail and warn sets.
    ['a lone surrogate', `a${unidade(0xd800)}b`, 'dados', 'reprova'],
    [
      'U+FEFF as a single-character literal in code warns (rule 0 of the ported classifier)',
      `s.replace(${ASPAS}${cp(0xfeff)}${ASPAS}, '')`,
      'codigo',
      'avisa',
    ],
    [
      'U+FEFF as a single-character literal in an agent file fails',
      `'${cp(0xfeff)}'`,
      'agente',
      'reprova',
    ],
    ['U+FEFF between two letters in code fails', `a${cp(0xfeff)}b`, 'codigo', 'reprova'],
    ['noncharacter U+FFFE', `a${cp(0xfffe)}b`, 'prosa', 'avisa'],
    ['noncharacter U+10FFFF', `a${cp(0x10ffff)}`, 'agente', 'avisa'],
    ['interlinear annotation', `a${cp(0xfff9)}b${cp(0xfffb)}`, 'dados', 'avisa'],
    ['supplementary private use', `a${cp(0x100000)}`, 'nome', 'avisa'],
    ['reserved ignorable after the tag block', `a${cp(0xe0200)}`, 'prosa', 'reprova'],
    // Strict files get no other script or bidi exemption (the joiner and the
    // mark they keep are proved in the next block).
    [
      'soft hyphen between letters in an agent file',
      `Silben${cp(0x00ad)}trennung`,
      'agente',
      'reprova',
    ],
    [
      'paired RLI..PDI in Arabic in an agent file',
      cp(0x0645, 0x2067, 0x0627, 0x2069),
      'agente',
      'reprova',
    ],
    ['paired RLI..PDI in Arabic in code', cp(0x0645, 0x2067, 0x0627, 0x2069), 'codigo', 'reprova'],
    ['RLM in a Hebrew line of code', cp(0x05e9, 0x05dc, 0x200f), 'codigo', 'avisa'],
    ['RLM in a Hebrew commit message', cp(0x05e9, 0x05dc, 0x200f), 'commit', 'limpo'],
    ['RLM in a Hebrew line of an agent file', cp(0x05e9, 0x05dc, 0x200f), 'agente', 'limpo'],
    ['RLM with the Hebrew on the NEXT line', `abc${cp(0x200f)}\n${cp(0x05e9)}`, 'prosa', 'reprova'],
    ['Mongolian FVS in an agent file', cp(0x1820, 0x180b), 'agente', 'reprova'],
    ['IVS after Han in data', cp(0x845b, 0xe0100), 'dados', 'avisa'],
    ['VS1 after zero in prose', `0${cp(0xfe00)}`, 'prosa', 'avisa'],
    ['VS1 after zero in code', `0${cp(0xfe00)}`, 'codigo', 'reprova'],
    ['grapheme joiner after a Hebrew letter', cp(0x05d0, 0x034f, 0x05b7), 'prosa', 'avisa'],
    ['grapheme joiner after an ASCII letter', `a${cp(0x034f)}`, 'prosa', 'reprova'],
    ['Khmer inherent vowel after a Khmer letter', cp(0x1780, 0x17b4), 'prosa', 'avisa'],
    ['Khmer inherent vowel in a name', cp(0x1780, 0x17b4), 'nome', 'reprova'],
    ['Jamo filler next to a Jamo', cp(0x115f, 0x1161), 'prosa', 'avisa'],
    ['ZWJ between Arabic and Devanagari', cp(0x0645, 0x200d, 0x0915), 'prosa', 'reprova'],
    // The ZWJ walk-back skips a skin tone and a selector, but the selector itself
    // still needs a pictograph right before it, so this non-RGI shape fails once.
    [
      'selector after a skin tone inside a ZWJ sequence',
      cp(0x1f44d, 0x1f3fd, 0xfe0f, 0x200d, 0x1f525),
      'prosa',
      'reprova',
    ],
    [
      'RGI golfer: selector, ZWJ, sign, selector',
      cp(0x1f3cc, 0xfe0f, 0x200d, 0x2640, 0xfe0f),
      'agente',
      'limpo',
    ],
    // GitHub's anti-mention guard in a Dependabot commit message: one U+200B
    // between '@' and a login character, and nothing else.
    ['mention guard in a commit message', `see @${cp(0x200b)}someone`, 'commit', 'limpo'],
    ['mention guard before a digit', `@${cp(0x200b)}9lives`, 'commit', 'limpo'],
    ['mention guard shape before a dash', `@${cp(0x200b)}-x`, 'commit', 'reprova'],
    ['two U+200B after @', `@${cp(0x200b, 0x200b)}x`, 'commit', 'reprova'],
    ['U+200B inside a word of a commit message', `no${cp(0x200b)}tes`, 'commit', 'reprova'],
    ['mention guard shape in a file', `@${cp(0x200b)}someone`, 'prosa', 'reprova'],
    ['mention guard shape in a name', `@${cp(0x200b)}someone`, 'nome', 'reprova'],
    // Khmer marks word boundaries with U+200B (date-fns' km locale).
    ['U+200B between Khmer words in prose', cp(0x1780, 0x200b, 0x1781), 'prosa', 'limpo'],
    ['U+200B between Khmer words in data', cp(0x179f, 0x200b, 0x1794), 'dados', 'limpo'],
    ['U+200B between Khmer words in code', cp(0x17cd, 0x200b, 0x1798), 'codigo', 'limpo'],
    [
      'U+200B between Khmer words in an agent file',
      cp(0x1780, 0x200b, 0x1781),
      'agente',
      'reprova',
    ],
    ['U+200B between Khmer words in a name', cp(0x1780, 0x200b, 0x1781), 'nome', 'reprova'],
    ['U+200B between a quote and a Khmer word', `${ASPAS}${cp(0x200b, 0x1796)}`, 'codigo', 'avisa'],
    ['two U+200B between Khmer words', cp(0x1780, 0x200b, 0x200b, 0x1781), 'prosa', 'reprova'],
  ]
  for (const [nome, texto, tipo, esperado] of casos) {
    test(`${nome} [${tipo}] -> ${esperado}`, () => {
      assert.equal(pior(texto, tipo), esperado, motivos(texto, tipo).join(', '))
    })
  }

  test('U+FEFF at offset 0 of a decoded blob is a second BOM; elsewhere it is ZWNBSP', () => {
    assert.deepEqual(motivos(`${cp(0xfeff)}a`, 'prosa', { conteudo: true }), ['reprova:second-bom'])
    assert.deepEqual(motivos(`${cp(0xfeff)}a`, 'commit'), ['reprova:zero-width-no-break-space'])
  })

  test('offsets are UTF-16, so a caller can hand them to posicao', () => {
    const texto = `${cp(0x1f600)}x${cp(0x200b)}`
    assert.deepEqual(
      classificar(texto, 'prosa').map((a) => [a.indice, a.fim, a.cp, a.veredito]),
      [[3, 4, 0x200b, 'reprova']],
    )
  })

  test('a 20,000-tag run and 8 MiB of ASCII stay linear', () => {
    const inicio = Date.now()
    assert.equal(classificar(`a${cp(...new Array(20000).fill(0xe0041))}`, 'prosa').length, 20000)
    assert.equal(classificar(`${'x'.repeat(99)}\n`.repeat(84000), 'prosa').length, 0)
    assert.ok(Date.now() - inicio < 5000, `took ${Date.now() - inicio} ms`)
  })
})

describe('strict mode keeps what Persian and Arabic are written with, and nothing more', () => {
  // Measured before: a Persian CLAUDE.md, an Arabic AGENTS.md with an RLM
  // before a number and a Persian file name all failed, because strict mode
  // dropped the joiner and bidi-mark exemptions whole. Strict mode now keeps a
  // lone ZWNJ or ZWJ between two LETTERS of one joining script, and a lone
  // LRM, RLM or ALM on a line with right-to-left script.
  const MIKHAHAM = cp(0x0645, 0x06cc, 0x200c, 0x062e, 0x0648, 0x0627, 0x0647, 0x0645)
  const ARABE = cp(0x0627, 0x0644, 0x0625, 0x0635, 0x062f, 0x0627, 0x0631)
  const casos = [
    ['Persian word with ZWNJ in an agent file', `# ${MIKHAHAM}\n`, 'agente', 'limpo'],
    ['Persian word with ZWNJ in a name', `docs/${MIKHAHAM}.md`, 'nome', 'limpo'],
    [
      'ZWJ between two Arabic letters in an agent file',
      cp(0x0645, 0x200d, 0x062e),
      'agente',
      'limpo',
    ],
    [
      'RLM before a number on an Arabic line of an agent file',
      `${ARABE} ${cp(0x200f)}2\n`,
      'agente',
      'limpo',
    ],
    ['ALM on an Arabic line in a name', `docs/${ARABE}${cp(0x061c)}1.md`, 'nome', 'limpo'],
    // What stays strict.
    [
      'ZWNJ run between Persian letters in an agent file',
      cp(0x0645, 0x200c, 0x200c, 0x062e),
      'agente',
      'reprova',
    ],
    ['ZWNJ between an Arabic and a Latin letter', cp(0x0645, 0x200c, 0x61), 'agente', 'reprova'],
    [
      'ZWNJ between an Arabic letter and an Arabic-Indic digit',
      cp(0x0645, 0x200c, 0x0661),
      'agente',
      'reprova',
    ],
    [
      'ZWNJ between Arabic and Devanagari letters in a name',
      cp(0x0645, 0x200c, 0x0915),
      'nome',
      'reprova',
    ],
    [
      'ZWNJ after a Devanagari virama (a mark, not a letter) in an agent file',
      cp(0x0915, 0x094d, 0x200c, 0x0937),
      'agente',
      'reprova',
    ],
    [
      'ZWSP between Persian letters in an agent file',
      cp(0x0645, 0x200b, 0x062e),
      'agente',
      'reprova',
    ],
    [
      'RLM on a line with no right-to-left letter in an agent file',
      `abc ${cp(0x200f)}2`,
      'agente',
      'reprova',
    ],
    [
      'RLM with the Arabic on the next line of an agent file',
      `abc${cp(0x200f)}\n${ARABE}`,
      'agente',
      'reprova',
    ],
    [
      'two RLM in a row on an Arabic line of an agent file',
      `${ARABE} ${cp(0x200f, 0x200f)}2`,
      'agente',
      'reprova',
    ],
    [
      'RLM next to a ZWSP on an Arabic line of a name',
      `${ARABE}${cp(0x200f, 0x200b)}.md`,
      'nome',
      'reprova',
    ],
    [
      'RLO override on an Arabic line of an agent file',
      `${ARABE} ${cp(0x202e)}abc`,
      'agente',
      'reprova',
    ],
    [
      'paired RLI..PDI on an Arabic line in a name',
      `${ARABE}${cp(0x2067)}a${cp(0x2069)}`,
      'nome',
      'reprova',
    ],
    ['tag after a Persian word in an agent file', `${MIKHAHAM}${cp(0xe0041)}`, 'agente', 'reprova'],
    // The mark must not supply its own right-to-left context. U+061C sits in the
    // Arabic block, so a line context built from the block alone made every lone
    // ALM on an English line exempt (measured: five of them on one line of
    // AGENTS.md, and docs/CLAUDE<ALM>.md, all passed). Only a right-to-left
    // LETTER makes the line right-to-left: not the Arabic number sign, which is a
    // format character, and not an Arabic vowel mark riding on a Latin letter.
    [
      'lone ALM on a Latin line of an agent file',
      `run the tests${cp(0x061c)} now`,
      'agente',
      'reprova',
    ],
    ['lone ALM in a Latin name', `docs/CLAUDE${cp(0x061c)}.md`, 'nome', 'reprova'],
    ['lone ALM on a Latin line of prose', `Release ${cp(0x061c)}2026`, 'prosa', 'reprova'],
    [
      'RLM after the Arabic number sign on a Latin line of an agent file',
      `run ${cp(0x0600)} ${cp(0x200f)}x`,
      'agente',
      'reprova',
    ],
    [
      'LRM after an Arabic vowel mark on a Latin letter in an agent file',
      `a${cp(0x064b)}bc ${cp(0x200e)}x`,
      'agente',
      'reprova',
    ],
    [
      'RLM on an Arabic line whose letters carry vowel marks, in an agent file',
      `${cp(0x0643, 0x064e, 0x062a, 0x064e, 0x0628, 0x064e)} ${cp(0x200f)}2`,
      'agente',
      'limpo',
    ],
  ]
  for (const [nome, texto, tipo, esperado] of casos) {
    test(`${nome} [${tipo}] -> ${esperado}`, () => {
      assert.equal(pior(texto, tipo), esperado, motivos(texto, tipo).join(', '))
    })
  }

  test('a Persian CLAUDE.md, an Arabic AGENTS.md and a Persian file name pass the whole rule', () => {
    const { dir } = repositorio([
      { caminho: 'CLAUDE.md', conteudo: `# ${MIKHAHAM}\n\n${MIKHAHAM} ${MIKHAHAM}\n` },
      { caminho: 'AGENTS.md', conteudo: `# ${ARABE} ${cp(0x200f)}2\n` },
      { caminho: `docs/${MIKHAHAM}.md`, conteudo: '# notes\n' },
    ])
    assert.equal(checarHiddenUnicode({ dir }), null)
    const sujo = repositorio([
      { caminho: 'CLAUDE.md', conteudo: `# ${cp(0x0645, 0x200b, 0x062e)}\n` },
      { caminho: 'AGENTS.md', conteudo: `# ${ARABE} ${cp(0x202e)}2\n` },
    ])
    const saida = checarHiddenUnicode({ dir: sujo.dir })
    assert.equal(typeof saida, 'string', JSON.stringify(saida))
    semInvisivel(saida)
    assert.ok(saida.includes('CLAUDE.md:1:4 <U+200B> zero-width-space'), saida)
    assert.ok(saida.includes('AGENTS.md:1:11 <U+202E> bidi-control'), saida)
  })

  test('every lone ALM on an English line fails the whole rule, one finding each', () => {
    const ALM = cp(0x061c)
    const { dir } = repositorio([
      {
        caminho: 'AGENTS.md',
        conteudo: `# Rules\n\nAlways${ALM} run${ALM} the${ALM} tests.\nNever${ALM} push.\n`,
      },
      { caminho: 'CLAUDE.md', conteudo: `Run npm test${ALM} before commit.\n` },
      { caminho: `docs/CLAUDE${ALM}.md`, conteudo: '# notes\n' },
    ])
    const saida = checarHiddenUnicode({ dir })
    assert.equal(typeof saida, 'string', JSON.stringify(saida))
    semInvisivel(saida)
    assert.equal(saida.split('<U+061C> bidi-mark').length - 1, 6, saida)
    assert.ok(saida.includes('name docs/CLAUDE<U+061C>.md:1:12 <U+061C> bidi-mark'), saida)
    assert.ok(saida.includes('AGENTS.md:3:7 <U+061C> bidi-mark'), saida)
    assert.ok(saida.includes('CLAUDE.md:1:13 <U+061C> bidi-mark'), saida)
  })

  test('MARCAS_RTL holds only alphabetic marks of the right-to-left blocks', () => {
    const marca = /^\p{M}$/u
    for (const [inicio, fim] of TABELAS.MARCAS_RTL) {
      for (let c = inicio; c <= fim; c++) {
        assert.ok(naFaixa(c, TABELAS.RTL_FORTE), `U+${c.toString(16)} is outside RTL_FORTE`)
        assert.ok(naFaixa(c, TABELAS.ALFABETICO), `U+${c.toString(16)} is not Alphabetic`)
        // A Node older than Unicode 17 does not know the newest marks yet, so
        // only an assigned code point is held to the property here.
        if (/^\p{Assigned}$/u.test(cp(c)))
          assert.ok(marca.test(cp(c)), `U+${c.toString(16)} is not a mark`)
      }
    }
  })
})

describe('decoding by BOM feeds the classifier (why the reader decodes first)', () => {
  const carga = `ok ${tags('zzzzzzzzzzzz')} fim`
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(carga, 'utf16le')])
  const be = Buffer.from(le)
  be.swap16()
  const u32 = Buffer.alloc(4 + [...carga].length * 4)
  u32.writeUInt32LE(0xfeff, 0)
  ;[...carga].forEach((ch, k) => u32.writeUInt32LE(ch.codePointAt(0), 4 + 4 * k))
  const u8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(carga, 'utf8')])
  for (const [nome, bytes] of [
    ['utf-16le', le],
    ['utf-16be', be],
    ['utf-32le', u32],
    ['utf-8-bom', u8],
  ]) {
    test(`${nome}: all 12 tags found`, () => {
      const { texto, codificacao } = decodificarBlob(bytes)
      assert.equal(codificacao, nome)
      assert.equal(motivos(texto, 'prosa', { conteudo: true }).length, 12)
    })
  }
  test('a naive UTF-8 read of the UTF-16LE bytes finds none of them', () => {
    assert.equal(motivos(le.toString('utf8'), 'prosa').length, 0)
  })
})

// ═════════════════════════════════════════════════════════ the rule, whole

const criados = []
after(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})

// The machine's git config never decides what these repositories hold: no
// system or global file (Git for Windows ships core.autocrlf=true in its
// system config, which rewrote CRLF blobs to LF before the rule saw them) and
// no excludes file. The same isolation prove-injection.mjs uses.
const SEM_CONFIG = join(tmpdir(), 'rebar-prove-unicode-gitconfig-inexistente')
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
 * Writes entries straight into the index: [{ caminho, conteudo, modo?, oid? }].
 * `conteudo` is a string (UTF-8) or a Buffer. Returns the oid of each entry.
 */
function gravar(dir, arquivos) {
  const oids = arquivos.map((a) =>
    a.oid
      ? a.oid
      : git(dir, ['hash-object', '-w', '--no-filters', '--stdin'], Buffer.from(a.conteudo)),
  )
  const registros = arquivos.map((a, k) =>
    Buffer.concat([
      Buffer.from(`${a.modo || '100644'} ${oids[k]}\t`),
      Buffer.from(a.caminho, 'utf8'),
      Buffer.from([0]),
    ]),
  )
  git(dir, ['update-index', '-z', '--add', '--index-info'], Buffer.concat(registros))
  return oids
}

function repositorio(arquivos = []) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-unicode-'))
  criados.push(dir)
  git(dir, ['init', '-q'])
  const oids = arquivos.length ? gravar(dir, arquivos) : []
  return { dir, oids }
}

/** One commit of the current index with `mensagem` taken verbatim as bytes. */
function commitar(dir, mensagem) {
  const arvore = git(dir, ['write-tree'])
  const pai = spawnSync('git', ['rev-parse', '-q', '--verify', 'HEAD'], {
    cwd: dir,
    encoding: 'utf8',
  })
  const argumentos = [
    'commit-tree',
    arvore,
    ...(pai.status === 0 ? ['-p', pai.stdout.trim()] : []),
    '-F',
    '-',
  ]
  const id = git(dir, argumentos, Buffer.from(mensagem, 'utf8'))
  git(dir, ['update-ref', 'HEAD', id])
  return id
}

const linhaDaAllowlist = (campos) =>
  `${JSON.stringify({ regra: 'hidden-unicode', motivo: 'measured and reviewed', ...campos })}\n`

/** The remedies a failure prints, by the allowlist key that would exempt it. */
const REMEDIO_ARQUIVO = ` — remove it, or for a generated or vendored file add {regra, motivo, arquivo, oid} to ${NOME_DA_ALLOWLIST}`
const REMEDIO_COMMIT = ` — remove it, or for a commit already published add {regra, motivo, commit} to ${NOME_DA_ALLOWLIST}`
const INEXEMPTAVEIS =
  '; tags outside an emoji flag, bidi controls in agent files or names, and findings inside ' +
  'the allowlist itself cannot be exempted'

/** The printed verdict never carries the characters it reports. */
function semInvisivel(saida) {
  const texto = typeof saida === 'string' ? saida : JSON.stringify(saida)
  for (const ch of texto) {
    const c = ch.codePointAt(0)
    assert.ok(
      !naFaixa(c, IGNORAVEIS) && !naFaixa(c, CONTROLES),
      `the output carries U+${c.toString(16)}`,
    )
  }
}

describe('checarHiddenUnicode over index-only repositories', () => {
  test('na with no entry and no commit; null for clean content', () => {
    assert.deepEqual(checarHiddenUnicode({ dir: repositorio().dir }), {
      na: 'git tracks no file and there is no commit',
    })
    const { dir } = repositorio([
      { caminho: 'README.md', conteudo: `# Caf${cp(0xe9)} ${cp(0x26a0, 0xfe0f)}\n` },
    ])
    assert.equal(checarHiddenUnicode({ dir }), null)
  })

  test('names, symlink targets and commit messages fail, with escaped positions', () => {
    const { dir } = repositorio([
      { caminho: `docs/no${cp(0x200b)}tes.md`, conteudo: '# Notes\n' },
      { caminho: 'link.md', conteudo: `docs/a${cp(0x2060)}.md`, modo: '120000' },
    ])
    const id = commitar(dir, `fix: typo${cp(0xe0041, 0xe0042)}\n`)
    const saida = checarHiddenUnicode({ dir })
    assert.equal(typeof saida, 'string')
    semInvisivel(saida)
    assert.match(saida, /^4 hidden code point\(s\): /)
    assert.ok(saida.includes('name docs/no<U+200B>tes.md:1:8 <U+200B> zero-width-space'), saida)
    assert.ok(
      saida.includes('symlink link.md target 1:7 <U+2060> word-joiner-or-invisible-operator'),
      saida,
    )
    assert.ok(saida.includes(`commit ${id.slice(0, 12)}:1:10 <U+E0041> tag x2`), saida)
  })

  test('format escapes: a JSON unicode escape fails, an escaped emoji sequence passes, even parity is text', () => {
    const u = (hex) => `${BARRA}u${hex}`
    const { dir } = repositorio([
      { caminho: 'config/a.json', conteudo: `{"d": "ok${u('200b')}"}\n` },
      // Python's ensure_ascii writes emoji as surrogate escapes.
      {
        caminho: 'config/b.json',
        conteudo: `{"d": "${u('d83d')}${u('dc68')}${u('200d')}${u('d83d')}${u('dc69')}"}\n`,
      },
      { caminho: 'config/c.json', conteudo: `{"d": "${BARRA}${BARRA}u200b"}\n` },
      { caminho: 'config/d.yml', conteudo: `d: "${BARRA}U000E0041"\n` },
      { caminho: 'config/e.toml', conteudo: `d = 'literal ${u('200b')}'\n` },
    ])
    const saida = checarHiddenUnicode({ dir })
    // The tag is never exempt, so the remedy names the file shape and says so.
    assert.equal(
      saida,
      '2 hidden code point(s): config/a.json:1:10 <U+200B> escaped-zero-width-space · ' +
        'config/d.yml:1:5 <U+E0041> escaped-tag' +
        REMEDIO_ARQUIVO +
        INEXEMPTAVEIS,
    )
  })

  test('an escape behind a link is decoded the way the client opens the link, not by its target', () => {
    // A client opens `.mcp.json` and SKILL.md by those names and parses them as
    // JSON and as frontmatter, so the target's own name decides nothing.
    const u = (hex) => `${BARRA}u${hex}`
    const json = `{"mcpServers": {"x": {"command": "node", "env": {"A": "x${u('200b')}"}}}}\n`
    const skill = `---\nname: x\ndescription: "dates${BARRA}U000E0061"\n---\nbody\n`
    for (const [link, alvo, conteudo, posicao, motivo] of [
      ['.mcp.json', 'cfg/m.txt', json, '1:57', '<U+200B> escaped-zero-width-space'],
      ['.mcp.json', 'cfg/m', json, '1:57', '<U+200B> escaped-zero-width-space'],
      ['.claude/skills/x/SKILL.md', 'docs/x.txt', skill, '3:20', '<U+E0061> escaped-tag'],
      ['.claude/skills/x/SKILL.md', 'docs/x', skill, '3:20', '<U+E0061> escaped-tag'],
    ]) {
      const alvoRelativo = link.includes('/') ? `../../../${alvo}` : alvo
      const { dir } = repositorio([
        { caminho: alvo, conteudo },
        { caminho: link, conteudo: alvoRelativo, modo: '120000' },
      ])
      const saida = checarHiddenUnicode({ dir })
      assert.equal(typeof saida, 'string', `${link} -> ${alvo}: ${JSON.stringify(saida)}`)
      assert.ok(saida.includes(`${alvo}:${posicao} read as ${link} ${motivo}`), saida)
      // The same bytes with no link are data nobody parses: nothing to report.
      const sozinho = repositorio([{ caminho: alvo, conteudo }])
      assert.equal(checarHiddenUnicode({ dir: sozinho.dir }), null, alvo)
    }
  })

  test('a folder link whose settings file leaves the repository fails, as control-bytes fails it', () => {
    const { dir } = repositorio([
      { caminho: '.claude', conteudo: 'cfg', modo: '120000' },
      { caminho: 'cfg/settings.json', conteudo: '/etc/claude-settings.json', modo: '120000' },
      { caminho: 'cfg/README.md', conteudo: '# cfg\n' },
    ])
    const saida = checarHiddenUnicode({ dir })
    assert.equal(typeof saida, 'string', JSON.stringify(saida))
    assert.ok(
      saida.includes('.claude/settings.json unreadable-agent-file (symlink-externo)'),
      saida,
    )
  })

  test('frontmatter escapes count in agent files, and the file is strict', () => {
    const { dir } = repositorio([
      {
        caminho: '.claude/skills/x/SKILL.md',
        conteudo: `---\nname: x\ndescription: "use it${BARRA}u00ad"\n---\n# X\n`,
      },
      // The same escape in prose frontmatter between letters only warns.
      { caminho: 'docs/post.md', conteudo: `---\ntitle: "Silben${BARRA}u00adtrennung"\n---\n` },
    ])
    const saida = checarHiddenUnicode({ dir })
    assert.equal(
      saida,
      '1 hidden code point(s): .claude/skills/x/SKILL.md:3:21 <U+00AD> ' +
        'escaped-soft-hyphen-outside-word · also 1 code point(s) to review' +
        REMEDIO_ARQUIVO,
    )
  })

  test('an agent file the rule cannot read as the agent does fails, whatever it holds', () => {
    const ponteiro = `version https://git-lfs.github.com/spec/v1\noid sha256:${'0'.repeat(64)}\nsize 12\n`
    const { dir } = repositorio([
      { caminho: 'AGENTS.md', conteudo: ponteiro },
      { caminho: 'CLAUDE.md', conteudo: 'a\n' },
      { caminho: 'claude.md', conteudo: 'b\n' },
    ])
    const saida = checarHiddenUnicode({ dir })
    assert.match(saida, /^3 agent file\(s\) not readable as the agent reads them: /)
    assert.ok(saida.includes('AGENTS.md unreadable-agent-file (lfs)'), saida)
    assert.ok(saida.includes('CLAUDE.md unreadable-agent-file (colisao)'), saida)
  })

  test('a directory symlink over an agent folder: the real target is read as an agent file', () => {
    const { dir } = repositorio([
      { caminho: '.claude', conteudo: 'cfg', modo: '120000' },
      { caminho: 'cfg/settings.json', conteudo: `{"a": "x${tags('ab')}"}\n` },
    ])
    assert.equal(
      checarHiddenUnicode({ dir }),
      '2 hidden code point(s): cfg/settings.json:1:9 <U+E0061> tag x2',
      'a tag has no remedy to offer: no allowlist entry exempts it',
    )
  })

  test('warnings, submodules and missing blobs are a nota, never a failure', () => {
    const { dir } = repositorio([
      { caminho: 'docs/spinner.md', conteudo: `frame ${cp(0x2800)}\n` },
      { caminho: 'vendor/sub', oid: 'ab'.repeat(20), modo: '160000' },
      { caminho: 'data.txt', oid: 'cd'.repeat(20) },
    ])
    const saida = checarHiddenUnicode({ dir })
    assert.deepEqual(Object.keys(saida), ['nota'])
    assert.ok(
      saida.nota.includes('1 code point(s) to review: docs/spinner.md:1:7 <U+2800> braille-blank'),
      saida.nota,
    )
    assert.ok(saida.nota.includes('1 submodule(s) not scanned: vendor/sub'), saida.nota)
    assert.ok(
      saida.nota.includes('1 blob(s) missing from the object store, not scanned: data.txt'),
      saida.nota,
    )
  })

  test('when every tracked blob is missing, the rule throws instead of passing', () => {
    const { dir } = repositorio([{ caminho: 'data.txt', oid: 'cd'.repeat(20) }])
    assert.throws(
      () => checarHiddenUnicode({ dir }),
      /none of the 1 tracked blob\(s\) is in the object store/,
    )
  })

  test('the allowlist exempts a file by blob and a commit by id, and says when nobody owns it', () => {
    const { dir, oids } = repositorio([
      { caminho: 'vendor/lib.js', conteudo: `var s = a${cp(0x200b)}b\n` },
    ])
    const id = commitar(dir, `wip${cp(0x200b)}\n`)
    gravar(dir, [
      {
        caminho: NOME_DA_ALLOWLIST,
        conteudo:
          '# reviewed exemptions\n' +
          linhaDaAllowlist({ arquivo: 'vendor/lib.js', oid: oids[0] }) +
          linhaDaAllowlist({ commit: id }) +
          linhaDaAllowlist({ arquivo: 'gone.js', oid: 'ef'.repeat(20) }),
      },
    ])
    const saida = checarHiddenUnicode({ dir })
    assert.deepEqual(Object.keys(saida), ['nota'])
    assert.ok(
      saida.nota.includes(`1 ${NOME_DA_ALLOWLIST} entry for hidden-unicode exempts nothing`),
      saida.nota,
    )
    assert.ok(
      saida.nota.includes(
        `${NOME_DA_ALLOWLIST} exempts 2 finding(s) and no CODEOWNERS entry covers it`,
      ),
      saida.nota,
    )

    // With an owner for the file and no stale entry, the same exemptions are silent.
    const outro = repositorio([{ caminho: 'vendor/lib.js', conteudo: `var s = a${cp(0x200b)}b\n` }])
    gravar(outro.dir, [
      {
        caminho: NOME_DA_ALLOWLIST,
        conteudo: linhaDaAllowlist({ arquivo: 'vendor/lib.js', oid: outro.oids[0] }),
      },
      { caminho: '.github/CODEOWNERS', conteudo: `/${NOME_DA_ALLOWLIST} @owner\n` },
    ])
    assert.equal(checarHiddenUnicode({ dir: outro.dir }), null)
  })

  test('a commit message: one leading BOM is consumed, a second one fails; a mention guard passes', () => {
    const umBom = repositorio([{ caminho: 'README.md', conteudo: '# x\n' }])
    commitar(umBom.dir, `${cp(0xfeff)}docs: update README\n`)
    assert.equal(checarHiddenUnicode({ dir: umBom.dir }), null)

    const doisBoms = repositorio([{ caminho: 'README.md', conteudo: '# x\n' }])
    const id = commitar(doisBoms.dir, `${cp(0xfeff, 0xfeff)}docs\n`)
    assert.equal(
      checarHiddenUnicode({ dir: doisBoms.dir }),
      `1 hidden code point(s): commit ${id.slice(0, 12)}:1:2 <U+FEFF> second-bom` + REMEDIO_COMMIT,
    )

    const bot = repositorio([{ caminho: 'README.md', conteudo: '# x\n' }])
    commitar(
      bot.dir,
      `Bump actions/checkout from 4 to 5\n\nRelease notes by @${cp(0x200b)}octocat.\n` +
        `You can trigger a rebase by commenting @${cp(0x200b)}dependabot rebase.\n`,
    )
    assert.equal(checarHiddenUnicode({ dir: bot.dir }), null)
  })

  test('a BOM a regex strips still fails in code, and the remedy names the escape as source text', () => {
    // P4: a U+FEFF left after decoding fails outside a whole one-character
    // literal. The printed remedy said only "remove it", which breaks a regex
    // that strips a BOM; the escape written as source text passes. Measured on
    // prumo's .ai/gerar.mjs and a Python test string before this remedy existed.
    const { dir } = repositorio([
      { caminho: 'lib/s.mjs', conteudo: `x.replace(/^${cp(0xfeff)}?/, "")\n` },
    ])
    const saida = checarHiddenUnicode({ dir })
    assert.equal(typeof saida, 'string', JSON.stringify(saida))
    semInvisivel(saida)
    assert.match(saida, /^1 hidden code point\(s\): lib\/s\.mjs:1:13 <U\+FEFF> /)
    assert.ok(saida.includes('escape sequence in source text'), saida)
    assert.ok(
      saida.endsWith(
        ' — remove it, or in code write it as an escape sequence in source text; for a ' +
          `generated or vendored file add {regra, motivo, arquivo, oid} to ${NOME_DA_ALLOWLIST}`,
      ),
      saida,
    )
    // The same escape spelled as six ASCII characters is text, and passes.
    const escrito = repositorio([
      { caminho: 'lib/s.mjs', conteudo: `x.replace(/^${BARRA}uFEFF?/, "")\n` },
    ])
    assert.equal(checarHiddenUnicode({ dir: escrito.dir }), null)
    // Outside code the remedy keeps its two clauses.
    const prosa = repositorio([{ caminho: 'docs/a.md', conteudo: `a${cp(0x200b)}b\n` }])
    assert.ok(!String(checarHiddenUnicode({ dir: prosa.dir })).includes('source text'))
  })

  test('Khmer word boundaries and a workspace file escape', () => {
    const { dir } = repositorio([
      { caminho: 'docs/km.md', conteudo: `${cp(0x1780, 0x17b6, 0x200b, 0x1794, 0x17b6)}\n` },
      { caminho: 'src/km.js', conteudo: `const s = ${ASPAS}${cp(0x200b, 0x1796)}${ASPAS}\n` },
      { caminho: 'app.code-workspace', conteudo: `{"settings": {"a": "x${BARRA}u200b"}}\n` },
    ])
    const saida = checarHiddenUnicode({ dir })
    assert.equal(
      saida,
      '1 hidden code point(s): app.code-workspace:1:22 <U+200B> escaped-zero-width-space · ' +
        'also 1 code point(s) to review' +
        REMEDIO_ARQUIVO,
    )
  })

  test('what the allowlist cannot exempt: tags, bidi controls in agent files, itself, and a malformed line', () => {
    const { dir, oids } = repositorio([
      { caminho: 'vendor/tags.js', conteudo: `x${tags('ab')}\n` },
      { caminho: 'AGENTS.md', conteudo: `a ${cp(0x202e)} b\n` },
    ])
    gravar(dir, [
      {
        caminho: NOME_DA_ALLOWLIST,
        conteudo:
          linhaDaAllowlist({ arquivo: 'vendor/tags.js', oid: oids[0] }) +
          linhaDaAllowlist({ arquivo: 'AGENTS.md', oid: oids[1] }) +
          `{"regra": "hidden-unicode", "motivo": "x${cp(0x200b)}"}\n`,
      },
    ])
    const saida = checarHiddenUnicode({ dir })
    semInvisivel(saida)
    assert.match(saida, /^4 hidden code point\(s\) and 1 malformed allowlist line\(s\): /)
    assert.ok(saida.includes('vendor/tags.js:1:2 <U+E0061> tag x2'), saida)
    assert.ok(saida.includes('AGENTS.md:1:3 <U+202E> bidi-control'), saida)
    assert.ok(saida.includes(`${NOME_DA_ALLOWLIST}:3:41 <U+200B> zero-width-space`), saida)
    assert.ok(saida.includes(`${NOME_DA_ALLOWLIST}:3:1 malformed allowlist line: `), saida)
  })
})
