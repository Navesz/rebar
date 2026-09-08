/**
 * THE PROOF THAT THE SHIPPED SITE DOES NOT EMIT A PATH OUTSIDE ITS OWN FOLDER.
 *
 * Where this comes from. A GitHub Pages project site lives in a folder, and the
 * blocks `new/site/blocks/` ship derive `basePath` from `urlBase` in
 * `next.config.ts`. What reading a built `out/` showed — on assay, on 08/09,
 * with all four `verificar` steps green:
 *
 *   <img src="/marca.svg">                     next/image, unoptimized
 *   {"start_url":"/","icons":[{"src":"/icone-192.png"}]}   app/manifest.ts
 *   <loc>https://user.github.io/repo</loc>      sitemap, no trailing slash,
 *                                              while canonical says `/repo/`
 *
 * None of the three is a type, lint or build error. They are 404s and a split
 * canonical on the published site — and they were born in the TEMPLATE, so
 * every project the generator creates carried them.
 *
 * AND A FOURTH, of the same family, found on 07/09 by reading the two files
 * side by side: `app/layout.tsx` declared no `icons` AT ALL. The project that
 * hit it wrote the favicon into its own copy and the template never got it
 * back, so every site the generator made was born with the tab showing
 * whatever the scaffold happened to leave there. Same disease as the three
 * above — the fix living in the consumer instead of in the mould — and the
 * favicon is named in the plan (§3.3, §6.2) as one of the holes rebar came to
 * fill.
 *
 * WHAT IS PROVED HERE is the template's shape, not a build: that the four
 * files pass their paths through `naPasta`, that `naPasta` is exported by
 * `conteudo/carregar.ts`, that the icon the layout declares is a file the
 * GENERATOR ACTUALLY WRITES — the list derived from `aplicar.mjs`, never
 * retyped — and that the gate that reads `out/` goes along in the blocks and
 * is wired into `verificar`. And, in the other direction, that a mutation in
 * each of them REPROVES — because a checker that never fails is a comment
 * claiming to be a door.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { semComentario } from '../../tooling/rebar-check/index.mjs'

const BLOCOS = fileURLToPath(new URL('./blocks/', import.meta.url))
const ler = (...partes) => readFileSync(join(BLOCOS, ...partes), 'utf8')

/**
 * The rule, over the SOURCE of a block: no root-absolute string literal that
 * looks like a path to `public/` or to the site's root, unless it is the
 * argument of `naPasta`.
 *
 * Deliberately narrow. It does not try to understand TypeScript — it looks for
 * the literals that actually caused the defect, and it looks at what comes
 * IMMEDIATELY BEFORE them. A wider rule over a template of eight files would be
 * a false positive machine, and a wrong automatic rule costs more than an
 * absent rule.
 *
 * IT STRIPS THE COMMENTS FIRST, with the checker's own `semComentario` and not
 * with a second stripper written here. The first version of this proof failed
 * over the CLEAN manifest, because the note explaining the defect quotes it —
 * `"start_url": "/"` written in prose. It is the third time in this session
 * that a rule trips on the comment that documents it, and the answer has been
 * the same all three times: what the rule reads is the CODE.
 */
export function caminhosCrus(fonteBruta) {
  const fonte = semComentario(fonteBruta)
  const crus = []
  // `'/'`, `'/algo.png'`, `'/algo/'` — the shapes that reach a URL. What is not
  // taken: `'./x'`, `'@/x'`, an absolute URL, and a regular expression.
  for (const casou of fonte.matchAll(/(naPasta\(\s*)?(['"])(\/[A-Za-z0-9._/-]*)\2/g)) {
    const [, viaNaPasta, , caminho] = casou
    if (viaNaPasta) continue
    crus.push(caminho)
  }
  return crus
}

/**
 * The `icons:` value of a metadata object, as SOURCE TEXT — from the key to
 * the brace that closes it, counted rather than guessed at with a regex.
 *
 * Counting is what lets the same helper serve both sides: it returns the slice
 * when the key is there, and `null` when it is not, which IS the defect being
 * chased — a template with no favicon at all. A regex for the whole value
 * would have to know how deep the object nests, and `icons` nests one level in
 * the shape Next takes.
 */
export function trechoDeIcones(fonteBruta) {
  const fonte = semComentario(fonteBruta)
  const chave = fonte.match(/\bicons:\s*\{/)
  if (!chave) return null
  let profundidade = 0
  for (let i = chave.index + chave[0].length - 1; i < fonte.length; i++) {
    if (fonte[i] === '{') profundidade += 1
    else if (fonte[i] === '}') {
      profundidade -= 1
      if (profundidade === 0) return fonte.slice(chave.index, i + 1)
    }
  }
  return null
}

/**
 * The images the generator WRITES into `public/`, read out of the generator.
 *
 * Derived, never retyped: the day step 3 of `aplicar.mjs` renames a file or
 * stops writing one, this list changes with it and the layout gets accused,
 * instead of a copy kept here agreeing with a template that now points at
 * nothing. Declaring an icon that does not exist is worse than declaring none
 * — the browser asks and takes a 404.
 */
function imagensDoGerador() {
  const fonte = semComentario(readFileSync(new URL('./aplicar.mjs', import.meta.url), 'utf8'))
  const escritas = [...fonte.matchAll(/gravar\('public\/([A-Za-z0-9._-]+)'/g)]
  return escritas.map(([, arquivo]) => `/${arquivo}`)
}

test('naPasta is exported by the content loader', () => {
  const carregar = ler('conteudo', 'carregar.ts')
  assert.match(carregar, /export const naPasta = \(caminho: string\)/)
  // Derived from the SAME `urlBase` `next.config.ts` reads, and not from a
  // second constant that could drift from it.
  assert.match(carregar, /new URL\(site\.meta\.urlBase\)\.pathname/)
})

test('the manifest passes start_url, scope and the icons through naPasta', () => {
  const fonte = ler('app', 'manifest.ts')
  for (const campo of ['start_url', 'scope']) {
    assert.match(fonte, new RegExp(`${campo}: naPasta\\(`), `${campo} without naPasta`)
  }
  assert.equal(
    (fonte.match(/src: naPasta\('\/icone-\d+\.png'\)/g) ?? []).length,
    2,
    'the two icons must go through naPasta',
  )
  assert.deepEqual(caminhosCrus(fonte), [], 'raw path in the manifest')
})

test('the mutated manifest is caught — the rule is a door, not a comment', () => {
  // Exactly the shape that shipped, and that reached three published sites.
  const mutante = ler('app', 'manifest.ts')
    .replace("start_url: naPasta('/')", "start_url: '/'")
    .replace("src: naPasta('/icone-192.png')", "src: '/icone-192.png'")
  assert.deepEqual(caminhosCrus(mutante), ['/', '/icone-192.png'])
})

test('the layout declares the favicon, through naPasta, on a file the generator writes', () => {
  const fonte = ler('app', 'layout.tsx')
  const trecho = trechoDeIcones(fonte)
  assert.ok(trecho, 'the template declares no icons: every site it makes is born with no favicon')
  assert.deepEqual(caminhosCrus(trecho), [], 'raw path in the favicon')

  const passados = [...trecho.matchAll(/naPasta\(\s*'(\/[A-Za-z0-9._/-]+)'\s*\)/g)]
  assert.equal(passados.length, 1, `expected one icon path through naPasta, got: ${trecho}`)

  // The file has to be one the GENERATOR writes. `og.png` is in this list and
  // passes — the rule is membership, not shape, because the reason the icon is
  // a square and not the 1200-by-630 card is a judgement written next to the
  // declaration, and a rule that tried to enforce it would be guessing.
  const escritas = imagensDoGerador()
  assert.ok(escritas.length > 0, 'the derivation of the images out of aplicar.mjs came out empty')
  assert.ok(
    escritas.includes(passados[0][1]),
    `${passados[0][1]} is not written by the generator, which writes ${escritas.join(', ')}`,
  )

  // And the import, because `naPasta` in the metadata of a block that does not
  // import it is a red typecheck — but this proof reads source, not types, so
  // it is the assertion that stands in for the compiler here.
  assert.match(fonte, /import \{ naPasta, site \} from '@\/conteudo\/carregar'/)
})

test('the mutated layout is caught — the favicon gone, and the favicon raw', () => {
  const fonte = ler('app', 'layout.tsx')
  const trecho = trechoDeIcones(fonte)
  // The mutations are TEXTUAL, over the source, so the slice the detector
  // handed back has to be literally in it — it is, because the declaration
  // carries no comment inside. If that ever stops holding, this line says so,
  // instead of a `replace` that edits nothing and a mutant identical to the
  // original passing as though it had been caught.
  assert.ok(fonte.includes(trecho), 'the icons declaration is no longer a literal slice')

  // (a) THE STATE THE TEMPLATE WAS IN until 07/09: the key simply absent. What
  //     is left behind is a dangling comma, and that is fine — nothing
  //     compiles this text, the detector reads it.
  assert.equal(trechoDeIcones(fonte.replace(trecho, '')), null, 'a template with no favicon passed')

  // (b) THE SHAPE THAT BUILDS, TYPES AND LINTS GREEN and 404s once published:
  //     the right file, without the site's folder in front of it. The expected
  //     path is taken from the template itself so the two do not have to be
  //     kept in step by hand.
  const [, caminho] = trecho.match(/naPasta\(\s*'(\/[A-Za-z0-9._/-]+)'\s*\)/)
  const cru = fonte.replace(trecho, trecho.replace(/naPasta\(\s*('[^']+')\s*\)/, '$1'))
  assert.deepEqual(caminhosCrus(trechoDeIcones(cru)), [caminho], 'a raw favicon was not caught')
})

test('the sitemap announces the canonical form, with the trailing slash', () => {
  const fonte = ler('app', 'sitemap.ts')
  assert.match(fonte, /url: `\$\{site\.meta\.urlBase\.replace\(\/\\\/\$\/, ''\)\}\/`/)
  // And the config that makes that form canonical is the same one that is in
  // the box: without `trailingSlash` the assertion above would be arbitrary.
  assert.match(ler('next.config.ts'), /trailingSlash: true/)
})

test('the published-paths gate goes along in the blocks and proves itself', () => {
  const fonte = ler('testes', 'publicado.mjs')
  assert.match(fonte, /export function caminhosForaDaPasta/)
  // The two cases, in the file that ships: one that fails and one that passes.
  assert.match(fonte, /html que reprova/)
  assert.match(fonte, /html que aprova/)
  assert.match(fonte, /json que reprova/)
  assert.match(fonte, /json que aprova/)
  // A site at the root of a domain leaves the denominator instead of being
  // handed a free green — the `na()` of rebar-check, applied here.
  assert.match(fonte, /n\/a — o site mora na raiz do domínio/)
})

test('the gate chains `publicado` after `build`, and the site preset writes it', () => {
  const portao = readFileSync(new URL('../gate/aplicar.mjs', import.meta.url), 'utf8')
  const elos = portao.match(/const elos = \[([^\]]*)\]/)
  assert.ok(elos, 'the chain of links was not found in the gate')
  const nomes = [...elos[1].matchAll(/'([^']+)'/g)].map((m) => m[1])

  // TWO FACTS AND NOT THE WHOLE LIST, and the difference was measured on
  // 2026-09-08: this assertion used to pin the chain exactly, and it failed the
  // moment the chain legitimately GREW — `format-check`, `links`, `secret` and
  // `portao-remoto` joined, closing three holes that had already bitten. A test
  // that fails on a correct change is a test that gets deleted, and it was
  // asserting somebody else's subject: what the whole chain is belongs to
  // `new/gate/prove-elos.mjs`, which owns it. What belongs HERE is the one
  // ordering this file exists for.
  assert.ok(nomes.includes('publicado'), `the published-paths link left the chain: ${nomes}`)
  // AFTER `build`, and it is the whole point: what it reads is `out/`.
  assert.ok(
    nomes.indexOf('publicado') > nomes.indexOf('build'),
    `\`publicado\` reads the export, so it cannot run before \`build\`: ${nomes}`,
  )

  const site = readFileSync(new URL('./aplicar.mjs', import.meta.url), 'utf8')
  assert.match(site, /pkg\.scripts\.publicado =\s*'node testes\/publicado\.mjs --provar/)
  assert.match(site, /'testes\/publicado\.mjs',/)
})

test('the proof of the shipped gate passes over its own two cases', async () => {
  // It is not enough to read that the cases are written: they have to RUN. This
  // executes the file the generator copies, in `--provar` mode, and demands 0.
  const { execFileSync } = await import('node:child_process')
  const saida = execFileSync(
    process.execPath,
    [join(BLOCOS, 'testes', 'publicado.mjs'), '--provar'],
    {
      encoding: 'utf8',
    },
  )
  assert.equal((saida.match(/✓/g) ?? []).length, 4, saida)
})
