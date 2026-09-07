#!/usr/bin/env node
// prove-steps.mjs — the proofs of the `verificar` steps that are FUNCTIONS.
//
// A step that is `comando:` already proves itself: if the script it calls
// disappears or breaks, the step falls. A step that is `funcao:` is gate code, and
// gate code without proof is the defect this whole repository chases,
// committed in the most expensive place there is.
//
// THE FINDING THIS CLOSES, from the audit of 31/08: `checarBlocos` landed with
// 410 lines in `verify.config.mjs` — including a string and template tokenizer
// written by hand, with a stack of `${}` — and ZERO tests. `grep -rln
// checarBlocos` in the repository returned only its own definition. Swapping its
// body for `return { codigo: 0 }`, `npm run verificar` still printed
// APROVADO 9 de 9 and nothing flagged it. A gate step that can be switched off
// without anyone noticing is not a gate, it is decoration.
//
// THE FORM: mutation, not output assertion. Each test copies the blocks to a
// temporary directory, plants ONE defect, and demands the step find it. It is the
// same discipline as `proofs/prove.mjs` — two cases per rule — applied
// to the gate instead of to the rules.
//
// Usage:
//   node --test tooling/verify/prove-steps.mjs
//   node tooling/verify/prove-steps.mjs        (same thing)

import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test, { after, describe } from 'node:test'

import { checarBlocos, checarSintaxe } from '../../verify.config.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const BLOCOS = join('new', 'site', 'blocks')

/**
 * Builds a temporary root with the blocks inside, applies the mutation and returns
 * what the step answered.
 *
 * The root is rebuilt instead of pointing at the live repository because the step
 * takes `raiz` as a parameter precisely for that — and because a test that
 * writes into the repository is the defect the foundation's `provar-portao.mjs`
 * had and that this repository refused to inherit.
 */
async function comBlocosMutados(mutar) {
  const tmp = await mkdtemp(join(tmpdir(), 'rebar-passos-'))
  try {
    await cp(join(RAIZ, BLOCOS), join(tmp, BLOCOS), { recursive: true })
    await mutar({
      ler: (rel) => readFile(join(tmp, BLOCOS, rel), 'utf8'),
      escrever: (rel, texto) => writeFile(join(tmp, BLOCOS, rel), texto, 'utf8'),
    })
    return await checarBlocos({ raiz: tmp })
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

// ──────────────────────────────────────────────────────── the case that PASSES

// ────────────────────────────────────────────────── why groups, and not
// loose tests at the top of the file
//
// In `node:test`, a test declared at the top of the file runs in SERIES: the
// root `concurrency` is 1 and there is no flag that changes that for a single
// file (`--test-concurrency` splits FILES, and here there is only one). Measured
// with four 500 ms tests: 2144 ms at the top against 616 ms inside a
// `describe` with `concurrency: 4`.
//
// That matters because almost every test here is WAITING, not counting: building
// a temporary root and running a process. In series the 18 tests took 3.5 s and
// the `passos` step was the fourth most expensive in the gate; the bill got worse
// with every new proof, which is the wrong incentive in a file whose job is to
// gain proofs.
//
// Each family becomes a concurrent `describe`. The groups still run in series
// among themselves, and inside a group the REPORT ORDER becomes the order of
// finishing — the price, and it is small because what you read here is the name
// of the test that went red, not the sequence.

describe('the `blocos` step', { concurrency: 7 }, () => {
  test('PASSES · the blocks as they stand in the repository pass', async () => {
    const r = await checarBlocos({ raiz: RAIZ })
    assert.equal(r.codigo, 0, `the repository blocks should pass:\n${r.saida}`)
  })

  // ──────────────────────────────────────────── the cases that have to FAIL
  //
  // One per class of defect the step claims to catch. If the step is emptied —
  // `return { codigo: 0 }` —, ALL of these fail at once, which is the point.

  test('FAILS · field that does not exist in site.json', async () => {
    const r = await comBlocosMutados(async ({ ler, escrever }) => {
      const t = await ler(join('app', 'manifest.ts'))
      // `nomeCurto` is really read by the manifest; `nomeCurtoo` does not exist.
      // The example is named in the step's comment, and this proof is what keeps
      // that comment from turning into folklore.
      assert.ok(t.includes('nomeCurto'), 'manifest.ts stopped reading meta.nomeCurto')
      await escrever(join('app', 'manifest.ts'), t.replace(/nomeCurto\b/g, 'nomeCurtoo'))
    })
    assert.equal(r.codigo, 1, `expected a fail, got ${r.codigo}:\n${r.saida}`)
    assert.match(r.saida, /nomeCurtoo/, 'the output has to name the nonexistent field')
  })

  test('FAILS · nonexistent field in .tsx too, not only in .ts', async () => {
    const r = await comBlocosMutados(async ({ ler, escrever }) => {
      const t = await ler(join('app', 'page.tsx'))
      assert.match(t, /site\.[a-zA-Z.]+/, 'page.tsx stopped reaching into the site')
      await escrever(join('app', 'page.tsx'), t.replace(/site\.identidade\b/, 'site.identidadeZZZ'))
    })
    assert.equal(r.codigo, 1, `expected a fail, got ${r.codigo}:\n${r.saida}`)
    assert.match(r.saida, /identidadeZZZ/)
  })

  test('DOES NOT FLAG · path that shows up only inside a string', async () => {
    // The tokenizer exists for this: `esquema.ts` writes "conteudo/site.json"
    // in an error message, and the field-access pattern matches inside the string.
    // Without stripping strings, the blocks flag twelve nonexistent paths.
    const r = await comBlocosMutados(async ({ ler, escrever }) => {
      const t = await ler(join('app', 'page.tsx'))
      await escrever(
        join('app', 'page.tsx'),
        `const aviso = "leia site.campoQueNaoExiste no manual"\n${t}`,
      )
    })
    assert.equal(r.codigo, 0, `a string is not a field access, but it failed:\n${r.saida}`)
  })

  test('DOES NOT FLAG · path inside a comment', async () => {
    const r = await comBlocosMutados(async ({ ler, escrever }) => {
      const t = await ler(join('app', 'page.tsx'))
      await escrever(join('app', 'page.tsx'), `// site.outroCampoInexistente\n${t}`)
    })
    assert.equal(r.codigo, 0, `a comment is not code, but it failed:\n${r.saida}`)
  })

  test('FAILS · block that vanished from disk', async () => {
    const r = await comBlocosMutados(async ({ escrever }) => {
      await escrever(join('app', 'manifest.ts'), '')
    })
    // An empty file has nothing to check, but the step cannot say "all good"
    // about a block the generator will copy empty into every project.
    assert.notEqual(r.saida.length, 0, 'the step went silent about an empty block')
  })

  test('FAILS · broken example JSON', async () => {
    const r = await comBlocosMutados(async ({ escrever }) => {
      await escrever('modelo.json', '{ this is not json')
    })
    assert.notEqual(r.codigo, 0, `expected a fail, got ${r.codigo}:\n${r.saida}`)
  })
})

// ──────────────────────────────────────── the `mcp` step — freshness gate
//
// Objective nº 5 of ESTADO.md: "manter o MCP vivo — regra mudou, MCP se
// regenera, e o portão reprova se estiver velho" [keep the MCP alive — a rule
// changed, the MCP regenerates itself, and the gate fails if it is stale]. The
// defect it kills is the one the owner lived through at Herz and at BMB Compras:
// the MCP held the project's rules, the rules changed, the MCP went on serving
// the old version, and nobody noticed. A gate that only EXISTS has exactly that
// defect — it was for lack of proof that `checarBlocos` could be born with 410
// lines and zero tests.
//
// WHY THESE PROOFS RUN A PROCESS, instead of calling a function.
//
// The `mcp` step is `comando:` and not `funcao:`, and the rest of this file only
// reaches `funcao:`. The second exit was the one chosen: the proof runs
// `node mcp/generate.mjs --verificar` as a process. Three reasons, in the order
// they weigh:
//
//   1. THE CONTRACT BETWEEN THE FRONTS IS A CLI. `node mcp/generate.mjs --verificar`
//      regenerates in memory, compares against disk and exits 1 if they diverge.
//      Turning it into `funcao:` would demand a SECOND contract — a module
//      export — for the same truth. It is literally what §7.2 of the PLANO
//      forbids: "derivado, nunca duplicado; não há duas fontes para divergir"
//      [derived, never duplicated; there are no two sources to diverge]. A
//      freshness gate with two sources to diverge is a joke about itself.
//   2. `funcao:` runs INSIDE the verificar process, and `mcp/` is a separate
//      package that MAY have dependencies. Importing the generator in there would
//      make one error of its own take down the whole gate instead of one step —
//      and would give the root `verificar` an import path into a package with its
//      own `node_modules`, which is the opposite of the zero-dependency rule at
//      the root.
//   3. Running the process is the STRONGEST proof. It exercises exactly the bytes
//      the gate executes: the same argv, the same exit code, the same
//      stdout. A proof that called a function would be proving a path
//      the gate does not use.
//
// The case that matters is STALE ARTIFACT: the rule changed in `index.mjs` and
// `rules.generated.json` fell behind. It is the Herz defect, staged.

const GERADOR = 'mcp/generate.mjs'
const FONTE = join('tooling', 'rebar-check', 'index.mjs')
const ARTEFATO = join('mcp', 'rules.generated.json')

// While the other front has not delivered the generator, these proofs stay SKIP
// instead of red — and the hole is not silent: the `mcp` step of
// verify.config.mjs lists `mcp/generate.mjs` in `exige`, so its absence already
// BREAKS the whole gate with exit 127 and a line naming the file. Two
// mouths shouting the same fact would only teach people to ignore both, and would
// leave the `passos` suite red for a reason that is not its own.
const RAZAO_DO_SKIP = existsSync(join(RAIZ, 'mcp', 'generate.mjs'))
  ? false
  : 'mcp/generate.mjs does not exist yet — the `mcp` step of verificar already fails on that via `exige` (exit 127)'

/**
 * Copies `origem` to `destino` skipping ONE folder by name.
 *
 * WHY NOT THROUGH THE `filter` FIELD OF `fs.cp`.
 *
 * The previous version passed `{ recursive: true, filter: semPasta('provas') }`.
 * A/B interleaved on this machine (Windows 11, Node 24.13), four consecutive
 * pairs, copying the TWO files that are left of
 * `tooling/rebar-check`:
 *
 *   filter    700 · 723 · 647 · 631 ms
 *   readdir     6 ·   5 ·   6 ·   5 ms
 *
 * ~120×. `filter` refuses entry by entry, but only AFTER the recursive
 * `fs.cp` has walked the source tree — and `proofs/` has 262 fixtures.
 * You paid for the whole walk just to throw it away. Skipping the folder in
 * `readdir`, before `cp` knows it exists, means there is no walk.
 *
 * What that did NOT buy: the `passos` step did not drop by the same proportion,
 * because what is left in it is spawning processes (two `node` per test of the
 * `numeros` family), and there is no escaping that without giving up exercising
 * the CLI. On the record for the next person who measures and finds it odd: the
 * waste was real and it is gone, the bottleneck is elsewhere.
 */
async function copiarSem(origem, destino, pasta) {
  await mkdir(destino, { recursive: true })
  for (const nome of await readdir(origem)) {
    if (nome === pasta) continue
    await cp(join(origem, nome), join(destino, nome), { recursive: true })
  }
}

/**
 * Builds a temporary root with the generator, the artifact and the source of the
 * rules, applies the mutation and runs `node mcp/generate.mjs --verificar` inside it.
 *
 * `node_modules` stays OUT of the copy on purpose: the freshness gate runs in the
 * root `verificar` and has to work without `mcp/node_modules`. Copying the
 * dependencies would hide a regression in that — the generator would pass here and
 * break in a clean clone, which is the worst place to find out.
 *
 * `proofs/` of rebar-check also stays out: 262 fixture files the
 * generator does not read, and the copy is made on every test.
 */
async function comMcpMutado(mutar) {
  const tmp = await mkdtemp(join(tmpdir(), 'rebar-mcp-'))
  try {
    await copiarSem(join(RAIZ, 'mcp'), join(tmp, 'mcp'), 'node_modules')
    await copiarSem(
      join(RAIZ, 'tooling', 'rebar-check'),
      join(tmp, 'tooling', 'rebar-check'),
      'proofs',
    )
    // The MCP generator now imports the SECURITY rules too. Without
    // this copy the temporary tree does not resolve the import and the mutation
    // dies with ERR_MODULE_NOT_FOUND -- which the test would read as "the
    // artifact is stale", pointing at the wrong place.
    await copiarSem(join(RAIZ, 'tooling', 'security'), join(tmp, 'tooling', 'security'), 'proofs')
    await cp(join(RAIZ, 'package.json'), join(tmp, 'package.json'))

    await mutar({
      ler: (rel) => readFile(join(tmp, rel), 'utf8'),
      escrever: (rel, texto) => writeFile(join(tmp, rel), texto, 'utf8'),
      apagar: (rel) => rm(join(tmp, rel), { force: true }),
    })

    // Same form the step uses: cwd at the root, relative path in argv, no
    // shell. With no shell there is no cmd.exe quoting rule to get right, which is
    // the `npx` bug rebar inherited from the foundation and refused to repeat.
    const r = spawnSync(process.execPath, [GERADOR, '--verificar'], {
      cwd: tmp,
      encoding: 'utf8',
      windowsHide: true,
    })
    return { codigo: r.status, saida: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

describe('the `mcp` step', { concurrency: 4 }, () => {
  test('PASSES · artifact up to date, no mutation at all', { skip: RAZAO_DO_SKIP }, async () => {
    const r = await comMcpMutado(async () => {})
    assert.equal(
      r.codigo,
      0,
      'the repository mcp/rules.generated.json is STALE (or the generator does not ' +
        `run without mcp/node_modules). Regenerate with: node mcp/generate.mjs\n${r.saida}`,
    )
  })

  test(
    'FAILS · rule title changed and the artifact fell behind',
    { skip: RAZAO_DO_SKIP },
    async () => {
      const r = await comMcpMutado(async ({ ler, escrever }) => {
        const t = await ler(FONTE)
        // Source anchor, not prose: it has to match the text in ${FONTE} byte for
        // byte. `TITULO-TROCADO-PELA-PROVA` is the planted sentinel the regex
        // below looks for — renaming either one breaks the proof.
        const antes = "titulo: 'has an .editorconfig'"
        assert.ok(t.includes(antes), `the editorconfig rule changed shape in ${FONTE}`)
        await escrever(FONTE, t.replace(antes, "titulo: 'TITULO-TROCADO-PELA-PROVA'"))
      })
      assert.notEqual(
        r.codigo,
        0,
        'the rule changed and the artifact fell behind — it is the Herz defect, and ' +
          `the freshness gate let it through:\n${r.saida}`,
      )
      assert.match(
        r.saida,
        /editorconfig|TITULO-TROCADO-PELA-PROVA/,
        'failing without saying WHAT diverged sends the owner to reread 21 rules by hand',
      )
    },
  )

  test('FAILS · NEW rule in the source, artifact without it', { skip: RAZAO_DO_SKIP }, async () => {
    const r = await comMcpMutado(async ({ ler, escrever }) => {
      const t = await ler(FONTE)
      const ancora = 'const REGRAS = ['
      assert.ok(t.includes(ancora), `the rule list changed shape in ${FONTE}`)
      // A whole, inert rule: id, class, level, title and a `checar` that
      // never flags anything. Any faithful derivation of the source gains an entry.
      // The planted rule below is source code injected into ${FONTE}: its
      // Portuguese field names and id are the shape that file has, not prose.
      const plantada =
        `${ancora}\n  {\n    id: 'regra-plantada-pela-prova',\n` +
        "    classe: 'determinística',\n    nivel: 'N0',\n" +
        "    titulo: 'regra plantada pela prova do passo mcp',\n" +
        '    checar: () => null,\n  },'
      await escrever(FONTE, t.replace(ancora, plantada))
    })
    assert.notEqual(r.codigo, 0, `new rule, MCP not regenerated, passed clean:\n${r.saida}`)
    assert.match(
      r.saida,
      /regra-plantada-pela-prova/,
      'the diff has to name the rule that came in, otherwise it is not a diff, it is a gripe',
    )
  })

  test('FAILS · artifact deleted, and with exit 1, not 127', { skip: RAZAO_DO_SKIP }, async () => {
    // This pins the step's decision: `exige` lists ONLY `mcp/generate.mjs`, never
    // the artifact. A missing tool is the executor's BROKE (127); a missing
    // artifact is a STALE REPOSITORY, and the one who has to say it is the
    // generator, with exit 1. If the artifact entered `exige`, deleting it would
    // become "missing tooling" — the wrong accusation, pointing at who did not err.
    const r = await comMcpMutado(async ({ apagar }) => {
      await apagar(ARTEFATO)
    })
    assert.notEqual(r.codigo, 0, 'with no artifact at all the generator said everything is fresh')
  })
})

// ───────────────────── the `numeros` step — freshness gate of the documents
//
// The SAME defect as the `mcp` step, in the second place where it lives. Measured
// in the README before the meter existed: `16 determinísticas` when there are 17,
// `50 casos` when there are 52, `21 de 21 regras com prova` when it is 22 of 22,
// `os 8 passos` when there are 12 — and ESTADO.md with FOUR different counts of
// proof cases (13, 33, 47 and 50) in the same file.
//
// The proof runs a PROCESS for the same three reasons written above for the `mcp`
// step, and they hold word for word: the contract between the fronts is the CLI,
// a module export would be the second source §7.2 forbids, and running the
// process exercises exactly the bytes the gate executes.
//
// THE MUTATION THESE PROOFS HAVE TO KILL is `--verificar` starting to exit 0
// always. Each test below plants ONE defect and demands exit ≠ 0; an emptied
// meter takes down all five at once, which is the point.
//
// THE TEMPORARY ROOT IS PARTIAL ON PURPOSE: in go the meter, the source of the
// rules and the gate config; out stay `mcp/`, `new/`, `domains/`, the
// `.git` and the 262 fixtures of `proofs/cases/`. That exercises the per-group
// N/A — the meter has to say ⚠ about what this tree does not have, and never
// DIVERGIU.

const MEDIDOR = 'tooling/numbers.mjs'

/**
 * The seed document. The values are born WRONG on purpose (`0`): the first
 * thing the helper does is run the meter with no argument, and there is only proof
 * that writing and checking agree if the writing has real work to do.
 *
 * The marker ids and the `0 de 0` value are the meter's own shape, not prose:
 * the meter rewrites that value, and one test needs the `rules.deterministicas`
 * marker to keep starting its line.
 */
const SEMENTE = [
  '# proof root',
  '',
  'Rules: <!--n rules.total-->0<!--/n--> · deterministic',
  '<!--n rules.deterministicas-->0<!--/n--> · heuristic <!--n rules.heuristicas-->0<!--/n-->.',
  '',
  'The gate has <!--n verify.passos-->0<!--/n--> steps, and `mcp` is the',
  '<!--n verify.posicao.mcp-->0 de 0<!--/n-->.',
  '',
].join('\n')

const rodarMedidor = (cwd, ...args) => {
  // Same form the step uses: cwd at the root, relative path in argv, no
  // shell — and no `.git`, to prove the meter survives a tree that
  // is not a git repository instead of blowing up on it.
  const r = spawnSync(process.execPath, [MEDIDOR, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  return { codigo: r.status, saida: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/**
 * THE TEMPLATE: the seeded root, built ONCE for the whole family.
 *
 * CUT WORK BEFORE PARALLELIZING, which is the lesson `proofs/prove.mjs`
 * had already learned in this same repository: there the 94 `git init` became one
 * copied template. Here it was the seeding. Each test of this family ran TWO
 * `node` processes — one to write the seed and another to check —, and the first
 * did exactly the same thing in all of them: take a README with zeros and
 * write today's numbers. With nine tests that was nine identical seedings.
 *
 * Now the template is seeded once and each test COPIES the finished tree — four
 * little files — and runs only the process that matters. The seeding is still
 * a real seeding (the template is born from the same README with zeros, and its
 * exit 0 is checked here), so the proof that "writing and checking agree"
 * lost nothing.
 *
 * A `documento` other than SEMENTE does not use the template: in that case the
 * seeding is another one and has to happen again.
 */
let promessaDoMolde = null
function molde() {
  promessaDoMolde ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebar-numeros-molde-'))
    await montarRaizDoMedidor(dir, SEMENTE)
    const semeou = rodarMedidor(dir)
    assert.equal(semeou.codigo, 0, `the meter could not write the seed:\n${semeou.saida}`)
    return dir
  })()
  return promessaDoMolde
}

async function montarRaizDoMedidor(dir, documento) {
  await cp(join(RAIZ, MEDIDOR), join(dir, MEDIDOR), { recursive: true })
  await copiarSem(
    join(RAIZ, 'tooling', 'rebar-check'),
    join(dir, 'tooling', 'rebar-check'),
    'proofs',
  )
  await copiarSem(join(RAIZ, 'tooling', 'security'), join(dir, 'tooling', 'security'), 'proofs')
  await cp(join(RAIZ, 'verify.config.mjs'), join(dir, 'verify.config.mjs'))
  await cp(join(RAIZ, 'package.json'), join(dir, 'package.json'))
  await writeFile(join(dir, 'README.md'), documento, 'utf8')
}

/**
 * Builds a temporary root already seeded (the document is born up to date),
 * applies the mutation and runs `node tooling/numbers.mjs` with the argv asked for.
 */
async function comNumeros(mutar, { documento = SEMENTE, argv = ['--verificar'] } = {}) {
  const tmp = await mkdtemp(join(tmpdir(), 'rebar-numeros-'))
  const rodar = (...args) => rodarMedidor(tmp, ...args)
  try {
    if (documento === SEMENTE) {
      // The template tree has six files; here the recursive `cp` is cheap
      // because there is no big subtree at all for it to walk.
      await cp(await molde(), tmp, { recursive: true })
    } else {
      await montarRaizDoMedidor(tmp, documento)
      const semeou = rodar()
      assert.equal(semeou.codigo, 0, `the meter could not write the seed:\n${semeou.saida}`)
    }

    await mutar({
      ler: (rel) => readFile(join(tmp, rel), 'utf8'),
      // `mkdir` before the `writeFile` because one of the mutations writes a
      // document in a SUBFOLDER — that is what exercises the `documentos()` recursion.
      escrever: async (rel, texto) => {
        await mkdir(dirname(join(tmp, rel)), { recursive: true })
        await writeFile(join(tmp, rel), texto, 'utf8')
      },
      rodar,
    })
    return rodar(...argv)
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

// The template belongs to the whole process, so what deletes it is the end of the
// process — not one test's `finally`, which would pull it from under the other eight.
after(async () => {
  if (promessaDoMolde) {
    await rm(await promessaDoMolde, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  }
})

describe('the `numeros` step', { concurrency: 8 }, () => {
  test('FAILS · MCP steps change and the document goes stale', async () => {
    const r = await comNumeros(async ({ ler, escrever, rodar }) => {
      for (const rel of ['mcp/rules.generated.json', 'mcp/generate.mjs', 'mcp/src/index.mjs']) {
        await escrever(rel, await readFile(join(RAIZ, rel), 'utf8'))
      }
      const artefato = JSON.parse(await ler('mcp/rules.generated.json'))
      assert.ok(artefato.gate.passos.length > 0, 'the real artifact needs to have steps')
      await escrever(
        'README.md',
        `${await ler('README.md')}\nThe MCP has <!--n mcp.artefato.passos-->0<!--/n--> steps.\n`,
      )
      const semeou = rodar()
      assert.equal(semeou.codigo, 0, semeou.saida)
      assert.ok(
        (await ler('README.md')).includes(
          `<!--n mcp.artefato.passos-->${artefato.gate.passos.length}<!--/n-->`,
        ),
        'the document needs to reflect the steps present in the real artifact',
      )
      artefato.gate.passos.pop()
      await escrever('mcp/rules.generated.json', JSON.stringify(artefato))
    })
    assert.equal(r.codigo, 1, `a change in the MCP steps went unnoticed:\n${r.saida}`)
    assert.match(r.saida, /mcp\.artefato\.passos/)
  })

  test('PASSES · freshly regenerated document checks out, absent group shows as ⚠', async () => {
    const r = await comNumeros(async () => {})
    assert.equal(r.codigo, 0, `writing and checking disagreed in the same tree:\n${r.saida}`)
    // The per-group N/A has to be AUDIBLE. This root has no `mcp/`, `new/`,
    // `domains/` or `.git`; if the meter went silent about that, anyone who deleted
    // one of those folders in the real repository would switch off part of the gate
    // with nothing showing up on screen.
    //
    // The regex matches the METER's output, which is Portuguese: do not translate it.
    assert.match(r.saida, /⚠ grupo "git"/, 'an N/A group has to come out named, not in silence')
  })

  test('FAILS · number hand-edited in the document', async () => {
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      const antes = /<!--n rules\.total-->(\d+)<!--\/n-->/.exec(t)
      assert.ok(antes, 'the seed lost the rules.total marker')
      await escrever('README.md', t.replace(antes[0], '<!--n rules.total-->999<!--/n-->'))
    })
    assert.notEqual(r.codigo, 0, `an invented number in the document passed clean:\n${r.saida}`)
    assert.match(
      r.saida,
      /rules\.total/,
      'failing without saying WHICH number diverged sends the owner to reread the whole document',
    )
    assert.match(
      r.saida,
      /README\.md:\d+/,
      'the line has to say file and line, otherwise it is not a diff',
    )
  })

  test('FAILS · NEW rule in the source and the document not regenerated', async () => {
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler(FONTE)
      const ancora = 'const REGRAS = ['
      assert.ok(t.includes(ancora), `the rule list changed shape in ${FONTE}`)
      // A whole, inert rule, same as the `mcp` step's: any faithful count of the
      // source gains one. The planted rule is source code injected into ${FONTE},
      // so its Portuguese field names and id stay as that file has them.
      const plantada =
        `${ancora}\n  {\n    id: 'regra-plantada-pela-prova',\n` +
        "    classe: 'determinística',\n    nivel: 'N0',\n" +
        "    titulo: 'regra plantada pela prova do passo numeros',\n" +
        '    checar: () => null,\n  },'
      await escrever(FONTE, t.replace(ancora, plantada))
    })
    assert.notEqual(r.codigo, 0, `new rule, document not regenerated, passed clean:\n${r.saida}`)
    assert.match(
      r.saida,
      /rules\.(total|deterministicas)/,
      'the diff has to name the fact that changed, otherwise it is not a diff, it is a gripe',
    )
  })

  test('FAILS · marker with an id that is no fact at all', async () => {
    // `nao.existe.mesmo` is a marker ID, not prose: it is written into the
    // document here and matched back by the regex below, so both stay as they are.
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      await escrever('README.md', `${t}\ninvented fact: <!--n nao.existe.mesmo-->1<!--/n-->\n`)
    })
    assert.notEqual(r.codigo, 0, 'a marker pointing at a nonexistent fact passed clean')
    assert.match(r.saida, /nao\.existe\.mesmo/)
  })

  test('FAILS · marker inside a code fence', async () => {
    // The marker is an HTML comment: invisible in rendered markdown, VISIBLE
    // inside a fence, because GitHub prints the fence literally. Without this
    // check, anyone marking `npm run provar   # 52 casos` would publish the raw
    // markup on the page — a render defect that shows up in no test at all.
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      await escrever(
        'README.md',
        `${t}\n\`\`\`bash\nnpm run provar   # <!--n rules.total-->22<!--/n--> rules\n\`\`\`\n`,
      )
    })
    assert.notEqual(r.codigo, 0, 'a marker inside a fence passed clean, and it shows on the page')
    // `cerca` is the METER's word in its own output: matching it in English would
    // match nothing.
    assert.match(r.saida, /cerca/i)
  })

  test('N/A · a document with no markers at all is not a fail, and is not mute', async () => {
    // PINS THE DECISION, and it is this step's known gap: while nobody has
    // marked anything, the meter checks ZERO numbers and still exits 0 — shouting
    // DIVERGIU about a document not yet marked is accusing someone who did not err,
    // and it is the same `na()` as rebar-check's. What keeps it from silence is the
    // ⚠ line, which the step prints even when it passes because of the `avisar` field.
    const r = await comNumeros(async () => {}, { documento: '# no markers at all\n' })
    assert.equal(r.codigo, 0, `a document with no markers cannot fail:\n${r.saida}`)
    assert.match(
      r.saida,
      /⚠ nenhum marcador/,
      'with no markers the step passes; if it passes MUTE, the gate becomes decoration',
    )
  })
  // ─────────────────────────── the three defects of FORM that passed in silence
  //
  // Finding of 02/09, by the same method as always: delete the piece and see if the
  // suite goes red. Three pieces of `marcadoresDe`/`documentos` could be
  // deleted with the suite 18 of 18 green — and all three already had their own
  // comment in `numbers.mjs` telling the story of why they exist, which only makes
  // the absence of proof worse: the decision was written and nobody was guarding it.
  //
  //   1. the loop `for (const m of texto.matchAll(ABERTURA))`
  //   2. the recursion of `documentos()` into a subfolder
  //   3. `abreParagrafo`
  //
  // All three are defects of FORM, not of value, and that is why they escaped: the
  // proofs that existed touched the NUMBER, and crooked form changes no number —
  // it makes the number stop being checked, in silence, which is the worst way.

  test('FAILS · marker opened and never closed', async () => {
    // The pair does not match, so the marker vanishes from `matchAll(MARCADOR)` —
    // and with it vanishes the check of the number it fences, with nothing changing
    // on screen. The marker goes in the MIDDLE of the line on purpose: glued to the
    // start it would also trip `abreParagrafo`, and the test would pass by the wrong
    // defect.
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      await escrever('README.md', `${t}\nOpened and never closed: <!--n rules.total-->22\n`)
    })
    assert.notEqual(
      r.codigo,
      0,
      'an orphan opening passed clean, and its number stopped being checked',
    )
    // Both regexes match the METER's output, in Portuguese: leave them alone.
    assert.match(r.saida, /nunca fechado/)
    assert.match(r.saida, /README\.md:\d+/, 'without file:line there is no finding the bent marker')
  })

  test('FAILS · a document in a SUBFOLDER is governed too', async () => {
    // `documentos()` walks the whole tree instead of keeping a list of names,
    // and its comment says why: someone puts a marker in `docs/STACK.md` and the
    // gate goes mute about a number that came into being. Without the recursion,
    // this document is born with the wrong value and nobody notices.
    const r = await comNumeros(async ({ escrever }) => {
      await escrever(
        join('docs', 'PROFUNDO.md'),
        'Rules: <!--n rules.total-->0<!--/n--> in the subfolder.\n',
      )
    })
    assert.notEqual(r.codigo, 0, 'a document in a subfolder stayed outside the gate')
    assert.match(r.saida, /PROFUNDO\.md/, 'failing without naming the subfolder file helps nobody')
  })

  test('FAILS · marker that OPENS a paragraph', async () => {
    // In CommonMark, an HTML comment at column 0 that STARTS a block becomes a raw
    // HTML block, and the rest of the line comes out literal for whoever reads it on
    // GitHub. The mutation invents no marker: it only puts a blank line before a
    // marker that already starts the line in the seed — the value stays up to date,
    // so the only thing that can fail here is the render defect.
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      const alvo = '<!--n rules.deterministicas-->'
      assert.ok(t.includes(`\n${alvo}`), 'the seed lost the marker that starts a line')
      await escrever('README.md', t.replace(`\n${alvo}`, `\n\n${alvo}`))
    })
    assert.notEqual(r.codigo, 0, 'marker opening a paragraph passed clean, and it breaks render')
    // The METER prints this in Portuguese: the regex stays as it is.
    assert.match(r.saida, /ABRE parágrafo/)
  })

  test('FAILS · marker INSIDE a link destination', async () => {
    // THE DEFECT THAT ACTUALLY SHIPPED, and it shipped in the most embarrassing
    // way available to this project: the badge said `rules-26` and GitHub printed
    //
    //   ![Rules](https://img.shields.io/badge/rules-26-blue)
    //
    // as literal text, for weeks. An HTML comment inside `](...)` breaks the
    // markdown. It was not caught because `--verificar` proved the NUMBER was
    // fresh and nobody opened the rendered page: the tooling was checked and the
    // product was not, which is the exact failure this repository exists to stop.
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      await escrever(
        'README.md',
        `${t}\n\n[![Rules](https://img.shields.io/badge/rules-<!--n rules.total-->1<!--/n-->-blue)](#x)\n`,
      )
    })
    assert.notEqual(
      r.codigo,
      0,
      'a marker inside a link destination passed clean, and it breaks render',
    )
    // The METER prints this in Portuguese: the regex stays as it is.
    assert.match(r.saida, /dentro de link/)
  })

  test('the badge number is derived WITHOUT a marker, and a stale one fails', async () => {
    // The other half of the same fix. The number has to keep coming from the
    // source — otherwise the badge is a second source that ages, and this one
    // already did: it said 23 while the MCP served 26. So it is derived by the
    // SHAPE of the shields.io URL instead, which renders and still cannot age.
    const r = await comNumeros(async ({ ler, escrever }) => {
      const t = await ler('README.md')
      await escrever(
        'README.md',
        `${t}\n\n[![Rules](https://img.shields.io/badge/rules-99-blue)](#x)\n`,
      )
    })
    assert.notEqual(r.codigo, 0, 'a badge showing 99 rules passed clean')
    assert.match(r.saida, /rules\.all/)
    assert.match(r.saida, /99/)
  })
})

// ──────────────────────────────── the `sintaxe` step — "is the code code?"
//
// THE FINDING THIS CLOSES, measured on 02/09 with the same method as the finding
// of 31/08 about `checarBlocos`: swapping the body of `checarSintaxe` for
// `return { codigo: 0 }`, this suite still read `pass 18 · fail 0`. Three of the
// gate's `funcao:` steps — `sintaxe`, `higiene` and `hooks` — could be
// emptied without one red line. `checarBlocos` got proof because someone
// looked at it; the neighbours were left out for the same reason it almost
// was.
//
// It gets proof now because it was just REWRITTEN: the serial `execFileSync`
// loop became a `spawn` pool. Rewriting a gate step nobody proves for the sake of
// performance is the cheapest way to switch off a gate by accident.
//
// The temporary root is an empty `git init`, and it is the minimum the step needs:
// `listarMjs` calls `git ls-files --cached --others --exclude-standard`, and
// `--others` already sees a new file without `git add`. With no `.git` the step
// THROWS, and throwing is the contract — the executor classifies it as BROKE (127),
// not as the repository failing.

const VALIDO = 'export const x = 1\n'
const QUEBRADO = 'export const x = (((\n'

/**
 * Builds a temporary root that is a git repository, writes the files
 * asked for and returns what the step answered.
 *
 * `arquivos` is { relative path: content }. `sumir` lists paths that are
 * written, enter the index with `git add` and THEN vanish from disk — it is the
 * only way to stage an index out of sync, which the step has to keep apart from a
 * syntax error.
 */
/**
 * The empty `.git`, created ONCE and copied for each test.
 *
 * Same cut as `proofs/prove.mjs`, for the same reason measured there: `git init`
 * costs ~140 ms on this machine and copying the handful of little files it produces
 * costs a couple of milliseconds. The template is born in the SAME `os.tmpdir()` as
 * the test trees on purpose — `git init` records in `.git/config` what it
 * detected of the file system (filemode, symlinks, ignorecase), and a template
 * created on another volume would carry that wrong detection along.
 */
let promessaDoGitVazio = null
function gitVazio() {
  promessaDoGitVazio ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebar-sintaxe-molde-'))
    const r = spawnSync('git', ['init', '--quiet'], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    })
    assert.equal(r.status, 0, `could not prepare the git template in ${dir}: ${r.stderr ?? ''}`)
    return join(dir, '.git')
  })()
  return promessaDoGitVazio
}

after(async () => {
  if (promessaDoGitVazio) {
    await rm(dirname(await promessaDoGitVazio), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  }
})

async function comArvoreMjs(arquivos, { sumir = [], prazo } = {}) {
  const tmp = await mkdtemp(join(tmpdir(), 'rebar-sintaxe-'))
  const git = (...args) => spawnSync('git', args, { cwd: tmp, encoding: 'utf8', windowsHide: true })
  try {
    await cp(await gitVazio(), join(tmp, '.git'), { recursive: true })
    for (const [rel, texto] of Object.entries(arquivos)) {
      await mkdir(dirname(join(tmp, rel)), { recursive: true })
      await writeFile(join(tmp, rel), texto, 'utf8')
    }
    if (sumir.length) {
      git('add', '-A')
      for (const rel of sumir) await rm(join(tmp, rel), { force: true })
    }
    return await checarSintaxe({ raiz: tmp, prazo: prazo ?? Date.now() + 60_000 })
  } finally {
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

describe('the `sintaxe` step', { concurrency: 5 }, () => {
  test('PASSES · tree of .mjs that compiles', async () => {
    const r = await comArvoreMjs({ 'a.mjs': VALIDO, 'sub/b.mjs': VALIDO })
    assert.equal(r.codigo, 0, `valid .mjs were failed:\n${r.saida}`)
    // The regex matches the STEP's output, in Portuguese: leave it alone.
    assert.match(r.saida, /2 arquivo\(s\)/, 'the step has to say HOW MANY it checked')
  })

  test('FAILS · syntax error, naming the file', async () => {
    const r = await comArvoreMjs({ 'a.mjs': VALIDO, 'ruim.mjs': QUEBRADO })
    assert.equal(r.codigo, 1, `a file that does not compile passed:\n${r.saida}`)
    assert.match(
      r.saida,
      /ruim\.mjs/,
      'failing without saying WHICH file sends you to reread the whole tree',
    )
    assert.match(
      r.saida,
      /SyntaxError/,
      'the node message is what says the LINE; without it there is no hint',
    )
  })

  test('DOES NOT FLAG · .mjs covered by .gitignore stays out of the denominator', async () => {
    // `--exclude-standard` is what keeps node_modules/ out of the count. Without it
    // the step would fail because of a third-party dependency, and a step that
    // fails for what is not the repository's is a step people learn to ignore.
    const r = await comArvoreMjs({
      '.gitignore': 'ignorado/\n',
      'a.mjs': VALIDO,
      'ignorado/ruim.mjs': QUEBRADO,
    })
    assert.equal(r.codigo, 0, `a file ignored by git entered the count:\n${r.saida}`)
  })

  test('ORDER · two broken ones come out in NAME order, not finishing order', async () => {
    // The pool finishes the files out of order. Without the indexed buckets the
    // output would change from one run to the next, and a diff that becomes noise is
    // a diff nobody reads. The names are chosen so that alphabetical order is
    // the REVERSE of the order the processes tend to finish in (the smallest
    // file first), so a report by finishing order fails this test.
    const r = await comArvoreMjs({
      'aaa.mjs': `${QUEBRADO}${'// filler\n'.repeat(400)}`,
      'zzz.mjs': QUEBRADO,
    })
    assert.equal(r.codigo, 1)
    assert.ok(
      r.saida.indexOf('aaa.mjs') < r.saida.indexOf('zzz.mjs'),
      `the report order followed finishing, not the name:\n${r.saida}`,
    )
  })

  test('CODE 2 · file in the index and absent from disk is a bent index, not syntax', async () => {
    // See the step's comment: this really happened, and the step shouted
    // "Erro de sintaxe", sending you to look for the wrong line in a deleted file.
    const r = await comArvoreMjs(
      { 'a.mjs': VALIDO, 'fantasma.mjs': VALIDO },
      {
        sumir: ['fantasma.mjs'],
      },
    )
    assert.equal(r.codigo, 2, `a ghost file turned into a content failure:\n${r.saida}`)
    assert.match(r.saida, /git add -A/, 'the output has to say the command that fixes it')
    assert.doesNotMatch(r.saida, /SyntaxError/, 'a ghost cannot be accused of a syntax error')
  })

  test('DEADLINE · once it expires, the step SAYS how many went unchecked', async () => {
    // With asynchronous `spawn` the executor's clock expires on its own and would
    // kill the step with "tempo limite estourado" and nothing else. Asking for the
    // deadline in here exists only so the output names the hole.
    const r = await comArvoreMjs({ 'a.mjs': VALIDO, 'b.mjs': VALIDO }, { prazo: Date.now() - 1 })
    assert.notEqual(r.codigo, 0, 'an expired deadline cannot come out passed')
    // The regex matches the STEP's output, in Portuguese: leave it alone.
    assert.match(r.saida, /2 arquivo\(s\) ficaram sem checar/)
  })
})

// ────────────────────────────────── the gate cannot shrink in silence
//
// FINDING OF THE 31/08 AUDIT, and it is the most ironic of the module: removing
// the whole `nome: 'mcp'` object from `verify.config.mjs`, the gate printed
// `APROVADO 10 de 10`, green and mute. The mechanism that makes it impossible to
// forget the MCP could itself be forgotten, and nothing in the repository noticed.
//
// The "N of N" count is the trap: it measures against its own list, so a
// shorter list is still complete. A gate that measures itself by itself passes
// any shrinkage.
//
// WHERE THE RECURSION STOPS, and it is worth saying instead of pretending it is
// closed: this test can be deleted along with it. What it buys is that deleting a
// step now demands TWO edits, in two files, in a diff review sees. The true fixed
// point is the ruleset on the server, which requires the `verificar` check by name
// and lives in no file of this repository — it is the N4s, and it is the only level
// the agent does not edit.

const PASSOS_ESPERADOS = [
  'hygiene',
  'hooks',
  'commit-msg',
  'syntax',
  'blocks',
  'mcp-server',
  'mcp',
  'numbers',
  'format',
  'links',
  'secret',
  'secret-proofs',
  'steps',
  'strip',
  'proofs',
  'generator-map',
  'generator-identity',
  'mcp-template',
  'security',
  'security-table',
  'security-self',
  'self',
]

test('THE GATE DOES NOT SHRINK · every expected step is still in the list', async () => {
  const config = await import('../../verify.config.mjs')
  const nomes = (config.default ?? []).map((p) => p.nome)

  const sumiram = PASSOS_ESPERADOS.filter((n) => !nomes.includes(n))
  assert.deepEqual(
    sumiram,
    [],
    `step(s) removed from verify.config.mjs without taking them out of this list: ${sumiram.join(', ')}.\n` +
      `If the removal is intentional, take the name out of PASSOS_ESPERADOS in the same commit — ` +
      `that is what makes the shrinkage visible in review.`,
  )

  // The reverse is not an error: a NEW step not yet in the list only needs to be
  // added. It stays as a warning, without failing, because failing here would punish
  // whoever is precisely adding gate.
  //
  // The ⚠ in front is what makes the warning GET THROUGH (finding of 02/09). The
  // line was `nota: …`, and a note without a mark is a note that dies in here: the
  // `verificar` executor discards the stdout of every step that passes, and the
  // `passos` step did not declare `avisar`. The warning existed and reached nobody —
  // which is worse than not existing, because it gives the impression someone is looking.
  //
  // The ⚠ prefix is matched by `avisar: /^\s*⚠/` in verify.config.mjs: keep it first.
  const novos = nomes.filter((n) => !PASSOS_ESPERADOS.includes(n))
  if (novos.length) {
    console.log(
      `⚠ new step(s) outside PASSOS_ESPERADOS: ${novos.join(', ')} — ` +
        'add them there in the same commit, otherwise deleting them later goes mute again',
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// THE VERDICT OF EACH STEP — broke is not failed, and mute is not passed
//
// The `verify.mjs` header has declared this in lines 17-25 since it
// existed: 127 is the ruler breaking, 1 is the repository saying no, and "sem a
// distinção, o bug do verificador entra na conta como se fosse defeito do
// repositório auditado" [without the distinction, the verifier's bug goes on the
// bill as if it were a defect of the audited repository]. Its two executors —
// subprocess and function — read "different from zero" as failed, and no test looked.
//
// Worse: `Number(r?.codigo ?? 0)`. A function that returned `undefined`, `null`,
// `{}` or forgot the field came out with code 0 and the step PASSED. A mute step
// turning into a passed step is the cheapest form of false gate, and the hardest to
// notice, because the scoreboard stays green.
//
// The forge runs the REAL executor, with a config in tmpdir. It complains that
// the config is external to the working tree, and that is what we want: external
// exits 3, and both `quebrou` (127) and `reprovou` (1) DOMINATE that 3 — the last
// assertion down here is that dominance.

/** Runs the executor over a forged config and returns its JSON. */
async function comForja(passos) {
  const dir = await mkdtemp(join(tmpdir(), 'rebar-forja-'))
  try {
    const config = join(dir, 'forja.config.mjs')
    await writeFile(config, `export default [\n${passos.join(',\n')},\n]\n`, 'utf8')
    const r = spawnSync(
      process.execPath,
      [join(RAIZ, 'tooling', 'verify', 'verify.mjs'), `--config=${config}`, '--json'],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
    )
    return { json: JSON.parse(r.stdout), status: r.status }
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
}

// The state values asserted below — `passou`, `reprovou`, `quebrou` and the
// `reprovado` result — are the executor's own JSON, not prose: verify.mjs writes
// those exact strings, so translating them here would compare against a value
// nothing produces. Same for the `nome:` of each forged step.
const estadoDoPasso = (json, nome) => json.passos.find((p) => p.nome === nome)?.estado

test('A MISSING VERDICT IS A BREAK · a function that returns nothing does not pass', async () => {
  const { json } = await comForja([
    '{ nome: "mudo", funcao: () => undefined }',
    '{ nome: "vazio", funcao: () => ({}) }',
    '{ nome: "nulo", funcao: () => null }',
    '{ nome: "texto", funcao: () => ({ codigo: "zero" }) }',
  ])
  for (const nome of ['mudo', 'vazio', 'nulo', 'texto']) {
    assert.equal(
      estadoDoPasso(json, nome),
      'quebrou',
      `the step "${nome}" returned no verdict and the executor cannot call that passed`,
    )
  }
  assert.equal(json.resultado, 'quebrou')
})

test('CODE 127 IS THE RULER BREAKING · it is not the repository failing', async () => {
  // In both executors, because they are two different code paths.
  const { json } = await comForja([
    '{ nome: "funcao-127", funcao: () => ({ codigo: 127, saida: "missing command" }) }',
    `{ nome: "processo-127", comando: [process.execPath, "-e", "process.exit(127)"] }`,
  ])
  assert.equal(estadoDoPasso(json, 'funcao-127'), 'quebrou')
  assert.equal(estadoDoPasso(json, 'processo-127'), 'quebrou')
})

test('CODE 2 IS A BENT STATE · and `checarSintaxe` already said so in writing', async () => {
  // `verify.config.mjs` returns 2 when the git index lists a file that is not
  // on disk, with the comment "O executor não trata isso como reprovação de
  // conteúdo" [the executor does not treat this as a content failure]. The executor
  // did treat it that way, and the comment had been lying for months.
  const { json } = await comForja([
    '{ nome: "indice-torto", funcao: () => ({ codigo: 2, saida: "git lists a ghost" }) }',
  ])
  assert.equal(estadoDoPasso(json, 'indice-torto'), 'quebrou')
})

test('AND THE REST STILL FAILS · the fix did not loosen the gate', async () => {
  const { json } = await comForja([
    '{ nome: "passa", funcao: () => ({ codigo: 0, saida: "ok" }) }',
    '{ nome: "reprova", funcao: () => ({ codigo: 1, saida: "found something wrong" }) }',
    `{ nome: "processo-reprova", comando: [process.execPath, "-e", "process.exit(1)"] }`,
  ])
  assert.equal(estadoDoPasso(json, 'passa'), 'passou')
  assert.equal(estadoDoPasso(json, 'reprova'), 'reprovou')
  assert.equal(estadoDoPasso(json, 'processo-reprova'), 'reprovou')
  assert.equal(json.resultado, 'reprovado')
})

test('127 DOMINATES 1 · you do not accuse a repository with a ruler that broke', async () => {
  const { json, status } = await comForja([
    '{ nome: "reprova", funcao: () => ({ codigo: 1, saida: "found something wrong" }) }',
    '{ nome: "quebra", funcao: () => ({ codigo: 127, saida: "could not run it" }) }',
  ])
  assert.equal(json.resultado, 'quebrou')
  assert.equal(json.codigoSaida, 127)
  assert.equal(status, 127)
})
