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
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
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

// ───────────────────────────────────────── o passo `mcp` — portão de frescor
//
// O objetivo nº 5 do ESTADO.md: "manter o MCP vivo — regra mudou, MCP se
// regenera, e o portão reprova se estiver velho". O defeito que ele mata é o
// que o dono viveu no Herz e no BMB Compras: o MCP guardava as regras do
// projeto, as regras mudaram, o MCP continuou servindo a versão velha, e
// ninguém percebeu. Um portão que só EXISTE tem exatamente esse defeito — foi
// por não ter prova que `checarBlocos` pôde nascer com 410 linhas e zero teste.
//
// POR QUE ESTAS PROVAS RODAM UM PROCESSO, e não chamam uma função.
//
// O passo `mcp` é `comando:` e não `funcao:`, e o resto deste arquivo só
// alcança `funcao:`. A saída escolhida foi a segunda: a prova roda
// `node mcp/gerar.mjs --verificar` como processo. Três razões, na ordem em que
// pesam:
//
//   1. O CONTRATO ENTRE AS FRENTES É UMA CLI. `node mcp/gerar.mjs --verificar`
//      regenera em memória, compara com o disco e sai 1 se divergir. Virar
//      `funcao:` exigiria um SEGUNDO contrato — um export de módulo — para a
//      mesma verdade. É literalmente o que a §7.2 do PLANO proíbe: "derivado,
//      nunca duplicado; não há duas fontes para divergir". Um portão de
//      frescor com duas fontes para divergir é uma piada sobre si mesmo.
//   2. `funcao:` roda DENTRO do processo do verificar, e o `mcp/` é pacote
//      separado que PODE ter dependência. Importar o gerador ali dentro faria
//      um erro dele derrubar o portão inteiro em vez de um passo — e daria ao
//      `verificar` da raiz um caminho de import para dentro de um pacote com
//      `node_modules` próprio, que é o oposto da regra de zero dependência na
//      raiz.
//   3. Rodar o processo é a prova MAIS FORTE. Ela exercita exatamente os bytes
//      que o portão executa: o mesmo argv, o mesmo código de saída, a mesma
//      stdout. Uma prova que chamasse uma função estaria provando um caminho
//      que o portão não usa.
//
// O caso que importa é ARTEFATO VELHO: a regra mudou no `index.mjs` e o
// `regras.gerado.json` ficou para trás. É o defeito do Herz, encenado.

const GERADOR = 'mcp/gerar.mjs'
const FONTE = join('ferramental', 'rebar-check', 'index.mjs')
const ARTEFATO = join('mcp', 'regras.gerado.json')

// Enquanto a outra frente não entrega o gerador, estas provas ficam SKIP em vez
// de vermelhas — e o buraco não é silencioso: o passo `mcp` do
// verificar.config.mjs lista `mcp/gerar.mjs` em `exige`, então a ausência já
// QUEBRA o portão inteiro com exit 127 e uma linha nomeando o arquivo. Duas
// bocas gritando o mesmo fato só ensinariam a ignorar as duas, e deixariam a
// suíte `passos` vermelha por um motivo que não é dela.
const RAZAO_DO_SKIP = existsSync(join(RAIZ, 'mcp', 'gerar.mjs'))
  ? false
  : 'mcp/gerar.mjs ainda não existe — o passo `mcp` do verificar já reprova isso por `exige` (exit 127)'

/**
 * Monta uma raiz temporária com o gerador, o artefato e a fonte das regras,
 * aplica a mutação e roda `node mcp/gerar.mjs --verificar` lá dentro.
 *
 * `node_modules` fica FORA da cópia de propósito: o portão de frescor roda no
 * `verificar` da raiz e tem de funcionar sem `mcp/node_modules`. Copiar as
 * dependências esconderia uma regressão nisso — o gerador passaria aqui e
 * quebraria em clone limpo, que é o pior lugar para descobrir.
 *
 * `provas/` do rebar-check também fica fora: são 262 arquivos de fixture que o
 * gerador não lê, e a cópia é feita a cada teste.
 */
const semPasta = (nome) => (src) => !src.split(/[\\/]/).includes(nome)

async function comMcpMutado(mutar) {
  const tmp = await mkdtemp(join(tmpdir(), 'rebar-mcp-'))
  try {
    await cp(join(RAIZ, 'mcp'), join(tmp, 'mcp'), {
      recursive: true,
      filter: semPasta('node_modules'),
    })
    await cp(join(RAIZ, 'ferramental', 'rebar-check'), join(tmp, 'ferramental', 'rebar-check'), {
      recursive: true,
      filter: semPasta('provas'),
    })
    await cp(join(RAIZ, 'package.json'), join(tmp, 'package.json'))

    await mutar({
      ler: (rel) => readFile(join(tmp, rel), 'utf8'),
      escrever: (rel, texto) => writeFile(join(tmp, rel), texto, 'utf8'),
      apagar: (rel) => rm(join(tmp, rel), { force: true }),
    })

    // Mesma forma que o passo usa: cwd na raiz, caminho relativo em argv, sem
    // shell. Sem shell não há regra de aspas do cmd.exe para acertar, que é o
    // bug de `npx` que o rebar herdou do alicerce e se recusou a repetir.
    const r = spawnSync(process.execPath, [GERADOR, '--verificar'], {
      cwd: tmp,
      encoding: 'utf8',
      windowsHide: true,
    })
    return { codigo: r.status, saida: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

test('APROVA · artefato em dia, sem mutação nenhuma', { skip: RAZAO_DO_SKIP }, async () => {
  const r = await comMcpMutado(async () => {})
  assert.equal(
    r.codigo,
    0,
    'o mcp/regras.gerado.json do repositório está VELHO (ou o gerador não roda ' +
      `sem mcp/node_modules). Regenere com: node mcp/gerar.mjs\n${r.saida}`,
  )
})

test(
  'REPROVA · título de regra mudou e o artefato ficou para trás',
  { skip: RAZAO_DO_SKIP },
  async () => {
    const r = await comMcpMutado(async ({ ler, escrever }) => {
      const t = await ler(FONTE)
      const antes = "titulo: 'tem .editorconfig'"
      assert.ok(t.includes(antes), `a regra editorconfig mudou de forma em ${FONTE}`)
      await escrever(FONTE, t.replace(antes, "titulo: 'TITULO-TROCADO-PELA-PROVA'"))
    })
    assert.notEqual(
      r.codigo,
      0,
      'a regra mudou e o artefato ficou para trás — é o defeito do Herz, e o ' +
        `portão de frescor deixou passar:\n${r.saida}`,
    )
    assert.match(
      r.saida,
      /editorconfig|TITULO-TROCADO-PELA-PROVA/,
      'reprovar sem dizer O QUE divergiu manda o dono reler 21 regras à mão',
    )
  },
)

test('REPROVA · regra NOVA na fonte e artefato sem ela', { skip: RAZAO_DO_SKIP }, async () => {
  const r = await comMcpMutado(async ({ ler, escrever }) => {
    const t = await ler(FONTE)
    const ancora = 'const REGRAS = ['
    assert.ok(t.includes(ancora), `a lista de regras mudou de forma em ${FONTE}`)
    // Regra completa e inerte: id, classe, nível, título e um `checar` que
    // nunca acusa nada. Qualquer derivação fiel da fonte ganha uma entrada.
    const plantada =
      `${ancora}\n  {\n    id: 'regra-plantada-pela-prova',\n` +
      "    classe: 'determinística',\n    nivel: 'N0',\n" +
      "    titulo: 'regra plantada pela prova do passo mcp',\n" +
      '    checar: () => null,\n  },'
    await escrever(FONTE, t.replace(ancora, plantada))
  })
  assert.notEqual(r.codigo, 0, `regra nova sem regenerar o MCP passou limpo:\n${r.saida}`)
  assert.match(
    r.saida,
    /regra-plantada-pela-prova/,
    'o diff tem de nomear a regra que entrou, senão não é diff, é reclamação',
  )
})

test('REPROVA · artefato apagado, e com exit 1, não 127', { skip: RAZAO_DO_SKIP }, async () => {
  // Isto pina a decisão do passo: `exige` lista SÓ `mcp/gerar.mjs`, nunca o
  // artefato. Ferramenta ausente é QUEBROU (127) do executor; artefato ausente
  // é o REPOSITÓRIO velho, e quem tem de dizer isso é o gerador, com exit 1.
  // Se o artefato entrasse no `exige`, sumir com ele viraria "ferramental
  // faltando" — a acusação errada, apontando para quem não errou.
  const r = await comMcpMutado(async ({ apagar }) => {
    await apagar(ARTEFATO)
  })
  assert.notEqual(r.codigo, 0, 'sem artefato nenhum o gerador disse que está tudo em dia')
})

// ─────────────────────────────────── o portão não pode encolher em silêncio
//
// ACHADO DA AUDITORIA DE 31/08, e é o mais irônico do módulo: removendo o
// objeto `nome: 'mcp'` inteiro do `verificar.config.mjs`, o portão imprimia
// `APROVADO 10 de 10`, verde e mudo. O mecanismo que torna impossível esquecer
// o MCP podia ele mesmo ser esquecido, e nada no repositório notava.
//
// A contagem "N de N" é a armadilha: ela mede contra a própria lista, então
// lista menor continua completa. Um portão que se mede por si mesmo aprova
// qualquer encolhimento.
//
// ONDE A RECURSÃO PARA, e vale dizer em vez de fingir que fechou: este teste
// pode ser apagado junto. O que ele compra é que apagar um passo passa a exigir
// DUAS edições, em dois arquivos, num diff que a revisão vê. O ponto fixo de
// verdade é o ruleset no servidor, que exige o check `verificar` por nome e
// não mora em arquivo nenhum deste repositório — é o N4s, e é o único nível
// que o agente não edita.

const PASSOS_ESPERADOS = [
  'higiene',
  'hooks',
  'sintaxe',
  'blocos',
  'mcp-servidor',
  'mcp',
  'formato',
  'elos',
  'segredo',
  'passos',
  'provas',
  'auto',
]

test('O PORTÃO NÃO ENCOLHE · todos os passos esperados continuam na lista', async () => {
  const config = await import('../../verificar.config.mjs')
  const nomes = (config.default ?? []).map((p) => p.nome)

  const sumiram = PASSOS_ESPERADOS.filter((n) => !nomes.includes(n))
  assert.deepEqual(
    sumiram,
    [],
    `passo(s) removidos do verificar.config.mjs sem tirar desta lista: ${sumiram.join(', ')}.\n` +
      `Se a remoção é intencional, tire o nome de PASSOS_ESPERADOS no mesmo commit — ` +
      `é o que torna o encolhimento visível na revisão.`,
  )

  // O inverso não é erro: passo NOVO que ainda não está na lista só precisa ser
  // acrescentado. Fica como aviso no relatório do teste, sem reprovar, porque
  // reprovar aqui puniria quem está justamente acrescentando portão.
  const novos = nomes.filter((n) => !PASSOS_ESPERADOS.includes(n))
  if (novos.length) console.log(`      nota: passo(s) novo(s) fora da lista: ${novos.join(', ')}`)
})
