#!/usr/bin/env node
/**
 * THE SITE LAYER of the generator: applies the blocks on top of the shadcn
 * scaffold.
 *
 * The scaffold comes from
 *   npx shadcn@latest create -t next -b base -p nova --pointer -n <nome> -y
 * and delivers Next 16 App Router, React 19, Tailwind 4 and `@base-ui/react`
 * with ZERO Radix. What it does NOT deliver is what makes that thing a site:
 * metadata that survives without JavaScript, content outside the code, and
 * `output: "export"`. That is what this module puts in.
 *
 * ZERO DEPENDENCY: Node built-ins only. `node:fs`, `node:path`, `node:url` and,
 * in `og.mjs`, `node:zlib`.
 *
 * WINDOWS AND LINUX: every path goes through `path.join`. No `find`, no `xargs`
 * and no `cp -r`, and no `execFileSync` — this module calls no process at all.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cartaoOg, icone } from './og.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const BLOCOS = join(AQUI, 'blocks')

/** Today's date in YYYY-MM-DD, no timezone: it is what the schema's `dataIso` takes. */
function hojeIso(agora = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`
}

/**
 * `nomeCurto` has a 12-character ceiling in the schema because it is the name
 * the operating system shows under the installed app's icon. Cutting here, with
 * the same ceiling, avoids generating a project that is born failing its own
 * schema — which would be the worst first impression possible.
 */
function encurtar(nome) {
  const primeira = nome.trim().split(/\s+/)[0]
  return (primeira.length >= 2 ? primeira : nome.trim()).slice(0, 12)
}

/**
 * The same token as `conteudo/esquema.ts`, and the duplication is DELIBERATE:
 * that file is TypeScript compiled by Next inside the generated project, this
 * one is `.mjs` running on the generator's Node, and there is no honest import
 * between the two without inventing a build step just for the generator. Two
 * identical lines of regex cost less than that — and if they diverge, the worst
 * that happens is the generator announcing too little: what fails the build is
 * the schema, always.
 *
 * THE TOKEN STAYS PORTUGUESE: `TROQUE-` is the literal text written into
 * `conteudo/site.json`, and the twin regex in `esquema.ts` matches the same
 * text. It moves in both files at once, or it stops matching.
 */
const SENTINELA = /\bTROQUE-[A-Z-]{3,}/

/** Every text in the JSON, with the path down to it. */
function caminharTextos(valor, caminho, saida) {
  if (typeof valor === 'string') {
    saida.push([caminho, valor])
    return
  }
  if (Array.isArray(valor)) {
    valor.forEach((item, i) => caminharTextos(item, `${caminho}[${i}]`, saida))
    return
  }
  if (valor && typeof valor === 'object') {
    for (const [chave, item] of Object.entries(valor)) {
      caminharTextos(item, caminho ? `${caminho}.${chave}` : chave, saida)
    }
  }
}

/**
 * The fields that came out with a placeholder — that is, the debt this preset
 * has just created and that only the owner can pay.
 */
export function pendencias(conteudo) {
  const textos = []
  caminharTextos(conteudo, '', textos)
  return textos.filter(([, valor]) => SENTINELA.test(valor))
}

/**
 * The pending fields of an ALREADY GENERATED project, read from disk.
 *
 * It exists so `new/index.mjs` can turn the debt into a WARNING and, through
 * that, into an exit code — today it exits 0 saying "project complete" while
 * nine fields wait for the owner's hand, and 0 is the lie that makes the rest
 * of the scoreboard worth nothing. `index.mjs` belongs to another front and was
 * not touched; the call missing there is one line:
 *
 *   const pendentes = pendenciasDoProjeto(destino)
 *   if (pendentes.length) avisosSite.push(`${pendentes.length} campo(s) de ...`)
 *
 * and the exit goes to 1 with the sentence it already has written: "the ruler
 * passed, but there is a warning above that needs a hand". That is the right
 * semantics — generated, not failed.
 */
export function pendenciasDoProjeto(destino) {
  return pendencias(JSON.parse(readFileSync(join(destino, 'conteudo', 'site.json'), 'utf8')))
}

/**
 * The warning the generator puts in the owner's face.
 *
 * WHY THE PRESET SPEAKS FOR ITSELF, instead of handing the list back for
 * `index.mjs` to print along with the rest: the one who creates the debt is
 * this module, at the moment it writes the `site.json`, and announcing it at
 * that same instant does not depend on any caller remembering to ask.
 * `index.mjs` stays the owner of the scoreboard and of the exit code; this
 * block is what guarantees the debt is SEEN even when the preset is called on
 * its own (`node new/site/aplicar.mjs ...`), which is how its development
 * happens.
 *
 * And the tone is what matters: the project did NOT fail, it came out whole.
 * What is missing is business fact, which the generator does not have and must
 * not invent.
 */
function anunciarPendencias(pendentes) {
  if (!pendentes.length) return
  const risca = '─'.repeat(66)
  // Seven-space indent to line up with the body of `index.mjs`'s steps. An
  // empty line comes out actually empty — an indent on a blank line is trailing
  // whitespace, and the generated project's `.editorconfig` forbids it.
  const eco = (linha = '') => console.log(linha ? `       ${linha}` : '')
  eco(risca)
  eco(`NEEDS A HAND — ${pendentes.length} field(s) of conteudo/site.json came out`)
  eco('with a PLACEHOLDER, and the `npm run build` of THIS project FAILS until')
  eco('you swap them. It is on purpose, and it is why rebar exists: a phone')
  eco('that is plausible-yet-false ships, looks right and stops delivering')
  eco('orders in SILENCE (§12.3 / Navesz/Galegos#1).')
  eco()
  for (const [caminho, valor] of pendentes) eco(`  ${caminho} = ${JSON.stringify(valor)}`)
  eco()
  eco('Open conteudo/site.json and write the real values. The build says the')
  eco('format each one requires, all of them at once, in a single message.')
  eco()
  // THE OTHER WAY OUT, and it is HALF the instruction. The generator does not
  // know whether this business has WhatsApp, e-mail or an address — so it emits
  // the three blocks with a placeholder and says how to say "I do not have it".
  // Without this line the owner knows one way out only, filling it in, and
  // whoever does not have the field invents a value to get the build green —
  // which is exactly how `contato@exemplo.com.br` is born.
  eco('MISSING ONE OF THEM? DELETE THE WHOLE KEY, instead of filling it in:')
  eco('  · no WhatsApp → delete "identidade.whatsapp" (the button goes too)')
  eco('  · no e-mail   → delete "identidade.email"')
  eco('  · no address  → delete "identidade.endereco" (the 5 fields, together)')
  eco('A site can have only e-mail, or an address and no phone. What it can')
  eco('NOT have is a field left blank: blank publishes an empty contact.')
  eco(risca)
}

/**
 * Fills `conteudo/site.json` with what the generator KNOWS — name, domain, date.
 *
 * What it does NOT KNOW gets a sentinel, and never a plausible value. This is
 * where `"5500000000000"` came from: it matched the schema's
 * `/^[1-9]\d{9,14}$/`, the build exited 0, and the published HTML carried
 * `https://wa.me/5500000000000` in two places — button and footer. The
 * generator reproducing, on its own, the defect the whole project exists to
 * prevent.
 *
 * The rule now: a placeholder is INERT AND LOUD. `TROQUE-PELO-NUMERO-COM-DDI`
 * does not turn into a link by accident, and `conteudo/esquema.ts` fails the
 * build while it is still there.
 *
 * THE THREE CONTACT BLOCKS COME OUT DECLARED, and that is a choice, not
 * carelessness. Since 02/09 `whatsapp`, `email` and `endereco` are conditional:
 * the presence of the key is the declaration that the home renders that. The
 * generator does not know which of them this business has, and the two ways out
 * err to different sides — emitting everything makes the owner DELETE what he
 * does not use, emitting nothing makes the site be born with no contact at all
 * and nobody warning about it. Emitting with a placeholder is the only one of
 * the two that FAILS the build while the decision has not been taken, so it is
 * the one; the `anunciarPendencias` block teaches both ways out, filling in and
 * deleting.
 */
export function montarConteudo({ nome, dominio, agora }) {
  const base = JSON.parse(readFileSync(join(BLOCOS, 'conteudo', 'site.json'), 'utf8'))
  base.identidade.nome = nome
  base.meta.urlBase = `https://${dominio}`
  base.meta.titulo = nome
  base.meta.gabaritoDeTitulo = `%s · ${nome}`
  base.meta.nomeCurto = encurtar(nome)
  base.meta.atualizadoEm = hojeIso(agora)
  // THIS SENTENCE STAYS PORTUGUESE: it is CONTENT of the generated site, which
  // declares `idioma: "pt-BR"`, and it overwrites the same sentence already
  // seeded in `blocks/conteudo/site.json`. English alt text on a pt-BR page is
  // the alt text being wrong for whoever reads it.
  base.meta.og.alt = `Cartão de compartilhamento de ${nome}`
  base.home.titulo = nome
  return base
}

/**
 * Applies everything into `destino`. Returns the list of written paths,
 * relative to the destination, so the gate can check what came out.
 */
export function aplicarSite({ destino, nome, dominio, agora, silencioso = false }) {
  const escritos = []
  const gravar = (relativo, dados) => {
    const alvo = join(destino, ...relativo.split('/'))
    mkdirSync(dirname(alvo), { recursive: true })
    writeFileSync(alvo, dados)
    escritos.push(relativo)
  }

  // 1. The static blocks, copied as they are. `cpSync` takes the dotfiles
  //    along, which is what brings the `.pages.yml`.
  //
  //    `modelo.json` does NOT go along: it is the marker that takes this folder
  //    out of rebar-check's evaluation inside the rebar repository (see
  //    RAIZES_DE_MODELO in tooling/rebar-check/index.mjs). Copied, it would
  //    become an orphan file at the root of the generated project, talking
  //    about a repository the project's owner has never seen.
  cpSync(BLOCOS, destino, {
    recursive: true,
    force: true,
    filter: (origem) => basename(origem) !== 'modelo.json',
  })
  for (const relativo of [
    'next.config.ts',
    '.pages.yml',
    'conteudo/esquema.ts',
    'conteudo/carregar.ts',
    'app/layout.tsx',
    'app/page.tsx',
    'app/sitemap.ts',
    'app/robots.ts',
    'app/manifest.ts',
    // The content contract's proof goes ALONG, and does not stay in rebar: the
    // two cases it exercises — the site with no WhatsApp and the site that
    // declares the button with no number — are sites THIS project's build will
    // never see, because a project can only be one of them. It runs in
    // `npm test`, which the gate puts in the `npm run verificar` chain, which
    // CI runs.
    'testes/conteudo.test.mjs',
    // The published-paths gate. It goes ALONG for the same reason: what it
    // checks — every absolute path in `out/` starting with the site's folder —
    // is a property of THIS project's export, and the defect it catches (a
    // `next/image` src or a manifest `start_url` without the `basePath`) is a
    // 404 with the build green. rebar has no `out/` to check.
    'testes/publicado.mjs',
  ]) {
    escritos.push(relativo)
  }

  // 2. The content, with the project's identity inside it.
  const conteudo = montarConteudo({ nome, dominio, agora })
  gravar('conteudo/site.json', `${JSON.stringify(conteudo, null, 2)}\n`)

  // 3. The images. Generated, not copied: they depend on the name and the color
  //    that have just been decided. See the header of `og.mjs` for why the file
  //    is `og.png` and not `og.jpg`.
  const cores = { corTema: conteudo.meta.cores.tema, corFundo: conteudo.meta.cores.fundo }
  gravar('public/og.png', cartaoOg({ nome, dominio, ...cores }))
  gravar('public/icone-192.png', icone(192, { nome, ...cores }))
  gravar('public/icone-512.png', icone(512, { nome, ...cores }))

  // 4. `out/` is the export's output. Out of version control, and the scaffold
  //    does not know that because the scaffold does not know it will export.
  const gitignore = join(destino, '.gitignore')
  const atual = readFileSync(gitignore, 'utf8')
  if (!/^\/?out\/?$/m.test(atual)) {
    writeFileSync(gitignore, `${atual.replace(/\n*$/, '\n')}\n# the static export output\n/out\n`)
    escritos.push('.gitignore')
  }

  // 5. The `publicado` script, so `verificar` picks it up.
  //
  //    THE ORDER IS WHAT MAKES THIS WORK, and it is worth saying out loud: this
  //    layer runs BEFORE the gate's `aplicarPortao`, and the gate builds
  //    `verificar` by FILTERING the scripts that exist. Writing the script here
  //    is enough for it to become the last link in the chain — after `build`,
  //    which is the only place it can run, because what it reads is `out/`.
  const caminhoPkg = join(destino, 'package.json')
  const pkg = JSON.parse(readFileSync(caminhoPkg, 'utf8'))
  pkg.scripts = pkg.scripts ?? {}
  // The two cases in one script: the proof of the rule and the rule. The proof
  // runs first, and it needs no build — a broken detector fails before spending
  // a minute compiling.
  pkg.scripts.publicado = 'node testes/publicado.mjs --provar && node testes/publicado.mjs'
  writeFileSync(caminhoPkg, `${JSON.stringify(pkg, null, 2)}\n`)
  escritos.push('package.json')

  // 6. The debt, in your face. Last on purpose: the owner reads what is missing
  //    after seeing that everything was written, not in the middle of the file
  //    list.
  if (!silencioso) anunciarPendencias(pendencias(conteudo))

  return escritos
}

// Directly executable, so it can be RUN and what comes out can be seen:
//   node new/site/aplicar.mjs <destino> <nome> <dominio>
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [destino, nome, dominio] = process.argv.slice(2)
  if (!destino || !nome || !dominio) {
    console.error('usage: node aplicar.mjs <destino> <nome> <dominio>')
    process.exit(2)
  }
  for (const caminho of aplicarSite({ destino, nome, dominio })) console.log(caminho)
}
