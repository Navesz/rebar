import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { cn } from '@/lib/utils'
import { site } from '@/conteudo/carregar'

const fontSans = Geist({ subsets: ['latin'], variable: '--font-sans' })
const fontMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

/**
 * NENHUM LITERAL DE CONTEÚDO AQUI. Tudo vem de `conteudo/site.json`, validado
 * em `conteudo/esquema.ts`. Trocar o nome do negócio é editar um JSON; não é
 * caçar string em `.tsx`.
 *
 * `metadataBase` é a peça que faz o resto funcionar: é ela que transforma
 * `/og.png` na URL ABSOLUTA que sai no HTML. WhatsApp, LinkedIn, Slack e
 * Discord não resolvem caminho relativo e não executam JavaScript — sem a base,
 * a tag sai relativa e o preview do link vem vazio. Foi essa propriedade que o
 * spike de 31/08 mediu no `out/index.html`.
 */
export const metadata: Metadata = {
  metadataBase: new URL(site.meta.urlBase),
  title: { default: site.meta.titulo, template: site.meta.gabaritoDeTitulo },
  description: site.meta.descricao,
  applicationName: site.identidade.nome,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    // O og quer `pt_BR`; o atributo `lang` do HTML quer `pt-BR`. Mesmo dado,
    // dois formatos — derivado, para o JSON não ter de guardar os dois.
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
