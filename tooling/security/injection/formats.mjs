// formats — the zero-dependency readers the injection rules parse config with.
//
// WHY PARSE AND NOT GREP. A key written with a JSON escape is invisible to a
// regex and real to the client: measured in phase 1,
// a Claude settings key with one letter written as a unicode escape parses to
// the plain key, and a raw-text match misses it. So every comparison a rule
// makes happens AFTER decoding, on what the client would read.
//
// WHY OUR OWN READERS. rebar has no dependency in tooling/, and the three
// readers the clients use disagree exactly where an attack lives. JSON.parse
// keeps the LAST duplicate key (measured `{"a":1,"a":2}` gives 2) and throws on
// a comment; VS Code's jsonc-parser is fault tolerant and still returns a
// value from a broken file. A reader that records every duplicate and every
// position lets the rule judge all the values any client might pick.
//
// ─────────────────────────────────────────────────────────────── the API
//
/**
 * @typedef {{ linha: number, coluna: number }} Posicao
 *   1-based. `linha` counts LF only; `coluna` counts CODE POINTS since the line
 *   start (an emoji is one column), the same unit `posicao` in reader.mjs uses.
 *
 * @typedef {{ linha: number, coluna: number, mensagem: string }} ErroDeFormato
 *
 * @typedef {{ ponteiro: string, ocorrencias: Array<{ valor: any, linha: number, coluna: number }> }} Duplicata
 *   `ponteiro` is an RFC 6901 JSON pointer over DECODED keys ('' is the root,
 *   `~` is written `~0` and `/` is written `~1`). `ocorrencias` lists every
 *   definition of that key in source order, the first one included, each with
 *   the position of its key token.
 *
 * lerJsonc(texto, { estrito = false } = {})
 *   -> { valor, duplicatas: Duplicata[], erro: ErroDeFormato | null, posicoes: Map<string, Posicao> }
 *   `estrito: true` is RFC 8259 (what Claude Code accepts). `estrito: false`
 *   also allows `//` and `/* *\/` comments and trailing commas (JSONC). Both
 *   accept one U+FEFF at offset 0. Objects are `Object.create(null)`, so a
 *   `__proto__` key is data, not a prototype. `valor` keeps the LAST duplicate;
 *   callers evaluate every entry of `duplicatas`. On `erro`, `valor` is
 *   `undefined` (no partial value: a broken file is reported, not guessed).
 *   `posicoes` maps each pointer to its key token (object members) or to the
 *   value start (array items and the root).
 *
 * lerToml(texto) -> same shape as lerJsonc.
 *   Comments, [t], [[t]], dotted and quoted keys, basic strings with the escapes
 *   b t n f r " \ uXXXX UXXXXXXXX e xHH, literal strings, both multi-line
 *   strings, multi-line arrays, inline tables (newlines and trailing commas
 *   accepted). Booleans are booleans; numbers, dates and times are kept as
 *   their RAW TEXT (a string). Redefining a key or a table is a duplicate;
 *   anything else outside that subset is `erro`.
 *
 * lerYaml(texto, { ancoras = false } = {}) -> { valor, duplicatas: Duplicata[], erro: ErroDeFormato | null, posicoes: Map<string, Posicao> }
 *   A YAML subset: block mappings and sequences, flow collections (multi-line
 *   too), plain, single- and double-quoted scalars (multi-line too), block
 *   scalars `|` `>` with chomping and indentation indicators, comments. Plain
 *   scalars follow the core schema (null, booleans, numbers). Tags, merge
 *   keys, complex keys, directives and a second document are `erro`, never a
 *   guess. Anchors and aliases are `erro` too unless `ancoras: true`: then
 *   `&name` before a node and `*name` as a whole node are read, the alias
 *   becoming a deep copy of the last node anchored with that name. An unknown
 *   alias, an alias inside its own anchor, an anchor on a mapping key and more
 *   than 100,000 nodes copied through aliases stay `erro`, and `posicoes`
 *   holds only the alias node's own pointer, not the copied children. GitHub
 *   documents anchors and aliases for workflows (and not merge keys): 6 of
 *   3,231 real workflows use them, and 2 of those hide an agent step behind
 *   one. A repeated mapping key is recorded in `duplicatas` the way lerJsonc
 *   records it, and `valor` keeps the last one: lenient loaders do the same,
 *   so the order of the keys decides what those clients read.
 *
 * lerFrontmatter(texto)
 *   -> { presente: boolean, valor: any, duplicatas: Duplicata[], erro: ErroDeFormato | null, posicoes: Map<string, Posicao>, yaml: string, indice: number }
 *   Only when `texto` starts with `---` + newline AND a closing `---` line
 *   exists; otherwise `presente: false, valor: null, erro: null`. Positions and
 *   `erro` are in FILE coordinates. `yaml` is the text between the fences and
 *   `indice` its UTF-16 offset in `texto`, so a caller runs
 *   `escapesDecodificados(fm.yaml, 'yaml')` and adds `fm.indice` to each indice.
 *
 * escapesDecodificados(texto, formato) with formato 'json' | 'json5' | 'yaml' | 'toml'
 *   -> Array<{ indice: number, cp: number, forma: string }>
 *   Escapes that the FORMAT itself decodes, inside string contexts only (not in
 *   comments, not in YAML single-quoted or block scalars, not in TOML literal
 *   strings). A backslash counts only after an even run of backslashes.
 *   `indice` is the UTF-16 offset of the backslash; `cp` the decoded code point
 *   (surrogate pairs joined when both halves are escaped); `forma` is
 *   `<formato>:<escape letter>`, for example 'json:u' or 'yaml:e', and never
 *   spells the escape itself. Reported:
 *     json  \uXXXX (U+0000 omitted: iconv-lite tables carry it), \b, \f
 *     json5 the json set plus \xHH and \v, in double- and single-quoted strings
 *     yaml  \e \xHH \uXXXX \UXXXXXXXX \b \f \0 \a \v \N \_ \L \P (double-quoted)
 *     toml  \e \xHH \uXXXX \UXXXXXXXX \b \f (basic and multi-line basic strings)
 *   Line feed, tab, carriage return, quote and backslash escapes are never
 *   reported: they are the everyday ones.
 */
//
// This file holds no raw control or invisible character, and no escape of one
// spelled as text: every code point below is a hex number, and every table the
// injection rules export is proven not to match this source.

const PROFUNDIDADE_MAXIMA = 512

/**
 * Nodes the aliases of one YAML document may copy. An alias is a copy, so nine
 * levels of ten aliases would build 10^9 nodes from a file of ten lines. The
 * largest of 3,292 real workflows measured on 2026-09-13 parses to 5,374
 * nodes, aliases included, so the cap sits almost twenty times above it.
 */
const LIMITE_DE_COPIA = 100000

/**
 * Which escape dialect a tracked file's extension (reader.mjs extensaoDe) is
 * read with. One map for hidden-unicode and control-bytes, so the two rules
 * never disagree about the same escape: when each kept its own copy, a VS Code
 * workspace was decoded by one and not by the other.
 */
export const FORMATO_POR_EXTENSAO = Object.freeze({
  json: 'json',
  jsonc: 'json',
  // JSON5 strings may be single-quoted and may carry a hex escape, and a JSON5
  // parser decodes both (json5 2.2.3 returns the code point): read as strict
  // JSON, neither was seen.
  json5: 'json5',
  // A VS Code workspace is JSONC, and it is an agent config file.
  'code-workspace': 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
})

class FalhaDeFormato extends Error {
  constructor(mensagem, indice) {
    super(mensagem)
    this.indice = indice
  }
}

// ──────────────────────────────────────────────────────────────── positions

function inicioDasLinhas(texto) {
  const inicios = [0]
  for (let k = texto.indexOf('\n'); k !== -1; k = texto.indexOf('\n', k + 1)) inicios.push(k + 1)
  return inicios
}

function posicaoEm(texto, inicios, indice) {
  let baixo = 0
  let alto = inicios.length - 1
  while (baixo < alto) {
    const meio = (baixo + alto + 1) >> 1
    if (inicios[meio] <= indice) baixo = meio
    else alto = meio - 1
  }
  let coluna = 1
  for (let k = inicios[baixo]; k < indice && k < texto.length; k++) {
    const u = texto.charCodeAt(k)
    if (u >= 0xd800 && u <= 0xdbff && k + 1 < indice) {
      const v = texto.charCodeAt(k + 1)
      if (v >= 0xdc00 && v <= 0xdfff) k++
    }
    coluna++
  }
  return { linha: baixo + 1, coluna }
}

const segmento = (chave) => String(chave).replace(/~/g, '~0').replace(/\//g, '~1')
const filho = (ponteiro, chave) => `${ponteiro}/${segmento(chave)}`
const ehTabela = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const temChave = (objeto, chave) => Object.prototype.hasOwnProperty.call(objeto, chave)
const HEX = /^[0-9a-fA-F]+$/
const hexDe = (texto, inicio, tamanho) => {
  const trecho = texto.slice(inicio, inicio + tamanho)
  return trecho.length === tamanho && HEX.test(trecho) ? parseInt(trecho, 16) : -1
}

/** Records a repeated key: the first occurrence is fetched only when needed. */
function coletorDeDuplicatas() {
  const porPonteiro = new Map()
  return {
    registrar(ponteiro, primeira, nova) {
      let d = porPonteiro.get(ponteiro)
      if (!d) {
        d = { ponteiro, ocorrencias: [primeira] }
        porPonteiro.set(ponteiro, d)
      }
      d.ocorrencias.push(nova)
    },
    lista: () => [...porPonteiro.values()],
  }
}

// ═══════════════════════════════════════════════════════════════ JSON / JSONC

// Built from numbers so the source spells no control escape.
const ESCAPES_JSON = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: String.fromCodePoint(0x08),
  f: String.fromCodePoint(0x0c),
  n: String.fromCodePoint(0x0a),
  r: String.fromCodePoint(0x0d),
  t: String.fromCodePoint(0x09),
}
const NUMERO_JSON = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y

export function lerJsonc(texto, { estrito = false } = {}) {
  const fonte = String(texto)
  const n = fonte.length
  const inicios = inicioDasLinhas(fonte)
  const onde = (k) => posicaoEm(fonte, inicios, k)
  const duplicatas = coletorDeDuplicatas()
  const posicoes = new Map()
  let i = fonte.charCodeAt(0) === 0xfeff ? 1 : 0

  const falhar = (mensagem, k = i) => {
    throw new FalhaDeFormato(mensagem, k)
  }

  const espaco = () => {
    while (i < n) {
      const c = fonte.charCodeAt(i)
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        i++
        continue
      }
      if (c === 0x2f && (fonte[i + 1] === '/' || fonte[i + 1] === '*')) {
        if (estrito) falhar('a comment is not JSON, and this file is read as strict JSON')
        if (fonte[i + 1] === '/') {
          const fim = fonte.indexOf('\n', i)
          i = fim === -1 ? n : fim
          continue
        }
        const fim = fonte.indexOf('*/', i + 2)
        if (fim === -1) falhar('unterminated block comment')
        i = fim + 2
        continue
      }
      return
    }
  }

  const cadeia = () => {
    const inicio = i
    i++
    let s = ''
    let trecho = i
    while (i < n) {
      const c = fonte.charCodeAt(i)
      if (c === 0x22) {
        s += fonte.slice(trecho, i)
        i++
        return s
      }
      if (c < 0x20) falhar('raw control character inside a string')
      if (c === 0x5c) {
        s += fonte.slice(trecho, i)
        const e = fonte[i + 1]
        if (e !== undefined && temChave(ESCAPES_JSON, e)) {
          s += ESCAPES_JSON[e]
          i += 2
        } else if (e === 'u') {
          const v = hexDe(fonte, i + 2, 4)
          if (v < 0) falhar('invalid unicode escape')
          // One UTF-16 unit per escape: a pair of escapes joins into one code
          // point, and a lone half stays lone, exactly as JSON.parse does.
          s += String.fromCharCode(v)
          i += 6
        } else falhar('invalid escape')
        trecho = i
        continue
      }
      i++
    }
    return falhar('unterminated string', inicio)
  }

  const valor = (ponteiro, profundidade) => {
    if (profundidade > PROFUNDIDADE_MAXIMA) falhar(`nesting deeper than ${PROFUNDIDADE_MAXIMA}`)
    espaco()
    if (i >= n) falhar('unexpected end of the document')
    const c = fonte[i]
    if (c === '{') {
      i++
      const objeto = Object.create(null)
      const vistas = new Map()
      for (let primeira = true; ; primeira = false) {
        espaco()
        if (fonte[i] === '}') {
          if (!primeira && estrito) falhar('trailing comma')
          i++
          return objeto
        }
        if (fonte[i] !== '"') falhar('expected a key in double quotes')
        const inicioDaChave = i
        const chave = cadeia()
        espaco()
        if (fonte[i] !== ':') falhar('expected a colon')
        i++
        const p = filho(ponteiro, chave)
        const lugar = onde(inicioDaChave)
        const v = valor(p, profundidade + 1)
        const ocorrencia = { valor: v, ...lugar }
        if (vistas.has(chave)) duplicatas.registrar(p, vistas.get(chave), ocorrencia)
        else vistas.set(chave, ocorrencia)
        objeto[chave] = v
        posicoes.set(p, lugar)
        espaco()
        if (fonte[i] === ',') {
          i++
          continue
        }
        if (fonte[i] === '}') {
          i++
          return objeto
        }
        falhar('expected a comma or a closing brace')
      }
    }
    if (c === '[') {
      i++
      const lista = []
      for (let primeira = true; ; primeira = false) {
        espaco()
        if (fonte[i] === ']') {
          if (!primeira && estrito) falhar('trailing comma')
          i++
          return lista
        }
        const p = filho(ponteiro, lista.length)
        espaco()
        posicoes.set(p, onde(i))
        lista.push(valor(p, profundidade + 1))
        espaco()
        if (fonte[i] === ',') {
          i++
          continue
        }
        if (fonte[i] === ']') {
          i++
          return lista
        }
        falhar('expected a comma or a closing bracket')
      }
    }
    if (c === '"') return cadeia()
    for (const [literal, v] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ]) {
      if (fonte.startsWith(literal, i)) {
        i += literal.length
        return v
      }
    }
    NUMERO_JSON.lastIndex = i
    const m = NUMERO_JSON.exec(fonte)
    if (!m) falhar('unexpected token')
    i += m[0].length
    return Number(m[0])
  }

  try {
    espaco()
    posicoes.set('', onde(i))
    const v = valor('', 0)
    espaco()
    if (i < n) falhar('unexpected content after the value')
    return { valor: v, duplicatas: duplicatas.lista(), erro: null, posicoes }
  } catch (e) {
    if (!(e instanceof FalhaDeFormato)) throw e
    return {
      valor: undefined,
      duplicatas: duplicatas.lista(),
      erro: { ...onde(e.indice), mensagem: e.message },
      posicoes,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════ TOML

const ESCAPES_TOML = {
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  f: 0x0c,
  r: 0x0d,
  e: 0x1b,
  '"': 0x22,
  '\\': 0x5c,
}
const CHAVE_NUA = /[A-Za-z0-9_-]+/y
const FICHA_TOML = /[0-9A-Za-z+\-_.:]+/y

export function lerToml(texto) {
  const fonte = String(texto)
  const n = fonte.length
  const inicios = inicioDasLinhas(fonte)
  const onde = (k) => posicaoEm(fonte, inicios, k)
  const duplicatas = coletorDeDuplicatas()
  const posicoes = new Map()
  // How each table came to exist decides whether it may be defined again:
  // one made implicitly by `[a.b]` may still get its own `[a]` header once.
  const origem = new WeakMap()
  const definicoes = new WeakMap()
  const arraysDeTabela = new WeakSet()
  let i = fonte.charCodeAt(0) === 0xfeff ? 1 : 0

  const falhar = (mensagem, k = i) => {
    throw new FalhaDeFormato(mensagem, k)
  }
  const novaTabela = (como) => {
    const t = Object.create(null)
    origem.set(t, como)
    definicoes.set(t, new Map())
    return t
  }
  const raiz = novaTabela('explicita')

  /** Defines `nome` in `tabela`, recording a duplicate when it was already defined. */
  const definir = (tabela, nome, ponteiro, v, k) => {
    const lugar = onde(k)
    const ocorrencia = { valor: v, ...lugar }
    const vistas = definicoes.get(tabela)
    if (vistas.has(nome)) {
      duplicatas.registrar(ponteiro, vistas.get(nome), ocorrencia)
    } else if (temChave(tabela, nome)) {
      // Existed implicitly (a table made by a header path or a dotted key)
      // and is now assigned a value: TOML calls that a redefinition.
      const antes = { valor: tabela[nome], ...(posicoes.get(ponteiro) || lugar) }
      duplicatas.registrar(ponteiro, antes, ocorrencia)
    }
    if (!vistas.has(nome)) vistas.set(nome, ocorrencia)
    tabela[nome] = v
    posicoes.set(ponteiro, lugar)
  }

  const espacos = () => {
    while (fonte[i] === ' ' || fonte[i] === '\t') i++
  }
  const comentario = () => {
    const fim = fonte.indexOf('\n', i)
    i = fim === -1 ? n : fim
  }
  const brancoMultilinha = () => {
    for (;;) {
      espacos()
      if (fonte[i] === '#') comentario()
      else if (fonte[i] === '\n') i++
      else if (fonte[i] === '\r' && fonte[i + 1] === '\n') i += 2
      else return
    }
  }
  const controleProibido = (u) => (u < 0x20 && u !== 0x09) || u === 0x7f

  const escape = () => {
    const e = fonte[i + 1]
    if (e !== undefined && temChave(ESCAPES_TOML, e)) {
      i += 2
      return String.fromCodePoint(ESCAPES_TOML[e])
    }
    const tamanho = e === 'x' ? 2 : e === 'u' ? 4 : e === 'U' ? 8 : 0
    if (!tamanho) falhar('invalid escape in a basic string')
    const v = hexDe(fonte, i + 2, tamanho)
    if (v < 0 || v > 0x10ffff || (v >= 0xd800 && v <= 0xdfff)) {
      falhar('the escape is not a Unicode scalar value')
    }
    i += 2 + tamanho
    return String.fromCodePoint(v)
  }

  const basica = () => {
    const inicio = i
    i++
    let s = ''
    for (;;) {
      if (i >= n) falhar('unterminated string', inicio)
      const c = fonte[i]
      if (c === '"') {
        i++
        return s
      }
      if (c === '\n' || c === '\r') falhar('a basic string cannot span lines', inicio)
      if (c === '\\') {
        s += escape()
        continue
      }
      if (controleProibido(fonte.charCodeAt(i))) falhar('raw control character inside a string')
      s += c
      i++
    }
  }

  const basicaMultilinha = () => {
    const inicio = i
    i += 3
    if (fonte[i] === '\n') i++
    else if (fonte[i] === '\r' && fonte[i + 1] === '\n') i += 2
    let s = ''
    for (;;) {
      if (i >= n) falhar('unterminated multi-line string', inicio)
      if (fonte.startsWith('"""', i)) {
        let aspas = 3
        while (fonte[i + aspas] === '"' && aspas < 5) aspas++
        s += '"'.repeat(aspas - 3)
        i += aspas
        return s
      }
      const c = fonte[i]
      if (c === '\\') {
        // A backslash that ends a line trims the break and every blank after it.
        let k = i + 1
        while (fonte[k] === ' ' || fonte[k] === '\t') k++
        if (fonte[k] === '\n' || (fonte[k] === '\r' && fonte[k + 1] === '\n')) {
          i = k
          while (i < n && /[ \t\r\n]/.test(fonte[i])) i++
          continue
        }
        s += escape()
        continue
      }
      const u = fonte.charCodeAt(i)
      if (controleProibido(u) && u !== 0x0a && !(u === 0x0d && fonte[i + 1] === '\n')) {
        falhar('raw control character inside a string')
      }
      s += c
      i++
    }
  }

  const literal = () => {
    const inicio = i
    const fim = fonte.indexOf("'", i + 1)
    const quebra = fonte.indexOf('\n', i + 1)
    if (fim === -1 || (quebra !== -1 && quebra < fim)) falhar('unterminated literal string', inicio)
    const s = fonte.slice(i + 1, fim)
    for (let k = 0; k < s.length; k++) {
      if (controleProibido(s.charCodeAt(k)))
        falhar('raw control character inside a string', i + 1 + k)
    }
    i = fim + 1
    return s
  }

  const literalMultilinha = () => {
    const inicio = i
    i += 3
    if (fonte[i] === '\n') i++
    else if (fonte[i] === '\r' && fonte[i + 1] === '\n') i += 2
    const fim = fonte.indexOf("'''", i)
    if (fim === -1) falhar('unterminated multi-line literal string', inicio)
    let aspas = 3
    while (fonte[fim + aspas] === "'" && aspas < 5) aspas++
    const s = fonte.slice(i, fim) + "'".repeat(aspas - 3)
    i = fim + aspas
    return s
  }

  const chave = () => {
    const partes = []
    for (;;) {
      espacos()
      const k = i
      let nome
      if (fonte.startsWith('"""', i) || fonte.startsWith("'''", i)) {
        falhar('a multi-line string cannot be a key')
      }
      if (fonte[i] === '"') nome = basica()
      else if (fonte[i] === "'") nome = literal()
      else {
        CHAVE_NUA.lastIndex = i
        const m = CHAVE_NUA.exec(fonte)
        if (!m) falhar('expected a key')
        nome = m[0]
        i += nome.length
      }
      partes.push({ nome, k })
      espacos()
      if (fonte[i] !== '.') return partes
      i++
    }
  }

  const valorToml = (ponteiro, profundidade) => {
    if (profundidade > PROFUNDIDADE_MAXIMA) falhar(`nesting deeper than ${PROFUNDIDADE_MAXIMA}`)
    const c = fonte[i]
    if (c === '"') return fonte.startsWith('"""', i) ? basicaMultilinha() : basica()
    if (c === "'") return fonte.startsWith("'''", i) ? literalMultilinha() : literal()
    if (c === '[') {
      i++
      const lista = []
      for (;;) {
        brancoMultilinha()
        if (fonte[i] === ']') {
          i++
          return lista
        }
        const p = filho(ponteiro, lista.length)
        posicoes.set(p, onde(i))
        lista.push(valorToml(p, profundidade + 1))
        brancoMultilinha()
        if (fonte[i] === ',') {
          i++
          continue
        }
        if (fonte[i] === ']') {
          i++
          return lista
        }
        falhar('expected a comma or a closing bracket')
      }
    }
    if (c === '{') {
      i++
      const tabela = novaTabela('inline')
      for (;;) {
        brancoMultilinha()
        if (fonte[i] === '}') {
          i++
          return tabela
        }
        parChaveValor(tabela, ponteiro, profundidade + 1)
        brancoMultilinha()
        if (fonte[i] === ',') {
          i++
          continue
        }
        if (fonte[i] === '}') {
          i++
          return tabela
        }
        falhar('expected a comma or a closing brace')
      }
    }
    for (const [literalBooleano, v] of [
      ['true', true],
      ['false', false],
    ]) {
      if (
        fonte.startsWith(literalBooleano, i) &&
        !/[A-Za-z0-9_-]/.test(fonte[i + literalBooleano.length] || '')
      ) {
        i += literalBooleano.length
        return v
      }
    }
    FICHA_TOML.lastIndex = i
    const m = FICHA_TOML.exec(fonte)
    if (!m || !/^[+-]?(?:[0-9]|inf|nan)/.test(m[0])) falhar('expected a value')
    let ficha = m[0]
    i += ficha.length
    // A date and a time may be separated by one space: 1979-05-27 07:32:00Z.
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(ficha) && /^ [0-9]{2}:/.test(fonte.slice(i, i + 4))) {
      FICHA_TOML.lastIndex = i + 1
      const hora = FICHA_TOML.exec(fonte)
      ficha += ` ${hora[0]}`
      i += 1 + hora[0].length
    }
    return ficha
  }

  const parChaveValor = (tabela, ponteiroBase, profundidade) => {
    const partes = chave()
    if (fonte[i] !== '=') falhar('expected =')
    i++
    espacos()
    let alvo = tabela
    let ponteiro = ponteiroBase
    for (const { nome, k } of partes.slice(0, -1)) {
      ponteiro = filho(ponteiro, nome)
      const existente = temChave(alvo, nome) ? alvo[nome] : undefined
      if (existente === undefined) {
        const nova = novaTabela(origem.get(alvo) === 'inline' ? 'inline' : 'pontilhada')
        alvo[nome] = nova
        posicoes.set(ponteiro, onde(k))
        alvo = nova
      } else if (ehTabela(existente) && origem.get(existente) !== 'inline') {
        alvo = existente
      } else {
        const nova = novaTabela('pontilhada')
        definir(alvo, nome, ponteiro, nova, k)
        alvo = nova
      }
    }
    const { nome, k } = partes[partes.length - 1]
    ponteiro = filho(ponteiro, nome)
    const v = valorToml(ponteiro, profundidade)
    definir(alvo, nome, ponteiro, v, k)
  }

  let atual = raiz
  let ponteiroAtual = ''

  const cabecalho = () => {
    const duplo = fonte.startsWith('[[', i)
    i += duplo ? 2 : 1
    const partes = chave()
    if (duplo) {
      if (!fonte.startsWith(']]', i)) falhar('expected ]]')
      i += 2
    } else {
      if (fonte[i] !== ']') falhar('expected ]')
      i++
    }
    let alvo = raiz
    let ponteiro = ''
    for (const { nome, k } of partes.slice(0, -1)) {
      ponteiro = filho(ponteiro, nome)
      const existente = temChave(alvo, nome) ? alvo[nome] : undefined
      if (existente === undefined) {
        const nova = novaTabela('implicita')
        alvo[nome] = nova
        posicoes.set(ponteiro, onde(k))
        alvo = nova
      } else if (Array.isArray(existente) && arraysDeTabela.has(existente)) {
        ponteiro = filho(ponteiro, existente.length - 1)
        alvo = existente[existente.length - 1]
      } else if (ehTabela(existente) && origem.get(existente) !== 'inline') {
        alvo = existente
      } else {
        const nova = novaTabela('implicita')
        definir(alvo, nome, ponteiro, nova, k)
        alvo = nova
      }
    }
    const { nome, k } = partes[partes.length - 1]
    ponteiro = filho(ponteiro, nome)
    const existente = temChave(alvo, nome) ? alvo[nome] : undefined
    if (duplo) {
      let lista = existente
      if (!(Array.isArray(lista) && arraysDeTabela.has(lista))) {
        lista = []
        arraysDeTabela.add(lista)
        if (existente === undefined) {
          alvo[nome] = lista
          definicoes.get(alvo).set(nome, { valor: lista, ...onde(k) })
          posicoes.set(ponteiro, onde(k))
        } else definir(alvo, nome, ponteiro, lista, k)
      }
      const tabela = novaTabela('explicita')
      lista.push(tabela)
      atual = tabela
      ponteiroAtual = filho(ponteiro, lista.length - 1)
      posicoes.set(ponteiroAtual, onde(k))
      return
    }
    if (ehTabela(existente) && origem.get(existente) === 'implicita') {
      origem.set(existente, 'explicita')
      definicoes.get(alvo).set(nome, { valor: existente, ...onde(k) })
      posicoes.set(ponteiro, onde(k))
      atual = existente
    } else {
      const tabela = novaTabela('explicita')
      definir(alvo, nome, ponteiro, tabela, k)
      atual = tabela
    }
    ponteiroAtual = ponteiro
  }

  try {
    while (i < n) {
      espacos()
      if (i >= n) break
      const c = fonte[i]
      if (c === '\n') {
        i++
        continue
      }
      if (c === '\r' && fonte[i + 1] === '\n') {
        i += 2
        continue
      }
      if (c === '#') {
        comentario()
        continue
      }
      if (c === '[') cabecalho()
      else parChaveValor(atual, ponteiroAtual, 0)
      espacos()
      if (fonte[i] === '#') comentario()
      if (i >= n) break
      if (fonte[i] === '\n') i++
      else if (fonte[i] === '\r' && fonte[i + 1] === '\n') i += 2
      else falhar('expected the end of the line')
    }
    posicoes.set('', { linha: 1, coluna: 1 })
    return { valor: raiz, duplicatas: duplicatas.lista(), erro: null, posicoes }
  } catch (e) {
    if (!(e instanceof FalhaDeFormato)) throw e
    return {
      valor: undefined,
      duplicatas: duplicatas.lista(),
      erro: { ...onde(e.indice), mensagem: e.message },
      posicoes,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════ YAML

// YAML double-quoted escapes, as code points. `\x`, `\u` and `\U` are read apart.
const ESCAPES_YAML = {
  0: 0x00,
  a: 0x07,
  b: 0x08,
  t: 0x09,
  '\t': 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  e: 0x1b,
  ' ': 0x20,
  '"': 0x22,
  '/': 0x2f,
  '\\': 0x5c,
  N: 0x85,
  _: 0xa0,
  L: 0x2028,
  P: 0x2029,
}

function resolverPlano(s) {
  if (s === '' || s === '~' || /^(?:null|Null|NULL)$/.test(s)) return null
  if (/^(?:true|True|TRUE)$/.test(s)) return true
  if (/^(?:false|False|FALSE)$/.test(s)) return false
  if (/^[-+]?[0-9]+$/.test(s)) return Number(s)
  if (/^0o[0-7]+$/.test(s)) return parseInt(s.slice(2), 8)
  if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s.slice(2), 16)
  if (/^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/.test(s)) return Number(s)
  if (/^[-+]?\.(?:inf|Inf|INF)$/.test(s)) return s.startsWith('-') ? -Infinity : Infinity
  if (/^\.(?:nan|NaN|NAN)$/.test(s)) return NaN
  return s
}

/**
 * Parses `fonte.slice(inicio, fim)` as one YAML document of the subset, with
 * every position and error in `fonte` coordinates.
 */
function lerYamlEm(fonte, inicio, fim, { ancoras = false } = {}) {
  const inicios = inicioDasLinhas(fonte)
  const onde = (k) => posicaoEm(fonte, inicios, k)
  const posicoes = new Map()
  // Anchors, when the caller asks for them: the last node each name anchored,
  // the names whose node is still being read, and how many nodes the aliases
  // have copied so far (the cap is what stops a billion laughs: 9 levels of
  // 10 aliases would copy 10^9 nodes).
  const ancorados = new Map()
  const abertas = new Map()
  let copiados = 0
  // A repeated key is recorded, not refused: lenient loaders keep the last
  // value, strict ones refuse the file, so the caller must judge every
  // occurrence, and the repetition itself is a failure.
  const duplicatas = coletorDeDuplicatas()
  const linhas = []
  for (let k = inicio; k <= fim;) {
    let quebra = fonte.indexOf('\n', k)
    if (quebra === -1 || quebra > fim) quebra = fim
    let t = fonte.slice(k, quebra)
    if (t.endsWith('\r')) t = t.slice(0, -1)
    if (!(quebra === fim && k === fim)) linhas.push({ ini: k, texto: t })
    k = quebra + 1
  }
  const total = linhas.length
  let l = 0

  const falhar = (mensagem, linha = l, coluna = 0) => {
    const base = linha < total ? linhas[linha].ini : fim
    throw new FalhaDeFormato(mensagem, base + coluna)
  }
  const espacosIniciais = (t) => {
    let r = 0
    while (t[r] === ' ') r++
    return r
  }
  const recuo = (linha) => {
    const t = linhas[linha].texto
    const r = espacosIniciais(t)
    if (t[r] === '\t') falhar('a tab used for indentation', linha, r)
    return r
  }
  const ehVazia = (t) => {
    const s = t.trimStart()
    return s === '' || s.startsWith('#')
  }
  const pularVazias = () => {
    while (l < total && ehVazia(linhas[l].texto)) l++
  }
  // `---` and `...` at column 0 end the node: what follows is judged by the
  // document loop (a second document is an error there, not a bad key).
  const marcaDeDocumento = (t) => /^(?:---|\.\.\.)(?:[ \t]|$)/.test(t)
  const ehItem = (t, c) => t[c] === '-' && (c + 1 >= t.length || t[c + 1] === ' ')
  const comentarioComeca = (t, k) =>
    t[k] === '#' && (k === 0 || t[k - 1] === ' ' || t[k - 1] === '\t')
  const restoVazio = (t, k) => {
    while (t[k] === ' ' || t[k] === '\t') k++
    return k >= t.length || t[k] === '#'
  }

  const SEM_SUPORTE = 'anchors, aliases and tags are not supported'
  /** The name after the `&` or `*` at column k of t, or erro. */
  const nomeDeAncora = (t, k, linha) => {
    const m = /^[^\s,[\]{}]+/.exec(t.slice(k + 1))
    if (!m) falhar('an anchor or alias needs a name', linha, k)
    return m[0]
  }
  /** A deep copy of an anchored node, counted against the expansion cap. */
  const copiar = (v, linha, coluna, profundidade = 0) => {
    if (++copiados > LIMITE_DE_COPIA) falhar('alias expansion too large', linha, coluna)
    if (profundidade > PROFUNDIDADE_MAXIMA) {
      falhar(`nesting deeper than ${PROFUNDIDADE_MAXIMA}`, linha, coluna)
    }
    if (Array.isArray(v)) return v.map((x) => copiar(x, linha, coluna, profundidade + 1))
    if (ehTabela(v)) {
      const copia = Object.create(null)
      for (const k of Object.keys(v)) copia[k] = copiar(v[k], linha, coluna, profundidade + 1)
      return copia
    }
    return v
  }
  /** The node `*nome` at (linha, coluna) stands for. */
  const aliasDe = (nome, linha, coluna) => {
    if (abertas.get(nome)) falhar('alias inside its own anchor', linha, coluna)
    if (!ancorados.has(nome)) falhar('unknown alias', linha, coluna)
    return copiar(ancorados.get(nome), linha, coluna)
  }
  /** Reads the node an anchor names and records it under that name, the last one winning. */
  const ancorar = (nome, ler) => {
    abertas.set(nome, (abertas.get(nome) || 0) + 1)
    const v = ler()
    abertas.set(nome, abertas.get(nome) - 1)
    ancorados.set(nome, v)
    return v
  }
  /** The column after `&nome` and its blanks; another property or an alias there is erro. */
  const depoisDaAncora = (t, k, nome, linha) => {
    let d = k + 1 + nome.length
    while (t[d] === ' ' || t[d] === '\t') d++
    if (d < t.length && '&*!'.includes(t[d])) falhar(SEM_SUPORTE, linha, d)
    return d
  }

  const lerEscapeYaml = (t, k, linha) => {
    const e = t[k + 1]
    if (e !== undefined && temChave(ESCAPES_YAML, e))
      return { texto: String.fromCodePoint(ESCAPES_YAML[e]), passo: 2 }
    const tamanho = e === 'x' ? 2 : e === 'u' ? 4 : e === 'U' ? 8 : 0
    if (!tamanho) falhar('invalid escape in a double-quoted scalar', linha, k)
    const v = hexDe(t, k + 2, tamanho)
    if (v < 0 || v > 0x10ffff) falhar('invalid escape in a double-quoted scalar', linha, k)
    // `\u` halves join through the JS string, as JSON escapes do.
    const texto = e === 'u' ? String.fromCharCode(v) : String.fromCodePoint(v)
    return { texto, passo: 2 + tamanho }
  }

  /** A quoted scalar from (linha, coluna), folded across lines. Returns the end. */
  const citado = (linhaInicial, coluna) => {
    const aspa = linhas[linhaInicial].texto[coluna]
    let li = linhaInicial
    let k = coluna + 1
    let t = linhas[li].texto
    let s = ''
    let protegido = 0
    for (;;) {
      if (k >= t.length) {
        const semEspaco = s.replace(/[ \t]+$/, '')
        s = semEspaco.length < protegido ? s.slice(0, protegido) : semEspaco
        let vazias = 0
        for (;;) {
          li++
          if (li >= total) falhar('unterminated quoted scalar', linhaInicial, coluna)
          t = linhas[li].texto
          if (t.trim() !== '') break
          vazias++
        }
        s += vazias ? '\n'.repeat(vazias) : ' '
        k = 0
        while (t[k] === ' ' || t[k] === '\t') k++
        continue
      }
      const c = t[k]
      if (aspa === "'") {
        if (c === "'") {
          if (t[k + 1] === "'") {
            s += "'"
            k += 2
            continue
          }
          return { valor: s, linha: li, coluna: k + 1 }
        }
        s += c
        k++
        continue
      }
      if (c === '"') return { valor: s, linha: li, coluna: k + 1 }
      if (c === '\\') {
        if (k + 1 >= t.length) {
          // An escaped line break joins the next line with no space.
          li++
          if (li >= total) falhar('unterminated quoted scalar', linhaInicial, coluna)
          t = linhas[li].texto
          k = 0
          while (t[k] === ' ' || t[k] === '\t') k++
          protegido = s.length
          continue
        }
        const { texto, passo } = lerEscapeYaml(t, k, li)
        s += texto
        k += passo
        protegido = s.length
        continue
      }
      s += c
      k++
    }
  }

  const blocoLiteral = (t, j, recuoPai) => {
    const dobrado = t[j] === '>'
    let k = j + 1
    let explicito = 0
    let chomp = ''
    for (let v = 0; v < 2; v++) {
      if (!explicito && /[1-9]/.test(t[k] || '')) explicito = Number(t[k++])
      else if (!chomp && (t[k] === '+' || t[k] === '-')) chomp = t[k++]
    }
    if (!restoVazio(t, k) || (t[k] === '#' && k === j + 1))
      falhar('invalid block scalar header', l, j)
    l++
    let recuoConteudo = explicito ? Math.max(recuoPai, 0) + explicito : -1
    const corpo = []
    while (l < total) {
      const t2 = linhas[l].texto
      if (t2.trim() === '') {
        corpo.push(recuoConteudo >= 0 && t2.length > recuoConteudo ? t2.slice(recuoConteudo) : '')
        l++
        continue
      }
      const r2 = espacosIniciais(t2)
      if (recuoConteudo === -1) {
        if (r2 <= recuoPai) break
        recuoConteudo = r2
      }
      if (r2 < recuoConteudo) break
      corpo.push(t2.slice(recuoConteudo))
      l++
    }
    let fimConteudo = corpo.length
    while (fimConteudo > 0 && corpo[fimConteudo - 1] === '') fimConteudo--
    const conteudo = corpo.slice(0, fimConteudo)
    const finais = corpo.length - fimConteudo
    let s
    if (!dobrado) s = conteudo.join('\n')
    else {
      s = ''
      let anterior = null
      let vazias = 0
      for (const linha of conteudo) {
        if (linha === '') {
          vazias++
          continue
        }
        if (anterior === null) s += '\n'.repeat(vazias) + linha
        else if (/^[ \t]/.test(linha) || /^[ \t]/.test(anterior))
          s += '\n'.repeat(vazias + 1) + linha
        else s += (vazias ? '\n'.repeat(vazias) : ' ') + linha
        anterior = linha
        vazias = 0
      }
    }
    if (chomp === '-') return s
    if (chomp === '+') return (conteudo.length ? `${s}\n` : '') + '\n'.repeat(finais)
    return conteudo.length ? `${s}\n` : ''
  }

  /** A key at column `c` of `t`, or null when the line is not `key: ...`. */
  const chaveDaLinha = (t, c) => {
    const inicial = t[c]
    if (inicial === '"' || inicial === "'") {
      let k = c + 1
      for (; k < t.length; k++) {
        if (inicial === '"' && t[k] === '\\') {
          k++
          continue
        }
        if (t[k] === inicial) {
          if (inicial === "'" && t[k + 1] === "'") {
            k++
            continue
          }
          break
        }
      }
      if (k >= t.length) return null
      let d = k + 1
      while (t[d] === ' ') d++
      if (t[d] !== ':' || !(d + 1 >= t.length || t[d + 1] === ' ' || t[d + 1] === '\t')) return null
      // `t` is always the current line, and the quote closes on it (checked
      // above), so the multi-line reader stays on this one line.
      const { valor } = citado(l, c)
      return { chave: valor, depois: d + 1 }
    }
    if (inicial === '?' && (c + 1 >= t.length || t[c + 1] === ' ')) {
      falhar('complex mapping keys are not supported', l, c)
    }
    if (inicial === '[' || inicial === '{') return null
    for (let k = c; k < t.length; k++) {
      if (comentarioComeca(t, k)) return null
      if (t[k] === ':' && (k + 1 >= t.length || t[k + 1] === ' ' || t[k + 1] === '\t')) {
        const chave = t.slice(c, k).trimEnd()
        if (chave === '') return null
        // `* name:` is no alias but a broken line (a Markdown bullet pasted
        // into a workflow, measured once in 3,292): invalid YAML, not a
        // feature this subset lacks.
        if (ancoras && /^[&*](?:\s|$)/.test(chave)) falhar('an anchor or alias needs a name', l, c)
        if (ancoras && chave[0] === '&') {
          falhar('an anchor on a mapping key is not supported', l, c)
        }
        if ('&*!'.includes(chave[0])) falhar(SEM_SUPORTE, l, c)
        return { chave, depois: k + 1 }
      }
    }
    return null
  }

  const exigirFimDeLinha = (linha, coluna) => {
    if (!restoVazio(linhas[linha].texto, coluna))
      falhar('unexpected content after the value', linha, coluna)
  }

  const fluxo = (linhaInicial, coluna, ponteiro, profundidade) => {
    let li = linhaInicial
    let k = coluna
    const atual = () => (li < total ? linhas[li].texto[k] : undefined)
    const pular = () => {
      for (;;) {
        if (li >= total) falhar('unterminated flow collection', linhaInicial, coluna)
        const t = linhas[li].texto
        while (t[k] === ' ' || t[k] === '\t') k++
        if (k >= t.length || comentarioComeca(t, k)) {
          li++
          k = 0
          continue
        }
        return
      }
    }
    const escalarDeFluxo = () => {
      pular()
      const t = linhas[li].texto
      const c = t[k]
      if (c === '"' || c === "'") {
        const r = citado(li, k)
        li = r.linha
        k = r.coluna
        return r.valor
      }
      if ('&*!'.includes(c)) falhar('anchors, aliases and tags are not supported', li, k)
      if (c === '@' || c === '`')
        falhar('a plain scalar cannot start with a reserved indicator', li, k)
      const inicio = k
      while (k < t.length) {
        const d = t[k]
        if (d === ',' || d === '[' || d === ']' || d === '{' || d === '}') break
        if (d === ':' && (k + 1 >= t.length || ' \t,[]{}'.includes(t[k + 1]))) break
        if (comentarioComeca(t, k)) break
        k++
      }
      return resolverPlano(t.slice(inicio, k).trim())
    }
    const noDeFluxo = (p, prof) => {
      if (prof > PROFUNDIDADE_MAXIMA) falhar(`nesting deeper than ${PROFUNDIDADE_MAXIMA}`, li, k)
      pular()
      const c = atual()
      if (ancoras && (c === '&' || c === '*')) {
        const t = linhas[li].texto
        const nome = nomeDeAncora(t, k, li)
        if (c === '*') {
          const coluna = k
          k += 1 + nome.length
          return aliasDe(nome, li, coluna)
        }
        k = depoisDaAncora(t, k, nome, li)
        return ancorar(nome, () => noDeFluxo(p, prof))
      }
      if (c === '[') {
        k++
        const lista = []
        for (;;) {
          pular()
          if (atual() === ']') {
            k++
            return lista
          }
          const pi = filho(p, lista.length)
          posicoes.set(pi, onde(linhas[li].ini + k))
          let item = noDeFluxo(pi, prof + 1)
          pular()
          if (atual() === ':') {
            k++
            const par = Object.create(null)
            par[String(item)] = pularEValor(filho(pi, String(item)), prof + 1)
            item = par
            pular()
          }
          lista.push(item)
          if (atual() === ',') {
            k++
            continue
          }
          if (atual() === ']') {
            k++
            return lista
          }
          falhar('expected a comma or a closing bracket in a flow sequence', li, k)
        }
      }
      if (c === '{') {
        k++
        const objeto = Object.create(null)
        for (;;) {
          pular()
          if (atual() === '}') {
            k++
            return objeto
          }
          const lugar = onde(linhas[li].ini + k)
          const chaveBruta = escalarDeFluxo()
          const chave = chaveBruta === null ? '' : String(chaveBruta)
          const pc = filho(p, chave)
          const anterior = temChave(objeto, chave)
            ? { valor: objeto[chave], ...posicoes.get(pc) }
            : null
          posicoes.set(pc, lugar)
          pular()
          let v = null
          if (atual() === ':') {
            k++
            v = pularEValor(pc, prof + 1)
            pular()
          }
          if (anterior) duplicatas.registrar(pc, anterior, { valor: v, ...lugar })
          objeto[chave] = v
          if (atual() === ',') {
            k++
            continue
          }
          if (atual() === '}') {
            k++
            return objeto
          }
          falhar('expected a comma or a closing brace in a flow mapping', li, k)
        }
      }
      if (c === ']' || c === '}' || c === ',') falhar('unexpected flow indicator', li, k)
      return escalarDeFluxo()
    }
    const pularEValor = (p, prof) => {
      pular()
      const c = atual()
      if (c === ',' || c === ']' || c === '}') return null
      return noDeFluxo(p, prof)
    }
    const valor = noDeFluxo(ponteiro, profundidade)
    return { valor, linha: li, coluna: k }
  }

  /** A scalar or flow node that starts at (l, coluna), then l moves past it. */
  const escalarEmLinha = (coluna, recuoMinimo, ponteiro, profundidade) => {
    const t = linhas[l].texto
    const c = t[coluna]
    if (c === '"' || c === "'") {
      const r = citado(l, coluna)
      exigirFimDeLinha(r.linha, r.coluna)
      l = r.linha + 1
      return r.valor
    }
    if (c === '[' || c === '{') {
      const r = fluxo(l, coluna, ponteiro, profundidade)
      exigirFimDeLinha(r.linha, r.coluna)
      l = r.linha + 1
      return r.valor
    }
    if (ancoras && c === '*') {
      const nome = nomeDeAncora(t, coluna, l)
      exigirFimDeLinha(l, coluna + 1 + nome.length)
      const v = aliasDe(nome, l, coluna)
      l++
      return v
    }
    if (ancoras && c === '&') {
      const nome = nomeDeAncora(t, coluna, l)
      const depois = depoisDaAncora(t, coluna, nome, l)
      // An anchor alone on its line belongs to a block node below it, which
      // only a key or a sequence item may introduce here.
      if (restoVazio(t, depois)) falhar(SEM_SUPORTE, l, coluna)
      return ancorar(nome, () => escalarEmLinha(depois, recuoMinimo, ponteiro, profundidade))
    }
    if ('&*!'.includes(c)) falhar(SEM_SUPORTE, l, coluna)
    if (c === '@' || c === '`' || c === '%') {
      falhar('a plain scalar cannot start with a reserved indicator', l, coluna)
    }
    let fimDoTexto = t.length
    for (let k = coluna; k < t.length; k++) {
      if (comentarioComeca(t, k)) {
        fimDoTexto = k
        break
      }
    }
    let s = t.slice(coluna, fimDoTexto).trim()
    const temValorDeMapa = (x) => /:(?:[ \t]|$)/.test(x)
    if (temValorDeMapa(s)) falhar('a mapping value is not allowed here', l, coluna)
    const terminouEmComentario = fimDoTexto < t.length
    l++
    let vazias = 0
    let k = l
    while (!terminouEmComentario && k < total) {
      const t2 = linhas[k].texto
      if (t2.trim() === '') {
        vazias++
        k++
        continue
      }
      const r2 = espacosIniciais(t2)
      if (r2 <= recuoMinimo || t2.trimStart().startsWith('#')) break
      let fim2 = t2.length
      for (let q = r2; q < t2.length; q++) {
        if (comentarioComeca(t2, q)) {
          fim2 = q
          break
        }
      }
      const pedaco = t2.slice(r2, fim2).trim()
      if (temValorDeMapa(pedaco)) falhar('a mapping value is not allowed here', k, r2)
      s += (vazias ? '\n'.repeat(vazias) : ' ') + pedaco
      vazias = 0
      k++
      l = k
      if (fim2 < t2.length) break
    }
    return resolverPlano(s)
  }

  const valorDaChave = (t, depois, recuoChave, ponteiro, profundidade) => {
    let j = depois
    while (t[j] === ' ' || t[j] === '\t') j++
    if (j >= t.length || t[j] === '#') {
      l++
      pularVazias()
      if (l >= total) return null
      const r2 = recuo(l)
      if (r2 > recuoChave) return no(recuoChave, ponteiro, profundidade)
      if (r2 === recuoChave && ehItem(linhas[l].texto, r2))
        return sequencia(r2, ponteiro, profundidade)
      return null
    }
    if (ancoras && t[j] === '&') {
      // `key: &name` then a value on this line, a block scalar, or a block node
      // on the lines below: the value is read exactly as without the anchor.
      const nome = nomeDeAncora(t, j, l)
      const depois = depoisDaAncora(t, j, nome, l)
      return ancorar(nome, () => valorDaChave(t, depois, recuoChave, ponteiro, profundidade))
    }
    if (ancoras && t[j] === '*') return escalarEmLinha(j, recuoChave, ponteiro, profundidade)
    if ('&*!'.includes(t[j])) falhar(SEM_SUPORTE, l, j)
    if (t[j] === '|' || t[j] === '>') return blocoLiteral(t, j, recuoChave)
    return escalarEmLinha(j, recuoChave, ponteiro, profundidade)
  }

  const mapa = (r, ponteiro, profundidade) => {
    const objeto = Object.create(null)
    for (;;) {
      pularVazias()
      if (l >= total) break
      const t = linhas[l].texto
      const rr = recuo(l)
      if (rr < r || marcaDeDocumento(t)) break
      if (rr > r) falhar('unexpected indentation', l, rr)
      if (ehItem(t, r)) break
      const k = chaveDaLinha(t, r)
      if (!k) falhar('expected a "key: value" line', l, r)
      if (k.chave === '<<') falhar('merge keys are not supported', l, r)
      const p = filho(ponteiro, k.chave)
      const lugar = onde(linhas[l].ini + r)
      const anterior = temChave(objeto, k.chave)
        ? { valor: objeto[k.chave], ...posicoes.get(p) }
        : null
      posicoes.set(p, lugar)
      const v = valorDaChave(t, k.depois, r, p, profundidade + 1)
      if (anterior) duplicatas.registrar(p, anterior, { valor: v, ...lugar })
      objeto[k.chave] = v
    }
    return objeto
  }

  const sequencia = (r, ponteiro, profundidade) => {
    const lista = []
    for (;;) {
      pularVazias()
      if (l >= total) break
      const t = linhas[l].texto
      const rr = recuo(l)
      if (rr < r || marcaDeDocumento(t)) break
      if (rr > r) falhar('unexpected indentation', l, rr)
      if (!ehItem(t, r)) break
      const p = filho(ponteiro, lista.length)
      posicoes.set(p, onde(linhas[l].ini + r))
      let j = r + 1
      while (t[j] === ' ') j++
      if (j >= t.length || t[j] === '#') {
        l++
        pularVazias()
        lista.push(l < total && recuo(l) > r ? no(r, p, profundidade + 1) : null)
        continue
      }
      if (ancoras && t[j] === '*') {
        lista.push(escalarEmLinha(j, r, p, profundidade + 1))
        continue
      }
      if (ancoras && t[j] === '&') {
        const nome = nomeDeAncora(t, j, l)
        const d = depoisDaAncora(t, j, nome, l)
        if (restoVazio(t, d)) {
          l++
          pularVazias()
          lista.push(
            ancorar(nome, () => (l < total && recuo(l) > r ? no(r, p, profundidade + 1) : null)),
          )
          continue
        }
        if (t[d] === '|' || t[d] === '>') {
          lista.push(ancorar(nome, () => blocoLiteral(t, d, r)))
          continue
        }
        // `- &name key: v` anchors the KEY (js-yaml reads it so), which this
        // subset refuses; `- &name - v` would anchor a nested sequence.
        if (chaveDaLinha(t, d)) falhar('an anchor on a mapping key is not supported', l, j)
        if (ehItem(t, d)) falhar(SEM_SUPORTE, l, j)
        lista.push(ancorar(nome, () => escalarEmLinha(d, r, p, profundidade + 1)))
        continue
      }
      if ('&*!'.includes(t[j])) falhar(SEM_SUPORTE, l, j)
      if (t[j] === '|' || t[j] === '>') {
        lista.push(blocoLiteral(t, j, r))
        continue
      }
      if (ehItem(t, j) || chaveDaLinha(t, j)) {
        // `- key: v` and `- - v`: the item's content becomes a block node at
        // its own column. The dash is swapped for a space of the same width,
        // so every column keeps pointing at the same character.
        linhas[l] = { ini: linhas[l].ini, texto: ' '.repeat(j) + t.slice(j) }
        lista.push(no(r, p, profundidade + 1))
        continue
      }
      lista.push(escalarEmLinha(j, r, p, profundidade + 1))
    }
    return lista
  }

  const no = (pai, ponteiro, profundidade) => {
    if (profundidade > PROFUNDIDADE_MAXIMA) falhar(`nesting deeper than ${PROFUNDIDADE_MAXIMA}`)
    pularVazias()
    if (l >= total) return null
    const t = linhas[l].texto
    const r = recuo(l)
    if (r <= pai) return null
    if (ehItem(t, r)) return sequencia(r, ponteiro, profundidade)
    if (chaveDaLinha(t, r)) return mapa(r, ponteiro, profundidade)
    if (t[r] === '|' || t[r] === '>') return blocoLiteral(t, r, pai)
    return escalarEmLinha(r, pai, ponteiro, profundidade)
  }

  try {
    pularVazias()
    if (l < total && linhas[l].texto.startsWith('%'))
      falhar('YAML directives are not supported', l, 0)
    if (l < total && /^---(?:[ \t]|$)/.test(linhas[l].texto)) {
      if (!restoVazio(linhas[l].texto, 3))
        falhar('content on the document start line is not supported', l, 4)
      l++
    }
    posicoes.set('', onde(l < total ? linhas[l].ini : fim))
    const valor = no(-1, '', 0)
    pularVazias()
    if (l < total) {
      const t = linhas[l].texto
      if (/^\.\.\.(?:[ \t]|$)/.test(t)) {
        l++
        pularVazias()
        if (l < total) falhar('content after the end of the document', l, 0)
      } else if (/^---(?:[ \t]|$)/.test(t)) falhar('more than one YAML document', l, 0)
      else falhar('unexpected content', l, espacosIniciais(t))
    }
    return { valor, duplicatas: duplicatas.lista(), erro: null, posicoes }
  } catch (e) {
    if (!(e instanceof FalhaDeFormato)) throw e
    return {
      valor: undefined,
      duplicatas: duplicatas.lista(),
      erro: { ...onde(e.indice), mensagem: e.message },
      posicoes,
    }
  }
}

export function lerYaml(texto, { ancoras = false } = {}) {
  const fonte = String(texto)
  const inicio = fonte.charCodeAt(0) === 0xfeff ? 1 : 0
  return lerYamlEm(fonte, inicio, fonte.length, { ancoras })
}

export function lerFrontmatter(texto) {
  const fonte = String(texto)
  const ausente = {
    presente: false,
    valor: null,
    duplicatas: [],
    erro: null,
    posicoes: new Map(),
    yaml: '',
    indice: 0,
  }
  let abertura
  if (fonte.startsWith('---\n')) abertura = 4
  else if (fonte.startsWith('---\r\n')) abertura = 5
  else return ausente
  // The closing fence is the first line that is exactly `---` (trailing blanks
  // allowed). Without one there is no frontmatter at all, only a thematic break.
  const m = /(?:^|\n)---[ \t]*(?:\r?\n|\r?$)/.exec(fonte.slice(abertura))
  if (!m) return ausente
  const fimDoYaml = abertura + m.index + (m[0].startsWith('\n') ? 1 : 0)
  const r = lerYamlEm(fonte, abertura, fimDoYaml)
  return {
    presente: true,
    valor: r.erro ? null : r.valor,
    duplicatas: r.duplicatas,
    erro: r.erro,
    posicoes: r.posicoes,
    yaml: fonte.slice(abertura, fimDoYaml),
    indice: abertura,
  }
}

// ═══════════════════════════════════════════════════════ escapesDecodificados

const LETRAS_JSON = { b: 0x08, f: 0x0c }
// JSON5 takes the ECMAScript 5.1 single escapes, which add the vertical tab.
const LETRAS_JSON5 = { b: 0x08, f: 0x0c, v: 0x0b }
const LETRAS_YAML = {
  e: 0x1b,
  b: 0x08,
  f: 0x0c,
  0: 0x00,
  a: 0x07,
  v: 0x0b,
  N: 0x85,
  _: 0xa0,
  L: 0x2028,
  P: 0x2029,
}
const LETRAS_TOML = { e: 0x1b, b: 0x08, f: 0x0c }

/**
 * Reads one escape at `k` (a backslash) and pushes what it decodes to. Returns
 * how many UTF-16 units the escape spans, so the caller skips it whole: that is
 * what makes backslash parity come out right without counting runs.
 */
function umEscape(t, k, formato, letras, out) {
  const e = t[k + 1]
  if (e === undefined) return 1
  if (temChave(letras, e)) {
    out.push({ indice: k, cp: letras[e], forma: `${formato}:${e}` })
    return 2
  }
  const tamanho =
    e === 'u'
      ? 4
      : formato !== 'json' && e === 'x'
        ? 2
        : formato !== 'json' && formato !== 'json5' && e === 'U'
          ? 8
          : 0
  if (!tamanho) return 2
  let cp = hexDe(t, k + 2, tamanho)
  if (cp < 0) return 2
  let passo = 2 + tamanho
  if (e === 'u' && cp >= 0xd800 && cp <= 0xdbff && t[k + 6] === '\\' && t[k + 7] === 'u') {
    const baixo = hexDe(t, k + 8, 4)
    if (baixo >= 0xdc00 && baixo <= 0xdfff) {
      cp = 0x10000 + ((cp - 0xd800) << 10) + (baixo - 0xdc00)
      passo = 12
    }
  }
  if (cp > 0x10ffff) return passo
  if ((formato === 'json' || formato === 'json5') && cp === 0) return passo
  out.push({ indice: k, cp, forma: `${formato}:${e}` })
  return passo
}

/**
 * JSON and JSONC strings, and with `json5` the JSON5 ones: a string opens on a
 * double OR a single quote and closes on the same quote, and a backslash before
 * a line break continues it on the next line.
 */
function escapesJson(t, out, { json5 = false } = {}) {
  const formato = json5 ? 'json5' : 'json'
  const letras = json5 ? LETRAS_JSON5 : LETRAS_JSON
  const n = t.length
  let i = 0
  while (i < n) {
    const c = t[i]
    if (c === '/' && t[i + 1] === '/') {
      const fim = t.indexOf('\n', i)
      i = fim === -1 ? n : fim
      continue
    }
    if (c === '/' && t[i + 1] === '*') {
      const fim = t.indexOf('*/', i + 2)
      i = fim === -1 ? n : fim + 2
      continue
    }
    if (c !== '"' && !(json5 && c === "'")) {
      i++
      continue
    }
    i++
    // A JSON string cannot span lines, so an unterminated one stops at the
    // line end instead of swallowing the rest of the file.
    while (i < n && t[i] !== c && t[i] !== '\n') {
      if (t[i] !== '\\') {
        i++
        continue
      }
      // JSON5 line continuation: the backslash and the line break vanish.
      if (json5 && t[i + 1] === '\r' && t[i + 2] === '\n') {
        i += 3
        continue
      }
      i += umEscape(t, i, formato, letras, out)
    }
    if (t[i] === c) i++
  }
}

function escapesToml(t, out) {
  const n = t.length
  let i = 0
  while (i < n) {
    const c = t[i]
    if (c === '#') {
      const fim = t.indexOf('\n', i)
      i = fim === -1 ? n : fim
      continue
    }
    if (t.startsWith("'''", i)) {
      const fim = t.indexOf("'''", i + 3)
      i = fim === -1 ? n : fim + 3
      while (t[i] === "'") i++
      continue
    }
    if (c === "'") {
      let fim = i + 1
      while (fim < n && t[fim] !== "'" && t[fim] !== '\n') fim++
      i = fim + 1
      continue
    }
    if (c !== '"') {
      i++
      continue
    }
    const multi = t.startsWith('"""', i)
    i += multi ? 3 : 1
    while (i < n) {
      if (multi && t.startsWith('"""', i)) {
        i += 3
        while (t[i] === '"') i++
        break
      }
      if (!multi && (t[i] === '"' || t[i] === '\n')) {
        if (t[i] === '"') i++
        break
      }
      i += t[i] === '\\' ? umEscape(t, i, 'toml', LETRAS_TOML, out) : 1
    }
  }
}

/**
 * YAML decodes escapes only inside DOUBLE-QUOTED scalars. A quote opens one only
 * where a scalar may start (line start, after `- `, `? `, `: `, `[`, `{`, `,`,
 * and inside a flow collection after a `:` that follows a closing quote);
 * a quote in the middle of a plain scalar is just a character. The body of a
 * block scalar (`|`, `>`) is skipped whole: nothing in it is decoded, which is
 * why `run: |` blocks in workflows never report.
 */
function escapesYaml(t, out) {
  const n = t.length
  const branco = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === undefined
  let i = 0
  let fluxo = 0
  // Inside a flow collection a line break does not reset where a scalar may
  // start; in block context every line does.
  let podeIniciar = true
  // When a number: lines indented deeper than it (and blank lines) are the body
  // of a block scalar.
  let blocoAte = null
  // A quoted scalar just closed. In a flow collection YAML lets a value follow
  // a JSON-like key with no space (`{"k":"v"}`), and js-yaml decodes that
  // value's escapes, so a colon right after a closing quote opens a scalar too.
  let aposAspas = false
  while (i < n) {
    let inicioDaLinha = i
    let fimDaLinha = t.indexOf('\n', i)
    if (fimDaLinha === -1) fimDaLinha = n
    let recuo = 0
    while (t[i + recuo] === ' ') recuo++
    if (blocoAte !== null) {
      const vazia = t.slice(i + recuo, fimDaLinha).replace(/\r$/, '') === ''
      if (vazia || recuo > blocoAte) {
        i = fimDaLinha + 1
        continue
      }
      blocoAte = null
    }
    if (fluxo === 0) podeIniciar = true
    i += recuo
    // The column of the node a block scalar header belongs to: the key before
    // `:`, the dash of `- |`, or one less than the line indent for a bare `|`.
    let colunaDoToken = recuo
    let colunaDoDono = recuo - 1
    while (i < n && t[i] !== '\n') {
      const c = t[i]
      const coluna = i - inicioDaLinha
      if (c === ' ' || c === '\t' || c === '\r') {
        i++
        continue
      }
      if (c === '#' && (i === inicioDaLinha || t[i - 1] === ' ' || t[i - 1] === '\t')) {
        const fim = t.indexOf('\n', i)
        i = fim === -1 ? n : fim
        break
      }
      if (podeIniciar && (c === '"' || c === "'")) {
        colunaDoToken = coluna
        i++
        if (c === '"') {
          while (i < n && t[i] !== '"') {
            i += t[i] === '\\' ? umEscape(t, i, 'yaml', LETRAS_YAML, out) : 1
          }
        } else {
          while (i < n && !(t[i] === "'" && t[i + 1] !== "'")) i += t[i] === "'" ? 2 : 1
        }
        i++
        podeIniciar = false
        aposAspas = true
        // A quoted scalar may close on a later line; columns count from there.
        const quebra = t.lastIndexOf('\n', i - 1)
        if (quebra >= inicioDaLinha) inicioDaLinha = quebra + 1
        continue
      }
      const colaNaAspa = aposAspas && fluxo > 0
      aposAspas = false
      if (podeIniciar && (c === '-' || c === '?') && branco(t[i + 1])) {
        colunaDoDono = coluna
        i++
        continue
      }
      if (podeIniciar && (c === '&' || c === '!' || c === '*')) {
        while (i < n && !branco(t[i])) i++
        continue
      }
      if (podeIniciar && fluxo === 0 && (c === '|' || c === '>')) {
        const cabecalho = t.slice(i, fimDaLinha).replace(/\r$/, '')
        if (/^[|>](?:[1-9][-+]?|[-+][1-9]?)?(?:[ \t]+#.*|[ \t]*)$/.test(cabecalho)) {
          blocoAte = colunaDoDono
          i = fimDaLinha
          break
        }
      }
      // A bracket opens a flow collection only where a node may start, or inside
      // one already open. In `a: x "{"` the scalar has started at `x`, so the
      // brace is plain text: counted as an opener, it let the next quote open a
      // scalar no parser sees and swallowed the escapes of the real one after it.
      if ((c === '[' || c === '{') && (podeIniciar || fluxo > 0)) {
        fluxo++
        podeIniciar = true
        i++
        continue
      }
      if (c === ']' || c === '}') {
        fluxo = Math.max(0, fluxo - 1)
        podeIniciar = false
        i++
        continue
      }
      if (c === ',' && fluxo > 0) {
        podeIniciar = true
        i++
        continue
      }
      if (
        c === ':' &&
        (branco(t[i + 1]) || colaNaAspa || (fluxo > 0 && ',[]{}'.includes(t[i + 1])))
      ) {
        colunaDoDono = colunaDoToken
        podeIniciar = true
        i++
        continue
      }
      if (podeIniciar) {
        colunaDoToken = coluna
        podeIniciar = false
      }
      i++
    }
    if (t[i] === '\n') i++
  }
}

export function escapesDecodificados(texto, formato) {
  const t = String(texto)
  const out = []
  if (formato === 'json') escapesJson(t, out)
  else if (formato === 'json5') escapesJson(t, out, { json5: true })
  else if (formato === 'yaml') escapesYaml(t, out)
  else if (formato === 'toml') escapesToml(t, out)
  else throw new Error(`escapesDecodificados: unknown format ${JSON.stringify(formato)}`)
  return out
}
