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
    // Os dois ícones são GERADOS junto com o og — PNG de verdade, escrito com
    // `zlib`, que é built-in. Declarar ícone que não existe é pior que não
    // declarar: o navegador pede, toma 404, e o manifesto fica meio válido.
    icons: [
      { src: '/icone-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
