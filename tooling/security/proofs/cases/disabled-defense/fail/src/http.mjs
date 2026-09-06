import { Agent } from 'node:https'

export const agente = new Agent({
  rejectUnauthorized: false,
})
