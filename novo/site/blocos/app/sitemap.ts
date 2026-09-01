import type { MetadataRoute } from 'next'

import { site } from '@/conteudo/carregar'

/**
 * `force-static` é O QUE FAZ ESTE ARQUIVO EXISTIR sob `output: "export"`. Rota
 * de metadado é tratada como dinâmica por padrão, e export não tem servidor
 * para atender rota dinâmica: sem esta linha o `sitemap.xml` não é emitido, o
 * build não reclama, e a ausência só aparece no Search Console semanas depois.
 * Vale igual para `robots.ts` e `manifest.ts`.
 */
export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: site.meta.urlBase,
      // Data de CONTEÚDO, não `new Date()`. Com `new Date()` o mesmo commit
      // gera bytes diferentes a cada build, e build que não é reprodutível não
      // dá para comparar entre duas rodadas.
      lastModified: site.meta.atualizadoEm,
      changeFrequency: 'monthly',
      priority: 1,
    },
  ]
}
