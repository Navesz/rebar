// reader — what the injection rules read, and how: the INDEX, never the disk.
//
// WHY ITS OWN READER. rebar-check's lerRepo was measured against the attacks
// these rules exist for, and lost on each one. It reads the disk
// (rebar-check/index.mjs:125), so an index that differs from the working copy
// goes through. It honors .rebarignore, and a two-line .rebarignore hid
// .github/workflows. It trims git output, which dropped a trailing U+FEFF from
// a commit message. And git's own defaults hide more: a directory symlink named
// `.claude` makes `.claude/settings.json` vanish from ls-files, `git replace`
// hands cat-file a clean substitute blob, and a UTF-32LE BOM read as UTF-16LE
// comes out as NUL-laced noise.
//
// So this file reads stage-0 index entries (ls-files -s -z + cat-file), with
// replace objects off, no optional locks, no fsmonitor and no path quoting,
// decodes by BOM (UTF-32 before UTF-16), resolves and mounts symlinks, and
// honors no exemption of any kind: no proof roots, no template roots, no
// .rebarignore. What it cannot read, it says, per entry.
//
// ─────────────────────────────────────────────────────────────── the API
//
/**
 * @typedef {'agente' | 'codigo' | 'prosa' | 'dados'} Tipo
 *   'agente' — a file an AI client loads or obeys: instruction files, agent and
 *   MCP config, and anything they pull in (see tipoDoCaminho and the upgrades).
 *
 * @typedef {object} Entrada
 * @property {string} caminho      repo-relative, '/' separated, raw (never quoted)
 * @property {string} modo         '100644' | '100755' | '120000'
 * @property {string} oid          blob id of THIS index entry (for a link: the link blob)
 * @property {number} tamanho      full blob size in bytes, even when truncated
 * @property {Buffer|null} bytes   the blob (cut at 8 MiB), null when 'ausente'
 * @property {string|null} texto   decoded text, BOM consumed. NULL when there is
 *                                 nothing to scan: estado 'ausente' or 'binario',
 *                                 or a symlink that does not resolve to a tracked file.
 * @property {'utf-8'|'utf-8-bom'|'utf-16le'|'utf-16be'|'utf-32le'|'utf-32be'|'utf-8-invalido'} codificacao
 * @property {'ok'|'truncado'|'ausente'|'binario'|'lfs'} estado
 * @property {Tipo} tipo
 * @property {boolean} temNul      the text holds U+0000 (for 'binario': the first 8000 bytes hold
 *                                 0x00; a NUL-free blob is 'binario' when its first 8000 bytes
 *                                 are not UTF-8 and at least 20% of them decode to U+FFFD or C0)
 * @property {null | { alvo: string, resolvido: string|null, externo: boolean, pasta: boolean }} symlink
 *   Set on mode 120000 entries. `alvo` is the target as written (scan it as a
 *   NAME). `resolvido` is the tracked path it ends at ('' is the repo root),
 *   followed through up to 8 links; null when `externo`. `externo` is true for
 *   an absolute, out-of-repo, dangling or looping target. `pasta` is true when
 *   it resolves to a tracked directory. A link that resolves to a tracked FILE
 *   carries that file's bytes, texto, codificacao, estado, temNul and tamanho.
 * @property {string|null} viaSymlink
 *   Set on VIRTUAL entries: a directory link `L -> D` mounts `L/<rest>` for
 *   every tracked entry `D/<rest>`, with that file's content, so a rule
 *   looking for `.claude/settings.json` finds it behind a `.claude` link. A
 *   link under D is followed: a file link mounts the file it resolves to, a
 *   folder link mounts again (no loop), and a link that resolves nowhere
 *   mounts with `symlink.externo` true and no text.
 *   Entries with `symlink` or `viaSymlink` set repeat content that also has its
 *   own real entry; rules that count findings per blob may skip them.
 * @property {{ filtro: string|null, semDiff: boolean, gerado: boolean, codificacaoDeDisco: string|null, exportSubst: boolean }} atributos
 *   From `git check-attr --cached` (the INDEX .gitattributes). Every real regular
 *   entry and every 'agente' entry is queried; a link or a mounted path that is
 *   not an agent path keeps the neutral values (null, false). The values are the
 *   union of what a case-sensitive and a case-insensitive checkout apply
 *   (core.ignorecase false and true), so the verdict does not depend on the OS
 *   of the clone that reads it.
 * @property {boolean} nomeUtf8Invalido  the path bytes are not valid UTF-8
 *
 * lerIndice(dir, { semMemoria = false } = {})
 *   -> { entradas: Entrada[], gitlinks: Array<{ caminho, oid }>, colisoes: string[][],
 *        porCaminho: Map<string, Entrada>, origem: Map<Entrada, Entrada>, semGit: boolean }
 *   `origem` maps each link or mounted entry that shows a tracked file to the
 *   real regular entry whose bytes it carries.
 *   Memoized per path.resolve(dir). `entradas` holds real entries first, then
 *   virtual ones. `colisoes` are groups of 2+ paths equal under toLowerCase()
 *   where at least one is 'agente'. `semGit` is true (and everything empty) only
 *   when `dir` is not inside a git work tree; any other git failure, and an
 *   unmerged (stage != 0) entry, THROWS, which the executor turns into quebrou.
 *
 * problemasDeLeitura(entrada, indice) -> string[]
 *   For 'agente' entries only (otherwise []): any of 'ausente', 'truncado',
 *   'lfs', 'nul', 'utf-8-invalido', 'filtro', 'semDiff', 'gerado',
 *   'working-tree-encoding', 'export-subst', 'symlink-externo', 'colisao'.
 *   Each one means the agent may read something other than what the rule and
 *   the reviewer see. PROBLEMAS_DO_CAMINHO lists the ones a link or mounted
 *   entry reports for its own path.
 *
 * formatosDeEscape(indice) -> Map<Entrada, Map<formato, caminho>>
 *   For each real regular entry, the escape dialects its bytes are parsed with,
 *   from its own path and from every link or mounted path that shows it.
 *
 * textosNoDisco(entrada) -> string[]
 *   The text an agent reading the checkout as UTF-8 sees when
 *   working-tree-encoding is a UTF-16 or UTF-32 name; [] otherwise.
 *
 * repositorioDeOrigem(dir) -> 'owner/name' | null   from remote.origin.url; null when unknown
 *
 * lerCommits(dir, { semMemoria = false } = {}) -> Array<{ id, mensagem, codificacao: 'utf-8'|'utf-8-invalido' }>
 *   Every commit reachable from HEAD, newest first, message raw (no trim, no
 *   BOM handling). No HEAD, or no repository: [].
 *
 * lerAllowlist(dir) -> {
 *   `entradas: Array<{ linha, regra, motivo, forma: string[], arquivo?, oid?, commit?, ponteiro?, servidor?, sha256? }>`,
 *   erros: Array<{ linha, coluna, mensagem }>,  // any error: EVERY injection rule reprova, not exemptable
 *   naoRastreada: boolean,          // a copy exists on disk but not in the index (it is ignored: nota)
 *   rastreada: boolean,
 *   cobertaPorCodeowners: boolean,  // the CODEOWNERS GitHub would use has an owner for the file
 *   aceita(regra, chave) -> boolean,  // chave: {arquivo, oid} | {commit} | {arquivo, ponteiro, sha256} | {arquivo, servidor, sha256}; records use
 *   obsoletas(regra) -> number,       // entries of `regra` that no aceita() call used so far
 * }
 *   `.rebar-injection-allowlist`, JSON Lines read from the INDEX blob; blank
 *   lines and lines starting with # are skipped. Each object is exactly
 *   {regra, motivo (1-200 code points)} plus one key shape. A motivo that
 *   contains MOTIVO_A_ESCREVER (whitespace collapsed, case ignored) is an error
 *   line. Not memoized: every call returns fresh use counters.
 *
 * sugerirEntrada(r, regra, chave) -> void
 *   Records `{ regra, chave }` in `r.sugestoesDaAllowlist` when the caller made
 *   that an array (the `--sugerir-allowlist` option of index.mjs); a no-op
 *   otherwise. An engine calls it where a reprova finding stands that `chave`,
 *   passed to aceita(), would exempt.
 *
 * posicao(texto, indice) -> { linha, coluna }
 *   `indice` is a UTF-16 offset (what indexOf returns). 1-based; `linha` counts
 *   LF; `coluna` counts code points since the line start.
 * onde(caminho, linha, coluna) -> `${escaparSaida(caminho)}:${linha}:${coluna}`
 * resumir(itens, max = 12) -> the first `max` joined with ' · ', plus ' …and N more'
 * impressao(texto) -> `sha256:<first 12 hex> len:<code points>` (UTF-8 hash);
 *   the only way free text from a repository is printed.
 *
 * Also exported: decodificarBlob(bytes) -> { texto, codificacao }, tipoDoCaminho(caminho) -> Tipo,
 * extensaoDe(caminho), EXT_TEXTO, NOMES_TEXTO, INSTRUCAO_NOME, INSTRUCAO_CAMINHO,
 * CODIGO, PROSA, LIMITE_DE_BLOB, NOME_DA_ALLOWLIST, REGRAS_DA_ALLOWLIST,
 * FORMAS_DE_CHAVE, MOTIVO_A_ESCREVER, PROBLEMAS_DO_CAMINHO, EXTENSOES_COM_FRONTMATTER.
 */

import { isUtf8 } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'

import { escaparSaida } from '../texto-seguro.mjs'
import { FORMATO_POR_EXTENSAO, lerJsonc, lerToml, lerYaml } from './formats.mjs'

/**
 * The same ceiling as `LIMITE_BYTES` in tooling/secret/scan-secret.mjs, named
 * and not cited by line: a line number there went stale when that file's header
 * grew by 40 lines. A blob above it is read truncated and SAID so, per entry: an
 * 8 MiB instruction file is already an anomaly, and reading it whole would let
 * one blob blow the process memory.
 */
export const LIMITE_DE_BLOB = 8 * 1024 * 1024

/** Bytes of blob content per `cat-file --batch` call. */
const LOTE_DE_BYTES = 64 * 1024 * 1024

/** git reads the first 8000 bytes to decide "binary" (xdiff FIRST_FEW_BYTES). */
const JANELA_BINARIA = 8000

/**
 * The share of replacement characters and C0 controls (TAB, LF and CR aside)
 * above which a window that is not valid UTF-8 is binary. git's NUL test
 * assumes every binary holds a 0x00 early, and a small compressed or encrypted
 * blob often has none: 243 random bytes miss one with probability
 * (255/256)^243, about 39%. Measured on an honest repository of extracted
 * firmware: 808 tracked blobs of invalid UTF-8 with no text extension, every
 * one with 30% to 60% of its first 8000 code points replaced or C0, and 25,972
 * control-bytes findings on them. Latin-1 documents sit near 0.3% (3 SVGs in
 * another repository at 0.002 to 0.003), so 20% separates the two with room.
 */
const RAZAO_BINARIA = 0.2

/**
 * Whether the start of a blob reads as encrypted or compressed bytes rather
 * than text in a legacy code page. It opens no new evasion: every path that
 * reaches this test could already be made binary with one 0x00 byte, and
 * agent files and must-be-text paths never reach it.
 */
function pareceCifrado(b) {
  const janela = b.subarray(0, JANELA_BINARIA)
  if (isUtf8(janela)) return false
  let total = 0
  let ruins = 0
  for (const ch of janela.toString('utf8')) {
    const c = ch.codePointAt(0)
    total++
    if (c === 0xfffd || (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d)) ruins++
  }
  return total > 0 && ruins / total >= RAZAO_BINARIA
}

export const NOME_DA_ALLOWLIST = '.rebar-injection-allowlist'

/**
 * The motivo `--sugerir-allowlist` prints on every line it suggests. The reader
 * refuses any motivo that contains it: a line pasted as printed exempts
 * nothing, because a fixed placeholder says why no person accepted anything.
 * "Contains" and not "equals", so appending a word to it is refused too. The
 * comparison first drops every space, punctuation mark, symbol and format
 * character: measured on the first cut, which only collapsed runs of spaces,
 * the placeholder with the space after its colon deleted was a valid motivo
 * and exempted two findings.
 */
export const MOTIVO_A_ESCREVER = 'TODO: write why a person accepted this finding'
const normalizarMotivo = (s) =>
  String(s)
    .replace(/[\s\p{P}\p{S}\p{Cf}]+/gu, '')
    .toLowerCase()

/** See the API block: records a suggested allowlist key when the caller asked for them. */
export function sugerirEntrada(r, regra, chave) {
  if (r && typeof r === 'object' && Array.isArray(r.sugestoesDaAllowlist)) {
    r.sugestoesDaAllowlist.push({ regra, chave })
  }
}

export const REGRAS_DA_ALLOWLIST = [
  'hidden-unicode',
  'control-bytes',
  'agent-config-exec',
  'mcp-server-launch',
  'agent-bypass-invocation',
  'ai-workflow-untrusted-input',
  'mcp-ansi-escape',
]

// ───────────────────────────────────────────────────────────── classification

/**
 * Instruction and agent-config files, by basename. The core is the list
 * measured in phase 1; the additions come from the
 * client-by-client sourced list (Codex
 * AGENTS.override.md, Roo .roorules) and from the files the config rules read
 * (.devcontainer.json, *.code-workspace).
 */
export const INSTRUCAO_NOME =
  /^(?:AGENTS|AGENT|CLAUDE|CLAUDE\.local|GEMINI|SKILL|copilot-instructions|AGENTS\.override)\.md$|^\.(?:cursorrules|windsurfrules|clinerules|roorules(?:-[^/]*)?|mcp\.json|devcontainer\.json)$|\.code-workspace$/i

/**
 * The same, by path. Case-insensitive ON PURPOSE: on Windows and macOS a
 * tracked `.Claude/Settings.json` is exactly what the client opens as
 * `.claude/settings.json` (measured with core.ignorecase=true). A Dev Container
 * config sits at `.devcontainer/devcontainer.json` or one folder deeper, which
 * the containers.dev spec allows ("a single level deep subfolder") and bypass.mjs
 * already read; two folders deep is no config the tools look for.
 */
export const INSTRUCAO_CAMINHO =
  /(?:^|\/)(?:\.cursor\/(?:rules|mcp\.json|hooks\.json|cli\.json)|\.github\/(?:instructions|prompts|agents|chatmodes|skills|hooks)\/|\.github\/copilot-instructions\.md|\.claude\/|\.codex\/|\.gemini\/|\.roo\/|\.kiro\/|\.windsurf\/|\.devin\/|\.clinerules\/|\.amazonq\/|\.agents\/skills\/|\.vscode\/(?:mcp|settings|tasks)\.json|\.devcontainer\/(?:[^/]+\/)?devcontainer\.json|\.rebar\/)|\.mdc$/i

/** A symlink at one of these paths stands where an agent directory lives. */
const DIRETORIO_DE_AGENTE =
  /(?:^|\/)\.(?:claude|codex|gemini|cursor|vscode|github|devcontainer|roo|kiro|windsurf|devin|clinerules|amazonq|agents|rebar)$/i

/** The code and prose extensions measured in phase 1, verbatim. */
export const CODIGO = new Set(
  (
    '.js .mjs .cjs .jsx .ts .mts .cts .tsx .py .rb .go .rs .java .kt .c .h .cc .cpp .hpp .cs ' +
    '.php .sh .bash .zsh .ps1 .swift .vue .svelte .astro .sql .lua .pl .css .scss .less .map .wasm .node'
  ).split(' '),
)
export const PROSA = new Set(
  '.md .mdx .markdown .txt .rst .adoc .html .htm .xml .svg .po .pot'.split(' '),
)
const PROSA_NOME = /^(?:README|LICENSE|NOTICE|CHANGELOG|LICENCE|AUTHORS|HISTORY)(?:\.|$)/i

/**
 * Extensions and names that are text no matter what bytes they hold, so a NUL
 * cannot turn them into "binary" and out of every scan. The union of
 * the phase-1 prototype's list and the spec written after it, which adds code-workspace, kts, scala, fish, psm1 and dart.
 */
export const EXT_TEXTO = new Set(
  (
    'md mdc mdx markdown txt rst adoc json jsonc json5 code-workspace toml yml yaml ini cfg conf env ' +
    'js mjs cjs jsx ts mts cts tsx py rb go rs java kt kts scala c h cc cpp hpp cs php pl lua ' +
    'sh bash zsh fish ps1 psm1 bat cmd swift dart html htm xml svg css scss vue svelte astro ' +
    'lock gitignore gitattributes editorconfig'
  ).split(' '),
)
export const NOMES_TEXTO =
  /(^|\/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|SKILL\.md|\.cursorrules|\.windsurfrules|copilot-instructions\.md|Dockerfile|Makefile|LICENSE|NOTICE|README[^/]*|\.env[^/]*|CODEOWNERS|pre-commit|commit-msg)$/i

/** The extension without its dot; for a dotfile with no other dot, the name after the dot. */
export function extensaoDe(caminho) {
  const nome = posix.basename(caminho).toLowerCase()
  const ext = posix.extname(nome)
  if (ext && ext !== nome) return ext.slice(1)
  return nome.startsWith('.') ? nome.slice(1) : ''
}

/** The static class of a path. lerIndice may still upgrade an entry to 'agente'. */
export function tipoDoCaminho(caminho) {
  const nome = posix.basename(caminho)
  if (INSTRUCAO_NOME.test(nome) || INSTRUCAO_CAMINHO.test(caminho)) return 'agente'
  const ext = posix.extname(nome).toLowerCase()
  if (CODIGO.has(ext)) return 'codigo'
  if (PROSA.has(ext) || PROSA_NOME.test(nome)) return 'prosa'
  return 'dados'
}

// ────────────────────────────────────────────────────────────────── decoding

const SUBSTITUTO = String.fromCodePoint(0xfffd)
const NUL = String.fromCodePoint(0)

function utf32(b, littleEndian) {
  const pedacos = []
  let lote = []
  for (let k = 0; k + 3 < b.length; k += 4) {
    const v = littleEndian ? b.readUInt32LE(k) : b.readUInt32BE(k)
    // A surrogate value is kept as a lone unit, so hidden-unicode sees an
    // unpaired surrogate instead of a replacement character that hides it.
    lote.push(v > 0x10ffff ? 0xfffd : v)
    if (lote.length === 4096) {
      pedacos.push(String.fromCodePoint(...lote))
      lote = []
    }
  }
  if (lote.length) pedacos.push(String.fromCodePoint(...lote))
  if (b.length % 4) pedacos.push(SUBSTITUTO)
  return pedacos.join('')
}

/**
 * Decodes by BOM, in this order: UTF-32LE (FF FE 00 00), UTF-32BE, UTF-16LE
 * (FF FE), UTF-16BE (FE FF), UTF-8 with BOM, UTF-8.
 *
 *  - UTF-32 is checked FIRST: a BOM-only decoder like scan-secret's reads
 *    FF FE 00 00 as UTF-16LE and yields NUL-laced text (measured).
 *  - Only ONE BOM is consumed. Measured: TextDecoder with its default
 *    ignoreBOM:false silently ate a second U+FEFF; Buffer#toString keeps it,
 *    so a doubled BOM stays visible to the rules.
 *  - UTF-16 and UTF-32 are decoded by hand (swap16 for big-endian, readUInt32
 *    for UTF-32) and UTF-8 validity comes from buffer.isUtf8: none of it needs
 *    ICU, so a Node built without it decodes the same bytes the same way.
 *  - Invalid UTF-8 is still decoded (replacement characters) and marked
 *    'utf-8-invalido': outside agent files a Latin-1 doc is common and only a
 *    nota; inside them it is a reading problem.
 */
export function decodificarBlob(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xfe && b[2] === 0 && b[3] === 0) {
    return { texto: utf32(b.subarray(4), true), codificacao: 'utf-32le' }
  }
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff) {
    return { texto: utf32(b.subarray(4), false), codificacao: 'utf-32be' }
  }
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) {
    const grande = b[0] === 0xfe
    const corpo = b.subarray(2)
    const par = corpo.subarray(0, corpo.length - (corpo.length % 2))
    let unidades = par
    if (grande) {
      unidades = Buffer.from(par)
      unidades.swap16()
    }
    const sobra = corpo.length % 2 ? SUBSTITUTO : ''
    return {
      texto: unidades.toString('utf16le') + sobra,
      codificacao: grande ? 'utf-16be' : 'utf-16le',
    }
  }
  const bom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
  const corpo = bom ? b.subarray(3) : b
  const codificacao = !isUtf8(corpo) ? 'utf-8-invalido' : bom ? 'utf-8-bom' : 'utf-8'
  return { texto: corpo.toString('utf8'), codificacao }
}

const temBomUnicode = (b) =>
  b.length >= 2 &&
  ((b[0] === 0xff && b[1] === 0xfe) ||
    (b[0] === 0xfe && b[1] === 0xff) ||
    (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff))

/** Cuts a truncated blob back to a whole character of its encoding. */
function cortarNaFronteira(b) {
  if (
    b.length >= 4 &&
    ((b[0] === 0xff && b[1] === 0xfe && b[2] === 0 && b[3] === 0) ||
      (b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff))
  ) {
    return b.subarray(0, b.length - ((b.length - 4) % 4))
  }
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) {
    return b.subarray(0, b.length - ((b.length - 2) % 2))
  }
  let k = b.length - 1
  let continuacoes = 0
  while (k >= 0 && continuacoes < 3 && (b[k] & 0xc0) === 0x80) {
    k--
    continuacoes++
  }
  if (k < 0 || (b[k] & 0xc0) !== 0xc0) return b
  const precisa = b[k] >= 0xf0 ? 4 : b[k] >= 0xe0 ? 3 : 2
  return b.length - k < precisa ? b.subarray(0, k) : b
}

/**
 * The version lines git-lfs accepts as a pointer: its own spec URL and the two
 * legacy aliases (git-lfs lfs/pointer.go v1Aliases). Measured with git-lfs 3.7.1:
 * `git lfs smudge` turns a pointer under either alias into the stored object,
 * status 0, so
 * recognising only the first let a `.env` pointer be read as the `.env` itself.
 */
const MARCAS_LFS = [
  'https://git-lfs.github.com/spec/v1',
  'https://hawser.github.com/spec/v1',
  'http://git-media.io/v/2',
].map((url) => Buffer.from(`version ${url}`))
const ehPonteiroLfs = (b) =>
  MARCAS_LFS.some((m) => b.length >= m.length && b.subarray(0, m.length).equals(m))

// ─────────────────────────────────────────────────────────────────────── git

const PREFIXO_GIT = ['-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false']
const ambienteGit = () => ({ ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' })

/**
 * One git call with the target as cwd. stderr is captured and never inherited:
 * the proofs runner reads any byte on this process's stderr as "the checker
 * died". A non-zero exit throws, and the executor turns that into quebrou.
 */
function git(dir, argumentos, { entrada, aceitar = [0], ambiente } = {}) {
  const r = spawnSync('git', [...PREFIXO_GIT, ...argumentos], {
    cwd: dir,
    encoding: 'buffer',
    maxBuffer: 1 << 30,
    windowsHide: true,
    env: ambiente || ambienteGit(),
    // A string input would be encoded with `encoding`, and 'buffer' is not a
    // text encoding: Node throws ERR_UNKNOWN_ENCODING (measured).
    input: typeof entrada === 'string' ? Buffer.from(entrada, 'utf8') : entrada,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (r.error) throw new Error(`git ${argumentos[0]} did not run: ${r.error.message}`)
  if (!aceitar.includes(r.status)) {
    const linha = String(r.stderr || '')
      .split('\n')
      .find((l) => l.trim())
    throw new Error(
      `git ${argumentos.join(' ')} exited ${r.status}: ${escaparSaida((linha || '').trim(), { limite: 200 })}`,
    )
  }
  return r
}

/** Splits a buffer on NUL, keeping empty fields. */
function partirPorNul(buffer) {
  const partes = []
  let inicio = 0
  for (let k = buffer.indexOf(0); k !== -1; k = buffer.indexOf(0, inicio)) {
    partes.push(buffer.subarray(inicio, k))
    inicio = k + 1
  }
  partes.push(buffer.subarray(inicio))
  return partes
}

const MEMORIA_DE_REPOSITORIO = new Map()

/**
 * True only when `dir` is outside any work tree. The message is matched in the
 * C locale; "dubious ownership" and every other failure throw instead, so a
 * CI checkout that git refuses never reads as "nothing tracked".
 */
function foraDeRepositorio(dir) {
  if (MEMORIA_DE_REPOSITORIO.has(dir)) return MEMORIA_DE_REPOSITORIO.get(dir)
  const r = git(dir, ['rev-parse', '--is-inside-work-tree'], {
    aceitar: [0, 128],
    ambiente: { ...ambienteGit(), LC_ALL: 'C', LANGUAGE: 'C' },
  })
  let fora
  if (r.status === 0) fora = String(r.stdout).trim() !== 'true'
  else if (/not a git repository/i.test(String(r.stderr))) fora = true
  else {
    const linha = String(r.stderr).split('\n')[0].trim()
    throw new Error(`git rev-parse exited 128: ${escaparSaida(linha, { limite: 200 })}`)
  }
  MEMORIA_DE_REPOSITORIO.set(dir, fora)
  return fora
}

// ─────────────────────────────────────────────────────────────── the index

const MEMORIA_DO_INDICE = new Map()

export function lerIndice(dir, { semMemoria = false } = {}) {
  const chave = resolve(dir)
  if (!semMemoria && MEMORIA_DO_INDICE.has(chave)) return MEMORIA_DO_INDICE.get(chave)
  if (semMemoria) MEMORIA_DE_REPOSITORIO.delete(chave)
  const indice = montarIndice(chave)
  MEMORIA_DO_INDICE.set(chave, indice)
  return indice
}

function lerBlobs(dir, oids) {
  const blobs = new Map()
  if (oids.length === 0) return blobs
  const verificacao = git(dir, ['cat-file', '--batch-check'], { entrada: `${oids.join('\n')}\n` })
  for (const linha of verificacao.stdout.toString('latin1').split('\n')) {
    if (!linha) continue
    const partes = linha.split(' ')
    if (partes[1] === 'missing') {
      blobs.set(partes[0], { tamanho: 0, bytes: null, ausente: true, truncado: false })
      continue
    }
    if (partes.length !== 3 || partes[1] !== 'blob') {
      throw new Error(
        `git cat-file --batch-check: an index entry is not a blob (${escaparSaida(linha)})`,
      )
    }
    blobs.set(partes[0], {
      tamanho: Number(partes[2]),
      bytes: null,
      ausente: false,
      truncado: false,
    })
  }

  let lote = []
  let bytesDoLote = 0
  const despejar = () => {
    if (lote.length === 0) return
    const saida = git(dir, ['cat-file', '--batch'], { entrada: `${lote.join('\n')}\n` }).stdout
    let p = 0
    while (p < saida.length) {
      const fimDoCabecalho = saida.indexOf(0x0a, p)
      if (fimDoCabecalho === -1) break
      const cabecalho = saida.toString('latin1', p, fimDoCabecalho).split(' ')
      p = fimDoCabecalho + 1
      const blob = blobs.get(cabecalho[0])
      if (!blob)
        throw new Error('git cat-file --batch answered for an object it was not asked about')
      if (cabecalho[1] === 'missing') {
        blob.ausente = true
        continue
      }
      const tamanho = Number(cabecalho[2])
      blob.bytes = saida.subarray(p, p + tamanho)
      p += tamanho + 1 // git closes each blob with one extra LF
    }
    for (const oid of lote) {
      const blob = blobs.get(oid)
      if (!blob.ausente && blob.bytes === null)
        throw new Error(`git cat-file --batch did not return ${oid}`)
    }
    lote = []
    bytesDoLote = 0
  }

  for (const [oid, blob] of blobs) {
    if (blob.ausente) continue
    if (blob.tamanho > LIMITE_DE_BLOB) {
      blob.bytes = lerTruncado(dir, oid)
      blob.truncado = true
      continue
    }
    if (bytesDoLote + blob.tamanho > LOTE_DE_BYTES) despejar()
    lote.push(oid)
    bytesDoLote += blob.tamanho
  }
  despejar()
  return blobs
}

/**
 * A blob over the ceiling is read on its own and cut. spawnSync with maxBuffer
 * blown kills git and still hands over what it read: scan-secret measured a
 * 1 MiB ceiling against a 5 MiB blob returning 1,114,112 bytes, beginning
 * intact. Memory stays bounded by the ceiling, not by the blob.
 */
function lerTruncado(dir, oid) {
  const r = spawnSync('git', [...PREFIXO_GIT, 'cat-file', 'blob', oid], {
    cwd: dir,
    encoding: 'buffer',
    maxBuffer: LIMITE_DE_BLOB,
    windowsHide: true,
    env: ambienteGit(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const saida = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.alloc(0)
  if (saida.length < LIMITE_DE_BLOB) {
    throw new Error(`git cat-file blob ${oid} returned ${saida.length} bytes of a blob over 8 MiB`)
  }
  return cortarNaFronteira(saida.subarray(0, LIMITE_DE_BLOB))
}

const ATRIBUTOS_NEUTROS = () => ({
  filtro: null,
  semDiff: false,
  gerado: false,
  codificacaoDeDisco: null,
  exportSubst: false,
})

function montarIndice(dir) {
  if (foraDeRepositorio(dir)) {
    return {
      entradas: [],
      gitlinks: [],
      colisoes: [],
      porCaminho: new Map(),
      origem: new Map(),
      semGit: true,
    }
  }

  // 1. The index, raw.
  const reais = []
  const gitlinks = []
  for (const registro of partirPorNul(git(dir, ['ls-files', '-s', '-z']).stdout)) {
    if (registro.length === 0) continue
    const tab = registro.indexOf(0x09)
    if (tab === -1) throw new Error('git ls-files -s printed a record without a tab')
    const [modo, oid, estagio] = registro.toString('latin1', 0, tab).split(' ')
    const bytesDoCaminho = registro.subarray(tab + 1)
    const caminho = bytesDoCaminho.toString('utf8')
    if (estagio !== '0') {
      throw new Error(
        `unmerged index: ${escaparSaida(caminho)} is at stage ${estagio}; finish the merge before auditing`,
      )
    }
    if (modo === '160000') {
      gitlinks.push({ caminho, oid })
      continue
    }
    reais.push({
      caminho,
      modo,
      oid,
      tamanho: 0,
      bytes: null,
      texto: null,
      codificacao: 'utf-8',
      estado: 'ok',
      tipo: tipoDoCaminho(caminho),
      temNul: false,
      symlink: null,
      viaSymlink: null,
      atributos: ATRIBUTOS_NEUTROS(),
      nomeUtf8Invalido: !isUtf8(bytesDoCaminho),
    })
  }

  // 2. Blobs, once per oid.
  const blobs = lerBlobs(dir, [...new Set(reais.map((e) => e.oid))])
  // Links resolve against REAL entries only; virtual ones join `porCaminho`
  // after, so no link ever points at content that is not filled in yet.
  const reaisPorCaminho = new Map(reais.map((e) => [e.caminho, e]))
  const porCaminho = new Map(reaisPorCaminho)
  const pastas = new Set()
  for (const e of reais) {
    for (let k = e.caminho.indexOf('/'); k !== -1; k = e.caminho.indexOf('/', k + 1)) {
      pastas.add(e.caminho.slice(0, k))
    }
  }

  // 3. Symlinks: resolve, and mount directory links.
  const alvoDe = (e) => {
    const blob = blobs.get(e.oid)
    return blob && blob.bytes ? blob.bytes.toString('utf8') : null
  }
  const resolver = (link, alvo) => {
    let atualLink = link
    let atualAlvo = alvo
    for (let salto = 0; salto < 8; salto++) {
      if (atualAlvo === null || atualAlvo === '' || atualAlvo.includes(NUL)) return null
      if (/^(?:[\\/]|[A-Za-z]:|~)/.test(atualAlvo)) return null
      let p = posix.normalize(posix.join(posix.dirname(atualLink), atualAlvo))
      if (p === '..' || p.startsWith('../')) return null
      if (p === '.' || p === './') p = ''
      p = p.replace(/\/+$/, '')
      // A link inside the path (a/link/x) is followed before the rest.
      const partes = p === '' ? [] : p.split('/')
      let desvio = null
      for (let k = 0; k < partes.length - 1; k++) {
        const prefixo = partes.slice(0, k + 1).join('/')
        const talvez = reaisPorCaminho.get(prefixo)
        if (talvez && talvez.modo === '120000') {
          desvio = { prefixo, resto: partes.slice(k + 1).join('/'), link: talvez }
          break
        }
        if (talvez) return null
      }
      if (desvio) {
        const base = resolver(desvio.link.caminho, alvoDe(desvio.link))
        if (!base || !base.pasta) return null
        atualLink = `${base.resolvido ? `${base.resolvido}/` : ''}_`
        atualAlvo = desvio.resto
        continue
      }
      if (p === '') return { resolvido: '', pasta: true }
      const e = reaisPorCaminho.get(p)
      if (e && e.modo === '120000') {
        atualLink = p
        atualAlvo = alvoDe(e)
        continue
      }
      if (e) return { resolvido: p, pasta: false }
      if (pastas.has(p)) return { resolvido: p, pasta: true }
      return null
    }
    return null
  }

  const virtuais = []
  const origem = new Map() // link or virtual entry -> the real regular entry whose content it shows

  /**
   * Mounts `<caminhoDoLink>/<rest>` for every tracked entry under the folder
   * `alvo`. A link found under it is followed as the OS follows it: a file link
   * mounts the file it ends at (`.claude -> cfg` with `cfg/settings.json` itself
   * a link still shows the settings), a folder link mounts again, and a link
   * that does not resolve mounts as an external link, so an agent path behind
   * it fails as unreadable instead of vanishing. `cadeia` holds the folders
   * already being mounted, which stops a link that points back up.
   */
  const montar = (link, caminhoDoLink, alvo, cadeia) => {
    const prefixo = alvo === '' ? '' : `${alvo}/`
    for (const alvoReal of reais) {
      if (!alvoReal.caminho.startsWith(prefixo)) continue
      const caminho = `${caminhoDoLink}/${alvoReal.caminho.slice(prefixo.length)}`
      if (porCaminho.has(caminho)) continue
      let fonte = alvoReal
      let symlink = null
      if (alvoReal.modo === '120000') {
        const blob = blobs.get(alvoReal.oid)
        const r2 = blob && !blob.ausente ? resolver(alvoReal.caminho, alvoDe(alvoReal)) : null
        if (r2 && r2.pasta) {
          const volta = cadeia.some(
            (p) => r2.resolvido === '' || p === r2.resolvido || p.startsWith(`${r2.resolvido}/`),
          )
          if (!volta && cadeia.length < 8)
            montar(link, caminho, r2.resolvido, [...cadeia, r2.resolvido])
          continue
        }
        if (r2) fonte = reaisPorCaminho.get(r2.resolvido)
        else {
          const texto = alvoDe(alvoReal)
          symlink = {
            alvo: texto === null ? '' : texto,
            resolvido: null,
            externo: true,
            pasta: false,
          }
        }
      }
      const virtual = {
        ...fonte,
        caminho,
        tipo: tipoDoCaminho(caminho),
        symlink,
        viaSymlink: link.caminho,
        atributos: ATRIBUTOS_NEUTROS(),
      }
      virtuais.push(virtual)
      porCaminho.set(caminho, virtual)
      if (!symlink) origem.set(virtual, fonte)
    }
  }

  for (const e of reais) {
    if (e.modo !== '120000') continue
    const blob = blobs.get(e.oid)
    const alvo = alvoDe(e)
    const r = blob && !blob.ausente ? resolver(e.caminho, alvo) : null
    e.symlink = {
      alvo: alvo === null ? '' : alvo,
      resolvido: r ? r.resolvido : null,
      externo: r === null,
      pasta: Boolean(r && r.pasta),
    }
    if (DIRETORIO_DE_AGENTE.test(e.caminho)) e.tipo = 'agente'
    if (!r) continue
    if (!r.pasta) {
      origem.set(e, reaisPorCaminho.get(r.resolvido))
      continue
    }
    montar(e, e.caminho, r.resolvido, [r.resolvido])
  }
  const todas = [...reais, ...virtuais]

  // 4. Upgrades to 'agente'.
  const textoCru = new Map()
  const textoDe = (e) => {
    const real = origem.get(e) || e
    if (real.modo === '120000') return null
    const blob = blobs.get(real.oid)
    if (!blob || !blob.bytes) return null
    if (!textoCru.has(real.oid)) textoCru.set(real.oid, decodificarBlob(blob.bytes).texto)
    return textoCru.get(real.oid)
  }
  const elevar = (e) => {
    if (!e) return
    e.tipo = 'agente'
    const real = origem.get(e)
    if (real) real.tipo = 'agente'
  }
  const propagar = () => {
    for (const [e, real] of origem) if (e.tipo === 'agente' && real) real.tipo = 'agente'
  }
  propagar()

  const nomesExtras = new Set()
  for (const e of todas) {
    if (/(?:^|\/)\.gemini\/settings\.json$/i.test(e.caminho)) {
      const t = textoDe(e)
      const r = t === null ? null : lerJsonc(t)
      const nome = r && !r.erro && r.valor ? r.valor.context?.fileName : undefined
      for (const n of [nome].flat())
        if (typeof n === 'string' && n) nomesExtras.add(n.toLowerCase())
    }
    if (/(?:^|\/)\.codex\/config\.toml$/i.test(e.caminho)) {
      const t = textoDe(e)
      const r = t === null ? null : lerToml(t)
      const nomes = r && !r.erro && r.valor ? r.valor.project_doc_fallback_filenames : undefined
      for (const n of [nomes].flat())
        if (typeof n === 'string' && n) nomesExtras.add(n.toLowerCase())
    }
    if (/(?:^|\/)\.aider\.conf\.ya?ml$/i.test(e.caminho)) {
      const t = textoDe(e)
      const r = t === null ? null : lerYaml(t)
      const lidos = r && !r.erro && r.valor && typeof r.valor === 'object' ? [r.valor.read] : []
      // A repeated `read:` key: every copy is upgraded, whichever one aider keeps.
      for (const d of r && !r.erro ? r.duplicatas : []) {
        if (d.ponteiro === '/read') lidos.push(...d.ocorrencias.map((o) => o.valor))
      }
      for (const n of lidos.flat()) {
        if (typeof n !== 'string' || !n || /^(?:[\\/]|[A-Za-z]:|~)/.test(n)) continue
        const p = posix.normalize(posix.join(posix.dirname(e.caminho), n))
        elevar(porCaminho.get(p))
      }
    }
  }
  const casaNomeExtra = (caminho) => {
    const baixo = caminho.toLowerCase()
    for (const nome of nomesExtras) if (baixo === nome || baixo.endsWith(`/${nome}`)) return true
    return false
  }
  if (nomesExtras.size) for (const e of todas) if (casaNomeExtra(e.caminho)) elevar(e)

  // @imports (Claude Code memory files; Gemini's context files use the same
  // syntax). Up to 5 hops, tracked targets inside the repository only.
  const fila = todas
    .filter(
      (e) =>
        /^(?:CLAUDE|CLAUDE\.local|GEMINI)\.md$/i.test(posix.basename(e.caminho)) ||
        casaNomeExtra(e.caminho),
    )
    .map((e) => ({ e, salto: 0 }))
  const visitados = new Set(fila.map((x) => x.e.caminho))
  while (fila.length) {
    const { e, salto } = fila.shift()
    const t = textoDe(e)
    if (t === null) continue
    for (const bruto of importsDe(t)) {
      if (/^(?:[\\/]|[A-Za-z]:|~)/.test(bruto)) continue
      let alvo = null
      for (const candidato of [bruto, bruto.replace(/[.,;:!?)\]]+$/, '')]) {
        const p = posix.normalize(posix.join(posix.dirname(e.caminho), candidato))
        if (p === '..' || p.startsWith('../')) continue
        alvo = porCaminho.get(p)
        if (alvo) break
      }
      if (!alvo) continue
      elevar(alvo)
      if (salto + 1 < 5 && !visitados.has(alvo.caminho)) {
        visitados.add(alvo.caminho)
        fila.push({ e: alvo, salto: salto + 1 })
      }
    }
  }
  propagar()

  // 5. Content and estado, real regular entries first, then what mirrors them.
  const preencher = (e, fonte) => {
    const blob = blobs.get(fonte.oid)
    e.tamanho = blob ? blob.tamanho : 0
    if (!blob || blob.ausente) {
      e.estado = 'ausente'
      return
    }
    const b = blob.bytes
    e.bytes = b
    if (ehPonteiroLfs(b)) {
      const d = decodificarBlob(b)
      e.estado = 'lfs'
      e.texto = d.texto
      e.codificacao = d.codificacao
      e.temNul = d.texto.includes(NUL)
      return
    }
    const binario =
      e.tipo !== 'agente' &&
      !temBomUnicode(b) &&
      !EXT_TEXTO.has(extensaoDe(e.caminho)) &&
      !NOMES_TEXTO.test(e.caminho) &&
      (b.subarray(0, JANELA_BINARIA).includes(0) || pareceCifrado(b))
    if (binario) {
      e.estado = 'binario'
      e.temNul = b.subarray(0, JANELA_BINARIA).includes(0)
      e.codificacao = isUtf8(b) ? 'utf-8' : 'utf-8-invalido'
      return
    }
    const d = decodificarBlob(b)
    e.texto = d.texto
    e.codificacao = d.codificacao
    e.temNul = d.texto.includes(NUL)
    e.estado = blob.truncado ? 'truncado' : 'ok'
  }
  for (const e of reais) if (e.modo !== '120000') preencher(e, e)
  for (const e of reais) {
    if (e.modo !== '120000') continue
    const real = origem.get(e)
    const blob = blobs.get(e.oid)
    if (real) {
      for (const campo of ['tamanho', 'bytes', 'texto', 'codificacao', 'estado', 'temNul'])
        e[campo] = real[campo]
    } else {
      e.tamanho = blob ? blob.tamanho : 0
      e.estado = !blob || blob.ausente ? 'ausente' : 'ok'
    }
  }
  for (const v of virtuais) {
    const real = origem.get(v)
    // A mounted link that resolves nowhere has no content: texto stays null and
    // its `symlink.externo` is what problemasDeLeitura reports.
    if (!real) continue
    for (const campo of ['tamanho', 'bytes', 'texto', 'codificacao', 'estado', 'temNul'])
      v[campo] = real[campo]
  }

  // 6. Attributes that hide a file from review or from this reader.
  //
  // Every real regular file is asked, not only agent files: a root `.env` and a
  // `package.json` are 'dados', and with working-tree-encoding on them the index
  // held CJK text while checkout wrote the ASCII line npm and the agent run
  // (measured: agent-config-exec and agent-bypass-invocation both passed). One
  // batched call either way. Links and mounted paths keep the neutral values
  // unless they are agent paths, which were always asked: git applies no filter
  // or encoding to a symlink blob.
  const perguntados = todas.filter(
    (e) => e.tipo === 'agente' || (e.viaSymlink === null && e.modo !== '120000'),
  )
  if (perguntados.length) {
    // working-tree-encoding makes checkout write the blob re-encoded: a UTF-8
    // blob whose code units are pairs of ASCII bytes (CJK text in the index and
    // the diff) lands on disk as plain ASCII, byte for byte a line a rule would
    // fail. export-subst expands `$Format:...$` from commit data in every
    // `git archive`. Either way what the agent reads is not what was judged.
    //
    // Asked twice, as a case-sensitive and as a case-insensitive checkout, and
    // united. git matches .gitattributes patterns ignoring case when
    // core.ignorecase is true, which clone sets on Windows and macOS and leaves
    // false on Linux, and the target's own config decided which one this read.
    // Measured: `agents.md working-tree-encoding=UTF-16LE` over a tracked
    // AGENTS.md passed every rule on a Linux-style clone, while a Windows
    // checkout wrote the ASCII line that starts an agent CLI with approval off.
    // A command-line -c overrides the repository config for check-attr.
    const porCaminhoAtributos = new Map()
    const definido = (info) => info !== 'unspecified' && info !== 'unset'
    const entrada = Buffer.from(perguntados.map((e) => e.caminho + NUL).join(''), 'utf8')
    for (const ignorarCaixa of ['false', 'true']) {
      const saida = git(
        dir,
        [
          '-c',
          `core.ignorecase=${ignorarCaixa}`,
          'check-attr',
          '-z',
          '--cached',
          '--stdin',
          'filter',
          'diff',
          'linguist-generated',
          'working-tree-encoding',
          'export-subst',
        ],
        { entrada },
      ).stdout
      const campos = partirPorNul(saida).map((b) => b.toString('utf8'))
      for (let k = 0; k + 2 < campos.length; k += 3) {
        const [caminho, atributo, info] = [campos[k], campos[k + 1], campos[k + 2]]
        const a = porCaminhoAtributos.get(caminho) || ATRIBUTOS_NEUTROS()
        if (atributo === 'filter' && definido(info)) a.filtro = a.filtro || info
        if (atributo === 'diff' && info === 'unset') a.semDiff = true
        if (atributo === 'linguist-generated' && (info === 'set' || info === 'true'))
          a.gerado = true
        if (atributo === 'working-tree-encoding' && definido(info)) {
          a.codificacaoDeDisco = a.codificacaoDeDisco || info
        }
        if (atributo === 'export-subst' && definido(info)) a.exportSubst = true
        porCaminhoAtributos.set(caminho, a)
      }
    }
    for (const e of perguntados)
      e.atributos = porCaminhoAtributos.get(e.caminho) || ATRIBUTOS_NEUTROS()
  }

  // 7. Case collisions: on Windows and macOS two such paths are one file.
  const grupos = new Map()
  for (const e of todas) {
    const chave = e.caminho.toLowerCase()
    if (!grupos.has(chave)) grupos.set(chave, [])
    grupos.get(chave).push(e)
  }
  const colisoes = [...grupos.values()]
    .filter((g) => g.length >= 2 && g.some((e) => e.tipo === 'agente'))
    .map((g) => g.map((e) => e.caminho).sort())

  return { entradas: todas, gitlinks, colisoes, porCaminho, origem, semGit: false }
}

/**
 * `@path` tokens outside fenced code and code spans, at a line start or after
 * whitespace (so `user@host` is not one). Claude Code documents that imports
 * inside code are not evaluated, and an unclosed fence runs to the end of the
 * file, as CommonMark reads it.
 */
function importsDe(texto) {
  const alvos = []
  let cerca = null
  for (const bruta of texto.split('\n')) {
    const linha = bruta.replace(/\r$/, '')
    const abre = /^ {0,3}(`{3,}|~{3,})/.exec(linha)
    if (cerca) {
      if (
        abre &&
        abre[1][0] === cerca[0] &&
        abre[1].length >= cerca.length &&
        /^ {0,3}[`~]+[ \t]*$/.test(linha)
      ) {
        cerca = null
      }
      continue
    }
    if (abre) {
      cerca = abre[1]
      continue
    }
    const semCodigo = linha.replace(/(`+)[^`]*?\1/g, (x) => ' '.repeat(x.length))
    for (const m of semCodigo.matchAll(/(?:^|\s)@([^\s`]+)/g)) alvos.push(m[1])
  }
  return alvos
}

// ───────────────────────────────────────────────────────── reading problems

const CONJUNTOS_DE_COLISAO = new WeakMap()

/**
 * The reading problems that belong to a PATH rather than to the bytes behind
 * it. A link or a mounted entry repeats content its real entry already reports
 * (a NUL, invalid UTF-8, an LFS pointer), but these come from its own path: the
 * attributes git matches against that path, a link out of the repository met
 * behind a linked folder, a case collision. One list for every rule, so no rule
 * drops one of them for mirrors: hidden-unicode kept only the collision, and a
 * `.claude` folder link whose settings.json left the repository passed there
 * while control-bytes failed it.
 */
export const PROBLEMAS_DO_CAMINHO = Object.freeze([
  'filtro',
  'semDiff',
  'gerado',
  'working-tree-encoding',
  'export-subst',
  'symlink-externo',
  'colisao',
])

/** Markdown flavours whose frontmatter a client parses as YAML (skills, agents, rules). */
export const EXTENSOES_COM_FRONTMATTER = new Set(['md', 'mdc', 'mdx', 'markdown'])

/** The escape dialect a client opening `caminho` reads it with, or null. */
function formatoDoCaminho(caminho) {
  const ext = extensaoDe(caminho)
  if (temChavePropria(FORMATO_POR_EXTENSAO, ext)) return FORMATO_POR_EXTENSAO[ext]
  return EXTENSOES_COM_FRONTMATTER.has(ext) ? 'frontmatter' : null
}
const temChavePropria = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * Real regular entry -> the escape dialects ('json' | 'json5' | 'yaml' | 'toml'
 * | 'frontmatter') a client may parse its bytes with, each with the first path
 * that implies it. The entry's own path comes first, then every link and
 * mounted path that shows the same bytes: a client opens `.mcp.json` by that
 * name, so a link to `m.txt` is still parsed as JSON, and the escape pass must
 * decode it as JSON too. Measured before: an escaped ESC or U+200B behind
 * `.mcp.json -> m.txt` or `SKILL.md -> docs/x` passed both rules that decode
 * escapes, while the same bytes stored directly failed.
 *
 * @returns {Map<Entrada, Map<string, string>>} formato -> caminho that implies it
 */
export function formatosDeEscape(indice) {
  const saida = new Map()
  const juntar = (real, caminho) => {
    const formato = formatoDoCaminho(caminho)
    if (!formato) return
    if (!saida.has(real)) saida.set(real, new Map())
    const formatos = saida.get(real)
    if (!formatos.has(formato)) formatos.set(formato, caminho)
  }
  for (const e of indice.entradas) {
    if (e.viaSymlink === null && e.modo !== '120000') juntar(e, e.caminho)
  }
  const origem = indice.origem || new Map()
  for (const e of indice.entradas) {
    if (e.viaSymlink === null && e.modo !== '120000') continue
    const real = origem.get(e)
    if (real && real.viaSymlink === null && real.modo !== '120000') juntar(real, e.caminho)
  }
  return saida
}

export function problemasDeLeitura(entrada, indice) {
  if (!entrada || entrada.tipo !== 'agente') return []
  const motivos = []
  if (entrada.estado === 'ausente') motivos.push('ausente')
  if (entrada.estado === 'truncado') motivos.push('truncado')
  if (entrada.estado === 'lfs') motivos.push('lfs')
  if (entrada.temNul) motivos.push('nul')
  if (entrada.codificacao === 'utf-8-invalido') motivos.push('utf-8-invalido')
  if (entrada.atributos?.filtro) motivos.push('filtro')
  if (entrada.atributos?.semDiff) motivos.push('semDiff')
  if (entrada.atributos?.gerado) motivos.push('gerado')
  if (entrada.atributos?.codificacaoDeDisco) motivos.push('working-tree-encoding')
  if (entrada.atributos?.exportSubst) motivos.push('export-subst')
  if (entrada.symlink?.externo) motivos.push('symlink-externo')
  if (indice) {
    let emColisao = CONJUNTOS_DE_COLISAO.get(indice)
    if (!emColisao) {
      emColisao = new Set((indice.colisoes || []).flat())
      CONJUNTOS_DE_COLISAO.set(indice, emColisao)
    }
    if (emColisao.has(entrada.caminho)) motivos.push('colisao')
  }
  return motivos
}

/**
 * What an agent that reads the checkout as UTF-8 sees when `working-tree-encoding`
 * re-encodes the blob on disk: the index text encoded the way git writes it,
 * then decoded as UTF-8. Only the UTF-16 and UTF-32 families, whose bytes git
 * and this function produce the same way without ICU; an ambiguous name
 * (`UTF-16`) gives both byte orders. [] when there is nothing to add.
 */
export function textosNoDisco(entrada) {
  const nome = String(entrada?.atributos?.codificacaoDeDisco || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  if (!nome || entrada.texto === null) return []
  const texto = entrada.texto
  const utf16 = (grande) => {
    const b = Buffer.from(texto, 'utf16le')
    if (grande) b.swap16()
    return b
  }
  const utf32 = (grande) => {
    const pontos = [...texto].map((ch) => ch.codePointAt(0))
    const b = Buffer.alloc(pontos.length * 4)
    pontos.forEach((p, k) => (grande ? b.writeUInt32BE(p, k * 4) : b.writeUInt32LE(p, k * 4)))
    return b
  }
  const bytes = []
  if (/^(?:utf16|ucs2)(?:le)?(?:bom)?$/.test(nome)) bytes.push(utf16(false))
  if (/^(?:utf16|ucs2)(?:be)?(?:bom)?$/.test(nome)) bytes.push(utf16(true))
  if (/^(?:utf32|ucs4)(?:le)?(?:bom)?$/.test(nome)) bytes.push(utf32(false))
  if (/^(?:utf32|ucs4)(?:be)?(?:bom)?$/.test(nome)) bytes.push(utf32(true))
  return bytes.map((b) => b.toString('utf8'))
}

// ────────────────────────────────────────────────────────────── the remote

/**
 * The `owner/name` a clone's origin remote names, or null: the value GitHub
 * gives `github.repository` when this clone is where the workflow runs.
 * actions/checkout sets origin to the repository the run belongs to, and a fork
 * or a copy has its own. Read from the local config, not the index: nothing a
 * commit carries can set it. Any git failure is null (unknown), never a throw.
 */
export function repositorioDeOrigem(dir) {
  let r
  try {
    r = git(dir, ['config', '--get', 'remote.origin.url'], { aceitar: [0, 1] })
  } catch {
    return null
  }
  if (r.status !== 0) return null
  const url = String(r.stdout)
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  const m = /[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(url)
  return m ? `${m[1]}/${m[2]}` : null
}

// ─────────────────────────────────────────────────────────────────── commits

const MEMORIA_DE_COMMITS = new Map()

export function lerCommits(dir, { semMemoria = false } = {}) {
  const chave = resolve(dir)
  if (!semMemoria && MEMORIA_DE_COMMITS.has(chave)) return MEMORIA_DE_COMMITS.get(chave)
  if (semMemoria) MEMORIA_DE_REPOSITORIO.delete(chave)
  let commits = []
  if (!foraDeRepositorio(chave)) {
    const cabeca = git(chave, ['rev-parse', '--verify', '-q', 'HEAD'], { aceitar: [0, 1] })
    if (cabeca.status === 0) {
      // Raw: no trim anywhere. JS trim removes U+FEFF, which is how rebar-check
      // lost a trailing one (measured). `tformat` ends every record with LF,
      // so each id after the first starts with exactly that one LF.
      const saida = git(chave, [
        '-c',
        'i18n.logOutputEncoding=UTF-8',
        'log',
        '--no-show-signature',
        '--format=%H%x00%B%x00',
        'HEAD',
      ]).stdout
      const partes = partirPorNul(saida)
      for (let k = 0; k + 1 < partes.length; k += 2) {
        let id = partes[k].toString('latin1')
        if (id.startsWith('\n')) id = id.slice(1)
        if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id)) {
          throw new Error('git log printed a record that does not start with a commit id')
        }
        const bytes = partes[k + 1]
        commits.push({
          id,
          mensagem: bytes.toString('utf8'),
          codificacao: isUtf8(bytes) ? 'utf-8' : 'utf-8-invalido',
        })
      }
    }
  }
  MEMORIA_DE_COMMITS.set(chave, commits)
  return commits
}

// ───────────────────────────────────────────────────────────────── allowlist

export const FORMAS_DE_CHAVE = [
  ['arquivo', 'oid'],
  ['commit'],
  ['arquivo', 'ponteiro', 'sha256'],
  ['arquivo', 'servidor', 'sha256'],
]
const ID_DE_OBJETO = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const VALIDA_CAMPO = {
  arquivo: (v) => typeof v === 'string' && v.length > 0,
  oid: (v) => typeof v === 'string' && ID_DE_OBJETO.test(v),
  commit: (v) => typeof v === 'string' && ID_DE_OBJETO.test(v),
  ponteiro: (v) => typeof v === 'string' && (v === '' || v.startsWith('/')),
  servidor: (v) => typeof v === 'string' && v.length > 0,
  sha256: (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v),
}

/** gitignore-style pattern against a repo-relative path, as CODEOWNERS reads it. */
function padraoCasa(padrao, caminho) {
  let p = padrao.startsWith('\\#') ? padrao.slice(1) : padrao
  const soPasta = p.endsWith('/')
  p = p.replace(/\/+$/, '')
  if (p === '') return false
  const ancorado = p.includes('/')
  p = p.replace(/^\//, '')
  let corpo = ''
  for (let k = 0; k < p.length; k++) {
    const c = p[k]
    if (c === '*' && p[k + 1] === '*') {
      if (p[k + 2] === '/') {
        corpo += '(?:.*/)?'
        k += 2
      } else {
        corpo += '.*'
        k++
      }
    } else if (c === '*') corpo += '[^/]*'
    else if (c === '?') corpo += '[^/]'
    else corpo += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  const re = new RegExp(`^${ancorado ? '' : '(?:.*/)?'}${corpo}${soPasta ? '/.+' : '(?:/.*)?'}$`)
  return re.test(caminho)
}

export function lerAllowlist(dir) {
  const indice = lerIndice(dir)
  const real = indice.porCaminho.get(NOME_DA_ALLOWLIST)
  const entrada = real && real.viaSymlink === null ? real : null
  const erros = []
  const entradas = []
  let naoRastreada = false
  if (!entrada) {
    try {
      naoRastreada = Boolean(
        lstatSync(join(resolve(dir), NOME_DA_ALLOWLIST), { throwIfNoEntry: false }),
      )
    } catch {
      naoRastreada = false
    }
  }

  if (entrada) {
    const problema = entrada.symlink
      ? 'it is tracked as a symlink'
      : entrada.texto === null || entrada.estado !== 'ok'
        ? `its blob is ${entrada.estado}`
        : entrada.codificacao === 'utf-8-invalido'
          ? 'it is not valid UTF-8'
          : entrada.temNul
            ? 'it holds a NUL byte'
            : null
    if (problema)
      erros.push({ linha: 1, coluna: 1, mensagem: `the allowlist cannot be read: ${problema}` })
    else {
      const linhas = entrada.texto.split('\n')
      for (let n = 0; n < linhas.length; n++) {
        const linha = linhas[n].replace(/\r$/, '')
        const recuo = linha.length - linha.trimStart().length
        const conteudo = linha.trim()
        if (conteudo === '' || conteudo.startsWith('#')) continue
        const erro = (mensagem, coluna = 1) =>
          erros.push({ linha: n + 1, coluna: recuo + coluna, mensagem })
        const r = lerJsonc(conteudo, { estrito: true })
        if (r.erro) {
          erro(`not one JSON object: ${r.erro.mensagem}`, r.erro.coluna)
          continue
        }
        if (r.duplicatas.length) {
          erro(`duplicate key ${escaparSaida(r.duplicatas[0].ponteiro, { limite: 40 })}`)
          continue
        }
        const v = r.valor
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
          erro('each line must be one JSON object')
          continue
        }
        if (!REGRAS_DA_ALLOWLIST.includes(v.regra)) {
          erro(`regra must be one of ${REGRAS_DA_ALLOWLIST.join(', ')}`)
          continue
        }
        const pontosDoMotivo = typeof v.motivo === 'string' ? [...v.motivo].length : 0
        if (typeof v.motivo !== 'string' || v.motivo.trim() === '' || pontosDoMotivo > 200) {
          erro('motivo must be a string of 1 to 200 characters that says why')
          continue
        }
        if (normalizarMotivo(v.motivo).includes(normalizarMotivo(MOTIVO_A_ESCREVER))) {
          erro(
            'motivo is the placeholder --sugerir-allowlist prints: write why a person accepted it',
          )
          continue
        }
        const chaves = Object.keys(v)
          .filter((k) => k !== 'regra' && k !== 'motivo')
          .sort()
        const forma = FORMAS_DE_CHAVE.find(
          (f) => f.length === chaves.length && [...f].sort().every((k, i) => k === chaves[i]),
        )
        if (!forma) {
          erro(
            'the key must be exactly one of {arquivo, oid} | {commit} | {arquivo, ponteiro, sha256} | {arquivo, servidor, sha256}',
          )
          continue
        }
        const invalido = forma.find((campo) => !VALIDA_CAMPO[campo](v[campo]))
        if (invalido) {
          erro(`${invalido} has an invalid value`)
          continue
        }
        const registro = { linha: n + 1, regra: v.regra, motivo: v.motivo, forma }
        for (const campo of forma) registro[campo] = v[campo]
        entradas.push(registro)
      }
    }
  }

  // GitHub uses the FIRST CODEOWNERS it finds in this order, and the LAST
  // matching pattern in it; a pattern with no owner removes ownership.
  let cobertaPorCodeowners = false
  if (entrada) {
    for (const lugar of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
      const co = indice.porCaminho.get(lugar)
      if (!co || co.viaSymlink !== null || co.symlink || co.texto === null) continue
      let donos = 0
      for (const linha of co.texto.split('\n')) {
        const t = linha.trim()
        if (!t || t.startsWith('#')) continue
        const [padrao, ...resto] = t.split(/\s+/)
        const comentario = resto.findIndex((x) => x.startsWith('#'))
        const donosDaLinha = comentario === -1 ? resto : resto.slice(0, comentario)
        if (padraoCasa(padrao, NOME_DA_ALLOWLIST)) donos = donosDaLinha.length
      }
      cobertaPorCodeowners = donos > 0
      break
    }
  }

  const usadas = new Set()
  return {
    entradas,
    erros,
    naoRastreada,
    rastreada: Boolean(entrada),
    cobertaPorCodeowners,
    aceita(regra, chave) {
      let aceitou = false
      if (!chave || typeof chave !== 'object') return false
      for (const [k, e] of entradas.entries()) {
        if (e.regra !== regra) continue
        if (e.forma.every((campo) => chave[campo] === e[campo])) {
          usadas.add(k)
          aceitou = true
        }
      }
      return aceitou
    },
    obsoletas(regra) {
      let n = 0
      for (const [k, e] of entradas.entries()) if (e.regra === regra && !usadas.has(k)) n++
      return n
    },
  }
}

// ──────────────────────────────────────────────────────────────── reporting

let ultimoTexto = null
let ultimosInicios = null

export function posicao(texto, indice) {
  if (texto !== ultimoTexto) {
    ultimoTexto = texto
    ultimosInicios = [0]
    for (let k = texto.indexOf('\n'); k !== -1; k = texto.indexOf('\n', k + 1))
      ultimosInicios.push(k + 1)
  }
  let baixo = 0
  let alto = ultimosInicios.length - 1
  while (baixo < alto) {
    const meio = (baixo + alto + 1) >> 1
    if (ultimosInicios[meio] <= indice) baixo = meio
    else alto = meio - 1
  }
  let coluna = 1
  for (let k = ultimosInicios[baixo]; k < indice && k < texto.length; k++) {
    const u = texto.charCodeAt(k)
    if (u >= 0xd800 && u <= 0xdbff && k + 1 < indice) {
      const v = texto.charCodeAt(k + 1)
      if (v >= 0xdc00 && v <= 0xdfff) k++
    }
    coluna++
  }
  return { linha: baixo + 1, coluna }
}

export function onde(caminho, linha, coluna) {
  return `${escaparSaida(caminho)}:${linha}:${coluna}`
}

export function resumir(itens, max = 12) {
  const mostrados = itens.slice(0, max).join(' · ')
  return itens.length > max ? `${mostrados} …and ${itens.length - max} more` : mostrados
}

export function impressao(texto) {
  const s = String(texto)
  const hash = createHash('sha256').update(s, 'utf8').digest('hex')
  return `sha256:${hash.slice(0, 12)} len:${[...s].length}`
}
