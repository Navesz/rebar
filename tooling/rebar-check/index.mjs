#!/usr/bin/env node
// rebar-check — runs against ANY repository and prints a scoreboard.
//
// Why this exists before the generator: the previous project did not scale. The
// old version of this comment said it "died because enforcement never touched a
// project", and that was MEASURED and is FALSE — its tooling gates the CI of a
// real repository, `prumo/.github/workflows/ci.yml` line 113. It touched 2 of
// 19. What was missing was scale, not contact.
// Checking is retroactive and works on the repositories that already exist;
// generating only serves the next one. The right inversion is not
// generator-first, it is CONSUMER-first.
//
// Zero dependencies: Node built-ins only. What checks the build cannot depend
// on the build, and so `npx github:Navesz/rebar` works without installing
// — the `bin` field of package.json is what makes npx resolve this, and the
// promise stayed false from the first commit until that field existed.
//
// Never writes anything. Reads the repository and exits.
//
// Usage:
//   node index.mjs [path...]           scoreboard per repository
//   node index.mjs --json [path]       output for CI
//   node index.mjs --rule=<id> [dir]  one rule only (this is what the proofs use)
//   node index.mjs --heuristics         heuristics also drop the exit code
//   node index.mjs novo <name> [dom]   dispatches to the GENERATOR, new/index.mjs
//   node index.mjs --mcp               hands stdio to the MCP SERVER, mcp/src/
//
// The `new` subcommand lives here, and not in a second `bin`, for a reason of
// npx mechanics: `npx github:Navesz/rebar new meu-site` resolves the bin that
// has the PACKAGE NAME — `rebar`, this file — and passes "new" as the first
// argument. Without the dispatch, the checker treated "new" as a path to audit
// and exited 2 saying "path does not exist". An extra `bin` does not fix that:
// it is only reachable through `npx -p github:Navesz/rebar rebar-new …`, which
// nobody types. It exists anyway, as an unambiguous form — see the package.json.
//
// To audit a folder literally named `new`, use `./novo`.
//
// Códigos de saída — three different things, three different codes:
//   0    everything applicable passed
//   1    FAILED: real violation
//   2    invalid target (not a git repository) or wrong invocation
//   127  BROKE: a rule threw. Defect of rebar-check, not of the target.
//
// That heading stays in Portuguese: `mcp/generate.mjs` locates this block with
// the literal regex `// Códigos de saída` to publish the exit codes in the MCP
// artifact. Translating it makes the generator fail.
//
// The 1 against the 127 is §8.2 of the plan ("verificar.mjs:124 → distinguir
// reprovou de quebrou") [verificar.mjs:124 → distinguish failed from broke].
// Without it the checker's own bug enters the score as if it were a defect of
// the audited repository.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ───────────────────────────────────────────────────────────────── utilities

const cor = process.stdout.isTTY && !process.env.NO_COLOR
const c = {
  verde: (s) => (cor ? `\x1b[32m${s}\x1b[0m` : s),
  vermelho: (s) => (cor ? `\x1b[31m${s}\x1b[0m` : s),
  amarelo: (s) => (cor ? `\x1b[33m${s}\x1b[0m` : s),
  fraco: (s) => (cor ? `\x1b[2m${s}\x1b[0m` : s),
  forte: (s) => (cor ? `\x1b[1m${s}\x1b[0m` : s),
}

/**
 * "Not applicable" is a THIRD state, and creating it was the most expensive fix
 * in this file. Before, a rule with no object to check returned `null` — the
 * same as "passed". Measured consequence: an EMPTY folder with an empty `.git/`
 * scored 8 of 14, tying with rebar itself and scoring DOUBLE the alicerce.
 * Nothing does not conform; nothing does not apply. N/A leaves the DENOMINATOR.
 */
const na = (motivo) => ({ na: motivo })

/**
 * Runs git. Distinguishes the two things that used to be one:
 *   { ok: true,  saida }  — ran, may have come out empty (repo with no commit is valid)
 *   { ok: false, erro }   — git failed or does not exist
 * The old `catch { return '' }` swallowed "fatal: not a git repository" and
 * returned an empty string, so `coautoria-ia` and `identidade-git` passed a
 * directory that was not even a repository. A crash became a pass.
 */
function git(dir, args) {
  try {
    const saida = execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, saida: saida.trim() }
  } catch (e) {
    return { ok: false, erro: (e.stderr || e.message || '').toString().trim().split('\n')[0] }
  }
}

/**
 * A read with THREE states, for the same reason `na()` exists: two boxes are
 * not enough for three things.
 *
 *   { estado: 'ok', texto }       read it
 *   { estado: 'ausente' }         does not exist — legitimate N/A
 *   { estado: 'ilegivel', erro }  EXISTS and I could not read it
 *
 * The old `catch { return null }` merged "absent" with "unreadable", and
 * `pkg === null` became `na('not an npm project')` — which LEAVES THE
 * DENOMINATOR. Measured in the attack: a repository at 9 of 10 (90%) with a
 * syntactically broken package.json becomes 6 of 6 (100%) — four rules
 * (dependabot, ci-gateia, typecheck, formatter) vanish from the score and the
 * repository starts scoring MAXIMUM. Breaking the file improved the score. It
 * is the same class of "a crash became a pass" that `git()` already fixed, now
 * on disk.
 *
 * `rastreado` closes the second door of the same attack: `rm package.json`
 * without committing leaves the file in the git index and off the disk. For
 * anything that came from the `git ls-files` list the index is the truth about
 * existing, so ENOENT there is "exists and I could not read it", not "does not
 * exist".
 */
function lerArquivo(dir, rel, rastreado = false) {
  try {
    return { estado: 'ok', texto: readFileSync(join(dir, rel), 'utf8') }
  } catch (e) {
    const some = e.code === 'ENOENT' || e.code === 'ENOTDIR'
    if (some && !rastreado) return { estado: 'ausente' }
    const erro = some ? 'tracked by git and absent from disk' : e.code || e.message
    return { estado: 'ilegivel', erro }
  }
}

function lerJsonRastreado(dir, rel) {
  const bruto = lerArquivo(dir, rel, true)
  if (bruto.estado !== 'ok') return bruto
  let valor
  try {
    valor = JSON.parse(bruto.texto)
  } catch (e) {
    return { estado: 'ilegivel', erro: `invalid JSON: ${e.message.split('\n')[0]}` }
  }
  // `null`, a list and a number are valid JSON and are not a manifest. Without
  // this sieve, a `package.json` whose content is `null` would pass as "read"
  // and `valor.scripts` would throw over in the rule — exit 127, accusing
  // rebar-check of a defect that belongs to the target.
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return { estado: 'ilegivel', erro: 'valid JSON but not an object' }
  }
  return { estado: 'ok', valor }
}

function ler(dir, rel) {
  try {
    return readFileSync(join(dir, rel), 'utf8')
  } catch {
    return null
  }
}

function existe(dir, rel) {
  try {
    return existsSync(join(dir, rel))
  } catch {
    return false
  }
}

const CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|vue|astro)$/i
const IGNORAR = /(^|\/)(node_modules|dist|build|\.next|out|coverage|vendor)\//

/**
 * Variables the ENVIRONMENT supplies, not the project. They leave the
 * `env-example` score because `.env.example` documents what a person has to
 * FILL IN, and nobody fills in NO_COLOR in an example file.
 *
 * Measured on 2026-08-30 across the 11 repositories: `NO_COLOR` was the ONLY
 * variable of the alicerce (which thereby became "reads 1 environment
 * variable(s) and has no .env.example") and the ONLY one charged against prumo,
 * which has a .env.example with PRUMO_KEK and DATABASE_URL documented. Two of
 * six accusations were this. `CI` inflated openkartline from 4 to 5 — there the
 * accusation still stands, because the other four are real.
 *
 * The list is short on purpose, and each name is here because it is produced by
 * whoever RUNS the program (terminal, CI runner, toolchain) and not by whoever
 * configures it. Platform names (GITHUB_*, VERCEL_*) did not get in because
 * they appeared in none of the 11 — a list larger than the measurement is guesswork.
 */
const ENV_DO_AMBIENTE = new Set(['CI', 'NO_COLOR', 'FORCE_COLOR', 'NODE_ENV'])

/**
 * A file is a test if a SEGMENT of the path is a test folder, or if the NAME is
 * a test name. By segment, not by substring: "pass/" contains "provar" and is
 * not a test folder.
 *
 * The Portuguese enters here because the previous version was blind to it.
 * Measured in the alicerce: 43 tracked files with "prova" in the name, and the
 * rule saw ZERO — a checker written in Portuguese that does not recognize a
 * test named in Portuguese. It was one of the two proven deterministic false
 * positives. DO NOT TRANSLATE the Portuguese entries below: they are folder and
 * file names inside the Brazilian repositories this ruler audits, and
 * translating them blinds the rule exactly where it exists to work.
 *
 * `_test.` and `test_` enter for the SAME reason, one language down: the Python
 * and Go convention writes `vectra_kw82_test.py`, and the previous pattern only
 * knew the dot (`.test.`). Measured on 2026-08-30 across the 12 repositories:
 * VectraB-Lab was accused of "zero test files" while having THREE tracked
 * `*_test.py` scripts. Recognizing the convention adds exactly 3 files across 12
 * repositories and ZERO evaluable code files — no content rule loses text
 * because of this, and the arithmetic is in the report.
 *
 * The loose prefix (`TESTE-1-cabo-KKL.md`) stays out on purpose: a `-`
 * separator with no dot is a document name, and accepting it would turn a `.md`
 * of notes into proof that the repository tests.
 */
const PASTA_TESTE = new Set([
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  'teste',
  'testes',
  'prova',
  'provas',
  'proof',
  'proofs',
])
const NOME_TESTE = /(\.|^|_)(test|spec|teste|prova)\.|^(provar|testar)[-.]|^test_/i

/**
 * What CANNOT be a test, by extension.
 *
 * It is a NEGATIVE, and the choice matters. The temptation is to list the
 * extensions that COUNT as a test — `.mjs .ts .py .go` — and that list would
 * fail `.dart`, `.R`, `.jl`, `.hs` and `.bats`: languages whose test file has a
 * test name and an extension nobody remembers to add. A false positive in an
 * automatic rule costs more than a missing rule, and here the false positive
 * would be saying "zero test files" to someone who wrote tests.
 *
 * So the list is of what is prose, spreadsheet, image, media or package. An
 * unknown extension still counts as a test, which is the safe side of this choice.
 */
const EXTENSAO_DE_DOCUMENTO = new Set([
  // prose
  'md',
  'markdown',
  'mdx',
  'txt',
  'rst',
  'adoc',
  'asciidoc',
  'org',
  'tex',
  'pdf',
  'doc',
  'docx',
  'odt',
  'rtf',
  'epub',
  // spreadsheet and presentation
  'xls',
  'xlsx',
  'ods',
  'ppt',
  'pptx',
  'odp',
  // image, media, font
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'bmp',
  'ico',
  'svg',
  'mp3',
  'wav',
  'ogg',
  'mp4',
  'mov',
  'webm',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  // package and log
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'log',
])

/**
 * A document is a document even with a test name.
 *
 * Without this, `provas/PLANO.md` satisfied the `tests` rule — the folder is in
 * `PASTA_TESTE` —, and so did `docs/PLANO.teste.md`, through `NOME_TESTE`. A
 * repository with zero tests and a planning document came out PASSED, which is
 * the wrong direction to be wrong in.
 *
 * The `tests__python-name` case had already recorded that `TESTE-1-cabo-KKL.md`
 * does not count, but attributed that to the `-` separator instead of the
 * extension: renaming it to `TESTE.1.cabo.md` brought the hole back.
 */
function ehDocumento(rel) {
  const nome = rel.split('/').pop() ?? ''
  const ponto = nome.lastIndexOf('.')
  // No extension means not a document: hooks and shell scripts live like that,
  // and a `tests/rodar` is a test.
  if (ponto <= 0) return false
  return EXTENSAO_DE_DOCUMENTO.has(nome.slice(ponto + 1).toLowerCase())
}

function ehTeste(rel) {
  if (ehDocumento(rel)) return false
  const partes = rel.split('/')
  if (partes.slice(0, -1).some((p) => PASTA_TESTE.has(p.toLowerCase()))) return true
  return NOME_TESTE.test(partes[partes.length - 1])
}

/**
 * Tracked production code — the sieve `fontes()` applies BEFORE removing tests.
 * Extracted so the COUNT of what leaves for being a test uses exactly the same
 * sieve as the exclusion: a count computed by a similar but different sieve is
 * worse than no count at all, because it looks like it checks.
 */
const ehCodigoAvaliavel = (a) => CODIGO.test(a) && !IGNORAR.test(a)

/**
 * Where a `caso.json` has the meaning of a marker. Outside here it is an
 * ordinary file.
 *
 * The comment that used to be in this file claimed the marker "is no generic
 * bypass". The audit proved the opposite with three bytes:
 *
 *     echo "{}" > domains/caso.json && git add domains/caso.json
 *
 * The whole `domains/` tree left the evaluation. No content validation — `{}`
 * was enough — and the only signal was the fixture count going from 63 to 70,
 * in dim grey and WITH NO warning symbol.
 *
 * A literal prefix, and not "any folder ending in proofs/cases/": the marker
 * holds in the place where THIS repository's proofs live and in no other.
 * Recognizing the path by shape would give back the generic bypass with one
 * extra `mkdir -p`.
 */
const RAIZES_DE_PROVA = [
  'tooling/rebar-check/proofs/cases/',
  // The security module has proofs of its own, and without this line its trees
  // entered rebar's own evaluation: the warning "3 caso.json IGNORED as proof
  // marker" came out on the module's first commit. They passed by luck — the
  // fixtures are small today —, and it is exactly the failure that broke nine
  // rules during the translation of this repository, when the 53 markers
  // stopped being recognized and rebar accused its own test material.
  //
  // A LIST, and not "any folder ending in proofs/cases/": recognizing by shape
  // would give back the generic bypass with one extra `mkdir -p`, which is why
  // the prefix has been literal from the start. A new root goes in here, by
  // hand, and whoever adds one writes down why.
  'tooling/security/proofs/cases/',
]

/**
 * A TEMPLATE IS NOT A PRODUCT — it is the same lesson as `caso.json`, one floor
 * up, and it came back the minute the generator entered the repository.
 *
 * `new/site/blocks/` and `new/gate/arquivos/` are FILES THAT ARE GOING TO BE
 * COPIED into another repository. Tracked in here, rebar started measuring
 * itself by them. Measured on 2026-08-31, with `new/` committed into a mirror
 * of the repository in os.tmpdir() (22 files):
 *
 *   typecheck    – no TypeScript        →  ✗ no tracked package.json has script
 *                                            typecheck, …
 *   score        11 of 11               →  11 of 13
 *
 * The five `.tsx`/`.ts` files of `new/site/blocks/app/` and `conteudo/` made
 * rebar look like a TypeScript project without a compiler. It is not: rebar has
 * not one line of TypeScript of its own, and those five files are only compiled
 * AFTER being copied, by the generated project's `tsc`.
 *
 * And there is the argument that authorizes the exclusion without loosening
 * anything: the template goes on being checked, only WHERE IT LANDS. Step 5 of
 * the generator runs this same ruler on the freshly created project, with the
 * template already in place, with the Next `tsconfig.json` and `package.json`
 * around it. Measuring the template in the wrong place is not extra rigor, it
 * is a measurement of something else.
 *
 * The lock is double and both halves are mandatory:
 *   1. the prefix has to be EXACTLY one of the literal roots below — not
 *      "starts with", not "any folder called blocks". Without this the marker
 *      would become the generic bypass `caso.json` already tried to be;
 *   2. there has to be a `modelo.json` with `for` and `why`, tracked and
 *      readable. A refused marker becomes a WARNING naming the file.
 * And the count is printed on the scoreboard, always, like the proofs' count.
 */
const RAIZES_DE_MODELO = ['new/gate/arquivos/', 'new/site/blocks/']

/**
 * Minimum schema of the marker: for `caso.json`, `rule` and `why`, the two
 * fields prove.mjs demands of every case; for `modelo.json`, `for` and `why`. A
 * marker without them is not a marker, it is a file with the right name — and
 * hiding a tree was exactly what a file with the right name got you.
 */
function marcadorInvalido(dir, rel, campos = ['rule', 'why']) {
  const lido = lerJsonRastreado(dir, rel)
  if (lido.estado !== 'ok') return lido.erro
  const falta = campos.filter((k) => typeof lido.valor[k] !== 'string' || !lido.valor[k].trim())
  return falta.length ? `missing ${falta.join(' and ')}` : null
}

/**
 * Takes out of the evaluation the trees that are PROOF MATERIAL, not product.
 *
 * This was born of a real failure, and it showed up the minute the proofs were
 * written: the `ui-falso` and `schema-orfao` cases are, by construction,
 * defective repositories in miniature. Tracked inside rebar, they made rebar
 * fail on `ui-falso`, `schema-orfao` and `typecheck` — accused by its own
 * proofs. A tool that cannot tell the product from the proof material measures
 * the proof material.
 *
 * Two exit doors, both VISIBLE in the output, and both with a lock:
 *
 *   caso.json     marks the root of a proof case. Only holds under
 *                 RAIZES_DE_PROVA and only with the minimum schema — see the
 *                 note above, which records the three-byte attack the previous
 *                 version accepted. A refused marker becomes a WARNING, naming
 *                 the file.
 *   .rebarignore  path prefixes, one per line, `#` comments. It exists for
 *                 vendor and generated material. It is a real bypass — which is
 *                 why the count of what it hid is printed on the scoreboard,
 *                 and why it has to be TRACKED. An open gate has to be a
 *                 checked fact, not an omission.
 */
/**
 * Mode of each file in the git INDEX, not on disk.
 *
 * The distinction decides the `hooks-executaveis` rule: the `chmod` an
 * installer does is local and does not travel in the clone; what travels is the
 * committed mode. In a Linux clone, a hook with mode 100644 is ignored by git
 * IN SILENCE — the installer prints "hooks installed" and nothing runs.
 */
function modosDoIndice(dir) {
  // `-z` for the same reason as `lerRepo`: with an accented name the path comes
  // back quoted and the file mode is lost -- the `hooks-executable` rule would
  // stop seeing precisely the hook whose name has an accent.
  const r = git(dir, ['ls-files', '--stage', '-z'])
  if (!r.ok || !r.saida) return new Map()
  const mapa = new Map()
  for (const linha of r.saida.split('\0')) {
    // "<mode> <sha> <stage>\t<path>"
    const tab = linha.indexOf('\t')
    if (tab === -1) continue
    mapa.set(linha.slice(tab + 1), linha.slice(0, linha.indexOf(' ')))
  }
  return mapa
}

function semFixtures(dir, todos) {
  const raizes = []
  const marcadoresRecusados = []
  for (const a of todos.filter((x) => basename(x) === 'caso.json')) {
    const prefixo = a.slice(0, -'caso.json'.length)
    // An empty root is the worst case of the attack: a `caso.json` at the ROOT
    // of the repository produces prefix '' and `''.startsWith` matches
    // EVERYTHING — the whole repository would vanish from the evaluation with a
    // three-byte file.
    if (!prefixo) {
      marcadoresRecusados.push(`${a} — at the repository root, it would hide the whole repository`)
      continue
    }
    // `prefixo === <raiz>` is the same trap one level down: a marker placed in
    // the folder that CONTAINS the cases would erase them all at once.
    const sobRaiz = RAIZES_DE_PROVA.some((raiz) => prefixo.startsWith(raiz) && prefixo !== raiz)
    if (!sobRaiz) {
      marcadoresRecusados.push(
        `${a} — outside ${RAIZES_DE_PROVA.map((r) => `${r}<case>/`).join(' and ')}`,
      )
      continue
    }
    const invalido = marcadorInvalido(dir, a)
    if (invalido) {
      marcadoresRecusados.push(`${a} — ${invalido}`)
      continue
    }
    raizes.push(prefixo)
  }

  // The generator's TEMPLATE tree — see RAIZES_DE_MODELO. Double lock: prefix
  // identical to a literal root AND a marker with a schema.
  const raizesDeModelo = []
  const modelosRecusados = []
  for (const a of todos.filter((x) => basename(x) === 'modelo.json')) {
    // A marker INSIDE a proof case is not a marker of this repository: it is
    // the case's content, and the whole case already left the evaluation one
    // loop above. Without this line, the three `modelo.json` files of the
    // `typecheck__modelo-*` cases came out as "3 modelo.json IGNORED" on
    // rebar's own scoreboard — a true warning about a file nobody was going to
    // read as a bypass.
    if (raizes.some((p) => a.startsWith(p))) continue
    const prefixo = a.slice(0, -'modelo.json'.length)
    if (!RAIZES_DE_MODELO.includes(prefixo)) {
      modelosRecusados.push(`${a} — not one of the template roots`)
      continue
    }
    const invalido = marcadorInvalido(dir, a, ['for', 'why'])
    if (invalido) {
      modelosRecusados.push(`${a} — ${invalido}`)
      continue
    }
    raizesDeModelo.push(prefixo)
  }

  // Read from GIT, not from disk. An untracked `.rebarignore` — including one
  // hidden behind `.git/info/exclude` — blinded the checker without existing
  // for git: it does not enter a diff, does not enter a review, does not show
  // up in `git status`. A bypass that is not under review is a back door, so
  // here it is ignored entirely and the fact becomes a warning.
  const ignoreRastreado = todos.includes('.rebarignore')
  const ignoreNoDisco = ler(dir, '.rebarignore')
  const ignoreClandestino = ignoreNoDisco !== null && !ignoreRastreado
  const prefixos = (ignoreRastreado ? ignoreNoDisco || '' : '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => (l.endsWith('/') ? l : l + '/'))

  const arquivos = []
  let provas = 0,
    modelos = 0,
    ignorados = 0
  for (const a of todos) {
    if (raizes.some((p) => a.startsWith(p))) {
      provas++
      continue
    }
    if (raizesDeModelo.some((p) => a.startsWith(p))) {
      modelos++
      continue
    }
    if (prefixos.some((p) => a.startsWith(p))) {
      ignorados++
      continue
    }
    arquivos.push(a)
  }
  return {
    arquivos,
    ignorados: {
      provas,
      raizesDeProva: raizes,
      marcadoresRecusados,
      modelos,
      raizesDeModelo,
      modelosRecusados,
      rebarignore: ignorados,
      rebarignoreClandestino: ignoreClandestino,
    },
  }
}

/**
 * Content of the tracked code files, with a size ceiling, split into the two
 * piles the rules actually want: `producao` and `teste`.
 *
 * The split comes out of here, and not of a second loop, because the sieve has
 * to be the SAME at both ends — the file above already records that a count
 * computed by a similar but different sieve is worse than no count at all.
 *
 * `teste` exists because almost every content rule wants to look at production
 * only, and ONE does not: `schema-orfao` asks whether anyone READS the schema,
 * and a contract test that imports it is the strongest possible proof that
 * someone reads it. Measured: `openkartline` was accused of two schemas
 * "defined and never read" with `apps/web/src/services/schemaContract.test.ts`
 * importing both.
 */
function fontes(dir, arquivos) {
  const producao = []
  const teste = []
  for (const a of arquivos) {
    if (!ehCodigoAvaliavel(a)) continue
    try {
      if (statSync(join(dir, a)).size > 512 * 1024) continue
      ;(ehTeste(a) ? teste : producao).push([a, readFileSync(join(dir, a), 'utf8')])
    } catch {
      /* the file vanished between the ls-files and the read */
    }
  }
  return { producao, teste }
}

// ──────────────────────────── defense looked for where the defect was found
//
// A whole class of false positive fixed here: DEFECT LOOKED FOR RECURSIVELY,
// DEFENSE LOOKED FOR ONLY AT THE ROOT. `ui-falso` swept `components/ui/` at any
// depth and checked `components.json` only in `r.dir`; `formatter`, `typecheck`
// and `shadcn-completo` read only the root package.json. Five of the twelve
// measured repositories are monorepos, and the accusation landed on exactly
// those. Measured: prumo, ducado and LinhaK accused of "components/ui/ imitating
// the convention, with no components.json in any directory above" while all
// three had the file tracked (apps/web/, apps/web/, web/); openkartline accused
// of "no prettier" with prettier declared in apps/web/package.json. Five
// findings, five false.

const RE_MANIFESTO = /(^|\/)package\.json$/
const RE_COMPONENTS_JSON = /(^|\/)components\.json$/
// A file's directory prefix, in git's format: '' at the root, 'apps/web/' with
// a trailing slash. Git ALWAYS returns a forward slash, including on Windows;
// `join`/`sep` here would produce 'apps\web\' and nothing would match anything.
const pastaDe = (rel) => rel.slice(0, rel.lastIndexOf('/') + 1)

/**
 * Every TRACKED package.json, read, with the state of the read preserved.
 * `arquivos` already came filtered by `semFixtures`, so the manifests of
 * rebar's own proof cases stay out — as they have to.
 */
function manifestosNpm(dir, arquivos) {
  return arquivos
    .filter((a) => RE_MANIFESTO.test(a) && !IGNORAR.test(a))
    .map((rel) => ({ rel, ...lerJsonRastreado(dir, rel) }))
}

/**
 * Single door for the rules that depend on a manifest: returns a FAIL string
 * when there is a tracked package.json that could not be read, and null when it
 * is possible to go on. A fail and not `na()`, because N/A leaves the
 * denominator and that was exactly where the attack got in; a fail and not an
 * exception, because a broken package.json is a defect of the TARGET, and the
 * 127 is reserved for a defect of rebar-check.
 */
function manifestoIlegivel(r, sePresta = () => true) {
  const maus = r.manifestos.filter((m) => m.estado !== 'ok' && sePresta(m))
  if (!maus.length) return null
  const lista = maus.slice(0, 3).map((m) => `${m.rel} (${m.erro})`)
  return `package.json unreadable, impossible to evaluate: ${lista.join('; ')}`
}

/**
 * The guard restricted to the ROOT manifest, for the rules whose applicability
 * belongs to the repository and not to the package. It has to be restricted:
 * with the wide guard, an unreadable package in `web/` would make `dependabot`
 * FAIL a repository that has no package.json at the root at all — it would
 * trade a false negative for a false positive, which is the trade this whole
 * step exists not to make.
 */
const raizIlegivel = (r) => manifestoIlegivel(r, (m) => m.rel === 'package.json')

/**
 * Union of dependencies + devDependencies of ALL manifests.
 *
 * Here the raw union is the right match, and in `ui-falso` it is not — the
 * difference is what each defense defends. A formatter and a UI primitive are
 * resolved by the package manager of the WHOLE WORKSPACE (npm/pnpm/yarn hoist
 * to the root), so declaring prettier in one package formats the entire
 * repository. A `components.json`, on the other hand, configures the aliases of
 * ONE project and does not reach the neighboring package.
 */
function dependenciasDeTodos(r) {
  const d = {}
  for (const m of r.manifestos) {
    if (m.estado !== 'ok') continue
    Object.assign(d, m.valor.dependencies, m.valor.devDependencies)
  }
  return d
}

/** Script names declared in any manifest of the repository. */
function scriptsDeTodos(r) {
  const nomes = new Set()
  for (const m of r.manifestos) {
    if (m.estado !== 'ok') continue
    const s = m.valor.scripts
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue
    for (const n of Object.keys(s)) nomes.add(n)
  }
  return nomes
}

/**
 * The folder and every directory above it, up to the root: 'apps/web/src/'
 * becomes ['apps/web/src/', 'apps/web/', 'apps/', ''].
 *
 * It is `ui-falso`'s match-by-PROXIMITY rule. Going up is the only path that
 * reproduces how the real tool resolves: `components.json` lives at the root of
 * the PROJECT and its aliases point downward. That is why
 * `apps/web/components.json` defends `apps/web/src/components/ui/` (it is
 * above) and does NOT defend `packages/outro/components/ui/` (it is a sibling,
 * not an ancestor) — which was the risk of trading "only at the root" for
 * "exists anywhere", a trade of a false positive for a false negative.
 *
 * The climb goes to the root on purpose, without stopping at the package
 * boundary: a `components.json` at the root of a single-app monorepo is
 * legitimate configuration of the nested app, and the file does not say who it
 * points at. Between accusing someone who should not be accused and staying
 * quiet about someone who should, a deterministic rule chooses to stay quiet —
 * it is the same arithmetic that demoted the literal-color rule to a heuristic.
 */
function ancestrais(pasta) {
  const saida = [pasta]
  let p = pasta
  while (p) {
    p = p.slice(0, p.lastIndexOf('/', p.length - 2) + 1)
    saida.push(p)
  }
  return saida
}

/**
 * A runner called by a script: `node ci/verificar.mjs`, `tsx scripts/x.ts`.
 * Only the path, no `..` — the target has to be a file OF the repository, and
 * the final check is the `git ls-files` list, not this pattern.
 */
const RE_RUNNER =
  /(?:^|[\s;&|])(?:node|tsx|ts-node|bun)\s+(?:--?[\w-]+(?:=\S+)?\s+)*([\w./-]+\.[cm]?[jt]s)\b/g

/**
 * Expands what the CI actually executes. A workflow that runs `npm run
 * verificar` is running the body of `verificar` — and, if that body calls
 * another script, it is running that one too.
 *
 * Without this, `ci-gateia` looked for the literal words lint/typecheck/test in
 * the YAML and failed every repository that aggregates verification into a
 * single command. It was the second proven deterministic false positive.
 *
 * The second leg — following `node <file>` INTO the file — closes the same hole
 * one step further on, and it was measured: `ducado` was accused of "the CI
 * does not reach: lint" with `.github/workflows/verificar.yml` running
 * `npm run verificar`, the `verificar` script being `node ci/verificar.mjs`, and
 * that file running `npm run --silent lint` on line 21. The real chain has three
 * links and the expansion walked only two; stopping at the `node` was declaring
 * that the CI does not reach the lint it reaches on every run.
 *
 * The expansion only ADDS text, so it can only turn a fail into a pass — never
 * invent an accusation. The ceiling is `profundidade` and each name and each
 * file enter only once, otherwise a script that calls itself would make the
 * loop grow forever.
 */
/**
 * Only what the workflow EXECUTES: the values of `run:`.
 *
 * P1 of an external audit, reproduced: with `scripts.test` defined and a
 * workflow that only does `echo ok`, the rule failed — and adding the line
 * `# TODO: run test later` flipped the verdict to PASSED. The base text was the
 * raw YAML, so any appearance of the word anywhere in the file satisfied the
 * rule.
 *
 * WHY EXTRACT INSTEAD OF SUBTRACT. Removing comments would fix only the
 * reported case, and the same report names two neighbors: job name and `echo`
 * message. Subtracting non-execution is a list that never closes — `name:`,
 * `echo`, `if:`, `env:`, job key, `with:`, the `on:`. Extracting execution is a
 * list of one item, and it is the definition of what the rule asks: the CI
 * REACHES the verification, and to reach is to run.
 *
 * What stays out of reach, and it is honest to say so: a `uses:` of a composite
 * action can run the script with no `run:` visible here. In that case the rule
 * fails a CI that does verify — a false positive, and the repository chooses
 * the false positive over the false negative when the subject is a gate.
 */
function comandosDoCi(yml) {
  const linhas = yml.split('\n')
  const saida = []
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(/^(\s*)-?\s*run\s*:\s*(.*)$/)
    if (!m) continue
    const [, recuo, resto] = m
    // Block scalar: `run: |` or `run: >`, and the command comes indented below.
    if (/^[|>][-+]?\s*$/.test(resto)) {
      const base = recuo.length
      for (let j = i + 1; j < linhas.length; j++) {
        if (linhas[j].trim() === '') continue
        const r = linhas[j].match(/^(\s*)/)[1].length
        if (r <= base) break
        saida.push(linhas[j])
        i = j
      }
    } else if (resto) {
      saida.push(resto)
    }
  }
  return saida.join('\n')
}

function textoEfetivoDoCi(yml, scripts, r, profundidade = 3) {
  let texto = comandosDoCi(yml)
  const vistos = new Set()
  const lidos = new Set()
  for (let i = 0; i < profundidade; i++) {
    let cresceu = false
    for (const [nome, corpo] of Object.entries(scripts)) {
      if (vistos.has(nome)) continue
      // `npm run x`, `pnpm x`, `yarn x`, `run-s x`, `run-p x`
      const invocado = new RegExp(
        `(?:npm\\s+run|pnpm\\s+(?:run\\s+)?|yarn\\s+(?:run\\s+)?|run-[sp])\\s+${nome}\\b`,
      )
      if (invocado.test(texto)) {
        texto += '\n' + semComentario(corpo)
        vistos.add(nome)
        cresceu = true
      }
    }
    for (const m of [...texto.matchAll(RE_RUNNER)]) {
      // Normalized to a forward slash and without `./`: git returns
      // `ci/verificar.mjs` and the YAML may write `./ci/verificar.mjs`.
      const rel = m[1].replace(/\\/g, '/').replace(/^\.\//, '')
      if (lidos.has(rel) || !r.arquivos.includes(rel)) continue
      lidos.add(rel)
      const corpo = ler(r.dir, rel)
      if (corpo === null) continue
      texto += '\n' + semComentario(corpo)
      cresceu = true
    }
    if (!cresceu) break
  }
  return texto
}

// ──────────────────────────────────────────────────────────────── the rules
//
// classe: 'determinística' drops the exit code · 'heurística' only informs.
// (Both values stay in Portuguese: they are the discriminator this file, the
// MCP generator and the proofs all compare with `===`, not prose.)
// The distinction is not cosmetic: the literal-color rule, when measured on
// herz, gave SEVEN occurrences and ZERO true positives — five were comments
// documenting the rule itself. A wrong automatic rule costs more than a missing
// rule, and a heuristic that blocks teaches people to turn the whole output off.
//
// `checar` returns ONE of four things:
//   null            passed
//   'reason'        failed
//   na('reason')    not applicable — leaves the denominator
//   (throws)        broke — exit 127, defect of rebar-check

/**
 * A bot commits, and committing does not make it an inconsistent identity of
 * the owner.
 *
 * Without this list, the merge commit GitHub creates at `refs/pull/N/merge` —
 * authored by `GitHub <noreply@github.com>` — counts as a second person AND as
 * "personal e-mail exposed", two false positives at once. Measured: with that,
 * EVERY pull request was born failed, which made it physically impossible to
 * turn rebar on as a required merge check in any repository.
 */
const EH_BOT =
  /<[^>]*(noreply@github\.com|\[bot\]@|@bots\.|dependabot|renovate|github-actions)[^>]*>|\[bot\]\s*</i

// ──────────────────────────────── co-authorship: allowlist of humans

/**
 * Where the allowlist of human co-authors lives, at the root of the AUDITED
 * repository.
 *
 * A single path with no folder to create, because rebar-check runs against a
 * third party's repository: `tooling/` is rebar's layout, `.rebar-coauthors` is
 * a convention any repository can adopt with one file — same family as
 * `.rebarignore`.
 */
const ALLOWLIST_COAUTORES = '.rebar-coauthors'

/**
 * The list of AI agents, used ONLY when the audited repository has no
 * allowlist. It is documented here as what it is: a lost race.
 *
 * The previous version had 9 names. The 2026-08-30 attack built a repository in
 * tmpdir and pushed six current agents through at once — Windsurf, ChatGPT,
 * Cody, Codeium, Amazon Q, Tabnine —, all with a trailer that
 * `git log --format=%(trailers:key=Co-authored-by)` recognized, and the rule
 * accused "1 of 9 commits" in a history where 8 commits had a co-authorship
 * trailer. This list has four times as many names and will age the same way;
 * that is why it is PLAN B, and not the policy.
 *
 * An agent name that is also a person's name (Cody, Jules) gets in through the
 * domain, and not loose: accusing `Cody Silva <cody@empresa.com>` of being AI
 * would turn the lost list into a lost AND unfair list.
 */
const AGENTES_ENUMERADOS =
  /(claude|anthropic|cursor\.(com|sh)|cursoragent|copilot|codex|openai|chatgpt|devin|cognition|aider|gemini|google-labs-jules|jules@google|windsurf|codeium|sourcegraph|tabnine|amazon\s*q|amazonaws|codewhisperer|q-developer|replit|bolt\.new|v0\.dev|lovable|cline|roo-?code|kilo-?code|continue\.dev|sweep(ai|\.dev)|qodo|codium|coderabbit|greptile|ellipsis\.dev|korbit|bito\.ai|blackbox|phind|supermaven|augmentcode|zencoder|refact\.ai|sourcery|openhands|opendevin|all-hands|swe-agent|gpt-engineer|mentat|trae\.ai|marscode|comate)/i

/**
 * Automation that does NOT write code from a prompt: dependency bumper, image
 * formatter, release robot. It leaves the pot BEFORE classification, because
 * co-authorship by a maintenance robot is not co-authorship by AI.
 *
 * This exists because the list above ended in a loose `\[bot\]`, and that
 * wildcard asserted something false: that every GitHub App that signs a trailer
 * is an AI agent. Measured on 2026-08-30: `ducado` was accused of "1 of 25
 * commits with AI co-authorship" and the ONLY trailer in the whole history is
 * `dependabot[bot]`. On `openkartline` the wildcard inflated the accusation
 * from 2 to 6 — 4 of the 6 were dependabot and only 2 were Claude, so the
 * printed number was triple the true one.
 *
 * It is the same judgment `EH_BOT` already makes one rule below, with the same
 * sentence: a bot commits, and committing does not make it an AI author. And it
 * is the opposite of what the wildcard did — enumerating who is NOT AI is safe
 * here because erring short lands in the N/A branch ("cannot be classified"),
 * and not in a silent pass.
 */
const AUTOMACAO_NAO_IA =
  /(dependabot|renovate|greenkeeper|snyk-bot|imgbot|allcontributors|pre-commit-ci|mergify|semantic-release|release-please|github-actions)/i

const emailDeCoautor = (valor) => {
  const m = /<([^<>]*)>/.exec(valor)
  const bruto = (m ? m[1] : valor).trim().toLowerCase()
  return bruto.includes('@') ? bruto : null
}

/**
 * The allowlist has to be TRACKED, not just exist on disk.
 *
 * It is the same door the clandestine `.rebarignore` already had, and here it
 * would be worse: a two-byte file dropped on disk would turn off the whole rule
 * for the audited repository without showing up in any diff. `r.arquivos` comes
 * from `git ls-files`, so what is not there does not exist for this rule.
 */
function lerAllowlistCoautores(r) {
  if (!r.arquivos.includes(ALLOWLIST_COAUTORES)) return { estado: 'ausente' }
  const bruto = lerArquivo(r.dir, ALLOWLIST_COAUTORES, true)
  if (bruto.estado !== 'ok') return { estado: 'ilegivel', erro: bruto.erro }
  const emails = new Set()
  for (const linha of bruto.texto.split(/\r?\n/)) {
    const l = linha.trim()
    if (!l || l.startsWith('#')) continue
    const e = emailDeCoautor(l)
    if (e) emails.add(e)
  }
  return { estado: 'ok', emails }
}

/**
 * The co-authorship trailers of the history, asked OF GIT.
 *
 * `%(trailers:key=Co-authored-by)` is the same parser that decides what is a
 * real trailer — it resolves line folding and does not mistake a loose line in
 * the middle of the body for a trailer. Reading `%B` and running a regex over
 * it was reimplementing that by hand, and by hand a `Co-authored-by:` smuggled
 * below the `git commit -v` scissors line has already got in once.
 *
 * Plan B exists for git older than 2.22, which does not know the placeholder
 * and returns it literally. When it runs, the printed reason says it ran: a
 * verdict read by a worse instrument has to show up as such.
 */
function coautoresDoHistorico(r) {
  const SEP_COMMIT = '\x00'
  const SEP_TRAILER = '\x1e'
  const log = git(r.dir, [
    'log',
    '--format=%(trailers:key=Co-authored-by,valueonly=true,separator=%x1e)%x00',
  ])
  const suportado = log.ok && !log.saida.includes('%(trailers')
  const coautores = []

  if (suportado) {
    const registros = log.saida.split(SEP_COMMIT)
    // The last chunk after the final %x00 is empty leftover, not a commit.
    for (const reg of registros.slice(0, -1)) {
      for (const v of reg.split(SEP_TRAILER)) {
        const valor = v.trim()
        if (valor) coautores.push({ valor, email: emailDeCoautor(valor) })
      }
    }
    return { coautores, total: r.commits.length, porEnumeracaoDoTexto: null }
  }

  for (const m of r.commits.join('\n').matchAll(/^co-authored-by:[ \t]*(.+)$/gim)) {
    const valor = m[1].trim()
    if (valor) coautores.push({ valor, email: emailDeCoautor(valor) })
  }
  return {
    coautores,
    total: r.commits.length,
    porEnumeracaoDoTexto: log.ok ? 'git without %(trailers)' : log.erro || 'git log failed',
  }
}

/**
 * What counts as "there is a type check that can be called on its own".
 *
 * Demanding the literal name `typecheck` charged the repository for the
 * VOCABULARY, not the practice — the same mistake the `testes` rule made with
 * file names in Portuguese. Measured: prumo (`"tipos": "tsc -b"`) and ducado
 * (`"tipos"` at the root and `"typecheck"` in three packages) were accused of
 * having no typecheck while both had the script. `tipos` stays in Portuguese
 * below for that reason: it is a script name written inside the Brazilian
 * repositories this ruler audits, not prose.
 *
 * The list is of script NAMES, and that is deliberate: what the rule wants is a
 * target the CI can invoke. `navesz.github.io` has `tsc --noEmit` INSIDE the
 * `build` and still fails — correctly, because it is exactly the failure this
 * rule's proof describes, "the only contact with the compiler is the build".
 */
const NOMES_TYPECHECK = ['typecheck', 'type-check', 'check-types', 'tipos', 'tsc']

// ───────────────────────────────── what is, and what is NOT, a content literal
//
// §12.3 of the plan settled that the content of the `site` preset lives in
// `conteudo/*.json` and that business identity — phone, price, address — is
// validated content, not code. The `conteudo-fora-do-codigo` rule enforces it.
//
// The hard part is not the assertion, it is the DEFINITION. A `className`
// string, an `import`, an `aria-label` and an object key are not content, and
// the wide version of this rule would accuse them all. So it recognizes only
// TWO shapes, both chosen for being impossible to confuse with the four above:
//
//   1. PRICE — `R$` followed by a digit. It does not exist in a class name, in
//      an import path, in an object key or in an accessibility label. Note the
//      requirement is the DIGIT: `` `R$ ${valor}` `` does not match, and that is
//      right — a currency formatter is code, a currency value is content.
//      `R$` stays as it is: it is the Brazilian currency marker the rule hunts
//      for inside audited repositories, not prose.
//
//   2. RENDERED SENTENCE — text between `>` and `<`, that is, a JSX text node.
//      By construction of JSX, className/import/aria-label/key live in an
//      ATTRIBUTE or outside the markup, and a text node is what the visitor reads.
//
// How much this catches: measured on 2026-08-30 across the 11 repositories,
// IGNORING the applicability gate, the definition finds 188 occurrences in 45
// files of 7 repositories — 147 in decima-edicoes alone, in 15 of its 25 files,
// then ducado 13, hug-brasil-propostas 12, vectra-painel 9, Galegos 3, prumo 3
// and LinhaK 1. None of the 188 is false; I opened the list and they are all
// content indeed, without a single className, import, aria-label or key string.
// What the table proves is something else — that EVERY hand-written site
// violates this assertion, and therefore the assertion cannot be charged to
// someone who never promised to keep it.
//
// Worth recording the inversion the same table showed, because it is a limit of
// the definition and not a compliment to it: Galegos, which §12.3 cites as the
// worst case with the 623 lines of `menu.ts`, gives 3 — and what catches it
// there is the PRICE (`src/lib/menu.ts` line 590), not the sentence. A catalog
// in a `.ts` object literal stays invisible, and stays so on purpose: the
// pattern that caught it would catch every constant table of every project.
//
// That is where the gate comes from: the rule only applies to the repository
// that ADOPTED the convention, that is, that has `conteudo/*.json` tracked.
// Same shape as `notice` (only charges NOTICE to whoever chose Apache) and
// `ui-falso` (only charges components.json to whoever created components/ui/).
// With the gate, the 11 measured repositories come out N/A with the reason
// printed, and the generator's output — which is born with `conteudo/` — is
// charged in full.

const RE_CONTEUDO_JSON = /^((?:.*\/)?)conteudo\/[^/]+\.json$/
export const PRECO_BRL = /R\$\s?\d[\d.,]*/
export const RE_JSX = /\.(tsx|jsx)$/i

/**
 * Does a `/` open a regular expression, or divide? The last code character
 * before it decides — and for keywords the word decides, because `return /x/`
 * is a regex and `total / 2` is a division with `total` ending in a letter just
 * like `return`.
 */
const ABRE_REGEX = /[(,=:[!&|?{};+\-*%~^<>]$/
const PALAVRA_ANTES_DE_REGEX =
  /\b(return|typeof|instanceof|in|of|case|do|else|yield|await|new|delete|void|throw)$/

/**
 * Strips comments — and ONLY comments.
 *
 * It lives outside the content rule because six places depend on it for the
 * same reason, and the reason has been recorded in this file since the first
 * measurement: of the SEVEN occurrences the literal-color rule gave on herz,
 * FIVE were comments documenting the rule itself. A comment that trips the rule
 * it explains is the cheapest way to burn the tool — and it almost happened
 * again here: writing the Galegos number out in full in the `telefone` note
 * made rebar accuse its own index.mjs, and writing `process` `.env.X` in the
 * `url-producao` note made `env-example` charge a `.env.example` for a variable
 * that does not exist.
 *
 * ── WHY IT IS NOT TWO REGEXES, which is what was here until 2026-09-06 ───────
 *
 *   t.replace(<block>, ' ').replace(<line>, '$1 ')
 *
 * where <block> matched from `/`+`*` to the next `*`+`/`, stopping at nothing,
 * and <line> matched from `//` to the end of the line as long as the preceding
 * character was not `:`. (Written that way, and not literally, because a
 * literal `*`+`/` in here would close this comment -- which is the same
 * blindness the text below describes, happening in this paragraph.)
 *
 * A regex does not know what a string is. A block opener INSIDE a string opened
 * a comment that only closed at the file's next block closer, and everything in
 * between was ERASED — with no line limit and leaving no trace. A `//` inside a
 * string ate the rest of the line.
 *
 * Erasing is the wrong outcome. The function exists to take out of the exam
 * what does not run; what it did was take out of the exam what does run, and
 * six rules judged the leftovers. One of them is the SECURITY rule:
 * `rejectUnauthorized: false` written after a string containing a block opener
 * left the audit in silence. A false negative shows up nowhere — it is the
 * worst thing a ruler does.
 *
 * ── THE PROPERTY THAT DECIDES THE DESIGN ─────────────────────────────────────
 *
 * ONLY THE COMMENT BRANCH ERASES. String, template and regular expression are
 * COPIED character by character; they exist here only so that the `//` and the
 * block opener inside them are not read as a comment. So getting string
 * detection wrong never erases code — at most it lets a comment through, which
 * is a false positive, and a false positive shows up in the face of whoever
 * runs it. The old way erred toward the other side.
 *
 * And a string ends at the line break, on purpose: an unclosed quote — or a
 * prose apostrophe, if this ever touches text — contaminates one line and never
 * the whole file. Same for the regular expression.
 *
 * The `:` before `//` is still protected, which is the usual `https://`; inside
 * a string it would already be protected now, but the body of the shell script
 * `ci-gates` assembles arrives here without quotes.
 */
// Exported for `prove-strip.mjs`: six rules judge what this function returns,
// and until 2026-09-06 nothing exercised it on its own.
export function semComentario(t) {
  return partirComentario(t).codigo
}

/**
 * The comments only, from the SAME machine.
 *
 * It exists because the `single-language` rule extracted comments with the same
 * naive `t.match(...)` pair that `semComentario` stopped being — written out here
 * rather than pasted, because a literal close-block inside this doc would end it.
 * Same reason as before: a regex does not know what a string is.
 * Measured in `new/gate/aplicar.mjs`: a block-opener inside a string literal
 * opened a bogus comment and dragged code into the text the rule was about to
 * judge.
 *
 * Two extractions of the same concept are two sources to diverge, and these did.
 * Now there is one.
 */
export function soComentario(t) {
  return partirComentario(t).comentarios
}

function partirComentario(t) {
  let saida = ''
  let notas = ''
  let anterior = '' // last code character emitted, ignoring whitespace
  let palavra = '' // and the last word, for `return /x/`
  // One item per open template. `chaves` is the depth of `${...}` inside it: 0
  // means we are in the body of the template, and not in the code.
  const templates = []
  let i = 0

  const codigo = (c) => {
    saida += c
    if (!/\s/.test(c)) {
      anterior = c
      palavra = /[\w$]/.test(c) ? palavra + c : ''
    }
  }

  while (i < t.length) {
    const topo = templates[templates.length - 1]
    const c = t[i]
    const d = t[i + 1] ?? ''

    // ── template body: only `\`, `${` and the backtick end it
    if (topo && topo.chaves === 0) {
      if (c === '\\') {
        saida += t.slice(i, i + 2)
        i += 2
        continue
      }
      if (c === '`') {
        templates.pop()
        codigo(c)
        i += 1
        continue
      }
      if (c === '$' && d === '{') {
        topo.chaves = 1
        saida += '${'
        i += 2
        continue
      }
      saida += c
      i += 1
      continue
    }

    // ── line comment. The `:` before it is the `https://`.
    if (c === '/' && d === '/' && anterior !== ':') {
      const de = i
      while (i < t.length && t[i] !== '\n') i += 1
      notas += `${t.slice(de, i)}\n`
      saida += ' '
      continue
    }

    // ── block comment. The line breaks stay: without them the text shrinks and
    //    every rule that counts lines starts pointing at the wrong one.
    if (c === '/' && d === '*') {
      const de = i
      i += 2
      while (i < t.length) {
        if (t[i] === '*' && t[i + 1] === '/') {
          i += 2
          break
        }
        if (t[i] === '\n') saida += '\n'
        i += 1
      }
      notas += `${t.slice(de, i)}\n`
      saida += ' '
      continue
    }

    // ── string. Copied whole; ends at the quote or at the line break.
    if (c === '"' || c === "'") {
      codigo(c)
      i += 1
      while (i < t.length) {
        if (t[i] === '\\') {
          saida += t.slice(i, i + 2)
          i += 2
          continue
        }
        if (t[i] === '\n') break
        const fechou = t[i] === c
        saida += t[i]
        i += 1
        if (fechou) break
      }
      continue
    }

    if (c === '`') {
      templates.push({ chaves: 0 })
      codigo(c)
      i += 1
      continue
    }

    // ── regular expression. Also copied, and also confined to one line.
    if (
      c === '/' &&
      (anterior === '' || ABRE_REGEX.test(anterior) || PALAVRA_ANTES_DE_REGEX.test(palavra))
    ) {
      codigo(c)
      i += 1
      let classe = false
      while (i < t.length) {
        if (t[i] === '\\') {
          saida += t.slice(i, i + 2)
          i += 2
          continue
        }
        if (t[i] === '\n') break
        if (t[i] === '[') classe = true
        else if (t[i] === ']') classe = false
        const fechou = t[i] === '/' && !classe
        saida += t[i]
        i += 1
        if (fechou) break
      }
      continue
    }

    // ── braces, which is what returns the template to its own body
    if (topo && c === '{') topo.chaves += 1
    if (topo && c === '}' && topo.chaves > 0) topo.chaves -= 1

    codigo(c)
    i += 1
  }

  return { codigo: saida, comentarios: notas }
}

/** No comments and no import lines: neither of the two is rendered. */
export function semComentarioNemImport(t) {
  return semComentario(t).replace(/^\s*import[^\n]*$/gm, ' ')
}

/**
 * ── THE DISCRIMINATOR: who OWNS the text node ────────────────────────────────
 *
 * Every quoted sample below is EVIDENCE copied verbatim out of the audited
 * repositories, which are Brazilian. It stays in Portuguese: translating a
 * measurement rewrites the measurement.
 *
 * The question that separates CONTENT from INTERFACE VOCABULARY is not one of
 * length. Measured across the 11 repositories: "Imprimir ou salvar em PDF" has
 * 5 words and 24 characters, "Nossa cozinha abre às 18h" has 5 and 25 — no
 * length threshold passes between the two. What does pass is the SEMANTICS OF
 * THE ELEMENT carrying the text: that "Imprimir ou salvar em PDF" lives inside
 * a `<button>` (`decima-edicoes/app/components/print-button.tsx:8`), and
 * `<button>` is not a prose element — it is a control, and the text of a
 * control is its NAME.
 *
 * Hence the rule only asserts about a text node whose OWNER is a prose element
 * (`PROSA` below). Three measured consequences, all against the 11:
 *
 *   · an action label leaves by construction — `<button>`, `<a>` and `<label>`
 *     are not in `PROSA`, and no verb has to be enumerated for that;
 *   · the exclusion is by the OWNER, not by the ancestor. Looking for `<a>` in
 *     the chain would remove ZERO accusations in this sample and would remove
 *     real content the moment a link-card appeared (`<a><h3>title</h3></a>`),
 *     where the title is content and the `<a>` is only the clickable area;
 *   · the gate costs 38 accusations out of the 300 and none of them is content:
 *     they are `<div>`, `<span>` and third-party components, where the checker
 *     DOES NOT KNOW what the element means. Same discipline as `na()`: what
 *     cannot be decided leaves, and leaves quietly.
 *
 * ── THE MATCH: a run of text, not a chunk between two `<` ────────────────────
 *
 * The previous match cut at the first `<`, so a sentence crossed by a
 * `<strong>` became two or three findings. Measured: 17 of the 185 sentences
 * started with a period, with a dash or in the middle of the clause — they were
 * FRAGMENTS, not literals. And the damage was more than cosmetic: a sentence
 * that breaks into pieces of fewer than 4 words VANISHES. `nosDeTexto()`
 * assembles the run across the inline elements and closes it at a block
 * boundary. Fragments measured after that: ZERO of 258.
 *
 * A `{…}` in child position becomes a BARRIER: its loose text is code and goes
 * away, the JSX opened in there is still read, and a marker stays in its place.
 * That is what makes `<p>Faltam {n} dias para o milhão</p>` visible — the old
 * match discarded the whole sentence because of the brace.
 *
 * ── THE TWO GUARDS THAT DIED, with the number that killed them ───────────────
 *
 * They are exactly two of the mutations the audit saw survive, and they
 * survived because the constants had no job:
 *
 *   MINIMUM OF 25 CHARACTERS — dead. Measured: it cost 13 TRUE accusations
 *     ("Este carro fala KW82.", "Esta edição não existe.", "Suas chaves de
 *     API") and bought none. What does that job is the minimum number of
 *     WORDS, and that one has a number: lowered from 4 to 1 the definition
 *     jumps from 262 to 481 findings, and the extra 219 are field labels
 *     ("Forma de pagamento", "Informe a rua"), section names ("Cardápio") and
 *     nodes made only of interpolation.
 *   SINAL_DE_CODIGO as a CHARACTER CLASS — dead in its old form. It existed to
 *     kill what crossed the `>` of an arrow or of a comparison; with the run
 *     assembled by `nosDeTexto()`, an expression is a barrier and that no
 *     longer reaches here. What was left of it was damage: 51 TRUE accusations
 *     fell only because the prose had a `;` or a `:`
 *     ("Madeira real continua se movendo. Plano, umidade e integridade
 *     precisam ser medidos no recebimento…"). The name stays and the body
 *     changes: the sign that it is not prose became the PROPORTION of letters.
 */
const PROSA = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'dd',
  'dt',
  'blockquote',
  'figcaption',
  'caption',
  'td',
  'th',
  'legend',
  'article',
  'address',
])

/** Inline elements: the run of text crosses them, they do not interrupt it. */
const INLINE = new Set([
  'strong',
  'b',
  'em',
  'i',
  'span',
  'code',
  'small',
  'mark',
  'u',
  's',
  'sub',
  'sup',
  'abbr',
  'time',
  'kbd',
  'var',
  'cite',
  'q',
  'dfn',
  'bdi',
  'bdo',
  'wbr',
  'br',
])

/** Childless elements: `<br/>` becomes a space, the rest is a block boundary. */
const VAZIO = new Set([
  'br',
  'hr',
  'img',
  'input',
  'meta',
  'link',
  'source',
  'track',
  'area',
  'col',
  'embed',
  'param',
])

/**
 * HTML element names the reader recognizes. It is the parser's LOCK: without
 * it, the `<b)` of an `if (a<b)` would become a tag. With it the tag still has
 * to close on a `>` with no `;` and no other `<` on the way.
 */
const HTML = new Set([
  ...PROSA,
  ...INLINE,
  ...VAZIO,
  'a',
  'aside',
  'audio',
  'body',
  'button',
  'canvas',
  'circle',
  'colgroup',
  'defs',
  'details',
  'dialog',
  'div',
  'dl',
  'ellipse',
  'fieldset',
  'footer',
  'form',
  'g',
  'head',
  'header',
  'html',
  'iframe',
  'label',
  'line',
  'main',
  'nav',
  'noscript',
  'ol',
  'optgroup',
  'option',
  'path',
  'picture',
  'polygon',
  'polyline',
  'pre',
  'rect',
  'script',
  'section',
  'select',
  'slot',
  'style',
  'summary',
  'svg',
  'table',
  'tbody',
  'template',
  'text',
  'textarea',
  'tfoot',
  'thead',
  'title',
  'tr',
  'tspan',
  'ul',
  'use',
  'video',
])

const MARCA_EXPR = String.fromCharCode(0)
const PALAVRA = /[\p{L}][\p{L}'’-]*/gu
const LETRA_OU_PONTUACAO = /[\p{L} ,.;:!?'’…·—–-]/gu

/**
 * The minimum that separates SENTENCE from LABEL, and the only length threshold
 * left. The number is in the block above: lowered from 4 to 1, the definition
 * goes from 262 to 481 findings across the 11 repositories, and the extra 219
 * are labels, not content.
 */
const MIN_PALAVRAS = 4

/** Below this the node is a table of numbers, not prose — see `sinalDeCodigo`. */
const MIN_LETRAS = 0.9

/** Skips a string or template starting from the quote at `i`. */
function pularAspas(t, i) {
  const aspa = t[i]
  i++
  while (i < t.length) {
    if (t[i] === '\\') i += 2
    else if (t[i] === aspa) return i + 1
    else i++
  }
  return i
}

/**
 * Assembles the RUNS of text of a JSX file: each one is the text an element
 * carries between two block boundaries, with the inline elements crossed.
 */
function nosDeTexto(fonte) {
  const saida = []
  const pilha = []
  let i = 0
  const topo = () => pilha[pilha.length - 1]

  function fecharCorrida(q) {
    if (!q) return
    // Expression and inline do not EMIT: the first because its loose text is
    // code, the second because its text belongs to the parent's run.
    if (q.expressao || q.inline) {
      q.partes = []
      return
    }
    const texto = q.partes.join('')
    q.partes = []
    if (texto.trim()) saida.push({ texto, dono: q.nome })
  }

  function fecharQuadro(q) {
    const pai = topo()
    if (q.inline && pai) {
      pai.partes.push(q.partes.join(''))
      return
    }
    fecharCorrida(q)
  }

  function fronteira() {
    const pai = topo()
    if (!pai) return
    if (!pai.inline) return fecharCorrida(pai)
    const avo = pilha[pilha.length - 2]
    if (avo) {
      avo.partes.push(pai.partes.join(''))
      pai.partes = []
    }
  }

  while (i < fonte.length) {
    const c = fonte[i]

    if (c === '<' && /[A-Za-z/]/.test(fonte[i + 1] || '')) {
      let j = i + 1
      const fechamento = fonte[j] === '/'
      if (fechamento) j++
      let nome = ''
      while (j < fonte.length && /[\w.:-]/.test(fonte[j])) nome += fonte[j++]
      // A component (uppercase) and `Namespace.Tag` count; lowercase only if HTML.
      if (!nome || !(/^[A-Z]/.test(nome) || nome.includes('.') || HTML.has(nome))) {
        i++
        continue
      }
      let k = j
      let chaves = 0
      let fechou = false
      while (k < fonte.length && k - i < 4000) {
        const d = fonte[k]
        if (d === '"' || d === "'" || d === '`') {
          k = pularAspas(fonte, k)
          continue
        }
        if (d === '{') {
          chaves++
          k++
          continue
        }
        if (d === '}') {
          chaves--
          k++
          continue
        }
        if (chaves === 0 && (d === '<' || d === ';')) break
        if (chaves === 0 && d === '>') {
          fechou = true
          break
        }
        k++
      }
      if (!fechou) {
        i++
        continue
      }
      const autoFecha = fonte[k - 1] === '/'
      i = k + 1

      if (fechamento) {
        const idx = pilha.map((x) => x.nome).lastIndexOf(nome)
        if (idx === -1) continue
        if (!INLINE.has(nome)) fronteira()
        while (pilha.length > idx) fecharQuadro(pilha.pop())
        if (!INLINE.has(nome)) fronteira()
        continue
      }
      if (autoFecha || VAZIO.has(nome)) {
        if (INLINE.has(nome)) {
          if (topo()) topo().partes.push(' ')
        } else fronteira()
        continue
      }
      if (!INLINE.has(nome)) fronteira()
      pilha.push({ nome, partes: [], inline: INLINE.has(nome), expressao: false })
      continue
    }

    // `{…}` in child position: barrier. See the note on the match above.
    if (c === '{' && pilha.length) {
      if (topo()) topo().partes.push(MARCA_EXPR)
      pilha.push({ nome: '{}', partes: [], inline: false, expressao: true })
      i++
      continue
    }
    if (c === '}' && pilha.length) {
      const idx = pilha.map((x) => x.expressao).lastIndexOf(true)
      if (idx !== -1) {
        while (pilha.length > idx) fecharQuadro(pilha.pop())
      } else if (topo()) topo().partes.push(c)
      i++
      continue
    }
    // Inside an expression a string is code: skipping it whole keeps a `<` or a
    // `{` written between quotes from tearing down the stack.
    if ((c === '"' || c === "'" || c === '`') && topo() && topo().expressao) {
      i = pularAspas(fonte, i)
      continue
    }

    if (topo()) topo().partes.push(c)
    i++
  }
  while (pilha.length) fecharQuadro(pilha.pop())
  return saida
}

/** What makes a node NOT prose: a letter ratio below MIN_LETRAS. */
function sinalDeCodigo(frase) {
  const letras = (frase.match(LETRA_OU_PONTUACAO) || []).length
  return letras / frase.length < MIN_LETRAS
}

/** The CONTENT sentences of a JSX file, by the definition in the block above. */
export function frasesDeConteudo(t) {
  const achadas = []
  for (const no of nosDeTexto(t)) {
    if (!PROSA.has(no.dono)) continue
    const frase = no.texto.split(MARCA_EXPR).join('…').replace(/\s+/g, ' ').trim()
    if (!frase) continue
    const palavras = frase.match(PALAVRA) || []
    if (palavras.length < MIN_PALAVRAS) continue
    if (sinalDeCodigo(frase)) continue
    achadas.push(frase)
  }
  return achadas
}

// EXPORTED for the MCP generator (`mcp/generate.mjs`), and that is the only
// reason for the `export` here: the artifact the MCP server reads is DERIVED
// from this list, never a copy of it. Without the export, the generator would
// have to guess `id`, `classe`, `nivel` and `titulo` by regex over the file's
// text — and a regex that errs makes the rule vanish in silence, which is
// exactly the defect the MCP exists not to repeat. With the export, the
// generator COMPARES what it read in the text with what the module hands over,
// and diverges loudly.
//
// The `EH_PROGRAMA` just below is what makes this safe: importing this file
// does not fire the CLI, because `process.argv[1]` is the other program.
export const REGRAS = [
  // ── deterministic ───────────────────────────────────────────────────────

  {
    id: 'editorconfig',
    classe: 'determinística',
    nivel: 'N1',
    // Portuguese on purpose: tooling/verify/prove-steps.mjs matches the line
    // below byte for byte — the `titulo` key plus this exact title — to plant
    // its sentinel and prove the MCP freshness gate. Translating it drops that
    // proof in silence, and repeating the literal up here would make the
    // proof's `replace` hit this comment instead of the title.
    titulo: 'tem .editorconfig',
    checar: (r) => (existe(r.dir, '.editorconfig') ? null : 'absent'),
  },

  {
    id: 'dependabot',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'automated dependency updates',
    checar: (r) => {
      // A read guard only: applicability is still the ROOT package.json,
      // because dependabot and renovate are repository configuration and not
      // package configuration. Without the guard, breaking the package.json
      // took this rule out of the denominator along with the other three.
      const ilegivel = raizIlegivel(r)
      if (ilegivel) return ilegivel
      if (!r.pkg) return na('not an npm project')
      return existe(r.dir, '.github/dependabot.yml') ||
        existe(r.dir, '.github/dependabot.yaml') ||
        existe(r.dir, 'renovate.json') ||
        existe(r.dir, '.github/renovate.json')
        ? null
        : 'no dependabot and no renovate'
    },
  },

  {
    id: 'ci',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'has CI',
    checar: (r) => (r.workflows.length ? null : 'no workflow in .github/workflows/'),
  },

  {
    id: 'ci-gates',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'the CI reaches the verification the repository has',
    checar: (r) => {
      // Same read guard as the others: with a broken package.json,
      // `r.pkg?.scripts` became `{}`, `alvos` came out empty and the rule left
      // the denominator. Four rules vanishing is what turned 9 of 10 into 6 of 6.
      const ilegivel = raizIlegivel(r)
      if (ilegivel) return ilegivel
      if (!r.workflows.length) return na('no CI — the `ci` rule is the one that demands it')
      const scripts = r.pkg?.scripts || {}
      // Charges only what the repository HAS. Demanding `lint` of a repo with
      // no lint is demanding it adopt a tool — a decision of another level.
      const alvos = ['lint', 'typecheck', 'test'].filter((g) => scripts[g])
      if (!alvos.length) return na('package.json has no lint, typecheck or test script')
      const yml = r.workflows.map((w) => ler(r.dir, w) || '').join('\n')
      const efetivo = textoEfetivoDoCi(yml, scripts, r)
      const faltam = alvos.filter((g) => !new RegExp(`\\b${g}\\b`).test(efetivo))
      return faltam.length ? `the CI does not reach: ${faltam.join(', ')}` : null
    },
  },

  {
    id: 'tests',
    classe: 'determinística',
    nivel: 'N3',
    titulo: 'has tests',
    checar: (r) => (r.arquivos.some(ehTeste) ? null : 'zero test files'),
  },

  {
    id: 'typecheck',
    classe: 'determinística',
    nivel: 'N0',
    titulo: 'has a typecheck script',
    checar: (r) => {
      const ilegivel = manifestoIlegivel(r)
      if (ilegivel) return ilegivel
      if (!r.manifestos.length) return na('not an npm project')
      if (!r.arquivos.some((a) => /\.(ts|tsx)$/i.test(a))) return na('no TypeScript')
      const nomes = scriptsDeTodos(r)
      return NOMES_TYPECHECK.some((n) => nomes.has(n))
        ? null
        : `no tracked package.json has script ${NOMES_TYPECHECK.join(', ')}`
    },
  },

  {
    id: 'formatter',
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'has a formatter',
    checar: (r) => {
      const ilegivel = manifestoIlegivel(r)
      if (ilegivel) return ilegivel
      if (!r.manifestos.length) return na('not an npm project')
      const d = dependenciasDeTodos(r)
      return d.prettier || d['@biomejs/biome'] || d.dprint ? null : 'no prettier, biome or dprint'
    },
  },

  {
    id: 'env-example',
    classe: 'determinística',
    nivel: 'N2',
    titulo: 'reads env and documents it in .env.example',
    checar: (r) => {
      if (!r.varsEnv.size) return na('does not read environment variables')
      if (!r.envExample)
        return `reads ${r.varsEnv.size} environment variable(s) and has no .env.example`
      const faltando = [...r.varsEnv].filter(
        (v) => !new RegExp(`^${v}\\s*=`, 'm').test(r.envExample),
      )
      return faltando.length ? `not documented: ${faltando.slice(0, 4).join(', ')}` : null
    },
  },

  {
    id: 'license',
    classe: 'determinística',
    nivel: 'N7',
    titulo: 'has a LICENSE',
    checar: (r) => (r.arquivos.some((a) => /^LICEN[CS]E/i.test(a)) ? null : 'absent'),
  },

  {
    id: 'readme',
    classe: 'determinística',
    nivel: 'N7',
    titulo: 'has a README',
    // THIS RULE CATCHES ZERO TODAY, and that is written here on purpose.
    //
    // Measured on 31/08/2026 across the 12 repositories on this machine: ALL
    // have a README, from 25 to 282 useful lines, and NONE is framework
    // boilerplate (I searched for "bootstrapped with create-next-app", "npm
    // create vite", "Getting Started with Create React App" and the like — zero
    // occurrences).
    //
    // So why it exists. First: two hours before this line was written, rebar
    // itself was the only repository with no README, and it went public that
    // way — while docs/PLANO.md listed "README como entregável" [README as a
    // deliverable] TWICE as a hole this project exists to fill. The ruler could
    // not see the hole its own plan named.
    // Second: the generator is going to produce a new repository, and a new
    // repository is born without a README by default.
    //
    // PRESENCE only, with no size floor. A line limit would fail
    // `navesz.github.io` (25 lines) and `VectraB-Lab` (31), which are small
    // projects with a proportional README — and a wrong automatic rule costs
    // more than a missing rule.
    checar: (r) =>
      r.arquivos.some((a) => /^readme(\.[a-z]+)?$/i.test(a))
        ? null
        : 'absent — it is the first thing anyone sees in a public repository',
  },

  {
    id: 'notice',
    classe: 'determinística',
    nivel: 'N7',
    titulo: 'Apache-2.0 accompanied by a NOTICE',
    checar: (r) => {
      const lic = r.arquivos.find((a) => /^LICEN[CS]E/i.test(a))
      if (!lic) return na('no LICENSE — the `licenca` rule is the one that demands it')
      if (!/Apache License/i.test(ler(r.dir, lic) || '')) return na('the license is not Apache')
      return r.arquivos.some((a) => /^NOTICE/i.test(a)) ? null : 'Apache license with no NOTICE'
    },
  },

  {
    id: 'hooks-executable',
    classe: 'determinística',
    nivel: 'N5',
    titulo: 'git hook committed with the execute bit',
    // AUDIT FINDING, 31/08: mode 100755 was guaranteed ONCE, at creation, and
    // nothing kept it. A `git update-index --chmod=-x` — or a file created on
    // Windows, where the bit does not exist — returns the hook to 100644, and
    // on Linux git starts IGNORING IT in silence. The gate declares itself on
    // and does nothing, which is the worst possible state.
    //
    // The mode read is the INDEX's, not the disk's: a local `chmod` does not
    // travel in the clone, and it is the clone that lands on the user's machine.
    checar: (r) => {
      const nomes =
        /(^|\/)(pre-commit|commit-msg|pre-push|prepare-commit-msg|post-checkout|pre-rebase)$/
      const hooks = r.arquivos.filter((a) => nomes.test(a))
      if (!hooks.length) return na('no file with a git hook name')
      const modos = modosDoIndice(r.dir)
      const mudos = hooks.filter((h) => modos.get(h) !== '100755')
      return mudos.length
        ? `no execute bit in the index, git ignores them on Linux: ${mudos.join(', ')}` +
            ` — fix with: git update-index --chmod=+x ${mudos.join(' ')}`
        : null
    },
  },

  {
    id: 'gate-with-placeholder',
    classe: 'determinística',
    nivel: 'N5',
    titulo: 'the gate was not left with an install placeholder',
    // FINDING FROM USING THE GENERATOR FOR REAL, 02/09. The owner asked for a
    // real site, and generating one exposed this: the CONTENT placeholder is
    // inert and loud — the build fails while a `TROQUE-…` is left. The GATE
    // placeholder was inert and MUTE.
    //
    // The git identity on this machine is local to the rebar repository, not
    // global. The generator found none, wrote `DONO NÃO CONFIGURADO` in NOTICE,
    // README and `.rebar-coauthors`, and rebar-check gave 13 of 13, exit 0 on
    // top of that.
    //
    // The worst of the three is `.rebar-coauthors`: it becomes the allowlist of
    // who may sign a commit, with an `@exemplo.invalido` e-mail inside. Nobody
    // matches that e-mail, so the `coautoria-ia` rule starts failing every
    // commit — or, depending on how it is read, none. A gate installed with a
    // placeholder is a gate people learn to switch off in the first week.
    checar: (r) => {
      // The Portuguese in MARCA is a CONTRACT with the generator, not prose:
      // `new/index.mjs` writes `DONO NÃO CONFIGURADO` and
      // `configure-git-user-email@exemplo.invalido`, and the site templates
      // write `TROQUE-…`. Translating it makes the gate stop seeing them.
      const MARCA = /(NÃO|NAO) CONFIGURADO|@exemplo\.invalido|TROQUE-[A-Z-]{3,}/
      const ONDE = /^(NOTICE|README\.md|\.rebar-coauthors|LICENSE)$/i
      const alvos = r.arquivos.filter((a) => ONDE.test(a))
      if (!alvos.length) return na('no gate identity file')
      const sujos = alvos.filter((a) => MARCA.test(ler(r.dir, a) || ''))
      return sujos.length
        ? `the generator found no identity and left a marker in ${sujos.join(', ')}` +
            ` — configure git and redo it, or fix it by hand`
        : null
    },
  },

  {
    id: 'ai-coauthorship',
    classe: 'determinística',
    nivel: 'N5',
    titulo: 'co-authorship only by humans from the allowlist',
    checar: (r) => {
      if (!r.commits.length) return na('repository with no commit')

      const { coautores: brutos, total, porEnumeracaoDoTexto } = coautoresDoHistorico(r)
      // Maintenance automation leaves before any count, so that it appears
      // neither in the verdict nor in the printed NUMBER — see AUTOMACAO_NAO_IA.
      const coautores = brutos.filter((x) => !AUTOMACAO_NAO_IA.test(x.valor))

      // Zero co-authorship trailers is the only verdict that does NOT depend on
      // knowing who is AI and who is a person: there is no co-author at all,
      // therefore no AI co-author. It holds with and without an allowlist, and
      // it is the case of this repository's 11 commits. It leaves before
      // everything else so the N/A branch below never swallows a repository
      // that is genuinely clean.
      if (!coautores.length) return null

      const lista = lerAllowlistCoautores(r)
      if (lista.estado === 'ilegivel')
        return `${ALLOWLIST_COAUTORES} is tracked and I could not read it: ${lista.erro}`

      const fonte = porEnumeracaoDoTexto
        ? ' (trailers read from the text: ' + porEnumeracaoDoTexto + ')'
        : ''

      if (lista.estado === 'ok') {
        const forasteiros = coautores.filter((x) => !x.email || !lista.emails.has(x.email))
        if (!forasteiros.length) return null
        return (
          `${forasteiros.length} of ${total} commits with a co-author outside ${ALLOWLIST_COAUTORES}: ` +
          [...new Set(forasteiros.map((x) => x.valor))].slice(0, 3).join(' · ') +
          fonte
        )
      }

      // Without an allowlist only ENUMERATION is left, and enumeration is the
      // form this fix exists to abandon: measured on 2026-08-30, the list of 9
      // agents let Windsurf, ChatGPT, Cody, Codeium, Amazon Q and Tabnine
      // through in one go. Here it survives for a narrow reason: rebar-check
      // runs against a THIRD PARTY's repository, which does not have rebar's
      // allowlist, and turning the rule off there would trade a leaky gate for
      // no gate at all.
      //
      // What changes is what enumeration has the right to ASSERT. Found a known
      // agent, it fails — enumeration proves presence. Found none, it does NOT
      // pass: it becomes N/A saying there is a co-author that cannot be
      // classified. Enumeration does not prove absence, and a "✓" there would
      // be the checker asserting what it does not know. Same discipline as the
      // `na()` at the top of this file: what cannot be decided leaves the
      // denominator, with the reason printed.
      const suspeitos = coautores.filter((x) => AGENTES_ENUMERADOS.test(x.valor))
      if (suspeitos.length) {
        return (
          `${suspeitos.length} of ${total} commits with AI co-authorship, by ENUMERATION ` +
          `(no ${ALLOWLIST_COAUTORES} tracked): ` +
          [...new Set(suspeitos.map((x) => x.valor))].slice(0, 3).join(' · ') +
          fonte
        )
      }
      return na(
        `${coautores.length} co-author(s) and no ${ALLOWLIST_COAUTORES} tracked — ` +
          'only known agents can be enumerated, and enumeration does not prove absence',
      )
    },
  },

  {
    id: 'git-identity',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'consistent author identity',
    checar: (r) => {
      if (!r.autores.length) return na('repository with no commit')
      const humanos = r.autores.filter((a) => !EH_BOT.test(a))
      if (!humanos.length) return na('only bot commits')
      const ids = new Set(humanos)
      if (ids.size <= 1) return null

      // COUNTING COMBINATIONS WAS THE DEFECT. Two humans in a repository are
      // two combinations, and the rule failed — a false positive against a
      // team, which is the thing this house avoids most: a wrong automatic rule
      // costs more than a missing rule. What follows separates what the ruler
      // PROVES from what it merely suspects.
      const partes = [...ids].map((i) => {
        const m = /^(.*?)\s*<([^<>]*)>\s*$/.exec(i)
        return {
          id: i,
          nome: (m ? m[1] : i).trim().toLowerCase(),
          email: (m ? m[2] : '').trim().toLowerCase(),
        }
      })

      const agrupar = (chave, valor) => {
        const mapa = new Map()
        for (const p of partes) {
          if (!p[chave] || !p[valor]) continue
          if (!mapa.has(p[chave])) mapa.set(p[chave], new Set())
          mapa.get(p[chave]).add(p[valor])
        }
        return [...mapa].filter(([, s]) => s.size > 1)
      }

      // 1 · COLLISION — the deterministic core. One name with two e-mails, or
      //     one e-mail with two names, is not "two people": it is an
      //     inconsistent identity, which is the name of the rule. It is the
      //     case measured in the forensics — the same person now as
      //     `Leonardo Naves <…noreply>`, now as `leona
      //     <leonardo@empresa.com.br>`, and `git shortlog` counting two.
      const nomesComVariosEmails = agrupar('nome', 'email')
      const emailsComVariosNomes = agrupar('email', 'nome')
      if (nomesComVariosEmails.length || emailsComVariosNomes.length) {
        const partesDoTexto = [
          ...nomesComVariosEmails.map(
            ([nome, emails]) => `"${nome}" committed with ${emails.size} e-mails`,
          ),
          ...emailsComVariosNomes.map(
            ([email, nomes]) => `<${email}> committed with ${nomes.size} names`,
          ),
        ]
        const pessoal = partes.filter(
          (p) => p.email && !/@users\.noreply\.github\.com$/.test(p.email),
        )
        const extra = pessoal.length ? ` (personal e-mail exposed: ${pessoal.length})` : ''
        return `${partesDoTexto.slice(0, 3).join('; ')}${extra}`
      }

      // 1b · THE GITHUB LOGIN SHOWING UP TWICE. This is the case collision does
      //      not catch and the forensics measured: `Leonardo Naves
      //      <12345+leona@users.noreply.github.com>` and `leona
      //      <leonardo@empresa.com.br>` are the same person, and name and
      //      e-mail differ in both.
      //
      //      The link is written in the address. The format is
      //      `<id>+<login>@users.noreply.github.com`, so the login is `leona` —
      //      a platform identifier, not an invented nickname. When it reappears
      //      as the NAME of another identity or as the local part of its
      //      e-mail, it is the same person with two identities, and the effect
      //      is what the rule exists to prevent: the personal e-mail enters the
      //      public history and `git shortlog` counts two people where there is one.
      const logins = new Map()
      for (const p of partes) {
        const m = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/.exec(p.email)
        if (m) logins.set(m[1].toLowerCase(), p)
      }
      const mesmaPessoa = []
      for (const p of partes) {
        if (
          logins.has(p.email.replace(/@.*$/, '')) &&
          logins.get(p.email.replace(/@.*$/, '')) !== p
        )
          mesmaPessoa.push(p)
        else if (logins.has(p.nome) && logins.get(p.nome) !== p) mesmaPessoa.push(p)
      }
      if (mesmaPessoa.length) {
        return (
          `the GitHub login reappears in another identity: ` +
          `${mesmaPessoa
            .slice(0, 3)
            .map(
              (p) =>
                `${p.id} is the same "${logins.get(logins.has(p.nome) ? p.nome : p.email.replace(/@.*$/, '')).id}"`,
            )
            .join('; ')} (personal e-mail in the public history)`
        )
      }

      // 2 · NO COLLISION, BUT THE REPOSITORY ALREADY DECLARED WHO IS HUMAN. The
      //     list is the SAME one the co-authorship rule uses, on purpose: the
      //     question is the same — "who is human on this project?" — and two
      //     lists diverge. Its header already says that whoever answers for the
      //     commit is the owner of the e-mail.
      const lista = lerAllowlistCoautores(r)
      if (lista.estado === 'ok') {
        const forasteiros = partes.filter((p) => !p.email || !lista.emails.has(p.email))
        return forasteiros.length
          ? `${forasteiros.length} author(s) outside ${ALLOWLIST_COAUTORES}: ` +
              `${forasteiros
                .slice(0, 3)
                .map((p) => p.id)
                .join(', ')} — ` +
              `if they are people on the project, add the e-mail there`
          : null
      }

      // 3 · NO COLLISION AND NO LIST. The ruler has no way of knowing whether
      //     these are N people or one person with N identities, and inventing
      //     an answer is what it used to do. `na` leaves the denominator with
      //     the reason in plain sight: a declared non-measurement is worth more
      //     than a guess, and the reason points at the fix.
      const pessoal = partes.filter(
        (p) => p.email && !/@users\.noreply\.github\.com$/.test(p.email),
      )
      const extra = pessoal.length ? `; ${pessoal.length} with a personal e-mail exposed` : ''
      return na(
        `${ids.size} identities with no name and no e-mail collision${extra} — ` +
          `either they are ${ids.size} people, or one with ${ids.size} identities, and with no ` +
          `${ALLOWLIST_COAUTORES} tracked there is no way to decide`,
      )
    },
  },

  {
    id: 'fake-ui',
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'components/ui/ accompanied by components.json',
    checar: (r) => {
      // The BASE of a UI folder is the directory that contains `components/`:
      // `apps/web/src/components/ui/botao.tsx` has base `apps/web/src/`. That
      // is where the search for the defense climbs from.
      const bases = new Set()
      for (const a of r.arquivos) {
        const m = /^((?:.*?\/)?)components\/ui\//.exec(a)
        if (m) bases.add(m[1])
      }
      if (!bases.size) return na('no components/ui/ folder')
      const defesas = new Set(r.componentsJson.map(pastaDe))
      const orfas = [...bases].filter((b) => !ancestrais(b).some((p) => defesas.has(p)))
      return orfas.length
        ? `components/ui/ imitating the convention, with no components.json in any directory above: ` +
            orfas
              .slice(0, 3)
              .map((b) => `${b}components/ui/`)
              .join(', ')
        : null
    },
  },

  {
    id: 'orphan-schema',
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'no orphan JSON Schema',
    checar: (r) => {
      const schemas = r.arquivos.filter((a) => /\.schema\.json$/.test(a))
      if (!schemas.length) return na('no .schema.json in the repository')
      // A test COUNTS as a reader, and this is the only place in the file where
      // it counts.
      //
      // The other content rules ask what the product DOES, and a test is not
      // product. This question is another one: is there anyone who reads this
      // schema? A contract test that imports it answers YES in the strongest
      // form there is — if the schema changes, the test breaks. Measured:
      // `openkartline` was accused of two schemas "defined and never read" with
      // `apps/web/src/services/schemaContract.test.ts` importing both on lines
      // 2 and 3. It was this rule's only accusation across the 11 repositories,
      // and it was false.
      const todo = [...r.fontes, ...r.fontesTeste].map(([, t]) => t).join('\n')
      const orfaos = schemas.filter((s) => !todo.includes(basename(s)))
      return orfaos.length ? `defined and never read: ${orfaos.slice(0, 3).join(', ')}` : null
    },
  },

  {
    id: 'content-outside-code',
    // STILL A HEURISTIC — and now with the number that REFUSES the promotion,
    // not with a list of pending items. Three of the four defects named in the
    // 31/08 audit are fixed and measured; the fourth did not give, and it is
    // the one holding the rule here.
    //
    // Every quoted sentence below is EVIDENCE copied verbatim out of the
    // audited Brazilian repositories, and stays in Portuguese for that reason.
    //
    // 1. FRAGMENT — FIXED. The match cut at the first `<`, and 18 of the 185
    //    sentences started with a period, a dash or in the middle of the
    //    clause. `nosDeTexto()` reassembles the run across the inline elements:
    //    ZERO of 262 now start away from the start of the clause. The 6 that
    //    start in lowercase were checked one by one in the source: four are
    //    `<li>` items of a "Nunca:" list, one is a caption written that way,
    //    and the sixth is debugging leftover (`esperado 0x… · recebido 0x…`) —
    //    none is a piece of a sentence.
    //
    // 2. ACTION LABEL — FIXED, and without enumerating verbs. The discriminator
    //    is the OWNER of the text node: `<button>`, `<a>` and `<label>` are not
    //    prose elements, and the text of a control is its NAME. See the `PROSA`
    //    block. Of the labels the audit named, four left:
    //    "Imprimir ou salvar em PDF" (`<button>`), "Arraste pela grade ou use
    //    ‹ › para percorrer." (`<span>`), "Não deu para abrir o cofre."
    //    (`<AlertTitle>`) and "Carregando o índice de preços…" (`<div>`).
    //
    // 3. DECORATIVE PROOF — FIXED. Of the nine mutations that survived in this
    //    rule, the three named were: erasing the digit from the price pattern,
    //    lowering the sentence minimum and turning off the code-signal filter.
    //    All three now DIVERGE, and the main case's `pass/` exists for that: it
    //    contains `R$` WITHOUT a digit, a three-word field label, a table row
    //    with fewer than 90% letters, a `<button>` with a four-word label and a
    //    state in a `<div>`. Each of them turns red if the corresponding guard
    //    is loosened.
    //
    // 4. INTERFACE VOCABULARY IN `<p>` — DID NOT GIVE, and it is what refuses
    //    the promotion. Measured before: 27 of 185 (14.6%). Measured after: 31
    //    of 262 (11.8%), and this number is RECOUNTABLE —
    //    `node measure-content.mjs <repos>` prints the table and the
    //    classification. The 14.1% this line published until 31/08 came from a
    //    hand count and did not reproduce; the instrument was written precisely
    //    because this repository has already published a wrong number four
    //    times, and it contradicted the first number it checked — the most
    //    expensive one in the file, the one that REFUSES this rule's promotion.
    //    The structure did not move the number because the ones that remain
    //    live in real prose elements: "Nenhuma proposta salva ainda." is a
    //    `<p>` under `history.length === 0` and "Clique para enviar a logo da
    //    empresa" is a `<p>` next to an `<input type="file">`. Separating them
    //    from "Nossa cozinha abre às 18h" would require ENUMERATING instruction
    //    verbs and state words — and enumeration here fails toward the wrong
    //    side: the incomplete list does not merely stop excluding, it ACCUSES.
    //    It is the exact inversion of the `coautoria-ia` argument: there
    //    enumeration proves presence and can therefore fail; here it would have
    //    to prove the ABSENCE of instruction in order not to accuse, and it
    //    does not. With ~12% noise, a deterministic rule blocks merges over a
    //    field label — and a rule that blocks merges over a field label teaches
    //    people to turn the whole output off.
    //
    // §12.3 of the plan stays open because of item 4, and not because of 1, 2
    // and 3. What is missing is not matching engineering: it is a discriminator
    // of VOICE — text that speaks of the business against text that speaks of
    // the program — and it does not come out of the element tree.
    classe: 'heurística',
    nivel: 'N1',
    titulo: 'content in conteudo/*.json, not inside src/ or app/',
    // The reason for the applicability gate is in the comment block above
    // `RE_CONTEUDO_JSON`; the definition of "content literal" and the number it
    // gives across the 11 repositories are in the `PROSA` block, just below it.
    checar: (r) => {
      // The base is the directory that contains `conteudo/`: in a monorepo,
      // `apps/site/conteudo/menu.json` has base `apps/site/`. The assertion
      // stays tied to that base, and not to the whole repository, for the same
      // reason `ui-falso` matches by proximity: a neighboring `apps/painel/`
      // that never promised anything cannot be accused by `apps/site/`'s promise.
      const bases = new Set()
      for (const a of r.arquivos) {
        const m = RE_CONTEUDO_JSON.exec(a)
        if (m) bases.add(m[1])
      }
      if (!bases.size) {
        return na('no conteudo/*.json tracked — the repository did not adopt the §12.3 convention')
      }
      const sob = (a) =>
        [...bases].some((b) => a.startsWith(`${b}src/`) || a.startsWith(`${b}app/`))
      const alvos = r.fontes.filter(([a]) => sob(a))
      if (!alvos.length) return na('there is conteudo/*.json and no code in src/ or app/ beside it')

      const achados = []
      for (const [a, bruto] of alvos) {
        const t = semComentarioNemImport(bruto)
        const preco = PRECO_BRL.exec(t)
        if (preco) achados.push(`${a}: price ${JSON.stringify(preco[0])}`)
        // Sentences only in files with JSX. In a plain `.ts` there is no text
        // node, and looking for markup there would read a comparison operator
        // as prose.
        if (!RE_JSX.test(a)) continue
        const frases = frasesDeConteudo(t)
        if (frases.length) {
          achados.push(`${a}: sentence ${JSON.stringify(frases[0].slice(0, 60))}`)
        }
      }
      return achados.length
        ? `${achados.length} content literal(s) outside conteudo/: ${achados.slice(0, 3).join(' · ')}`
        : null
    },
  },

  {
    id: 'phone',
    // PROMOTED FROM HEURISTIC TO DETERMINISTIC, and the number that decided it
    // is here.
    //
    // Measured on 2026-08-30 across the 11 repositories + rebar: 417 production
    // code files swept, ONE accusation — `Galegos/src/lib/whatsapp.ts` line 7,
    // a `const WHATSAPP_NUMBER` with the pizzeria's mobile in thirteen digits
    // —, and it is true. One true, zero false, in 417 files. (The number is not
    // transcribed here on purpose: see the `semComentario` note, which holds
    // what happens when it is.)
    //
    // §12.3 of the plan settled the decision that gives this its teeth: phone,
    // CNPJ and address are validated CONTENT, not code and not an environment
    // variable. And the cost of the mistake is documented in Galegos itself:
    // `Navesz/Galegos#1` tried to move the number into an env var and the owner
    // stopped the PR, because the build passes and the `wa.me` ships with no
    // recipient. Deterministic is what makes the decision hold.
    //
    // The pattern was TIGHTENED along with the promotion, and that is the
    // expensive half. The old `\(?\d{2}\)?\s?9\d{4}-?\d{4}` accepted ELEVEN
    // DIGITS IN A ROW with no punctuation at all, with a `9` in the third
    // place: a product EAN-13 (`7891234599999`) matched. Acceptable in a
    // heuristic that only informs; unacceptable in a rule that fails merges.
    // Now only what carries a MARK of a Brazilian phone counts — a `wa.me`
    // link, country code 55, or the DDD punctuation. The same Galegos is still
    // caught (`55` + `24` + `9` + eight digits) and the other 416 files stay
    // clean: the tightening did not cost a single true positive.
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'no Brazilian phone number in the code',
    checar: (r) => {
      // The patterns below describe the shape of a BRAZILIAN phone number — the
      // `wa.me` link, the 55 country code, the DDD in parentheses. They are the
      // subject of the rule, not prose, and there is nothing in them to
      // translate.
      const re =
        /wa\.me\/\d{8,}|\+?55\s?\(?\d{2}\)?\s?9\d{4}-?\d{4}|\(\d{2}\)\s?9\d{4}-?\d{4}|\b\d{2}\s9\d{4}-\d{4}\b/
      // Comments out: see the `semComentario` note. What §12.3 forbids is the
      // number the program USES — the one that ships in the `wa.me` and in the
      // `tel:` —, and that one lives in executed code, not in a footnote.
      // ELEVEN RAW DIGITS count ONLY when the file assembles a `wa.me` or a
      // `tel:`. It is the fix for a regression the tightening above caused and
      // the audit caught: the SAME Galegos mobile written without the country
      // code, in the same file, assembling the same link, passed clean. Context
      // is what separates a phone from a barcode: an EAN-13 does not become a
      // WhatsApp link, and that is why the raw digits only count accompanied.
      const cru = /\b\d{2}9\d{8}\b/
      const usaContato = /wa\.me|tel:|whatsapp/i
      const hits = r.fontes
        .filter(([, t]) => {
          const limpo = semComentario(t)
          return re.test(limpo) || (usaContato.test(limpo) && cru.test(limpo))
        })
        .map(([a]) => a)
      return hits.length
        ? `a phone is content, not code (§12.3) — ${hits.length} file(s): ${hits.slice(0, 3).join(', ')}`
        : null
    },
  },

  // ── heuristics ──────────────────────────────────────────────────────────

  {
    id: 'shadcn-complete',
    classe: 'heurística',
    nivel: 'N1',
    titulo: 'shadcn with the apparatus, not just the folder',
    checar: (r) => {
      // Same fix as `ui-falso` and `formatter`: `components.json` looked for at
      // any depth, the apparatus looked for in every manifest. Before, no
      // monorepo ever got evaluated by this heuristic — prumo, ducado and
      // LinhaK left through `na('does not use shadcn')` while all three had the
      // file tracked in a subfolder.
      if (!r.componentsJson.length) return na('does not use shadcn')
      // The read guard comes AFTER the N/A: whoever does not use shadcn should
      // not earn a warning because of a broken package.json. Here that is safe
      // because a heuristic does not enter the denominator — there is no N/A to
      // launder.
      const ilegivel = manifestoIlegivel(r)
      if (ilegivel) return ilegivel
      const d = dependenciasDeTodos(r)
      // WATCH OUT: @radix-ui alone fails the one repo that got it right.
      // Galegos uses shadcn correctly in the base-nova style, with
      // @base-ui/react and ZERO Radix.
      //
      // `radix-ui` without a slash is the unified package that replaced the
      // separate `@radix-ui/react-*`, and its absence here was a latent false
      // positive this step uncovered: once it started seeing
      // `apps/web/components.json`, the heuristic accused ducado of
      // "components.json with no primitive" with `"radix-ui": "^1.6.7"`
      // declared and `import { Select as SelectPrimitive } from 'radix-ui'` in
      // eight components. A defense looked for by its old name is the same
      // class of error as a defense looked for only at the root.
      const primitiva = Object.keys(d).some(
        (k) => k.startsWith('@radix-ui/') || k === 'radix-ui' || k === '@base-ui/react',
      )
      const faltam = []
      if (!primitiva) faltam.push('a primitive (@radix-ui/*, radix-ui or @base-ui/react)')
      if (!d['class-variance-authority']) faltam.push('cva')
      if (!d['tailwind-merge']) faltam.push('tailwind-merge')
      return faltam.length ? `components.json with no ${faltam.join(', ')}` : null
    },
  },

  {
    id: 'production-url',
    classe: 'heurística',
    // WHY IT STAYS A HEURISTIC, with the number in hand.
    //
    // After the two fixes below the rule went from 12 accused files in 7
    // repositories to 6 files in 5, and the 6 are literally true — none is a
    // false positive. Even so it does NOT get promoted to deterministic, and
    // the reason is its own name: 4 of the 6 are the address of a THIRD PARTY's
    // PUBLIC API (`viacep.com.br`, `api.bcb.gov.br`, `api.deepinfra.com`,
    // `api.replicate.com`) and only 2 are the production origin of the site
    // itself (`decima-edicoes/scripts/verify-static.mjs`,
    // `navesz.github.io/scripts/fetch-data.mjs`). Pinning the address of a
    // public API is normal engineering, not a defect; the defect is pinning
    // WHERE THIS site ships to. Separating the two requires knowing the deploy
    // origin, and the checker does not know it. Blocking merges at 2-of-6
    // precision on the defect the rule names is punishing correct behavior —
    // and a rule that punishes correct behavior teaches people to turn the
    // whole output off.
    nivel: 'N2',
    titulo: 'no production URL outside configuration',
    checar: (r) => {
      // FIX 1 — the env-fallback pattern, which is the RIGHT pattern.
      //
      // `process.env.X ?? 'https://…'` is exactly what you want a person to
      // write: an environment variable with a sensible default. Measured:
      // `decima-edicoes/app/lib/site.ts:5` accused over
      // `process.env.NEXT_PUBLIC_SITE_URL ?? 'https://navesz.github.io/decima-edicoes'`,
      // and `hug-brasil-propostas` accused TWICE over the same shape
      // (`scripts/check-access.js:3` and `src/lib/accessControl.ts:6`). Three
      // of the twelve accusations were the ruler hitting whoever got it right.
      //
      // The fallback is erased from the text BEFORE the search, and not the
      // whole file: a file can have the right pattern on one line and the raw
      // address on another, and absolving the file because of the good line
      // would trade this false positive for a false negative.
      const ENV_FALLBACK =
        /(?:process|import\.meta)\.env(?:\.[A-Za-z_$][\w$]*|\[\s*['"][^'"]+['"]\s*\])\s*(?:\?\?|\|\|)\s*(['"`])[^'"`]*\1/g

      // FIX 2 — an address only counts when it is used AS an address.
      //
      // The literal has to OPEN a string and come right after a request call or
      // an address name. Measured, three accusations fell and none of the three
      // held up once the file was opened:
      //   openkartline/apps/web/src/App.tsx:521 — `href="https://github.com/…"`,
      //     a footer link to the repository itself. A link is a link.
      //   prumo/…/migrations/20260825_0003_credentials.ts — twenty
      //     `doc: 'https://docs.fal.ai'` fields, a documentation catalog seeded
      //     into a table. It is DATA, and a table is the right place for data.
      //   prumo/…/collectors/index.ts:76 — the address inside the `User-Agent`
      //     string. It opens no string, so it never even gets tested.
      const ABERTURA =
        /(['"`])(https?:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org|schema\.org|json-schema\.org|fonts\.(?:googleapis|gstatic)\.com|registry\.npmjs)[a-z0-9.-]+\.(?:com|com\.br|br|app|dev|io|net|site)[^'"`]*)/gi
      const CHAMADA = /(?:fetch|axios(?:\.\w+)?|request|createClient|connect|new\s+URL)\s*\(\s*$/i
      // Portuguese in the list for the same reason as `NOMES_TYPECHECK` and
      // `NOME_TESTE`, and it must NOT be translated: a ruler that only
      // recognizes English variable names is blind to the repository it exists
      // to measure. `origem`, `endereco` and `servidor` are what a project from
      // here writes where `decima-edicoes` wrote `origin`.
      const NOME_ENDERECO =
        /[A-Za-z0-9_$]*(?:url|uri|endpoint|origin|origem|host|base|site|api|endereco|endereço|servidor)\s*[:=]\s*$/i

      const hits = []
      for (const [a, bruto] of r.fontes) {
        if (/config|\.d\.ts$/i.test(a)) continue
        const t = bruto.replace(ENV_FALLBACK, ' ')
        for (const m of t.matchAll(ABERTURA)) {
          // 60 characters are enough for the roomiest `const LONG_NAME =` and
          // keep a neighboring line from lending its verdict to the next one.
          const antes = t.slice(Math.max(0, m.index - 60), m.index)
          if (CHAMADA.test(antes) || NOME_ENDERECO.test(antes)) {
            hits.push(a)
            break
          }
        }
      }
      return hits.length ? `${hits.length} file(s): ${hits.slice(0, 3).join(', ')}` : null
    },
  },

  {
    id: 'raw-hex',
    classe: 'heurística',
    nivel: 'N1',
    titulo: 'no hex duplicating a CSS token',
    checar: (r) => {
      // Only accuses hex that ALREADY EXISTS as a token in the CSS. A loose hex
      // has too many legitimate contexts — three.js material, overlay veil —
      // and the naive version of this rule gave 100% false positives when
      // measured.
      const css = r.arquivos.filter((a) => /\.css$/.test(a))
      if (!css.length) return na('no .css in the repository')
      const noCss = new Set()
      for (const a of css)
        for (const m of (ler(r.dir, a) || '').matchAll(/#[0-9a-f]{6}/gi))
          noCss.add(m[0].toLowerCase())
      if (!noCss.size) return na('no hex color in the CSS')
      const dup = new Set()
      for (const [, t] of r.fontes)
        for (const m of t.matchAll(/#[0-9a-f]{6}/gi)) {
          if (noCss.has(m[0].toLowerCase())) dup.add(m[0].toLowerCase())
        }
      return dup.size
        ? `${dup.size} color(s) defined in both places: ${[...dup].slice(0, 3).join(', ')}`
        : null
    },
  },

  {
    id: 'single-language',
    classe: 'heurística',
    nivel: 'N1',
    titulo: 'one language only in the repository',
    checar: (r) => {
      // The Portuguese stopwords below are the DETECTOR, not prose. Translating
      // them makes the rule stop detecting Portuguese, which is the one thing
      // it exists to do. Leave both lists exactly as they are.
      const pt = /\b(não|para|então|função|usuário|configuração|arquivo)\b/i
      const en = /\b(the|this|should|configuration|file|user)\b/i
      let ptN = 0,
        enN = 0
      for (const [, t] of r.fontes) {
        // `soComentario` AND NOT A REGEX OF ITS OWN. Until 2026-09-07 this rule
        // pulled the comments out with the same naive pair that `semComentario`
        // stopped being — and it had the same defect, measured here: a
        // block-opener inside a string literal in `new/gate/aplicar.mjs` opened a
        // bogus comment and dragged `destino: 'preservado', porque:` into the
        // text about to be judged. Two extractions of one concept are two sources
        // to diverge, and these did.
        //
        // A span between backticks is CODE QUOTED, not prose, and leaves before
        // the language test. An identifier in English inside a Portuguese comment
        // is not a language switch, it is the name of the thing — nobody
        // translates `User-Agent`, `<input type="file">` or `cat-file --batch`.
        //
        // Measured on 2026-08-31 on the rebar mirror with `new/` tracked: the
        // `en` count fell from 3 to 0, and those 3 were exactly these three files,
        // all with Portuguese prose — `index.mjs`, `scan-secret.mjs` and
        // `new/index.mjs`. With min(pt,en) >= 3 as the floor, those three carried
        // the whole accusation.
        //
        // A span between QUOTES leaves for the same reason, and the reason is
        // stronger: quoted speech is not the writer's prose, and translating what
        // somebody said is rewriting it, not translating. This repository is full
        // of the owner's words kept verbatim with the English in brackets after
        // them, and of sample strings measured in Brazilian repositories — the
        // measurement IS the Portuguese. Measured on 2026-09-07, after the
        // translation: 9 of the 11 files the rule was accusing were quotation
        // only. Without this the rule fails on the very repository it is the
        // reference for, which is how the naive colour rule died.
        const txt = soComentario(t)
          .replace(/`[^`]*`/g, ' ')
          .replace(/["\u201C][^"\u201D]*["\u201D]/g, ' ')
        if (pt.test(txt)) ptN++
        if (en.test(txt)) enN++
      }

      const menor = Math.min(ptN, enN)
      return menor >= 3 ? `comments in pt (${ptN}) and en (${enN}) in the same repository` : null
    },
  },
]

// ─────────────────────────────────────────────────────── reading the repo

export function lerRepo(dir) {
  // A `.git/` existing is not enough: an EMPTY `.git/` folder passes existsSync
  // and makes every git command fail. Ask git, not the disk.
  const raiz = git(dir, ['rev-parse', '--git-dir'])
  if (!raiz.ok) return { erro: raiz.erro || 'git unavailable' }

  // `-z` is mandatory: without it git applies `core.quotePath` and an accented
  // name comes back C-quoted between quotes. Every rule below would receive a
  // path that does not exist, the read would fail in silence, and the file
  // would leave the scoreboard without having been looked at. See HOLE 7 in
  // tooling/secret/scan-secret.mjs, where this already cost an AWS key passing
  // GREEN.
  const ls = git(dir, ['ls-files', '-z'])
  if (!ls.ok) return { erro: ls.erro }
  const todos = ls.saida ? ls.saida.split('\0').filter(Boolean) : []
  const { arquivos, ignorados } = semFixtures(dir, todos)

  const manifestos = manifestosNpm(dir, arquivos)
  const componentsJson = arquivos.filter((a) => RE_COMPONENTS_JSON.test(a) && !IGNORAR.test(a))
  // `pkg` is still only the ROOT manifest, and only for those that depend on it
  // for a reason of their own (`ci-gateia` reads the scripts the workflow
  // invokes, `dependabot` decides applicability). Whoever asks about the whole
  // repository uses `manifestos`.
  const raiz_ = manifestos.find((m) => m.rel === 'package.json')
  const pkg = raiz_?.estado === 'ok' ? raiz_.valor : null
  const { producao: fs_, teste: fsTeste } = fontes(dir, arquivos)
  // `ehTeste` serves BOTH ends: it defines what satisfies the `testes` rule and
  // filters what enters `fontes()`. Measured in the attack, with the same
  // bytes: renaming a folder to `proofs/` took its content out of env-example,
  // schema-orfao, telefone, url-producao and idioma-unico AND still satisfied
  // `testes` — "2 of 8 + 2 warnings" became "3 of 7 + 0 warnings", without one
  // line saying what had vanished. The count is what turns that open gate into
  // a checked fact, the same way it is already done with the .rebarignore.
  const excluidosPorTeste = arquivos.filter((a) => ehCodigoAvaliavel(a) && ehTeste(a))
  ignorados.testes = excluidosPorTeste.length
  ignorados.amostraTestes = excluidosPorTeste.slice(0, 3)

  // Comments out BEFORE the sweep: `.env.example` documents what the program
  // READS AT RUNTIME, and a variable quoted in a comment is read by nobody.
  // Without this, a note explaining the env-fallback pattern made rebar itself
  // fail `env-example` over two variables that do not exist.
  const varsEnv = new Set()
  for (const [, t] of fs_) {
    for (const m of semComentario(t).matchAll(
      /(?:process|import\.meta)\.env\.([A-Z][A-Z0-9_]*)/g,
    )) {
      if (!ENV_DO_AMBIENTE.has(m[1])) varsEnv.add(m[1])
    }
  }

  // \x00 separates commits: a commit message contains \n freely.
  // A repository with no commit at all makes `git log` exit 128 — that is a
  // valid state, and it becomes an empty list, which the rules treat as N/A.
  const logBruto = git(dir, ['log', '--format=%B%x00'])
  const commits =
    logBruto.ok && logBruto.saida
      ? logBruto.saida
          .split('\x00')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  // --no-merges: on a pull request GitHub creates a merge commit authored by
  // `GitHub <noreply@github.com>`. Without this, EVERY PR is born failed on
  // this rule — measured, and it was what physically prevented turning rebar on
  // in a real PR.
  const logAutores = git(dir, ['log', '--no-merges', '--format=%an <%ae>'])
  const autores =
    logAutores.ok && logAutores.saida ? logAutores.saida.split('\n').filter(Boolean) : []

  return {
    dir,
    nome: basename(dir) || dir,
    arquivos,
    ignorados,
    pkg,
    manifestos,
    componentsJson,
    fontes: fs_,
    fontesTeste: fsTeste,
    varsEnv,
    commits,
    autores,
    envExample: ler(dir, '.env.example'),
    workflows: arquivos.filter((a) => /^\.github\/workflows\/.+\.ya?ml$/.test(a)),
  }
}

function avaliar(dir, filtro) {
  if (!existsSync(dir)) return { dir, nome: basename(dir) || dir, erro: 'path does not exist' }
  const r = lerRepo(dir)
  if (r.erro) return { dir, nome: basename(dir) || dir, erro: r.erro }

  const aRodar = filtro ? REGRAS.filter((x) => x.id === filtro) : REGRAS
  const resultados = aRodar.map((regra) => {
    const base = { id: regra.id, titulo: regra.titulo, classe: regra.classe, nivel: regra.nivel }
    let saida
    try {
      saida = regra.checar(r)
    } catch (e) {
      // BROKE is a defect of rebar-check. It never enters the target's score.
      return { ...base, estado: 'quebrou', motivo: `${e.message}` }
    }
    if (saida === null || saida === undefined) return { ...base, estado: 'passou' }
    if (typeof saida === 'object' && saida.na) return { ...base, estado: 'na', motivo: saida.na }
    return { ...base, estado: 'reprovou', motivo: String(saida) }
  })
  return { dir, nome: r.nome, ignorados: r.ignorados, resultados }
}

// ───────────────────────────────────────────────────────────────── output

const MARCA = {
  passou: () => c.verde('✓'),
  reprovou: () => c.vermelho('✗'),
  na: () => c.fraco('–'),
  quebrou: () => c.amarelo('⚠'),
}

function nota(resultados) {
  const det = resultados.filter((x) => x.classe === 'determinística')
  const aplicaveis = det.filter((x) => x.estado === 'passou' || x.estado === 'reprovou')
  return {
    ok: aplicaveis.filter((x) => x.estado === 'passou').length,
    total: aplicaveis.length,
    na: det.filter((x) => x.estado === 'na').length,
    quebrou: resultados.filter((x) => x.estado === 'quebrou').length,
  }
}

function imprimir(a) {
  if (a.erro) {
    console.log(`\n${c.forte(a.nome)}\n  ${c.vermelho('✗')} ${a.erro}`)
    return
  }

  const det = a.resultados.filter((x) => x.classe === 'determinística')
  const heu = a.resultados.filter((x) => x.classe === 'heurística')

  console.log(`\n${c.forte('rebar-check')} · ${c.forte(a.nome)}`)
  for (const x of det) {
    const detalhe = x.motivo ? c.fraco(`  ${x.motivo}`) : ''
    const titulo = x.estado === 'na' ? c.fraco(x.titulo) : x.titulo
    console.log(`  ${MARCA[x.estado]()} ${x.id.padEnd(18)} ${titulo}${detalhe}`)
  }
  const heuVisiveis = heu.filter((x) => x.estado === 'reprovou' || x.estado === 'quebrou')
  if (heuVisiveis.length) {
    console.log(c.fraco('  ── heuristics (they do not enter the score, they do not drop the CI)'))
    for (const x of heuVisiveis) {
      console.log(`  ${MARCA[x.estado]()} ${x.id.padEnd(18)} ${c.fraco(x.motivo)}`)
    }
  }

  const n = nota(a.resultados)
  if (n.total === 0) {
    console.log(`  ${c.fraco('nothing evaluable in this repository')}`)
  } else {
    const txt = `${n.ok} of ${n.total}`
    console.log(
      `  ${n.ok === n.total ? c.verde(txt) : c.vermelho(txt)}` +
        (n.na ? c.fraco(`  ·  ${n.na} not applicable`) : '') +
        (heuVisiveis.length ? c.fraco(`  ·  ${heuVisiveis.length} warning(s)`) : ''),
    )
  }
  if (n.quebrou) {
    console.log(
      `  ${c.amarelo(`⚠ ${n.quebrou} rule(s) BROKE — defect of rebar-check, outside the score`)}`,
    )
  }
  const ig = a.ignorados
  // Every exclusion gate prints a line, even when it hid nothing wrong. Bypass
  // A and B were invisible: one raised a number in dim grey with no symbol, the
  // other raised nothing. A warning with the LIST, not just the count — a
  // number on its own cannot be checked.
  if (ig?.marcadoresRecusados?.length) {
    console.log(
      `  ${c.amarelo(`⚠ ${ig.marcadoresRecusados.length} caso.json IGNORED as proof marker:`)}`,
    )
    for (const m of ig.marcadoresRecusados) console.log(`      ${c.amarelo(m)}`)
  }
  if (ig?.modelosRecusados?.length) {
    console.log(
      `  ${c.amarelo(`⚠ ${ig.modelosRecusados.length} modelo.json IGNORED as template marker:`)}`,
    )
    for (const m of ig.modelosRecusados) console.log(`      ${c.amarelo(m)}`)
  }
  if (ig?.rebarignoreClandestino) {
    console.log(
      `  ${c.amarelo('⚠ .rebarignore exists on disk and is NOT tracked — ignored entirely')}`,
    )
  }
  if (ig?.rebarignore) {
    console.log(`  ${c.amarelo(`⚠ ${ig.rebarignore} file(s) hidden by .rebarignore`)}`)
  }
  if (ig?.provas) {
    // Grouped BY ROOT. While there was only one, the prefix came out factored
    // so as not to repeat 40 characters per line and hide the list inside its
    // own length. With two roots, factoring a common prefix that no longer
    // exists would print a case from the security module as if it lived under
    // rebar-check — each root comes out with its own.
    // Grouped BY ROOT ever since there is more than one: factoring a common
    // prefix that no longer exists would print a case name from the security
    // module as if it lived under rebar-check.
    const porRaiz = RAIZES_DE_PROVA.map((raiz) => {
      const nomes = (ig.raizesDeProva || [])
        .filter((p) => p.startsWith(raiz))
        .map((p) => p.slice(raiz.length, -1))
      return nomes.length ? `${raiz}{${nomes.join(', ')}}` : null
    }).filter(Boolean)
    console.log(
      c.fraco(
        `  ${ig.provas} proof case file(s), outside the evaluation  ·  ${porRaiz.join('  ·  ')}`,
      ),
    )
  }
  if (ig?.modelos) {
    // The count comes out even when it is benign, and it names the roots: an
    // exclusion nobody sees is an exclusion nobody checks. It is the same rule
    // as the proofs line, just above.
    console.log(
      c.fraco(
        `  ${ig.modelos} generator template file(s), outside the evaluation` +
          `  ·  ${(ig.raizesDeModelo || []).join(', ')}`,
      ),
    )
  }
  if (ig?.testes) {
    const amostra = ig.amostraTestes?.length ? `: ${ig.amostraTestes.join(', ')}` : ''
    console.log(
      c.fraco(`  ${ig.testes} code file(s) outside the content rules for being tests${amostra}`),
    )
  }
}

// ─────────────────────────────────────────────────────────────────── main
//
// The command line only runs when THIS file is the PROGRAM. Imported as a
// library — which is what `measure-content.mjs` does to reuse the definition of
// a content literal instead of reimplementing it — the module hands over only
// the exported symbols and does not evaluate, does not print and does not exit.
//
// `realpathSync` on BOTH sides because npx installs the bin as a LINK: on Linux
// `node_modules/.bin/rebar` is a symlink to this file, and comparing raw paths
// would give false exactly on the hot path. It is also what makes the Windows
// case fold decide nothing: `c:/USERS/...` and `C:/Users/...` come back equal
// from realpath, and it was checked — both forms run the command line.
//
// The two edge cases, and why they fall to OPPOSITE sides:
//   · NO `argv[1]` — `node -e`, `--input-type=module`, REPL. There no file is
//     the program, so this one is not either: it returns FALSE and the embedder
//     receives only the symbols. Without this line, `node -e
//     "import('…/index.mjs')"` made the checker audit the current directory and
//     exit 2 — measured.
//   · REALPATH FAILS on a path that EXISTS as an argument. There it cannot be
//     known, and it returns TRUE: the file goes back to behaving like a
//     program, which is what it did before this guard. Erring toward "program"
//     is erring loudly (it prints and exits with a code); erring toward
//     "library" would be an `npx` that does nothing and exits 0.
const EH_PROGRAMA = (() => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return true
  }
})()

if (EH_PROGRAMA) {
  const args = process.argv.slice(2)

  // ─── dispatch of the `new` subcommand, BEFORE any option parsing
  //
  // It comes first on purpose: the generator has its own command line (`<nome>
  // [dominio]`), and letting the checker's parser look at it would produce
  // "unknown option" on a flag that belongs to the other program.
  //
  // The import is DYNAMIC and only happens here. That way `npx
  // github:Navesz/rebar .` — the hot path, the one that runs in CI — pays
  // nothing for the generator existing, and keeps working in a checkout where
  // `new/` did not come along.
  // THE FOLDER IS `new/`, AND THE SUBCOMMAND IS `new`. They were `new` and
  // `new/` respectively until 2026-09-07, and that mismatch was not cosmetic: it
  // made this branch always take the `exit(2)` below. `rebar new` was DEAD, and
  // the gate was green the whole time, because nothing runs it.
  //
  // Second time for this exact class. On 2026-09-05 `aplicar.mjs` read
  // `verify.yml` from a folder where the file is called `verificar.yml`, and the
  // gate stayed 15/15 green for six commits. Both are leftovers from the same
  // rename, and both survived for the same reason: the gate proved the tooling
  // and never the product. `prove-map.mjs` now runs this dispatch.
  if (args[0] === 'new') {
    const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const gerador = join(RAIZ, 'new', 'index.mjs')
    if (!existsSync(gerador)) {
      console.error(`rebar: subcommand "new" needs ${gerador}, which is not in this checkout.`)
      console.error('       To audit a folder named "new", write ./new')
      process.exit(2)
    }
    console.log(`rebar: subcommand "new" → generator (to audit the "new" folder, use ./new)`)
    // The generator calls `process.exit` on its own at the end of its main, so
    // this import does not return. If it ever does return, the exit 0 below is
    // the right one: it means the module loaded and finished without complaining.
    await import(pathToFileURL(gerador).href)
    process.exit(0)
  }

  // ─── dispatch of `--mcp`, also BEFORE option parsing
  //
  // This flag audits NOTHING: it hands the process to the MCP server, which
  // speaks JSON-RPC over stdio. That is why it comes first, next to `new` —
  // the parser below would refuse `--mcp` as an unknown option, and that is
  // exactly what happened until today: every project generated by `rebar new`
  // writes a `.mcp.json` that runs `.rebar/mcp.mjs`, which calls `rebar --mcp`.
  // The pointer existed on both sides and the target did not answer —
  // `rebar-check: unknown option: --mcp`, exit 2, in every generated project.
  //
  // It is a CHILD PROCESS, and not a dynamic import like `new`, because of
  // stdio. The MCP transport is pure JSON-RPC on stdout: a single stray line
  // there brings down the whole session. With `stdio: 'inherit'` the child owns
  // all three channels and nothing this file already loaded can write in
  // between.
  //
  // The two errors below are separate on purpose, because the fix is different:
  // the first is a checkout without the module, the second is the module
  // without its dependencies. `mcp/` is a SEPARATE package precisely so the
  // root can carry on with zero dependencies — the price is this `npm install`,
  // and it is spelled out instead of showing up as a raw ERR_MODULE_NOT_FOUND.
  if (args.includes('--mcp')) {
    const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const servidor = join(RAIZ, 'mcp', 'src', 'index.mjs')
    const semMcp = (motivo, conserto) => {
      console.error(`rebar: --mcp needs ${motivo}`)
      console.error(`       ${conserto}`)
      console.error('       Without MCP the rules are still reachable by the CI command:')
      console.error('         npx --yes github:Navesz/rebar . --json')
      process.exit(2)
    }
    if (!existsSync(servidor)) {
      semMcp(`${servidor}, which is not in this checkout.`, 'Clone the whole rebar.')
    }
    if (!existsSync(join(RAIZ, 'mcp', 'node_modules'))) {
      semMcp(
        'the dependencies of the mcp/ package, which are not installed.',
        'Install them once: cd mcp && npm install',
      )
    }
    // `process.execPath` and a .mjs: a real executable on both systems, with no
    // shell. It is the same reason the generated project's `.mcp.json` calls
    // `node` and not `npx` — on Windows `npx` is a `.cmd` and CreateProcess
    // does not execute it without an interpreter.
    const filho = spawnSync(process.execPath, [servidor], { stdio: 'inherit' })
    process.exit(filho.status ?? 1)
  }

  const json = args.includes('--json')
  const heuristicasBarram = args.includes('--heuristics')
  const regraArg = args.find((a) => a.startsWith('--rule='))
  const filtro = regraArg ? regraArg.slice('--rule='.length) : null

  const desconhecidas = args.filter(
    (a) => a.startsWith('--') && !/^--(json|heuristics|rule=)/.test(a),
  )
  if (desconhecidas.length) {
    console.error(`rebar-check: unknown option: ${desconhecidas.join(', ')}`)
    process.exit(2)
  }

  if (filtro && !REGRAS.some((x) => x.id === filtro)) {
    console.error(`rebar-check: unknown rule: ${filtro}`)
    // `disponíveis:` stays in Portuguese: it is the line prefix
    // tooling/rebar-check/proofs/prove.mjs reads back with startsWith() to
    // discover the rule ids without importing this CLI. Translating it here
    // makes that discovery return null and the up-front validation vanish.
    console.error(`disponíveis: ${REGRAS.map((x) => x.id).join(', ')}`)
    process.exit(2)
  }

  const alvos = args.filter((a) => !a.startsWith('--'))
  if (!alvos.length) alvos.push(process.cwd())

  const avaliacoes = alvos.map((d) => avaliar(d, filtro))

  if (json) {
    console.log(
      JSON.stringify(
        avaliacoes.map((a) => (a.erro ? a : { ...a, nota: nota(a.resultados) })),
        null,
        2,
      ),
    )
  } else {
    for (const a of avaliacoes) imprimir(a)
    if (avaliacoes.length > 1) {
      console.log(`\n${c.forte('summary')}`)
      for (const a of avaliacoes) {
        if (a.erro) {
          console.log(`  ${a.nome.padEnd(24)} ${c.vermelho(a.erro)}`)
          continue
        }
        const n = nota(a.resultados)
        if (!n.total) {
          console.log(`  ${a.nome.padEnd(24)} ${c.fraco('nothing evaluable')}`)
          continue
        }
        // A FIXED-WIDTH bar. With N/A leaving the denominator each repository
        // has a different total, and a variable-length bar would make 2/6 look
        // worse than 3/11 — a comparison the ruler does not support.
        const pct = n.ok / n.total
        const cheio = Math.round(pct * 10)
        const barra = '█'.repeat(cheio) + '·'.repeat(10 - cheio)
        console.log(
          `  ${a.nome.padEnd(24)} ${pct === 1 ? c.verde(barra) : c.vermelho(barra)}` +
            ` ${String(Math.round(pct * 100)).padStart(3)}%` +
            c.fraco(` ${n.ok}/${n.total}`) +
            (n.na ? c.fraco(` · ${n.na} n/a`) : ''),
        )
      }
    }
  }

  // Order of the codes: BROKE dominates FAILED. A defect in the checker
  // invalidates the verdict — you do not accuse a repository with a ruler that
  // broke.
  const quebrou = avaliacoes.some((a) => a.resultados?.some((x) => x.estado === 'quebrou'))
  const alvoInvalido = avaliacoes.some((a) => a.erro)
  const reprovou = avaliacoes.some((a) =>
    a.resultados?.some(
      (x) => x.estado === 'reprovou' && (x.classe === 'determinística' || heuristicasBarram),
    ),
  )

  if (quebrou) process.exit(127)
  if (alvoInvalido) process.exit(2)
  process.exit(reprovou ? 1 : 0)
}
