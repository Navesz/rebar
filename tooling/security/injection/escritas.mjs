// escritas — mixed-script-token: a URL host, a URL segment, a package name or an
// agent config identifier that mixes writing systems.
//
// WHY. A letter from another alphabet that looks like a Latin one turns a host,
// a package or a server name into a different one that reads the same. Daniel
// Stenberg reported on 2025-05-16 an AI-generated vulnerability report for curl
// whose GitHub link had its first letter swapped for an Armenian one; the
// Trojan Source paper filed the identifier form as CVE-2021-42694. A model that
// copies the address follows it, and a reviewer reads the familiar name.
//
// WHAT IS JUDGED, AND WHAT NEVER IS. Only strings that name something a machine
// resolves: the host of every URL in any tracked text (the whole host is one
// token, so a lookalike label under a Latin top-level domain mixes; each
// punycode label is decoded first), the path, query and fragment segments of
// those URLs, the names in package.json, requirements files and pyproject.toml,
// and the keys and identifier-shaped values of agent config files. Prose and
// code identifiers are never judged: across the local repositories the
// same test over every word hit 92 honest words in 4 repositories (a resistance
// in kilo-ohms, a colour difference, a Greek variable in a formula), while the
// scoped tokens measured 0 mixed in 14,892 hosts, 106,134 path tokens, 86
// names, 457 dependencies, 273 script names, 51 config keys and 15 config values
// of the local repositories (the prototype), and, with this engine, 0 findings in
// the 23 local repositories and rebar and 0 mixed in 51,076 hosts, 253,367 path
// tokens, 1,681 names, 16,979 dependencies and 8,815 script names of 3,245 unique
// node_modules manifests and READMEs.
//
// THE ALGORITHM IS UTS #39's resolved script set, at the Highly Restrictive
// level: the script sets of every letter are intersected, Han letters count for
// Japanese, Chinese and Korean writing, kana for Japanese, Hangul for Korean and
// Bopomofo for Chinese, and Latin may join exactly one of those three. There is
// no confusables skeleton: it would remove no false positive, because none was
// measured, and it would cost a large table. Script data comes from
// escritas-tabelas.mjs, never from a property escape.
//
// A finding prints the position, the kind of token and the `<U+XXXX>` of the
// letter from the minority script, never the token or the URL.

import { escaparSaida } from '../texto-seguro.mjs'
import { ESCRITAS_DE_LETRA } from './escritas-tabelas.mjs'
import { FORMATO_POR_EXTENSAO, lerJsonc, lerToml, lerYaml } from './formats.mjs'
import {
  allowlistMalformada,
  extensaoDe,
  lerAllowlist,
  lerIndice,
  notasDaAllowlist,
  onde,
  posicao,
  resumir,
} from './reader.mjs'

/** "Not applicable": the class leaves the denominator (invariant I4). */
const na = (motivo) => ({ na: motivo })

const rotulo = (cp) => `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`

// ═════════════════════════════════════════════════════════════ script sets

const INICIOS = Int32Array.from(ESCRITAS_DE_LETRA, (f) => f[0])

/** The script codes of a letter as the table stores them ('Latn', 'Arab Syrc'), or null. */
export function escritasDe(cp) {
  let baixo = 0
  let alto = INICIOS.length - 1
  if (alto < 0 || cp < INICIOS[0]) return null
  while (baixo < alto) {
    const meio = (baixo + alto + 1) >> 1
    if (INICIOS[meio] <= cp) baixo = meio
    else alto = meio - 1
  }
  const f = ESCRITAS_DE_LETRA[baixo]
  return cp <= f[1] ? f[2] : null
}

const AUMENTADOS = new Map()
/** UTS #39 section 5.1: the writing systems a script also counts for. */
function aumentado(assinatura) {
  let s = AUMENTADOS.get(assinatura)
  if (s) return s
  s = new Set(assinatura.split(' '))
  if (s.has('Hani')) for (const x of ['Hanb', 'Jpan', 'Kore']) s.add(x)
  if (s.has('Hira') || s.has('Kana')) s.add('Jpan')
  if (s.has('Hang')) s.add('Kore')
  if (s.has('Bopo')) s.add('Hanb')
  AUMENTADOS.set(assinatura, s)
  return s
}
const temNaoAscii = (s) => {
  for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) > 0x7f) return true
  return false
}
const intersecao = (a, b) => new Set([...a].filter((x) => b.has(x)))
const CJK_COM_LATIM = ['Jpan', 'Hanb', 'Kore']

/**
 * null when the letters of `token` share a writing system, or when Latin joins
 * one of Japanese, Chinese or Korean writing; otherwise the code point to name:
 * the first letter that is not Latin when the token has Latin letters, else the
 * first letter that shares nothing with the first letter. A token of ASCII only
 * returns null before any lookup. Code points with no script are ignored, so a
 * lone lookalike among digits is not mixed: a documented limit.
 */
export function escritaMista(token) {
  const s = String(token)
  if (!temNaoAscii(s)) return null
  let todos = null
  let semLatim = null
  let latim = false
  let primeiroVazio = null
  const letras = []
  for (const ch of s) {
    const cp = ch.codePointAt(0)
    const assinatura = escritasDe(cp)
    if (assinatura === null) continue
    const a = aumentado(assinatura)
    letras.push({ cp, a })
    todos = todos ? intersecao(todos, a) : new Set(a)
    if (a.has('Latn')) latim = true
    else semLatim = semLatim ? intersecao(semLatim, a) : new Set(a)
    if (!todos.size && primeiroVazio === null) primeiroVazio = cp
  }
  if (!todos || todos.size) return null
  if (latim && semLatim && CJK_COM_LATIM.some((x) => semLatim.has(x))) return null
  if (latim) return letras.find((l) => !l.a.has('Latn')).cp
  const primeiro = letras[0].a
  const fora = letras.find((l) => ![...l.a].some((x) => primeiro.has(x)))
  return fora ? fora.cp : primeiroVazio
}

// ═════════════════════════════════════════════════════════════════ punycode

const BASE = 36
const TMIN = 1
const TMAX = 26
const LIMITE = 0x7fffffff

function adaptar(delta, pontos, primeiro) {
  let d = primeiro ? Math.floor(delta / 700) : delta >> 1
  d += Math.floor(d / pontos)
  let k = 0
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN))
    k += BASE
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + 38))
}

function digito(u) {
  if (u >= 0x30 && u <= 0x39) return u - 22
  if (u >= 0x41 && u <= 0x5a) return u - 0x41
  if (u >= 0x61 && u <= 0x7a) return u - 0x61
  return -1
}

/**
 * RFC 3492 decoding of one label WITHOUT its `xn--` prefix, or null when it is
 * not valid punycode. Its own decoder: `node:punycode` prints a deprecation
 * warning on stderr, which the proof runner reads as a broken checker, and
 * `url.domainToUnicode` applies the IDNA tables of whatever Node runs it.
 */
export function decodificarPunycode(rotulo) {
  const entrada = String(rotulo)
  const saida = []
  const delimitador = entrada.lastIndexOf('-')
  for (let k = 0; k < Math.max(0, delimitador); k++) {
    const u = entrada.charCodeAt(k)
    if (u >= 0x80) return null
    saida.push(u)
  }
  let n = 0x80
  let i = 0
  let vies = 72
  // RFC 3492 6.2: the last delimiter is consumed only when basic code points
  // came before it, so a label that starts with its only hyphen is decoded whole.
  for (let pos = delimitador > 0 ? delimitador + 1 : 0; pos < entrada.length;) {
    const antigo = i
    let peso = 1
    for (let k = BASE; ; k += BASE) {
      if (pos >= entrada.length) return null
      const d = digito(entrada.charCodeAt(pos++))
      if (d < 0) return null
      if (d > Math.floor((LIMITE - i) / peso)) return null
      i += d * peso
      const t = k <= vies ? TMIN : k >= vies + TMAX ? TMAX : k - vies
      if (d < t) break
      if (peso > Math.floor(LIMITE / (BASE - t))) return null
      peso *= BASE - t
    }
    const total = saida.length + 1
    vies = adaptar(i - antigo, total, antigo === 0)
    if (Math.floor(i / total) > LIMITE - n) return null
    n += Math.floor(i / total)
    i %= total
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null
    saida.splice(i, 0, n)
    i++
  }
  return String.fromCodePoint(...saida)
}

// ═════════════════════════════════════════════════════════════════════ URLs

const URL_COM_ESQUEMA = /\b(?:https?|ftp|wss?|git|ssh|svn|file):\/\/[^\s"'`<>()[\]{}\\|^]+/gi
// user@host:path, the address form git and scp take. The host needs a dot, and
// the lookbehind keeps it from starting in the middle of a word.
const URL_SCP =
  /(?<![^\s"'`(<[{=,])[^\s"'`<>@:/()[\]{}]+@([^\s"'`<>@:/()[\]{},;]+\.[^\s"'`<>@:/()[\]{},;.]+):(?!\/\/)[^\s"'`<>]+/g

const decodificar = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * Every URL of a text: `[{ indice, host, indiceDoHost, rotuloPuny, segmentos: [{ texto, indice }] }]`.
 * Trailing sentence punctuation is not part of a URL. `host` is the authority
 * without user, port and brackets, percent-decoded, with each `xn--` label
 * decoded (an invalid label stays as written); `rotuloPuny` is the offset of
 * the first such label, or -1.
 */
export function urlsDe(texto) {
  const t = String(texto)
  const saida = []
  const cobertos = []
  for (const m of t.matchAll(URL_COM_ESQUEMA)) {
    const url = m[0].replace(/[.,;:!?]+$/, '')
    const inicioDaAutoridade = url.indexOf('://') + 3
    const resto = url.slice(inicioDaAutoridade)
    const autoridade = resto.split(/[/?#]/)[0]
    const arroba = autoridade.lastIndexOf('@')
    let host = autoridade.slice(arroba + 1)
    let deslocamento = arroba + 1
    if (host.startsWith('[')) {
      host = host.replace(/^\[([^\]]*)\].*$/, '$1')
      deslocamento += 1
    } else host = host.replace(/:\d*$/, '')
    const segmentos = []
    let k = inicioDaAutoridade + autoridade.length
    for (const parte of url.slice(k).split(/([/?#&=+])/)) {
      if (parte && !/^[/?#&=+]$/.test(parte)) segmentos.push({ texto: parte, indice: m.index + k })
      k += parte.length
    }
    saida.push(montarHost(host, m.index + inicioDaAutoridade + deslocamento, m.index, segmentos))
    cobertos.push([m.index, m.index + url.length])
  }
  for (const m of t.matchAll(URL_SCP)) {
    if (cobertos.some(([a, b]) => m.index >= a && m.index < b)) continue
    const indiceDoHost = m.index + m[0].indexOf('@') + 1
    saida.push(montarHost(m[1], indiceDoHost, m.index, []))
  }
  return saida
}

function montarHost(cru, indiceDoHost, indice, segmentos) {
  let rotuloPuny = -1
  let k = 0
  const rotulos = decodificar(cru)
    .split('.')
    .map((r) => {
      const inicio = k
      k += r.length + 1
      if (!/^xn--/i.test(r)) return r
      if (rotuloPuny < 0) rotuloPuny = indiceDoHost + inicio
      const d = decodificarPunycode(r.slice(4))
      return d === null ? r : d
    })
  return { indice, host: rotulos.join('.'), indiceDoHost, rotuloPuny, segmentos }
}

const SEPARADOR = /[\s!-/:-@[-`{-~]+/

/** The tokens a URL is judged by: `[{ tipo: 'url host'|'url path', token, indice }]`. */
export function tokensDeUrl(url) {
  const tokens = [
    {
      tipo: 'url host',
      token: url.host,
      indice: url.rotuloPuny >= 0 ? url.rotuloPuny : url.indiceDoHost,
    },
  ]
  for (const s of url.segmentos) {
    for (const token of decodificar(s.texto).split(SEPARADOR)) {
      if (token) tokens.push({ tipo: 'url path', token, indice: s.indice })
    }
  }
  return tokens
}

// ═════════════════════════════════════════════════════════════ manifests

const MAPAS_DE_DEPENDENCIA = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const codificarSegmento = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1')

/** `npm:<name>@<range>` -> name; anything else -> null. */
function nomeDeApelido(espec) {
  const m = /^npm:(@?[^@]+)(?:@.*)?$/.exec(String(espec))
  return m ? m[1] : null
}

/** [ponteiro, token] pairs a package.json names, per section 4.4 (2). */
function nomesDoPacote(v) {
  const pares = []
  if (!ehObjeto(v)) return pares
  if (typeof v.name === 'string') pares.push(['/name', v.name])
  for (const mapa of [...MAPAS_DE_DEPENDENCIA, 'resolutions']) {
    if (!ehObjeto(v[mapa])) continue
    for (const [chave, espec] of Object.entries(v[mapa])) {
      const p = `/${mapa}/${codificarSegmento(chave)}`
      pares.push([p, chave])
      const apelido = typeof espec === 'string' ? nomeDeApelido(espec) : null
      if (apelido) pares.push([p, apelido])
    }
  }
  const sobrepostas = (o, base, profundidade) => {
    if (!ehObjeto(o) || profundidade > 20) return
    for (const [chave, x] of Object.entries(o)) {
      const p = `${base}/${codificarSegmento(chave)}`
      pares.push([p, chave])
      if (typeof x === 'string') {
        const apelido = nomeDeApelido(x)
        if (apelido) pares.push([p, apelido])
      } else sobrepostas(x, p, profundidade + 1)
    }
  }
  sobrepostas(v.overrides, '/overrides', 0)
  for (const lista of ['bundleDependencies', 'bundledDependencies']) {
    if (Array.isArray(v[lista]))
      v[lista].forEach((x, i) => typeof x === 'string' && pares.push([`/${lista}/${i}`, x]))
  }
  for (const secao of ['bin', 'scripts']) {
    if (ehObjeto(v[secao]))
      for (const chave of Object.keys(v[secao]))
        pares.push([`/${secao}/${codificarSegmento(chave)}`, chave])
  }
  return pares
}

const lerComo = {
  json: (t) => lerJsonc(t),
  json5: (t) => lerJsonc(t),
  yaml: (t) => lerYaml(t),
  toml: (t) => lerToml(t),
}

// ═══════════════════════════════════════════════════════════════ the rule

/**
 * mixed-script-token over the index of `r.dir`: the reprova string, `{ nota }`,
 * null, or `na` when nothing tracked names a URL, a package or an agent setting.
 */
export function checarMixedScript(r) {
  const indice = lerIndice(r.dir)
  const allowlist = lerAllowlist(r.dir)
  const malformada = allowlistMalformada(allowlist)
  if (malformada) return malformada
  if (indice.semGit) return na('no URL, package manifest or agent config tracked')

  let candidatos = 0
  const itens = []
  let usouAlguma = false
  for (const e of indice.entradas) {
    if (e.viaSymlink !== null || e.symlink !== null || e.texto === null) continue
    const texto = e.texto.replace(/\r\n/g, '\n')
    const achados = []
    const julgar = (tipo, token, lugar) => {
      candidatos++
      const cp = escritaMista(token)
      if (cp !== null) achados.push({ tipo, cp, lugar })
    }
    const noTexto = (i) => posicao(texto, i)
    const doPonteiro = (analise, ponteiro) => analise.posicoes?.get(ponteiro) || null

    for (const url of urlsDe(texto)) {
      for (const t of tokensDeUrl(url)) julgar(t.tipo, t.token, noTexto(t.indice))
    }

    const nome = e.caminho.split('/').pop()
    if (nome === 'package.json') {
      const analise = lerJsonc(texto)
      if (!analise.erro) {
        for (const [ponteiro, token] of nomesDoPacote(analise.valor))
          julgar('package name', token, doPonteiro(analise, ponteiro))
      }
    } else if (/^requirements[^/]*\.txt$/i.test(nome)) {
      let k = 0
      for (const linha of texto.split('\n')) {
        const m = /^\s*([^\s#;<>=!~[@]+)/.exec(linha)
        if (m && !linha.trim().startsWith('-'))
          julgar('package name', m[1], noTexto(k + m.index + m[0].length - m[1].length))
        k += linha.length + 1
      }
    } else if (nome === 'pyproject.toml') {
      const analise = lerToml(texto)
      const projeto =
        !analise.erro && ehObjeto(analise.valor?.project) ? analise.valor.project : null
      if (projeto && typeof projeto.name === 'string')
        julgar('package name', projeto.name, doPonteiro(analise, '/project/name'))
      if (projeto && Array.isArray(projeto.dependencies)) {
        projeto.dependencies.forEach((d, i) => {
          const m = typeof d === 'string' ? /^\s*([^\s;<>=!~[(@]+)/.exec(d) : null
          if (m) julgar('package name', m[1], doPonteiro(analise, `/project/dependencies/${i}`))
        })
      }
    }

    const formato = FORMATO_POR_EXTENSAO[extensaoDe(e.caminho)]
    if (e.tipo === 'agente' && lerComo[formato]) {
      const analise = lerComo[formato](texto)
      if (!analise.erro) {
        const andar = (v, ponteiro, profundidade) => {
          if (profundidade > 20 || v === null || typeof v !== 'object') return
          for (const [chave, x] of Object.entries(v)) {
            const p = `${ponteiro}/${codificarSegmento(chave)}`
            const lugar = doPonteiro(analise, p)
            if (!Array.isArray(v))
              for (const token of chave.split(SEPARADOR))
                if (token) julgar('config key', token, lugar)
            if (typeof x === 'string') {
              if (!/\s/.test(x) && x.length <= 200)
                for (const token of x.split(SEPARADOR))
                  if (token) julgar('config value', token, lugar)
            } else andar(x, p, profundidade + 1)
          }
        }
        andar(analise.valor, '', 0)
      }
    }

    if (!achados.length) continue
    if (allowlist.aceita('mixed-script-token', { arquivo: e.caminho, oid: e.oid })) {
      usouAlguma = true
      continue
    }
    const vistos = new Set()
    for (const a of achados) {
      const local = a.lugar
        ? onde(e.caminho, a.lugar.linha, a.lugar.coluna)
        : `${escaparSaida(e.caminho)} (${a.tipo})`
      const item = `${local} ${a.tipo} mixes writing systems at ${rotulo(a.cp)}`
      if (vistos.has(item)) continue
      vistos.add(item)
      itens.push(item)
    }
  }

  if (itens.length) {
    return (
      `${itens.length} token(s) mixing writing systems: ${resumir(itens)} — a letter of another ` +
      'alphabet makes a different host or name that reads the same; write it in one script, or ' +
      'allowlist the file with a reason'
    )
  }
  const notas = notasDaAllowlist(allowlist, 'mixed-script-token', usouAlguma)
  if (!candidatos)
    return notas.length
      ? { nota: notas.join(' · ') }
      : na('no URL, package manifest or agent config tracked')
  return notas.length ? { nota: notas.join(' · ') } : null
}
