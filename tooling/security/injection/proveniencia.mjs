// proveniencia — instruction-provenance: an AGENTS.md that carries the rebar
// generator marker has to be an AGENTS.md the generator could have written.
//
// WHY. `rebar new` writes the root AGENTS.md from a template and puts a marker
// comment on its first line. Until 2026-09-13 the generator trusted that marker
// anywhere in the file (an includes()) and copied a third-party Next.js block
// into the file with no inspection and no size ceiling; garantirAgents in
// new/gate/aplicar.mjs now keeps a marked file only when it equals the render and
// warns on an unknown block. To a reviewer the marker is still a claim nobody
// holds against the text.
// A pull request that edits the template body, or plants the marker on a file
// that never came from the generator, reads to a reviewer as "generated, skip it".
//
// HOW. The unit of comparison is the whole file, because the template has no end
// marker. It is matched against moldes-agentes.json, an append-only table of
// every template version the generator ever rendered (4 families over 13
// commits, then v5), each with two slots: the project name and the Next.js
// block. From v5 the template pins the rebar commit its command line runs, and
// that commit is a third slot: 40 lowercase hex digits, or the placeholder the
// generator writes when it cannot learn its own commit. A tail
// after the template is allowed: owners add sections, and a hidden directive in
// one is hidden-markdown-directive's to judge. The three generated repositories
// match with no tail: assay and navesz-portfolio v4, rebar-site v3.
//
// WHAT FAILS (heuristic, so only under --heuristics): the marker below the top,
// the marker twice, the marker in any instruction file other than the root
// AGENTS.md, and a root AGENTS.md that matches no version. A third-party block
// with a hash nobody recorded is a nota only when it is over twice the measured
// maximum (18 lines, 1,354 bytes) or carries a URL, fenced code, a nested comment
// or an execution token: `next dev` rewrites that block on every release, and a
// warning on every rewrite would be a line nobody can act on.
//
// Printed: positions, version names, line numbers and counts. Never the text.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { EXEC_FORTE_TEXTO, ehArquivoMarkdown, mascaras } from './instrucoes.mjs'
import { allowlistMalformada, lerAllowlist, lerIndice, onde, posicao, resumir } from './reader.mjs'

const na = (motivo) => ({ na: motivo })

/** The marker `rebar new` writes on the first line of the root AGENTS.md. */
export const MARCADOR_AGENTES = '<!-- ' + 'rebar:agentes' + ' -->'
export const SLOT_NOME = '{{nome}}'
export const SLOT_BLOCO =
  '<!-- BEGIN:nextjs-agent-rules -->{{bloco}}<!-- END:nextjs-agent-rules -->'
export const SLOT_COMMIT = '{{commit}}'
/**
 * What the generator writes in place of the commit when it cannot learn it:
 * SEM_COMMIT in new/gate/aplicar.mjs, which this module cannot import (mirrors
 * carry no new/ folder). prove-proveniencia.mjs holds the two equal.
 */
export const COMMIT_DESCONHECIDO = 'TROQUE-PELO-COMMIT-DO-REBAR'
/** The append-only table of template versions. */
export const MOLDES = new URL('./moldes-agentes.json', import.meta.url)

/**
 * The same pattern as RE_BLOCO_SHADCN in new/gate/aplicar.mjs, which is not
 * exported and cannot be imported here anyway: numbers.mjs and mcp/generate.mjs
 * load this module in mirrors with no new/ folder. prove-proveniencia.mjs holds
 * the two sources equal.
 */
export const RE_BLOCO =
  /<!--\s*BEGIN:nextjs-agent-rules\s*-->[\s\S]*?<!--\s*END:nextjs-agent-rules\s*-->/

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

/** Twice the measured maximum of the two known blocks (9 lines, 677 bytes). */
const TETO_DE_LINHAS = 18
const TETO_DE_BYTES = 1354

const MEMORIA_DE_MOLDES = new Map()

/**
 * Reads and checks the table. It THROWS on a missing or unparseable file and on
 * any stored hash that does not match its string: an edited older version would
 * make generated projects fail silently, so a table that lies is a broken ruler
 * (quebrou), never a verdict.
 */
export function carregarMoldes(url = MOLDES) {
  const chave = String(url)
  if (MEMORIA_DE_MOLDES.has(chave)) return MEMORIA_DE_MOLDES.get(chave)
  const caminho = url instanceof URL ? fileURLToPath(url) : chave
  let tabela
  try {
    tabela = JSON.parse(readFileSync(caminho, 'utf8'))
  } catch (e) {
    throw new Error(`the template table moldes-agentes.json cannot be read: ${e.message}`)
  }
  if (!tabela || !Array.isArray(tabela.versoes) || !tabela.versoes.length) {
    throw new Error('the template table moldes-agentes.json has no versions')
  }
  for (const v of tabela.versoes) {
    if (
      typeof v.comBloco !== 'string' ||
      typeof v.semBloco !== 'string' ||
      sha256(v.comBloco) !== v.sha256ComBloco ||
      sha256(v.semBloco) !== v.sha256SemBloco
    ) {
      throw new Error(
        `the template table moldes-agentes.json was edited: ${v.versao} no longer matches its hash`,
      )
    }
  }
  if (!Array.isArray(tabela.blocosConhecidos)) tabela.blocosConhecidos = []
  MEMORIA_DE_MOLDES.set(chave, tabela)
  return tabela
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const GRUPO_NOME = '(?<nome>[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)'
const GRUPO_BLOCO =
  '(?<bloco><!--\\s*BEGIN:nextjs-agent-rules\\s*-->[\\s\\S]*?<!--\\s*END:nextjs-agent-rules\\s*-->)'
const FORMA_DO_COMMIT = `[0-9a-f]{40}|${COMMIT_DESCONHECIDO}`
const GRUPO_COMMIT = `(?<commit>${FORMA_DO_COMMIT})`

/**
 * One regex per render. Literal parts are escaped, the first name slot captures
 * the name the way `rebar new` validates it (new/index.mjs:48,56) and later ones
 * must repeat it, the block slot takes any Next.js block, and the commit slot
 * takes a full commit id or the placeholder, the same one wherever it repeats
 * (an abbreviated id is not what the generator writes). The render's trailing
 * newlines become `\n*`: the template ends with three of them and the block form
 * with two, and an editor that trims or adds a final newline changes nothing the
 * generator claimed.
 */
function compilar(render) {
  const semFim = render.replace(/\n+$/, '')
  let fonte = '^'
  let nomeVisto = false
  let commitVisto = false
  for (const parte of semFim.split(
    /(\{\{nome\}\}|\{\{commit\}\}|<!-- BEGIN:nextjs-agent-rules -->\{\{bloco\}\}<!-- END:nextjs-agent-rules -->)/,
  )) {
    if (parte === SLOT_NOME) {
      fonte += nomeVisto ? '\\k<nome>' : GRUPO_NOME
      nomeVisto = true
    } else if (parte === SLOT_COMMIT) {
      fonte += commitVisto ? '\\k<commit>' : GRUPO_COMMIT
      commitVisto = true
    } else if (parte === SLOT_BLOCO) fonte += GRUPO_BLOCO
    else fonte += escapar(parte)
  }
  return new RegExp(`${fonte}\\n*(?<cauda>[\\s\\S]*)$`, 'd')
}

const COMPILADOS = new WeakMap()
function compilados(moldes) {
  let lista = COMPILADOS.get(moldes)
  if (!lista) {
    lista = moldes.versoes.flatMap((v) => [
      { versao: v.versao, forma: 'comBloco', render: v.comBloco, re: compilar(v.comBloco) },
      { versao: v.versao, forma: 'semBloco', render: v.semBloco, re: compilar(v.semBloco) },
    ])
    COMPILADOS.set(moldes, lista)
  }
  return lista
}

/** Offsets of the marker outside code and front matter. */
function marcadoresFora(texto) {
  const m = mascaras(texto)
  const achados = []
  for (
    let k = texto.indexOf(MARCADOR_AGENTES);
    k !== -1;
    k = texto.indexOf(MARCADOR_AGENTES, k + 1)
  ) {
    if (!m[k]) achados.push(k)
  }
  return achados
}

/** How many lines of the text equal the render from the top, stopping at the block slot. */
function prefixoIgual(linhasTexto, render) {
  let n = 0
  let nomeDoTexto = null
  for (const linha of render.replace(/\n+$/, '').split('\n')) {
    if (linha.includes(SLOT_BLOCO)) break
    const outra = linhasTexto[n]
    if (outra === undefined) break
    if (linha.includes(SLOT_NOME) || linha.includes(SLOT_COMMIT)) {
      let fonte = ''
      let nomeNaLinha = false
      for (const parte of linha.split(/(\{\{nome\}\}|\{\{commit\}\})/)) {
        if (parte === SLOT_NOME) {
          fonte += nomeDoTexto ? escapar(nomeDoTexto) : nomeNaLinha ? '\\k<nome>' : GRUPO_NOME
          nomeNaLinha = true
        } else if (parte === SLOT_COMMIT) fonte += `(?:${FORMA_DO_COMMIT})`
        else fonte += escapar(parte)
      }
      const casou = new RegExp(`^${fonte}$`).exec(outra)
      if (!casou) break
      if (!nomeDoTexto && casou.groups) nomeDoTexto = casou.groups.nome
    } else if (linha !== outra) break
    n++
  }
  return n
}

/**
 * `{ estado, ... }` for the text of a root AGENTS.md:
 *   'sem-marcador'           no marker outside code;
 *   'marcador-fora-do-topo'  `indice` of the first marker, which is not at offset 0;
 *   'marcador-repetido'      `n` markers;
 *   'confere'                `versao`, `forma`, `nome`, `commit` and `bloco` (or null), `indiceDoBloco`, `cauda`, `indiceDaCauda`;
 *   'divergente'             `versaoProxima`, `linhaDivergente`.
 * The byte order mark is already consumed by the reader.
 */
export function conferirAgents(texto, moldes) {
  const t = String(texto).replace(/\r\n/g, '\n')
  const marcadores = marcadoresFora(t)
  if (!marcadores.length) return { estado: 'sem-marcador' }
  if (!t.startsWith(MARCADOR_AGENTES))
    return { estado: 'marcador-fora-do-topo', indice: marcadores[0] }
  if (marcadores.length > 1) return { estado: 'marcador-repetido', n: marcadores.length }

  let melhor = null
  for (const c of compilados(moldes)) {
    const m = c.re.exec(t)
    if (!m) continue
    if (!melhor || m.groups.cauda.length <= melhor.cauda.length) {
      melhor = {
        estado: 'confere',
        versao: c.versao,
        forma: c.forma,
        nome: m.groups.nome ?? null,
        commit: m.groups.commit ?? null,
        bloco: m.groups.bloco ?? null,
        indiceDoBloco: m.groups.bloco ? m.indices.groups.bloco[0] : -1,
        cauda: m.groups.cauda,
        indiceDaCauda: t.length - m.groups.cauda.length,
      }
    }
  }
  if (melhor) return melhor

  const linhas = t.split('\n')
  let proxima = null
  for (const c of compilados(moldes)) {
    const n = prefixoIgual(linhas, c.render)
    if (!proxima || n >= proxima.n) proxima = { versao: c.versao, n }
  }
  return { estado: 'divergente', versaoProxima: proxima.versao, linhaDivergente: proxima.n + 1 }
}

/** The nota about a third-party block, or null when it is known or small and clean. */
function notaDoBloco(t, bloco, indice, moldes) {
  if (moldes.blocosConhecidos.some((b) => b.sha256 === sha256(bloco))) return null
  const linhas = bloco.split('\n').length
  const bytes = Buffer.byteLength(bloco, 'utf8')
  const motivos = []
  if (linhas > TETO_DE_LINHAS || bytes > TETO_DE_BYTES)
    motivos.push(`above the ${TETO_DE_LINHAS}-line/1,354-byte ceiling`)
  if (/https?:\/\/|www\./.test(bloco)) motivos.push('has a URL')
  if (/^ {0,3}(`{3,}|~{3,})/m.test(bloco)) motivos.push('has fenced code')
  if (bloco.split('<!--').length - 1 > 2) motivos.push('has a nested comment')
  if (EXEC_FORTE_TEXTO.test(bloco)) motivos.push('has an exec token')
  if (!motivos.length) return null
  const inicio = posicao(t, indice).linha
  return (
    `third-party block at AGENTS.md:${inicio}-${inicio + linhas - 1} is not a known Next.js block ` +
    `(${linhas} lines, ${bytes} bytes), ${motivos.join(', ')}`
  )
}

const REMEDIO = 'if this file was edited by hand, delete the marker line'

/**
 * instruction-provenance over the index of `r.dir`: the reprova string,
 * `{ nota }`, null, or `na` when no instruction file carries the marker.
 * `moldes` is the table's URL, injectable for the proofs.
 */
export function checarProvenance(r, { moldes = MOLDES } = {}) {
  const indice = lerIndice(r.dir)
  const malformada = allowlistMalformada(lerAllowlist(r.dir))
  if (malformada) return malformada

  const portadores = []
  for (const e of indice.entradas) {
    if (e.viaSymlink !== null || e.symlink !== null || e.texto === null || e.tipo !== 'agente')
      continue
    if (!ehArquivoMarkdown(e) || !e.texto.includes(MARCADOR_AGENTES)) continue
    const t = e.texto.replace(/\r\n/g, '\n')
    const marcadores = marcadoresFora(t)
    if (marcadores.length) portadores.push({ e, t, marcadores })
  }
  if (!portadores.length) return na('no instruction file carries the rebar generator marker')

  const tabela = carregarMoldes(moldes)
  const itens = []
  let nota = null
  for (const { e, t, marcadores } of portadores) {
    if (e.caminho !== 'AGENTS.md') {
      const { linha, coluna } = posicao(t, marcadores[0])
      itens.push(
        `${onde(e.caminho, linha, coluna)} carries the rebar generator marker, which the ` +
          'generator writes only at the top of the root AGENTS.md',
      )
      continue
    }
    const c = conferirAgents(t, tabela)
    if (c.estado === 'marcador-fora-do-topo') {
      const { linha, coluna } = posicao(t, c.indice)
      itens.push(
        `${onde('AGENTS.md', linha, coluna)} carries the rebar marker below the top; ${REMEDIO}`,
      )
    } else if (c.estado === 'marcador-repetido') {
      itens.push(`AGENTS.md carries the rebar marker ${c.n} times; ${REMEDIO}`)
    } else if (c.estado === 'divergente') {
      itens.push(
        `AGENTS.md carries the rebar marker and matches none of the ${tabela.versoes.length} ` +
          `template versions (closest ${c.versaoProxima}, first differing line ${c.linhaDivergente}); ${REMEDIO}`,
      )
    } else if (c.estado === 'confere') {
      if (c.bloco) nota = notaDoBloco(t, c.bloco, c.indiceDoBloco, tabela)
      else {
        const cauda = c.cauda.trim()
        const m = cauda ? RE_BLOCO.exec(cauda) : null
        if (m && m[0] === cauda)
          nota = notaDoBloco(t, cauda, t.indexOf(cauda, c.indiceDaCauda), tabela)
      }
    }
  }
  if (itens.length) {
    return `${itens.length} false generator claim(s): ${resumir(itens)}`
  }
  return nota ? { nota } : null
}
