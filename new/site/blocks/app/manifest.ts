import type { MetadataRoute } from 'next'

import { site } from '@/conteudo/carregar'

// Ver a nota de `sitemap.ts`.
export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.identidade.nome,
    short_name: site.meta.nomeCurto,
    description: site.meta.descricao,
    start_url: '/',
    display: 'standalone',
    lang: site.meta.idioma,
    background_color: site.meta.cores.fundo,
    theme_color: site.meta.cores.tema,
    // Both icons are GENERATED alongside the og image — real PNGs, written with
    // `zlib`, which is built in. Declaring an icon that does not exist is worse
    // than declaring none: the browser asks, takes a 404, and the manifest ends
    // up half valid.
    icons: [
      { src: '/icone-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
