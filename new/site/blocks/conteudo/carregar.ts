/**
 * The single point where `site.json` becomes typed data — and the point where
 * the build dies if it diverges from the schema.
 *
 * The validation runs at MODULE SCOPE on purpose. `app/layout.tsx` imports from
 * here, `next build` evaluates this module to pre-render the route, and a missing
 * field throws before any HTML comes out. That is what separates a schema from
 * decoration: decoration is what only runs when somebody remembers to call it.
 */
import bruto from './site.json'
import { esquemaSite, type Site } from './esquema'

export const site: Site = esquemaSite(bruto, 'site')
export type { Site }
// `Contato` and `Whatsapp` go out through here because whoever renders imports
// from THIS file, never from the schema: there is one door only. `Contato` is
// what makes the home's map charged as total; `Whatsapp` is the already-narrowed
// block `linkWhatsapp` demands — without it the button does not compile without
// handling the `null`.
export type { Contato, Whatsapp } from './esquema'
export { linkWhatsapp } from './esquema'

/**
 * THE PATH OF A FILE IN `public/`, WITH THE SITE'S FOLDER IN FRONT OF IT.
 *
 * A GitHub Pages project site lives in a folder — `user.github.io/repo` — and
 * `next.config.ts` derives its `basePath` from this same `urlBase`. What
 * READING THE BUILT `out/` shows is that the `basePath` does not reach
 * everywhere on its own:
 *
 *   · `og:image`, `canonical` and `link rel=manifest` — Next resolves these,
 *     they come out with the folder.
 *   · `next/image` with `images.unoptimized` — it does NOT. The `src` comes out
 *     raw, because the prefix is applied to the optimizer's URL
 *     (`/_next/image`), and `output: "export"` brings up no optimizer at all.
 *   · the JSON that `app/manifest.ts` emits — it does NOT. `start_url` and the
 *     icons come out raw, pointing at the ROOT of the domain, outside the site.
 *
 * The last two are a 404 on the published site with the build green the whole
 * way — the class of defect this project exists to make impossible. So: every
 * path to a file in `public/` goes through here, and `testes/publicado.mjs`
 * fails any absolute path in the export that does not start with the folder.
 *
 * For a site at the root of a domain the pathname is empty and this function
 * returns its argument unchanged — there is nothing to prefix, and nothing to
 * go wrong.
 */
export const naPasta = (caminho: string) =>
  `${new URL(site.meta.urlBase).pathname.replace(/\/$/, '')}${caminho}`
