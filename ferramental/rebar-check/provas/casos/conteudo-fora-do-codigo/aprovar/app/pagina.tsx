import conteudo from '../conteudo/inicio.json' with { type: 'json' }
import { formatarPreco } from './lib/preco'

export function Pagina() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6" aria-label="Apresentacao">
      <h1>{conteudo.titulo}</h1>
      <p>{conteudo.chamada}</p>
      <span>{formatarPreco(conteudo.precoEmCentavos)}</span>
    </section>
  )
}
