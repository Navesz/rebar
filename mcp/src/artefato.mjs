// The artifact: how this server reads the rule, and why it dies without it.
//
// §7.2 of docs/PLANO.md orders one thing and forbids another. It orders: DERIVED,
// NEVER DUPLICATED — the server keeps no copy of the rule, it reads the generated
// source. It forbids: copied prose, which is what the previous server served (five
// tools returning chunks of markdown from the plan).
//
// Hence the division of labor, which is the contract between this module's two ends:
//
//   tooling/rebar-check/index.mjs   the SOURCE. 22 rules, the why of each one.
//   mcp/generate.mjs                       the GENERATOR. Derives the artifact from the source.
//   mcp/rules.generated.json              the ARTIFACT. It is what this file reads.
//   node mcp/generate.mjs --verificar      the FRESHNESS GATE. Regenerates in memory,
//                                       compares with the disk, fails if it diverges.
//
// THIS SERVER NEVER READS index.mjs TO LEARN THE RULE. If it did, there would be two
// implementations reading the source — the generator's and mine — and they would
// diverge, which is exactly the defect this whole module exists not to commit.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, not `.pathname`: on Windows the pathname arrives as "/C:/Users/..."
// and every readFileSync afterwards looks in C:\C:\Users\... It is the bug that left
// the foundation's hook installer dead for weeks.
const AQUI = dirname(fileURLToPath(import.meta.url))

/** The repository root: mcp/src/ → mcp/ → root. */
export const RAIZ = join(AQUI, '..', '..')

/** The artifact lives next to the generator, inside the mcp/ package. */
export const CAMINHO_ARTEFATO = join(RAIZ, 'mcp', 'rules.generated.json')

/** An error whose message says what to do. The `process.exit` stays with the caller. */
export class FalhaDeArtefato extends Error {}

// The format this server knows how to read. The artifact carries `formato: 1`; if the
// generator one day changes the shape and goes to 2, dying and saying so beats serving
// a field that no longer exists and answering `undefined` with the face of an answer.
const FORMATO_SUPORTADO = 1

// The keys without which no tool works. Checking here, once, at boot, is worth more
// than a `?.` at every use: the model does not see a tool exception, it sees an empty
// answer.
const CHAVES_OBRIGATORIAS = ['formato', 'fontes', 'codigosDeSaida', 'niveis', 'regras', 'gate']

const COMO_GERAR = [
  '  generate:   node mcp/generate.mjs',
  '  the gate:   node mcp/generate.mjs --verificar   (runs inside `npm run verify`,',
  '              step `mcp` — regenerates in memory and fails if the disk diverges)',
].join('\n')

/**
 * Reads the artifact from disk.
 *
 * DIES LOUD if it does not exist, instead of serving empty. An MCP that answers "no
 * rule found" when the artifact vanished teaches the model that the project has no
 * rules — worse than not answering, because it looks like an answer.
 */
export function carregar(caminho = CAMINHO_ARTEFATO) {
  let cru
  try {
    cru = readFileSync(caminho, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new FalhaDeArtefato(
        [
          'the rules artifact is not on disk.',
          `  expected:   ${caminho}`,
          '',
          '  This server serves the GENERATED ARTIFACT; it does not read tooling/rebar-check/index.mjs.',
          '  Without the artifact the only honest answer is to die — serving empty would teach the',
          '  model that the project has no rules at all.',
          '',
          COMO_GERAR,
        ].join('\n'),
      )
    }
    throw new FalhaDeArtefato(`could not read ${caminho}: ${e.message}`)
  }

  let json
  try {
    json = JSON.parse(cru)
  } catch (e) {
    throw new FalhaDeArtefato(
      [
        `${caminho} exists but is not valid JSON: ${e.message}`,
        '  Do not edit the artifact by hand — it is generated.',
        COMO_GERAR,
      ].join('\n'),
    )
  }

  const faltando = CHAVES_OBRIGATORIAS.filter((k) => json[k] === undefined)
  if (faltando.length) {
    throw new FalhaDeArtefato(
      [
        `${caminho} is missing: ${faltando.join(', ')}.`,
        '  This is not a rebar artifact, or it is in a format this server does not know.',
        COMO_GERAR,
      ].join('\n'),
    )
  }

  if (json.formato !== FORMATO_SUPORTADO) {
    throw new FalhaDeArtefato(
      [
        `artifact format ${json.formato}; this server reads format ${FORMATO_SUPORTADO}.`,
        '  The generator and the server are on different versions. Update the whole mcp/ package.',
      ].join('\n'),
    )
  }

  if (!Array.isArray(json.regras) || json.regras.length === 0) {
    throw new FalhaDeArtefato(
      [
        `${caminho} has zero rules.`,
        '  An empty artifact is worse than a missing one: it looks like an answer.',
        COMO_GERAR,
      ].join('\n'),
    )
  }

  return json
}

/**
 * The freshness signal the SERVER can give — and the one it cannot.
 *
 * The authority on freshness is the gate (`node mcp/generate.mjs --verificar`), which
 * regenerates the whole artifact in memory and compares byte by byte. That is
 * expensive and it is its job, not mine: the MCP is never the door.
 *
 * What can be done for free is comparing the sha256 the artifact itself recorded in
 * `fontes[]` with the file's hash today. That does NOT reimplement the generator — it
 * reads no rule out of index.mjs, it only runs the bytes through sha256 — and it
 * answers a weaker but true question: "has the source changed since this was
 * generated?".
 *
 * Weak on purpose, in both directions:
 *   · false positive — touching a comment in index.mjs changes the hash without
 *     changing a rule;
 *   · never a false negative — if the rule changed, the hash changed.
 * One warning too many costs a line; one silence too few is the Herz defect back.
 *
 * Measured cost: 3 files, 205 KB together, ~2 ms per call. No cache — a cache is the
 * origin of drift, and this file exists because of drift.
 */
export function frescor(artefato, raiz = RAIZ) {
  const divergentes = []
  const naoConferidos = []
  // Kept apart from `naoConferidos` because it is not the same thing: a tree entry
  // is a known and constant limitation; a missing source is the artifact claiming to
  // derive from a file that is not here.
  const ausentes = []

  for (const fonte of artefato.fontes ?? []) {
    // A directory entry (ends in "/"): the generator sums a whole tree into a single
    // hash, with an algorithm of its own. Reproducing that here would mean keeping a
    // second implementation current forever — the defect this module chases.
    if (fonte.arquivo.endsWith('/')) {
      naoConferidos.push(fonte.arquivo)
      continue
    }
    const alvo = join(raiz, ...fonte.arquivo.split('/'))
    let bytes
    try {
      bytes = readFileSync(alvo)
    } catch {
      // A missing source is not a divergence: the mcp/ package may have been copied
      // out of the repository, and then the artifact is all there is — and it stays
      // servable.
      //
      // Servable, but NOT "up to date", and that difference was the one missing.
      // While the sources were only the four format ones, saying "up to date" with
      // one of them gone was still defensible. Once the decisions became a source, it
      // stopped being so: deleting `new/index.mjs` would make the server paste in a
      // decision derived from a file that is no longer there, and claim it is up to
      // date.
      naoConferidos.push(fonte.arquivo)
      ausentes.push(fonte.arquivo)
      continue
    }
    const hoje = createHash('sha256').update(bytes).digest('hex')
    if (hoje !== fonte.sha256) {
      divergentes.push({ arquivo: fonte.arquivo, daqui: fonte.daqui })
    }
  }

  const conferidos = (artefato.fontes?.length ?? 0) - naoConferidos.length
  const comum = { divergentes, naoConferidos, ausentes, conferidos }
  // Changed is worse than gone, and gone is worse than not checkable. That is the
  // order here, on purpose.
  //
  // The four state values stay in Portuguese: they are identifiers this module and
  // avisoDeFrescor compare against, not prose. Renaming them is another job.
  if (divergentes.length) return { estado: 'suspeito', ...comum }
  if (conferidos === 0) return { estado: 'desconhecido', ...comum }
  if (ausentes.length) return { estado: 'parcial', ...comum }
  return { estado: 'em dia', ...comum }
}

/**
 * The warning line that goes glued to EVERY answer when the source has changed.
 *
 * It goes on every answer, not in a status tool: a status tool is discretionary —
 * "o modelo decide se chama" [the model decides whether to call it], as the Herz
 * repository itself admits. A warning that only shows up when somebody asks is a
 * warning nobody reads.
 *
 * The "FRESHNESS WARNING" prefix and the "changed since the artifact was generated"
 * wording are matched by regex in prova-cliente.mjs. Reword here and reword there.
 */
export function avisoDeFrescor(f) {
  const rodape = [
    'What follows may be old. The gate decides, not me:',
    '  node mcp/generate.mjs --verificar   (and `npm run verify`, step `mcp`)',
  ]
  if (f.estado === 'suspeito') {
    const quais = f.divergentes.map((d) => d.arquivo).join(', ')
    return [
      `FRESHNESS WARNING: ${quais} changed since the artifact was generated.`,
      ...rodape,
    ].join('\n')
  }
  // `parcial` warns just the same, because the effect on the reader is the same: part
  // of this answer is derived from a file this tree does not have, and so there is no
  // way to say whether it aged. A warning that only comes out in the worst case is a
  // warning that gives the impression the rest was checked.
  if (f.estado === 'parcial') {
    return [
      `FRESHNESS WARNING: ${f.ausentes.join(', ')} is not in this tree.`,
      'There is no way to know whether what came from there has aged.',
      ...rodape,
    ].join('\n')
  }
  return null
}

/** Display path, always with "/", so the answer does not change between Windows and Linux. */
export function exibirCaminho(p) {
  return p.split(sep).join('/')
}
