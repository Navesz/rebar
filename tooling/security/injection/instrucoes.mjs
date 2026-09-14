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

// ═════════════════════════════════════════════════════════ the structure

// A container prefix: block quote markers and list markers, nested in any order.
const RECIPIENTE = /^(?:[ \t]*(?:>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]+))*/
const ABRE_CERCA = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FECHA_CERCA = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const INTERROMPE = /^ {0,3}(?:<!--|`{3,}|~{3,})/
// Beyond this many units before an opener on its line, nothing but prose can
// precede it, so the line prefix is not even sliced (a one-line file of 40,000
// comments sliced its prefix 40,000 times).
const PREFIXO_MAXIMO = 200

/** Index of the first element of the sorted `lista` greater than `x`. */
function primeiroApos(lista, x) {
  let baixo = 0
  let alto = lista.length
  while (baixo < alto) {
    const meio = (baixo + alto) >> 1
    if (lista[meio] <= x) baixo = meio + 1
    else alto = meio
  }
  return baixo
}

/** Whether `pos` falls inside one of the sorted, disjoint `[{ inicio, fim }]`. */
function dentroDe(intervalos, pos) {
  let baixo = 0
  let alto = intervalos.length - 1
  while (baixo <= alto) {
    const meio = (baixo + alto) >> 1
    if (intervalos[meio].inicio > pos) alto = meio - 1
    else if (intervalos[meio].fim <= pos) baixo = meio + 1
    else return true
  }
  return false
}

/**
 * `(indice) -> { linha, coluna }` over one text: a 1-based line and a column in
 * code points. Asked in increasing order within a line, it walks on from the
 * last answer instead of from the line start: reader.mjs's posicao walks from
 * the line start, and 40,000 comments on one 520 KB line took 25 s with it.
 */
function posicionador(texto) {
  const inicios = [0]
  for (let k = texto.indexOf('\n'); k !== -1; k = texto.indexOf('\n', k + 1)) inicios.push(k + 1)
  let ultimo = { indice: 0, linha: 1, coluna: 1 }
  return (indice) => {
    const linha = primeiroApos(inicios, indice)
    let k = inicios[linha - 1]
    let coluna = 1
    if (ultimo.linha === linha && ultimo.indice <= indice) {
      k = ultimo.indice
      coluna = ultimo.coluna
    }
    for (; k < indice; k++) {
      const u = texto.charCodeAt(k)
      if (u >= 0xd800 && u <= 0xdbff && k + 1 < indice) {
        const v = texto.charCodeAt(k + 1)
        if (v >= 0xdc00 && v <= 0xdfff) k++
      }
      coluna++
    }
    ultimo = { indice, linha, coluna }
    return { linha, coluna }
  }
}

/** A comment body without the block quote markers that continue its lines. */
const semMarcasDeCitacao = (corpo, antes) =>
  antes !== null && /^[ \t]*>/.test(antes) ? corpo.replace(/\n[ \t]*(?:>[ \t]?)+/g, '\n') : corpo

/**
 * What a rendered page shows as code and which comments it hides, read in ONE
 * pass from left to right, because CommonMark gives the construct that STARTS
 * first the text: a backtick or a fence line inside an HTML comment is part of
 * the comment and pairs with nothing, and a comment opener inside a code span is
 * code. Built as two passes (masks, then comments), a backtick inside one comment
 * paired with a lone backtick after the next comment and masked the directive
 * between them, and a fence opener in one comment and a closer in another masked
 * everything in between; GitHub rendered both directives as nothing.
 *
 * `{ mascara, comentarios }`. The mask covers only closed constructs:
 *   front matter from a first-line `---` to the next `---` or `...`;
 *   a top-level fence, when its closer exists (same character, at least as long);
 *   a backtick run paired with the next run of the same length before the
 *     paragraph ends: a blank line, a line that opens a comment or a fence (at
 *     the top or inside a container), or a block quote that starts after a line
 *     that was not one.
 * Indented code and unclosed fences are NOT masked: measured, masking them adds
 * no true finding and would let a real comment through, while not masking them
 * added 2 visible regions over the local repositories and 3 over the public files.
 *
 * A comment is `{ inicio, fim, forma, recipiente, corpo }`. forma 'bloco' when
 * only 0-3 spaces or container markers (`>`, `-`, `*`, `+`, `1.`) precede it on
 * its line (CommonMark HTML block type 2, which a list item or a block quote
 * opens too), 'inline' otherwise, 'jsx' for an MDX `{/* *\/}` comment. A block
 * comment that never closes runs to the end of the file, and so does one after
 * whitespace only: in a list item that is the rest of the page, which GitHub hid.
 * An inline comment closes only inside its paragraph; unclosed there, it is
 * literal text and the scan goes on past it.
 */
function estrutura(texto, { mdx = false } = {}) {
  const n = texto.length
  const m = new Uint8Array(n)
  const marcar = (a, b) => m.fill(1, a, Math.min(b, n))
  const comentarios = []

  const inicios = [0]
  for (let k = texto.indexOf('\n'); k !== -1; k = texto.indexOf('\n', k + 1)) inicios.push(k + 1)
  const fimDaLinha = (i) => (i + 1 < inicios.length ? inicios[i + 1] - 1 : n)
  const linha = (i) => texto.slice(inicios[i], fimDaLinha(i))

  let pos = 0
  if (linha(0) === '---') {
    for (let k = 1; k < inicios.length; k++) {
      const l = linha(k)
      if (l === '---' || l === '...') {
        marcar(0, fimDaLinha(k))
        pos = fimDaLinha(k)
        break
      }
    }
  }

  // Per line: fence openers, fence closers by character, and paragraph breaks.
  const abridoras = []
  const fechadoras = { '`': [], '~': [] }
  const quebras = []
  let citacaoAntes = false
  for (let i = 0; i < inicios.length; i++) {
    const l = linha(i)
    const abre = ABRE_CERCA.exec(l)
    if (abre && !(abre[1][0] === '`' && abre[2].includes('`'))) abridoras.push(i)
    const fecha = FECHA_CERCA.exec(l)
    if (fecha) fechadoras[fecha[1][0]].push([i, fecha[1].length])
    const prefixo = RECIPIENTE.exec(l)[0]
    const citacao = /^ {0,3}>/.test(l)
    if (
      i > 0 &&
      (/^[ \t]*$/.test(l) ||
        (citacao && !citacaoAntes) ||
        INTERROMPE.test(prefixo ? l.slice(prefixo.length) : l))
    )
      quebras.push(inicios[i])
    citacaoAntes = citacao
  }
  const linhasFechadoras = {
    '`': fechadoras['`'].map((x) => x[0]),
    '~': fechadoras['~'].map((x) => x[0]),
  }
  const haQuebra = (a, b) => {
    const q = primeiroApos(quebras, a)
    return q < quebras.length && quebras[q] <= b
  }

  const corridas = []
  const porTamanho = new Map()
  for (const x of texto.matchAll(/`+/g)) {
    corridas.push(x.index)
    const lista = porTamanho.get(x[0].length)
    if (lista) lista.push(x.index)
    else porTamanho.set(x[0].length, [x.index])
  }
  const tamanhoDa = (indice) => {
    let k = indice
    while (texto.charCodeAt(k) === 0x60) k++
    return k - indice
  }

  const ABRE_JSX = /\{[ \t\n]*\/\*/g
  const FECHA_JSX = /\*\/[ \t\n]*\}/g
  let ai = 0
  let ri = 0
  let proximoComentario = -2
  let proximoFecho = -2
  let proximoJsx = mdx ? -2 : -1
  let tamanhoJsx = 0
  let semFimJsx = false

  while (pos < n) {
    while (ai < abridoras.length && inicios[abridoras[ai]] < pos) ai++
    while (ri < corridas.length && corridas[ri] < pos) ri++
    if (proximoComentario !== -1 && proximoComentario < pos)
      proximoComentario = texto.indexOf('<!--', pos)
    if (proximoJsx !== -1 && proximoJsx < pos) {
      ABRE_JSX.lastIndex = pos
      const jsx = ABRE_JSX.exec(texto)
      proximoJsx = jsx ? jsx.index : -1
      tamanhoJsx = jsx ? jsx[0].length : 0
    }
    const candidatos = [
      ai < abridoras.length ? inicios[abridoras[ai]] : Infinity,
      ri < corridas.length ? corridas[ri] : Infinity,
      proximoComentario === -1 ? Infinity : proximoComentario,
      proximoJsx === -1 ? Infinity : proximoJsx,
    ]
    const menor = Math.min(...candidatos)
    if (menor === Infinity) break
    const qual = candidatos.indexOf(menor)

    if (qual === 0) {
      const i = abridoras[ai]
      const [, cerca] = ABRE_CERCA.exec(linha(i))
      const lista = fechadoras[cerca[0]]
      let fecha = -1
      for (let k = primeiroApos(linhasFechadoras[cerca[0]], i); k < lista.length; k++) {
        if (lista[k][1] >= cerca.length) {
          fecha = lista[k][0]
          break
        }
      }
      ai++
      if (fecha === -1) continue
      marcar(inicios[i], fimDaLinha(fecha))
      pos = fimDaLinha(fecha)
    } else if (qual === 1) {
      const ia = corridas[ri]
      const na = tamanhoDa(ia)
      const mesmas = porTamanho.get(na)
      const b = primeiroApos(mesmas, ia)
      const ib = b < mesmas.length ? mesmas[b] : -1
      if (ib !== -1 && !haQuebra(ia, ib)) {
        marcar(ia, ib + na)
        pos = ib + na
      } else pos = ia + na
    } else if (qual === 2) {
      const k = proximoComentario
      const inicioDaLinha = inicios[primeiroApos(inicios, k) - 1]
      const antes = k - inicioDaLinha <= PREFIXO_MAXIMO ? texto.slice(inicioDaLinha, k) : null
      const prefixo = antes === null ? '' : RECIPIENTE.exec(antes)[0]
      const topo = antes !== null && /^ {0,3}$/.test(antes)
      const recipiente = !topo && prefixo !== '' && /^ {0,3}$/.test(antes.slice(prefixo.length))
      const soEspaco = antes !== null && /^[ \t]*$/.test(antes)
      const forma = topo || recipiente ? 'bloco' : 'inline'
      let fim
      if (texto.startsWith('<!-->', k)) fim = k + 5
      else if (texto.startsWith('<!--->', k)) fim = k + 6
      else {
        if (proximoFecho !== -1 && proximoFecho < k + 4) proximoFecho = texto.indexOf('-->', k + 4)
        fim = proximoFecho === -1 ? -1 : proximoFecho + 3
        if (fim !== -1 && forma === 'inline' && !soEspaco && haQuebra(k, proximoFecho)) fim = -1
      }
      if (fim === -1) {
        if (forma === 'bloco' || soEspaco) {
          comentarios.push({
            inicio: k,
            fim: n,
            forma,
            recipiente,
            corpo: semMarcasDeCitacao(texto.slice(k + 4), antes),
          })
          break
        }
        pos = k + 4
        continue
      }
      comentarios.push({
        inicio: k,
        fim,
        forma,
        recipiente,
        corpo: semMarcasDeCitacao(texto.slice(k + 4, Math.max(k + 4, fim - 3)), antes),
      })
      pos = fim
    } else {
      const abertura = tamanhoJsx
      let fecho = null
      if (!semFimJsx) {
        FECHA_JSX.lastIndex = menor + abertura
        fecho = FECHA_JSX.exec(texto)
        if (!fecho) semFimJsx = true
      }
      // An expression that never closes does not compile, so nothing renders.
      if (!fecho) {
        pos = menor + abertura
        continue
      }
      const fim = fecho.index + fecho[0].length
      comentarios.push({
        inicio: menor,
        fim,
        forma: 'jsx',
        recipiente: false,
        corpo: texto.slice(menor + abertura, fecho.index),
      })
      pos = fim
    }
  }
  return { mascara: m, comentarios }
}

/** The code and front matter mask of `estrutura`: where a comment is shown, not hidden. */
export function mascaras(texto) {
  return estrutura(texto).mascara
}

// ═══════════════════════════════════════════════════════════════ the regions

// A link reference definition, matched sticky where a line's container prefix
// ends. Every repetition here has one way to match: the label and the title
// cannot hold a bracket or quote of their own kind nor a blank line, and a title
// needs whitespace before it. The first draft that put the container prefix
// inside the pattern backtracked exponentially on nested block quote markers.
const TITULO_LINHA = '(?:[^"\\\\\\n]|\\\\.|\\n(?![ \\t>]*\\n)){0,999}'
const DEFINICAO = new RegExp(
  '\\[((?:[^\\[\\]\\n\\\\]|\\\\.|\\n(?![ \\t>]*\\n)){1,999})\\]:[ \\t]*(?:\\n[ \\t>]*)?' +
    '(<[^>\\n]*>|\\S+)' +
    `(?:(?:[ \\t]+(?:\\n[ \\t>]*)?|[ \\t]*\\n[ \\t>]*)("${TITULO_LINHA}"|` +
    `'${TITULO_LINHA.replace('"', "'")}'|\\(${TITULO_LINHA.replace('"', ')')}\\)))?[ \\t]*$`,
  'my',
)
const USO = /\[((?:[^[\]\n]|\n(?![ \t]*\n)){1,999})\](?:\[([^[\]\n]{0,999})\])?/g
const normalizarRotulo = (s) =>
  s
    .replace(/\n[ \t]*(?:>[ \t]?)*/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const ATRIBUTO = /([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g
// Any zero a stylesheet reads as zero: 0, 00, 0.0, .0, with or without a unit.
const CSS_OCULTO =
  /display\s*:\s*none|visibility\s*:\s*hidden|(?:font-size|opacity)\s*:\s*\+?(?:0+(?:\.0*)?|\.0+)(?:[a-z]+|%)?\s*(?:!\s*important\s*)?(?:;|$)/i
const LIMITE_DA_TAG = 4096

/**
 * `{ nome, atributos, fim }` of an opening tag at `k`, or null. The attributes
 * are walked with their quotes, so a `>` inside a quoted value does not end the
 * tag (`<p title="a>b" hidden>` lost its hidden attribute to a `[^>]*` pattern).
 */
function lerAbertura(texto, k) {
  const nome = /^<([a-zA-Z][\w-]*)(?=[\s/>])/.exec(texto.slice(k, k + 66))
  if (!nome) return null
  let aspas = null
  const limite = Math.min(texto.length, k + LIMITE_DA_TAG)
  for (let i = k + nome[0].length; i < limite; i++) {
    const ch = texto[i]
    if (aspas) {
      if (ch === aspas) aspas = null
    } else if (ch === '"' || ch === "'") aspas = ch
    else if (ch === '>')
      return {
        nome: nome[1].toLowerCase(),
        atributos: texto.slice(k + nome[0].length, i),
        fim: i + 1,
      }
  }
  return null
}

/** 'estilo', 'hidden' or null for the attribute text of a tag. */
function formaOculta(atributos) {
  let estilo = null
  let oculto = false
  for (const a of atributos.matchAll(ATRIBUTO)) {
    const nome = a[1].toLowerCase()
    if (nome === 'hidden') oculto = true
    else if (nome === 'style' && a[2] !== undefined)
      estilo = a[2].replace(/^(["'])([\s\S]*)\1$/, '$2')
  }
  if (estilo !== null && CSS_OCULTO.test(estilo)) return 'estilo'
  return oculto ? 'hidden' : null
}

/**
 * Every hidden region of an LF text, in order of appearance within each kind:
 * `[{ tipo: 'comentario'|'definicao'|'elemento', forma, recipiente, linha, coluna, corpo, indice }]`.
 * `mdx` reads `{/* ... *\/}` as a comment too: MDX 2 and 3 refuse `<!-- -->`, and
 * that expression comment is how an .mdx page hides text.
 *
 *   comentario  see `estrutura`.
 *   definicao   a link reference definition, at the top or inside a list item or
 *               a block quote, with a label that may wrap one line, whose label
 *               nothing uses outside the masks, the comments and every
 *               definition; `[label](...)` is an inline link with its own
 *               destination and no use. corpo is the label, a line break, and the
 *               title. The line break matters: joined by a space, a title that
 *               opens by naming its addressee no longer starts the body, and the
 *               vocative family missed it (measured).
 *   elemento    an opening tag outside the masks and the comments whose style
 *               hides it (display, visibility, a zero font size or opacity,
 *               quoted or not) or that carries the hidden attribute, up to its
 *               matching closing tag of the same name in any case (or the first
 *               one, when nesting leaves it unmatched), tags blanked. No closer,
 *               no region.
 */
export function regioesOcultas(texto, { mdx = false } = {}) {
  const { mascara: m, comentarios } = estrutura(texto, { mdx })
  const posicao = posicionador(texto)
  const regioes = []
  for (const c of comentarios) {
    const { linha, coluna } = posicao(c.inicio)
    regioes.push({
      tipo: 'comentario',
      forma: c.forma,
      recipiente: c.recipiente,
      linha,
      coluna,
      corpo: c.corpo,
      indice: c.inicio,
    })
  }

  const definicoes = []
  let fimDaUltima = 0
  for (let l = 0; l < texto.length; l = texto.indexOf('\n', l) + 1 || texto.length) {
    if (l < fimDaUltima) continue
    const ate = texto.indexOf('\n', l)
    const prefixo = RECIPIENTE.exec(
      texto.slice(l, Math.min(ate === -1 ? texto.length : ate, l + PREFIXO_MAXIMO)),
    )[0]
    let inicio = l + prefixo.length
    for (let s = 0; s < 3 && texto[inicio] === ' '; s++) inicio++
    if (texto[inicio] !== '[' || m[inicio] || dentroDe(comentarios, inicio)) continue
    DEFINICAO.lastIndex = inicio
    const x = DEFINICAO.exec(texto)
    if (!x) continue
    const titulo = x[3] ? x[3].slice(1, -1).replace(/\n[ \t]*(?:>[ \t]?)+/g, '\n') : ''
    fimDaUltima = inicio + x[0].length
    definicoes.push({ rotulo: x[1], titulo, inicio, fim: fimDaUltima })
  }
  if (definicoes.length) {
    const usados = new Set()
    for (const x of texto.matchAll(USO)) {
      if (m[x.index] || dentroDe(definicoes, x.index) || dentroDe(comentarios, x.index)) continue
      if (x[2] === undefined && texto[x.index + x[0].length] === '(') continue
      usados.add(normalizarRotulo(x[2] ? x[2] : x[1]))
    }
    for (const d of definicoes) {
      if (usados.has(normalizarRotulo(d.rotulo))) continue
      const { linha, coluna } = posicao(d.inicio)
      regioes.push({
        tipo: 'definicao',
        forma: 'definicao',
        recipiente: false,
        linha,
        coluna,
        corpo: `${d.rotulo.replace(/\n[ \t]*(?:>[ \t]?)*/g, ' ')}\n${d.titulo}`,
        indice: d.inicio,
      })
    }
  }

  const pares = new Map()
  const fechamento = (nome, k) => {
    let p = pares.get(nome)
    if (!p) {
      p = { casados: new Map(), fechos: [] }
      const pilha = []
      for (const t of texto.matchAll(new RegExp(`<(/?)${nome}(?=[\\s/>])`, 'gi'))) {
        if (m[t.index] || dentroDe(comentarios, t.index)) continue
        if (t[1]) {
          p.fechos.push(t.index)
          if (pilha.length) p.casados.set(pilha.pop(), t.index)
        } else pilha.push(t.index)
      }
      pares.set(nome, p)
    }
    if (p.casados.has(k)) return p.casados.get(k)
    const f = primeiroApos(p.fechos, k)
    return f < p.fechos.length ? p.fechos[f] : -1
  }
  let maior = -2
  for (let k = texto.indexOf('<'); k !== -1; k = texto.indexOf('<', k + 1)) {
    if (m[k]) continue
    // No `>` within reach, no tag: 100,000 `<a ` with none walked 400 M units.
    if (maior !== -1 && maior < k) maior = texto.indexOf('>', k)
    if (maior === -1) break
    if (maior - k > LIMITE_DA_TAG) continue
    const tag = lerAbertura(texto, k)
    if (!tag || dentroDe(comentarios, k)) continue
    const forma = formaOculta(tag.atributos)
    if (!forma) continue
    const fecha = fechamento(tag.nome, k)
    if (fecha === -1) continue
    const { linha, coluna } = posicao(k)
    regioes.push({
      tipo: 'elemento',
      forma,
      recipiente: false,
      linha,
      coluna,
      corpo: texto.slice(tag.fim, Math.max(tag.fim, fecha)).replace(/<[^<>]*>/g, ' '),
      indice: k,
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
// them, and without this shape their words hit the addressee vocabulary. The
// shape excuses the namespaced token ONLY. Across 478 + 32 + 16 + 1 public
// markers and 41 + 1 + 5 + 1 + 7 in node_modules, the most bare words after the
// token that were not attribute pairs was 3 (`automd:badges bundlejs
// packagephobia codecov`), apart from the all-contributors notice, which carries
// no family anyway. Excusing any number of words let `meta:x` followed by an
// override, or `Claude:note` followed by an order, pass as a marker.
const MARCADOR_GENERICO =
  /^\s*((?:(?:BEGIN|END|START|STOP|begin|end|start|stop)\s+)?[\w.@/+-]+(?::[\w.@/+-]+)+)((?:\s+[\w.@/+-]+(?:=\S+)?)*)\s*$/
const PALAVRAS_SOLTAS_DE_MARCADOR = 3

/** A generic marker: the shape, at most three bare words after it, and no family in them. */
function ehMarcadorGenerico(corpo) {
  const m = MARCADOR_GENERICO.exec(corpo)
  if (!m) return false
  const soltas = m[2].split(/\s+/).filter((a) => a && !a.includes('='))
  if (soltas.length > PALAVRAS_SOLTAS_DE_MARCADOR) return false
  return !FAMILIAS.some(([, testa]) => testa(m[2]))
}

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

// A code span, an href/src/srcset value, a link destination: the pieces of a body
// that name something rather than say something.
const PEDACOS = /`([^`\n]*)`|\b(?:href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')|\]\(([^)]*)\)/gi

/**
 * The body with its pieces blanked (`abrir` false), or with the pieces that
 * read as prose (whitespace inside and at least 3 words) kept as plain text.
 */
function limpar(corpo, abrir) {
  return corpo.replace(PEDACOS, (_, codigo, duplas, simples, destino) => {
    const dentro = codigo ?? duplas ?? simples ?? destino
    const antes = destino !== undefined ? ']' : ''
    if (abrir && /\S\s+\S/.test(dentro) && contarPalavras(dentro) >= 3) return `${antes} ${dentro} `
    return codigo !== undefined ? ' ' : antes
  })
}

/**
 * `{ classe: 'marcador'|'curto'|'prosa', palavras, familias }` for a region body.
 * A marker is no prose; fewer than 3 words is too short to address anyone; a
 * prose region is a directive when `familias` is not empty.
 *
 * Code spans, link destinations and href/src values are blanked, so an address
 * or a code sample is not read as an order. But inside a hidden region a code
 * span is hidden too, and blanking every one erased a directive wrapped whole in
 * backticks, or put in the parentheses of a link: the body fell under 3 words.
 * So the words are counted, and the families run a second time, on the body with
 * the pieces that read as prose kept; a family counts when either reading fires.
 */
export function avaliarRegiao(corpoCru) {
  if (MARCADOR_EXATO.some((re) => re.test(corpoCru)))
    return { classe: 'marcador', palavras: 0, familias: [] }
  const limpo = limpar(corpoCru, false)
  if (ehMarcadorGenerico(limpo)) return { classe: 'marcador', palavras: 0, familias: [] }
  const aberto = limpar(corpoCru, true)
  const palavras = contarPalavras(aberto)
  if (palavras < 3) return { classe: 'curto', palavras, familias: [] }
  return {
    classe: 'prosa',
    palavras,
    familias: FAMILIAS.filter(
      ([, testa]) => testa(limpo) || (aberto !== limpo && testa(aberto)),
    ).map(([nome]) => nome),
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
