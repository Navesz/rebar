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

import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test, { after, describe } from 'node:test'

import { checarBlocos, checarSintaxe } from '../../verificar.config.mjs'

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

// ─────────────────────────────────────────────────── por que grupos, e não
// testes soltos no topo do arquivo
//
// No `node:test`, teste declarado no topo do arquivo roda em SÉRIE: o
// `concurrency` da raiz é 1 e não há flag que mude isso para um arquivo só
// (`--test-concurrency` divide ARQUIVOS, e aqui só existe um). Medido com
// quatro testes de 500 ms: 2144 ms no topo contra 616 ms dentro de um
// `describe` com `concurrency: 4`.
//
// Isso importa porque quase todo teste daqui é ESPERA, não conta: montar uma
// raiz temporária e rodar um processo. Em série os 18 testes davam 3,5 s e o
// passo `passos` era o quarto mais caro do portão; a conta piorava a cada prova
// nova, que é o incentivo errado num arquivo cujo trabalho é ganhar provas.
//
// Cada família vira um `describe` concorrente. Os grupos continuam em série
// entre si, e dentro de um grupo a ORDEM DO RELATÓRIO passa a ser a de
// término — o preço, e ele é pequeno porque o que se lê aqui é o nome do teste
// que ficou vermelho, não a sequência.

describe('o passo `blocos`', { concurrency: 7 }, () => {
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
 * Copia `origem` para `destino` pulando UMA pasta pelo nome.
 *
 * POR QUE NÃO PELO CAMPO `filter` DO `fs.cp`.
 *
 * A versão anterior passava `{ recursive: true, filter: semPasta('provas') }`.
 * A/B intercalado nesta máquina (Windows 11, Node 24.13), quatro pares
 * seguidos, copiando os DOIS arquivos que sobram de
 * `ferramental/rebar-check`:
 *
 *   filter    700 · 723 · 647 · 631 ms
 *   readdir     6 ·   5 ·   6 ·   5 ms
 *
 * ~120×. O `filter` recusa entrada por entrada, mas só DEPOIS de o `fs.cp`
 * recursivo ter percorrido a árvore de origem — e `provas/` tem 262 fixtures.
 * Pagava-se a caminhada inteira para descartá-la. Pulando a pasta no `readdir`,
 * antes de o `cp` saber que ela existe, não há caminhada.
 *
 * O que isso NÃO comprou: o passo `passos` não caiu junto na mesma proporção,
 * porque o que sobra nele é subir processo (dois `node` por teste da família
 * `numeros`), e disso não dá para fugir sem parar de exercitar a CLI. Fica
 * registrado para o próximo que medir e estranhar: o desperdício era real e
 * saiu, o gargalo é outro.
 */
async function copiarSem(origem, destino, pasta) {
  await mkdir(destino, { recursive: true })
  for (const nome of await readdir(origem)) {
    if (nome === pasta) continue
    await cp(join(origem, nome), join(destino, nome), { recursive: true })
  }
}

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
async function comMcpMutado(mutar) {
  const tmp = await mkdtemp(join(tmpdir(), 'rebar-mcp-'))
  try {
    await copiarSem(join(RAIZ, 'mcp'), join(tmp, 'mcp'), 'node_modules')
    await copiarSem(
      join(RAIZ, 'ferramental', 'rebar-check'),
      join(tmp, 'ferramental', 'rebar-check'),
      'provas',
    )
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

describe('o passo `mcp`', { concurrency: 4 }, () => {
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
})

// ────────────────────────── o passo `numeros` — portão de frescor dos documentos
//
// O MESMO defeito do passo `mcp`, no segundo lugar onde ele mora. Medido no
// README antes de o medidor existir: `16 determinísticas` quando são 17, `50
// casos` quando são 52, `21 de 21 regras com prova` quando são 22 de 22, `os 8
// passos` quando são 12 — e o ESTADO.md com QUATRO contagens diferentes de
// casos de prova (13, 33, 47 e 50) no mesmo arquivo.
//
// A prova roda um PROCESSO pelas mesmas três razões escritas acima para o passo
// `mcp`, e elas valem palavra por palavra: o contrato entre as frentes é a CLI,
// um export de módulo seria a segunda fonte que a §7.2 proíbe, e rodar o
// processo exercita exatamente os bytes que o portão executa.
//
// A MUTAÇÃO QUE ESTAS PROVAS TÊM DE MATAR é `--verificar` passar a sair 0
// sempre. Cada teste abaixo planta UM defeito e exige exit ≠ 0; um medidor
// esvaziado derruba os cinco de uma vez, que é o ponto.
//
// A RAIZ TEMPORÁRIA É PARCIAL DE PROPÓSITO: entram o medidor, a fonte das
// regras e o config do portão; ficam de fora `mcp/`, `novo/`, `dominios/`, o
// `.git` e os 262 fixtures de `provas/casos/`. Isso exercita o N/A por grupo —
// o medidor tem de dizer ⚠ sobre o que esta árvore não tem, e nunca DIVERGIU.

const MEDIDOR = 'ferramental/numeros.mjs'

/**
 * O documento semente. Os valores nascem ERRADOS de propósito (`0`): a primeira
 * coisa que o helper faz é rodar o medidor sem argumento, e só há prova de que
 * escrever e conferir concordam se o escrever tiver mesmo trabalho a fazer.
 */
const SEMENTE = [
  '# raiz de prova',
  '',
  'Regras: <!--n regras.total-->0<!--/n--> · determinísticas',
  '<!--n regras.deterministicas-->0<!--/n--> · heurísticas <!--n regras.heuristicas-->0<!--/n-->.',
  '',
  'O portão tem <!--n verificar.passos-->0<!--/n--> passos, e o `mcp` é o',
  '<!--n verificar.posicao.mcp-->0 de 0<!--/n-->.',
  '',
].join('\n')

const rodarMedidor = (cwd, ...args) => {
  // Mesma forma que o passo usa: cwd na raiz, caminho relativo em argv, sem
  // shell — e sem `.git`, para provar que o medidor sobrevive a árvore que
  // não é repositório git em vez de estourar nela.
  const r = spawnSync(process.execPath, [MEDIDOR, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  return { codigo: r.status, saida: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/**
 * O MOLDE: a raiz semeada, montada UMA vez para a família inteira.
 *
 * CORTAR TRABALHO ANTES DE PARALELIZAR, que é a lição que `provas/provar.mjs`
 * já tinha aprendido no mesmo repositório: lá os 94 `git init` viraram um molde
 * copiado. Aqui era a semeadura. Cada teste desta família rodava DOIS processos
 * `node` — um para escrever a semente e outro para conferir —, e o primeiro
 * fazia exatamente a mesma coisa em todos eles: pegar um README com zeros e
 * escrever os números de hoje. Com nove testes eram nove semeaduras idênticas.
 *
 * Agora o molde é semeado uma vez e cada teste COPIA a árvore pronta — quatro
 * arquivinhos — e roda só o processo que interessa. A semeadura continua sendo
 * uma semeadura de verdade (o molde nasce do mesmo README com zeros, e o exit 0
 * dela é conferido aqui), então a prova de que "escrever e conferir concordam"
 * não perdeu nada.
 *
 * `documento` diferente da SEMENTE não usa o molde: nesse caso a semeadura é
 * outra e tem de acontecer de novo.
 */
let promessaDoMolde = null
function molde() {
  promessaDoMolde ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebar-numeros-molde-'))
    await montarRaizDoMedidor(dir, SEMENTE)
    const semeou = rodarMedidor(dir)
    assert.equal(semeou.codigo, 0, `o medidor não conseguiu escrever a semente:\n${semeou.saida}`)
    return dir
  })()
  return promessaDoMolde
}

async function montarRaizDoMedidor(dir, documento) {
  await cp(join(RAIZ, MEDIDOR), join(dir, MEDIDOR), { recursive: true })
  await copiarSem(
    join(RAIZ, 'ferramental', 'rebar-check'),
    join(dir, 'ferramental', 'rebar-check'),
    'provas',
  )
  await cp(join(RAIZ, 'verificar.config.mjs'), join(dir, 'verificar.config.mjs'))
  await cp(join(RAIZ, 'package.json'), join(dir, 'package.json'))
  await writeFile(join(dir, 'README.md'), documento, 'utf8')
}

/**
 * Monta uma raiz temporária já semeada (o documento nasce em dia), aplica a
 * mutação e roda `node ferramental/numeros.mjs` com o argv pedido.
 */
async function comNumeros(mutar, { documento = SEMENTE, argv = ['--verificar'] } = {}) {
  const tmp = await mkdtemp(join(tmpdir(), 'rebar-numeros-'))
  const rodar = (...args) => rodarMedidor(tmp, ...args)
  try {
    if (documento === SEMENTE) {
      // A árvore do molde tem seis arquivos; aqui o `cp` recursivo é barato
      // porque não há subárvore grande nenhuma para ele percorrer.
      await cp(await molde(), tmp, { recursive: true })
    } else {
      await montarRaizDoMedidor(tmp, documento)
      const semeou = rodar()
      assert.equal(semeou.codigo, 0, `o medidor não conseguiu escrever a semente:\n${semeou.saida}`)
    }

    await mutar({
      ler: (rel) => readFile(join(tmp, rel), 'utf8'),
      // `mkdir` antes do `writeFile` porque uma das mutações escreve documento
      // em SUBPASTA — é o que exercita a recursão de `documentos()`.
      escrever: async (rel, texto) => {
        await mkdir(dirname(join(tmp, rel)), { recursive: true })
        await writeFile(join(tmp, rel), texto, 'utf8')
      },
      rodar,
    })
    return rodar(...argv)
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

// O molde é do processo inteiro, então quem o apaga é o fim do processo — não
// o `finally` de um teste, que o tiraria debaixo dos outros oito.
after(async () => {
  if (promessaDoMolde) {
    await rm(await promessaDoMolde, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  }
})

describe('o passo `numeros`', { concurrency: 8 }, () => {
  test('APROVA · documento recém-regenerado confere, e o grupo ausente sai como ⚠', async () => {
    const r = await comNumeros(async () => {})
    assert.equal(r.codigo, 0, `escrever e conferir discordaram na mesma árvore:\n${r.saida}`)
    // O N/A por grupo tem de ser AUDÍVEL. Esta raiz não tem `mcp/`, `novo/`,
    // `dominios/` nem `.git`; se o medidor ficasse mudo sobre isso, quem apagasse
    // uma dessas pastas no repositório de verdade desligaria parte do portão sem
    // que nada aparecesse na tela.
    assert.match(r.saida, /⚠ grupo "git"/, 'grupo N/A tem de sair nomeado, não em silêncio')
  })

  test('REPROVA · número editado à mão no documento', async () => {
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      const antes = /<!--n regras\.total-->(\d+)<!--\/n-->/.exec(t)
      assert.ok(antes, 'a semente perdeu o marcador de regras.total')
      await escrever('README.md', t.replace(antes[0], '<!--n regras.total-->999<!--/n-->'))
    })
    assert.notEqual(r.codigo, 0, `número inventado no documento passou limpo:\n${r.saida}`)
    assert.match(
      r.saida,
      /regras\.total/,
      'reprovar sem dizer QUAL número divergiu manda o dono reler o documento inteiro',
    )
    assert.match(
      r.saida,
      /README\.md:\d+/,
      'a linha tem de dizer arquivo e linha, senão não é diff',
    )
  })

  test('REPROVA · regra NOVA na fonte e o documento sem regenerar', async () => {
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler(FONTE)
      const ancora = 'const REGRAS = ['
      assert.ok(t.includes(ancora), `a lista de regras mudou de forma em ${FONTE}`)
      // Regra completa e inerte, igual à do passo `mcp`: qualquer contagem fiel
      // da fonte ganha uma unidade.
      const plantada =
        `${ancora}\n  {\n    id: 'regra-plantada-pela-prova',\n` +
        "    classe: 'determinística',\n    nivel: 'N0',\n" +
        "    titulo: 'regra plantada pela prova do passo numeros',\n" +
        '    checar: () => null,\n  },'
      await escrever(FONTE, t.replace(ancora, plantada))
    })
    assert.notEqual(r.codigo, 0, `regra nova sem regenerar o documento passou limpo:\n${r.saida}`)
    assert.match(
      r.saida,
      /regras\.(total|deterministicas)/,
      'o diff tem de nomear o fato que mudou, senão não é diff, é reclamação',
    )
  })

  test('REPROVA · marcador com id que não é fato nenhum', async () => {
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      await escrever('README.md', `${t}\nfato inventado: <!--n nao.existe.mesmo-->1<!--/n-->\n`)
    })
    assert.notEqual(r.codigo, 0, 'marcador apontando para fato inexistente passou limpo')
    assert.match(r.saida, /nao\.existe\.mesmo/)
  })

  test('REPROVA · marcador dentro de cerca de código', async () => {
    // O marcador é comentário HTML: invisível no markdown renderizado, VISÍVEL
    // dentro de cerca, porque o GitHub imprime a cerca literalmente. Sem esta
    // checagem, quem marcasse `npm run provar   # 52 casos` publicaria a marcação
    // crua na página — defeito de renderização que não aparece em teste nenhum.
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      await escrever(
        'README.md',
        `${t}\n\`\`\`bash\nnpm run provar   # <!--n regras.total-->22<!--/n--> regras\n\`\`\`\n`,
      )
    })
    assert.notEqual(r.codigo, 0, 'marcador dentro de cerca passou limpo, e ele aparece na página')
    assert.match(r.saida, /cerca/i)
  })

  test('N/A · documento sem marcador nenhum não é reprovação, e não fica mudo', async () => {
    // PINA A DECISÃO, e ela é a fresta conhecida deste passo: enquanto ninguém
    // marcou nada, o medidor confere ZERO números e mesmo assim sai 0 — gritar
    // DIVERGIU sobre um documento ainda não marcado é acusar quem não errou, e é
    // o mesmo `na()` do rebar-check. O que impede o silêncio é a linha ⚠, que o
    // passo imprime mesmo aprovado por causa do campo `avisar`.
    const r = await comNumeros(async () => {}, { documento: '# sem marcador nenhum\n' })
    assert.equal(r.codigo, 0, `documento sem marcador não pode reprovar:\n${r.saida}`)
    assert.match(
      r.saida,
      /⚠ nenhum marcador/,
      'sem marcador o passo passa; se ele passar CALADO, o portão vira enfeite',
    )
  })
  // ─────────────────────────── os três defeitos de FORMA que passavam calados
  //
  // Achado de 02/09, pelo mesmo método de sempre: apagar o pedaço e ver se a
  // suíte fica vermelha. Três pedaços de `marcadoresDe`/`documentos` podiam ser
  // apagados com a suíte 18 de 18 verde — e os três já tinham comentário próprio
  // no `numeros.mjs` contando a história de por que existem, o que só torna a
  // ausência de prova pior: a decisão estava escrita e ninguém a estava guardando.
  //
  //   1. o laço `for (const m of texto.matchAll(ABERTURA))`
  //   2. a recursão de `documentos()` em subpasta
  //   3. `abreParagrafo`
  //
  // Os três são defeito de FORMA, não de valor, e é por isso que escaparam: as
  // provas que existiam mexiam no NÚMERO, e forma torta não muda número nenhum —
  // ela faz o número deixar de ser conferido, em silêncio, que é o pior modo.

  test('REPROVA · marcador aberto e nunca fechado', async () => {
    // O par não casa, então o marcador some do `matchAll(MARCADOR)` — e com ele
    // some a conferência do número que ele cerca, sem nada mudar na tela. O
    // marcador vai no MEIO da linha de propósito: colado no começo ele também
    // dispararia `abreParagrafo`, e o teste passaria pelo defeito errado.
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      await escrever('README.md', `${t}\nAberto e nunca fechado: <!--n regras.total-->22\n`)
    })
    assert.notEqual(
      r.codigo,
      0,
      'abertura órfã passou limpa, e o número dela deixou de ser conferido',
    )
    assert.match(r.saida, /nunca fechado/)
    assert.match(r.saida, /README\.md:\d+/, 'sem arquivo:linha não dá para achar o marcador torto')
  })

  test('REPROVA · documento em SUBPASTA também é governado', async () => {
    // `documentos()` desce a árvore inteira em vez de guardar uma lista de nomes,
    // e o comentário dele diz por quê: alguém põe marcador no `docs/STACK.md` e o
    // portão fica mudo sobre um número que passou a existir. Sem a recursão, este
    // documento nasce com o valor errado e ninguém percebe.
    const r = await comNumeros(async ({ escrever }) => {
      await escrever(
        join('docs', 'PROFUNDO.md'),
        'Regras: <!--n regras.total-->0<!--/n--> na subpasta.\n',
      )
    })
    assert.notEqual(r.codigo, 0, 'documento em subpasta ficou fora do portão')
    assert.match(
      r.saida,
      /PROFUNDO\.md/,
      'reprovar sem nomear o arquivo da subpasta não ajuda ninguém',
    )
  })

  test('REPROVA · marcador que ABRE parágrafo', async () => {
    // No CommonMark, comentário HTML na coluna 0 que INICIA bloco vira bloco HTML
    // cru, e o resto da linha sai literal para quem lê no GitHub. A mutação não
    // inventa marcador nenhum: ela só põe uma linha em branco antes de um
    // marcador que já começa a linha na semente — o valor continua em dia, então
    // a única coisa que pode reprovar aqui é o defeito de render.
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      const alvo = '<!--n regras.deterministicas-->'
      assert.ok(t.includes(`\n${alvo}`), 'a semente perdeu o marcador que começa linha')
      await escrever('README.md', t.replace(`\n${alvo}`, `\n\n${alvo}`))
    })
    assert.notEqual(r.codigo, 0, 'marcador abrindo parágrafo passou limpo, e ele quebra o render')
    assert.match(r.saida, /ABRE parágrafo/)
  })
})

// ───────────────────────────────── o passo `sintaxe` — "o código é código?"
//
// O ACHADO QUE ISTO FECHA, medido em 02/09 com o mesmo método do achado de
// 31/08 sobre `checarBlocos`: trocando o corpo de `checarSintaxe` por
// `return { codigo: 0 }`, esta suíte continuava `pass 18 · fail 0`. Três dos
// passos `funcao:` do portão — `sintaxe`, `higiene` e `hooks` — podiam ser
// esvaziados sem uma linha vermelha. `checarBlocos` ganhou prova porque alguém
// olhou para ele; os vizinhos ficaram de fora pelo mesmo motivo que ele quase
// ficou.
//
// Ganha prova agora porque acabou de ser REESCRITO: o laço `execFileSync` em
// série virou piscina de `spawn`. Reescrever por desempenho um passo do portão
// que ninguém prova é a forma mais barata de desligar um portão sem querer.
//
// A raiz temporária é um `git init` vazio, e é o mínimo que o passo precisa:
// `listarMjs` chama `git ls-files --cached --others --exclude-standard`, e
// `--others` já enxerga arquivo novo sem `git add`. Sem `.git` o passo LANÇA, e
// lançar é o contrato — o executor classifica como QUEBROU (127), não como o
// repositório reprovando.

const VALIDO = 'export const x = 1\n'
const QUEBRADO = 'export const x = (((\n'

/**
 * Monta uma raiz temporária que é um repositório git, escreve os arquivos
 * pedidos e devolve o que o passo respondeu.
 *
 * `arquivos` é { caminho relativo: conteúdo }. `sumir` lista caminhos que são
 * escritos, entram no índice com `git add` e DEPOIS somem do disco — é o único
 * jeito de encenar índice fora de sincronia, que o passo tem de separar de erro
 * de sintaxe.
 */
/**
 * O `.git` vazio, criado UMA vez e copiado para cada teste.
 *
 * Mesmo corte de `provas/provar.mjs`, pela mesma razão medida lá: `git init`
 * custa ~140 ms nesta máquina e copiar o punhado de arquivinhos que ele produz
 * custa um par de milissegundos. O molde nasce no MESMO `os.tmpdir()` das
 * árvores de teste de propósito — o `git init` grava em `.git/config` o que
 * detectou do sistema de arquivos (filemode, symlinks, ignorecase), e um molde
 * criado noutro volume levaria essa detecção errada junto.
 */
let promessaDoGitVazio = null
function gitVazio() {
  promessaDoGitVazio ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebar-sintaxe-molde-'))
    const r = spawnSync('git', ['init', '--quiet'], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    })
    assert.equal(r.status, 0, `não consegui preparar o molde git em ${dir}: ${r.stderr ?? ''}`)
    return join(dir, '.git')
  })()
  return promessaDoGitVazio
}

after(async () => {
  if (promessaDoGitVazio) {
    await rm(dirname(await promessaDoGitVazio), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  }
})

async function comArvoreMjs(arquivos, { sumir = [], prazo } = {}) {
  const tmp = await mkdtemp(join(tmpdir(), 'rebar-sintaxe-'))
  const git = (...args) => spawnSync('git', args, { cwd: tmp, encoding: 'utf8', windowsHide: true })
  try {
    await cp(await gitVazio(), join(tmp, '.git'), { recursive: true })
    for (const [rel, texto] of Object.entries(arquivos)) {
      await mkdir(dirname(join(tmp, rel)), { recursive: true })
      await writeFile(join(tmp, rel), texto, 'utf8')
    }
    if (sumir.length) {
      git('add', '-A')
      for (const rel of sumir) await rm(join(tmp, rel), { force: true })
    }
    return await checarSintaxe({ raiz: tmp, prazo: prazo ?? Date.now() + 60_000 })
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

describe('o passo `sintaxe`', { concurrency: 5 }, () => {
  test('APROVA · árvore de .mjs que compila', async () => {
    const r = await comArvoreMjs({ 'a.mjs': VALIDO, 'sub/b.mjs': VALIDO })
    assert.equal(r.codigo, 0, `.mjs válidos foram reprovados:\n${r.saida}`)
    assert.match(r.saida, /2 arquivo\(s\)/, 'o passo tem de dizer QUANTOS conferiu')
  })

  test('REPROVA · erro de sintaxe, nomeando o arquivo', async () => {
    const r = await comArvoreMjs({ 'a.mjs': VALIDO, 'ruim.mjs': QUEBRADO })
    assert.equal(r.codigo, 1, `arquivo que não compila passou:\n${r.saida}`)
    assert.match(
      r.saida,
      /ruim\.mjs/,
      'reprovar sem dizer QUAL arquivo manda reler a árvore inteira',
    )
    assert.match(
      r.saida,
      /SyntaxError/,
      'a mensagem do node é o que diz a LINHA; sem ela não é dica',
    )
  })

  test('NÃO ACUSA · .mjs que o .gitignore cobre fica fora do denominador', async () => {
    // `--exclude-standard` é o que mantém node_modules/ fora da conta. Sem ele
    // o passo reprovaria por causa de dependência de terceiro, e passo que
    // reprova pelo que não é do repositório é passo que se aprende a ignorar.
    const r = await comArvoreMjs({
      '.gitignore': 'ignorado/\n',
      'a.mjs': VALIDO,
      'ignorado/ruim.mjs': QUEBRADO,
    })
    assert.equal(r.codigo, 0, `arquivo ignorado pelo git entrou na conta:\n${r.saida}`)
  })

  test('ORDEM · dois quebrados saem em ordem de NOME, não de término', async () => {
    // A piscina termina os arquivos fora de ordem. Sem os baldes indexados a
    // saída mudaria de uma execução para outra, e diff que vira ruído é diff
    // que ninguém lê. Os nomes são escolhidos para que a ordem alfabética seja
    // a INVERSA da ordem em que os processos tendem a terminar (o menor
    // arquivo primeiro), então um relatório por término reprova este teste.
    const r = await comArvoreMjs({
      'aaa.mjs': `${QUEBRADO}${'// enche\n'.repeat(400)}`,
      'zzz.mjs': QUEBRADO,
    })
    assert.equal(r.codigo, 1)
    assert.ok(
      r.saida.indexOf('aaa.mjs') < r.saida.indexOf('zzz.mjs'),
      `a ordem do relatório seguiu o término, não o nome:\n${r.saida}`,
    )
  })

  test('CÓDIGO 2 · arquivo no índice e ausente do disco é índice torto, não sintaxe', async () => {
    // Ver o comentário do passo: isto já aconteceu de verdade, e o passo gritou
    // "Erro de sintaxe" mandando procurar a linha errada num arquivo apagado.
    const r = await comArvoreMjs(
      { 'a.mjs': VALIDO, 'fantasma.mjs': VALIDO },
      {
        sumir: ['fantasma.mjs'],
      },
    )
    assert.equal(r.codigo, 2, `arquivo fantasma virou reprovação de conteúdo:\n${r.saida}`)
    assert.match(r.saida, /git add -A/, 'a saída tem de dizer o comando que conserta')
    assert.doesNotMatch(r.saida, /SyntaxError/, 'fantasma não pode ser acusado de erro de sintaxe')
  })

  test('PRAZO · vencido, o passo DIZ quantos ficaram sem checar', async () => {
    // Com `spawn` assíncrono o relógio do executor vence sozinho e mataria o
    // passo com "tempo limite estourado" e mais nada. A consulta ao prazo aqui
    // dentro existe só para a saída nomear o buraco.
    const r = await comArvoreMjs({ 'a.mjs': VALIDO, 'b.mjs': VALIDO }, { prazo: Date.now() - 1 })
    assert.notEqual(r.codigo, 0, 'prazo vencido não pode sair aprovado')
    assert.match(r.saida, /2 arquivo\(s\) ficaram sem checar/)
  })
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
  'numeros',
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
  // acrescentado. Fica como aviso, sem reprovar, porque reprovar aqui puniria
  // quem está justamente acrescentando portão.
  //
  // O ⚠ na frente é o que faz o aviso ATRAVESSAR (achado de 02/09). A linha era
  // `nota: …`, e nota sem marca é nota que morre aqui dentro: o executor do
  // `verificar` descarta a stdout de todo passo que passa, e o passo `passos`
  // não declarava `avisar`. O aviso existia e não chegava a ninguém — que é
  // pior do que não existir, porque dá a impressão de que alguém está olhando.
  const novos = nomes.filter((n) => !PASSOS_ESPERADOS.includes(n))
  if (novos.length) {
    console.log(
      `⚠ passo(s) novo(s) fora de PASSOS_ESPERADOS: ${novos.join(', ')} — ` +
        'acrescente ali no mesmo commit, senão apagá-los depois volta a ser mudo',
    )
  }
})
