#!/usr/bin/env node
// Cliente mínimo de MCP — a prova de que este servidor RODA.
//
// Por que existe. O módulo mcp/ estava no disco há dias, 1.412 linhas, e NUNCA tinha
// sido executado: as dependências jamais foram instaladas, nenhum passo do verificar
// o tocava, nenhuma regra o cobria. "Escrito" não é "funcional", e a única forma de
// saber a diferença é falar o protocolo de verdade com ele.
//
// ZERO DEPENDÊNCIA de propósito, mesmo dentro de um pacote que pode ter dependência:
// se eu provasse o servidor com o SDK que o próprio servidor usa, um defeito do SDK
// se cancelaria dos dois lados. Aqui só entra node:child_process e JSON.
//
// O transporte stdio do MCP é JSON-RPC 2.0 em NDJSON — uma mensagem por linha, sem
// enquadramento Content-Length (isso é LSP, e confundir os dois é o erro clássico).
//
//   node mcp/src/prova-cliente.mjs           roda tudo e imprime as trocas reais
//   node mcp/src/prova-cliente.mjs --curto   só o veredito de cada passo

import { spawn } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SERVIDOR = join(AQUI, 'index.mjs')
const RAIZ = join(AQUI, '..', '..')
const LEIAME = join(AQUI, '..', 'README.md')
const CURTO = process.argv.includes('--curto')

// A versão do protocolo que este cliente fala. O servidor responde com a dele; se
// negociar para outra, a resposta do initialize mostra qual — e isso é informação,
// não erro.
const PROTOCOLO = '2025-06-18'

let falhas = 0

function titulo(t) {
  console.log(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`)
}

function ok(t) {
  console.log(`  ok   ${t}`)
}

function falhou(t) {
  falhas++
  console.log(`  FALHA ${t}`)
}

/** Corta resposta longa: a prova é que a resposta veio certa, não o texto inteiro. */
function trecho(t, limite = 900) {
  const s = String(t)
  return s.length <= limite ? s : `${s.slice(0, limite)}\n   … (+${s.length - limite} caracteres)`
}

class Cliente {
  /**
   * Por padrão sobe o servidor com `process.execPath`, o node que está rodando este
   * cliente. Com `comando` explícito, sobe do jeito que o `.mcp.json` do README manda
   * — que é o que o passo 5 usa para provar o snippet em vez de prometê-lo.
   */
  constructor(caminhoDoServidor, comando = null) {
    const [exe, args, opcoes] = comando
      ? [comando.command, comando.args, { cwd: RAIZ }]
      : [process.execPath, [caminhoDoServidor], {}]
    this.proc = spawn(exe, args, {
      ...opcoes,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.proximoId = 1
    this.pendentes = new Map()
    this.stderr = ''
    this.resto = ''

    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (pedaco) => {
      this.resto += pedaco
      let quebra
      while ((quebra = this.resto.indexOf('\n')) >= 0) {
        const linha = this.resto.slice(0, quebra).trim()
        this.resto = this.resto.slice(quebra + 1)
        if (!linha) continue
        const msg = JSON.parse(linha)
        if (msg.id !== undefined && this.pendentes.has(msg.id)) {
          this.pendentes.get(msg.id)(msg)
          this.pendentes.delete(msg.id)
        }
      }
    })
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (d) => {
      this.stderr += d
    })
  }

  enviar(objeto) {
    if (!CURTO) console.log(`  → ${JSON.stringify(objeto)}`)
    this.proc.stdin.write(`${JSON.stringify(objeto)}\n`)
  }

  /** Requisição com id: devolve a resposta correspondente. 15 s é folga generosa. */
  pedir(metodo, params) {
    const id = this.proximoId++
    const req = { jsonrpc: '2.0', id, method: metodo, params }
    return new Promise((resolve, reject) => {
      const relogio = setTimeout(
        () => reject(new Error(`sem resposta para ${metodo} em 15 s`)),
        15_000,
      )
      this.pendentes.set(id, (msg) => {
        clearTimeout(relogio)
        if (!CURTO) console.log(`  ← ${trecho(JSON.stringify(msg), 700)}`)
        resolve(msg)
      })
      this.enviar(req)
    })
  }

  /** Notificação: sem id, sem resposta. O `initialized` é obrigatório no MCP. */
  notificar(metodo, params) {
    this.enviar({ jsonrpc: '2.0', method: metodo, params })
  }

  fechar() {
    this.proc.stdin.end()
    this.proc.kill()
  }
}

function textoDa(resposta) {
  return (resposta.result?.content ?? []).map((c) => c.text).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────

titulo('1 · handshake: initialize + notifications/initialized')
const cliente = new Cliente(SERVIDOR)

const ini = await cliente.pedir('initialize', {
  protocolVersion: PROTOCOLO,
  capabilities: {},
  clientInfo: { name: 'prova-cliente-do-rebar', version: '1.0.0' },
})
if (ini.result?.serverInfo?.name === 'rebar') {
  ok(
    `servidor "${ini.result.serverInfo.name}" v${ini.result.serverInfo.version}, protocolo ${ini.result.protocolVersion}`,
  )
} else {
  falhou(`initialize devolveu ${JSON.stringify(ini).slice(0, 200)}`)
}
cliente.notificar('notifications/initialized', {})

titulo('2 · tools/list')
const lista = await cliente.pedir('tools/list', {})
const ferramentas = lista.result?.tools ?? []
if (ferramentas.length) {
  for (const f of ferramentas) {
    console.log(
      `  · ${f.name.padEnd(16)} ${Object.keys(f.inputSchema?.properties ?? {}).join(', ') || '(sem parâmetro)'}`,
    )
  }
  ok(`${ferramentas.length} ferramentas`)
} else {
  falhou('tools/list veio vazio')
}

// Cada chamada abaixo é uma pergunta que uma IA de verdade faz neste repositório.
const chamadas = [
  ['rebar_regras', { nivel: 'N1' }, 'o que me reprova quando eu mexer no CSS/lint'],
  ['rebar_porque', { id: 'hex-cru' }, 'reprovou hex-cru; por que isso é regra'],
  ['rebar_decidir', { assunto: 'cor' }, 'posso escrever #fff no componente?'],
  ['rebar_decidir', { assunto: 'mongodb' }, 'assunto que o rebar NÃO governa'],
  ['rebar_portao', { passo: 'mcp' }, 'o passo do portão que guarda este módulo'],
  ['rebar_verificar', {}, 'a régua no próprio rebar'],
  ['rebar_porque', { id: 'hex-crus' }, 'id errado: precisa sugerir, não morrer'],
]

for (const [nome, args, pergunta] of chamadas) {
  titulo(`3 · tools/call ${nome} ${JSON.stringify(args)}   — "${pergunta}"`)
  const r = await cliente.pedir('tools/call', { name: nome, arguments: args })
  const t = textoDa(r)
  if (!t) {
    falhou(`${nome} não devolveu texto`)
    continue
  }
  console.log(`\n${trecho(t, nome === 'rebar_porque' ? 2200 : 1600)}\n`)
  ok(
    `${nome}${r.result.isError ? ' (isError: true, esperado para id errado)' : ''} — ${t.length} caracteres`,
  )
}

cliente.fechar()

/**
 * Monta um repositório de mentira com uma cópia do servidor dentro, para testar o que
 * só dá para testar mexendo no disco.
 *
 * A cópia mora fora do repositório de verdade de propósito: os passos 4 e 6 precisam
 * de um artefato ausente e de uma fonte adulterada, e nenhum dos dois pode acontecer
 * em cima do rebar — o dono trabalha nele e outro agente também.
 *
 * A árvore imita a de verdade porque o servidor resolve tudo a partir da posição dele:
 * <raiz>/mcp/src/index.mjs → RAIZ = <raiz>. node_modules entra por junção, que no
 * Windows não pede admin e no Linux é symlink comum: o que se testa aqui é o JSON,
 * não a presença do SDK.
 */
function montarCopia(prefixo, { comArtefato = true, fonteAdulterada = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), prefixo))
  const src = join(base, 'mcp', 'src')
  mkdirSync(src, { recursive: true })
  for (const f of ['index.mjs', 'artefato.mjs', 'consultas.mjs']) {
    copyFileSync(join(AQUI, f), join(src, f))
  }
  symlinkSync(join(AQUI, '..', 'node_modules'), join(base, 'mcp', 'node_modules'), 'junction')
  if (comArtefato) {
    copyFileSync(join(AQUI, '..', 'regras.gerado.json'), join(base, 'mcp', 'regras.gerado.json'))
  }
  if (fonteAdulterada) {
    const dir = join(base, 'ferramental', 'rebar-check')
    mkdirSync(dir, { recursive: true })
    // Conteúdo diferente do original: é isso, e só isso, que o sha256 enxerga.
    writeFileSync(join(dir, 'index.mjs'), '// uma regra nova entrou aqui e o MCP não sabe\n')
  }
  return { base, servidor: join(src, 'index.mjs') }
}

/**
 * Desmonta a cópia — a junção PRIMEIRO, e com `rmdirSync`, não com `rmSync`.
 *
 * Uma junção do Windows é uma pasta de verdade para quem só olha, e apagar
 * recursivamente uma árvore que tem uma dentro é a receita para levar junto o
 * `mcp/node_modules` do repositório. `rmdirSync` remove a junção e para ali —
 * conferido antes de escrever isto: o alvo continuou intacto.
 */
function desmontarCopia(base) {
  try {
    rmdirSync(join(base, 'mcp', 'node_modules'))
    rmSync(base, { recursive: true, force: true })
  } catch {
    // Cópia de teste largada em %TEMP% não estraga nada, e o sistema limpa. Falhar a
    // prova por causa da faxina seria trocar o defeito real por ruído.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · o servidor sem artefato tem de MORRER, não servir vazio.
titulo('4 · sem artefato: o servidor morre com mensagem útil')
let semArtefato
try {
  semArtefato = montarCopia('rebar-mcp-sem-artefato-', { comArtefato: false })
} catch (e) {
  falhou(`não deu para montar a cópia de teste: ${e.message}`)
}

if (semArtefato) {
  const morto = spawn(process.execPath, [semArtefato.servidor], { windowsHide: true })
  let saidaDeErro = ''
  morto.stderr.setEncoding('utf8')
  morto.stderr.on('data', (d) => {
    saidaDeErro += d
  })
  const codigo = await new Promise((resolve) => morto.on('close', resolve))
  console.log(saidaDeErro.trimEnd())
  console.log(`\n  exit=${codigo}`)
  const util =
    saidaDeErro.includes('node mcp/gerar.mjs') && saidaDeErro.includes('regras.gerado.json')
  if (codigo === 1 && util) ok('morreu com exit 1 e disse como gerar o artefato')
  else falhou(`esperado exit 1 com o comando de geração na mensagem; veio exit ${codigo}`)
  desmontarCopia(semArtefato.base)
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · o snippet do README tem de FUNCIONAR.
//
// Um MCP só serve se estiver configurado, e configuração errada falha calada: o
// Claude Code simplesmente não lista a ferramenta, e ninguém liga o silêncio ao
// caminho trocado. Então o snippet não é copiado para cá — é LIDO do README e
// EXECUTADO. Se alguém mover mcp/src/index.mjs e esquecer o README, esta prova
// reprova. É o mesmo princípio do resto do módulo: derive, não duplique.
titulo('5 · o snippet de .mcp.json do README sobe o servidor')
const fence = /```json\n([\s\S]*?)```/.exec(readFileSync(LEIAME, 'utf8'))
if (!fence) {
  falhou('não achei bloco ```json no mcp/README.md')
} else {
  const config = JSON.parse(fence[1])
  const entrada = config.mcpServers?.rebar
  console.log(`  cwd: raiz do repositório`)
  console.log(`  ${JSON.stringify(entrada)}`)
  if (entrada?.command !== 'node') {
    falhou(`o snippet chama "${entrada?.command}"; tem de ser "node" (npx no Windows dá ENOENT)`)
  }
  const doSnippet = new Cliente(null, entrada)
  try {
    const r = await doSnippet.pedir('initialize', {
      protocolVersion: PROTOCOLO,
      capabilities: {},
      clientInfo: { name: 'prova-do-snippet', version: '1.0.0' },
    })
    const t = await doSnippet.pedir('tools/list', {})
    const n = t.result?.tools?.length ?? 0
    if (r.result?.serverInfo?.name === 'rebar' && n === ferramentas.length) {
      ok(`o snippet sobe o servidor e lista as mesmas ${n} ferramentas`)
    } else {
      falhou(`o snippet subiu algo diferente: ${JSON.stringify(r.result?.serverInfo)}, ${n} tools`)
    }
  } catch (e) {
    falhou(`o snippet não subiu o servidor: ${e.message}\n${doSnippet.stderr.trim()}`)
  }
  doSnippet.fechar()
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · fonte mudou, artefato não: TODA resposta tem de vir com o aviso.
//
// É o defeito do Herz reproduzido de propósito — a regra muda e o MCP continua
// servindo a versão velha. A autoridade sobre isso é o portão (`gerar.mjs
// --verificar`); o servidor só compara o sha256 que o artefato gravou em `fontes[]`
// com o hash do arquivo hoje. Sinal fraco, mas nunca falso negativo: se a regra
// mudou, o hash mudou.
//
// O aviso vai grudado na RESPOSTA, não numa tool de status, e é isso que este passo
// prova: uma tool de status só fala quando alguém pergunta, e o modelo não pergunta.
titulo('6 · fonte adulterada: o aviso de frescor cola em toda resposta')
let velho
try {
  velho = montarCopia('rebar-mcp-velho-', { fonteAdulterada: true })
} catch (e) {
  falhou(`não deu para montar a cópia de teste: ${e.message}`)
}

if (velho) {
  const c = new Cliente(velho.servidor)
  try {
    await c.pedir('initialize', {
      protocolVersion: PROTOCOLO,
      capabilities: {},
      clientInfo: { name: 'prova-de-frescor', version: '1.0.0' },
    })
    c.notificar('notifications/initialized', {})
    const r = await c.pedir('tools/call', {
      name: 'rebar_regras',
      arguments: { busca: 'readme' },
    })
    const t = textoDa(r)
    console.log(`\n${trecho(t, 700)}\n`)
    if (t.startsWith('AVISO DE FRESCOR') && t.includes('ferramental/rebar-check/index.mjs')) {
      ok('o aviso veio na frente da resposta, nomeando o arquivo que mudou')
    } else {
      falhou('a resposta veio sem aviso de frescor')
    }
  } catch (e) {
    falhou(`${e.message}\n${c.stderr.trim()}`)
  }
  c.fechar()
  desmontarCopia(velho.base)
}

titulo(falhas ? `${falhas} FALHA(S)` : 'tudo passou')
process.exit(falhas ? 1 : 0)
