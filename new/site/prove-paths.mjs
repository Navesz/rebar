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
 * WHAT IS PROVED HERE is the template's shape, not a build: that the three
 * files pass their paths through `naPasta`, that `naPasta` is exported by
 * `conteudo/carregar.ts`, and that the gate that reads `out/` goes along in the
 * blocks and is wired into `verificar`. And, in the other direction, that a
 * mutation in each of them REPROVES — because a checker that never fails is a
 * comment claiming to be a door.
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
  assert.deepEqual(nomes, ['lint', 'typecheck', 'test', 'build', 'publicado'])
  // AFTER `build`, and it is the whole point: what it reads is `out/`.
  assert.ok(nomes.indexOf('publicado') > nomes.indexOf('build'))

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
