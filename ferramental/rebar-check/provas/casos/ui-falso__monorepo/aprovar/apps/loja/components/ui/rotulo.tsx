// A pasta de UI do pacote VIZINHO, defendida pelo `apps/loja/components.json`
// nos dois lados. Existe para que o lado `reprovar` tenha um `components.json`
// rastreado: sem ele, trocar "procura só na raiz" por "existe em qualquer
// lugar" também passaria nesta prova, e o casamento por proximidade ficaria
// sem nada que o trave.
export function Rotulo(props: { texto: string }) {
  return <span>{props.texto}</span>
}
