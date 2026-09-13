#!/usr/bin/env node
// rebar-security — the security ruler, against a repository that ALREADY EXISTS.
//
// Usage:
//   node tooling/security/index.mjs <dir>              scoreboard of a repository
//   node tooling/security/index.mjs --json <dir>       for CI
//   node tooling/security/index.mjs --rule=<id> <dir>  one rule only
//   node tooling/security/index.mjs --heuristics <dir> heuristics fail too
//
// EXIT CODES — the same as rebar-check's, and for the same reason:
//   0    everything that applies passed
//   1    failed — a real violation
//   2    invalid target or wrong invocation
//   127  BROKE: a rule threw. A defect of THIS tool, not of the target.
//
// ──────────────────────────────────────────────── where these rules came from
//
// From 16 Brazilian technical videos about security, read and distilled into
// 163 candidate flaws. Each one went through three independent skeptics — one
// asking "can this be decided without running the application?", another "in how
// many honest repositories would this fire wrong?", the third "doesn't rebar
// already check that?". 82 survived. The whole inventory is in
// `docs/security/INVENTARIO.md`, with the frequency scoreboard and — more
// important — the 8 cases that did NOT become rules.
//
// ────────────────────────────────────── the invariants, and why there are few
//
// Ten invariants came out of the repetition in the false positives the
// reporters named. Three decide almost everything, and they are written here
// because every new rule enters by proving it respects them:
//
//   I1. REPO-WIDE SCOPE, NEVER PER FILE. Whenever the predicted false positive
//       is "the defense is in another file" (middleware, policy, serializer),
//       the rule looks at the whole repository or it does not exist.
//
//   I4. `na()` BRANCH MANDATORY. Without the prerequisite — no server code, no
//       git, no manifest — the verdict is "not evaluated" and the class LEAVES
//       THE DENOMINATOR. Silence by absence never becomes "passed".
//
//   I7. A COMMENT DOES NOT COUNT. Measured in this repository with another
//       rule: 7 occurrences, ZERO true positives, five of them comments about
//       the rule itself. Every detector that contains the pattern it looks for
//       accuses itself without this guard.
//
// ─────────────────────────── the vocabulary is bilingual, and that is measured
//
// While translating this project into English I swapped `'provas'` for
// `'proofs'` in a list the checker uses to RECOGNIZE test folders in other
// people's repositories. The rule went blind, and the proof case fell on the
// spot — it said, written beforehand: "se o segmento `provas` sair do
// reconhecedor, o lado aprovar sai 1" [if the `provas` segment leaves the
// recognizer, the pass side exits 1]. The quote stays in Portuguese because it
// is verbatim from `tooling/rebar-check/proofs/cases/tests/caso.json`.
//
// The lesson counts double here: this module audits BRAZILIAN repositories. A
// password detector that looks only for `password` does not see `senha`; a
// secret detector that looks only for `secret` does not see `chave`. Every
// vocabulary list below carries both languages, and that is by measurement, not
// by symmetry.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { styleText } from 'node:util'
import { lerRepo, nota, semComentarioNemImport } from '../rebar-check/index.mjs'
import {
  CHAVES_QUE_EXECUTAM,
  VARIAVEIS_PERIGOSAS,
  checarAgentConfig,
} from './injection/agent-config.mjs'
import {
  BINARIOS_DE_AGENTE,
  FLAGS_AMBIGUAS,
  FLAGS_FORTES,
  PARES_DE_FLAG,
  checarBypass,
} from './injection/bypass.mjs'
import {
  ESCAPES_DE_CONTROLE,
  MARCADORES_DE_SERVIDOR,
  checarControlBytes,
  checarMcpAnsiEscape,
} from './injection/control.mjs'
import { EXECUTORES_REMOTOS, SINAIS_DE_SHELL, checarMcpLaunch } from './injection/mcp-launch.mjs'
import { checarHiddenUnicode } from './injection/unicode.mjs'
import { escaparSaida } from './texto-seguro.mjs'

// ─────────────────────────────────────── the prompt-injection signature tables
//
// The six injection rules keep their engines AND their pattern tables in
// `./injection/*.mjs`, one file per family, and this file only re-exports each
// table by name. Two readers depend on that
// shape: `mcp/generate.mjs` walks this module's exports for `[RegExp, string]`
// tables and hands each one to the rule whose `checar` NAMES it, so a table
// passed any other way would leave the MCP artifact without its vocabulary; and
// `tooling/security/prove-table.mjs` holds the six text tables exported here
// against this file, the family sources, the READMEs and the artifact, so none
// of them turns into a sample of what the tables hunt; the four tables that
// match parsed config keys and launch commands whole are held to that anchored
// shape, since no raw file can match them.
export { CHAVES_QUE_EXECUTAM, VARIAVEIS_PERIGOSAS } from './injection/agent-config.mjs'
export {
  BINARIOS_DE_AGENTE,
  FLAGS_AMBIGUAS,
  FLAGS_FORTES,
  PARES_DE_FLAG,
} from './injection/bypass.mjs'
export { ESCAPES_DE_CONTROLE, MARCADORES_DE_SERVIDOR } from './injection/control.mjs'
export { EXECUTORES_REMOTOS, SINAIS_DE_SHELL } from './injection/mcp-launch.mjs'

/** "Not applicable" — the third state. Out of the denominator, not the scoreboard. */
const na = (motivo) => ({ na: motivo })

const ler = (dir, rel) => {
  try {
    return readFileSync(join(dir, rel), 'utf8')
  } catch {
    return null
  }
}

/**
 * PRODUCTION code files, already without fixture, without test, without example.
 *
 * `r.fontes` comes from rebar-check and already excludes fixture and test (I5).
 * What is left here is dropping `*.example`, `*.sample`, `*.template`, `*.dist`
 * and the Portuguese equivalents — invariant I6, and it is measured debt: this
 * very repository's secret scanner produces two false positives at exactly this
 * point.
 *
 * `exemplo|modelo` stay in Portuguese ON PURPOSE. They are file names in the
 * audited repositories, which are Brazilian; translating them blinds the
 * exclusion and brings the false positive back.
 */
const EXEMPLO = /\.(example|exemplo|sample|template|dist|modelo)(\.|$)/i

/**
 * `r.fontes` arrives as `[path, text]` pairs, not as a list of paths.
 *
 * It cost the first red pair of proofs: I treated it as a list of paths, the
 * `filter` compared a regex against an array (which turns into a string with the
 * whole file inside it), and the read got the pair as if it were a path. Every
 * rule went blind in silence — `disabled-defense` said "passed" over a tree with
 * `rejectUnauthorized: false`, which is the worst possible outcome for a
 * security ruler.
 *
 * The text coming along is an advantage: no rule reopens a file, and the comment
 * is stripped only once (I7).
 */
const codigo = (r) =>
  (r.fontes || [])
    .filter(([rel]) => !EXEMPLO.test(rel))
    .map(([rel, texto]) => [rel, semComentarioNemImport(texto)])

/** For a file that is not a source — Dockerfile, settings.py, workflow. */
const corpo = (dir, rel) => {
  const t = ler(dir, rel)
  return t === null ? null : semComentarioNemImport(t)
}

// ───────────────────────────────────── the existing scanner, run and not copied
//
// `tooling/secret/scan-secret.mjs` is 900 lines of detection that was rewritten
// after an adversarial audit closed seven measured holes in it. None of that is
// re-typed here. The reuse is a SUBPROCESS, and the shape was not a choice:
// that file exports nothing and runs on import — it calls git at the top level
// and ends in `process.exit`, so `import` would scan on load and kill this
// process. Reading its `--json` is the closest thing to a single source that
// exists without touching it.
//
// The property that buys is worth more than the elegance it costs: this rule
// cannot invent a finding the hook would not have made, nor miss one the hook
// makes. Every placeholder list, every vendor prefix, the `rebar-segredo-ok:`
// escape and the seven closed holes arrive here for free and stay in one place.
//
// DEBT, written down because paying it is not this module's to pay: with the
// rules table and the line scan EXPORTED from that file, this becomes an
// `import` and one process less per evaluation. See the report.
const VARREDOR = fileURLToPath(new URL('../secret/scan-secret.mjs', import.meta.url))

/** One git call, with the target as cwd, or an exception. */
function gitAqui(dir, argumentos) {
  const r = spawnSync('git', argumentos, {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (r.error) throw new Error(`git ${argumentos.join(' ')}: ${r.error.message}`)
  if (r.status !== 0) {
    throw new Error(`git ${argumentos.join(' ')} exited ${r.status}`)
  }
  return r.stdout
}

/**
 * Runs the scanner over `dir` and gives back its `--json`.
 *
 * It THROWS on anything that is not a clean verdict, and throwing is the whole
 * point: the executor turns an exception into `quebrou`, which is exit 127, and
 * 127 dominates 1 — you do not accuse a repository with a ruler that broke. The
 * two states that ARE verdicts are exit 0 (nothing found) and exit 1 (found);
 * exit 2 is the scanner refusing the target, and that is not a fact about the
 * repository being audited.
 *
 * `stdout` and `stderr` are captured and never inherited. The proofs runner
 * reads any byte on this process's stderr as "the checker died" — inheriting the
 * scanner's summary would turn every case into `quebrou` without one line saying
 * why.
 */
function varrerSegredos(dir) {
  const r = spawnSync(process.execPath, [VARREDOR, '--json'], {
    cwd: dir,
    encoding: 'utf8',
    // The scanner caps a FILE at 8 MiB, but not the finding list: a committed
    // key file yields one finding per line. 64 MiB is room for a repository
    // that is beyond saving anyway, and an overflow here would come back as a
    // truncated JSON, which the parse below turns into `quebrou` and not into
    // a quiet "passed".
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
    windowsHide: true,
  })
  const primeiraDeErro = () =>
    String(r.stderr || '')
      .trim()
      .split('\n')
      .find((l) => l.trim()) || `exit ${r.status}`

  if (r.error) throw new Error(`could not run the secret scanner: ${r.error.message}`)
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`the secret scanner did not run here: ${primeiraDeErro()}`)
  }
  // MEASURED: a node that DIES also exits 1, exactly like a scan that FOUND
  // something, so the exit code alone cannot tell a verdict from a corpse —
  // pointing the path at a file that does not exist gave exit 1 with the module
  // error on stderr. What separates them is the JSON: a scanner that ran printed
  // one, a scanner that died printed nothing. So the parse failure carries the
  // stderr line with it, or the diagnosis is a syntax error about an empty
  // string and the reader has to go find the real cause by hand.
  let dados
  try {
    dados = JSON.parse(r.stdout)
  } catch (e) {
    throw new Error(
      `the secret scanner printed no readable JSON (${primeiraDeErro()}): ${e.message}`,
    )
  }
  if (!dados || !Array.isArray(dados.achados) || typeof dados.varridos !== 'number') {
    throw new Error('the secret scanner JSON changed shape — this rule reads it wrong now')
  }
  return dados
}

// ══════════════════════════════════════════════════════════════════════ rules

// `classe: 'determinística'` is a VALUE, not prose. It is read outside this
// file — `mcp/generate.mjs`, `mcp/src/consultas.mjs` (twice) and
// `tooling/numbers.mjs` all compare against the literal. Translate it here and
// all three rules print as heuristic, stop failing the commit, and the MCP
// scoreboard counts zero deterministic ones.
// CLOSED set. Every entry is a literal, not a heuristic.
//
// THE SECOND COLUMN IS THE EXPLANATION ALONE, and never the literal. Until
// 2026-09-07 it carried both — `'rejectUnauthorized: false — TLS without
// verifying the certificate'` — and that duplication made this rule ACCUSE
// ITS OWN TABLE: eight of the nine findings it reported against the rebar
// were these strings finding themselves.
//
// Measured, and the measurement is what points at the fix: the REGEX as
// written in the source does NOT self-match (`\s*` is not whitespace), only
// the message did. So the literal in the output comes from the MATCH now,
// which is where it should have come from all along — it is the text that
// is actually in the audited file, not a copy of it typed here.
//
// Excluding this file instead would have been the patch: a repository that
// vendored the rebar would go on accusing it.
export const DESLIGAM = [
  [/rejectUnauthorized\s*:\s*false/, 'TLS without verifying the certificate'],
  [/NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"`]?0/, 'turns TLS off for the whole process'],
  [/\bverify\s*=\s*False\b/, 'requests without verifying the certificate'],
  [/InsecureSkipVerify\s*:\s*true/, 'TLS without verifying the certificate'],
  // ASSEMBLED, not literal: this is the only pattern of the table with no `\s`
  // in the middle, so its source would carry the very text it looks for and
  // the rule would accuse this file forever. In the others the source has
  // `\s*` where real code has a space, and that is why they do not match
  // themselves.
  //
  // Same idiom as `'ghp_' + 'A1b2...'` in tooling/secret/prove-scan.mjs.
  // tooling/security/prove-table.mjs locks it.
  [new RegExp('@csrf' + '_exempt\\b'), 'route with no CSRF protection'],
  [/skip_before_action\s+:verify_authenticity_token/, 'CSRF turned off'],
  [/contentSecurityPolicy\s*:\s*false/, 'helmet without a CSP'],
  [/curl\s+(-[a-zA-Z]*k|--insecure)\b/, 'download without checking the cert'],
]

export const REGRAS = [
  // ──────────────────────────────────────────────────────────────────── S1
  {
    id: 'env-committed',
    classe: 'determinística',
    nivel: 'N5',
    titulo: 'no .env tracked by git',
    /**
     * The most common class in the whole inventory: a versioned secret shows up
     * in 7 of the 16 videos. This is its cheapest slice — a `git ls-files`.
     *
     * It is NOT the secret scanner, which already exists in `tooling/secret/`.
     * That one looks at the staged CONTENT; this one looks at the tracked NAME.
     * They are different findings: a `.env` can be tracked and empty today and
     * get the key tomorrow with nobody noticing, because the file already went
     * through review.
     *
     * False positive predicted and excluded: `.env.example`, `.env.sample`,
     * `.env.template`, `.env.dist` and `.env.exemplo` are the FIX for this flaw,
     * not the flaw. A repository that documents its variables in a tracked
     * `.env.example` is doing the right thing.
     *
     * N5 and not N1 because the fix after the commit is not deleting the file:
     * it is rotating the credential. The place to block is before the commit
     * exists.
     */
    checar: (r) => {
      const alvos = (r.arquivos || []).filter((a) => {
        const nome = basename(a)
        if (!/^\.env(\..+)?$/.test(nome)) return false
        return !EXEMPLO.test(nome)
      })
      if (!alvos.length) return null
      return (
        `${alvos.length} tracked .env file(s): ${alvos.join(', ')} — ` +
        'deleting is not enough, the secret is already in history; rotate the credential'
      )
    },
  },

  // ──────────────────────────────────────────────────────────────────── S2
  {
    id: 'disabled-defense',
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'no framework protection turned off by a literal',
    /**
     * The cheapest gap the inventory audit found, and it was not even in the
     * inventory: no video showed it, but it is the most deterministic pattern
     * there is in a repository built with AI.
     *
     * Every literal in this list is a HUMAN DECISION recorded on one line —
     * somebody turned a protection off so the demo would stop erroring, and
     * never turned it back on. There is no dataflow, no schema, no proof of
     * absence: the literal is there or it is not. That is why the false positive
     * tends to zero and the finding explains itself.
     *
     * It brings CSRF (CWE-352, third in the CWE Top 25) into the module, which
     * would otherwise be left with no rule at all.
     *
     * FALSE POSITIVE PREDICTED AND HANDLED: the very file that documents these
     * patterns — this one — would match every one of them. That is what
     * `semComentarioNemImport` solves (I7), and it is the reason the body is
     * read without comments.
     */
    checar: (r) => {
      // Source already comes with the text; config and workflow need a read.
      const config = [
        ...(r.arquivos || []).filter((a) =>
          /(^|\/)(Dockerfile|docker-compose\.ya?ml|settings\.py)$/i.test(a),
        ),
        ...(r.workflows || []),
      ]
      const alvos = [
        ...codigo(r),
        ...config.map((rel) => [rel, corpo(r.dir, rel)]).filter(([, x]) => x !== null),
      ]
      if (!alvos.length) return na('no code or configuration file')

      const achados = []
      for (const [rel, t] of alvos) {
        for (const [padrao, motivo] of DESLIGAM) {
          // THE MATCHED TEXT, and not a copy of it typed into the table. The
          // output reads as before -- `rejectUnauthorized: false — TLS without ...`
          // -- except that the literal is now what IS in the audited file, with
          // the spacing it really has.
          const casou = padrao.exec(t)
          if (casou) achados.push(`${rel}: ${casou[0].trim()} — ${motivo}`)
        }
        // DEBUG on only counts alongside an open host: `DEBUG = True` by itself
        // is the development default, and flagging it paints every settings.py.
        if (/^\s*DEBUG\s*=\s*True/m.test(t) && /ALLOWED_HOSTS\s*=\s*\[\s*['"]\*['"]/.test(t)) {
          achados.push(`${rel}: DEBUG = True with ALLOWED_HOSTS = ['*'] — debug mode exposed`)
        }
      }
      if (!achados.length) return null
      return `${achados.length} protection(s) turned off: ${achados.join(' · ')}`
    },
  },

  // ──────────────────────────────────────────────────────────────────── S3
  {
    id: 'password-without-kdf',
    classe: 'determinística',
    nivel: 'N1',
    titulo: 'password never compared in plain text nor by a fast hash',
    /**
     * Third most common class in the inventory — 4 of the 16 videos. Chosen
     * ahead of `mass-assignment`, which shows up in 5, for a cost reason: mass
     * assignment only decides severity by reading the privileged column of the
     * schema, which demands a `schema.prisma` or SQL parser. This one is textual
     * all the way through.
     *
     * TWO SIGNALS, and both need bilingual vocabulary:
     *
     *   (a) direct comparison — `u.password === req.body.password`, or the same
     *       with `senha`. If the comparison is `===`, it never went through a
     *       KDF: bcrypt, argon2 and scrypt return a hash with the salt embedded
     *       and demand `compare`.
     *
     *   (b) fast hash on an authentication path — `createHash('sha256')`,
     *       `md5`, `sha1`. Fast is the defect: what protects a password is being
     *       slow.
     *
     * FALSE POSITIVE PREDICTED AND EXCLUDED: LEGITIMATE PRE-HASH. `bcrypt`
     * silently truncates at 72 bytes, and the recommended defense is to feed a
     * sha256 of the password into bcrypt. A file that does
     * `bcrypt.hash(sha256(senha))` is RIGHT, and flagging it would punish
     * whoever knows the problem. That is why signal (b) only counts where there
     * is no slow primitive in the same file.
     */
    checar: (r) => {
      const fontes = codigo(r)
      if (!fontes.length) return na('no production code file')

      // BILINGUAL vocabulary. See the note at the top: the English-only list is
      // blind in exactly the repositories this module exists to audit. `senha`
      // stays in Portuguese because it is what the rule LOOKS FOR inside
      // third-party Brazilian code — translating it blinds the detector.
      //
      // `rebar-segredo-ok:` is not prose either: it is the escape token
      // `tooling/secret/scan-secret.mjs` matches, and renaming it voids every
      // escape already written in the audited repositories. Only the
      // justification after the colon is English — the token demands `\s*\S+`
      // after it, and it gets it.
      const SENHA = '(?:password|senha|passwd|pwd)' // rebar-segredo-ok: regex vocabulary, not a credential -- it is the list the rule LOOKS FOR
      const LENTA = /\b(bcrypt|argon2|scrypt|pbkdf2)\b/i
      const RAPIDA =
        /createHash\(\s*['"`](md5|sha1|sha256|sha512)['"`]\s*\)|hashlib\.(md5|sha1|sha256)\(/i
      const COMPARA = new RegExp(
        `${SENHA}\\s*(===|==|!==|!=)\\s*[a-zA-Z_$][\\w$.\\[\\]'"]*${SENHA}`,
        'i',
      )

      const achados = []
      let viuAuth = false
      for (const [rel, t] of fontes) {
        const falaDeSenha = new RegExp(SENHA, 'i').test(t)
        if (falaDeSenha) viuAuth = true

        if (COMPARA.test(t)) achados.push(`${rel}: password compared with === (plain text)`)
        else if (falaDeSenha && RAPIDA.test(t) && !LENTA.test(t)) {
          achados.push(`${rel}: fast hash on a password path, no bcrypt/argon2/scrypt in the file`)
        }
      }
      if (!viuAuth) return na('no code touches a password')
      if (!achados.length) return null
      return `${achados.length} occurrence(s): ${achados.join(' · ')}`
    },
  },

  // ──────────────────────────────────────────────────────────────────── S4
  {
    id: 'hardcoded-secret',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'no credential written into a file git tracks',
    /**
     * THE MEASUREMENT THAT OPENED THIS RULE. A repository was built with four
     * credentials of real shape — an AWS access key, a GitHub token, an LLM API
     * key, and the assignment of a literal to an `apiKey` constant, which is
     * the exact shape of the live one sitting in the public `Navesz/Climatic`
     * today. Both rulers were run against it:
     *
     *   rebar-security .   2 of 2, 1 not applicable, EXIT 0   — saw nothing
     *   rebar .            none of the 23 rules mentions a credential
     *
     * The detector that catches all four already existed and worked:
     * `tooling/secret/scan-secret.mjs` exited 1 with 4 findings on the same
     * tree. It was simply not a rule of either ruler — it ran only as an
     * internal step of rebar's own gate, and as the pre-commit hook of the
     * generated project.
     *
     * WHY THAT GAP IS THE WHOLE POINT, AND WHY THE LEVEL IS N4. The hook is
     * N5, and N5 is the level `docs/PLANO.md` describes as the one the agent
     * removes WITH NO DIFF AT ALL: `git commit --no-verify` and the scan never
     * happened. What the generated project's CI runs is `npm run verificar`,
     * `npx rebar .` and `npx rebar-security .` — and until this rule none of
     * the three read a single byte looking for a credential. So a secret
     * committed with `--no-verify` reached main with CI green. The mother rule
     * of the taxonomy says a rule that can go down a level must go down: N4
     * blocks the merge and survives the flag, and this rule is the same scan
     * standing there.
     *
     * IT DETECTS NOTHING OF ITS OWN. Every pattern, every placeholder list and
     * the `rebar-segredo-ok:` escape come from the scanner, run as a
     * subprocess — see the note above `VARREDOR`. Derived, never duplicated: a
     * second copy of those patterns would drift from the hook's, and then the
     * commit and the merge would disagree about what a credential is.
     */
    checar: (r) => {
      const varredura = varrerSegredos(r.dir)
      const naoLidos =
        (varredura.pulos?.truncados?.length || 0) + (varredura.pulos?.ilegiveis?.length || 0)

      // ABSENCE OF A TARGET IS `na`; ABSENCE OF INFORMATION IS NOT. A repository
      // where git tracks nothing has no credential to hide, and the class leaves
      // the denominator (I4). A repository where the scanner READ NOTHING it
      // tried to read is a different thing entirely — the measurement failed,
      // and laundering that into `na` is exactly the move that once took a
      // repository from 9 of 10 to 6 of 6. It goes out as a broken ruler.
      if (varredura.varridos === 0) {
        if (naoLidos > 0) {
          throw new Error(`read none of the ${naoLidos} tracked file(s) it tried to scan`)
        }
        return na('git tracks no file here')
      }

      // The scanner reports paths relative to the GIT ROOT it discovers from its
      // cwd; `lerRepo` reports them relative to the TARGET. The two coincide
      // only when the target is the root, which is the usual call and not the
      // only one. `--show-prefix` is the translation between the two, and
      // without it a target one folder down would be judged by findings from
      // outside itself, with paths that do not exist in it.
      const prefixo = gitAqui(r.dir, ['rev-parse', '--show-prefix']).trim()
      const noAlvo = varredura.achados
        .filter((a) => a.caminho.startsWith(prefixo))
        .map((a) => ({ ...a, caminho: a.caminho.slice(prefixo.length) }))

      // PROOF MATERIAL, BY THE MARKER THE TOOLKIT ALREADY USES — and this is the
      // false positive that decides whether the rule is usable at all. This
      // repository tracks 345 case files stuffed with credentials that are fake
      // on purpose, including the two `fail/` trees that exist to prove THIS
      // rule fails what it should. Without this filter the rule accuses the
      // proofs that keep it honest, which is the same problem `scan-secret.mjs`
      // already solved for a tracked `.env` and solved this same way.
      //
      // `r.ignorados.raizesDeProva` is not a second mechanism: it is the list of
      // `caso.json` roots `semFixtures` already VALIDATED — only under a literal
      // proof root and only with the schema —, which is strictly harder to forge
      // than "some ancestor has a caso.json". A `mkdir` plus an empty object
      // does not hide a key here.
      //
      // `.rebarignore` is deliberately NOT honoured. It is a declared bypass for
      // vendor and generated material, and style debt is not a credential: one
      // committed under an ignored prefix leaks in the clone exactly like any
      // other. The scanner refuses folder exclusions for the same reason.
      const provas = r.ignorados?.raizesDeProva || []
      const achados = noAlvo.filter((a) => !provas.some((p) => a.caminho.startsWith(p)))

      // Location and rule NAME, never the matched text. The scanner already
      // redacts what it prints because its output goes to a CI log; this one
      // goes to a CI log too, and into `--json`, and the position is enough to
      // find the line without carrying the credential one hop further.
      const onde = achados
        .slice(0, 12)
        .map((a) => `${a.caminho}:${a.linha}:${a.coluna} (${a.regra})`)
      const resto = achados.length > onde.length ? ` …and ${achados.length - onde.length} more` : ''
      const cobertura = naoLidos
        ? ` · this verdict does not cover ${naoLidos} file(s) the scanner could not read whole`
        : ''

      if (!achados.length) {
        // Passed, with a hole named. There is no fourth state and there should
        // not be one, but "I scanned everything" and "I did not read these N"
        // are two different claims and the rule was only able to make the first.
        return naoLidos
          ? {
              nota:
                `${naoLidos} file(s) scanned only in part or not at all — ` +
                'the verdict does not cover them',
            }
          : null
      }
      return (
        `${achados.length} credential(s) in tracked files: ${onde.join(' · ')}${resto}${cobertura}` +
        ' — deleting the line is not enough, what is in history has to be ROTATED'
      )
    },
  },

  // ──────────────────────────────────────────────────────────────────── S5
  {
    id: 'hidden-unicode',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'no known hidden-Unicode signature in tracked text, file names or commit messages',
    /**
     * A model reads code points and a pull request shows glyphs. The
     * Default_Ignorable_Code_Point set (4174 code points in UCD 17.0.0) is the
     * part of Unicode a renderer may draw as nothing, so a line of an agent
     * instruction file can carry a sentence no reviewer sees: tag characters
     * spell ASCII one for one, bidi overrides reorder what the reviewer reads
     * (Trojan Source, CVE-2021-42574), a Hangul filler is a valid identifier
     * that looks empty, and the GlassWorm loader hid in runs of variation
     * selectors.
     *
     * It reads what git will hand out, not the disk: stage-0 index blobs decoded
     * by their byte order mark, every tracked path and symlink target as a name,
     * every commit message reachable from HEAD, and a second pass over the
     * escapes JSON, YAML and TOML decode by themselves. No proof root, template
     * root or `.rebarignore` hides anything from it.
     *
     * The exemptions exist because a measurement demanded each one: RGI emoji
     * sequences (rebar's own docs carry 25 warning signs with a presentation
     * selector), script joiners in the scripts that write words with them,
     * right-to-left marks on lines that are already right-to-left. Agent files
     * and names keep only the joiner between two letters of one script and the
     * lone mark on a right-to-left line, which Persian and Arabic need. What is
     * left in a repository goes into
     * `.rebar-injection-allowlist` by blob id or commit id.
     *
     * N4 for the reason hardcoded-secret gives: a hook is removed with no diff,
     * and CI on the merge is the level that survives it. A pass means no known
     * signature matched, never that the repository is free of prompt injection.
     */
    checar: (r) => checarHiddenUnicode(r),
  },

  {
    id: 'control-bytes',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'no known terminal-control signature in tracked text',
    /**
     * A C0 or C1 control in a tracked text file acts on the terminal that prints
     * it: a colour sequence conceals what follows, a backspace or a bare carriage
     * return overwrites what came before, and `git diff` pages through a pager
     * that passes colour sequences raw. The reviewer reads less than the model
     * that reads the blob.
     *
     * Measured before the rule existed, over the 744 files tracked by rebar,
     * rebar-site and bookkeep: the only raw control was rebar's own colour
     * helper, 2 bytes on one line. Code keeps a narrower set, because honest
     * sources carry sentinels (a YAML plugin, a PNG magic), and a file whose line
     * endings are all bare carriage returns is a warning, not a finding.
     *
     * JSON and YAML parsers refuse a raw control, so the attack reaches them as
     * the format's own escape. Those escapes go through the same decoder
     * hidden-unicode uses, and fail the same way. Tracked names and commit
     * messages are read too, because `git log` and `ls-files` print them raw.
     */
    checar: (r) => checarControlBytes(r),
  },

  {
    id: 'agent-config-exec',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'no known agent setting that runs a command or widens approval',
    /**
     * A cloned repository can carry the settings an AI client obeys before
     * anyone types a command: a helper that runs in a non-interactive session,
     * an environment block that sends the client's API traffic and credential to
     * another host, a task that starts when the folder opens, a rule that
     * approves every shell command. Each shipped as an advisory: CVE-2025-53773
     * (a workspace auto-approve key), CVE-2026-21852 (a project environment
     * block redirecting the API endpoint), CVE-2025-61260 (a dotenv file moving
     * an agent home into the repository), CVE-2026-41613 (a loader variable in
     * an MCP server environment). In a diff they all look like configuration.
     *
     * The files are PARSED, not grepped: a key with one letter written as a
     * unicode escape, behind a comment and a trailing comma, is invisible to a
     * text pattern and real to the editor. A duplicate key fails on its own,
     * because clients disagree about which copy wins. Command text, URLs and
     * header values are printed only as a sha256 prefix and a length.
     *
     * Settings that wait for folder trust, or that a team uses on purpose, pass
     * with a warning instead: hooks, plugin marketplaces, the preview launch
     * file. An accepted setting is pinned in `.rebar-injection-allowlist` by
     * file, pointer and the hash of its value.
     */
    checar: (r) => checarAgentConfig(r, { CHAVES_QUE_EXECUTAM, VARIAVEIS_PERIGOSAS }),
  },

  {
    id: 'mcp-server-launch',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'every MCP server launch in versioned config is the template or allowlisted',
    /**
     * A versioned MCP configuration is a program the client starts on the
     * developer's machine, and headless and cloud sessions load project servers
     * without asking. An allowlist by server NAME was measured against real
     * history and lost both ways: it fired on 149 of 150 routine version bumps,
     * and a server renamed in the same commit as its new command walked past it.
     *
     * So a launch is judged by a sha256 fingerprint of every field that decides
     * what runs. The one launch accepted with no entry is the template this
     * rebar ships, read from the running package and never from the target:
     * rebar-site, assay and navesz-portfolio track it byte for byte. Any other
     * launch needs its fingerprint in `.rebar-injection-allowlist`.
     *
     * Some findings no entry can accept, because they change what runs without
     * changing the text: an unparseable file or a duplicate key, a command read
     * from the environment, a server marked trusted, the mcp-remote proxy below
     * 0.1.16 (CVE-2025-6514, CVSS 9.6), and a package runner next to a tracked
     * registry override.
     */
    checar: (r) => checarMcpLaunch(r, { EXECUTORES_REMOTOS, SINAIS_DE_SHELL }),
  },

  {
    id: 'agent-bypass-invocation',
    classe: 'determinística',
    nivel: 'N4',
    titulo: 'no agent CLI started with its approval switch turned off',
    /**
     * Two supply-chain incidents used exactly this shape. The Nx s1ngularity
     * release (August 2025) shipped an install script that looked for agent
     * CLIs on the machine and started each one with its permission prompts
     * skipped, asking it to search the disk for wallets and keys. The Amazon Q
     * Developer extension 1.84.0 (CVE-2025-8217) carried a line that started
     * the vendor's chat CLI with every tool trusted and a prompt that wiped files
     * and cloud resources. The switch was the whole difference between an agent
     * that asks and an agent that acts.
     *
     * The place decides the verdict, not the switch alone: 25 of 39 sampled
     * GitHub Agentic Workflows lock files carry such switches inside a firewall
     * container, on purpose. It fails where nothing asks a person first: package
     * lifecycle scripts and the files they start, git hooks, editor tasks that
     * run on folder open, agent hooks, agent instruction files, and workflows
     * that are not generated lock files (a workflow that only runs on push or on
     * a schedule included). Elsewhere it is a warning.
     *
     * Most switches are one letter or a generic word, so they count only with
     * their binary in the same command, or within 3 lines in code. The output
     * names the CLI and the effect, never the switch.
     */
    checar: (r) =>
      checarBypass(r, { FLAGS_FORTES, FLAGS_AMBIGUAS, PARES_DE_FLAG, BINARIOS_DE_AGENTE }),
  },

  {
    id: 'mcp-ansi-escape',
    classe: 'heurística',
    nivel: 'N1',
    titulo: 'no escaped terminal control in an MCP server file',
    /**
     * Trail of Bits showed terminal control sequences inside MCP tool
     * descriptions, hidden from the person using a coding agent and read in full
     * by the model, written in the server source as ESCAPES rather than raw
     * bytes, which control-bytes cannot see.
     *
     * Where a description string begins and ends cannot be found without running
     * the server: descriptions are built by concatenation, joins, interpolation
     * and schema helpers. So this works per file. A candidate is a code file
     * that uses an MCP server SDK, or a tracked file a versioned MCP config
     * launches; the finding is an escaped ESC or CSI in its code, comments
     * stripped.
     *
     * A heuristic at N1 because an honest server may colour a console line:
     * measured, 2 of 48 unique server files in node_modules did. It informs, and
     * fails only under `--heuristics`.
     */
    checar: (r) => checarMcpAnsiEscape(r, { MARCADORES_DE_SERVIDOR, ESCAPES_DE_CONTROLE }),
  },
]

// ═══════════════════════════════════════════════════════════════ the executor

function avaliar(dir, filtro) {
  if (!existsSync(dir)) return { dir, nome: basename(dir) || dir, erro: 'path does not exist' }
  const r = lerRepo(dir)
  if (r.erro) return { dir, nome: basename(dir) || dir, erro: r.erro }

  const aRodar = filtro ? REGRAS.filter((x) => x.id === filtro) : REGRAS
  // `passou` · `reprovou` · `na` · `quebrou` are the state VALUES the `--json`
  // carries, and `tooling/rebar-check/proofs/prove.mjs` compares them literally
  // against what each proof case declares. They stay in Portuguese: translated,
  // every side of every case reads as a state that does not exist.
  const resultados = aRodar.map((regra) => {
    const base = { id: regra.id, titulo: regra.titulo, classe: regra.classe, nivel: regra.nivel }
    let saida
    try {
      saida = regra.checar(r)
    } catch (e) {
      // BROKE is a defect of THIS tool. It never enters the target's score, and
      // 127 dominates 1: you do not accuse a repository with a ruler that broke.
      return { ...base, estado: 'quebrou', motivo: `${e.message}` }
    }
    if (saida === null || saida === undefined) return { ...base, estado: 'passou' }
    if (typeof saida === 'object' && saida.na) return { ...base, estado: 'na', motivo: saida.na }
    // PASSED, WITH A HOLE NAMED. Still three states — `nota` does not change the
    // verdict, the score or the exit code; it is the only channel a rule has to
    // say "what I did read is clean, and I did not read all of it". It prints as
    // `⚠`, which is the marker `verify.config.mjs` already declares as `avisar`
    // for the `security-self` step, so the gate shows it instead of discarding
    // the stdout of a step that passed.
    if (typeof saida === 'object' && saida.nota)
      return { ...base, estado: 'passou', nota: String(saida.nota) }
    return { ...base, estado: 'reprovou', motivo: String(saida) }
  })
  return { dir, nome: r.nome, resultados }
}

const c = process.stdout.isTTY && !process.env.NO_COLOR
// Colour from `node:util`, with no control character in this file at all.
// Until 2026-09-12 this line held two raw U+001B bytes, the only raw control
// character among the 493 files rebar tracks, so control-bytes failed rebar on
// its own colour helper. The next fix spelled the escape as text, and then
// tooling/security/prove-table.mjs, which holds every injection table against
// the RAW text of this file, comments included, matched it: one of the escaped forms
// mcp-ansi-escape looks for. That rule would not fire here (this file is no
// server), but a ruler that ships a sample of what its own table hunts is the
// defect the table proof exists to stop. `validateStream: false` keeps the
// decision where it was, in `c`; Node versions before 22.13 ignore the option
// and always colour, which is the same thing.
const cor = (formato, s) => (c ? styleText(formato, s, { validateStream: false }) : s)
const verde = (s) => cor('green', s)
const vermelho = (s) => cor('red', s)
const fraco = (s) => cor('gray', s)

// Room for a motivo that lists 12 findings with their paths, which is what the
// rules print at most, and short enough that one hostile path cannot flood a
// CI log or an MCP answer.
const LIMITE_DE_TEXTO = 4000

/**
 * The evaluation as it may be SHOWN: every string that came from the target
 * passes through `escaparSaida`, the same in the scoreboard and in `--json`.
 *
 * The rules report file names, commit messages and config keys of a repository
 * that may be hostile. Printed raw, a name with a line break forges a `✓` or `⚠`
 * line in output read line by line, and a U+200B or a tag sequence reaches the
 * agent that reads the MCP answer as text nobody sees. Escaping at the output
 * covers every rule, including the ones not written yet.
 *
 * `id`, `titulo`, `classe`, `nivel` and `estado` are this file's own constants,
 * and `estado` is compared literally by prove.mjs, so they go out untouched.
 * `dir` is the caller's own argument and goes out as given.
 */
function paraSaida(a) {
  const curto = (s) => escaparSaida(s, { limite: 200 })
  const longo = (s) => escaparSaida(s, { limite: LIMITE_DE_TEXTO })
  const nome = curto(a.nome)
  if (a.erro) return { ...a, nome, erro: longo(a.erro) }
  const resultados = a.resultados.map((x) => ({
    ...x,
    ...(x.motivo !== undefined && { motivo: longo(x.motivo) }),
    ...(x.nota !== undefined && { nota: longo(x.nota) }),
  }))
  return { ...a, nome, resultados }
}

function imprimir(a) {
  console.log(`\nrebar-security · ${a.nome}`)
  if (a.erro) {
    console.log(`  ${vermelho('✗')} ${a.erro}`)
    return
  }
  const largura = Math.max(...a.resultados.map((x) => x.id.length))
  for (const x of a.resultados) {
    const marca = {
      passou: verde('✓'),
      reprovou: vermelho('✗'),
      na: fraco('–'),
      quebrou: vermelho('!'),
    }[x.estado]
    const motivo =
      x.estado === 'passou' ? '' : `  ${x.estado === 'na' ? fraco(x.motivo) : x.motivo}`
    console.log(`  ${marca} ${x.id.padEnd(largura)}  ${x.titulo}${motivo}`)
    // The `⚠` opens the line because that is what the gate matches on.
    if (x.nota) console.log(`  ⚠ ${' '.repeat(largura)}  ${x.nota}`)
  }
  const aplicaveis = a.resultados.filter((x) => x.estado === 'passou' || x.estado === 'reprovou')
  const passaram = aplicaveis.filter((x) => x.estado === 'passou').length
  const naS = a.resultados.filter((x) => x.estado === 'na').length
  console.log(`  ${passaram} of ${aplicaveis.length}${naS ? `  ·  ${naS} not applicable` : ''}`)
}

function principal(argv) {
  const json = argv.includes('--json')
  const heuristicasBarram = argv.includes('--heuristics')
  const regraArg = argv.find((a) => a.startsWith('--rule='))
  const filtro = regraArg ? regraArg.slice('--rule='.length) : null

  const desconhecida = argv.find((a) => a.startsWith('--') && !/^--(json|heuristics|rule=)/.test(a))
  if (desconhecida) {
    console.error(`rebar-security: unknown option: ${escaparSaida(desconhecida)}`)
    process.exit(2)
  }
  if (filtro && !REGRAS.some((x) => x.id === filtro)) {
    console.error(`rebar-security: unknown rule: ${escaparSaida(filtro)}`)
    // `disponíveis:` stays in Portuguese and at column 0: it is the line prefix
    // tooling/rebar-check/proofs/prove.mjs reads back with startsWith() to learn
    // the rule ids without importing this CLI. This line used to print
    // `  known:`, and the discovery returned null in silence: no up-front check
    // of the case ids, and no `N of M rules with a proof` line for this module.
    // prove.mjs carries the mirror of this note, and so does rebar-check.
    console.error(`disponíveis: ${REGRAS.map((x) => x.id).join(', ')}`)
    process.exit(2)
  }

  const alvos = argv.filter((a) => !a.startsWith('--'))
  if (!alvos.length) alvos.push('.')

  const avaliacoes = alvos.map((d) => avaliar(d, filtro))
  // `nota` is the same object rebar-check's `--json` carries, from the same
  // function, so a client reads the score of either ruler the same way. The MCP
  // server reads `a.nota.ok` from rebar-check's output, and this output had no
  // `nota` to read. The score is counted before escaping, which touches only text.
  const exibidas = avaliacoes.map((a) => paraSaida(a.erro ? a : { ...a, nota: nota(a.resultados) }))
  if (json) console.log(JSON.stringify(exibidas, null, 2))
  else exibidas.forEach(imprimir)

  if (avaliacoes.some((a) => a.erro)) return 2
  const todos = avaliacoes.flatMap((a) => a.resultados)
  if (todos.some((x) => x.estado === 'quebrou')) return 127
  const reprovou = todos.some(
    (x) => x.estado === 'reprovou' && (x.classe === 'determinística' || heuristicasBarram),
  )
  return reprovou ? 1 : 0
}

// `pathToFileURL`, not interpolation: on Windows `argv[1]` comes with a
// backslash and `import.meta.url` with a forward slash, so the direct
// comparison is always false and the binary prints nothing -- it was the first
// defect of this file, and it exits quiet, which is the worst way to exit.
if (pathToFileURL(process.argv[1] || '').href === import.meta.url) {
  process.exitCode = principal(process.argv.slice(2))
}
