// A versao antiga lia process.env.API_TOKEN aqui. Hoje o token chega por
// parametro, e esta linha existe so para registrar a troca.
export function configurar(token) {
  return { token, tentativas: 3 }
}
