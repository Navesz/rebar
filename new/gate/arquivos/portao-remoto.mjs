#!/usr/bin/env node
// THE REMOTE GATE — the half of the gate that does not live in this repository.
//
// WHY THIS FILE EXISTS. Everything else in `npm run verificar` measures files
// that are right here: the lint, the types, the tests, the secret scan. The
// branch protection is the one demand of this project that lives on GitHub's
// servers, and until this file existed nobody ever asked whether it was there.
// The generator printed a line telling the human to go to Settings › Rules and
// exited 0 either way. Measured on 2026-09-07, on the two repositories of this
// owner:
//
//   gh api repos/Navesz/rebar/rulesets   →  1 ruleset, "portao", active
//   gh api repos/Navesz/assay/rulesets   →  []
//   gh api repos/Navesz/assay/branches/main/protection  →  404, not protected
//
// One of the two had the gate. Both had a green CI badge, and the badge is
// exactly what an unprotected branch looks like: the workflow runs, it goes
// green or red, and NOTHING stops the merge either way. An open gate has to be
// a CHECKED FACT, not an omission.
//
// ─────────────────────────────────────────────────────────── THE VERDICT TABLE
//
// The axis of this file is NOT "how serious is it". It is one question:
// DID THE CHECKER MANAGE TO ASCERTAIN THE FACT?
//
//   asked, and there is no ruleset          → FAILS,   exit 1
//   asked, and what is there matches        → passes,  exit 0
//   asked, and what is there DIVERGES       → FAILS,   exit 1
//   could not ask (no gh, no token, no net) → WARNS,   exit 0, with a ⚠ on screen
//   the record is missing or is not JSON    → FAILS,   exit 1, and never na()
//   this script itself broke                → BROKE,   exit 127
//   no git remote at all                    → na(),    exit 0, naming who charges
//   not inside a git repository             → invalid target, exit 2
//
// Failing the developer on a plane would be the wrong rule: it teaches people to
// switch the whole verify off, and a verify that is off measures nothing. But
// "could not ask" must never become a silent pass either — that is the same
// omission this file was written to end — so it always prints, and it prints the
// ⚠ that CI and the verify runner pick up as a warning.
//
// And 127 dominates 1: a repository is not accused by a ruler that broke.
//
// ─────────────────────────────────────────────────────── WHERE EACH FACT COMES FROM
//
//   the required check NAMES  → DERIVED from .github/workflows/verificar.yml.
//        They are the job `name:` with the matrix expanded, which is literally
//        the string GitHub matches a required status check by. Writing them by
//        hand in two places is how a ruleset ends up requiring a check that no
//        workflow produces any more — a gate that can never be satisfied, or,
//        worse, one that waits forever on a check nobody runs.
//   the repository            → DERIVED from `git remote get-url origin`. Typing
//        the owner and the name into a file is one more thing to diverge from
//        the truth, and the truth is one command away.
//   everything else (branch, which job is the gate, whether a PR is demanded)
//        → the record in .rebar/portao-remoto.json. Those are DEMANDS, and a
//        demand has no other home on disk.
//
// Zero dependencies, Node built-ins only.
//
//   node .rebar/portao-remoto.mjs            check, write nothing
//   node .rebar/portao-remoto.mjs --gravar   check and rewrite the record
//   node .rebar/portao-remoto.mjs --corpo    print the ruleset body that fixes it
//   node .rebar/portao-remoto.mjs --provar   run the two cases, offline

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))

export const REGISTRO = '.rebar/portao-remoto.json'
export const FLUXO = '.github/workflows/verificar.yml'

// The schema this code knows how to read. A record written by a NEWER version is
// not a failure of the repository: it is this script running behind, and the
// honest answer to that is 127 — the ruler broke — never an accusation.
export const ESQUEMA = 1

const PASSOU = 0
const REPROVOU = 1
const ALVO_INVALIDO = 2
const QUEBROU = 127

const saida = (...t) => console.log(...t)
const erro = (...t) => console.error(...t)

// ────────────────────────────────────────────────────────────────────── git

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
}

/**
 * The repository this script belongs to.
 *
 * rev-parse from the SCRIPT'S OWN directory and not from the cwd, for the same
 * reason as `.githooks/install.mjs`: the repository being checked has to be the
 * repository where the file lives. With the cwd, running this from inside
 * another clone would check the wrong clone, in silence.
 */
function raizDoRepositorio() {
  const r = git(['rev-parse', '--show-toplevel'], AQUI)
  if (r.status !== 0) return null
  const caminho = r.stdout.trim()
  return caminho || null
}

/** owner and repository out of a remote URL, in the three shapes git writes. */
export function donoERepositorio(url) {
  const m = /github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(String(url).trim())
  if (!m) return null
  return { dono: m[1], repositorio: m[2] }
}

// ──────────────────────────────────────────── the required checks, derived

/**
 * The status check contexts the workflow produces for one job.
 *
 * GitHub matches a required status check BY NAME, and the name of a matrix job
 * is its `name:` with `${{ matrix.x }}` expanded — one context per combination.
 * This is a targeted read of that one job, not a YAML parser: anything it does
 * not recognize THROWS, and the caller turns that into 127. Guessing here would
 * produce the worst artifact this repository knows, an automatic rule that is
 * wrong, which costs more than an absent rule.
 */
export function checksDoFluxo(texto, idDoJob) {
  const linhas = String(texto).split('\n')
  const inicioJobs = linhas.findIndex((l) => /^jobs:\s*$/.test(l))
  if (inicioJobs < 0) throw new Error(`${FLUXO} has no top-level \`jobs:\` block`)

  const abre = new RegExp(`^  ${idDoJob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`)
  let inicio = -1
  for (let k = inicioJobs + 1; k < linhas.length; k++) {
    if (/^\S/.test(linhas[k])) break
    if (abre.test(linhas[k])) {
      inicio = k
      break
    }
  }
  if (inicio < 0) throw new Error(`${FLUXO} has no job called \`${idDoJob}\``)

  const bloco = []
  for (let k = inicio + 1; k < linhas.length; k++) {
    const l = linhas[k]
    if (!l.trim() || /^\s*#/.test(l)) {
      bloco.push(l)
      continue
    }
    if (l.length - l.trimStart().length <= 2) break
    bloco.push(l)
  }

  // `name:` as a DIRECT child of the job — indent 4. Deeper is a step's name,
  // and a step name is not a status check context.
  const nome = bloco.map((l) => /^ {4}name:\s*(.*\S)\s*$/.exec(l)).find(Boolean)?.[1]
  const modelo = nome ? nome.replace(/^['"]|['"]$/g, '') : null

  const matriz = lerMatriz(bloco, idDoJob)
  if (!matriz.length) {
    const contexto = modelo ?? idDoJob
    exigirTudoExpandido(contexto, idDoJob)
    return [contexto]
  }

  const contextos = []
  for (const combinacao of produto(matriz)) {
    let contexto
    if (modelo) {
      contexto = modelo
      for (const [chave, valor] of combinacao) {
        contexto = contexto.replace(
          new RegExp(`\\$\\{\\{\\s*matrix\\.${chave}\\s*\\}\\}`, 'g'),
          valor,
        )
      }
    } else {
      // GitHub's default name for a matrix job, and it is what the check is
      // called when the job declares no `name:`.
      contexto = `${idDoJob} (${combinacao.map(([, v]) => v).join(', ')})`
    }
    exigirTudoExpandido(contexto, idDoJob)
    contextos.push(contexto)
  }
  return contextos
}

function exigirTudoExpandido(contexto, idDoJob) {
  if (contexto.includes('${{')) {
    throw new Error(
      `the name of job \`${idDoJob}\` still has an unexpanded expression after the matrix: ` +
        `${JSON.stringify(contexto)}. This script cannot compute the check name, and a guessed ` +
        'name is worse than no rule at all',
    )
  }
}

/** The matrix as [[key, [values]], …]. Inline list and block list, nothing else. */
function lerMatriz(bloco, idDoJob) {
  const abre = bloco.findIndex((l) => /^ {6}matrix:\s*$/.test(l))
  if (abre < 0) return []
  const entradas = []
  for (let k = abre + 1; k < bloco.length; k++) {
    const l = bloco[k]
    if (!l.trim() || /^\s*#/.test(l)) continue
    const recuo = l.length - l.trimStart().length
    if (recuo <= 6) break
    const par = /^ {8}([A-Za-z0-9_-]+):\s*(.*)$/.exec(l)
    if (!par) continue
    const [, chave, valorBruto] = par
    if (chave === 'include' || chave === 'exclude') {
      throw new Error(
        `the matrix of job \`${idDoJob}\` uses \`${chave}\`, which changes the set of ` +
          'combinations. This script does not compute that, and it will not guess it',
      )
    }
    const valor = valorBruto.trim()
    if (valor.startsWith('[')) {
      entradas.push([chave, listaEmLinha(valor)])
      continue
    }
    if (valor === '') {
      const itens = []
      for (let j = k + 1; j < bloco.length; j++) {
        const item = /^ {10}-\s*(.*\S)\s*$/.exec(bloco[j])
        if (!item) break
        itens.push(item[1].replace(/^['"]|['"]$/g, ''))
        k = j
      }
      entradas.push([chave, itens])
      continue
    }
    entradas.push([chave, [valor.replace(/^['"]|['"]$/g, '')]])
  }
  return entradas
}

function listaEmLinha(texto) {
  return texto
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

function produto(entradas) {
  let combinacoes = [[]]
  for (const [chave, valores] of entradas) {
    const proxima = []
    for (const parcial of combinacoes)
      for (const v of valores) proxima.push([...parcial, [chave, v]])
    combinacoes = proxima
  }
  return combinacoes
}

// ─────────────────────────────────────────────────────────────────── gh

/**
 * Finds an executable on PATH, by hand instead of handing the bare name to
 * spawnSync. Two reasons, and neither one is the test suite:
 *
 *   1. "gh is not installed" has to be a NAMED verdict — could not ascertain —
 *      and not an ENOENT that reads like a crash. Resolving first tells the two
 *      apart before a single process is spawned.
 *   2. Windows. `spawnSync('gh')` only finds what PATHEXT lists, and Node
 *      refuses to run a .cmd or .bat without a shell — the same portability
 *      defect that killed the project before this one. Resolving first lets the
 *      call become `process.execPath` + script for anything that is not a real
 *      executable, with the arguments still passed as a VECTOR and no shell in
 *      between.
 */
export function resolverNoPath(nome, env = process.env) {
  const extensoes =
    process.platform === 'win32' ? ['.exe', '.com', '.mjs', '.cmd', '.bat'] : ['', '.mjs']
  for (const pasta of String(env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!pasta) continue
    const limpa = pasta.replace(/^"|"$/g, '')
    for (const ext of extensoes) {
      const caminho = join(limpa, `${nome}${ext}`)
      try {
        if (!statSync(caminho).isFile()) continue
      } catch {
        continue
      }
      if (ext === '.mjs') return { comando: process.execPath, prefixo: [caminho], caminho }
      if (ext === '.cmd' || ext === '.bat') return { caminho, semShell: false }
      return { comando: caminho, prefixo: [], caminho }
    }
  }
  return null
}

function perguntar(gh, rota) {
  const r = spawnSync(gh.comando, [...gh.prefixo, 'api', rota], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  })
  if (r.error) return { ok: false, motivo: `gh did not run: ${r.error.message}` }
  if (r.status !== 0) {
    const primeira = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n')[0]
    return { ok: false, motivo: primeira || `gh exited ${r.status} for ${rota}` }
  }
  try {
    return { ok: true, dados: JSON.parse(r.stdout) }
  } catch {
    return { ok: false, motivo: `gh answered something that is not JSON for ${rota}` }
  }
}

// ──────────────────────────────────────────────────────────── the decision

/**
 * The verdict table, as a pure function. No network, no disk, no process.
 *
 * `regras` is what `gh api repos/o/r/rules/branches/<branch>` returned — the
 * ACTIVE rules for that branch. `ruleset` is the ruleset detail, or null when it
 * could not be read: `bypass_actors` and `enforcement` do not travel in the
 * rules listing, so they are a second call and a second thing that can fail.
 * Failing to read them does not become a pass and does not become a failure —
 * it becomes a named gap in `naoApurado`, which the caller prints.
 */
export function decidir({ checksExigidos, exigido, regras, ruleset }) {
  if (!Array.isArray(regras)) throw new Error('decidir: `regras` has to be the array gh returned')
  const faltas = []
  const naoApurado = []

  const rsc = regras.find((r) => r.type === 'required_status_checks')
  const contextos = (rsc?.parameters?.required_status_checks ?? []).map((c) => c.context)
  const observado = {
    regras: regras.map((r) => r.type).sort(),
    checks: contextos,
    rulesets: [...new Set(regras.map((r) => r.ruleset_id).filter((n) => n != null))],
    enforcement: ruleset ? ruleset.enforcement : null,
    bypassActors: ruleset ? (ruleset.bypass_actors ?? []).length : null,
  }

  if (regras.length === 0) {
    return {
      estado: 'ausente',
      faltas: ['no rule applies to the branch — anyone with push rights merges anything'],
      naoApurado,
      observado,
    }
  }

  const tipos = new Set(observado.regras)
  if (exigido.delecaoBloqueada && !tipos.has('deletion')) {
    faltas.push('rule `deletion` — the branch can be deleted')
  }
  if (exigido.forcePushBloqueado && !tipos.has('non_fast_forward')) {
    faltas.push('rule `non_fast_forward` — a force push rewrites the branch')
  }
  if (exigido.pullRequest && !tipos.has('pull_request')) {
    faltas.push('rule `pull_request` — a push straight to the branch skips every check')
  }

  if (!rsc) {
    faltas.push('rule `required_status_checks` — CI is a badge nobody requires')
  } else {
    for (const c of checksExigidos) {
      if (!contextos.includes(c)) faltas.push(`required check ${JSON.stringify(c)}`)
    }
    if (rsc.parameters?.strict_required_status_checks_policy !== true) {
      faltas.push(
        '`strict_required_status_checks_policy` is off — a branch behind the base merges ' +
          'without CI running again on the merged state',
      )
    }
  }

  if (ruleset === null) {
    naoApurado.push(
      'enforcement and bypass_actors — reading the ruleset itself was refused, so this verdict ' +
        'does not cover who is allowed to walk around the gate',
    )
  } else {
    if (exigido.enforcement && ruleset.enforcement !== exigido.enforcement) {
      faltas.push(
        `enforcement is ${JSON.stringify(ruleset.enforcement)} and the record demands ` +
          `${JSON.stringify(exigido.enforcement)} — anything other than active is a dry run`,
      )
    }
    if (exigido.semBypass && (ruleset.bypass_actors ?? []).length > 0) {
      faltas.push(
        `bypass_actors has ${ruleset.bypass_actors.length} entry(ies) — whoever is on that list ` +
          'is not stopped by any of the rules above',
      )
    }
  }

  return { estado: faltas.length ? 'divergente' : 'instalado', faltas, naoApurado, observado }
}

/** The ruleset body that installs exactly what `exigido` demands. */
export function corpoDoRuleset(checksExigidos, nome = 'portao') {
  return {
    name: nome,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
          // Copied from the ruleset measured on `Navesz/rebar` — the one this
          // whole file exists to reproduce. A solo owner approves nothing, so
          // `required_approving_review_count` is 0 and this is what still makes
          // the pull request cost something: a commit GitHub cannot attribute
          // needs a human to sign for it. If your account's API refuses the
          // parameter, drop this line: the other three rules stand on their own.
          require_extra_approval_for_unattributed_changes: true,
          allowed_merge_methods: ['merge', 'squash', 'rebase'],
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: checksExigidos.map((context) => ({ context })),
        },
      },
    ],
  }
}

// ────────────────────────────────────────────────────────────────── main

function conferir(argv) {
  const gravar = argv.includes('--gravar')
  const soCorpo = argv.includes('--corpo')

  const raiz = raizDoRepositorio()
  if (!raiz) {
    erro('[portao-remoto] not inside a git repository — there is no branch to protect.')
    return ALVO_INVALIDO
  }

  // THE RECORD FIRST, and its absence is a FAILURE and never na(). A deleted
  // file is the cheapest way to turn a red step green, and "the file is not
  // there" is the absence of information — which this repository has already
  // paid for once, when it was read as "does not apply" and took a score from
  // 9/10 to 6/6.
  const caminhoRegistro = join(raiz, ...REGISTRO.split('/'))
  if (!existsSync(caminhoRegistro)) {
    erro(`[portao-remoto] error  ${REGISTRO} is missing.`)
    erro('  This is not "not applicable": it is the record that says what the branch')
    erro('  protection has to be, and without it nothing can be compared to anything.')
    erro(
      `  Restore it from the generator, or write it again and run: node ${REGISTRO.replace('.json', '.mjs')} --gravar`,
    )
    return REPROVOU
  }
  let registro
  try {
    registro = JSON.parse(readFileSync(caminhoRegistro, 'utf8'))
  } catch (e) {
    erro(`[portao-remoto] error  ${REGISTRO} is not valid JSON: ${e.message}`)
    return REPROVOU
  }
  if (typeof registro?.esquema !== 'number' || !registro?.exigido) {
    erro(
      `[portao-remoto] error  ${REGISTRO} has no \`esquema\`/\`exigido\` — it is not the record.`,
    )
    return REPROVOU
  }
  if (registro.esquema > ESQUEMA) {
    erro(
      `[portao-remoto] broke  ${REGISTRO} is schema ${registro.esquema} and this script reads ` +
        `up to ${ESQUEMA}. A repository is not accused by a ruler that cannot read it.`,
    )
    return QUEBROU
  }
  const exigido = registro.exigido
  const ramo = exigido.ramo || 'main'
  const idDoJob = exigido.job || 'verificar'

  // The demand's names come from the workflow, every run. See the header.
  const caminhoFluxo = join(raiz, ...FLUXO.split('/'))
  if (!existsSync(caminhoFluxo)) {
    erro(`[portao-remoto] error  ${FLUXO} is missing — there is no CI for a ruleset to require.`)
    return REPROVOU
  }
  let checksExigidos
  try {
    checksExigidos = checksDoFluxo(readFileSync(caminhoFluxo, 'utf8'), idDoJob)
    if (!checksExigidos.length) throw new Error(`job \`${idDoJob}\` expanded to zero contexts`)
  } catch (e) {
    erro(`[portao-remoto] broke  could not derive the required checks: ${e.message}`)
    return QUEBROU
  }

  if (soCorpo) {
    saida(
      JSON.stringify(corpoDoRuleset(checksExigidos, registro.nomeDoRuleset || 'portao'), null, 2),
    )
    return PASSOU
  }

  const remoto = git(['remote', 'get-url', 'origin'], raiz)
  if (remoto.status !== 0 || !remoto.stdout.trim()) {
    saida('[portao-remoto] na(no remote named `origin` — this project was never pushed anywhere,')
    saida('               so there is no branch on GitHub to protect. Whoever charges for it is')
    saida('               `gh repo create`; the moment a remote exists this step starts failing')
    saida('               until the ruleset is installed.)')
    return PASSOU
  }
  const alvo = donoERepositorio(remoto.stdout)
  if (!alvo) {
    saida(
      `[portao-remoto] na(origin is ${remoto.stdout.trim()}, which is not GitHub — rulesets are`,
    )
    saida('               a GitHub feature and this check has nothing to ask.)')
    return PASSOU
  }
  const repo = `${alvo.dono}/${alvo.repositorio}`

  const gh = resolverNoPath('gh')
  if (!gh || !gh.comando) {
    erro(
      `[portao-remoto] ⚠ could not ascertain: \`gh\` is not on PATH${gh ? ` in a form Node can run without a shell (${gh.caminho})` : ''}.`,
    )
    erro(`  The gate of ${repo} was NOT checked. This is a warning and not a failure on purpose:`)
    erro('  failing the developer with no network teaches people to switch the verify off. But it')
    erro('  is not silence either — install the GitHub CLI and run this again:')
    erro(`    node ${REGISTRO.replace('.json', '.mjs')} --gravar`)
    return PASSOU
  }

  const rotaRegras = `repos/${repo}/rules/branches/${ramo}`
  const respostaRegras = perguntar(gh, rotaRegras)
  if (!respostaRegras.ok) {
    erro(`[portao-remoto] ⚠ could not ascertain: ${respostaRegras.motivo}`)
    erro(`  The gate of ${repo} on branch \`${ramo}\` was NOT checked. Without a token, without`)
    erro('  network or without access, this script does not know whether the branch is protected —')
    erro('  and not knowing is not the same as approving. Authenticate with `gh auth login` and')
    erro(`  run: node ${REGISTRO.replace('.json', '.mjs')} --gravar`)
    return PASSOU
  }
  const regras = respostaRegras.dados
  if (!Array.isArray(regras)) {
    erro(`[portao-remoto] broke  ${rotaRegras} did not answer a list of rules.`)
    return QUEBROU
  }

  // bypass_actors and enforcement live on the ruleset, not on the rules listing.
  let ruleset = null
  const ids = [...new Set(regras.map((r) => r.ruleset_id).filter((n) => n != null))]
  if (ids.length) {
    const detalhes = ids.map((id) => perguntar(gh, `repos/${repo}/rulesets/${id}`))
    if (detalhes.every((d) => d.ok)) {
      // Several rulesets can apply to the same branch. The weakest one decides:
      // one ruleset with a bypass list is a way around all of them.
      ruleset = {
        enforcement: detalhes.every((d) => d.dados.enforcement === 'active')
          ? 'active'
          : detalhes.find((d) => d.dados.enforcement !== 'active').dados.enforcement,
        bypass_actors: detalhes.flatMap((d) => d.dados.bypass_actors ?? []),
      }
    }
  }

  let veredicto
  try {
    veredicto = decidir({ checksExigidos, exigido, regras, ruleset })
  } catch (e) {
    erro(`[portao-remoto] broke  the verdict table failed: ${e.message}`)
    return QUEBROU
  }

  if (gravar) {
    const novo = {
      ...registro,
      estado: veredicto.estado,
      exigido: { ...exigido, checks: checksExigidos },
      observado: veredicto.observado,
      verificadoEm: new Date().toISOString(),
      verificadoPor: `${REGISTRO.replace('.json', '.mjs')} against ${repo}@${ramo}`,
    }
    writeFileSync(caminhoRegistro, `${JSON.stringify(novo, null, 2)}\n`, 'utf8')
    saida(`[portao-remoto] record rewritten: estado "${veredicto.estado}"`)
  }

  for (const gap of veredicto.naoApurado) erro(`[portao-remoto] ⚠ ${gap}`)

  if (veredicto.estado === 'instalado') {
    saida(
      `[portao-remoto] ok — ${repo}@${ramo} requires ${checksExigidos.length} check(s), ` +
        'blocks force push and deletion, and demands a pull request.',
    )
    return PASSOU
  }

  erro(
    `[portao-remoto] error  the remote gate of ${repo}@${ramo} is ${veredicto.estado.toUpperCase()}:`,
  )
  for (const f of veredicto.faltas) erro(`  missing  ${f}`)
  erro('')
  erro('  A green CI on an unprotected branch is a badge, not a gate: the workflow runs, it goes')
  erro('  red, and the merge happens anyway. Install it with one command:')
  erro('')
  erro(
    `    node ${REGISTRO.replace('.json', '.mjs')} --corpo | gh api --method POST repos/${repo}/rulesets --input -`,
  )
  erro('')
  erro(`  Then record the fact: node ${REGISTRO.replace('.json', '.mjs')} --gravar`)
  return REPROVOU
}

// ────────────────────────────────────────────── the proof, and it ships

/**
 * A repository in the tmpdir with a fake `gh` first on PATH.
 *
 * IT LIVES IN THE SHIPPED FILE ON PURPOSE. `--provar` needs it inside the
 * generated project, offline, and rebar's own `new/gate/prove-portao-remoto.mjs`
 * imports this very function for its five cases. One implementation, two
 * consumers — a second copy in the prover would be the copy that ages.
 *
 * The fake gh is a `.mjs`, and that is not a trick: `resolverNoPath` walks PATH
 * folder by folder and runs a script through `process.execPath`. A `.cmd` shim
 * would be the one shape Node refuses to spawn without a shell, on Windows,
 * which is exactly the defect this whole repository keeps paying for.
 */
export function repoFalso({ respostas = {}, fluxo, registro, comGh = true, comRemoto = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'portao-remoto-'))
  const escrever = (rel, texto) => {
    const caminho = join(dir, ...rel.split('/'))
    mkdirSync(dirname(caminho), { recursive: true })
    writeFileSync(caminho, texto, 'utf8')
  }

  git(['init', '-q'], dir)
  if (comRemoto) git(['remote', 'add', 'origin', 'https://github.com/exemplo/projeto.git'], dir)

  escrever(FLUXO, fluxo)
  if (registro != null) escrever(REGISTRO, `${JSON.stringify(registro, null, 2)}\n`)
  // mkdir on its own line: the case that deletes the record never writes into
  // .rebar/, and the copy below would die of ENOENT before the case could run.
  mkdirSync(join(dir, '.rebar'), { recursive: true })
  copyFileSync(fileURLToPath(import.meta.url), join(dir, '.rebar', 'portao-remoto.mjs'))

  const pastaGit = resolverNoPath('git')
  if (!pastaGit) throw new Error('git is not on PATH — the proof cannot build a repository')
  const caminhos = [dirname(pastaGit.caminho)]
  if (process.platform === 'win32' && process.env.SystemRoot) {
    caminhos.push(join(process.env.SystemRoot, 'System32'))
  }

  if (comGh) {
    escrever(
      'bin/gh.mjs',
      '#!/usr/bin/env node\n' +
        `const RESPOSTAS = ${JSON.stringify(respostas, null, 2)}\n` +
        'const args = process.argv.slice(2)\n' +
        "if (args[0] !== 'api') { process.stderr.write('fake gh: only `api`\\n'); process.exit(1) }\n" +
        'const r = RESPOSTAS[args[1]]\n' +
        'if (r === undefined) { process.stderr.write(`fake gh: HTTP 404 for ${args[1]}\\n`); process.exit(1) }\n' +
        'process.stdout.write(JSON.stringify(r))\n',
    )
    caminhos.unshift(join(dir, 'bin'))
  }

  return {
    dir,
    env: { ...process.env, PATH: caminhos.join(delimiter), Path: caminhos.join(delimiter) },
    limpar: () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }),
  }
}

/** Runs the copy of this script that lives inside the fake repository. */
export function rodarNoRepoFalso(falso, args = []) {
  const r = spawnSync(process.execPath, [join(falso.dir, '.rebar', 'portao-remoto.mjs'), ...args], {
    cwd: falso.dir,
    env: falso.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  })
  return { status: r.status, saida: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const REGRAS_COMPLETAS = (checks) => [
  { type: 'deletion', ruleset_id: 1 },
  { type: 'non_fast_forward', ruleset_id: 1 },
  { type: 'pull_request', parameters: { required_approving_review_count: 0 }, ruleset_id: 1 },
  {
    type: 'required_status_checks',
    parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: checks.map((context) => ({ context })),
    },
    ruleset_id: 1,
  },
]

/**
 * THE TWO CASES, offline. A rule born with only the failing case would pass for
 * correct while failing everything, so the approving case is not optional.
 *
 * The workflow and the record come from THIS project, on disk: the derivation
 * is proved against the real file, not against a copy written here that would
 * age apart from it.
 */
function provar() {
  const raiz = raizDoRepositorio()
  if (!raiz) {
    erro('[portao-remoto] --provar needs a git repository to read the workflow from.')
    return ALVO_INVALIDO
  }
  const fluxo = readFileSync(join(raiz, ...FLUXO.split('/')), 'utf8')
  const registro = JSON.parse(readFileSync(join(raiz, ...REGISTRO.split('/')), 'utf8'))
  const checks = checksDoFluxo(fluxo, registro.exigido?.job || 'verificar')
  const rota = 'repos/exemplo/projeto/rules/branches/main'
  const falhas = []

  const casos = [
    {
      titulo: 'no ruleset — the gate is open and the step has to say so',
      respostas: { [rota]: [] },
      esperado: REPROVOU,
      exigirNaSaida: [/AUSENTE/i, /--corpo/],
    },
    {
      titulo: 'ruleset installed, every check required — the step has to pass',
      respostas: {
        [rota]: REGRAS_COMPLETAS(checks),
        'repos/exemplo/projeto/rulesets/1': { enforcement: 'active', bypass_actors: [] },
      },
      esperado: PASSOU,
      exigirNaSaida: [/ok —/],
    },
  ]

  for (const caso of casos) {
    const falso = repoFalso({ respostas: caso.respostas, fluxo, registro })
    try {
      const r = rodarNoRepoFalso(falso)
      if (r.status !== caso.esperado) {
        falhas.push(`${caso.titulo}: exit ${r.status}, expected ${caso.esperado}\n${r.saida}`)
        continue
      }
      for (const padrao of caso.exigirNaSaida) {
        if (!padrao.test(r.saida))
          falhas.push(`${caso.titulo}: output does not match ${padrao}\n${r.saida}`)
      }
      saida(`[portao-remoto] ok  ${caso.titulo}`)
    } finally {
      falso.limpar()
    }
  }

  if (falhas.length) {
    for (const f of falhas) erro(`[portao-remoto] FAILED  ${f}`)
    return REPROVOU
  }
  saida(`[portao-remoto] ${casos.length} case(s) proved, with no network.`)
  return PASSOU
}

// Only when this file is the program. The generated project's test imports it to
// derive the check names, and an import must not run a check.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const argv = process.argv.slice(2)
  let codigo
  try {
    codigo = argv.includes('--provar') ? provar() : conferir(argv)
  } catch (e) {
    erro(`[portao-remoto] broke  ${e?.stack ?? e}`)
    codigo = QUEBROU
  }
  process.exit(codigo)
}
