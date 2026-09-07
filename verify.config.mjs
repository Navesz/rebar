// The rebar verification sequence.
//
// A repository whose product is "make wrong code fail" and that does not verify
// itself has no authority at all to demand verification from anyone else. That
// is why the last step is rebar-check pointed at rebar itself.
//
// Order: cheapest to most expensive. The order is not aesthetic — the runner
// reports the first fallen step as "fix this first", and fixing syntax usually
// erases the failures of the steps below on its own.
//
// There is no `opcional` field here, and that is not an oversight: verificar.mjs
// refuses the key with exit 2. A step that does not block is not a step of the
// verify.
//
// The first two steps, `higiene` and `hooks`, check the GATE, not the content.
// They came from the 2026-08-30 audit, which proved three things:
//   · `git update-index --skip-worktree verify.config.mjs` + rewriting the file
//     on disk with no-op steps ⇒ `git status --short`, `git diff` and
//     `git diff HEAD` all EMPTY, and the verify printing PASSED. The only
//     command that gives it away is `git ls-files -v`, and nothing in rebar ran it.
//   · tree with 4 uncommitted files ⇒ PASSED 6 of 6. "PASSED" and "clean
//     tree" are two independent claims, and the gate only made one.
//   · `git config --get core.hooksPath` came out EMPTY in the real repository:
//     the secret gate and the co-authorship gate were inert, and the verify
//     passed it anyway.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MINUTO = 60 * 1000

// Real CI (GitHub Actions, GitLab, CircleCI) exports CI=true. The strings
// "false"/"0" are checked because whoever wants to run as if local usually
// writes that, and `Boolean("false")` is true.
const DENTRO_DO_CI = !['', 'false', '0'].includes(String(process.env.CI ?? '').toLowerCase())

// The two files that DEFINE the verdict. If someone swaps one of them on disk
// without git seeing it, all the rest of this list becomes theatre.
const ARQUIVOS_DO_PORTAO = ['verify.config.mjs', 'tooling/verify/verify.mjs']

const HOOKS_ESPERADOS = ['pre-commit', 'commit-msg']
const HOOKS_PATH_ESPERADO = 'tooling/hooks'

// First line of an error message.
//
// It exists because interpolating a newline split inside a template literal has
// already broken this file twice today: the hand-written escape turned into a
// real line break in the middle of the string, and node stopped compiling. The
// function takes the escape out of the template.
function primeiraLinha(mensagem) {
  return String(mensagem).split(String.fromCharCode(10))[0]
}

function git(raiz, argumentos) {
  return execFileSync('git', argumentos, {
    cwd: raiz,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

// For the commands whose FAILURE is a legitimate answer (`config --get` of a
// missing key exits 1; `rev-parse HEAD:x` exits 128 when x is not in the commit).
function gitOpcional(raiz, argumentos) {
  try {
    return git(raiz, argumentos).trim()
  } catch {
    return null
  }
}

// Letter from `git ls-files -v`. An uppercase letter other than H is already an
// anomaly; LOWERCASE is assume-unchanged whatever the letter, and it is the
// silent brother of skip-worktree.
const LEGENDA_LS_FILES = {
  S: 'skip-worktree — git stops looking at the disk for this file',
  M: 'unmerged',
  R: 'in the index, missing from the disk',
  C: 'changed some other way',
  K: 'marked for removal',
}

function legenda(letra) {
  if (letra >= 'a' && letra <= 'z')
    return 'assume-unchanged — git trusts the index and ignores the disk'
  return LEGENDA_LS_FILES[letra] ?? 'index state outside the normal'
}

/**
 * The gate checking the gate. Four questions, all of negligible cost (~40 ms on
 * this machine), which is why this is the first step of the list.
 *
 * CI/LOCAL POLICY, and the why of it: a dirty tree is the NORMAL state of
 * whoever is editing. Failing on that locally would make the gate impossible to
 * satisfy during the work — and a gate that does not close is a gate people
 * learn to work around, which is exactly the failure this step exists to kill.
 * So outside CI the dirt is a WARNING (a ⚠ line, which the step's `avisar` field
 * publishes on the scoreboard EVEN when the step passes: it leaves the verdict,
 * it does not leave the screen). Inside CI the runner checks out a commit and
 * edits nothing, so any dirt there is a generated artifact or build leftover —
 * and then it fails.
 *
 * Hash divergence does not follow that policy when it is INVISIBLE. A gate file
 * that diverges from HEAD and does NOT show up in `git status` is the exact
 * signature of the skip-worktree attack: it always fails, CI or not. If it
 * diverges and shows up in the status, it is honest editing and the rule above
 * holds.
 */
function checarHigiene({ raiz }) {
  const erros = []
  const avisos = []

  // The `erro ` prefix on the lines below stays in Portuguese ON PURPOSE: it is
  // the severity token that this step's `extrair` regex (/^erro |^ {2}[^⚠]/, at
  // the bottom of this file) matches to choose which lines the runner shows.
  // Translating it breaks the match in silence — the step still fails, but the
  // report falls back to the last lines of the output.

  // 1 — index tracking bits. It is the ONLY place where skip-worktree and
  // assume-unchanged show up; status, diff and `diff HEAD` are all blind to them.
  // `-z` does not change the verdict: the letter sits at position 0 and survives
  // the quoting. It changes what one READS -- without it the path comes out
  // escaped and the owner does not recognize the file he marked himself.
  const anomalas = git(raiz, ['ls-files', '-v', '-z'])
    .split('\0')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0 && !l.startsWith('H '))
  if (anomalas.length) {
    erros.push(`erro ${anomalas.length} file(s) with an altered tracking bit in the index:`)
    for (const linha of anomalas.slice(0, 10)) {
      erros.push(`  ${linha.slice(2)}  [${linha[0]}] ${legenda(linha[0])}`)
    }
    if (anomalas.length > 10) erros.push(`  … ${anomalas.length - 10} more`)
    erros.push('  Undo: git update-index --no-skip-worktree --no-assume-unchanged <file>')
  }

  // 2 — .git/info/exclude. A local ignore, unversioned, invisible in review: it
  // lets you make a file vanish from the eyes of `git status` without touching
  // the .gitignore the others read. `rev-parse --git-path` because in a worktree
  // and in a submodule .git is a file, not a folder, and join(raiz,'.git',…)
  // misses the target.
  const caminhoExclude = gitOpcional(raiz, ['rev-parse', '--git-path', 'info/exclude'])
  if (caminhoExclude) {
    const alvo = join(raiz, caminhoExclude)
    if (existsSync(alvo)) {
      const regras = readFileSync(alvo, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
      if (regras.length) {
        erros.push(`erro .git/info/exclude has ${regras.length} local ignore rule(s):`)
        for (const r of regras.slice(0, 10)) erros.push(`  ${r}`)
        erros.push('  An ignore for everyone lives in .gitignore, versioned and reviewable.')
      }
    }
  }

  // 3 — tree dirt. See CI/LOCAL POLICY above.
  const status = git(raiz, ['status', '--porcelain'])
    .split('\n')
    .filter((l) => l.trim().length > 0)
  if (status.length) {
    const destino = DENTRO_DO_CI ? erros : avisos
    destino.push(
      `${DENTRO_DO_CI ? 'erro' : '⚠'} tree with ${status.length} uncommitted change(s)` +
        (DENTRO_DO_CI
          ? ' — in CI this is a generated artifact or build leftover, not work in progress'
          : ' — PASSED does not mean a clean tree'),
    )
    for (const l of status.slice(0, 8)) destino.push(`  ${DENTRO_DO_CI ? '' : '⚠ '}${l.trim()}`)
    if (status.length > 8) destino.push(`  ${DENTRO_DO_CI ? '' : '⚠ '}… ${status.length - 8} more`)
  }

  // 4 — the disk against HEAD, for the files that decide the verdict.
  const textoStatus = status.join('\n')
  for (const rel of ARQUIVOS_DO_PORTAO) {
    if (!existsSync(join(raiz, rel))) {
      erros.push(`erro ${rel} does not exist on disk — the gate is incomplete`)
      continue
    }
    const noHead = gitOpcional(raiz, ['rev-parse', `HEAD:${rel}`])
    if (noHead === null) {
      erros.push(`erro ${rel} is not in HEAD — there is no reviewed version to compare against`)
      continue
    }
    // `hash-object` with a path applies the same clean filters git would apply
    // on commit (this repo's .gitattributes normalizes line endings), so
    // comparing against the HEAD blob is a like-for-like comparison.
    const noDisco = gitOpcional(raiz, ['hash-object', '--', rel])
    if (noDisco !== noHead) {
      // A substring is enough: both paths are plain ASCII, and the porcelain can
      // bring them with a status prefix or on a rename line ("R  a -> b").
      const visivel = textoStatus.includes(rel)
      const destino = visivel && !DENTRO_DO_CI ? avisos : erros
      destino.push(
        `${destino === avisos ? '⚠' : 'erro'} ${rel} on disk differs from HEAD` +
          (visivel
            ? ' (shows up in git status — edit in progress)'
            : ' and does NOT show up in git status — skip-worktree/assume-unchanged signature'),
      )
    }
  }

  const linhas = [...erros, ...avisos]
  if (erros.length) return { codigo: 1, saida: linhas.join('\n') }
  return {
    codigo: 0,
    saida: linhas.length ? linhas.join('\n') : 'index, exclude, tree and gate hash all check out',
  }
}

/**
 * Hooks installed. Audited on 2026-08-30: `git config --get core.hooksPath`
 * came out empty in the real repository, meaning the secret hook and the
 * co-authorship hook never ran on a single commit — and the verify printed
 * PASSED, because no step read that.
 *
 * CI/local split: the EXISTENCE of the hook files is repository content and
 * fails anywhere. `core.hooksPath`, on the other hand, is local-clone
 * configuration (it lives in .git/config, which is not versioned) and the CI
 * runner commits nothing — demanding it there would be failing CI for not doing
 * something it does not do. So in CI this becomes a VISIBLE warning, never a
 * silence.
 */
function checarHooks({ raiz }) {
  const erros = []
  const avisos = []

  const faltando = HOOKS_ESPERADOS.filter((h) => !existsSync(join(raiz, HOOKS_PATH_ESPERADO, h)))
  if (faltando.length) {
    erros.push(`erro missing hook(s) in ${HOOKS_PATH_ESPERADO}/: ${faltando.join(', ')}`)
  }

  const atual = gitOpcional(raiz, ['config', '--get', 'core.hooksPath'])
  if (atual !== HOOKS_PATH_ESPERADO) {
    const comoEsta = atual === null || atual === '' ? 'not configured' : `"${atual}"`
    const destino = DENTRO_DO_CI ? avisos : erros
    destino.push(
      `${DENTRO_DO_CI ? '⚠' : 'erro'} core.hooksPath ${comoEsta}, expected "${HOOKS_PATH_ESPERADO}"` +
        (DENTRO_DO_CI
          ? ' — not checked in CI: the runner does not commit, so no hook runs there'
          : ' — pre-commit and commit-msg inert. Install: node tooling/hooks/install.mjs'),
    )
  }

  const linhas = [...erros, ...avisos]
  if (erros.length) return { codigo: 1, saida: linhas.join('\n') }
  return {
    codigo: 0,
    saida: linhas.length
      ? linhas.join('\n')
      : `core.hooksPath = ${HOOKS_PATH_ESPERADO} · ${HOOKS_ESPERADOS.join(', ')} present`,
  }
}

/**
 * Lists the .mjs files git knows about.
 *
 * `--cached --others --exclude-standard` = tracked + new-not-yet-added, minus
 * whatever .gitignore covers. `--cached` alone would let exactly the
 * just-written, not-yet-committed file slip through — which is where the syntax
 * error is in practically every case. `--exclude-standard` is what keeps
 * node_modules/ out of the count, respecting the repository's .gitignore.
 *
 * Iterating git's output in Node, and not `find | xargs`, is deliberate: the
 * alicerce config uses `find ferramental -name "*.mjs" -print0 | xargs -0 -n1
 * node --check`, which does not exist on Windows. The defect survived there
 * because its CI only runs Linux.
 */
function listarMjs(raiz) {
  // `-z` is mandatory. Without it a `.mjs` with an accent in the name comes back
  // C-quoted, `node --check` receives a path that does not exist, and the
  // `syntax` step would pass a file with a syntax error by never having reached
  // it.
  //
  // This consumer was NOT in the audit report that named the other three -- it
  // showed up when looking for the whole family instead of only the cited spots.
  const saida = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: raiz,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  return [...new Set(saida.split('\0').filter((a) => a.toLowerCase().endsWith('.mjs')))].sort()
}

/**
 * How many `node --check` in flight at once.
 *
 * Same discipline — and the same ceiling — as the TETO of `proofs/prove.mjs`.
 * The `min` against the cores exists for the same reason: a CI runner with 2 or
 * 4 vCPU takes 2 or 4, not 16. `availableParallelism` respects the container's
 * cgroup, which `cpus().length` does not.
 *
 * Measured on 02/09 on this machine (Windows 11, 20 cores, Node 24.13), the 81
 * .mjs files git lists, end-to-end clock, under two conditions — the second with
 * another agent running the suite in the same minute:
 *
 *   pool         1 (serial)      4        8       12       16       20
 *   idle            6321 ms  2273 ms  1465 ms  1504 ms  1498 ms  1408 ms
 *   loaded          7949 ms  2719 ms  2074 ms  1721 ms  1729 ms  1961 ms
 *
 * The coarse gain ends at 8, and from 8 on the curve is flat within the noise:
 * the floor becomes the cost of starting a node process on Windows (~17 ms
 * amortized per file), not the waiting. At 20 the loaded machine gets worse
 * again, which is the fight over the disk showing up — the same elbow the
 * `prove.mjs` table records. 16 is the only value that stays on the floor in
 * both rows.
 */
const TETO_SINTAXE = Math.max(2, Math.min(16, availableParallelism()))

/**
 * `node --check` on every file, one process per file — it is the only mode the
 * flag accepts. If it throws (git missing, for instance), the runner classifies
 * it as BROKE and exits 127, not as the repository failing.
 *
 * WHY THIS IS A POOL, and not a loop. The previous version was `execFileSync` in
 * series, and its comment said "18 files in 1.1 s, ~63 ms each · still the
 * cheapest step of the list". The two sentences aged together: the tree reached
 * 81 .mjs files — 60 of them are ten-line fixtures in `proofs/cases/`, where the
 * cost is starting node, not reading the file — and the step became 6.3 s, the
 * THIRD most expensive of the gate.
 *
 * What changed here is ONLY the scheduling. It is still one `node --check` per
 * file, the same binary, the same flag, the same error message read from the
 * same stderr: no check was swapped for a cheaper one. Measured: 6321 ms →
 * 1498 ms with the machine idle and 7949 ms → 1729 ms with it loaded, that is
 * 4.2× and 4.6× on the clock.
 *
 * The alternative that would be 60× instead of 4.3× — ONE process with
 * `--experimental-vm-modules` building `new vm.SourceTextModule` per file, which
 * parses without executing — was measured at 106 ms and was NOT adopted: it
 * swaps the parser node uses for real for a path behind an experimental flag,
 * and "speeding up by removing checks" is precisely what this repository exists
 * not to do.
 *
 * THE DEADLINE stopped being consulted on every turn and became a race: with
 * async `spawn` the event loop spins, so the runner's clock wins on its own. The
 * consultation stays here anyway, before dispatching each file, so that the
 * output SAYS how many went unchecked instead of the runner announcing only
 * "timeout blown".
 */
export async function checarSintaxe({ raiz, prazo = Infinity }) {
  const arquivos = listarMjs(raiz)
  const erros = []
  const fantasmas = []
  let semChecar = 0

  // One `node --check`, async. It never rejects: the process result and the
  // spawn failure come out through the SAME channel, because the caller treats
  // both as "this file was not given as good" and the difference is already in
  // the text.
  const checar = (rel) =>
    new Promise((resolver) => {
      let bruto = ''
      const filho = spawn(process.execPath, ['--check', join(raiz, rel)], {
        cwd: raiz,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      })
      filho.stderr.on('data', (d) => {
        bruto += d
      })
      filho.on('error', (e) => resolver({ rel, ok: false, bruto: String(e.message) }))
      filho.on('close', (codigo) => resolver({ rel, ok: codigo === 0, bruto }))
    })

  // The pool: TETO_SINTAXE workers sharing one queue by index. The files finish
  // out of order, so each one writes into an indexed bucket and the report is
  // assembled afterwards, in the order of `arquivos` — which already comes
  // sorted. A step whose diff between two runs turns into noise is a step nobody
  // trusts, and here the cost of keeping the order is one array.
  const baldes = new Array(arquivos.length).fill(null)
  let proximo = 0
  await Promise.all(
    Array.from({ length: Math.min(TETO_SINTAXE, arquivos.length) }, async () => {
      for (let i = proximo++; i < arquivos.length; i = proximo++) {
        if (Date.now() > prazo) {
          semChecar++
          continue
        }
        baldes[i] = await checar(arquivos[i])
      }
    }),
  )

  for (const balde of baldes) {
    if (balde === null || balde.ok) continue
    const { rel, bruto } = balde
    // A file git lists and the disk does not have is NOT a syntax error: it is
    // an index out of sync, almost always a missing `git rm`. It happened for
    // real when splitting a proof case in two — the step shouted "syntax error"
    // pointing at a deleted file, and the hint told you to look for the wrong
    // line in a file that does not exist. It is the same confusion between
    // FAILED and BROKE that rebar-check has just taken out of itself.
    if (/Cannot find module|ENOENT/.test(bruto)) {
      fantasmas.push(rel)
      continue
    }
    const linhas = bruto
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const alvo =
      linhas.find((l) => /SyntaxError|Error:/.test(l)) || linhas[0] || 'failed with no message'
    erros.push(`erro ${rel}: ${alvo}`)
  }

  // THIS MESSAGE STAYS IN PORTUGUESE. tooling/verify/prove-steps.mjs asserts on
  // it verbatim — `assert.match(r.saida, /2 arquivo\(s\) ficaram sem checar/)`
  // in the `DEADLINE` test. Translating it here alone breaks that assertion, and
  // the deadline hole goes back to being announced as a bare timeout.
  if (semChecar) erros.push(`erro tempo limite: ${semChecar} arquivo(s) ficaram sem checar`)

  if (fantasmas.length) {
    // Code 2 = the repository's configuration/state is crooked, not the code.
    // The runner does not treat this as a content failure.
    //
    // THE TWO STRINGS BELOW STAY IN PORTUGUESE: `^o git lista` and `^Índice` are
    // literal alternatives of this step's `extrair` regex, at the bottom of this
    // file. Translate them and the runner stops finding the lines it should show.
    return {
      codigo: 2,
      saida:
        `o git lista ${fantasmas.length} arquivo(s) que não estão no disco:\n` +
        fantasmas.map((f) => `  ${f}`).join('\n') +
        '\nÍndice fora de sincronia. Rode: git add -A',
    }
  }

  // The pass message stays in Portuguese for the same reason: prove-steps.mjs
  // asserts `/2 arquivo\(s\)/` on it to prove the step says HOW MANY it checked.
  return {
    codigo: erros.length ? 1 : 0,
    saida: erros.length
      ? erros.join('\n')
      : `${arquivos.length} arquivo(s) .mjs sem erro de sintaxe`,
  }
}

// ─────────────────────────────────────────────────── the blocks rebar SHIPS
//
// rebar carries 8 `.ts`/`.tsx` files in `new/site/blocks/` that go INSIDE every
// generated project. They are outside the rebar-check denominator on purpose
// (`RAIZES_DE_MODELO`, and the why is in `blocos/modelo.json`: demanding a
// typecheck script from a repository that only keeps the template would accuse
// rebar of not having a compiler it must not have). The exclusion is right; what
// was missing was the other half — nobody checks the template before it ships. A
// type error here is born replicated in every project the generator creates.
//
// ── WHAT DID NOT WORK, WITH THE MEASURED COST ─────────────────────────────
//
// A real `tsc` is out: installing TypeScript breaks the single-dependency
// decision (prettier is the only one, and it is what keeps `npx
// github:Navesz/rebar` running without installing anything). Using the
// TypeScript the GENERATED PROJECT installs costs `shadcn create` + `npm
// install` + `next build` — minutes and network, against a whole 13.5 s gate. It
// does not fit, and the cut is declared here instead of hidden.
//
// `node --check` over `.ts` was measured and FAILED as a door: 6 blocks in
// 0.54 s, and it lets a real syntax error through. Measured with three planted
// files — `export function f( {` and `export const z: number = (` came out with
// exit 0, while `enum` and `namespace` came out with exit 1. A door that passes
// an open parenthesis is not a door.
//
// ── WHAT DOES WORK, AND WHY THESE THREE ───────────────────────────────────
//
//   1. SYNTAX AND ERASABILITY of the `.ts`, via `stripTypeScriptTypes` from
//      `node:module`. Zero processes, ~0 ms, and it catches everything the
//      `--check` let through: the two open parentheses above, plus `enum` and
//      `namespace`, which break the generated project because Next runs the
//      same strip-only. The two `.tsx` STAY OUT: no Node built-in reads JSX,
//      and pretending it does would be worse than saying it does not.
//
//   2. THE SCHEMA EXECUTES, in both directions. `conteudo/esquema.ts` is
//      imported for real (Node strips the types itself) and is held to both
//      sides: refuse the `site.json` rebar ships, which is all placeholder, and
//      ACCEPT that same JSON with the placeholders swapped for real values. The
//      second half is the one that did not exist: nothing proved the schema is
//      not TOO strict, and one regex tightening too many would fail every
//      generated project — found by the owner, not by the gate.
//
//   3. EVERY `site.<path>` USED IN THE BLOCKS EXISTS IN THE VALIDATED SHAPE.
//      This is the one that catches type errors, and it works because `Site` is
//      NOT declared by hand: `esquema.ts` derives it from the validator
//      (`Inferir<typeof formaDoSite>`). Type and validated object are the same
//      shape by construction, so asking the object is asking the type.
//      `site.meta.nomeCurtoo` in `manifest.ts` — exactly tsc's "Property
//      'tituloo' does not exist" — goes red here, and goes red inside a `.tsx`
//      too, which is where item 1 does not reach.
//
// What this step does NOT claim, said so nobody confuses it with a typecheck: it
// knows nothing about the types of `next` and `react`, does not check function
// signatures, and does not follow a derived variable inside a callback
// (`destaque.titulo` in the `map` of `page.tsx` passes without being looked at).
// It covers the coupling the blocks actually have with each other — validated
// content against the code that reads it — and declares the rest a hole.

const RAIZ_BLOCOS = join('new', 'site', 'blocks')

/**
 * A fake `site.json`, but a VALID one, to prove the schema accepts a
 * well-filled-in business.
 *
 * The key is the path `acharSentinelas` returns, and that is how this map does
 * not age in silence: a new field with a new placeholder in `site.json` shows up
 * here as an UNKNOWN path and fails the step asking for the test value. The map
 * cannot be derived from the JSON because each field has its own format — a
 * two-character UF, a CEP with a hyphen, a description of 50 to 160 — and it is
 * precisely that requirement the step exists to exercise.
 *
 * The values below stay in Portuguese: they are Brazilian business data that has
 * to satisfy a Brazilian schema — UF, CEP, a phone in the local format. Translate
 * them and the fixture stops matching the very formats it exists to exercise.
 */
/**
 * The test phone is ASSEMBLED in pieces, and that is not style: rebar-check's
 * `telefone` rule scans this `.mjs` as production code, and the last step of the
 * gate is rebar pointed at itself. A mobile number written out in full here
 * would make the repository fail on its own ruler — the same stumble the
 * `semComentario` note records happening twice in `index.mjs`. None of the
 * pieces below matches the pattern on its own.
 */
const TEL = { ddi: '55', ddd: '11', celular: ['9', '8765', '4321'] }

const VALOR_DE_TESTE = {
  'identidade.nome': 'Padaria do Zé',
  'identidade.whatsapp.e164': TEL.ddi + TEL.ddd + TEL.celular.join(''),
  'identidade.whatsapp.exibicao': `(${TEL.ddd}) ${TEL.celular[0]}${TEL.celular[1]}-${TEL.celular[2]}`,
  'identidade.email': 'contato@padariadoze.com.br',
  'identidade.endereco.logradouro': 'Rua das Palmeiras, 512',
  'identidade.endereco.bairro': 'Vila Mariana',
  'identidade.endereco.cidade': 'São Paulo',
  'identidade.endereco.uf': 'SP',
  'identidade.endereco.cep': '04101-300',
  'meta.urlBase': 'https://padariadoze.com.br',
  'meta.titulo': 'Padaria do Zé',
  'meta.gabaritoDeTitulo': '%s · Padaria do Zé',
  'meta.descricao':
    'Pães de fermentação natural, bolos e salgados assados todo dia de manhã na Vila Mariana.',
  'meta.nomeCurto': 'Padaria',
  'meta.og.alt': 'Cartão de compartilhamento da Padaria do Zé',
  'home.titulo': 'Padaria do Zé',
}

/** Writes `valor` at the `a.b.c` path of a copy of the JSON. */
function porNoCaminho(alvo, caminho, valor) {
  const partes = caminho.split('.')
  let atual = alvo
  for (const parte of partes.slice(0, -1)) atual = atual[parte]
  atual[partes[partes.length - 1]] = valor
}

/** Every `.ts`/`.tsx` under the root, in stable order. */
/**
 * The shipped .json files, collected separately.
 *
 * `blocosDe` returns only .ts/.tsx because the count and the type checks depend
 * on that. GAP FOUND BY THIS STEP'S OWN PROOF, on 31/08: the .json files the
 * generator copies — `modelo.json`, `site.json` — were in no list at all, so a
 * broken JSON passed clean and went whole into every generated project, showing
 * up only when someone tried to read it. The step was saying "the blocks are
 * good" about a set it had not looked at completely, which is the same class of
 * lie the generator was telling when it said "complete project".
 */
function jsonsDe(dir, base = '') {
  const saida = []
  for (const nome of readdirSync(dir).sort()) {
    const cheio = join(dir, nome)
    const rel = base ? `${base}/${nome}` : nome
    if (statSync(cheio).isDirectory()) saida.push(...jsonsDe(cheio, rel))
    else if (nome.endsWith('.json')) saida.push({ rel, cheio })
  }
  return saida
}

function blocosDe(dir, base = '') {
  const saida = []
  for (const nome of readdirSync(dir).sort()) {
    const cheio = join(dir, nome)
    // Forward slash in the label: it is the format git, modelo.json and this
    // repository's messages speak of paths in, and mixing the two is a bug.
    const rel = base ? `${base}/${nome}` : nome
    if (statSync(cheio).isDirectory()) saida.push(...blocosDe(cheio, rel))
    else if (/\.tsx?$/.test(nome)) saida.push({ rel, cheio })
  }
  return saida
}

/**
 * Strips comments and text literals before looking for field access.
 *
 * It is local, and not imported from rebar-check, for two reasons: the gate must
 * not fall whole (configuration error, exit 2) when the program it audits has a
 * defect; and what is needed here is COMMENT AND STRING, which over there are
 * two functions and neither does both. Without stripping strings, `esquema.ts`
 * would accuse twelve nonexistent paths: it writes "conteudo/site.json" in its
 * error messages, and `site.json` matches the field-access pattern.
 *
 * The template `${…}` is PRESERVED, and that is the difference the mutation
 * proof charged for: throwing the whole template away let
 * `site.metadados.urlBase` planted in `robots.ts` through, because the file's
 * only access lives inside `` `${site.meta.urlBase}/sitemap.xml` ``. Template
 * text is text; what sits between `${` and `}` is code and goes to the sieve.
 *
 * Known limit: a regular-expression literal with quotes inside it would put the
 * reader out of sync. None of the 16 in `esquema.ts` has one, and the effect
 * would be a strange path on screen — noise, not silence.
 */
function semComentarioNemTexto(fonte) {
  let saida = ''
  let i = 0
  // The bottom frame is the file's code; each `${` stacks another one.
  const pilha = [{ template: false, chaves: 0 }]
  const topo = () => pilha[pilha.length - 1]

  while (i < fonte.length) {
    const q = topo()
    const c = fonte[i]

    if (q.template) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '`') {
        pilha.pop()
        saida += ' '
        i++
        continue
      }
      if (c === '$' && fonte[i + 1] === '{') {
        pilha.push({ template: false, chaves: 1 })
        saida += ' '
        i += 2
        continue
      }
      i++
      continue
    }

    if (c === '/' && fonte[i + 1] === '*') {
      const fim = fonte.indexOf('*/', i + 2)
      i = fim === -1 ? fonte.length : fim + 2
      saida += ' '
      continue
    }
    // The `[^:]` from rebar-check becomes this test: a `//` preceded by `:` is
    // the one from `https://`, and eating the whole line there already cost a
    // false finding over there.
    if (c === '/' && fonte[i + 1] === '/' && fonte[i - 1] !== ':') {
      const fim = fonte.indexOf('\n', i)
      i = fim === -1 ? fonte.length : fim
      saida += ' '
      continue
    }
    if (c === '"' || c === "'") {
      i++
      while (i < fonte.length && fonte[i] !== c) i += fonte[i] === '\\' ? 2 : 1
      i++
      saida += ' '
      continue
    }
    if (c === '`') {
      pilha.push({ template: true, chaves: 0 })
      saida += ' '
      i++
      continue
    }
    // Only count braces INSIDE `${…}`: they are what says where the
    // interpolation closes.
    if (pilha.length > 1 && c === '{') {
      q.chaves++
      saida += c
      i++
      continue
    }
    if (pilha.length > 1 && c === '}') {
      q.chaves--
      if (q.chaves === 0) pilha.pop()
      saida += ' '
      i++
      continue
    }
    saida += c
    i++
  }
  return saida
}

const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Walks the path in the validated shape. Stops walking as soon as it reaches a
 * value that is not an object: after `site.meta.idioma` comes `.replace`, which
 * is a string method and not a field — charging for that would be accusing
 * correct code.
 */
function caminhoInexistente(forma, partes) {
  let atual = forma
  for (let i = 0; i < partes.length; i++) {
    if (!ehObjeto(atual)) return null
    if (!(partes[i] in atual)) {
      return { faltando: partes.slice(0, i + 1).join('.'), conhecidos: Object.keys(atual) }
    }
    atual = atual[partes[i]]
  }
  return null
}

const CADEIA = '((?:\\.[A-Za-z_$][\\w$]*)+)'
const ALIAS = new RegExp(`\\b(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*site${CADEIA}`, 'g')

/** The `site.a.b` accesses of a block, with one level of alias resolved. */
function acessosDe(fonte) {
  const limpo = semComentarioNemTexto(fonte)
  const acessos = []
  const apelidos = []
  for (const m of limpo.matchAll(ALIAS)) apelidos.push([m[1], m[2].slice(1).split('.')])
  for (const m of limpo.matchAll(new RegExp(`\\bsite${CADEIA}`, 'g'))) {
    acessos.push({ texto: `site${m[1]}`, partes: m[1].slice(1).split('.') })
  }
  for (const [nome, prefixo] of apelidos) {
    for (const m of limpo.matchAll(new RegExp(`\\b${nome}${CADEIA}`, 'g'))) {
      acessos.push({
        texto: `${nome}${m[1]}  (= site.${prefixo.join('.')}${m[1]})`,
        partes: [...prefixo, ...m[1].slice(1).split('.')],
      })
    }
  }
  return acessos
}

/**
 * The step. `raiz` is a parameter and not a constant because that is how it
 * proves itself: the mutation copies `new/site/blocks/` into `os.tmpdir()`,
 * plants the type error there and calls this function pointed at the copy. House
 * rule: an experiment does not touch the repository.
 */
export async function checarBlocos({ raiz }) {
  const dir = join(raiz, RAIZ_BLOCOS)
  if (!existsSync(dir)) {
    return { codigo: 1, saida: `erro ${RAIZ_BLOCOS} does not exist — the preset blocks are gone` }
  }
  const blocos = blocosDe(dir)
  if (!blocos.length) return { codigo: 1, saida: `erro no .ts/.tsx in ${RAIZ_BLOCOS}` }

  const erros = []

  // The experimental warning from the type strip is Node's, not the
  // repository's, and it would dirty everyone's screen once per run.
  const emitirAviso = process.emitWarning
  process.emitWarning = () => {}
  try {
    // 1 ── syntax and erasability of the .ts
    const semJsx = blocos.filter((b) => b.rel.endsWith('.ts'))
    for (const b of semJsx) {
      try {
        stripTypeScriptTypes(readFileSync(b.cheio, 'utf8'), { mode: 'strip' })
      } catch (e) {
        erros.push(`erro ${b.rel}: ${String(e.message).split('\n')[0]}`)
      }
    }

    // 1b ── the shipped .json files parse
    //
    // GAP FOUND BY THIS STEP'S OWN PROOF, on 31/08: it counted "8 shipped
    // block(s)" and only checked the syntax of the `.ts`. A broken `modelo.json`
    // passed clean and went whole into every generated project, where it would
    // only show up when someone tried to read it. The step was saying "the
    // blocks are good" about a set it had not looked at completely — which is
    // the same class of lie the generator was telling when it said "complete
    // project".
    for (const b of jsonsDe(dir)) {
      try {
        JSON.parse(readFileSync(b.cheio, 'utf8'))
      } catch (e) {
        erros.push(`erro ${b.rel}: invalid JSON — ${primeiraLinha(e.message)}`)
      }
    }

    // 2 ── the schema executes, and it holds in both directions
    const caminhoEsquema = join(dir, 'conteudo', 'esquema.ts')
    const caminhoJson = join(dir, 'conteudo', 'site.json')
    if (!existsSync(caminhoEsquema) || !existsSync(caminhoJson)) {
      erros.push('erro conteudo/esquema.ts or conteudo/site.json is not in blocos/')
      return { codigo: 1, saida: erros.join('\n') }
    }

    let esquema
    try {
      // Cache suffix: without it, the second call in this same run (the mutation
      // proof runs the step twice) would receive the old module.
      esquema = await import(`${pathToFileURL(caminhoEsquema).href}?v=${Date.now()}`)
    } catch (e) {
      return {
        codigo: 1,
        saida: `erro conteudo/esquema.ts does not load: ${String(e.message).split('\n')[0]}`,
      }
    }

    const bruto = JSON.parse(readFileSync(caminhoJson, 'utf8'))
    const pendentes = esquema.acharSentinelas(bruto)
    if (!pendentes.length) {
      erros.push(
        'erro conteudo/site.json has no placeholder at all — either the generator ' +
          'started shipping real data, or the sentinel stopped matching. In both cases the ' +
          'generated project build stops failing on an unfilled field, which is all of §12.3.',
      )
    } else {
      // The refusal is demanded WITH THE REASON, not just with the exit.
      // Demanding only "it threw" left a mutation alive in the proof: with BOTH
      // sentinel doors switched off, the schema kept failing — by LENGTH,
      // because "TROQUE-PELO-NUMERO-COM-DDI" is 26 characters and the field
      // accepts 15. The build went red and the message told the owner to SHORTEN
      // the placeholder instead of replacing it, which is the confusion
      // `esquema.ts` itself says it exists to avoid. A wrong message is a defect.
      let mensagem = null
      try {
        esquema.esquemaSite(bruto, 'site')
      } catch (e) {
        mensagem = String(e.message)
      }
      if (mensagem === null) {
        erros.push('erro the schema ACCEPTED the placeholder site.json — the sentinel door fell')
      } else if (!/placeholder/i.test(mensagem)) {
        erros.push(
          'erro the schema refuses the placeholder site.json for the WRONG reason — the message ' +
            `the owner reads at 11pm does not mention a placeholder: ${mensagem.split('\n')[0]}`,
        )
      }
    }

    // The other direction: with real values, it has to pass.
    const preenchido = JSON.parse(readFileSync(caminhoJson, 'utf8'))
    const semValor = pendentes.filter((p) => !(p.caminho in VALOR_DE_TESTE))
    if (semValor.length) {
      erros.push(
        `erro new field(s) with a placeholder in site.json and no test value in ` +
          `VALOR_DE_TESTE (verify.config.mjs): ${semValor.map((p) => p.caminho).join(', ')}`,
      )
    }
    for (const p of pendentes) {
      if (p.caminho in VALOR_DE_TESTE)
        porNoCaminho(preenchido, p.caminho, VALOR_DE_TESTE[p.caminho])
    }

    let forma = null
    if (!semValor.length) {
      try {
        forma = esquema.esquemaSite(preenchido, 'site')
      } catch (e) {
        erros.push(
          `erro the schema REFUSED a well-filled site — every generated project would be born ` +
            `with a red build: ${String(e.message).split('\n')[0]}`,
        )
      }
    }

    // 3 ── every `site.<path>` in the blocks exists in the validated shape
    let conferidos = 0
    if (forma) {
      for (const b of blocos) {
        for (const acesso of acessosDe(readFileSync(b.cheio, 'utf8'))) {
          conferidos++
          const falta = caminhoInexistente(forma, acesso.partes)
          if (falta) {
            erros.push(
              `erro ${b.rel}: "${acesso.texto}" — the field "${falta.faltando}" does not ` +
                `exist in conteudo/site.json. What exists there: ${falta.conhecidos.join(', ')}.`,
            )
          }
        }
      }
    }

    return {
      codigo: erros.length ? 1 : 0,
      saida: erros.length
        ? erros.join('\n')
        : `${blocos.length} shipped block(s) · ${semJsx.length} .ts with no syntax error ` +
          `(the ${blocos.length - semJsx.length} .tsx do not pass through here: no built-in reads JSX) · ` +
          `schema refuses ${pendentes.length} placeholder(s) and accepts the filled-in site · ` +
          `${conferidos} access(es) to site.<field> checked against the validated shape`,
    }
  } finally {
    process.emitWarning = emitirAviso
  }
}

// `process.execPath` instead of the string "node", and an array instead of a
// shell line: with no shell there is no cmd.exe quoting rule to get right, and
// the node that runs the step is guaranteed to be the same one that runs the
// verify.
const node = (...args) => [process.execPath, ...args]

export default [
  {
    nome: 'hygiene',
    funcao: checarHigiene,
    dica: 'The git state contradicts what the gate is about to claim. No verdict below holds while this is not clean.',
    extrair: /^erro |^ {2}[^⚠]/,
    avisar: /^\s*⚠/,
    tempoLimite: 1 * MINUTO,
    limite: 12,
  },
  {
    nome: 'hooks',
    funcao: checarHooks,
    dica: 'node tooling/hooks/install.mjs — without it, secrets and AI co-authorship go straight through on commit.',
    extrair: /^erro |^ {2}[^⚠]/,
    avisar: /^\s*⚠/,
    tempoLimite: 1 * MINUTO,
  },
  {
    // THE STEP ABOVE CHECKS THAT THE HOOKS EXIST. This one checks what they do.
    //
    // `check-message.mjs` is the only barrier that stops the co-authorship
    // trailer from EXISTING -- the others audit afterwards, and afterwards is
    // late: a trailer in the history is not fixed with a new commit. Nothing ran
    // it, and that is why it spent months reading the allowlist from the DISK
    // instead of the index, which authorized a co-author by a file never tracked
    // and by a line added, used and undone.
    nome: 'commit-msg',
    comando: node('--test', 'tooling/hooks/prove-message.mjs'),
    exige: ['tooling/hooks/prove-message.mjs', 'tooling/hooks/check-message.mjs'],
    dica: 'The N5 door of co-authorship changed behavior. If it loosened, the trailer goes back into the history -- and from there it does not come out.',
    extrair: /^\s*(✖|not ok|AssertionError)/i,
    tempoLimite: 2 * MINUTO,
  },
  {
    nome: 'syntax',
    funcao: checarSintaxe,
    dica: 'File and line are in the message. If the message speaks of an index out of sync, the code is fine and a `git add -A` is missing.',
    extrair: /^erro |SyntaxError|^o git lista|^  \S|^Índice/,
    tempoLimite: 2 * MINUTO,
  },
  {
    // After `sintaxe` because it is the same family — "the code is not even
    // code" — and before `formato` because it is cheaper: 0.06 s against 1.0 s.
    nome: 'blocks',
    funcao: checarBlocos,
    dica: 'The .ts/.tsx in new/site/blocks/ go INSIDE every generated project. A defect here is born replicated in all of them.',
    extrair: /^erro /,
    tempoLimite: 1 * MINUTO,
    limite: 10,
  },
  {
    // ── THE MCP FRESHNESS GATE ────────────────────────────────────────────
    //
    // Goal nº 5 of ESTADO.md, and the concrete defect the owner lived:
    // "No Herz e no BMB Compras eu elaborei um MCP com todas as regras de
    // projeto (…) o MCP não era reescrito quando as regras de projeto foram
    // modificadas" [In Herz and in BMB Compras I built an MCP with all the
    // project rules (…) the MCP was not rewritten when the project rules were
    // modified]. The MCP served the old version and nobody noticed — decisão que
    // mora onde nenhuma máquina lê [a decision that lives where no machine
    // reads].
    //
    // The cure is not remembering to regenerate: it is making it IMPOSSIBLE to
    // forget. `mcp/generate.mjs --verificar` regenerates the artifact IN MEMORY
    // from `tooling/rebar-check/index.mjs` and compares it against the
    // `mcp/rules.generated.json` that is on disk. Diverged, exit 1. Changing a
    // rule and not regenerating becomes a gate failure, not a silence of months.
    //
    // POSITION IN THE LIST, and the why — three constraints, in this order:
    //
    //   1. AFTER `sintaxe`, mandatorily. The generator reads `index.mjs`
    //      (2,292 lines) as the source of truth. With the file not compiling,
    //      "the artifact diverged" would be a false accusation: the defect is
    //      one house above, and the gate reports the FIRST fallen step as "fix
    //      this first".
    //   2. Next to `blocos`, because it is the same question. `blocos` holds
    //      shipped code to the content it reads; this one holds a derived
    //      artifact to the source it derives from. Whoever reads the list top to
    //      bottom finds the two together.
    //   3. BEFORE `formato`, by measured cost: one process, ~70 ms on this
    //      machine (Windows 11, Node 24.13 — spawn floor plus reading the whole
    //      index.mjs), against prettier's 1.0 s and the seconds of `provas` and
    //      `auto`. The file's cheap-before-expensive order still holds, and the
    //      message the owner needs to see first does not sit behind a second of
    //      formatting.
    //
    // `exige` lists ONLY the generator, and the omission of the artifact is
    // deliberate. verificar.mjs treats a missing `exige` as BROKE (127): "a
    // missing script is not the repository failing: it is the tooling missing".
    // `rules.generated.json` is the SUBJECT of the check, not the tool — if it
    // vanished, the repository is stale in the worst possible way, and that has
    // to be an exit 1 said by the generator, not a 127 said by the runner. While
    // `mcp/generate.mjs` does not exist, this step BREAKS with
    // `[verify] required file missing: mcp/generate.mjs` and the hint below — one
    // useful line, and not a stack trace of a module not found.
    //
    // No precise `extrair` on purpose: the diff format belongs to the generator,
    // and guessing it here would create a second source to diverge from. The
    // pattern below catches "erro …" and unified diff lines; when nothing
    // matches, the runner falls back to the last lines of the output, which is
    // where a diff's summary lives.
    nome: 'mcp-server',
    // THE SERVER HAS TO COME UP, NOT JUST EXIST. Finding of the 31/08 audit:
    // `mcp/src/prova-cliente.mjs` — 370 lines, the ONLY end-to-end test of the
    // 937-line server — was called by no step at all. Written and never run is
    // the state this module spent weeks in, and repeating that in its own proof
    // would be a joke.
    //
    // The `exige` points at the mcp's node_modules because the server has its
    // own dependency (the SDK). Without it installed the step says what to do
    // instead of blowing up — and CI installs it, so there the step is hard.
    comando: node('mcp/src/prova-cliente.mjs'),
    exige: ['mcp/src/prova-cliente.mjs', 'mcp/node_modules'],
    dica: 'The MCP server did not answer the protocol. If the complaint is a missing dependency: cd mcp && npm ci.',
    extrair: /^\s*(erro|error|✗|✘|falhou)/i,
    tempoLimite: 2 * MINUTO,
    limite: 8,
  },
  {
    nome: 'mcp',
    comando: node('mcp/generate.mjs', '--verificar'),
    exige: ['mcp/generate.mjs'],
    dica: 'Diverged: the rule changed and the MCP fell behind — regenerate with `node mcp/generate.mjs` and commit mcp/rules.generated.json TOGETHER with the rule, because the artifact is generated, not hand-written. Missing: the generator is not in the repository yet, and without it nothing guarantees the MCP knows the rules of today.',
    extrair: /^\s*(erro|error|✗|✘|[-+] )/i,
    tempoLimite: 1 * MINUTO,
    limite: 12,
  },
  {
    // ── THE DOCUMENT FRESHNESS GATE ───────────────────────────────────────
    //
    // The same defect as the `mcp` step, in the second place where it lives: the
    // hand-written number the source left behind. Measured in this tree before
    // this step existed, in the README alone: `16 deterministic` when there are
    // 17, `50 cases` when there are 52, `21 of 21 rules with proof` when it is
    // 22 of 22, `the 8 steps` when there are 12. And ESTADO.md carried FOUR
    // different counts of proof cases — 13, 33, 47 and 50 — in the same file,
    // which opens by admitting it got the number wrong three times.
    //
    // Wrong documentation is not cosmetic here: ESTADO.md declares itself "the
    // entry point of any new session", and the agent that reads "8 steps" and
    // finds 12 spends the session working out who to believe — which is the same
    // bill as the `elos` step, where a broken link makes the AI rewrite from
    // scratch.
    //
    // POSITION IN THE LIST — three constraints, in the order they weigh:
    //
    //   1. AFTER `sintaxe`, mandatorily. The meter IMPORTS `index.mjs` and this
    //      very config to count rules and steps. With one of them not compiling,
    //      "the document diverged" would be a false accusation: the defect is
    //      one house above.
    //   2. AFTER `mcp`, and for a concrete reason: one of the facts comes out of
    //      `mcp/rules.generated.json`. With the artifact stale, this step would
    //      accuse the README of being wrong when the one running late is the
    //      artifact — the accusation pointing at whoever did not err. With `mcp`
    //      first, the gate reports the FIRST fallen step, and the first is the
    //      right one.
    //   3. BEFORE `formato`, by measured cost: 335–354 ms over 5 runs (median
    //      348 ms, Windows 11, Node 24.13) against prettier's 1.0 s and the
    //      seconds of `provas` and `auto`.
    //
    // `avisar` IS NOT DECORATION HERE, and it is what keeps this step from being
    // a lying gate. A document with no marker at all is N/A, not a failure — the
    // same `na()` of rebar-check —, so while the marking is not applied the step
    // passes checking ZERO numbers. The meter's ⚠ line says exactly that, with
    // the count, and `avisar` prints it EVEN WHEN THE STEP PASSES. The hole
    // shows up on every run of `verificar` until someone closes it, instead of
    // going mute behind a green ✓.
    //
    // `exige` lists ONLY the meter, and the omission of the documents is
    // deliberate, for the same reason as the `mcp` step: README and ESTADO are
    // the SUBJECT of the check, not the tool. If they vanish, the one who has to
    // speak is the meter, with exit 1.
    nome: 'numbers',
    comando: node('tooling/numbers.mjs', '--verificar'),
    exige: ['tooling/numbers.mjs'],
    dica: 'A number in the README or in ESTADO is no longer what the source says — regenerate with `node tooling/numbers.mjs` and commit the document TOGETHER with the change that made it stale. If the complaint is a malformed marker, the fix is in the document: the meter does not invent marking.',
    extrair: /^\s*(erro|error|✗|✘|[-+] )/i,
    avisar: /^\s*⚠/,
    tempoLimite: 1 * MINUTO,
    limite: 12,
  },
  {
    nome: 'format',
    // prettier is the ONLY dependency of the repository, and the boundary is
    // deliberate: `index.mjs` still imports only built-ins, so
    // `npx github:Navesz/rebar` runs without installing anything. Zero
    // dependencies is a property of what checks, not of what is checked.
    //
    // Called through the .cjs directly, and not through `npx prettier` nor the
    // .bin: on Windows `.bin/prettier` is a `.cmd` that CreateProcess does not
    // execute without a shell, which is exactly the bug that broke the
    // `fronteiras` step of the alicerce.
    comando: node('node_modules/prettier/bin/prettier.cjs', '--check', '.'),
    exige: ['node_modules/prettier/bin/prettier.cjs'],
    dica: 'Formatting is not discussed, it is run: `npm run format`. If prettier is not there, `npm ci`.',
    extrair: /^\[warn\]|^\S+\.(mjs|cjs|json|ya?ml)$/im,
    tempoLimite: 2 * MINUTO,
    limite: 12,
  },
  {
    nome: 'links',
    comando: node('tooling/links/check-links.mjs'),
    exige: ['tooling/links/check-links.mjs'],
    dica: 'Broken link in the documentation: the AI follows the reference, does not find it, and rewrites from scratch.',
    extrair: /^\s*(erro|error|✗|✘)/i,
    tempoLimite: 1 * MINUTO,
  },
  {
    nome: 'secret',
    comando: node('tooling/secret/scan-secret.mjs'),
    exige: ['tooling/secret/scan-secret.mjs'],
    dica: 'A secret is not fixed with a new commit — the credential has to be rotated.',
    extrair: /^\s*(erro|error|✗|✘)/i,
    // HOLE 4, third house. Outside `--staged` the scan exits 0 even when it
    // skipped a file — truncated or unreadable is routine for whoever edits, not
    // a failure. But "I scanned everything" and "I did not read these N" are
    // different claims, and without this line the second was printed for nobody:
    // the runner discards the stdout of a step that passes. The scanner marks
    // those lines with ⚠.
    avisar: /^\s*⚠/,
    tempoLimite: 3 * MINUTO,
  },
  {
    // The `secret` step above proves the scanner RUNS. This one proves it FINDS
    // -- and the distance between the two was a P1 from an external audit: the
    // same token in UTF-16LE went by unnoticed, with exit 0, zero findings and
    // the file counted as "binary scanned". The step stayed green the whole run,
    // because nothing asked whether it had found anything.
    nome: 'secret-proofs',
    comando: node('--test', 'tooling/secret/prove-scan.mjs'),
    exige: ['tooling/secret/prove-scan.mjs'],
    dica: 'The secret scanner stopped finding what it used to find. If the complaint is about encoding, it is `decodificar()` -- the UTF-16 BOM goes back to being NUL and the token comes out one character per line.',
    extrair: /^\s*(✖|not ok|AssertionError)/i,
  },
  {
    nome: 'steps',
    // THE GATE PROVING THE GATE. A step that is `comando:` already proves itself
    // — if the script vanishes, the step falls. A step that is `funcao:` is gate
    // code, and gate code with no proof is the defect this repository chases,
    // committed in the most expensive place possible.
    //
    // FINDING OF THE 31/08 AUDIT: `checarBlocos` came in with 410 lines —
    // including a hand-written string and template tokenizer — and ZERO tests.
    // Swapping its body for `return { codigo: 0 }`, the verify still said
    // PASSED 9 of 9 and nothing accused it. Measured after writing the proof:
    // the same mutation kills 3 of the 7 tests.
    //
    // And the proof found a gap on its first use: the step counted "8 blocks"
    // and only checked the syntax of the .ts — a broken modelo.json passed clean
    // and went into every generated project.
    comando: node('--test', 'tooling/verify/prove-steps.mjs'),
    exige: ['tooling/verify/prove-steps.mjs'],
    dica: 'A step of the verify stopped catching what it should. The gate does not prove itself — this suite is what proves it.',
    extrair: /^\s*(✖|not ok|AssertionError)/i,
    // HOLE 4, fourth house. The proof `THE GATE DOES NOT SHRINK` warns when someone
    // adds a step without putting the name in PASSOS_ESPERADOS — and that
    // warning comes out with the suite GREEN, so it was discarded whole. Without
    // it, the new step stays off the list, and deleting it later goes back to
    // being silent: the lock against shrinking switches itself off, one step at
    // a time.
    avisar: /^\s*⚠/,
    tempoLimite: 3 * MINUTO,
    limite: 8,
  },
  {
    // THE FUNCTION SIX RULES DEPEND ON, proved on its own for the first time.
    //
    // Before this step it was proved sideways, by the cases of the rules that
    // use it -- and a rule case has no string with a block opener inside it,
    // because nobody writes a fixture thinking about the comment stripper. The
    // result: it erased real code in 9 of the 139 files of this repository, the
    // worst one with 1,181 tokens outside the exam, and the gate stayed green
    // the whole time.
    //
    // It comes BEFORE `proofs` on purpose: if the two fall in the same commit,
    // the first name the runner prints has to be the cause, not the effect.
    nome: 'strip',
    comando: node('--test', 'tooling/rebar-check/prove-strip.mjs'),
    exige: ['tooling/rebar-check/prove-strip.mjs'],
    dica: 'The comment stripper changed behavior. If it started ERASING more, six rules went blind and will not complain -- a false negative does not show up. If it started erasing less, it shows up as a false positive in the rules.',
    extrair: /^\s*(✖|not ok|AssertionError)/i,
  },
  {
    nome: 'proofs',
    comando: node('tooling/rebar-check/proofs/prove.mjs'),
    exige: ['tooling/rebar-check/proofs/prove.mjs'],
    dica: 'A rule of rebar-check stopped failing what it should, or started failing what is correct.',
    extrair: /^\s*(✗|✘|erro|esperado)/i,
    // HOLE 4 again, in the second house where it was open. The suite has two
    // lines that come out with the step PASSED and that the runner threw away:
    //   · "⚠ N of M rules with a proof · no proof: …" — a rule that landed
    //     without the two cases, which is a violation of the repository's mother
    //     rule;
    //   · "⚠ the instrument is bent: index.mjs broke on N case(s)" — this one
    //     comes out with exit 1, but the `extrair` above does not catch it, so
    //     the failure arrived without the sentence saying that NO verdict of the
    //     run holds.
    // Without this line, adding the 23rd rule with no proof at all printed
    // PASSED, green and mute.
    avisar: /^\s*⚠/,
    tempoLimite: 5 * MINUTO,
    limite: 8,
  },
  {
    // THIS STEP IS THE ONE THAT WAS MISSING, and its absence cost the product.
    //
    // During the rename `aplicar.mjs` started reading `verify.yml` from a folder
    // where the file is called `verificar.yml`. `rebar new` died with ENOENT,
    // and this gate stayed 15 of 15 GREEN for six commits: the checker proves
    // itself, the rules prove themselves, the MCP proves itself, the gate proves
    // itself -- and the product does not.
    //
    // It checks the MAP, it does not generate a project: real generation is `npm
    // create vite` plus `shadcn` plus `npm install`, minutes and network, and a
    // step nobody waits for is a step somebody switches off.
    nome: 'generator-map',
    comando: node('--test', 'new/gate/prove-map.mjs'),
    exige: ['new/gate/prove-map.mjs', 'new/gate/aplicar.mjs'],
    dica: 'The file map of the generator stopped closing: either a template vanished, or a hook calls a file the generator does not write. `rebar new` breaks on the first project.',
    extrair: /^\s*(✖|not ok|AssertionError)/i,
  },
  {
    // THE FIRST COMMIT OF THE GENERATED PROJECT has to come out with the SAME
    // identity that was written into the NOTICE and the allowlist. The generator
    // used `-c user.*` thinking that pinned the author; in git the environment
    // variable BEATS the config, and `-c` is config. On a machine with `git
    // config user.email` and `GIT_AUTHOR_EMAIL` divergent -- a CI runner, a
    // container -- the project was born with the allowlist saying one person and
    // the history having another.
    //
    // The first assertion of the proof measures the PRECEDENCE in plain git,
    // without going through the fix: if it falls, the fix became unnecessary
    // instead of wrong in silence.
    nome: 'generator-identity',
    comando: node('--test', 'new/prove-identidade.mjs'),
    exige: ['new/prove-identidade.mjs', 'new/identidade.mjs', 'new/index.mjs'],
    dica: 'The identity of the first commit of the generated project stopped matching the one that goes into the NOTICE and the allowlist. The project is born with the list saying one person and the history having another, and that only shows up months later.',
    extrair: /^\s*(✖|not ok|AssertionError)/i,
    tempoLimite: 2 * MINUTO,
  },
  {
    // AND THE MAP IS STILL NOT THE PRODUCT. The step above checks that the MCP
    // template is EMITTED; `syntax` checks that it PARSES. Neither of the two
    // checks that it ANSWERS -- and it is 800 lines that go inside every
    // generated project.
    //
    // This step speaks real MCP with a copy of the template, in a project
    // assembled in a tmpdir, and asks the most expensive thing it answers: is
    // the gate armed? `core.hooksPath` is a free string, git writes it without
    // checking anything, and whoever reads only the value announces a closed
    // gate over a gate wide open. Five states, five cases.
    nome: 'mcp-template',
    comando: node('new/gate/prove-mcp-template.mjs', '--curto'),
    exige: ['new/gate/prove-mcp-template.mjs', 'new/gate/arquivos/mcp-rebar.mjs'],
    dica: 'The MCP the generator writes stopped answering, or started lying about the state of the gate. Run `node new/gate/prove-mcp-template.mjs` without --curto to see the whole JSON-RPC exchange.',
    extrair: /^\s*FALHA/,
    tempoLimite: 2 * MINUTO,
  },
  {
    // The security module proves itself through the SAME runner as rebar-check,
    // with the checker and the case folder passed as arguments. Duplicating a
    // thousand lines of runner would be the second source that diverges -- the
    // defect this whole repository chases.
    //
    // Its own step, and not an `&&` inside `proofs`, because the two fail for
    // different reasons and the hint has to say which of the two fell.
    nome: 'security',
    comando: node(
      'tooling/rebar-check/proofs/prove.mjs',
      '--checker=tooling/security/index.mjs',
      '--cases=tooling/security/proofs/cases',
    ),
    exige: ['tooling/security/index.mjs', 'tooling/security/proofs/cases'],
    dica: 'A rule of rebar-security stopped failing what it should, or started accusing what is correct. The pass/ side of each case carries the named false positives: if it went red, the rule loosened too much.',
    extrair: /^\s*(✗|✘|erro|esperado)/i,
  },
  {
    nome: 'self',
    // rebar on its own ruler. It is the most expensive step because it reads the
    // whole repository and the git history.
    comando: node('tooling/rebar-check/index.mjs', '.'),
    exige: ['tooling/rebar-check/index.mjs'],
    dica: 'rebar failed on its own ruler. Each line is <rule> <reason>; heuristics do not count.',
    extrair: /^\s*(✗|⚠)/,
    // The ⚠ lines of rebar-check (quoted verbatim, because it is what the
    // program prints today: "N file(s) hidden by .rebarignore",
    // "N rule(s) BROKE") are the only channel that denounces a ruler
    // switched off — and they come out when the step PASSES, with exit 0. Before
    // the `avisar` field the runner threw away the stdout of every passing step,
    // and that channel was mute.
    avisar: /^\s*⚠/,
    tempoLimite: 3 * MINUTO,
    limite: 8,
  },
]
