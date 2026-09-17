#!/usr/bin/env node
// Minimal MCP client — the proof that this server RUNS.
//
// Why it exists. The mcp/ module had been on disk for days, 1,412 lines, and had
// NEVER been executed: the dependencies were never installed, no verifier step
// touched it, no rule covered it. "Written" is not "working", and the only way to
// know the difference is to speak the real protocol to it.
//
// ZERO DEPENDENCIES on purpose, even inside a package that is allowed to have them:
// if I proved the server with the SDK the server itself uses, an SDK defect would
// cancel itself out on both sides. Only node:child_process and JSON come in here.
//
// The MCP stdio transport is JSON-RPC 2.0 in NDJSON — one message per line, no
// Content-Length framing (that is LSP, and confusing the two is the classic mistake).
//
//   node mcp/src/prova-cliente.mjs           runs everything and prints the real traffic
//   node mcp/src/prova-cliente.mjs --curto   only the verdict of each step

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The client lives outside this file since the second proof that needs it showed
// up — the one for the MCP the generator writes, in new/gate/prove-mcp-template.mjs.
import { Cliente, PROTOCOLO, textoDa, trecho } from './cliente-jsonrpc.mjs'
import { CONTROLES, IGNORAVEIS, naFaixa } from './texto-seguro.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SERVIDOR = join(AQUI, 'index.mjs')
const RAIZ = join(AQUI, '..', '..')
const LEIAME = join(AQUI, '..', 'README.md')
const CURTO = process.argv.includes('--curto')

let falhas = 0

function titulo(t) {
  console.log(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`)
}

function ok(t) {
  console.log(`  ok   ${t}`)
}

function falhou(t) {
  falhas++
  console.log(`  FAIL ${t}`)
}

// ─────────────────────────────────────────────────────────────────────────────

titulo('1 · handshake: initialize + notifications/initialized')
const cliente = new Cliente(SERVIDOR, { curto: CURTO })

const ini = await cliente.pedir('initialize', {
  protocolVersion: PROTOCOLO,
  capabilities: {},
  clientInfo: { name: 'prova-cliente-do-rebar', version: '1.0.0' },
})
if (ini.result?.serverInfo?.name === 'rebar') {
  ok(
    `server "${ini.result.serverInfo.name}" v${ini.result.serverInfo.version}, protocol ${ini.result.protocolVersion}`,
  )
} else {
  falhou(`initialize returned ${JSON.stringify(ini).slice(0, 200)}`)
}
cliente.notificar('notifications/initialized', {})

titulo('2 · tools/list')
const lista = await cliente.pedir('tools/list', {})
const ferramentas = lista.result?.tools ?? []
if (ferramentas.length) {
  for (const f of ferramentas) {
    console.log(
      `  · ${f.name.padEnd(16)} ${Object.keys(f.inputSchema?.properties ?? {}).join(', ') || '(no parameter)'}`,
    )
  }
  ok(`${ferramentas.length} tools`)
} else {
  falhou('tools/list came back empty')
}

// ─────────────────────────────────────────────────────────────────────────────
// 2b · THE SANITIZER THE SERVER IMPORTS IS THE CANONICAL ONE.
//
// mcp/src/texto-seguro.mjs is a byte copy of tooling/security/texto-seguro.mjs, and
// a copy, not an import, only because the gate's mirrors of mcp/ carry no
// tooling/security. A copy nobody compares is a second table that ages on its own:
// a code point added to the canonical table would be escaped by the CLI and handed
// raw to the model by this server. sha256 of the bytes, so a line ending counts too.
titulo('2b · the sanitizer copy in mcp/src is byte-identical to tooling/security')
{
  const sha = (caminho) => createHash('sha256').update(readFileSync(caminho)).digest('hex')
  const copia = sha(join(AQUI, 'texto-seguro.mjs'))
  const canonico = sha(join(RAIZ, 'tooling', 'security', 'texto-seguro.mjs'))
  if (copia === canonico) {
    ok(`sha256 ${copia.slice(0, 12)}… on both sides`)
  } else {
    falhou(
      `mcp/src/texto-seguro.mjs (sha256 ${copia.slice(0, 12)}…) diverged from ` +
        `tooling/security/texto-seguro.mjs (sha256 ${canonico.slice(0, 12)}…). ` +
        'Copy the canonical file over the copy, byte for byte.',
    )
  }
}

// Every call below is a question a real AI asks in this repository, and the
// FOURTH field is the contract: must this call return `isError`, yes or no?
//
// Before, it did not exist, and `isError` only picked a LABEL — the one of the
// single case that was supposed to fail ("expected for a wrong id"), glued onto
// any error from any of the seven. If `rebar_verificar` started blowing up, the
// proof printed an `ok` with that borrowed label and the `mcp-server` step went
// green over a broken server.
//
// The `assunto` values stay in Portuguese: they are queries run against the
// artifact's own text, which is Portuguese. "color" would find nothing.
//
// The FIFTH field is what the text itself must carry, beyond isError: `vizinho`
// for a failing rebar_porque (the neighbour it must offer, or null for none),
// `contem` and `semContem` for lines the answer must and must not have. A
// scoreboard can come back without isError and still be the wrong scoreboard.
const chamadas = [
  ['rebar_regras', { nivel: 'N1' }, 'what fails me when I touch the CSS/lint', false],
  ['rebar_porque', { id: 'raw-hex' }, 'hex-cru failed; why is that a rule', false],
  ['rebar_decidir', { assunto: 'cor' }, 'can I write #fff in the component?', false],
  ['rebar_decidir', { assunto: 'mongodb' }, 'a subject rebar does NOT govern', false],
  ['rebar_portao', { passo: 'mcp' }, 'the gate step that guards this module', false],
  // `{}` runs BOTH rulers. It ran rebar-check alone, and the security rules, the
  // prompt-injection ones among them, were out of reach of the one call an agent
  // makes before saying it is done.
  [
    'rebar_verificar',
    {},
    'the rulers on rebar itself',
    false,
    { contem: [/^ruler: rebar-check$/m, /^ruler: rebar-security$/m, /^overall exit=/m] },
  ],
  [
    'rebar_verificar',
    { regua: 'rebar-security' },
    'the security ruler alone',
    false,
    {
      contem: [/^ruler: rebar-security$/m, /^command: node tooling\/security\/index\.mjs --json /m],
      semContem: [/^ruler: rebar-check$/m],
    },
  ],
  // A security rule id went to rebar-check, which answered exit 2 "unknown rule"
  // (measured with disabled-defense). The artifact records the module of every
  // rule, and the id alone now picks the binary. disabled-defense proves the
  // routing on a rule that exists today; hidden-unicode is the rule this routing
  // was built for.
  [
    'rebar_verificar',
    { regra: 'disabled-defense' },
    'a security rule runs on the ruler that owns it',
    false,
    { contem: [/^command: node tooling\/security\/index\.mjs --json --rule=disabled-defense /m] },
  ],
  [
    'rebar_verificar',
    { regra: 'hidden-unicode' },
    'the hidden-Unicode rule runs on rebar-security',
    false,
    { contem: [/^command: node tooling\/security\/index\.mjs --json --rule=hidden-unicode /m] },
  ],
  [
    'rebar_verificar',
    { regra: 'hidden-unicode', regua: 'rebar-check' },
    'a rule and a ruler that does not own it: fails naming the owner',
    true,
    { contem: [/is a rebar-security rule/] },
  ],
  // The two that must fail, one for each side of the `sugestao.length ? ... : ''`
  // in consultas.mjs — the branch that suggests and the one with nothing to suggest.
  //
  // The probe here was `hex-crus`, with the label "precisa sugerir" [needs to
  // suggest]. Measured: it stopped suggesting when the ids went to English, because
  // `hex-` stopped being a prefix of anything — the rule became `raw-hex`. The label
  // went on claiming the opposite for six commits, because nothing compared. It is
  // the defect this contract exists to keep from happening again.
  [
    'rebar_porque',
    { id: 'raw-hexx' },
    'typo of a real id: fails suggesting the right one',
    true,
    { vizinho: 'raw-hex' },
  ],
  [
    'rebar_porque',
    { id: 'mongodb-driver' },
    'an id from another world: fails without inventing a neighbour',
    true,
    { vizinho: null },
  ],
]

for (const [
  nome,
  args,
  pergunta,
  erroEsperado,
  { vizinho, contem = [], semContem = [] } = {},
] of chamadas) {
  titulo(`3 · tools/call ${nome} ${JSON.stringify(args)}   — "${pergunta}"`)
  const r = await cliente.pedir('tools/call', { name: nome, arguments: args })
  const t = textoDa(r)
  if (!t) {
    falhou(`${nome} returned no text`)
    continue
  }
  console.log(`\n${trecho(t, nome === 'rebar_porque' ? 2200 : 1600)}\n`)

  // THE CONTRACT, in both directions. Failing when it should not is a broken
  // server; NOT failing when it should is a contract silently loosened — a
  // nonexistent `id` that starts answering as if it existed is worse than the error.
  const erro = r.result.isError === true
  if (erro !== erroEsperado) {
    falhou(
      erroEsperado
        ? `${nome} ${JSON.stringify(args)} should have returned isError and did not — the contract loosened`
        : `${nome} ${JSON.stringify(args)} returned isError and should not have:\n${trecho(t, 400)}`,
    )
    continue
  }

  // Whoever fails has an EXTRA contract: "do not die" is half of it. The fifth
  // field says which neighbour the message must offer — or `null` when offering
  // none is the right answer. Both directions matter: suggesting nothing when there
  // was a similar id leaves the agent with no way out, and inventing a neighbour for
  // an id from another subject is worse than the dry error.
  // The lines the text must and must not carry. They are the wording index.mjs
  // prints (`ruler:`, `command:`, `overall exit=`, `is a <ruler> rule`); reword it
  // there and reword it here, or these contracts quietly stop being checked.
  const faltou = contem.find((re) => !re.test(t))
  if (faltou) {
    falhou(`${nome} ${JSON.stringify(args)} did not carry ${faltou}:\n${trecho(t, 600)}`)
    continue
  }
  const sobrou = semContem.find((re) => re.test(t))
  if (sobrou) {
    falhou(
      `${nome} ${JSON.stringify(args)} carried ${sobrou}, which it must not:\n${trecho(t, 600)}`,
    )
    continue
  }

  // The neighbour contract belongs to rebar_porque: the other failing calls say
  // what is wrong through `contem` above.
  if (erroEsperado && nome === 'rebar_porque') {
    // This pattern is the message consultas.mjs prints. Reword it there and reword
    // it here, or this contract quietly stops being checked.
    const sugeriu = /^Close to that: (.+)$/m.exec(t)
    if (vizinho && sugeriu?.[1]?.split(', ').includes(vizinho) !== true) {
      falhou(`${nome} should have pointed at "${vizinho}" and did not:\n${trecho(t, 400)}`)
      continue
    }
    if (!vizinho && sugeriu) {
      falhou(`${nome} invented a neighbour for an id from another subject: ${sugeriu[0]}`)
      continue
    }
    // The escape hatch always exists, with a neighbour or without one.
    if (!t.includes('rebar_regras')) {
      falhou(`${nome} failed without saying where the full list is`)
      continue
    }
  }

  ok(`${nome}${erro ? ' (isError, as the contract demands)' : ''} — ${t.length} characters`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b · THE SUBJECT REACHES THE RULE THAT FAILS IT — AND NO OTHER.
//
// THE WORST CASE OF THE HOUSE, INVERTED, and it was live. Measured on
// 2026-09-07 against the artifact, asking the five questions an agent asks
// before writing a route:
//
//   rls          "nobody will fail you over it"          true
//   upload       "nobody will fail you over it"          true
//   rate limit   answered with the `readme` rule         noise
//   csrf         "nobody will fail you over it"          FALSE. It fails.
//   tls          answered with `disabled-defense`        true, by accident
//
// `disabled-defense` fails the commit for an exemption written into a route.
// The MCP said nobody would. An agent that believes it writes the line, and the
// gate then refuses the commit it was told to make — a ruler that lies in the
// direction of permission is worse than no ruler at all.
//
// THE THREE CONTRACTS HERE, and the third is the one that keeps the other two
// honest:
//
//   1. a subject that HAS a rule reaches that rule. `csrf` and `tls` through the
//      prose of the header, `curl` through the literals of the pattern table
//      (that word is in no paragraph of the artifact), `helmet` through the
//      second column of the table (that word is in no pattern). Four subjects,
//      three different paths in, so a regression names which one broke.
//
//   2. a subject that has NO rule is not answered with a rule. `rate limit` came
//      back with `readme`, because the word "limit" shows up in the paragraph
//      about README size. A wrong answer wearing the face of an answer is worse
//      than "I do not know".
//
//   3. THE APPROVING SIDE — and without it this whole block passes by making
//      everything match everything. `rls` and `upload` are real subjects rebar
//      does not govern, and the honest answer to them is that nobody will fail
//      you over it. A change that made every subject find a rule would satisfy
//      contracts 1 and 2 and would break here.
titulo('3b · rebar_decidir: the subject reaches the rule that fails it, and no other')

// `exige` — this id has to come out FIRST, and "first" is not decoration: the
// answer is sorted by strength and cut at eight, so an id that is merely present
// can be the ninth and never printed. It is also what catches the vocabulary
// coming untied from the table that feeds it — every rule would then answer
// every subject the table covers, "present" would go on passing, and the model
// would be handed eight innocent rules with the guilty one somewhere below.
//
// `silencio` — the honest "nothing decides it", with no rule at all. `proibe` —
// this id must not be among the answers, and it is read off the ANSWER lines
// only: the empty answer also NAMES what it threw away, and taking that name for
// an answer would make this contract congratulate the defect it exists to catch.
const DECIDIR = [
  [
    'csrf',
    { exige: 'disabled-defense' },
    'the rule fails the exemption; the MCP said nobody would',
  ],
  ['tls', { exige: 'disabled-defense' }, 'it used to hit by accident, through a word in a comment'],
  ['curl', { exige: 'disabled-defense' }, 'only the LITERALS of the pattern table can answer this'],
  ['helmet', { exige: 'disabled-defense' }, 'only the EXPLANATION column can answer this'],
  [
    'rate limit',
    { silencio: true, proibe: 'readme' },
    'nothing checks it; it answered with README',
  ],
  ['rls', { silencio: true }, 'the approving side: a real subject rebar does not govern'],
  ['upload', { silencio: true }, 'the approving side, second case'],
]

// The id of every entry the answer OFFERS AS AN ANSWER. The line shape is the
// one consultas.mjs prints (`[rule N1 det] id — title`); reword it there and
// reword it here, or this contract quietly stops being checked.
const idsRespondidos = (t) =>
  t
    .split('\n')
    .filter((l) => /^\[/.test(l))
    .map((l) => l.replace(/^\[[^\]]*\]\s*/, '').split(' ')[0])

for (const [assunto, contrato, pergunta] of DECIDIR) {
  const r = await cliente.pedir('tools/call', {
    name: 'rebar_decidir',
    arguments: { assunto },
  })
  const t = textoDa(r) ?? ''
  if (!CURTO) console.log(`\n  ── "${assunto}" — ${pergunta}\n${trecho(t, 500)}`)
  const respondidos = idsRespondidos(t)

  if (contrato.exige && respondidos[0] !== contrato.exige) {
    falhou(
      `rebar_decidir "${assunto}" did not come out strongest as ${contrato.exige} — it answered ` +
        `${respondidos.length ? respondidos.join(', ') : 'nothing at all'}. ` +
        'The gate fails this and the MCP says it does not.',
    )
    continue
  }
  if (contrato.proibe && respondidos.includes(contrato.proibe)) {
    falhou(
      `rebar_decidir "${assunto}" answered with ${contrato.proibe}, which decides nothing about it`,
    )
    continue
  }
  if (contrato.silencio) {
    // Both patterns are the wording consultas.mjs prints for the empty answer.
    if (!/^Nothing in the artifact decides/m.test(t)) {
      falhou(`rebar_decidir "${assunto}" invented an answer: ${trecho(t, 200)}`)
      continue
    }
    if (respondidos.length) {
      falhou(
        `rebar_decidir "${assunto}" said nothing decides it AND listed ${respondidos.join(', ')}`,
      )
      continue
    }
    if (!/nobody will fail you over it/.test(t)) {
      falhou(`rebar_decidir "${assunto}" said nothing decides it without saying that is safe`)
      continue
    }
  }
  ok(`"${assunto}" — ${contrato.exige ? contrato.exige : 'nothing decides it, and it says so'}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3c · THE VOCABULARY IS NOT A COPY OF WHAT THE TABLE HUNTS.
//
// The literals of `disabled-defense` enter the artifact so that a question can
// reach the rule. Written back joined by the character the pattern demands
// between them, they would BE the flaw — and `rules.generated.json` is a tracked
// file like any other. It is the invariant tooling/security/prove-table.mjs
// holds over the rules file and over itself; here it is held over the artifact
// the generator writes, which is the third place those literals now live.
titulo('3c · the vocabulary derived from the table is not a copy of what the table hunts')
{
  // EVERY TABLE, not only DESLIGAM. The prompt-injection rules bring tables of
  // their own (flags, keys, escaped forms), and each of them is exported and
  // derived into the artifact the same way. A check that names one table goes
  // green over the tables nobody named. The shape is the one mcp/generate.mjs
  // `tabelasDePadrao` derives from: a non-empty array whose every row starts with
  // a RegExp and its explanation; a third column (the date a row was verified)
  // does not change what it is.
  const modulo = await import(pathToFileURL(join(RAIZ, 'tooling', 'security', 'index.mjs')).href)
  const tabelas = Object.entries(modulo).filter(
    ([, valor]) =>
      Array.isArray(valor) &&
      valor.length > 0 &&
      valor.every(
        (e) =>
          Array.isArray(e) && e.length >= 2 && e[0] instanceof RegExp && typeof e[1] === 'string',
      ),
  )
  const padroes = tabelas.flatMap(([nomeDaTabela, linhas]) =>
    linhas.map(([padrao]) => [nomeDaTabela, padrao]),
  )
  const artefato = JSON.parse(readFileSync(join(RAIZ, 'mcp', 'rules.generated.json'), 'utf8'))
  const comTermos = artefato.regras.filter((r) => r.termos?.literais?.length)

  // THE VOCABULARY, and not the whole file, and the difference is measured.
  //
  // Run over `rules.generated.json` whole, this check goes red on a `porque`
  // paragraph — the one where the source comment of `disabled-defense` QUOTES
  // the literal to explain where the printed text comes from. That quote has
  // been in the artifact since before this vocabulary existed, and the ruler
  // does not read it: `codigo()` only sees the code extensions, and the artifact
  // is JSON. A proof stricter than the rule accuses what the rule forgives, and
  // that is not rigour, it is noise — the same sentence tooling/security/
  // prove-table.mjs carries about its own first version.
  //
  // What IS new here is the vocabulary, and it is the one that could turn the
  // artifact into a sample of the flaw: joined with the character the pattern
  // demands between the words instead of a space, every literal would match.
  const vocabulario = comTermos
    .map((r) => [...r.termos.literais, ...(r.termos.explicacoes ?? [])].join(' '))
    .join('\n')
  const achados = padroes.filter(([, padrao]) => {
    // A `g` or `y` pattern keeps `lastIndex` between calls, and a second test
    // would start mid-text and miss.
    padrao.lastIndex = 0
    return padrao.test(vocabulario)
  })
  if (!tabelas.length) {
    falhou(
      'tooling/security/index.mjs exports no [RegExp, explanation] table: the check below ' +
        'would pass by emptiness',
    )
  } else if (achados.length) {
    falhou(
      `the derived vocabulary matches ${achados.length} pattern(s) of the ruler: ` +
        `${achados.map(([t, x]) => `${t} ${x.source}`).join(' · ')}. ` +
        'Every repository that vendors the artifact would start failing over the MCP.',
    )
  } else {
    ok(
      `${padroes.length} patterns in ${tabelas.length} table(s) (${tabelas.map(([t]) => t).join(', ')}), ` +
        'and none of them matches the vocabulary',
    )
  }

  // The other direction, and without it the check above passes by emptiness: a
  // generator that stopped deriving the tables would match nothing AND answer
  // nothing. 3b would go red on `curl` and `helmet`; this says which FIELD went
  // missing instead of leaving it to be guessed from a query that stopped working.
  if (!comTermos.length) {
    falhou('no rule in the artifact carries `termos`: the pattern tables stopped being derived')
  } else {
    ok(
      `${comTermos.length} rule(s) carry the literals they fail over: ` +
        comTermos.map((r) => r.id).join(', '),
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3d · THE REASON OF A RULE SURVIVES THE EXTRACTION.
//
// Measured on 2026-09-07: `disabled-defense`, `env-committed` and
// `password-without-kdf` write their reason in a JSDoc block, and the extractor
// read only `//`. All three reached the artifact with ONE header paragraph, and
// that paragraph was the section ruler drawn above them — so `rebar_porque`
// answered the rule about CSRF with a row of box-drawing characters, and
// `rebar_decidir` had nothing of the header to search.
//
// TWO CONTRACTS, one per half of that defect, and they are read off the SOURCE
// and off the artifact independently of the generator's own parser: a proof that
// asks the generator whether the generator worked proves nothing.
titulo('3d · a rule whose source writes a header does not reach the artifact without one')
{
  const artefato = JSON.parse(readFileSync(join(RAIZ, 'mcp', 'rules.generated.json'), 'utf8'))
  const cache = new Map()
  const fonteDe = (rel) => {
    if (!cache.has(rel)) {
      const bruto = readFileSync(join(RAIZ, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n')
      cache.set(rel, bruto.split('\n'))
    }
    return cache.get(rel)
  }

  // 1. THE HEADER IS NOT LOST. `fonte.linha` is the `id:` line; from the next one
  // to the `checar:` key is the header the source wrote. If there is a comment in
  // there in ANY of its two markers, the artifact has to carry a `cabecalho`
  // paragraph — whatever marker the author chose.
  const mudos = []
  for (const r of artefato.regras) {
    const linhas = fonteDe(r.fonte.arquivo)
    const entre = []
    for (let i = r.fonte.linha; i < linhas.length && !/^ {4}checar:/.test(linhas[i]); i++) {
      entre.push(linhas[i])
    }
    const escreveu = entre.some((l) => /^\s*(\/\/|\/\*|\*)/.test(l))
    const carrega = (r.porque ?? []).some((p) => p.onde === 'cabecalho')
    if (escreveu && !carrega) mudos.push(`${r.id} (${r.fonte.arquivo}:${r.fonte.linha})`)
  }
  if (mudos.length) {
    falhou(
      `${mudos.length} rule(s) with a header in the source and none in the artifact: ` +
        `${mudos.join(', ')}. The MCP would present them as arbitrary, which is the ` +
        'one thing the `porque` field exists not to do.',
    )
  } else {
    ok(`${artefato.regras.length} rules, and every written header reached the artifact`)
  }

  // 2. AND WHAT REACHES IT IS NOT DECORATION. The ruler that used to be the whole
  // reason of the three security rules is navigation for the human eye; as a
  // paragraph it taught the model that the rule is about the letter S.
  const enfeites = []
  for (const r of artefato.regras) {
    for (const p of r.porque ?? []) {
      if (/[─-╿—]{4,}/.test(p.texto) || /^[─-╿—\-=·\s]+$/.test(p.texto)) {
        enfeites.push(`${r.id}:${p.linha}`)
      }
    }
  }
  if (enfeites.length) {
    falhou(
      `${enfeites.length} paragraph(s) of \`porque\` are a ruler, not a reason: ${enfeites.join(', ')}`,
    )
  } else {
    const total = artefato.regras.reduce((n, r) => n + (r.porque?.length ?? 0), 0)
    ok(`${total} paragraphs of \`porque\`, and not one of them is a frame line`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3e · EVERY SECURITY RULE REACHES THE ARTIFACT WITH A PROOF.
//
// mcp/generate.mjs finds proofs only through `caso.json` folders. A rule proved
// only by a test that builds its input at runtime reaches the artifact with
// `provas: []`, and rebar_porque then prints no "what locks this rule" for it: the
// model is told the reason and never shown that anything holds it. The
// prompt-injection rules are the ones most tempted to live without a case folder,
// because their inputs are invisible characters nobody wants on disk.
titulo('3e · every rebar-security rule in the artifact carries at least one proof')
{
  const artefato = JSON.parse(readFileSync(join(RAIZ, 'mcp', 'rules.generated.json'), 'utf8'))
  const seguranca = artefato.regras.filter((r) => r.modulo === 'rebar-security')
  const semProva = seguranca.filter((r) => !(r.provas?.length >= 1)).map((r) => r.id)
  if (!seguranca.length) {
    falhou('the artifact has no rule with modulo rebar-security: the module fell out of MODULOS')
  } else if (semProva.length) {
    falhou(
      `${semProva.length} rebar-security rule(s) with no proof in the artifact: ` +
        `${semProva.join(', ')}. Give each one a caso.json folder under tooling/security/proofs/cases.`,
    )
  } else {
    ok(`${seguranca.length} rebar-security rules, each with at least one proof`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3f · REPOSITORY TEXT REACHES THE MODEL ESCAPED.
//
// Measured before the sanitizer existed: a commit trailer carrying U+200B, U+E0041
// and U+001B reached `content[].text` raw through the ai-coauthorship motivo. An MCP
// answer is read by an agent as text, so an invisible character that crosses this
// boundary is an instruction nobody sees.
//
// The repository is built here, at runtime, and the name with the invisible
// character lives only in the git index: the blobs go in through `hash-object
// --stdin`, the tree through `update-index --index-info`, and the commit message
// through `commit-tree`'s stdin. So no file with an invisible character is ever
// written to a disk, no argv and no logged request carries one (argv encoding on
// Linux was not verified, and the gate prints this proof's traffic), and the only
// code points in this source are the hex numbers below.
//
// Two answers, and over both text the same guard: no code point of IGNORAVEIS or
// CONTROLES is left in it, except LF.
//   - regua rebar-security must report the tracked name as `<U+200B>`. That needs
//     the hidden-unicode rule; before it exists no rule reads file names, and this
//     assertion fails on purpose.
//   - regua rebar-check must carry the trailer as `<U+E0041>`. rebar-check prints
//     its motivos as the repository wrote them, so this one is escaped by this
//     server alone, and it holds today.
titulo('3f · a name and a commit message with invisible characters reach the answer escaped')
{
  const cp = (n) => String.fromCodePoint(n)
  const rotulo = (n) => `U+${n.toString(16).toUpperCase().padStart(4, '0')}`
  const base = mkdtempSync(join(tmpdir(), 'rebar-mcp-escape-'))
  try {
    // An empty global config and no system config: a user's hooks path, template
    // directory or signing setting must not decide what this proof builds.
    const vazio = join(base, 'vazio.gitconfig')
    writeFileSync(vazio, '')
    const ambiente = {
      ...process.env,
      GIT_CONFIG_GLOBAL: vazio,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'prova',
      GIT_AUTHOR_EMAIL: 'prova@example.invalid',
      GIT_COMMITTER_NAME: 'prova',
      GIT_COMMITTER_EMAIL: 'prova@example.invalid',
    }
    const repo = join(base, 'alvo')
    mkdirSync(repo)
    const git = (args, entrada) => {
      const r = spawnSync('git', args, {
        cwd: repo,
        env: ambiente,
        input: entrada,
        encoding: 'utf8',
        windowsHide: true,
      })
      if (r.status !== 0) {
        throw new Error(`git ${args.join(' ')} exited ${r.status}: ${(r.stderr ?? '').trim()}`)
      }
      return r.stdout
    }

    const nomeRastreado = `docs/no${cp(0x200b)}tas.md`
    git(['-c', 'init.defaultBranch=main', 'init', '-q'])
    const blob = git(['hash-object', '-w', '--stdin'], Buffer.from('notas\n', 'utf8')).trim()
    // One plain file ALSO on disk, with the same bytes. hardcoded-secret reads the
    // working tree, and a repository whose every tracked file exists only in the
    // index makes it throw "read none of the 1 tracked file(s)" (measured): the
    // answer came back exit 127, a broken ruler over a case that has nothing to do
    // with secrets. The name with U+200B stays index-only.
    writeFileSync(join(repo, 'README.md'), 'notas\n')
    git(
      ['update-index', '-z', '--add', '--index-info'],
      Buffer.from(
        ['README.md', nomeRastreado].map((caminho) => `100644 ${blob}\t${caminho}\0`).join(''),
        'utf8',
      ),
    )
    const arvore = git(['write-tree']).trim()
    // The trailer names a known agent, so ai-coauthorship fails and prints it. The
    // tags ride on it; U+200B stays out of the message, so a `<U+200B>` in the
    // security answer can only come from the file name.
    const mensagem =
      'inicial\n\n' +
      `Co-authored-by: Copilot${cp(0xe0041)}${cp(0xe0042)} <copilot@example.invalid>\n`
    const commit = git(['commit-tree', arvore], Buffer.from(mensagem, 'utf8')).trim()
    git(['update-ref', 'HEAD', commit])

    // git may drop a path it refuses and exit 0 while doing it (measured with a C0
    // control on Windows). The name has to be in the index byte for byte, or the
    // assertions below would test a repository without the case.
    if (!git(['ls-files', '-z']).split('\0').includes(nomeRastreado)) {
      throw new Error('git did not keep the name with U+200B in the index')
    }

    const perguntar = async (regua) => {
      const r = await cliente.pedir('tools/call', {
        name: 'rebar_verificar',
        arguments: { caminho: repo, regua },
      })
      const t = textoDa(r) ?? ''
      if (!CURTO) console.log(`\n  ── regua ${regua}\n${trecho(t, 1600)}\n`)
      const crus = new Set()
      for (const ch of t) {
        const n = ch.codePointAt(0)
        if (n !== 0x0a && (naFaixa(n, IGNORAVEIS) || naFaixa(n, CONTROLES))) crus.add(rotulo(n))
      }
      if (r.result?.isError === true) {
        falhou(`regua ${regua} on the built repository returned isError:\n${trecho(t, 600)}`)
      } else if (crus.size) {
        falhou(`regua ${regua}: raw code point(s) reached the answer: ${[...crus].join(', ')}`)
      } else {
        ok(`regua ${regua}: no code point of IGNORAVEIS or CONTROLES other than LF`)
      }
      return t
    }

    const seguranca = await perguntar('rebar-security')
    if (seguranca.includes('<U+200B>')) {
      ok('regua rebar-security reported the tracked name, escaped as <U+200B>')
    } else {
      falhou(
        'regua rebar-security did not report the tracked name as <U+200B>: no rule reads ' +
          `file names yet, or its finding lost the escape:\n${trecho(seguranca, 600)}`,
      )
    }

    const check = await perguntar('rebar-check')
    if (check.includes('<U+E0041>')) {
      ok('regua rebar-check carried the commit trailer, escaped as <U+E0041>')
    } else {
      falhou(
        'regua rebar-check did not carry the trailer as <U+E0041>: ai-coauthorship stopped ' +
          `printing it, or this server stopped escaping it:\n${trecho(check, 600)}`,
      )
    }
  } catch (e) {
    falhou(`could not build the repository with invisible characters: ${e.message}`)
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 10 })
  }
}

// The caller's words come back in a no-match answer. The search text was escaped
// and the level and class were not: a class carrying a line break put a forged
// line into the answer, and an invisible or ESC reached content[].text raw.
titulo('3g · the caller words a rebar_regras answer repeats are escaped, every filter')
{
  const pontos = (...n) => String.fromCodePoint(...n)
  const rotulo = (n) => `U+${n.toString(16).toUpperCase().padStart(4, '0')}`
  const r = await cliente.pedir('tools/call', {
    name: 'rebar_regras',
    arguments: {
      nivel: `N9${pontos(0x200b, 0x1b)}[2J`,
      classe: `z${pontos(0xe0041, 0x0a)}FAILED:`,
    },
  })
  const t = textoDa(r) ?? ''
  const crus = new Set()
  for (const ch of t) {
    const n = ch.codePointAt(0)
    if (n !== 0x0a && (naFaixa(n, IGNORAVEIS) || naFaixa(n, CONTROLES))) crus.add(rotulo(n))
  }
  if (crus.size) {
    falhou(`rebar_regras echoed raw code point(s): ${[...crus].join(', ')}:\n${trecho(t, 400)}`)
  } else if (/^FAILED:/m.test(t)) {
    falhou(`rebar_regras let a line break from the class forge a line:\n${trecho(t, 400)}`)
  } else if (!['<U+200B>', '<U+001B>', '<U+E0041>', '<U+000A>'].every((x) => t.includes(x))) {
    falhou(`rebar_regras did not escape the level and the class as <U+XXXX>:\n${trecho(t, 400)}`)
  } else {
    ok('level and class come back as <U+200B>, <U+001B>, <U+E0041> and <U+000A>, forging no line')
  }
}

// An invalid regua is refused by the SDK's schema check, whose isError text is
// zod's issue message, and zod quotes the value it received raw. So the caller's
// own invisible, ESC, tag and line break came back in content[].text, and the LF
// put a `FAILED:` line of the caller's into the answer.
titulo('3g2 · an invalid regua is refused without repeating it')
{
  const pontos = (...n) => String.fromCodePoint(...n)
  const rotulo = (n) => `U+${n.toString(16).toUpperCase().padStart(4, '0')}`
  for (const regua of [`x${pontos(0x200b, 0x1b, 0xe0041, 0x0a)}FAILED: forged`, 42]) {
    const r = await cliente.pedir('tools/call', { name: 'rebar_verificar', arguments: { regua } })
    const t = textoDa(r) ?? ''
    const crus = new Set()
    for (const ch of t) {
      const n = ch.codePointAt(0)
      if (n !== 0x0a && (naFaixa(n, IGNORAVEIS) || naFaixa(n, CONTROLES))) crus.add(rotulo(n))
    }
    const erro = r.result?.isError === true || Boolean(r.error)
    if (!erro) {
      falhou(`rebar_verificar accepted regua ${JSON.stringify(typeof regua)}:\n${trecho(t, 400)}`)
    } else if (crus.size) {
      falhou(
        `rebar_verificar echoed raw code point(s) of regua: ${[...crus].join(', ')}:\n${trecho(t, 400)}`,
      )
    } else if (/^FAILED:/m.test(t) || t.includes('forged')) {
      falhou(`rebar_verificar repeated the regua it refused:\n${trecho(t, 400)}`)
    } else if (!/regua must be one of rebar-check, rebar-security, ambas/.test(t)) {
      falhou(`rebar_verificar refused regua without naming the choices:\n${trecho(t, 400)}`)
    } else {
      ok(`an invalid regua (${typeof regua}) is refused, naming the choices and never the input`)
    }
  }
}

// A tool name that is not registered never reaches a handler: the SDK answers
// `Tool <name> not found` through createToolError, with the requested name as it
// came. Measured on SDK 1.30.0: U+200B, ESC and a tag character came back raw,
// and the LF in the name put a `FAILED:` line of the caller's into the answer.
titulo('3g3 · an unknown tool name is refused without repeating it raw')
{
  const pontos = (...n) => String.fromCodePoint(...n)
  const rotulo = (n) => `U+${n.toString(16).toUpperCase().padStart(4, '0')}`
  const nome = `rebar_x${pontos(0x200b, 0x0a)}FAILED: forged${pontos(0x1b)}[2J${pontos(0xe0041)}`
  const r = await cliente.pedir('tools/call', { name: nome, arguments: {} })
  const t = textoDa(r) ?? JSON.stringify(r.error ?? '')
  const crus = new Set()
  for (const ch of t) {
    const n = ch.codePointAt(0)
    if (n !== 0x0a && (naFaixa(n, IGNORAVEIS) || naFaixa(n, CONTROLES))) crus.add(rotulo(n))
  }
  const erro = r.result?.isError === true || Boolean(r.error)
  if (!erro) {
    falhou(`an unknown tool name was not refused:\n${trecho(t, 400)}`)
  } else if (crus.size) {
    falhou(`the unknown tool name came back with raw code point(s): ${[...crus].join(', ')}`)
  } else if (/^FAILED:/m.test(t)) {
    falhou(`a line break in the unknown tool name forged a line:\n${trecho(t, 400)}`)
  } else {
    ok('an unknown tool name comes back escaped, with no raw code point and no forged line')
  }
}

// `caminho` is a folder. Handed to the ruler as it came, a value that starts with
// `--` was read as an option: the ruler audited its own cwd (rebar) under a rule
// filter or with heuristics on, and answered green for a tree nobody named.
titulo('3h · a caminho that looks like an option is a folder, never an option')
{
  const r = await cliente.pedir('tools/call', {
    name: 'rebar_verificar',
    arguments: { caminho: '--heuristics', regua: 'rebar-security' },
  })
  const t = textoDa(r) ?? ''
  if (/^command: node \S+ --json --heuristics(?:\s|$)/m.test(t)) {
    falhou(`caminho reached the ruler as an option:\n${trecho(t, 600)}`)
  } else if (/exit=0\b/.test(t)) {
    falhou(`an option-looking caminho came back green:\n${trecho(t, 600)}`)
  } else {
    ok('caminho --heuristics is resolved as a folder under the root, and nothing passes over it')
  }
}

cliente.fechar()

/**
 * Builds a fake repository with a copy of the server inside, to test what can only be
 * tested by touching the disk.
 *
 * The copy lives outside the real repository on purpose: steps 4 and 6 need a missing
 * artifact and a tampered source, and neither can happen on top of rebar — the owner
 * works in it and so does another agent.
 *
 * The tree imitates the real one because the server resolves everything from its own
 * position: <root>/mcp/src/index.mjs → RAIZ = <root>. node_modules comes in as a
 * junction, which on Windows does not ask for admin and on Linux is a plain symlink:
 * what is tested here is the JSON, not the presence of the SDK.
 */
function montarCopia(
  prefixo,
  { comArtefato = true, fonteAdulterada = false, semFonte = null } = {},
) {
  const base = mkdtempSync(join(tmpdir(), prefixo))
  const src = join(base, 'mcp', 'src')
  mkdirSync(src, { recursive: true })
  // texto-seguro.mjs came in with the output sanitizer. Without it the copy dies
  // with ERR_MODULE_NOT_FOUND at the import, and step 4 would read that crash as
  // "the server died without an artifact", the right exit for the wrong reason.
  for (const f of ['index.mjs', 'artefato.mjs', 'consultas.mjs', 'texto-seguro.mjs']) {
    copyFileSync(join(AQUI, f), join(src, f))
  }
  symlinkSync(join(AQUI, '..', 'node_modules'), join(base, 'mcp', 'node_modules'), 'junction')
  if (comArtefato) {
    copyFileSync(
      join(AQUI, '..', 'rules.generated.json'),
      join(base, 'mcp', 'rules.generated.json'),
    )
  }
  if (fonteAdulterada) {
    const dir = join(base, 'tooling', 'rebar-check')
    mkdirSync(dir, { recursive: true })
    // Content different from the original: that, and only that, is what sha256 sees.
    writeFileSync(join(dir, 'index.mjs'), '// a new rule came in here and the MCP does not know\n')
  }
  if (semFonte) {
    // Every file source copied IDENTICAL, except one, which is left out. Identical
    // on purpose: if any of them diverged, the state would be `suspeito` and the
    // absence would hide behind it.
    const art = JSON.parse(readFileSync(join(AQUI, '..', 'rules.generated.json'), 'utf8'))
    for (const f of art.fontes) {
      if (f.arquivo.endsWith('/') || f.arquivo === semFonte) continue
      const partes = f.arquivo.split('/')
      const destino = join(base, ...partes)
      mkdirSync(dirname(destino), { recursive: true })
      copyFileSync(join(RAIZ, ...partes), destino)
    }
  }
  return { base, servidor: join(src, 'index.mjs') }
}

/**
 * Takes the copy down — the junction FIRST, and with `rmdirSync`, not `rmSync`.
 *
 * A Windows junction is a real folder to anyone just looking, and deleting
 * recursively a tree with one inside is the recipe for taking the repository's
 * `mcp/node_modules` along with it. `rmdirSync` removes the junction and stops there
 * — checked before writing this: the target stayed intact.
 */
function desmontarCopia(base) {
  try {
    rmdirSync(join(base, 'mcp', 'node_modules'))
    rmSync(base, { recursive: true, force: true })
  } catch {
    // A test copy left behind in %TEMP% spoils nothing, and the system cleans it.
    // Failing the proof over the housekeeping would trade the real defect for noise.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · the server without an artifact has to DIE, not serve empty.
titulo('4 · no artifact: the server dies with a useful message')
let semArtefato
try {
  semArtefato = montarCopia('rebar-mcp-sem-artefato-', { comArtefato: false })
} catch (e) {
  falhou(`could not build the test copy: ${e.message}`)
}

if (semArtefato) {
  const morto = spawn(process.execPath, [semArtefato.servidor], { windowsHide: true })
  let saidaDeErro = ''
  morto.stderr.setEncoding('utf8')
  morto.stderr.on('data', (d) => {
    saidaDeErro += d
  })
  const codigo = await new Promise((resolve) => morto.on('close', resolve))
  console.log(saidaDeErro.trimEnd())
  console.log(`\n  exit=${codigo}`)
  const util =
    saidaDeErro.includes('node mcp/generate.mjs') && saidaDeErro.includes('rules.generated.json')
  if (codigo === 1 && util) ok('died with exit 1 and said how to generate the artifact')
  else falhou(`expected exit 1 with the generation command in the message; got exit ${codigo}`)
  desmontarCopia(semArtefato.base)
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · the README snippet has to WORK.
//
// An MCP only serves if it is configured, and a wrong configuration fails silently:
// Claude Code simply does not list the tool, and nobody connects the silence to the
// wrong path. So the snippet is not copied over here — it is READ from the README and
// EXECUTED. If somebody moves mcp/src/index.mjs and forgets the README, this proof
// fails. It is the same principle as the rest of the module: derive, do not duplicate.
titulo('5 · the .mcp.json snippet from the README starts the server')
const fence = /```json\n([\s\S]*?)```/.exec(readFileSync(LEIAME, 'utf8'))
if (!fence) {
  falhou('found no ```json block in mcp/README.md')
} else {
  const config = JSON.parse(fence[1])
  const entrada = config.mcpServers?.rebar
  console.log(`  cwd: repository root`)
  console.log(`  ${JSON.stringify(entrada)}`)
  if (entrada?.command !== 'node') {
    falhou(
      `the snippet calls "${entrada?.command}"; it has to be "node" (npx on Windows gives ENOENT)`,
    )
  }
  const doSnippet = new Cliente(null, { comando: entrada, cwd: RAIZ, curto: CURTO })
  try {
    const r = await doSnippet.pedir('initialize', {
      protocolVersion: PROTOCOLO,
      capabilities: {},
      clientInfo: { name: 'prova-do-snippet', version: '1.0.0' },
    })
    const t = await doSnippet.pedir('tools/list', {})
    const n = t.result?.tools?.length ?? 0
    if (r.result?.serverInfo?.name === 'rebar' && n === ferramentas.length) {
      ok(`the snippet starts the server and lists the same ${n} tools`)
    } else {
      falhou(
        `the snippet started something else: ${JSON.stringify(r.result?.serverInfo)}, ${n} tools`,
      )
    }
  } catch (e) {
    falhou(`the snippet did not start the server: ${e.message}\n${doSnippet.stderr.trim()}`)
  }
  doSnippet.fechar()
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · the source changed, the artifact did not: EVERY answer has to carry the warning.
//
// It is the prior-app defect reproduced on purpose — the rule changes and the MCP goes on
// serving the old version. The authority on this is the gate (`gerar.mjs
// --verificar`); the server only compares the sha256 the artifact recorded in
// `fontes[]` with the file's hash today. A weak signal, but never a false negative:
// if the rule changed, the hash changed.
//
// The warning goes glued to the ANSWER, not to a status tool, and that is what this
// step proves: a status tool only speaks when somebody asks, and the model does not ask.
titulo('6 · tampered source: the freshness warning sticks to every answer')
let velho
try {
  velho = montarCopia('rebar-mcp-velho-', { fonteAdulterada: true })
} catch (e) {
  falhou(`could not build the test copy: ${e.message}`)
}

if (velho) {
  const c = new Cliente(velho.servidor, { curto: CURTO })
  try {
    await c.pedir('initialize', {
      protocolVersion: PROTOCOLO,
      capabilities: {},
      clientInfo: { name: 'prova-de-frescor', version: '1.0.0' },
    })
    c.notificar('notifications/initialized', {})
    const r = await c.pedir('tools/call', {
      name: 'rebar_regras',
      arguments: { busca: 'readme' },
    })
    const t = textoDa(r)
    console.log(`\n${trecho(t, 700)}\n`)
    // "FRESHNESS WARNING" is the prefix artefato.mjs prints. Reword it there and
    // reword it here, or this step goes green over a silent server.
    if (t.startsWith('FRESHNESS WARNING') && t.includes('tooling/rebar-check/index.mjs')) {
      ok('the warning came in front of the answer, naming the file that changed')
    } else {
      falhou('the answer came with no freshness warning')
    }
  } catch (e) {
    falhou(`${e.message}\n${c.stderr.trim()}`)
  }
  c.fechar()
  desmontarCopia(velho.base)
}

titulo('7 · MISSING source: "em dia" cannot come out of an incomplete tree')
{
  // `em dia` in the title above stays in Portuguese: it is one of the four
  // freshness state values artefato.mjs returns, not prose.
  //
  // P2 #10. The state was binary in practice: changed (`suspeito`) or unchanged
  // (`em dia`), and "I did not find the file" fell into the second. While the
  // sources were only the four format ones this was still defensible; once the
  // decisions became a source, it stopped being so — deleting `new/index.mjs` would
  // make the server paste in a decision derived from a file that is no longer there
  // and claim it is up to date.
  const semDecisao = montarCopia('rebar-mcp-parcial-', { semFonte: 'new/index.mjs' })
  const c = new Cliente(semDecisao.servidor, { curto: CURTO })
  try {
    await c.apresentar('prova-de-fonte-ausente')
    const r = await c.pedir('tools/call', {
      name: 'rebar_regras',
      arguments: { busca: 'readme' },
    })
    const texto = textoDa(r)
    // Both patterns are the wording artefato.mjs prints. Reword there, reword here.
    if (!/FRESHNESS WARNING/.test(texto)) {
      falhou('a tree missing one of the sources answered with no warning at all')
    } else if (!/new\/index\.mjs/.test(texto)) {
      falhou(`the warning does not name the missing source:\n${trecho(texto, 300)}`)
    } else {
      ok('the warning came, naming the missing source')
    }
    // And what IS checkable goes on being checked: no divergence invented just
    // because a file was missing.
    if (/changed since the artifact was generated/.test(texto)) {
      falhou('an absence was reported as a divergence — they are different things')
    }
  } finally {
    await c.fechar()
    desmontarCopia(semDecisao.base)
  }
}

titulo(falhas ? `${falhas} FAILURE(S)` : 'everything passed')
process.exit(falhas ? 1 : 0)
