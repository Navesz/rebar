import type { MetadataRoute } from 'next'

import { site } from '@/conteudo/carregar'

// Ver a nota de `sitemap.ts`: sem `force-static` esta rota não é emitida no
// export, e o silêncio é total.
export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    // `urlBase` é validado SEM barra no fim justamente para esta concatenação
    // não produzir `//sitemap.xml`, que é 404 anunciado como se fosse válido.
    sitemap: `${site.meta.urlBase}/sitemap.xml`,
  }
}
