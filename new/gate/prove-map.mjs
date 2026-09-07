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

import { ESTATICOS, COPIADOS_DO_REBAR, EXECUTAVEIS, moldeAgents } from './aplicar.mjs'

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
describe('o workflow que o gerador emite', () => {
  // COMENTÁRIO FORA ANTES DE OLHAR, e a razão apareceu na primeira execução
  // destes testes: o comentário que EXPLICA por que o `.nvmrc` saiu contém a
  // string `.nvmrc`, e o teste leu a explicação como diretiva — reprovando o
  // próprio conserto. É a mesma armadilha que o `ci-gates` do rebar-check já
  // tinha resolvido extraindo só os valores de `run:`. Comentário não executa.
  const yml = readFileSync(join(MOLDES, 'verificar.yml'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join(String.fromCharCode(10))

  /** Os jobs do workflow, com o corpo de cada um. Indentação de dois espaços. */
  const jobs = () => {
    const corpo = yml.slice(yml.indexOf(String.fromCharCode(10) + 'jobs:') + 1)
    const achados = []
    const marcas = [...corpo.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)]
    marcas.forEach((m, i) => {
      const fim = i + 1 < marcas.length ? marcas[i + 1].index : corpo.length
      achados.push({ nome: m[1], corpo: corpo.slice(m.index, fim) })
    })
    return achados
  }

  // ── que ele publique
  //
  // O gerador entrega um Next com `output: "export"` e um `.pages.yml`: tudo
  // apontando para GitHub Pages, e até 2026-09-06 nada que publicasse. Foi
  // medido no rebar-site, que este gerador gerou — publicar exigiu escrever o
  // job à mão lá dentro, e a solução ficou no projeto em vez de voltar ao molde.
  test('o workflow emitido tem um job que publica', () => {
    const publica = jobs().filter((j) => /actions\/deploy-pages/.test(j.corpo))
    assert.equal(
      publica.length,
      1,
      'o preset `site` nasce pronto para GitHub Pages e sem nada que o publique',
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
    const topo = yml.slice(0, yml.indexOf(String.fromCharCode(10) + 'jobs:'))
    assert.doesNotMatch(
      topo,
      /pages:\s*write/,
      'a permissão de Pages vazou para o escopo do arquivo',
    )
  })

  // ── e que ele não cite arquivo que não existe
  //
  // Mesmo teste que já existia para os hooks — "todo `.githooks/*.mjs` que um
  // molde CHAMA é um arquivo que o gerador EMITE" — aplicado ao workflow, que é
  // onde faltava e onde custou: o job `publicar` veio colado do rebar-site com
  // `node-version-file` apontando para um `.nvmrc` que o gerador não escreve. O
  // único job com `pages: write` morria no setup-node, e o `generator-map`
  // ficava verde porque conferia a ESTRUTURA do job, nunca as dependências dele.
  const noProjeto = new Set([...emitidos, 'AGENTS.md', '.rebar-coauthors', 'package.json'])

  test('`node-version-file` aponta para arquivo emitido, ou não existe', () => {
    for (const m of yml.matchAll(/node-version-file:\s*['"]?([^'"\s]+)/g)) {
      assert.ok(
        noProjeto.has(m[1]),
        `o workflow pede "${m[1]}" e o gerador não escreve esse arquivo — o setup-node morre e ` +
          `o job inteiro nunca roda. Ou emita o arquivo, ou fixe a versão com \`node-version:\``,
      )
    }
  })

  test('todo caminho de arquivo citado em `run:` é emitido', () => {
    // Só caminho com pasta e extensão conhecida: `npm run x` não é arquivo.
    for (const m of yml.matchAll(/^\s*(?:- )?run:\s*(.+)$/gm)) {
      for (const alvo of m[1].matchAll(
        /(?:^|\s)([\w.-]+\/[\w.\/-]+\.(?:mjs|js|cjs|json|yml|yaml))/g,
      )) {
        assert.ok(noProjeto.has(alvo[1]), `o workflow roda "${alvo[1]}", que o gerador não escreve`)
      }
    }
  })
})

// O AGENTS.md do PROJETO GERADO — e é o gerado, não o molde.
//
// O `portao.test.mjs` que o gerador emite faz sete asserções sobre esse arquivo,
// e até 2026-09-07 nada as executava aqui. Duas divergências viviam disso:
//
//   · o molde mandava o leitor para `.rebar-coautores`, com o nome antigo, e o
//     teste emitido afere `.rebar-coauthors`. O `npm test` do projeto reprovava
//     no primeiro dia — o dia em que o dono mais confia no que recebeu.
//   · a primeira versão DESTE teste pegava uma asserção só, com `.exec()`, e
//     dizia ser a da allowlist. São sete, e `.exec()` devolve a primeira: ele
//     conferia o `npx` e passava com o nome da allowlist errado. Teste que passa
//     pelo motivo errado é pior que teste nenhum, porque ocupa o lugar dele.
//
// O alvo é a saída de `moldeAgents`, que é o que vai para o disco. Uma das sete
// mora dentro de `if (abre)` e só vale quando o bloco do shadcn foi inserido —
// por isso o bloco entra aqui, e por isso ele entra com o conteúdo que o teste
// emitido procura.
const BLOCO_DO_SHADCN = [
  '<!-- BEGIN:nextjs-agent-rules -->',
  'Consulte a documentação em node_modules/next/dist/docs quando precisar.',
  '<!-- END:nextjs-agent-rules -->',
].join(String.fromCharCode(10))

describe('o AGENTS.md que o gerador escreve', () => {
  const teste = readFileSync(join(MOLDES, 'portao.test.mjs'), 'utf8')
  // Nao-guloso ate a barra seguida de virgula ou parentese: e o fim do literal
  // de regex, e so ele. A versao ingenua `[^/]+` cortava
  // `github:Navesz\/rebar` no meio, e o pedaco truncado casava com quase tudo.
  const exigidos = [...teste.matchAll(/assert\.match\(\s*agents,\s*\/(.+?)\/[,)]/g)].map(
    (m) => m[1],
  )

  test('o teste emitido continua exigindo alguma coisa do AGENTS.md', () => {
    assert.ok(
      exigidos.length >= 5,
      `o portao.test.mjs afere ${exigidos.length} coisa(s) do AGENTS.md — se caiu para menos, ` +
        `alguém tirou asserção do teste que vai para o usuário`,
    )
  })

  test('E O ARQUIVO GERADO SATISFAZ TODAS ELAS', () => {
    const agents = moldeAgents('padaria-do-ze', BLOCO_DO_SHADCN)
    const faltando = exigidos.filter((fonte) => !new RegExp(fonte).test(agents))
    assert.deepEqual(
      faltando,
      [],
      `o teste que o gerador EMITE exige isto do AGENTS.md e o arquivo gerado não tem: ` +
        `${faltando.join(' · ')}. O \`npm test\` do projeto reprova no primeiro dia.`,
    )
  })

  test('o bloco do shadcn atravessa intacto — é dele que fala o `if (abre)`', () => {
    const agents = moldeAgents('padaria-do-ze', BLOCO_DO_SHADCN)
    assert.ok(
      agents.includes(BLOCO_DO_SHADCN),
      'o bloco de terceiro foi alterado no caminho. O molde diz que ele fica INTACTO de propósito: ' +
        'ele fala da versão do Next instalada e envelhece junto com ela',
    )
  })

  test('sem bloco de terceiro não sobra cabeçalho órfão', () => {
    const agents = moldeAgents('padaria-do-ze', '')
    assert.doesNotMatch(
      agents,
      /Aviso do scaffold/,
      'sem bloco, a seção que o envolve não pode aparecer — sobraria um cabeçalho apontando para nada',
    )
    assert.equal(
      agents.includes('BEGIN:nextjs-agent-rules'),
      agents.includes('END:nextjs-agent-rules'),
      'o bloco `nextjs-agent-rules` ficou pela metade',
    )
  })

  test('o nome do projeto entra, e nenhum marcador de molde sobra cru', () => {
    const agents = moldeAgents('padaria-do-ze', BLOCO_DO_SHADCN)
    assert.match(agents, /padaria-do-ze/, 'o nome do projeto não foi trocado no molde')
    assert.doesNotMatch(
      agents,
      /{{\s*nome\s*}}/,
      'sobrou marcador `{{nome}}` cru no arquivo gerado',
    )
  })
})
