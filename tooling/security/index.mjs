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

import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { lerRepo, semComentarioNemImport } from '../rebar-check/index.mjs'

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
  // MONTADO, e nao literal: este e o unico padrao da tabela sem `\s` no
  // meio, entao a fonte dele carregaria o proprio texto que ele procura e a
  // regra acusaria este arquivo para sempre. Nos outros a fonte tem `\s*`
  // onde o codigo real tem espaco, e por isso nao se auto-casam.
  //
  // Mesmo idioma que `'ghp_' + 'A1b2...'` em tooling/secret/prove-scan.mjs.
  // A prova `nenhum padrao casa a propria fonte` trava isto.
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
          // O TEXTO CASADO, e nao uma copia dele digitada na tabela. A saida sai
          // igual a de antes -- `rejectUnauthorized: false — TLS without ...` --
          // com a diferenca de que o literal agora e o que ESTA no arquivo
          // auditado, com o espacamento que ele tem de verdade.
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
    return { ...base, estado: 'reprovou', motivo: String(saida) }
  })
  return { dir, nome: r.nome, resultados }
}

const c = process.stdout.isTTY && !process.env.NO_COLOR
const cor = (n, s) => (c ? `[${n}m${s}[0m` : s)
const verde = (s) => cor(32, s)
const vermelho = (s) => cor(31, s)
const fraco = (s) => cor(90, s)

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
    console.error(`rebar-security: unknown option: ${desconhecida}`)
    process.exit(2)
  }
  if (filtro && !REGRAS.some((x) => x.id === filtro)) {
    console.error(`rebar-security: unknown rule: ${filtro}`)
    console.error(`  known: ${REGRAS.map((x) => x.id).join(', ')}`)
    process.exit(2)
  }

  const alvos = argv.filter((a) => !a.startsWith('--'))
  if (!alvos.length) alvos.push('.')

  const avaliacoes = alvos.map((d) => avaliar(d, filtro))
  if (json) console.log(JSON.stringify(avaliacoes, null, 2))
  else avaliacoes.forEach(imprimir)

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
