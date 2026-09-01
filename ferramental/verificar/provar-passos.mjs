#!/usr/bin/env node
// provar-passos.mjs — as provas dos passos do `verificar` que são FUNÇÃO.
//
// Passo que é `comando:` já se prova sozinho: se o script que ele chama sumir
// ou quebrar, o passo cai. Passo que é `funcao:` é código do portão, e código
// do portão sem prova é o defeito que este repositório inteiro persegue,
// cometido no lugar mais caro possível.
//
// O ACHADO QUE ISTO FECHA, da auditoria de 31/08: `checarBlocos` entrou com
// 410 linhas em `verificar.config.mjs` — incluindo um tokenizador de string e
// template escrito à mão, com pilha de `${}` — e ZERO teste. `grep -rln
// checarBlocos` no repositório devolvia só a própria definição. Trocando o
// corpo dele por `return { codigo: 0 }`, o `npm run verificar` continuava
// APROVADO 9 de 9 e nada acusava. Um passo do portão que pode ser desligado
// sem ninguém perceber não é portão, é enfeite.
//
// A FORMA: mutação, não asserção de saída. Cada teste copia os blocos para um
// diretório temporário, planta UM defeito, e exige que o passo o encontre. É a
// mesma disciplina de `provas/provar.mjs` — dois casos por regra —, aplicada
// ao portão em vez de às regras.
//
// Uso:
//   node --test ferramental/verificar/provar-passos.mjs
//   node ferramental/verificar/provar-passos.mjs        (mesma coisa)

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

import { checarBlocos } from '../../verificar.config.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const BLOCOS = join('novo', 'site', 'blocos')

/**
 * Monta uma raiz temporária com os blocos dentro, aplica a mutação e devolve o
 * que o passo respondeu.
 *
 * A raiz é recriada em vez de apontar para o repositório vivo porque o passo
 * recebe `raiz` como parâmetro justamente para isso — e porque teste que
 * escreve no repositório é o defeito que o `provar-portao.mjs` do alicerce
 * tinha e que este repositório se recusou a herdar.
 */
async function comBlocosMutados(mutar) {
  const tmp = await mkdtemp(join(tmpdir(), 'rebar-passos-'))
  try {
    await cp(join(RAIZ, BLOCOS), join(tmp, BLOCOS), { recursive: true })
    await mutar({
      ler: (rel) => readFile(join(tmp, BLOCOS, rel), 'utf8'),
      escrever: (rel, texto) => writeFile(join(tmp, BLOCOS, rel), texto, 'utf8'),
    })
    return await checarBlocos({ raiz: tmp })
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

// ─────────────────────────────────────────────────────────── o caso que APROVA

test('APROVA · os blocos como estão no repositório passam', async () => {
  const r = await checarBlocos({ raiz: RAIZ })
  assert.equal(r.codigo, 0, `os blocos do repositório deveriam passar:\n${r.saida}`)
})

// ─────────────────────────────────────────── os casos que têm de REPROVAR
//
// Um por classe de defeito que o passo diz pegar. Se o passo for esvaziado —
// `return { codigo: 0 }` —, TODOS estes falham de uma vez, que é o ponto.

test('REPROVA · campo que não existe no site.json', async () => {
  const r = await comBlocosMutados(async ({ ler, escrever }) => {
    const t = await ler(join('app', 'manifest.ts'))
    // `nomeCurto` é lido de verdade pelo manifest; `nomeCurtoo` não existe.
    // O exemplo é nomeado no comentário do passo, e esta prova é o que impede
    // aquele comentário de virar folclore.
    assert.ok(t.includes('nomeCurto'), 'o manifest.ts deixou de ler meta.nomeCurto')
    await escrever(join('app', 'manifest.ts'), t.replace(/nomeCurto\b/g, 'nomeCurtoo'))
  })
  assert.equal(r.codigo, 1, `esperava reprovar, saiu ${r.codigo}:\n${r.saida}`)
  assert.match(r.saida, /nomeCurtoo/, 'a saída tem de nomear o campo inexistente')
})

test('REPROVA · campo inexistente também em .tsx, não só em .ts', async () => {
  const r = await comBlocosMutados(async ({ ler, escrever }) => {
    const t = await ler(join('app', 'page.tsx'))
    assert.match(t, /site\.[a-zA-Z.]+/, 'o page.tsx deixou de acessar o site')
    await escrever(join('app', 'page.tsx'), t.replace(/site\.identidade\b/, 'site.identidadeZZZ'))
  })
  assert.equal(r.codigo, 1, `esperava reprovar, saiu ${r.codigo}:\n${r.saida}`)
  assert.match(r.saida, /identidadeZZZ/)
})

test('NÃO ACUSA · caminho que aparece só dentro de string', async () => {
  // O tokenizador existe por isto: `esquema.ts` escreve "conteudo/site.json"
  // em mensagem de erro, e o padrão de acesso a campo casa dentro da string.
  // Sem tirar string, os blocos acusam doze caminhos inexistentes.
  const r = await comBlocosMutados(async ({ ler, escrever }) => {
    const t = await ler(join('app', 'page.tsx'))
    await escrever(
      join('app', 'page.tsx'),
      `const aviso = "leia site.campoQueNaoExiste no manual"\n${t}`,
    )
  })
  assert.equal(r.codigo, 0, `string não é acesso a campo, mas reprovou:\n${r.saida}`)
})

test('NÃO ACUSA · caminho dentro de comentário', async () => {
  const r = await comBlocosMutados(async ({ ler, escrever }) => {
    const t = await ler(join('app', 'page.tsx'))
    await escrever(join('app', 'page.tsx'), `// site.outroCampoInexistente\n${t}`)
  })
  assert.equal(r.codigo, 0, `comentário não é código, mas reprovou:\n${r.saida}`)
})

test('REPROVA · bloco que sumiu do disco', async () => {
  const r = await comBlocosMutados(async ({ escrever }) => {
    await escrever(join('app', 'manifest.ts'), '')
  })
  // Arquivo vazio não tem o que checar, mas o passo não pode dizer "tudo certo"
  // sobre um bloco que o gerador vai copiar vazio para todo projeto.
  assert.notEqual(r.saida.length, 0, 'o passo ficou mudo sobre um bloco vazio')
})

test('REPROVA · JSON de exemplo quebrado', async () => {
  const r = await comBlocosMutados(async ({ escrever }) => {
    await escrever('modelo.json', '{ isso nao e json')
  })
  assert.notEqual(r.codigo, 0, `esperava reprovar, saiu ${r.codigo}:\n${r.saida}`)
})
