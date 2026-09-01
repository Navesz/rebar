import conteudo from '../conteudo/inicio.json' with { type: 'json' }

export function Pagina() {
  return (
    <section>
      <h1>{conteudo.titulo}</h1>
      <p>
        Mesa de <strong>jantar em madeira</strong> macica
      </p>
    </section>
  )
}
