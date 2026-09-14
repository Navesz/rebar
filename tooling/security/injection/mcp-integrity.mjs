// mcp-integrity — the `.rebar/mcp.mjs` a tracked MCP config launches is a
// version of the server rebar generated, byte for byte.
//
// WHY BYTES. An MCP client starts the file a project config names on every
// session, and Claude Code's headless, Agent SDK and cloud sessions start
// project servers without asking. mcp-server-launch pins the LAUNCH (`node
// .rebar/mcp.mjs`); nothing pinned what that launch runs, so an edit to the
// server file walked past every rule: the launch text never changed. rebar's
// generator copies new/gate/arquivos/mcp-rebar.mjs verbatim, so the honest
// state is a blob rebar shipped.
//
// WHY A TABLE AND NOT THE RUNNING TEMPLATE. Measured on 2026-09-13: rebar-site
// tracks blob 8bc5d7f (version 2 of the template), assay and navesz-portfolio
// track ea75237 (version 6). Held against the current template, all three would
// fail on the day this rule shipped, for code rebar itself wrote. The table,
// tooling/security/injection/modelos-mcp.json, lists every version the template
// ever had in rebar's history; new/gate/modelos-mcp.mjs derives it from git and
// the `mcp-template` gate step fails when the template changes without it.
//
// WHY NO ALLOWLIST ENTRY. A modified server is a legitimate thing to run, and
// it already has a way in: launch it under another file name, and accept that
// launch by fingerprint for mcp-server-launch. Accepting a changed blob under the
// generated name would make the file an agent is told is rebar's server into
// whatever the last allowlist edit said.
//
// WHAT IS NEVER PRINTED. The file content: a finding names the path, the config
// position, the blob prefix and the sha256 prefix.
//
// ─────────────────────────────────────────────────────────────── the API
//
/**
 * checarMcpIntegrity(r, { tabela? }) -> string (reprova) | null | { nota } | { na }
 *   `tabela` is the URL of the version table; it defaults to the running
 *   rebar's modelos-mcp.json and exists only so a proof can point it at a
 *   synthetic or missing file. A table that cannot be read or is malformed
 *   throws, which the executor reports as quebrou: a defect of this tool.
 *
 * lerTabelaDeModelos(url) -> { esquema, versoes: [{ ordem, sha256, blob, bytes, desde, data, atual,
 *                                                   recusada, regua_sem_pino, ganchos_antigos }] }
 *   `recusada`: null, or why rebar-security fails a version rebar shipped.
 *   `regua_sem_pino`: the version runs rebar unpinned when `regua: true` is called.
 *   `ganchos_antigos`: the version predates the English hook file names.
 *
 * alvosDoServidor(indice) -> Map<caminho, { arquivo, linha, coluna }>
 *   Tracked MCP configs whose launch names a path ending in `.rebar/mcp.mjs`,
 *   resolved from the client's project folder (or a relative `cwd`); the first
 *   config wins, so one file is judged once.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { posix } from 'node:path'

import { escaparSaida } from '../texto-seguro.mjs'
import { lerConfigsMcp, palavras } from './mcp-launch.mjs'
import {
  NOME_DA_ALLOWLIST,
  lerAllowlist,
  lerIndice,
  onde,
  problemasDeLeitura,
  resumir,
} from './reader.mjs'

const TABELA = new URL('./modelos-mcp.json', import.meta.url)
const DESTINO = '.rebar/mcp.mjs'
const SEM_ALVO = 'no MCP configuration launches .rebar/mcp.mjs'
const na = (motivo) => ({ na: motivo })

const MEMORIA_DA_TABELA = new Map()

const inteiro = (v, minimo) => Number.isInteger(v) && v >= minimo

export function lerTabelaDeModelos(url = TABELA) {
  const chave = String(url)
  if (MEMORIA_DA_TABELA.has(chave)) return MEMORIA_DA_TABELA.get(chave)
  const ruim = (porque) =>
    new Error(
      `the running rebar's tooling/security/injection/modelos-mcp.json is malformed: ${porque}`,
    )
  let tabela
  try {
    tabela = JSON.parse(readFileSync(url, 'utf8'))
  } catch (e) {
    throw ruim(e.code === 'ENOENT' ? 'the file is missing' : e.message)
  }
  if (!tabela || typeof tabela !== 'object' || tabela.esquema !== 2) throw ruim('esquema is not 2')
  if (!Array.isArray(tabela.versoes) || !tabela.versoes.length) throw ruim('versoes is empty')
  tabela.versoes.forEach((v, i) => {
    const ok =
      v &&
      typeof v === 'object' &&
      inteiro(v.ordem, 1) &&
      typeof v.sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(v.sha256) &&
      typeof v.blob === 'string' &&
      /^[0-9a-f]{40}$/.test(v.blob) &&
      inteiro(v.bytes, 0) &&
      (v.desde === null || (typeof v.desde === 'string' && /^[0-9a-f]{40}$/.test(v.desde))) &&
      (v.data === null || (typeof v.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.data))) &&
      typeof v.atual === 'boolean' &&
      (v.recusada === null || (typeof v.recusada === 'string' && v.recusada.length > 0)) &&
      typeof v.regua_sem_pino === 'boolean' &&
      typeof v.ganchos_antigos === 'boolean'
    if (!ok)
      throw ruim(
        `entry ${i + 1} does not have the shape {ordem, sha256, blob, bytes, desde, data, atual, ` +
          'recusada, regua_sem_pino, ganchos_antigos}',
      )
  })
  const atuais = tabela.versoes.filter((v) => v.atual).length
  if (atuais !== 1) throw ruim(`${atuais} entries are marked atual, expected exactly 1`)
  if (tabela.versoes.some((v) => v.atual && v.recusada)) throw ruim('the atual entry is recusada')
  MEMORIA_DA_TABELA.set(chave, tabela)
  return tabela
}

const limpar = (w) =>
  w
    .replace(/\\/g, '/')
    .replace(/^\$\{(?:workspaceFolder|workspaceRoot)\}\//, '')
    .replace(/^(?:\.\/)+/, '')

const ehAlvo = (p) => p === DESTINO || p.endsWith(`/${DESTINO}`)

export function alvosDoServidor(indice) {
  const { servidores } = lerConfigsMcp(indice)
  const alvos = new Map()
  for (const s of servidores) {
    if (!s.argv) continue
    // A relative cwd is where a stdio client starts the process, so relative
    // arguments resolve from there; the project folder is the fallback when
    // nothing is tracked under cwd, the reading the client would take for a
    // cwd it cannot find.
    const bases = []
    if (typeof s.bruto.cwd === 'string') {
      const cwd = limpar(s.bruto.cwd)
      if (cwd && !/^(?:\/|[A-Za-z]:|~|\$)/.test(cwd)) bases.push(posix.join(s.raiz || '.', cwd))
    }
    bases.push(s.raiz)
    const palavrasDoLancamento = s.argv.flatMap((w) => (/\s/.test(w) ? [w, ...palavras(w)] : [w]))
    for (const bruta of palavrasDoLancamento) {
      let w = bruta
      const igual = w.indexOf('=')
      if (w.startsWith('-') && igual > 0) w = w.slice(igual + 1)
      w = limpar(w)
      if (
        !w ||
        /\s/.test(w) ||
        /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(w) ||
        /^(?:\/|[A-Za-z]:|~|\$)/.test(w)
      ) {
        continue
      }
      const candidatos = bases
        .map((base) => posix.normalize(posix.join(base || '.', w)))
        .filter((p) => p !== '..' && !p.startsWith('../') && ehAlvo(p))
      if (!candidatos.length) continue
      const p = candidatos.find((c) => indice.porCaminho.has(c)) ?? candidatos[0]
      if (!alvos.has(p)) alvos.set(p, { arquivo: s.arquivo, linha: s.linha, coluna: s.coluna })
    }
  }
  return alvos
}

export function checarMcpIntegrity(r, { tabela = TABELA } = {}) {
  const dir = r && typeof r === 'object' ? r.dir : r
  const indice = lerIndice(dir)
  if (indice.semGit) return na(SEM_ALVO)

  // This rule exempts nothing, and a malformed allowlist still fails it: every
  // injection rule refuses a bypass that cannot be read, so no rule is the one
  // that stays green over it.
  const itens = lerAllowlist(dir).erros.map(
    (x) =>
      `${onde(NOME_DA_ALLOWLIST, x.linha, x.coluna)} ${escaparSaida(x.mensagem, { limite: 120 })} ` +
      '(not exemptable)',
  )

  const alvos = alvosDoServidor(indice)
  if (!alvos.size) {
    if (itens.length) return `${itens.length} MCP server integrity finding(s): ${resumir(itens)}`
    return na(SEM_ALVO)
  }

  const { versoes } = lerTabelaDeModelos(tabela)
  const total = versoes.length
  const notas = []
  for (const [p, { arquivo, linha, coluna }] of alvos) {
    const cfg = onde(arquivo, linha, coluna)
    const nome = escaparSaida(p, { limite: 120 })
    const e = indice.porCaminho.get(p)
    if (!e) {
      itens.push(
        `${cfg} launches ${nome}, which git does not track — the client runs whatever is on disk`,
      )
      continue
    }
    if (e.symlink || e.viaSymlink) {
      itens.push(
        `${cfg} launches ${nome}, a symbolic link — the generator never writes one, and the bytes ` +
          'judged would not be the bytes run',
      )
      continue
    }
    const problemas = problemasDeLeitura(e, indice)
    if (e.estado !== 'ok' || e.bytes === null || problemas.length) {
      const lista = [
        ...new Set([e.estado !== 'ok' ? e.estado : null, ...problemas].filter(Boolean)),
      ]
      itens.push(
        `${nome} cannot be verified as read (${lista.join(', ') || 'unreadable'}): the client may ` +
          'run something other than what git stores',
      )
      continue
    }
    // The raw index bytes, with no line-ending normalization: none of the six
    // historical blobs holds a carriage return (measured), and a checkout that
    // adds one is what a client would run.
    const h = createHash('sha256').update(e.bytes).digest('hex')
    const v = versoes.find((x) => x.sha256 === h)
    if (!v) {
      itens.push(
        `${nome} (blob ${e.oid.slice(0, 7)}, sha256:${h.slice(0, 12)}) matches none of the ${total} ` +
          'MCP server versions rebar ever generated — the MCP client runs these bytes on every ' +
          'session; restore a known version, or launch a modified server under another file name ' +
          `and accept that launch in ${NOME_DA_ALLOWLIST}`,
      )
      continue
    }
    if (v.atual) continue
    const origem = v.desde && v.data ? `, first shipped ${v.desde.slice(0, 7)} on ${v.data}` : ''
    const qual = `${nome} is version ${v.ordem} of ${total} of rebar's MCP server template (blob ${v.blob.slice(0, 7)}${origem})`
    // WHAT UPDATING TAKES DEPENDS ON THE VERSION. Measured on a clone of
    // rebar-site (version 2) on 2026-09-13: the server file alone made
    // rebar_verificar report two rules DESARMADA, because version 2 predates
    // the English hook names; the server plus the five hook files and the
    // renamed allowlist passed. assay (version 6) needed the server only.
    const atualizar = v.ganchos_antigos
      ? 'to update, copy from the rebar commit your CI pins new/gate/arquivos/mcp-rebar.mjs over ' +
        `${nome}, new/gate/arquivos/pre-commit, commit-msg and install.mjs into .githooks/, ` +
        'tooling/secret/scan-secret.mjs and tooling/hooks/check-message.mjs into .githooks/, delete ' +
        '.githooks/varrer-segredo.mjs, checar-mensagem.mjs and instalar.mjs, rename .rebar-coautores ' +
        'to .rebar-coauthors, run node .githooks/install.mjs, and commit it all together — this version ' +
        'predates the English hook names, and the server file alone reports two rules DESARMADA'
      : 'to update, copy new/gate/arquivos/mcp-rebar.mjs from the rebar commit your CI pins over ' +
        `${nome} and commit it; the current server reads that pin from .github/workflows/verificar.yml`
    if (v.recusada) {
      itens.push(`${qual}, which this rule refuses: ${v.recusada} — ${atualizar}`)
      continue
    }
    const semPino = v.regua_sem_pino
      ? ', which runs github:Navesz/rebar unpinned when `rebar_verificar {regua: true}` is called'
      : ''
    notas.push(`${qual}${semPino}; ${atualizar}`)
  }

  if (itens.length) return `${itens.length} MCP server integrity finding(s): ${resumir(itens)}`
  if (notas.length) return { nota: notas.join(' · ') }
  return null
}
