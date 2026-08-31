// Formatador de moeda e codigo. Valor de moeda e conteudo. A regra separa os
// dois exigindo o DIGITO depois do cifrao.
export function formatarPreco(centavos: number) {
  const formato = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  return formato.format(centavos / 100)
}
