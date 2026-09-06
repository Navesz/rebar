// O codigo de producao nao cita o schema pelo nome: quem o cita e o teste de
// contrato, e a pergunta desta regra e se ALGUEM le, nao se producao le.
export function totalDeItens(pedido) {
  return pedido.itens.length
}
