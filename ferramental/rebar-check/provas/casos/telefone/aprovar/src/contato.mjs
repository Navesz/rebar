// O numero saiu daqui e foi para conteudo/contato.json. O valor antigo era
// +55 21 90000-0000, e esta linha existe so para registrar a troca.
export function linkDoPedido(numero, texto) {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
}
