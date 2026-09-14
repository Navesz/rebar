// instrucoes — the Markdown an agent reads and a reviewer does not see, and the
// helpers the three phase-3 heuristics share.
//
// WHAT A HIDDEN REGION IS HERE. GitHub renders a Markdown file with its HTML
// comments and its unused link reference definitions removed, and a model reads
// both, because an instruction file reaches it as raw text. Checked by rendering
// through the GitHub /markdown API: a block comment, an inline comment and a
// `[//]: # (...)` definition all rendered as nothing. Elements hidden by a
// `style` (display, visibility, a zero font size or opacity) or by the `hidden`
// attribute are regions too: GitHub strips those attributes, but the Markdown
// preview bundled with Cursor 3.17.19 renders raw HTML under a style-src policy
// that allows inline styles, with no sanitizer, so there the text does vanish.
// Measured 0 such elements outside code in 291 + 82 + 2,796 + 690 Markdown files
// (repositories, rebar, node_modules, public instruction files), so including
// them costs no false positive.
//
// WHY A REGION NEEDS A SIGNAL. Hidden prose alone is not one: 381 of 690 public
// instruction files that carry a comment hide prose in it, and all 18 prose
// comments across rebar, rebar-site and bookkeep are notes for maintainers. So a
// region counts only when it is addressed to an agent: a vocative, an override
// of earlier instructions, a request to conceal, a condition on being a model, a
// model that must do something, or an imperative next to a strong execution
// token. Six families, measured: 0 regions in the 23 local repositories, 0 in
// rebar, 0 in node_modules, and 2 regions in 2 of 690 public instruction files,
// with 28 of 28 recall phrases read right. The seventh family the first design
// had (an imperative next to an addressee) fired on 3 honest local files and on
// 10 regions in 5 public files, so it is gone.
//
// WHY THE VOCABULARY IS NOT A TABLE. Every other injection family exports its
// patterns as [RegExp, string] rows, index.mjs re-exports them, and
// prove-table.mjs holds each row against the raw text of rebar's sources, READMEs
// and MCP artifact. Read raw that way, these families match 14 of those targets
// (the concealment family 6, the execution tokens 14, the vocative 2), and none
// of those is a finding: the rule reads only hidden regions, never visible prose.
// So the vocabulary stays internal to this file, built by concatenation, and
// prove-injection.mjs test (f), which runs the rule on rebar, is the self-check.
// The cost is named: the MCP artifact carries no search term for these rules.
//
// Everything a family looks for is ASSEMBLED from pieces, and no comment here
// spells one.

import { posix } from 'node:path'

import { escritasDe } from './escritas.mjs'

const j = (...partes) => partes.join('')

// ═══════════════════════════════════════════════════════════════ the targets

const EXTENSOES_MARKDOWN = new Set(['md', 'mdx', 'markdown', 'mdc'])
const ARQUIVO_DE_REGRA = /^\.(?:cursorrules|windsurfrules|clinerules|roorules(?:-.*)?)$/i

/**
 * Whether an index entry is Markdown a client may read raw: an .md, .mdx,
 * .markdown or .mdc file, or an agent rule file with no extension. Agent JSON,
 * TOML and YAML are not: they carry no hidden Markdown region.
 */
export function ehArquivoMarkdown(entrada) {
  const nome = posix.basename(entrada.caminho)
  const ponto = nome.lastIndexOf('.')
  const extensao = ponto > 0 ? nome.slice(ponto + 1).toLowerCase() : ''
  if (EXTENSOES_MARKDOWN.has(extensao)) return true
  return entrada.tipo === 'agente' && ARQUIVO_DE_REGRA.test(nome)
}

// ═════════════════════════════════════════════════════════════════ the masks

/**
 * Offsets that are code or front matter, where a comment is shown and not hidden.
 * Only three things are masked, and only when they are closed:
 *   m1 front matter from a first-line `---` to the next `---` or `...`;
 *   m2 a top-level fence, when its closer exists (same character, at least as long);
 *   m3 a backtick run paired with the next run of the same length, with no blank
 *      line and no line-start comment between them.
 * Indented code and unclosed fences are NOT masked: measured, masking them adds
 * no true finding and would let a real comment through, while not masking them
 * added 2 visible regions over the local repositories and 3 over the public files.
 * The third condition of m3 is CommonMark's: an HTML block (type 2) interrupts a
 * paragraph, so a code span never runs across a line that starts a comment.
 */
export function mascaras(texto) {
  const m = new Uint8Array(texto.length)
  const marcar = (a, b) => {
    for (let k = a; k < b && k < texto.length; k++) m[k] = 1
  }
  const linhas = []
  let p = 0
  for (const l of texto.split('\n')) {
    linhas.push([p, l])
    p += l.length + 1
  }
  let i = 0
  if (linhas.length && linhas[0][1] === '---') {
    for (let k = 1; k < linhas.length; k++) {
      if (linhas[k][1] === '---' || linhas[k][1] === '...') {
        marcar(0, linhas[k][0] + linhas[k][1].length)
        i = k + 1
        break
      }
    }
  }
  for (; i < linhas.length; i++) {
    const [inicio, l] = linhas[i]
    const abre = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(l)
    if (!abre || (abre[1][0] === '`' && abre[2].includes('`'))) continue
    let fecha = -1
    for (let k = i + 1; k < linhas.length; k++) {
      const c = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(linhas[k][1])
      if (c && c[1][0] === abre[1][0] && c[1].length >= abre[1].length) {
        fecha = k
        break
      }
    }
    if (fecha === -1) continue
    marcar(inicio, linhas[fecha][0] + linhas[fecha][1].length)
    i = fecha
  }
  const corridas = []
  for (const x of texto.matchAll(/`+/g)) if (!m[x.index]) corridas.push([x.index, x[0].length])
  for (let a = 0; a < corridas.length; a++) {
    const [ia, na] = corridas[a]
    for (let b = a + 1; b < corridas.length; b++) {
      const [ib, nb] = corridas[b]
      const entre = texto.slice(ia, ib)
      if (/\n[ \t]*\n/.test(entre) || /\n {0,3}<!--/.test(entre)) break
      if (nb === na) {
        marcar(ia, ib + nb)
        a = b
        break
      }
    }
  }
  return m
}

// ═══════════════════════════════════════════════════════════════ the regions

/** 1-based line, and column in code points, of a UTF-16 offset. */
function lugar(texto, indice) {
  const inicio = texto.lastIndexOf('\n', indice - 1) + 1
  const linha = texto.slice(0, indice).split('\n').length
  return {
    linha,
    coluna: [...texto.slice(inicio, indice)].length + 1,
    antes: texto.slice(inicio, indice),
  }
}

const REFERENCIA =
  /^ {0,3}\[([^\]\n]{1,999})\]:[ \t]*\n?[ \t]*(<[^>\n]*>|\S+)(?:[ \t]*\n?[ \t]*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\)))?[ \t]*$/gm
const USO = /\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g
const normalizarRotulo = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()

const ABERTURA = /<([a-zA-Z][\w-]*)\b([^>]*)>/g
const ESTILO = /\bstyle\s*=\s*("[^"]*"|'[^']*')/i
const CSS_OCULTO =
  /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d])|opacity\s*:\s*0(?![.\d])/i
// A BARE attribute: quoted values are blanked first, so a class list that
// happens to hold the word is not the attribute.
const ATRIBUTO_HIDDEN = /(?:^|\s)hidden(?=[\s>=/]|$)/i

/**
 * Every hidden region of an LF text, in order of appearance within each kind:
 * `[{ tipo: 'comentario'|'definicao'|'elemento', forma, linha, coluna, corpo, indice }]`.
 *
 *   comentario  a `<!--` outside the masks, to the first `-->`; `<!-->` and
 *               `<!--->` are empty. forma 'bloco' when only 0-3 spaces precede it
 *               on its line (CommonMark HTML block type 2), else 'inline'. An
 *               unterminated block runs to the end of the file, as CommonMark
 *               reads it; an unterminated inline one is literal text, and the
 *               scan goes on past it: stopping there, as the first prototype
 *               did, let one stray inline opener hide every block comment after it.
 *   definicao   a link reference definition whose label nothing uses outside the
 *               masks and outside every definition; corpo is the label, a line
 *               break, and the title. The line break matters: joined by a space,
 *               a title that opens by naming its addressee no longer starts the
 *               body, and the vocative family missed it (measured).
 *   elemento    an opening tag outside the masks whose style hides it or that
 *               carries a bare hidden attribute, up to the first closing tag of
 *               the same name, tags blanked. No closer, no region.
 */
export function regioesOcultas(texto) {
  const m = mascaras(texto)
  const regioes = []

  let k = 0
  while ((k = texto.indexOf('<!--', k)) !== -1) {
    if (m[k]) {
      k += 4
      continue
    }
    const onde = lugar(texto, k)
    const forma = /^ {0,3}$/.test(onde.antes) ? 'bloco' : 'inline'
    let fim
    if (texto.startsWith('<!-->', k)) fim = k + 5
    else if (texto.startsWith('<!--->', k)) fim = k + 6
    else {
      const f = texto.indexOf('-->', k + 4)
      fim = f === -1 ? -1 : f + 3
    }
    if (fim === -1) {
      if (forma === 'bloco') {
        regioes.push({
          tipo: 'comentario',
          forma,
          linha: onde.linha,
          coluna: onde.coluna,
          corpo: texto.slice(k + 4),
          indice: k,
        })
        break
      }
      k += 4
      continue
    }
    const corpo = texto.slice(k + 4, Math.max(k + 4, fim - 3))
    regioes.push({
      tipo: 'comentario',
      forma,
      linha: onde.linha,
      coluna: onde.coluna,
      corpo,
      indice: k,
    })
    k = fim
  }

  const definicoes = []
  for (const x of texto.matchAll(REFERENCIA)) {
    if (m[x.index]) continue
    const titulo = x[3] ? x[3].slice(1, -1) : ''
    definicoes.push({ rotulo: x[1], titulo, inicio: x.index, fim: x.index + x[0].length })
  }
  if (definicoes.length) {
    const usados = new Set()
    for (const x of texto.matchAll(USO)) {
      if (m[x.index]) continue
      if (definicoes.some((d) => x.index >= d.inicio && x.index < d.fim)) continue
      usados.add(normalizarRotulo(x[2] ? x[2] : x[1]))
    }
    for (const d of definicoes) {
      if (usados.has(normalizarRotulo(d.rotulo))) continue
      const onde = lugar(texto, d.inicio)
      regioes.push({
        tipo: 'definicao',
        forma: 'definicao',
        linha: onde.linha,
        coluna: onde.coluna,
        corpo: `${d.rotulo}\n${d.titulo}`,
        indice: d.inicio,
      })
    }
  }

  for (const x of texto.matchAll(ABERTURA)) {
    if (m[x.index]) continue
    const atributos = x[2]
    const estilo = ESTILO.exec(atributos)
    let forma = null
    if (estilo && CSS_OCULTO.test(estilo[1])) forma = 'estilo'
    else if (ATRIBUTO_HIDDEN.test(atributos.replace(/"[^"]*"|'[^']*'/g, '""'))) forma = 'hidden'
    if (!forma) continue
    const fecha = texto.indexOf(`</${x[1]}`, x.index + x[0].length)
    if (fecha === -1) continue
    const onde = lugar(texto, x.index)
    regioes.push({
      tipo: 'elemento',
      forma,
      linha: onde.linha,
      coluna: onde.coluna,
      corpo: texto.slice(x.index + x[0].length, fecha).replace(/<[^>]+>/g, ' '),
      indice: x.index,
    })
  }
  return regioes
}

// ═══════════════════════════════════════════════════════════════ the signals

// Machine markers that are no prose: rebar's numbers markers, the generator
// marker, the Next.js agent-rules markers, their legacy codemod pair.
const MARCADOR_EXATO = [
  /^n [a-z0-9][a-z0-9.-]*$/,
  /^\/n$/,
  new RegExp(j('^ reb', 'ar:age', 'ntes $')),
  new RegExp(j('^ (BEGIN|END):nex', 'tjs-age', 'nt-rules $')),
  new RegExp(j('^ NEXT-AGE', 'NTS-MD-(START|END) $')),
]
// A namespaced marker of any tool (`tool:agents:start v10`): public files carry
// them, and without this shape their words hit the addressee vocabulary.
const MARCADOR_GENERICO =
  /^\s*(?:(?:BEGIN|END|START|STOP|begin|end|start|stop)\s+)?[\w.@/+-]+(?::[\w.@/+-]+)+(?:\s+[\w.@/+-]+(?:=\S+)?)*\s*$/

const ENDERECADO = j(
  '(A',
  'I|I',
  'A|LLMs?|age',
  'nts?|age',
  'ntes?|assis',
  'tant|assis',
  'tente|asis',
  'tente|Cla',
  'ude|Copi',
  'lot|Co',
  'dex|Gem',
  'ini|Cur',
  'sor|mo',
  'del|mo',
  'delo|language mo',
  'del)',
)
const VOCATIVO = new RegExp(
  j(
    '(^\\s*|[.!?\\n]\\s*)((note|message|instructions?|reminder|nota|mensagem|instruç(ão|ões)|aviso|mensaje|instrucciones)\\s+)?',
    '((to|for|para|ao|à|aos|às|al)\\s+)?((the|o|a|os|as|el|la|any|all|todo|toda)\\s+)?((coding|ai|ia)\\s+)?',
    ENDERECADO,
    '(\\s+',
    ENDERECADO,
    ')?\\s*(instructions?|instruç(ão|ões)|instrucciones)?\\s*[:,]',
  ),
  'iu',
)
const ARTIGOS =
  '(all\\s+|any\\s+|todas?\\s+|todos?\\s+|the\\s+|your\\s+|suas?\\s+|as\\s+|os\\s+|o\\s+|a\\s+|las\\s+|los\\s+|tus\\s+)*'
const NOME_DE_REGRA =
  '((instructions?|rules|prompts?|instruç(ão|ões)|regras|orientações|instrucciones|reglas|indicaciones)\\s+)?'
const SOBREPOR = new RegExp(
  j(
    '\\b(ign',
    'ore|disre',
    'gard|for',
    'get|over',
    'ride|desconsidere|esqueça|ignora|olvida)\\s+',
    ARTIGOS,
    NOME_DE_REGRA,
    '(previous|prior|above|earlier|preceding|other|anteriores|acima|anterior)\\b',
  ),
  'iu',
)
const OCULTACAO = new RegExp(
  [
    j('(do ', "not|don't|never) (tell|mention|reveal|inform|show|disclose)"),
    j('without ', '(telling|asking|informing|notifying)'),
    j('(não|nunca) ', '(conte|mencione|revele|avise|mostre)'),
    j('sem ', '(avisar|contar|perguntar)'),
    j('no ', '(menciones|digas|avises|cuentes|reveles)'),
  ].join('|'),
  'iu',
)
const CONDICIONAL = new RegExp(
  j(
    '\\b(if|when|se|quando|si|cuando)\\s+(you\\s+are|you\\x27re|voc',
    'ê\\s+(é|for)|eres)\\s+(an?\\s+|uma?\\s+|um\\s+|una?\\s+)?',
    '(ai\\b|ia\\b|llm|age',
    'nt|assis',
    'tant|assis',
    'tente|asis',
    'tente|mo',
    'del|mo',
    'delo|language mo',
    'del|cla',
    'ude|copi',
    'lot|co',
    'dex|gem',
    'ini)',
  ),
  'iu',
)
const VERBOS = [
  j('ign', 'ore'),
  j('disre', 'gard'),
  j('for', 'get'),
  j('over', 'ride'),
  j('ru', 'n'),
  j('exec', 'ute'),
  j('ca', 'll'),
  j('fet', 'ch'),
  j('se', 'nd'),
  j('up', 'load'),
  j('del', 'ete'),
  j('ins', 'ert'),
  j('incl', 'ude'),
  j('wri', 'te'),
  j('ope', 'n'),
  j('vis', 'it'),
  j('dow', 'nload'),
  j('instal', 'l'),
  j('pos', 't'),
  j('ro', 'de'),
  j('execu', 'te'),
  j('cha', 'me'),
  j('env', 'ie'),
  j('ba', 'ixe'),
  j('apa', 'gue'),
  j('inc', 'lua'),
  j('escr', 'eva'),
  j('abr', 'a'),
  j('ejec', 'uta'),
  j('enví', 'a'),
  j('inst', 'ala'),
  j('env', 'iar'),
  j('rod', 'ar'),
  j('execu', 'tar'),
  j('ba', 'ixar'),
  j('cha', 'mar'),
]
const ADVERBIOS = [
  j('ne', 'ver'),
  j('alw', 'ays'),
  j('do ', 'not'),
  j('don', "'t"),
  j('nun', 'ca'),
  j('semp', 're'),
  j('nã', 'o'),
  j('siem', 'pre'),
]
const IMPERATIVO = new RegExp(
  j(
    '(^|[.!?:;]\\s+|\\n\\s*|[-*]\\s+)((',
    ADVERBIOS.join('|'),
    ')\\s+)?(',
    VERBOS.join('|'),
    ')\\b',
  ),
  'iu',
)
const SEGUNDA_PESSOA = new RegExp(
  j(
    '\\b(',
    [
      j('you ', '(must|should|will|are)'),
      j('your ', '(task|instructions|goal)'),
      j('sys', 'tem ', 'prompt'),
      j('previous ', 'instructions'),
      j('você ', '(deve|precisa|vai)'),
      j('sua ', 'tarefa'),
      j('instruç', 'ões ', 'anteriores'),
      j('deb', 'es'),
      j('tu ', 'tarea'),
    ].join('|'),
    ')\\b',
  ),
  'iu',
)

/**
 * Strong execution tokens in free text: a pipe into a shell, a download tool with
 * a switch or an address, command substitution, an MCP tool name prefix, the SSH
 * key folder or key file, a token-shaped variable name, a dotenv file, a netcat
 * listener. Shared with instruction-provenance, which notes a third-party block
 * carrying one. Not a table on purpose (see the file header).
 */
export const EXEC_FORTE_TEXTO = new RegExp(
  [
    j('\\|\\s*(ba', 'sh|s', 'h|z', 'sh|pwsh|power', 'shell|i', 'ex)\\b'),
    j('\\b(cu', 'rl|wg', 'et)\\s+(-\\w|https?:)'),
    j('\\$', '\\('),
    j('\\bmc', 'p__'),
    j('~\\/\\.s', 'sh'),
    j('\\bid_r', 'sa\\b'),
    j('\\b[A-Z][A-Z0-9_]*_(TO', 'KEN|SEC', 'RET|API_', 'KEY)\\b'),
    j('\\.e', 'nv\\b'),
    j('\\bnc\\s', '+-e'),
  ].join('|'),
)
const URL_COM_VERBO = new RegExp(
  j(
    '\\b(fet',
    'ch|vis',
    'it|op',
    'en|se',
    'nd|po',
    'st|upl',
    'oad|down',
    'load|acesse|envie|baixe)\\b[^\\n]{0,60}https?:\\/\\/',
  ),
  'iu',
)
const MODAL = new RegExp(
  j(
    '(?<![\\w/.-])(',
    [
      j('A', 'I'),
      j('I', 'A'),
      j('LLMs?'),
      j('[Aa]ge', 'nts?'),
      j('[Aa]ge', 'ntes?'),
      j('[Aa]ssis', 'tant'),
      j('[Aa]ssis', 'tente'),
      j('Cla', 'ude'),
      j('Copi', 'lot'),
      j('Co', 'dex'),
      j('Gem', 'ini'),
      j('mo', 'del'),
      j('mo', 'delo'),
    ].join('|'),
    ')\\s+(must|should|shall|has to|needs to|deve|precisa|tem que|debe|tiene que)\\s+(',
    VERBOS.join('|'),
    ')\\b',
  ),
  'u',
)

// The combining mark blocks a decomposed accent lives in: inside a word they
// join, the way \p{M} joined in the pattern the measurement used.
const MARCAS = [
  [0x300, 0x36f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
]
const APOSTROFO_TIPOGRAFICO = 0x2019
const ehMarca = (cp) => MARCAS.some(([a, b]) => cp >= a && cp <= b)

/**
 * Words of a text: a run that starts at a letter with a script (the letters of
 * escritas-tabelas.mjs) and goes on over letters, combining marks, an apostrophe,
 * a typographic apostrophe or a hyphen. It is the definition every measurement
 * above used (a letter, then letters, marks, apostrophes and hyphens), written
 * over the literal table so no property escape decides a verdict: `don't` and
 * `coding-agent` are one word each, and a digit ends a word.
 */
export function contarPalavras(s) {
  let palavras = 0
  let dentro = false
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0)
    const letra = cp > 0x40 && escritasDe(cp) !== null
    if (letra) {
      if (!dentro) palavras++
      dentro = true
    } else if (
      dentro &&
      (cp === 0x27 || cp === 0x2d || cp === APOSTROFO_TIPOGRAFICO || ehMarca(cp))
    ) {
      // still inside the word
    } else dentro = false
  }
  return palavras
}

const FAMILIAS = [
  ['vocativo', (c) => VOCATIVO.test(c)],
  ['sobrepor', (c) => SOBREPOR.test(c)],
  ['ocultacao', (c) => OCULTACAO.test(c)],
  ['condicional', (c) => CONDICIONAL.test(c)],
  ['modal', (c) => MODAL.test(c)],
  [
    'verbo+exec',
    (c) =>
      (IMPERATIVO.test(c) || SEGUNDA_PESSOA.test(c)) &&
      (EXEC_FORTE_TEXTO.test(c) || URL_COM_VERBO.test(c)),
  ],
]

/**
 * `{ classe: 'marcador'|'curto'|'prosa', palavras, familias }` for a region body.
 * A marker is no prose; fewer than 3 words is too short to address anyone; a
 * prose region is a directive when `familias` is not empty. Code spans, link
 * destinations and href/src values are blanked before the families run, so an
 * address or a code sample is not read as an order.
 */
export function avaliarRegiao(corpoCru) {
  if (MARCADOR_EXATO.some((re) => re.test(corpoCru)))
    return { classe: 'marcador', palavras: 0, familias: [] }
  const corpo = corpoCru
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\b(href|src|srcset)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\]\([^)]*\)/g, ']')
  if (MARCADOR_GENERICO.test(corpo)) return { classe: 'marcador', palavras: 0, familias: [] }
  const palavras = contarPalavras(corpo)
  if (palavras < 3) return { classe: 'curto', palavras, familias: [] }
  return {
    classe: 'prosa',
    palavras,
    familias: FAMILIAS.filter(([, testa]) => testa(corpo)).map(([nome]) => nome),
  }
}

// ═══════════════════════════════════════════════════════════════ the clients

/**
 * Which clients load a file by itself, sourced client by client (Codex, Copilot,
 * Cursor, VS Code, Devin and Windsurf, Cline, Roo, Kiro, Claude Code, Gemini CLI,
 * Amazon Q docs). First match wins. It grades the message, never the verdict.
 */
const CLIENTES = [
  [/(?:^|\/)AGENTS\.override\.md$/i, ['Codex']],
  [
    /(?:^|\/)AGENTS\.md$/i,
    ['Codex', 'Copilot', 'Cursor', 'VS Code', 'Devin/Windsurf', 'Cline', 'Roo', 'Kiro'],
  ],
  [/(?:^|\/)AGENT\.md$/i, ['Roo']],
  [/^CLAUDE\.md$/i, ['Claude Code', 'Copilot', 'VS Code']],
  [/(?:^|\/)CLAUDE(?:\.local)?\.md$/i, ['Claude Code']],
  [/(?:^|\/)\.claude\/(?:rules|skills|commands|agents)\//i, ['Claude Code']],
  [/^GEMINI\.md$/i, ['Gemini CLI', 'Copilot']],
  [/(?:^|\/)GEMINI\.md$/i, ['Gemini CLI']],
  [/(?:^|\/)\.github\/copilot-instructions\.md$/i, ['Copilot', 'VS Code']],
  [/(?:^|\/)\.github\/instructions\//i, ['Copilot', 'VS Code']],
  [/(?:^|\/)\.github\/(?:prompts|agents|chatmodes|skills)\//i, ['VS Code']],
  [/(?:^|\/)\.cursor\/rules\/.*\.mdc$/i, ['Cursor']],
  [/(?:^|\/)\.cursorrules$/i, ['Cline (Cursor legacy)']],
  [/(?:^|\/)(?:\.windsurfrules$|\.windsurf\/rules\/|\.devin\/rules\/)/i, ['Devin/Windsurf']],
  [/(?:^|\/)\.clinerules(?:\/|$)/i, ['Cline', 'Roo']],
  [/(?:^|\/)(?:\.roorules[^/]*$|\.roo\/)/i, ['Roo']],
  [/(?:^|\/)\.kiro\/steering\//i, ['Kiro']],
  [/(?:^|\/)\.amazonq\/rules\//i, ['Amazon Q']],
]

/**
 * `{ clientes, removeBloco }` for a tracked path. `removeBloco` is true only for
 * CLAUDE.md and CLAUDE.local.md at any depth: Claude Code documents that it
 * strips BLOCK-level comments from those before the model reads them, and nothing
 * about inline comments, imports or other files.
 */
export function clientesDe(caminho, tipo) {
  const achado = CLIENTES.find(([re]) => re.test(caminho))
  const clientes = achado
    ? achado[1].join(', ')
    : tipo === 'agente'
      ? 'an agent client (imported or configured)'
      : 'read on demand'
  return { clientes, removeBloco: /^CLAUDE(?:\.local)?\.md$/i.test(posix.basename(caminho)) }
}

// ═══════════════════════════════════════════════════════ commands in prose

const GERENCIADOR = /\b(npm|pnpm|yarn|bun)\s+(run(?:-script)?\s+|--silent\s+)?([a-z][\w:.-]*)/g
const SUBCOMANDOS = new Set(
  'install i ci add exec x dlx create init publish view ls why outdated update audit config link pack version help'.split(
    ' ',
  ),
)

/**
 * The package scripts an instruction text tells someone to run:
 * `[{ script, indice }]`. A package manager subcommand is not a script, and
 * `t` is npm's alias of `test`.
 */
export function comandosNomeados(texto) {
  const saida = []
  for (const x of String(texto).matchAll(GERENCIADOR)) {
    let script = x[3].replace(/[.:]+$/, '')
    if (!x[2] && SUBCOMANDOS.has(script)) continue
    if (script === 't') script = 'test'
    if (script) saida.push({ script, indice: x.index })
  }
  return saida
}
