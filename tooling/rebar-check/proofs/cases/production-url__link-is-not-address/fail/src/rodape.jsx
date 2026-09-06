// O mesmo link e o mesmo campo de dado do lado aprovar, MAIS a requisicao
// para um endereco assado no codigo. So o fetch e a diferenca.
export const DOCUMENTACAO = [{ nome: 'fal', doc: 'https://docs.exemplo.com.br' }]

export async function carregarCatalogo() {
  return fetch('https://api.exemplo.com.br/catalogo')
}

export function Rodape() {
  return <a href="https://github.com/exemplo/projeto">codigo-fonte</a>
}
