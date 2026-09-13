// texto-seguro — the one place that decides which code points are unsafe to PRINT.
//
// WHY IT EXISTS. A ruler's output is read by people in a terminal and, through
// the MCP server, by agents. Both surfaces take what the target repository
// wrote: a file name, a commit message, a stderr line. Measured before this file
// existed, a commit trailer carrying U+200B, U+E0041 and U+001B reached the MCP
// `content[].text` raw through the `ai-coauthorship` motivo. So the sanitizing
// happens at the OUTPUT, whatever the rules end up wording.
//
// WHY A NUMERIC TABLE AND NOT A REGEX. Three constraints decide it.
//   - `\p{Default_Ignorable_Code_Point}` resolves against the ICU of the running
//     Node, and CI runs Node 22 while local runs Node 24. A verdict that depends
//     on the runtime can pass here and fail there on the same bytes. A literal
//     table freezes the answer; the proof asserts it still equals `\p{}`.
//   - An escaped control spelled in the source is exactly what the escaped-form
//     heuristics look for, and this file is copied into `mcp/src`, next to
//     server code. Hex numbers are opaque to every one of those checks.
//   - It has no imports and no top-level I/O, so every mirror the gate builds
//     (it copies `tooling/security` whole) and the MCP copy resolve it alone.
//
// Every table is a list of INCLUSIVE `[first, last]` ranges, sorted and
// disjoint, which is what `naFaixa` needs for its binary search.
//
// The printed form is `<U+XXXX>` (uppercase hex, at least 4 digits) and not a JS
// escape: an agent that pastes a reported path into code would turn a JS escape
// back into the raw character, and `<U+XXXX>` is decoded by no parser.

/**
 * Default_Ignorable_Code_Point, UCD 17.0.0 — DerivedCoreProperties-17.0.0.txt
 * (2025-07-30), sha256 24c7fed1195c482faaefd5c1e7eb821c5ee1fb6de07ecdbaa64b56a99da22c08.
 * The 27 data lines of that file merge into these 17 ranges, 4174 code points.
 * The set has not changed since Unicode 14.0, so Node 22 and Node 24 agree.
 *
 * These are the code points a renderer is allowed to draw as nothing: zero-width
 * spaces and joiners, the bidi overrides behind Trojan Source, fillers that make
 * an identifier look empty, variation selectors and the tag block that can carry
 * a whole ASCII sentence nobody sees.
 */
export const IGNORAVEIS = [
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f], // combining grapheme joiner
  [0x061c, 0x061c], // arabic letter mark
  [0x115f, 0x1160], // hangul choseong and jungseong fillers
  [0x17b4, 0x17b5], // khmer inherent vowels
  [0x180b, 0x180f], // mongolian free variation selectors and vowel separator
  [0x200b, 0x200f], // zero width space, joiners, directional marks
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x206f], // word joiner, invisible operators, bidi isolates
  [0x3164, 0x3164], // hangul filler
  [0xfe00, 0xfe0f], // variation selectors 1-16
  [0xfeff, 0xfeff], // zero width no-break space (BOM)
  [0xffa0, 0xffa0], // halfwidth hangul filler
  [0xfff0, 0xfff8], // reserved
  [0x1bca0, 0x1bca3], // shorthand format controls
  [0x1d173, 0x1d17a], // musical symbol format controls
  [0xe0000, 0xe0fff], // tags and variation selectors 17-256
]

/**
 * C0, DEL and C1. TAB, LF and CR are INCLUDED: a printed value is one field on
 * one line, and a line break inside a motivo is how a forged `✓` or `⚠` line
 * gets into a scoreboard the gate parses line by line.
 */
export const CONTROLES = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
]

/**
 * Not ignorable and not controls, but still unsafe to print raw: the two
 * separators JavaScript treats as line terminators, lone surrogates (a string
 * iterated by code point yields them as one unit each), the three private use
 * areas, whose glyphs are whatever a font decides, and the interlinear
 * annotation controls, which hide text between their anchors.
 */
export const ESCAPAR_TAMBEM = [
  [0x2028, 0x2029], // line and paragraph separators
  [0xd800, 0xdfff], // surrogates, only ever lone here
  [0xe000, 0xf8ff], // private use area
  [0xfff9, 0xfffb], // interlinear annotation anchor, separator, terminator
  [0xf0000, 0xffffd], // supplementary private use area A
  [0x100000, 0x10fffd], // supplementary private use area B
]

/** Binary search over sorted, disjoint, inclusive `[first, last]` ranges. */
export function naFaixa(cp, faixas) {
  let baixo = 0
  let alto = faixas.length - 1
  while (baixo <= alto) {
    const meio = (baixo + alto) >> 1
    const [inicio, fim] = faixas[meio]
    if (cp < inicio) alto = meio - 1
    else if (cp > fim) baixo = meio + 1
    else return true
  }
  return false
}

const escapar = (cp) =>
  cp >= 0x20 && cp < 0x7f
    ? false
    : naFaixa(cp, CONTROLES) || naFaixa(cp, IGNORAVEIS) || naFaixa(cp, ESCAPAR_TAMBEM)

const rotulo = (cp) => `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`

/**
 * The display form of any string that came from outside this process: a repository
 * path, a motivo built from file content, a stderr excerpt.
 *
 * Every unsafe code point becomes `<U+XXXX>`. Then the result is cut at `limite`
 * code points and `…(+N)` names how many were left out. The cut never splits a
 * `<U+XXXX>` in half: a partial label would read as a different code point, so
 * it goes out whole or not at all, and N counts it.
 */
export function escaparSaida(texto, { limite = 200 } = {}) {
  const pedacos = []
  for (const ch of String(texto)) {
    const cp = ch.codePointAt(0)
    pedacos.push(escapar(cp) ? rotulo(cp) : ch)
  }
  let usados = 0
  let saida = ''
  let i = 0
  for (; i < pedacos.length; i++) {
    // A label is ASCII, so its length in code units is its length in code
    // points; a kept character may be a surrogate pair and counts as one.
    const tamanho = pedacos[i].length > 2 ? pedacos[i].length : 1
    if (usados + tamanho > limite) break
    usados += tamanho
    saida += pedacos[i]
  }
  if (i === pedacos.length) return saida
  let resto = 0
  for (; i < pedacos.length; i++) resto += pedacos[i].length > 2 ? pedacos[i].length : 1
  return `${saida}…(+${resto})`
}
