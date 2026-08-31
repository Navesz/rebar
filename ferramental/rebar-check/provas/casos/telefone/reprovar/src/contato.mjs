// O mesmo numero do comentario do lado aprovar, agora numa constante que o
// programa usa para montar o link.
const NUMERO = '+55 21 90000-0000'

export function linkDoPedido(texto) {
  return `https://wa.me/${NUMERO.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`
}
