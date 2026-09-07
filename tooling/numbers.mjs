#!/usr/bin/env node
// numbers.mjs — the numbers in the README and in ESTADO are not typed. This file writes them.
//
// WHY IT EXISTS, and the defect is not hypothetical: it has happened SIX TIMES.
// Measured in this tree on 02/09/2026, before this line existed:
//
//   fact                        the README said   the truth
//   deterministic rules         16                17
//   proof cases                 50                52
//   rules with proof            21 of 21          22 of 22
//   `verificar` steps           8                 12
//
// And ESTADO.md carries FOUR different proof-case counts scattered through the
// same file — 13, 33, 47 and 50 —, of which at most one can be right. ESTADO
// itself opens with a section admitting it has already got a number wrong three
// times ("disse 20 checagens quando eram 19" [said 20 checks when there were 19]),
// and has got three more wrong since.
//
// The cause is STRUCTURAL and attention does not make it go away: the numbers are
// written by hand and the truth changes every commit. Writing more carefully is the
// answer that has already failed six times; the whole repository exists to say that
// a rule in markdown has close to zero compliance and a rule in a gate has 100%.
//
// THE HOUSE DOCTRINE ALREADY SOLVED THIS ONCE, in `mcp/generate.mjs`, and this
// file is the same shape applied to the second place where the defect lives:
//
//   DERIVED, NEVER TYPED    no number in this file is typed here. Every fact has
//                           a SOURCE on disk and a one-line derivation. There are
//                           no two sources to diverge — there is one source and
//                           one projection of it inside the text.
//   ONE COMMAND REGENERATES `node tooling/numbers.mjs`
//   ONE GATE FAILS          `--verificar` recomputes IN MEMORY, compares with what
//                           is written in the documents, and exits 1 if they
//                           diverge. It is the `numeros` step of `verificar`, and
//                           it is what makes committing a stale document impossible.
//
// ZERO DEPENDENCIES, and this is not a preference: this file runs in the root
// `verificar`, which has to work on a clean clone. Node built-ins only.
//
// ─────────────────────────────────────────────────────────────────────────────
// (a) THE SHAPE OF THE MARKUP IN THE MARKDOWN — this module's design decision.
//
// The document has to SAY the number, and whoever reads it has to keep reading
// ordinary markdown. Three shapes were weighed against three criteria: render well
// on GitHub, not pollute the reading, and produce a small diff on regeneration.
//
//   1. A WHOLE GENERATED BLOCK, between HTML comments.
//      Rejected. The README's number is almost never alone: it is INSIDE the
//      sentence ("**16 deterministic** bring down the exit code", "the gate's
//      `mcp` step — 5 of 11"). A generated block containing the sentence makes
//      the generator the owner of the PROSE, and prose moves into a `.mjs` —
//      which is the second source §7.2 of the plan forbids, only with the prose
//      on the wrong side. The diff cost is worse too: the block reprints whole
//      for one digit.
//
//   2. A SINGLE GENERATED TABLE, and the text only points at it.
//      Rejected, and it is the worst of the three for this repository. It would
//      trade "**17 deterministic** bring down the exit code" for "the
//      deterministic ones (see table) bring down the exit code". The README's
//      value is the number being IN the sentence that uses it; pushing it into a
//      distant table is the same distance between decision and use that rebar
//      accuses others of.
//
//   3. AN INLINE MARKER PER NUMBER. CHOSEN.
//        **<!--n rules.deterministicas-->17<!--/n--> deterministic**
//      · IT RENDERS: an HTML comment is invisible on GitHub, and is legal inline
//        in CommonMark — the `**` still opens strong emphasis because it comes
//        after a space and before punctuation.
//      · IT DOES NOT POLLUTE: the prose stays the human author's. The generator
//        owns 26 characters around the value, and nothing else.
//      · MINIMAL DIFF: regenerating swaps EXACTLY the digits that changed. A new
//        rule touches 5 passages of the README; a generated block would touch 5
//        whole blocks. A diff nobody reviews is a diff that passes.
//      · UNPLANNED BONUS: the marker NAMES the fact. Whoever opens the raw
//        markdown sees `rules.deterministicas` and knows not to edit it by hand —
//        the shape documents itself at the place where the temptation happens.
//
// THE COST OF THE CHOICE, and it is real: an HTML comment is invisible in rendered
// markdown, but VISIBLE inside a code fence — GitHub prints ```` ```bash ````
// literally, comment and all. So A FACT DOES NOT LIVE INSIDE A FENCE. The fence
// shows the COMMAND, which is copyable and does not age; the number it prints goes
// in the prose beside it. This is not a workaround, it is a fix: today's README has
// `npm run provar     # 50 casos` inside a fence — a line the person copies,
// pastes, and gets another number from. A fence that lies is worse than a fence
// without a comment.
//
// And so that the rule does not depend on someone remembering it, `conferirCerca()`
// further down FAILS a marker inside a fence, naming file and line. A rendering
// defect that would go out silent goes out loud.
//
// ─────────────────────────────────────────────────────────────────────────────
// (b) WHERE THE LINE RUNS BETWEEN A DERIVED FACT AND A HISTORICAL MEASUREMENT.
//
// Not every number in a document is a fact of this tree. "7 occurrences and zero
// true positives in herz", "161 commits across six repositories", "8 of 9 real
// credentials passed" — that is the RECORD OF A PAST MEASUREMENT, made on another
// machine, on another date, over a tree that is not this one. Deriving it would be
// impossible; overwriting it would be ERASING HISTORY, and the history is what
// gives the rule its authority. It stays written by hand, with a date, and that is
// how it has to be.
//
// A number enters this catalogue if, and only if, it passes all THREE tests:
//
//   1. It is a property of THIS tree, now — not of another repository, another
//      machine, another date.
//   2. It changes when the code changes, and ONLY then. It does not change with
//      the clock, and it does not change by the very act of being recorded.
//   3. It has a one-line derivation, with no network and without running the
//      product.
//
// TEST 2 IS WHAT EXCLUDES THE COMMIT COUNT, and it was in the request.
// `git rev-list --all --count` returns 36 in this tree. If the document recorded
// 36, the commit that records 36 would turn the count into 37 — a stale document
// the instant after, and the CI, which runs after the commit, would be RED
// FOREVER. A fact that changes by being recorded is a gate that never closes. What
// goes in its place are the numbers that only change when someone touches the
// repository: tracked files (the index already reflects the `git add` before the
// commit) and commits with a co-authorship trailer (which the allowlist keeps at 0
// and which only leaves 0 when the invariant is violated — and then going red is
// the right thing).
//
// TEST 3 IS WHAT EXCLUDES "12 of 12 on the ruler itself". That number comes from
// RUNNING `rebar-check`, and what already locks it is the `auto` step of
// `verificar`. Deriving it here would create the second source §7.2 forbids, and
// on top of that would duplicate the gate's most expensive step inside its
// cheapest one.
//
// ─────────────────────────────────────────────────────────────────────────────
// Usage:
//   node tooling/numbers.mjs              rewrites the markers in the documents
//   node tooling/numbers.mjs --verificar  recomputes, compares, exits 1 on divergence
//   node tooling/numbers.mjs --fatos      lists the facts, the value and the source
//
// Exit codes — same discipline as mcp/generate.mjs, three things, three codes:
//   0    wrote, or checked and matched
//   1    DIVERGED: the document does not say what the source says today. Regenerate.
//        A malformed marker is also 1 — what erred was the document, and the fix
//        is in the document.
//   2    the DERIVATION itself broke — a source with an unexpected shape, a count
//        that does not add up. It dominates 1 for the same reason 127 dominates 1
//        in index.mjs: you do not accuse the document with a crooked gauge.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..')

/** DERIVATION error — exits 2, never 1. See the exit-code block above. */
class Torto extends Error {}
const exigir = (condicao, mensagem) => {
  if (!condicao) throw new Torto(mensagem)
}

// ───────────────────────────────────────────────────────────────────── reading

// `join` for the disk (Windows), forward slash for everything that shows up in the
// output and in the markers: `--verificar` runs in CI on a Windows + Linux matrix,
// and a `ferramental\rebar-check\index.mjs` printed on one side and not on the
// other would make the same tree have two outputs.
const caminho = (rel) => join(RAIZ, ...rel.split('/'))
const existe = (rel) => existsSync(caminho(rel))

/**
 * Reads a file from the repository, normalizing CRLF. The `.gitattributes` pins
 * LF, but a checkout with `autocrlf` on hands CRLF to Node — and then every line
 * count would change because of a byte git considers nonexistent.
 */
const ler = (rel) => readFileSync(caminho(rel), 'utf8').replace(/\r\n/g, '\n')

/**
 * Counts lines the way `wc -l` counts: one per break. It is the count the
 * documents cite ("`mcp/generate.mjs` · 902 lines"), and the command that
 * reproduces it is written beside each fact in `--fatos`.
 */
function contarLinhas(rel) {
  const texto = ler(rel)
  return texto.split('\n').length - (texto.endsWith('\n') ? 1 : 0)
}

/** Relative paths of every file under `rel`, in stable order. */
function arquivosSob(rel, pular = () => false) {
  const saida = []
  const andar = (parcial) => {
    for (const nome of readdirSync(caminho(parcial)).sort()) {
      const filho = `${parcial}/${nome}`
      if (pular(filho, nome)) continue
      if (statSync(caminho(filho)).isDirectory()) andar(filho)
      else saida.push(filho)
    }
  }
  andar(rel)
  return saida
}

/** One line from git, or `null` if this tree is not a git repository. */
function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: RAIZ,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

const pt = (n) => n.toLocaleString('pt-BR')

// ───────────────────────────────────────────────────────────── the fact groups
//
// THE CORE IS MANDATORY, THE REST IS PER GROUP — and this is rebar-check's own
// N/A doctrine, applied here for the same reason `mcp/generate.mjs` applied it per
// section: *"o nada não conforma; o nada não se aplica"* [absence does not
// conform; absence is not applicable].
//
// A tree with no `new/` cannot testify about the generator; one that is not a git
// repository cannot testify about tracked files. Shouting DIVERGED there would be
// accusing the document of being stale when what is incomplete is the tree — the
// wrong accusation, pointing at whoever did not err.
//
// WHERE THIS SHOWS UP FOR REAL: the proof of this step, in
// `tooling/verify/prove-steps.mjs`, builds a temporary root WITHOUT
// `.git` and without `domains/`. Without the per-group N/A, that proof would ask
// the gauge to accuse the absence of things it itself decided not to copy.
//
// THE COST, and it is real: whoever DELETES `new/` from the real repository makes
// this gate stop checking the generator's numbers, in silence. What is left
// against that is the ⚠ line naming the group and the source that was missing —
// printed even when the step PASSES, because the step declares `avisar` in
// verify.config.mjs.

/** The rules, from the module that exports them — the same source the MCP derives. */
async function grupoRegras() {
  const rel = 'tooling/rebar-check/index.mjs'
  const mod = await import(pathToFileURL(caminho(rel)).href)
  const regras = mod.REGRAS
  exigir(Array.isArray(regras) && regras.length, `${rel}: REGRAS is not a non-empty list`)

  const por = (classe) => regras.filter((r) => r.classe === classe)
  const det = por('determinística')
  const heu = por('heurística')
  exigir(
    det.length + heu.length === regras.length,
    `${rel}: ${regras.length} rules, but ${det.length} deterministic + ${heu.length} ` +
      'heuristic do not add up — a third class appeared',
  )
  // The list comes out in backticks and separated by `·` because that is the shape
  // the two documents already print it in. Presentation format lives here and not in
  // the document for the same reason the value does: so there is nothing to diverge.
  const lista = (rs) => rs.map((r) => `\`${r.id}\``).join(' · ')

  // THE SECURITY MODULE COUNTS TOO, and until 2026-09-07 it did not: this
  // function read only `rebar-check`, so the badge said 23 while the MCP served
  // 26. A module that exists, runs as a gate step and carries four proof cases
  // was invisible in every document.
  //
  // `rules.total` stays the rebar-check number, because that is the one the
  // surrounding prose uses ("the 23 rules of format"). What is new is the total,
  // and it is the total that goes on the badge.
  const relSeg = 'tooling/security/index.mjs'
  const modSeg = await import(pathToFileURL(caminho(relSeg)).href)
  const seguranca = modSeg.REGRAS
  exigir(Array.isArray(seguranca) && seguranca.length, `${relSeg}: REGRAS is not a non-empty list`)

  return {
    'rules.total': `${regras.length}`,
    'rules.security': `${seguranca.length}`,
    'rules.all': `${regras.length + seguranca.length}`,
    'rules.lista-security': lista(seguranca),
    'rules.deterministicas': `${det.length}`,
    'rules.heuristicas': `${heu.length}`,
    'rules.lista-deterministicas': lista(det),
    'rules.lista-heuristicas': lista(heu),
    'lines.rebar-check': `${pt(contarLinhas(rel))}`,
  }
}

/** The proof cases, counted in the `caso.json` files — the same prove.mjs reads. */
function grupoProvas(totalDeRegras) {
  const base = 'tooling/rebar-check/proofs/cases'
  const pastas = readdirSync(caminho(base))
    .sort()
    .filter((n) => statSync(caminho(`${base}/${n}`)).isDirectory())

  const regras = new Set()
  for (const nome of pastas) {
    const rel = `${base}/${nome}/caso.json`
    exigir(existe(rel), `${rel}: case folder with no caso.json`)
    let caso
    try {
      caso = JSON.parse(ler(rel))
    } catch (e) {
      throw new Torto(`${rel}: invalid JSON — ${e.message}`)
    }
    // Matches on the `regra` field FROM INSIDE the case, and not on the folder
    // name: the name is convention, the field is declaration. Same choice as
    // mcp/generate.mjs.
    exigir(caso.rule, `${rel}: no "rule" field`)
    regras.add(caso.rule)
  }
  exigir(pastas.length, `${base}/: no proof case in this tree`)

  return {
    'proofs.casos': `${pastas.length}`,
    'proofs.regras-com-prova': `${regras.size}`,
    // COVERAGE IS A FRACTION OF TWO SOURCES, and the previous version of this
    // line was `${regras.size} de ${regras.size}` — the same number twice.
    //
    // Finding of the 31/08 audit, and it is worse than a stale number: that fact
    // was STRUCTURALLY incapable of being wrong. If half the rules lost their
    // proof, it would keep printing "N de N", and the README sells exactly that
    // sentence as the guarantee that every rule is born with two cases. A number
    // that cannot accuse is not a measurement, it is decoration — and decoration
    // dressed as measurement is the thing this repository exists to clear away.
    //
    // Now the numerator comes from the `caso.json` files and the denominator from
    // the checker's rule catalogue. They are different sources, and it is because
    // they are different that the fraction can come out uneven and accuse.
    //
    // The `de` in the value stays Portuguese: it is DOCUMENT CONTENT, already
    // written inside the markers of README.md and ESTADO.md. Changing it makes
    // those documents diverge until someone runs `node tooling/numbers.mjs`.
    'proofs.cobertura': `${regras.size} de ${totalDeRegras}`,
    'proofs.regras-sem-prova': `${Math.max(0, totalDeRegras - regras.size)}`,
  }
}

/** The gate's steps, in order, from verify.config.mjs itself. */
async function grupoVerificar() {
  const rel = 'verify.config.mjs'
  const mod = await import(pathToFileURL(caminho(rel)).href)
  const passos = mod.default
  exigir(Array.isArray(passos) && passos.length, `${rel}: the default export is not a step list`)
  const nomes = passos.map((p) => p.nome)
  exigir(
    nomes.every((n) => typeof n === 'string' && n),
    `${rel}: step with no name`,
  )

  const fatos = {
    'verify.passos': `${passos.length}`,
    'verify.lista-passos': nomes.map((n) => `\`${n}\``).join(' · '),
  }
  // One position per step, and not only the `mcp` one the README cites today. It
  // is free, and it makes inserting a step in the middle fix EVERY position
  // citation at once — which is exactly the error the README carries now
  // ("5 de 11", when there are 12 steps and `mcp` is the sixth).
  //
  // The `de` in the value stays Portuguese for the same reason as in
  // `proofs.cobertura`: it is document content that is already written in the
  // markers of README.md and ESTADO.md.
  nomes.forEach((n, i) => {
    fatos[`verify.posicao.${n}`] = `${i + 1} de ${passos.length}`
  })
  return fatos
}

/** The MCP artifact and the server that reads it. */
function grupoMcp() {
  const relArtefato = 'mcp/rules.generated.json'
  const bruto = ler(relArtefato)
  let a
  try {
    a = JSON.parse(bruto)
  } catch (e) {
    throw new Torto(`${relArtefato}: not JSON — ${e.message}`)
  }
  exigir(Array.isArray(a.regras), `${relArtefato}: no "regras" list`)

  const relServidor = 'mcp/src/index.mjs'
  const ferramentas = [...ler(relServidor).matchAll(/registerTool\(\s*'([a-z_]+)'/g)]
  exigir(
    ferramentas.length,
    `${relServidor}: no registerTool matched — the server has changed shape`,
  )

  // THE SERVER DOES NOT INCLUDE THE PROOF CLIENT. `mcp/src/prova-cliente.mjs` is
  // 370 lines that exercise the server from outside; adding them would give 1.307
  // and the document would say the server is 40% bigger than it is.
  const linhasServidor = arquivosSob('mcp/src', (_f, nome) => nome === 'prova-cliente.mjs')
    .filter((f) => f.endsWith('.mjs'))
    .reduce((n, f) => n + contarLinhas(f), 0)

  return {
    'mcp.artefato.regras': `${a.regras.length}`,
    'mcp.artefato.niveis': `${a.niveis?.length ?? 0}`,
    'mcp.artefato.passos': `${a.gate?.passos.length ?? 0}`,
    'mcp.artefato.provas': `${a.regras.reduce((n, r) => n + (r.provas?.length || 0), 0)}`,
    // Document KB, base 1000 — it is the unit the two documents already write
    // "78 KB" in, and changing the base now would create a diff that is not a fact.
    'mcp.artefato.tamanho': `${Math.round(Buffer.byteLength(bruto, 'utf8') / 1000)} KB`,
    'mcp.ferramentas': `${ferramentas.length}`,
    'lines.mcp-gerador': `${pt(contarLinhas('mcp/generate.mjs'))}`,
    'lines.mcp-servidor': `${pt(linhasServidor)}`,
  }
}

/** The `rebar new` generator: how many steps it announces, and how much is template. */
function grupoNovo() {
  const rel = 'new/index.mjs'
  const fonte = ler(rel)
  // The generator prints `▸ 1/6`, `▸ 2/6` … The denominator IS the number of steps,
  // and it is already written where it would err loudly: if someone adds a step and
  // forgets the denominator, the check below breaks with exit 2.
  const marcas = [...fonte.matchAll(/▸ (\d+)\/(\d+)\b/g)].map((m) => [+m[1], +m[2]])
  exigir(marcas.length, `${rel}: no "▸ n/m" mark — the generator changed shape`)
  const total = marcas[0][1]
  exigir(
    marcas.every(([, m]) => m === total),
    `${rel}: the "▸ n/m" marks do not agree on the denominator`,
  )
  exigir(
    Math.max(...marcas.map(([n]) => n)) === total,
    `${rel}: the denominator of the marks is ${total}, but the largest step printed ` +
      `is ${Math.max(...marcas.map(([n]) => n))}`,
  )

  const todos = arquivosSob('new', (_filho, nome) => nome === 'node_modules')
  // TEMPLATE is what the generator COPIES into the created project, and the border
  // is not guessed: it is the folder carrying a `modelo.json`, which is the same
  // lock rebar-check uses to take those files out of the evaluation.
  const pastasModelo = todos
    .filter((f) => f.endsWith('/modelo.json'))
    .map((f) => f.slice(0, -'modelo.json'.length))
  exigir(pastasModelo.length, 'new/: no modelo.json — the template lock is gone')
  const modelo = todos.filter((f) => pastasModelo.some((p) => f.startsWith(p)))

  return {
    'new.passos': `${total}`,
    'new.arquivos': `${todos.length}`,
    'new.arquivos-modelo': `${modelo.length}`,
  }
}

/** What git knows. Wholly N/A when this tree is not a git repository. */
function grupoGit() {
  // `-z` is mandatory, and here it is a CORRECTNESS defect and not a message one:
  // this path is counted and matched by folder prefix. Without `-z` an accented
  // name comes back C-quoted and counts as another file.
  const rastreados = git('ls-files', '-z')
  exigir(rastreados !== null, 'git ls-files did not answer in a tree that has .git')
  const arquivos = rastreados.split('\0').filter(Boolean)
  const casos = 'tooling/rebar-check/proofs/cases/'

  const coautoria = git('log', '--all', '-i', '--grep=Co-authored-by', '--format=%H')
  const primeiro = git(
    'log',
    '--all',
    '--reverse',
    '--format=%ad',
    '--date=format:%Y-%m-%d %H:%M:%S',
  )

  return {
    // `git.arquivos-rastreados` and `git.arquivos-fora-dos-casos` LEFT here on
    // 02/09, and the lesson is the one this file had already written and did not
    // apply.
    //
    // §0 demands that a derived fact change when the code changes AND ONLY THEN —
    // never by the very act of being recorded. The commit count was excluded by
    // that test, with the right reasoning written beside it. The FILE count fails
    // for the SAME reason and passed: the commit that recorded 340 added
    // `tooling/numbers.mjs`, and the count turned into 341. The CI failed on the
    // next commit, on both systems, exactly as the audit predicted.
    //
    // A gate that fails because of the very commit that feeds it is a gate
    // impossible to satisfy, and a gate that does not close is a gate people learn
    // to work around. The number went back into the document by hand, with a date,
    // beside the other historical measurements.
    // It only leaves 0 when `commit-msg` is bypassed. Then going red is the right
    // behavior, and not the nuisance the total commit count would be.
    'git.commits-com-coautoria': `${(coautoria || '').split('\n').filter(Boolean).length}`,
    'git.primeiro-commit': (primeiro || '').split('\n')[0] || '(no commit)',
  }
}

/** The manifest: it is where "single dependency: prettier" comes from. */
function grupoPacote() {
  const rel = 'package.json'
  const pkg = JSON.parse(ler(rel))
  const dev = Object.entries(pkg.devDependencies || {})
  return {
    'package.dependencias': `${Object.keys(pkg.dependencies || {}).length}`,
    'package.dev-dependencias': dev.map(([n, v]) => `\`${n}\` ${v}`).join(' · ') || 'none',
  }
}

/** The domain proved against a real PostgreSQL. */
function grupoDominio() {
  const rel = 'domains/privilegio-de-banco/privilegio.test.mjs'
  const testes = [...ler(rel).matchAll(/^\s*test\(/gm)].length
  exigir(testes, `${rel}: no test( matched — the suite changed shape`)
  return { 'domain.privilegio.testes': `${testes}` }
}

/**
 * Group → the sources it REQUIRES. The same table decides what is generated and
 * what is compared, so that deriving and checking never diverge.
 */
const GRUPOS = [
  {
    chave: 'regras',
    exige: ['tooling/rebar-check/index.mjs', 'tooling/security/index.mjs'],
    montar: grupoRegras,
  },
  { chave: 'proofs', exige: ['tooling/rebar-check/proofs/cases'], montar: grupoProvas },
  { chave: 'verificar', exige: ['verify.config.mjs'], montar: grupoVerificar },
  {
    chave: 'mcp',
    exige: ['mcp/rules.generated.json', 'mcp/src/index.mjs', 'mcp/generate.mjs'],
    montar: grupoMcp,
  },
  { chave: 'new', exige: ['new/index.mjs'], montar: grupoNovo },
  { chave: 'git', exige: ['.git'], montar: grupoGit },
  { chave: 'pacote', exige: ['package.json'], montar: grupoPacote },
  {
    chave: 'dominio',
    exige: ['domains/privilegio-de-banco/privilegio.test.mjs'],
    montar: grupoDominio,
  },
]

/** Derives what this tree can derive, and says what was left out. */
async function derivar() {
  const fatos = new Map()
  const ausentes = []
  for (const g of GRUPOS) {
    const faltando = g.exige.filter((r) => !existe(r))
    if (faltando.length) {
      ausentes.push({ chave: g.chave, faltando })
      continue
    }
    // The `provas` group receives the rule total because coverage is a fraction of
    // TWO sources — see the note in `grupoProvas`. The groups run in declaration
    // order, and `regras` comes before `provas` for that reason.
    const jaDerivado = fatos.get('rules.total')?.valor
    for (const [id, valor] of Object.entries(await g.montar(Number(jaDerivado)))) {
      exigir(!fatos.has(id), `fact "${id}" derived by two groups — duplicate id`)
      exigir(typeof valor === 'string' && valor.length, `fact "${id}" came out empty`)
      fatos.set(id, { valor, grupo: g.chave, fonte: g.exige[0] })
    }
  }
  exigir(fatos.size, 'no group could be derived in this tree — there is nothing to check')
  return { fatos, ausentes }
}

// ──────────────────────────────────────────────────── the documents and the text

// THE GRAMMAR, and it is tiny on purpose: a pair of HTML comments, the id in the
// opening one, nothing in the closing one. Repeating the id in the closing one
// would help in a long region; here the region is a short value, and repeating
// would double the pollution in the very criterion where this shape beats the
// other two.
const MARCADOR = /<!--n ([a-z0-9][a-z0-9.\-]*)-->([\s\S]*?)<!--\/n-->/g
const ABERTURA = /<!--n ([a-z0-9][a-z0-9.\-]*)-->/g

/**
 * Every `.md` in the tree is governed — not a fixed list of two names.
 *
 * Registering a document by hand is the same class of defect this module exists
 * to kill: someone puts a marker in `docs/STACK.md`, forgets to register the
 * file, and the gate goes mute about a number that came into existence. Here the
 * marker is enough: where it is, the gate checks.
 *
 * `proofs/cases/` stays OUT because proof material is byte-exact — it is the same
 * reason prettier already skips it, and rewriting a fixture's `README.md` would
 * change what the rule is reading.
 */
function documentos() {
  const forade = new Set(['node_modules', '.git'])
  const casos = 'tooling/rebar-check/proofs/cases'
  const saida = []
  const andar = (parcial) => {
    for (const nome of readdirSync(caminho(parcial)).sort()) {
      if (forade.has(nome)) continue
      const filho = parcial ? `${parcial}/${nome}` : nome
      if (filho === casos) continue
      if (statSync(caminho(filho)).isDirectory()) andar(filho)
      else if (nome.endsWith('.md')) saida.push(filho)
    }
  }
  andar('')
  return saida
}

/** Lines (1-based) that fall inside a code fence. */
function linhasEmCerca(texto) {
  const dentro = new Set()
  let aberta = false
  texto.split('\n').forEach((linha, i) => {
    if (/^\s{0,3}(```|~~~)/.test(linha)) {
      aberta = !aberta
      dentro.add(i + 1)
      return
    }
    if (aberta) dentro.add(i + 1)
  })
  return dentro
}

const linhaDe = (texto, indice) => texto.slice(0, indice).split('\n').length

/**
 * Finds a document's markers. It also returns the SHAPE defects — an opening with
 * no closing, and a marker inside a fence —, because a marker that does not match
 * is worse than a missing marker: the number sits there, looking checked.
 */
/**
 * A marker that OPENS a paragraph breaks the rendered markdown, and that is why it
 * is refused here instead of trusted to the memory of whoever writes.
 *
 * In CommonMark, an HTML comment at column 0 opens an HTML BLOCK (type 2) when it
 * starts a block — and the rest of that line comes out as raw HTML, so the
 * backticks become literals instead of code. In the MIDDLE of a paragraph it is
 * harmless: a type 2 HTML block does not interrupt a paragraph in progress.
 *
 * Finding of the 31/08 audit: 30 lines began with a marker, and 4 of them really
 * opened a paragraph — the README showed a literal backtick to whoever reads it on
 * GitHub. The fix in the prose is one word ("They are: "), and the sentence even
 * improves; what was missing was someone to say so.
 */
function abreParagrafo(linhas, i) {
  if (!linhas[i].startsWith('<!--n ')) return false
  const anterior = i > 0 ? linhas[i - 1] : ''
  return !anterior.trim() || /^(#|\||```|---)/.test(anterior)
}

/**
 * Badge numbers, derived WITHOUT a marker.
 *
 * A marker cannot live inside a link destination — see the defect detector in
 * `marcadoresDe` — and a badge is a link destination and nothing else. So the
 * number is found by the SHAPE of the shields.io URL and rewritten from the
 * fact, which keeps the two properties that matter: it renders on GitHub, and it
 * cannot age without the gate saying so.
 *
 * The label is part of the key because the three READMEs are in three languages
 * and the badge label is translated. The number is not.
 */
const BADGES = [
  { doc: 'README.md', rotulo: 'rules', fato: 'rules.all' },
  { doc: 'README.md', rotulo: 'gate', fato: 'verify.passos' },
  { doc: 'README.pt-BR.md', rotulo: 'regras', fato: 'rules.all' },
  { doc: 'README.pt-BR.md', rotulo: 'port%C3%A3o', fato: 'verify.passos' },
  { doc: 'README.es.md', rotulo: 'reglas', fato: 'rules.all' },
  { doc: 'README.es.md', rotulo: 'compuerta', fato: 'verify.passos' },
]

const reDoBadge = (rotulo) => new RegExp(`(img\\.shields\\.io/badge/${rotulo}-)(\\d+)`, 'g')

/** The badges of one document, shaped like marker findings so the rest is free. */
function badgesDe(rel, texto) {
  const achados = []
  for (const b of BADGES.filter((x) => x.doc === rel)) {
    for (const m of texto.matchAll(reDoBadge(b.rotulo))) {
      achados.push({ arquivo: rel, id: b.fato, linha: linhaDe(texto, m.index), atual: m[2] })
    }
  }
  return achados
}

function marcadoresDe(rel) {
  const texto = ler(rel)
  const cerca = linhasEmCerca(texto)
  const achados = []
  const defeitos = []
  const casaram = new Set()

  for (const m of texto.matchAll(MARCADOR)) {
    const linha = linhaDe(texto, m.index)
    casaram.add(m.index)
    if (cerca.has(linha)) {
      // "cerca" stays Portuguese in the message: the proof of this step, in
      // tooling/verify/prove-steps.mjs, asserts /cerca/i against this line.
      defeitos.push(
        `${rel}:${linha}: marker "${m[1]}" INSIDE a code fence (cerca) — GitHub prints ` +
          'the comment as text. Keep the command in the fence, the number in the prose beside it.',
      )
      continue
    }
    achados.push({ arquivo: rel, id: m[1], linha, atual: m[2] })
  }

  // An opening with no closing does not show up in the matching above; without
  // this sweep it disappears in silence, and the number it fences stops being
  // checked with nothing changing on screen.
  //
  // The comparison is by INDEX and not by line, and the difference was measured:
  // by line, a line carrying one closed marker and one open one — which is exactly
  // the shape of a table cell with two numbers — took the orphan opening for closed
  // and went mute again.
  //
  // "nunca fechado" stays Portuguese: prove-steps.mjs asserts /nunca fechado/.
  for (const m of texto.matchAll(ABERTURA)) {
    const linha = linhaDe(texto, m.index)
    if (!casaram.has(m.index) && !cerca.has(linha)) {
      defeitos.push(
        `${rel}:${linha}: marker "${m[1]}" opened and never closed (nunca fechado) — no <!--/n-->`,
      )
    }
  }
  // A MARKER INSIDE A LINK DESTINATION. It is the defect that actually shipped:
  //
  //   [![Rules](https://img.shields.io/badge/rules-<!--n x-->26<!--/n-->-blue)](#x)
  //
  // An HTML comment inside `](...)` breaks the `![...](...)` syntax and GitHub
  // prints the whole thing as literal text. The badge was broken from the day it
  // was written, and it was not caught because `--verificar` proved the NUMBER
  // was fresh and nobody opened the rendered page. The number was right and the
  // badge was text.
  //
  // A badge number needs no marker at all — see `BADGES` above.
  for (const m of texto.matchAll(MARCADOR)) {
    const linha = linhaDe(texto, m.index)
    if (cerca.has(linha)) continue
    const daLinha = texto.split(String.fromCharCode(10))[linha - 1] ?? ''
    const antes = daLinha.slice(0, Math.max(0, daLinha.indexOf(m[0])))
    const abriu = antes.lastIndexOf('](')
    if (abriu !== -1 && !antes.slice(abriu + 2).includes(')')) {
      // "dentro de link" stays Portuguese: prove-steps.mjs asserts it.
      defeitos.push(
        `${rel}:${linha}: marker "${m[1]}" INSIDE a link destination (dentro de link) — ` +
          'an HTML comment in `](...)` breaks the markdown and GitHub prints the line as ' +
          'text. A badge number needs no marker: see BADGES in tooling/numbers.mjs.',
      )
    }
  }

  // A marker that OPENS a paragraph — see `abreParagrafo`. It comes last because
  // it is the only defect that does not stop the number from being checked: it
  // breaks the RENDER, not the derivation. But it breaks for whoever reads on
  // GitHub, which is the only reader this file has.
  const linhas = texto.split(String.fromCharCode(10))
  for (let i = 0; i < linhas.length; i++) {
    if (cerca.has(i + 1)) continue
    if (abreParagrafo(linhas, i)) {
      // "ABRE parágrafo" stays Portuguese: prove-steps.mjs asserts /ABRE parágrafo/.
      defeitos.push(
        `${rel}:${i + 1}: marker ABRE parágrafo (it opens a paragraph) — in CommonMark that ` +
          'becomes an HTML block and the rest of the line comes out as raw HTML (the ' +
          'backticks turn into literals). Put a word of prose before it, like "They are: ".',
      )
    }
  }

  // The badges join the findings HERE, and that is the whole wiring: `conferir`
  // and `escrever` iterate `achados` comparing `atual` to the fact, and neither
  // needs to know a badge from a marker.
  achados.push(...badgesDe(rel, texto))

  return { texto, achados, defeitos }
}

/** Rewrites the known markers. Returns the new text and how many changed. */
function reescrever(texto, fatos, rel) {
  let trocados = 0
  let novo = texto.replace(MARCADOR, (inteiro, id, atual) => {
    const fato = fatos.get(id)
    if (!fato || fato.valor === atual) return inteiro
    trocados++
    return `<!--n ${id}-->${fato.valor}<!--/n-->`
  })

  // The badges, by URL shape instead of by marker. Same idempotence: bytes only
  // move when the value moved.
  for (const b of BADGES.filter((x) => x.doc === rel)) {
    const fato = fatos.get(b.fato)
    if (!fato) continue
    novo = novo.replace(reDoBadge(b.rotulo), (inteiro, prefixo, atual) => {
      if (fato.valor === atual) return inteiro
      trocados++
      return `${prefixo}${fato.valor}`
    })
  }

  return { novo, trocados }
}

// ────────────────────────────────────────────────────────── compare and write

/**
 * Cut through the MIDDLE, and not at the end, and the difference was measured.
 *
 * `rules.lista-deterministicas` is 17 ids in backticks — 300 characters. Pasted
 * whole twice (old and new) they push the other divergences off the screen with
 * the step's `limite: 12`. But cutting at the END is worse than cutting a lot:
 * the list grows at the end, so the two lines would come out IDENTICAL on screen
 * and the owner would read "it changed" without seeing what. Keeping start and
 * end, `· hex-cru` shows up on the `+` line and not on the `-` one, which is the
 * whole news in three words. The complete value comes out in `--fatos`.
 */
const recortar = (s) => (s.length > 110 ? `${s.slice(0, 60)}…${s.slice(-45)}` : s)

/** ⚠ naming each group THIS tree could not derive, and what was missing. */
function avisarAusentes(ausentes) {
  for (const a of ausentes) {
    // `⚠ grupo "<key>"` stays Portuguese: prove-steps.mjs asserts /⚠ grupo "git"/.
    console.error(
      `  ⚠ grupo "${a.chave}" NOT derived, NOT checked — this tree lacks ${a.faltando.join(', ')}`,
    )
  }
}

/**
 * ⚠ for when nobody has marked anything yet.
 *
 * A document with no marker is N/A, not a failure: shouting DIVERGED about a
 * README that has not been marked yet is accusing the document of being stale
 * when what is missing is the markup — the wrong accusation, pointing at whoever
 * did not err. It is rebar-check's own `na()`.
 *
 * THE COST, and it is the gap this decision opens: while no marker exists, this
 * gate checks zero numbers. What is left against that is this line, and it goes
 * out EVEN WHEN THE STEP PASSES, because the `numeros` step of verify.config.mjs
 * declares `avisar: /^\s*⚠/`. The hole shows up on every run of `verificar`
 * until someone closes it.
 */
function avisarSemMarcador(docs, fatos) {
  // ONE line only, and the pointer to the fix goes INSIDE it. The `verificar`
  // executor extracts line by line with `avisar: /^\s*⚠/`; a second explanatory
  // paragraph without the ⚠ would be discarded there, and the warning would reach
  // the owner without saying what to do — which is the same complaint the `dica`
  // of each step exists not to repeat.
  //
  // `⚠ nenhum marcador` stays Portuguese: prove-steps.mjs asserts /⚠ nenhum marcador/.
  console.error(
    `  ⚠ nenhum marcador · no marker in ${docs.length} markdown document(s) — this gate ` +
      `checks 0 of the ${fatos.size} facts it knows how to derive. Mark it like this: ` +
      '<!--n rules.deterministicas-->17<!--/n--> · the id list comes out of ' +
      '`node tooling/numbers.mjs --fatos`',
  )
}

function escrever(fatos, ausentes) {
  avisarAusentes(ausentes)
  const docs = documentos()
  const defeitos = []
  const escritos = []
  let marcadores = 0

  for (const rel of docs) {
    const { texto, achados, defeitos: d } = marcadoresDe(rel)
    defeitos.push(...d)
    marcadores += achados.length
    const desconhecidos = achados.filter((a) => !fatos.has(a.id))
    for (const a of desconhecidos) {
      defeitos.push(`${a.arquivo}:${a.linha}: "${a.id}" is not a derivable fact (see --fatos)`)
    }
    if (!achados.length) continue
    const { novo, trocados } = reescrever(texto, fatos, rel)
    if (!trocados) continue
    // Idempotent on purpose: bytes are only touched when a value changed. It is
    // what stops a regeneration from dirtying the diff of a commit that touched no
    // number at all.
    writeFileSync(caminho(rel), novo, 'utf8')
    escritos.push(`${rel} (${trocados})`)
  }

  if (defeitos.length) {
    for (const d of defeitos) console.error(`  error ${d}`)
    return 1
  }
  if (!marcadores) {
    avisarSemMarcador(docs, fatos)
    return 0
  }
  console.log(
    escritos.length
      ? `numbers: rewrote ${escritos.join(', ')} · ${marcadores} marker(s) · ${fatos.size} fact(s)`
      : `numbers: ${marcadores} marker(s) in ${docs.length} document(s) already up to date`,
  )
  return 0
}

function conferir(fatos, ausentes) {
  avisarAusentes(ausentes)
  const docs = documentos()
  const defeitos = []
  const divergencias = []
  const naoDerivados = []
  let marcadores = 0

  for (const rel of docs) {
    const { achados, defeitos: d } = marcadoresDe(rel)
    defeitos.push(...d)
    marcadores += achados.length
    for (const a of achados) {
      const fato = fatos.get(a.id)
      if (!fato) {
        // A fact from a group that is N/A in this tree is not a divergence — it is
        // N/A, and goes out as ⚠. A fact NO group produces is a defect of the
        // document, and goes out as an error: the id was mistyped, or the fact
        // stopped existing.
        const naGrupo = ausentes.some((x) => a.id.startsWith(`${x.chave}.`))
        if (naGrupo) naoDerivados.push(`${a.arquivo}:${a.linha} ${a.id}`)
        else
          defeitos.push(`${a.arquivo}:${a.linha}: "${a.id}" is not a derivable fact (see --fatos)`)
        continue
      }
      if (fato.valor !== a.atual) divergencias.push({ ...a, esperado: fato.valor })
    }
  }

  if (defeitos.length) {
    console.error(`numbers --verificar: DIVERGED. ${defeitos.length} malformed marker(s).`)
    for (const d of defeitos) console.error(`  error ${d}`)
    console.error('\n  Fix: in the document, not here.')
    return 1
  }
  for (const n of naoDerivados) {
    console.error(`  ⚠ marker not checked in this tree (group N/A): ${n}`)
  }

  if (divergencias.length) {
    console.error(
      `numbers --verificar: DIVERGED. ${divergencias.length} number(s) written in the ` +
        'documents are not what the source says today.',
    )
    // UNIFIED DIFF SHAPE, and it is not aesthetics: the `numeros` step of
    // verify.config.mjs extracts from the output with /^\s*(erro|✗|[-+] )/, and
    // without the `- `/`+ ` at the start nothing matches and the executor falls
    // back to the last lines — which would be the fix line, not what changed. THE
    // FILE AND THE LINE go on every line, and not in a header above: a line
    // extracted alone has to say alone where to fix.
    //
    // Ceiling of 12, the same `limite` the step imposes: printing more is writing
    // for a crop that has already cropped.
    for (const d of divergencias.slice(0, 12)) {
      console.error(
        `  - ${d.arquivo}:${d.linha} ${d.id} = ${recortar(d.atual)}   (document, stale)`,
      )
      console.error(`  + ${d.arquivo}:${d.linha} ${d.id} = ${recortar(d.esperado)}   (source, now)`)
    }
    if (divergencias.length > 12) {
      console.error(`  … and ${divergencias.length - 12} more number(s).`)
    }
    console.error('\n  Fix: node tooling/numbers.mjs')
    return 1
  }

  if (!marcadores) {
    avisarSemMarcador(docs, fatos)
    return 0
  }
  console.log(
    `numbers --verificar: up to date · ${marcadores} marker(s) in ${docs.length} document(s) · ` +
      `${fatos.size} derivable fact(s)` +
      `${ausentes.length ? ` · ${ausentes.length} group(s) N/A in this tree` : ''}`,
  )
  return 0
}

/** The catalogue on screen: what the next front reads to know what to mark. */
function listarFatos(fatos, ausentes) {
  avisarAusentes(ausentes)
  const usados = new Map()
  for (const rel of documentos()) {
    for (const a of marcadoresDe(rel).achados) {
      usados.set(a.id, (usados.get(a.id) || 0) + 1)
    }
  }
  console.log(`${fatos.size} derivable fact(s) · ${usados.size} already marked in a document\n`)
  let grupo = null
  for (const [id, f] of fatos) {
    if (f.grupo !== grupo) {
      grupo = f.grupo
      console.log(`── ${grupo}  (source: ${f.fonte})`)
    }
    const marcas = usados.get(id)
    console.log(`  ${marcas ? `${marcas}×` : ' ·'} ${id.padEnd(34)} ${f.valor}`)
  }
  return 0
}

// ────────────────────────────────────────────────────────────────────── program

const args = process.argv.slice(2)
const desconhecidas = args.filter((a) => !/^--(verificar|fatos)$/.test(a))
if (desconhecidas.length) {
  console.error(`numbers: unknown option: ${desconhecidas.join(', ')}`)
  console.error('usage: node tooling/numbers.mjs [--verificar | --fatos]')
  process.exit(2)
}

let fatos
let ausentes
try {
  ;({ fatos, ausentes } = await derivar())
} catch (e) {
  // A crooked derivation exits 2 and NEVER 1: 1 means "the document is stale,
  // regenerate", and ordering a regeneration with a broken gauge is ordering a
  // wrong number written over a right one.
  console.error(`numbers: the DERIVATION broke — ${e.message}`)
  if (!(e instanceof Torto)) console.error(e.stack)
  process.exit(2)
}

process.exit(
  args.includes('--fatos')
    ? listarFatos(fatos, ausentes)
    : args.includes('--verificar')
      ? conferir(fatos, ausentes)
      : escrever(fatos, ausentes),
)
