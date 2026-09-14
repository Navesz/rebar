#!/usr/bin/env node
// THE VERSION TABLE OF THE GENERATED MCP SERVER, derived from git history.
//
// Every project `rebar new` makes carries a byte copy of
// new/gate/arquivos/mcp-rebar.mjs as `.rebar/mcp.mjs`, and rebar-security's
// mcp-integrity rule accepts that file only when its sha256 is a version rebar
// shipped. The list of versions is this file's output,
// tooling/security/injection/modelos-mcp.json, and it lives under
// tooling/security so every copy of the security ruler carries it (the gate's
// mirrors copy tooling/security whole and have no new/ folder).
//
// WHY FROM HISTORY AND NOT BY HAND. A hand-kept list forgets the version nobody
// remembers shipping, and that is the version a site still tracks: measured on
// 2026-09-13, rebar-site tracks version 2 of 6, a blob last touched on
// 2026-09-03. `git log` over both paths the template ever had
// (novo/portao/arquivos/ before the English rename, new/gate/arquivos/ after)
// lists every commit that changed it; ONE `git cat-file --batch` reads all the
// blobs. Measured: 6 commits, 6 versions, 178 ms with one batch against 3,516 ms
// with one process per blob.
//
// THE CURRENT FILE HAS NO COMMIT YET, and the table must not depend on that.
// A commit cannot contain its own id, so the entry for the bytes on disk is
// written with `desde: null, data: null, atual: true`; the JSON is then the same
// before and after the commit that changes the template.
//
// EVERY ENTRY IS PROVED, not only the ones history requires. Until this
// version the check tolerated an entry it could not find in history, so a
// squash merge would not turn main red; measured by review on 2026-09-13, that
// also let a hand-added entry (an arbitrary sha256, blob `bbbb…`, desde
// `cccc…`) pass the `mcp-template` step, and every rebar-security built from
// that commit then accepted those bytes as a known server. So the committed
// table must now equal the one this file derives. The price is stated: a pull
// request that commits the template in more than one commit leaves on the table
// a version that a squash merge removes from main's history, and main's gate
// fails until `--escrever` runs there. Squash such a branch before merging.
//
//   node new/gate/modelos-mcp.mjs --escrever    writes the table (then npm run format)
//   node new/gate/modelos-mcp.mjs --verificar   exits 1 and prints what is stale

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const FONTES_HISTORICAS = [
  'novo/portao/arquivos/mcp-rebar.mjs',
  'new/gate/arquivos/mcp-rebar.mjs',
]
export const CAMINHO_DA_TABELA = 'tooling/security/injection/modelos-mcp.json'
const MODELO_ATUAL = 'new/gate/arquivos/mcp-rebar.mjs'

// The two blobs the published sites track today (rebar-site: version 2;
// assay and navesz-portfolio: version 6). If history is ever rewritten and
// either vanishes from the table, those projects fail mcp-integrity for code
// rebar generated, so their absence is a gate failure, not a quiet regeneration.
const ANCORAS_DOS_SITES = [
  '21718883da0c94877abc2b0298ee70986f052639de59e8778d2d1f78df9ca33e',
  'e88672736caa94c5a191ad6423c7371b8815b8f37b874748cbdef1049eafcbd5',
]

/**
 * Versions rebar-security refuses although rebar shipped them, by sha256, with
 * the reason printed in the finding. Reviewed by hand: whether a file runs code
 * when it starts is not something a text test can decide.
 *
 * Version 1 is a launcher, not a server: on every session start, with no tool
 * called, it runs `npx --yes github:Navesz/rebar --mcp` (whatever rebar's
 * default branch holds that minute) and falls back to `spawnSync('npx', …,
 * { shell: true })`. Measured by review on 2026-09-13: started the way a client
 * starts it, offline with an isolated cache, it requested the tarball of main's
 * current HEAD. Versions 2 to 6 also name the unpinned spec, but only run it
 * when `rebar_verificar {regua: true}` is called, and rebar-site (version 2),
 * assay and navesz-portfolio (version 6) track them today: they stay a note
 * that says so (see ESPEC_SOLTA).
 */
const RECUSADAS = {
  '2d40b7edbca63e0962ab24ffe8ec783c3bc5f9e5c4356ac65533b16016da78fa':
    'it starts npx --yes github:Navesz/rebar --mcp, unpinned, every time the client starts it, ' +
    'with a shell: true fallback',
}

/** Text a version names when it runs rebar unpinned on `regua: true`. */
const ESPEC_SOLTA = "'github:Navesz/rebar'"

/**
 * Text a version holds when it predates the English hook names (version 2):
 * the current server looks for `.githooks/scan-secret.mjs`, `check-message.mjs`,
 * `install.mjs` and `.rebar-coauthors`, so the server file alone is not an
 * update there (measured on a clone of rebar-site: two rules DESARMADA).
 */
const GANCHO_ANTIGO = 'varrer-segredo.mjs'

const sha256 = (b) => createHash('sha256').update(b).digest('hex')

/** The fields each entry derives from its own bytes. */
function derivados(h, bytes) {
  const texto = bytes.toString('utf8')
  return {
    recusada: Object.hasOwn(RECUSADAS, h) ? RECUSADAS[h] : null,
    regua_sem_pino: texto.includes(ESPEC_SOLTA),
    ganchos_antigos: texto.includes(GANCHO_ANTIGO),
  }
}

function git(raiz, args, entrada) {
  const r = spawnSync('git', args, {
    cwd: raiz,
    encoding: 'buffer',
    input: entrada,
    maxBuffer: 1 << 30,
    windowsHide: true,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' },
  })
  if (r.error) throw new Error(`git ${args[0]} did not run: ${r.error.message}`)
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${r.status}: ${String(r.stderr).trim()}`)
  }
  return r.stdout
}

/** Every distinct template blob in the history of HEAD, oldest first. */
function versoesDaHistoria(raiz) {
  if (git(raiz, ['rev-parse', '--is-shallow-repository']).toString('utf8').trim() === 'true') {
    throw new Error('shallow clone: the history of the template is incomplete')
  }
  const commits = git(raiz, [
    'log',
    '--full-history',
    '--reverse',
    '--format=%H %cs',
    'HEAD',
    '--',
    ...FONTES_HISTORICAS,
  ])
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [id, data] = l.split(' ')
      return { id, data }
    })
  const pedidos = commits.flatMap((c) =>
    FONTES_HISTORICAS.map((f) => ({ ...c, rotulo: `${c.id}:${f}` })),
  )
  if (!pedidos.length) return []
  const saida = git(
    raiz,
    ['cat-file', '--batch'],
    Buffer.from(`${pedidos.map((p) => p.rotulo).join('\n')}\n`),
  )

  // `--batch` answers in request order: `<oid> blob <size>\n<bytes>\n`, or
  // `<request> missing\n` for a path the commit does not have (the rename).
  const versoes = []
  const vistos = new Set()
  let k = 0
  for (const pedido of pedidos) {
    const fim = saida.indexOf(0x0a, k)
    const cabeca = saida.subarray(k, fim).toString('utf8')
    k = fim + 1
    if (cabeca.endsWith(' missing')) continue
    const m = /^([0-9a-f]{40}) blob (\d+)$/.exec(cabeca)
    if (!m)
      throw new Error(
        `git cat-file --batch answered ${JSON.stringify(cabeca)} for ${pedido.rotulo}`,
      )
    const tamanho = Number(m[2])
    const bytes = saida.subarray(k, k + tamanho)
    k += tamanho + 1
    const h = sha256(bytes)
    if (vistos.has(h)) continue
    vistos.add(h)
    versoes.push({
      sha256: h,
      blob: m[1],
      bytes: tamanho,
      desde: pedido.id,
      data: pedido.data,
      ...derivados(h, bytes),
    })
  }
  return versoes
}

export function gerarTabela(raiz) {
  const historia = versoesDaHistoria(raiz)
  const disco = readFileSync(join(raiz, ...MODELO_ATUAL.split('/')))
  const hDisco = sha256(disco)
  const blobDisco = git(raiz, ['hash-object', '--no-filters', MODELO_ATUAL]).toString('utf8').trim()
  const versoes = historia.map((v, i) => ({
    ordem: i + 1,
    sha256: v.sha256,
    blob: v.blob,
    bytes: v.bytes,
    desde: v.sha256 === hDisco ? null : v.desde,
    data: v.sha256 === hDisco ? null : v.data,
    atual: v.sha256 === hDisco,
    recusada: v.recusada,
    regua_sem_pino: v.regua_sem_pino,
    ganchos_antigos: v.ganchos_antigos,
  }))
  if (!versoes.some((v) => v.atual)) {
    versoes.push({
      ordem: versoes.length + 1,
      sha256: hDisco,
      blob: blobDisco,
      bytes: disco.length,
      desde: null,
      data: null,
      atual: true,
      ...derivados(hDisco, disco),
    })
  }
  return {
    esquema: 2,
    gerado_por: 'new/gate/modelos-mcp.mjs',
    destino: '.rebar/mcp.mjs',
    fontes: FONTES_HISTORICAS,
    versoes,
  }
}

const curto = (h) => String(h ?? '').slice(0, 12)

/**
 * What is stale or unproved in the committed table, as sentences; [] when it
 * equals the table derived from HEAD's history and the file on disk.
 *
 * `texto` replaces the committed file, so a proof can hand in a doctored table.
 */
export function conferirTabela(raiz, { texto } = {}) {
  let tabela
  try {
    tabela = JSON.parse(texto ?? readFileSync(join(raiz, ...CAMINHO_DA_TABELA.split('/')), 'utf8'))
  } catch (e) {
    return [`${CAMINHO_DA_TABELA} cannot be read: ${e.message}`]
  }
  const versoes = Array.isArray(tabela?.versoes) ? tabela.versoes : []
  if (tabela?.esquema !== 2 || !versoes.length) {
    return [`${CAMINHO_DA_TABELA} has no esquema 2 with a non-empty versoes list`]
  }
  const esperada = gerarTabela(raiz)
  const diferencas = []
  const porSha = new Map(esperada.versoes.map((v) => [v.sha256, v]))
  const presentes = new Set()
  for (const v of versoes) {
    const e = porSha.get(v?.sha256)
    presentes.add(v?.sha256)
    if (!e) {
      diferencas.push(
        `entry ${v?.ordem} (sha256:${curto(v?.sha256)}, blob ${curto(v?.blob).slice(0, 7)}) is neither ` +
          `a version of ${MODELO_ATUAL} in the history of HEAD nor the file on disk — nothing proves ` +
          'rebar shipped those bytes (a hand-added entry, or a branch version a squash merge dropped: ' +
          'run --escrever)',
      )
      continue
    }
    for (const campo of Object.keys(e)) {
      if (JSON.stringify(v[campo]) !== JSON.stringify(e[campo])) {
        diferencas.push(
          `entry sha256:${curto(e.sha256)}: ${campo} is ${JSON.stringify(v[campo])}, and the ` +
            `history says ${JSON.stringify(e[campo])}`,
        )
      }
    }
  }
  for (const e of esperada.versoes) {
    if (presentes.has(e.sha256)) continue
    diferencas.push(
      e.atual
        ? `${MODELO_ATUAL} on disk (sha256:${curto(e.sha256)}) is not in the table`
        : `blob ${e.blob.slice(0, 7)} (first in ${e.desde.slice(0, 7)} on ${e.data}) is in the ` +
            'history of HEAD and not in the table',
    )
  }
  if (!diferencas.length && JSON.stringify(tabela) !== JSON.stringify(esperada)) {
    diferencas.push('the entries or the header differ from the derived table in order or shape')
  }
  for (const ancora of ANCORAS_DOS_SITES) {
    if (!presentes.has(ancora)) {
      diferencas.push(`sha256:${curto(ancora)}, tracked by a published site, left the table`)
    }
  }
  return diferencas
}

if (pathToFileURL(process.argv[1] || '').href === import.meta.url) {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  if (process.argv.includes('--escrever')) {
    const t = gerarTabela(raiz)
    writeFileSync(join(raiz, ...CAMINHO_DA_TABELA.split('/')), `${JSON.stringify(t, null, 2)}\n`)
    process.stdout.write(`${CAMINHO_DA_TABELA}: ${t.versoes.length} version(s) written\n`)
  } else if (process.argv.includes('--verificar')) {
    const d = conferirTabela(raiz)
    for (const linha of d) process.stdout.write(`FALHA ${linha}\n`)
    process.exitCode = d.length ? 1 : 0
  } else {
    process.stderr.write('usage: node new/gate/modelos-mcp.mjs --escrever | --verificar\n')
    process.exitCode = 2
  }
}
