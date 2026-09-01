import { linkWhatsapp, site } from '@/conteudo/carregar'

/**
 * NENHUM LITERAL DE CONTEÚDO DENTRO. Todo texto visível é `{expressão}` lida de
 * `conteudo/site.json`; o que sobra em `.tsx` é estrutura e classe do Tailwind.
 *
 * O link do WhatsApp é o caso que dá nome à §12.3: o FORMATO do link é código
 * (não muda de negócio para negócio), o DESTINATÁRIO é conteúdo validado. O PR
 * `Navesz/Galegos#1` errou o corte ao mandar o destinatário para env var — o
 * build passava e o link subia sem ninguém do outro lado. Aqui, número ausente
 * ou malformado reprova o build em `conteudo/esquema.ts`.
 */
export default function Pagina() {
  const endereco = site.identidade.endereco

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">{site.home.titulo}</h1>
        <p className="text-muted-foreground text-lg leading-relaxed">{site.home.subtitulo}</p>
        <a
          className="bg-primary text-primary-foreground inline-flex w-fit items-center rounded-md px-5 py-2.5 text-sm font-medium"
          href={linkWhatsapp(site, site.home.mensagemWhatsapp)}
          rel="noopener noreferrer"
          target="_blank"
        >
          {site.home.chamadaAcao}
        </a>
      </header>

      <ul className="grid gap-6 sm:grid-cols-3">
        {site.home.destaques.map((destaque) => (
          <li className="flex flex-col gap-2" key={destaque.titulo}>
            <h2 className="font-medium">{destaque.titulo}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">{destaque.texto}</p>
          </li>
        ))}
      </ul>

      <footer className="text-muted-foreground mt-auto flex flex-col gap-1 text-sm">
        <p>{site.identidade.nome}</p>
        <address className="not-italic">
          {endereco.logradouro}
          {', '}
          {endereco.bairro}
          {' — '}
          {endereco.cidade}
          {'/'}
          {endereco.uf}
          {' · '}
          {endereco.cep}
        </address>
        <p>
          <a href={`mailto:${site.identidade.email}`}>{site.identidade.email}</a>
          {' · '}
          <a
            href={linkWhatsapp(site, site.home.mensagemWhatsapp)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {site.identidade.whatsapp.exibicao}
          </a>
        </p>
      </footer>
    </main>
  )
}
