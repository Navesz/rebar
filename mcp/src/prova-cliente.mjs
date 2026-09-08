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

import { spawn } from 'node:child_process'
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
const chamadas = [
  ['rebar_regras', { nivel: 'N1' }, 'what fails me when I touch the CSS/lint', false],
  ['rebar_porque', { id: 'raw-hex' }, 'hex-cru failed; why is that a rule', false],
  ['rebar_decidir', { assunto: 'cor' }, 'can I write #fff in the component?', false],
  ['rebar_decidir', { assunto: 'mongodb' }, 'a subject rebar does NOT govern', false],
  ['rebar_portao', { passo: 'mcp' }, 'the gate step that guards this module', false],
  ['rebar_verificar', {}, 'the ruler on rebar itself', false],
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
    'raw-hex',
  ],
  [
    'rebar_porque',
    { id: 'mongodb-driver' },
    'an id from another world: fails without inventing a neighbour',
    true,
    null,
  ],
]

for (const [nome, args, pergunta, erroEsperado, vizinho] of chamadas) {
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
        ? `${nome} should have returned isError and did not — the nonexistent-id contract loosened`
        : `${nome} returned isError and should not have:\n${trecho(t, 400)}`,
    )
    continue
  }

  // Whoever fails has an EXTRA contract: "do not die" is half of it. The fifth
  // field says which neighbour the message must offer — or `null` when offering
  // none is the right answer. Both directions matter: suggesting nothing when there
  // was a similar id leaves the agent with no way out, and inventing a neighbour for
  // an id from another subject is worse than the dry error.
  if (erroEsperado) {
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
  const { DESLIGAM } = await import(
    pathToFileURL(join(RAIZ, 'tooling', 'security', 'index.mjs')).href
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
  const achados = DESLIGAM.filter(([padrao]) => padrao.test(vocabulario))
  if (achados.length) {
    falhou(
      `the derived vocabulary matches ${achados.length} pattern(s) of the ruler: ` +
        `${achados.map(([x]) => x.source).join(' · ')}. ` +
        'Every repository that vendors the artifact would start failing over the MCP.',
    )
  } else {
    ok(`${DESLIGAM.length} patterns in the table, and none of them matches the vocabulary`)
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
  for (const f of ['index.mjs', 'artefato.mjs', 'consultas.mjs']) {
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
// It is the Herz defect reproduced on purpose — the rule changes and the MCP goes on
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
