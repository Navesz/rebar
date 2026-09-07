// Minimal MCP client over stdio — the piece that lets a proof TALK to a server
// instead of describing it.
//
// It lived inside `prova-cliente.mjs`, which starts the server of THIS package.
// It moved here when the second proof that needed it showed up: the one for the
// MCP the generator writes into new projects, in
// `new/gate/prove-mcp-template.mjs`. Copying the sixty lines would be the second
// source aging on its own — and a defect in the client would cancel itself out
// on both sides, which is the same reason it does not use the SDK the server
// uses.
//
// ZERO DEPENDENCIES on purpose, even inside a package that is allowed to have
// dependencies.
//
// The MCP stdio transport is JSON-RPC 2.0 in NDJSON — one message per line, no
// Content-Length framing (that is LSP, and confusing the two is the classic
// mistake).

import { spawn } from 'node:child_process'

/** The protocol version this client speaks. The server answers with its own. */
export const PROTOCOLO = '2025-06-18'

/** Cuts a long answer: the proof is that the answer came right, not the whole text. */
export function trecho(t, limite = 900) {
  const s = String(t)
  return s.length <= limite ? s : `${s.slice(0, limite)}\n   … (+${s.length - limite} characters)`
}

/** The text of a `tools/call` answer, which arrives in pieces. */
export function textoDa(resposta) {
  return (resposta.result?.content ?? []).map((c) => c.text).join('\n')
}

export class Cliente {
  /**
   * By default it starts the server with `process.execPath`, the node running
   * this proof. With an explicit `comando`, it starts it the way a `.mcp.json`
   * says — which is how a published snippet gets proved instead of promised.
   *
   * `cwd` matters more than it looks in the generator's proofs: the project's
   * server derives the root from its own path, and a wrong cwd would make it
   * answer about another repository.
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

  /** Request with an id: returns the matching answer. 15 s is generous slack. */
  pedir(metodo, params) {
    const id = this.proximoId++
    const req = { jsonrpc: '2.0', id, method: metodo, params }
    return new Promise((resolve, reject) => {
      const relogio = setTimeout(() => reject(new Error(`no answer for ${metodo} in 15 s`)), 15_000)
      this.pendentes.set(id, (msg) => {
        clearTimeout(relogio)
        if (!this.curto) console.log(`  ← ${trecho(JSON.stringify(msg), 700)}`)
        resolve(msg)
      })
      this.enviar(req)
    })
  }

  /** Notification: no id, no answer. `initialized` is mandatory in MCP. */
  notificar(metodo, params) {
    this.enviar({ jsonrpc: '2.0', method: metodo, params })
  }

  /** The whole handshake, which is the same in every proof. */
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
   * Closes and WAITS for the process to actually die.
   *
   * The `await` is not fussiness: on Windows you cannot delete a folder that is
   * still the `cwd` of a live process, and `kill()` only asks. Without waiting,
   * the proof that builds a project in a tmpdir passes all five cases and dies
   * with EPERM during cleanup — measured.
   */
  fechar() {
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return Promise.resolve()
    return new Promise((resolve) => {
      this.proc.once('exit', () => resolve())
      this.proc.stdin.end()
      this.proc.kill()
      // Safety net: a server that ignores the signal does not hang the proof.
      setTimeout(() => resolve(), 5000).unref()
    })
  }
}
