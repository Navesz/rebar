import type { ReactNode } from 'react'

import { linkWhatsapp, site, type Contato } from '@/conteudo/carregar'

/**
 * NENHUM LITERAL DE CONTEÚDO DENTRO. Todo texto visível é `{expressão}` lida de
 * `conteudo/site.json`; o que sobra em `.tsx` é estrutura e classe do Tailwind.
 *
 * O link do WhatsApp é o caso que dá nome à §12.3: o FORMATO do link é código
 * (não muda de negócio para negócio), o DESTINATÁRIO é conteúdo validado. O PR
 * `Navesz/Galegos#1` errou o corte ao mandar o destinatário para env var — o
 * build passava e o link subia sem ninguém do outro lado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTE ARQUIVO RENDERIZA O QUE FOI DECLARADO, E NÃO QUEBRA COM O QUE FALTOU.
 *
 * Até 02/09 ele assumia que telefone, e-mail e endereço existiam sempre, e o
 * esquema os exigia de todo site para que a suposição fosse verdade. Era a
 * §12.3 lida errado: ela decidiu que o telefone MORA aqui e é validado, não que
 * todo negócio TENHA telefone. Agora os três são blocos condicionais, e a
 * declaração é a presença da chave em `conteudo/site.json`.
 *
 * O MAPA `CONTATOS` É O DENTE, e ele fecha as duas direções do defeito de uma
 * vez, sem regra nova, sem heurística e sem varrer arquivo:
 *
 *   · bloco DECLARADO e não renderizado — alguém escreve o WhatsApp, a home não
 *     tem o botão, e a pessoa acha que publicou o contato. Apagar a entrada
 *     daqui deixa o mapa incompleto perante o `satisfies` abaixo: NÃO COMPILA.
 *   · bloco RENDERIZADO e vazio — o desastre do Galegos, link `wa.me` sem
 *     destinatário. O valor é `T | null` e `linkWhatsapp` recebe o bloco, não o
 *     site: sem estreitar o `null`, NÃO COMPILA.
 *   · bloco NOVO no esquema — um Instagram, um horário — sem lugar na home:
 *     falta a chave no mapa e o `satisfies` reprova. NÃO COMPILA.
 *
 * O limite, dito de frente: apagar a seção inteira do JSX abaixo, mapa
 * incluído, não é pego por tipo nenhum. Isso é o dono removendo a home, não uma
 * deriva silenciosa — e o `npm run lint` do projeto acusa o que ficar sem uso.
 * ─────────────────────────────────────────────────────────────────────────
 */
const CONTATOS = {
  whatsapp: ({ whatsapp }: Contato) =>
    whatsapp && (
      <a href={linkWhatsapp(whatsapp)} rel="noopener noreferrer" target="_blank">
        {whatsapp.exibicao}
      </a>
    ),

  email: ({ email }: Contato) => email && <a href={`mailto:${email}`}>{email}</a>,

  endereco: ({ endereco }: Contato) =>
    endereco && (
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
    ),
  // `satisfies`, e não anotação de tipo: anotação aceitaria o mapa a MENOS
  // (o objeto seria só um `Renderizadores` incompleto na hora de escrever) e
  // apagaria os tipos de retorno de cada entrada. `satisfies` cobra a chave que
  // falta E a chave que sobra — bloco apagado do esquema com renderizador
  // esquecido aqui também não compila.
  //
  // Sem `-?` de propósito: as chaves de `Contato` são OBRIGATÓRIAS com valor
  // `T | null`, nunca `?`, porque `objeto()` do esquema sempre escreve todas.
  // O `-?` estava aqui e foi medido em 02/09: com ele fora, apagar um
  // renderizador continua dando TS1360. Modificador que não muda nada é
  // comentário mentindo que é código.
} satisfies { [Bloco in keyof Contato]: (contato: Contato) => ReactNode }

export default function Pagina() {
  // Apelido de um nível só, que é o que o passo `blocos` do rebar sabe
  // resolver ao conferir todo `site.<campo>` contra a forma validada.
  const zap = site.identidade.whatsapp

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">{site.home.titulo}</h1>
        <p className="text-muted-foreground text-lg leading-relaxed">{site.home.subtitulo}</p>
        {/* A chamada principal É o botão de WhatsApp, então ela existe exatamente
            quando o bloco existe. Sem o bloco a home fica sem botão de propósito:
            inventar uma chamada para o e-mail seria o gerador escrevendo copy que
            ninguém aprovou, e copy que ninguém aprovou é o que vira link morto. */}
        {zap && (
          <a
            className="bg-primary text-primary-foreground inline-flex w-fit items-center rounded-md px-5 py-2.5 text-sm font-medium"
            href={linkWhatsapp(zap)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {zap.chamadaAcao}
          </a>
        )}
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
        {Object.entries(CONTATOS).map(([bloco, montar]) => {
          const linha = montar(site.identidade)
          // Bloco ausente devolve `null` e não vira parágrafo vazio: o rodapé de
          // um site só com e-mail tem uma linha, não três com dois buracos.
          return linha ? <p key={bloco}>{linha}</p> : null
        })}
      </footer>
    </main>
  )
}
