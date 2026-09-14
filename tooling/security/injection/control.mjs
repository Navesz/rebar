// control — terminal control characters in tracked text, and escaped ones in
// the source of MCP servers.
//
// Two rules live here, and they are two because one of them can be decided
// from the bytes and the other cannot.
//
// control-bytes (determinística). A C0 or C1 control in a tracked text file
// acts on the terminal that prints it: an SGR sequence recolours or conceals
// what follows, a backspace or a bare carriage return overwrites what came
// before, and `git diff` goes through `less -R` (git sets LESS=FRX), which
// passes colour sequences through raw. A reviewer reading the diff sees less
// than a model reading the blob. Measured before this rule existed
// (a phase-1 prototype, not tracked): across the 744 files tracked by rebar, rebar-site
// and bookkeep the only raw control was rebar's own colour helper, 2 bytes on
// one line, fixed with the escape spelled as text. In rebar-site/node_modules,
// 1 of 10,875 non-code text files and 21 of 26,321 code files carry one, and 20
// of those 21 are generated bundles or code-page tables: the expected
// allowlist users.
//
// Two character sets, because code has measured legitimate sentinels (a YAML
// plugin's U+0002, U+0018 and U+001F, a PNG magic's U+001A) and prose has none:
//   - prose, config, data and agent files: every C0 except TAB and LF, a CR
//     not followed by LF, DEL, and every C1;
//   - code files: only the characters that hide or rewrite text or make a
//     file look binary (NUL, BS, ESC and the C1 introducers), plus a bare CR
//     when the same file also ends lines with LF.
// A file whose line endings are ALL bare CR is legacy, not an overwrite trick,
// and nobody measured how common it is, so in code it is a nota.
//
// Two shapes pass in prose and data files (never in agent files, code, names,
// commit messages or the allowlist), each because it hides nothing:
//   - a form feed alone on its line. xterm treats FF the same as LF, and less
//     shows a control it does not pass as ^L; the GNU Coding Standards (5.1)
//     put every page break alone on its line and PEP 8 allows them. Measured:
//     90 of the 101 FF in 16 files of Git for Windows' share and Python 3.12's
//     Lib sit alone on their line (COPYING.LIB, a man page, a Perl module); the
//     other 11 are in PDFs, an ONNX model and a TOML file invalid on purpose.
//     Main failed a GNU COPYING, Emacs Lisp files and the real LGPL COPYING.LIB.
//   - a colour sequence whose every parameter keeps text visible (SGR_VISIVEL):
//     the snapshot and golden files of CLI tests carry the red, green, bold and
//     dim a program printed. What stays out is what hides text on some
//     terminal: SGR 8 is "Invisible" in xterm's ctlseqs, and less -R (git's
//     pager, LESS=FRX) passes SGR raw, so black (30), white (37), grey (90) and
//     bright white (97) fail, because a theme can paint text in its background
//     colour (Solarized Dark's base03 is bright black, Solarized Light's base3
//     bright white), as do every background colour and 256 or true colour.
//     Cursor movement, erase and OSC 8 links fail too. The exemption reads the
//     CONTENT, never the path: a __snapshots__/ or testdata/ exemption would be
//     a place to hide an instruction an agent reads when a test fails.
//
// Raw bytes are not how the attack reaches JSON, YAML or TOML: JSON.parse and
// js-yaml refuse a raw ESC. What gets through is the format's OWN escape, which
// the parser turns back into the control. So every tracked .json/.jsonc/.json5/
// .yml/.yaml/.toml, and every Markdown frontmatter, is read a second time
// through escapesDecodificados (formats.mjs), the one decoder hidden-unicode
// shares. Measured 0 such escapes in 60,598 dependency files once a JSON NUL
// escape (iconv-lite code-page tables) is left out, which the decoder does.
//
// mcp-ansi-escape (heurística, N1). Trail of Bits showed ANSI sequences in MCP
// tool descriptions hidden from the user of a coding agent, written in the
// server source as escapes. Where a description string begins and ends cannot
// be found without running the code: rebar's own servers build descriptions by
// concatenation, array joins, template interpolation and schema helpers. So
// this rule works per file: a server file (by marker, or launched by a tracked
// MCP config) whose code, comments stripped, spells an escaped ESC or CSI.
// Measured: 2 of 48 unique server files in node_modules have a legitimate hit
// (a coloured console line in an SDK example), which is why it is a heuristic.
//
// What neither rule does: honor .rebarignore, proof roots, template roots or
// .gitattributes (a PR can edit all of them), or print file content. A finding
// is a position and a `<U+XXXX>` label, or a position and an explanation.
//
// Every vocabulary item a table looks for is ASSEMBLED by concatenation, and no
// comment here spells one: this file is tracked code, and prove-control.mjs
// asserts that neither table matches it.

import { posix } from 'node:path'

import { semComentario } from '../../rebar-check/index.mjs'
import { escaparSaida } from '../texto-seguro.mjs'
import { escapesDecodificados, lerFrontmatter } from './formats.mjs'
import { arquivosReferenciados } from './mcp-launch.mjs'
import {
  CODIGO,
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
  sugerirEntrada,
} from './reader.mjs'

/** "Not applicable": the class leaves the denominator (invariant I4). */
const na = (motivo) => ({ na: motivo })

const rotulo = (cp) => `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

// ═══════════════════════════════════════════════════════════════ the tables
//
// [RegExp, explicacao]. The explanation says what the match MEANS and never
// repeats the text it matched: the explanation is printed, and a table whose
// explanations spelled the literal would accuse its own output.

/** One literal backslash, as regex source. */
const BARRA = '\\\\'

/**
 * What makes a code file a candidate for mcp-ansi-escape: the calls, classes
 * and imports of the TypeScript and Python MCP server SDKs. Measured over the
 * tracked trees of rebar, rebar-site and bookkeep, the refined marker set of
 * the phase-1 measurement matched exactly the three server files, and 97 files
 * in node_modules.
 *
 * The class names carry one letter as a one-letter class (`[S]`, `[M]`): same
 * matches, but mcp/generate.mjs indexes the word runs of each pattern source
 * into mcp/rules.generated.json, and a whole class name there, as a quoted JSON
 * word, is exactly what the row matches. prove-table.mjs holds every table
 * against the artifact read whole, and it measured these three rows matching it
 * before the split, the same fix bypass.mjs uses for binary names.
 */
export const MARCADORES_DE_SERVIDOR = [
  [new RegExp('\\b' + 'register' + 'Tool\\s*\\('), 'registers a tool on an SDK server'],
  [new RegExp('[\'"`]' + 'tools' + '\\/list[\'"`]'), 'answers the tool listing method'],
  [new RegExp('\\b' + 'Mcp' + '[S]erver\\b'), 'the server class of the TypeScript SDK'],
  [new RegExp('\\b' + 'Stdio' + '[S]erverTransport\\b'), 'the stdio transport of an SDK server'],
  [new RegExp('\\b' + 'Fast' + '[M]CP\\b'), 'the Python server framework'],
  [new RegExp('@model' + 'contextprotocol\\/sdk\\b'), 'imports the TypeScript SDK'],
  [
    new RegExp('\\b(?:from|import)\\s+' + 'mcp' + '\\.server\\b'),
    'imports the Python server package',
  ],
]

/**
 * Escaped spellings of ESC (U+001B) and of the one-byte CSI (U+009B) that a JS,
 * TS, Python or shell string decodes back into the control, plus the two HTML
 * entities and the calls that build either from its number. The octal form is
 * a syntax error in ES modules and template literals, so it only bites in
 * sloppy CommonJS, Python and shell, which is where it is looked for anyway.
 */
export const ESCAPES_DE_CONTROLE = [
  [new RegExp(BARRA + 'x' + '1[bB]'), 'hex escape of ESC'],
  [new RegExp(BARRA + '(?:u' + '001[bB]|U' + '0000001[bB])'), 'unicode escape of ESC'],
  [new RegExp(BARRA + 'u' + '\\{0*1[bB]\\}'), 'code point escape of ESC'],
  [new RegExp(BARRA + 'x' + '9[bB]'), 'hex escape of the one-byte CSI'],
  [new RegExp(BARRA + '(?:u' + '009[bB]|U' + '0000009[bB])'), 'unicode escape of the one-byte CSI'],
  [new RegExp(BARRA + 'u' + '\\{0*9[bB]\\}'), 'code point escape of the one-byte CSI'],
  [new RegExp(BARRA + '(?:0' + '33|3' + '3(?![0-7]))'), 'octal escape of ESC'],
  [new RegExp(BARRA + 'e' + '\\['), 'ESC escape opening a control sequence'],
  [new RegExp('&#' + '0*27;'), 'decimal HTML entity of ESC'],
  [new RegExp('&#' + '[xX]0*1[bB];'), 'hex HTML entity of ESC'],
  [
    new RegExp(
      '\\b' +
        'from' +
        '(?:Char' +
        'Code|Code' +
        'Point)\\s*\\(\\s*(?:27|0x1[bB]|0o33|155|0x9[bB]|0o233)\\s*[,)]',
    ),
    'ESC or CSI built from its number',
  ],
  [
    new RegExp('\\b' + 'chr' + '\\s*\\(\\s*(?:27|0x1[bB]|0o33|155|0x9[bB])\\s*\\)'),
    'ESC or CSI built from its number',
  ],
]

// ═══════════════════════════════════════════════════════════ control-bytes

// Lookup tables over U+0000-U+009F, built from numbers: a character class
// spelling these code points would be the very thing the escape tables catch.
const LIMITE_DE_CONTROLE = 0xa0
const FALHA_EM_TEXTO = new Uint8Array(LIMITE_DE_CONTROLE)
for (let c = 0x00; c < 0x20; c++) FALHA_EM_TEXTO[c] = 1
for (let c = 0x7f; c < LIMITE_DE_CONTROLE; c++) FALHA_EM_TEXTO[c] = 1
// TAB and LF are ordinary text; CR is decided by what follows it.
FALHA_EM_TEXTO[0x09] = 0
FALHA_EM_TEXTO[0x0a] = 0
FALHA_EM_TEXTO[0x0d] = 0

/**
 * NUL, BS, ESC, and the C1 controls that open a string or a sequence: RI, DCS,
 * SOS, CSI, OSC, PM and APC. Everything else in C0 and C1 hides nothing in
 * code, and U+0002, U+0018, U+001A and U+001F were measured as sentinels in
 * honest source.
 */
const FALHA_EM_CODIGO = new Uint8Array(LIMITE_DE_CONTROLE)
for (const c of [0x00, 0x08, 0x1b, 0x8d, 0x90, 0x98, 0x9b, 0x9d, 0x9e, 0x9f]) FALHA_EM_CODIGO[c] = 1

/**
 * BEL, VT and FF: a bell, a vertical tab and a form feed. A terminal rings or
 * moves the cursor down, and none of them can overwrite, recolour or hide text
 * that was printed. In a commit message they are almost always an accident of
 * PowerShell, where a backtick is the escape character inside a double-quoted
 * string: `-m "use `actions/checkout`"` stores BEL where the code span began
 * (measured in a real history: three BEL, exactly where Markdown code spans
 * opened). A published commit cannot be reworded, so in a MESSAGE these three
 * are a nota; NUL, BS, ESC, a lone CR, DEL and C1 still fail there.
 */
const SO_AVISO_NA_MENSAGEM = new Set([0x07, 0x0b, 0x0c])

/**
 * The C1 controls a UTF-8 letter decoded twice leaves behind: U+00C3 U+0087 is
 * the second read of the two bytes of a c-cedilla. They keep the finding (the
 * byte is a control either way) and change only the remedy. Left out are RI
 * (U+008D, which moves the cursor up so later text overwrites), DCS, SOS, CSI,
 * OSC, PM and APC: the introducers FALHA_EM_CODIGO lists, which open a sequence
 * whatever letter came before them, so they keep saying that they hide text.
 */
const SO_MOJIBAKE = new Uint8Array(LIMITE_DE_CONTROLE)
for (let c = 0x80; c < LIMITE_DE_CONTROLE; c++) SO_MOJIBAKE[c] = FALHA_EM_CODIGO[c] ? 0 : 1

/**
 * The SGR parameters that leave text visible on the themes named in the header: reset,
 * bold, dim, italic, underline, reverse, strike, their resets, the six colours
 * from red to cyan and their bright forms, and the default foreground. See the
 * header for why 8, 30, 37, 90, 97, backgrounds and extended colour are out.
 */
const SGR_VISIVEL = new Set([
  0, 1, 2, 3, 4, 7, 9, 21, 22, 23, 24, 27, 29, 31, 32, 33, 34, 35, 36, 39, 91, 92, 93, 94, 95, 96,
])
/** The longest parameter string a visible colour sequence may carry. */
const LIMITE_DE_PARAMETROS = 40

/**
 * The length of the colour sequence that starts with the ESC at `k` when every
 * parameter is in SGR_VISIVEL, else 0. Only digits and semicolons may sit
 * between the bracket and the final letter (an empty parameter is 0): a colon
 * sub-parameter, a private marker or any other byte is judged as a plain ESC.
 */
function sgrVisivel(texto, k) {
  if (texto.charCodeAt(k + 1) !== 0x5b) return 0
  const parametros = []
  let numero = ''
  const fim = Math.min(texto.length, k + 2 + LIMITE_DE_PARAMETROS + 1)
  for (let j = k + 2; j < fim; j++) {
    const c = texto.charCodeAt(j)
    if (c >= 0x30 && c <= 0x39) numero += String.fromCharCode(c)
    else if (c === 0x3b) {
      parametros.push(numero === '' ? 0 : Number(numero))
      numero = ''
    } else if (c === 0x6d) {
      parametros.push(numero === '' ? 0 : Number(numero))
      return parametros.every((p) => SGR_VISIVEL.has(p)) ? j - k + 1 : 0
    } else return 0
  }
  return 0
}

/** A decoded format escape fails when it yields C0 other than TAB/LF, DEL or C1. */
const escapeFalha = (cp) => (cp < 0x20 && cp !== 0x09 && cp !== 0x0a) || (cp >= 0x7f && cp <= 0x9f)

/**
 * A path or a link target: every C0, DEL and C1, TAB and LF included. A name is
 * one field on one line, and a line break inside it is how a forged line gets
 * into output read line by line. Measured 0 such names in the three repos.
 */
const falhaEmNome = (cp) => cp < 0x20 || (cp >= 0x7f && cp < LIMITE_DE_CONTROLE)

/**
 * Source code by extension, whatever class the reader gave the path: a server
 * under an agent folder (`.rebar/mcp.mjs`) is still a server.
 */
const ehFonte = (e) => e.tipo === 'codigo' || CODIGO.has(posix.extname(e.caminho).toLowerCase())

/** Link and virtual entries repeat content that has its own real entry. */
const espelho = (e) => e.symlink !== null || e.viaSymlink !== null

/** The real regular entry whose content a link or virtual entry shows, or `e` itself. */
function realDe(e, indice) {
  if (e.symlink) {
    const alvo = e.symlink.resolvido === null ? null : indice.porCaminho.get(e.symlink.resolvido)
    return alvo && !espelho(alvo) ? alvo : e
  }
  if (e.viaSymlink !== null) {
    const link = indice.porCaminho.get(e.viaSymlink)
    if (!link || !link.symlink || link.symlink.resolvido === null) return e
    const resto = e.caminho.slice(e.viaSymlink.length + 1)
    const alvo = indice.porCaminho.get(
      link.symlink.resolvido ? `${link.symlink.resolvido}/${resto}` : resto,
    )
    return alvo && !espelho(alvo) ? alvo : e
  }
  return e
}

/**
 * Raw controls of one decoded text. Returns the failing positions and whether
 * the file is a CR-only code file. Iterates UTF-16 units: every code point
 * judged here is below U+00A0, so a surrogate is never one of them.
 * `quebraDePagina`: a form feed alone on its line is no finding. `corVisivel`:
 * a colour sequence of visible parameters is no finding. Both for prose and
 * data files only (see the header).
 */
function varrerBrutos(texto, codigo, { quebraDePagina = false, corVisivel = false } = {}) {
  const tabela = codigo ? FALHA_EM_CODIGO : FALHA_EM_TEXTO
  const achados = []
  const crSoltos = []
  let temLf = false
  for (let k = 0; k < texto.length; k++) {
    const u = texto.charCodeAt(k)
    if (u >= LIMITE_DE_CONTROLE || (u >= 0x20 && u < 0x7f)) continue
    if (u === 0x1b && corVisivel) {
      const tamanho = sgrVisivel(texto, k)
      if (tamanho) {
        k += tamanho - 1
        continue
      }
    }
    if (
      u === 0x0c &&
      quebraDePagina &&
      (k === 0 || texto.charCodeAt(k - 1) === 0x0a) &&
      (k + 1 === texto.length ||
        texto.charCodeAt(k + 1) === 0x0a ||
        (texto.charCodeAt(k + 1) === 0x0d && texto.charCodeAt(k + 2) === 0x0a))
    ) {
      continue
    }
    if (u === 0x0a) temLf = true
    else if (u === 0x0d) {
      if (texto.charCodeAt(k + 1) !== 0x0a) crSoltos.push(k)
    } else if (tabela[u]) achados.push({ indice: k, cp: u, forma: null })
  }
  let soCr = false
  if (crSoltos.length) {
    // In code a bare CR fails only next to LF endings; alone, it
    // is a legacy line ending and becomes a nota.
    if (codigo && !temLf) soCr = true
    else for (const k of crSoltos) achados.push({ indice: k, cp: 0x0d, forma: 'cr' })
  }
  return { achados, soCr }
}

/**
 * Format escapes of one entry that decode to a failing control, in file
 * coordinates, read with one dialect: 'json', 'json5', 'yaml', 'toml' or
 * 'frontmatter'. The caller picks the dialects from every path a client opens
 * the bytes by (formatosDeEscape), so a link at `.mcp.json` to `m.txt` is still
 * decoded as JSON.
 */
function varrerEscapes(e, formato) {
  if (formato === 'frontmatter') {
    const fm = lerFrontmatter(e.texto)
    if (!fm.presente) return []
    return escapesDecodificados(fm.yaml, 'yaml')
      .filter((x) => escapeFalha(x.cp))
      .map((x) => ({ ...x, indice: x.indice + fm.indice }))
  }
  return escapesDecodificados(e.texto, formato).filter((x) => escapeFalha(x.cp))
}

/** Control code points of a name-like string, as `<U+XXXX>` labels. */
function controlesDoNome(texto) {
  const vistos = new Set()
  for (const ch of texto) {
    const cp = ch.codePointAt(0)
    if (falhaEmNome(cp)) vistos.add(cp)
  }
  return [...vistos].map(rotulo)
}

/** The allowlist parts every injection rule reports the same way. */
function notasDaAllowlist(allowlist, regra, usouAlguma) {
  const notas = []
  const obsoletas = allowlist.obsoletas(regra)
  if (obsoletas) {
    notas.push(
      `${plural(obsoletas, 'allowlist entry', 'allowlist entries')} for ${regra} ` +
        `${obsoletas === 1 ? 'matches' : 'match'} nothing ` +
        'tracked today and can be removed',
    )
  }
  if (allowlist.naoRastreada) {
    notas.push(
      `${NOME_DA_ALLOWLIST} exists on disk but git does not track it, so it exempts nothing`,
    )
  }
  // Only when the file is tracked, in use, and nobody owns it.
  if (allowlist.rastreada && usouAlguma && !allowlist.cobertaPorCodeowners) {
    notas.push(
      `no CODEOWNERS entry owns ${NOME_DA_ALLOWLIST}, so any pull request can widen what it exempts`,
    )
  }
  return notas
}

function errosDaAllowlist(allowlist) {
  return allowlist.erros.map(
    (x) => `${NOME_DA_ALLOWLIST}:${x.linha}:${x.coluna} ${escaparSaida(x.mensagem)}`,
  )
}

/**
 * control-bytes over the index of `r.dir`.
 *
 * Returns the reprova string, `{ nota }` when what was read is clean but part
 * of it was not read whole or an allowlist entry is stale, `null`, or `na` when
 * git tracks no text and there is no commit.
 */
export function checarControlBytes(r) {
  const indice = lerIndice(r.dir)
  if (indice.semGit) return na('no tracked text file')
  const commits = lerCommits(r.dir)
  const allowlist = lerAllowlist(r.dir)
  const formatos = formatosDeEscape(indice)

  const itens = []
  let caracteres = 0
  // Whether a finding the allowlist could exempt is among the failures: a file
  // other than the allowlist itself, or a commit message.
  let arquivoIsentavel = false
  let commitIsentavel = false
  const problemas = []
  const nomes = []
  const notas = { truncados: [], invalidos: [], soCr: [], ausentes: [], mensagens: [] }
  // What the file findings are: 'pagina' (a bell, vertical tab or form feed),
  // 'mojibake' (a C1 control right after a UTF-8 lead byte read as Latin-1), or
  // 'esconde'. The remedy says a control hides text only when one of them can.
  const classes = new Set()
  let usouAlguma = false
  let lidos = 0
  let reaisComBlob = 0
  let reaisAusentes = 0

  for (const e of indice.entradas) {
    // Names first: a path and a link target are text a terminal prints too.
    const doNome = controlesDoNome(e.caminho)
    if (doNome.length && e.viaSymlink === null)
      nomes.push(`name ${escaparSaida(e.caminho)} ${doNome.join(' ')}`)
    if (e.symlink && e.symlink.alvo) {
      const doAlvo = controlesDoNome(e.symlink.alvo)
      if (doAlvo.length) nomes.push(`link target of ${escaparSaida(e.caminho)} ${doAlvo.join(' ')}`)
    }

    // Reading problems of agent files. A mirror entry repeats the content of a
    // real one, so it only adds what belongs to its own path. A NUL is reported
    // by the character scan below, with its position.
    const motivos = problemasDeLeitura(e, indice).filter(
      (m) => m !== 'nul' && (!espelho(e) || PROBLEMAS_DO_CAMINHO.includes(m)),
    )
    if (motivos.length) problemas.push(`${escaparSaida(e.caminho)} (${motivos.join(', ')})`)

    if (espelho(e)) continue
    if (e.modo !== '120000') {
      if (e.estado === 'ausente') reaisAusentes++
      else reaisComBlob++
    }
    if (e.estado === 'ausente') {
      if (e.tipo !== 'agente') notas.ausentes.push(escaparSaida(e.caminho))
      continue
    }
    if (e.texto === null) continue
    lidos++
    if (e.tipo !== 'agente') {
      if (e.estado === 'truncado') notas.truncados.push(escaparSaida(e.caminho))
      if (e.codificacao === 'utf-8-invalido') notas.invalidos.push(escaparSaida(e.caminho))
    }

    // An agent file gets the prose set even with a code extension: what an
    // agent loads is held to the strictest reading. The allowlist is data, and
    // still gets no exemption: nothing in it may make a reviewer skip a line.
    const livre = (e.tipo === 'prosa' || e.tipo === 'dados') && e.caminho !== NOME_DA_ALLOWLIST
    const { achados, soCr } = varrerBrutos(e.texto, e.tipo === 'codigo', {
      quebraDePagina: livre,
      corVisivel: livre,
    })
    if (soCr) notas.soCr.push(escaparSaida(e.caminho))
    // One escape may decode under two dialects (a JSON unicode escape is also a
    // YAML one): it counts once, under the first path that reads it.
    const escapes = []
    const vistos = new Set()
    for (const [formato, porOnde] of formatos.get(e) || []) {
      for (const x of varrerEscapes(e, formato)) {
        if (vistos.has(x.indice)) continue
        vistos.add(x.indice)
        escapes.push({ ...x, porOnde: porOnde === e.caminho ? null : porOnde })
      }
    }
    const todos = [...achados, ...escapes].sort((a, b) => a.indice - b.indice)
    if (!todos.length) continue

    // The allowlist itself is never exempt: an entry there could hide the
    // control that makes a reviewer skip the line that adds the entry.
    if (
      e.caminho !== NOME_DA_ALLOWLIST &&
      allowlist.aceita('control-bytes', { arquivo: e.caminho, oid: e.oid })
    ) {
      usouAlguma = true
      continue
    }

    // One item per code point and form per file, at its first position, with
    // the count of the rest: 1,000 ESC in one bundle are one line, not 1,000.
    const grupos = new Map()
    for (const a of todos) {
      const chave = `${a.cp} ${a.forma} ${a.porOnde || ''}`
      const g = grupos.get(chave)
      if (g) g.n++
      else grupos.set(chave, { ...a, n: 1 })
    }
    for (const g of grupos.values()) {
      const { linha, coluna } = posicao(e.texto, g.indice)
      const forma =
        g.forma === null
          ? ''
          : g.forma === 'cr'
            ? ' not followed by LF'
            : ` as a ${g.forma} escape${g.porOnde ? ` read as ${escaparSaida(g.porOnde)}` : ''}`
      const resto = g.n > 1 ? ` (+${g.n - 1} more)` : ''
      itens.push(`${onde(e.caminho, linha, coluna)} ${rotulo(g.cp)}${forma}${resto}`)
    }
    caracteres += todos.length
    for (const a of todos) {
      const antes = a.indice > 0 ? e.texto.charCodeAt(a.indice - 1) : -1
      if (SO_AVISO_NA_MENSAGEM.has(a.cp)) classes.add('pagina')
      else if (a.forma === null && SO_MOJIBAKE[a.cp] && antes >= 0xc2 && antes <= 0xdf) {
        classes.add('mojibake')
      } else classes.add('esconde')
    }
    if (e.caminho !== NOME_DA_ALLOWLIST) {
      arquivoIsentavel = true
      sugerirEntrada(r, 'control-bytes', { arquivo: e.caminho, oid: e.oid })
    }
  }

  for (const c of commits) {
    // A message is prose: its line breaks are ordinary, the rest is not, except
    // the bell, vertical tab and form feed, which only warn (SO_AVISO_NA_MENSAGEM).
    const achados = varrerBrutos(c.mensagem, false).achados
    if (!achados.length) continue
    if (allowlist.aceita('control-bytes', { commit: c.id })) {
      usouAlguma = true
      continue
    }
    const item = `commit ${c.id.slice(0, 12)} message ${[...new Set(achados.map((a) => rotulo(a.cp)))].join(' ')}`
    if (achados.some((a) => !SO_AVISO_NA_MENSAGEM.has(a.cp))) {
      nomes.push(item)
      commitIsentavel = true
      sugerirEntrada(r, 'control-bytes', { commit: c.id })
    } else {
      notas.mensagens.push(item)
    }
  }

  if (lidos === 0 && reaisComBlob === 0 && reaisAusentes > 0 && problemas.length === 0) {
    // Nothing tracked could be read: that is a failed measurement, not a clean
    // repository, and `na` would launder it.
    throw new Error(`none of the ${reaisAusentes} tracked blob(s) is in the object store`)
  }

  const erros = errosDaAllowlist(allowlist)
  // Each part carries its own remedy: a reader who has only an unreadable
  // agent file should not be told to delete a character that is not there.
  const partes = []
  // A generated or vendored bundle is not edited by hand, and CI reads a commit
  // after it is published: for those the allowlist is the fix, so the remedy
  // names it. Only the allowlist file itself can never be exempted.
  if (itens.length) {
    // A bell, vertical tab or form feed rings or moves the cursor and hides
    // nothing: telling a maintainer that the form feed of a license file hides
    // text from the review misleads them about the risk. Nor does a C1 control
    // that a double decode left after a Latin-1 letter: measured, a Portuguese
    // heading saved through UTF-8 twice was told its U+0087 and U+0083 hide
    // text. The hiding claim stays whenever any other control is among the
    // findings.
    let porque = ''
    if (classes.has('esconde')) {
      porque = 'a terminal acts on it and hides text from the review while a model reads it all; '
    } else {
      if (classes.has('pagina')) {
        porque +=
          'a page-break or bell control hides no text, and only a form feed alone on its line ' +
          'in a prose or data file is left alone; '
      }
      if (classes.has('mojibake')) {
        porque +=
          'a C1 control right after a Latin-1 letter is UTF-8 text decoded twice, so re-save ' +
          'the file as UTF-8; '
      }
    }
    partes.push(
      `${plural(caracteres, 'control character', 'control characters')}: ${resumir(itens)} — ` +
        porque +
        'remove it, or in code write the escape sequence as source text' +
        (arquivoIsentavel
          ? '; for a generated or vendored file add {regra, motivo, arquivo, oid} to ' +
            NOME_DA_ALLOWLIST
          : ''),
    )
  }
  if (nomes.length) {
    partes.push(
      `${plural(nomes.length, 'name or message', 'names or messages')} with a control character: ` +
        `${resumir(nomes)} — rename the file or reword the commit` +
        (commitIsentavel
          ? `; for a commit already published add {regra, motivo, commit} to ${NOME_DA_ALLOWLIST}`
          : ''),
    )
  }
  if (problemas.length) {
    partes.push(
      `${plural(problemas.length, 'agent file', 'agent files')} this rule cannot read the way ` +
        `the agent does: ${resumir(problemas)} — keep it as plain UTF-8 text tracked by git`,
    )
  }
  if (erros.length) {
    partes.push(`${NOME_DA_ALLOWLIST} is malformed, and that is never exempt: ${resumir(erros)}`)
  }
  if (partes.length) return partes.join(' · ')

  if (lidos === 0 && commits.length === 0) return na('no tracked text file')

  const nota = []
  if (notas.truncados.length) {
    nota.push(
      `${plural(notas.truncados.length, 'file above 8 MiB was', 'files above 8 MiB were')} read only in the first 8 MiB: ${resumir(notas.truncados)}`,
    )
  }
  if (notas.ausentes.length) {
    nota.push(
      `${plural(notas.ausentes.length, 'blob is', 'blobs are')} missing from the object store, not read: ${resumir(notas.ausentes)}`,
    )
  }
  if (notas.invalidos.length) {
    nota.push(
      `${plural(notas.invalidos.length, 'file is', 'files are')} not valid UTF-8, read with replacement characters, so a legacy code page byte is not judged: ${resumir(notas.invalidos)}`,
    )
  }
  if (notas.soCr.length) {
    nota.push(
      `${plural(notas.soCr.length, 'code file ends', 'code files end')} every line with a bare carriage return, which a terminal prints over the previous line: ${resumir(notas.soCr)}`,
    )
  }
  if (notas.mensagens.length) {
    nota.push(
      `${plural(notas.mensagens.length, 'commit message carries', 'commit messages carry')} a ` +
        `bell, vertical tab or form feed, which hides no text: ${resumir(notas.mensagens)} — ` +
        'usually a PowerShell backtick escape in a double-quoted -m (a backtick before a, v or ' +
        `f); single-quote the message next time, or add {regra, motivo, commit} to ${NOME_DA_ALLOWLIST}`,
    )
  }
  nota.push(...notasDaAllowlist(allowlist, 'control-bytes', usouAlguma))
  return nota.length ? { nota: nota.join(' · ') } : null
}

// ═════════════════════════════════════════════════════════ mcp-ansi-escape

const JS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'])

/**
 * Python source without `#` comments. Strings (single, double, triple quoted)
 * are copied whole so a `#` inside one stays; a comment becomes one space, so
 * line numbers do not move.
 */
function semComentarioPython(t) {
  let saida = ''
  let i = 0
  while (i < t.length) {
    const c = t[i]
    if (c === '#') {
      while (i < t.length && t[i] !== '\n') i++
      saida += ' '
      continue
    }
    if (c === '"' || c === "'") {
      const triplo = t.startsWith(c + c + c, i)
      const fecho = triplo ? c + c + c : c
      let j = i + fecho.length
      while (j < t.length) {
        if (t[j] === '\\') {
          j += 2
          continue
        }
        if (!triplo && t[j] === '\n') break
        if (t.startsWith(fecho, j)) {
          j += fecho.length
          break
        }
        j++
      }
      saida += t.slice(i, j)
      i = j
      continue
    }
    saida += c
    i++
  }
  return saida
}

/** The code of a file with its comments removed, by language; other kinds stay raw. */
function codigoSemComentario(caminho, texto) {
  const ext = posix.extname(caminho).toLowerCase()
  if (JS.has(ext)) return semComentario(texto)
  if (ext === '.py') return semComentarioPython(texto)
  return texto
}

function validarTabela(nome, tabela) {
  if (
    !Array.isArray(tabela) ||
    !tabela.length ||
    !tabela.every((x) => Array.isArray(x) && x[0] instanceof RegExp && typeof x[1] === 'string')
  ) {
    throw new Error(`checarMcpAnsiEscape: ${nome} has to be a non-empty [RegExp, string] table`)
  }
}

/**
 * mcp-ansi-escape over the index of `r.dir`. The tables arrive as parameters
 * and are never imported here, so the rule object in index.mjs names every table it consults.
 */
export function checarMcpAnsiEscape(
  r,
  { MARCADORES_DE_SERVIDOR: marcadores, ESCAPES_DE_CONTROLE: escapes } = {},
) {
  validarTabela('MARCADORES_DE_SERVIDOR', marcadores)
  validarTabela('ESCAPES_DE_CONTROLE', escapes)
  const indice = lerIndice(r.dir)
  if (indice.semGit) return na('no MCP server source tracked')
  // Read before any early return: a malformed allowlist fails every injection
  // rule, and a stale entry is reported, even where no server file exists.
  const allowlist = lerAllowlist(r.dir)

  // Candidates, once per real file: a launch that names a link is judged on
  // the file behind it, under that file's own path and blob id. The files a
  // launch names come from mcp-server-launch's own resolution, so a command
  // string (`node srv.mjs`) and a shell wrapper (`bash -c "node srv.mjs"`) are
  // split into words exactly as that rule splits them.
  const candidatos = new Map()
  const candidatar = (e, codigo) => {
    if (!candidatos.has(e.caminho)) candidatos.set(e.caminho, { e, codigo })
  }
  for (const { caminho } of arquivosReferenciados(r.dir)) {
    const lancado = indice.porCaminho.get(caminho)
    if (!lancado) continue
    const e = realDe(lancado, indice)
    if (e.texto !== null) candidatar(e, codigoSemComentario(e.caminho, e.texto))
  }
  for (const e of indice.entradas) {
    if (espelho(e) || e.texto === null || !ehFonte(e) || candidatos.has(e.caminho)) continue
    // Cheap first: stripping comments only removes text, so a file whose RAW
    // text has no marker cannot have one after stripping.
    if (!marcadores.some(([re]) => re.test(e.texto))) continue
    const codigo = codigoSemComentario(e.caminho, e.texto)
    if (marcadores.some(([re]) => re.test(codigo))) candidatar(e, codigo)
  }
  if (!candidatos.size) {
    const erros = errosDaAllowlist(allowlist)
    if (erros.length) {
      return `${NOME_DA_ALLOWLIST} is malformed, and that is never exempt: ${resumir(erros)}`
    }
    const nota = notasDaAllowlist(allowlist, 'mcp-ansi-escape', false)
    return nota.length ? { nota: nota.join(' · ') } : na('no MCP server source tracked')
  }

  const globais = escapes.map(([re, explicacao]) => [
    new RegExp(re.source, `${re.flags.replace('g', '')}g`),
    explicacao,
  ])
  const itens = []
  let usouAlguma = false
  for (const { e, codigo } of candidatos.values()) {
    const achados = []
    for (const [re, explicacao] of globais) {
      re.lastIndex = 0
      for (let m = re.exec(codigo); m; m = re.exec(codigo)) {
        achados.push({ indice: m.index, explicacao })
        if (m[0] === '') re.lastIndex++
      }
    }
    if (!achados.length) continue
    if (
      e.caminho !== NOME_DA_ALLOWLIST &&
      allowlist.aceita('mcp-ansi-escape', { arquivo: e.caminho, oid: e.oid })
    ) {
      usouAlguma = true
      continue
    }
    if (e.caminho !== NOME_DA_ALLOWLIST) {
      sugerirEntrada(r, 'mcp-ansi-escape', { arquivo: e.caminho, oid: e.oid })
    }
    // Positions come from the stripped code, which keeps every line break, so
    // the line is exact; a block comment earlier on the same line shifts the
    // column by its length.
    achados.sort((a, b) => a.indice - b.indice)
    for (const a of achados) {
      const { linha, coluna } = posicao(codigo, a.indice)
      itens.push(`${onde(e.caminho, linha, coluna)} ${a.explicacao}`)
    }
  }

  const erros = errosDaAllowlist(allowlist)
  if (itens.length || erros.length) {
    const partes = []
    if (itens.length) {
      partes.push(
        `${plural(itens.length, 'escaped terminal control', 'escaped terminal controls')} in ` +
          `MCP server source: ${resumir(itens)} — a tool description or result carrying it ` +
          'can recolour, hide or rewrite what the agent client prints; build the text without ' +
          'the control, or allowlist the file with a reason',
      )
    }
    if (erros.length) {
      partes.push(`${NOME_DA_ALLOWLIST} is malformed, and that is never exempt: ${resumir(erros)}`)
    }
    return partes.join(' · ')
  }
  const nota = notasDaAllowlist(allowlist, 'mcp-ansi-escape', usouAlguma)
  return nota.length ? { nota: nota.join(' · ') } : null
}
