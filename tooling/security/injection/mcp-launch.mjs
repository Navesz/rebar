// mcp-launch — every MCP server a client would start from this repository is
// the launch rebar ships, or a launch someone accepted by its exact fingerprint.
//
// WHY THE LAUNCH AND NOT THE NAME. A versioned MCP config is a program the
// client starts on the developer's machine: Claude Code documents that `claude
// -p`, Agent SDK and cloud sessions load project servers without asking. An
// allowlist by server name was measured against real history and lost both
// ways: it fired on 149 of 150 routine version bumps, and a server renamed in
// the same commit as its new command walks past it. So a launch is judged by a
// sha256 fingerprint of every field that decides what runs (command, args, env,
// cwd, url, headers, ...), and the only launch accepted without an entry is the
// one in `new/gate/arquivos/mcp.json` of the RUNNING rebar, which
// rebar-site, assay and navesz-portfolio track byte for byte today.
//
// WHY SOME FINDINGS CANNOT BE ACCEPTED. A fingerprint pins the text of the
// launch, not what that text resolves to. Five things change what runs without
// changing the text, so no entry exempts them: a file the reader cannot parse
// or that holds a duplicate key (clients disagree on which copy wins; JSON.parse
// keeps the last one), a command read from the environment (`${`), Gemini's
// `trust: true` (every tool call runs unconfirmed), mcp-remote below 0.1.16
// (CVE-2025-6514, 0.0.5 to 0.1.15, CVSS 9.6), and a package runner next to a
// tracked registry override that reaches the package it starts or a tracked
// node_modules/.bin, which swaps the package the runner fetches.
//
// WHAT IS NEVER PRINTED. Command text, URLs, headers and env values stay out of
// the output: the fingerprint stands for them, and a server name
// goes through escaparSaida capped at 40 code points.
//
// ─────────────────────────────────────────────────────────────── the API
//
/**
 * checarMcpLaunch(r, { EXECUTORES_REMOTOS, SINAIS_DE_SHELL, molde? })
 *   -> string (reprova) | null | { nota } | { na }
 *   `r.dir` is the repository. `molde` is the URL of the template config; it
 *   defaults to the running rebar's `new/gate/arquivos/mcp.json` and exists as a
 *   parameter only so a proof can point it at a missing file.
 *
 * EXECUTORES_REMOTOS, SINAIS_DE_SHELL: Array<[RegExp, explicacao]>
 *   Every row carries exactly one NAMED GROUP, and the group name is what the
 *   engine acts on (see the tables). Rows are anchored and tested against short
 *   single-line keys the engine builds from the argv, never against file text.
 *
 * `lerConfigsMcp(indice) -> { servidores, duros, declaram }`
 *   `servidores`: `Array<{ arquivo, cliente, nome, linha, coluna, raiz, bruto, lancamento,
 *                  impressao, argv: string[]|null, argvInteiro: string[]|null, razoes: string[] }>`
 *   `argvInteiro` is set when the command holds a space: the command as one word,
 *   the reading of a client that spawns with no shell; `argv` splits it.
 *   `duros`: file-level findings that no allowlist entry exempts, already formatted.
 *   `declaram`: how many config files hold a servers container at all.
 *
 * lancamentoCanonico(servidor) -> object     the fingerprinted fields, absent ones omitted
 * impressaoDeLancamento(servidor) -> string  sha256 hex of the canonical JSON, keys sorted
 * classificarLancamento(argv, tabelas) -> { rotulos, palavras, execucoes }
 * especNpm(espec) -> { remoto, tipo?, fixado?, nome? }
 * mcpRemoteAbaixo(palavra) -> boolean     the word names mcp-remote below 0.1.16 or unversioned
 * palavras(texto) -> string[]
 * `arquivosReferenciados(dir) -> Array<{ caminho, arquivo, servidor }>`
 *   Tracked files a launch names in command or args, resolved from the client's
 *   project folder (and `cwd`). mcp-ansi-escape takes these as candidates.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { posix } from 'node:path'

import { escaparSaida } from '../texto-seguro.mjs'
import { lerJsonc, lerToml, lerYaml } from './formats.mjs'
import {
  NOME_DA_ALLOWLIST,
  lerAllowlist,
  sugerirEntrada,
  lerIndice,
  onde,
  problemasDeLeitura,
  resumir,
} from './reader.mjs'

const REGRA = 'mcp-server-launch'
const na = (motivo) => ({ na: motivo })

// ──────────────────────────────────────────────────────────────── the tables

/**
 * Launchers that fetch code at start-up. The key tested is the launcher's
 * basename plus up to two following words (`npx`, `pnpm dlx`, `uv tool run`),
 * longest first. The group name picks how the rest of the argv is read:
 * `npm` (package specs), `python` (an index or git spec), `imagem` (a container
 * image), `deno` (a URL or registry module).
 */
export const EXECUTORES_REMOTOS = [
  [
    /^(?<npm>npx|pnpx|bunx|npm exec|npm x|pnpm dlx|yarn dlx|bun x)$/,
    'a runner that downloads an npm or git package and starts it',
  ],
  [
    /^(?<python>uvx|uv tool run|pipx run)$/,
    'a runner that downloads a Python package and starts it',
  ],
  [/^(?<imagem>docker run|podman run)$/, 'a container engine that pulls an image and starts it'],
  [/^(?<deno>deno run|deno x)$/, 'Deno, which can start a module fetched from the network'],
]

/**
 * Signs that a shell reads the launch. The key tested is `<launcher basename>
 * <word>` for every word after the launcher (and the basename alone). Groups:
 * `emLinha` (the NEXT word is a command string), `resto` (the remaining words
 * are the command), `encadeia` (the word chains another command), `execucao`
 * (a runner or package manager told to run a script). A line break inside a
 * word is turned into a command separator before the test, which is what a
 * shell does with it.
 */
export const SINAIS_DE_SHELL = [
  [
    /^(?:sh|bash|zsh|dash|ksh|mksh|ash|fish) (?<emLinha>-[A-Za-z]*c[A-Za-z]*)$/,
    'a POSIX shell handed an inline command string',
  ],
  [/^cmd (?<resto>[-/][ck])$/i, 'the Windows command interpreter handed a command line'],
  [
    /^(?:pwsh|powershell) (?<resto>[-/](?:c|e|ec|com[a-z]*|enc[a-z]*))$/i,
    'PowerShell handed an inline or encoded command',
  ],
  [/^(?<encadeia>[^\n]*(?:&&|\|\||[;|])[^\n]*)$/, 'a word that chains a second command'],
  [
    /^(?:npx|pnpx|bunx) (?<execucao>-c|--call(?:=[^\n]*)?)$/,
    'a package runner handed a command string',
  ],
  [
    /^(?:npm|pnpm|yarn|bun) (?<execucao>run|run-script|exec|x)$/,
    'a package manager that runs a script or a package binary',
  ],
]

// ─────────────────────────────────────────────────────────── config formats

/**
 * Where each client keeps its servers. Matched on the lowercased path, at any
 * depth: on Windows and macOS a tracked `.Cursor/MCP.json` is the file the
 * client opens (measured with core.ignorecase=true). Every JSON file is read
 * as JSONC: a comment that makes a strict client skip the file can only make
 * this rule report MORE servers, never hide one. `compartilhado` files also
 * hold other settings, so only duplicates under the servers key are this
 * rule's business (agent-config-exec judges the rest).
 */
const CONFIGS = [
  { sufixo: '.cursor/mcp.json', cliente: 'cursor', chave: 'mcpServers', formato: 'json' },
  { sufixo: '.vscode/mcp.json', cliente: 'vscode', chave: 'servers', formato: 'json' },
  {
    sufixo: '.gemini/settings.json',
    cliente: 'gemini',
    chave: 'mcpServers',
    formato: 'json',
    compartilhado: true,
  },
  {
    sufixo: '.codex/config.toml',
    cliente: 'codex',
    chave: 'mcp_servers',
    formato: 'toml',
    compartilhado: true,
  },
  { sufixo: '.mcp.json', cliente: 'claude', chave: 'mcpServers', formato: 'json', nome: true },
]

function configDe(caminho) {
  const baixo = caminho.toLowerCase()
  for (const c of CONFIGS) {
    if (
      c.nome
        ? posix.basename(baixo) === c.sufixo
        : baixo === c.sufixo || baixo.endsWith(`/${c.sufixo}`)
    ) {
      return c
    }
  }
  return null
}

/** The folder a client treats as the project: where it starts stdio servers. */
function raizDoProjeto(caminho, config) {
  const pasta = posix.dirname(caminho)
  const acima = config.nome ? pasta : posix.dirname(pasta)
  return acima === '.' ? '' : acima
}

const ponteiroDe = (...chaves) =>
  chaves.map((k) => `/${String(k).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('')

// ───────────────────────────────────────────────────────────── fingerprint

/**
 * The fields that decide what a client starts or where it connects. The first
 * thirteen decide it for every client; the Codex and VS Code spellings after them
 * (env_vars, http_headers, env_http_headers, bearer_token_env_var,
 * sandboxEnabled, dev) change the same things for those clients, so an
 * accepted fingerprint must not survive a change to them either.
 */
const CAMPOS_DO_LANCAMENTO = [
  'type',
  'command',
  'args',
  'env',
  'envFile',
  'cwd',
  'url',
  'serverUrl',
  'httpUrl',
  'headers',
  'headersHelper',
  'oauth',
  'trust',
  'env_vars',
  'http_headers',
  'env_http_headers',
  'bearer_token_env_var',
  'sandboxEnabled',
  'dev',
]

export function lancamentoCanonico(servidor) {
  const s = servidor && typeof servidor === 'object' ? servidor : {}
  const lancamento = Object.create(null)
  for (const campo of CAMPOS_DO_LANCAMENTO) {
    if (campo === 'type') {
      lancamento.type = s.type !== undefined ? s.type : s.command !== undefined ? 'stdio' : 'http'
    } else if (s[campo] !== undefined) {
      lancamento[campo] = s[campo]
    }
  }
  return lancamento
}

/**
 * JSON.stringify with keys sorted at every depth. Written out instead of
 * rebuilding sorted objects because the readers return null-prototype objects
 * on purpose: copying a `__proto__` key into a plain object would set a
 * prototype instead of a field, and two different launches would hash alike.
 */
function jsonOrdenado(v) {
  if (Array.isArray(v))
    return `[${v.map((x) => (x === undefined ? 'null' : jsonOrdenado(x))).join(',')}]`
  if (v !== null && typeof v === 'object') {
    const chaves = Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
    return `{${chaves.map((k) => `${JSON.stringify(k)}:${jsonOrdenado(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

export function impressaoDeLancamento(servidor) {
  return createHash('sha256')
    .update(jsonOrdenado(lancamentoCanonico(servidor)), 'utf8')
    .digest('hex')
}

// ──────────────────────────────────────────────────────── the implicit launch

const MOLDE = new URL('../../../new/gate/arquivos/mcp.json', import.meta.url)
const MEMORIA_DO_MOLDE = new Map()

/**
 * The fingerprints of the template shipped with the RUNNING checker, never of
 * anything in the target: a target that could vouch for its own launch would
 * vouch for anything. A vendored checker without `new/` has no implicit entry.
 * A template that exists and does not parse is a defect of this tool: throw,
 * which the executor reports as quebrou.
 */
function lancamentosDoMolde(molde) {
  const chave = String(molde)
  if (MEMORIA_DO_MOLDE.has(chave)) return MEMORIA_DO_MOLDE.get(chave)
  let texto = null
  try {
    texto = readFileSync(molde, 'utf8')
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e
  }
  const aceitos = new Set()
  if (texto !== null) {
    const lido = lerJsonc(texto, { estrito: true })
    const servidores = lido.valor && lido.valor.mcpServers
    if (lido.erro || lido.duplicatas.length || !servidores || typeof servidores !== 'object') {
      throw new Error("the running rebar's new/gate/arquivos/mcp.json has no readable mcpServers")
    }
    for (const s of Object.values(servidores)) aceitos.add(impressaoDeLancamento(s))
  }
  MEMORIA_DO_MOLDE.set(chave, aceitos)
  return aceitos
}

// ───────────────────────────────────────────────────────────── reading configs

const texto40 = (s) => escaparSaida(s, { limite: 40 })

export function lerConfigsMcp(indice) {
  const servidores = []
  const duros = []
  let declaram = 0
  for (const entrada of indice.entradas) {
    const config = configDe(entrada.caminho)
    if (!config) continue
    const arquivo = entrada.caminho
    const problemas = problemasDeLeitura(entrada, indice)
    if (problemas.length) {
      duros.push(
        `${onde(arquivo, 1, 1)} cannot be trusted as read (${problemas.join(', ')}): ` +
          'the client may start something this rule never saw (not exemptable)',
      )
    }
    if (entrada.texto === null) continue

    const lido = config.formato === 'toml' ? lerToml(entrada.texto) : lerJsonc(entrada.texto)
    if (lido.erro) {
      duros.push(
        `${onde(arquivo, lido.erro.linha, lido.erro.coluna)} cannot be parsed: ` +
          `${escaparSaida(lido.erro.mensagem, { limite: 80 })} (not exemptable)`,
      )
      continue
    }
    const base = ponteiroDe(config.chave)
    for (const d of lido.duplicatas) {
      if (config.compartilhado && d.ponteiro !== base && !d.ponteiro.startsWith(`${base}/`))
        continue
      const ultima = d.ocorrencias[d.ocorrencias.length - 1]
      duros.push(
        `${onde(arquivo, ultima.linha, ultima.coluna)} duplicate key ` +
          `${texto40(d.ponteiro || '/')}: clients disagree on which copy runs (not exemptable)`,
      )
    }

    const valor = lido.valor
    const container =
      valor !== null && typeof valor === 'object' && !Array.isArray(valor)
        ? valor[config.chave]
        : undefined
    if (container === undefined) continue
    declaram++
    if (container === null || typeof container !== 'object' || Array.isArray(container)) {
      const p = lido.posicoes.get(base) || { linha: 1, coluna: 1 }
      duros.push(
        `${onde(arquivo, p.linha, p.coluna)} ${config.chave} is not an object (not exemptable)`,
      )
      continue
    }
    for (const [nome, bruto] of Object.entries(container)) {
      const p = lido.posicoes.get(ponteiroDe(config.chave, nome)) || { linha: 1, coluna: 1 }
      const razoes = []
      let argv = null
      let argvInteiro = null
      const objeto = bruto !== null && typeof bruto === 'object' && !Array.isArray(bruto)
      if (!objeto) razoes.push('the server entry is not an object')
      else {
        const { command, args } = bruto
        if (command !== undefined && typeof command !== 'string')
          razoes.push('command is not a string')
        if (
          args !== undefined &&
          !(Array.isArray(args) && args.every((a) => typeof a === 'string'))
        ) {
          razoes.push('args is not a list of strings')
        }
        if (!razoes.length && typeof command === 'string') {
          argv = [...(/\s/.test(command.trim()) ? palavras(command) : [command]), ...(args || [])]
          // A client that spawns with no shell takes a command with a space as one
          // path (`C:/Program Files/nodejs/npx.cmd`); one that goes through a shell
          // splits it. Both readings are classified and united: measured before,
          // the split reading saw no runner in a spaced path, and the registry
          // override check never ran on an allowlisted launch.
          if (/\s/.test(command.trim())) argvInteiro = [command, ...(args || [])]
        }
      }
      servidores.push({
        arquivo,
        cliente: config.cliente,
        nome,
        linha: p.linha,
        coluna: p.coluna,
        raiz: raizDoProjeto(arquivo, config),
        bruto: objeto ? bruto : {},
        lancamento: lancamentoCanonico(objeto ? bruto : {}),
        impressao: impressaoDeLancamento(objeto ? bruto : {}),
        argv,
        argvInteiro,
        razoes,
      })
    }
  }
  return { servidores, duros, declaram }
}

// ──────────────────────────────────────────────────────────── the classifier

/**
 * Shell-style word split: single quotes, double quotes with backslash, no
 * expansion. Ported from a phase-1 prototype. It
 * only labels a launch; the verdict never depends on it being a full shell.
 */
export function palavras(s) {
  const saida = []
  let atual = ''
  let tem = false
  const texto = String(s)
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (c === "'") {
      const fim = texto.indexOf("'", i + 1)
      atual += texto.slice(i + 1, fim === -1 ? texto.length : fim)
      i = fim === -1 ? texto.length : fim
      tem = true
    } else if (c === '"') {
      let j = i + 1
      while (j < texto.length && texto[j] !== '"') {
        if (texto[j] === '\\' && j + 1 < texto.length) j++
        atual += texto[j]
        j++
      }
      i = j
      tem = true
    } else if (/\s/.test(c)) {
      if (tem || atual) saida.push(atual)
      atual = ''
      tem = false
    } else {
      atual += c
      tem = true
    }
  }
  if (tem || atual) saida.push(atual)
  return saida
}

const baseDe = (comando) =>
  String(comando)
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .toLowerCase()
    .replace(/\.(?:cmd|exe|ps1|bat|com)$/, '')

const HEX_DE_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const SEMVER_EXATO = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * An npm package spec: local path, git, tarball or registry. `fixado` is kept
 * for the pin rule of phase 2 and never reported here.
 */
export function especNpm(espec) {
  const e = String(espec)
  if (/^(?:\.{0,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|file:)/.test(e)) return { remoto: false }
  const git = e.match(
    /^(?:github:|gitlab:|bitbucket:|gist:|git\+(?:ssh|https?|file):\/\/|git:\/\/)([^#]*)(?:#(.*))?$/,
  )
  const atalho = e.match(/^([A-Za-z0-9][\w.-]*\/[\w.-]+)(?:#(.*))?$/)
  if (git || (atalho && !e.startsWith('@'))) {
    const ref = (git ? git[2] : atalho[2]) ?? ''
    return { remoto: true, tipo: 'git', fixado: HEX_DE_COMMIT.test(ref) }
  }
  if (/^https?:\/\//.test(e)) return { remoto: true, tipo: 'tarball', fixado: false }
  const m = e.match(/^(@[^/@\s]+\/[^@\s]+|[^@\s][^@\s]*)(?:@(.+))?$/)
  if (!m) return { remoto: true, tipo: 'desconhecido', fixado: false }
  return {
    remoto: true,
    tipo: 'registro',
    nome: m[1],
    fixado: Boolean(m[2]) && SEMVER_EXATO.test(m[2]),
  }
}

/** npm flags that take the next word as their value, so it is not the package. */
const FLAGS_NPM_COM_VALOR = new Set([
  '--prefix',
  '--registry',
  '--cache',
  '--userconfig',
  '--workspace',
  '-w',
  '--loglevel',
])

function pacotesNpm(lista) {
  const pacotes = []
  let executavel = null
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i]
    if (a === '--') {
      executavel = lista[i + 1] ?? null
      break
    }
    if (a === '-p' || a === '--package') {
      if (lista[i + 1] !== undefined) pacotes.push(lista[++i])
      continue
    }
    if (a.startsWith('--package=')) {
      pacotes.push(a.slice('--package='.length))
      continue
    }
    if (a === '-c' || a === '--call' || FLAGS_NPM_COM_VALOR.has(a)) {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    executavel = a
    break
  }
  if (!pacotes.length && executavel) pacotes.push(executavel)
  return pacotes
}

function especPython(lista) {
  let de = null
  let executavel = null
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i]
    if (a === '--from' || a === '--spec') {
      de = lista[++i] ?? null
      continue
    }
    if (a.startsWith('--from=') || a.startsWith('--spec=')) {
      de = a.slice(a.indexOf('=') + 1)
      continue
    }
    if (a === '--with' || a === '--python' || a === '-p') {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    executavel = a
    break
  }
  return de ?? executavel ?? ''
}

const FLAGS_DOCKER_COM_VALOR = /^-(?:e|v|p|w|u|-name|-env|-volume|-network|-mount)$/

function imagemDocker(lista) {
  return lista.find(
    (a, i) => !a.startsWith('-') && !FLAGS_DOCKER_COM_VALOR.test(lista[i - 1] ?? ''),
  )
}

const ROTULO_DO_GRUPO = {
  emLinha: 'shell',
  resto: 'shell',
  encadeia: 'shell',
  execucao: 'exec-flag',
}
const ORDEM_DOS_ROTULOS = ['remote-url', 'remote-package', 'shell', 'exec-flag', 'local']

function grupoDe(m, linha) {
  const achado = Object.entries(m.groups || {}).find(([, v]) => v !== undefined)
  if (!achado) throw new Error(`mcp-server-launch table row ${linha[0]} has no named group`)
  return achado
}

function exigirTabela(nome, tabela) {
  if (
    !Array.isArray(tabela) ||
    !tabela.length ||
    !tabela.every((l) => Array.isArray(l) && l[0] instanceof RegExp && typeof l[1] === 'string')
  ) {
    throw new Error(`checarMcpLaunch needs ${nome} as a non-empty [RegExp, string] table`)
  }
}

/**
 * Options a package manager or runner takes BEFORE its subcommand whose value
 * may come as the next word (`pnpm -C dir dlx`, `npm --loglevel warn exec`,
 * `docker --context x run`, `uv --directory d tool run`). The `--opt=value`
 * spelling is one word and needs no entry.
 */
const OPCOES_GLOBAIS_COM_VALOR = new Set([
  '--loglevel',
  '--prefix',
  '--userconfig',
  '--globalconfig',
  '--registry',
  '--cache',
  '--location',
  '--workspace',
  '--dir',
  '-C',
  '--filter',
  '-F',
  '--reporter',
  '--store-dir',
  '--cwd',
  '--config',
  '--context',
  '-c',
  '--host',
  '-H',
  '--log-level',
  '-l',
  '--directory',
  '--project',
  '--config-file',
  '--cache-dir',
  '--color',
])

/**
 * The keys EXECUTORES_REMOTOS is tried with for one command, most specific
 * first, each with the words left after it. The contiguous words come first
 * (`uv tool run`, `pnpm dlx`, `npx`). Then the subcommand after global options:
 * measured, `pnpm --silent dlx` (pnpm 11.16) and `npm --loglevel=warn exec` run
 * the runner, and read as contiguous words they matched no row, so the check a
 * registry override makes unexemptable never ran. The first word that does not
 * start with a dash is tried both as the subcommand and, after an option that
 * takes a value, as that value, so `pnpm -w dlx` (no value) and `pnpm -C d dlx`
 * both land on dlx.
 */
function chavesDeExecutor(base, seg) {
  const chaves = []
  for (let n = Math.min(3, seg.length); n >= 1; n--) {
    chaves.push({ chave: [base, ...seg.slice(1, n)].join(' '), resto: seg.slice(n) })
  }
  const inicios = []
  let k = 1
  while (k < seg.length && seg[k].startsWith('-') && seg[k] !== '--') k++
  if (k > 1 && k < seg.length && seg[k] !== '--') {
    inicios.push(k)
    if (OPCOES_GLOBAIS_COM_VALOR.has(seg[k - 1])) {
      let j = k + 1
      while (j < seg.length && seg[j].startsWith('-') && seg[j] !== '--') {
        j += OPCOES_GLOBAIS_COM_VALOR.has(seg[j]) ? 2 : 1
      }
      if (j < seg.length && seg[j] !== '--') inicios.push(j)
    }
  }
  for (const i of inicios) {
    for (let n = Math.min(2, seg.length - i); n >= 1; n--) {
      chaves.push({ chave: [base, ...seg.slice(i, i + n)].join(' '), resto: seg.slice(i + n) })
    }
  }
  return chaves
}

/**
 * argv -> labels, every word seen (unwrapped shells included) and one record
 * per launcher that downloads code. Shell wrappers are unwrapped up to 3
 * levels, so `cmd /c npx ...` and `bash -c "npx ..."` still expose the runner to
 * the checks that cannot be accepted.
 */
export function classificarLancamento(argv, { EXECUTORES_REMOTOS, SINAIS_DE_SHELL }) {
  exigirTabela('EXECUTORES_REMOTOS', EXECUTORES_REMOTOS)
  exigirTabela('SINAIS_DE_SHELL', SINAIS_DE_SHELL)
  const rotulos = new Set()
  const todas = []
  const execucoes = []

  const segmentos = (lista) => {
    const partes = [[]]
    for (const w of lista) {
      if (/^(?:&&|\|\||[;|&])$/.test(w)) partes.push([])
      else partes[partes.length - 1].push(w)
    }
    return partes.filter((p) => p.length)
  }

  const analisar = (lista, profundidade) => {
    if (!lista.length || profundidade > 3) return
    todas.push(...lista)
    for (const seg of segmentos(lista)) {
      const base = baseDe(seg[0])
      if (base === 'env') {
        let k = 1
        while (k < seg.length) {
          const w = seg[k]
          if (w === '-u' || w === '--unset') k += 2
          else if (w === '-S' || w === '--split-string') {
            analisar([...palavras(seg[k + 1] ?? ''), ...seg.slice(k + 2)], profundidade + 1)
            k = seg.length + 1
          } else if (w.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) k++
          else break
        }
        if (k < seg.length) analisar(seg.slice(k), profundidade + 1)
        continue
      }

      let desembrulhado = false
      for (let k = 0; k < seg.length; k++) {
        const chave = k === 0 ? base : `${base} ${seg[k].replace(/\r\n|\r|\n/g, ';')}`
        for (const linha of SINAIS_DE_SHELL) {
          const m = linha[0].exec(chave)
          if (!m) continue
          const [grupo, valor] = grupoDe(m, linha)
          const rotulo = ROTULO_DO_GRUPO[grupo]
          if (!rotulo)
            throw new Error(`mcp-server-launch: unknown group ${grupo} in SINAIS_DE_SHELL`)
          rotulos.add(rotulo)
          if (desembrulhado || k === 0) continue
          let interno = null
          if (grupo === 'emLinha') interno = palavras(seg[k + 1] ?? '')
          else if (grupo === 'resto') {
            const resto = seg.slice(k + 1)
            interno = resto.length === 1 ? palavras(resto[0]) : resto
          } else if (grupo === 'execucao' && (valor === '-c' || valor === '--call')) {
            interno = palavras(seg[k + 1] ?? '')
          } else if (grupo === 'execucao' && valor.startsWith('--call=')) {
            interno = palavras(valor.slice('--call='.length))
          }
          if (interno) {
            desembrulhado = true
            analisar(interno, profundidade + 1)
          }
        }
      }

      for (const { chave, resto } of chavesDeExecutor(base, seg)) {
        const linha = EXECUTORES_REMOTOS.find((l) => l[0].test(chave))
        if (!linha) continue
        const [familia] = grupoDe(linha[0].exec(chave), linha)
        const execucao = { familia, remoto: false, pacotes: [] }
        if (familia === 'npm') {
          for (const espec of pacotesNpm(resto)) {
            const e = especNpm(espec)
            execucao.pacotes.push({ espec, ...e })
            if (e.remoto) execucao.remoto = true
          }
        } else if (familia === 'python') {
          const espec = especPython(resto)
          const local = espec === '' || /^(?:\.{0,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|file:)/.test(espec)
          const git = /^git\+[^@]+(?:@([^#]+))?/.exec(espec)
          const fixado = git
            ? HEX_DE_COMMIT.test(git[1] ?? '')
            : /^[\w.-]+(?:\[[^\]]*\])?(?:==|@)\d+(?:\.\d+)*$/.test(espec)
          execucao.pacotes.push({ espec, remoto: !local, fixado })
          execucao.remoto = !local
        } else if (familia === 'imagem') {
          const espec = imagemDocker(resto)
          if (espec) {
            execucao.pacotes.push({
              espec,
              remoto: true,
              fixado: /@sha256:[0-9a-f]{64}$/.test(espec),
            })
            execucao.remoto = true
          }
        } else if (familia === 'deno') {
          const alvo = resto.find((a) => !a.startsWith('-'))
          if (alvo && /^(?:https?:|npm:|jsr:)/.test(alvo)) {
            execucao.pacotes.push({ espec: alvo, remoto: true, fixado: false })
            execucao.remoto = true
          }
        } else {
          throw new Error(`mcp-server-launch: unknown group ${familia} in EXECUTORES_REMOTOS`)
        }
        execucoes.push(execucao)
        rotulos.add(execucao.remoto ? 'remote-package' : 'local')
        break
      }
    }
  }

  analisar(argv, 0)
  if (!rotulos.size) rotulos.add('local')
  if (rotulos.size > 1) rotulos.delete('local')
  return {
    rotulos: ORDEM_DOS_ROTULOS.filter((r) => rotulos.has(r)),
    palavras: todas,
    execucoes,
  }
}

// ─────────────────────────────────────────────────── checks nobody can accept

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i

function rotuloDeUrl(servidor) {
  for (const campo of ['url', 'serverUrl', 'httpUrl']) {
    const u = servidor[campo]
    if (u === undefined) continue
    try {
      if (typeof u === 'string' && LOOPBACK.test(new URL(u).hostname)) return 'local'
    } catch {
      // An unparseable URL is judged as the worse case.
    }
    return 'remote-url'
  }
  return null
}

/**
 * mcp-remote is safe from 0.1.16 on (CVE-2025-6514 covers 0.0.5 to 0.1.15). A
 * word names it as a bare package, a versioned spec, a `--package=` value, an
 * npm alias (`<name>@npm:mcp-remote@<version>`) or a path ending in its binary;
 * `@scope/mcp-remote` is another package. No version, a dist-tag or any range
 * whose floor is not proven at or above 0.1.16 counts as below.
 *
 * `comoPacote`: the word is a spec a package runner resolves. Then ANY http(s),
 * git, ssh or file URL with a path segment naming mcp-remote (a tarball, a
 * GitHub archive or codeload link, a repository URL) counts as below unless a
 * version at or above 0.1.16 can be read from it. Measured before: the
 * `.tar.gz`, codeload, `https://github.com/...#v0.1.10` spellings and the alias
 * of 0.1.10 were accepted by an allowlist fingerprint. A word that is not a
 * package spec (the server URL a proxy connects to, say) is not held to that:
 * a URL there is not a name.
 */
export function mcpRemoteAbaixo(palavra, { comoPacote = false } = {}) {
  const w = String(palavra).replace(/^--package=/, '')
  // An npm alias installs the package after `@npm:` under another name.
  const alias = /^(?:@[^/@\s]+\/)?[^@\s/]+@npm:(\S+)$/i.exec(w)
  if (alias) return mcpRemoteAbaixo(alias[1], { comoPacote })
  // A registry tarball names its version in the file name, and a git spec in its
  // ref. Measured before: both spellings of 0.1.10 were never recognised, so an
  // allowlist fingerprint accepted the CVE version.
  const tarball = /(?:^|[\\/])mcp-remote-(\d+\.\d+\.\d+[^\\/]*?)\.tgz$/i.exec(w.split(/[?#]/)[0])
  if (tarball) return versaoAbaixoDe0116(tarball[1])
  const git =
    /^(?:github:|gitlab:|bitbucket:|git\+(?:ssh|https?|file):\/\/|git:\/\/|[A-Za-z0-9][\w.-]*\/)(?:[^#]*[/:])?mcp-remote(?:\.git)?\/?(?:#(.*))?$/i.exec(
      w,
    )
  if (git && !w.startsWith('@')) {
    return versaoAbaixoDe0116((git[1] ?? '').replace(/^semver:/i, ''))
  }
  if (comoPacote && /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|(?:github|gitlab|bitbucket|gist):)/.test(w)) {
    return urlDeMcpRemoteAbaixo(w)
  }
  if (w.includes('://') || /^(?:npm:)?@[^/]+\/mcp-remote/i.test(w)) return false
  const m = /^(?:npm:)?(?:.*[\\/])?mcp-remote(?:\.(?:cmd|exe|ps1|bat))?(?:@(.*))?$/i.exec(w)
  if (!m) return false
  return versaoAbaixoDe0116(m[1] ?? '')
}

/**
 * A URL package spec: false when no path segment names mcp-remote (the
 * repository, `mcp-remote.git`, or its tarball file); otherwise true unless a
 * version read from the last path segment (`mcp-remote-0.1.16.tgz`,
 * `v0.1.16.tar.gz`, codeload's `.../tar.gz/v0.1.16`) or from the `#` ref is at
 * or above 0.1.16. A branch, a commit or nothing proves no version.
 */
function urlDeMcpRemoteAbaixo(w) {
  const [antesDoRef, ...ref] = w.split('#')
  const semConsulta = antesDoRef.split('?')[0]
  const caminho = semConsulta.replace(/^[A-Za-z][A-Za-z0-9+.-]*:(?:\/\/[^/]*)?/, '')
  const segmentos = caminho.split(/[\\/]/).filter(Boolean)
  const nomeia = (s) =>
    /^mcp-remote(?:\.git)?$/i.test(s) ||
    /^mcp-remote-\d+\.\d+\.\d+\S*?\.(?:tgz|tar\.gz|zip)$/i.test(s)
  if (!segmentos.some(nomeia)) return false
  const versoes = []
  const ultimo = (segmentos[segmentos.length - 1] || '')
    .replace(/\.(?:tgz|tar\.gz|zip)$/i, '')
    .replace(/^mcp-remote-/i, '')
  if (/^v?\d+\.\d+\.\d+/.test(ultimo)) versoes.push(ultimo)
  if (ref.length) {
    const r = ref.join('#').replace(/^semver:/i, '')
    if (/^(?:\^|~|>=|=|v)?\d+\.\d+\.\d+/.test(r)) versoes.push(r)
  }
  return versoes.length === 0 || versoes.some(versaoAbaixoDe0116)
}

/** Whether a version or range is not proven at or above 0.1.16; no version counts as below. */
function versaoAbaixoDe0116(texto) {
  const v = /^(?:\^|~|>=|=|v)?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    texto,
  )
  if (!v) return true
  const [a, b, c] = [v[1], v[2], v[3]].map(Number)
  const ordem = a !== 0 ? 1 : b !== 1 ? b - 1 : c - 16
  return ordem < 0 || (ordem === 0 && Boolean(v[4]))
}

/**
 * The public registries a runner uses when nothing overrides it. A config line
 * that names one of them points the runner at the default, never away from it.
 * Measured before: `registry=https://registry.npmjs.org/` in a project .npmrc
 * made every allowlisted npx server unexemptable. Only the https spelling is
 * the default: npm 11.6.2 keeps `http://registry.npmjs.org/` as http and
 * `//registry.npmjs.org/` verbatim (`npm config get registry`), so both are
 * a different registry, and both passed here before.
 */
const REGISTRO_PADRAO = /^https:\/\/registry\.(?:npmjs\.org|yarnpkg\.com)\/?$/i

/**
 * A key or value as npm's ini parser reads it: `unsafe()` of ini@5.0.0
 * (lib/ini.js, the version npm 11.6.2 bundles). Trimmed; a text wrapped in
 * matching double or single quotes is JSON-parsed (single quotes stripped
 * first), keeping the text when that fails; otherwise it is cut at the first
 * `;` or `#` that no backslash escapes, and `\;`, `\#`, `\\` unescape.
 */
function desfazerIni(bruto) {
  let v = String(bruto ?? '').trim()
  const aspas = (q) => v.startsWith(q) && v.endsWith(q)
  if (aspas('"') || aspas("'")) {
    if (v.startsWith("'")) v = v.slice(1, -1)
    try {
      return JSON.parse(v)
    } catch {
      return v
    }
  }
  let saida = ''
  let escape = false
  for (const c of v) {
    if (escape) {
      saida += ';#\\'.includes(c) ? c : `\\${c}`
      escape = false
    } else if (c === ';' || c === '#') break
    else if (c === '\\') escape = true
    else saida += c
  }
  if (escape) saida += '\\'
  return saida.trim()
}

/**
 * The ${NAME} and ${NAME?} references npm expands in every .npmrc key before
 * using it (@npmcli/config lib/index.js:585, `envReplace(key, this.env)`, and
 * lib/env-replace.js): an odd run of backslashes before one keeps it literal.
 */
const REFERENCIA_DE_AMBIENTE = /(?<!\\)(\\*)\$\{([^${}?]+)(\?)?\}/g

/**
 * Whether a .npmrc key can be a registry key once npm expands it, and for
 * which scope. First the expansion on a machine where the variable is unset (a
 * `${NAME?}` becomes empty, a `${NAME}` stays as written), which is what a
 * repository can count on; then, since any variable may hold any text, a key
 * whose literal ends could still spell `registry` or `@scope:registry` counts
 * as an unscoped override. Measured with `npm config get`:
 * `${UNSET?}registry=`, `regi${UNSET?}stry=` and `@acme${UNSET?}:registry=` all
 * set the registry, and this rule read none of them.
 * Returns { sim: false } | { sim: true, escopo: string | null }.
 */
function chaveDeRegistro(chave) {
  const texto = String(chave)
  const pedacos = []
  let resto = ''
  let variavel = false
  let desde = 0
  for (const m of texto.matchAll(REFERENCIA_DE_AMBIENTE)) {
    const [inteira, barras, nome, opcional] = m
    resto += texto.slice(desde, m.index)
    desde = m.index + inteira.length
    if (barras.length % 2) {
      resto += inteira.slice((barras.length + 1) / 2)
      continue
    }
    resto += barras.slice(barras.length / 2)
    pedacos.push({ antes: resto, nome, opcional: Boolean(opcional) })
    resto = ''
    variavel = true
  }
  resto += texto.slice(desde)
  let semVariavel = ''
  for (const p of pedacos) semVariavel += p.antes + (p.opcional ? '' : `\${${p.nome}}`)
  semVariavel += resto
  const m = /^(?:(@[^:]+):)?registry$/.exec(semVariavel)
  if (m) return { sim: true, escopo: m[1] ?? null }
  if (!variavel) return { sim: false }
  const inicio = pedacos[0].antes
  const fim = resto
  const podeComecar = inicio === '' || 'registry'.startsWith(inicio) || inicio.startsWith('@')
  const podeTerminar =
    fim === '' || 'registry'.endsWith(fim) || ':registry'.endsWith(fim) || fim.endsWith(':registry')
  return podeComecar && podeTerminar ? { sim: true, escopo: null } : { sim: false }
}

/**
 * The top-level entries of a .npmrc, in file order, as ini@5.0.0 `decode()`
 * yields them: lines split on CR and LF, blank and `;` or `#` comment lines
 * skipped, and a `[section]` header ends the top level for the rest of the
 * file (npm reads no key inside a section). A `key[]` is the array form of
 * `key`. Measured with npm 11.6.2: `"registry"=`, `'registry' =`, `registry[]=`
 * and `"@acme:registry"=` all set the registry, while `REGISTRY=` (keys are
 * case-sensitive), a key after `[x]` and `registry\=x=` do not, and
 * `registry=https://registry.npmjs.org/ ; comment` is the default.
 */
function lerNpmrc(texto) {
  const saida = []
  for (const linha of String(texto).split(/[\r\n]+/)) {
    if (!linha || /^\s*[;#]/.test(linha) || /^\s*$/.test(linha)) continue
    if (/^\[[^\]]*\]\s*$/.test(linha)) break
    const m = /^([^=]+)(=(.*))?$/.exec(linha)
    if (!m) continue
    let chave = desfazerIni(m[1])
    if (typeof chave === 'string' && chave.length > 2 && chave.endsWith('[]'))
      chave = chave.slice(0, -2)
    saida.push({ chave: String(chave), valor: m[2] ? desfazerIni(m[3]) : true })
  }
  return saida
}

/** Whether a registry value from a config (a string, or bun's `{ url }`) is a default one. */
function ehRegistroPadrao(valor) {
  const url = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor.url : valor
  if (typeof url !== 'string') return false
  const limpo = url
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim()
  return REGISTRO_PADRAO.test(limpo)
}

/** `@Scope` or `scope` as the lower-case `@scope` npm compares. */
const escopoNormal = (escopo) => `@${String(escopo).replace(/^@/, '').toLowerCase()}`

/**
 * Tracked files that change which package a runner starts. npm, pnpm and bun
 * read a project `.npmrc`, yarn reads `.yarnrc.yml`, bun reads `bunfig.toml`,
 * uv reads `uv.toml`, and a runner prefers a local `node_modules/.bin` entry to
 * the registry. Each npm-family override records its folder (`pasta`, '' at the
 * root) and its scope (`escopo`, null when it applies to every package), so the
 * check can keep only the ones that reach a given launch (sobrescritaQueAlcanca).
 * A registry value that is a public default is no override. A file that cannot
 * be read counts as an unscoped override: the runner reads it anyway.
 */
function sobrescritasDeRegistro(indice) {
  const npm = []
  const python = []
  const vistos = new Set()
  for (const e of indice.entradas) {
    if (vistos.has(e.caminho)) continue
    vistos.add(e.caminho)
    const baixo = e.caminho.toLowerCase()
    const nome = posix.basename(baixo)
    const dirname = posix.dirname(e.caminho)
    const pasta = dirname === '.' ? '' : dirname
    const empurrar = (escopo) => npm.push({ caminho: e.caminho, pasta, escopo })
    if (/(?:^|\/)node_modules\/\.bin\/./.test(baixo)) {
      // Wherever it sits: which folder a runner searches for binaries is not
      // modelled here, so this one keeps reaching every npm-family launch.
      npm.push({ caminho: e.caminho, pasta: null, escopo: null })
      continue
    }
    if (nome === '.npmrc') {
      if (e.texto === null) empurrar(null)
      else {
        for (const { chave, valor } of lerNpmrc(e.texto)) {
          const registro = chaveDeRegistro(chave)
          const padrao = typeof valor === 'string' && REGISTRO_PADRAO.test(valor)
          if (registro.sim && !padrao) {
            empurrar(registro.escopo ? escopoNormal(registro.escopo) : null)
          }
        }
      }
    } else if (nome === '.yarnrc.yml') {
      const lido = e.texto === null ? null : lerYaml(e.texto)
      const v = lido && !lido.erro ? lido.valor : undefined
      // A repeated key reads as an unreadable file here, as it did when the
      // YAML reader refused it: which copy yarn keeps is not assumed.
      if (!lido || lido.erro || lido.duplicatas.length) empurrar(null)
      else if (v && typeof v === 'object') {
        if (v.npmRegistryServer !== undefined && !ehRegistroPadrao(v.npmRegistryServer)) {
          empurrar(null)
        }
        if (v.npmScopes && typeof v.npmScopes === 'object') {
          for (const [escopo, cfg] of Object.entries(v.npmScopes)) {
            if (
              cfg &&
              typeof cfg === 'object' &&
              cfg.npmRegistryServer !== undefined &&
              !ehRegistroPadrao(cfg.npmRegistryServer)
            ) {
              empurrar(escopoNormal(escopo))
            }
          }
        }
      }
    } else if (nome === 'bunfig.toml') {
      const lido = e.texto === null ? null : lerToml(e.texto)
      const install = lido && !lido.erro && lido.valor ? lido.valor.install : undefined
      if (!lido || lido.erro) empurrar(null)
      else if (install && typeof install === 'object') {
        if (install.registry !== undefined && !ehRegistroPadrao(install.registry)) empurrar(null)
        if (install.scopes && typeof install.scopes === 'object') {
          for (const [escopo, valor] of Object.entries(install.scopes)) {
            if (!ehRegistroPadrao(valor)) empurrar(escopoNormal(escopo))
          }
        }
      }
    } else if (nome === 'uv.toml') {
      const lido = e.texto === null ? null : lerToml(e.texto)
      const v = lido && !lido.erro ? lido.valor : null
      const indices = (o) =>
        o &&
        typeof o === 'object' &&
        ['index-url', 'extra-index-url', 'index', 'find-links'].some((k) => o[k] !== undefined)
      if (!v || indices(v) || indices(v.pip)) python.push({ caminho: e.caminho, escopo: null })
    }
  }
  return { npm, python }
}

/**
 * The folders whose npm-family config a launch reads: the repository root and
 * the folder the server starts in (its `cwd` resolved from the project folder,
 * or the project folder itself). Measured before: a `packages/ui/.npmrc` of a
 * monorepo, which a launch from the root never reads, blocked it for good.
 */
function pastasDoLancamento(s) {
  if (typeof s.bruto.cwd === 'string') {
    const cwd = s.bruto.cwd
      .replace(/\\/g, '/')
      .replace(/^\$\{(?:workspaceFolder|workspaceRoot)\}(?:\/|$)/, '')
      .replace(/^(?:\.\/)+/, '')
    if (!/^(?:\/|[A-Za-z]:|~|\$)/.test(cwd)) {
      const pasta = posix.normalize(posix.join(s.raiz || '.', cwd || '.')).replace(/\/+$/, '')
      if (pasta !== '..' && !pasta.startsWith('../'))
        return new Set(['', pasta === '.' ? '' : pasta])
    }
  }
  // No cwd, or one this rule cannot place (absolute, a variable): the folder the
  // client starts a stdio server in.
  return new Set(['', s.raiz])
}

/** The scope of the package a spec resolves to (`x@npm:@s/p` is `@s`), or null. */
function escopoDoPacote(espec) {
  let e = String(espec)
  const alias = /^(?:@[^/@\s]+\/)?[^@\s/]+@npm:(\S+)$/i.exec(e)
  if (alias) e = alias[1]
  e = e.replace(/^npm:/i, '')
  const m = /^(@[^/@\s]+)\//.exec(e)
  return m ? m[1].toLowerCase() : null
}

/**
 * The first override that changes where THIS launch resolves its package: a
 * config at the root or in the launch's folder, unscoped, or scoped to the
 * scope of a package the launch names. An override of another scope routes
 * packages the launch does not name, and what those install transitively is
 * outside what a launch fingerprint can pin anyway. Measured before: a company
 * `.npmrc` with `@acme:registry` blocked every allowlisted unscoped npx server.
 */
function sobrescritaQueAlcanca(execucoes, sobrescritas, pastas) {
  for (const x of execucoes) {
    if (x.familia === 'npm') {
      const escopos = new Set(x.pacotes.map((p) => escopoDoPacote(p.espec)).filter(Boolean))
      const achada = sobrescritas.npm.find(
        (o) =>
          (o.pasta === null || pastas.has(o.pasta)) && (o.escopo === null || escopos.has(o.escopo)),
      )
      if (achada) return achada
    }
    if (x.familia === 'python' && x.remoto && sobrescritas.python.length)
      return sobrescritas.python[0]
  }
  return null
}

// ─────────────────────────────────────────────────────────────── the rule

const plural = (n, um, varios) => (n === 1 ? um : varios)

/**
 * The launch classified under every reading of its command (split and whole,
 * see lerConfigsMcp), labels, words and runners united, so a check that cannot
 * be accepted runs when either reading reaches it.
 */
function classificarLeituras(s, tabelas) {
  if (!s.argv) return null
  const leituras = [s.argv, s.argvInteiro]
    .filter(Boolean)
    .map((a) => classificarLancamento(a, tabelas))
  if (leituras.length === 1) return leituras[0]
  const rotulos = new Set(leituras.flatMap((c) => c.rotulos))
  if (rotulos.size > 1) rotulos.delete('local')
  return {
    rotulos: ORDEM_DOS_ROTULOS.filter((r) => rotulos.has(r)),
    palavras: leituras.flatMap((c) => c.palavras),
    execucoes: leituras.flatMap((c) => c.execucoes),
  }
}

export function checarMcpLaunch(r, { EXECUTORES_REMOTOS, SINAIS_DE_SHELL, molde = MOLDE } = {}) {
  const tabelas = { EXECUTORES_REMOTOS, SINAIS_DE_SHELL }
  exigirTabela('EXECUTORES_REMOTOS', EXECUTORES_REMOTOS)
  exigirTabela('SINAIS_DE_SHELL', SINAIS_DE_SHELL)
  const dir = r && typeof r === 'object' ? r.dir : r
  const indice = lerIndice(dir)
  if (indice.semGit) return na('no MCP server configuration tracked')

  const allowlist = lerAllowlist(dir)
  const { servidores, duros, declaram } = lerConfigsMcp(indice)
  const aceitosPeloMolde = servidores.length ? lancamentosDoMolde(molde) : new Set()

  // A malformed allowlist line exempts nothing and fails every injection rule:
  // a bypass that cannot be read is not accepted.
  const itensDuros = allowlist.erros.map(
    (x) =>
      `${onde(NOME_DA_ALLOWLIST, x.linha, x.coluna)} ${escaparSaida(x.mensagem, { limite: 120 })} ` +
      '(not exemptable)',
  )
  itensDuros.push(...duros)
  const itensSemAceite = []
  let sobrescritas = null
  let aceitosPorEntrada = 0

  for (const s of servidores) {
    const razoes = [...s.razoes]
    let rotulos = []
    if (!razoes.length) {
      const classe = classificarLeituras(s, tabelas)
      rotulos = classe ? [...classe.rotulos] : []
      const url = rotuloDeUrl(s.bruto)
      if (url) rotulos = [url, ...rotulos.filter((x) => x !== 'local' || url === 'local')]
      if (s.bruto.headersHelper !== undefined && !rotulos.includes('shell')) rotulos.push('shell')
      if (!rotulos.length) rotulos.push('local')
      if (rotulos.length > 1) rotulos = rotulos.filter((x) => x !== 'local')
      rotulos = ORDEM_DOS_ROTULOS.filter((x) => rotulos.includes(x))

      if (typeof s.bruto.command === 'string' && s.bruto.command.includes('${')) {
        razoes.push('its command is resolved from the environment when the client starts it')
      }
      if (s.cliente === 'gemini' && s.bruto.trust === true) {
        razoes.push('trust: true lets every tool call run without a confirmation')
      }
      if (
        classe &&
        (classe.palavras.some((w) => mcpRemoteAbaixo(w)) ||
          classe.execucoes.some((x) =>
            x.pacotes.some((p) => mcpRemoteAbaixo(p.espec, { comoPacote: true })),
          ))
      ) {
        razoes.push('it names mcp-remote below 0.1.16 or with no version (CVE-2025-6514)')
      }
      if (classe && classe.execucoes.length) {
        sobrescritas = sobrescritas || sobrescritasDeRegistro(indice)
        const alcance = sobrescritaQueAlcanca(classe.execucoes, sobrescritas, pastasDoLancamento(s))
        if (alcance) {
          razoes.push(
            `it runs a package runner while ${escaparSaida(alcance.caminho, { limite: 80 })} ` +
              'changes which package that runner starts',
          )
        }
      }
    }

    const cabeca =
      `${onde(s.arquivo, s.linha, s.coluna)} server ${texto40(s.nome)} ` +
      `[${rotulos.join(', ')}] fingerprint sha256:${s.impressao}`
    const doMolde = !razoes.length && aceitosPeloMolde.has(s.impressao)
    const porEntrada =
      !doMolde &&
      allowlist.aceita(REGRA, { arquivo: s.arquivo, servidor: s.nome, sha256: s.impressao })
    if (razoes.length) {
      itensDuros.push(`${cabeca} — ${razoes.join('; ')} (not exemptable)`)
    } else if (!doMolde && !porEntrada) {
      itensSemAceite.push(cabeca)
      sugerirEntrada(r, REGRA, { arquivo: s.arquivo, servidor: s.nome, sha256: s.impressao })
    } else if (porEntrada) {
      aceitosPorEntrada++
    }
  }

  const obsoletas = allowlist.obsoletas(REGRA)
  const avisoObsoletas = obsoletas
    ? `${obsoletas} ${NOME_DA_ALLOWLIST} ${plural(obsoletas, 'entry', 'entries')} for ${REGRA} ` +
      `${plural(obsoletas, 'matches', 'match')} no current launch: ` +
      'a stale acceptance is one edit away from accepting something else'
    : null

  const itens = [...itensDuros, ...itensSemAceite]
  if (itens.length) {
    const partes = [
      `${itens.length} MCP launch ${plural(itens.length, 'finding', 'findings')}: ${resumir(itens)}`,
    ]
    if (itensSemAceite.length) {
      partes.push(
        ` — accept a launch by adding {regra, motivo, arquivo, servidor, sha256} to ${NOME_DA_ALLOWLIST}, ` +
          'or remove the server',
      )
    }
    if (itensSemAceite.length && allowlist.naoRastreada) {
      partes.push(
        ` · ${NOME_DA_ALLOWLIST} exists on disk but git does not track it, so it accepts nothing`,
      )
    }
    if (avisoObsoletas) partes.push(` · ${avisoObsoletas}`)
    return partes.join('')
  }

  const notas = []
  if (aceitosPorEntrada && !allowlist.cobertaPorCodeowners) {
    notas.push(
      `${aceitosPorEntrada} MCP ${plural(aceitosPorEntrada, 'launch', 'launches')} accepted by ` +
        `${NOME_DA_ALLOWLIST}, which no CODEOWNERS entry owns: whoever edits that file accepts launches`,
    )
  }
  if (avisoObsoletas) notas.push(avisoObsoletas)
  if (!servidores.length) {
    if (notas.length) return { nota: notas.join(' · ') }
    return declaram
      ? na('the tracked MCP configuration declares no server')
      : na('no MCP server configuration tracked')
  }
  return notas.length ? { nota: notas.join(' · ') } : null
}

// ─────────────────────────────────────────────── files a launch points at

/**
 * Tracked files named by a launch. A stdio server starts in the client's
 * project folder, so a word resolves from there (and from `cwd` when set),
 * after dropping a leading `${workspaceFolder}/` or `./` and a `--flag=`
 * prefix. Words with whitespace are split once more, which reaches the script
 * inside `bash -c "node server.mjs"`. Absolute and URL words are skipped.
 */
export function arquivosReferenciados(dir) {
  const indice = lerIndice(dir)
  const { servidores } = lerConfigsMcp(indice)
  const achados = new Map()
  const limpar = (w) =>
    w
      .replace(/\\/g, '/')
      .replace(/^\$\{(?:workspaceFolder|workspaceRoot)\}\//, '')
      .replace(/^(?:\.\/)+/, '')
  for (const s of servidores) {
    if (!s.argv) continue
    const bases = [s.raiz]
    if (typeof s.bruto.cwd === 'string') {
      const cwd = limpar(s.bruto.cwd)
      if (cwd && !/^(?:\/|[A-Za-z]:|~|\$)/.test(cwd)) bases.unshift(posix.join(s.raiz, cwd))
    }
    const todas = s.argv.flatMap((w) => (/\s/.test(w) ? [w, ...palavras(w)] : [w]))
    for (const bruta of todas) {
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
      for (const base of bases) {
        const p = posix.normalize(posix.join(base || '.', w))
        if (p === '..' || p.startsWith('../')) continue
        const e = indice.porCaminho.get(p)
        if (!e || e.texto === null || e.symlink?.pasta) continue
        const chave = `${p}\0${s.arquivo}\0${s.nome}`
        if (!achados.has(chave))
          achados.set(chave, { caminho: p, arquivo: s.arquivo, servidor: s.nome })
      }
    }
  }
  return [...achados.values()].sort((a, b) =>
    a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0,
  )
}
