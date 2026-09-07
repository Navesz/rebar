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
