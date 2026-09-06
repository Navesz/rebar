import { Agent } from 'node:https'

// NUNCA use `rejectUnauthorized: false` aqui: desliga a verificacao de
// certificado no processo inteiro. O mesmo vale para
// NODE_TLS_REJECT_UNAUTHORIZED=0 e para `curl -k` no Dockerfile.
// Este comentario existe para provar que comentario nao conta como
// ocorrencia -- se contasse, todo detector se acusaria.
export const agente = new Agent({
  keepAlive: true,
})
