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

// ─────────────────────────────────────────────────────────────────────────────
// O PROJETO GERADO TEM DE TER COMO PUBLICAR — e não por fora do portão
//
// P2 #9. O gerador entrega um Next configurado para export estático
// (`output: "export"`, `trailingSlash`, `images.unoptimized`) e um `.pages.yml`
// para o Pages CMS: tudo apontando para GitHub Pages, e nenhum job que
// publicasse. O projeto nascia com tudo para publicar e nada que publique.
//
// Foi medido no `rebar-site`, que este gerador gerou: publicar exigiu escrever
// o job à mão lá dentro, e a solução ficou no projeto em vez de voltar ao
// molde. "Derivado, nunca duplicado" existe exatamente para isso.
//
// A segunda asserção é a que importa mais que a primeira. Ter deploy não vale
// nada se ele puder rodar com o portão vermelho: um job de publicação sem
// `needs` é um caminho paralelo ao portão, e o portão vira relatório.
describe('publicação', () => {
  const yml = readFileSync(join(MOLDES, 'verificar.yml'), 'utf8')

  /** Os jobs do workflow, com o corpo de cada um. Indentação de dois espaços. */
  const jobs = () => {
    const corpo = yml.slice(yml.indexOf('\njobs:') + 1)
    const achados = []
    const re = /^ {2}([a-z][a-z0-9-]*):$/gm
    const marcas = [...corpo.matchAll(re)]
    marcas.forEach((m, i) => {
      const fim = i + 1 < marcas.length ? marcas[i + 1].index : corpo.length
      achados.push({ nome: m[1], corpo: corpo.slice(m.index, fim) })
    })
    return achados
  }

  test('o workflow emitido tem um job que publica', () => {
    const publica = jobs().filter((j) => /actions\/deploy-pages/.test(j.corpo))
    assert.equal(
      publica.length,
      1,
      'o preset `site` nasce pronto para GitHub Pages e sem nada que o publique — ' +
        'foi assim que o rebar-site precisou do job escrito à mão em vez de gerado',
    )
  })

  test('E ELE NÃO CORRE POR FORA DO PORTÃO · todo deploy depende de `verificar`', () => {
    for (const j of jobs().filter((x) =>
      /actions\/deploy-pages|upload-pages-artifact/.test(x.corpo),
    )) {
      assert.match(
        j.corpo,
        /^\s+needs: verificar$/m,
        `o job "${j.nome}" publica sem depender do portão — deploy paralelo sobe a página com o ` +
          `lint quebrado, e aí o portão é relatório, não porta`,
      )
    }
  })

  test('a permissão de escrever no Pages fica SÓ no job que publica', () => {
    // `permissions: pages: write` no topo daria a chave a todo job do arquivo,
    // inclusive ao que roda código de PR de terceiro.
    const topo = yml.slice(0, yml.indexOf('\njobs:'))
    assert.doesNotMatch(
      topo,
      /pages:\s*write/,
      'a permissão de Pages vazou para o escopo do arquivo',
    )
  })
})
