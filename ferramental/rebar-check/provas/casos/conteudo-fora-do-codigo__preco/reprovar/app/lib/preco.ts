// Formatador de moeda e CODIGO: ele escreve a pontuacao, nao o valor. O valor
// vem de conteudo/inicio.json em centavos. A regra separa os dois exigindo o
// DIGITO depois do cifrao — sem digito nao ha preco, so simbolo.
export function formatarPreco(centavos: number) {
  const formato = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 })
  return formato.format(centavos / 100)
}
