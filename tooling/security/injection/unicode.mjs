// unicode — hidden-unicode: code points an agent reads and a reviewer never sees.
//
// WHY THE RULE EXISTS. A model reads code points, a diff shows glyphs, and the
// Default_Ignorable_Code_Point set is exactly the part of Unicode a renderer is
// allowed to draw as nothing. Tag characters U+E0020-U+E007E spell ASCII one for
// one and render as nothing, so a line of AGENTS.md can carry a whole sentence
// nobody reviews. Bidi overrides reorder what a reviewer reads (Trojan Source,
// CVE-2021-42574), fillers such as U+3164 are valid JavaScript identifiers that
// look empty, and GlassWorm hid its loader as runs of variation selectors inside
// an empty-looking string. None of that is visible in a pull request.
//
// WHAT IS READ, AND FROM WHERE. Everything comes from ./reader.mjs: stage-0
// INDEX blobs decoded by BOM, never the disk, with no proof root, template root or
// .rebarignore exemption. Four sources:
//   - the decoded text of every entry that is not binary;
//   - every tracked path, and the target string of every symlink, as NAMES;
//   - every commit message reachable from HEAD;
//   - a second pass over the escapes a format decodes by itself: JSON, YAML and
//     TOML string contexts, and markdown frontmatter. A description
//     written with a unicode escape is clean ASCII on disk and a real invisible
//     after parsing, measured in phase 1.
//
// WHAT FAILS. The fail set is Default_Ignorable_Code_Point (IGNORAVEIS from
// ../texto-seguro.mjs, 4174 code points of UCD 17.0.0) plus unpaired surrogates.
// The warn set (a nota, never a failure) is U+2800, the private use areas, the
// interlinear annotation controls and the noncharacters. The exceptions below
// exist because the measurement demanded them, each with its number:
//   - emoji. Over the Unicode 17.0 files, every RGI ZWJ, keycap, flag and tag
//     sequence gives zero findings (prove-unicode.mjs runs all of them). rebar's
//     own docs carry 25 U+26A0 U+FE0F warning signs.
//   - script joiners. ZWNJ is how Persian writes a word: 132 of them in zod's fa
//     and kn locales would all be false positives without the JUNCAO rule.
//   - right-to-left marks in a line that is already right-to-left (a line with a
//     right-to-left letter; the mark itself never counts).
//   - a single invisible as the whole of a quoted literal in code (a character
//     table, a `trim` of one code point) warns instead of failing: 152
//     occurrences in 21 dependency files were exactly that.
// Agent files and names are STRICT: of those exemptions they keep only the two
// that Persian and Arabic text cannot be written without, in their narrowest
// shape: one ZWNJ or ZWJ with a letter of the same joining script on each side,
// and one LRM, RLM or ALM on a line that already has a right-to-left letter.
// Everything else (tags, overrides and isolates, runs of invisibles, ZWSP, the
// variation and filler exemptions) fails there. With the exceptions, 169
// dependency files with candidates came down to 36 that fail, all minified
// bundles and code tables (rebar-site node_modules).
//
// WHAT IS PRINTED. The position and `<U+XXXX>`, never the text around it: a
// tag run decoded to ASCII in a CI log or an MCP answer would deliver the very
// payload the rule exists to stop. Paths go through escaparSaida.
//
// This file holds no raw invisible, bidi, tag or control character and no escape
// of one spelled as text: every code point is a hex number.

import { IGNORAVEIS, escaparSaida, naFaixa } from '../texto-seguro.mjs'
import { SEQUENCIAS_DE_TAG } from './emoji-17.mjs'
import { escapesDecodificados, lerFrontmatter } from './formats.mjs'
import {
  NOME_DA_ALLOWLIST,
  PROBLEMAS_DO_CAMINHO,
  formatosDeEscape,
  lerAllowlist,
  lerCommits,
  lerIndice,
  onde,
  posicao,
  problemasDeLeitura,
  resumir,
} from './reader.mjs'
import {
  ALFABETICO,
  AVISOS,
  EMOJI_MODIFIER,
  EXT_PICT,
  HAN,
  JAMO,
  JUNCAO,
  KHMER,
  MARCAS_RTL,
  MONGOL,
  NAO_CARACTERES,
  RTL_FORTE,
  WHITE_SPACE,
} from './unicode-tabelas.mjs'

const REGRA = 'hidden-unicode'

/**
 * UTF-16 code units worth a closer look. Anything else is skipped with one
 * comparison, so a megabyte of ASCII or Latin costs a loop and nothing more.
 * Every surrogate is in: tags, private use planes, noncharacters and lone
 * surrogates all live beyond the BMP or are surrogates themselves.
 */
const PREFILTRO = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x2800, 0x2800],
  [0x3164, 0x3164],
  [0xd800, 0xf8ff],
  [0xfdd0, 0xfdef],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xffff],
]

/** The code points of the private use areas, which AVISOS also lists. */
const USO_PRIVADO = [
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
  [0x100000, 0x10fffd],
]

/**
 * The tag part of the three RGI subdivision flags (England, Scotland, Wales),
 * from emoji-17.mjs. A tag code point is exempt only inside one of these, whole.
 * Measured in phase 1: the loose shape "black flag,
 * any tags, cancel tag" exempted a 25-tag run, which is 25 hidden ASCII letters.
 */
const TAGS_DE_BANDEIRA = SEQUENCIAS_DE_TAG.map((s) => s.slice(1))
const BANDEIRA_PRETA = 0x1f3f4

const ehTag = (c) => c >= 0xe0000 && c <= 0xe007f
const ehTecla = (c) => c === 0x23 || c === 0x2a || (c >= 0x30 && c <= 0x39)
const ehSurrogate = (c) => c >= 0xd800 && c <= 0xdfff
const ehAlfanumericoAscii = (c) =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
const ignoravel = (c) => c >= 0 && naFaixa(c, IGNORAVEIS)

/**
 * A right-to-left LETTER, the only thing that makes a line right-to-left. The
 * block alone is not enough: U+061C ALM lies inside the Arabic block, so a mark
 * judged by its own block supplied its own context, and any number of lone ALMs
 * passed on an English line of AGENTS.md or in a file name (measured). The
 * letter test also drops the Arabic number signs U+0600-0605, U+06DD and U+08E2
 * (format characters, not Alphabetic) and the harakat and points of MARCAS_RTL,
 * which a Latin letter can carry.
 */
const letraRtl = (c) =>
  naFaixa(c, RTL_FORTE) && naFaixa(c, ALFABETICO) && !naFaixa(c, MARCAS_RTL) && !ignoravel(c)

/**
 * "A visible base": above ASCII, and not white space, ignorable, a control, a
 * surrogate or private use (a fixed approximation, used where the
 * prototype asked \p{L}\p{M}\p{N}\p{P}\p{S}).
 */
const baseVisivel = (c) =>
  c > 0x9f &&
  !ehSurrogate(c) &&
  !naFaixa(c, WHITE_SPACE) &&
  !naFaixa(c, IGNORAVEIS) &&
  !naFaixa(c, USO_PRIVADO)

const rotulo = (cp) => `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`

/**
 * Classifies every candidate code point of `texto`.
 *
 * @param {string} texto
 * @param {'agente'|'codigo'|'prosa'|'dados'|'nome'|'commit'} tipo  the reader's
 *   tipo for file content, 'nome' for a path or a symlink target, 'commit' for a
 *   message. 'agente' and 'nome' are STRICT: what an agent obeys and a path a
 *   tool opens keep only a lone joiner between two letters of one joining script
 *   and a lone bidi mark on a right-to-left line; no other script, bidi or
 *   variant exemption applies.
 * @param {{ conteudo?: boolean }} [opcoes]  `conteudo`: the text is a decoded
 *   blob, so a U+FEFF at offset 0 is a SECOND byte order mark (the reader already
 *   consumed the first).
 * @returns {Array<{ indice: number, fim: number, cp: number,
 *   veredito: 'reprova'|'avisa'|'isento', motivo: string }>}
 *   `indice` and `fim` are UTF-16 offsets of the code point in `texto`.
 */
export function classificar(texto, tipo, { conteudo = false } = {}) {
  const t = String(texto)
  const n = t.length
  const estrito = tipo === 'agente' || tipo === 'nome'
  const achados = []

  /** The code point that ENDS right before `pos`, or -1. */
  const antes = (pos) => {
    if (pos <= 0) return -1
    const b = t.charCodeAt(pos - 1)
    if (b >= 0xdc00 && b <= 0xdfff && pos >= 2) {
      const a = t.charCodeAt(pos - 2)
      if (a >= 0xd800 && a <= 0xdbff) return (a - 0xd800) * 0x400 + (b - 0xdc00) + 0x10000
    }
    return b
  }
  const depois = (pos) => (pos >= n ? -1 : t.codePointAt(pos))

  // Line context, computed once per line: does it hold a strong right-to-left
  // letter, and do its embeddings and isolates close in order.
  const linhas = new Map()
  const linhaDe = (pos) => {
    const inicio = pos === 0 ? 0 : t.lastIndexOf('\n', pos - 1) + 1
    const guardada = linhas.get(inicio)
    if (guardada) return guardada
    let fim = t.indexOf('\n', pos)
    if (fim === -1) fim = n
    let rtl = false
    const pilha = []
    let balanceado = true
    for (let p = inicio; p < fim;) {
      const c = t.codePointAt(p)
      p += c > 0xffff ? 2 : 1
      if (!rtl && letraRtl(c)) rtl = true
      if (c === 0x202a || c === 0x202b || c === 0x202d || c === 0x202e) pilha.push('e')
      else if (c === 0x202c) balanceado = pilha.pop() === 'e' && balanceado
      else if (c >= 0x2066 && c <= 0x2068) pilha.push('i')
      else if (c === 0x2069) balanceado = pilha.pop() === 'i' && balanceado
    }
    const info = { rtl, balanceado: balanceado && pilha.length === 0 }
    linhas.set(inicio, info)
    return info
  }

  // A tag run is judged whole, once: it is exempt only when it is exactly the
  // tag part of an RGI flag and follows the black flag. Remembering the last run
  // keeps a 10,000-tag payload linear.
  let ultimaCorrida = null
  const tagIsenta = (pos) => {
    if (ultimaCorrida && pos >= ultimaCorrida.inicio && pos < ultimaCorrida.fim)
      return ultimaCorrida.isenta
    let inicio = pos
    while (ehTag(antes(inicio))) inicio -= 2
    let fim = pos
    const corrida = []
    while (fim < n && ehTag(t.codePointAt(fim))) {
      corrida.push(t.codePointAt(fim))
      fim += 2
    }
    const isenta =
      antes(inicio) === BANDEIRA_PRETA &&
      TAGS_DE_BANDEIRA.some(
        (s) => s.length === corrida.length && s.every((x, i) => x === corrida[i]),
      )
    ultimaCorrida = { inicio, fim, isenta }
    return isenta
  }

  // The element before a ZWJ ends in a pictograph, optionally followed by one
  // skin tone and then optionally by one U+FE0F.
  const fimDeEmoji = (pos) => {
    let p = pos
    let x = antes(p)
    if (x === 0xfe0f) {
      p -= 1
      x = antes(p)
    }
    if (naFaixa(x, EMOJI_MODIFIER)) {
      p -= 2
      x = antes(p)
    }
    return x >= 0 && naFaixa(x, EXT_PICT)
  }
  const mesmaEscritaDeJuncao = (a, b) =>
    a >= 0 && b >= 0 && JUNCAO.some(([, faixas]) => naFaixa(a, faixas) && naFaixa(b, faixas))
  // Strict mode keeps only the joiner a word needs: ONE joiner with a LETTER of
  // the same joining script on each side. Persian writes everyday words with a
  // ZWNJ between two Arabic-script letters, so an agent file or a file name in
  // Persian failed on its own words (measured: the prose exemption covered them
  // and strict mode removed it). A mark, digit or punctuation beside the joiner,
  // or a second invisible, still fails there.
  const juncaoEstrita = (a, b) =>
    !ignoravel(a) &&
    !ignoravel(b) &&
    naFaixa(a, ALFABETICO) &&
    naFaixa(b, ALFABETICO) &&
    mesmaEscritaDeJuncao(a, b)

  for (let k = 0; k < n;) {
    const u = t.charCodeAt(k)
    if (u < 0xad || !naFaixa(u, PREFILTRO)) {
      k++
      continue
    }
    const inicio = k
    const c = t.codePointAt(inicio)
    const fim = inicio + (c > 0xffff ? 2 : 1)
    const solto = ehSurrogate(c)
    const dicp = naFaixa(c, IGNORAVEIS)
    const aviso = !dicp && !solto && (naFaixa(c, AVISOS) || naFaixa(c, NAO_CARACTERES))
    if (!dicp && !solto && !aviso) {
      k = fim
      continue
    }
    k = fim
    const ant = antes(inicio)
    const prox = depois(fim)
    const antD = ignoravel(ant)
    const proxD = ignoravel(prox)
    const r = (veredito, motivo) => achados.push({ indice: inicio, fim, cp: c, veredito, motivo })

    // A lone surrogate is not a character at all; UTF-16 and UTF-32 blobs and
    // format escapes can still deliver one.
    if (solto) {
      r('reprova', 'lone-surrogate')
      continue
    }
    // One invisible as the whole content of a quoted literal in code is data
    // about the character (a table entry, a strip of one code point). Measured
    // concession: 152 occurrences in 21 dependency files. Strict files never.
    // It comes before the U+FEFF rule, as rule 0 of the ported prototype did:
    // the byte order mark written as `'<U+FEFF>'` to strip it is that same data
    // (measured in phase 1: the 4 literals of that shape in rebar's secret
    // proofs warned with rule 0 first and failed without it), and offset 0 can
    // never meet this test, which needs a quote on both sides.
    if (
      dicp &&
      tipo === 'codigo' &&
      !antD &&
      !proxD &&
      ant === prox &&
      (ant === 0x22 || ant === 0x27 || ant === 0x60)
    ) {
      r('avisa', 'single-char-literal')
      continue
    }
    // The reader consumes exactly one BOM, so any U+FEFF left is either a second
    // BOM (measured: a default TextDecoder hides it) or a zero-width no-break
    // space in the middle of text. Never exempt outside a single-character
    // literal in code.
    if (c === 0xfeff) {
      r('reprova', conteudo && inicio === 0 ? 'second-bom' : 'zero-width-no-break-space')
      continue
    }
    if (aviso) {
      r(
        'avisa',
        c === 0x2800
          ? 'braille-blank'
          : c >= 0xfff9 && c <= 0xfffb
            ? 'interlinear-annotation'
            : naFaixa(c, NAO_CARACTERES)
              ? 'noncharacter'
              : 'private-use',
      )
      continue
    }
    if (ehTag(c)) {
      if (tagIsenta(inicio)) r('isento', 'emoji-tag-flag')
      else r('reprova', 'tag')
      continue
    }
    if (c >= 0xe0100 && c <= 0xe01ef) {
      // An ideographic variation sequence is a real glyph choice after a Han
      // character in prose; in code, agent files and names it is a carrier.
      if (!estrito && tipo !== 'codigo' && naFaixa(ant, HAN) && !proxD)
        r('avisa', 'ideographic-variation')
      else r('reprova', 'variation-selector')
      continue
    }
    if (c >= 0xe0000) {
      r('reprova', 'reserved-ignorable')
      continue
    }
    if (c === 0xfe0e || c === 0xfe0f) {
      // Exactly one selector, after a pictograph, or after # * 0-9
      // when the keycap mark follows. Of the 371 bases in
      // emoji-variation-sequences.txt 17.0 only those 12 are not pictographs, and
      // every RGI keycap carries U+20E3; a second selector in a row fails.
      if ((naFaixa(ant, EXT_PICT) && !antD) || (ehTecla(ant) && prox === 0x20e3))
        r('isento', 'emoji-presentation')
      else r('reprova', 'variation-selector')
      continue
    }
    if (c >= 0xfe00 && c <= 0xfe0d) {
      if (!estrito && tipo !== 'codigo' && !antD && !proxD && (ant === 0x30 || baseVisivel(ant)))
        r('avisa', 'standardized-variant')
      else r('reprova', 'variation-selector')
      continue
    }
    if (c >= 0x180b && c <= 0x180f) {
      if (!estrito && naFaixa(ant, MONGOL) && !antD && !proxD) r('isento', 'mongolian-variation')
      else r('reprova', 'mongolian-selector')
      continue
    }
    if (c === 0x200d) {
      if (fimDeEmoji(inicio) && naFaixa(prox, EXT_PICT)) r('isento', 'emoji-zwj')
      else if (!estrito && !antD && !proxD && mesmaEscritaDeJuncao(ant, prox))
        r('isento', 'script-joiner')
      else if (estrito && juncaoEstrita(ant, prox)) r('isento', 'script-joiner')
      else r('reprova', 'zero-width-joiner')
      continue
    }
    if (c === 0x200c) {
      if (estrito ? juncaoEstrita(ant, prox) : !antD && !proxD && mesmaEscritaDeJuncao(ant, prox))
        r('isento', 'script-joiner')
      else r('reprova', 'zero-width-non-joiner')
      continue
    }
    if (c === 0x200e || c === 0x200f || c === 0x061c) {
      // The implicit marks are ordinary punctuation in a right-to-left line: an
      // RLM keeps a number or a Latin word in place inside Arabic text. Strict
      // mode takes the same line context, and only a mark standing alone: next
      // to another invisible it is part of a run, which carries data.
      const L = estrito && (antD || proxD) ? null : linhaDe(inicio)
      if (L && L.rtl && tipo !== 'codigo') r('isento', 'bidi-mark-rtl')
      else if (L && L.rtl) r('avisa', 'bidi-mark-rtl-code')
      else r('reprova', 'bidi-mark')
      continue
    }
    if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) {
      // The Trojan Source controls. rustc denies all nine in any pairing; the
      // only concession is balanced ones in right-to-left prose.
      const L = tipo === 'prosa' ? linhaDe(inicio) : null
      if (L && L.rtl && L.balanceado) r('avisa', 'bidi-control-paired-rtl')
      else r('reprova', 'bidi-control')
      continue
    }
    if (c === 0x00ad) {
      if (!estrito && naFaixa(ant, ALFABETICO) && naFaixa(prox, ALFABETICO))
        r('avisa', 'soft-hyphen')
      else r('reprova', 'soft-hyphen-outside-word')
      continue
    }
    if (c === 0x034f) {
      if (!estrito && ant > 0x7f && naFaixa(ant, ALFABETICO) && !proxD)
        r('avisa', 'grapheme-joiner')
      else r('reprova', 'grapheme-joiner')
      continue
    }
    if (c === 0x17b4 || c === 0x17b5) {
      if (!estrito && naFaixa(ant, KHMER)) r('avisa', 'khmer-inherent-vowel')
      else r('reprova', 'khmer-inherent-vowel')
      continue
    }
    if (c === 0x115f || c === 0x1160) {
      if (!estrito && (naFaixa(ant, JAMO) || naFaixa(prox, JAMO))) r('avisa', 'jamo-filler')
      else r('reprova', 'hangul-filler')
      continue
    }
    if (c === 0x200b && !proxD) {
      // GitHub writes '@' U+200B <login> when it quotes release notes into a
      // Dependabot pull request, so nobody gets pinged, and a squash merge
      // keeps it in history for good. Measured on an honest repository: all
      // 145 U+200B in its history sat right after '@' and before a login
      // character, in 2 bot commits. One fixed-position code point per '@'
      // carries at most one bit, like the script-joiner exemption; a run, a
      // U+200B inside a word, and every file and name stay failures.
      if (tipo === 'commit' && ant === 0x40 && ehAlfanumericoAscii(prox)) {
        r('isento', 'mention-guard')
        continue
      }
      // Khmer writes no spaces between words and marks word boundaries with
      // U+200B. Measured in date-fns' km locale: 6 of 12 sit between two Khmer
      // code points, and 6 between an opening quote and a Khmer word, which is
      // only a warning. Agent files and names stay strict.
      if (!estrito && !antD && naFaixa(ant, KHMER) && naFaixa(prox, KHMER)) {
        r('isento', 'khmer-word-boundary')
        continue
      }
      if (!estrito && !antD && (naFaixa(ant, KHMER) || naFaixa(prox, KHMER))) {
        r('avisa', 'khmer-word-boundary-edge')
        continue
      }
    }
    if (c === 0x3164 || c === 0xffa0) {
      r('reprova', 'hangul-filler')
      continue
    }
    r(
      'reprova',
      c === 0x200b
        ? 'zero-width-space'
        : c >= 0x2060 && c <= 0x2064
          ? 'word-joiner-or-invisible-operator'
          : 'default-ignorable',
    )
  }
  return achados
}

/** How many UTF-16 units the escape at `e.indice` spans (see umEscape in formats.mjs). */
function comprimentoDoEscape(e) {
  const letra = e.forma.slice(e.forma.indexOf(':') + 1)
  if (letra === 'u') return e.cp > 0xffff ? 12 : 6
  if (letra === 'x') return 4
  if (letra === 'U') return 10
  return 2
}

/**
 * The text as the FORMAT decodes it: each escape replaced by its code point, the
 * rest untouched. Only escapes are decoded, so neighbours keep their context (an
 * emoji ZWJ sequence written as escapes by a Python dump stays exempt).
 * `origem` maps a view offset that came from an escape to [start, end) in
 * `texto`.
 */
function visaoDecodificada(texto, escapes) {
  const partes = []
  const origem = new Map()
  let posicaoNaFonte = 0
  let posicaoNaVisao = 0
  for (const e of [...escapes].sort((a, b) => a.indice - b.indice)) {
    if (e.indice < posicaoNaFonte) continue
    const tamanho = comprimentoDoEscape(e)
    partes.push(texto.slice(posicaoNaFonte, e.indice))
    posicaoNaVisao += e.indice - posicaoNaFonte
    const ch = String.fromCodePoint(e.cp)
    origem.set(posicaoNaVisao, [e.indice, e.indice + tamanho])
    partes.push(ch)
    posicaoNaVisao += ch.length
    posicaoNaFonte = e.indice + tamanho
  }
  partes.push(texto.slice(posicaoNaFonte))
  return { visao: partes.join(''), origem }
}

/**
 * The findings that came from an escape, in SOURCE offsets, with the motivo
 * prefixed `escaped-`. Findings over raw characters are left to the raw pass,
 * so nothing is counted twice.
 */
function achadosDeEscape(texto, formato, tipo) {
  const escapes = escapesDecodificados(texto, formato)
  if (escapes.length === 0) return []
  const { visao, origem } = visaoDecodificada(texto, escapes)
  const saida = []
  for (const a of classificar(visao, tipo)) {
    const fonte = origem.get(a.indice)
    if (!fonte) continue
    saida.push({ ...a, indice: fonte[0], fim: fonte[1], motivo: `escaped-${a.motivo}` })
  }
  return saida
}

/**
 * hidden-unicode. Returns a string (reprovou), `{ nota }` (passou with a hole
 * named), `{ na }`, or null; throws when nothing tracked could be read.
 */
export function checarHiddenUnicode(r) {
  const dir = r.dir
  const indice = lerIndice(dir)
  const commits = lerCommits(dir)
  if (indice.entradas.length === 0 && indice.gitlinks.length === 0 && commits.length === 0)
    return { na: 'git tracks no file and there is no commit' }

  // Real entries only: a link or a mounted virtual entry repeats a blob that
  // also has its own entry, and the reader already upgraded that real entry to
  // 'agente' when an agent path points at it.
  const reais = indice.entradas.filter((e) => e.viaSymlink === null)
  const regulares = reais.filter((e) => e.modo !== '120000')
  if (regulares.length > 0 && regulares.every((e) => e.estado === 'ausente')) {
    throw new Error(
      `none of the ${regulares.length} tracked blob(s) is in the object store, so nothing could be read`,
    )
  }

  const allowlist = lerAllowlist(dir)
  const falhas = []
  const avisos = []
  let pontosReprovados = 0
  let pontosAvisados = 0
  let isentadosPelaAllowlist = 0
  // Which allowlist key shapes could exempt a failure still standing, and
  // whether a failure no entry can exempt is among them: the remedy offers the
  // allowlist only where it works.
  // `codigo`: a failure stands in a code file, where the honest fix for a BOM a
  // program strips or writes is the escape spelled as source text, which passes.
  const remediaveis = { arquivo: false, commit: false, nenhum: false, codigo: false }

  /**
   * Groups a run of equal findings into one item and applies the allowlist.
   * `chave` is the allowlist key of the source, or null when nothing there can
   * be exempted. Tag code points outside the RGI flags are never exempt, nor are
   * the Trojan Source controls in an agent file or a name: those are the shapes
   * with no honest use there.
   */
  const registrar = (
    achados,
    { chave, local, estrito, dentroDaAllowlist = false, codigo = false },
  ) => {
    let grupo = null
    const fechar = () => {
      if (!grupo) return
      const { a, quantos } = grupo
      const item = `${local(a.indice)} ${rotulo(a.cp)} ${a.motivo}${quantos > 1 ? ` x${quantos}` : ''}`
      if (a.veredito === 'reprova') {
        falhas.push(item)
        pontosReprovados += quantos
        if (codigo) remediaveis.codigo = true
        if (grupo.inexemptavel || !chave) remediaveis.nenhum = true
        else if (chave.commit) remediaveis.commit = true
        else remediaveis.arquivo = true
      } else {
        avisos.push(item)
        pontosAvisados += quantos
      }
      grupo = null
    }
    for (const a of achados) {
      if (a.veredito === 'isento') continue
      const base = a.motivo.replace(/^escaped-/, '')
      const inexemptavel =
        dentroDaAllowlist || base === 'tag' || (base === 'bidi-control' && estrito)
      if (!inexemptavel && chave && allowlist.aceita(REGRA, chave)) {
        isentadosPelaAllowlist++
        continue
      }
      if (
        grupo &&
        grupo.fim === a.indice &&
        grupo.a.motivo === a.motivo &&
        grupo.a.veredito === a.veredito
      ) {
        grupo.quantos++
        grupo.fim = a.fim
        continue
      }
      fechar()
      grupo = { a, quantos: 1, fim: a.fim, inexemptavel }
    }
    fechar()
  }

  // 1. Names: every tracked path (gitlinks included) and every symlink target.
  for (const e of [...reais, ...indice.gitlinks]) {
    const noNome = classificar(e.caminho, 'nome')
    const chave = { arquivo: e.caminho, oid: e.oid }
    if (noNome.length) {
      registrar(noNome, {
        chave,
        estrito: true,
        dentroDaAllowlist: e.caminho === NOME_DA_ALLOWLIST,
        local: (i) => {
          const p = posicao(e.caminho, i)
          return `name ${onde(e.caminho, p.linha, p.coluna)}`
        },
      })
    }
    if (e.symlink && e.symlink.alvo) {
      const noAlvo = classificar(e.symlink.alvo, 'nome')
      if (noAlvo.length) {
        registrar(noAlvo, {
          chave,
          estrito: true,
          dentroDaAllowlist: e.caminho === NOME_DA_ALLOWLIST,
          local: (i) =>
            `symlink ${escaparSaida(e.caminho)} target 1:${posicao(e.symlink.alvo, i).coluna}`,
        })
      }
    }
  }

  // 2. Content: raw, then what the format's own escapes decode to. The format
  // comes from every path a client can open the bytes by: a link at `.mcp.json`
  // is parsed as JSON whatever its target is named.
  const formatos = formatosDeEscape(indice)
  const truncados = []
  const ausentes = []
  for (const e of regulares) {
    if (e.estado === 'truncado' && e.tipo !== 'agente') truncados.push(e.caminho)
    if (e.estado === 'ausente' && e.tipo !== 'agente') ausentes.push(e.caminho)
    if (e.texto === null) continue
    const texto = e.texto
    const comum = {
      chave: { arquivo: e.caminho, oid: e.oid },
      estrito: e.tipo === 'agente',
      dentroDaAllowlist: e.caminho === NOME_DA_ALLOWLIST,
      codigo: e.tipo === 'codigo',
      local: (i) => {
        const p = posicao(texto, i)
        return onde(e.caminho, p.linha, p.coluna)
      },
    }
    const crus = classificar(texto, e.tipo, { conteudo: true })
    if (crus.length) registrar(crus, comum)

    // One escape can decode under two dialects (a JSON unicode escape is also a
    // YAML one): it is reported once, under the first path that reads it.
    const vistos = new Set()
    for (const [formato, porOnde] of formatos.get(e) || []) {
      let escapados
      if (formato === 'frontmatter') {
        if (!texto.startsWith('---')) continue
        const fm = lerFrontmatter(texto)
        if (!fm.presente) continue
        escapados = achadosDeEscape(fm.yaml, 'yaml', e.tipo).map((a) => ({
          ...a,
          indice: a.indice + fm.indice,
          fim: a.fim + fm.indice,
        }))
      } else {
        escapados = achadosDeEscape(texto, formato, e.tipo)
      }
      escapados = escapados.filter((a) => {
        const chave = `${a.indice} ${a.cp}`
        if (vistos.has(chave)) return false
        vistos.add(chave)
        return true
      })
      if (!escapados.length) continue
      registrar(
        escapados,
        porOnde === e.caminho
          ? comum
          : { ...comum, local: (i) => `${comum.local(i)} read as ${escaparSaida(porOnde)}` },
      )
    }
  }

  // 3. Commit messages, keyed by commit id in the allowlist.
  for (const commit of commits) {
    // One leading BOM is consumed, as the reader consumes it for a blob: Windows
    // PowerShell 5.1 writes one with `Out-File -Encoding utf8`, `git commit -F`
    // keeps it, and at offset 0 it carries nothing. A second one right after it
    // is still a second-bom.
    const bom = commit.mensagem.charCodeAt(0) === 0xfeff ? 1 : 0
    const achados = classificar(commit.mensagem.slice(bom), 'commit', { conteudo: bom === 1 }).map(
      (a) => ({ ...a, indice: a.indice + bom, fim: a.fim + bom }),
    )
    if (achados.length === 0) continue
    registrar(achados, {
      chave: { commit: commit.id },
      estrito: false,
      local: (i) => {
        const p = posicao(commit.mensagem, i)
        return `commit ${commit.id.slice(0, 12)}:${p.linha}:${p.coluna}`
      },
    })
  }

  // 4. What an agent loads and this rule cannot read the way the agent does
  // (an LFS pointer, a filter, -diff, a NUL, invalid UTF-8, a truncated blob, a
  // link out of the repository, a case collision): the verdict would be about
  // other bytes, so it fails, and no allowlist entry changes that. A mounted
  // entry repeats the bytes of its real one, so it adds only the problems of its
  // own path: a link out of the repository behind a linked folder is one.
  const ilegiveis = []
  for (const e of indice.entradas) {
    const motivos = problemasDeLeitura(e, indice).filter(
      (m) => e.viaSymlink === null || PROBLEMAS_DO_CAMINHO.includes(m),
    )
    if (motivos.length)
      ilegiveis.push(`${escaparSaida(e.caminho)} unreadable-agent-file (${motivos.join(', ')})`)
  }

  // 5. A malformed allowlist line fails every injection rule.
  const errosDaAllowlist = allowlist.erros.map(
    (x) =>
      `${NOME_DA_ALLOWLIST}:${x.linha}:${x.coluna} malformed allowlist line: ${escaparSaida(x.mensagem, { limite: 120 })}`,
  )

  const notas = []
  if (avisos.length) notas.push(`${pontosAvisados} code point(s) to review: ${resumir(avisos)}`)
  if (indice.gitlinks.length) {
    const nomes = indice.gitlinks.map((g) => escaparSaida(g.caminho))
    notas.push(`${nomes.length} submodule(s) not scanned: ${resumir(nomes, 3)}`)
  }
  if (truncados.length) {
    const nomes = truncados.map((c) => escaparSaida(c))
    notas.push(`${nomes.length} blob(s) over 8 MiB scanned only in part: ${resumir(nomes, 3)}`)
  }
  if (ausentes.length) {
    const nomes = ausentes.map((c) => escaparSaida(c))
    notas.push(
      `${nomes.length} blob(s) missing from the object store, not scanned: ${resumir(nomes, 3)}`,
    )
  }
  const obsoletas = allowlist.obsoletas(REGRA)
  if (obsoletas)
    notas.push(
      `${obsoletas} ${NOME_DA_ALLOWLIST} entr${obsoletas === 1 ? 'y' : 'ies'} for ${REGRA} ${obsoletas === 1 ? 'exempts' : 'exempt'} nothing`,
    )
  if (allowlist.naoRastreada)
    notas.push(`${NOME_DA_ALLOWLIST} exists on disk but is not tracked, so it exempts nothing`)
  // Only when the file is tracked, in use, and nobody owns it.
  if (allowlist.rastreada && isentadosPelaAllowlist > 0 && !allowlist.cobertaPorCodeowners) {
    notas.push(
      `${NOME_DA_ALLOWLIST} exempts ${isentadosPelaAllowlist} finding(s) and no CODEOWNERS entry covers it`,
    )
  }

  if (falhas.length || ilegiveis.length || errosDaAllowlist.length) {
    const partes = []
    if (pontosReprovados) partes.push(`${pontosReprovados} hidden code point(s)`)
    if (ilegiveis.length)
      partes.push(`${ilegiveis.length} agent file(s) not readable as the agent reads them`)
    if (errosDaAllowlist.length)
      partes.push(`${errosDaAllowlist.length} malformed allowlist line(s)`)
    const itens = [...falhas, ...ilegiveis, ...errosDaAllowlist]
    const tambem = pontosAvisados ? ` · also ${pontosAvisados} code point(s) to review` : ''
    // A commit is usually published by the time CI reads it, and a generated or
    // vendored bundle is not edited by hand: for those the allowlist is the fix
    // (README, the allowlist section), so the message says so where it applies.
    // In code the character often does a job (a regex or a literal that strips
    // or writes a BOM), and "remove it" breaks that code: the escape written as
    // source text keeps the job and passes (measured on a BOM at the start of a
    // regex, and in a Python string), the wording control-bytes already uses.
    const remedios = []
    if (remediaveis.codigo) remedios.push('in code write it as an escape sequence in source text')
    if (remediaveis.arquivo) {
      remedios.push(
        `for a generated or vendored file add {regra, motivo, arquivo, oid} to ${NOME_DA_ALLOWLIST}`,
      )
    }
    if (remediaveis.commit) {
      remedios.push(
        `for a commit already published add {regra, motivo, commit} to ${NOME_DA_ALLOWLIST}`,
      )
    }
    let remedio = ''
    if (remedios.length) {
      remedio =
        ` — remove it, or ${remedios.join('; ')}` +
        (remediaveis.nenhum
          ? '; tags outside an emoji flag, bidi controls in agent files or names, and findings ' +
            'inside the allowlist itself cannot be exempted'
          : '')
    }
    return `${partes.join(' and ')}: ${resumir(itens)}${tambem}${remedio}`
  }
  if (notas.length) return { nota: notas.join(' · ') }
  return null
}
