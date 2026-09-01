import conteudo from '../conteudo/inicio.json' with { type: 'json' }
import { formatarPreco } from './lib/preco'

export function Pagina() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6" aria-label="Apresentacao">
      <h1>{conteudo.titulo}</h1>
      <p>{conteudo.chamada}</p>
      <span>R$ {formatarPreco(conteudo.precoEmCentavos)}</span>
      <p>Forma de pagamento</p>
      <p>lote 7 · lote 9 · lote 12 · sem foto</p>
      <button type="button">Ver o catalogo completo</button>
      <div>Nenhuma peca nesta colecao por enquanto.</div>
    </section>
  )
}
