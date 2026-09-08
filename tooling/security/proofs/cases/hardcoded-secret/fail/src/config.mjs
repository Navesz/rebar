// As quatro formas que a auditoria mediu no repositorio de teste, no mesmo
// arquivo. Todas sinteticas: prefixo e comprimento sao o que as regras do
// fornecedor leem, e o miolo e sequencia de teclado, credencial de ninguem.
export const aws = {
  region: 'sa-east-1',
  accessKeyId: 'AKIA3TQ7WZ2NLKD5RJ6V',
}

export const githubToken = 'ghp_B4c5D6e7F8g9H0i1J2k3L4m5N6o7P8q9R0s1'

export const chaveDoModelo = 'sk-ant-api03-9Fk2Lm7Qp4Xr8Tv3Zb6Nc1Hd5Ws0Yj'

// A quarta e a forma exata que esta viva no Navesz/Climatic publico: nao tem
// prefixo de fornecedor nenhum, quem a denuncia e o NOME do identificador.
const apiKey = '7f3c9a1b5e2d8046c4a7b9e1f2306d58'

export const clima = (cidade) =>
  fetch(`https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${cidade}`)
