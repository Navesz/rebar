// O endereco vem do ambiente e cai num padrao sensato quando ele falta. Isto
// e configuracao, nao endereco assado no codigo.
export const API_URL = process.env.API_URL ?? 'https://api.exemplo.com.br/catalogo'

export async function carregarCatalogo() {
  const resposta = await fetch(API_URL)
  return resposta.json()
}
