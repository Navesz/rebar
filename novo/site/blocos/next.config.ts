import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // SSG puro. É o que faz og:image existir: WhatsApp, LinkedIn, Slack e Discord
  // não executam JavaScript, então meta tag pintada no cliente não existe para
  // eles. Medido no spike de 31/08 — todas as rotas "prerendered as static
  // content", out/index.html com 12 KB e a meta absoluta lá dentro.
  output: 'export',
  images: {
    // NÃO É OPCIONAL, e não é preferência. O otimizador de imagem do Next é um
    // serviço que roda em servidor; `output: "export"` não sobe servidor nenhum.
    // Sem esta linha o build reprova assim que encontra um <Image>.
    unoptimized: true,
  },
}

export default nextConfig
