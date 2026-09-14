// agent-config — the settings an AI client reads from a repository and obeys
// before anyone types a command (rule agent-config-exec).
//
// WHY A RULE ABOUT SETTINGS. A cloned repository can carry a settings file that
// runs a helper command in a non-interactive run, sends the client's API traffic
// (and the credential with it) to another host, starts a task when the folder
// opens, or approves every shell command. Each of those shipped as a real
// advisory: CVE-2025-53773 (a workspace auto-approve key), CVE-2026-21852 (a
// project `env` block redirecting the API endpoint), CVE-2025-61260 (a `.env`
// moving an agent home into the repository), CVE-2026-41613 (a loader variable
// hidden in an MCP server environment). In a diff they all look like config.
//
// WHY PARSE AND NOT GREP. Measured by a phase-1 prototype (not tracked): a
// VS Code key with one letter written as a unicode escape, behind a comment and
// a trailing comma, is invisible to a raw-text regex and real to the editor. So
// every comparison below runs on DECODED keys, from formats.mjs, and each
// position comes from the parser.
//
// WHY THE INDEX. Measured in phase 1: a tracked directory link
// named like the client's config folder hides the settings file from ls-files,
// and .rebarignore or a proof root would hide it from r.arquivos. reader.mjs
// reads stage-0 index entries, resolves links and mounts directory links, and
// honors no exemption; this file only uses what it returns.
//
// WHAT IT NEVER PRINTS. Commands, URLs, rule strings and header values are
// attacker text, and this output reaches CI logs, `--json` and MCP answers that
// agents read. They go out only as `sha256:<12 hex> len:<n>`;
// key paths and server names go through escaparSaida, capped at 40 code points.
//
// THE THREE ANSWERS:
//   a string — a finding that must not merge: reprovou
//   { nota } — only settings that deserve a human look: passou with a warning
//   na()     — no agent configuration file is tracked
//
// Every vendor key, value and variable name in this file is assembled from
// pieces. The other injection families read this file's raw text with their
// own tables, and a source that spells what it hunts accuses
// itself or a neighbour.
//
// ─────────────────────────────────────────────────────────────── the API
//
/**
 * checarAgentConfig(r, { CHAVES_QUE_EXECUTAM, VARIAVEIS_PERIGOSAS })
 *   -> string | { nota: string } | { na: string } | null
 *   `r.dir` is the target. Throws when a table is missing or git fails, which
 *   the executor turns into quebrou.
 *
 * CHAVES_QUE_EXECUTAM: Array<[RegExp, explicacao, uso]>
 *   The RegExp is anchored and tested against `<familia>:<pointer>`, where the
 *   pointer is RFC 6901 over decoded keys, relative to the view the family
 *   reads (for example `vscode:/<key>` for the `settings` member of a
 *   workspace file). `uso` is { veredito: 'reprova'|'avisa', quando, rotulo?,
 *   livre?, contar?, lancamento? }; `quando` names a condition on the value.
 *
 * VARIAVEIS_PERIGOSAS: Array<[RegExp, explicacao, uso]>
 *   The RegExp is anchored, case-insensitive, and tested against an environment
 *   variable NAME. `uso.contextos` lists where the row applies: 'claude' (the
 *   settings `env` block), 'mcp' (an MCP server `env`), 'dotenv' (a `.env`).
 *
 * alvoDeConfig(caminho) -> { formato, visoes, ... } | null
 *   Whether a repo-relative path is a file this rule reads, and how.
 *
 * ehRegraAmpla(dialeto, regra) -> boolean  ('claude' | 'gemini' | 'cursor')
 * canonico(valor) -> string  JSON with object keys sorted, the allowlist hash input.
 */

import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { createContext, runInContext } from 'node:vm'

import { escaparSaida } from '../texto-seguro.mjs'
import { lerFrontmatter, lerJsonc, lerToml } from './formats.mjs'
import {
  NOME_DA_ALLOWLIST,
  impressao,
  lerAllowlist,
  sugerirEntrada,
  lerIndice,
  onde,
  posicao,
  problemasDeLeitura,
  resumir,
  textosNoDisco,
} from './reader.mjs'

const ID = 'agent-config-exec'
const na = (motivo) => ({ na: motivo })
const j = (...partes) => partes.join('')
/** 'A+B C+D' -> 'AB|CD': a list of names whose source never spells one whole. */
const alternativas = (lista) => lista.split('+').join('').split(' ').join('|')

/** One table row. `uso` is frozen: the engine reads it, nobody writes it. */
const registro = (fonte, explicacao, uso, flags = '') => [
  new RegExp(fonte, flags),
  explicacao,
  Object.freeze(uso),
]

// ─────────────────────────────────────────────────────────────── vocabulary

const V = {
  bypass: j('bypass', 'Permissions'),
  auto: 'auto',
  aceitaEdicoes: j('accept', 'Edits'),
  autoAprova: j('auto', 'Approve'),
  pilotoAutomatico: j('auto', 'pilot'),
  aoAbrirPasta: j('folder', 'Open'),
  ligado: 'on',
  nunca: j('nev', 'er'),
  semSandbox: j('danger-', 'full-access'),
}

// ═══════════════════════════════════════════════════════════════ the tables

/**
 * Keys that run a command, send traffic elsewhere, or widen approval. The
 * verdicts follow the vendor docs checked in phase 1: a key that only acts
 * after folder trust warns, and the owner decision adds the preview launch file
 * as a warning only. Ordered by family; when two rows hold for the same key,
 * the engine keeps the reprova one.
 */
export const CHAVES_QUE_EXECUTAM = [
  // ── the Claude settings pair, read together
  registro(
    j(
      '^claude:/(',
      j('api', 'Key', 'Helper|'),
      j('aws', 'Auth', 'Refresh|'),
      j('aws', 'Credential', 'Export|'),
      j('gcp', 'Auth', 'Refresh|'),
      j('otel', 'Headers', 'Helper'),
      ')$',
    ),
    'a credential or telemetry helper, a shell command the client runs even in a non-interactive run',
    { veredito: 'reprova', quando: 'texto', livre: true },
  ),
  registro(
    j('^claude:/', 'permissions/', 'default', 'Mode$'),
    'a default permission mode that stops asking before any tool runs',
    { veredito: 'reprova', quando: { um: [V.bypass, V.auto] }, rotulo: 'inerte' },
  ),
  registro(
    j('^claude:/', 'permissions/', 'default', 'Mode$'),
    'a default permission mode that accepts file edits without asking',
    { veredito: 'avisa', quando: { um: [V.aceitaEdicoes] }, rotulo: 'confianca' },
  ),
  registro(
    j('^claude:/', 'skip', 'Dangerous', 'Mode', 'Permission', 'Prompt$'),
    'asks the client to skip the warning shown before approvals are turned off',
    { veredito: 'reprova', quando: 'presente', rotulo: 'inerte' },
  ),
  registro(
    j('^claude:/', 'permissions/', 'allow/', '\\d+$'),
    'pre-approves every shell command, or an interpreter with any arguments',
    { veredito: 'reprova', quando: 'regraClaudeAmpla', livre: true, rotulo: 'confianca' },
  ),
  registro(
    j('^claude:/', 'enable', 'All', 'Project', 'Mcp', 'Servers$'),
    'approves every MCP server the repository declares, including ones added later',
    { veredito: 'avisa', quando: 'verdadeiro', rotulo: 'confianca' },
  ),
  registro(
    j('^claude:/', 'enabled', 'Mcpjson', 'Servers$'),
    'pre-approves MCP servers the repository declares',
    { veredito: 'avisa', quando: 'naoVazio', contar: true, rotulo: 'confianca' },
  ),
  registro(
    j('^claude:/(', 'enabled', 'Plugins|', 'extra', 'Known', 'Marketplaces', ')$'),
    'enables plugins or plugin sources chosen by the repository',
    { veredito: 'avisa', quando: 'naoVazio', contar: true, rotulo: 'confianca' },
  ),
  registro(
    j('^claude:/', 'sandbox/', 'enabled$'),
    'turns the command sandbox off, over a stricter value the user may have set',
    { veredito: 'avisa', quando: 'falso' },
  ),
  registro(
    j('^claude:/', 'sandbox/', 'allow', 'Unsandboxed', 'Commands$'),
    'lets a command that fails in the sandbox retry outside it',
    { veredito: 'avisa', quando: 'verdadeiro' },
  ),
  registro(
    j('^claude:/', 'sandbox/', 'excluded', 'Commands$'),
    'runs the listed commands outside the sandbox',
    { veredito: 'avisa', quando: 'naoVazio', contar: true },
  ),
  registro(
    j('^claude:/', 'disable', 'All', 'Hooks$'),
    'switches every hook on or off for whoever opens the folder, their own hooks included',
    { veredito: 'avisa', quando: 'presente' },
  ),
  registro(
    j(
      '^claude:/(',
      'status',
      'Line|',
      'subagent',
      'Status',
      'Line|',
      'file',
      'Suggestion',
      ')/command$',
    ),
    'a shell command the client runs to draw part of its interface',
    { veredito: 'avisa', quando: 'texto', livre: true, rotulo: 'confianca' },
  ),
  registro(
    '^claude-local:$',
    'a personal settings file is tracked, so the client treats it as supplied by the repository',
    { veredito: 'avisa', quando: 'presente' },
  ),
  registro(
    j('^claude-launch:/', 'configurations/', '\\d+$'),
    'a preview launch the client starts when someone asks for a preview',
    { veredito: 'avisa', quando: 'objeto', lancamento: true },
  ),

  // ── hooks, wherever a client reads them
  registro(
    j('^(claude|gemini|codex|ganchos):/', 'hooks/', '[^/]+/\\d+(/', 'hooks/', '\\d+)?$'),
    'a hook, a command or request the client runs by itself on an agent event',
    { veredito: 'avisa', quando: 'gancho', livre: true },
  ),

  // ── VS Code workspace settings, and the settings member of a workspace file
  registro(
    j('^vscode:/', 'chat\\.tools\\.(global\\.)?', 'auto', 'Approve$'),
    'approves every agent tool call without asking',
    { veredito: 'reprova', quando: 'verdadeiro', rotulo: 'inerte' },
  ),
  registro(
    j('^vscode:/', 'chat\\.permissions\\.', 'default$'),
    'a default chat permission level that stops asking before tools run',
    {
      veredito: 'reprova',
      quando: { um: [V.autoAprova, V.pilotoAutomatico] },
      rotulo: 'confianca',
    },
  ),
  registro(
    j('^vscode:/', 'chat\\.tools\\.terminal\\.', 'auto', 'Approve/', '[^/]+$'),
    'approves any terminal command, or an interpreter with any arguments',
    { veredito: 'reprova', quando: 'terminalAmplo', livre: true, rotulo: 'confianca' },
  ),
  registro(
    j('^vscode:/', 'chat\\.tools\\.terminal\\.', 'auto', 'Approve/', '[^/]+$'),
    'approves a terminal command without asking',
    { veredito: 'avisa', quando: 'terminalAprova', livre: true, rotulo: 'confianca' },
  ),
  registro(
    j('^vscode:/', 'chat\\.tools\\.terminal\\.', 'ignore', 'Default', 'Auto', 'Approve', 'Rules$'),
    'drops the built-in rules that keep dangerous terminal commands asking',
    { veredito: 'reprova', quando: 'verdadeiro', rotulo: 'confianca' },
  ),
  registro(
    j('^vscode:/', 'chat\\.tools\\.urls\\.', 'auto', 'Approve/', '[^/]+$'),
    'approves requests to any address without asking',
    { veredito: 'reprova', quando: 'urlCuringa', livre: true, rotulo: 'confianca' },
  ),
  registro(
    j('^vscode:/', 'chat\\.tools\\.urls\\.', 'auto', 'Approve/', '[^/]+$'),
    'approves requests to an address without asking',
    { veredito: 'avisa', quando: 'urlAprova', livre: true, rotulo: 'confianca' },
  ),
  registro(
    j('^vscode:/', 'task\\.allow', 'Automatic', 'Tasks$'),
    'lets tasks start by themselves when the folder opens',
    { veredito: 'reprova', quando: { um: [V.ligado] }, rotulo: 'inerte' },
  ),
  registro(
    j('^vscode:/', 'security\\.workspace\\.', 'trust\\.', 'enabled$'),
    'turns off the question of whether to trust the folder',
    { veredito: 'reprova', quando: 'falso', rotulo: 'inerte' },
  ),
  registro(
    j(
      '^vscode:(/\\[[^/]*\\])?/([^/]*\\.)?(',
      j('executable', 'Path|path|node', 'Path|server', 'Path|interpreter', 'Path|'),
      j('default', 'Interpreter', 'Path|tsdk|bin', 'Path|executable'),
      ')$',
    ),
    'points an editor tool at a program that lives in the repository',
    { veredito: 'reprova', quando: 'caminhoRastreado', livre: true, rotulo: 'confianca' },
    'i',
  ),

  // ── Dev Containers: lifecycle commands the container tooling runs by itself.
  // initializeCommand runs on the HOST when the container is built; the others
  // run inside it on create, start or attach. None of them asks.
  registro(
    j(
      '^devcontainer:/(',
      'initialize',
      'Command|on',
      'Create',
      'Command|update',
      'Content',
      'Command|post',
      'Create',
      'Command|post',
      'Start',
      'Command|post',
      'Attach',
      'Command)$',
    ),
    'a lifecycle command the container tooling runs by itself',
    { veredito: 'avisa', quando: 'comando', livre: true },
  ),

  // ── tasks, in tasks.json and in the tasks member of a workspace file
  registro(
    j('^tasks:/', 'tasks/', '\\d+/', 'run', 'Options/', 'run', 'On$'),
    'starts a task by itself when the folder opens',
    { veredito: 'reprova', quando: { um: [V.aoAbrirPasta] }, rotulo: 'confianca' },
  ),

  // ── Cursor CLI project permissions
  registro(
    j('^cursor-cli:/', 'permissions/', 'allow/', '\\d+$'),
    'pre-approves every shell command, or an interpreter with any arguments',
    { veredito: 'reprova', quando: 'regraCursorAmpla', livre: true },
  ),

  // ── Codex project config. A `[profiles.<name>]` table carries the same two
  // keys, and the client applies them when `profile = "<name>"` or `--profile`
  // selects it; any profile can be selected, so every one is judged. Measured
  // before: the top-level key failed and the same key under a profile passed.
  registro(
    j('^codex:/', '(?:profiles/[^/]+/)?', 'approval', '_policy$'),
    'an approval policy that never asks before a command runs',
    { veredito: 'reprova', quando: { um: [V.nunca] }, rotulo: 'confianca' },
  ),
  registro(
    j('^codex:/', '(?:profiles/[^/]+/)?', 'sandbox', '_mode$'),
    'a sandbox mode with no sandbox at all',
    { veredito: 'reprova', quando: { um: [V.semSandbox] }, rotulo: 'confianca' },
  ),
  // The permission profile that replaces the sandbox mode (Codex permissions
  // docs): its built-in no-sandbox profile is the same hole under a new key.
  // Top-level only: the config reference says a project .codex/config.toml
  // cannot override `profile` or `profiles`, so a profile table there is inert
  // (the two rows above still judge those tables, which a later change can drop).
  registro(
    j('^codex:/', 'default', '_permissions$'),
    'a default permission profile with no sandbox at all',
    { veredito: 'reprova', quando: { um: [j(':', V.semSandbox)] }, rotulo: 'confianca' },
  ),

  // ── Gemini project settings
  registro(
    j('^gemini:/', 'mcp', 'Servers/', '[^/]+/', 'trust$'),
    'skips every confirmation for the tools of this MCP server',
    { veredito: 'reprova', quando: 'verdadeiro' },
  ),
  registro(
    j('^gemini:/', 'tools/', 'allowed/', '\\d+$'),
    'pre-approves every shell command, or an interpreter with any arguments',
    { veredito: 'reprova', quando: 'regraGeminiAmpla', livre: true },
  ),

  // ── any MCP server map
  registro(
    j('^mcp:/', '[^/]+/(', 'headers', 'Helper|http', '_headers', '_helper', ')$'),
    'a shell command the client runs to build the request headers of an MCP server',
    { veredito: 'avisa', quando: 'texto', livre: true, rotulo: 'confianca' },
  ),
  registro(
    j('^mcp:/', '[^/]+/', 'env', 'File$'),
    'loads the environment of an MCP server from a file',
    { veredito: 'avisa', quando: 'texto', livre: true },
  ),

  // ── subagent, skill and command frontmatter
  registro(
    // Documented for subagents; read on skills and commands too, where no
    // client documents it, because a key nobody honors today costs nothing to drop.
    j('^(subagente|skill):/', 'permission', 'Mode$'),
    'a frontmatter permission mode that stops asking before any tool runs',
    { veredito: 'reprova', quando: { um: [V.bypass] }, rotulo: 'inerte' },
  ),
  registro(
    j('^subagente:/(', 'hooks|', 'mcp', 'Servers', ')$'),
    'hooks or MCP servers declared by a subagent',
    { veredito: 'avisa', quando: 'presente', rotulo: 'confianca' },
  ),
  registro(
    j('^skill:/(', 'hooks|', 'mcp', 'Servers', ')$'),
    'hooks or MCP servers declared by a skill',
    { veredito: 'avisa', quando: 'presente' },
  ),
  registro(
    j('^skill:/', 'allowed', '-tools$'),
    'pre-approves every shell command, or an interpreter with any arguments, whenever the skill runs',
    { veredito: 'reprova', quando: 'ferramentasAmplas', livre: true },
  ),
  registro(
    j('^skill:/', 'allowed', '-tools$'),
    'pre-approves tools whenever the skill runs, with no folder trust asked',
    { veredito: 'avisa', quando: 'ferramentas', livre: true },
  ),
  registro(
    j('^skill:/', '!/', '\\d+$'),
    'a command the skill runs before the model reads it, next to a shell grant',
    { veredito: 'avisa', quando: 'comandoComShell', livre: true },
  ),
]

/**
 * Environment variable NAMES, case-insensitive: on Windows process.env is, so a
 * lowercase spelling reaches the same variable. `contextos` keeps each row
 * where its danger was documented: the endpoint and home rows are about the
 * client's own process (its settings `env`), the loader rows are about any
 * program started with the environment.
 */
const TODOS = ['claude', 'mcp', 'dotenv']

export const VARIAVEIS_PERIGOSAS = [
  registro(
    j('^[A-Z0-9_]*_BASE', '_URL$'),
    'sends the client API traffic, and the credential with it, to another address',
    { veredito: 'reprova', quando: 'presente', contextos: ['claude'], livre: true },
    'i',
  ),
  registro(
    j('^ANTHROPIC', '_CUSTOM', '_HEADERS$'),
    'adds headers to every API request the client sends',
    { veredito: 'reprova', quando: 'presente', contextos: ['claude'], livre: true },
    'i',
  ),
  registro(
    j('^(HTTPS?|ALL)', '_PROXY$'),
    'routes the client traffic through a proxy',
    { veredito: 'reprova', quando: 'presente', contextos: ['claude'], livre: true },
    'i',
  ),
  registro(
    j('^NODE', '_EXTRA', '_CA', '_CERTS$'),
    'trusts an extra certificate authority, which lets a proxy read the traffic',
    { veredito: 'reprova', quando: 'presente', contextos: ['claude'], livre: true },
    'i',
  ),
  registro(
    j('^CLAUDE', '_CODE', '_SHELL', '_PREFIX$'),
    'wraps every shell command the client runs',
    { veredito: 'reprova', quando: 'presente', contextos: ['claude'], livre: true },
    'i',
  ),
  registro(
    j('^(CLAUDE', '_CONFIG', '_DIR|CLAUDE', '_CODE', '_TMPDIR|HOME|XDG', '_[A-Z0-9_]*)$'),
    'moves where the client reads and writes its own files',
    {
      veredito: 'reprova',
      quando: 'presente',
      contextos: ['claude'],
      livre: true,
      rotulo: 'inerte',
    },
    'i',
  ),
  registro(
    j(
      '^(',
      alternativas('LD_PRE+LOAD LD_AU+DIT DYLD_INSERT_LIB+RARIES BASH_+ENV ENV PERL5+OPT'),
      '|',
      alternativas(
        'RUBY+OPT JAVA_TOOL_OP+TIONS _JAVA_OP+TIONS GIT_SSH_COM+MAND GIT_EXTERNAL_+DIFF',
      ),
      '|',
      alternativas('PROMPT_COM+MAND ZDOT+DIR'),
      ')$',
    ),
    'loads code into programs started with this environment',
    { veredito: 'reprova', quando: 'presente', contextos: TODOS, livre: true },
    'i',
  ),
  registro(
    j('^NODE', '_OPTIONS$'),
    'loads code into every Node process started with this environment',
    { veredito: 'reprova', quando: 'precarga', contextos: TODOS, livre: true },
    'i',
  ),
  registro(
    j('^OTEL', '_EXPORTER', '_OTLP', '_([A-Z0-9_]+_)?(ENDPOINT|HEADERS)$'),
    'sends telemetry to an address or with headers chosen by the repository',
    { veredito: 'avisa', quando: 'presente', contextos: TODOS, livre: true },
    'i',
  ),
  registro(
    j(
      '^(',
      alternativas('PYTHON+PATH NODE_+PATH LD_LIBRARY_+PATH DYLD_LIBRARY_+PATH PYTHON+STARTUP'),
      ')$',
    ),
    'changes where programs started with this environment load code from',
    { veredito: 'avisa', quando: 'presente', contextos: TODOS, livre: true },
    'i',
  ),
  registro(
    j('^CODEX', '_HOME$'),
    'moves the agent home, and the configuration it trusts, into the repository',
    { veredito: 'reprova', quando: 'casaRelativa', contextos: ['dotenv'], livre: true },
    'i',
  ),
  registro(
    j('^CODEX', '_HOME$'),
    'moves the agent home to a fixed folder',
    { veredito: 'avisa', quando: 'casaAbsoluta', contextos: ['dotenv'], livre: true },
    'i',
  ),
]

// ═══════════════════════════════════════════════════════════════ the targets

const rota = (...partes) => new RegExp(partes.join(''), 'i')

/**
 * Which tracked paths are read, and how. Matched case-insensitively at any
 * depth: on Windows and macOS a tracked `.Claude/Settings.json` is the file the
 * client opens (measured with core.ignorecase=true), and clients load nested
 * skills and subfolder settings.
 *
 * `formato` 'json' is strict RFC 8259: the Claude docs say settings files are
 * strict JSON, and a comment makes the client skip the file. 'jsonc' is for the
 * editors whose parser is fault tolerant and still applies part of a broken file.
 */
const ALVOS = [
  [
    rota('(?:^|/)\\.', 'claude/', 'settings\\.json$'),
    { formato: 'json', visoes: [['claude', '']], claude: 'principal' },
  ],
  [
    rota('(?:^|/)\\.', 'claude/', 'settings\\.local\\.json$'),
    { formato: 'json', visoes: [['claude', '']], claude: 'local' },
  ],
  [
    rota('(?:^|/)\\.', 'claude/', 'launch\\.json$'),
    { formato: 'jsonc', visoes: [['claude-launch', '']], soAvisa: true },
  ],
  [
    rota('(?:^|/)\\.', 'vscode/', 'settings\\.json$'),
    { formato: 'jsonc', visoes: [['vscode', '']] },
  ],
  [rota('(?:^|/)\\.', 'vscode/', 'tasks\\.json$'), { formato: 'jsonc', visoes: [['tasks', '']] }],
  [
    rota('(?:^|/)\\.', 'vscode/', 'mcp\\.json$'),
    { formato: 'jsonc', visoes: [['mcp', '/servers']] },
  ],
  [
    rota('\\.code-', 'workspace$'),
    {
      formato: 'jsonc',
      // settings.mcp.servers is where VS Code reads the MCP servers of a
      // workspace file (mcpResourceScannerService.ts), so their keys are judged
      // like those of any other server map.
      visoes: [
        ['vscode', '/settings'],
        ['tasks', '/tasks'],
        ['mcp', '/settings/mcp/servers'],
      ],
      pastaDoArquivo: true,
    },
  ],
  [
    // One folder deeper is a config too: the containers.dev spec lists
    // `.devcontainer/<folder>/devcontainer.json` "where <folder> is a single level
    // deep subfolder", the form for several configurations in one repository.
    // Measured before: chat auto-approve in .devcontainer/py/devcontainer.json
    // was not applicable, and 7 of 51 MCP search hits used that form, which
    // mcp-server-launch reads too.
    rota(
      '(?:^|/)\\.',
      'devcontainer/(?:[^/]+/)?',
      'devcontainer\\.json$|(?:^|/)\\.',
      'devcontainer\\.json$',
    ),
    {
      formato: 'jsonc',
      // The Dev Containers extension writes customizations.vscode.settings into
      // the container's machine settings when it creates the container, so the
      // editor keys judged in .vscode/settings.json are judged there too.
      // Measured before: the chat auto-approve key failed in .vscode/settings.json
      // and in a workspace file and passed here. Tasks are not a customization,
      // so the task view stays out.
      visoes: [
        ['mcp', '/customizations/vscode/mcp/servers'],
        ['vscode', '/customizations/vscode/settings'],
        ['devcontainer', ''],
      ],
    },
  ],
  [rota('(?:^|/)\\.', 'cursor/', 'hooks\\.json$'), { formato: 'json', visoes: [['ganchos', '']] }],
  [rota('(?:^|/)\\.', 'cursor/', 'cli\\.json$'), { formato: 'json', visoes: [['cursor-cli', '']] }],
  [
    rota('(?:^|/)\\.', 'cursor/', 'mcp\\.json$|(?:^|/)\\.', 'mcp\\.json$'),
    { formato: 'json', visoes: [['mcp', '/mcpServers']] },
  ],
  [
    rota('(?:^|/)\\.', 'codex/', 'config\\.toml$'),
    {
      formato: 'toml',
      visoes: [
        ['codex', ''],
        ['mcp', '/mcp_servers'],
      ],
    },
  ],
  [
    rota(
      '(?:^|/)\\.',
      'codex/',
      'hooks\\.json$|(?:^|/)\\.',
      'windsurf/',
      'hooks\\.json$|(?:^|/)\\.',
      'github/',
      'hooks/[^/]+\\.json$',
    ),
    { formato: 'jsonc', visoes: [['ganchos', '']] },
  ],
  [
    rota('(?:^|/)\\.', 'gemini/', 'settings\\.json$'),
    {
      formato: 'jsonc',
      visoes: [
        ['gemini', ''],
        ['mcp', '/mcpServers'],
      ],
    },
  ],
  // Exact basename: `.env.example` and friends are the documented fix, not the
  // flaw (the same exclusion env-committed makes), and direnv's `.envrc` needs
  // an explicit `direnv allow` before it loads.
  [rota('(?:^|/)\\.', 'env$'), { formato: 'dotenv' }],
  [
    rota('(?:^|/)\\.', 'claude/', 'agents/.+\\.md$'),
    { formato: 'frontmatter', visoes: [['subagente', '']] },
  ],
  [
    rota(
      '(?:^|/)\\.',
      'claude/',
      'skills/.+/SKILL\\.md$|(?:^|/)\\.',
      'claude/',
      'commands/.+\\.md$',
    ),
    { formato: 'frontmatter', visoes: [['skill', '']], corpo: true },
  ],
]

export function alvoDeConfig(caminho) {
  for (const [padrao, alvo] of ALVOS) if (padrao.test(caminho)) return alvo
  return null
}

// ═══════════════════════════════════════════════════════════════ small helpers

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const temChave = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const decodificarSegmento = (s) => s.replace(/~1/g, '/').replace(/~0/g, '~')
const codificarSegmento = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1')
const segmentosDe = (ponteiro) =>
  ponteiro === '' ? [] : ponteiro.slice(1).split('/').map(decodificarSegmento)

/**
 * JSON with object keys sorted (UTF-16 order, what Array#sort gives), the input
 * of the allowlist hash: the same node hashes the same whatever order its keys
 * were written in, and any change to it reopens the finding.
 */
export function canonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`
  if (ehObjeto(valor)) {
    const chaves = Object.keys(valor).sort()
    return `{${chaves.map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(',')}}`
  }
  return valor === undefined ? 'null' : JSON.stringify(valor)
}

const sha256 = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex')

/** Every node under `valor`, root included, as [pointer, value]. Iterative: no stack to blow. */
function todosOsNos(valor, base) {
  const saida = []
  const pilha = [[base, valor]]
  while (pilha.length) {
    const [ponteiro, v] = pilha.pop()
    saida.push([ponteiro, v])
    if (Array.isArray(v)) {
      for (let k = v.length - 1; k >= 0; k--) pilha.push([`${ponteiro}/${k}`, v[k]])
    } else if (ehObjeto(v)) {
      const chaves = Object.keys(v)
      for (let k = chaves.length - 1; k >= 0; k--) {
        pilha.push([`${ponteiro}/${codificarSegmento(chaves[k])}`, v[chaves[k]]])
      }
    }
  }
  return saida
}

// ─────────────────────────────────────────────────────────── broad shell rules

/**
 * The interpreters and runners this rule knows. An interpreter is broad
 * when a wildcard can reach its own options (`-c`, `-e`) or replace the script
 * it runs; a runner is broad when the wildcard takes the place of what it runs.
 * `Bash(npm run *)` stays narrow: it runs the package scripts, which are
 * reviewed files, and the prototype kept it passing. `Bash(node test/x.js:*)`
 * stays narrow for the same reason: every argument after a fixed tracked script
 * goes to that script, and Claude Code's own "don't ask again" writes exactly
 * that shape (found in the resolve package's settings.local.json, in 6 local
 * node_modules trees).
 */
const INTERPRETADORES = new Set(
  j('sh bash zsh pwsh power', 'shell cmd node python python3 ruby perl deno').split(' '),
)
/**
 * Interpreters whose first argument, when it is not an option, is the script
 * they run. pwsh, powershell, cmd and deno stay out: their second slot holds
 * an option or a subcommand (`deno run`, `cmd /c`) that decides what runs.
 * comandoAmplo reads those two narrowly only in fixed shapes, for Claude and
 * Gemini: `deno fmt`, `deno check`, `deno doc`, `deno info` and `deno task
 * <name>`, and `pwsh -File <script>` after the switches that change no code.
 */
const COM_PROGRAMA_FIXO = new Set(j('sh bash zsh node py', 'thon py', 'thon3 ruby perl').split(' '))
const EXECUTORES = new Set(j('npx npm pnpm yarn bunx uvx cu', 'rl wget').split(' '))
const SUBCOMANDOS_QUE_EXECUTAM = new Set(['exec', 'x', 'dlx'])

/**
 * Options of each runner that take the next word as their value, so that word
 * is not what the runner runs (`uvx --from pkg *`, `npm --loglevel warn exec *`).
 * An option missing here makes a rule read as narrower than it is, never broader.
 */
const OPCOES_DE_EXECUTOR_COM_VALOR = (() => {
  const npm = ['--prefix', '--registry', '--cache', '--userconfig', '--workspace', '-w']
  const npmTodos = [...npm, '--loglevel', '-p', '--package', '-c', '--call']
  const curl = j(
    '-H -X -d -o -u -A -e -b -c -F -T -x -m -w --header --request --data ',
    '--output --user --user-agent --max-time --connect-timeout --retry --url',
  )
  const wget = j(
    '-O -P -U -e -t -T --header --output-document --directory-prefix ',
    '--user-agent --tries --timeout',
  )
  return Object.fromEntries(
    Object.entries({
      npx: npmTodos,
      npm: npmTodos,
      pnpm: [...npmTodos, '-C', '--dir', '-F', '--filter', '--reporter'],
      yarn: [...npmTodos, '--cwd'],
      bunx: ['-p', '--package'],
      uvx: j(
        '--from --with --with-editable --with-requirements -p --python --index ',
        '--default-index --index-url --extra-index-url -f --find-links --directory --project --cache-dir --config-file',
      ).split(' '),
      [j('cu', 'rl')]: curl.split(' '),
      wget: wget.split(' '),
    }).map(([nome, lista]) => [nome, new Set(lista)]),
  )
})()

/**
 * The switch that makes an interpreter run the text after it as code, or pick
 * the module it runs. Each one assembled, so no neighbour table reads a shell
 * command here. Matched case-insensitively for pwsh, powershell and cmd only.
 */
const SWITCHES_DE_CODIGO = (() => {
  const t = (...xs) => xs.map((x) => j('-', x))
  const shell = t('c')
  const ps = [...t('c', 'e', 'ec'), j('-', 'com', 'mand'), j('-', 'encoded', 'com', 'mand')]
  return {
    sh: shell,
    bash: shell,
    zsh: shell,
    pwsh: ps,
    powershell: ps,
    cmd: [j('/', 'c'), j('/', 'k')],
    node: [...t('e', 'p'), j('-', '-ev', 'al'), j('-', '-pr', 'int')],
    python: t('c', 'm'),
    python3: t('c', 'm'),
    ruby: t('e', 'r'),
    perl: t('e', 'E'),
    deno: [j('ev', 'al')],
  }
})()
const SEM_CAIXA = new Set(j('pwsh power', 'shell cmd').split(' '))

/**
 * An option that makes the program print its version or help and exit,
 * whatever follows. Measured on this machine with each option first and a
 * payload after it (a script name, an exec, -c, -e, -r of an inert file, an
 * output file): npm 11.6.2, pnpm 11.16.0, uvx 0.11.31, curl 8.21.0, node 24.13,
 * Python 3.12.10 and bash 5.3 printed and ran nothing, and the controls without
 * the option ran. `curl -v`, `uvx -v` and `bash -v` are verbose, not version,
 * so they are not here. yarn, bunx, wget, deno, pwsh, sh, zsh, ruby and perl
 * were not measured and keep the old reading. The option has to be the whole
 * first word: Claude's `:*` is ` *` at a word boundary, and Gemini matches
 * `command === rule || command.startsWith(rule + ' ')`, so `--versionX` cannot
 * ride the rule.
 */
const OPCOES_INFORMATIVAS = (() => {
  const npm = ['--version', '-v', '--help', '-h']
  const maiusculo = ['--version', '-V', '--help', '-h']
  return {
    npm,
    npx: npm,
    pnpm: npm,
    uvx: maiusculo,
    [j('cu', 'rl')]: maiusculo,
    node: npm,
    [j('pyt', 'hon')]: maiusculo,
    [j('pyt', 'hon3')]: maiusculo,
    [j('ba', 'sh')]: ['--version', '--help'],
  }
})()

/**
 * deno subcommands that run no user code: the formatter has only built-in
 * formatters, and check, doc and info read modules without executing them.
 * `deno lint` stays broad, because `lint.plugins` loads code from the config
 * and `--config` picks any file.
 */
const DENO_ESTREITOS = new Set(['fmt', 'check', 'doc', 'info'])

/**
 * The PowerShell switches that change nothing about what runs, which a scan
 * for `-File` may step over, and the ones that take one value. Anything else
 * ends the scan broad: PowerShell accepts any unambiguous prefix of a
 * parameter name, and measured with Windows PowerShell 5.1,
 * `-NoProfile -Comm -File t.ps1 ; Write-Output MARK` and `-co -File ...`
 * printed MARK (the prefix of -Command took the rest), while `-File t.ps1 ;
 * Write-Output MARK` handed everything after the script to the script, and so
 * did `-File t.ps1 -Command ...` and `-File t.ps1 -EncodedCommand x`.
 * Two switches are left out because they do change what runs, measured on
 * Windows PowerShell 5.1.26100 with a script that prints only SCRIPT:
 * `-NoExit -File t.ps1 < p.txt` (and `-noe`) printed SCRIPT and then ran the
 * command in p.txt at the prompt it left open, which the same line without
 * -NoExit did not; and `-SettingsFile x.json -File t.ps1 '; Write-Output MARK'`
 * printed MARK, because 5.1 has no -SettingsFile and read the whole line as
 * -Command. pwsh 7 was not installed, so -SettingsFile is not trusted there
 * either.
 */
const PS_SEM_VALOR = new Set(
  j('-noprofile -nop -nologo -nol -noninteractive -noni ', '-sta -mta').split(' '),
)
const PS_COM_VALOR = new Set(
  j(
    '-executionpolicy -ep -windowstyle -w -workingdirectory -wd ',
    '-inputformat -if -outputformat -of',
  ).split(' '),
)
const ARQUIVO_DO_PS = j('-fi', 'le')

/**
 * The narrow shapes of Claude and Gemini rules: true when the rule is narrow
 * for a reason the generic branches below cannot see, else null. Cursor keeps
 * the generic reading: its docs say the command base is the first token, with
 * an optional command:args syntax, and that matching was not measured.
 */
function estreitoConhecido(programa, palavras, s, prefixo) {
  const info = OPCOES_INFORMATIVAS[programa]
  if (info && palavras.length && info.includes(palavras[0])) return true
  if (programa === 'deno') {
    // An exact Claude rule approves that one command, whatever it is.
    if (!prefixo && !s.includes('*')) return true
    const [sub = '', nome = ''] = palavras
    if (DENO_ESTREITOS.has(sub)) return true
    // deno's parser (cli_parser defs.rs, TASK_SUBCOMMAND) gives the words after
    // the task name to the task (tests_full.rs, task_following_double_hyphen_arg:
    // `deno task build --test` hands the task argv ["--test"]); only an option
    // before the name, --eval among them, reaches deno.
    if (sub === 'task') return nome !== '' && !nome.startsWith('-') && !nome.includes('*')
    return false
  }
  if (programa === 'pwsh' || programa === j('power', 'shell')) {
    for (let k = 0; k < palavras.length; k++) {
      const w = palavras[k].toLowerCase()
      if (w.includes('*')) return false
      if (w === ARQUIVO_DO_PS) {
        const alvo = palavras[k + 1] || ''
        return alvo !== '' && !alvo.startsWith('-') && !alvo.includes('*')
      }
      if (PS_SEM_VALOR.has(w)) continue
      if (PS_COM_VALOR.has(w) && k + 1 < palavras.length && !palavras[k + 1].includes('*')) {
        k++
        continue
      }
      return false
    }
    return false
  }
  // `node --run <name>` runs a package.json script, like `npm run`, which
  // this rule already reads as narrow. Measured with node 24.13: `node --run
  // marca -e x` and `--require ./x` after the name ran only the script.
  if (programa === 'node' && (palavras[0] === '--run' || /^--run=[^*]+$/.test(palavras[0] || ''))) {
    return true
  }
  return false
}

const ehSwitchDeCodigo = (programa, token) => {
  const lista = SWITCHES_DE_CODIGO[programa] || []
  const t = SEM_CAIXA.has(programa) ? token.toLowerCase() : token
  return lista.some((s) => (SEM_CAIXA.has(programa) ? s.toLowerCase() : s) === t)
}

function programaDe(token) {
  const nome = String(token)
    .replace(/^["']|["']$/g, '')
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, '')
  return nome.replace(/^(python|ruby|perl|node)[0-9][0-9.]*$/, '$1')
}

/**
 * Whether the command part of a permission rule reaches any command.
 * `prefixo` is true for the dialects whose rule is a command PREFIX (Gemini
 * `run_shell_command(git)` allows every git command, Cursor `Shell(npm)` every
 * npm command); Claude's rule is the exact command unless it has a wildcard.
 */
function comandoAmplo(especificacao, prefixo, dialeto) {
  const s = especificacao.trim()
  if (s === '' || s === '*' || s === ':*' || s.startsWith('*')) return true
  const [primeiro] = s.split(/[\s:]+/)
  const programa = programaDe(primeiro)
  const resto = s.slice(primeiro.length).replace(/^[\s:]+/, '')
  if (dialeto === 'claude' || dialeto === 'gemini') {
    const palavrasDoResto = resto
      .replace(/:\*\s*$/, ' *')
      .split(/\s+/)
      .filter(Boolean)
    if (estreitoConhecido(programa, palavrasDoResto, s, prefixo)) return false
    if (programa === 'deno') return true
  }
  // Claude's `X:*` is the prefix X followed by anything, the same rule as
  // `X *`: `npm exec:*` has to read as the subcommand exec and a wildcard, or it
  // passed as narrow while `npm exec *` failed. Both branches below rewrite it.
  if (INTERPRETADORES.has(programa)) {
    if (prefixo) return true
    if (!s.includes('*')) return false
    if (!COM_PROGRAMA_FIXO.has(programa)) return true
    // `node x.js:*` is read as `node x.js *`: what counts is whether the
    // wildcard can reach the interpreter's options or replace its script.
    const [, arg1 = '', arg2 = ''] = s
      .replace(/:\*\s*$/, ' *')
      .trim()
      .split(/\s+/)
    if (arg1 === '' || arg1.includes('*')) return true
    if (arg1 === j('-', 'm') && programa.startsWith('python'))
      return arg2 === '' || arg2.includes('*')
    return arg1.startsWith('-')
  }
  if (EXECUTORES.has(programa)) {
    // Options first: `Bash(npx -y *)` approves what `Bash(npx *)` approves, and
    // in a prefix dialect `run_shell_command(npx -y)` approves every `npx -y`
    // command. Measured before: both passed as narrow, and so did the same
    // shape for curl and for `npm exec`. An option whose word holds the wildcard
    // reaches anything after it.
    const palavras = resto
      .replace(/:\*\s*$/, ' *')
      .split(/\s+/)
      .filter(Boolean)
    const comValor = OPCOES_DE_EXECUTOR_COM_VALOR[programa] || new Set()
    let k = 0
    const pularOpcoes = () => {
      while (k < palavras.length && palavras[k].startsWith('-')) {
        const opcao = palavras[k]
        if (opcao.includes('*')) return true
        k++
        if (!opcao.includes('=') && comValor.has(opcao) && k < palavras.length) {
          if (palavras[k].includes('*')) return true
          k++
        }
      }
      return false
    }
    const amplo = () =>
      (k < palavras.length && palavras[k].startsWith('*')) || (prefixo && k >= palavras.length)
    if (pularOpcoes() || amplo()) return true
    if (k < palavras.length && SUBCOMANDOS_QUE_EXECUTAM.has(palavras[k].toLowerCase())) {
      k++
      if (pularOpcoes() || amplo()) return true
    }
  }
  return false
}

const DIALETOS = {
  claude: { ferramenta: j('^\\s*(Ba', 'sh|Power', 'Shell)'), prefixo: false },
  gemini: { ferramenta: j('^\\s*(run', '_shell', '_command|Shell', 'Tool)'), prefixo: true },
  cursor: { ferramenta: j('^\\s*(She', 'll)'), prefixo: true },
}

export function ehRegraAmpla(dialeto, regra) {
  const d = DIALETOS[dialeto]
  if (!d || typeof regra !== 'string') return false
  const m = new RegExp(`${d.ferramenta}\\s*(?:\\(([\\s\\S]*)\\))?\\s*$`).exec(regra)
  if (!m) return false
  if (m[2] === undefined) return true
  return comandoAmplo(m[2], d.prefixo, dialeto)
}

/** `Tool(spec)` tokens of a skill `allowed-tools`: a space- or comma-separated string, or a list. */
function ferramentasDe(valor) {
  const itens = Array.isArray(valor) ? valor : [valor]
  const tokens = []
  for (const item of itens) {
    if (typeof item !== 'string') continue
    for (const m of item.matchAll(/[A-Za-z_][\w-]*(?:\([^)]*\))?/g)) tokens.push(m[0])
  }
  return tokens
}

const temConcessaoDeShell = (tokens) =>
  tokens.some((t) => new RegExp(`${DIALETOS.claude.ferramenta}(\\(|$)`).test(t))

/** The regular-expression bodies that match every command line. */
const CORINGAS = new Set([
  '',
  '.*',
  '.+',
  '.',
  '.*?',
  '.+?',
  '(.*)',
  '(.+)',
  '(?:.*)',
  '(?:.+)',
  '[\\s\\S]*',
  '[\\s\\S]+',
  '[\\S\\s]*',
  '[\\S\\s]+',
  '[^]*',
  '[^]+',
  '\\S*',
  '\\S+',
  '(\\s.*)?',
  '( .*)?',
  '(?:\\s.*)?',
])

/**
 * A `chat.tools.terminal.autoApprove` key that approves any command: a regex
 * whose body is a catch-all, or that starts with an interpreter or runner and
 * lets anything follow; or a plain prefix that is just an interpreter or runner.
 * A plain key approves every command line that starts with it, so an
 * interpreter plus its inline-code switch (`node -e`, `bash -c`) is broad too,
 * as `Bash(node -e:*)` is in the Claude dialect; so is a regex that reaches
 * that switch and has no end anchor.
 */
function padraoDeTerminalAmplo(padrao) {
  const regex = /^\/([\s\S]*)\/([a-z]*)$/.exec(padrao)
  if (regex) return regexTextualAmpla(regex[1]) || regexCasaSondaAmpla(regex[1], regex[2])
  const partes = padrao.trim().split(/\s+/)
  if (partes[0] === '') return true
  const programa = programaDe(partes[0])
  if (partes.length === 1) return INTERPRETADORES.has(programa) || EXECUTORES.has(programa)
  if (!INTERPRETADORES.has(programa)) return false
  // Options may come before the switch (`pwsh -NoProfile -Command`); the
  // switch must end the key, or the key already names the code it runs.
  for (let k = 1; k < partes.length; k++) {
    if (ehSwitchDeCodigo(programa, partes[k])) return k === partes.length - 1
    if (!/^[-/]/.test(partes[k])) return false
  }
  return false
}

/**
 * The regex body read as TEXT: a catch-all spelling, or an interpreter or runner
 * word or group first with nothing after it that pins the command down.
 */
function regexTextualAmpla(fonte) {
  const ancoradoNoFim = /(?<!\\)\$$/.test(fonte)
  let corpo = fonte.replace(/^\^/, '').replace(/(?<!\\)\$$/, '')
  if (CORINGAS.has(corpo)) return true
  const grupo = /^\((?:\?:)?([A-Za-z0-9_.|-]+)\)/.exec(corpo)
  const palavra = /^([A-Za-z0-9_.-]+)/.exec(corpo)
  const nomes = grupo ? grupo[1].split('|') : palavra ? [palavra[1]] : []
  if (!nomes.some((n) => INTERPRETADORES.has(programaDe(n)) || EXECUTORES.has(programaDe(n)))) {
    return false
  }
  const semEspaco = (x) => {
    for (let antes = null; antes !== x;) {
      antes = x
      x = x.replace(/^(?:\\b|\\s\+|\\s\*|\\s| \+| )/, '')
    }
    return x
  }
  corpo = semEspaco(corpo.slice((grupo || palavra)[0].length))
  if (CORINGAS.has(corpo)) return true
  // `/^bash -c/`: the switch, spelled plainly or with its dash or slash
  // escaped, then nothing that pins the code down.
  const programas = nomes.map(programaDe).filter((p) => INTERPRETADORES.has(p))
  const cabeca = /^(\\?[-/][A-Za-z-]+|[A-Za-z]+)(?=$|\\s|\\b| )/.exec(corpo)
  if (!cabeca) return false
  const token = cabeca[1].replace(/^\\/, '')
  if (!programas.some((p) => ehSwitchDeCodigo(p, token))) return false
  const depois = semEspaco(corpo.slice(cabeca[0].length))
  return !ancoradoNoFim || (depois !== '' && CORINGAS.has(depois))
}

/**
 * Short command lines, each 12 code points or fewer, that a narrow approval
 * never needs to match: two unrelated lines, and an interpreter with its
 * inline-code switch or a runner. Assembled, like every command word here.
 */
const SONDAS_SEM_RELACAO = ['x', j('zz9', ' q')]
const SONDAS_DE_EXECUCAO = [
  j('no', 'de -', 'e x'),
  j('ba', 'sh -', 'c x'),
  j('s', 'h -', 'c x'),
  j('pyt', 'hon -', 'c x'),
  j('pw', 'sh -', 'c x'),
  j('np', 'x y'),
  j('cu', 'rl y'),
]
const TEMPO_DA_SONDA_MS = 200

/**
 * The regex as VS Code applies it, tried on the probes. The textual reading
 * knows only the spellings it lists: measured, a one-letter class, a
 * non-capturing group inside the name and an empty group all approved the
 * inline-code line and still passed as narrow. The regex is attacker input, so
 * it runs in a separate context with a time limit (a vm timeout interrupts a
 * backtracking regex: measured, 67 ms for a nested quantifier that would run
 * for minutes), and on probes of 12 code points at most. A body or flag set
 * that does not compile approves nothing; one that runs out of time is judged
 * broad, because a key built to stall the checker deserves the look.
 */
function regexCasaSondaAmpla(fonte, flags) {
  const contexto = createContext({
    fonte,
    flags: flags.replace(/[gy]/g, ''),
    sondas: [...SONDAS_SEM_RELACAO, ...SONDAS_DE_EXECUCAO],
  })
  let casou
  try {
    casou = runInContext(
      'let re = null; try { re = new RegExp(fonte, flags) } catch {}; re && sondas.map((s) => re.test(s))',
      contexto,
      { timeout: TEMPO_DA_SONDA_MS },
    )
  } catch (e) {
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return true
    throw e
  }
  if (!Array.isArray(casou)) return false
  const semRelacao = casou.slice(0, SONDAS_SEM_RELACAO.length)
  return semRelacao.every(Boolean) || casou.slice(SONDAS_SEM_RELACAO.length).some(Boolean)
}

const aprova = (v) => v === true || (ehObjeto(v) && v.approve === true)
const aprovaUrl = (v) =>
  v === true || (ehObjeto(v) && (v.approveRequest === true || v.approveResponse === true))
const URLS_CORINGA = new Set([
  '*',
  '**',
  'http://*',
  'https://*',
  'http://*/*',
  'https://*/*',
  '*://*',
  '*://*/*',
])

/** Node options that load code into the process, or open it to a debugger. */
const PRECARGA = new Set([
  j('-', 'r'),
  j('--re', 'quire'),
  j('--im', 'port'),
  j('--lo', 'ader'),
  j('--experimental-lo', 'ader'),
  j('--ins', 'pect'),
  j('--ins', 'pect-brk'),
  j('--ins', 'pect-port'),
  j('--ins', 'pect-wait'),
])

/**
 * NODE_OPTIONS split the way Node splits it (ParseNodeOptionsEnvVar): a space
 * outside double quotes ends a token, a double quote toggles quoting and is
 * dropped, and inside quotes a backslash takes the next character literally.
 * A text match is not enough: measured on Node 24.13, a double-quoted flag and
 * a flag with a quoted half both preload, and neither matched the old regex.
 */
function opcoesDoNode(valor) {
  const tokens = []
  let atual = ''
  let aberto = false
  let aspas = false
  for (let k = 0; k < valor.length; k++) {
    let c = valor[k]
    if (c === '\\' && aspas) {
      k++
      if (k >= valor.length) break
      c = valor[k]
    } else if (c === ' ' && !aspas) {
      if (aberto) tokens.push(atual)
      atual = ''
      aberto = false
      continue
    } else if (c === '"') {
      aspas = !aspas
      aberto = true
      continue
    }
    atual += c
    aberto = true
  }
  if (aberto) tokens.push(atual)
  return tokens
}

/**
 * Whether one of the tokens is a preload option. Node accepts `_` for `-`
 * between the words of an option name (measured: the underscore spelling of
 * the loader option was honored), so the name is compared with that folded.
 */
const precarrega = (valor) =>
  opcoesDoNode(valor).some((token) => {
    const nome = token.split('=')[0]
    const dobrado = nome.startsWith('--') ? `--${nome.slice(2).replace(/_/g, '-')}` : nome
    return PRECARGA.has(dobrado)
  })

/** A `.env` agent home inside the checkout: relative, or built from the current directory. */
function casaRelativa(v) {
  if (typeof v !== 'string' || v.trim() === '') return false
  const s = v.trim()
  // The shell's working-directory variable, with its first letter as a
  // one-letter class. Spelled whole, the three letters are also the password
  // abbreviation password-without-kdf looks for, and this file hashes with
  // sha256 (the allowlist fingerprint), so rebar's own security-self failed on
  // it once the file was committed (measured in a scratch clone). Same match.
  if (/\$\{?[P]WD\}?/.test(s)) return true
  return !/^(?:~|\/|\\|[A-Za-z]:[\\/]|\$\{?HOME\}?)/.test(s)
}

/**
 * A key whose value names a program, resolved the way the editor does: relative
 * to the workspace folder (the parent of `.vscode`, or the folder of the
 * workspace file), `${workspaceFolder}/` and `./` removed. It is a finding only
 * when that lands on a tracked path, because 18,368 public settings files point
 * `python.defaultInterpreterPath` at an untracked virtualenv (measured in
 * phase 1).
 */
function caminhoRastreado(v, ctx) {
  if (typeof v !== 'string') return false
  let s = v.trim().replace(/\\/g, '/')
  s = s.replace(/^\$\{workspace(?:Folder|Root)\}\//, '')
  if (/^(?:\/|[A-Za-z]:\/|~|\$)/.test(s)) return false
  s = s.replace(/^(?:\.\/)+/, '')
  if (s === '' || s === '.') return false
  const base = ctx.alvo.pastaDoArquivo
    ? posix.dirname(ctx.entrada.caminho)
    : posix.dirname(posix.dirname(ctx.entrada.caminho))
  const p = posix.normalize(base === '.' ? s : `${base}/${s}`).replace(/\/+$/, '')
  if (p === '' || p === '.' || p === '..' || p.startsWith('../')) return false
  return ctx.rastreados.has(p.toLowerCase())
}

const CONDICOES = {
  presente: (v) => v !== undefined,
  texto: (v) => typeof v === 'string' && v.trim() !== '',
  verdadeiro: (v) => v === true,
  falso: (v) => v === false,
  objeto: (v) => ehObjeto(v),
  naoVazio: (v) => (Array.isArray(v) ? v.length > 0 : ehObjeto(v) && Object.keys(v).length > 0),
  // A command as Dev Containers take it: a string, an argv array, or an object
  // of named commands run in parallel.
  comando: (v) => (typeof v === 'string' ? v.trim() !== '' : CONDICOES.naoVazio(v)),
  gancho: (v) => ehObjeto(v) && !Array.isArray(v.hooks),
  regraClaudeAmpla: (v) => ehRegraAmpla('claude', v),
  regraGeminiAmpla: (v) => ehRegraAmpla('gemini', v),
  regraCursorAmpla: (v) => ehRegraAmpla('cursor', v),
  ferramentas: (v) => ferramentasDe(v).length > 0,
  ferramentasAmplas: (v) => ferramentasDe(v).some((t) => ehRegraAmpla('claude', t)),
  comandoComShell: (v, ctx) => typeof v === 'string' && ctx.temShell,
  terminalAmplo: (v, ctx) => aprova(v) && padraoDeTerminalAmplo(ctx.ultimaChave),
  terminalAprova: (v) => aprova(v),
  urlCuringa: (v, ctx) => aprovaUrl(v) && URLS_CORINGA.has(ctx.ultimaChave.trim()),
  urlAprova: (v) => aprovaUrl(v),
  caminhoRastreado,
  precarga: (v) => typeof v === 'string' && precarrega(v),
  casaRelativa,
  casaAbsoluta: (v) => typeof v === 'string' && v.trim() !== '' && !casaRelativa(v),
}

function vale(quando, valor, ctx) {
  if (ehObjeto(quando)) return typeof valor === 'string' && quando.um.includes(valor)
  const condicao = CONDICOES[quando]
  if (!condicao) throw new Error(`${ID}: a table row names an unknown condition "${quando}"`)
  return condicao(valor, ctx)
}

/** The row that decides a value, reprova first; null when none holds. */
function decidir(tabela, alvoDoTeste, valor, ctx, contexto) {
  let escolhida = null
  for (const [padrao, explicacao, uso] of tabela) {
    if (contexto && !(uso.contextos || []).includes(contexto)) continue
    padrao.lastIndex = 0
    if (!padrao.test(alvoDoTeste) || !vale(uso.quando, valor, ctx)) continue
    if (!escolhida || (uso.veredito === 'reprova' && escolhida.uso.veredito !== 'reprova')) {
      escolhida = { explicacao, uso }
    }
  }
  return escolhida
}

// ───────────────────────────────────────────────────────────────── readers

/**
 * The lines a dotenv loader reads, one layer of quotes removed. Gemini CLI loads
 * `.gemini/.env` with the dotenv npm parser, whose LINE grammar (17.4.2) takes
 * `NAME=value` and also `NAME: value`, names with dots and dashes, and values
 * quoted with a double quote, a single quote or a backtick, which may run over
 * several lines. Measured: with only `=` and two quote marks, `LD_PRELOAD: ./x.so`
 * and a backtick-quoted NODE_OPTIONS preload both passed, and dotenv.parse
 * returned both variables.
 *
 * Two readings, united. The first is dotenv's own grammar over the whole text:
 * it turns CRLF and a lone CR into LF, and its `\s` around the name and the
 * separator takes any Unicode space and a line break. Measured with dotenv
 * 17.4.2: a no-break or ideographic space before the name or before `=`, a lone
 * CR between two assignments, and `NAME:` followed by a line break all loaded
 * the variable, and the line reader below saw none of them. The second is that
 * line reader, kept for loaders that read one line at a time and would take a
 * line dotenv folds into the value before it.
 */
function lerDotenv(texto) {
  const itens = lerDotenvComoDotenv(texto)
  const vistos = new Set(itens.map((i) => `${i.nome}\0${i.valor}`))
  for (const item of lerDotenvPorLinha(texto)) {
    const chave = `${item.nome}\0${item.valor}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    itens.push(item)
  }
  return itens
}

/**
 * dotenv's LINE regex (lib/main.js, 17.4.2) without its leading `^\s*`, run
 * sticky from the first non-space of each line. Run whole with the `mg` flags,
 * that leading `\s*` is tried from every line start over every blank after it,
 * which is quadratic on a file of blank lines; starting past the blanks is the
 * same match, because `\s` includes every line break. The name is matched
 * atomically (a lookahead and its backreference) for the same reason: no
 * character of a name can be a space, `=` or `:`, so giving one back never
 * helps, and a long name before many blank lines would retry every length.
 */
const LINHA_DO_DOTENV =
  /((?:export\s+)?)(?=([\w.-]+))\2(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$/my

/** Where the `m` flag starts a line: after LF, U+2028 and U+2029. */
const INICIO_DE_LINHA = /[\n\u2028\u2029]/g

function lerDotenvComoDotenv(original) {
  const texto = original.replace(/\r\n?/g, '\n')
  const itens = []
  let consumidoAte = 0
  let linha = 1
  let inicioDaLinha = 0 // offset after the last LF, for the column
  let contadoAte = 0
  for (let inicio = 0; ;) {
    INICIO_DE_LINHA.lastIndex = inicio
    const quebra = INICIO_DE_LINHA.exec(texto)
    const fim = quebra ? quebra.index : texto.length
    let primeiro = inicio
    while (primeiro < fim && /\s/.test(texto[primeiro])) primeiro++
    if (inicio >= consumidoAte && primeiro < fim) {
      LINHA_DO_DOTENV.lastIndex = primeiro
      const m = LINHA_DO_DOTENV.exec(texto)
      if (m) {
        const nomeEm = primeiro + m[1].length
        for (; contadoAte < nomeEm; contadoAte++) {
          if (texto[contadoAte] === '\n') {
            linha++
            inicioDaLinha = contadoAte + 1
          }
        }
        const coluna = [...texto.slice(inicioDaLinha, nomeEm)].length + 1
        // dotenv's own value handling: trim, one layer of matching quotes, and
        // the two escapes a double-quoted value expands.
        let valor = (m[3] || '').trim()
        const aspa = valor[0]
        valor = valor.replace(/^(['"`])([\s\S]*)\1$/gm, '$2')
        if (aspa === '"') valor = valor.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
        itens.push({ nome: m[2], valor, linha, coluna })
        consumidoAte = primeiro + Math.max(m[0].length, 1)
      }
    }
    if (!quebra) break
    inicio = fim + 1
  }
  return itens
}

function lerDotenvPorLinha(texto) {
  const itens = []
  const linhas = texto.split('\n')
  for (let n = 0; n < linhas.length; n++) {
    const bruta = linhas[n].replace(/\r$/, '')
    const m = /^([ \t]*)(export[ \t]+)?([\w.-]+)(?:[ \t]*=[ \t]*|:[ \t]+)(.*)$/.exec(bruta)
    if (!m) continue
    let valor = m[4]
    const aspa = valor[0]
    const coluna = m[1].length + (m[2] || '').length + 1
    const linha = n + 1
    if (aspa === '"' || aspa === "'" || aspa === '`') {
      // The closing quote is the next one not escaped by a backslash, on this
      // line or a later one, as dotenv's `"(?:\\"|[^"])*"` finds it.
      const resto = [valor.slice(1), ...linhas.slice(n + 1)].join('\n')
      let fim = -1
      for (let k = 0; k < resto.length; k++) {
        if (resto[k] === '\\' && resto[k + 1] === aspa) k++
        else if (resto[k] === aspa) {
          fim = k
          break
        }
      }
      if (fim === -1) valor = valor.slice(1)
      else {
        valor = resto.slice(0, fim)
        n += (valor.match(/\n/g) || []).length
      }
    } else {
      valor = valor.replace(/[ \t]+#.*$/, '').trim()
    }
    itens.push({ nome: m[3], valor, linha, coluna })
  }
  return itens
}

/**
 * The commands a skill body runs before the model reads it: an inline
 * `!` + backtick span at a line start or after whitespace, and a fence opened
 * with three backticks and `!`. Documented in the Claude skills page, which
 * also says the inline form is ignored after any other character.
 */
function comandosDoCorpo(texto, fm) {
  const fimDoYaml = fm.indice + fm.yaml.length
  const quebra = texto.indexOf('\n', fimDoYaml)
  const inicio = quebra === -1 ? texto.length : quebra + 1
  const corpo = texto.slice(inicio)
  const crase = String.fromCodePoint(0x60)
  const achados = []
  const emLinha = new RegExp(`(^|[ \\t])!${crase}([^${crase}\\n]+)${crase}`, 'gm')
  for (const m of corpo.matchAll(emLinha)) {
    achados.push({ indice: inicio + m.index + m[1].length, comando: m[2] })
  }
  const cerca = new RegExp(
    `^ {0,3}${crase}{3}!.*\\n([\\s\\S]*?)(?:^ {0,3}${crase}{3}[ \\t]*$|(?![\\s\\S]))`,
    'gm',
  )
  for (const m of corpo.matchAll(cerca)) achados.push({ indice: inicio + m.index, comando: m[1] })
  return achados.sort((a, b) => a.indice - b.indice)
}

/** The reading problems of a `.env`, which is 'dados' and gets none from the reader. */
function problemasDoDotenv(entrada) {
  const problemas = []
  if (['lfs', 'ausente'].includes(entrada.estado)) problemas.push(entrada.estado)
  const a = entrada.atributos || {}
  if (a.filtro && a.filtro !== 'lfs') problemas.push('filtro')
  if (a.codificacaoDeDisco) problemas.push('working-tree-encoding')
  if (a.exportSubst) problemas.push('export-subst')
  return problemas
}

// ═══════════════════════════════════════════════════════════════ the engine

const ROTULOS = {
  confianca: ' (after trusting the folder)',
  inerte: ' (ignored by current clients, honored by older ones; removing it costs nothing)',
}

/**
 * Whether settings.local.json replaces what settings.json says at `ponteiro`.
 * The Claude docs: lists merge, scalars from the local file win. Walking down
 * the pointer, two objects keep merging, two arrays are united (so neither
 * item is overridden), and anything else defined locally replaces the shared
 * file's node there.
 */
function sobrescrito(ponteiro, compartilhado, local) {
  const segmentos = segmentosDe(ponteiro)
  let a = compartilhado
  let b = local
  for (let k = 0; ; k++) {
    if (b === undefined) return false
    if (ehObjeto(a) && ehObjeto(b)) {
      if (k === segmentos.length) return false
      const s = segmentos[k]
      a = temChave(a, s) ? a[s] : undefined
      b = temChave(b, s) ? b[s] : undefined
      continue
    }
    if (Array.isArray(a) && Array.isArray(b)) return false
    return true
  }
}

export function checarAgentConfig(r, tabelas = {}) {
  const { CHAVES_QUE_EXECUTAM: chaves, VARIAVEIS_PERIGOSAS: variaveis } = tabelas
  if (!Array.isArray(chaves) || !Array.isArray(variaveis)) {
    throw new Error(`${ID} needs the CHAVES_QUE_EXECUTAM and VARIAVEIS_PERIGOSAS tables`)
  }
  // Checked up front and not when a row first matches: a condition name with a
  // typo would otherwise sit silent until the one repository that has that key.
  for (const [padrao, , uso] of [...chaves, ...variaveis]) {
    const ok =
      uso &&
      (uso.veredito === 'reprova' || uso.veredito === 'avisa') &&
      (ehObjeto(uso.quando) ? Array.isArray(uso.quando.um) : temChave(CONDICOES, uso.quando))
    if (!ok) throw new Error(`${ID}: the table row ${padrao} has no valid verdict or condition`)
  }
  const indice = lerIndice(r.dir)
  const allowlist = lerAllowlist(r.dir)
  const alvos = indice.semGit
    ? []
    : indice.entradas.map((e) => [e, alvoDeConfig(e.caminho)]).filter(([, a]) => a)

  const rastreados = new Set()
  for (const caminho of indice.porCaminho.keys()) {
    const baixo = caminho.toLowerCase()
    rastreados.add(baixo)
    for (let k = baixo.indexOf('/'); k !== -1; k = baixo.indexOf('/', k + 1)) {
      rastreados.add(baixo.slice(0, k))
    }
  }

  const achados = []
  const vistos = new Set()
  const anotar = (a) => {
    const chave = [a.arquivo, a.ponteiro, a.explicacao, a.hash].join('\0')
    if (vistos.has(chave)) return
    vistos.add(chave)
    achados.push(a)
  }
  /** A finding about the file itself: never exemptable. */
  const estrutural = (entrada, veredito, lugar, ponteiro, explicacao) =>
    anotar({
      veredito,
      isentavel: false,
      arquivo: entrada.caminho,
      ponteiro,
      no: undefined,
      hash: '',
      linha: lugar.linha,
      coluna: lugar.coluna,
      explicacao,
    })

  const fatos = []
  const pares = new Map() // Claude settings folder -> { principal, local } parsed values

  for (const [entrada, alvo] of alvos) {
    const severo = alvo.soAvisa ? 'avisa' : 'reprova'
    const inicio = { linha: 1, coluna: 1 }
    // A `.env` is not an agent file, so problemasDeLeitura says nothing about
    // it; but an LFS pointer or a missing blob is a `.env` whose real content
    // (what a smudged checkout loads) this rule never sees, and so is one that
    // checkout rewrites: a filter other than LFS (whose smudge passes a
    // non-pointer blob through as it is, so estado 'lfs' already covers it),
    // working-tree-encoding, which turned CJK text in the index into the ASCII
    // `CODEX_HOME=./.cx` on disk (measured), and export-subst.
    const problemas =
      alvo.formato === 'dotenv' ? problemasDoDotenv(entrada) : problemasDeLeitura(entrada, indice)
    // No text and no named problem is still a file the client may read and this
    // rule cannot: a link to a folder, or a `.env` behind a link that leaves the
    // repository. Skipping it in silence is the hole this reader exists to close.
    if (entrada.texto === null && !problemas.length) {
      problemas.push(
        entrada.symlink
          ? entrada.symlink.externo
            ? 'symlink-externo'
            : 'symlink'
          : entrada.estado,
      )
    }
    if (problemas.length) {
      estrutural(
        entrada,
        severo,
        inicio,
        null,
        `cannot be read the way the client reads it (${problemas.join(', ')})`,
      )
    }
    if (entrada.texto === null) continue

    if (alvo.formato === 'dotenv') {
      // The index text, and the text checkout writes when working-tree-encoding
      // re-encodes it: the loader reads the disk.
      for (const texto of [entrada.texto, ...textosNoDisco(entrada)]) {
        for (const item of lerDotenv(texto)) {
          fatos.push({
            entrada,
            alvo,
            familia: 'dotenv',
            nomeDaVariavel: item.nome,
            ponteiro: `/${codificarSegmento(item.nome)}`,
            valor: item.valor,
            lugar: { linha: item.linha, coluna: item.coluna },
          })
        }
      }
      continue
    }

    if (alvo.formato === 'frontmatter') {
      const fm = lerFrontmatter(entrada.texto)
      if (!fm.presente) continue
      if (fm.erro) {
        // The client does not run hooks from frontmatter it cannot parse, so
        // this is a look, not a failure.
        estrutural(
          entrada,
          'avisa',
          fm.erro,
          null,
          'frontmatter that cannot be parsed, which a client may read differently',
        )
        continue
      }
      // A repeated key parses in a lenient loader, which keeps the last copy,
      // and fails in a strict one: the order of the keys decides what is
      // granted, so it fails here as it does in JSON and TOML, never exempt.
      for (const d of fm.duplicatas) {
        estrutural(
          entrada,
          severo,
          d.ocorrencias[1],
          d.ponteiro,
          `a key defined ${d.ocorrencias.length} times, and clients disagree on which one wins`,
        )
      }
      const [familia] = alvo.visoes[0]
      const posicoes = fm.posicoes
      // Every copy a later duplicate hides is judged too, like in JSON.
      const arvores = [{ valor: fm.valor, base: '', sombra: null }]
      for (const d of fm.duplicatas) {
        for (const o of d.ocorrencias.slice(0, -1)) {
          arvores.push({
            valor: o.valor,
            base: d.ponteiro,
            sombra: { linha: o.linha, coluna: o.coluna },
          })
        }
      }
      for (const arvore of arvores) {
        for (const [ponteiro, valor] of todosOsNos(arvore.valor, arvore.base)) {
          if (ponteiro === '') continue
          fatos.push({
            entrada,
            alvo,
            familia,
            logico: ponteiro,
            ponteiro,
            valor,
            posicoes,
            lugar: arvore.sombra,
            sombra: Boolean(arvore.sombra),
          })
        }
      }
      if (alvo.corpo && ehObjeto(fm.valor)) {
        const ferramentas = j('allowed', '-tools')
        const concessoes = [
          fm.valor[ferramentas],
          ...fm.duplicatas
            .filter((d) => d.ponteiro === `/${ferramentas}`)
            .flatMap((d) => d.ocorrencias.map((o) => o.valor)),
        ]
        const temShell = temConcessaoDeShell(concessoes.flatMap(ferramentasDe))
        comandosDoCorpo(entrada.texto, fm).forEach((c, k) => {
          fatos.push({
            entrada,
            alvo,
            familia,
            logico: `/!/${k}`,
            ponteiro: `/!/${k}`,
            valor: c.comando,
            lugar: posicao(entrada.texto, c.indice),
            temShell,
          })
        })
      }
      continue
    }

    const analise =
      alvo.formato === 'toml'
        ? lerToml(entrada.texto)
        : lerJsonc(entrada.texto, { estrito: alvo.formato === 'json' })
    if (analise.erro) {
      estrutural(
        entrada,
        severo,
        analise.erro,
        null,
        'cannot be parsed, and a tolerant client may still apply part of it',
      )
    }
    for (const d of analise.duplicatas) {
      const segunda = d.ocorrencias[1]
      estrutural(
        entrada,
        severo,
        segunda,
        d.ponteiro,
        `a key defined ${d.ocorrencias.length} times, and clients disagree on which one wins`,
      )
    }
    if (analise.erro) continue

    // The last definition of every key is in `valor`; the ones a duplicate
    // hides are judged too, because a client that keeps the first one runs them.
    const arvores = [{ valor: analise.valor, base: '', sombra: null }]
    for (const d of analise.duplicatas) {
      for (const o of d.ocorrencias.slice(0, -1)) {
        arvores.push({
          valor: o.valor,
          base: d.ponteiro,
          sombra: { linha: o.linha, coluna: o.coluna },
        })
      }
    }
    for (const [familia, raiz] of alvo.visoes) {
      for (const arvore of arvores) {
        for (const [ponteiro, valor] of todosOsNos(arvore.valor, arvore.base)) {
          if (ponteiro !== raiz && !ponteiro.startsWith(`${raiz}/`)) continue
          fatos.push({
            entrada,
            alvo,
            familia,
            logico: ponteiro.slice(raiz.length),
            ponteiro,
            valor,
            posicoes: analise.posicoes,
            lugar: arvore.sombra,
            sombra: Boolean(arvore.sombra),
          })
        }
      }
    }
    if (alvo.claude) {
      // The exact folder spelling: `.Claude/settings.local.json` overrides
      // `.claude/settings.json` only where the file system ignores case, and on
      // Linux the client never opens it, so the shared value stays live there.
      const pasta = posix.dirname(entrada.caminho)
      const par = pares.get(pasta) || {}
      par[alvo.claude] = analise.valor
      par[`${alvo.claude}Entrada`] = entrada
      pares.set(pasta, par)
      if (alvo.claude === 'local') {
        fatos.push({
          entrada,
          alvo,
          familia: 'claude-local',
          logico: '',
          ponteiro: '',
          valor: analise.valor,
          posicoes: analise.posicoes,
        })
      }
    }
  }

  // A shared file and a local file whose folders differ only by case: each is
  // judged alone, and the pair is named so a person can see why.
  const porCaixa = new Map()
  for (const [pasta, par] of pares) {
    const chave = pasta.toLowerCase()
    if (!porCaixa.has(chave)) porCaixa.set(chave, [])
    porCaixa.get(chave).push([pasta, par])
  }
  for (const grupo of porCaixa.values()) {
    for (const [pastaLocal, parLocal] of grupo) {
      if (!parLocal.localEntrada) continue
      for (const [pastaPrincipal, parPrincipal] of grupo) {
        if (pastaPrincipal === pastaLocal || !parPrincipal.principalEntrada) continue
        estrutural(
          parLocal.localEntrada,
          'avisa',
          { linha: 1, coluna: 1 },
          null,
          `overrides ${escaparSaida(parPrincipal.principalEntrada.caminho, { limite: 80 })} only ` +
            'where the file system ignores case, so that file is judged as if nothing overrode it',
        )
      }
    }
  }

  for (const fato of fatos) {
    const { entrada, alvo, familia } = fato
    if (alvo.claude === 'principal' && familia === 'claude') {
      const par = pares.get(posix.dirname(entrada.caminho))
      if (par && par.local !== undefined && sobrescrito(fato.logico, par.principal, par.local)) {
        continue
      }
    }
    const segmentos = segmentosDe(fato.logico || '')
    const ctx = {
      entrada,
      alvo,
      rastreados,
      temShell: fato.temShell,
      ultimaChave: segmentos.length ? segmentos[segmentos.length - 1] : '',
    }
    let decisao = null
    if (familia === 'dotenv') {
      decisao = decidir(variaveis, fato.nomeDaVariavel, fato.valor, ctx, 'dotenv')
    } else {
      decisao = decidir(chaves, `${familia}:${fato.logico}`, fato.valor, ctx)
      const ehEnv =
        (familia === 'claude' && segmentos.length === 2 && segmentos[0] === 'env') ||
        (familia === 'mcp' && segmentos.length === 3 && segmentos[1] === 'env')
      if (!decisao && ehEnv) {
        decisao = decidir(variaveis, segmentos[segmentos.length - 1], fato.valor, ctx, familia)
      }
    }
    if (!decisao) continue
    const lugar = fato.lugar ||
      fato.posicoes?.get(fato.ponteiro) ||
      fato.posicoes?.get('') || { linha: 1, coluna: 1 }
    anotar({
      veredito: decisao.uso.veredito,
      isentavel: true,
      arquivo: entrada.caminho,
      ponteiro: fato.ponteiro,
      no: fato.valor,
      hash: sha256(canonico(fato.valor)),
      linha: lugar.linha,
      coluna: lugar.coluna,
      explicacao: decisao.explicacao,
      uso: decisao.uso,
      sombra: fato.sombra,
    })
  }

  // ── the allowlist: `{arquivo, ponteiro, sha256}`, exact, and never for a file defect
  const allowlistValida = allowlist.erros.length === 0
  let liberadas = 0
  const valem = achados.filter((a) => {
    if (!allowlistValida || !a.isentavel) return true
    const chave = { arquivo: a.arquivo, ponteiro: a.ponteiro, sha256: a.hash }
    if (!allowlist.aceita(ID, chave)) return true
    liberadas++
    return false
  })

  const formatar = (a) => {
    let s = onde(a.arquivo, a.linha, a.coluna)
    if (a.ponteiro !== null)
      s += ` ${escaparSaida(a.ponteiro === '' ? '/' : a.ponteiro, { limite: 40 })}`
    s += ` ${a.explicacao}`
    const uso = a.uso || {}
    if (uso.contar) {
      const n = Array.isArray(a.no) ? a.no.length : ehObjeto(a.no) ? Object.keys(a.no).length : 0
      s += ` (${n} name(s))`
    }
    if (uso.lancamento) {
      const nome = ehObjeto(a.no) && typeof a.no.name === 'string' ? a.no.name : ''
      s += ` (named ${escaparSaida(nome || '?', { limite: 40 })}, ${impressao(canonico(a.no))})`
    } else if (uso.livre) {
      s += ` ${impressao(typeof a.no === 'string' ? a.no : canonico(a.no))}`
    }
    if (a.sombra) s += ' (in a definition a later duplicate hides)'
    if (uso.rotulo) s += ROTULOS[uso.rotulo]
    return s
  }
  // What --sugerir-allowlist prints: the exact key aceita() compares, for a
  // finding the allowlist can release. A null pointer (a file-level finding)
  // is no key any entry can carry.
  for (const a of valem) {
    if (a.veredito === 'reprova' && a.isentavel && typeof a.ponteiro === 'string') {
      sugerirEntrada(r, ID, { arquivo: a.arquivo, ponteiro: a.ponteiro, sha256: a.hash })
    }
  }
  const reprovas = valem.filter((a) => a.veredito === 'reprova').map(formatar)
  const avisos = valem.filter((a) => a.veredito === 'avisa').map(formatar)

  const notas = []
  if (liberadas) notas.push(`${liberadas} finding(s) released by ${NOME_DA_ALLOWLIST}`)
  if (allowlistValida) {
    const obsoletas = allowlist.obsoletas(ID)
    if (obsoletas) {
      notas.push(`${obsoletas} ${NOME_DA_ALLOWLIST} entry(ies) of this rule match nothing any more`)
    }
  }
  if (allowlist.naoRastreada && achados.length) {
    notas.push(`${NOME_DA_ALLOWLIST} is on disk but not tracked, so it releases nothing`)
  }
  // Only when an entry is actually in use, so the line is one
  // somebody can act on.
  if (allowlist.rastreada && liberadas && !allowlist.cobertaPorCodeowners) {
    notas.push(
      `no CODEOWNERS entry covers ${NOME_DA_ALLOWLIST}, so any pusher can release a finding`,
    )
  }

  if (!allowlistValida || reprovas.length) {
    const partes = []
    if (!allowlistValida) {
      const erros = allowlist.erros.map(
        (e) => `${NOME_DA_ALLOWLIST}:${e.linha}:${e.coluna} ${escaparSaida(e.mensagem)}`,
      )
      partes.push(`the allowlist is malformed, so it releases nothing: ${resumir(erros, 3)}`)
    }
    if (reprovas.length) {
      partes.push(
        `${reprovas.length} agent config finding(s) that run a command, send traffic elsewhere ` +
          `or widen approval: ${resumir(reprovas)}`,
      )
    }
    let s = partes.join(' · ')
    if (avisos.length) s += ` (+${avisos.length} more to review)`
    if (notas.length) s += ` · ${notas.join(' · ')}`
    return s
  }
  if (!alvos.length) {
    return notas.length ? { nota: notas.join(' · ') } : na('no agent configuration file tracked')
  }
  if (avisos.length || notas.length) {
    const partes = []
    if (avisos.length)
      partes.push(`${avisos.length} agent config item(s) to review: ${resumir(avisos)}`)
    return { nota: [...partes, ...notas].join(' · ') }
  }
  return null
}
