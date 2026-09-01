import conteudo from '../conteudo/inicio.json' with { type: 'json' }

export function Pagina() {
  return (
    <section>
      <h1>{conteudo.titulo}</h1>
      <p>
        {conteudo.chamada} <strong>{conteudo.destaque}</strong>
      </p>
    </section>
  )
}
