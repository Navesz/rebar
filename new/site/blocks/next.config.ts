import type { NextConfig } from 'next'

import { site } from './conteudo/carregar'

const nextConfig: NextConfig = {
  // Pure SSG. It is what makes og:image exist: WhatsApp, LinkedIn, Slack and
  // Discord do not execute JavaScript, so a meta tag painted on the client does
  // not exist for them. Measured in the 31/08 spike — every route "prerendered
  // as static content", out/index.html at 12 KB and the absolute meta inside it.
  output: 'export',

  // DERIVED FROM `urlBase`, and derived on purpose: a GitHub Pages PROJECT site
  // lives at `user.github.io/repo`, and without `basePath` the published page
  // asks for the stylesheet at `/_next/...` instead of `/repo/_next/...`. The
  // HTML is right, the sheet 404s, and the site comes out with no styling at
  // all — while the build passes. There is no second place saying which folder
  // the site lives in, so there is nothing to diverge: for a site at the root of
  // a domain the pathname is empty and this line is a no-op.
  basePath: new URL(site.meta.urlBase).pathname.replace(/\/$/, ''),

  // `/docs` and `/docs/` have to be the same page. Without this the export emits
  // `docs.html` and only one of the two forms answers — measured on the rebar
  // site, where `/docs/` returned 404 while `/docs` worked.
  trailingSlash: true,

  images: {
    // NOT OPTIONAL, and not a preference. Next's image optimizer is a service
    // that runs on a server; `output: "export"` brings up no server at all.
    // Without this line the build fails the moment it meets an <Image>.
    unoptimized: true,
  },
}

export default nextConfig
