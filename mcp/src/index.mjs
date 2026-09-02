#!/usr/bin/env node
// Servidor MCP do rebar — as regras deste repositório, servidas do artefato gerado.
//
// POR QUE ELE EXISTE, nas palavras do dono: "No Herz e no BMB Compras eu não tive
// esse problema porque elaborei um MCP com todas as regras de projeto, pra ele sempre
// ficar na memória e forçar a ser usadas." E o defeito que sobrou: "O MCP não era
// reescrito quando as regras de projeto foram modificadas."
//
// A correção está em duas peças, e SÓ UMA delas mora aqui:
//
//   mcp/gerar.mjs           deriva mcp/regras.gerado.json da fonte, e o passo `mcp` do
//                           `npm run verificar` regenera em memória e REPROVA se o
//                           disco divergir. Esse é o portão de frescor.
//   mcp/src/*  (este)       serve o artefato. Nunca lê ferramental/rebar-check/index.mjs.
//
// O QUE ESTE SERVIDOR NÃO É — §7.2, literal: "O MCP nunca é a porta. A porta é N0–N5."
// Chamar uma tool daqui é atalho para não errar; quem reprova é `npm run verificar`,
// o hook e o CI. Nenhuma resposta abaixo autoriza nada.
//
// O QUE MUDOU EM RELAÇÃO À VERSÃO ANTERIOR DESTE ARQUIVO. Ele servia PROSA: cinco
// ferramentas devolvendo trechos de docs/PLANO.md por seção. Isso contraria a §7.2
// por dois motivos medidos — prosa é o formato que o Herz provou ignorável (17 guias,
// 1.961 linhas, 80 KB, "o modelo decide se chama"), e o plano é o que o projeto
// PRETENDE, enquanto o artefato é o que o portão REPROVA hoje. Quando os dois
// divergem, quem manda é quem reprova. A prosa continua alcançável: as ferramentas
// devolvem `arquivo:linha` do PLANO em vez de copiar o texto para cá.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import {
  avisoDeFrescor,
  carregar,
  CAMINHO_ARTEFATO,
  exibirCaminho,
  FalhaDeArtefato,
  frescor,
  RAIZ,
} from './artefato.mjs'
import { catalogo, decidir, portao, porque } from './consultas.mjs'

const executar = promisify(execFile)

// ─────────────────────────────────────────────────────────────────────────────
// Boot: morrer alto se o artefato não existir.
//
// Um servidor MCP que sobe sem a fonte de dados responde "nenhuma regra encontrada"
// para tudo, e o modelo conclui que o projeto não tem regra. Resposta vazia com cara
// de resposta é pior que servidor morto: servidor morto o dono conserta hoje.
// ─────────────────────────────────────────────────────────────────────────────
try {
  carregar()
} catch (e) {
  if (e instanceof FalhaDeArtefato) {
    console.error(`rebar-mcp: ${e.message}`)
    process.exit(1)
  }
  throw e
}

const texto = (t) => ({ content: [{ type: 'text', text: t }] })
const erro = (t) => ({ content: [{ type: 'text', text: t }], isError: true })

/**
 * Recarrega o artefato A CADA CHAMADA e cola o aviso de frescor na resposta.
 *
 * Sem cache de propósito: o módulo inteiro existe porque uma cópia velha continuou
 * sendo servida sem ninguém perceber. Se `node mcp/gerar.mjs` rodar enquanto esta
 * sessão está aberta, a próxima chamada já responde com a regra nova. Custo medido:
 * 79 KB de JSON, ~1 ms.
 */
function comArtefato(fn) {
  return async (args) => {
    let artefato
    try {
      artefato = carregar()
    } catch (e) {
      return erro(`rebar-mcp: ${e.message}`)
    }
    const aviso = avisoDeFrescor(frescor(artefato))
    const corpo = await fn(artefato, args ?? {})
    const conteudo = typeof corpo === 'string' ? texto(corpo) : corpo
    if (!aviso) return conteudo
    return {
      ...conteudo,
      content: [{ type: 'text', text: aviso }, ...conteudo.content],
    }
  }
}

const servidor = new McpServer({ name: 'rebar', version: '0.2.0' })

// ─── 1. o catálogo ───────────────────────────────────────────────────────────
servidor.registerTool(
  'rebar_regras',
  {
    title: 'As regras que reprovam este repositório',
    description:
      'Lista as regras do rebar-check, agrupadas por nível N0–N7, com id, classe e título. ' +
      'CHAME ANTES DE ESCREVER CÓDIGO neste repositório ou num projeto gerado por ele: é a lista ' +
      'do que vai reprovar no commit e no CI. Filtre por nível, classe ou termo para não trazer tudo. ' +
      'Derivado de mcp/regras.gerado.json; a razão de cada regra sai em rebar_porque.',
    inputSchema: {
      nivel: z.string().optional().describe('N0..N7 — só as regras desse nível'),
      classe: z
        .string()
        .optional()
        .describe('determinística (reprova) ou heurística (só avisa); aceita prefixo'),
      busca: z.string().optional().describe('termo no id ou no título, sem acento serve'),
    },
  },
  comArtefato((artefato, args) => catalogo(artefato, args)),
)

// ─── 2. o porquê ─────────────────────────────────────────────────────────────
servidor.registerTool(
  'rebar_porque',
  {
    title: 'Por que esta regra existe, com o número medido',
    description:
      'Devolve a razão de uma regra (ou de uma decisão fechada) pelo id: os parágrafos de porquê ' +
      'lidos da fonte com arquivo:linha, e os casos de prova que a travam. ' +
      'CHAME QUANDO O PORTÃO REPROVAR e você for tentado a contornar a regra, e ANTES de propor ' +
      'afrouxar, ignorar ou apagar qualquer verificação. Quase toda razão aqui traz o número que a ' +
      'mediu; número medido não se negocia.',
    inputSchema: {
      id: z.string().describe('id da regra, ex. "hex-cru", ou de uma decisão fechada'),
    },
  },
  comArtefato((artefato, { id }) => {
    const r = porque(artefato, id)
    return r.ok ? texto(r.texto) : erro(r.texto)
  }),
)

// ─── 3. o que já foi decidido ────────────────────────────────────────────────
servidor.registerTool(
  'rebar_decidir',
  {
    title: 'O que este projeto já decidiu sobre X',
    description:
      'Procura um assunto no artefato e responde o que o rebar já decidiu sobre ele: decisão fechada ' +
      'com o arquivo:linha que a prova, regra que a impõe, ou passo do portão. ' +
      'CHAME ANTES DE PROPOR qualquer escolha de stack, biblioteca, formato ou processo — a decisão ' +
      'provavelmente já existe e está provada em código. Quando nada casa, ela DIZ que nada impõe ' +
      'isso, em vez de inventar: isso também é resposta.',
    inputSchema: {
      assunto: z.string().describe('o assunto, em palavras: "cor", "env", "tailwind", "commit"'),
    },
  },
  comArtefato((artefato, { assunto }) => decidir(artefato, assunto)),
)

// ─── 4. o portão ─────────────────────────────────────────────────────────────
servidor.registerTool(
  'rebar_portao',
  {
    title: 'Os passos do portão, na ordem, e o que fazer quando um reprova',
    description:
      'Devolve os passos de `npm run verificar` na ordem, o comando de cada um e os códigos de saída; ' +
      'com { passo } devolve a dica de conserto daquele passo. ' +
      'CHAME QUANDO O VERIFICAR REPROVAR e a mensagem não bastar, e antes de dizer que algo "passou". ' +
      'Este MCP não é a porta: a porta é o comando que esta ferramenta devolve.',
    inputSchema: {
      passo: z.string().optional().describe('nome ou número do passo, ex. "mcp" ou "5"'),
    },
  },
  comArtefato((artefato, { passo }) => portao(artefato, passo)),
)

// ─── 5. rodar a régua ────────────────────────────────────────────────────────
//
// A única ferramenta que EXECUTA. Ela roda o mesmo binário do hook e do CI
// (`ferramental/rebar-check/index.mjs --json`), então não existe segundo veredito
// para divergir do primeiro — é atalho para o mesmo comando, não uma opinião nova.
//
// Roda o CHECKER, não o `npm run verificar` inteiro: os 11 passos incluem suíte de
// teste e prettier no repositório todo, que é caro demais para uma chamada de tool e
// já é trabalho do portão. Aqui responde a pergunta rápida "as 22 regras passam neste
// caminho?" — em ~1 s, medido.
//
// process.execPath e execFile, nunca `npx` nem shell: no Windows `npx` sem
// shell:true não existe como executável, e é o defeito que sobreviveu no alicerce
// porque o CI só rodava Linux.
const CHECKER = join(RAIZ, 'ferramental', 'rebar-check', 'index.mjs')

servidor.registerTool(
  'rebar_verificar',
  {
    title: 'Rodar a régua num caminho e devolver o placar',
    description:
      'Executa o rebar-check (o mesmo do hook e do CI) num caminho e devolve, por regra, o que passou, ' +
      'reprovou ou não se aplica, mais o código de saída. ' +
      'CHAME DEPOIS DE MEXER no repositório, e antes de afirmar que terminou. ' +
      'ATALHO, NÃO BARREIRA: quem barra é `npm run verificar` no hook e no CI; um verde aqui não ' +
      'substitui o portão, que ainda roda formato, elos, segredo, provas e frescor do MCP.',
    inputSchema: {
      caminho: z
        .string()
        .optional()
        .describe('pasta a auditar; precisa ser repositório git. Padrão: a raiz do rebar'),
      regra: z.string().optional().describe('id de uma regra só, para iterar rápido'),
    },
  },
  comArtefato(async (artefato, { caminho, regra }) => {
    if (!existsSync(CHECKER)) {
      return erro(
        [
          `rebar-mcp: o checker não está neste checkout (esperado em ${exibirCaminho(CHECKER)}).`,
          'As outras ferramentas continuam servindo o artefato; só a execução depende do repositório.',
        ].join('\n'),
      )
    }
    if (regra && !artefato.regras.some((r) => r.id === regra)) {
      return erro(`"${regra}" não é regra. Veja a lista em rebar_regras.`)
    }

    const alvo = caminho?.trim() ? caminho.trim() : RAIZ
    const args = [CHECKER, '--json']
    if (regra) args.push(`--regra=${regra}`)
    args.push(alvo)

    let saida
    let codigo = 0
    try {
      saida = await executar(process.execPath, args, {
        cwd: RAIZ,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      })
    } catch (e) {
      // O checker sai 1 quando reprova: isso é resultado, não falha da chamada.
      if (typeof e.code !== 'number') {
        return erro(`rebar-mcp: o checker não rodou: ${e.message}`)
      }
      codigo = e.code
      saida = e
    }

    const significado = artefato.codigosDeSaida?.[String(codigo)] ?? '(código desconhecido)'

    let avaliacoes
    try {
      avaliacoes = JSON.parse(saida.stdout)
    } catch {
      return erro(
        [
          `rebar-mcp: exit=${codigo} (${significado}) e a saída não é JSON.`,
          (saida.stderr || saida.stdout || '').trim().slice(0, 1500),
        ].join('\n'),
      )
    }

    const blocos = avaliacoes.map((a) => {
      if (a.erro) return `${a.nome}: ${a.erro}`
      const reprovou = a.resultados.filter((x) => x.estado === 'reprovou')
      const quebrou = a.resultados.filter((x) => x.estado === 'quebrou')
      const na = a.resultados.filter((x) => x.estado === 'na')
      // O `nota` do checker conta SÓ determinística — é o placar que decide o exit.
      // Heurística sai numa linha à parte, senão "13/13" ao lado de sete n/a listados
      // não fecha a conta e o leitor conclui que alguma coisa sumiu.
      const heu = a.resultados.filter((x) => x.classe === 'heurística')
      const heuAvisou = heu.filter((x) => x.estado === 'reprovou').length
      const linhas = [
        `alvo: ${a.nome}`,
        `determinísticas (estas reprovam): ${a.nota.ok}/${a.nota.total} passaram · ${a.nota.na} não se aplicam · ${a.nota.quebrou} quebrou(aram)`,
        `heurísticas (só avisam): ${heu.length - heuAvisou - heu.filter((x) => x.estado === 'na').length} passaram · ${heuAvisou} avisaram · ${heu.filter((x) => x.estado === 'na').length} não se aplicam`,
      ]
      if (quebrou.length) {
        linhas.push('', 'QUEBROU (defeito do rebar-check, não do alvo):')
        for (const x of quebrou) linhas.push(`  ${x.id}  ${x.motivo ?? ''}`)
      }
      if (reprovou.length) {
        linhas.push('', 'REPROVOU:')
        for (const x of reprovou) {
          linhas.push(`  ${x.id} (${x.nivel} ${x.classe})  ${x.motivo ?? ''}`)
        }
        linhas.push(`  → a razão de cada uma: rebar_porque { id: "${reprovou[0].id}" }`)
      }
      if (!reprovou.length && !quebrou.length) linhas.push('', 'Nenhuma regra reprovou.')
      if (na.length) {
        linhas.push('', `não se aplicam: ${na.map((x) => x.id).join(', ')}`)
      }
      return linhas.join('\n')
    })

    return [
      `exit=${codigo} — ${significado}`,
      `comando: node ferramental/rebar-check/index.mjs --json${regra ? ` --regra=${regra}` : ''} ${exibirCaminho(alvo)}`,
      '',
      blocos.join('\n\n'),
      '',
      'Isto é a régua, não o portão. O portão é `npm run verificar` (rebar_portao mostra os passos).',
    ].join('\n')
  }),
)

// Log de boot vai para stderr, sempre: stdout é o canal JSON-RPC, e qualquer byte
// solto ali quebra o handshake do cliente.
console.error(
  `rebar-mcp: 5 ferramentas, artefato em ${exibirCaminho(CAMINHO_ARTEFATO)}, ${carregar().regras.length} regras.`,
)

await servidor.connect(new StdioServerTransport())
