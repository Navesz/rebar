import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { cn } from '@/lib/utils'
import { naPasta, site } from '@/conteudo/carregar'

const fontSans = Geist({ subsets: ['latin'], variable: '--font-sans' })
const fontMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

/**
 * NO CONTENT LITERAL HERE. Everything comes from `conteudo/site.json`,
 * validated in `conteudo/esquema.ts`. Changing the business name is editing a
 * JSON; it is not hunting strings in `.tsx`.
 *
 * `metadataBase` is the piece that makes the rest work: it is what turns
 * `/og.png` into the ABSOLUTE URL that goes out in the HTML. WhatsApp,
 * LinkedIn, Slack and Discord do not resolve a relative path and do not execute
 * JavaScript — without the base, the tag comes out relative and the link
 * preview comes up empty. That is the property the 31/08 spike measured in
 * `out/index.html`.
 */
export const metadata: Metadata = {
  metadataBase: new URL(site.meta.urlBase),
  title: { default: site.meta.titulo, template: site.meta.gabaritoDeTitulo },
  description: site.meta.descricao,
  applicationName: site.identidade.nome,
  alternates: { canonical: '/' },
  // THE FAVICON, AND IT POINTS AT A FILE THE GENERATOR REALLY WRITES.
  //
  // Without this key the tab shows whatever the scaffold left behind, and the
  // one project that noticed fixed it in its own copy — the template stayed
  // without it, so every site born after that carried the same hole. That is
  // the shape of defect this repository exists to close, and the favicon is
  // named in the plan (§3.3, §6.2) as one of the holes.
  //
  // WHY THE 192 AND NOT THE CARD. `aplicar.mjs` writes three images and no
  // brand drawing: the share card, which is 1200 by 630 and would be a sliver
  // squeezed into a square tab, and the two icons `og.mjs` draws with one or
  // two initials — sized that way, in its own words, because of favicon size.
  // So the tab gets the smaller of the two squares, which is the SAME art
  // `app/manifest.ts` already declares: one drawing, not a second one to drift
  // from it. Pointing at a file the generator does not write would be
  // declaring a 404, which is worse than declaring nothing.
  //
  // AND IT GOES THROUGH `naPasta`, for the reason measured in
  // `conteudo/carregar.ts`: Next does not resolve `icons` against
  // `metadataBase` the way it resolves the canonical and the og image — this
  // string reaches the `href` verbatim. Read in the built export of a site
  // that lives in a folder, a path with no folder in front of it is a 404 with
  // the build, the types and the lint all green.
  icons: { icon: { url: naPasta('/icone-192.png'), type: 'image/png' } },
  openGraph: {
    type: 'website',
    // og wants `pt_BR`; the HTML `lang` attribute wants `pt-BR`. Same datum,
    // two formats — derived, so the JSON does not have to keep both.
    locale: site.meta.idioma.replace('-', '_'),
    url: '/',
    siteName: site.identidade.nome,
    title: site.meta.titulo,
    description: site.meta.descricao,
    images: [
      {
        url: site.meta.og.caminho,
        width: site.meta.og.largura,
        height: site.meta.og.altura,
        alt: site.meta.og.alt,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: site.meta.titulo,
    description: site.meta.descricao,
    images: [site.meta.og.caminho],
  },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang={site.meta.idioma}
      suppressHydrationWarning
      className={cn('antialiased', fontMono.variable, 'font-sans', fontSans.variable)}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
