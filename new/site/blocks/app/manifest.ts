import type { MetadataRoute } from 'next'

import { naPasta, site } from '@/conteudo/carregar'

// Ver a nota de `sitemap.ts`.
export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.identidade.nome,
    short_name: site.meta.nomeCurto,
    description: site.meta.descricao,
    // EVERY PATH GOES THROUGH `naPasta`, AND THIS WAS READ IN THE BUILT FILE.
    // Next resolves the `basePath` in the `<link rel="manifest">` but NOT
    // inside the JSON it generates here: the manifest came out with
    // `"start_url": "/"` and icons at `/icone-192.png` — pointing at the root
    // of the domain, outside a project site. Installing the app would open the
    // wrong page and both icons would 404, with the build green throughout.
    start_url: naPasta('/'),
    scope: naPasta('/'),
    display: 'standalone',
    lang: site.meta.idioma,
    background_color: site.meta.cores.fundo,
    theme_color: site.meta.cores.tema,
    // Both icons are GENERATED alongside the og image — real PNGs, written with
    // `zlib`, which is built in. Declaring an icon that does not exist is worse
    // than declaring none: the browser asks, takes a 404, and the manifest ends
    // up half valid.
    icons: [
      { src: naPasta('/icone-192.png'), sizes: '192x192', type: 'image/png' },
      { src: naPasta('/icone-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
