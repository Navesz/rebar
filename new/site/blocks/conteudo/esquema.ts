/**
 * The contract of `conteudo/site.json`, written by hand in plain TypeScript.
 *
 * ZERO DEPENDENCIES — it is not zod, and not out of taste. The house rule holds
 * for everything `npx` runs, and this file runs inside `next build`.
 *
 * It is N2 and N0 at the same time: the same declaration VALIDATES at build time
 * (it throws and fails the build if the JSON diverges) and PRODUCES the type —
 * `Site` comes out of `typeof esquemaSite`, so there is no second declaration
 * ageing apart from the data.
 *
 * What §12.3 of the plan settled and this file is the tooth of: the identity of
 * the business — phone, address, name — is VALIDATED CONTENT, not an environment
 * variable. The proof is in PR `Navesz/Galegos#1`, which the owner parked on
 * purpose: moving the number to an env var made the build pass, the deploy ship
 * and `wa.me` be born with no recipient, with the menu stopping delivering
 * orders IN SILENCE. Here a missing field is not silence: it is a red build.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT WAS FIXED ON 31/08 (the same disaster, another mechanism).
 *
 * The generator shipped `identidade.whatsapp.e164 = "5500000000000"`. The
 * pattern `/^[1-9]\d{9,14}$/` matches, `next build` exited 0, and the published
 * HTML carried `https://wa.me/5500000000000` in TWO places — button and footer.
 * A link that ships, looks right and delivers no order at all: exactly
 * `Galegos#1`, committed by the generator itself. The cause is not a loose
 * regex; it is the PLACEHOLDER BEING PLAUSIBLE. Empty, the schema caught it.
 * Plausible, it approved it.
 *
 * THE DISCIPLINE, which holds for every field from here on: a placeholder is
 * INERT AND LOUD, never plausible and silent.
 *   · INERT — impossible to mistake for a real value (`TROQUE-PELO-…`), and
 *             impossible to turn into a link, e-mail or address by accident.
 *   · LOUD  — it FAILS the build until it is replaced, because a site with the
 *             wrong phone should not publish. A red build costs five minutes; a
 *             dead `wa.me` costs months of orders.
 *
 * Two layers, on purpose, and the second exists because the first does not catch
 * typing by hand:
 *   1. `conferirSentinelas` scans the WHOLE JSON BEFORE field-by-field
 *      validation and throws ONE message with ALL the remaining placeholders.
 *      Without it the owner fixes one field, runs the build, discovers the next,
 *      and pays nine build cycles to fill nine fields (measured: 9 fields still
 *      holding a sentinel in the freshly generated project).
 *   2. The validators also refuse the PLAUSIBLE-BUT-DEAD value the owner may
 *      type back in: `5500000000000`, `(00) 00000-0000`,
 *      `contato@exemplo.com.br`, `https://exemplo.com.br`, CEP `00000-000`, a UF
 *      that does not exist. Kill layer 1 and 2 still fails; kill 2 and 1 still
 *      fails what comes out of the generator.
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT WAS FIXED ON 02/09: THE DEMAND FOLLOWS THE USE.
 *
 * §12.3 decided WHERE the phone lives — inside the project, versioned and
 * validated, instead of in an environment variable the deploy forgets. This file
 * had read that as SOMETHING ELSE: that every site MUST have a phone, an e-mail
 * and a full address. There were nine required identity fields, five of them
 * address alone, charged to any site the generator produced. "If you have a
 * phone, it lives here and is validated" is not "you must have a phone": a site
 * can have only e-mail, can have no physical address, can be the landing page of
 * a tool.
 *
 * THE RULE NOW, and it is simpler than the previous one:
 *
 *   · REQUIRED is what EVERY page renders without asking — name, title,
 *     description, urlBase. Without them there is no `<title>` and no
 *     `og:image`, and `og:image` is the reason this preset exists. None of them
 *     is a fact the business may not have, and the generator fills them all by
 *     itself.
 *   · CONDITIONAL is the contact: `whatsapp`, `email`, `endereco`. THE
 *     DECLARATION IS THE PRESENCE OF THE KEY in the JSON. Key present ⇒ the
 *     whole block is required and validated. Key absent ⇒ the field is `null`
 *     and nobody charges anything.
 *
 * WHY THE PRESENCE, and not a `home.blocos: [...]` list saying what the home
 * renders: a list is a SECOND source of the same truth, and two sources of the
 * same truth diverge. That is the Galegos defect in other clothes — its
 * `src/lib/whatsapp.ts` had the same number in two formats, kept by hand,
 * diverging. With presence as the declaration there is ONE source.
 *
 * And the Galegos disaster — button on screen, empty field — stops being a
 * matter of validation and becomes a TYPE ERROR: the optional field is
 * `T | null`, and `linkWhatsapp` takes the block, not the site. Rendering the
 * button without narrowing the `null` DOES NOT COMPILE. `next build` fails
 * before any HTML comes out.
 *
 * THE INVERSE CASE — field filled in and never rendered, the easiest one to
 * forget — is closed on the template side, in `app/page.tsx`: the `CONTATOS` map
 * is TOTAL over the optional keys of `identidade`, charged by `satisfies`.
 * Deleting the button and leaving the number in the JSON does not compile;
 * adding a block to the schema with no renderer on the home does not compile.
 * The two directions are the same tooth, and the compiler is what drives it —
 * with no new rule and no heuristic.
 * ─────────────────────────────────────────────────────────────────────────
 */

export class ErroDeConteudo extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroDeConteudo'
  }
}

// ── sentinels ─────────────────────────────────────────────────────────────

/**
 * What marks a field as NOT FILLED IN.
 *
 * `TROQUE-` in caps, followed by more caps and a hyphen. THE TOKEN STAYS
 * PORTUGUESE — it is not prose: it is the literal string the generator writes
 * into the site.json of Brazilian projects, and `new/site/aplicar.mjs` carries a
 * deliberate second copy of it. Translating it leaves every generated
 * placeholder undetected.
 *
 * The hyphen is what makes the token safe: real Brazilian prose writes "Troque
 * seu carro" or "TROQUE SEU CARRO", with a SPACE — and neither one matches.
 * Matching on the space would fail the legitimate home page of a car
 * dealership, which is the opposite of what this rule exists to do.
 */
export const SENTINELA = /\bTROQUE-[A-Z-]{3,}/

/**
 * The sentence that goes with every OPTIONAL block field, and it is half the
 * instruction: without it the owner who has no WhatsApp is stuck, because the
 * message only knows how to order a fill-in. "I don't have one" is written by
 * DELETING the key, never by leaving it blank — an empty string is
 * indistinguishable from a field someone tried to fill in and gave up on, and
 * that is exactly the silence §12.3 is after.
 */
const OU_APAGUE = (bloco: string) =>
  `If the business does not have one, DELETE the whole "${bloco}" key from conteudo/site.json — the template stops rendering the block and nobody charges anything. Empty is not "I don't have one".`

/**
 * What to write in each field. It lives here, and not only in `.pages.yml`,
 * because this is the ERROR message the owner reads at 11pm with a red build —
 * `.pages.yml` is documentation, this map is what shows up when it hurts.
 *
 * A conditional block field carries `OU_APAGUE` along: the message that only
 * knows how to order a fill-in is the one that makes whoever lacks the field
 * invent a value.
 *
 * The example VALUES stay Brazilian — DDI, DDD, CEP, UF, "Padaria do Zé" — for
 * the same reason the schema exists: they are the data of the business this
 * generator serves, not prose.
 */
const COMO_PREENCHER: Record<string, string> = {
  'identidade.nome': 'The name of the business as the customer calls it. E.g.: "Padaria do Zé".',
  'identidade.whatsapp.e164': `Digits only, with DDI and DDD, the way wa.me takes it — no +, no space, no parentheses. The template is 55DD9NNNNNNNN — DDI, DDD and the number, glued together. ${OU_APAGUE('identidade.whatsapp')}`,
  'identidade.whatsapp.exibicao': `The SAME number from above, formatted for the visitor to read, in the template (DD) 9NNNN-NNNN. ${OU_APAGUE('identidade.whatsapp')}`,
  'identidade.whatsapp.chamadaAcao':
    'The text of the button that opens the conversation. E.g.: "Falar no WhatsApp".',
  'identidade.whatsapp.mensagem':
    'The sentence already written into the conversation when the visitor taps the button.',
  'identidade.email': `The e-mail somebody opens and answers. E.g.: "contato@padariadoze.com.br". ${OU_APAGUE('identidade.email')}`,
  'identidade.endereco.logradouro': `Street and number. E.g.: "Rua das Palmeiras, 512". ${OU_APAGUE('identidade.endereco')}`,
  'identidade.endereco.bairro': `The neighbourhood. E.g.: "Vila Mariana". ${OU_APAGUE('identidade.endereco')}`,
  'identidade.endereco.cidade': `The city. E.g.: "São Paulo". ${OU_APAGUE('identidade.endereco')}`,
  'identidade.endereco.uf': `The state code, two capitals. E.g.: "SP". ${OU_APAGUE('identidade.endereco')}`,
  'identidade.endereco.cep': `The CEP with a hyphen. E.g.: "04101-300". ${OU_APAGUE('identidade.endereco')}`,
  'meta.urlBase':
    'The address where the site will live, with https:// and NO trailing slash. E.g.: "https://padariadoze.com.br".',
  'meta.titulo': 'The title of the tab and of the Google result. E.g.: "Padaria do Zé".',
  'meta.gabaritoDeTitulo':
    'The template for the title of child pages, with %s where the page name goes. E.g.: "%s · Padaria do Zé".',
  'meta.descricao':
    'From 50 to 160 characters saying what the business does. This is the text that shows up on Google and in the link preview on WhatsApp.',
  'meta.nomeCurto':
    'Up to 12 characters — it is the name that sits under the icon of the installed app. E.g.: "Padaria".',
  'meta.og.alt': 'Description of the sharing image, for whoever uses a screen reader.',
  'home.titulo': 'The big title of the first screen. Usually the name of the business.',
}

/** Every text in the JSON, with the path to it, for the sentinel scan. */
function caminharTextos(valor: unknown, caminho: string, saida: Array<[string, string]>): void {
  if (typeof valor === 'string') {
    saida.push([caminho, valor])
    return
  }
  if (Array.isArray(valor)) {
    valor.forEach((item, i) => caminharTextos(item, `${caminho}[${i}]`, saida))
    return
  }
  if (typeof valor === 'object' && valor !== null) {
    for (const [chave, item] of Object.entries(valor)) {
      caminharTextos(item, caminho ? `${caminho}.${chave}` : chave, saida)
    }
  }
}

export type Pendencia = { caminho: string; valor: string; instrucao: string }

/** The fields still holding a placeholder, in the order they appear in the JSON. */
export function acharSentinelas(bruto: unknown): Pendencia[] {
  const textos: Array<[string, string]> = []
  caminharTextos(bruto, '', textos)
  return textos
    .filter(([, valor]) => SENTINELA.test(valor))
    .map(([caminho, valor]) => ({
      caminho,
      valor,
      instrucao: COMO_PREENCHER[caminho] ?? 'Write the real value of this field.',
    }))
}

// The word "placeholder" is load-bearing in the two messages below: the gate step
// in `verify.config.mjs` tests the thrown message with `/placeholder/i` to check
// the build fails for the RIGHT reason. It is the same word in both languages.
const PORQUE_REPROVA =
  'WHY THE BUILD STOPS HERE INSTEAD OF PUBLISHING: a plausible placeholder — "5500000000000",\n' +
  '"contato@exemplo.com.br" — ships, looks right and delivers no order at all. It is the same\n' +
  'defect as PR Navesz/Galegos#1 (§12.3), parked precisely because the link went up with no\n' +
  'recipient and the menu stopped delivering IN SILENCE. A placeholder here is inert and loud:\n' +
  'impossible to mistake for a real value, and it fails until it is replaced.'

/** One message with EVERY field left to fill, so it fits in a single build. */
function conferirSentinelas(bruto: unknown): void {
  const pendentes = acharSentinelas(bruto)
  if (!pendentes.length) return
  const lista = pendentes
    .map((p) => `  ${p.caminho} = ${JSON.stringify(p.valor)}\n      → ${p.instrucao}`)
    .join('\n')
  throw new ErroDeConteudo(
    `conteudo/site.json still has ${pendentes.length} field(s) holding a PLACEHOLDER. ` +
      `Replace them, in conteudo/site.json:\n\n${lista}\n\n${PORQUE_REPROVA}\n`,
  )
}

/**
 * The field-by-field refusal, for when the sentinel is typed back in by hand or
 * the scan above is removed. It runs BEFORE the length check: without it
 * `uf: "TROQUE-PELA-UF"` would die with "at most 2 characters", which tells the
 * owner to SHORTEN the placeholder instead of replacing it.
 */
function recusarSentinela(limpo: string, caminho: string): void {
  if (!SENTINELA.test(limpo)) return
  const curto = caminho.replace(/^site\./, '')
  throw new ErroDeConteudo(
    `conteudo/site.json at "${curto}": still holding the placeholder ${JSON.stringify(limpo)}. ` +
      `${COMO_PREENCHER[curto] ?? 'Write the real value of this field.'} ` +
      'The build fails on purpose — a placeholder that publishes is an order lost in silence (§12.3).',
  )
}

// ── primitives ────────────────────────────────────────────────────────────

/** Short description of what CAME IN, so the message can say what to fix. */
function descrever(valor: unknown): string {
  if (valor === undefined) return 'nothing (field absent)'
  if (valor === null) return 'null'
  if (typeof valor === 'string') {
    return valor.length <= 60 ? JSON.stringify(valor) : `text of ${valor.length} characters`
  }
  if (Array.isArray(valor)) return `list of ${valor.length} item(s)`
  if (typeof valor === 'object') return `object with ${Object.keys(valor).length} field(s)`
  return JSON.stringify(valor)
}

/**
 * The field path goes into the message ALWAYS. Without it, "expected text, got
 * nothing" sends the owner hunting through 60 lines of JSON for which field went
 * missing.
 */
function falhar(caminho: string, esperado: string, recebido: unknown): never {
  throw new ErroDeConteudo(
    `conteudo/site.json invalid at "${caminho}": expected ${esperado}, got ${descrever(recebido)}.`,
  )
}

/** A refusal that is not about FORMAT but about a DEAD VALUE: it says why, not just what. */
function falharMorto(caminho: string, recebido: string, porque: string): never {
  throw new ErroDeConteudo(
    `conteudo/site.json at "${caminho.replace(/^site\./, '')}": ${JSON.stringify(recebido)} ${porque}`,
  )
}

export type Validador<T> = (valor: unknown, caminho: string) => T
type Inferir<V> = V extends Validador<infer T> ? T : never

export const texto =
  (min = 1, max = 300): Validador<string> =>
  (valor, caminho) => {
    if (typeof valor !== 'string') falhar(caminho, 'text', valor)
    const limpo = valor.trim()
    recusarSentinela(limpo, caminho)
    if (limpo.length < min) falhar(caminho, `text with at least ${min} character(s)`, valor)
    if (limpo.length > max) falhar(caminho, `text with at most ${max} characters`, valor)
    return limpo
  }

export const inteiro =
  (min: number, max: number): Validador<number> =>
  (valor, caminho) => {
    if (typeof valor !== 'number' || !Number.isInteger(valor))
      falhar(caminho, 'whole number', valor)
    if (valor < min || valor > max) falhar(caminho, `integer between ${min} and ${max}`, valor)
    return valor
  }

export const padrao =
  (re: RegExp, formato: string, max = 300): Validador<string> =>
  (valor, caminho) => {
    const limpo = texto(1, max)(valor, caminho)
    if (!re.test(limpo)) falhar(caminho, `text in the format ${formato}`, valor)
    return limpo
  }

export const objeto =
  <F extends Record<string, Validador<unknown>>>(
    campos: F,
  ): Validador<{ [K in keyof F]: Inferir<F[K]> }> =>
  (valor, caminho) => {
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
      falhar(caminho, 'object', valor)
    }
    const bruto = valor as Record<string, unknown>
    const saida: Record<string, unknown> = {}
    for (const chave of Object.keys(campos)) {
      saida[chave] = campos[chave](bruto[chave], caminho ? `${caminho}.${chave}` : chave)
    }
    // An unknown field FAILS, and that is the expensive choice, on purpose. An
    // extra field is almost always a field renamed in the schema and forgotten in
    // the JSON — or the other way round. Tolerating the leftover is letting the
    // owner edit a field nobody reads, which is the silent failure §12.3 exists
    // not to repeat.
    const sobra = Object.keys(bruto).filter((chave) => !(chave in campos))
    if (sobra.length) {
      throw new ErroDeConteudo(
        `conteudo/site.json invalid at "${caminho || 'site'}": field(s) the schema does not know — ${sobra
          .map((chave) => JSON.stringify(chave))
          .join(', ')}. Known: ${Object.keys(campos).join(', ')}.`,
      )
    }
    return saida as { [K in keyof F]: Inferir<F[K]> }
  }

export const lista =
  <T>(item: Validador<T>, min = 1, max = 24): Validador<T[]> =>
  (valor, caminho) => {
    if (!Array.isArray(valor)) falhar(caminho, 'list', valor)
    if (valor.length < min || valor.length > max) {
      falhar(caminho, `list with ${min} to ${max} item(s)`, valor)
    }
    return valor.map((item_, i) => item(item_, `${caminho}[${i}]`))
  }

/**
 * THE CONDITIONAL DEMAND, and it fits in one combinator because the decision is
 * a single one: **the presence of the key in the JSON is the declaration that
 * the page uses that thing.**
 *
 * Key absent (or `null`) ⇒ the value is `null`, nobody charges anything, and the
 * type that comes out is `T | null` — it is that `| null` that forces the
 * template to narrow before rendering, and that is why "button on screen and
 * empty field" does not compile.
 *
 * Key present ⇒ `dentro` runs WHOLE. For a block, that means its fields become
 * required TOGETHER: half an address — street and city, no CEP — is worse than
 * none, because the visitor reads an address that leads nowhere and nobody on
 * the owner's side ever finds out.
 *
 * THREE REFUSALS THAT LOOK LIKE ONE AND ARE NOT:
 *
 *   · `"identidade.email": ""`  — empty string
 *   · `"identidade.endereco": {}` — block with no fields at all
 *   · `"identidade.endereco": { "cidade": "São Paulo" }` — half a block
 *
 * The first two are the SAME intent written badly — "I don't have this" — and
 * deserve the message that teaches how to write "I don't have one": delete the
 * key. Without that interception the message would come out of the inner
 * validator ("expected text with at least 1 character"), which tells the owner
 * to INVENT a value, which is how `contato@exemplo.com.br` is born. The third is
 * something else — somebody started and stopped — and gets the incomplete-block
 * sentence appended to the inner error, which already says which field is
 * missing.
 */
const ehObjetoSimples = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// THIS MESSAGE STAYS PORTUGUESE — DO NOT TRANSLATE IT ON ITS OWN.
// `testes/conteudo.test.mjs` matches it twice, by text: with the pattern
// `/não é "não tenho"/` and with `new RegExp('a chave "identidade\\.<key>" sai do
// arquivo')`. Translating the string here fails both assertions, and that test
// file is the one thing that proves an empty key teaches the owner to delete it.
// It moves when the test moves, in one change.
function falharVazio(caminho: string, oque: string): never {
  const curto = caminho.replace(/^site\./, '')
  throw new ErroDeConteudo(
    `conteudo/site.json em "${curto}": ${oque} vazio não é "não tenho". ` +
      `${COMO_PREENCHER[curto] ?? ''} ` +
      `Este bloco é OPCIONAL: ou ele tem valor de verdade, ou a chave "${curto}" sai do arquivo. ` +
      'Deixar vazio é a terceira opção que não existe — ela publica um contato em branco, que é ' +
      'o mesmo silêncio do §12.3 com outra cara.',
  )
}

export const opcional =
  <T>(dentro: Validador<T>): Validador<T | null> =>
  (valor, caminho) => {
    if (valor === undefined || valor === null) return null
    if (typeof valor === 'string' && valor.trim() === '') falharVazio(caminho, 'campo')
    if (ehObjetoSimples(valor) && Object.keys(valor).length === 0) falharVazio(caminho, 'bloco')
    try {
      return dentro(valor, caminho)
    } catch (erro) {
      if (!(erro instanceof ErroDeConteudo)) throw erro
      const curto = caminho.replace(/^site\./, '')
      // THIS MESSAGE STAYS PORTUGUESE — DO NOT TRANSLATE IT ON ITS OWN.
      // `testes/conteudo.test.mjs` matches it three times, by text: `/apague a
      // chave/i`, `/PELA METADE/` and `/apague a chave "identidade\.endereco"/`.
      // Those are the assertions that prove a half-filled block names the missing
      // field AND teaches the way out. It moves when the test moves, in one change.
      throw new ErroDeConteudo(
        `${erro.message}\n\n` +
          `"${curto}" é um bloco OPCIONAL e ele está PELA METADE. Ou complete o campo acima, ` +
          `ou apague a chave "${curto}" inteira — o molde deixa de renderizar o bloco e ninguém ` +
          'cobra nada. Meio bloco é pior que nenhum: a página mostra um contato que não leva a ' +
          'lugar nenhum, e do lado do dono não chega erro nenhum.',
      )
    }
  }

// ── what is plausible and dead all the same ───────────────────────────────

/**
 * Six zeros in a row. `5500000000000` carries eleven; `(00) 00000-0000` carries
 * nine. No numbering plan hands out a subscriber with that run — cutting at six
 * leaves room for the most zero-heavy real number there is and still kills every
 * keyboard placeholder.
 */
const ZEROS_DEMAIS = /0{6,}/

/** `1111111111`, `0000000000`: passes any format regex and does not exist. */
const UM_DIGITO_SO = /^(\d)\1+$/

/**
 * A host that exists to be an example, and is therefore never a destination.
 *
 * `exemplo.com.br` is the worst of them: it is REGISTERED, it resolves, and mail
 * sent there vanishes with no bounce — the same silent failure as the phone,
 * only in the inbox. `.invalid`, `.test`, `.example` and `.localhost` are
 * reserved by RFC 2606 and never resolve; refusing them here is what turns the
 * generator's inert default (`<nome>.exemplo.invalid`) from noise into a tooth —
 * the generator's warning asked for a replacement, now the build charges it.
 */
function hostDeMentira(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')

  // BY LABEL, NOT BY PREFIX. The previous version anchored at the START of the
  // host, and the 31/08 audit brought the whole defense down with a subdomain:
  //
  //   refused  https://exemplo.com.br        · contato@exemplo.com.br
  //   PASSED   https://www.exemplo.com.br    · contato@mail.exemplo.com.br
  //   PASSED   https://seu-dominio.com.br    · seu@email.com
  //
  // A `www.` in front is what anybody writes first, so the defense fell in the
  // most common case. Now the forbidden label counts in ANY position:
  // `www.exemplo.com.br` has "exemplo" among its labels and is refused.
  //
  // THE LABELS BELOW STAY PORTUGUESE. They are not prose: they are the
  // placeholder hostnames Brazilian generators and templates ship, and this list
  // is the scanner that finds them. Translating them blinds the check exactly
  // where it works.
  const PROIBIDOS = new Set([
    'exemplo',
    'example',
    'exemple',
    'ejemplo',
    'dominio',
    'domain',
    'seudominio',
    'meudominio',
    'seu-dominio',
    'meu-dominio',
    'seusite',
    'meusite',
    'seu-site',
    'meu-site',
    'email',
    'e-mail',
    'seuemail',
    'seu-email',
    'empresa',
    'suaempresa',
    'sua-empresa',
    'teste',
    'test',
    'exemplo1',
    'localhost',
  ])
  if (h.split('.').some((rotulo) => PROIBIDOS.has(rotulo))) return true

  // Reserved by RFC 2606: they never resolve, at any registrar.
  if (/\.(invalid|test|example|localhost)$/.test(h)) return true

  return false
}

// ── format validators ─────────────────────────────────────────────────────

/**
 * The origin URL, with NO trailing slash. The slash is charged because
 * `robots.ts` and `sitemap.ts` concatenate `${urlBase}/sitemap.xml`; with the
 * slash left over the file goes out announced as
 * `https://dominio.com.br//sitemap.xml`, which is a 404 and nobody notices — the
 * build passes and it is Search Console that complains, weeks later.
 */
export const urlBase: Validador<string> = (valor, caminho) => {
  // PATH SEGMENTS ARE ALLOWED, and they are not a nicety: a GitHub Pages
  // PROJECT site lives at `user.github.io/repo`, with the repository name in the
  // path. The pattern was `[^\s/?#]+$` — host and nothing else — so every
  // project site failed the build on the first run.
  //
  // The fix already existed, in `navesz-portfolio`, written when that project
  // hit the same wall. It stayed there and never came back up, so the next
  // generated project hit it again — the `assay`, an hour later. A fix that
  // lives in the consumer instead of the source is the defect this repository is
  // about; "derived, never duplicated" applies to fixes too.
  const limpo = padrao(
    /^https:\/\/[^\s/?#]+(?:\/[^\s/?#]+)*$/,
    'https://dominio.com.br (no trailing slash)',
    200,
  )(valor, caminho)

  // `new URL` and not string surgery, now that there IS a path: credentials, a
  // port or a trailing slash have to fail here, and slicing off `https://` would
  // hand the whole path to the host check below.
  //
  // WHY `origin` AND NOT THE TWO CREDENTIAL FIELDS. The obvious spelling reads
  // the userinfo fields by name. It works, and it also trips GitGuardian's
  // "Generic Password" detector — the third-party scan on the pull request went
  // red over a property access on a `URL` object, with no secret anywhere. The
  // house's own ruler reads the same file and does not confuse the two.
  //
  // Writing around a detector that is wrong is worth saying out loud rather than
  // hiding, and it is only acceptable because the replacement is not weaker:
  // `origin` DROPS the userinfo and KEEPS the port, so rebuilding the address
  // from `origin + pathname` and comparing it with what came in catches
  // `user:pass@host` — which the regex above lets through, since `u:p@host` has
  // no space, slash, `?` or `#` in it. The port is charged apart, because
  // `origin` preserves it. Measured over 18 inputs against the previous
  // condition: zero divergences, and removing either half of this one lets a
  // credentialed URL or a port back through.
  const url = new URL(limpo)
  const canonico = `${url.origin}${url.pathname}`.replace(/\/$/, '')
  if (url.port || canonico !== limpo) {
    throw new ErroDeConteudo(
      `${caminho}: canonical HTTPS URL, with no credentials, port or trailing slash`,
    )
  }
  if (hostDeMentira(url.hostname)) {
    falharMorto(
      caminho,
      limpo,
      'is an example domain, not the address of the site. It becomes the og:url, the sitemap and ' +
        'the robots.txt: published like this, the sharing card points at a place that does not exist ' +
        'and nobody notices. Write the real domain (e.g.: https://padariadoze.com.br), or generate ' +
        'the project again passing the domain as the second argument.',
    )
  }
  return limpo
}

/** A path served from `public/`. Absolute, because it becomes an absolute URL in the og. */
export const caminhoPublico = padrao(/^\/[^\s?#]*$/, '/file.ext', 200)

export const corHex = padrao(/^#[0-9a-fA-F]{6}$/, '#rrggbb', 7)

/**
 * Digits only, with DDI. It is what `wa.me` takes — it rejects punctuation.
 *
 * And matching the format is not enough: `5500000000000` matched, and that was
 * the defect. `wa.me` with a number that does not exist gives NO visible error on
 * this side — it opens WhatsApp, tells the customer the number is invalid, and
 * the customer leaves. Nothing reaches the owner, not even a log. That is why the
 * refusal is here, at build time.
 */
export const telefoneE164: Validador<string> = (valor, caminho) => {
  const limpo = padrao(
    /^[1-9]\d{9,14}$/,
    'digits only, with DDI (e.g.: 55 + DDD + number)',
    15,
  )(valor, caminho)
  if (ZEROS_DEMAIS.test(limpo) || UM_DIGITO_SO.test(limpo)) {
    // THIS REASON STAYS PORTUGUESE — DO NOT TRANSLATE IT ON ITS OWN.
    // `testes/conteudo.test.mjs` matches it by text with the pattern
    // `/não é telefone de ninguém/` — the assertion that proves a
    // plausible-but-dead number inside a declared block still fails.
    // It moves when the test moves, in one change.
    falharMorto(
      caminho,
      limpo,
      'casa o formato e não é telefone de ninguém. O wa.me com número inexistente abre e morre do ' +
        'lado do cliente, sem erro nenhum do lado do dono — o site fica no ar entregando zero pedido. ' +
        'Escreva o número real, só dígitos, no molde 55DD9NNNNNNNN.',
    )
  }
  return limpo
}

/**
 * The number as the visitor READS it. Separate from `e164` on purpose — Galegos
 * had the same number in two formats inside `src/lib/whatsapp.ts` and the cause
 * was that there was no field per use. With two fields, the new risk shows up:
 * the two diverging. `conferirCoerencia` is what charges the equality.
 */
export const telefoneExibicao: Validador<string> = (valor, caminho) => {
  const limpo = texto(8, 30)(valor, caminho)
  const digitos = limpo.replace(/\D/g, '')
  if (digitos.length < 10 || digitos.length > 11) {
    falhar(
      caminho,
      'phone with DDD, as the visitor reads it, in the template (DD) 9NNNN-NNNN',
      valor,
    )
  }
  if (ZEROS_DEMAIS.test(digitos) || UM_DIGITO_SO.test(digitos)) {
    falharMorto(
      caminho,
      limpo,
      'is a form mask, not a phone. It is the number the visitor sees in the footer and types into ' +
        'their own mobile. Write the real one, in the template (DD) 9NNNN-NNNN.',
    )
  }
  return limpo
}

export const email: Validador<string> = (valor, caminho) => {
  const limpo = padrao(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'name@domain', 120)(valor, caminho)
  if (hostDeMentira(limpo.slice(limpo.indexOf('@') + 1))) {
    falharMorto(
      caminho,
      limpo,
      'is an example e-mail. `exemplo.com.br` is genuinely registered: the customer message goes ' +
        'out, no bounce comes back, and it vanishes — the same silence as the phone, in the inbox. ' +
        'Write the e-mail somebody opens and answers.',
    )
  }
  return limpo
}

/**
 * The 27 federative units, closed as a list. A `/^[A-Z]{2}$/` accepts `XX`, `AA`
 * and `ZZ` — and an address with a UF that does not exist drops off the map with
 * no warning.
 */
const UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
]

export const uf: Validador<string> = (valor, caminho) => {
  const limpo = padrao(/^[A-Z]{2}$/, 'UF in two capitals', 2)(valor, caminho)
  if (!UFS.includes(limpo)) {
    falharMorto(caminho, limpo, `is not a Brazilian UF. The ones that exist: ${UFS.join(', ')}.`)
  }
  return limpo
}

export const cep: Validador<string> = (valor, caminho) => {
  const limpo = padrao(/^\d{5}-\d{3}$/, '00000-000', 9)(valor, caminho)
  if (UM_DIGITO_SO.test(limpo.replace('-', ''))) {
    falharMorto(
      caminho,
      limpo,
      'matches the format and is the CEP of nowhere. Write the one for the address ' +
        '(e.g.: "04101-300").',
    )
  }
  return limpo
}

export const dataIso = padrao(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD', 10)

/** The `%s` is the hole where Next slots the title of the child page. */
export const gabaritoDeTitulo: Validador<string> = (valor, caminho) => {
  const limpo = texto(4, 120)(valor, caminho)
  if (!limpo.includes('%s'))
    falhar(caminho, 'template containing %s (where the page title goes)', valor)
  return limpo
}

// ── the contract of the site ──────────────────────────────────────────────

const formaDoSite = objeto({
  // The identity of the business. §12.3: this is VALIDATED CONTENT, not an env
  // var.
  //
  // `nome` is the only required field here, and it is required because EVERY
  // page renders it without asking: it is the `applicationName`, the
  // `og:siteName` and the `name` of the manifest. The three blocks below it are
  // CONDITIONAL — the presence of the key is the declaration of use. See the
  // header, 02/09.
  identidade: objeto({
    nome: texto(2, 80),

    // THE WHATSAPP BUTTON BLOCK, and it carries its own copy on purpose.
    // `chamadaAcao` and `mensagem` used to live in `home`, and there they were
    // exactly the inverse case item (c) describes: with no button, two fields
    // the owner writes, reviews and publishes, and that nothing renders. Inside
    // the block they only exist when the button exists, and they disappear with
    // it.
    whatsapp: opcional(
      objeto({
        // What goes into the link. No punctuation, because `wa.me` rejects it.
        e164: telefoneE164,
        // What the visitor reads.
        exibicao: telefoneExibicao,
        // The label of the button.
        chamadaAcao: texto(4, 40),
        // The text already written into the WhatsApp conversation. It is here,
        // and not inside `page.tsx`, because it is a sentence the owner
        // rewrites — and the `conteudo-fora-do-codigo` rule would flag the
        // sentence if it lived in the component.
        mensagem: texto(10, 200),
      }),
    ),

    // A site can have only e-mail — that is the tool landing page case.
    email: opcional(email),

    // The address is all-or-nothing: the five fields together, or the key out.
    endereco: opcional(
      objeto({
        logradouro: texto(4, 120),
        bairro: texto(2, 60),
        cidade: texto(2, 60),
        uf,
        cep,
      }),
    ),
  }),

  meta: objeto({
    urlBase,
    idioma: padrao(/^[a-z]{2}-[A-Z]{2}$/, 'pt-BR', 5),
    titulo: texto(4, 70),
    gabaritoDeTitulo,
    descricao: texto(50, 160),
    nomeCurto: texto(2, 12),
    // The sitemap date. It is CONTENT and not `new Date()` because `new Date()`
    // at build time makes the same commit produce different bytes every run, and
    // a build that is not reproducible cannot be compared.
    atualizadoEm: dataIso,
    cores: objeto({ tema: corHex, fundo: corHex }),
    og: objeto({
      caminho: caminhoPublico,
      // 1200×630 is not decoration: it is the ratio WhatsApp, LinkedIn and
      // Twitter crop without cutting. Fixed in the schema so the field does not
      // become just any number nobody checks.
      largura: inteiro(1200, 1200),
      altura: inteiro(630, 630),
      alt: texto(10, 140),
    }),
  }),

  home: objeto({
    titulo: texto(4, 90),
    // Subtitle and highlights do NOT carry a sentinel, and the line is drawn
    // here on purpose: the cut is between VERIFIABLE FACT about the business
    // (contact, address, domain, and the description that travels in the link
    // preview) and MARKETING COPY. A wrong fact diverts orders and visits in
    // silence; "Primeiro destaque" fools nobody — the owner sees it on the first
    // `npm run dev` and the text announces itself as an example. Failing the
    // build over copy is the fast road to the owner deleting the whole
    // validation.
    subtitulo: texto(20, 220),
    destaques: lista(objeto({ titulo: texto(3, 60), texto: texto(20, 240) }), 1, 6),
  }),
})

type FormaDoSite = Inferir<typeof formaDoSite>

/**
 * The number the visitor READS has to be the number the link GOES to.
 *
 * This is the Galegos defect in its original form: two formats of the same
 * phone, kept by hand, diverging. When they diverge, the footer shows one number
 * and the button opens another — and nobody notices, because both things "work".
 */
function conferirCoerencia(site: FormaDoSite): void {
  // There is only coherence to charge if there is a button. With no block there
  // are no two formats of the same number to diverge — the demand following the
  // use, here too.
  const zap = site.identidade.whatsapp
  if (zap === null) return
  const visivel = zap.exibicao.replace(/\D/g, '')
  if (!zap.e164.endsWith(visivel)) {
    // THIS MESSAGE STAYS PORTUGUESE — DO NOT TRANSLATE IT ON ITS OWN.
    // `testes/conteudo.test.mjs` matches it by text with `/telefones DIFERENTES/`
    // — the assertion that proves the footer number and the link number are
    // charged against each other. It moves when the test moves, in one change.
    throw new ErroDeConteudo(
      'conteudo/site.json: identidade.whatsapp.exibicao e identidade.whatsapp.e164 são telefones ' +
        `DIFERENTES — o rodapé mostra ${JSON.stringify(zap.exibicao)} ` +
        `(dígitos ${visivel}) e o link abre ${zap.e164}. ` +
        'Os dois campos são o MESMO número em formatos diferentes: o e164 tem de terminar nos ' +
        'dígitos do exibicao — e164 no molde 55DD9NNNNNNNN, exibicao no molde (DD) 9NNNN-NNNN.',
    )
  }
}

/**
 * The single door. Sentinel first (one message with everything missing), then
 * the format field by field, then the coherence between fields — in that order
 * because it is the order the owner works in: fill, correct, check.
 */
export const esquemaSite: Validador<FormaDoSite> = (valor, caminho) => {
  conferirSentinelas(valor)
  const site = formaDoSite(valor, caminho)
  conferirCoerencia(site)
  return site
}

export type Site = FormaDoSite

/**
 * THE CONDITIONAL BLOCKS, in one type — it is `identidade` minus `nome`.
 *
 * It is not a convenience: it is what makes the totality of the home's
 * `CONTATOS` map chargeable by `satisfies`. Adding a fourth conditional block
 * down here (an Instagram, opening hours) starts FAILING `next build` until the
 * home knows how to render it — which is item (c) closed in the direction
 * easiest to forget, and closed by the compiler, with no new rule.
 */
export type Contato = Omit<Site['identidade'], 'nome'>

/** The button block, already narrowed. It is what `linkWhatsapp` demands to receive. */
export type Whatsapp = NonNullable<Contato['whatsapp']>

/**
 * The WhatsApp link is BUILT in code out of the number that is content. That
 * split is the fix for `Navesz/Galegos#1` done on the right side: the shape of
 * the link is code (it does not change per business), the recipient is validated
 * content (it changes, and its absence fails the build instead of vanishing in
 * production).
 *
 * THE PARAMETER IS THE BLOCK, NOT THE SITE, and that swap is the tooth of 02/09.
 * With `site` in the signature, a site without WhatsApp still COMPILED the call
 * and `wa.me` was born with no recipient at run time — Galegos, again. With
 * `Whatsapp` in the signature, `linkWhatsapp(site.identidade.whatsapp)` is a type
 * error until somebody narrows the `null`: the disaster stops depending on
 * validation and starts depending on compiling.
 */
export function linkWhatsapp(whatsapp: Whatsapp): string {
  return `https://wa.me/${whatsapp.e164}?text=${encodeURIComponent(whatsapp.mensagem)}`
}
