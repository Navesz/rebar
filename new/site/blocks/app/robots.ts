import type { MetadataRoute } from 'next'

import { site } from '@/conteudo/carregar'

// See the note in `sitemap.ts`: without `force-static` this route is not
// emitted into the export, and the silence is total.
export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    // `urlBase` is validated WITHOUT a trailing slash precisely so this
    // concatenation does not produce `//sitemap.xml`, which is a 404 announced
    // as if it were valid.
    sitemap: `${site.meta.urlBase}/sitemap.xml`,
  }
}
