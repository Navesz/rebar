#!/usr/bin/env node
// gerar.mjs — the MCP is not written by hand. This file is what writes it.
//
// WHY IT EXISTS. The defect the owner lived through in Herz and in BMB Compras
// was not "the MCP was missing": it was that the MCP KEPT SERVING THE OLD RULE
// after the rule changed, and nobody noticed. Measured in this repository on
// 01/09/2026, before this line existed: `mcp/` had 182 lines of server serving
// PROSE from the plan by section, they had NEVER run (the dependencies were
// never installed), NO step of `verify` touched them and NO rule covered them —
// while the `rebar-check` next door already enforced 22 rules the MCP did not
// know about. It is the diagnosis that opens the plan, committed inside the
// repository itself: *"decisão que mora onde nenhuma máquina lê"* [a decision
// that lives where no machine reads].
//
// The design is §7.2 of docs/PLANO.md, and its three lines govern this whole
// file:
//
//   GENERATED ARTIFACT   the MCP server holds no hand-written rule. It reads
//                        `rules.generated.json`, which comes out of here.
//   FRESHNESS GATE       `--verificar` regenerates IN MEMORY and compares with
//                        disk. Diverged, exit 1. It is what makes it impossible
//                        to change the rule and forget the MCP.
//   DERIVED, NEVER       no fact in this file is typed here. Every field of the
//   DUPLICATED           artifact has a SOURCE on disk, and the artifact
//                        carries the sha256 of each one. There are not two
//                        sources to diverge — there is one source and one
//                        projection of it.
//
// ZERO DEPENDENCY, and here that is not preference: this file runs inside the
// ROOT's `verify`, which does not install `mcp/node_modules`. Node built-ins
// only. `mcp/` as a package may have dependencies; the freshness gate may not,
// or the gate starts depending on what it is checking.
//
// Usage:
//   node mcp/generate.mjs              writes mcp/rules.generated.json
//   node mcp/generate.mjs --verificar  regenerates in memory, compares, exits 1 if diverged
//   node mcp/generate.mjs --resumo     prints what would be generated, without writing
//
// Exit codes — same discipline as index.mjs, three things, three codes:
//   0    wrote, or checked and matched
//   1    DIVERGED: disk is not what the source produces today. Regenerate.
//   2    GENERATION itself broke — missing source, unexpected shape, a count
//        that does not add up. It dominates 1 for the same reason 127 dominates
//        1 in index.mjs: you do not accuse the disk with a crooked generator.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// NAMESPACE, and not named imports: `tabelasDePadrao` walks EVERYTHING the rule
// module exports looking for pattern tables. Naming `DESLIGAM` here would be the
// copy §7.2 forbids — the day a second table is born, the generator would have to
// learn its name, and until somebody remembered, the MCP would answer that
// nothing in the artifact governs what that table fails.
import * as MODULO_CHECK from '../tooling/rebar-check/index.mjs'
import * as MODULO_SEGURANCA from '../tooling/security/index.mjs'

const { REGRAS, semComentarioNemImport } = MODULO_CHECK
const { REGRAS: REGRAS_SEGURANCA } = MODULO_SEGURANCA

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..')
const ARTEFATO = join(AQUI, 'rules.generated.json')

/** GENERATION error — exits 2, never 1. See the exit-code block above. */
class Torto extends Error {}
const exigir = (condicao, mensagem) => {
  if (!condicao) throw new Torto(mensagem)
}

// ───────────────────────────────────────────────────────────────── reading

/**
 * Reads a repository file with a stable POSIX path.
 *
 * `join` for the disk (Windows), forward slash for what goes into the artifact:
 * the artifact is compared byte by byte between Windows and Linux on the CI
 * matrix, and a `ferramental\\rebar-check\\index.mjs` written in there would
 * make the freshness gate fail on half the matrix because of the slash, without
 * any fact having changed.
 */
function ler(rel) {
  const abs = join(RAIZ, ...rel.split('/'))
  exigir(existsSync(abs), `missing source: ${rel}`)
  // Normalizes CRLF. The .gitattributes pins LF in the repository, but a
  // checkout with autocrlf on hands CRLF to Node, and then the sha256 and the
  // comment cut would change because of a byte git considers nonexistent.
  return readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
}

const sha256 = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex')

const linhaDe = (texto, indice) => texto.slice(0, indice).split('\n').length

/** Finds the (1-based) line of the pattern's first occurrence, or breaks. */
function linhaDoPadrao(texto, padrao, rel) {
  const m = padrao.exec(texto)
  exigir(m, `${rel}: could not find ${padrao} — the source changed shape`)
  return linhaDe(texto, m.index)
}

// ────────────────────────────────────────────────── comment → the "porque"
//
// THE EXPENSIVE PART, and the choice has a cost that stays written down.
//
// The `porque` of each rule — the measured number that justifies the decision,
// "417 files, one accusation, zero false positives", "43 files with `prova` in
// the name and the rule saw zero" — lives in a COMMENT in `index.mjs`. An AI
// that receives "do not use a phone number in the code" ignores it; one that
// receives "one true positive and zero false ones across 417 files, and the PR
// that tried to move it to an env var was stopped because wa.me ships with no
// recipient" does not ignore it. That is why the comment IS the content, not
// decoration.
//
// THE SHAPE CHOSEN: `porque` is ONE list of paragraphs, each with the LINE it
// came from and an `onde` label — `cabecalho` (between the rule's `{` and the
// `checar:` key, plus the contiguous block above the `{`) or `implementacao`
// (inside the body of `checar`). An empty `//` line separates paragraphs; a
// list item opens its own.
//
// THE FIRST VERSION OF THIS FUNCTION CUT into two fields, `porque` from the
// header only and `notas` from the body, and measurement knocked the cut down:
// of the 22 rules, 15 were left with an EMPTY `porque` — and not for lack of a
// reason. The reason for `hex-cru` ("the naive version of this rule gave 100%
// false positives when measured"), the whole reason for `coautoria-ia` and the
// one for `dependabot` ("four rules disappearing is what turned 9 out of 10
// into 6 out of 6") are written INSIDE `checar`. An artifact that handed
// `porque: []` to 15 of 22 rules would teach the model that those rules are
// arbitrary, which is the exact opposite of what this field exists to do. The
// `onde` label preserves the distinction without hiding the number: whoever
// wants only the decision reason filters by `cabecalho`.
//
// THE COST THAT REMAINS: the classification is POSITIONAL, not semantic. A pure
// implementation comment ("60 characters are enough for the loosest const")
// comes along, labeled `implementacao`. I preferred labeled noise to silence.
//
// THE BETTER SHAPE, and it is not available: a `porque:` field on the rule
// itself. Zero parsing, zero fragility, and `porque` would start being checked
// by prettier and by the `export` itself. It costs 22 edits in `index.mjs`, and
// this front's permission is for ONE touch only (the `export const REGRAS`). It
// is recorded as the next move: when someone can edit the 22 rules, moving
// `porque` inside the object erases this whole block.
//
// THE FRAGILITY is known and CONTAINED, not ignored: the match depends on the
// shape prettier imposes (`  {` at column 2, keys at column 4). If it changes,
// the parser does not silently return empty text — the check further down
// compares the list matched in the TEXT against the IMPORTED `REGRAS` array, id
// by id, and exits 2. A rule vanishing from the artifact is the defect this
// module exists not to commit; it vanishes LOUD or it does not vanish.

/**
 * Strips the comment marker and returns `''` for a line that is only decoration.
 *
 * TWO MARKERS, and only one of them was here. `//` and the ` * ` of a JSDoc
 * block. Measured 2026-09-07: the three rules of tooling/security/index.mjs
 * write their reason in JSDoc, and all three reached the artifact with the whole
 * header gone. `disabled-defense` — the rule that fails a commit for turning
 * CSRF off — arrived with ONE paragraph, and the paragraph was the section
 * ruler above it.
 *
 * A RULER IS DECORATION WHATEVER LABEL RIDES ON IT. The old test demanded the
 * line END in box-drawing characters, and the three in the source end in a
 * section tag (`S1`, `S2`, `S3`). So the run itself is the signal now, and the
 * cut is measured: of the 58 paragraphs in the artifact, exactly 3 carried a run
 * of four or more, and those 3 were the tags. No prose line carries four in a
 * row.
 */
function limparComentario(linha) {
  const m = /^\s*(?:\/\/|\/\*\*|\*\/|\*)\s?(.*?)\s*$/.exec(linha)
  if (!m) return undefined
  // ` * a paragraph that closes its own block */` — the closer is not text.
  const texto = m[1].replace(/\s*\*\/$/, '').replace(/\s+$/, '')
  // The box-drawing block and the em dash go in as \u escapes and not as the
  // glyphs: a character RANGE written with the characters themselves is
  // unreadable in a diff and one keystroke away from an empty class.
  if (!texto || /^[\u2500-\u257f\u2014\-=\u00b7\s]+$/.test(texto)) return ''
  if (/[\u2500-\u257f\u2014]{4,}/.test(texto)) return ''
  return texto
}

/**
 * Joins comment lines into paragraphs. An empty line opens a new paragraph;
 * inside a paragraph the lines become one single sentence, because the break in
 * the source is prettier's printWidth 100 and not the author's.
 *
 * A list item (`1.`, `·`, `-`) opens its own paragraph: without this, the four
 * numbered conclusions of `conteudo-fora-do-codigo` — which are the reason the
 * rule stays heuristic — turned into a 40-line paragraph.
 */
function paragrafos(linhas, onde, primeiraLinha = 0) {
  const saida = []
  let atual = []
  let abriuEm = 0
  const fechar = () => {
    const texto = atual.join(' ').replace(/\s+/g, ' ').trim()
    if (texto) saida.push({ onde, linha: abriuEm, texto })
    atual = []
  }
  linhas.forEach((bruta, i) => {
    const t = limparComentario(bruta)
    if (t === undefined) return
    if (t === '') return fechar()
    if (/^(\d+\.|[·•*]|[-–—] )/.test(t)) fechar()
    if (!atual.length) abriuEm = primeiraLinha + i
    atual.push(t)
  })
  fechar()
  return saida
}

/** The same, when the consumer only wants the text (decisions, no line). */
const soTexto = (ps) => ps.map((p) => p.texto)

/**
 * Matches each rule object in the TEXT of index.mjs and returns header, body and
 * line. It does not interpret code: it only uses the indentation prettier
 * guarantees.
 */
function regrasNoTexto(fonte, rel) {
  const linhas = fonte.split('\n')
  const inicioArray = linhas.findIndex((l) => /^export const REGRAS = \[$/.test(l))
  exigir(
    inicioArray >= 0,
    `${rel}: could not find "export const REGRAS = [" — the generator's touch on the source of truth is gone`,
  )

  const achadas = []
  for (let i = inicioArray + 1; i < linhas.length; i++) {
    if (linhas[i] === ']') break
    if (linhas[i] !== '  {') continue

    // The contiguous `//` block ABOVE the `{` belongs to this rule.
    const acima = []
    for (let j = i - 1; j >= 0 && /^\s*\/\//.test(linhas[j]); j--) acima.unshift(linhas[j])

    let fim = i + 1
    while (fim < linhas.length && linhas[fim] !== '  },') fim++
    exigir(fim < linhas.length, `${rel}: rule object opened at line ${i + 1} and never closed`)

    const dentro = linhas.slice(i + 1, fim)
    const iChecar = dentro.findIndex((l) => /^    checar:/.test(l))
    exigir(iChecar >= 0, `${rel}: rule at line ${i + 1} with no "checar:" key at column 4`)

    const mId = /^    id: '([^']+)',$/.exec(dentro[0])
    exigir(mId, `${rel}: rule at line ${i + 1} does not start with "id: '…'," at column 4`)

    achadas.push({
      id: mId[1],
      linha: i + 2, // the `id:` line, which is where a human will look
      // The body of `checar`, WITHOUT comments, for `tabelasDaRegra` to see
      // which pattern table this rule consults. Without comments because that is
      // what a rule reads (invariant I7 of tooling/security/index.mjs): a table
      // named inside a comment of a NEIGHBOURING rule would hand that rule
      // somebody else's vocabulary, and the MCP would answer the wrong id.
      corpo: semComentarioNemImport(dentro.slice(iChecar).join('\n')),
      porque: [
        // `i + 1 - acima.length` is the (1-based) line of the first `//` of the
        // block above the `{`; `i + 3` is the line of the key right after `id:`.
        ...paragrafos(acima, 'cabecalho', i + 1 - acima.length),
        ...paragrafos(dentro.slice(1, iChecar), 'cabecalho', i + 3),
        ...paragrafos(dentro.slice(iChecar), 'implementacao', i + 2 + iChecar),
      ],
    })
    i = fim
  }
  return achadas
}

// ──────────────────────────────────── pattern table → what the rule looks for
//
// THE DEFECT THIS SECTION CLOSES, measured on 2026-09-07 by asking the server
// the five questions a real agent asks before writing a route:
//
//   rls          "nobody will fail you over it"          true
//   upload       "nobody will fail you over it"          true
//   rate limit   answered with the `readme` rule         NOISE
//   csrf         "nobody will fail you over it"          FALSE. It fails.
//   tls          answered with `disabled-defense`        true, BY ACCIDENT
//
// `disabled-defense` fails a commit that turns CSRF off — the pattern is in the
// table of tooling/security/index.mjs, and the whole table stayed OUT of the
// artifact. So the MCP told the model it could write the exemption and the gate
// then failed the commit: the house's worst case, inverted. `tls` only answered
// because the word had survived inside a prose comment; nothing indexed it.
//
// WHAT BECOMES A TERM, and why not more than this:
//
//   the SECOND COLUMN, whole. It is already an English sentence written to be
//   read by a human ("route with no CSRF protection"), the table's own shape
//   guarantees it is there, and it costs no interpretation.
//
//   the LITERAL WORD RUNS OF THE PATTERN. A regular expression is not text, and
//   there is no honest general way to turn one back into the string it matches:
//   a bracket class is a choice, a quantifier is a quantity, an alternation is
//   two different strings. What CAN be read out with no guessing is the run of
//   characters that are only themselves — and that is where `csrf` lives, and
//   `tls`, and `verify`. A pattern made only of metacharacters yields none, and
//   then the explanation is the whole of what it gives; the check in `montar`
//   makes that case loud instead of silent.
//
// NOTHING IS TYPED HERE. The table is walked out of the module's own exports and
// the rule that owns it is found by the identifier its `checar` names, so a
// second table born tomorrow enters with no edit to this file.

/**
 * Every export of a rule module that IS a pattern table: a non-empty array of
 * `[RegExp, explanation]` pairs. The shape is the declaration — a module has to
 * announce nothing, and a table that is renamed goes on being found.
 */
function tabelasDePadrao(modulo) {
  const tabelas = new Map()
  for (const [nome, valor] of Object.entries(modulo)) {
    if (!Array.isArray(valor) || !valor.length) continue
    const ehTabela = valor.every(
      (e) =>
        Array.isArray(e) && e.length >= 2 && e[0] instanceof RegExp && typeof e[1] === 'string',
    )
    if (ehTabela) tabelas.set(nome, valor)
  }
  return tabelas
}

/**
 * The literal word runs of a pattern, in the order they appear in it.
 *
 * A backslash-letter escape and a bracket class are not text: they become a
 * SEPARATOR, so the words around them do not glue into a word that exists in no
 * file. An escaped literal keeps its character. Runs of a single character are
 * dropped — the zero of a comparison and the letter of a command-line flag are
 * not a subject anybody asks about.
 *
 * THE SEPARATOR MATTERS, and a space is the whole point: joined with the
 * character the pattern actually demands between them, these terms would be a
 * COPY of what the table hunts and the artifact would turn into a sample of the
 * flaw. Same discipline as the split literal in tooling/secret/prove-scan.mjs;
 * tooling/security/prove-table.mjs is what locks it on the other side.
 */
function literaisDoPadrao(re) {
  const semSintaxe = re.source
    .replace(/\\[a-zA-Z]/g, ' ')
    .replace(/\\(.)/g, '$1')
    .replace(/\[[^\]]*\]/g, ' ')
  return [...new Set(semSintaxe.split(/[^A-Za-z0-9_]+/).filter((w) => w.length >= 2))]
}

/** Whether the CODE of a rule names this identifier — split into words, never a substring. */
const menciona = (corpo, nome) => corpo.split(/[^A-Za-z0-9_$]+/).includes(nome)

/**
 * The searchable vocabulary of one rule: `{ literais, explicacoes }`.
 *
 * The two are kept apart because they do not weigh the same at answer time. A
 * literal is the exact string that fails the commit — asked about `csrf`, that
 * IS the answer. An explanation is a sentence about the danger, and its words
 * ("route", "process", "download") also live in a hundred honest questions.
 */
function vocabularioDaRegra(corpo, tabelas) {
  const literais = []
  const explicacoes = []
  for (const [nome, tabela] of tabelas) {
    if (!menciona(corpo, nome)) continue
    for (const [padrao, explicacao] of tabela) {
      literais.push(...literaisDoPadrao(padrao))
      explicacoes.push(explicacao)
    }
  }
  return { literais: [...new Set(literais)], explicacoes: [...new Set(explicacoes)] }
}

// ─────────────────────────────────────────────────────────────────── proofs
//
// `proofs/cases/<regra>[__<variante>]/caso.json` is already JSON, with a
// hand-written `porque` field to explain WHAT THE CASE LOCKS DOWN. It is the
// cheapest source of `porque` in the repository: zero parsing, zero fragility.
//
// It matches by the `regra` field INSIDE caso.json, and not by the folder name:
// the folder name is convention, the field is declaration. A case whose folder
// is named `telefone__digito-cru` but declares another rule is a defect, and
// exits 2.
//
// The `porque` goes in WHOLE, uncut. Cutting here would create the second
// source §7.2 forbids: the artifact would say one thing and the caso.json
// another, and the divergence would be invisible because the cut is
// deterministic. Who decides what fits in an answer is the server, at answer
// time — not the generator, forever.

// `relBase` is a parameter ever since there is more than one rule module: each
// one has its own proofs, and pinning the folder here would make the security
// rules enter the artifact with no proof at all -- silently.
function lerProvas(idsValidos, relBase) {
  const base = join(RAIZ, ...relBase.split('/'))
  exigir(existsSync(base), `missing source: ${relBase}/`)

  const porRegra = new Map(idsValidos.map((id) => [id, []]))
  const arquivos = []
  for (const nome of readdirSync(base).sort()) {
    const dir = join(base, nome)
    if (!statSync(dir).isDirectory()) continue
    const rel = `${relBase}/${nome}/caso.json`
    const bruto = ler(rel)
    arquivos.push({ rel, bruto })

    let caso
    try {
      caso = JSON.parse(bruto)
    } catch (e) {
      throw new Torto(`${rel}: invalid JSON — ${e.message}`)
    }
    exigir(
      porRegra.has(caso.rule),
      `${rel}: declares rule "${caso.rule}", which does not exist in REGRAS`,
    )
    porRegra.get(caso.rule).push({
      caso: nome,
      // Expected state of each side. Omitted, prove.mjs assumes
      // aprovar=passou / reprovar=reprovou — the default is replicated here
      // because it is what says whether the case locks an N/A branch, and an N/A
      // branch is half the value. The literals 'passou' and 'reprovou' stay in
      // Portuguese: they are the state VALUES prove.mjs and the caso.json files
      // carry, not prose — translating them breaks the match with prove.mjs.
      aprovar: existsSync(join(dir, 'pass')) ? caso.aprovar?.estado || 'passou' : null,
      reprovar: existsSync(join(dir, 'fail')) ? caso.reprovar?.estado || 'reprovou' : null,
      porque: caso.why || null,
    })
  }

  // sha256 of every caso.json together, in path order: one single hash for 52
  // files. Changing the `porque` of one case changes this hash and the gate
  // accuses.
  const impressao = sha256(arquivos.map((a) => `${a.rel}\n${a.bruto}`).join('\n'))
  return { porRegra, quantos: arquivos.length, impressao, relBase }
}

// ──────────────────────────────────────────────────── N0–N7 taxonomy

/**
 * The level table from docs/PLANO.md §4. It is markdown, but it is a TABLE —
 * fixed columns, eight rows, one per level. Reading the table is deriving;
 * transcribing what it says into this file would be the copy §7.2 forbids.
 *
 * It breaks if the table disappears or shrinks, and that is the intent: the
 * `nivel` of every rule points at this table, and an artifact that says "N1"
 * without knowing what N1 means hands the model a label with no content.
 */
function lerNiveis(rel) {
  const fonte = ler(rel)
  const linhas = []
  for (const m of fonte.matchAll(/^\|\s*\*\*(N[0-7])\*\*\s*\|(.+?)\|(.+?)\|(.+?)\|\s*$/gm)) {
    const limpo = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').trim()
    linhas.push({
      nivel: m[1],
      oQueE: limpo(m[2]),
      falhaComo: limpo(m[3]).replace(/^"|"$/g, ''),
      custoPorSessao: limpo(m[4]),
      linha: linhaDe(fonte, m.index),
    })
  }
  exigir(
    linhas.length === 8,
    `${rel}: the N0–N7 table of §4 returned ${linhas.length} rows, and not 8`,
  )
  return { linhas, fonte }
}

// ─────────────────────────────────────────────────────────── exit codes

/**
 * The exit codes of rebar-check, from the "Códigos de saída" block in the
 * index.mjs header. That block title stays in Portuguese because it is the
 * ANCHOR the regex below matches inside index.mjs — translating it here blinds
 * the reader; translating it there blinds the generator. An AI that does not
 * know 127 is a DEFECT OF THE CHECKER and not of the repository will "fix" the
 * audited repository — it is the confusion §8.2 of the plan names, and it costs
 * a whole session when it happens.
 */
function lerCodigosDeSaida(fonte, rel) {
  const bloco = /\/\/ Códigos de saída[^\n]*\n((?:\/\/.*\n)+)/.exec(fonte)
  exigir(bloco, `${rel}: could not find the "Códigos de saída" block in the header`)
  const codigos = {}
  for (const m of bloco[1].matchAll(/^\/\/\s+(\d+)\s{2,}(.+)$/gm)) codigos[m[1]] = m[2].trim()
  exigir(
    Object.keys(codigos).length >= 4,
    `${rel}: the exit-code block yielded ${Object.keys(codigos).length} codes, and there are 4`,
  )
  return codigos
}

// ─────────────────────────────────────────────────────────── the gate

/**
 * The steps of `verify`, in the ORDER they run, from verify.config.mjs — which
 * is an ESM module of built-ins, importable without installing anything.
 *
 * `process.execPath` leaves the command and becomes "node": the binary's
 * absolute path is different on every machine, and writing it down would make
 * the freshness gate fail on Linux an artifact generated on Windows without
 * anything having changed.
 */
async function lerPortao(rel) {
  const mod = await import(pathToFileURL(join(RAIZ, ...rel.split('/'))).href)
  const passos = mod.default
  exigir(
    Array.isArray(passos) && passos.length,
    `${rel}: the default export is not a list of gate steps`,
  )
  return passos.map((p, i) => ({
    ordem: i + 1,
    nome: p.nome,
    // `comando:` runs a process and proves itself; `funcao:` is gate code inside
    // the config itself, and what proves it is the `passos` step.
    tipo: p.comando ? 'comando' : 'funcao',
    comando: p.comando ? p.comando.map((a) => (a === process.execPath ? 'node' : a)) : null,
    dica: p.dica || null,
  }))
}

// ──────────────────────────────────────────── decisions already settled
//
// (d) of the contract: the artifact CANNOT be only the list of rules. An AI
// that receives only the 22 rules does not know which stack to write in, nor
// where the content lives, and will propose the env var the owner already
// refused once in `Navesz/Galegos#1`.
//
// Every decision here carries a PROOF extracted from a file — never a sentence
// typed into this generator. And when the decision is already enforced by a
// rule, it POINTS at the rule instead of repeating the reason: repeating would
// create the second source §7.2 forbids.

function lerDecisoes(fonteCheck, relCheck) {
  const relNovo = 'new/index.mjs'
  const fonteNovo = ler(relNovo)
  const relNext = 'new/site/blocks/next.config.ts'
  const fonteNext = ler(relNext)
  const relPkg = 'package.json'
  const pkg = JSON.parse(ler(relPkg))

  // The `//` header of new/index.mjs is where the preset's stack is named with
  // versions. Extracted, not transcribed.
  const cabecalho = []
  for (const l of fonteNovo.split('\n').slice(1)) {
    if (!/^\/\//.test(l)) break
    cabecalho.push(l)
  }
  const stack = soTexto(paragrafos(cabecalho, 'cabecalho'))
  exigir(
    stack.some((p) => /shadcn/i.test(p)),
    `${relNovo}: the header does not mention shadcn — the stack stopped being derivable from here`,
  )

  const argv = /'shadcn@latest',\n\s*'([^']+)'/.exec(fonteNovo)

  return [
    {
      id: 'stack-do-preset-site',
      decisao:
        'The scaffold is delegated to `shadcn create`; rebar applies the `site` preset on top and runs the ruler on the result.',
      prova: {
        arquivo: relNovo,
        linha: linhaDoPadrao(fonteNovo, /'shadcn@latest',/, relNovo),
        trecho: argv ? `shadcn@latest ${argv[1]}` : 'shadcn@latest',
      },
      porque: stack,
      regraQueImpoe: null,
    },
    {
      id: 'saida-estatica',
      decisao:
        'The `site` preset is pure SSG: `output: "export"` and `images.unoptimized`. No server, and that is why the og:image exists for whoever does not execute JavaScript.',
      prova: {
        arquivo: relNext,
        linha: linhaDoPadrao(fonteNext, /output: 'export'/, relNext),
        trecho: "output: 'export' · images.unoptimized: true",
      },
      porque: soTexto(paragrafos(fonteNext.split('\n'), 'cabecalho')),
      regraQueImpoe: null,
    },
    {
      id: 'conteudo-em-conteudo-json',
      decisao:
        'Content lives in `conteudo/*.json`, schema-validated — not inside `src/` nor `app/`.',
      prova: {
        arquivo: relCheck,
        linha: linhaDoPadrao(fonteCheck, /^const RE_CONTEUDO_JSON = /m, relCheck),
        trecho: 'RE_CONTEUDO_JSON',
      },
      porque: null, // it is in the rule; repeating here would be the second source
      regraQueImpoe: 'conteudo-fora-do-codigo',
    },
    {
      id: 'identidade-do-negocio-e-conteudo-nao-env',
      decisao:
        'Phone, CNPJ and address are validated CONTENT. They are not code and they are NOT environment variables: with an env var the build passes, the deploy ships and `wa.me` generates a link with no recipient.',
      prova: {
        arquivo: relCheck,
        linha: linhaDoPadrao(fonteCheck, /id: 'phone',/, relCheck),
        trecho: "id: 'phone'",
      },
      porque: null,
      regraQueImpoe: 'telefone',
    },
    {
      id: 'zero-dependencia-no-que-confere',
      decisao:
        'The root has no production dependency, and what checks does not depend on what is checked. It is what makes `npx github:Navesz/rebar` run without installing anything.',
      prova: {
        arquivo: relPkg,
        linha: linhaDoPadrao(ler(relPkg), /"devDependencies"/, relPkg),
        trecho: `dependencies: ${Object.keys(pkg.dependencies || {}).length} · devDependencies: ${Object.keys(pkg.devDependencies || {}).join(', ')}`,
      },
      porque: null,
      regraQueImpoe: null,
    },
  ]
}

// ────────────────────────────────────────────────────────── references
//
// What exists only in PROSE does not go in copied — it goes in as a POINTER.
// And the pointer is DERIVED too: the line is looked up by the section title,
// not typed. A hand-typed `PLANO.md:517` rots on the first paragraph inserted
// above it, and the AI that follows the reference does not find it, does not
// ask, and rewrites from scratch — which is exactly what the `elos` step of
// `verify` exists to prevent in the documentation.
//
// The section titles below are ANCHORS, not prose: they are matched verbatim
// against docs/PLANO.md and docs/STACK.md, which are Portuguese documents.
// `## O critério único` stays as written for that reason — translate it here
// and the lookup finds nothing and the generation exits 2.

function lerReferencias() {
  const alvos = [
    ['o-mcp-que-se-regenera', 'docs/PLANO.md', /^## 7\.2 /m, 'the design of this module'],
    ['taxonomia-n0-n7', 'docs/PLANO.md', /^# 4\. /m, 'what each level means and the mother rule'],
    [
      'as-tres-camadas-de-porta',
      'docs/PLANO.md',
      /^## 7\.3 /m,
      'verify, hook, CI and branch protection',
    ],
    [
      'o-perfil-e-o-compilador',
      'docs/PLANO.md',
      /^## 7\.1 /m,
      'where the generated-artifact idea comes from',
    ],
    ['objetivos-do-repositorio', 'docs/PLANO.md', /^# 0\. /m, 'the six declared objectives'],
    [
      'stack-postgres',
      'docs/STACK.md',
      /^## O critério único/m,
      'the criterion that knocked down Prisma and NestJS',
    ],
  ]
  return alvos.map(([assunto, rel, padrao, oQueEsta]) => ({
    assunto,
    arquivo: rel,
    linha: linhaDoPadrao(ler(rel), padrao, rel),
    oQueEsta,
  }))
}

// ──────────────────────────────────────────────────────── the assembly
//
// THE CORE IS MANDATORY, THE REST IS BY SECTION — and this is rebar-check's own
// N/A doctrine, applied here.
//
// `tooling/rebar-check/index.mjs` and `package.json` are the core: without them
// there is no artifact at all, and generation exits 2. The other sources — the
// PLANO, the verify.config, the new/, the proof cases — each command one
// SECTION. If one of them is not in THIS tree, the section is not generated AND
// NOT COMPARED.
//
// The reason is the same as `na()` in index.mjs, and the comment over there
// holds word for word: *"O nada não conforma; o nada não se aplica."* [Nothing
// does not conform; nothing does not apply] — the same sentence the `na()`
// comment carries in English today. A tree that does not have `docs/PLANO.md`
// cannot testify about the taxonomy. Shouting "DIVERGED" there would be accusing
// the artifact of being old when what is incomplete is the tree — the wrong
// accusation, pointing at whoever did not err, which is the same mistake 127
// against 1 exists not to commit.
//
// WHERE THIS SHOWS UP FOR REAL: the proof of the `mcp` step
// (`tooling/verify/prove-steps.mjs`) assembles a temporary root with ONLY
// `mcp/`, `tooling/rebar-check/` without `proofs/`, and the `package.json` — on
// purpose, to prove that the freshness gate runs without `mcp/node_modules`. In
// that root, four of the six sources do not exist. Without N/A by section, that
// proof would ask the generator to accuse the absence of files it itself decided
// not to copy.
//
// THE COST, and it is real: if someone DELETES `docs/PLANO.md` from the real
// repository, this gate stops checking the taxonomy. What is left against that
// is the ⚠ line printed here naming the section and the source that went
// missing, and the `elos` step of `verify`, which fails a broken link to a file
// that vanished. It is written down because it is the crack this decision opens,
// and not the one it closes.

const existe = (rel) => existsSync(join(RAIZ, ...rel.split('/')))

/**
 * The derived sections and the source of each one. `podar()` uses the SAME table
 * to strip from the disk side what this tree could not regenerate — the table is
 * the single source of that correspondence, so generating and comparing do not
 * diverge.
 */
const SECOES = [
  { chave: 'niveis', exige: ['docs/PLANO.md'] },
  { chave: 'gate', exige: ['verify.config.mjs'] },
  {
    chave: 'decisoesFechadas',
    exige: ['new/index.mjs', 'new/site/blocks/next.config.ts', 'package.json'],
  },
  { chave: 'referencias', exige: ['docs/PLANO.md', 'docs/STACK.md'] },
  { chave: 'proofs', exige: ['tooling/rebar-check/proofs/cases'] },
]

/** Sections THIS tree cannot generate, with what was missing for each one. */
function secoesAusentes() {
  return SECOES.map((s) => ({ ...s, faltando: s.exige.filter((r) => !existe(r)) })).filter(
    (s) => s.faltando.length,
  )
}

/**
 * Strips from the DISK object exactly what this tree did not regenerate, so the
 * comparison does not confuse "the artifact is old" with "this tree is partial".
 */
function podar(valor, ausentes) {
  if (!ausentes.length) return valor
  const copia = JSON.parse(JSON.stringify(valor))
  const chaves = new Set(ausentes.map((s) => s.chave))
  for (const c of chaves) {
    if (c === 'proofs') for (const r of copia.regras || []) delete r.provas
    else delete copia[c]
  }
  // `fontes` follows along, and for TWO reasons that are not the same one.
  //
  // The first is the old one: an entry whose file is not in this tree leaves
  // both sides, or the sha256 of a missing file becomes a divergence by itself.
  //
  // The second appeared when `package.json` became a source of
  // `decisoesFechadas`. In a tree without `new/index.mjs` the whole section is
  // skipped, and the generated side emits no source of it at all — but the
  // `package.json` EXISTS, so it survived the existence filter and the
  // comparison accused "old artifact" where there was a partial tree. It is the
  // confusion this function exists to avoid, and the correction is the same
  // table: the source of a skipped section leaves too.
  if (Array.isArray(copia.fontes)) {
    const deSecaoPulada = new Set(SECOES.filter((s) => chaves.has(s.chave)).flatMap((s) => s.exige))
    copia.fontes = copia.fontes.filter((f) => {
      const partes = f.arquivo.split(' · ').map((a) => a.trim().replace(/\/$/, ''))
      return partes.every((rel) => existe(rel) && !deSecaoPulada.has(rel))
    })
  }
  return copia
}

async function montar() {
  const relCheck = 'tooling/rebar-check/index.mjs'
  const relConfig = 'verify.config.mjs'
  const relPlano = 'docs/PLANO.md'
  const fonteCheck = ler(relCheck)
  const ausentes = secoesAusentes()
  const pulou = (chave) => ausentes.some((s) => s.chave === chave)

  // THE CHECK THAT MAKES DRIFT LOUD. The text and the imported module have to
  // agree on the whole list, id by id, in the same order. If prettier changes
  // the indentation or someone writes a rule in a new shape, the parser matches
  // one fewer — and without this comparison the rule would vanish from the
  // artifact in SILENCE, which is the exact defect this module exists not to
  // commit.
  const niveis = pulou('niveis') ? null : lerNiveis(relPlano)

  // TWO RULE MODULES, and the second is the reason this list exists.
  //
  // `rebar-check` says whether the repository is in the right shape;
  // `rebar-security` says whether it has a security flaw. They are different
  // binaries, with their own proofs, but ONE source of truth for the AI: without
  // this the MCP served 23 rules and zero security ones, and whoever opened the
  // project was warned about the `.editorconfig` and not about the tracked
  // `.env`.
  //
  // Each module carries the path to its OWN proofs. Pinning the folder would
  // make the second one's rules enter the artifact with no proof, silently.
  const MODULOS = [
    {
      modulo: 'rebar-check',
      rel: relCheck,
      REGRAS,
      exporta: MODULO_CHECK,
      provas: 'tooling/rebar-check/proofs/cases',
    },
    {
      modulo: 'rebar-security',
      rel: 'tooling/security/index.mjs',
      REGRAS: REGRAS_SEGURANCA,
      exporta: MODULO_SEGURANCA,
      provas: 'tooling/security/proofs/cases',
    },
  ]

  const regras = []
  const provasPorModulo = []
  for (const m of MODULOS) {
    const fonte = ler(m.rel)

    // THE CHECK THAT MAKES DRIFT LOUD, now per module. The text and the imported
    // array have to agree on the whole list, id by id, in the same order. If
    // prettier changes the indentation or someone writes a rule in a new shape,
    // the parser matches one fewer — and without this comparison the rule would
    // vanish from the artifact in SILENCE, which is the defect this module
    // exists not to commit.
    const noTexto = regrasNoTexto(fonte, m.rel)
    const idsTexto = noTexto.map((r) => r.id).join(',')
    const idsModulo = m.REGRAS.map((r) => r.id).join(',')
    exigir(
      idsTexto === idsModulo,
      `${m.rel}: the text matched ${noTexto.length} rule(s) and the module exports ${m.REGRAS.length}.\n` +
        `  text  : ${idsTexto}\n  module: ${idsModulo}`,
    )

    const provas = pulou('proofs')
      ? null
      : lerProvas(
          m.REGRAS.map((r) => r.id),
          m.provas,
        )
    if (provas) provasPorModulo.push(provas)

    const tabelas = tabelasDePadrao(m.exporta)

    for (const [i, regra] of m.REGRAS.entries()) {
      const t = noTexto[i]
      exigir(
        regra.titulo && regra.classe && regra.nivel,
        `rule ${regra.id}: mandatory field is empty`,
      )
      exigir(
        !niveis || niveis.linhas.some((n) => n.nivel === regra.nivel),
        `rule ${regra.id}: level "${regra.nivel}" does not exist in the N0–N7 table`,
      )
      const consultaTabela = [...tabelas.keys()].some((nome) => menciona(t.corpo, nome))
      const vocabulario = vocabularioDaRegra(t.corpo, tabelas)
      // A RULE THAT CONSULTS A TABLE AND INDEXES NOTHING IS THE csrf DEFECT BACK:
      // it fails a commit over words, and no question can reach it, so the MCP
      // answers that nobody will fail you over them. Breaking generation here is
      // louder than serving that, and 2 is the code for a crooked generator — not 1.
      exigir(
        !consultaTabela || vocabulario.literais.length + vocabulario.explicacoes.length > 0,
        `rule ${regra.id}: consults a pattern table and yields no searchable term. ` +
          'The MCP would answer that nothing in the artifact governs what this rule fails.',
      )
      regras.push({
        id: regra.id,
        // Which binary runs this rule. Without the field, the AI reads
        // "env-committed" in the artifact and calls `npx rebar`, which does not
        // know it.
        modulo: m.modulo,
        titulo: regra.titulo,
        // deterministic knocks the exit code down; heuristic only informs. It is
        // the difference between "does not land on main" and "gets noted".
        classe: regra.classe,
        nivel: regra.nivel,
        fonte: { arquivo: m.rel, linha: t.linha },
        porque: t.porque,
        // WHAT THE RULE LITERALLY LOOKS FOR. Absent, the model asks "csrf",
        // hears that nothing in the artifact decides it, writes the exemption
        // and the gate fails the commit. The field is omitted — not emitted
        // empty — for the rules that consult no table, because an empty object
        // on 25 of 26 rules is 25 lines saying nothing.
        ...(vocabulario.literais.length || vocabulario.explicacoes.length
          ? { termos: vocabulario }
          : {}),
        ...(provas ? { provas: provas.porRegra.get(regra.id) } : {}),
      })
    }
  }

  const provas = provasPorModulo.length
    ? {
        quantos: provasPorModulo.reduce((s, p) => s + p.quantos, 0),
        impressao: sha256(provasPorModulo.map((p) => `${p.relBase}\n${p.impressao}`).join('\n')),
        relBase: provasPorModulo.map((p) => p.relBase).join(' · '),
      }
    : null

  const porNivel = (n) => regras.filter((r) => r.nivel === n).map((r) => r.id)

  const artefato = {
    $aviso:
      'GENERATED ARTIFACT by mcp/generate.mjs. Do not edit by hand: the freshness step regenerates it in memory and fails if the disk diverges. To change anything here, change the SOURCE listed in `fontes` and run `node mcp/generate.mjs`.',
    gerador: 'mcp/generate.mjs',
    formato: 1,
    fontes: [
      {
        arquivo: relCheck,
        sha256: sha256(fonteCheck),
        daqui: 'the format rules, the why of each one and the exit codes',
      },
      {
        arquivo: 'tooling/security/index.mjs',
        sha256: sha256(ler('tooling/security/index.mjs')),
        daqui: 'the security rules and the why of each one',
      },
      ...(pulou('gate')
        ? []
        : [
            {
              arquivo: relConfig,
              sha256: sha256(ler(relConfig)),
              daqui: 'the gate steps, in order',
            },
          ]),
      ...(niveis
        ? [
            {
              arquivo: relPlano,
              sha256: sha256(niveis.fonte),
              daqui: 'the N0–N7 taxonomy and the prose pointers',
            },
          ]
        : []),
      ...(provas
        ? [
            {
              arquivo: `${provas.relBase}/`,
              sha256: provas.impressao,
              daqui: `the why of each of the ${provas.quantos} proof cases`,
            },
          ]
        : []),
      // THE SOURCES OF THE DECISIONS, which were missing here and that is why
      // the server could say "up to date" while serving an old decision.
      // `lerDecisoes` reads all three, and what is not in this list is not
      // checked on every answer.
      ...(pulou('decisoesFechadas')
        ? []
        : [
            {
              arquivo: 'new/index.mjs',
              sha256: sha256(ler('new/index.mjs')),
              daqui: 'the stack of the `site` preset, extracted from the header',
            },
            {
              arquivo: 'new/site/blocks/next.config.ts',
              sha256: sha256(ler('new/site/blocks/next.config.ts')),
              daqui: 'the static-export decision of the preset',
            },
            {
              arquivo: 'package.json',
              sha256: sha256(ler('package.json')),
              daqui: 'the zero-dependency-at-the-root decision',
            },
          ]),
      ...(pulou('referencias') || !existe('docs/STACK.md')
        ? []
        : [
            {
              arquivo: 'docs/STACK.md',
              sha256: sha256(ler('docs/STACK.md')),
              daqui: 'the prose pointers of the stack',
            },
          ]),
    ],
    codigosDeSaida: lerCodigosDeSaida(fonteCheck, relCheck),
    ...(niveis
      ? {
          niveis: niveis.linhas.map((n) => ({
            nivel: n.nivel,
            oQueE: n.oQueE,
            falhaComo: n.falhaComo,
            custoPorSessao: n.custoPorSessao,
            fonte: { arquivo: relPlano, linha: n.linha },
            regras: porNivel(n.nivel),
          })),
        }
      : {}),
    regras,
    ...(pulou('gate')
      ? {}
      : { gate: { comando: 'npm run verify', passos: await lerPortao(relConfig) } }),
    ...(pulou('decisoesFechadas') ? {} : { decisoesFechadas: lerDecisoes(fonteCheck, relCheck) }),
    ...(pulou('referencias') ? {} : { referencias: lerReferencias() }),
    // What this artifact deliberately does NOT carry. It exists so the server
    // never invents: asked about this, it points at the reference instead of
    // answering from memory — and model memory is the source §7.2 classifies as
    // *"decisão que mora onde nenhuma máquina lê"* [a decision that lives where
    // no machine reads].
    naoDerivado: [
      'The text of the 120 panel decisions (§5 of the PLANO): it is prose, and copied prose diverges again. It is in `referencias`.',
      'The database and contract decisions of docs/STACK.md: nothing in rebar enforces them today, and an artifact that promises what nobody checks is the false promise this repository hunts.',
      'The implementation of each rule: the artifact says WHAT and WHY. The HOW is the `checar` in index.mjs, and it changes without the decision changing.',
    ],
  }
  // ── WHAT MAKES THIS UNREPEATABLE ───────────────────────────────────────────
  //
  // `SECOES` already declares what each derived section READS. `fontes` is what
  // the server CHECKS by sha256 on every answer. The two lists were
  // independent, and that is how three files read by `lerDecisoes` stayed out
  // of the check: a decision changed in `new/index.mjs`, the artifact went old,
  // and the server checked the four that had not changed and answered "up to
  // date" with the old decision pasted into the answer.
  //
  // Adding the three entries fixes today's case. This check fixes tomorrow's: a
  // generated section with a file outside `fontes` stops GENERATION, here, with
  // the file's name. The next section is not born blind.
  //
  // The `split(' · ')` is not a whim: the proof-cases entry holds TWO roots in
  // one single field ("a/cases · b/cases/"), because the two become one single
  // tree hash. Comparing without splitting would say neither of the two is
  // registered, and the check would fail itself.
  const registradas = new Set(
    artefato.fontes.flatMap((f) => f.arquivo.split(' · ').map((a) => a.trim().replace(/\/$/, ''))),
  )
  for (const s of SECOES) {
    if (ausentes.some((a) => a.chave === s.chave)) continue
    const fora = s.exige.filter((rel) => !registradas.has(rel))
    exigir(
      fora.length === 0,
      `section "${s.chave}" is derived from ${fora.join(', ')}, and that file (or those files) is ` +
        `not in \`fontes\`. The server checks freshness by the sha256 of what is in \`fontes\`: ` +
        `outside it, the change is not seen and it answers "up to date" with old content.`,
    )
  }

  return { artefato, ausentes }
}

// ─────────────────────────────────────────────────── compare and write

/** Difference by path. Returns a list of `{ onde, disco, gerado }`. */
function diferencas(disco, gerado, onde = '') {
  const iguais = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  if (iguais(disco, gerado)) return []
  const objeto = (v) => v && typeof v === 'object'
  if (!objeto(disco) || !objeto(gerado) || Array.isArray(disco) !== Array.isArray(gerado)) {
    return [{ onde: onde || '(raiz)', disco, gerado }]
  }
  const chaves = [...new Set([...Object.keys(disco), ...Object.keys(gerado)])]
  const saida = []
  for (const k of chaves) {
    // In a list of identified objects, the path uses the IDENTIFIER and not the
    // index: `rules.telefone.titulo` says what changed, `rules.17.titulo` tells
    // you to go count. And the index still lies when what changed was the ORDER
    // — inserting a rule in the middle would make every rule below it show up as
    // divergent by position, and the 5 useful diff lines would vanish in the
    // middle of 40.
    const rotulo =
      Array.isArray(disco) && (disco[k]?.id || gerado[k]?.id)
        ? disco[k]?.id || gerado[k]?.id
        : Array.isArray(disco) && (disco[k]?.nome || gerado[k]?.nome)
          ? disco[k]?.nome || gerado[k]?.nome
          : Array.isArray(disco) && (disco[k]?.arquivo || gerado[k]?.arquivo)
            ? disco[k]?.arquivo || gerado[k]?.arquivo
            : k
    const sub = onde ? `${onde}.${rotulo}` : rotulo
    if (!(k in disco)) saida.push({ onde: sub, disco: '(missing on disk)', gerado: gerado[k] })
    else if (!(k in gerado))
      saida.push({ onde: sub, disco: disco[k], gerado: '(no longer generated)' })
    else saida.push(...diferencas(disco[k], gerado[k], sub))
  }
  return saida
}

const recortar = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  // 160 characters: it fits one line of the owner's terminal with the
  // `limite: 12` of the `mcp` step, and a 2,800-character `porque` pasted whole
  // into the verify output hides the other 19 divergences.
  return s === undefined ? 'undefined' : s.length > 160 ? `${s.slice(0, 160)}…` : s
}

/**
 * The comparison is SEMANTIC — JSON parsed on both sides — and not byte by byte.
 *
 * The artifact is in .prettierignore, so the generator is the sole owner of the
 * bytes and a byte-by-byte gate would even work. Semantic anyway, for two
 * measured reasons: (1) byte by byte accuses "the MCP is old" when someone only
 * touched whitespace, and a wrong hint is worse than no hint; (2) it is how we
 * found out the reverse path does not close — with prettier commanding too,
 * `node mcp/generate.mjs` left the `formato` step red, and the cycle "I changed
 * the rule, I regenerated, it is green" needed two commands. FACT is this
 * module's business; bytes are the business of whoever writes the file.
 */
function lerDoDisco() {
  if (!existsSync(ARTEFATO)) return { ausente: true }
  try {
    return { valor: JSON.parse(readFileSync(ARTEFATO, 'utf8')) }
  } catch (e) {
    return { ilegivel: e.message }
  }
}

/** ⚠ naming each section THIS tree could not generate, and what was missing. */
function avisarAusentes(ausentes) {
  for (const s of ausentes) {
    console.error(
      `  ⚠ section "${s.chave}" NOT generated nor checked — ${s.faltando.join(', ')} missing in this tree`,
    )
  }
}

function escrever(gerado, ausentes) {
  avisarAusentes(ausentes)
  const disco = lerDoDisco()
  // Idempotent on purpose: if the fact is already the same, the bytes on disk
  // stay as they are. It is what lets prettier own the formatting without a
  // regeneration undoing its work on the next commit.
  if (disco.valor && !diferencas(podar(disco.valor, ausentes), gerado).length) {
    console.log(`mcp/gerar: ${relative(RAIZ, ARTEFATO).replace(/\\/g, '/')} is already up to date`)
    return
  }
  writeFileSync(ARTEFATO, `${JSON.stringify(gerado, null, 2)}\n`, 'utf8')
  console.log(
    `mcp/gerar: wrote ${relative(RAIZ, ARTEFATO).replace(/\\/g, '/')} · ` +
      `${gerado.regras.length} rules · ${gerado.niveis?.length ?? '–'} levels · ` +
      `${gerado.gate?.passos.length ?? '–'} steps · ` +
      `${gerado.regras.reduce((n, r) => n + (r.provas?.length || 0), 0)} proofs`,
  )
}

function conferir(gerado, ausentes) {
  avisarAusentes(ausentes)
  const disco = lerDoDisco()
  if (disco.ausente) {
    console.error('mcp/gerar --verificar: DIVERGED — mcp/rules.generated.json does not exist.')
    console.error('  The MCP server would read nothing. Run: node mcp/generate.mjs')
    return 1
  }
  if (disco.ilegivel) {
    console.error(`mcp/gerar --verificar: DIVERGED — the artifact is not JSON: ${disco.ilegivel}`)
    console.error('  Run: node mcp/generate.mjs')
    return 1
  }
  // `podar` strips from the DISK side exactly what this tree did not regenerate.
  // Without it, the temporary root of the `mcp` step's proof — which copies only
  // `mcp/`, the `rebar-check` without `proofs/` and the `package.json` — would
  // accuse the artifact of being old because of four files it itself decided not
  // to copy.
  const diff = diferencas(podar(disco.valor, ausentes), gerado)
  if (!diff.length) {
    console.log(
      `mcp/gerar --verificar: up to date · ${gerado.regras.length} rules · ` +
        `${gerado.fontes.length} source(s) checked` +
        `${ausentes.length ? ` · ${ausentes.length} section(s) N/A in this tree` : ''}`,
    )
    return 0
  }
  // THE LINE POINTER GOES TO THE END, AND BECOMES ONE SINGLE LINE. Measured:
  // inserting ONE comment at the top of index.mjs shifts `fonte.linha` of all 22
  // rules and of every `porque` paragraph — 60 divergences, of which 59 are the
  // same news ("the file grew one line") and ONE is the fact that changed. With
  // the raw order, the ceiling of 20 blew before reaching the fact, and the
  // gate's output became noise. A rule that shouts the irrelevant teaches people
  // to turn the whole output off — it is the same arithmetic that keeps
  // `conteudo-fora-do-codigo` heuristic.
  const ponteiro = (d) => /\.linha$/.test(d.onde)
  const fatos = diff.filter((d) => !ponteiro(d))
  const ponteiros = diff.filter(ponteiro)

  console.error(
    `mcp/gerar --verificar: DIVERGED. ${fatos.length} fact(s) changed` +
      `${ponteiros.length ? ` and ${ponteiros.length} line pointer(s) shifted` : ''}. ` +
      'The source changed and the MCP artifact fell behind.',
  )
  // UNIFIED-DIFF SHAPE, and it is not aesthetics. The `mcp` step of
  // verify.config.mjs extracts from this command's output with
  // `/^\s*(erro|✗|[-+] )/` — without the `- `/`+ ` at the start nothing matches
  // and the runner falls back to the last lines, which would be the repair line
  // and not what changed. The PATH goes on every line, and not in a header
  // above: a line extracted alone has to say alone which field diverged.
  //
  // Ceiling of 12, the same `limite` the `mcp` step of `verify` imposes on this
  // command's output: printing more is writing for a cut that already cut.
  for (const d of fatos.slice(0, 12)) {
    console.error(`  - ${d.onde} = ${recortar(d.disco)}   (disk, old)`)
    console.error(`  + ${d.onde} = ${recortar(d.gerado)}   (source, today)`)
  }
  if (fatos.length > 12) console.error(`  … and ${fatos.length - 12} more fact(s).`)
  if (ponteiros.length) {
    const exemplo = ponteiros[0]
    console.error(
      `  - ${ponteiros.length} line pointer(s), e.g. ${exemplo.onde}: ` +
        `${exemplo.disco} → ${exemplo.gerado}   (the file changed size above them)`,
    )
  }
  console.error('\n  Fix: node mcp/generate.mjs')
  return 1
}

// ────────────────────────────────────────────────────────────────── program

const args = process.argv.slice(2)
const desconhecidas = args.filter((a) => !/^--(verificar|resumo)$/.test(a))
if (desconhecidas.length) {
  console.error(`mcp/gerar: unknown option: ${desconhecidas.join(', ')}`)
  console.error('usage: node mcp/generate.mjs [--verificar | --resumo]')
  process.exit(2)
}

let gerado
let ausentes
try {
  ;({ artefato: gerado, ausentes } = await montar())
} catch (e) {
  // Crooked generation exits 2 and NEVER 1: 1 means "the disk is old,
  // regenerate", and ordering a regeneration with a broken generator is ordering
  // garbage written over the good artifact.
  console.error(`mcp/gerar: GENERATION broke — ${e.message}`)
  if (!(e instanceof Torto)) console.error(e.stack)
  process.exit(2)
}

if (args.includes('--resumo')) {
  avisarAusentes(ausentes)
  console.log(`${gerado.regras.length} rules · ${gerado.niveis?.length ?? 0} levels`)
  for (const r of gerado.regras) {
    // `'determinística'` stays in Portuguese: it is the `classe` VALUE the rule
    // modules export, not prose. Translate it here and every rule prints as `h`.
    console.log(
      `  ${r.nivel} ${r.classe === 'determinística' ? 'D' : 'h'} ${r.id.padEnd(24)}` +
        ` porque:${String(r.porque.filter((x) => x.onde === 'cabecalho').length).padStart(2)}c` +
        `+${String(r.porque.filter((x) => x.onde === 'implementacao').length).padStart(2)}i` +
        ` provas:${String(r.provas?.length ?? 0).padStart(2)}`,
    )
  }
  process.exit(0)
}

process.exit(
  args.includes('--verificar') ? conferir(gerado, ausentes) : (escrever(gerado, ausentes), 0),
)
