#!/usr/bin/env node
// Servidor MCP do rebar.
//
// Existe porque o dono identificou o defeito: "a gente não criou um MCP pra essa
// sessão, então pode ser que você se perca". É o mesmo mecanismo que fez o
// bmb-compras virar aplicação final funcional — regra na memória do agente desde
// o começo.
//
// Duas regras de construção, e as duas vêm de defeitos medidos no Herz:
//
//   1. NENHUMA PROSA MORA AQUI. Toda resposta é lida de docs/PLANO.md no momento
//      da chamada. Não há cópia para divergir. O MCP do Herz serve 17 guias em
//      arquivos próprios, e o perfil do Alicerce registra que isso virou "texto
//      pago em token toda sessão".
//
//   2. RODA DO FONTE, NUNCA DE dist/. O CLAUDE.md do Herz diz que dist velho é a
//      causa nº 1 de "o guia não mudou". Sem build, sem essa classe de bug.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// fileURLToPath, não .pathname: no Windows o pathname vem como "/C:/Users/..."
// e todo readFileSync depois procura em C:\C:\Users\... É o bug que deixou o
// instalador de hooks do Alicerce morto por semanas.
const AQUI = dirname(fileURLToPath(import.meta.url))
const PLANO = join(AQUI, '..', '..', 'docs', 'PLANO.md')

/** Lê o plano do disco a cada chamada. Sem cache: cache é a origem da deriva. */
function lerPlano() {
  return readFileSync(PLANO, 'utf8')
}

/**
 * Fatia o documento em seções de primeiro nível.
 * A chave é o número ("0".."13"); o valor traz título e corpo.
 */
function seccionar(texto) {
  const linhas = texto.split('\n')
  const secoes = new Map()
  let atual = null
  let emCerca = false

  for (const linha of linhas) {
    // Um "# 5." dentro de bloco de código não é cabeçalho.
    if (linha.startsWith('```')) emCerca = !emCerca
    if (!emCerca) {
      const m = /^# (\d+)\.\s+(.*)$/.exec(linha)
      if (m) {
        atual = { numero: m[1], titulo: m[2].trim(), linhas: [] }
        secoes.set(m[1], atual)
        continue
      }
    }
    if (atual) atual.linhas.push(linha)
  }

  for (const s of secoes.values()) s.corpo = s.linhas.join('\n').trim()
  return secoes
}

const servidor = new McpServer({ name: 'rebar', version: '0.1.0' })

const texto = (t) => ({ content: [{ type: 'text', text: t }] })
const erro = (t) => ({ content: [{ type: 'text', text: t }], isError: true })

servidor.registerTool(
  'rebar_indice',
  {
    title: 'Índice do plano',
    description:
      'Lista as seções do plano do rebar, com número, título e tamanho. Chame antes de rebar_plano para saber o que existe sem ler o documento inteiro.',
    inputSchema: {},
  },
  async () => {
    const secoes = [...seccionar(lerPlano()).values()]
    const linhas = secoes.map(
      (s) => `${s.numero.padStart(2)} · ${s.titulo}  (${s.corpo.split('\n').length} linhas)`,
    )
    return texto(`Plano do rebar — ${secoes.length} seções\n\n${linhas.join('\n')}`)
  },
)

servidor.registerTool(
  'rebar_plano',
  {
    title: 'Ler uma seção do plano',
    description:
      'Devolve uma seção do plano pelo número. Use rebar_indice para descobrir os números. Nunca leia docs/PLANO.md inteiro: são 900+ linhas.',
    inputSchema: { secao: z.string().describe('Número da seção, por exemplo "9" ou "12"') },
  },
  async ({ secao }) => {
    const secoes = seccionar(lerPlano())
    const s = secoes.get(String(secao).trim())
    if (!s) {
      const nums = [...secoes.keys()].join(', ')
      return erro(`Seção "${secao}" não existe. Disponíveis: ${nums}`)
    }
    return texto(`# ${s.numero}. ${s.titulo}\n\n${s.corpo}`)
  },
)

servidor.registerTool(
  'rebar_decidido',
  {
    title: 'O que já foi decidido',
    description:
      'Devolve o registro de decisões (§11) e as decisões travadas (§2.1). Chame ANTES de propor qualquer escolha de stack, banco, biblioteca ou processo — a decisão provavelmente já foi tomada e está datada aqui.',
    inputSchema: {},
  },
  async () => {
    const secoes = seccionar(lerPlano())
    const registro = secoes.get('11')
    const contexto = secoes.get('2')

    const travadas = contexto
      ? contexto.corpo.slice(contexto.corpo.indexOf('## 2.1'))
      : '(seção 2 não encontrada)'

    return texto(
      [
        '## Decisões travadas',
        '',
        travadas,
        '',
        '---',
        '',
        `## ${registro ? registro.titulo : 'Registro de decisões'}`,
        '',
        registro ? registro.corpo : '(seção 11 não encontrada)',
      ].join('\n'),
    )
  },
)

servidor.registerTool(
  'rebar_aberto',
  {
    title: 'O que ainda está aberto',
    description:
      'Devolve o que ainda não foi decidido (§13) e os furos que a revisão adversarial encontrou (§12). Chame antes de afirmar que algo está resolvido.',
    inputSchema: {},
  },
  async () => {
    const secoes = seccionar(lerPlano())
    const aberto = secoes.get('13')
    const revisao = secoes.get('12')
    return texto(
      [
        `## ${aberto ? aberto.titulo : 'Aberto'}`,
        '',
        aberto ? aberto.corpo : '(seção 13 não encontrada)',
        '',
        '---',
        '',
        `## ${revisao ? revisao.titulo : 'Revisão'}`,
        '',
        revisao ? revisao.corpo : '(seção 12 não encontrada)',
      ].join('\n'),
    )
  },
)

servidor.registerTool(
  'rebar_passo',
  {
    title: 'O passo a passo de construção',
    description:
      'Devolve a ordem de construção com critério de pronto de cada passo (§9). Chame antes de começar a implementar qualquer coisa, para saber qual é o passo atual e o que precisa estar verdadeiro para ele fechar.',
    inputSchema: {},
  },
  async () => {
    const s = seccionar(lerPlano()).get('9')
    return s ? texto(`# 9. ${s.titulo}\n\n${s.corpo}`) : erro('Seção 9 não encontrada.')
  },
)

await servidor.connect(new StdioServerTransport())
