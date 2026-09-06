// O mesmo endereco, a mesma constante, e nenhum caminho para troca-lo sem
// editar codigo.
export const API_URL = 'https://api.exemplo.com.br/catalogo'

export async function carregarCatalogo() {
  const resposta = await fetch(API_URL)
  return resposta.json()
}
