import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { cn } from '@/lib/utils'
import { site } from '@/conteudo/carregar'

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
