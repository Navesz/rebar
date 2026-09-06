import { buscarUsuario } from './db.mjs'

export async function entrar(req) {
  const usuario = await buscarUsuario(req.body.email)
  if (!usuario) return null
  if (usuario.senha === req.body.senha) return usuario
  return null
}
