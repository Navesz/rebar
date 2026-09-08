#!/usr/bin/env node
// Secret scan. It exists because "never commit a credential" is a document rule
// and has to become a gate: rebar-check is retroactive and measures what is
// already there, but a secret is not fixed by measuring afterwards — once it is
// in history, it demands ROTATION. This is the only tool in the toolkit that has
// to block BEFORE, and that is why it is the one that lives in the hook.
//
// Zero dependencies. It scans what Git tracks, not the disk: an ignored file is
// not a risk, and node_modules is not ours.
//
// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN AFTER AN ADVERSARIAL AUDIT. The previous version let a real `ghp_`
// token through by EIGHT different paths, always printing "no findings". The
// numbers below are the ones the audit measured, not estimates. Every decision
// in this file is tied to one of them:
//
//   1. INDEX AGAINST DISK. `--staged` took the NAMES from the index and read the
//      CONTENT from the disk. It read one file and committed another. It is not
//      only an attack: it happens on its own every time someone edits the file
//      after `git add`. Now, under `--staged`, the content comes from the INDEX
//      BLOB. The disk is only read in normal mode, where index and disk have no
//      reason to diverge.
//
//   2. THE PLACEHOLDER TURNED OFF THE WHOLE LINE. Measured: 8 of 9 REAL
//      credentials passed. The worst case was `{ host: "localhost", token:
//      "ghp_…" }` — a line any project writes. Now the placeholder is tested
//      against the MATCHED SPAN, never against the line, and the vendor rules
//      (fixed prefix + length) only accept a disabler that sits INSIDE the token
//      itself: a 40-character `ghp_` is an example of nothing. Turning off the
//      whole line only through the escape hatch `rebar-segredo-ok:`.
//
//   3. SIX SILENT EXITS. The same `ghp_` came in through vendor/, build/, .svg,
//      a file >512 KB, a line >2000 characters and a file with a NUL byte — all
//      of them skipped WHOLE and without printing anything. Now there is no skip
//      by folder nor by extension, a long line is scanned in windows and a
//      binary is scanned through its islands of text. What is left of skipping
//      (truncated, unreadable) is counted and PRINTED. Silence here is worse
//      than a false positive: a false positive the human sees.
//
//   4. BLIND TO camelCase. The lookbehind `(?<![A-Za-z0-9])` on the keyword kept
//      `githubToken` and `googleApiKey` from matching — 6 of 7 realistic
//      credentials passed through that. The key is now matched as a whole
//      IDENTIFIER and broken into words in JavaScript, which solves camelCase,
//      snake_case, UPPER_SNAKE, kebab and dotted in one go.
//
//   5. ONLY 6 VENDORS. Missing were github_pat_, Stripe (it uses `_`, and the
//      rule demanded a hyphen), SendGrid, npm, GitLab, HuggingFace and the AWS
//      secret key.
//
//   6. IT DEPENDED ON THE DIRECTORY. git ran without `cwd`: the SAME staged
//      secret gave exit 1 from the root and exit 0 from inside tooling/, and the
//      ENOENT was swallowed by a mute catch. Now every git runs with `cwd` on
//      the discovered root, and a git failure is a message, not silence.
//
//   7. ACCENTED FILE NAME. `core.quotePath` is true by default on every OS and
//      this repository is written in Portuguese: `configuração.mjs` came out
//      C-quoted, readFileSync failed and the failure was swallowed. Every path
//      listing now uses `-z` (NUL), which does not go through quoting.
// ─────────────────────────────────────────────────────────────────────────────
//
// Usage:
//   node scan-secret.mjs              everything Git tracks
//   node scan-secret.mjs --staged     only what is staged (hook)
//   node scan-secret.mjs --json
//
// Escape hatch, on the finding's line:  // rebar-segredo-ok: <reason>
// The token stays Portuguese on purpose: it is a CONTRACT with the user, already
// written into the audited repositories. Renaming it voids every escape already
// in place. Without a written reason it does not count — suppression without
// justification is exactly the workaround this tool exists to prevent.

import { execFileSync, spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const soStaged = args.includes('--staged')
const comoJson = args.includes('--json')

// 8 MiB, and the number came out of measurement, not of a guess. The old ceiling
// was 512 KB and it was one of the six exit paths: a 600 KB file with the `ghp_`
// inside was skipped whole and in silence. Measured on this machine, scanning a
// minified bundle: 1 MiB → 489 ms, 2 MiB → 510 ms of whole process against
// 279 ms of Node startup alone, that is ~230 ms per 2 MiB scanned. At 8 MiB that
// gives ~1 s, which fits the hook's 5 s budget.
//
// The ceiling still exists because a 500 MB blob freezes the hook, but it no
// longer DISCARDS anything: above the ceiling the file is scanned up to the
// ceiling and the truncation is printed. No file leaves the scan without leaving
// a line behind.
const LIMITE_BYTES = 8 * 1024 * 1024

// A long line was also a silent exit (`if (linha.length > 2000) continue`). The
// ceiling existed out of fear of backtracking; the right answer is to slice, not
// to discard. The 200-character overlap guarantees that no token falls exactly
// on the seam between two windows — the largest token we recognize
// (github_pat_, ~82 characters) fits inside it with room to spare.
const JANELA = 2000
const SOBREPOSICAO = 200

// Memory ceiling per `git cat-file --batch` batch. Blobs larger than
// LIMITE_BYTES never enter the batch, so the batch only grows by count.
const LOTE_BYTES = 32 * 1024 * 1024

// The token stays Portuguese, and it is not prose: it is the escape hatch
// already written into the audited repositories. Renaming it voids every escape
// in place — see the header.
const MARCA_LIBERACAO = /rebar-segredo-ok:\s*\S+/

/**
 * Placeholders are the main source of false positives, and a rule with a false
 * positive teaches people to turn checking off — checking turned off checks
 * zero.
 *
 * CHANGE OF SCOPE, and it is the fix for HOLE 2: this expression is now tested
 * against the MATCHED SPAN, never against the line. Before, a single term from
 * this list in any column of the line erased every rule on that line at once —
 * that is how `{ host: "localhost", token: "ghp_…" }` passed. Tested against the
 * span, the word `localhost` still exempts `password: 'localhost'` and never
 * gets near the `ghp_` beside it.
 *
 * Rules marked `alta` (vendor prefix + length) do NOT consult this list: there
 * is no 40-character placeholder starting with `ghp_`. They consult only
 * PLACEHOLDER_FORTE just below.
 *
 * The Portuguese words inside the expression — `senha`, `desenvolvimento`,
 * `exemplo` — are NOT prose. They are the vocabulary the scanner LOOKS FOR
 * inside the repositories it audits, and those repositories are Brazilian.
 * Translating them blinds the scanner exactly where it exists to work.
 */
const PLACEHOLDER = new RegExp(
  [
    // ── inherited from the foundation ──
    /process\.env|import\.meta\.env|\$\{|\$\(|<[^>]*>|\bxxx+\b|\bchange[_-]?me\b/,
    /\bexample\b|\bexemplo\b|\bplaceholder\b|\bseu[_-]|\bdummy\b|\bfake\b/,
    /\btest(e)?[_-]?(key|token|secret)\b|\*{4,}|\.{4,}|\bnull\b|\bundefined\b/,

    // 1. Canonical Postgres/Docker development credential, and only in VALUE
    //    POSITION. The three locks still hold even with the scope reduced to the
    //    span, because the span of `credencial-atribuida` includes the key:
    //    without them, `postgres` as a KEY would exempt itself.
    //      · on the left it demands a value opening (quote, `=`, `:`, `(`, `,`);
    //      · `(?![A-Za-z0-9_-])` stops it matching the prefix of a key, and is
    //        what keeps `POSTGRES_PASSWORD: 'S3cr3tDeVerdade'` a finding;   // rebar-segredo-ok: example inside the comment that documents the pattern itself
    //      · `(?!\s*[:=])` stops it matching the word WHEN IT IS THE KEY, and is
    //        what keeps `senha: 'Tr0v0…'` and `postgres://u:p@prod/db`   // rebar-segredo-ok: example inside the comment that documents the pattern itself
    //        findings — in both, what comes next is `:`.
    /(?:^\s*|[=:(,[{]\s*|['"`])(?:senha|postgres(?:ql)?|docker|local(?:host)?)(?![A-Za-z0-9_-])(?!\s*[:=])/,

    // 2. A value that declares itself development. It is this alternative that
    //    cleans up rebar: measured, the foundation scanner gave 2 findings in
    //    this repository — privilegio.test.mjs:19 and :196,
    //    `password: 'app_dev_only'` in a pool pointing at 127.0.0.1, zero true
    //    positives out of 2. It demands marker + separator + noun, so that
    //    `device`, `developer` and `devops` do not become an off switch.
    /(?<![a-z0-9])(?:dev|desenvolvimento|homolog|sandbox)[_-](?:only|local|senha|password|pass|pwd|key|token|secret|teste?)(?![a-z0-9])/,

    // 3. A credential whose HOST is the machine itself. A connection string to
    //    127.0.0.1 is nobody's secret: whoever has the password already has the
    //    machine. Anchored to the userinfo `@` — it exempts the host, never the
    //    line.
    /@(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(?![\w.-])/,
  ]
    .map((r) => r.source)
    .join('|'),
  'i',
)

/**
 * The only disabler a vendor rule accepts, and only INSIDE the matched span.
 * Measured on the attack suite: the documentation line
 * `sk-ant-api03-EXEMPLO-nao-e-chave-de-verdade` was the single false positive in
 * 44 cases — text no project manages to avoid writing.
 *
 * Why this does not reopen HOLE 2: the test is against the SPAN, that is,
 * against the guts of the token itself. To hide here, the credential would have
 * to carry `example`/`exemplo`/`xxx` between word boundaries — and a token that
 * carries that inside is no longer the token. In a 40-character `ghp_`, pure
 * alphanumeric after the prefix, `\bexample\b` has no way to match: both
 * neighbours are alphanumeric and there is no boundary. Only the formats with a
 * hyphen or an underscore in the middle stay exposed (sk-, glpat-, github_pat_),
 * and for those the explicit escape hatch is still the right road.
 *
 * `exemplo`, `seu` and `sua` stay in Portuguese: they are vocabulary the scanner
 * LOOKS FOR inside Brazilian repositories, not prose.
 */
const PLACEHOLDER_FORTE =
  /\bexample\b|\bexemplo\b|\bplaceholder\b|\bdummy\b|\bfake\b|\bchange[_-]?me\b|\bxxx+\b|\bseu[_-]|\bsua[_-]|\byour[_-]|\.{4,}|\*{4,}/i

// ── Words that make an identifier a credential key ───────────────────────────
// Fix for HOLE 4. The old version tried to solve camelCase with a lookbehind and
// that cannot work: `(?<![A-Za-z0-9])token` never matches in `githubToken`,
// because the letter before `Token` is alphanumeric. Matching the WHOLE
// identifier and breaking it into words here in JavaScript solves camelCase,
// snake_case, UPPER_SNAKE, kebab and dotted with a single implementation.
//
// The Portuguese entries in the sets below — `senha`, `credencial`,
// `credenciais`, `chave`, `privada` — are the vocabulary the scanner LOOKS FOR
// inside the repositories it audits, and those are Brazilian. Not prose, not
// translated.
const FORTES = new Set([
  'senha',
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'secret',
  'token',
  'apikey',
  'apitoken',
  'credential',
  'credentials',
  'credencial',
  'credenciais',
])

// `key` and `auth` on their own are noise: `sortKey`, `cacheKey`, `authUrl`.
// They only count alongside a qualifier that turns them into a credential.
const FRACAS = new Set(['key', 'keys', 'chave', 'auth', 'cred', 'creds', 'signature'])
const QUALIFICADORES = new Set([
  'api',
  'secret',
  'access',
  'private',
  'privada',
  'auth',
  'client',
  'signing',
  'encryption',
  'refresh',
  'session',
  'bearer',
  'master',
  'admin',
  'service',
])

function palavrasDoIdentificador(identificador) {
  return identificador
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // githubToken → github Token
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // AWSSecret   → AWS Secret
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase())
}

// Subset of FORTES whose value is a PASSWORD typed by a person, not a token
// generated by a machine. The distinction exists because the two classes have
// different shapes and suffer different false positives — see
// `valorDeCredencial`.
const SENHAS = new Set(['senha', 'password', 'passwd', 'passphrase', 'pwd'])

function classeDoIdentificador(identificador) {
  const palavras = palavrasDoIdentificador(identificador)
  if (palavras.some((p) => SENHAS.has(p))) return 'senha'
  if (palavras.some((p) => FORTES.has(p))) return 'token'
  if (palavras.some((p) => FRACAS.has(p)) && palavras.some((p) => QUALIFICADORES.has(p)))
    return 'token'
  return null
}

/**
 * VALUE SHAPE gate, and it was paid for by measurement. Run against 9.5 MiB of
 * real third-party code (rebar's own node_modules, prettier included), the
 * scanner without this gate gave 16 false positives and no true one. Twelve came
 * from here, and all from the same place: `token`, `key` and `secret` are
 * compiler words as much as credential words. The real cases were
 *   `nextLastSignificantToken = "?NonExpressionParenEnd"`
 *   `UnexpectedTokenUnaryExponentiation: "Illegal expression. Wrap left…"`
 * — parser code, not a credential.
 *
 * Two locks, and each one cuts one of the two observed shapes:
 *   · a value with whitespace is PROSE. An error message is not a secret. It
 *     costs the password that contains a space, which exists but is rare, and
 *     for that one the vendor rules and the escape hatch are still there.
 *   · for the `token` class, the value has to mix letter and digit. A machine-
 *     generated token practically always has a digit; a compiler's PascalCase
 *     identifier (`?NonExpressionParenEnd`) never does. This lock does NOT apply
 *     to the `senha` class, because `password` is not an ambiguous word in
 *     parser code and a letters-only password is common.
 */
function valorDeCredencial(classe, valor) {
  if (/\s/.test(valor)) return false
  if (classe === 'senha') return true
  return /[0-9]/.test(valor) && /[A-Za-z]/.test(valor)
}

function temMisturaDeCaracteres(texto) {
  return /[a-z]/.test(texto) && /[A-Z]/.test(texto) && /[0-9]/.test(texto)
}

// Context NEAR the match, not the whole line. In a minified file the whole file
// is ONE line, so "does the line talk about a credential?" is always yes and the
// gate gates nothing — that is how 4 of the 16 false positives got in.
function contextoFala(linha, inicio, fim, padrao) {
  return padrao.test(linha.slice(Math.max(0, inicio - 64), fim + 16))
}

/**
 * `alta: true` = vendor prefix with fixed length. Two consequences: the
 * placeholder is not consulted (HOLE 2) and the rule also runs inside a binary
 * file (HOLE 3), where the generic heuristics would be pure noise.
 *
 * `sensivel: false` = the matched span is not the secret itself (a PEM header is
 * public), so it can be printed whole in the log.
 *
 * Order matters: whoever matches first keeps the interval, and an interval
 * already taken does not become a second finding. That is what makes
 * `token: "ghp_…"` yield ONE finding (github-token) instead of two.
 */
const REGRAS = [
  {
    nome: 'chave-privada',
    alta: true,
    sensivel: false,
    padrao: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    nome: 'aws-access-key-id',
    alta: true,
    padrao: /(?<![A-Za-z0-9])(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'github-token',
    alta: true,
    padrao: /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{30,}(?![A-Za-z0-9])/g,
  },
  {
    // HOLE 5: GitHub's new PAT does not start with `ghp_`. It passed whole.
    nome: 'github-pat',
    alta: true,
    padrao: /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{50,}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'gitlab-token',
    alta: true,
    padrao:
      /(?<![A-Za-z0-9])(?:glpat|gldt|glrt|glcbt|glptt|glsoat)-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
  },
  {
    nome: 'slack-token',
    alta: true,
    padrao: /(?<![A-Za-z0-9])xox[baprse]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'google-api-key',
    alta: true,
    padrao: /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g,
  },
  {
    nome: 'google-oauth-secret',
    alta: true,
    padrao: /(?<![A-Za-z0-9])GOCSPX-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
  },
  {
    // HOLE 5: Stripe separates with `_`, and the old rule (`sk-`) demanded a
    // hyphen. `pk_live_` is left out on purpose: a publishable key is public.
    nome: 'stripe',
    alta: true,
    padrao: /(?<![A-Za-z0-9])[sr]k_(?:live|test)_[A-Za-z0-9]{16,}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'sendgrid',
    alta: true,
    padrao: /(?<![A-Za-z0-9])SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g,
  },
  {
    nome: 'npm-token',
    alta: true,
    padrao: /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'huggingface-token',
    alta: true,
    padrao: /(?<![A-Za-z0-9])hf_[A-Za-z0-9]{30,}(?![A-Za-z0-9])/g,
  },
  {
    nome: 'chave-de-api',
    alta: true,
    padrao: /(?<![A-Za-z0-9])sk-(?:ant-|proj-|or-)?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g,
  },
  {
    nome: 'jwt',
    alta: true,
    padrao:
      /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g,
  },
  {
    // HOLE 5: the AWS secret key is 40 base64 characters and has no prefix — it
    // is indistinguishable from a hash. That is why it is NOT `alta`: it demands
    // that the line talk about a credential and that the value mix uppercase,
    // lowercase and digit. Without that pair of locks the rule would accuse
    // every lockfile `integrity: "sha512-…"`, and a rule that screams becomes a
    // rule turned off.
    // No `=` in the class, and that is a measured false-positive fix: with `=`
    // inside, the regex crossed the assignment sign and glued an identifier to a
    // number. In prettier/plugins/typescript.js the 40-character match was
    // `MethodWithSuperPropertyAccessInAsync=128` — the `=128` was what supplied
    // the digit temMisturaDeCaracteres demands. The AWS secret key is 30 bytes
    // in base64, which give exactly 40 characters and NO padding, so `=` never
    // really appears in it.
    // `credencial` and `senha` in the context pattern below are Portuguese on
    // purpose: they are the words written beside the key in the repositories
    // this scanner audits. Translating them throws away half the context the
    // rule reads, and this rule is nothing but context.
    nome: 'aws-secret-key',
    padrao: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/g,
    filtrar: (casamento, linha, inicio, fim) =>
      contextoFala(
        linha,
        inicio,
        fim,
        /\b(?:aws|secret|credential|credencial|senha|password)\b/i,
      ) && temMisturaDeCaracteres(casamento[0]),
  },
  {
    // The span runs to the HOST on purpose: it is the host that decides whether
    // the credential is worth anything, and it is what alternative 3 of
    // PLACEHOLDER reads to exempt `@localhost`. Ending at the `@`, as it ended
    // before, the span placeholder would have nothing to read.
    nome: 'string-de-conexao',
    padrao:
      /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|redis|amqp|ftp|ssh):\/\/[^\s:@/]+:[^\s:@/]+@[^\s/'"`,)\]}]+/gi,
  },
  {
    nome: 'senha-em-conexao',
    padrao: /\b(?:password|pwd)\s*=\s*[^;\s"'<${]{6,}/gi,
  },
  {
    // Key matched as a whole identifier (HOLE 4). `filtrar` decides whether that
    // identifier is a credential one by looking at the words that make it up.
    nome: 'credencial-atribuida',
    padrao: /([A-Za-z_$][A-Za-z0-9_$.-]{0,60})\s*[:=]\s*(["'`])([^"'`\r\n]{8,}?)\2/g,
    filtrar: (casamento) => {
      const classe = classeDoIdentificador(casamento[1])
      return classe !== null && valorDeCredencial(classe, casamento[3])
    },
  },
  {
    // THE SAME THING, WITHOUT QUOTES — and this hole cost an AWS secret key
    // crossing the whole hook. The rule above demands a quoted value, and
    // `.env`, YAML, shell, Dockerfile and documentation write without them.
    // Measured:
    // `AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` in a .md
    // staged came out "no findings", exit 0, and the commit went in.
    //
    // An AWS secret key is the worst possible case: 40 base64 characters and NO
    // distinctive prefix. The `AKIA` that the `aws-access-key-id` rule catches
    // is the PUBLIC identifier; the secret that comes with it carries no mark.
    // Without this rule, the half that matters passes.
    //
    // What holds the false positive back is the same pair of filters as the
    // quoted version: the identifier has to be of a credential class, and the
    // value has to look like a credential. Plus a 16-character minimum, against
    // the quoted version that accepts 8 — without the quotes there is no
    // delimiter, so the cut is more expensive and the floor rises to compensate.
    nome: 'credencial-atribuida-sem-aspas',
    padrao: /([A-Za-z_$][A-Za-z0-9_$.-]{0,60})\s*[:=]\s*([A-Za-z0-9+/_=.~-]{16,})(?=[\s;,)\]}]|$)/g,
    filtrar: (casamento) => {
      const classe = classeDoIdentificador(casamento[1])
      return classe !== null && valorDeCredencial(classe, casamento[2])
    },
  },
  {
    nome: 'cabecalho-autorizacao',
    padrao:
      /\b(?:Authorization|Proxy-Authorization)\s*[:=]\s*["'`]?\s*(?:Bearer|Basic|Token)\s+[A-Za-z0-9+/=_.-]{12,}/gi,
  },
]

// ── Git ──────────────────────────────────────────────────────────────────────
// HOLE 6: without `cwd`, the result depended on the folder the command ran from,
// and the mute catch turned ENOENT into "no findings". Everything here runs with
// cwd on the root and complains loudly when git fails.

function descobrirRaiz() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
  } catch (erro) {
    console.error(`[secret] not a Git repository, or git is not available: ${erro.message}`)
    process.exit(2)
  }
}

const RAIZ = descobrirRaiz()

function git(argumentos, opcoes = {}) {
  try {
    return execFileSync('git', argumentos, {
      cwd: RAIZ,
      encoding: opcoes.binario ? null : 'utf8',
      input: opcoes.entrada,
      maxBuffer: opcoes.maxBuffer ?? LOTE_BYTES + 8 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (erro) {
    console.error(`[secret] failed: git ${argumentos.join(' ')}\n         ${erro.message}`)
    process.exit(2)
  }
}

// HOLE 7: `-z` returns the raw path, NUL-separated. Without it git applies
// core.quotePath (true by default on every OS) and "configuração.mjs" comes back
// C-quoted — readFileSync failed and the failure was swallowed, so a file with
// an accented name went through GREEN with an AWS key inside.
function caminhosParaVarrer() {
  const bruto = soStaged
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    : git(['ls-files', '-z'])
  return bruto.split('\0').filter(Boolean)
}

// HOLE 1: under `--staged` the content has to come from the index, not from the
// disk. One `git show :path` per file would cost a process per file; `ls-files
// -s` gives the OID of every index entry in a single call, and `cat-file
// --batch` delivers the blobs in another. That is 3 processes in total, however
// many files the commit has. Measured: rebar's whole 106 tracked files staged,
// scanned through the index, take 381–432 ms across three runs — the hook has a
// 5 s budget.
function conteudosDoIndice(caminhos) {
  const desejados = new Set(caminhos)
  const oidPorCaminho = new Map()
  for (const registro of git(['ls-files', '-s', '-z']).split('\0')) {
    if (!registro) continue
    const tabulacao = registro.indexOf('\t')
    if (tabulacao === -1) continue
    const caminho = registro.slice(tabulacao + 1)
    if (!desejados.has(caminho)) continue
    // format: "<mode> <oid> <stage>\t<path>"
    oidPorCaminho.set(caminho, registro.slice(0, tabulacao).split(' ')[1])
  }

  const oids = [...new Set(oidPorCaminho.values())]
  const tamanhoPorOid = new Map()
  if (oids.length > 0) {
    const verificacao = git(['cat-file', '--batch-check'], { entrada: `${oids.join('\n')}\n` })
    for (const linha of verificacao.split('\n')) {
      const partes = linha.trim().split(' ')
      if (partes.length === 3 && partes[1] === 'blob')
        tamanhoPorOid.set(partes[0], Number(partes[2]))
    }
  }

  // A blob above the ceiling leaves the batch and is read on its own,
  // TRUNCATED. `spawnSync` with `maxBuffer` blown returns ENOBUFS but still
  // hands over the partial it already read in `r.stdout` — measured: a 1 MiB
  // ceiling against a 5 MiB blob returned 1,114,112 bytes with the beginning
  // intact. That is what allows scanning the first 8 MiB of a huge file instead
  // of declaring it unscanned, without risking the process memory.
  const truncadosPorOid = new Map()
  const lerTruncado = (oid) => {
    const r = spawnSync('git', ['cat-file', 'blob', oid], {
      cwd: RAIZ,
      maxBuffer: LIMITE_BYTES,
      windowsHide: true,
    })
    return Buffer.isBuffer(r.stdout) ? r.stdout.subarray(0, LIMITE_BYTES) : Buffer.alloc(0)
  }

  // Only batch-fetch the content of what fits under the ceiling, so that a
  // repository with a giant staged blob does not blow the process memory.
  const conteudoPorOid = new Map()
  let lote = []
  let bytesDoLote = 0
  const despejar = () => {
    if (lote.length === 0) return
    const buffer = git(['cat-file', '--batch'], { entrada: `${lote.join('\n')}\n`, binario: true })
    let posicao = 0
    while (posicao < buffer.length) {
      const fimDoCabecalho = buffer.indexOf(0x0a, posicao)
      if (fimDoCabecalho === -1) break
      const cabecalho = buffer.toString('utf8', posicao, fimDoCabecalho).split(' ')
      posicao = fimDoCabecalho + 1
      if (cabecalho[1] !== 'blob') continue // "<oid> missing"
      const tamanho = Number(cabecalho[2])
      conteudoPorOid.set(cabecalho[0], buffer.subarray(posicao, posicao + tamanho))
      posicao += tamanho + 1 // git closes each blob with an extra \n
    }
    lote = []
    bytesDoLote = 0
  }
  for (const [oid, tamanho] of tamanhoPorOid) {
    if (tamanho > LIMITE_BYTES) {
      truncadosPorOid.set(oid, lerTruncado(oid))
      continue
    }
    if (bytesDoLote + tamanho > LOTE_BYTES) despejar()
    lote.push(oid)
    bytesDoLote += tamanho
  }
  despejar()

  return { oidPorCaminho, tamanhoPorOid, conteudoPorOid, truncadosPorOid }
}

// ── Reading from disk (normal mode) ──────────────────────────────────────────
// Git returns a path with forward slashes; the disk on Windows does not.
// Rebuilding it with path.join from the segments is what makes the two formats
// line up.
function lerDoDisco(caminho) {
  const absoluto = join(RAIZ, ...caminho.split('/'))
  const tamanho = statSync(absoluto).size
  if (tamanho <= LIMITE_BYTES) return { dados: readFileSync(absoluto), tamanho }

  const descritor = openSync(absoluto, 'r')
  try {
    const buffer = Buffer.allocUnsafe(LIMITE_BYTES)
    const lidos = readSync(descritor, buffer, 0, LIMITE_BYTES, 0)
    return { dados: buffer.subarray(0, lidos), tamanho }
  } finally {
    closeSync(descritor)
  }
}

// ── Scan ─────────────────────────────────────────────────────────────────────

function ehPlaceholder(regra, linha, inicio, fim) {
  const trecho = linha.slice(inicio, fim)
  if (PLACEHOLDER_FORTE.test(trecho)) return true
  // From here down it is only for the heuristics. A vendor rule is not turned
  // off by `<…>` or `${…}` around it: the disabler has to sit inside the token,
  // otherwise wrapping the credential in signs would be enough to hide it.
  if (regra.alta) return false
  if (PLACEHOLDER.test(trecho)) return true
  const antes = linha.slice(0, inicio)
  const depois = linha.slice(fim)
  if (/<[^<>]*$/.test(antes) && /^[^<>]*>/.test(depois)) return true
  if (/\$\{[^{}]*$/.test(antes) && /^[^{}]*\}/.test(depois)) return true
  return false
}

function redigir(texto, sensivel) {
  if (!sensivel) return texto.length > 80 ? `${texto.slice(0, 80)}…` : texto
  // This tool's output goes to a CI log, which is another place a secret does
  // not enter. It shows enough to locate, never enough to use.
  if (texto.length <= 8) return `‹${texto.length} chars›`
  return `${texto.slice(0, 4)}…‹${texto.length} chars›`
}

function varrerLinha(caminho, numero, linha, apenasAlta, achados) {
  if (MARCA_LIBERACAO.test(linha)) return

  // A long line is no longer discarded (HOLE 3): it is sliced into overlapping
  // windows, because none of the rules needs to see more than that.
  const pedacos = []
  if (linha.length <= JANELA) pedacos.push([0, linha])
  else
    for (let b = 0; b < linha.length; b += JANELA - SOBREPOSICAO)
      pedacos.push([b, linha.slice(b, b + JANELA)])

  const tomados = []
  for (const regra of REGRAS) {
    if (apenasAlta && !regra.alta) continue
    for (const [deslocamento, pedaco] of pedacos) {
      regra.padrao.lastIndex = 0
      let casamento
      while ((casamento = regra.padrao.exec(pedaco)) !== null) {
        if (casamento[0].length === 0) {
          regra.padrao.lastIndex += 1
          continue
        }
        const inicio = deslocamento + casamento.index
        const fim = inicio + casamento[0].length
        if (regra.filtrar && !regra.filtrar(casamento, linha, inicio, fim)) continue
        if (ehPlaceholder(regra, linha, inicio, fim)) continue
        // An interval already taken by an earlier (more specific) rule does not
        // become a second finding, and the window overlap does not become a
        // doubled finding.
        if (tomados.some(([i, f]) => inicio < f && i < fim)) continue
        tomados.push([inicio, fim])
        achados.push({
          caminho,
          linha: numero,
          coluna: inicio + 1,
          regra: regra.nome,
          trecho: redigir(casamento[0], regra.sensivel !== false),
        })
      }
    }
  }
}

/**
 * Decodes by the BOM before anything else.
 *
 * A P1 from an external audit, reproduced: the SAME synthetic token in two files
 * in the index, one UTF-8 and the other UTF-16LE with BOM. The first was found,
 * the second passed — exit 0, zero findings, and the file counted as "binary
 * scanned", so that the silence looked like coverage.
 *
 * The mechanism is worse than "it does not decode". In UTF-16LE every ASCII
 * character takes two bytes, the second one NUL. `toString('utf8')` returns
 * `g\0h\0p\0…`; the binary guard just below sees the NUL and swaps the control
 * characters for a LINE BREAK, precisely to expose islands of text in a binary.
 * The side effect is that the token comes out one character per line, and no
 * rule matches anything.
 *
 * BOM only, and that is a choice. A BOM is deterministic: three signatures, no
 * guessing. Detecting UTF-16 WITHOUT a BOM would require statistics on the
 * proportion of NULs, and erring on the side of "this is text" would make the
 * scanner spend the expensive rules on real binaries. What is left without a BOM
 * still comes in through the binary path — scanned through its islands, and
 * COUNTED in the report, which is the difference between absent coverage and
 * faked coverage.
 */
function decodificar(dados) {
  if (dados.length >= 2) {
    // UTF-16LE: FF FE  ·  UTF-16BE: FE FF
    if (dados[0] === 0xff && dados[1] === 0xfe) return dados.subarray(2).toString('utf16le')
    if (dados[0] === 0xfe && dados[1] === 0xff) {
      // Node does not decode BE directly: swap the pairs and fall into LE.
      const trocado = Buffer.from(dados.subarray(2))
      trocado.swap16()
      return trocado.toString('utf16le')
    }
  }
  // UTF-8 with BOM: EF BB BF. The BOM alone does not get in the regex's way, but
  // leaving it in the text shifts the finding's column by three bytes on the
  // first line.
  if (dados.length >= 3 && dados[0] === 0xef && dados[1] === 0xbb && dados[2] === 0xbf) {
    return dados.subarray(3).toString('utf8')
  }
  return dados.toString('utf8')
}

function varrerConteudo(caminho, dados, relatorio) {
  let texto = decodificar(dados)
  let binario = false
  if (texto.indexOf('\u0000') !== -1) {
    // HOLE 3: a NUL byte made the whole file be skipped in silence. A secret
    // inside a binary leaks the same as one inside a .mjs. Swapping the control
    // characters for a line break turns the islands of ASCII text into scannable
    // lines; only the `alta` rules run here, because heuristics over binary junk
    // are noise.
    binario = true
    texto = texto.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '\n')
    relatorio.binarios.push(caminho)
  }

  const achados = []
  const linhas = texto.split(/\r?\n/)
  for (let i = 0; i < linhas.length; i++) varrerLinha(caminho, i + 1, linhas[i], binario, achados)
  return achados
}

// ── Execution ────────────────────────────────────────────────────────────────
//
// IGNORAR_CAMINHO no longer exists. The old list skipped vendor/, build/, dist/,
// .next/, coverage/, lockfiles and .svg — and the audit got the same `ghp_` in
// through four of them. The argument "it is third-party code" holds for style
// and for technical debt; it does NOT hold for a secret, because a credential
// committed in vendor/ leaks exactly like one committed in src/, and the clone
// of whoever takes the repo does not tell the two apart. .svg is text, not a
// binary image, and a token fits inside it. What is left of exclusion is only
// what Git already excludes: an ignored file is not tracked, so node_modules
// does not show up here.

const caminhos = caminhosParaVarrer()
const relatorio = { truncados: [], ilegiveis: [], binarios: [], provas: [], varridos: 0 }
const achados = []

const doIndice = soStaged ? conteudosDoIndice(caminhos) : null

/**
 * Path inside a proof case? The marker is the `caso.json` in some ancestor
 * directory -- the same one rebar-check's `semFixtures` uses, and not a
 * hand-written list of folders, which would age on its own.
 */
/**
 * A file under a proof-case directory, marked by a `caso.json` in an ancestor.
 *
 * RESOLVED AGAINST `RAIZ`, NOT THE WORKING DIRECTORY. It used to be relative,
 * and the effect was silent: run the scanner from inside a subdirectory and the
 * marker stopped being found, so the `.env` of the `env-committed` case became a
 * finding again. A guard that only holds when you happen to stand in the right
 * folder is a guard that fails on the machine that is not yours.
 */
function ehMaterialDeProva(caminho) {
  const partes = caminho.split('/')
  for (let i = partes.length - 1; i > 0; i--) {
    if (existsSync(join(RAIZ, partes.slice(0, i).join('/'), 'caso.json'))) return true
  }
  return false
}

for (const caminho of caminhos) {
  // A tracked environment file is a finding by itself, whatever the content.
  //
  // TWO EXCLUSIONS, and both were foreseen before they hurt.
  //
  // The first: the list of example suffixes was only `.example|.exemplo`, and
  // the security inventory audit recorded, with the line number, that it
  // produced two false positives. It did: the first commit of the security
  // module was blocked by a `.env.sample` that is the FIX for the flaw, not the
  // flaw.
  //
  // The second: proof material. A `.env` that exists to PROVE that the rule
  // detects `.env` cannot block the commit of the proof itself. The marker is
  // the same one rebar-check uses -- a `caso.json` in an ancestor directory.
  //
  // `exemplo` and `modelo` stay Portuguese in the suffix list below: they are
  // file-name suffixes written by the Brazilian repositories this scanner
  // audits, not prose.
  if (
    /(^|\/)\.env(\.|$)/.test(caminho) &&
    !/\.(example|exemplo|sample|template|dist|modelo)$/.test(caminho) &&
    !ehMaterialDeProva(caminho)
  ) {
    achados.push({ caminho, linha: 0, coluna: 0, regra: 'env-committed', trecho: caminho })
    continue
  }

  let dados
  if (soStaged) {
    const oid = doIndice.oidPorCaminho.get(caminho)
    const tamanho = oid === undefined ? undefined : doIndice.tamanhoPorOid.get(oid)
    if (tamanho !== undefined && tamanho > LIMITE_BYTES) {
      dados = doIndice.truncadosPorOid.get(oid)
      relatorio.truncados.push(`${caminho} (${tamanho} bytes, first ${LIMITE_BYTES} scanned)`)
    } else {
      dados = oid === undefined ? undefined : doIndice.conteudoPorOid.get(oid)
    }
    if (dados === undefined) {
      relatorio.ilegiveis.push(`${caminho} — no blob in the index`)
      continue
    }
  } else {
    try {
      const lido = lerDoDisco(caminho)
      dados = lido.dados
      if (lido.tamanho > LIMITE_BYTES) {
        relatorio.truncados.push(
          `${caminho} (${lido.tamanho} bytes, first ${LIMITE_BYTES} scanned)`,
        )
      }
    } catch (erro) {
      // It used to be `catch { continue }`, and that was where the accented name
      // came out clean. A read failure is now a printed line, not silence.
      relatorio.ilegiveis.push(`${caminho} — ${erro.code ?? erro.message}`)
      continue
    }
  }

  relatorio.varridos += 1
  // PROOF MATERIAL, BY THE SAME MARKER THE `.env` RULE ABOVE ALREADY HONOURS.
  //
  // A `fail/` tree exists to PROVE that a rule detects a credential; its
  // fixtures are credential-SHAPED on purpose. Letting them block the commit of
  // the proof itself is the scanner refusing the only thing that keeps it
  // honest — and it is not hypothetical: the `hardcoded-secret` rule shipped
  // with two such cases and this scanner went red on them the moment they were
  // staged.
  //
  // The file is still READ and still COUNTED, so the summary does not shrink,
  // and what was dropped is PRINTED. Silence here would be worse than a false
  // positive: a scanner that quietly skips a directory is one that can be
  // turned off by adding a `caso.json`.
  const doArquivo = varrerConteudo(caminho, dados, relatorio)
  if (doArquivo.length && ehMaterialDeProva(caminho)) {
    relatorio.provas.push(`${caminho} (${doArquivo.length})`)
  } else {
    achados.push(...doArquivo)
  }
}

// Under `--staged`, a file that could not be scanned is a file entering the
// commit unchecked — the hook has no way to approve what it did not read. In
// normal mode that is routine (a tracked file deleted from disk), so it only
// warns.
const naoVerificados = soStaged ? relatorio.ilegiveis.length : 0

function imprimirLista(rotulo, itens) {
  if (itens.length === 0) return
  console.error(`\n  ${rotulo} (${itens.length}):`)
  for (const item of itens.slice(0, 20)) console.error(`    ${item}`)
  if (itens.length > 20) console.error(`    …and ${itens.length - 20} more`)
}

if (comoJson) {
  console.log(
    JSON.stringify(
      {
        total: achados.length,
        modo: soStaged ? 'staged' : 'rastreados',
        varridos: relatorio.varridos,
        naoVerificados,
        achados,
        pulos: {
          truncados: relatorio.truncados,
          ilegiveis: relatorio.ilegiveis,
          binariosVarridos: relatorio.binarios,
        },
      },
      null,
      2,
    ),
  )
} else {
  // The summary comes out ALWAYS, including on the happy path. The most
  // expensive lie of the previous version was not a wrong finding: it was "no
  // findings" printed after skipping six files without counting any of them.
  const resumo =
    `[secret] ${relatorio.varridos} file(s) scanned in ${soStaged ? 'stage' : 'tracked files'}` +
    ` · ${relatorio.binarios.length} binary file(s) · ${relatorio.truncados.length} truncated` +
    ` · ${relatorio.ilegiveis.length} not scanned` +
    (relatorio.provas.length ? ` · ${relatorio.provas.length} proof fixture(s) not charged` : '')

  // ─── The ⚠, and why it exists (finding of 02/09) ───────────────────────────
  //
  // The comment above tells the most expensive lie of this tool: "no findings"
  // printed after skipping six files without counting any of them. The summary
  // fixed the lie IN THE TOOL and not in the gate: outside `--staged`,
  // `naoVerificados` is always 0, so a TRUNCATED or UNREADABLE file exits 0 —
  // and `verify` discards the stdout of every step that passes (HOLE 4, written
  // at the top of verify.mjs). Measured result: the two lists were printed for
  // nobody.
  //
  // The ⚠ is what makes them cross, because the `secret` step of
  // verify.config.mjs declares `avisar: /^\s*⚠/`. It stays a WARNING and not a
  // failure: a tracked file deleted from disk is routine for whoever edits, and
  // failing on that would be the gate nobody can satisfy. But "I scanned
  // everything" and "I did not read these N" are two different claims, and the
  // gate was only making the first.
  const naoLidos = relatorio.truncados.length + relatorio.ilegiveis.length
  const avisoDoNaoLido = () => {
    if (naoLidos === 0) return
    console.error(
      `  ⚠ ${relatorio.truncados.length} file(s) scanned only in part and ` +
        `${relatorio.ilegiveis.length} not scanned — this verdict does not cover ${naoLidos} file(s)`,
    )
    imprimirLista('truncated — scanned only in part', relatorio.truncados)
    imprimirLista('not scanned', relatorio.ilegiveis)
  }

  if (achados.length === 0 && naoVerificados === 0) {
    console.log(`${resumo} · no findings.`)
    avisoDoNaoLido()
  } else {
    console.error(resumo)
    if (achados.length > 0) {
      console.error(`\n[secret] ${achados.length} finding(s):\n`)
      for (const a of achados) {
        console.error(`  error  ${a.caminho}:${a.linha}:${a.coluna}  ${a.regra}`)
        console.error(`         ${a.trecho}`)
      }
    }
    avisoDoNaoLido()
    console.error(
      '\n  A secret that already entered history is not removed by a new commit:\n' +
        '  it has to be ROTATED. Rewriting history comes after, not instead.\n' +
        '  False positive: add on the line  // rebar-segredo-ok: <reason>\n',
    )
  }
}

process.exit(achados.length === 0 && naoVerificados === 0 ? 0 : 1)
