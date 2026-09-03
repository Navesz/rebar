#!/usr/bin/env node
// O SERVIDOR MCP DESTE PROJETO. Zero dependência, offline, e nada congelado dentro.
//
// ═════════════════════════════════════════════ 1. o que este arquivo era, e por que mudou
//
// Até 2026-09-02 este arquivo era um LANÇADOR: ele não servia nada, só chamava
// `npx --yes github:Navesz/rebar --mcp` e entregava o stdio para o servidor MCP
// do rebar. A auditoria de 31/08 suspeitou que a cadeia não podia funcionar. Foi
// medido, e não podia mesmo. O comando exato e a saída exata, de um projeto
// recém-gerado num tmpdir:
//
//   $ node .rebar/mcp.mjs
//   rebar: --mcp pede as dependências do pacote mcp/, que não estão instaladas.
//          Instale uma vez: cd mcp && npm install
//   rebar-mcp: o rebar não respondeu como servidor MCP (saída 2).
//
// E o defeito é ESTRUTURAL, não um esquecimento. A raiz do rebar tem ZERO
// dependência por regra da casa, então o SDK de MCP mora em `mcp/`, que é um
// pacote SEPARADO. O `npx` instala o pacote da raiz e só ele: o checkout que ele
// monta no cache tem os arquivos de `mcp/` e não tem `mcp/node_modules` — 22 MB,
// 93 pacotes, 3.399 arquivos na medição de 2026-09-02. Não existe versão desta
// cadeia que funcione sem acrescentar um `npm install` de 22 MB a toda invocação
// do rebar, inclusive às que só querem rodar a régua.
//
// ═══════════════════════════════════════════════════ 2. as duas saídas, e a conta
//
// (a) APONTAR PARA O REBAR — uma fonte, sempre em dia. Foi o que se tentou.
//     Custo medido em 2026-09-02, nesta máquina, com o cache do npx JÁ QUENTE:
//     8,4 s e 9,1 s por subida. Mais: exige rede em toda sessão, exige que
//     `github:Navesz/rebar` continue público e com esse nome, e — o que decide —
//     NÃO FUNCIONA HOJE, pelo parágrafo acima. Um cliente de MCP que espera 9 s
//     por um handshake costuma desistir antes; um que espera 9 s para receber
//     saída 2 desiste com certeza.
//
// (b) O PROJETO CARREGA O PRÓPRIO — offline, instantâneo, e é o que este arquivo
//     é agora. O preço declarado no pedido era: "passa a ter um arquivo que
//     envelhece, e aí precisa do portão de frescor dele também".
//
// ESSE PREÇO NÃO É PAGO AQUI, e é essa a decisão de desenho. Não há artefato.
// Nenhuma regra está escrita neste arquivo em forma de texto congelado: toda
// resposta é DERIVADA, na hora da chamada, dos arquivos deste projeto no disco.
// A regra do placeholder é lida de `conteudo/esquema.ts`; a lista de
// placeholders que ainda faltam é varrida em `conteudo/site.json` naquele
// segundo; a pilha sai das versões reais em `package.json`; os passos do portão
// saem de `package.json → scripts`; o que barra o commit sai dos hooks que estão
// em `.githooks/`. Não existe cópia para envelhecer, então não existe portão de
// frescor para escrever — que é uma resposta melhor ao defeito do Herz do que um
// portão seria, porque portão de frescor prova que a cópia bate com a fonte, e
// aqui não há segunda cópia.
//
// A consequência é dura de propósito e está exposta em toda resposta: quando o
// arquivo que impõe uma regra NÃO ESTÁ no disco, a ferramenta não recita a regra
// — ela responde DESARMADA. Regra recitada com o guarda ausente é pior que
// silêncio, porque soa igual a regra em vigor.
//
// ═════════════════════════════════════════════════════ 3. e as 22 regras do rebar?
//
// Continuam alcançáveis, e por execução, nunca por cópia: `rebar_verificar` com
// `{ regua: true }` roda a MESMA linha que o CI deste projeto roda, e devolve o
// placar. Medido em 2026-09-02: 9,3 s o `npx` sozinho, 17,2 s de ponta a ponta
// numa chamada de ferramenta. Rede obrigatória. Por isso é opção, e não padrão.
// Sem rede ela diz que não conseguiu, e nomeia o comando — nunca inventa um
// verde.
//
// ══════════════════════════════════════════════ 4. por que sem o SDK de MCP
//
// O `AGENTS.md` deste projeto proíbe instalar SDK de MCP, e esta é a razão de a
// proibição ser possível: o transporte stdio do MCP é JSON-RPC 2.0 em linhas
// terminadas por `\n`, e um servidor que só publica ferramentas precisa de
// quatro métodos — `initialize`, `tools/list`, `tools/call` e `ping`. São as ~90
// linhas da seção 6. O SDK resolveria o mesmo com 22 MB e uma árvore de
// dependência que este projeto teria de auditar, atualizar e explicar para
// sempre, num repositório que vai para a mão de um cliente.
//
// ═════════════════════════════════════════════════════ 5. o que o stdout é aqui
//
// O stdout é o CANAL DO PROTOCOLO e nada mais. Uma linha de prosa nele não vira
// aviso: vira mensagem malformada, e o cliente derruba a sessão sem dizer por
// quê. Por isso existe exatamente UMA escrita em stdout neste arquivo, dentro de
// `enviar()`, e `testes/portao.test.mjs` conta essa ocorrência e reprova se
// aparecer uma segunda — ou se aparecer a chamada de registro do console, que
// escreve no mesmo canal. Ela não é nomeada aqui de propósito: a régua varre o
// texto deste arquivo, e ela já reprovou uma vez por causa de um comentário que
// citava a chamada proibida em vez de descrevê-la. Todo aviso humano vai para o
// stderr, por `grito()`.

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────── 1. onde estamos
//
// A raiz sai do CAMINHO DESTE ARQUIVO, não de `process.cwd()`. O cliente de MCP
// escolhe o diretório de trabalho por conta dele e nem sempre é a raiz do
// projeto; este arquivo, porém, está sempre em `<raiz>/.rebar/mcp.mjs` — quem o
// põe lá é o portão, e `conferirPonteiroMcp` reprova a geração se o `.mcp.json`
// e o disco discordarem. Subir dois níveis é, portanto, um fato do gerador.
//
// fileURLToPath, não `.pathname`: no Windows o pathname vem "/C:/Users/...",
// com barra antes da letra do drive, e todo join a partir dele aponta para o nada.
const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = dirname(AQUI)

// A régua publicada. É o comando que o CI deste projeto roda e a única coisa que
// este arquivo sabe sobre o rebar: um endereço, nenhuma regra.
const ESPEC_REBAR = 'github:Navesz/rebar'
const REGUA = `npx --yes ${ESPEC_REBAR} .`

// Tudo o que for para humano vai para o stderr. Ver a seção 5 do cabeçalho.
const grito = (t) => process.stderr.write(`mcp: ${t}\n`)

// ────────────────────────────────────── 2. leitura do projeto, sempre na hora
//
// Sem cache, de propósito e com o custo medido: os arquivos lidos somam menos de
// 40 KB no projeto recém-gerado (2026-09-02), e uma leitura completa fica na
// casa do milissegundo. Guardar isso em memória traria de volta, pela porta dos
// fundos, exatamente o defeito que este desenho existe para não ter — a sessão
// que começou de manhã continuaria respondendo o `site.json` da manhã depois de
// o dono trocar os placeholders à tarde.

const caminho = (rel) => join(RAIZ, ...rel.split('/'))
const tem = (rel) => existsSync(caminho(rel))

function ler(rel) {
  try {
    return readFileSync(caminho(rel), 'utf8')
  } catch {
    return null
  }
}

function lerJson(rel) {
  const bruto = ler(rel)
  if (bruto === null) return null
  try {
    return JSON.parse(bruto)
  } catch {
    // JSON quebrado NÃO é o mesmo que arquivo ausente, e as duas respostas
    // seguintes são diferentes: ausente é "a regra está desarmada", quebrado é
    // "o build vai morrer aqui". Quem chama distingue pelo `undefined`.
    return undefined
  }
}

/**
 * `arquivo:linha` da primeira linha que contém a agulha.
 *
 * É o que substitui a citação: em vez de copiar para cá o texto que impõe a
 * regra — cópia que envelheceria —, a resposta manda o agente OLHAR a linha que
 * a impõe hoje. Quando a agulha some do arquivo, a função devolve o arquivo sem
 * linha, e a resposta passa a dizer que não achou; nunca aponta linha errada.
 */
function ondeEsta(rel, agulha) {
  const texto = ler(rel)
  if (texto === null) return null
  const linhas = texto.split('\n')
  const i = linhas.findIndex((l) => l.includes(agulha))
  return i === -1 ? rel : `${rel}:${i + 1}`
}

// ────────────────────────────────── 3. a sentinela de placeholder, lida do build
//
// A regra "o build reprova se o placeholder não for trocado" é imposta por
// `conteudo/esquema.ts`, e a forma dela é uma expressão regular declarada lá.
// ELA É LIDA DE LÁ, não copiada para cá, e o motivo é o mesmo do arquivo
// inteiro: se o esquema afrouxar ou apertar a sentinela, esta ferramenta muda
// junto no mesmo instante. Uma segunda cópia da regex daria a resposta de ontem
// com cara de resposta de hoje — e essa resposta é justamente "o seu build vai
// passar", que é a pior de todas para estar errada.
const DECL_SENTINELA = 'export const SENTINELA'

function sentinela() {
  const fonte = ler('conteudo/esquema.ts')
  if (fonte === null) return { re: null, motivo: 'conteudo/esquema.ts não está no disco' }
  const linha = fonte.split('\n').find((l) => l.includes(DECL_SENTINELA))
  if (!linha) {
    return { re: null, motivo: `não achei \`${DECL_SENTINELA}\` em conteudo/esquema.ts` }
  }
  // Recorta entre a primeira e a última barra da linha. `new RegExp` sobre um
  // literal do PRÓPRIO projeto, nunca sobre entrada de quem chama a ferramenta.
  const abre = linha.indexOf('/')
  const fecha = linha.lastIndexOf('/')
  if (abre === -1 || fecha <= abre) {
    return { re: null, motivo: 'a linha da SENTINELA não tem um literal de regex reconhecível' }
  }
  try {
    return {
      re: new RegExp(linha.slice(abre + 1, fecha)),
      motivo: null,
      onde: ondeEsta('conteudo/esquema.ts', DECL_SENTINELA),
    }
  } catch (e) {
    return { re: null, motivo: `a SENTINELA de conteudo/esquema.ts não compila: ${e.message}` }
  }
}

/** Todo campo de `conteudo/site.json` que ainda casa com a sentinela, com o caminho no JSON. */
function placeholdersPendentes() {
  const s = sentinela()
  const dado = lerJson('conteudo/site.json')
  if (dado === null) return { erro: 'conteudo/site.json não está no disco', itens: [] }
  if (dado === undefined)
    return { erro: 'conteudo/site.json não é JSON válido — o build morre aqui', itens: [] }
  if (!s.re) return { erro: s.motivo, itens: [] }

  const itens = []
  const andar = (no, trilha) => {
    if (typeof no === 'string') {
      if (s.re.test(no)) itens.push({ campo: trilha, valor: no })
      return
    }
    if (Array.isArray(no)) return no.forEach((v, i) => andar(v, `${trilha}[${i}]`))
    if (no && typeof no === 'object') {
      for (const [k, v] of Object.entries(no)) andar(v, trilha ? `${trilha}.${k}` : k)
    }
  }
  andar(dado, '')
  return { erro: null, itens, imposta_em: s.onde }
}

// ─────────────────────────────────────────────── 4. o estado do portão, derivado

/**
 * Os hooks só valem se o git souber deles. `core.hooksPath` é o que liga
 * `.githooks/` ao git, e ele NÃO vem junto no clone — quem clona este projeto
 * recebe os arquivos e nenhum hook armado. É a diferença entre "o arquivo existe"
 * e "o commit é barrado", e a resposta tem de dizer qual das duas é o caso.
 */
function hooksArmados() {
  try {
    const v = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: RAIZ,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return { valor: v || null, erro: null }
  } catch {
    // Sai não-zero quando a chave não existe — que é o caso comum e não é falha.
    return { valor: null, erro: null }
  }
}

/** As dependências reais, com as versões reais. Nunca uma lista escrita à mão. */
function pilha() {
  const pkg = lerJson('package.json')
  if (!pkg) return null
  const deps = { ...(pkg.dependencies || {}) }
  const devs = { ...(pkg.devDependencies || {}) }
  const next = ler('next.config.ts') || ler('next.config.mjs') || ler('next.config.js') || ''
  return {
    nome: pkg.name || '(sem nome no package.json)',
    deps,
    devs,
    scripts: pkg.scripts || {},
    // `output: "export"` muda o que é POSSÍVEL escrever, não só como se publica.
    exportEstatico: /output\s*:\s*['"]export['"]/.test(next),
    baseUi: Boolean(deps['@base-ui/react'] || devs['@base-ui/react']),
  }
}

/**
 * As regras DESTE projeto, derivadas dos arquivos que as impõem.
 *
 * Cada entrada declara quem a impõe. Se o arquivo não está no disco, o estado é
 * DESARMADA e a entrada diz isso na cara — ver a seção 2 do cabeçalho.
 */
function regrasDoProjeto() {
  const p = pilha()
  const ph = placeholdersPendentes()
  const hooks = hooksArmados()
  const armadoNoGit = hooks.valor !== null

  const regra = (id, titulo, imposta, corpo) => {
    const presentes = imposta.filter((rel) => tem(rel))
    return {
      id,
      titulo,
      imposta_por: imposta,
      estado: presentes.length === imposta.length ? 'ativa' : 'DESARMADA',
      falta: imposta.filter((rel) => !tem(rel)),
      ...corpo,
    }
  }

  const regras = [
    regra(
      'conteudo-fora-do-codigo',
      'Texto, telefone, endereço, preço e URL não moram no componente',
      ['conteudo/site.json', 'conteudo/esquema.ts', 'conteudo/carregar.ts'],
      {
        onde: 'conteudo/site.json — é o único lugar. `conteudo/esquema.ts` diz o formato de cada campo.',
        porque:
          'Literal em .tsx faz o build PASSAR e o site publicar com o dado errado. A falha não ' +
          'aparece em lugar nenhum: aparece no cliente que liga para o telefone antigo. ' +
          'Em JSON validado, o mesmo erro para o build antes de publicar.',
        como:
          'Importe de `conteudo/carregar.ts`, que valida no escopo do módulo — o `next build` ' +
          'avalia esse módulo para pré-renderizar a rota, então campo faltando lança antes de sair HTML.',
        nunca:
          'Nem `.tsx` com texto cru, nem variável de ambiente: as duas somem em produção sem aviso.',
      },
    ),
    regra(
      'placeholder-barra-o-build',
      'O build reprova enquanto sobrar um TROQUE-…',
      ['conteudo/esquema.ts', 'conteudo/site.json'],
      {
        imposta_em: ph.imposta_em || 'conteudo/esquema.ts',
        pendentes_agora: ph.erro ? `não consegui varrer: ${ph.erro}` : ph.itens.length,
        campos: ph.itens.map((i) => i.campo),
        porque:
          'O placeholder é INERTE de propósito — impossível de confundir com valor real. Um valor ' +
          'plausível inventado para calar o build sobe, parece certo e não entrega pedido nenhum.',
        como:
          'Pergunte o valor real ao usuário e troque em `conteudo/site.json`. NUNCA invente, ' +
          'e NUNCA afrouxe a SENTINELA para o build passar.',
      },
    ),
    regra(
      'segredo-nao-entra-no-commit',
      'Chave, token e .env são barrados antes de o commit existir',
      ['.githooks/pre-commit', '.githooks/varrer-segredo.mjs'],
      {
        armado_no_git: armadoNoGit,
        core_hooksPath: hooks.valor,
        porque:
          'Segredo no histórico não se conserta com commit novo: exige ROTACIONAR a credencial. ' +
          'Por isso é a única coisa barrada ANTES de existir, e não auditada depois.',
        como: armadoNoGit
          ? 'Já armado. O hook varre só o que está em stage, para caber em menos de 5 s.'
          : 'ARME AGORA: `node .githooks/instalar.mjs`. Sem `core.hooksPath` o arquivo está no ' +
            'disco e o git NÃO O EXECUTA — o portão parece instalado e verifica zero.',
      },
    ),
    regra(
      'coautoria-e-de-humano',
      'Você não assina o commit',
      ['.githooks/commit-msg', '.githooks/checar-mensagem.mjs', '.rebar-coautores'],
      {
        armado_no_git: armadoNoGit,
        porque:
          'A allowlist de `.rebar-coautores` é de PESSOAS do projeto. Trailer `Co-authored-by` de ' +
          'IA é barrado duas vezes: pelo hook, antes de o commit existir, e pela régua depois, no ' +
          'histórico — onde já não se desfaz sem reescrever.',
        como: 'Não acrescente trailer nenhum em seu nome. Quem edita a allowlist é o dono.',
      },
    ),
    regra(
      'pilha-fechada',
      'A pilha já está decidida; componente novo vem do shadcn',
      ['package.json'],
      {
        instalado: p
          ? Object.entries(p.deps)
              .map(([n, v]) => `${n}@${v}`)
              .sort()
          : [],
        nao_instale: [
          ...(p?.baseUi ? ['@radix-ui/* — o estilo aqui é base-nova sobre @base-ui/react'] : []),
          'qualquer segunda biblioteca de UI, de estado, de data ou de formulário',
          'SDK de MCP — este servidor não usa nenhum, de propósito (ver o topo de .rebar/mcp.mjs)',
        ],
        porque:
          'Dependência nova precisa de motivo escrito. Se um built-in do Node ou do próprio Next ' +
          'resolve, é ele — este repositório vai para a mão de um cliente e cada dependência vira ' +
          'auditoria e atualização para sempre.',
      },
    ),
    regra(
      'export-estatico',
      'O build é estático, e isso proíbe metade do Next',
      ['next.config.ts'],
      {
        ativo: Boolean(p?.exportEstatico),
        porque:
          'Com `output: "export"` o `next build` emite arquivos; sem ele emite um servidor, e a ' +
          'hospedagem estática publica uma pasta vazia. Essa falha NÃO aparece no build: aparece no deploy.',
        nao_use: p?.exportEstatico
          ? [
              'route handlers (app/**/route.ts) e middleware — não existem no export',
              'server actions e qualquer render por requisição',
              'next/image otimizado — o otimizador exige servidor; aqui `images.unoptimized` está ligado',
            ]
          : ['(o export não está ligado neste next.config — confira antes de publicar)'],
      },
    ),
    regra(
      'portao-antes-de-pronto',
      'Nada é "pronto" antes de `npm run verificar`',
      ['package.json'],
      {
        comando: p?.scripts?.verificar || '(não há script `verificar` no package.json)',
        passos: p?.scripts?.verificar ? p.scripts.verificar.split('&&').map((s) => s.trim()) : [],
        porque:
          'É o MESMO comando que o CI roda. Verde comprado desligando regra é dívida, não conclusão.',
        como: 'Rode e cole a saída. Este MCP é atalho para não errar; a porta é este comando.',
      },
    ),
    regra('idioma-unico', 'Português do Brasil, em tudo', ['AGENTS.md'], {
      porque:
        'Código, comentário, nome de arquivo e mensagem de commit. O comentário explica o PORQUÊ, ' +
        'com o número medido quando houver — não repete o que a linha abaixo dele já diz.',
      cobrada_por: `a régua do rebar, regra \`idioma-unico\`: ${REGUA}`,
    }),
  ]

  return regras
}

// ───────────────────────────────────────────────────────── 5. as cinco ferramentas
//
// Os nomes são os mesmos que o `AGENTS.md` deste projeto manda chamar, e isso é
// contrato: o texto que instrui o agente e as ferramentas que ele encontra têm
// de bater, senão a instrução vira ruído na primeira sessão.
//
// O ASSUNTO, porém, é OUTRO — e é o ponto do pedido. As mesmas cinco perguntas,
// respondidas sobre ESTE SITE e não sobre o repositório do rebar: quem abre este
// projeto daqui a seis meses quer saber onde mora o conteúdo daqui, o que
// reprova o build daqui e o que barra o commit daqui.

const emJson = (v) => JSON.stringify(v, null, 2)

const FERRAMENTAS = [
  {
    name: 'rebar_regras',
    title: 'As regras que reprovam ESTE projeto, derivadas do disco agora',
    description:
      'Lista as regras deste projeto: onde mora o conteúdo, o que barra o build, o que barra o ' +
      'commit e qual é a pilha. CHAME ANTES DA PRIMEIRA LINHA DE CÓDIGO. Cada regra nomeia o ' +
      'arquivo que a impõe e diz se ela está ATIVA ou DESARMADA neste checkout — nada aqui é ' +
      'texto congelado, tudo é lido do disco no instante da chamada.',
    inputSchema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'termo no id ou no título, para não trazer tudo' },
      },
    },
    executar: ({ busca }) => {
      let regras = regrasDoProjeto()
      if (busca) {
        const t = String(busca).toLowerCase()
        regras = regras.filter((r) => `${r.id} ${r.titulo}`.toLowerCase().includes(t))
        if (!regras.length) {
          return `Nenhuma regra deste projeto casa com "${busca}". Chame sem filtro para ver as ${regrasDoProjeto().length}.`
        }
      }
      const desarmadas = regras.filter((r) => r.estado === 'DESARMADA')
      const cabeca = [
        `As regras de ${pilha()?.nome ?? 'este projeto'}, derivadas do disco em ${new Date().toISOString()}.`,
        desarmadas.length
          ? `ATENÇÃO: ${desarmadas.length} regra(s) DESARMADA(S) — o arquivo que as impõe não está aqui. Avise o usuário.`
          : 'Todas as regras abaixo têm o arquivo que as impõe presente no disco.',
        `Estas são as regras DESTE site. As 22 regras do rebar-check rodam por \`${REGUA}\` — use rebar_verificar { regua: true }.`,
        '',
      ].join('\n')
      return cabeca + emJson(regras)
    },
  },

  {
    name: 'rebar_porque',
    title: 'Por que esta regra existe, com o arquivo que a impõe',
    description:
      'Devolve a razão de uma regra pelo id, e o arquivo:linha que a impõe HOJE. CHAME QUANDO O ' +
      'PORTÃO REPROVAR e você for tentado a contornar a regra, e ANTES de propor afrouxar, ignorar ' +
      'ou apagar qualquer verificação.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id da regra, ex. "placeholder-barra-o-build"' },
      },
      required: ['id'],
    },
    executar: ({ id }) => {
      const regras = regrasDoProjeto()
      const r = regras.find((x) => x.id === id)
      if (!r) {
        return {
          erro: true,
          texto: `"${id}" não é regra deste projeto.\nDisponíveis: ${regras.map((x) => x.id).join(', ')}`,
        }
      }
      // O tamanho em linhas, e não uma citação: citar aqui seria a cópia que
      // este arquivo inteiro existe para não ter. A resposta manda LER o
      // arquivo, que é a fonte que o portão usa.
      const provas = r.imposta_por.map((rel) => {
        const fonte = ler(rel)
        return {
          arquivo: rel,
          no_disco: fonte !== null,
          linhas: fonte === null ? null : fonte.split('\n').length,
        }
      })
      return emJson({ ...r, provas, leia_estes_arquivos: r.imposta_por })
    },
  },

  {
    name: 'rebar_decidir',
    title: 'O que este projeto já decidiu sobre X',
    description:
      'Procura um assunto nas decisões já fechadas deste projeto — pilha, conteúdo, publicação, ' +
      'commit, idioma — e responde com o arquivo que prova a decisão. CHAME ANTES DE PROPOR ' +
      'qualquer escolha de biblioteca, formato ou processo. Quando nada casa, ela DIZ que nada ' +
      'impõe isso, em vez de inventar.',
    inputSchema: {
      type: 'object',
      properties: {
        assunto: {
          type: 'string',
          description: 'em palavras: "cor", "imagem", "rota", "commit", "teste"',
        },
      },
      required: ['assunto'],
    },
    executar: ({ assunto }) => {
      const p = pilha()
      const t = String(assunto).toLowerCase()
      const decisoes = [
        {
          sobre: [
            'pilha',
            'framework',
            'next',
            'react',
            'tailwind',
            'ui',
            'componente',
            'radix',
            'biblioteca',
            'dependencia',
            'dependência',
          ],
          decisao: p
            ? `Fechada. Instalado hoje: ${
                Object.entries(p.deps)
                  .map(([n, v]) => `${n}@${v}`)
                  .join(', ') || '(nada em dependencies)'
              }.` +
              ` Componente novo vem do \`shadcn add\`, não escrito à mão. Dependência nova precisa de motivo escrito.`
            : 'Não consegui ler package.json — decisão indeterminada.',
          prova: 'package.json',
        },
        {
          sobre: [
            'conteudo',
            'conteúdo',
            'texto',
            'telefone',
            'endereco',
            'endereço',
            'preco',
            'preço',
            'url',
            'cnpj',
            'json',
          ],
          decisao:
            'Fechada. Todo dado do negócio mora em `conteudo/site.json`, validado por ' +
            '`conteudo/esquema.ts` no escopo do módulo. Literal em `.tsx` ou em variável de ' +
            'ambiente é proibido — as duas formas quebram em silêncio depois de publicado.',
          prova: 'conteudo/esquema.ts',
        },
        {
          sobre: [
            'publicar',
            'deploy',
            'build',
            'export',
            'estatico',
            'estático',
            'rota',
            'route',
            'middleware',
            'imagem',
            'image',
            'servidor',
          ],
          decisao: p?.exportEstatico
            ? 'Fechada: `output: "export"`. O build emite arquivos, não servidor. Logo NÃO existem ' +
              'route handlers, middleware, server actions nem otimização de imagem neste projeto.'
            : 'O `output: "export"` NÃO está ligado neste next.config — confira antes de publicar, ' +
              'porque a hospedagem estática publicaria uma pasta vazia.',
          prova: 'next.config.ts',
        },
        {
          sobre: [
            'commit',
            'coautoria',
            'autor',
            'segredo',
            'chave',
            'token',
            'env',
            'hook',
            'git',
          ],
          decisao:
            'Fechada. `.githooks/pre-commit` barra segredo antes de o commit existir; ' +
            '`.githooks/commit-msg` barra trailer de coautoria que não esteja na allowlist de ' +
            'humanos em `.rebar-coautores`. Armar: `node .githooks/instalar.mjs`.',
          prova: '.githooks/pre-commit',
        },
        {
          sobre: [
            'idioma',
            'lingua',
            'língua',
            'portugues',
            'português',
            'ingles',
            'inglês',
            'comentario',
            'comentário',
          ],
          decisao:
            'Fechada: português do Brasil em código, comentário, nome de arquivo e commit. O ' +
            'comentário explica o PORQUÊ, com o número medido quando houver.',
          prova: 'AGENTS.md',
        },
        {
          sobre: ['teste', 'verificar', 'portao', 'portão', 'ci', 'lint', 'typecheck'],
          decisao: p?.scripts?.verificar
            ? `Fechada: \`npm run verificar\` = ${p.scripts.verificar}. É o mesmo comando do CI.`
            : 'Não há script `verificar` no package.json — o portão deste projeto está incompleto.',
          prova: 'package.json',
        },
      ]

      // CASA POR PALAVRA, e não por substring, e o motivo é um falso positivo
      // medido: com `t.includes(s)` a pergunta "build" casava a decisão de
      // PILHA, porque "b-u-i-l-d" contém "ui". Resposta errada com cara de
      // resposta é o defeito que este servidor inteiro persegue.
      const palavras = t.split(/[^a-zà-ú]+/i).filter(Boolean)
      const casou = decisoes.filter((d) =>
        d.sobre.some((s) => palavras.some((p) => p === s || (p.length >= 4 && s.startsWith(p)))),
      )
      if (!casou.length) {
        return (
          `Nada neste projeto decide sobre "${assunto}".\n\n` +
          'Isso é resposta, não lacuna: escolha o que for razoável e ESCREVA O PORQUÊ no ' +
          `comentário. Se quiser conferir contra a régua do rebar, rode \`${REGUA}\`.\n` +
          `Assuntos que têm decisão fechada aqui: ${decisoes.map((d) => d.sobre[0]).join(', ')}.`
        )
      }
      return emJson(
        casou.map(({ sobre, ...resto }) => ({
          assunto: sobre[0],
          ...resto,
          no_disco: tem(resto.prova),
        })),
      )
    },
  },

  {
    name: 'rebar_portao',
    title: 'O portão deste projeto, na ordem, e o que fazer quando um passo reprova',
    description:
      'Devolve os passos de `npm run verificar` LIDOS do package.json, mais o estado dos hooks de ' +
      'git. CHAME QUANDO O VERIFICAR REPROVAR e a mensagem não bastar, e antes de dizer que algo ' +
      '"passou". Este MCP não é a porta: a porta é o comando que esta ferramenta devolve.',
    inputSchema: {
      type: 'object',
      properties: {
        passo: { type: 'string', description: 'nome do passo, ex. "build" ou "lint"' },
      },
    },
    executar: ({ passo }) => {
      const p = pilha()
      const hooks = hooksArmados()
      const cadeia = p?.scripts?.verificar
      const passos = cadeia
        ? cadeia.split('&&').map((s) => {
            const cmd = s.trim()
            const nome = cmd.replace(/^npm (run )?/, '')
            return { nome, comando: cmd, roda: p.scripts[nome] || '(script não encontrado)' }
          })
        : []

      if (passo) {
        const alvo = passos.find((x) => x.nome === String(passo).trim())
        if (!alvo) {
          return {
            erro: true,
            texto: `"${passo}" não é passo deste portão. São: ${passos.map((x) => x.nome).join(', ') || '(nenhum)'}`,
          }
        }
        const dica = {
          lint: 'Conserte o código. Desligar a regra no eslint.config é dívida, não conserto.',
          typecheck: 'Tipo `any` para calar o erro é o mesmo defeito com outro nome.',
          test: 'Teste que passou a falhar depois de uma mudança sua está certo até prova em contrário.',
          build:
            'A causa mais comum aqui NÃO é código: é placeholder. O `conteudo/esquema.ts` lança no ' +
            'escopo do módulo e o build para antes de sair HTML. Chame rebar_verificar para ver quais faltam.',
        }[alvo.nome]
        return emJson({
          ...alvo,
          quando_reprova: dica || 'Leia a saída do comando; ela nomeia o arquivo.',
        })
      }

      return emJson({
        a_porta: cadeia || '(não há script `verificar` — o portão deste projeto está incompleto)',
        passos,
        hooks_de_git: {
          core_hooksPath: hooks.valor,
          armado: hooks.valor !== null,
          arquivos_no_disco: ['.githooks/pre-commit', '.githooks/commit-msg'].filter((r) => tem(r)),
          como_armar: 'node .githooks/instalar.mjs',
          porque:
            'O hook NÃO vem armado no clone. Sem `core.hooksPath` o arquivo está no disco e o git ' +
            'não o executa: o portão parece instalado e verifica zero.',
        },
        regua_do_rebar: `${REGUA}   (as 22 regras; rede necessária)`,
        aviso: 'Este MCP é atalho. Quem barra é o comando acima, o hook e o CI.',
      })
    },
  },

  {
    name: 'rebar_verificar',
    title: 'Varrer este projeto agora e devolver o placar',
    description:
      'Varredura LOCAL e instantânea: placeholders que ainda faltam em conteudo/site.json, regras ' +
      'desarmadas e hooks não armados. Com { regua: true } roda também a régua publicada do rebar ' +
      `(\`${REGUA}\`), que custa ~17 s e EXIGE REDE. ` +
      'CHAME DEPOIS DE MEXER no projeto e antes de afirmar que terminou. ATALHO, NÃO BARREIRA: ' +
      'quem barra é `npm run verificar`, o hook e o CI.',
    inputSchema: {
      type: 'object',
      properties: {
        regua: {
          type: 'boolean',
          description: 'roda também a régua publicada do rebar (~17 s, rede necessária)',
        },
      },
    },
    executar: async ({ regua }) => {
      const ph = placeholdersPendentes()
      const regras = regrasDoProjeto()
      const hooks = hooksArmados()

      const reprovas = []
      if (ph.erro) reprovas.push(`conteúdo: ${ph.erro}`)
      else if (ph.itens.length) {
        reprovas.push(
          `conteúdo: ${ph.itens.length} placeholder(s) em conteudo/site.json — o \`next build\` PARA aqui. ` +
            `Campos: ${ph.itens.map((i) => i.campo).join(', ')}`,
        )
      }
      for (const r of regras.filter((x) => x.estado === 'DESARMADA')) {
        reprovas.push(`regra ${r.id}: DESARMADA — falta ${r.falta.join(', ')}`)
      }
      if (hooks.valor === null && tem('.githooks/pre-commit')) {
        reprovas.push(
          'hooks: os arquivos estão em .githooks/ mas `core.hooksPath` não está configurado — ' +
            'o git não os executa. Arme com `node .githooks/instalar.mjs`.',
        )
      }

      const local = {
        placar_local: reprovas.length ? 'REPROVA' : 'passa',
        reprovas,
        placeholders_pendentes: ph.erro ? null : ph.itens,
        conferido_em: new Date().toISOString(),
        aviso:
          'Isto é a varredura local, e ela NÃO substitui `npm run verificar` (lint, typecheck, ' +
          'teste e build) nem a régua do rebar.',
      }

      if (!regua) return emJson(local)
      return emJson({ ...local, regua_do_rebar: await rodarRegua() })
    },
  },
]

// ────────────────────────────────────────────── a única coisa que executa rede
//
// Fica separada e é chamada só sob pedido explícito, porque custa 9,3 s medidos
// em 2026-09-02 com o cache do npx quente, e porque falha quando não há rede —
// e uma ferramenta que às vezes leva 9 s e às vezes falha não pode ser o
// caminho padrão de nada.
//
// `process.execPath` sobre o `npx-cli.js` real, nunca o `npx` do PATH: no
// Windows `npx` é `npx.cmd`, um roteiro de lote, e o CreateProcess não roda
// `.cmd` sem interpretador. O erro é ENOENT sobre um comando que ESTÁ no PATH, e
// ele sobreviveu um ano no projeto anterior porque só o Linux era testado.
function resolverNpx() {
  const dirNode = dirname(process.execPath)
  const candidatos = [
    // Windows: node.exe e node_modules/npm/ dividem a mesma pasta.
    join(dirNode, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    // POSIX: o npm fica em ../lib/node_modules. Vale para nvm, fnm e homebrew.
    join(dirNode, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    join(dirNode, '..', 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ]
  return candidatos.find((c) => existsSync(c)) || null
}

/**
 * ASSÍNCRONA, e a primeira versão disto era síncrona. A troca não é estilo.
 *
 * Node roda num fio só. Com a variante síncrona do `spawn`, o processo INTEIRO
 * fica parado enquanto o `npx` resolve — e o que fica parado junto é o laço que
 * lê o stdin, isto é, o servidor deixa de responder a qualquer outra pergunta do
 * agente, inclusive ao `ping` com que o cliente decide se a sessão está viva.
 * Medido em 2026-09-02, essa parada é de 9,3 s com o cache do npx quente, e
 * cresce sem teto conhecido com a rede ruim: um atalho que congela a sessão
 * quando a rede piora é pior que atalho nenhum, que é a tese deste arquivo.
 *
 * Com `execFile` o filho corre ao lado, o laço de stdin continua girando e o
 * teto de tempo é REAL. 90 s é generoso para uma resolução fria de `npx` e curto
 * o bastante para o agente receber uma negativa em vez de esperar sem saber —
 * medido em 2026-09-02 contra uma especificação inexistente: negativa nomeando o
 * comando em 4,3 s, sem verde inventado.
 */
function rodarRegua() {
  const args = ['--yes', ESPEC_REBAR, '.', '--json']
  const npx = resolverNpx()
  const comando = `npx ${args.join(' ')}`
  const opcoes = {
    cwd: RAIZ,
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  }

  return new Promise((resolver) => {
    // A linha de comando é CONSTANTE deste arquivo — nada que vem do cliente de
    // MCP entra nela. O `shell: true` do plano B existe só para o layout de
    // instalação em que o npx-cli.js não está ao lado do Node.
    const chamada = npx
      ? [process.execPath, [npx, ...args], opcoes]
      : ['npx', args, { ...opcoes, shell: true }]

    execFile(...chamada, (erro, stdout, stderr) => {
      // O checker sai 1 quando REPROVA, e isso é resultado, não falha da
      // chamada: o `--json` continua no stdout e é ele que interessa.
      if (erro && !stdout) {
        const expirou = erro.killed || erro.signal
        return resolver({
          rodou: false,
          motivo: expirou
            ? `a régua não respondeu em ${opcoes.timeout / 1000} s e foi encerrada`
            : `a régua não chegou a rodar: ${erro.message}`,
          comando,
          leia:
            'Sem rede a régua não roda. As regras locais acima continuam valendo, e o CI ' +
            'roda esta mesma linha — o veredito dele não muda por causa disto.',
          stderr: (stderr || '').slice(0, 1000),
        })
      }
      let placar
      try {
        placar = JSON.parse(stdout)
      } catch {
        return resolver({
          rodou: false,
          motivo: 'a régua respondeu algo que não é JSON',
          saida: (stdout || stderr || '').slice(0, 2000),
          comando,
        })
      }
      resolver({ rodou: true, saida_do_processo: erro?.code ?? 0, comando, placar })
    })
  })
}

// ───────────────────────────────── 6. o transporte: JSON-RPC 2.0 por stdio, à mão
//
// O contrato do transporte stdio do MCP: uma mensagem JSON por linha, sem
// newline embutido. `JSON.stringify` nunca emite newline cru, então serializar e
// concatenar `\n` já satisfaz o enquadramento — não há caso a tratar.
//
// Notificação é mensagem SEM `id`, e a resposta a ela é NENHUMA. Responder uma
// notificação é o erro que trava clientes estritos, porque eles não têm a quem
// entregar a resposta.

const VERSAO = '1.0.0'

// As versões do protocolo que este servidor atende. Ele só usa `tools`, que
// existe igual nas três, então negociar é escolher a que o cliente pediu quando
// ela está aqui — e cair na mais nova quando não está, que é o que a
// especificação manda fazer com versão desconhecida.
const PROTOCOLOS = ['2024-11-05', '2025-03-26', '2025-06-18']

// O que o cliente mostra ao modelo assim que a sessão abre. É o ÚNICO texto
// deste servidor que chega ao agente sem ele ter chamado nada, então é aqui que
// mora a ordem de partida — e a frase que ele repassa ao usuário quando alguma
// coisa está desarmada.
const INSTRUCOES = [
  'Este é o servidor MCP deste projeto. Ele responde sobre ESTE site, lendo os arquivos do disco a cada chamada — nada aqui é cópia congelada.',
  '',
  'ANTES DA PRIMEIRA LINHA DE CÓDIGO, chame `rebar_regras`. Ela diz onde mora o conteúdo, o que barra o build, o que barra o commit e qual é a pilha.',
  'DEPOIS DE MEXER e antes de dizer que terminou, chame `rebar_verificar`.',
  '',
  'Se alguma regra voltar como DESARMADA, ou se os hooks não estiverem armados, DIGA AO USUÁRIO antes de continuar: o portão parece instalado e verifica zero.',
  '',
  `Este servidor é atalho, não porta. Quem barra é \`npm run verificar\`, o hook de commit e o CI — e a régua publicada, \`${REGUA}\`.`,
].join('\n')

// A ÚNICA escrita em stdout deste arquivo. Ver a seção 5 do cabeçalho.
const enviar = (m) => process.stdout.write(`${JSON.stringify(m)}\n`)

const responder = (id, result) => enviar({ jsonrpc: '2.0', id, result })
const falhar = (id, code, message) => enviar({ jsonrpc: '2.0', id, error: { code, message } })

function despachar(m) {
  const { id, method, params } = m
  // Notificação: sem `id`. Nada volta, nem para método desconhecido.
  const ehNotificacao = id === undefined || id === null

  if (method === 'initialize') {
    const pedida = params?.protocolVersion
    return responder(id, {
      protocolVersion: PROTOCOLOS.includes(pedida) ? pedida : PROTOCOLOS[PROTOCOLOS.length - 1],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'rebar', title: 'rebar — as regras deste projeto', version: VERSAO },
      instructions: INSTRUCOES,
    })
  }

  if (ehNotificacao) return

  if (method === 'ping') return responder(id, {})

  if (method === 'tools/list') {
    return responder(id, {
      tools: FERRAMENTAS.map(({ name, title, description, inputSchema }) => ({
        name,
        title,
        description,
        inputSchema,
      })),
    })
  }

  if (method === 'tools/call') {
    const alvo = FERRAMENTAS.find((f) => f.name === params?.name)
    if (!alvo) {
      return falhar(id, -32602, `ferramenta desconhecida: ${params?.name}`)
    }
    // `Promise.resolve` cobre as duas formas sem duplicar caminho: quatro
    // ferramentas só leem disco e devolvem string na hora; `rebar_verificar`
    // com `{ regua: true }` devolve promessa, porque ela roda um processo
    // filho e NÃO PODE parar o laço que lê o stdin — ver `rodarRegua`.
    return Promise.resolve()
      .then(() => alvo.executar(params?.arguments ?? {}))
      .then((saida) => {
        // Erro de USO — id que não existe, assunto sem decisão — volta como
        // resultado com `isError`, e não como erro de JSON-RPC. A diferença
        // importa: erro de protocolo o cliente esconde do modelo, e o modelo
        // fica sem saber que errou o argumento.
        const corpo = typeof saida === 'string' ? { texto: saida } : saida
        responder(id, {
          content: [{ type: 'text', text: corpo.texto }],
          ...(corpo.erro ? { isError: true } : {}),
        })
      })
      .catch((e) => {
        // Falha de leitura de disco não pode derrubar a sessão: ela vira
        // resposta, com o nome da ferramenta, para o agente poder consertar.
        responder(id, {
          content: [
            { type: 'text', text: `mcp: ${alvo.name} falhou lendo este projeto: ${e.message}` },
          ],
          isError: true,
        })
      })
  }

  return falhar(id, -32601, `método não implementado: ${method}`)
}

// Quantas chamadas estão no ar. Existe por causa do encerramento logo abaixo, e
// vale para o caso real, não só para o teste: o cliente pode fechar o cano
// enquanto `rebar_verificar { regua: true }` ainda está com o processo filho
// rodando, e sair ali entregaria silêncio no lugar da resposta.
let noAr = 0
let canoFechado = false

const talvezSair = () => {
  if (canoFechado && noAr === 0) process.exit(0)
}

let pendente = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (pedaco) => {
  pendente += pedaco
  let corte
  while ((corte = pendente.indexOf('\n')) !== -1) {
    const linha = pendente.slice(0, corte).trim()
    pendente = pendente.slice(corte + 1)
    if (!linha) continue
    let m
    try {
      m = JSON.parse(linha)
    } catch {
      // Sem `id` não há a quem responder, então o erro de parse vai para o
      // stderr e a sessão continua: uma linha suja não é motivo para derrubar
      // um servidor que o agente vai precisar na próxima pergunta.
      grito(`linha ilegível no stdin, ignorada (${linha.length} bytes)`)
      continue
    }
    noAr += 1
    try {
      const talvez = despachar(m)
      if (talvez && typeof talvez.then === 'function') {
        talvez.then(() => {
          noAr -= 1
          talvezSair()
        })
        continue
      }
    } catch (e) {
      if (m?.id !== undefined && m?.id !== null) falhar(m.id, -32603, `erro interno: ${e.message}`)
      else grito(`erro interno numa notificação: ${e.message}`)
    }
    noAr -= 1
  }
})

// Cliente fechou o cano: a sessão acabou e o processo sai limpo — MAS só depois
// de responder o que já estava no ar. Sem o `talvezSair` ele ficaria vivo
// segurando um stdin morto até alguém matá-lo; sem o contador, sairia no meio de
// uma chamada e o agente veria a sessão cair sem resposta e sem erro.
process.stdin.on('end', () => {
  canoFechado = true
  talvezSair()
})

grito(
  `servidor pronto em ${relative(process.cwd(), RAIZ) || '.'} — ${FERRAMENTAS.length} ferramentas, zero dependência`,
)
