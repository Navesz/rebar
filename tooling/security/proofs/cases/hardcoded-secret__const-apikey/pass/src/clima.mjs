// O MESMO ARQUIVO CONSERTADO, e a diferenca e uma linha.
//
// FALSO POSITIVO NOMEADO: `apiKey` continua aqui, com o mesmo nome, no mesmo
// lugar, usado na mesma URL. Uma regra que decidisse pelo NOME do
// identificador reprovaria este lado tambem, e reprovar o conserto e pior do
// que nao ter regra -- ensina a desligar a verificacao, e verificacao
// desligada verifica zero. O que separa os dois lados e so o formato do
// valor: literal de um lado, leitura do ambiente do outro.
const apiKey = process.env.WEATHER_API_KEY

export async function agora(cidade) {
  const r = await fetch(`https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${cidade}`)
  return r.json()
}
