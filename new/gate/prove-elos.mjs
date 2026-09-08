#!/usr/bin/env node
// THE LINKS THAT WERE MISSING FROM THE GENERATED PROJECT'S CHAIN.
//
// THE MEASUREMENT, 2026-09-07. rebar charges itself for 23 verify steps. The
// projects it generates ran 6 — lint, typecheck, test, build and the two halves
// of `publicado`. Three of the missing ones already bite today, and each one has
// a name and a bill:
//
//   format  · `npx prettier --check .` inside `assay` accused 32 files, and 15
//             of them had been WRITTEN BY THIS GENERATOR. Two formatters in
//             permanent disagreement, and no link that would ever say so.
//   links   · rebar has had a link checker since PR #24 — "o README tinha dois
//             badges saindo como texto, e eu nunca olhei a página" — and it never
//             came down into the projects.
//   secret  · the pre-commit hook scans only what is STAGED, and it is N5: it
//             disappears with `--no-verify`. The generated CI scanned for no
//             secret at all, so a credential committed that way reached main with
//             the badge green.
//
// This file proves the two halves of the cure that live in this folder: the link
// checker that ships, and the chain that has to reach it. Both directions, both
// offline.
//
//   node --test new/gate/prove-elos.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { CHECK_LINKS, garantirScripts, PASTA_HOOKS, PORTAO_REMOTO } from './aplicar.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const MOLDES = join(AQUI, 'arquivos')

/** A git repository in the tmpdir, with files staged so `git ls-files` sees them. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-elos-'))
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true })
  git('init', '-q')
  const escrever = (rel, texto) => {
    const caminho = join(dir, ...rel.split('/'))
    mkdirSync(dirname(caminho), { recursive: true })
    writeFileSync(caminho, texto, 'utf8')
  }
  return {
    dir,
    git,
    escrever,
    /** Puts the shipped checker where the project keeps it, and runs it. */
    rodarLinks() {
      const alvo = join(dir, ...CHECK_LINKS.split('/'))
      mkdirSync(dirname(alvo), { recursive: true })
      copyFileSync(join(MOLDES, 'check-links.mjs'), alvo)
      const r = spawnSync(process.execPath, [alvo], {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
      })
      return { status: r.status, saida: `${r.stdout ?? ''}${r.stderr ?? ''}` }
    },
    fim: () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }),
  }
}

test('THE CASE THAT PASSES · every reference of the README is in the repository', () => {
  const r = repo()
  try {
    r.escrever('docs/manual.md', '# manual\n')
    r.escrever('public/tela.png', 'nao-e-uma-imagem-de-verdade')
    r.escrever(
      'README.md',
      '# projeto\n\n[o manual](docs/manual.md)\n\n![a tela](public/tela.png)\n',
    )
    r.git('add', '-A')

    const saida = r.rodarLinks()
    assert.equal(saida.status, 0, `a whole README came out broken:\n${saida.saida}`)
    assert.match(saida.saida, /no broken relative link or image/)
  } finally {
    r.fim()
  }
})

test('THE CASE THAT FAILS · the image is on the disk and NOT in the repository', () => {
  // This is the defect, and it is invisible to `existsSync`: GitHub renders the
  // README from the REPOSITORY. A screenshot that was generated, referenced and
  // never committed looks right in the editor and comes out as a broken image
  // icon for everybody who opens the page.
  const r = repo()
  try {
    r.escrever('README.md', '# projeto\n\n![a tela](public/tela.png)\n')
    r.escrever('public/tela.png', 'na-arvore-de-trabalho-e-so')
    // Only the README is staged. The image exists on disk and git does not know it.
    r.git('add', 'README.md')

    const saida = r.rodarLinks()
    assert.equal(saida.status, 1, `the broken image passed:\n${saida.saida}`)
    assert.notEqual(saida.status, 127, `the checker broke instead of failing:\n${saida.saida}`)
    assert.match(saida.saida, /public\/tela\.png/, 'the message does not name the file')
    // Naming WHICH of the two failures it is: `git add` fixes one of them and
    // fixes nothing at all in the other.
    assert.match(saida.saida, /NOT in the repository/, 'the message does not name the cause')
  } finally {
    r.fim()
  }
})

test('a link to nowhere fails, and a fenced example does not', () => {
  const r = repo()
  try {
    r.escrever(
      'README.md',
      '# projeto\n\n[sumiu](docs/sumiu.md)\n\n```\n[exemplo](tambem-nao-existe.md)\n```\n',
    )
    r.git('add', '-A')

    const saida = r.rodarLinks()
    assert.equal(saida.status, 1, `the dead link passed:\n${saida.saida}`)
    assert.match(saida.saida, /docs\/sumiu\.md/)
    // A checker that fails on the tutorial showing a path is a checker somebody
    // switches off, and a switched-off checker measures zero.
    assert.doesNotMatch(saida.saida, /tambem-nao-existe/, 'it accused an example inside a fence')
    assert.match(saida.saida, /1 broken reference/, 'it counted more than the one real failure')
  } finally {
    r.fim()
  }
})

test('an external link and a same-page anchor are nobody else here to resolve', () => {
  const r = repo()
  try {
    r.escrever(
      'README.md',
      '# p\n\n[site](https://exemplo.com/x)\n[topo](#p)\n[mail](mailto:a@b.c)\n',
    )
    r.git('add', '-A')
    const saida = r.rodarLinks()
    assert.equal(saida.status, 0, `an absolute link was treated as a path:\n${saida.saida}`)
  } finally {
    r.fim()
  }
})

// ─────────────────────────────────────────────────── the chain that reaches them
//
// A checker nobody calls is the exact defect this repository keeps paying for:
// `mcp/src/prova-cliente.mjs` sat 370 lines long, called by no step, for weeks.
// The two tests below hold `garantirScripts` to what it promises — with the
// files there, the chain reaches them; without the files, it does not name them.

function projeto(scriptsDoScaffold, arquivos = []) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-cadeia-'))
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'p', scripts: scriptsDoScaffold }, null, 2)}\n`,
    'utf8',
  )
  for (const rel of arquivos) {
    const caminho = join(dir, ...rel.split('/'))
    mkdirSync(dirname(caminho), { recursive: true })
    writeFileSync(caminho, '// presente\n', 'utf8')
  }
  return {
    dir,
    ler: () => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')),
    fim: () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }),
  }
}

const SCRIPTS_DO_SCAFFOLD = {
  dev: 'next dev',
  build: 'next build',
  lint: 'eslint',
  typecheck: 'tsc --noEmit',
  // What `shadcn create` really writes, and it is half a formatter: it cannot
  // repair the .mjs, .json and .yml this gate itself puts into the project.
  format: 'prettier --write "**/*.{ts,tsx}"',
}

test('THE CHAIN · with the files there, `verificar` reaches all four new links', () => {
  const p = projeto(SCRIPTS_DO_SCAFFOLD, [
    `${PASTA_HOOKS}/scan-secret.mjs`,
    CHECK_LINKS,
    PORTAO_REMOTO,
  ])
  try {
    const avisos = []
    const elos = garantirScripts(p.dir, avisos)
    const pkg = p.ler()

    for (const elo of ['format-check', 'links', 'secret', 'portao-remoto']) {
      assert.ok(elos.includes(elo), `\`${elo}\` did not enter the chain`)
      assert.match(
        pkg.scripts.verificar,
        new RegExp('\\b' + elo + '\\b'),
        `the \`verificar\` script does not reach \`${elo}\``,
      )
    }
    // The writer is replaced, not kept: the scaffold's covered only ts/tsx, so
    // `npm run format` could not fix what `format-check` rejects.
    assert.equal(pkg.scripts.format, 'prettier --write .')
    // `portao-remoto` last, after the build: it is the only link whose fix is a
    // token and not a code edit, and blocking the build behind it makes the
    // chain unrunnable — which is how a chain gets deleted.
    assert.ok(
      pkg.scripts.verificar.indexOf('portao-remoto') > pkg.scripts.verificar.indexOf('build'),
      'the remote gate went in front of the build',
    )
    assert.deepEqual(avisos, [], `it warned about a complete project: ${avisos.join(' | ')}`)
  } finally {
    p.fim()
  }
})

test('THE INVERSE · with the files missing, the chain does not name them', () => {
  // A script pointing at a file that is not there turns a warning somebody can
  // read into a chain that breaks for a reason nobody can. `COPIADOS_DO_REBAR`
  // already says out loud when a copy failed; the chain must not say it twice
  // and worse.
  const p = projeto(SCRIPTS_DO_SCAFFOLD)
  try {
    const elos = garantirScripts(p.dir, [])
    const pkg = p.ler()
    for (const elo of ['links', 'secret', 'portao-remoto']) {
      assert.ok(!elos.includes(elo), `\`${elo}\` entered the chain with no file behind it`)
      assert.ok(!pkg.scripts[elo], `\`${elo}\` was written pointing at a file that is not there`)
    }
    // `format-check` stays: prettier is a devDependency of the scaffold, not a
    // file this gate copies, so there is nothing here for it to be missing.
    assert.ok(elos.includes('format-check'))
  } finally {
    p.fim()
  }
})
