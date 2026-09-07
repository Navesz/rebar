#!/usr/bin/env node
// prove.mjs — the rebar-check proofs.
//
// The mother rule of the alicerce says: every rule that rises to N1 is born with
// two cases, one that passes and one that fails. rebar-check shipped with 19 rules
// and ZERO cases, violating the rule the repository itself transcribes and bolds.
// Two rules have already had a PROVEN false positive — `tests` was blind to a file
// named in Portuguese (43 tracked files with "prova" in the name, zero seen) and
// `ci-gates` looked for the literal words lint/typecheck/test in the YAML. Both
// were fixed. This exists so the third one does not go by unnoticed.
//
// Usage:
//   node prove.mjs                 runs every case in proofs/cases/
//   node prove.mjs <rule-id>       runs only that case
//
// A case is the folder proofs/cases/<rule>[__<variant>]/ with:
//
//   caso.json     { "rule", "why", "pass"?, "fail"? }
//   pass/         the tree of one side
//   fail/         the tree of the other
//
// Each side block accepts:
//
//   "estado"   what the rule has to return there: "passou" · "reprovou" · "na".
//              Omitted, pass=passou and fail=reprovou hold. It is the field that
//              makes the N/A branches lockable — see ESTADO_PADRAO.
//   "commits"  list of { mensagem, autor }. Omitted, one default commit.
//              An EMPTY LIST means "no commit at all", which is the only way to
//              reach the N/A branches of `ai-coauthorship` and `git-identity`.
//
// The Portuguese still above is not prose, it is data this file reads or writes:
// `estado`, `commits`, `mensagem` and `autor` are keys of caso.json, and
// `passou` · `reprovou` · `na` are the states index.mjs prints in its `--json`.
// Renaming one of them is another job, with another risk, and it is not this one.
//
// Exit codes — same discipline as index.mjs, three things, three codes:
//   0    every side matched what was expected
//   1    some side DIVERGED, or index.mjs BROKE on it. A crash never counts as
//        "the fail side matched": an index.mjs that does not even compile makes
//        node exit 1, and the old format — which read the exit code — took the
//        15 `fail` sides for good ones, leaving the suite half green with the
//        checker dead.
//   2    the PROOF itself is malformed — and that dominates the 1, for the same
//        reason that 127 dominates 1 in index.mjs: you do not accuse anyone
//        with an instrument that is bent.
//
// It NEVER writes to the repository. Each side is assembled in a fresh directory
// under os.tmpdir() and deleted in the finally. The alicerce's provar-portao.mjs
// did writeFileSync + git add INSIDE the live repo — a known defect this file
// refuses to inherit.
//
// ────────────────────────────────────────────────────────────── performance
//
// This suite used to be SERIAL and was the most expensive step of `verify`.
// The numbers in this section are from 31/08, when there were 47 cases — they
// stay dated because what they teach is the ORDER OF RETURN of the changes, not
// today's clock.
//
// 47 cases ×
// 2 sides = 94 git repositories assembled one by one, ~660 processes in line. On
// this machine (Windows, 20 cores) the serial version took 41.3 · 42.0 · 51.9 s
// in three runs. I instrumented every spawn of it to know WHERE the time went —
// the measurement comes out of a 64.4 s run, and what matters in it is the
// PROPORTION:
//
//   index.mjs   n= 94  total= 18346 ms   mean=195.2 ms  28.5%
//   git commit  n=103  total= 16245 ms   mean=157.7 ms  25.2%
//   git init    n= 94  total= 13127 ms   mean=139.6 ms  20.4%
//   git add     n= 94  total=  7736 ms   mean= 82.3 ms  12.0%
//   git config  n=188  total=  6977 ms   mean= 37.1 ms  10.8%
//   rmSync      n= 94  total=  1515 ms                   2.4%
//   cpSync      n= 94  total=   445 ms                   0.7%
//   mkdtemp     n= 94  total=    48 ms                   0.1%
//
// That is: assembling the fixture cost 44.1 s (68%) and running what is under
// proof cost 18.3 s (28%). The bottleneck was NOT the checker; it was git. Hence
// the three changes, in this order of return:
//
//   1. CUT WORK. The 188 `git config` became ZERO: the committer identity goes
//      by GIT_COMMITTER_NAME/EMAIL in the environment, and the author already
//      came by `--author` on each commit. The 94 `git init` became ONE: the
//      template is initialized once and the `.git` is COPIED to each side —
//      copying ~20 little files against a 140 ms process. The template is born
//      inside the SAME os.tmpdir() as the fixtures on purpose: `git init`
//      writes into .git/config what it detected of the file system (filemode,
//      symlinks, ignorecase), and a template created on another volume would
//      carry that wrong detection along.
//   2. PARALLELIZE BY CASE. Each case was already independent by construction —
//      its own tmpdir, its own git, nothing shared —, but `spawnSync` blocked
//      the event loop and served one process at a time. Now it is asynchronous
//      `spawn` with a fixed-size pool (see TETO).
//   3. THE ORDER OF THE OUTPUT DOES NOT CHANGE. The cases finish out of order;
//      the report comes out in alphabetical order all the same, because each
//      case writes into an indexed bucket and the printing only drains the next
//      index when it is ready. A suite whose diff between two runs turns into
//      noise is a suite nobody trusts.
//
// What the remaining `git` calls gained: `commit --quiet --no-verify` (no commit
// summary that we throw away, no third-party hook) and `init --quiet` on the
// template.
//
// RESULT on 31/08, the same 47 cases of the time, idle machine:
//
//   before, serial                          41.3 · 42.0 · 51.9 s
//   cutting work only, still serial                 29.9 s
//   cutting + pool                            6.3 · 6.7 · 7.1 s
//
// ~6.5× on the clock, of which cutting work answers for 41 → 30 s and the pool
// for 30 → 6 s. With the machine under load (another agent running the suite in
// the same minute), an interleaved A/B gave 107–201 s serial against 13–21 s
// parallel — from 4.8× to 10.3×, never less.
//
// And the verdict did not change: 15 saved outputs — serial and parallel, TETO
// from 1 to 20, repeated runs — hit the SAME md5, byte for byte, including the
// run with a malformed case and another with a case that diverges on purpose.

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { availableParallelism, cpus, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))

// The checker and the cases folder are PARAMETERS, not constants.
//
// The security module was born with the same contract as this runner — three
// states, `caso.json` with `rule`/`why`, `pass/` and `fail/` folders, mutation as
// proof. Duplicating a thousand lines of executor for it would be the second
// source that diverges, which is the defect this whole repository chases. With no
// argument, the default is still rebar-check and nothing changes for whoever was
// already calling `npm run prove`.
const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`))
  return a ? resolve(a.slice(nome.length + 3)) : padrao
}
const INDEX = arg('checker', join(AQUI, '..', 'index.mjs'))
const CASOS = arg('cases', join(AQUI, 'cases'))

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
 * How many cases in flight at the same time.
 *
 * A fixed-size pool, never `Promise.all` over every case: each case is disk I/O
 * (assembling two repositories) far more than CPU, and on Windows a swarm of
 * gits fights over the same volume.
 *
 * The table below is HISTORICAL and is dated on purpose — measured on 31/08 on
 * this 20-core machine, with the 47 cases that existed then (today there are
 * more). What it decides is the SHAPE of the curve, not the absolute value, and
 * the shape does not change with more cases. End-to-end clock:
 *
 *   1 (this version, serial)   29.9 s       10   6.7 s
 *   4                           9.3 s       12   6.3 s
 *   6                           7.8 s       16   5.6 s
 *   8                           7.2 s       20   6.7 s
 *
 * The gross gain comes up to 8; from 8 to 16 it still drops; at 20 it goes back
 * up, which is the fight over the disk showing. Hence the ceiling of 16.
 *
 * The ceiling only bites on a big machine — the `min` with the cores guarantees
 * that a 2 or 4 vCPU runner takes 2 or 4, not 16. `availableParallelism` respects
 * the cgroup of the CI container, which `cpus().length` does not; the fallback
 * exists for old Node.
 */
const NUCLEOS = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length
const TETO = Math.max(2, Math.min(16, NUCLEOS))

/**
 * The STATE each side has to produce, by default.
 *
 * This used to be `{ aprovar: 0, reprovar: 1 }` — exit code —, and the choice
 * holed the suite by construction: index.mjs collapses "passou" and "na" into
 * the SAME exit 0, so none of the N/A branches could be locked, however many
 * cases one wrote. Measured: of the 70 mutations the audit applied to index.mjs,
 * 30 survived with the suite 15 of 15 green — and among the survivors were the
 * `na()` helper and the `catch` of `git()`, the two fixes index.mjs documents as
 * the most expensive it ever took. Now each side declares a state and the runner
 * reads it from the `--json`.
 *
 * The default reproduces the old contract, so the cases already written keep
 * holding without a line of rewriting.
 *
 * `quebrou` does not appear here and can never be expected: a crash is a defect
 * of the instrument, not a result from it.
 */
const ESTADO_PADRAO = { pass: 'passou', fail: 'reprovou' }
const LADOS = Object.keys(ESTADO_PADRAO)
const ESTADOS_ESPERAVEIS = new Set(['passou', 'reprovou', 'na'])

// Fixture data, not prose: this is the history the target repository ends up
// with, and rules read it — `git-identity` reads exactly this `%an <%ae>`.
// Translating it changes the target, not the text.
const COMMIT_PADRAO = { mensagem: 'caso de prova', autor: 'Prova <prova@rebar.local>' }

/**
 * 2026-01-01T00:00:00Z in seconds. It goes in the raw "<unix> <zone>" format
 * because an ISO date with no zone is read by git as LOCAL time — the proof would
 * run differently in São Paulo and on the CI runner. Each commit moves 60s so the
 * history stays in readable order without depending on a hash tiebreak.
 */
const EPOCA_FIXA = 1767225600

/**
 * Global and system config neutralized by pointing at a path that does not exist
 * (git treats a missing config file as empty). Without this the proof inherits
 * the machine's gitconfig: commit.gpgsign locks the commit, core.hooksPath fires
 * a third-party hook, init.templateDir injects a file into the tree and
 * core.autocrlf changes the content of what the rule is going to read. A fixture
 * that depends on the machine is not a fixture.
 */
const SEM_CONFIG = join(tmpdir(), 'rebar-provas-gitconfig-inexistente')

/**
 * The committer identity comes by ENVIRONMENT, not by local `git config`.
 *
 * It used to be two `git config` per side — 188 processes, 7.0 s of the 64.4 s
 * measured — to write exactly what these four variables say. The author of each
 * commit still comes from `--author`, which takes precedence over GIT_AUTHOR_*,
 * so the `%an <%ae>` the `git-identity` rule reads comes out identical.
 * index.mjs never reads the target's `git config` — only `git log` and `git
 * ls-files` —, so the absence of the local config is not observable by any rule.
 */
function ambienteGit(iCommit) {
  const carimbo = `${EPOCA_FIXA + iCommit * 60} +0000`
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: SEM_CONFIG,
    GIT_CONFIG_SYSTEM: SEM_CONFIG,
    GIT_AUTHOR_NAME: 'Prova',
    GIT_AUTHOR_EMAIL: 'prova@rebar.local',
    GIT_COMMITTER_NAME: 'Prova',
    GIT_COMMITTER_EMAIL: 'prova@rebar.local',
    GIT_AUTHOR_DATE: carimbo,
    GIT_COMMITTER_DATE: carimbo,
    GIT_TERMINAL_PROMPT: '0',
  }
}

/**
 * Live children — git and index.mjs. It only serves the signal handler, and it is
 * the piece that was missing when the suite went parallel: MEASURED, firing the
 * handler in the middle of a run, 10 `rebar-prova-*` folders were left behind
 * even with the handler's rmSync running on all of them. The reason is Windows: a
 * `git` still alive holds a handle inside the directory being deleted, the rmSync
 * fails, the catch swallows it, and process.exit kills the child AFTERWARDS, too
 * late. Killing first and deleting after takes the 10 down to 0.
 */
const filhos = new Set()

/**
 * Asynchronous spawn, never spawnSync: it is the piece that makes the pool
 * possible. With spawnSync the event loop sits still inside the child process and
 * the "parallelization" would serve one case at a time, exactly like before.
 *
 * No shell. `git` and `process.execPath` are real executables on both systems;
 * what the house forbids is `npx` without a shell, and npx does not show up here.
 */
function rodar(cmd, args, opcoes) {
  return new Promise((resolve) => {
    let filho
    try {
      filho = spawn(cmd, args, { ...opcoes, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ erro: e, codigo: null, stdout: '', stderr: '' })
      return
    }
    // Registered so the signal handler can KILL the children before trying to
    // delete the folders — see the signal handler.
    filhos.add(filho)
    let saida = ''
    let erroSaida = ''
    let erro = null
    filho.stdout.setEncoding('utf8')
    filho.stderr.setEncoding('utf8')
    filho.stdout.on('data', (d) => {
      saida += d
    })
    filho.stderr.on('data', (d) => {
      erroSaida += d
    })
    // 'error' (ENOENT, for one) still fires 'close' afterwards; I keep it and
    // resolve only once, on the close, so as not to leak a pending promise.
    filho.on('error', (e) => {
      erro = e
    })
    filho.on('close', (codigo) => {
      filhos.delete(filho)
      resolve({ erro, codigo, stdout: saida, stderr: erroSaida })
    })
  })
}

async function git(dir, args, iCommit = 0) {
  const r = await rodar('git', args, { cwd: dir, env: ambienteGit(iCommit) })
  if (r.erro) throw new Error(`git ${args[0]}: ${r.erro.message}`)
  if (r.codigo !== 0) {
    const detalhe = `${r.stderr || ''}\n${r.stdout || ''}`.trim().split('\n')[0]
    throw new Error(`git ${args.join(' ')} exited ${r.codigo}: ${detalhe}`)
  }
  return (r.stdout || '').trim()
}

/**
 * EVERY temporary folder of this run is born with this prefix, which carries the
 * PID.
 *
 * The PID is not decoration: it is what makes cleanup by SWEEP safe. Without it,
 * sweeping `rebar-prova-*` out of os.tmpdir() would delete the fixture of another
 * run happening at the same time — the CI matrix runs Windows and Linux, and on
 * this machine there is more than one agent touching the repository in the same
 * minute.
 */
const PREFIXO_TMP = `rebar-prova-${process.pid}-`

/**
 * Deleting on the normal path is asynchronous so as not to block the other cases
 * of the pool — 1.5 s of the instrumented run was rmSync blocking the loop.
 * maxRetries because on Windows git leaves a read-only object in .git/objects and
 * the antivirus holds the handle for a few milliseconds.
 */
async function apagar(dir) {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    /* it is temporary; the OS cleans it */
  }
}

/**
 * The sweep: deletes EVERYTHING this run created and is still in os.tmpdir().
 *
 * The normal path already deletes each side in its own `finally`, but deleting
 * can fail in silence — measured, with the machine under load an `rm` of the
 * template did not take and the folder stayed. One directory read at the end of
 * the run costs milliseconds and closes that hole. The filter is by PREFIXO_TMP,
 * so one run never deletes another's fixture.
 */
async function varrerRestos() {
  let restos = []
  try {
    restos = readdirSync(tmpdir()).filter((n) => n.startsWith(PREFIXO_TMP))
  } catch {
    /* with no readable tmpdir there is nothing to sweep */
  }
  for (const nome of restos) await apagar(join(tmpdir(), nome))
}

/**
 * The Ctrl+C cleanup. Three steps, in this order, and each one came out of a
 * measurement.
 *
 * The serial version kept the in-flight folders in a Set and deleted that Set.
 * With the pool that started to LIE in two ways, both measured by firing the
 * handler in the middle of the run:
 *
 *   1. 10 out of 10 folders were left behind because that side's `git` was still
 *      alive holding a handle inside it — on Windows the rmSync fails, the catch
 *      swallows it, and process.exit kills the child only afterwards, too late.
 *      Hence killing the children FIRST, and waiting 100 ms for the OS to let go
 *      of the handles. Atomics.wait is Node's factory blocking sleep; you cannot
 *      `await` here, because the handler has to finish on the same tick.
 *   2. Folders were still left behind that the Set NEVER GOT TO KNOW ABOUT:
 *      asynchronous `mkdtemp` creates the directory on disk before the callback
 *      runs in JS, and the 100 ms of waiting are exactly the window in which the
 *      `mkdtemp` of the other N lanes of the pool finish without ever being
 *      registered. An in-memory registry has no way to cover that.
 *
 * That is why the cleanup is a SWEEP of os.tmpdir() by PREFIXO_TMP, and not a
 * list: the disk is the only source that knows everything that was created, and
 * the prefix with the PID guarantees that only what belongs to this run is
 * deleted. Measured afterwards: 0 forgotten folders in 8 interruptions at random
 * points of the run, against 10 on the first attempt at a fix.
 */
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    for (const f of [...filhos]) {
      try {
        f.kill()
      } catch {
        /* it already died between the Set and here */
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    let restos = []
    try {
      restos = readdirSync(tmpdir()).filter((n) => n.startsWith(PREFIXO_TMP))
    } catch {
      /* with no readable tmpdir there is nothing to sweep */
    }
    for (const nome of restos) {
      try {
        rmSync(join(tmpdir(), nome), {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        })
      } catch {
        /* it is temporary; the OS cleans it */
      }
    }
    process.exit(130)
  })
}

// ─────────────────────────────────────────────────────── reading one case

/**
 * A badly declared "side" is a malformed proof, not a fail. It stacks into
 * `erros` instead of throwing so that one run shows ALL the defects of the case
 * at once, and not one per execution.
 */
function lerCommits(bloco, lado, erros) {
  if (bloco === undefined || bloco === null) return [COMMIT_PADRAO]
  if (typeof bloco !== 'object' || Array.isArray(bloco)) {
    erros.push(`"${lado}" has to be an object`)
    return [COMMIT_PADRAO]
  }
  if (bloco.commits === undefined) return [COMMIT_PADRAO]
  if (!Array.isArray(bloco.commits)) {
    erros.push(`"${lado}.commits" has to be a list`)
    return [COMMIT_PADRAO]
  }
  // An EMPTY list is a deliberate declaration of "git init and stop there", not
  // carelessness. It exists because `ai-coauthorship` and `git-identity` have an
  // N/A branch that is only reached in a repository with NO commit at all, and
  // without this that branch was unreachable by the proof. The files still go to
  // the index, so `git ls-files` keeps seeing the tree: the target is a
  // repository with content and no history, which is exactly the branch's object.
  if (!bloco.commits.length) return []
  const saida = []
  bloco.commits.forEach((cm, i) => {
    const onde = `${lado}.commits[${i}]`
    if (!cm || typeof cm !== 'object' || Array.isArray(cm)) {
      erros.push(`${onde} is not an object`)
      return
    }
    if (typeof cm.mensagem !== 'string' || !cm.mensagem.length)
      erros.push(`${onde} without "mensagem"`)
    const autor = typeof cm.autor === 'string' ? cm.autor.trim() : ''
    // git refuses the whole commit if the --author comes in bent. Failing the
    // proof here gives a better message than seeing "fatal: malformed --author"
    // over there.
    if (!/^[^<>]+<[^<>]*>$/.test(autor)) {
      erros.push(`${onde} author outside the format "Name <email>": ${JSON.stringify(cm.autor)}`)
    }
    saida.push({ mensagem: typeof cm.mensagem === 'string' ? cm.mensagem : '', autor })
  })
  return saida.length ? saida : [COMMIT_PADRAO]
}

/**
 * `"modos": { "hooks/pre-commit": "100755" }` — file mode in the index.
 *
 * It exists because `git add` on Windows writes everything as 100644, and without
 * this the `hooks-executable` rule would be unprovable on the only platform
 * where this repository is written. Only the two modes git knows for a plain file.
 */
function lerModos(bloco, lado, erros) {
  if (!bloco || typeof bloco !== 'object' || bloco.modos === undefined) return {}
  const m = bloco.modos
  if (typeof m !== 'object' || Array.isArray(m) || m === null) {
    erros.push(`"${lado}.modos" has to be an object of path to mode`)
    return {}
  }
  for (const [caminho, modo] of Object.entries(m)) {
    if (modo !== '100755' && modo !== '100644') {
      erros.push(
        `"${lado}.modos[${caminho}]" only takes "100755" or "100644", got ${JSON.stringify(modo)}`,
      )
    }
  }
  return m
}

function lerCaso(id) {
  const base = join(CASOS, id)
  const arquivo = join(base, 'caso.json')
  if (!existsSync(arquivo)) return { erros: ['no caso.json'] }

  let bruto
  try {
    bruto = JSON.parse(readFileSync(arquivo, 'utf8'))
  } catch (e) {
    return { erros: [`caso.json unreadable: ${e.message}`] }
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { erros: ['caso.json is not an object'] }
  }

  const erros = []
  // The folder can be `<rule>` or `<rule>__<variant>`. The variant exists because
  // a rule can have more than one way of being satisfied, and a case that is
  // satisfied by SEVERAL paths at once proves none of them.
  // Measured: the original `tests` case had three test files — a folder named in
  // Portuguese, a name in Portuguese and an ordinary file. Restoring by hand the
  // Portuguese-blindness bug, the proof stayed GREEN, because the name still
  // matched. A proof that survives the return of the defect it exists to lock is
  // not a proof. Each variant isolates ONE path.
  const regraDaPasta = id.includes('__') ? id.slice(0, id.indexOf('__')) : id
  if (bruto.rule !== regraDaPasta) {
    erros.push(`caso.json says rule ${JSON.stringify(bruto.rule)} and the folder is "${id}"`)
  }
  const regra = regraDaPasta
  if (typeof bruto.why !== 'string' || !bruto.why.trim()) {
    erros.push('caso.json without "why" — the proof has to say what real failure it stops')
  }

  const lados = {}
  for (const lado of LADOS) {
    const dir = join(base, lado)
    if (!existsSync(dir)) {
      erros.push(`the folder ${lado}/ is missing`)
      continue
    }
    if (!statSync(dir).isDirectory()) {
      erros.push(`${lado}/ exists and is not a folder`)
      continue
    }
    const bloco = bruto[lado]
    // The field is optional: without it the default holds, and the folders are
    // called `pass`/`fail` because that is what the overwhelming majority of
    // cases declares. A case that declares `na` on both sides uses the two
    // folders for two DIFFERENT N/A branches of the same rule — hence the
    // `why` having to say which branch each side reaches.
    let estado = ESTADO_PADRAO[lado]
    const pedido =
      bloco && typeof bloco === 'object' && !Array.isArray(bloco) ? bloco.estado : undefined
    if (pedido !== undefined) {
      if (!ESTADOS_ESPERAVEIS.has(pedido)) {
        erros.push(
          `"${lado}.estado" is ${JSON.stringify(pedido)} — only ${[...ESTADOS_ESPERAVEIS].join(', ')} hold`,
        )
      } else {
        estado = pedido
      }
    }
    lados[lado] = {
      dir,
      estado,
      commits: lerCommits(bloco, lado, erros),
      modos: lerModos(bloco, lado, erros),
    }
  }

  return {
    rule: regra,
    erros,
    why: typeof bruto.why === 'string' ? bruto.why.trim() : '',
    lados,
  }
}

// ────────────────────────────────────────────────────────── running one side

/**
 * The freshly initialized `.git` that every side copies, instead of running
 * `git init` 94 times (13.1 s of the 64.4 s measured). It is born in os.tmpdir(),
 * the same volume as the fixtures, because the `.git/config` the init writes
 * carries the file-system detection: a template from another volume would take
 * the wrong filemode and ignorecase into every fixture.
 */
let MOLDE_GIT = null

async function prepararMolde() {
  const dir = await mkdtemp(join(tmpdir(), `${PREFIXO_TMP}molde-`))
  await git(dir, ['init', '--quiet', '-b', 'principal'])
  MOLDE_GIT = { raiz: dir, git: join(dir, '.git') }
}

async function montarLado(origem, commits, modos) {
  const tmp = await mkdtemp(join(tmpdir(), PREFIXO_TMP))
  try {
    await cp(origem, tmp, { recursive: true })
    // The `.git` goes in AFTER the tree, in the same order the `git init` used
    // to: if one day a fixture brings a `.git` of its own, the template still
    // wins, the way the init won.
    await cp(MOLDE_GIT.git, join(tmp, '.git'), { recursive: true })
    // `git add` ONCE and outside the loop. The tree is copied whole before the
    // first commit and does not change between them, so repeating the add per
    // commit added nothing; and with `commits: []` there is no iteration at all,
    // so the add in there would leave the index empty — the `git ls-files` of
    // index.mjs would see a repository with NO FILE, which is another target,
    // not the one the case declared.
    await git(tmp, ['add', '-A'])
    // FILE MODE IN THE INDEX. `git add` on Windows writes everything as 100644
    // because the system has no execution bit — so without this NO fixture can
    // declare an executable hook, and the `hooks-executable` rule stays
    // unprovable on the only platform where this repository is written. The
    // `--chmod` acts on the index, which is exactly the layer the rule reads and
    // the only one that travels in the clone.
    for (const [caminho, modo] of Object.entries(modos || {})) {
      await git(tmp, ['update-index', `--chmod=${modo === '100755' ? '+x' : '-x'}`, caminho])
    }
    for (const [i, commit] of commits.entries()) {
      // --allow-empty because a legitimate side may have no file at all (the
      // empty tree is the natural `fail` of `license`) and because the 2nd
      // declared commit usually does not change the tree — the `ai-coauthorship`
      // case only changes the MESSAGE. Without this git exits 1 and the proof
      // dies by accident. --quiet cuts the summary we discard; --no-verify is a
      // seat belt against a hook coming from a future core.hooksPath.
      await git(
        tmp,
        [
          'commit',
          '--quiet',
          '--no-verify',
          '--allow-empty',
          '--author',
          commit.autor,
          '-m',
          commit.mensagem,
        ],
        i,
      )
    }
    return tmp
  } catch (e) {
    await apagar(tmp)
    throw e
  }
}

async function rodarRegra(id, dir) {
  // --heuristics ALWAYS. Measured in the four combinations: with `--rule=` on a
  // deterministic rule the flag is a no-op (editorconfig exits 1 with and without
  // it, because no heuristic gets to run under the filter); with `--rule=` on a
  // heuristic it is the ONLY way for the `fail` side to exit 1 — without the flag
  // `phone` accuses the phone number and still exits 0, and the proof would be
  // impossible to write. Without this the 5 heuristics would sit forever with no
  // case.
  //
  // process.execPath + the script path: no `npx`, which without shell:true does
  // not exist as an executable on Windows. It was the bug that broke the alicerce.
  //
  // --json because the exit code does not tell "passou" from "na": both exit 0.
  // While the verdict came from the exit code, EVERY N/A branch of index.mjs was
  // unlockable by construction of the format — 13 when the audit counted them,
  // 17 after the read guards went in. `stdout` and `stderr` come SEPARATE —
  // joining them, as this function used to, destroyed the only cheap evidence
  // that the checker died: anything in stderr dirties the JSON.
  const r = await rodar(process.execPath, [INDEX, `--rule=${id}`, '--heuristics', '--json', dir], {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: SEM_CONFIG,
      GIT_CONFIG_SYSTEM: SEM_CONFIG,
      NO_COLOR: '1',
    },
  })
  if (r.erro) throw new Error(`could not run index.mjs: ${r.erro.message}`)
  return { codigo: r.codigo, stdout: r.stdout || '', stderr: (r.stderr || '').trim() }
}

const primeiraLinha = (t) => t.split('\n').filter((l) => l.trim())[0] || ''

/**
 * Translates one execution of index.mjs into ONE observed state.
 *
 * Anything that is not a readable rule state becomes `quebrou`, and `quebrou`
 * never matches any side. It is the fix for the crudest hole of the old format:
 * an index.mjs with a syntax error makes node exit 1, and since the `fail` side
 * expected exactly 1, the 15 cases scored half green with the checker dead.
 * Here, three independent signals denounce the bent instrument: exit 127, any
 * byte in stderr, and stdout that is not JSON.
 */
function observar(exec) {
  const { codigo, stdout, stderr } = exec
  if (codigo === 2)
    return { estado: 'malformada', detalhe: 'exit 2 — invalid target or wrong invocation' }
  if (codigo === null) return { estado: 'quebrou', detalhe: 'the process died by signal' }
  if (codigo === 127) return { estado: 'quebrou', detalhe: 'exit 127 — the rule THREW' }
  if (stderr) return { estado: 'quebrou', detalhe: `it wrote to stderr: ${primeiraLinha(stderr)}` }

  let dados
  try {
    dados = JSON.parse(stdout)
  } catch (e) {
    return {
      estado: 'quebrou',
      detalhe: `it produced no parseable JSON (exit ${codigo}): ${primeiraLinha(e.message)}`,
    }
  }
  if (!Array.isArray(dados) || dados.length !== 1)
    return { estado: 'quebrou', detalhe: 'the --json did not return exactly one evaluation' }
  if (dados[0].erro)
    return { estado: 'malformada', detalhe: `index.mjs refused the target: ${dados[0].erro}` }

  const res = dados[0].resultados
  if (!Array.isArray(res) || res.length !== 1) {
    const quantos = Array.isArray(res) ? res.length : 'no'
    return { estado: 'quebrou', detalhe: `--rule= returned ${quantos} result(s), expected 1` }
  }
  const { estado, motivo } = res[0]
  if (typeof estado !== 'string') return { estado: 'quebrou', detalhe: 'result without "estado"' }
  if (estado === 'quebrou') return { estado: 'quebrou', detalhe: `the rule THREW: ${motivo}` }

  // It also locks the exit code CONTRACT, which was the only thing the old format
  // checked and which the new one would lose sight of if it only looked at the
  // JSON. With `--heuristics` on, reprovou has to exit 1 and passou/na have to
  // exit 0, heuristic rules included.
  const codigoDevido = estado === 'reprovou' ? 1 : 0
  if (codigo !== codigoDevido) {
    return {
      estado: 'quebrou',
      detalhe: `state "${estado}" and exit ${codigo} do not match — it should exit ${codigoDevido}`,
    }
  }
  return { estado, detalhe: motivo || '' }
}

async function provarLado(id, lado, spec) {
  let tmp = null
  try {
    tmp = await montarLado(spec.dir, spec.commits, spec.modos)
    const obs = observar(await rodarRegra(id, tmp))
    const veredito =
      obs.estado === spec.estado
        ? 'bateu'
        : obs.estado === 'quebrou' || obs.estado === 'malformada'
          ? obs.estado
          : 'divergiu'
    return { lado, veredito, esperado: spec.estado, obtido: obs.estado, detalhe: obs.detalhe }
  } catch (e) {
    // It failed assembling the fixture: it is the proof that is bent, not the rule.
    return {
      lado,
      veredito: 'malformada',
      esperado: spec.estado,
      obtido: null,
      detalhe: e.message,
    }
  } finally {
    if (tmp) await apagar(tmp)
  }
}

/**
 * The two sides of a case run in SERIES inside the case, and it is the cases that
 * run in parallel. On purpose: this way the whole pool has at most TETO fixtures
 * assembled at the same time, and the number of simultaneous gits is the one that
 * was measured, not double it.
 */
async function provarCaso(caso) {
  const saidas = []
  for (const lado of LADOS) saidas.push(await provarLado(caso.rule, lado, caso.lados[lado]))
  return saidas
}

// ─────────────────────────────────────────────── inventory and presentation

/**
 * Discovers the ids index.mjs knows without importing it (it is a CLI that calls
 * process.exit) and without duplicating the list here — a duplicated list ages.
 * An impossible id makes index.mjs exit 2 printing "disponíveis: ...".
 * If one day the message changes, it returns null and the up-front validation
 * just disappears.
 *
 * "disponíveis:" stays in Portuguese on purpose: here it is not prose, it is the
 * literal prefix of the line index.mjs writes to stderr, and the two only work
 * as a pair. Translating either side alone costs BOTH the unknown-id check and
 * the coverage line, and costs them in SILENCE — the find returns undefined,
 * this returns null, and every caller treats null as "no list to compare
 * against". Nothing turns red. index.mjs carries the mirror of this note.
 */
async function regrasConhecidas() {
  const r = await rodar(process.execPath, [INDEX, '--rule=__inexistente__'], {
    env: { ...process.env, NO_COLOR: '1' },
  })
  const linha = `${r.stderr || ''}`.split('\n').find((l) => l.startsWith('disponíveis:'))
  if (!linha) return null
  return linha
    .slice('disponíveis:'.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const MARCA = {
  bateu: () => c.verde('✓'),
  divergiu: () => c.vermelho('✗'),
  quebrou: () => c.amarelo('⚠'),
  malformada: () => c.amarelo('⚠'),
}

function morrer(mensagem) {
  console.error(`${c.vermelho('prove:')} ${mensagem}`)
  process.exit(2)
}

// ───────────────────────────────────────────────────────────────────── main

const args = process.argv.slice(2)
if (args.some((a) => a === '-h' || a === '--ajuda' || a === '--help')) {
  console.log('usage: node prove.mjs [rule-id]')
  process.exit(0)
}
// The list of valid flags and the PARSER live in different places, and this
// repository has already paid three times for it: `--heuristicas` became
// `--heuristics` in the parser and went on being refused here; `--regra=` became
// `--rule=` and the hook kept passing the old one. Renaming or adding a flag on
// one side only turns it into "unknown option", which is an error that does not
// point at the cause.
const CONHECIDAS = /^--(checker|cases)=/
const flags = args.filter((a) => a.startsWith('-') && !CONHECIDAS.test(a))
if (flags.length)
  morrer(
    `unknown option: ${flags.join(', ')} — usage: node prove.mjs [rule-id] [--checker=<path>] [--cases=<folder>]`,
  )
const posicionais = args.filter((a) => !a.startsWith('-'))
if (posicionais.length > 1) morrer('one rule id at a time')
const soEste = posicionais[0] || null

if (!existsSync(INDEX)) morrer(`index.mjs is not at ${INDEX}`)
if (!existsSync(CASOS))
  morrer(`${CASOS} does not exist — 19 rules and no case is exactly the hole these proofs close`)

const regras = await regrasConhecidas()

let ids = readdirSync(CASOS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => d.name)
  .sort()

if (soEste) {
  // Takes the rule id (runs all of its variants) or the exact folder name (runs
  // one variant only).
  const escolhidos = ids.filter((i) => i === soEste || i.startsWith(`${soEste}__`))
  if (!escolhidos.length) morrer(`there is no case for "${soEste}" in ${CASOS}`)
  ids = escolhidos
}
if (!ids.length) morrer(`no case in ${CASOS}`)

const largura = Math.max(...ids.map((i) => i.length), 12)
console.log(`\n${c.forte('rebar-check')} · ${c.forte('proofs')} · ${ids.length} case(s)`)

let bateram = 0
let divergiram = 0
let quebrados = 0
let malformados = 0
// A malformed case does NOT count as a proven rule. Counting the folder instead
// of the case would let coverage climb on its own just because someone created a
// directory.
const provadas = []

// Reading the cases is synchronous and cheap (small JSON); it stays OUT of the
// pool, in alphabetical order, so that "malformed proof" is decided before
// spending a process on it.
const trabalhos = ids.map((id) => {
  const caso = lerCaso(id)
  // An id index.mjs does not know is a malformed proof. Catching it here avoids
  // assembling two whole fixtures just for index.mjs to exit 2 on both.
  if (regras && caso.rule && !regras.includes(caso.rule))
    caso.erros.push(`index.mjs does not know the rule "${caso.rule}"`)
  return { id, caso }
})

/**
 * The printing of ONE case. It is only called by the drain, and the drain only
 * calls in index order — this is where the output goes back to being
 * deterministic after the cases have finished in any order. The counters go up
 * here too, for the same reason: a counter that goes up in finishing order is a
 * counter nobody can reproduce.
 */
function imprimirCaso({ id, caso }, resultados) {
  if (caso.erros.length) {
    malformados++
    console.log(`  ${c.amarelo('⚠')} ${id.padEnd(largura)} ${c.amarelo('MALFORMED')}`)
    for (const e of caso.erros) console.log(`      ${c.fraco(e)}`)
    return
  }

  if (!provadas.includes(caso.rule)) provadas.push(caso.rule)
  const pior = resultados.find((x) => x.veredito !== 'bateu')

  const resumoLados = resultados
    .map((x) => {
      // It prints the state, not the exit code: it was the exit code that hid
      // the difference between "passou" and "na", and a scoreboard that hides
      // does not check.
      const txt = `${x.lado} ${x.obtido || '—'}`
      return x.veredito === 'bateu' ? c.verde(txt) : c.vermelho(txt)
    })
    .join(c.fraco(' · '))
  console.log(`  ${MARCA[pior ? pior.veredito : 'bateu']()} ${id.padEnd(largura)} ${resumoLados}`)

  if (!pior) {
    bateram++
    return
  }
  if (resultados.some((x) => x.veredito === 'malformada')) malformados++
  else if (resultados.some((x) => x.veredito === 'quebrou')) quebrados++
  else divergiram++

  console.log(`      ${c.fraco(`why: ${caso.why}`)}`)
  for (const x of resultados) {
    if (x.veredito === 'bateu') continue
    const explica = {
      divergiu: `I expected "${x.esperado}", I observed "${x.obtido}"`,
      quebrou: `index.mjs BROKE — a bent instrument, not a finding about the target`,
      malformada: 'I could not assemble or run the fixture',
    }[x.veredito]
    console.log(`      ${c.vermelho(`${x.lado}/`)} ${explica}`)
    for (const l of String(x.detalhe).split('\n').filter(Boolean).slice(0, 6))
      console.log(`        ${c.fraco(`│ ${l}`)}`)
  }
}

// The indexed bucket + the drain: each case deposits its result at ITS index and
// the printing walks on while the next index is ready. Whoever finishes out of
// order waits; whoever finishes in turn prints right away, and the run keeps
// showing progress instead of spitting everything out at the end.
const feitos = new Array(trabalhos.length)
let aImprimir = 0
function escoar() {
  while (aImprimir < trabalhos.length && feitos[aImprimir] !== undefined) {
    imprimirCaso(trabalhos[aImprimir], feitos[aImprimir])
    aImprimir++
  }
}

// The template is the one thing the whole run depends on before it starts. If it
// does not come up — git missing from PATH, tmpdir without permission — this has
// to exit 2, and not die with a stack trace: the serial version gave one
// "MALFORMED" per case and exit 2 in that scenario, and the exit code cannot
// change because of the pool.
try {
  await prepararMolde()
} catch (e) {
  morrer(`could not prepare the git template in ${tmpdir()}: ${e.message}`)
}

// The pool: TETO workers sharing one queue by index. No `Promise.all` over the
// whole list — one git per side of every case fighting over the same disk makes
// the run SLOWER, besides keeping every fixture assembled at once.
let proximo = 0
await Promise.all(
  Array.from({ length: Math.min(TETO, trabalhos.length) }, async () => {
    for (;;) {
      const i = proximo++
      if (i >= trabalhos.length) return
      const { caso } = trabalhos[i]
      // `null` marks "no side was run" and is still different from `undefined`,
      // which is what the drain uses to know the index has not arrived.
      feitos[i] = caso.erros.length ? null : await provarCaso(caso)
      escoar()
    }
  }),
)
escoar()

// A sweep instead of `apagar(MOLDE_GIT.raiz)`: the template is only one of this
// run's folders, and the sweep catches it and any side whose `rm` failed.
await varrerRestos()

const total = ids.length
const placar = `${bateram} of ${total} case(s) matched`
console.log(
  `\n  ${bateram === total ? c.verde(placar) : c.vermelho(placar)}` +
    (divergiram ? c.vermelho(`  ·  ${divergiram} diverged`) : '') +
    (quebrados ? c.amarelo(`  ·  ${quebrados} with index.mjs BROKEN`) : '') +
    (malformados ? c.amarelo(`  ·  ${malformados} malformed`) : ''),
)
// Its own line, and not one more count on the line above: when the checker is
// broken the case scoreboard means nothing, and the reader has to see that before
// drawing any conclusion about the rules.
if (quebrados) {
  console.log(
    c.amarelo(
      `  ⚠ the instrument is bent: index.mjs broke on ${quebrados} case(s). ` +
        'No verdict from this run holds about any rule.',
    ),
  )
}

// Coverage only informs. Making it bring the exit code down would leave the suite
// red until the 19th rule got a case, and a suite that is born red nobody looks at.
//
// ─── WHAT CHANGED ON 02/09, and why the line got a ⚠ ─────────────────────────
//
// The sentence above still holds for the EXIT CODE. What did not hold was the
// channel: the line came out in `c.fraco` — grey, with no mark at all — and the
// `proofs` step of `verify.config.mjs` did not declare `avisar`. Chaining the two
// together, the executor discards the stdout of every step that PASSES (it is
// HOLE 4, written at the top of verify.mjs), so "a rule with no proof" was
// invisible at the gate: whoever added the 23rd rule with no case saw the gate's
// green `13 of 13` and nothing else, violating the mother rule of the repository
// — the one that says a new rule is born with the two cases — without a line on
// screen.
//
// Today it is 22 of 22, so this changes nothing in the output of now; it changes
// on the day someone leans on it. The line only gets a ⚠ when there is a hole:
// painting a complete coverage yellow would teach people to ignore the yellow.
//
// WHY IT STILL DOES NOT BLOCK. Blocking is one line (`sem.length` in the exit),
// and it is defensible — but it would be a NEW gate, and a new gate is born with
// the two cases. Proving it requires running this file against a controlled tree
// of cases. When this note was written `CASOS` was fixed at `join(AQUI, 'cases')`
// with no way to inject one; the `--cases=<dir>` at the top has since arrived —
// it is what makes this suite serve the security module today and the projects
// the generator creates tomorrow. So the case is writable now. It is still not
// written, and until it is, this line informs and does not block.
if (regras && !soEste) {
  const sem = regras.filter((r) => !provadas.includes(r))
  const placar = `${regras.length - sem.length} of ${regras.length} rules with a proof`
  if (sem.length) {
    console.log(
      c.amarelo(`  ⚠ ${placar}  ·  no proof: ${sem.join(', ')}`) +
        c.amarelo('\n  ⚠ a rule without the two cases is a rule nobody proved fails.'),
    )
  } else {
    console.log(c.fraco(`  ${placar}`))
  }
}

console.log('')
if (malformados) process.exit(2)
process.exit(divergiram || quebrados ? 1 : 0)
