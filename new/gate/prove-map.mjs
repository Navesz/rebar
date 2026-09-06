#!/usr/bin/env node
// As provas do MAPA DE ARQUIVOS do gerador.
//
// POR QUE ESTE ARQUIVO EXISTE, e é a lição mais cara desta árvore.
//
// Durante a tradução dos nomes para o inglês, um `sed` trocou as referências
// que tinham forma de caminho e nenhum arquivo de molde. O `aplicar.mjs` passou
// a ler `verify.yml` de uma pasta onde o arquivo se chama `verificar.yml`, e os
// hooks emitidos passaram a chamar `.githooks/varrer-segredo.mjs` enquanto o
// arquivo copiado se chamava `scan-secret.mjs`.
//
// `rebar novo` morreu com ENOENT no quarto estático. E o `npm run verify`
// FICOU 15 DE 15 VERDE a renomeação inteira, por seis commits, porque nenhum
// passo do portão gera um projeto. O checker se prova, as regras se provam, o
// MCP se prova, o portão se prova — e o produto não.
//
// POR QUE NÃO GERAR UM PROJETO INTEIRO AQUI. A geração de verdade roda
// `npm create vite`, `shadcn` e `npm install`: minutos, rede, e um passo de
// portão que ninguém espera é um passo que alguém desliga. O que quebrou não
// foi a geração, foi o MAPA — nomes que deixaram de casar. Então o que se prova
// é o mapa, em milissegundos e sem rede.
//
// Uso:  node --test new/gate/prove-map.mjs

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test, { describe } from 'node:test'

import { ESTATICOS, COPIADOS_DO_REBAR, EXECUTAVEIS } from './aplicar.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const MOLDES = join(AQUI, 'arquivos')

/** O conjunto de caminhos que o gerador ESCREVE no projeto criado. */
const emitidos = new Set([...ESTATICOS, ...COPIADOS_DO_REBAR].map(([, destino]) => destino))

describe('o mapa de arquivos do gerador', { concurrency: 4 }, () => {
  test('toda fonte de ESTATICOS existe em new/gate/arquivos/', () => {
    const faltando = ESTATICOS.filter(([fonte]) => !existsSync(join(MOLDES, fonte))).map(([f]) => f)
    assert.deepEqual(
      faltando,
      [],
      `o gerador lê molde que não existe — é o ENOENT que matou o \`rebar novo\`:\n  ${faltando.join('\n  ')}`,
    )
  })

  test('toda fonte de COPIADOS_DO_REBAR existe no rebar', () => {
    const faltando = COPIADOS_DO_REBAR.filter(([fonte]) => !existsSync(join(RAIZ, fonte))).map(
      ([f]) => f,
    )
    assert.deepEqual(
      faltando,
      [],
      `o gerador copia arquivo do rebar que não está mais lá (renomeado?):\n  ${faltando.join('\n  ')}`,
    )
  })

  // O DEFEITO QUE PASSOU DESPERCEBIDO POR MAIS TEMPO. Os dois lados estavam
  // certos separados: o arquivo era copiado com nome inglês, e o hook chamava o
  // nome português. Cada arquivo existia; o par é que não fechava.
  test('todo .githooks/*.mjs que um molde CHAMA é um arquivo que o gerador EMITE', () => {
    const chamados = new Set()
    for (const nome of readdirSync(MOLDES)) {
      const t = readFileSync(join(MOLDES, nome), 'utf8')
      for (const m of t.matchAll(/\.githooks\/[A-Za-z0-9._-]+\.mjs/g)) chamados.add(m[0])
    }
    const orfaos = [...chamados].filter((c) => !emitidos.has(c))
    assert.deepEqual(
      orfaos,
      [],
      `molde chama arquivo que o gerador não escreve — o hook do projeto criado quebra no primeiro commit:\n  ${orfaos.join('\n  ')}`,
    )
  })

  test('os arquivos marcados como executáveis estão entre os emitidos', () => {
    const orfaos = EXECUTAVEIS.filter((e) => !emitidos.has(e))
    assert.deepEqual(
      orfaos,
      [],
      `marca 100755 em arquivo que não é emitido:\n  ${orfaos.join('\n  ')}`,
    )
  })

  // Contra-isca: uma fonte que existe mas nunca é emitida é molde morto, e
  // molde morto envelhece sem ninguém notar. `agentes.md` é a exceção
  // declarada — passa por `moldeAgents` em vez de ser copiado, e o próprio
  // `aplicar.mjs` explica por quê.
  test('nenhum molde fica órfão em new/gate/arquivos/', () => {
    const usados = new Set(ESTATICOS.map(([fonte]) => fonte))
    const EXCECOES = new Set(['agentes.md', 'modelo.json'])
    const orfaos = readdirSync(MOLDES).filter((n) => !usados.has(n) && !EXCECOES.has(n))
    assert.deepEqual(
      orfaos,
      [],
      `molde que ninguém copia — ou entra em ESTATICOS, ou sai da pasta:\n  ${orfaos.join('\n  ')}`,
    )
  })
})
