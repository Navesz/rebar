#!/usr/bin/env node
// verify — rebar's single command. Runs the sequence declared in
// verify.config.mjs and returns ONE verdict, with output short enough to fit
// in an AI context without costing a whole read.
//
// Zero dependencies, on purpose: what checks the build cannot depend on the
// build. Runs with `node tooling/verify/verify.mjs` on any
// machine with Node >= 18 and git, before a toolchain exists.
//
// Usage:
//   node tooling/verify/verify.mjs             runs EVERYTHING
//   node tooling/verify/verify.mjs --json      machine output
//   node tooling/verify/verify.mjs --step=X   diagnostic slice
//   node tooling/verify/verify.mjs --config=<path>
//
// EXIT CODES — five different things, five different codes:
//   0    every step ran and every step passed. PASSED exists only here.
//   1    FAILED: a step ran to the end and said no.
//   2    configuration error, or wrong invocation.
//   3    PARTIAL: ran a slice (--step=). Not a pass.
//   127  BROKE: a step could not be EXECUTED — missing command, spawn
//        failure, timeout. Defect of the tooling, not of the repository.
//
// The distinction between 1 and 127 is the same one rebar-check makes: without
// it, the verifier's bug goes on the bill as if it were a defect of the audited
// repository.
//
// ─── THE TWO DOORS THE FOUNDATION LEFT UNLOCKED, locked here ───
//
// HOLE 1 — the `opcional` field. In the foundation the decision to fail was
// `resultados.some(r => !r.ok && !r.opcional && !r.pulado)`. Consequence: a
// step with `opcional:true` that FAILED printed "VERIFY — PASSED" and exited
// 0. One word turned any gate into a green warning. Here `opcional` is not
// ignored: it is a CONFIGURATION ERROR (exit 2), refused by name in
// validarPassos(). A step that must not block is not a step of verify.
//
// HOLE 2 — `--step=<name>`. Measured in the foundation: `node verificar.mjs
// --step=links` printed "VERIFY — PASSED", exit 0, having run 1 of 6
// steps, without a word about the 5 that did not run. Any CI goes green for
// free. Here the slice prints "PARTIAL — 1 of N steps · NOT A PASS",
// names who did not run, and exits 3. A pass exists only when the whole
// denominator ran.
//
// Third door, shut at birth: there is no abort-on-first-error. Skipping a step
// is the mechanic that produces a false green; here every selected step always
// runs to the end. The config's cheap-before-expensive order still holds — it
// decides which failure is reported as "fix this first".
//
// HOLE 3 — the config forgery. Audit of 2026-08-30: I wrote into
// $TEMP/forja.config.mjs six steps with `funcao: () => ({ codigo: 0 })` and ran
// `verify.mjs --config=$TEMP/forja.config.mjs`. Output: "VERIFY — PASSED
// 6 of 6 steps · 1 ms", exit 0 — byte-indistinguishable from a real pass,
// because NO field, neither in the text nor in --json, said which config had
// run. Two locks here: (1) the config path and the resolved root are ALWAYS
// printed, in every output, passed or not; (2) a config that is not a file
// tracked inside git's working tree becomes EXTERNAL CONFIG and never
// exits 0 — it falls to 3, the same logic as PARTIAL. An empty `--config=`,
// which used to fall silently into the automatic search, is now exit 2.
//
// HOLE 4 — the gate muted the one channel that denounces bypass. `extrairErros`
// only ran when the step did NOT pass, so the stdout of a passing step was
// discarded whole — including rebar-check's "⚠ N arquivo(s) escondidos por
// .rebarignore" lines [N file(s) hidden by .rebarignore — quoted verbatim
// because that is the literal rebar-check prints, and it still prints it in
// Portuguese], which are exactly the warning that someone hid a file
// from the ruler. Hence the `avisar` field: one RegExp per step, extracted
// and printed EVEN when the step passes, in a "warnings" section below the
// scoreboard.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const LIMITE_LINHAS_PADRAO = 6
const LARGURA_MAXIMA_LINHA = 160
const TEMPO_LIMITE_PADRAO = 5 * 60 * 1000

// ── invocation ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
// `?.slice()` returned '' for `--config=`, and '' is falsy: the runner fell
// into the automatic search and ran ANOTHER config without saying so. Whether
// the flag is present and what its value is are two different questions, so
// they are two variables.
const argConfig = args.find((a) => a.startsWith('--config='))
const opcoes = {
  json: args.includes('--json'),
  passo: args.find((a) => a.startsWith('--step='))?.slice('--step='.length),
  config: argConfig === undefined ? undefined : argConfig.slice('--config='.length),
}

const cor = process.stdout.isTTY && !process.env.NO_COLOR && !opcoes.json
const c = {
  verde: (s) => (cor ? `\x1b[32m${s}\x1b[0m` : s),
  vermelho: (s) => (cor ? `\x1b[31m${s}\x1b[0m` : s),
  amarelo: (s) => (cor ? `\x1b[33m${s}\x1b[0m` : s),
  cinza: (s) => (cor ? `\x1b[90m${s}\x1b[0m` : s),
  forte: (s) => (cor ? `\x1b[1m${s}\x1b[0m` : s),
}

class ErroDeConfiguracao extends Error {}

// Separate from ErroDeConfiguracao because the exit code is another one, and
// the difference matters: a crooked config is exit 2 ("fix the invocation"); a
// tampered config is exit 1, a FAIL of the repository — someone hid a change
// from git.
class ErroDeIntegridade extends Error {}

// A positional argument silently ignored is how you ask for one thing and get
// another with exit 0. Here anything outside the vocabulary exits 2.
//
// `step=` AND NOT `passo=`, AND THE MISMATCH WAS THE DEFECT THIS COMMENT EXISTS
// TO PREVENT, sitting three lines above itself. The reader above takes
// `--step=`; this list took `--passo=`, left over from the rename. So
// `--step=self` — the form the usage line below ADVERTISES — exited 2, while
// `--passo=self` passed the gate, was never read, and ran the whole suite in
// silence with exit 0. Asking for one step and getting twenty-three of them is
// cheap; the expensive version is the same thing in the other direction.
const desconhecidos = args.filter((a) => !/^--(json|step=|config=)/.test(a))
if (desconhecidos.length) {
  console.error(`\n${c.vermelho('VERIFY — WRONG INVOCATION')}\n`)
  console.error(`  I do not recognize: ${desconhecidos.join(', ')}`)
  console.error(`  I accept: --json · --step=<name> · --config=<path>\n`)
  process.exit(2)
}

// ── configuration ───────────────────────────────────────────────────────────

const CHAVES_VALIDAS = new Set([
  'nome',
  'comando',
  'funcao',
  'dica',
  'extrair',
  'limite',
  'tempoLimite',
  'exige',
  'avisar',
])

// git is the only judge of "this file belongs to this repository". Silent
// because every failure here (git missing, directory outside a repository,
// file not tracked) means the same thing to the caller: the provenance could
// not be proven. The caller decides what to do with the null.
function gitSilencioso(argumentos, cwd) {
  try {
    const saida = execFileSync('git', argumentos, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return saida.trim()
  } catch {
    return null
  }
}

// On Windows the tmpdir usually comes as an 8.3 name (C:\Users\LEONA~1\...)
// while git returns the long name. Comparing the two forms gives "outside the
// root" for a path that is inside. realpathSync normalizes both ends; if the
// path no longer exists, the raw resolve is enough.
function caminhoReal(p) {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

// The repository of verificar.mjs ITSELF, resolved from the script's directory
// and never from the cwd — same reason as instalar.mjs: running from inside
// another clone cannot change which repository is at stake.
const DIRETORIO_DESTE_SCRIPT = dirname(fileURLToPath(import.meta.url))

function topoGit(dir) {
  const bruto = gitSilencioso(['rev-parse', '--show-toplevel'], dir)
  // git returns forward slashes even on Windows; resolve() puts it in the OS's
  // own format.
  return bruto === null ? null : caminhoReal(resolve(bruto))
}

function mesmoCaminho(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Proof that the ruler came from the repository the ruler says it verifies.
 *
 * Three conditions, and none of them is spare. I audited the first two alone
 * and both leak: "being inside a git working tree" falls to a `git init` in
 * $TEMP, and "being tracked" falls to a `git add` + `git commit` in that same
 * fake repository — measured, the forgery went back to printing "PASSED 8 of 8
 * · exit 0". The condition that closes it is the third: the config's root has
 * to be the SAME root as the verificar.mjs that is executing. The attacker's
 * forged commit is reviewable, yes — only in a history nobody on this project
 * reads.
 */
function procedenciaDoConfig(arquivo) {
  const topo = topoGit(dirname(arquivo))
  if (topo === null) {
    return { raizGit: null, externo: true, motivo: 'it is not inside a git working tree' }
  }
  const real = caminhoReal(arquivo)
  const dentro =
    process.platform === 'win32'
      ? real.toLowerCase().startsWith(topo.toLowerCase() + sep)
      : real.startsWith(topo + sep)
  if (!dentro) {
    return { raizGit: topo, externo: true, motivo: `it is outside the git root (${topo})` }
  }

  const topoDoScript = topoGit(DIRETORIO_DESTE_SCRIPT)
  if (topoDoScript === null) {
    return {
      raizGit: topo,
      externo: true,
      motivo: "I could not find verificar.mjs's own repository to compare against",
    }
  }
  if (!mesmoCaminho(topo, topoDoScript)) {
    return {
      raizGit: topo,
      externo: true,
      motivo: `it comes from another repository (${topo}); this verificar.mjs belongs to ${topoDoScript}`,
    }
  }

  const rel = relative(topo, real).split(sep).join('/')
  if (gitSilencioso(['ls-files', '--error-unmatch', '--', rel], topo) === null) {
    return { raizGit: topo, externo: true, motivo: `"${rel}" is not tracked by this repository` }
  }
  return { raizGit: topo, externo: false, motivo: null, rel }
}

/**
 * The config's integrity, and why this check lives HERE and not in a step.
 *
 * I first tried putting it in verify.config.mjs's `higiene` step. Measured in
 * the test clone: `git update-index --skip-worktree verify.config.mjs` +
 * rewriting the file with eight steps `() => ({codigo:0})` ⇒ "PASSED 8 of 8
 * · exit 0". Obvious in hindsight — the step that would detect the swap is
 * declared by the swapped file. A ruler does not check itself when the ruler is
 * the piece that was replaced. So the one who checks the config is the runner,
 * before believing a single line of it.
 *
 * What THIS does not cover, and it is honest to say so: whoever can rewrite
 * verificar.mjs deletes this function. Against that one the defense is not
 * code — it is the file being in HEAD, going through review, and the config
 * path showing up printed on every run.
 */
function integridadeDoConfig(topo, rel) {
  // 1 — the tracking bit. `git status`, `git diff` and `git diff HEAD` are all
  // blind to skip-worktree and to assume-unchanged; `ls-files -v` is the only
  // one that sees it.
  const marca = gitSilencioso(['ls-files', '-v', '--', rel], topo)
  if (marca && !marca.startsWith('H ')) {
    const letra = marca[0]
    const nome =
      letra === 'S'
        ? 'skip-worktree'
        : letra >= 'a' && letra <= 'z'
          ? 'assume-unchanged'
          : `index state "${letra}"`
    return {
      adulterado: true,
      motivo:
        `${rel} is marked as ${nome} in the index: git stopped looking at the disk ` +
        `for this file, so status and diff lie about it.\n` +
        `  Undo it: git update-index --no-skip-worktree --no-assume-unchanged ${rel}`,
    }
  }

  // 2 — the disk against HEAD. Diverging is normal (that is what editing is).
  // Diverging WITHOUT showing up in status is the signature of tampering:
  // whoever edits in good faith shows up in status.
  const noHead = gitSilencioso(['rev-parse', `HEAD:${rel}`], topo)
  if (noHead === null) return { adulterado: false, motivo: null }
  // `hash-object` with a path applies the same clean filter as the commit (the
  // .gitattributes normalizes line endings), so it is a like-for-like comparison.
  const noDisco = gitSilencioso(['hash-object', '--', rel], topo)
  if (noDisco === null || noDisco === noHead) return { adulterado: false, motivo: null }
  const visivel = gitSilencioso(['status', '--porcelain', '--', rel], topo)
  if (visivel) return { adulterado: false, motivo: null }
  return {
    adulterado: true,
    motivo:
      `${rel} on disk (${noDisco.slice(0, 12)}) differs from HEAD (${noHead.slice(0, 12)}) ` +
      `and does NOT appear in git status. A change invisible to status is not editing, it is hiding.`,
  }
}

function auditarConfig(arquivo) {
  const p = procedenciaDoConfig(arquivo)
  if (p.externo) return { ...p, adulterado: false, motivoAdulteracao: null }
  const i = integridadeDoConfig(p.raizGit, p.rel)
  return { ...p, adulterado: i.adulterado, motivoAdulteracao: i.motivo }
}

async function carregarConfig() {
  let arquivo
  if (opcoes.config !== undefined) {
    // `--config=` with no value is not "use the default": it is half a command.
    // Accepting it as the default was a way to run one config and believe you
    // ran another.
    if (opcoes.config.trim() === '') {
      throw new ErroDeConfiguracao('--config= came in empty. Pass a path or drop the flag.')
    }
    arquivo = resolve(process.cwd(), opcoes.config)
    if (!existsSync(arquivo)) {
      throw new ErroDeConfiguracao(
        `--config=${opcoes.config} does not exist (I looked in ${arquivo}).`,
      )
    }
  } else {
    // Walks up the tree until it finds one. Running from inside tooling/ is
    // common and cannot change the verdict: the steps' commands are relative to
    // the root, and the root becomes the config's folder, not the caller's cwd.
    let dir = process.cwd()
    for (;;) {
      const tentativa = join(dir, 'verify.config.mjs')
      if (existsSync(tentativa)) {
        arquivo = tentativa
        break
      }
      const pai = dirname(dir)
      if (pai === dir) break
      dir = pai
    }
    if (!arquivo) {
      throw new ErroDeConfiguracao(
        `No verify.config.mjs from ${process.cwd()} up to the root of the disk.`,
      )
    }
  }

  // The audit comes BEFORE the import, not after: `import` executes the top of
  // the module. A tampered config does not run a single line — not even to be
  // failed afterwards.
  const procedencia = auditarConfig(arquivo)
  if (procedencia.adulterado) {
    throw new ErroDeIntegridade(`${arquivo}\n\n  ${procedencia.motivoAdulteracao}`)
  }

  let modulo
  try {
    modulo = await import(pathToFileURL(arquivo).href)
  } catch (e) {
    throw new ErroDeConfiguracao(`${arquivo} did not load:\n  ${e.message}`)
  }
  const passos = modulo.default
  if (!Array.isArray(passos) || passos.length === 0) {
    throw new ErroDeConfiguracao(
      `${arquivo} has to export a non-empty array of steps as its default.`,
    )
  }
  return { passos, arquivo, raiz: dirname(arquivo), procedencia }
}

function validarPassos(passos, arquivo) {
  const problemas = []
  const nomes = new Set()

  passos.forEach((p, i) => {
    const onde = `step #${i + 1}${p?.nome ? ` (${p.nome})` : ''}`
    if (typeof p !== 'object' || p === null) {
      problemas.push(`${onde}: is not an object.`)
      return
    }

    // HOLE 1. The check is by the key's NAME, before anything else, because the
    // goal is not to ignore the field — it is to stop someone from writing it
    // thinking it works and walking out of here with a gate switched off and
    // green.
    if ('opcional' in p) {
      problemas.push(
        `${onde}: the "opcional" field does not exist in rebar. In the foundation it made a ` +
          `step FAIL and still print PASSED with exit 0. A step that does not ` +
          `block is not a step of verify: take it off the list.`,
      )
    }
    if ('pulado' in p || 'grupo' in p) {
      problemas.push(`${onde}: "pulado"/"grupo" do not exist — every selected step always runs.`)
    }
    for (const k of Object.keys(p)) {
      if (!CHAVES_VALIDAS.has(k) && k !== 'opcional' && k !== 'pulado' && k !== 'grupo') {
        problemas.push(`${onde}: unknown key "${k}". Valid: ${[...CHAVES_VALIDAS].join(', ')}.`)
      }
    }

    if (typeof p.nome !== 'string' || !/^[a-z][a-z0-9-]*$/.test(p.nome)) {
      problemas.push(`${onde}: "nome" has to be lowercase, no spaces (e.g. "sintaxe").`)
    } else if (nomes.has(p.nome)) {
      problemas.push(`${onde}: repeated name — "--step=${p.nome}" would be ambiguous.`)
    } else {
      nomes.add(p.nome)
    }

    const temComando = 'comando' in p
    const temFuncao = 'funcao' in p
    if (temComando === temFuncao) {
      problemas.push(`${onde}: declare "comando" (array) OR "funcao", exactly one of the two.`)
    }
    if (temComando) {
      // Array, never a string: a string demands a shell, and the shell on
      // Windows is cmd.exe with quoting rules of its own. It was
      // execFileSync('npx', ...) without shell:true that broke the foundation
      // on this machine. With no shell there is nothing to escape.
      if (
        !Array.isArray(p.comando) ||
        p.comando.length === 0 ||
        p.comando.some((a) => typeof a !== 'string' || a.length === 0)
      ) {
        problemas.push(
          `${onde}: "comando" has to be an array of non-empty strings, e.g. [process.execPath, "x.mjs"].`,
        )
      }
    }
    if (temFuncao && typeof p.funcao !== 'function') {
      problemas.push(`${onde}: "funcao" has to be a function.`)
    }
    for (const k of ['extrair', 'avisar']) {
      if (k in p && !(p[k] instanceof RegExp)) problemas.push(`${onde}: "${k}" has to be a RegExp.`)
    }
    if ('exige' in p && (!Array.isArray(p.exige) || p.exige.some((a) => typeof a !== 'string'))) {
      problemas.push(`${onde}: "exige" has to be an array of paths relative to the root.`)
    }
    for (const k of ['limite', 'tempoLimite']) {
      if (k in p && (!Number.isInteger(p[k]) || p[k] <= 0)) {
        problemas.push(`${onde}: "${k}" has to be a positive integer.`)
      }
    }
    if ('dica' in p && typeof p.dica !== 'string')
      problemas.push(`${onde}: "dica" has to be a string.`)
  })

  if (problemas.length) {
    throw new ErroDeConfiguracao(`${arquivo}\n\n  ` + problemas.join('\n  '))
  }
}

// ── execution ───────────────────────────────────────────────────────────────
//
// Three possible outcomes per step, and they are NOT the same thing:
//   { estado: 'passou'   }   ran to the end and returned 0
//   { estado: 'reprovou' }   ran to the end and returned != 0
//   { estado: 'quebrou'  }   never got as far as a verdict

function executarComando(passo, raiz) {
  return new Promise((resolvePromessa) => {
    const inicio = Date.now()
    const tempoLimite = passo.tempoLimite ?? TEMPO_LIMITE_PADRAO
    let filho
    try {
      filho = spawn(passo.comando[0], passo.comando.slice(1), {
        cwd: raiz,
        // Plenty of tools decorate their output when they see a TTY, and the
        // decoration gets in the way of extraction. Here the output is always
        // captured, always raw.
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (e) {
      resolvePromessa({ estado: 'quebrou', saida: `failed to start: ${e.message}`, duracaoMs: 0 })
      return
    }

    let saida = ''
    // Tools that dump megabytes exist. 1 MB is already more than enough to
    // extract the first error lines.
    const acumular = (pedaco) => {
      if (saida.length < 1_000_000) saida += String(pedaco)
    }
    filho.stdout.on('data', acumular)
    filho.stderr.on('data', acumular)

    let encerrado = false
    const relogio = setTimeout(() => {
      if (encerrado) return
      encerrado = true
      filho.kill('SIGKILL')
      resolvePromessa({
        estado: 'quebrou',
        saida: `${saida}\n[verify] timeout of ${tempoLimite} ms blown — step killed with no verdict`,
        duracaoMs: Date.now() - inicio,
      })
    }, tempoLimite)
    relogio.unref()

    filho.on('error', (e) => {
      if (encerrado) return
      encerrado = true
      clearTimeout(relogio)
      // ENOENT here is the executable not existing. That is a defect of the
      // tooling, never "the repository failed".
      resolvePromessa({
        estado: 'quebrou',
        saida: `${saida}\n[verify] failed to run ${passo.comando[0]}: ${e.message}`,
        duracaoMs: Date.now() - inicio,
      })
    })

    filho.on('close', (codigo, sinal) => {
      if (encerrado) return
      encerrado = true
      clearTimeout(relogio)

      // Killed by a signal has no verdict: `codigo` comes in null and used to
      // become 1, that is, "the repository failed". A step knocked down by
      // running out of memory is not the repository saying no.
      if (codigo === null) {
        resolvePromessa({
          estado: 'quebrou',
          saida: `${saida}\n[verify] step killed by signal ${sinal} — no verdict`,
          duracaoMs: Date.now() - inicio,
        })
        return
      }

      resolvePromessa({
        estado: estadoDoCodigo(codigo),
        codigo,
        saida,
        duracaoMs: Date.now() - inicio,
      })
    })
  })
}

/**
 * A step's exit code, translated into the verdict.
 *
 * It exists once only because the two runners -- subprocess and function -- have
 * to answer the same, and until 2026-09-06 neither answered right: both read
 * "different from zero" as "failed", which erases the distinction this file's
 * header declares on lines 17-26.
 *
 * 2 and 127 are the RULER breaking, not the repository saying no:
 *
 *   127  the command does not exist, or the interpreter did not come up
 *   2    wrong invocation, or a crooked repository state -- `checarSintaxe`
 *        returns 2 when git's index lists a file that is not on disk, and its
 *        comment already said "the runner does not treat this as a content
 *        failure". The runner did treat it that way; now it does not.
 *
 * The difference is not cosmetic: `quebrou` exits 127 and `reprovou` exits 1,
 * and the house rule is that 127 dominates 1 -- you do not accuse a repository
 * with a ruler that broke.
 */
function estadoDoCodigo(codigo) {
  if (codigo === 0) return 'passou'
  if (codigo === 2 || codigo === 127) return 'quebrou'
  return 'reprovou'
}

async function executarFuncao(passo, raiz) {
  const inicio = Date.now()
  const tempoLimite = passo.tempoLimite ?? TEMPO_LIMITE_PADRAO
  const prazo = inicio + tempoLimite

  // The clock only fires if the function hands control back to the event loop.
  // A function that blocks (execFileSync in a loop, which is the case of the
  // `sintaxe` step) has to consult `prazo` itself — that is why it goes in the
  // argument.
  const relogio = new Promise((res) => {
    const t = setTimeout(
      () =>
        res({
          estado: 'quebrou',
          saida: `[verify] timeout of ${tempoLimite} ms blown`,
        }),
      tempoLimite,
    )
    t.unref()
  })

  const trabalho = (async () => {
    try {
      const r = await passo.funcao({ raiz, prazo })

      // AN ABSENT VERDICT IS A BREAK, not a pass. It was `Number(r?.codigo ?? 0)`:
      // a function that returned `undefined`, `null`, `{}` or forgot the field
      // came out with code 0 and the step PASSED. A mute step turning into a
      // passed step is the cheapest form of false gate -- and the hardest to
      // notice, because the scoreboard stays green.
      const codigo = Number.isInteger(r?.codigo) ? r.codigo : Number(r?.codigo)
      if (!Number.isInteger(codigo)) {
        return {
          estado: 'quebrou',
          saida:
            `[verify] the step's function returned no verdict: ` +
            `expected { codigo: <integer> }, got ${JSON.stringify(r) ?? String(r)}`,
        }
      }

      return { estado: estadoDoCodigo(codigo), codigo, saida: String(r?.saida ?? '') }
    } catch (e) {
      return { estado: 'quebrou', saida: `[verify] the step's function threw: ${e.message}` }
    }
  })()

  const r = await Promise.race([trabalho, relogio])
  return { ...r, duracaoMs: Date.now() - inicio }
}

async function executar(passo, raiz) {
  for (const rel of passo.exige ?? []) {
    const alvo = isAbsolute(rel) ? rel : join(raiz, rel)
    if (!existsSync(alvo)) {
      // A missing script is not the repository failing: it is the tooling
      // missing.
      return {
        estado: 'quebrou',
        saida: `[verify] required file missing: ${rel}`,
        duracaoMs: 0,
      }
    }
  }
  return passo.comando ? executarComando(passo, raiz) : executarFuncao(passo, raiz)
}

// ── error extraction ────────────────────────────────────────────────────────

// The difference between 300 and 15 thousand tokens per fix cycle is here. A
// tool that fails by dumping 400 lines of stack trace costs a whole context
// read; the same 6 right lines cost almost nothing.
//
// The Portuguese alternatives (`erro`, `falhou`) stay: this pattern is matched
// against the output of the tools the gate runs, and those still print in
// Portuguese. Translating them blinds the extractor.
const PADRAO_ERRO = /(^|\s)(error|erro|✗|✘|⚠|FAIL|failed|falhou)\b|error TS\d+|:\d+:\d+/i

// A RegExp with the /g flag carries lastIndex between .test() calls, which
// makes the filter match every other line. Since the regexes come from the
// config and the author has no reason to know that, the copy without /g is made
// here instead of refusing the flag.
function semGlobal(re) {
  return re.flags.includes('g') ? new RegExp(re.source, re.flags.replace(/g/g, '')) : re
}

function linhasUteis(saida) {
  return String(saida)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0)
}

function encurtar(l) {
  return l.length > LARGURA_MAXIMA_LINHA ? `${l.slice(0, LARGURA_MAXIMA_LINHA - 1)}…` : l
}

// HOLE 4. Runs for EVERY step, including the one that passed: a warning is only
// any use if it shows up precisely when nothing else is shouting.
function extrairAvisos(passo, saida) {
  if (!passo.avisar) return []
  const re = semGlobal(passo.avisar)
  const unicas = [
    ...new Set(
      linhasUteis(saida)
        .filter((l) => re.test(l))
        .map((l) => l.trim()),
    ),
  ]
  return unicas.slice(0, passo.limite ?? LIMITE_LINHAS_PADRAO).map(encurtar)
}

function extrairErros(passo, saida) {
  const linhas = linhasUteis(saida)

  const re = passo.extrair ? semGlobal(passo.extrair) : null
  let candidatas = re ? linhas.filter((l) => re.test(l)) : linhas.filter((l) => PADRAO_ERRO.test(l))

  // With no pattern recognized, the last lines are usually the tool's summary —
  // more useful than the first ones, which are banner.
  if (candidatas.length === 0) candidatas = linhas.slice(-LIMITE_LINHAS_PADRAO)

  const unicas = [...new Set(candidatas.map((l) => l.trim()))]
  const limite = passo.limite ?? LIMITE_LINHAS_PADRAO
  return { total: unicas.length, mostradas: unicas.slice(0, limite).map(encurtar) }
}

// ── report ──────────────────────────────────────────────────────────────────

function duracao(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

function relatar(veredito) {
  const { resultados, naoRodaram, parcial, declarados, duracaoMs, arquivo, raiz, procedencia } =
    veredito
  const quebrados = resultados.filter((r) => r.estado === 'quebrou')
  const reprovados = resultados.filter((r) => r.estado === 'reprovou')
  const aprovados = resultados.filter((r) => r.estado === 'passou')

  let titulo
  if (quebrados.length) titulo = c.amarelo('BROKE')
  else if (reprovados.length) titulo = c.vermelho('FAILED')
  else if (procedencia.externo) titulo = c.amarelo('EXTERNAL CONFIG')
  else if (parcial) titulo = c.amarelo('PARTIAL')
  else titulo = c.verde('PASSED')

  const placar = `${resultados.length} of ${declarados} steps`
  console.log(`\n${c.forte('VERIFY')} — ${titulo}  ${c.cinza(`${placar} · ${duracao(duracaoMs)}`)}`)

  // HOLE 3: without these two lines, "PASSED 6 of 6" from a config forged in
  // $TEMP is byte-for-byte identical to one from a real config. Printed
  // ALWAYS — a field that only shows up when there is a problem is a field
  // nobody learns to read.
  console.log(`  ${c.cinza('config')}  ${arquivo}`)
  console.log(`  ${c.cinza('root')}    ${raiz}`)

  if (procedencia.externo) {
    console.log(
      `\n  ${c.amarelo(c.forte('EXTERNAL CONFIG'))} — ${procedencia.motivo}. ${c.forte('NOT A PASS.')}`,
    )
    console.log(
      `  ${c.cinza('the steps ran, but whoever wrote the ruler is not under review in this repository.')}`,
    )
  }

  // HOLE 2: the line the foundation did not print. It comes BEFORE the details
  // because it is the information that changes how everything after it reads.
  if (parcial) {
    console.log(
      `\n  ${c.amarelo(c.forte(`PARTIAL — ${resultados.length} of ${declarados} steps. NOT A PASS.`))}`,
    )
    console.log(`  ${c.cinza(`did not run (${naoRodaram.length}): ${naoRodaram.join(' · ')}`)}`)
    console.log(
      `  ${c.cinza('a slice is for fixing, not for clearing. Run without --step= before committing.')}`,
    )
  }
  console.log('')

  for (const r of [...quebrados, ...reprovados]) {
    const marca = r.estado === 'quebrou' ? c.amarelo('⚠') : c.vermelho('✗')
    const rotulo =
      r.estado === 'quebrou'
        ? c.amarelo('DID NOT RUN')
        : r.erros.total === 1
          ? '1 error'
          : `${r.erros.total} errors`
    console.log(`  ${marca} ${r.nome.padEnd(10)} ${rotulo}  ${c.cinza(duracao(r.duracaoMs))}`)
    for (const linha of r.erros.mostradas) console.log(`      ${linha}`)
    if (r.erros.total > r.erros.mostradas.length) {
      console.log(
        c.cinza(
          `      … ${r.erros.total - r.erros.mostradas.length} more · node tooling/verify/verify.mjs --step=${r.nome}`,
        ),
      )
    }
    console.log('')
  }

  if (aprovados.length)
    console.log(`  ${c.verde('✓')} ${aprovados.map((r) => r.nome).join(' · ')}\n`)

  // HOLE 4: a section of its own, below the scoreboard, fed also by the steps
  // that PASSED. This is how "⚠ N arquivo(s) escondidos por .rebarignore" [N
  // file(s) hidden by .rebarignore — rebar-check's literal, still Portuguese]
  // reaches the reader — before, the stdout of a passing step was discarded
  // whole.
  const comAviso = resultados.filter((r) => r.avisos.length)
  if (comAviso.length) {
    const n = comAviso.reduce((s, r) => s + r.avisos.length, 0)
    console.log(
      `  ${c.amarelo(c.forte(`warnings (${n})`))} ${c.cinza('— they do not fail, but they are real')}`,
    )
    for (const r of comAviso) {
      for (const linha of r.avisos) console.log(`      ${c.cinza(r.nome.padEnd(8))} ${linha}`)
    }
    console.log('')
  }

  // The config declares from cheapest to most expensive, so the first one in
  // the order that fell is the one to fix first — and fixing it usually erases
  // the ones below.
  const primeiro = resultados.find((r) => r.estado !== 'passou')
  if (primeiro) {
    const restantes = resultados.filter((r) => r.estado !== 'passou').length - 1
    console.log(
      `  ${c.forte('First:')} ${primeiro.nome}.${primeiro.dica ? ` ${primeiro.dica}` : ''}`,
    )
    if (restantes === 1) console.log(c.cinza('  The other one may go with it.'))
    else if (restantes > 1) console.log(c.cinza(`  The other ${restantes} may go with it.`))
    console.log('')
  }
}

// ── main ────────────────────────────────────────────────────────────────────

async function principal() {
  const { passos, arquivo, raiz, procedencia } = await carregarConfig()
  validarPassos(passos, arquivo)

  const selecionados = opcoes.passo ? passos.filter((p) => p.nome === opcoes.passo) : passos
  if (opcoes.passo && selecionados.length === 0) {
    throw new ErroDeConfiguracao(
      `Step "${opcoes.passo}" does not exist in ${arquivo}.\n  ` +
        `Available: ${passos.map((p) => p.nome).join(', ')}`,
    )
  }
  const parcial = selecionados.length !== passos.length
  const naoRodaram = passos.filter((p) => !selecionados.includes(p)).map((p) => p.nome)

  const resultados = []
  const inicio = Date.now()
  for (const passo of selecionados) {
    // Progress only in a terminal: in a CI log the \r erases nothing and the
    // lines pile up, dirtying exactly the output this script exists to shorten.
    const mostrar = !opcoes.json && process.stdout.isTTY
    if (mostrar) process.stdout.write(c.cinza(`  … ${passo.nome}\r`))
    const r = await executar(passo, raiz)
    if (mostrar) process.stdout.write(`${' '.repeat(40)}\r`)
    resultados.push({
      nome: passo.nome,
      estado: r.estado,
      codigo: r.codigo ?? null,
      dica: passo.dica,
      duracaoMs: r.duracaoMs ?? 0,
      erros: r.estado === 'passou' ? { total: 0, mostradas: [] } : extrairErros(passo, r.saida),
      avisos: extrairAvisos(passo, r.saida),
    })
  }

  const veredito = {
    resultados,
    naoRodaram,
    parcial,
    declarados: passos.length,
    duracaoMs: Date.now() - inicio,
    arquivo,
    raiz,
    procedencia,
  }

  // Order of precedence, and it is not arbitrary: BROKE dominates FAILED
  // because you do not accuse a repository with a ruler that did not run.
  // FAILED dominates PARTIAL because a step that ran and said no is a real
  // verdict, and hiding it behind the 3 would lose information. PARTIAL
  // dominates the 0 always — it is HOLE 2's locked door.
  //
  // EXTERNAL CONFIG lands in the same band as PARTIAL, and for the same reason:
  // the steps may have all passed, but whoever chose the steps is not under
  // review. That does not accuse the repository (it is not 1) nor absolve it
  // (it is never 0).
  const quebrou = resultados.some((r) => r.estado === 'quebrou')
  const reprovou = resultados.some((r) => r.estado === 'reprovou')
  const externo = procedencia.externo
  const codigo = quebrou ? 127 : reprovou ? 1 : parcial || externo ? 3 : 0

  if (opcoes.json) {
    console.log(
      JSON.stringify(
        {
          resultado: quebrou
            ? 'quebrou'
            : reprovou
              ? 'reprovado'
              : externo
                ? 'config-externo'
                : parcial
                  ? 'parcial'
                  : 'aprovado',
          // HOLE 3: the consumer of --json has to be able to answer "which
          // ruler produced this verdict?" without trusting the word of whoever
          // ran it.
          config: {
            arquivo,
            raiz,
            raizGit: procedencia.raizGit,
            externo,
            motivoExterno: procedencia.motivo,
          },
          parcial,
          quando: new Date().toISOString().slice(0, 16).replace('T', ' '),
          duracaoMs: veredito.duracaoMs,
          passosDeclarados: passos.length,
          passosExecutados: resultados.length,
          naoRodaram,
          codigoSaida: codigo,
          passos: resultados.map((r) => ({
            nome: r.nome,
            estado: r.estado,
            codigo: r.codigo,
            duracaoMs: r.duracaoMs,
            totalErros: r.erros.total,
            erros: r.erros.mostradas,
            avisos: r.avisos,
          })),
        },
        null,
        2,
      ),
    )
  } else {
    relatar(veredito)
  }

  process.exitCode = codigo
}

principal().catch((e) => {
  if (e instanceof ErroDeIntegridade) {
    if (opcoes.json) {
      console.log(
        JSON.stringify(
          { resultado: 'config-adulterado', codigoSaida: 1, motivo: e.message.trim() },
          null,
          2,
        ),
      )
    } else {
      console.error(`\n${c.vermelho('VERIFY — TAMPERED CONFIG')}\n\n  ${e.message}\n`)
      console.error(
        `  ${c.cinza('no step ran: the ruler that would say all is well is the piece that was swapped.')}\n`,
      )
    }
    process.exitCode = 1
    return
  }
  const titulo = e instanceof ErroDeConfiguracao ? 'CONFIGURATION ERROR' : 'INTERNAL ERROR'
  console.error(`\n${c.vermelho(`VERIFY — ${titulo}`)}\n\n  ${e.message}\n`)
  // A broken config is never a pass nor a fail of the repository.
  process.exitCode = e instanceof ErroDeConfiguracao ? 2 : 127
})
