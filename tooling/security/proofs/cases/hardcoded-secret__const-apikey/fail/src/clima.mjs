// A FORMA DO Navesz/Climatic, SOZINHA — e sozinha e o ponto.
//
// O caso irmao `hardcoded-secret/` reprova por QUATRO caminhos ao mesmo tempo,
// e um lado satisfeito por varios caminhos nao prova nenhum: bastaria a regra
// contar so os achados de prefixo de fornecedor (`AKIA`, `ghp_`, `sk-`) para
// ele continuar vermelho com esta forma ja invisivel. Aqui nao ha prefixo
// nenhum. O que denuncia e o NOME do identificador mais o formato do valor, e
// e exatamente a chave viva que esta no main do repositorio publico hoje.
const apiKey = '7f3c9a1b5e2d8046c4a7b9e1f2306d58'

export async function agora(cidade) {
  const r = await fetch(`https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${cidade}`)
  return r.json()
}
