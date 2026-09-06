// Cliente mínimo de MCP sobre stdio — a peça que deixa uma prova FALAR com um
// servidor em vez de descrevê-lo.
//
// Estava dentro de `prova-cliente.mjs`, que sobe o servidor DESTE pacote. Saiu
// para cá quando apareceu a segunda prova que precisava dele: a do MCP que o
// gerador escreve nos projetos novos, em `new/gate/prove-mcp-template.mjs`.
// Copiar as sessenta linhas seria a segunda fonte a envelhecer sozinha — e um
// defeito no cliente se cancelaria dos dois lados, que é o mesmo motivo pelo
// qual ele não usa o SDK que o servidor usa.
//
// ZERO DEPENDÊNCIA de propósito, mesmo dentro de um pacote que pode ter
// dependência.
//
// O transporte stdio do MCP é JSON-RPC 2.0 em NDJSON — uma mensagem por linha,
// sem enquadramento Content-Length (isso é LSP, e confundir os dois é o erro
// clássico).

import { spawn } from 'node:child_process'

/** A versão do protocolo que este cliente fala. O servidor responde com a dele. */
export const PROTOCOLO = '2025-06-18'

/** Corta resposta longa: a prova é que a resposta veio certa, não o texto inteiro. */
export function trecho(t, limite = 900) {
  const s = String(t)
  return s.length <= limite ? s : `${s.slice(0, limite)}\n   … (+${s.length - limite} caracteres)`
}

/** O texto de uma resposta de `tools/call`, que vem em pedaços. */
export function textoDa(resposta) {
  return (resposta.result?.content ?? []).map((c) => c.text).join('\n')
}

export class Cliente {
  /**
   * Por padrão sobe o servidor com `process.execPath`, o node que está rodando
   * esta prova. Com `comando` explícito, sobe do jeito que um `.mcp.json` manda
   * — que é como se prova um snippet publicado em vez de prometê-lo.
   *
   * `cwd` importa mais do que parece nas provas do gerador: o servidor do
   * projeto deriva a raiz do próprio caminho, e um cwd errado o faria responder
   * sobre outro repositório.
   */
  constructor(caminhoDoServidor, { comando = null, cwd = null, curto = false } = {}) {
    const [exe, args] = comando
      ? [comando.command, comando.args]
      : [process.execPath, [caminhoDoServidor]]
    this.curto = curto
    this.proc = spawn(exe, args, {
      ...(cwd ? { cwd } : {}),
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
    if (!this.curto) console.log(`  → ${JSON.stringify(objeto)}`)
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
        if (!this.curto) console.log(`  ← ${trecho(JSON.stringify(msg), 700)}`)
        resolve(msg)
      })
      this.enviar(req)
    })
  }

  /** Notificação: sem id, sem resposta. O `initialized` é obrigatório no MCP. */
  notificar(metodo, params) {
    this.enviar({ jsonrpc: '2.0', method: metodo, params })
  }

  /** O handshake inteiro, que é igual em toda prova. */
  async apresentar(nome) {
    const ini = await this.pedir('initialize', {
      protocolVersion: PROTOCOLO,
      capabilities: {},
      clientInfo: { name: nome, version: '1.0.0' },
    })
    this.notificar('notifications/initialized', {})
    return ini
  }

  /**
   * Fecha e ESPERA o processo morrer de fato.
   *
   * O `await` não é zelo: no Windows não se apaga uma pasta que ainda é o `cwd`
   * de um processo vivo, e `kill()` só pede. Sem esperar, a prova que monta um
   * projeto num tmpdir passa nos cinco casos e morre com EPERM na limpeza —
   * medido.
   */
  fechar() {
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return Promise.resolve()
    return new Promise((resolve) => {
      this.proc.once('exit', () => resolve())
      this.proc.stdin.end()
      this.proc.kill()
      // Rede de segurança: um servidor que ignore o sinal não trava a prova.
      setTimeout(() => resolve(), 5000).unref()
    })
  }
}
