#!/usr/bin/env node
// The proofs of the generator's FILE MAP.
//
// WHY THIS FILE EXISTS, and it is the most expensive lesson in this tree.
//
// During the translation of the names into English, a `sed` swapped the
// references that had the shape of a path and no template file. `aplicar.mjs`
// started reading `verify.yml` from a folder where the file is called
// `verificar.yml`, and the emitted hooks started calling
// `.githooks/varrer-segredo.mjs` while the copied file was called
// `scan-secret.mjs`.
//
// `rebar new` died with ENOENT on the fourth static file. And `npm run verify`
// STAYED 15 OF 15 GREEN through the entire renaming, for six commits, because no
// gate step generates a project. The checker proves itself, the rules prove
// themselves, the MCP proves itself, the gate proves itself — and the product
// does not.
//
// WHY NOT GENERATE A WHOLE PROJECT HERE. Real generation runs `npm create vite`,
// `shadcn` and `npm install`: minutes, network, and a gate step nobody expects
// is a step somebody turns off. What broke was not the generation, it was the
// MAP — names that stopped matching. So what gets proved is the map, in
// milliseconds and with no network.
//
// Usage:  node --test new/gate/prove-map.mjs

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test, { describe } from 'node:test'

import { ESTATICOS, COPIADOS_DO_REBAR, EXECUTAVEIS, moldeAgents } from './aplicar.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')
const MOLDES = join(AQUI, 'arquivos')

/** The set of paths the generator WRITES into the created project. */
const emitidos = new Set([...ESTATICOS, ...COPIADOS_DO_REBAR].map(([, destino]) => destino))

describe('the file map of the generator', { concurrency: 4 }, () => {
  test('every ESTATICOS source exists in new/gate/arquivos/', () => {
    const faltando = ESTATICOS.filter(([fonte]) => !existsSync(join(MOLDES, fonte))).map(([f]) => f)
    assert.deepEqual(
      faltando,
      [],
      `the generator reads a template that does not exist — it is the ENOENT that killed \`rebar new\`:\n  ${faltando.join('\n  ')}`,
    )
  })

  test('every COPIADOS_DO_REBAR source still exists in rebar', () => {
    const faltando = COPIADOS_DO_REBAR.filter(([fonte]) => !existsSync(join(RAIZ, fonte))).map(
      ([f]) => f,
    )
    assert.deepEqual(
      faltando,
      [],
      `the generator copies a file from rebar that is no longer there (renamed?):\n  ${faltando.join('\n  ')}`,
    )
  })

  // THE DEFECT THAT WENT UNNOTICED THE LONGEST. Both sides were right apart:
  // the file was copied under the English name, and the hook called the
  // Portuguese name. Each file existed; it was the pair that did not close.
  test('every .githooks/*.mjs a template CALLS is a file the generator EMITS', () => {
    const chamados = new Set()
    for (const nome of readdirSync(MOLDES)) {
      const t = readFileSync(join(MOLDES, nome), 'utf8')
      for (const m of t.matchAll(/\.githooks\/[A-Za-z0-9._-]+\.mjs/g)) chamados.add(m[0])
    }
    const orfaos = [...chamados].filter((c) => !emitidos.has(c))
    assert.deepEqual(
      orfaos,
      [],
      `a template calls a file the generator does not write — the hook of the created project breaks on the first commit:\n  ${orfaos.join('\n  ')}`,
    )
  })

  test('the files marked executable are among the emitted ones', () => {
    const orfaos = EXECUTAVEIS.filter((e) => !emitidos.has(e))
    assert.deepEqual(
      orfaos,
      [],
      `marks 100755 on a file that is not emitted:\n  ${orfaos.join('\n  ')}`,
    )
  })

  // Counter-bait: a source that exists but is never emitted is a dead template,
  // and a dead template ages without anyone noticing. `agentes.md` is the
  // declared exception — it goes through `moldeAgents` instead of being copied,
  // and `aplicar.mjs` itself explains why.
  test('no template is left orphaned in new/gate/arquivos/', () => {
    const usados = new Set(ESTATICOS.map(([fonte]) => fonte))
    const EXCECOES = new Set(['agentes.md', 'modelo.json'])
    const orfaos = readdirSync(MOLDES).filter((n) => !usados.has(n) && !EXCECOES.has(n))
    assert.deepEqual(
      orfaos,
      [],
      `a template nobody copies — either it goes into ESTATICOS, or it leaves the folder:\n  ${orfaos.join('\n  ')}`,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE GENERATED PROJECT HAS TO HAVE A WAY TO PUBLISH — and not around the gate
//
// P2 #9. The generator ships a Next configured for static export
// (`output: "export"`, `trailingSlash`, `images.unoptimized`) and a `.pages.yml`
// for the Pages CMS: everything pointing at GitHub Pages, and no job that would
// publish. The project was born with everything to publish and nothing that
// publishes.
//
// It was measured in `rebar-site`, which this generator generated: publishing
// required writing the job by hand in there, and the solution stayed in the
// project instead of coming back to the template. "Derivado, nunca duplicado"
// [derived, never duplicated] — the principle as docs/PLANO.md words it, kept in
// Portuguese so the phrase still leads there — exists for exactly this.
//
// The second assertion is the one that matters more than the first. Having a
// deploy is worth nothing if it can run with the gate red: a publishing job with
// no `needs` is a path parallel to the gate, and the gate turns into a report.
describe('the workflow the generator emits', () => {
  // COMMENTS OUT BEFORE LOOKING, and the reason showed up on the first run of
  // these tests: the comment that EXPLAINS why the `.nvmrc` went away contains
  // the string `.nvmrc`, and the test read the explanation as a directive —
  // failing the very fix. It is the same trap that rebar-check's `ci-gates` had
  // already solved by extracting only the values of `run:`. A comment does not
  // execute.
  const yml = readFileSync(join(MOLDES, 'verificar.yml'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join(String.fromCharCode(10))

  /** The workflow jobs, with the body of each one. Two-space indentation. */
  const jobs = () => {
    const corpo = yml.slice(yml.indexOf(String.fromCharCode(10) + 'jobs:') + 1)
    const achados = []
    const marcas = [...corpo.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)]
    marcas.forEach((m, i) => {
      const fim = i + 1 < marcas.length ? marcas[i + 1].index : corpo.length
      achados.push({ nome: m[1], corpo: corpo.slice(m.index, fim) })
    })
    return achados
  }

  // ── that it publishes
  //
  // The generator ships a Next with `output: "export"` and a `.pages.yml`:
  // everything pointing at GitHub Pages, and until 2026-09-06 nothing that would
  // publish. It was measured in rebar-site, which this generator generated —
  // publishing required writing the job by hand in there, and the solution
  // stayed in the project instead of coming back to the template.
  test('the emitted workflow has a job that publishes', () => {
    const publica = jobs().filter((j) => /actions\/deploy-pages/.test(j.corpo))
    assert.equal(
      publica.length,
      1,
      'the `site` preset is born ready for GitHub Pages and with nothing that publishes it',
    )
  })

  test('AND IT DOES NOT RUN AROUND THE GATE · every deploy depends on `verificar`', () => {
    for (const j of jobs().filter((x) =>
      /actions\/deploy-pages|upload-pages-artifact/.test(x.corpo),
    )) {
      assert.match(
        j.corpo,
        /^\s+needs: verificar$/m,
        `job "${j.nome}" publishes without depending on the gate — a parallel deploy ships the ` +
          `page with the lint broken, and then the gate is a report, not a door`,
      )
    }
  })

  test('the permission to write to Pages stays ONLY in the job that publishes', () => {
    // `permissions: pages: write` at the top would hand the key to every job in
    // the file, including the one that runs code from a third-party PR.
    const topo = yml.slice(0, yml.indexOf(String.fromCharCode(10) + 'jobs:'))
    assert.doesNotMatch(
      topo,
      /pages:\s*write/,
      'the Pages permission leaked into the scope of the file',
    )
  })

  // ── and that it does not cite a file that does not exist
  //
  // Same test that already existed for the hooks — "every `.githooks/*.mjs` a
  // template CALLS is a file the generator EMITS" — applied to the workflow,
  // which is where it was missing and where it cost: the `publicar` job came
  // pasted over from rebar-site with `node-version-file` pointing at a `.nvmrc`
  // the generator does not write. The only job with `pages: write` died in
  // setup-node, and `generator-map` stayed green because it checked the STRUCTURE
  // of the job, never its dependencies.
  const noProjeto = new Set([...emitidos, 'AGENTS.md', '.rebar-coauthors', 'package.json'])

  test('`node-version-file` points at an emitted file, or does not exist', () => {
    for (const m of yml.matchAll(/node-version-file:\s*['"]?([^'"\s]+)/g)) {
      assert.ok(
        noProjeto.has(m[1]),
        `the workflow asks for "${m[1]}" and the generator does not write that file — setup-node ` +
          `dies and the whole job never runs. Either emit the file, or pin the version with \`node-version:\``,
      )
    }
  })

  test('every file path cited in `run:` is emitted', () => {
    // Only a path with a folder and a known extension: `npm run x` is not a file.
    for (const m of yml.matchAll(/^\s*(?:- )?run:\s*(.+)$/gm)) {
      for (const alvo of m[1].matchAll(
        /(?:^|\s)([\w.-]+\/[\w.\/-]+\.(?:mjs|js|cjs|json|yml|yaml))/g,
      )) {
        assert.ok(
          noProjeto.has(alvo[1]),
          `the workflow runs "${alvo[1]}", which the generator does not write`,
        )
      }
    }
  })
})

// The AGENTS.md of the GENERATED PROJECT — and it is the generated one, not the
// template.
//
// The `portao.test.mjs` the generator emits makes seven assertions about that
// file, and until 2026-09-07 nothing ran them here. Two divergences lived off
// that:
//
//   · the template sent the reader to `.rebar-coautores`, under the old name,
//     and the emitted test checks `.rebar-coauthors`. The project's `npm test`
//     failed on day one — the day the owner trusts what he received the most.
//   · the first version of THIS test grabbed one assertion only, with `.exec()`,
//     and claimed it was the allowlist one. There are seven, and `.exec()`
//     returns the first: it checked the `npx` and passed with the wrong
//     allowlist name. A test that passes for the wrong reason is worse than no
//     test, because it takes up its place.
//
// The target is the output of `moldeAgents`, which is what goes to disk. One of
// the seven lives inside `if (abre)` and only holds when the shadcn block was
// inserted — that is why the block comes in here, and why it comes in with the
// content the emitted test looks for.
//
// The block below stays in Portuguese on purpose: it is a fixture standing in
// for what the third-party scaffold writes, not prose of this repository.
const BLOCO_DO_SHADCN = [
  '<!-- BEGIN:nextjs-agent-rules -->',
  'Consulte a documentação em node_modules/next/dist/docs quando precisar.',
  '<!-- END:nextjs-agent-rules -->',
].join(String.fromCharCode(10))

describe('the AGENTS.md the generator writes', () => {
  const teste = readFileSync(join(MOLDES, 'portao.test.mjs'), 'utf8')
  // Non-greedy up to the slash followed by a comma or a parenthesis: that is the
  // end of the regex literal, and only that. The naive version `[^/]+` cut
  // `github:Navesz\/rebar` in half, and the truncated piece matched almost
  // everything.
  const exigidos = [...teste.matchAll(/assert\.match\(\s*agents,\s*\/(.+?)\/[,)]/g)].map(
    (m) => m[1],
  )

  test('the emitted test still demands something of the AGENTS.md', () => {
    assert.ok(
      exigidos.length >= 5,
      `portao.test.mjs checks ${exigidos.length} thing(s) in the AGENTS.md — if it dropped to ` +
        `fewer, somebody took an assertion out of the test that goes to the user`,
    )
  })

  test('AND THE GENERATED FILE SATISFIES EVERY ONE OF THEM', () => {
    const agents = moldeAgents('padaria-do-ze', BLOCO_DO_SHADCN)
    const faltando = exigidos.filter((fonte) => !new RegExp(fonte).test(agents))
    assert.deepEqual(
      faltando,
      [],
      `the test the generator EMITS demands this of the AGENTS.md and the generated file does ` +
        `not have it: ${faltando.join(' · ')}. The \`npm test\` of the project fails on day one.`,
    )
  })

  test('the shadcn block passes through intact — it is what the `if (abre)` talks about', () => {
    const agents = moldeAgents('padaria-do-ze', BLOCO_DO_SHADCN)
    assert.ok(
      agents.includes(BLOCO_DO_SHADCN),
      'the third-party block was altered on the way. The template says it stays INTACT on ' +
        'purpose: it talks about the installed Next version and ages along with it',
    )
  })

  test('with no third-party block no orphan heading is left over', () => {
    const agents = moldeAgents('padaria-do-ze', '')
    assert.doesNotMatch(
      agents,
      // Portuguese on purpose: this matches the heading `aplicar.mjs` writes
      // into the generated AGENTS.md. Translating it here stops the match.
      /Aviso do scaffold/,
      'with no block, the section that wraps it cannot appear — a heading pointing at nothing would be left',
    )
    assert.equal(
      agents.includes('BEGIN:nextjs-agent-rules'),
      agents.includes('END:nextjs-agent-rules'),
      'the `nextjs-agent-rules` block was left half done',
    )
  })

  test('the project name goes in, and no template marker is left raw', () => {
    const agents = moldeAgents('padaria-do-ze', BLOCO_DO_SHADCN)
    assert.match(agents, /padaria-do-ze/, 'the project name was not substituted in the template')
    assert.doesNotMatch(
      agents,
      /{{\s*nome\s*}}/,
      'a raw `{{nome}}` marker was left in the generated file',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE SUBCOMMAND THAT HANDS OVER THE GENERATOR HAS TO ACTUALLY DISPATCH
//
// The file existing is not enough: the dispatcher builds its path in code, and a
// path built wrong is invisible to every structural test.
//
// That was the defect. `join(RAIZ, 'novo', 'index.mjs')`, and the folder has
// been called `new/` since the rename: `rebar novo` ALWAYS exited 2 saying the
// generator was "not in this checkout", and the gate was green the whole time
// because nothing ran it. Second time for this exact class — on 2026-09-05
// `aplicar.mjs` read `verify.yml` from a folder where the file is
// `verificar.yml`, and the gate stayed 15/15 green for six commits.
//
// This test runs the real binary. It does not generate a project — generation is
// `npm create vite` plus network, minutes, and a step somebody switches off —
// but it reaches the exact point where both defects lived: the generator import.
test('`rebar new` reaches the generator instead of saying it is not here', () => {
  const r = spawnSync(
    process.execPath,
    [join(RAIZ, 'tooling', 'rebar-check', 'index.mjs'), 'new'],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
    },
  )
  const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`

  assert.doesNotMatch(
    saida,
    /not in this checkout/,
    `the dispatcher built a path that does not exist. It is the 2026-09-07 defect coming ` +
      `back: the folder is \`new/\` and the path pointed at \`novo/\`.\n\n${saida}`,
  )
  // With no project name the generator complains about the NAME — and complaining
  // about the name proves it loaded. That is the positive assertion: without it, a
  // dispatcher that died silently would pass.
  assert.match(
    saida,
    /project name|nome do projeto|usage:/i,
    `the generator never got as far as complaining about the missing name, so it ` +
      `probably did not load:\n\n${saida}`,
  )
})

// The path the dispatcher builds, checked against disk. It is the cheap half of
// the test above, and it gives the right message when the `spawnSync` fails for
// some other reason.
test('the generator path named in the dispatcher exists on disk', () => {
  const checker = readFileSync(join(RAIZ, 'tooling', 'rebar-check', 'index.mjs'), 'utf8')
  const m = /const gerador = join\(RAIZ, '([^']+)', '([^']+)'\)/.exec(checker)
  assert.ok(m, 'the generator dispatcher changed shape — this test went blind, fix it')
  assert.ok(
    existsSync(join(RAIZ, m[1], m[2])),
    `the dispatcher points at ${m[1]}/${m[2]}, which is not on disk`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// O PROJETO GERADO NASCE COM UM LOCKFILE QUE O `npm ci` DO RUNNER ACEITA
//
// Três projetos seguidos bateram no mesmo muro — rebar-site, navesz-portfolio e
// assay — e as três vezes o conserto ficou no consumidor:
//
//   npm error Missing: @emnapi/runtime@1.11.3 from lock file
//
// A causa não é o projeto, é a ferramenta: essas dependências são OPCIONAIS e
// resolvidas por plataforma, e o npm da máquina que gera escreve uma árvore que
// o npm do runner recusa. Fixar a versão obriga o npm a gravá-las.
//
// E o `npm ci` LOCAL aceita a árvore que o runner recusa, então conferir na
// própria máquina dá falso verde. Este teste é estrutural de propósito: ele não
// tenta reproduzir o npm, ele confere que a trava que resolve está lá.
test('o gerador fixa as opcionais de plataforma no package.json', () => {
  const fonte = readFileSync(join(AQUI, 'aplicar.mjs'), 'utf8')
  // Sem recortar o objeto: a versão que tentava capturar o bloco com regex
  // não-gulosa parava no `}` do spread `...(pkg.overrides ?? {})` e reprovava o
  // conserto correto. O que importa é que o gerador escreva `overrides` e que os
  // três pacotes estejam no arquivo — recortar o literal é precisão que este
  // teste não precisa e que ele erra.
  assert.match(
    fonte,
    /pkg\.overrides = \{/,
    'o gerador parou de escrever `pkg.overrides` — o próximo projeto nasce com um lockfile ' +
      'que o `npm ci` do CI recusa, e o build local não acusa',
  )
  for (const pacote of ['@emnapi/core', '@emnapi/runtime', '@emnapi/wasi-threads']) {
    assert.ok(
      fonte.includes(`'${pacote}'`),
      `${pacote} saiu dos overrides — foi ele que reprovou o CI de três projetos seguidos`,
    )
  }
})
