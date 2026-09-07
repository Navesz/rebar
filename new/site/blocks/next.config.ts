import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pure SSG. It is what makes og:image exist: WhatsApp, LinkedIn, Slack and
  // Discord do not execute JavaScript, so a meta tag painted on the client does
  // not exist for them. Measured in the 31/08 spike — every route "prerendered
  // as static content", out/index.html at 12 KB and the absolute meta inside it.
  output: 'export',
  images: {
    // NOT OPTIONAL, and not a preference. Next's image optimizer is a service
    // that runs on a server; `output: "export"` brings up no server at all.
    // Without this line the build fails the moment it meets an <Image>.
    unoptimized: true,
  },
}

export default nextConfig
