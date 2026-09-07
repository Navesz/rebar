#!/usr/bin/env node
// Blocks NON-HUMAN co-authorship in the message being written.
//
// Why it exists on top of the pre-commit step: `rebar-check --rule=ai-coauthorship`
// reads `git log`, and the commit in progress is not there yet. That step blocks
// the NEXT commit — it stops the trailer from staying, not from getting in. Since
// rebar's declared objective is "ignoring a rule breaks the commit", the half that
// runs before the commit exists was missing. This is it.
//
// Once in history, the trailer only comes out by rewriting history. Measured: the
// alicerce has 11 of 11 commits with co-authorship and there is no cleaning it
// without a force push.
//
// ── POLICY INVERSION (2026-08-30) ──────────────────────────────────────────
//
// This file enumerated 9 agents in a regex. The audit built a repository in a
// tmpdir with this very hook installed and walked SIX agents through at once:
//
//   Windsurf, ChatGPT, Cody, Codeium, Amazon Q, Tabnine  ->  hook exit 0 on all six
//
// and `git log --format=%(trailers:key=Co-authored-by)` gave back the six
// trailers, one per commit. It is not a regex failure: it is a failure of FORM.
// Enumerating AI agents is a race you lose every week; enumerating the project's
// humans is a short list that changes once a year. Now whoever is in
// `.rebar-coauthors` at the repository root passes, and nobody else.
//
// ── SECOND HOLE: THE SMUGGLING BELOW THE SCISSORS ──────────────────────────
//
// The previous version cut the text at
//   # ------------------------ >8 ------------------------
// so as not to flag the diff that `git commit -v` pastes there. Except git
// removes the scissors BECAUSE IT IS A COMMENT and KEEPS whatever comes after.
// Measured in that same attack: a `Co-authored-by: Claude <noreply@anthropic.com>`
// written below the scissors passed the hook with exit 0 and showed up in the
// commit's `%(trailers)` — the very agent the list of 9 named, coming in through
// the door the list was not watching.
//
// The fix is to stop reimplementing git's trailer rules by hand:
//
//   git stripspace --strip-comments   |   git interpret-trailers --parse
//
// The first is the SAME cleanup the commit's `cleanup=strip` applies (it even
// respects a changed `core.commentChar`, which the hand cut did not); the second
// is git saying what it considers a trailer, with line folding already resolved.
// Measured on the two sides that matter:
//
//   trailer below the scissors       -> stripspace+parse FINDS IT (the hole closes)
//   diff pasted by `git commit -v`   -> stripspace+parse DOES NOT (no false +)
//
// `interpret-trailers` ALONE, without the stripspace before it, returns empty for
// the trailer below the scissors — that was measured. Both commands, in this order.
//
// Called by the commit-msg hook with the path of the message file.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NOME_ALLOWLIST = '.rebar-coauthors'

// fileURLToPath, not .pathname: on Windows the pathname arrives as
// "/C:/Users/...", with a slash before the drive letter, and the join comes out
// as C:\C:\Users\...
const AQUI = dirname(fileURLToPath(import.meta.url))

function rodarGit(args, entrada) {
  return execFileSync('git', args, {
    input: entrada,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/**
 * Repository root. Asks git; if git does not answer, falls back to two levels
 * above this file — it lives in `<root>/tooling/hooks/`, and that is the only
 * layout assumption the hook makes.
 */
function raizDoRepo() {
  try {
    const saida = rodarGit(['rev-parse', '--show-toplevel']).trim()
    if (saida) return saida
  } catch {
    /* no git: fall back to the known layout */
  }
  return join(AQUI, '..', '..')
}

const emailDe = (valor) => {
  // `Name <email>` is the normal form; a bare `email` also counts, for whoever
  // writes the allowlist with the address alone. Lowercased because e-mail does
  // not distinguish case.
  const m = /<([^<>]*)>/.exec(valor)
  const bruto = (m ? m[1] : valor).trim().toLowerCase()
  return bruto.includes('@') ? bruto : null
}

/**
 * Reads the allowlist from git's INDEX — what is staged to go into this
 * commit — and not from disk.
 *
 * Until 2026-09-06 it read from disk, with this justification: "at commit-msg
 * time the file may be being edited in this same commit, and demanding that it
 * already be in HEAD would make the commit that ADDS a human to the list
 * impossible". The reason holds; the source is what was wrong. Between HEAD and
 * the disk there is the index, and the index is literally "what is going into
 * this commit": it serves the legitimate case — the addition is staged, so it
 * counts — and it closes the two doors the disk left open.
 *
 *   1. UNTRACKED FILE. A `.rebar-coauthors` that never entered the repository
 *      authorized a co-author, and showed up in no review at all: whoever
 *      clones does not see it, and history does not have it.
 *   2. UNSTAGED LINE. Add the e-mail on disk, commit with the co-author, undo
 *      the line. The commit passed and the repository never had the line.
 *
 * The old defense was "the one who demands tracking is rebar-check, which audits
 * afterwards". Auditing afterwards is what this policy exists in order not to
 * need: a co-authorship trailer is not fixed by a new commit, it stays in
 * history.
 *
 * The disk is still read, but only for the MESSAGE: existing there and not being
 * staged is the most likely honest mistake, and it deserves "run `git add`"
 * instead of "does not exist".
 */
function lerAllowlist(raiz) {
  const caminho = join(raiz, NOME_ALLOWLIST)
  let texto
  try {
    // `:<file>` is the index. Forward slash in the path because this git syntax
    // is not a filesystem path — on Windows the backslash fails.
    texto = rodarGit(['show', `:${NOME_ALLOWLIST}`])
  } catch {
    const noDisco = existsSync(caminho)
    return {
      caminho,
      emails: null,
      erro: noDisco
        ? 'exists on disk but is NOT staged — the commit-msg reads the index, ' +
          `which is what goes into this commit. Run: git add ${NOME_ALLOWLIST}`
        : 'is not in the git index',
    }
  }
  const emails = new Set()
  for (const linha of texto.split(/\r?\n/)) {
    const l = linha.trim()
    if (!l || l.startsWith('#')) continue
    const e = emailDe(l)
    if (e) emails.add(e)
  }
  return { caminho, emails, erro: null }
}

/** The trailers according to git itself. Throws if git is not available. */
function trailersPeloGit(texto) {
  const limpo = rodarGit(['stripspace', '--strip-comments'], texto)
  const saida = rodarGit(['interpret-trailers', '--parse'], limpo)
  return saida
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * Plan B, used only when git does not answer — which inside a git hook is nearly
 * impossible, but "nearly" is not "never" and the hook cannot become a silent
 * `catch` that passes everything.
 *
 * Two deliberate differences from the old cut:
 *  · it does NOT cut at the scissors, because that was exactly where the
 *    smuggling came in;
 *  · it demands the trailer at COLUMN 0. Every diff line that `git commit -v`
 *    pastes comes prefixed by `+`, `-` or a space, so the false positive the
 *    scissors existed to avoid does not reach column 0 anyway.
 *
 * In exchange this parser does not know what a "last paragraph" is, so it may
 * flag a loose `Co-authored-by:` line in the middle of the body that git would
 * not consider a trailer. Erring toward blocking is the right side here.
 */
function trailersPorContaPropria(texto) {
  return texto
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('#'))
    .filter((l) => /^[A-Za-z][A-Za-z0-9-]*:/.test(l))
    .map((l) => l.trim())
}

// ───────────────────────────────────────────────────────────────────── main

const arquivo = process.argv[2]
if (!arquivo) {
  console.error('check-message: missing the path of the message file')
  process.exit(2)
}

let texto
try {
  texto = readFileSync(arquivo, 'utf8')
} catch (e) {
  console.error(`check-message: could not read ${arquivo}: ${e.message}`)
  process.exit(2)
}
// CRLF normalized before anything else: on Windows the message editor writes
// \r\n, and a \r dangling at the end of the value would ruin the e-mail
// comparison without showing up anywhere in the output.
texto = texto.replace(/\r\n/g, '\n')

let trailers
let caiuParaOParserProprio = false
let motivoDaQueda = ''
try {
  trailers = trailersPeloGit(texto)
} catch (e) {
  caiuParaOParserProprio = true
  motivoDaQueda =
    (e.stderr || e.message || '').toString().trim().split('\n')[0] || 'git unavailable'
  trailers = trailersPorContaPropria(texto)
}

if (caiuParaOParserProprio) {
  console.error(
    `[co-authorship] warning: could not use git to read the trailers (${motivoDaQueda}).\n` +
      '                Fell back to the parser in this file, which is dumber than git:\n' +
      '                it understands neither line folding nor "last paragraph".',
  )
}

const coautores = trailers
  .filter((t) => /^co-authored-by\s*:/i.test(t))
  .map((t) => ({ linha: t, email: emailDe(t.slice(t.indexOf(':') + 1)) }))

if (!coautores.length) process.exit(0)

const { caminho, emails, erro } = lerAllowlist(raizDoRepo())

// With no allowlist, EVERY co-author is blocked. Fail-closed: the alternative
// would be to pass everything when the file disappears, and deleting a file
// cannot be the easiest way to turn the rule off.
const forasteiros = emails ? coautores.filter((x) => !x.email || !emails.has(x.email)) : coautores

if (!forasteiros.length) process.exit(0)

console.error('\n[co-authorship] co-authorship trailer outside the human allowlist:\n')
for (const x of forasteiros) console.error(`  ${x.linha}`)

if (erro) {
  console.error(
    `\nAnd there is no allowlist to consult: ${caminho} — ${erro}.\n` +
      'While it does not exist, NO Co-authored-by passes.',
  )
} else {
  console.error(
    `\nAccepted humans (${emails.size}), read from ${caminho}:\n` +
      [...emails].map((e) => `  ${e}`).join('\n'),
  )
}

console.error(
  '\nThe policy is an ALLOWLIST of humans, not a list of AI agents:\n' +
    'the agent list had 9 names and six current agents walked through it\n' +
    'in a single attack. If this co-author is a person on the project, add\n' +
    `their e-mail to ${NOME_ALLOWLIST} — in this same commit, if you like.\n\n` +
    'If it is an AI, drop the line and commit again. At the root, the fix is\n' +
    'not to generate the trailer:\n' +
    '  .claude/settings.json  ->  { "includeCoAuthoredBy": false }\n' +
    'That way the string never exists, and there is no false positive to argue.\n',
)
process.exit(1)
