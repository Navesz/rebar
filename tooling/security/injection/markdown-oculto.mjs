// markdown-oculto — hidden-markdown-directive: a region of a tracked Markdown or
// agent rule file that the rendered page hides and that is addressed to an agent.
//
// The regions and the signal families live in instrucoes.mjs, which says what
// was measured for each. This file only walks the index, grades each finding by
// the clients that load the file, and applies the allowlist.
//
// Printed per region: the position, its kind, its word count, the family names
// and the clients. Never a word of the region.

import { avaliarRegiao, clientesDe, ehArquivoMarkdown, regioesOcultas } from './instrucoes.mjs'
import {
  allowlistMalformada,
  lerAllowlist,
  lerIndice,
  notasDaAllowlist,
  onde,
  resumir,
} from './reader.mjs'

const na = (motivo) => ({ na: motivo })

const NOME_DA_FORMA = {
  'comentario bloco': 'block comment',
  'comentario inline': 'inline comment',
  'definicao definicao': 'unused link definition',
  'elemento estilo': 'element hidden by style',
  'elemento hidden': 'element with the hidden attribute',
}

/**
 * hidden-markdown-directive over the index of `r.dir`: the reprova string,
 * `{ nota }`, null, or `na` when git tracks no Markdown or agent rule file.
 */
export function checarHiddenMarkdown(r) {
  const indice = lerIndice(r.dir)
  const allowlist = lerAllowlist(r.dir)
  const malformada = allowlistMalformada(allowlist)
  if (malformada) return malformada

  // Unreadable agent entries (texto null) are skipped: control-bytes already
  // fails an agent file it cannot read the way the agent does.
  const alvos = indice.entradas.filter(
    (e) => e.viaSymlink === null && e.symlink === null && e.texto !== null && ehArquivoMarkdown(e),
  )
  const notas = () => notasDaAllowlist(allowlist, 'hidden-markdown-directive', usouAlguma)
  let usouAlguma = false
  if (!alvos.length) {
    const n = notas()
    return n.length ? { nota: n.join(' · ') } : na('no tracked Markdown or agent instruction file')
  }

  const itens = []
  for (const e of alvos) {
    const texto = e.texto.replace(/\r\n/g, '\n')
    // Cheap first: a file with none of the three openers has no region.
    if (!texto.includes('<!--') && !texto.includes(']:') && !texto.includes('<')) continue
    const diretivas = []
    for (const regiao of regioesOcultas(texto)) {
      const a = avaliarRegiao(regiao.corpo)
      if (a.familias.length) diretivas.push({ regiao, a })
    }
    if (!diretivas.length) continue
    if (allowlist.aceita('hidden-markdown-directive', { arquivo: e.caminho, oid: e.oid })) {
      usouAlguma = true
      continue
    }
    const { clientes, removeBloco } = clientesDe(e.caminho, e.tipo)
    for (const { regiao, a } of diretivas) {
      const forma = NOME_DA_FORMA[`${regiao.tipo} ${regiao.forma}`]
      const remove =
        removeBloco && regiao.tipo === 'comentario' && regiao.forma === 'bloco'
          ? '; Claude Code strips block comments'
          : ''
      itens.push(
        `${onde(e.caminho, regiao.linha, regiao.coluna)} (${forma}, ${a.palavras} words, ` +
          `${a.familias.join('+')}; loaded by ${clientes}${remove})`,
      )
    }
  }

  if (itens.length) {
    return (
      `${itens.length} hidden region(s) addressed to an agent: ${resumir(itens, 5)} — the rendered ` +
      'page hides this text and the agent reads it; make it visible prose or delete it, or ' +
      'allowlist the file with a reason'
    )
  }
  const n = notas()
  return n.length ? { nota: n.join(' · ') } : null
}
