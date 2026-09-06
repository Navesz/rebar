#!/usr/bin/env node
// A PRIMEIRA PROVA DE COMPORTAMENTO DO MCP QUE O GERADOR ESCREVE.
//
// Por que existe. `new/gate/arquivos/mcp-rebar.mjs` tem mais de 800 linhas e vai
// para dentro de todo projeto gerado como `.rebar/mcp.mjs`. Até 2026-09-06 nada
// o executava: o passo `syntax` conferia que ele PARSEIA, o `generator-map`
// conferia que ele é EMITIDO, e nenhum dos dois conferia que ele RESPONDE. É
// exatamente o buraco que deixou o `rebar novo` quebrado por seis commits com o
// portão 15/15 verde — o portão provava o ferramental e nunca o produto.
//
// O QUE SE PROVA AQUI, e é a pergunta mais cara que este MCP responde: o portão
// deste projeto está armado?
//
// `core.hooksPath` é uma string livre. O git grava sem conferir nada:
//
//   $ git config core.hooksPath .hooks-que-nunca-existiram   # sai 0, calado
//   $ git commit ...                                          # nenhum hook roda
//
// Quem lê só o valor conclui "armado" e responde ao agente que o portão está
// fechado enquanto ele está escancarado — que é pior que não saber, porque é o
// que faz o agente parar de perguntar. São cinco estados, e cada um é um caso
// abaixo.
//
//   node new/gate/prove-mcp-template.mjs           mostra as trocas
//   node new/gate/prove-mcp-template.mjs --curto   só o veredito

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Cliente, textoDa } from '../../mcp/src/cliente-jsonrpc.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const MODELO = join(AQUI, 'arquivos', 'mcp-rebar.mjs')
const CURTO = process.argv.includes('--curto')

let falhas = 0
const titulo = (t) => console.log(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`)
const ok = (t) => console.log(`  ok   ${t}`)
const falhou = (t) => {
  falhas++
  console.log(`  FALHA ${t}`)
}

/**
 * Um projeto gerado, mínimo mas real: repositório de verdade, hooks no disco, e
 * o modelo COPIADO — não importado. Importar leria o arquivo daqui e provaria o
 * caminho errado; o que vai para o usuário é a cópia.
 */
function montarProjeto() {
  const base = mkdtempSync(join(tmpdir(), 'rebar-mcp-'))

  // Configuração global e de sistema fora do caminho: um `core.hooksPath` na
  // máquina de quem roda esta prova decidiria o resultado dos cinco casos.
  // Arquivo vazio de verdade, porque `/dev/null` não existe no Windows.
  const vazio = join(base, 'git-config-vazio')
  writeFileSync(vazio, '', 'utf8')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: vazio, GIT_CONFIG_SYSTEM: vazio }
  const git = (...args) =>
    execFileSync('git', args, { cwd: base, encoding: 'utf8', env, windowsHide: true }).trim()

  git('init', '-q')
  git('config', 'user.email', 'prova@rebar.local')
  git('config', 'user.name', 'prova')

  const pkg = {
    name: 'projeto-de-prova',
    scripts: { verificar: 'npm run lint && npm run build', lint: 'echo lint', build: 'echo build' },
  }
  writeFileSync(join(base, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

  mkdirSync(join(base, '.githooks'), { recursive: true })
  for (const h of ['pre-commit', 'commit-msg']) {
    writeFileSync(join(base, '.githooks', h), '#!/bin/sh\nexit 0\n', 'utf8')
  }
  for (const m of ['scan-secret.mjs', 'check-message.mjs']) {
    writeFileSync(join(base, '.githooks', m), '// prova\n', 'utf8')
  }
  writeFileSync(join(base, '.rebar-coauthors'), 'humano@exemplo.com\n', 'utf8')

  // A pasta do CASO D: existe, e não é a do projeto.
  mkdirSync(join(base, 'outros-hooks'), { recursive: true })

  mkdirSync(join(base, '.rebar'), { recursive: true })
  const servidor = join(base, '.rebar', 'mcp.mjs')
  copyFileSync(MODELO, servidor)

  return { base, servidor, env, git }
}

/** Pergunta ao MCP do projeto o estado do portão, e devolve o bloco de hooks. */
async function estadoDoPortao(projeto) {
  const c = new Cliente(projeto.servidor, { cwd: projeto.base, curto: CURTO })
  try {
    await c.apresentar('prova-do-modelo')
    const r = await c.pedir('tools/call', { name: 'rebar_portao', arguments: {} })
    const t = textoDa(r)
    if (!t) throw new Error('rebar_portao não devolveu texto')
    return JSON.parse(t).hooks_de_git
  } finally {
    await c.fechar()
  }
}

const projeto = montarProjeto()

try {
  // ── caso A: o clone recém-feito. Nenhum hook armado, e é o normal.
  titulo('A · sem core.hooksPath — o estado de quem acabou de clonar')
  let h = await estadoDoPortao(projeto)
  if (h.armado !== false) falhou(`disse armado=${h.armado} sem core.hooksPath nenhum`)
  else if (!/não está configurado/.test(h.porque_nao ?? ''))
    falhou(`desarmou, mas o motivo não diz que falta configurar: ${h.porque_nao}`)
  else ok(`armado=false · ${h.porque_nao}`)

  // ── caso B: instalado de verdade. É o único que pode dizer sim.
  titulo('B · core.hooksPath = .githooks — instalado de verdade')
  projeto.git('config', 'core.hooksPath', '.githooks')
  h = await estadoDoPortao(projeto)
  if (h.armado !== true) falhou(`disse armado=${h.armado} com o portão instalado: ${h.porque_nao}`)
  else ok(`armado=true · core.hooksPath=${h.core_hooksPath}`)

  // ── caso C: O DEFEITO. Aponta para o que não existe, e o git não reclama.
  titulo('C · core.hooksPath para pasta inexistente — o git aceita e não roda nada')
  projeto.git('config', 'core.hooksPath', '.hooks-que-nunca-existiram')
  h = await estadoDoPortao(projeto)
  if (h.armado !== false)
    falhou(
      'disse armado=true com core.hooksPath apontando para o nada — é o portão escancarado ' +
        'sendo anunciado como fechado, que é o que faz o agente parar de perguntar',
    )
  else if (!/NÃO existe no disco/.test(h.porque_nao ?? ''))
    falhou(`desarmou, mas não disse que o destino não existe: ${h.porque_nao}`)
  else ok(`armado=false · ${h.porque_nao}`)

  // ── caso D: aponta para uma pasta que EXISTE, e é outra.
  titulo('D · core.hooksPath para OUTRA pasta existente — o git roda os hooks de lá')
  projeto.git('config', 'core.hooksPath', 'outros-hooks')
  h = await estadoDoPortao(projeto)
  if (h.armado !== false)
    falhou(
      'disse armado=true com core.hooksPath em outra pasta — os hooks deste projeto estão no ' +
        'disco e o git executa os de lá',
    )
  else if (!/e não para \.githooks\//.test(h.porque_nao ?? ''))
    falhou(`desarmou, mas não disse que é outra pasta: ${h.porque_nao}`)
  else ok(`armado=false · ${h.porque_nao}`)

  // ── caso E: o caminho ABSOLUTO da pasta certa é a pasta certa.
  //    Sem isto, um conserto que só comparasse strings passaria nos quatro
  //    acima e reprovaria quem instalou com caminho absoluto — falso positivo,
  //    que custa mais que regra ausente.
  titulo('E · core.hooksPath absoluto apontando para .githooks — é a mesma pasta')
  projeto.git('config', 'core.hooksPath', join(projeto.base, '.githooks'))
  h = await estadoDoPortao(projeto)
  if (h.armado !== true)
    falhou(`disse armado=false para o caminho absoluto da pasta certa: ${h.porque_nao}`)
  else ok(`armado=true · ${h.core_hooksPath}`)
} finally {
  // `maxRetries` porque o antivírus e o indexador do Windows seguram handle por
  // alguns milissegundos depois de o processo sair.
  rmSync(projeto.base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

titulo(falhas ? `${falhas} FALHA(S)` : 'tudo passou')
process.exit(falhas ? 1 : 0)
