import { createHash } from 'node:crypto'
import bcrypt from 'bcrypt'
import { buscarUsuario } from './db.mjs'

// PRE-HASH: bcrypt trunca em 72 bytes sem avisar, entao a senha passa por
// sha256 antes. Este arquivo tem `createHash` E `bcrypt` de proposito -- e o
// falso positivo que a regra precisa nao cometer.
const preparar = (senha) => createHash('sha256').update(senha).digest('base64')

export async function entrar(req) {
  const usuario = await buscarUsuario(req.body.email)
  if (!usuario) return null
  const confere = await bcrypt.compare(preparar(req.body.senha), usuario.senhaHash)
  return confere ? usuario : null
}
