#!/usr/bin/env node
// measure-content — recount the number that REFUSES the promotion of
// `conteudo-fora-do-codigo` to deterministic.
//
// WHY THIS FILE EXISTS
//
// The rule's comment, in `index.mjs`, carries the most expensive number in the
// repository: "Measured after: 37 of 262 (14,1%)" of interface vocabulary among
// the phrases the content-literal definition finds. It is that 14,1% that keeps
// the rule heuristic — with 14% noise, a deterministic rule blocks merges over
// a field label.
//
// The number did not reproduce. The audit of 31/08 arrived at another count
// because it REIMPLEMENTED the definition from the comment's prose instead of
// running it, and this repository has already published a wrong number four
// times by the same mechanism. The right answer is not to recount by hand a
// fifth time: it is to make it RECOUNTABLE. Hence this file's rule:
//
//   NOTHING OF THE DEFINITION IS REWRITTEN HERE. It all comes by `import`
//   from index.mjs.
//
// `frasesDeConteudo`, `PRECO_BRL`, `RE_JSX`, `semComentarioNemImport` and
// `lerRepo` are imported, not copied, because the definition is the FIVE
// together and not just the phrase matcher: `lerRepo` is what decides WHICH
// files go in (production, no test, no fixture, no `.rebarignore`, no
// `new/gate/` and no `new/site/blocks/`), and the denominator is half the
// number. Reimplementing the file selection is exactly the mistake the audit
// made. If one day the definition changes in index.mjs, this tool changes with
// it without anyone touching it — and that is what it is for.
//
// ABOUT THE CLASSIFICATION, AND WHY IT MAY ENUMERATE HERE
//
// "Interface vocabulary" was a classification done BY HAND, phrase by phrase.
// A hand does not reproduce. Here it is a LEXICON — named markers, written
// below, that anyone reads and contests by line number.
//
// This looks like it contradicts the comment of the rule itself, which refuses
// to enumerate instruction verbs. It does not, and the difference is what the
// thing DOES with the finding: the rule ACCUSES, and an incomplete list that
// accuses fails a merge over a field label; this file COUNTS, and an incomplete
// list that counts gets wrong a number that comes printed next to the list that
// produced it. Enumeration is forbidden in enforcement and is the only honest
// form of measurement. That is why `--frases` exists: to disagree with a
// classification here is to point at a line, not at an impression.
//
// This file NEVER fails. It exits 0 on any measurement — it measures, it does
// not judge. It exits 2 only when the invocation is wrong, which is no
// measurement at all.
//
// Usage:
//   node tooling/rebar-check/measure-content.mjs <repo>...
//   node tooling/rebar-check/measure-content.mjs <repo>... --frases
//   node tooling/rebar-check/measure-content.mjs <repo>... --json

import { PRECO_BRL, RE_JSX, frasesDeConteudo, lerRepo, semComentarioNemImport } from './index.mjs'

// ──────────────────────────────────────────────────────────── the lexicon

/**
 * The markers of INTERFACE VOCABULARY: text that talks about the PROGRAM
 * instead of talking about the business. Order matters — the phrase is
 * classified by the first one that matches, so that the sum per marker closes
 * with the total without counting twice.
 *
 * Each one came out of phrases that are in the sample, and the note says which,
 * so that nobody has to guess where the pattern came from.
 *
 * THE REGEXES BELOW STAY IN PORTUGUESE, and so do the phrases quoted in their
 * notes. Neither is prose: the regexes are the vocabulary this instrument LOOKS
 * FOR inside the audited repositories, and the quotes are the literal text
 * those repositories carry — the specimens each pattern was measured against.
 * Those repositories are Brazilian. Translated, either one measures nothing.
 */
const MARCADORES = [
  {
    id: 'estado-vazio',
    // The phrase ANNOUNCES absence of data, and it only counts at its START:
    // "Nenhuma proposta salva ainda." is an empty state, "Cada peça recebe
    // número próprio", which mentions nenhum in the middle, is not. Six in the
    // sample, all of them empty screens.
    re: /^nenhum(a|as|s)?\b/i,
  },
  {
    id: 'estado-de-erro',
    // Talks about a failure of the program. "Não deu para gerar o arquivo:" and
    // "Não deu para falar com o Banco Central agora" are the two shapes in
    // ducado; "Um erro escapou de todos os tratamentos" is LinhaK's boundary.
    re: /não deu para|não foi possível|\berros?\b|falhou|falha ao|tente novamente|deu errado/i,
  },
  {
    id: 'carregando',
    // Transient state. ZERO in the sample of the 11 — the "Carregando o índice
    // de preços…" the audit named lives in a `<div>`, and `<div>` is not in
    // PROSA. The marker stays because its absence is the finding.
    re: /\bcarregando\b|\baguarde\b|\bprocessando\b|\bsalvando\b|\benviando\b/i,
  },
  {
    id: 'instrucao',
    // INTERACTION imperative, in the second person. Two restrictions, and both
    // cost measurement:
    //
    // THE INFINITIVE STAYS OUT, and it is the infinitive that separates the two
    // voices in this sample: "Selecionar tampo inteiro, plano e com umidade
    // adequada" is a step in making furniture, "Selecione a forma de pagamento"
    // is operating the screen. The five task lines of DÉCIMA's notebook
    // ("Pesquisar", "Definir", "Verificar", "Confirmar", "Manter") leave through
    // here, with no written exception.
    //
    // THE VERB HAS TO OPEN A CLAUSE — start of the phrase, after strong
    // punctuation, or after an em dash/middle dot, which is how an interface
    // label chains ("Opcional — use para tirar ingredientes"). Matching at any
    // position cost TWO false positives in the 262, both on a verb/noun
    // homograph: "Reflexo difuso, toque visual nobre e melhor tolerância a
    // micro-riscos" and "Abaixo disso, use apenas o símbolo e preserve o ponto
    // central". It cost no true positive: "Verifique sua conexão e recarregue a
    // página" comes in through "Verifique", which opens the second clause.
    re: /(?:^|[.!?:…]\s+|[—–·]\s*)(?:clique|toque|arraste|solte|digite|informe|preencha|complete|selecione|escolha|marque|adicione|registre|baixe|envie|salve|confira|verifique|recarregue|use|monte|role|aperte|pressione|abra|feche|tente|refaça)\b/iu,
  },
  {
    id: 'nome-do-programa',
    // The text calls the program by its name. A short lexicon on purpose: every
    // term here was checked against the 262, and the ones that accused business
    // prose STAYED OUT — `servidor` matched "o servidor preenche" from LinhaK's
    // KWP2000 protocol, and `campos` matched "Este documento define os campos"
    // from DÉCIMA's certificate. A term that errs in a sample of 262 does not
    // get in. `programa` came in through the same test and passed: a single
    // match in the 262 ("Seu cofre sai daqui em formato que outro programa
    // abre"), zero false positives.
    re: /\b(o app|este aplicativo|esta página|a página|as telas|a navegação|javascript|navegador|deste computador|neste computador|neste aparelho|os filtros|a busca|programa)\b/i,
  },
  {
    id: 'sobra-de-depuracao',
    // Text that was never written for the visitor. One in the sample:
    // "esperado 0x… · recebido 0x …", which the rule's own comment had already
    // named when it checked the six lowercase phrases.
    re: /\b0x/,
  },
]

function classificar(frase) {
  for (const m of MARCADORES) if (m.re.test(frase)) return m.id
  return null
}

// ───────────────────────────────────────────────────────── the measurement

/**
 * Applies the IMPORTED definition to a repository. The two shapes of literal
 * come out separately because they count differently in index.mjs, and joining
 * them is how the total gets wrong: the PHRASE counts one per text node, the
 * PRICE counts one per FILE (`PRECO_BRL.exec` runs once and the finding is
 * registered once).
 */
function medir(dir) {
  const r = lerRepo(dir)
  if (r.erro) return { dir, erro: r.erro }

  let arquivosJsx = 0
  let arquivosComPreco = 0
  const frases = []

  for (const [rel, bruto] of r.fontes) {
    const t = semComentarioNemImport(bruto)
    if (PRECO_BRL.test(t)) arquivosComPreco++
    if (!RE_JSX.test(rel)) continue
    arquivosJsx++
    for (const frase of frasesDeConteudo(t)) {
      frases.push({ rel, frase, marcador: classificar(frase) })
    }
  }

  return { dir, nome: r.nome, arquivosJsx, arquivosComPreco, frases }
}

// ────────────────────────────────────────────────────────────────── output

const cor = process.stdout.isTTY && !process.env.NO_COLOR
const forte = (s) => (cor ? `\x1b[1m${s}\x1b[0m` : s)
const fraco = (s) => (cor ? `\x1b[2m${s}\x1b[0m` : s)

/** Percentage with ONE decimal and a comma: the format the number was published in. */
function pct(parte, todo) {
  if (!todo) return '—'
  return `${(Math.round((parte / todo) * 1000) / 10).toFixed(1).replace('.', ',')}%`
}

function imprimir(medicoes, mostrarFrases) {
  const larg = Math.max(12, ...medicoes.map((m) => (m.nome ?? m.dir).length))
  console.log(
    `\n${forte('repository'.padEnd(larg))}  ${forte('jsx'.padStart(5))} ` +
      `${forte('phrases'.padStart(7))} ${forte('prices'.padStart(7))} ` +
      `${forte('literals'.padStart(9))} ${forte('interface'.padStart(10))} ` +
      `${forte('content'.padStart(9))}`,
  )

  const tot = { jsx: 0, frases: 0, precos: 0, interface: 0 }
  for (const m of medicoes) {
    if (m.erro) {
      console.log(`${(m.nome ?? m.dir).padEnd(larg)}  ${m.erro}`)
      continue
    }
    const vi = m.frases.filter((f) => f.marcador).length
    tot.jsx += m.arquivosJsx
    tot.frases += m.frases.length
    tot.precos += m.arquivosComPreco
    tot.interface += vi
    console.log(
      `${m.nome.padEnd(larg)}  ${String(m.arquivosJsx).padStart(5)} ` +
        `${String(m.frases.length).padStart(7)} ${String(m.arquivosComPreco).padStart(7)} ` +
        `${String(m.frases.length + m.arquivosComPreco).padStart(9)} ` +
        `${String(vi).padStart(10)} ${String(m.frases.length - vi).padStart(9)}`,
    )
  }

  console.log(
    `${forte('TOTAL'.padEnd(larg))}  ${String(tot.jsx).padStart(5)} ` +
      `${String(tot.frases).padStart(7)} ${String(tot.precos).padStart(7)} ` +
      `${String(tot.frases + tot.precos).padStart(9)} ` +
      `${String(tot.interface).padStart(10)} ` +
      `${String(tot.frases - tot.interface).padStart(9)}`,
  )

  console.log(
    `\n${forte('interface vocabulary')}: ${tot.interface} of ${tot.frases} = ` +
      forte(pct(tot.interface, tot.frases)),
  )
  console.log(fraco('  (the number that refuses the promotion of the rule to deterministic)'))

  console.log(`\n${forte('by marker')}`)
  for (const mk of MARCADORES) {
    const n = medicoes.reduce(
      (s, m) => s + (m.frases ?? []).filter((f) => f.marcador === mk.id).length,
      0,
    )
    console.log(`  ${mk.id.padEnd(20)} ${String(n).padStart(4)}  ${fraco(String(mk.re))}`)
  }

  if (mostrarFrases) {
    console.log(`\n${forte('the phrases, one by one')}`)
    let i = 0
    for (const m of medicoes) {
      for (const f of m.frases ?? []) {
        i++
        const rot = f.marcador ? `[${f.marcador}]` : '[content]'
        console.log(`${String(i).padStart(4)} ${rot.padEnd(22)} ${m.nome}/${f.rel}`)
        console.log(`     ${f.frase}`)
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────── main

const args = process.argv.slice(2)
const mostrarFrases = args.includes('--frases')
const json = args.includes('--json')
const desconhecidas = args.filter((a) => a.startsWith('--') && !/^--(frases|json)$/.test(a))
const alvos = args.filter((a) => !a.startsWith('--'))

if (desconhecidas.length) {
  console.error(`measure-content: unknown option: ${desconhecidas.join(', ')}`)
  process.exit(2)
}
if (!alvos.length) {
  console.error('measure-content: give at least one repository.')
  console.error('usage: node tooling/rebar-check/measure-content.mjs <repo>... [--frases] [--json]')
  process.exit(2)
}

const medicoes = alvos.map(medir)

if (json) {
  const frases = medicoes.flatMap((m) => m.frases ?? [])
  console.log(
    JSON.stringify(
      {
        marcadores: MARCADORES.map((m) => ({ id: m.id, re: String(m.re) })),
        repositorios: medicoes,
        total: {
          frases: frases.length,
          interface: frases.filter((f) => f.marcador).length,
          precos: medicoes.reduce((s, m) => s + (m.arquivosComPreco ?? 0), 0),
        },
      },
      null,
      2,
    ),
  )
} else {
  imprimir(medicoes, mostrarFrases)
}

// Measuring is not judging: it exits 0 even when a target is not a git
// repository — its error shows up on its own line, and the rest of the table
// still holds.
process.exit(0)
