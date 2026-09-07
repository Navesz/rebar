import type { ReactNode } from 'react'

import { linkWhatsapp, site, type Contato } from '@/conteudo/carregar'

/**
 * NO CONTENT LITERAL INSIDE. Every visible text is an `{expression}` read from
 * `conteudo/site.json`; what is left in the `.tsx` is structure and Tailwind
 * classes.
 *
 * The WhatsApp link is the case that gives §12.3 its name: the link FORMAT is
 * code (it does not change from business to business), the RECIPIENT is
 * validated content. The `Navesz/Galegos#1` PR missed the cut by sending the
 * recipient to an env var — the build passed and the link shipped with nobody
 * on the other side.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS FILE RENDERS WHAT WAS DECLARED, AND DOES NOT BREAK ON WHAT IS MISSING.
 *
 * Until 02/09 it assumed phone, e-mail and address always existed, and the
 * schema demanded them of every site so the assumption would be true. That was
 * §12.3 read wrong: it decided that the phone LIVES here and is validated, not
 * that every business HAS a phone. Now the three are conditional blocks, and
 * the declaration is the presence of the key in `conteudo/site.json`.
 *
 * THE `CONTATOS` MAP IS THE TOOTH, and it closes both directions of the defect
 * at once, with no new rule, no heuristic and no file scanning:
 *
 *   · block DECLARED and not rendered — somebody writes the WhatsApp, the home
 *     has no button, and the person thinks they published the contact. Deleting
 *     the entry here leaves the map incomplete before the `satisfies` below: IT
 *     DOES NOT COMPILE.
 *   · block RENDERED and empty — the Galegos disaster, a `wa.me` link with no
 *     recipient. The value is `T | null` and `linkWhatsapp` takes the block, not
 *     the site: without narrowing the `null`, IT DOES NOT COMPILE.
 *   · NEW block in the schema — an Instagram, a set of opening hours — with no
 *     place on the home: the key is missing from the map and the `satisfies`
 *     fails. IT DOES NOT COMPILE.
 *
 * The limit, said to your face: deleting the whole JSX section below, map
 * included, is caught by no type at all. That is the owner removing the home,
 * not a silent drift — and the project's `npm run lint` reports whatever is
 * left unused.
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
  // `satisfies`, and not a type annotation: an annotation would accept the map
  // SHORT (the object would be just an incomplete `Renderizadores` at writing
  // time) and would erase each entry's return type. `satisfies` charges for the
  // key that is missing AND the key that is extra — a block deleted from the
  // schema with a renderer forgotten here does not compile either.
  //
  // No `-?`, on purpose: the keys of `Contato` are MANDATORY with value
  // `T | null`, never `?`, because the schema's `objeto()` always writes all of
  // them. The `-?` was here and was measured on 02/09: with it gone, deleting a
  // renderer still gives TS1360. A modifier that changes nothing is a comment
  // lying that it is code.
} satisfies { [Bloco in keyof Contato]: (contato: Contato) => ReactNode }

export default function Pagina() {
  // A one-level alias, which is what rebar's `blocos` step knows how to resolve
  // when it checks every `site.<field>` against the validated shape.
  const zap = site.identidade.whatsapp

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">{site.home.titulo}</h1>
        <p className="text-muted-foreground text-lg leading-relaxed">{site.home.subtitulo}</p>
        {/* The main call to action IS the WhatsApp button, so it exists exactly
            when the block exists. Without the block the home has no button, on
            purpose: inventing a call to action for the e-mail would be the
            generator writing copy nobody approved, and copy nobody approved is
            what turns into a dead link. */}
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
          // An absent block returns `null` and does not become an empty
          // paragraph: the footer of a site with only an e-mail has one line,
          // not three with two holes.
          return linha ? <p key={bloco}>{linha}</p> : null
        })}
      </footer>
    </main>
  )
}
