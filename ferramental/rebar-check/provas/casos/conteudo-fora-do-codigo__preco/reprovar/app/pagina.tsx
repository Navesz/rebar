import conteudo from '../conteudo/inicio.json' with { type: 'json' }
import { formatarPreco } from './lib/preco'

export function Pagina() {
  return (
    <section aria-label="Preco">
      <h1>{conteudo.titulo}</h1>
      <span>R$ 4.900,00</span>
      <span>R$ {formatarPreco(conteudo.precoEmCentavos)}</span>
    </section>
  )
}
