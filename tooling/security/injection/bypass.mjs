// bypass — an agent CLI started with its approval switch turned off, from a
// place that runs it with nobody watching.
//
// WHY THIS IS A SIGNATURE. Two supply-chain incidents used exactly this shape.
// The Nx s1ngularity release (August 2025) shipped a postinstall that looked
// for installed agent CLIs and started each one with the flag that skips its
// permission prompts, handing it a prompt that searched the disk for wallets
// and keys (StepSecurity's write-up shows the map of binaries and flags). The
// Amazon Q Developer extension 1.84.0 (CVE-2025-8217) carried a line that
// started the Q chat CLI with every tool trusted and a prompt that wiped files and
// cloud resources. In both, the flag was the whole difference between an
// agent that asks and an agent that acts.
//
// WHAT DECIDES THE VERDICT IS WHERE THE LINE LIVES, not the flag alone. The
// same flags are legitimate where a person starts the CLI on purpose: 25 of 39
// sampled GitHub Agentic Workflows lock files carry them, inside a firewall
// container, and the Copilot CLI documents one of them as required for
// scripted use. So a flag fails only in a place that runs without a dialog:
// package lifecycle scripts and the files they start, git hooks, editor tasks
// that run on folder open, devcontainer lifecycle commands, agent hook
// commands, agent instruction and config files, and workflows that are not
// gh-aw lock files. Anywhere else it is a warning, and prose outside a fence
// in a Markdown file is nothing at all.
//
// WHY STRONG AND AMBIGUOUS. A few flags exist only in one vendor's CLI and
// accuse alone. Most are one letter or a generic word (yes, all, force)
// and mean nothing without the binary next to them: measured before this
// split, a minified gsap bundle and Next's detect-agent (which reads an env
// var named after a Copilot flag) were the only two hits in 59,926
// node_modules text files, and both were noise. So an ambiguous flag counts
// only with its binary in the same shell command, or within 3 lines in code,
// where the Nx map kept the binary and the flag in separate literals.
//
// WHY EVERY WORD IS ASSEMBLED. The tables are exported, indexed by the MCP
// artifact and checked by prove-table.mjs against this file, the READMEs and
// mcp/rules.generated.json, which no rule exempts. A flag or a binary name written out
// here would make this file its own finding, so every name and flag below is
// joined from pieces, and every binary letter becomes a one-letter class so the
// artifact's word index never holds a quoted binary name either.
//
// ─────────────────────────────────────────────────────────────── the API
//
/**
 * Every table row is [RegExp, explicacao, verificadoEm 'YYYY-MM-DD'].
 * `explicacao` starts with the CLI id and a colon ('<id>: what it turns off');
 * a row that only warns wherever it is found says '<id> (warning only): ...'.
 * The engine reads the id and the strength from that prefix, never the flag.
 *
 * FLAGS_FORTES        flags that accuse with no binary around them, plus the
 *                     Agent SDK option strings and the one warning-only flag.
 * FLAGS_AMBIGUAS      `<binary> ... <flag>` inside one command.
 * PARES_DE_FLAG       `<binary> ... <flag> <value>` inside one command.
 * BINARIOS_DE_AGENTE  a binary where code starts it: the value of a
 *                     cmd/command/bin key, the first argument of a spawn or exec
 *                     call, or a command word followed by a dash argument. Used
 *                     for the 3-line window in code.
 *
 * checarBypass(r, { FLAGS_FORTES, FLAGS_AMBIGUAS, PARES_DE_FLAG, BINARIOS_DE_AGENTE, ACOES_DE_AGENTE })
 *   -> string (reprova) | { nota } | null | { na: 'no tracked text file' }
 *   Reads the index of `r.dir` (lerIndice) and `.rebar-injection-allowlist`
 *   (`{arquivo, oid}` entries). A malformed allowlist reprova and exempts nothing.
 *   ACOES_DE_AGENTE is the vendor action table of workflow.mjs: the approval
 *   inputs of those actions in a workflow or action file are read as the
 *   command the action runs (see segmentosDeEntradas).
 *
 * achadosDoIndice(indice, tabelas)  (tabelas as for checarBypass)
 *   -> { achados: Achado[], lidos, ausentes, naoLidos }
 *   Achado = { caminho, oid, linha, coluna, id, texto, severidade: 'reprova'|'avisa', rotulo }
 *   `indice` needs `entradas` and `porCaminho` shaped like lerIndice's; the
 *   measurement over node_modules builds one from disk.
 *
 * varrerShell(texto, tabelas, { guarda = false, yaml = false, dialetos = 'texto' }) -> Bruto[]
 * varrerCodigo(texto, tabelas, { guarda = true, dialetos = 'texto' }) -> Bruto[]
 *   Bruto = { linha, coluna, id, texto, forca: 'forte'|'ambigua'|'fraca' }
 *   `guarda` skips ambiguous rows on lines over 1000 characters (minified code).
 *   Both read a line ended by an odd run of backslashes together with the next
 *   one, as the shell does; `yaml` also joins the lines a folded or multi-line
 *   YAML scalar folds into one value. `dialetos` names the quote model a
 *   shell reads the text with (DIALETOS: 'texto', 'posix', 'pwsh'), a list of
 *   them, or for varrerShell a function of the 0-based physical line; with
 *   more than one, a switch counts when any of them reads it as an argument.
 *
 * For ai-workflow-untrusted-input (workflow.mjs imports these; this file never
 * imports it):
 * comandosDoShell(texto, dialeto = 'posix') -> Array<{ linha, palavras: string[] }>
 * agenteDoComando(palavras) -> CLI id | null
 * ehLockDoGhAw(texto) -> boolean       the gh-aw header in the first 10 lines
 * acaoDoUses(uses, ACOES_DE_AGENTE) -> { explicacao, dados } | null
 * validarAcoesDeAgente(tabela) -> tabela, or throws
 */

import { posix } from 'node:path'

import { semComentarioNemImport } from '../../rebar-check/index.mjs'
import { escaparSaida } from '../texto-seguro.mjs'
import { lerJsonc, lerYaml } from './formats.mjs'
import { palavras as palavrasDeLancamento } from './mcp-launch.mjs'
import {
  NOME_DA_ALLOWLIST,
  lerAllowlist,
  sugerirEntrada,
  lerIndice,
  onde,
  posicao,
  resumir,
  textosNoDisco,
} from './reader.mjs'

const REGRA = 'agent-bypass-invocation'
const na = (motivo) => ({ na: motivo })

// ──────────────────────────────────────────────────────────────── vocabulary

const j = (...partes) => partes.join('')

/**
 * The date the vendor sources were read for this table (the
 * Claude Code CLI reference, gemini-cli config.ts, codex-rs shared_options.rs,
 * amazon-q chat mod.rs, the Copilot CLI and Cursor CLI references, aider
 * args.py, opencode run.ts). Flags age fast: codex dropped its full-auto
 * handling from exec on 2026-07-30, and gemini deprecated its short approval
 * switch. A row is re-read on every vendor release, and this date says when.
 */
const VERIFICADO_EM = '2026-09-12'

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const ASPA = '["\'`]'

/**
 * A binary name as a pattern: each letter a one-letter class, a space either
 * whitespace or the `'a', 'b'` of an argv array. The classes are what keeps
 * the MCP artifact honest: mcp/generate.mjs indexes the letter runs of every
 * pattern source, and a plain name would land there as a quoted word that the
 * binary row itself matches.
 */
const soletrar = (nome) =>
  [...nome]
    .map((c) => {
      if (/[A-Za-z]/.test(c)) return `[${c}]`
      if (c === ' ') return `(?:\\s+|${ASPA}\\s*,\\s*${ASPA})`
      return escapar(c)
    })
    .join('')

// Token edges. Before a binary: a line or command start, whitespace, a quote,
// a path separator or an opening bracket. After it: an optional Windows shim
// extension or npm version, then the end, whitespace, a quote, a closer, or a
// shell operator. The shell ends a word at `<`, `>`, `&`, `;` and `|` and passes
// the word on unchanged: measured, `run --flag-x>/tmp/o.txt` gave the program the
// argument `--flag-x`, and a switch written right before `&`, `>` or `<` in a
// postinstall passed with no note while the same switch before a space failed.
const ANTES_DO_BINARIO = '(?:^|[\\s"\'`/\\\\(\\[,;&|])'
const CAUDA_DO_BINARIO = '(?:\\.exe|\\.cmd)?(?:@[\\w.^~-]+)?'
const DEPOIS_DO_BINARIO = '(?=$|[\\s"\'`\\],)<>&;|])'
const ANTES_DA_FLAG = '(?:^|[\\s"\'`\\[(,=])'
const DEPOIS_DA_FLAG = '(?=$|[\\s"\'`\\],)=<>&;|])'
// The rest of ONE command: a line break or a shell separator ends it.
const MESMO_COMANDO = '[^\\n;&|]*?'
// `flag value`, `flag=value`, `flag="value"` and the argv form `'flag', 'value'`.
const ENTRE_FLAG_E_VALOR = `(?:\\s+${ASPA}?|=${ASPA}?|${ASPA}\\s*,\\s*${ASPA})`
const DEPOIS_DO_VALOR = '(?=$|[\\s"\'`\\],)<>&;|])'

/** A word as a pattern that takes any letter case: `Command`, `CMD` and `cmd`. */
const semCaixa = (palavra) =>
  [...palavra].map((c) => `[${c.toLowerCase()}${c.toUpperCase()}]`).join('')

// Where code STARTS a program, or keeps the name of the one it starts. A key
// that names the command (any case: `Command:` and `CMD=` are the same key to
// the reader of the code), the first argument of a process call (Node, execa,
// Python subprocess and os), or a plain assignment of the name to a variable
// that a call then takes (`const tool = '<name>'`; the Nx map style with the
// name in a variable). A comparison (`===`, `!=`, `<=`) is not an assignment.
const CHAVE_OU_CHAMADA =
  `(?:\\b(?:${['cmd', 'command', 'bin', 'binary', 'executable', 'program'].map(semCaixa).join('|')})` +
  `${ASPA}?\\s*[:=]\\s*` +
  '|\\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|execa|execaSync|fork|' +
  'Popen|run|call|check_call|check_output|system|popen)\\s*\\(\\s*\\[?\\s*' +
  '|[\\w$\\])]\\s*(?<![=!<>])=\\s*)'

const traco = (...partes) => j('-', ...partes)
const dupla = (...partes) => j('-', '-', ...partes)
const semFreio = j('yo', 'lo')

/**
 * The research, one CLI per entry. Sources and the reasons a flag is strong,
 * ambiguous or absent were recorded in phase 1; the ones deliberately left
 * out are held out by the 'never matched' proof in prove-bypass.mjs.
 */
const CLIS = [
  {
    id: j('cla', 'ude'),
    nomes: [j('cla', 'ude'), j('@anthropic-ai/', 'cla', 'ude-code')],
    produto: 'Anthropic Claude Code CLI',
    fortes: [[dupla('dangerously-', 'skip-', 'permissions'), 'skips every permission prompt']],
    paresFortes: [
      [
        dupla('permission-', 'mode'),
        j('bypass', 'Permissions'),
        'starts in the mode that approves every tool call',
      ],
    ],
    fracas: [
      [
        dupla('allow-', 'dangerously-', 'skip-', 'permissions'),
        'puts the approve-everything mode one keypress away',
      ],
    ],
  },
  {
    id: j('gem', 'ini'),
    nomes: [j('gem', 'ini'), j('@google/', 'gem', 'ini-cli')],
    produto: 'Google Gemini CLI',
    // yargs with .strict() and no parserConfiguration: its camel-case expansion
    // takes the camelCase spelling of a dashed long option (measured with yargs
    // 17.7.2 and this CLI's option shape). Letter case and abbreviations it refuses.
    camelo: true,
    ambiguas: [
      [dupla(semFreio), 'approves every tool call'],
      [traco('y'), 'approves every tool call'],
    ],
    pares: [[dupla('approval-', 'mode'), semFreio, 'approves every tool call']],
  },
  {
    id: j('qw', 'en'),
    nomes: [j('qw', 'en'), j('@qwen-code/', 'qw', 'en-code')],
    produto: 'Qwen Code CLI',
    // A fork of the Gemini CLI, with the same yargs parser.
    camelo: true,
    ambiguas: [
      [dupla(semFreio), 'approves every tool call'],
      [traco('y'), 'approves every tool call'],
    ],
    pares: [[dupla('approval-', 'mode'), semFreio, 'approves every tool call']],
  },
  {
    id: j('cod', 'ex'),
    nomes: [j('cod', 'ex'), j('@openai/', 'cod', 'ex')],
    produto: 'OpenAI Codex CLI',
    fortes: [
      [
        dupla('dangerously-', 'bypass-', 'approvals-', 'and-', 'sandbox'),
        'turns off both the approval prompts and the sandbox',
      ],
    ],
    ambiguas: [[dupla(semFreio), 'turns off both the approval prompts and the sandbox']],
    pares: [
      [dupla('sand', 'box'), j('danger-', 'full-', 'access'), 'runs with no sandbox at all'],
      [traco('s'), j('danger-', 'full-', 'access'), 'runs with no sandbox at all'],
      [dupla('ask-', 'for-', 'approval'), 'never', 'never asks before running a command'],
      [traco('a'), 'never', 'never asks before running a command'],
    ],
    // `-c key=value` and `--config key=value` override a key of the Codex config
    // file for one run (codex-rs utils/cli config_override.rs parses the value as
    // TOML, and falls back to the raw string). Only the two keys that take the
    // sandbox away are rows. The approval key set to its never-ask value is
    // deliberately NOT one: Codex's config reference recommends it for
    // non-interactive runs and `exec` has no approval option at all, and over
    // 1,590 fetched repositories that row added 4 failures, all one SKILL.md
    // documenting exactly that default, while the two sandbox rows added 14
    // warnings in shell scripts and no failure.
    configs: [
      [j('sandbox', '_mode'), j('danger-', 'full-', 'access'), 'runs with no sandbox at all'],
      [
        j('default', '_permissions'),
        j(':danger-', 'full-', 'access'),
        'runs with no sandbox at all',
      ],
    ],
  },
  {
    id: 'amazon-q',
    nomes: [j('q', ' ', 'chat'), j('kiro-', 'cli', ' ', 'chat')],
    produto: 'Amazon Q Developer or Kiro CLI chat',
    fortes: [[dupla('trust-', 'all-', 'tools'), 'runs every tool without asking']],
    ambiguas: [[traco('a'), 'runs every tool without asking (short form)']],
  },
  {
    id: j('copi', 'lot'),
    nomes: [j('copi', 'lot'), j('@github/', 'copi', 'lot')],
    produto: 'GitHub Copilot CLI',
    fortes: [
      [dupla('allow-', 'all-', 'tools'), 'lets every tool run without asking'],
      [dupla('allow-', 'all-', 'paths'), 'lets every file path be touched without asking'],
    ],
    ambiguas: [
      [dupla('allow-', 'all'), 'lets every tool, path and URL through without asking'],
      [dupla('allow-', 'all-', 'urls'), 'lets every URL be fetched without asking'],
      [dupla(semFreio), 'lets every tool, path and URL through without asking'],
    ],
  },
  {
    id: j('cursor-', 'agent'),
    nomes: [j('cursor-', 'agent')],
    produto: 'Cursor agent CLI',
    ambiguas: [
      [traco('f'), 'allows every command unless it is explicitly denied'],
      [dupla('for', 'ce'), 'allows every command unless it is explicitly denied'],
      [dupla(semFreio), 'allows every command unless it is explicitly denied'],
      [dupla('approve-', 'mcps'), 'approves every MCP server without asking'],
    ],
    pares: [[dupla('sand', 'box'), 'disabled', 'runs commands outside the sandbox']],
  },
  {
    id: j('open', 'code'),
    nomes: [j('open', 'code'), j('open', 'code-ai')],
    produto: 'OpenCode CLI',
    ambiguas: [
      [dupla('au', 'to'), 'approves every permission request'],
      [dupla(semFreio), 'approves every permission request'],
    ],
  },
  {
    id: j('ai', 'der'),
    nomes: [j('ai', 'der')],
    produto: 'Aider CLI',
    // configargparse without allow_abbrev: argparse takes any unique prefix of a
    // long option (measured with Python 3.12 argparse: the prefix cut one and five
    // letters short both set the switch). No other long option of aider/args.py
    // starts with the first letter of this one (read 2026-09-13), so every prefix
    // from that one letter on is the same switch.
    prefixoMinimo: 1,
    ambiguas: [[dupla('yes-', 'always'), 'answers yes to every confirmation']],
  },
]

const ID_DO_SDK = j('cla', 'ude-agent-sdk')

/** Strings of the Claude Agent SDK (TypeScript and Python spellings) that accuse alone. */
const OPCOES_DO_SDK = [
  [
    `(?:^|[^\\w$])${j('permission', '(?:_m|M)', 'ode')}${ASPA}?\\s*[:=]\\s*` +
      `${ASPA}${j('bypass', 'Permissions')}${ASPA}`,
    'a query that approves every tool call',
  ],
  [
    `(?:^|[^\\w$])${j('allow', '(?:_d|D)', 'angerously', '(?:_s|S)', 'kip')}` +
      `${j('(?:_p|P)', 'ermissions')}${ASPA}?\\s*[:=]\\s*(?:true|True)\\b`,
    'unlocks the approve-everything mode for a query',
  ],
]

const binarioDe = (cli) => `(?:${cli.nomes.map(soletrar).join('|')})`
const linha = (fonte, explicacao) => [new RegExp(fonte), explicacao, VERIFICADO_EM]

/** Every ASCII letter but `l`, as one class (`[A-Za-xz]` for y): a run that never backtracks over `l`. */
function outrasLetras(l) {
  const faixas = []
  for (const [a, b] of [
    ['A', 'Z'],
    ['a', 'z'],
  ]) {
    const [ca, cb, cl] = [a, b, l].map((c) => c.charCodeAt(0))
    if (cl < ca || cl > cb) {
      faixas.push(`${a}-${b}`)
      continue
    }
    const ate = String.fromCharCode(cl - 1)
    const desde = String.fromCharCode(cl + 1)
    if (cl > ca) faixas.push(cl - 1 === ca ? a : `${a}-${ate}`)
    if (cl < cb) faixas.push(cl + 1 === cb ? b : `${desde}-${b}`)
  }
  return `[${faixas.join('')}]`
}

/**
 * A switch as the CLI's own parser lets it be written, not only as the table
 * spells it. The spellings the parsers the table cites accept:
 * - a one-letter switch also inside a group of short options. Measured with
 *   yargs-parser 21.1.1: the Gemini short switch grouped with the prompt switch
 *   set both, and the rule passed it. commander and clap document the same
 *   grouping for short booleans, so the letter counts anywhere in a single-dash
 *   word (the binary is still required: these rows are ambiguous);
 * - `camelo`: yargs takes the camelCase spelling of a dashed long option
 *   (measured with yargs 17.7.2 under .strict());
 * - `prefixoMinimo`: argparse takes every unique prefix of a long option, down
 *   to that many letters (measured with Python 3.12).
 * commander (Claude Code, Copilot, Cursor) refuses the camelCase spelling
 * (measured: commander.unknownOption), so those CLIs keep the exact long form.
 */
function grafia(flag, cli) {
  const curta = /^-([A-Za-z])$/.exec(flag)
  if (curta) return j('-', outrasLetras(curta[1]), '*', `[${curta[1]}]`, '[A-Za-z]*')
  if (!flag.startsWith('--')) return escapar(flag)
  const nome = flag.slice(2)
  if (cli.prefixoMinimo) {
    const letras = [...nome.slice(cli.prefixoMinimo)]
    const cauda = letras.reduceRight((dentro, c) => `(?:${escapar(c)}${dentro})?`, '')
    return `--${escapar(nome.slice(0, cli.prefixoMinimo))}${cauda}`
  }
  if (cli.camelo) {
    const partes = nome.split('-')
    return `--${partes
      .map((p, i) =>
        i === 0 || !p
          ? escapar(p)
          : `(?:-${escapar(p[0])}|${escapar(p[0].toUpperCase())})${escapar(p.slice(1))}`,
      )
      .join('')}`
  }
  return escapar(flag)
}

const flagSozinha = (flag, cli) => `${ANTES_DA_FLAG}${grafia(flag, cli)}${DEPOIS_DA_FLAG}`
// A pair keeps its short switch exact: an attached or grouped value (clap's
// `-a<value>`) was not measured, and the README says so.
const flagComValor = (flag, valor, cli) =>
  `${ANTES_DA_FLAG}${/^-[A-Za-z]$/.test(flag) ? escapar(flag) : grafia(flag, cli)}` +
  `${ENTRE_FLAG_E_VALOR}${escapar(valor)}${DEPOIS_DO_VALOR}`
const noComando = (cli, resto) =>
  `${ANTES_DO_BINARIO}${binarioDe(cli)}${CAUDA_DO_BINARIO}${DEPOIS_DO_BINARIO}${MESMO_COMANDO}${resto}`
// A config override with its key and value: `-c k=v`, `--config k="v"`,
// `--config 'k="v"'`, `--config=k=v`, `-c 'k = "v"'`, and the same key under a
// profile (`profiles.<name>.k`), which `--profile <name>` selects. Up to four
// quote or backslash characters may sit around the key and the value, which
// covers a TOML string inside a shell string inside a JSON or YAML one.
const flagDeConfig = (chave, valor) =>
  `${ANTES_DA_FLAG}(?:-c|--config)${ENTRE_FLAG_E_VALOR}[\\\\"'\`]{0,4}` +
  `(?:profiles\\.[^\\s="'\`.]+\\.)?${escapar(chave)}\\s*=\\s*[\\\\"'\`]{0,4}` +
  `${escapar(valor)}[\\\\"'\`]{0,4}${DEPOIS_DO_VALOR}`

export const FLAGS_FORTES = [
  ...CLIS.flatMap((cli) => [
    ...(cli.fortes || []).map(([flag, efeito]) =>
      linha(flagSozinha(flag, cli), `${cli.id}: ${efeito}`),
    ),
    ...(cli.paresFortes || []).map(([flag, valor, efeito]) =>
      linha(flagComValor(flag, valor, cli), `${cli.id}: ${efeito}`),
    ),
    ...(cli.fracas || []).map(([flag, efeito]) =>
      linha(flagSozinha(flag, cli), `${cli.id} (warning only): ${efeito}`),
    ),
  ]),
  ...OPCOES_DO_SDK.map(([fonte, efeito]) => linha(fonte, `${ID_DO_SDK}: ${efeito}`)),
]

export const FLAGS_AMBIGUAS = CLIS.flatMap((cli) =>
  (cli.ambiguas || []).map(([flag, efeito]) =>
    linha(noComando(cli, flagSozinha(flag, cli)), `${cli.id}: ${efeito}`),
  ),
)

export const PARES_DE_FLAG = CLIS.flatMap((cli) => [
  ...(cli.pares || []).map(([flag, valor, efeito]) =>
    linha(noComando(cli, flagComValor(flag, valor, cli)), `${cli.id}: ${efeito}`),
  ),
  ...(cli.configs || []).map(([chave, valor, efeito]) =>
    linha(noComando(cli, flagDeConfig(chave, valor)), `${cli.id}: ${efeito}`),
  ),
])

export const BINARIOS_DE_AGENTE = CLIS.map((cli) => {
  const bin = `${binarioDe(cli)}${CAUDA_DO_BINARIO}`
  // The quoted literal first and its context as a lookbehind: tried at every
  // position, the context alternatives (the assignment one starts at any word
  // character) cost a third more over node_modules; a quote fails fast.
  const literal = `${ASPA}(?<=${CHAVE_OU_CHAMADA}${ASPA})(?:[^"'\`\\s]*[\\\\/])?${bin}${ASPA}`
  const palavra = `${ANTES_DO_BINARIO}${bin}(?=(?:\\s+[a-z][\\w-]*)?\\s+${ASPA}?-)`
  return linha(`(?:${literal})|(?:${palavra})`, `${cli.id}: ${cli.produto}`)
})

// ─────────────────────────────────────────────────────────────── the engine

/** Minified code: the gsap false positive was one line of 44 KB. */
const LINHA_MINIFICADA = 1000
/** The Nx map kept `cmd` and `args` on neighbouring lines. */
const JANELA = 3

const ROTULO = /^([a-z][a-z0-9-]*)( \(warning only\))?: (\S.*)$/

const PREPARADAS = new WeakMap()

const uniao = (fontes) => new RegExp(fontes.map((f) => `(?:${f})`).join('|'), 'm')

/**
 * Validates the four tables and compiles them once. A table that is missing or
 * malformed THROWS: the executor turns it into quebrou, which is the honest
 * outcome for a rule that would otherwise run blind.
 *
 * An ambiguous or pair row is `<binary part><MESMO_COMANDO><flag part>`, and
 * the engine splits it at that gap and runs the two parts one after the other:
 * the leftmost binary, then the flag anywhere after it. That is the same match
 * the whole row makes, in linear time. Run whole, the lazy gap is quadratic:
 * measured, a 140 KB line holding one binary name 20,000 times took 7.8 s, so
 * an 8 MiB agent file would have held the gate for hours.
 */
function prepararTabelas(tabelas) {
  if (!tabelas || typeof tabelas !== 'object') {
    throw new Error('checarBypass needs its four tables as the second argument')
  }
  const chave = tabelas.FLAGS_FORTES
  if (Array.isArray(chave) && PREPARADAS.has(chave)) {
    const pronta = PREPARADAS.get(chave)
    if (
      pronta.origem.FLAGS_AMBIGUAS === tabelas.FLAGS_AMBIGUAS &&
      pronta.origem.PARES_DE_FLAG === tabelas.PARES_DE_FLAG &&
      pronta.origem.BINARIOS_DE_AGENTE === tabelas.BINARIOS_DE_AGENTE
    ) {
      return pronta
    }
  }
  const ler = (nome, forcaPadrao) => {
    const tabela = tabelas[nome]
    if (!Array.isArray(tabela) || tabela.length === 0) {
      throw new Error(`table ${nome} is missing or empty`)
    }
    return tabela.map((row, i) => {
      const ok =
        Array.isArray(row) &&
        row.length === 3 &&
        row[0] instanceof RegExp &&
        typeof row[1] === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(row[2])
      if (!ok) throw new Error(`${nome}[${i}] is not [RegExp, explicacao, verificadoEm]`)
      const m = ROTULO.exec(row[1])
      if (!m) throw new Error(`${nome}[${i}] explanation does not start with '<id>: '`)
      if (m[2] && nome !== 'FLAGS_FORTES') {
        throw new Error(`${nome}[${i}] is warning-only, and only FLAGS_FORTES rows can be`)
      }
      const flags = row[0].flags.replace(/[gy]/g, '')
      const saida = { id: m[1], texto: m[3], forca: m[2] ? 'fraca' : forcaPadrao }
      if (forcaPadrao !== 'ambigua') return { ...saida, re: new RegExp(row[0].source, flags) }
      const partes = row[0].source.split(MESMO_COMANDO)
      if (partes.length !== 2 || !partes[0] || !partes[1]) {
        throw new Error(`${nome}[${i}] is not <binary>${MESMO_COMANDO}<flag>`)
      }
      return {
        ...saida,
        binario: new RegExp(partes[0], flags),
        flag: new RegExp(partes[1], flags),
        // Global copies walk every binary and every flag of a command once.
        binarioGlobal: new RegExp(partes[0], `${flags}g`),
        flagGlobal: new RegExp(partes[1], `${flags}g`),
      }
    })
  }
  const fortes = ler('FLAGS_FORTES', 'forte')
  const compostas = [...ler('FLAGS_AMBIGUAS', 'ambigua'), ...ler('PARES_DE_FLAG', 'ambigua')]
  const binarios = ler('BINARIOS_DE_AGENTE', 'binario')
  const idsDeBinario = new Set(binarios.map((b) => b.id))
  for (const c of compostas) {
    if (!idsDeBinario.has(c.id)) throw new Error(`no BINARIOS_DE_AGENTE row for id ${c.id}`)
  }
  const pronta = {
    origem: tabelas,
    fortes,
    compostas,
    binarios,
    // A text can hold a finding only if a strong row matches, or a binary AND
    // a flag of some row both appear. Tested on the whole text first: without
    // it the prototype needed 4 min 40 s for 60k files.
    soFortes: uniao(fortes.map((x) => x.re.source)),
    algumBinario: uniao([
      ...compostas.map((x) => x.binario.source),
      ...binarios.map((x) => x.re.source),
    ]),
    algumaFlag: uniao(compostas.map((x) => x.flag.source)),
  }
  if (Array.isArray(chave)) PREPARADAS.set(chave, pronta)
  return pronta
}

const candidato = (t, texto) =>
  t.soFortes.test(texto) || (t.algumBinario.test(texto) && t.algumaFlag.test(texto))

// ─────────────────────────────────────────────────────────────── quoting
//
// A shell hands a quoted string to the program as ONE argument, whatever it
// holds. Read as plain text, a prompt after the binary gave its words to the
// flag rows: measured, `-la`, `-rf` and `-type` inside a quoted prompt matched
// a short-switch group and failed a workflow and an AGENTS.md; a `&` inside a
// quoted URL cut the command in two, and the switch after the URL passed with
// no note. So the command is split, and a short switch is matched, the way a
// shell reads the quotes.
//
// The quotes that hold the BINARY are not an argument of it: they are a string
// whose content is itself a command (`execSync("gemini ...")`, a JSON value, a
// Markdown code span in backticks). Inside those the same reading runs again,
// one level down, where an escaped quote (`\"` in a JSON or JS string) is a
// quote of the inner command.
//
// WHICH QUOTES, AND WHICH ESCAPE, DEPEND ON THE SHELL. One reading for every
// place was measured to hide a real short switch: in PowerShell the escape is
// the backtick and a backslash is literal, so `-p "don<backtick>"t" -y` and
// `-p "C:\temp\" -y` pass `-y` on its own, while a backslash-escape reading
// paired the quotes one character off and put `-y` inside a prompt; in a POSIX
// shell `$'...'` is a quote with backslash escapes, and a backtick is command
// substitution whose output is split into words (a real `-y`), not a quote.
// Each place is read with the model of what runs it (see dialetosDaEntrada and
// dialetosDoWorkflow); where that is unknown, with both shell models, and a
// switch counts when either reads it as an argument. Only text no shell reads
// first, a Markdown code span or a JS template string, keeps the backtick as
// a quote.
//   texto  backslash escapes; ", ' and backtick are quotes (Markdown, code, JSON)
//   posix  backslash escapes outside quotes and inside " and $'...'; ' is literal
//   pwsh   backtick escapes outside quotes and inside "; '' and "" are a quote
//          inside their own kind; a backslash is literal

const MODELOS_DE_ASPAS = {
  texto: { aspas: '"\'`', escape: '\\' },
  posix: { aspas: '"\'', escape: '\\' },
  pwsh: { aspas: '"\'', escape: '`' },
}
export const DIALETOS = Object.freeze(Object.keys(MODELOS_DE_ASPAS))
const AMBOS_OS_SHELLS = Object.freeze(['posix', 'pwsh'])
const PROFUNDIDADE_DE_ASPAS = 3

/**
 * The quoted spans and the command separators of `texto[de, ate)`, read at one
 * level with the quote model of `dialeto`: `delimitador` is null at the top, or
 * the quote character of the string the region sits in. A quote that never
 * closes is an ordinary character (an apostrophe in prose), which can only keep
 * more text together. Returns { spans: [{ abre, dentro, fim }], separadores:
 * [indice] }, sorted; a span's content is [dentro, fim).
 */
function estruturaDeAspas(texto, de, ate, delimitador, dialeto = 'texto') {
  const { aspas, escape } = MODELOS_DE_ASPAS[dialeto]
  const pwsh = dialeto === 'pwsh'
  const spans = []
  const separadores = []
  const aninhado = delimitador !== null
  const aspaEm = (i) => {
    const c = texto[i]
    // One level down, an escaped quote of the string that holds the command is
    // a quote of the command: `\"` in JSON, JS or a YAML double-quoted scalar,
    // and in PowerShell also its own backtick escape.
    if (aninhado && i + 1 < ate && aspas.includes(texto[i + 1])) {
      if (c === '\\' || c === escape) return [texto[i + 1], 2, false]
    }
    if (aspas.includes(c) && c !== delimitador) {
      // `$'...'`: bash, zsh and ksh read backslash escapes inside it.
      return [c, 1, dialeto === 'posix' && c === "'" && texto[i - 1] === '$']
    }
    return null
  }
  let i = de
  while (i < ate) {
    const aspa = aspaEm(i)
    if (aspa) {
      const [q, largura, ansiC] = aspa
      // The escape inside this kind of quote: none inside a plain single quote.
      const escapeDentro = q === "'" ? (ansiC ? '\\' : null) : pwsh ? '`' : '\\'
      let j = i + largura
      let fecho = null
      while (j < ate) {
        const t = aspaEm(j)
        if (t && t[0] === q) {
          // PowerShell writes a quote inside its own kind by doubling it.
          if (pwsh && t[1] === 1 && texto[j + 1] === q) {
            j += 2
            continue
          }
          fecho = [j, t[1]]
          break
        }
        j += escapeDentro !== null && texto[j] === escapeDentro ? 2 : 1
      }
      if (fecho === null) {
        i += largura
        continue
      }
      spans.push({ abre: i, dentro: i + largura, fim: fecho[0] })
      i = fecho[0] + fecho[1]
      continue
    }
    const c = texto[i]
    if (c === escape) {
      i += 2
      continue
    }
    if ((c === '&' || c === '|') && texto[i + 1] === c) {
      separadores.push(i)
      i += 2
      continue
    }
    // The `&` of a redirection (`2>&1`, `&>file`, `>&2`) joins nothing.
    if (
      c === ';' ||
      c === '|' ||
      (c === '&' && !'<>'.includes(texto[i - 1]) && texto[i + 1] !== '>')
    ) {
      separadores.push(i)
    }
    i++
  }
  return { spans, separadores }
}

/** The span whose content holds offset `p`, or null (spans are sorted and disjoint). */
function spanEm(spans, p) {
  let baixo = 0
  let alto = spans.length - 1
  while (baixo <= alto) {
    const meio = (baixo + alto) >> 1
    if (spans[meio].dentro > p) alto = meio - 1
    else if (spans[meio].fim <= p) baixo = meio + 1
    else return spans[meio]
  }
  return null
}

/**
 * Whether the switch starting at `p` is an argument of the binary starting at
 * `b` (b < p) in `texto`: no separator between them at the level both sit in,
 * and, for a short switch, not a word inside a quoted argument (a quoted
 * `-yp` is the switch; `"find -type d"` is a prompt). A long switch inside a
 * quoted argument still counts, as it did before quoting was read.
 * `memoria` caches the structure of each region for one text and one quote
 * model, `dialeto`.
 */
function argumentoDoBinario(
  texto,
  b,
  p,
  memoria,
  dialeto,
  de = 0,
  ate = texto.length,
  delimitador = null,
  nivel = 0,
) {
  const chave = `${de}:${ate}`
  let estrutura = memoria.get(chave)
  if (!estrutura) {
    estrutura = estruturaDeAspas(texto, de, ate, delimitador, dialeto)
    memoria.set(chave, estrutura)
  }
  const { spans, separadores } = estrutura
  // Offsets are sorted: the first separator past `b` decides.
  let k = 0
  let alto = separadores.length
  while (k < alto) {
    const meio = (k + alto) >> 1
    if (separadores[meio] <= b) k = meio + 1
    else alto = meio
  }
  if (k < separadores.length && separadores[k] < p) return false
  const span = spanEm(spans, p)
  if (!span) return true
  if (span.dentro <= b && b < span.fim) {
    if (nivel >= PROFUNDIDADE_DE_ASPAS) return true
    const aspa = texto[span.dentro - 1]
    return argumentoDoBinario(texto, b, p, memoria, dialeto, span.dentro, span.fim, aspa, nivel + 1)
  }
  const curta = texto[p] === '-' && texto[p + 1] !== '-'
  return !curta || p === span.dentro
}

const ESTRUTURA_DO_ULTIMO_TEXTO = { texto: null, dialeto: null, memoria: null }

/** Where the switch starts inside a flag match, which may begin with its edge character. */
const inicioDaFlag = (m) => m.index + (m[0][0] === '-' ? 0 : 1)

/**
 * The binary of the row that a flag of the same row belongs to, or null. Each
 * flag is paired with the nearest binary before it and accepted when it is an
 * argument of that binary (argumentoDoBinario), read with the quote model
 * `dialeto`. Binaries and flags are each walked once, so the match stays linear.
 */
function casarComposta(row, texto, dialeto = 'texto') {
  const primeiro = row.binario.exec(texto)
  if (!primeiro) return null
  const flags = row.flagGlobal
  flags.lastIndex = primeiro.index + primeiro[0].length
  let f = flags.exec(texto)
  if (!f) return null
  // No quote at all: nothing is quoted, and the command was already cut at its
  // separators, so the first flag after the first binary is the answer.
  if (!texto.includes('"') && !texto.includes("'") && !texto.includes('`')) return primeiro
  const binarios = row.binarioGlobal
  binarios.lastIndex = primeiro.index + primeiro[0].length
  let atual = primeiro
  let proximo = binarios.exec(texto)
  // Every row of a command reads the same text: its quote structure is kept
  // for the next row instead of being scanned once per row.
  if (ESTRUTURA_DO_ULTIMO_TEXTO.texto !== texto || ESTRUTURA_DO_ULTIMO_TEXTO.dialeto !== dialeto) {
    ESTRUTURA_DO_ULTIMO_TEXTO.texto = texto
    ESTRUTURA_DO_ULTIMO_TEXTO.dialeto = dialeto
    ESTRUTURA_DO_ULTIMO_TEXTO.memoria = new Map()
  }
  const { memoria } = ESTRUTURA_DO_ULTIMO_TEXTO
  for (; f; f = flags.exec(texto)) {
    const p = inicioDaFlag(f)
    while (proximo && proximo.index + proximo[0].length <= p) {
      atual = proximo
      proximo = binarios.exec(texto)
    }
    if (argumentoDoBinario(texto, inicioDoToken(atual), p, memoria, dialeto)) return atual
    if (f[0] === '') flags.lastIndex++
  }
  return null
}

/** Shell separators become spaces, so a window or a code line reads as one command. */
const achatar = (texto) => texto.replace(/[;&|]/g, ' ')

/**
 * Whether a whole file can hold any finding, tested on the RAW text before
 * anything else runs. Comment delimiters become spaces too, so a flag that only
 * touches its binary once a block comment is stripped still passes the test.
 * Measured on prettier's 9.5 MB of JavaScript: stripping comments cost 1.05 s
 * and a whole-text test 0.31 s, and almost no file passes it, so nearly all of
 * the stripping is skipped.
 */
const podeTerAchado = (t, texto) => candidato(t, texto.replace(/\/\*|\*\/|\/\/|[;&|]/g, ' '))

const colunaEm = (linha, indice) => [...linha.slice(0, indice)].length + 1

/** Where the token starts inside a match that may include the edge character before it. */
const inicioDoToken = (m) => m.index + (m[0] && /[^\w@-]/.test(m[0][0]) ? 1 : 0)

/**
 * One line cut into the commands a shell runs: at `&&`, `||`, `;`, `|` and a lone
 * `&` that sends a command to the background, outside quotes. The `&` of a
 * redirection (`2>&1`, `&>file`, `>&2`) joins nothing and is not a cut, and
 * neither is a separator inside quotes: measured before, the `&` of a quoted
 * URL cut the binary from its switch. Quotes are read with the model `dialeto`.
 */
function comandosDe(linha, dialeto = 'texto') {
  const comandos = []
  let inicio = 0
  if (/[;&|]/.test(linha)) {
    for (const k of estruturaDeAspas(linha, 0, linha.length, null, dialeto).separadores) {
      comandos.push({ inicio, texto: linha.slice(inicio, k) })
      inicio = k + (linha[k + 1] === linha[k] && linha[k] !== ';' ? 2 : 1)
    }
  }
  comandos.push({ inicio, texto: linha.slice(inicio) })
  return comandos
}

function coletor() {
  const achados = []
  const vistos = new Set()
  const anotar = (row, n, coluna) => {
    const chave = `${n}\0${row.id}\0${row.texto}`
    if (vistos.has(chave)) return
    vistos.add(chave)
    achados.push({ linha: n + 1, coluna, id: row.id, texto: row.texto, forca: row.forca })
  }
  return { achados, anotar }
}

/**
 * Where a physical line ends in an odd run of backslashes (a CR after it
 * allowed), the shell joins it to the next one: `gemini \` on one line and the
 * switch on the next are one command. Returns the length of line `n` to keep
 * when it continues, or -1.
 */
function continuacaoDeShell(linha) {
  const semCr = linha.endsWith('\r') ? linha.slice(0, -1) : linha
  let barras = 0
  while (barras < semCr.length && semCr[semCr.length - 1 - barras] === '\\') barras++
  return barras % 2 === 1 ? semCr.length - 1 : -1
}

const recuoDe = (linha) => linha.length - linha.trimStart().length

/**
 * The lines YAML folds into one value: the body of a folded block scalar
 * (`>`, `>-`, `>+`), whose lines at the body's own indent are joined with a
 * space, and a plain or quoted scalar that continues on more indented lines.
 * A literal block (`|`) keeps its line breaks, so only a backslash joins
 * there. Returns the set of line numbers that are glued to the next line.
 * GitHub runs the folded value as one shell line, which is how `run: >` with
 * the CLI name and its switch on separate lines ran as one command.
 */
function dobrasDeYaml(linhas) {
  const coladas = new Set()
  const vazia = (l) => l.trim() === ''
  const comentario = (l) => l.trimStart().startsWith('#')
  for (let n = 0; n < linhas.length; n++) {
    const linha = linhas[n].replace(/\r$/, '')
    // `key: value`, `- key: value`, `- value`: the column a continuation must pass.
    const m = /^(\s*(?:-\s+)*)(?:((?:"[^"]*"|'[^']*'|[^\s#"'][^#]*?)):(?:\s+|$))?(.*)$/.exec(linha)
    if (!m) continue
    const valor = m[3].trim()
    if (!valor || valor.startsWith('#')) continue
    const temChave = m[2] !== undefined
    const temTraco = /-\s+$/.test(m[1])
    if (!temChave && !temTraco) continue
    const coluna = temChave ? m[1].length : m[1].lastIndexOf('-')
    const bloco = /^([|>])[-+0-9]*\s*(?:#.*)?$/.exec(valor)
    if (bloco) {
      // A block scalar: its body is every following line indented past the
      // node, blank lines included. In a folded one (`>`), lines at the body
      // indent fold together; a literal one (`|`) is skipped whole, so shell
      // text inside it is never read as YAML keys.
      let base = -1
      let k = n + 1
      for (; k < linhas.length; k++) {
        const corpo = linhas[k].replace(/\r$/, '')
        if (vazia(corpo)) continue
        const r = recuoDe(corpo)
        if (r <= coluna) break
        if (base === -1) base = r
      }
      for (let q = n + 1; bloco[1] === '>' && q < k - 1; q++) {
        const a = linhas[q].replace(/\r$/, '')
        const b = linhas[q + 1].replace(/\r$/, '')
        if (!vazia(a) && !vazia(b) && recuoDe(a) === base && recuoDe(b) === base) coladas.add(q)
      }
      n = k - 1
      continue
    }
    if (/^[[{&*!]/.test(valor)) continue
    // A plain or quoted scalar: every next line indented past the node, up to
    // a blank line or a comment, is part of it.
    let k = n
    while (k + 1 < linhas.length) {
      const proxima = linhas[k + 1].replace(/\r$/, '')
      if (vazia(proxima) || comentario(proxima) || recuoDe(proxima) <= coluna) break
      coladas.add(k)
      k++
    }
    n = k
  }
  return coladas
}

/**
 * Physical lines joined into the lines a shell reads, with a map back:
 * `partes` holds, for each piece, its offset in the joined text and its
 * physical line, so a match reports the line and column it really has.
 */
function linhasLogicas(texto, { yaml = false } = {}) {
  const linhas = texto.split('\n')
  const dobras = yaml ? dobrasDeYaml(linhas) : null
  const saida = []
  for (let n = 0; n < linhas.length; n++) {
    let logica = ''
    const partes = []
    let k = n
    for (;;) {
      const corte = k + 1 < linhas.length ? continuacaoDeShell(linhas[k]) : -1
      const dobra = corte === -1 && dobras !== null && dobras.has(k)
      partes.push({ desde: logica.length, linha: k })
      if (corte !== -1) logica += `${linhas[k].slice(0, corte)} `
      else if (dobra) logica += `${linhas[k].replace(/\r$/, '')} `
      else {
        logica += linhas[k]
        break
      }
      k++
    }
    saida.push({ texto: logica, partes, fisicas: linhas })
    n = k
  }
  return saida
}

/** The physical line and column of an offset into a logical line. */
function lugarNaLogica(logica, indice) {
  let parte = logica.partes[0]
  for (const p of logica.partes) {
    if (p.desde > indice) break
    parte = p
  }
  const fisica = logica.fisicas[parte.linha]
  return { n: parte.linha, coluna: colunaEm(fisica, Math.min(indice - parte.desde, fisica.length)) }
}

/**
 * The composite and strong rows over one logical line, reported at physical
 * positions. The composite rows run once per quote model in `dialetos`, and a
 * switch any of them reads as an argument counts; a strong row accuses
 * wherever it sits, so it runs once.
 */
function casarLogica(t, logica, anotar, { longa, fortes = true, dialetos = ['texto'] }) {
  dialetos.forEach((dialeto, ordem) => {
    for (const comando of comandosDe(logica.texto, dialeto)) {
      const achar = (row, m) => {
        const { n, coluna } = lugarNaLogica(logica, comando.inicio + inicioDoToken(m))
        anotar(row, n, coluna)
      }
      if (fortes && ordem === 0) {
        for (const row of t.fortes) {
          const m = row.re.exec(comando.texto)
          if (m) achar(row, m)
        }
      }
      if (longa) continue
      for (const row of t.compostas) {
        const m = casarComposta(row, comando.texto, dialeto)
        if (m) achar(row, m)
      }
    }
  })
}

/**
 * `dialetos` as a list of known quote models: one name, a list, or a function
 * of the physical line (0-based) that returns either. An unknown name throws,
 * so a caller's typo cannot silently fall back to another reading.
 */
function listaDeDialetos(valor) {
  const lista = typeof valor === 'string' ? [valor] : valor
  if (!Array.isArray(lista) || lista.length === 0 || lista.some((d) => !DIALETOS.includes(d))) {
    throw new Error(`unknown quote model: ${String(valor)}`)
  }
  return lista
}

export function varrerShell(
  texto,
  tabelas,
  { guarda = false, yaml = false, dialetos = 'texto' } = {},
) {
  const t = prepararTabelas(tabelas)
  const porLinha =
    typeof dialetos === 'function'
      ? (n) => listaDeDialetos(dialetos(n))
      : () => listaDeDialetos(dialetos)
  if (typeof dialetos !== 'function') listaDeDialetos(dialetos)
  if (!candidato(t, achatar(texto))) return []
  const { achados, anotar } = coletor()
  for (const logica of linhasLogicas(texto, { yaml })) {
    if (!candidato(t, achatar(logica.texto))) continue
    casarLogica(t, logica, anotar, {
      longa: guarda && logica.texto.length > LINHA_MINIFICADA,
      dialetos: porLinha(logica.partes[0].linha),
    })
  }
  return achados
}

export function varrerCodigo(texto, tabelas, { guarda = true, dialetos = 'texto' } = {}) {
  const t = prepararTabelas(tabelas)
  const modelos = listaDeDialetos(dialetos)
  const plano = achatar(texto)
  if (!candidato(t, plano)) return []
  const { achados, anotar } = coletor()
  const linhas = texto.split('\n')
  const planas = plano.split('\n')
  const longa = (n) => guarda && linhas[n].length > LINHA_MINIFICADA
  // Only a line with a flag can be reported, and only a line with a binary can
  // lend it one: both lists are built once, so the window below stays linear.
  const comFlag = new Set()
  const binarios = []
  for (let n = 0; n < linhas.length; n++) {
    // Strong rows read the line as written, quoted or not: the Amazon Q line
    // was an unquoted call, which is also why it never compiled.
    if (t.soFortes.test(linhas[n])) {
      for (const row of t.fortes) {
        const m = row.re.exec(linhas[n])
        if (m) anotar(row, n, colunaEm(linhas[n], inicioDoToken(m)))
      }
    }
    if (longa(n) || !t.algumaFlag.test(planas[n])) continue
    comFlag.add(n)
    for (const dialeto of modelos) {
      for (const row of t.compostas) {
        const m = casarComposta(row, planas[n], dialeto)
        if (m) anotar(row, n, colunaEm(linhas[n], inicioDoToken(m)))
      }
    }
  }
  // A command continued with a trailing backslash (a shell script started by a
  // lifecycle script, a string continued in JS or Python) is one command: the
  // joined lines get the same one-command rows, reported where they match.
  if (plano.includes('\\')) {
    for (const logica of linhasLogicas(plano)) {
      if (logica.partes.length < 2 || !candidato(t, logica.texto)) continue
      casarLogica(t, logica, anotar, {
        longa: guarda && logica.texto.length > LINHA_MINIFICADA,
        fortes: false,
        dialetos: modelos,
      })
    }
  }
  for (let n = 0; n < linhas.length; n++) {
    if (!t.algumBinario.test(planas[n])) continue
    for (const b of t.binarios) {
      const m = b.re.exec(planas[n])
      if (m) binarios.push({ n, id: b.id, casado: m[0] })
    }
  }
  // The window: the binary as code starts it, glued in front of each line up
  // to 3 away that holds a flag, so the same one-command rows decide whether a
  // flag of THAT CLI sits there. Nothing but the binary is glued, so the flag
  // found is always on the line reported.
  for (const { n: b, id, casado } of binarios) {
    for (let n = Math.max(0, b - JANELA); n <= Math.min(linhas.length - 1, b + JANELA); n++) {
      if (!comFlag.has(n)) continue
      for (const row of t.compostas) {
        if (row.id !== id) continue
        const janela = `${casado} ${planas[n]}`
        if (!modelos.some((dialeto) => casarComposta(row, janela, dialeto))) continue
        anotar(row, n, colunaEm(linhas[n], linhas[n].length - linhas[n].trimStart().length))
      }
    }
  }
  return achados
}

// ───────────────────────────────────────────────────────────── the contexts

/**
 * npm lifecycle scripts: they run on `npm install` (of the package or of a
 * project that depends on it), on `npm ci`, on a git dependency's prepare, or
 * on publish and pack, and none of them asks. The uninstall trio is kept for
 * package managers that still run it.
 */
const CICLO_DE_VIDA = new Set([
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'preuninstall',
  'uninstall',
  'postuninstall',
])

/** githooks(5), git 2.55. A file with one of these names in a folder named `hooks`. */
const NOMES_DE_HOOK = new Set(
  (
    'applypatch-msg pre-applypatch post-applypatch pre-commit pre-merge-commit ' +
    'prepare-commit-msg commit-msg post-commit pre-rebase post-checkout post-merge pre-push ' +
    'pre-receive update proc-receive post-receive post-update reference-transaction ' +
    'push-to-checkout pre-auto-gc post-rewrite sendemail-validate fsmonitor-watchman ' +
    'p4-changelist p4-prepare-changelist p4-post-changelist p4-pre-submit post-index-change'
  ).split(' '),
)

const ehGancho = (caminho) =>
  /(?:^|\/)\.(?:husky|githooks)\//i.test(caminho) ||
  (posix.basename(posix.dirname(caminho)) === 'hooks' && NOMES_DE_HOOK.has(posix.basename(caminho)))

/** GitHub runs top-level files of the root `.github/workflows/` only. */
const ehWorkflow = (caminho) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(caminho)

/**
 * gh-aw writes this line near the top of every lock file (measured: line 3 in
 * all 39 sampled). The header is spoofable, which is why it only lowers a
 * workflow to a warning and never to silence.
 */
const CABECALHO_GH_AW = /automatically generated by gh-aw\b/i
export const ehLockDoGhAw = (texto) =>
  String(texto)
    .split('\n', 10)
    .some((l) => CABECALHO_GH_AW.test(l))

const ehMarkdown = (caminho) => /\.(?:md|mdx|markdown)$/i.test(caminho)
const ehJs = (caminho) => /\.[cm]?[jt]sx?$/i.test(caminho)
const ehYaml = (caminho) => /\.ya?ml$/i.test(caminho)

// ───────────────────────────────────────────── which shell reads the quotes

const EXTENSOES_PWSH = new Set(['.ps1', '.psm1', '.psd1'])
const EXTENSOES_POSIX = new Set(['.sh', '.bash', '.zsh', '.dash', '.ksh'])

/** The quote models of a shell named by a workflow `shell:`, a shebang or a key; null if none. */
function dialetosDoNome(nome) {
  const m = /^\s*(?:\S*[\\/])?([\w.-]+)/.exec(String(nome))
  if (!m) return null
  const base = m[1].toLowerCase().replace(/\.exe$/, '')
  if (base === 'pwsh' || base === 'powershell') return ['pwsh']
  if (['sh', 'bash', 'zsh', 'dash', 'ksh'].includes(base)) return ['posix']
  return null
}

/** The shell a `#!` line names, through `env` and its options. */
function dialetosDoShebang(texto) {
  const inicio = texto.charCodeAt(0) === 0xfeff ? 1 : 0
  const m = /^#!\s*(\S+)((?:[ \t]+\S+)*)/.exec(texto.slice(inicio, inicio + 200))
  if (!m) return null
  let nome = m[1]
  if (/(?:^|[\\/])env$/.test(nome)) {
    const palavras = m[2].trim().split(/[ \t]+/)
    nome = palavras.find((w) => w && !w.startsWith('-') && !w.includes('=')) || ''
  }
  return dialetosDoNome(nome)
}

/**
 * The quote models an entry is read with, as a list or, for a workflow, a
 * function of the physical line. A PowerShell script, or a file whose shebang
 * names PowerShell, is read as PowerShell; a shell script, a git hook and an
 * extensionless file something starts are read as POSIX shell; a workflow as
 * the shell each step runs (dialetosDoWorkflow). Everything else (Markdown,
 * code, JSON, data) keeps the text reading.
 */
function dialetosDaEntrada(caminho, texto, executado) {
  const extensao = posix.extname(caminho).toLowerCase()
  if (EXTENSOES_PWSH.has(extensao)) return ['pwsh']
  if (EXTENSOES_POSIX.has(extensao)) return ['posix']
  const shebang = dialetosDoShebang(texto)
  if (shebang) return shebang
  if (ehWorkflow(caminho)) return dialetosDoWorkflow(texto)
  if (ehGancho(caminho) || (executado && extensao === '')) return ['posix']
  return ['texto']
}

/**
 * The default shell of a job's runner, by its labels: GitHub runs `run:` with
 * pwsh on Windows and bash elsewhere. An expression (`${{ matrix.os }}`), a
 * self-hosted label with no OS, or a mix is unknown, and reads with both.
 */
function dialetosDoRunner(runsOn) {
  let rotulos = []
  if (typeof runsOn === 'string') rotulos = [runsOn]
  else if (Array.isArray(runsOn)) rotulos = runsOn
  else if (runsOn && typeof runsOn === 'object') rotulos = [runsOn.labels, runsOn.group].flat()
  rotulos = rotulos.filter((r) => typeof r === 'string')
  if (!rotulos.length || rotulos.some((r) => r.includes('${{'))) return AMBOS_OS_SHELLS
  const windows = rotulos.some((r) => /windows/i.test(r))
  const outro = rotulos.some((r) => /ubuntu|linux|macos|darwin/i.test(r))
  if (windows && !outro) return ['pwsh']
  if (outro && !windows) return ['posix']
  return AMBOS_OS_SHELLS
}

/**
 * For a workflow, the quote models of each physical line (0-based). A line of a
 * step's `run:` value is read as the shell that step runs: its `shell:`, else
 * the job's and then the workflow's `defaults.run.shell`, else sh for a job in
 * a container, else the runner's default. A shell that is neither kind (cmd,
 * an expression, a custom command) reads with both. A `run:` value written as
 * a quoted YAML scalar holds its command inside YAML's own quoting, where `\"`
 * is a quote, so a PowerShell step of that kind is read with the POSIX model
 * too. Every other line (an action input, a github-script body) is no shell
 * and keeps the text reading. A workflow the YAML reader refuses (anchors, for
 * one) reads every line with both shell models when it names Windows or
 * PowerShell anywhere, and as POSIX otherwise.
 */
function dialetosDoWorkflow(texto) {
  const reserva = /windows|pwsh|powershell/i.test(texto) ? AMBOS_OS_SHELLS : ['posix']
  let lido
  try {
    lido = lerYaml(texto, { ancoras: true })
  } catch {
    // Choosing a quote model must never break the rule: a document the reader
    // cannot take gets the reserve reading, like one it refuses.
    return () => reserva
  }
  const raiz = lido.valor
  if (lido.erro || !raiz || typeof raiz !== 'object' || Array.isArray(raiz)) return () => reserva
  const linhas = String(texto).split('\n')
  const shellPadrao = (no) => {
    const run = no.defaults && typeof no.defaults === 'object' ? no.defaults.run : null
    return run && typeof run === 'object' && typeof run.shell === 'string' ? run.shell : null
  }
  const dialetosDoShell = (shell) => dialetosDoNome(shell) || AMBOS_OS_SHELLS
  // Every key and item down to a step's own keys is a barrier: a `run:` value
  // ends at the first one after it.
  const barreiras = [...lido.posicoes]
    .filter(([ponteiro]) => ponteiro.split('/').length <= 6)
    .map(([, lugar]) => lugar.linha - 1)
    .sort((a, b) => a - b)
  const faixas = [] // { de, ate, dialetos }: physical lines [de, ate)
  const jobs = raiz.jobs && typeof raiz.jobs === 'object' ? raiz.jobs : {}
  const shellDoWorkflow = shellPadrao(raiz)
  for (const [nome, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object' || !Array.isArray(job.steps)) continue
    const shellDoJob = shellPadrao(job) ?? shellDoWorkflow
    let padrao = dialetosDoRunner(job['runs-on'])
    if (job.container) padrao = ['posix']
    if (shellDoJob !== null) padrao = dialetosDoShell(shellDoJob)
    job.steps.forEach((passo, i) => {
      if (!passo || typeof passo !== 'object' || typeof passo.run !== 'string') return
      const lugar = lido.posicoes.get(`/jobs/${segmento(nome)}/steps/${i}/run`)
      if (!lugar) return
      const de = lugar.linha - 1
      const ate = barreiras.find((b) => b > de) ?? linhas.length
      let dialetos = typeof passo.shell === 'string' ? dialetosDoShell(passo.shell) : padrao
      const citado = /^\s*(?:-\s+)?["']?run["']?\s*:\s*["']/.test(linhas[de] || '')
      if (citado && !dialetos.includes('posix')) dialetos = [...dialetos, 'posix']
      faixas.push({ de, ate, dialetos })
    })
  }
  return (n) => faixas.find((f) => f.de <= n && n < f.ate)?.dialetos || ['texto']
}

const TAREFAS = /(?:^|\/)\.vscode\/tasks\.json$/i
const WORKSPACE = /\.code-workspace$/i
const DEVCONTAINER =
  /(?:^|\/)\.devcontainer\.json$|(?:^|\/)\.devcontainer\/(?:[^/]+\/)?devcontainer\.json$/i
const GANCHOS =
  /(?:^|\/)(?:\.claude\/settings(?:\.local)?\.json|\.cursor\/hooks\.json|\.codex\/hooks\.json|\.github\/hooks\/[^/]+\.json|\.windsurf\/hooks\.json|\.gemini\/settings\.json)$/i

const COMANDOS_DO_DEVCONTAINER = [
  'initializeCommand',
  'onCreateCommand',
  'updateContentCommand',
  'postCreateCommand',
  'postStartCommand',
  'postAttachCommand',
]

const segmento = (chave) => String(chave).replace(/~/g, '~0').replace(/\//g, '~1')
const desfazerSegmento = (s) => s.replace(/~1/g, '/').replace(/~0/g, '~')

/** The text of a command field: a string, `{ value }`, or an argv array. */
function textoDeComando(v) {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.value === 'string') return v.value
  if (Array.isArray(v)) return v.map(textoDeComando).filter(Boolean).join(' ')
  return ''
}

/**
 * Files a command starts: `node x.js`, `bash x.sh`, `python x.py`, a
 * `deno run` or `bun` of a file, and a command whose first word is a relative
 * path. Only tracked files count, resolved from the config's folder, its
 * parent, and the repository root. One level: a file these files start is not
 * followed.
 */
const RE_INTERPRETADOR =
  /(?:^|[\s;&|(])(node|nodejs|tsx|ts-node|bun|deno|sh|bash|zsh|dash|python|python3|pwsh|powershell)(?:\.exe)?(?=\s)/g

/**
 * Options whose value is a module the Node family LOADS before the entry: the
 * value is a file that runs, and the entry is still to come. Measured: `node -r
 * ./scripts/t.js other.js`, `--import ./scripts/t.js` and `--require=./scripts/t.js`
 * in a postinstall ran scripts/t.js first, and the rule, which skipped the value,
 * left the file a warning. Each value is followed as a file of its own.
 */
const OPCOES_DE_PRELOAD = new Set([
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
])
const FAMILIA_NODE = new Set(['node', 'nodejs', 'bun', 'tsx', 'ts-node'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])

/**
 * Options that take the NEXT word as their value, so that word is not the file
 * the interpreter runs. Measured: `node -r dotenv/config scripts/t.js` and
 * `node --import tsx scripts/t.js` in a postinstall took the preload module as
 * the entry, found it untracked, and scripts/t.js fell to a warning; and with
 * Node 24.13 `--watch-path src x.js`, `--diagnostic-dir d x.js`, `--report-dir`,
 * `--redirect-warnings`, `--disable-warning` and `--test-reporter` all took the
 * next word as their value and ran x.js. An option missing here is not fatal:
 * the word after an unknown option is tried (see entradasDepois).
 */
const NODE_COM_VALOR = [
  ...OPCOES_DE_PRELOAD,
  '-C',
  '--conditions',
  '--env-file',
  '--env-file-if-exists',
  '--input-type',
  '--title',
  '--inspect-port',
  '--watch-path',
  '--cpu-prof-dir',
  '--cpu-prof-name',
  '--heap-prof-dir',
  '--heap-prof-name',
  '--diagnostic-dir',
  '--report-dir',
  '--report-filename',
  '--redirect-warnings',
  '--disable-warning',
  '--test-reporter',
  '--test-reporter-destination',
]
/**
 * The shells take a value after `-o`/`+o` (a `set -o` option name), `-O`/`+O`
 * (a shopt name, bash) and the rc-file options. Measured before: `bash -o
 * pipefail scripts/hook` took `pipefail` as the entry, found nothing tracked,
 * and the extensionless script, a failure with `bash -e scripts/hook`, fell to
 * a warning. In a short group every `o` or `O` takes the next word
 * (`bash -eo pipefail x`), which entradasDepois counts.
 */
const SHELL_COM_VALOR = ['-o', '+o', '-O', '+O', '--rcfile', '--init-file']
const OPCOES_COM_VALOR = {
  sh: SHELL_COM_VALOR,
  bash: SHELL_COM_VALOR,
  zsh: SHELL_COM_VALOR,
  dash: SHELL_COM_VALOR,
  node: NODE_COM_VALOR,
  nodejs: NODE_COM_VALOR,
  bun: NODE_COM_VALOR,
  tsx: [...NODE_COM_VALOR, '--tsconfig'],
  'ts-node': [...NODE_COM_VALOR, '-P', '--project', '-O', '--compiler-options'],
  python: ['-W', '-X'],
  python3: ['-W', '-X'],
  deno: ['--config', '--import-map', '--env-file', '--location', '--seed', '--v8-flags'],
}

/**
 * The words of a command as a shell hands them over: quotes removed, a quoted
 * string one word, a backslash outside single quotes escaping a quote, a blank
 * or a shell operator, and every redirection dropped with its target, glued or
 * not. Measured before: `node scripts/t.js>/dev/null` kept the redirection in
 * the file word, which then named nothing tracked.
 */
function palavrasDoShell(texto) {
  const saida = []
  let atual = ''
  let tem = false
  const n = texto.length
  const fechar = () => {
    if (tem) saida.push(atual)
    atual = ''
    tem = false
  }
  for (let i = 0; i < n; i++) {
    const c = texto[i]
    if (/\s/.test(c)) {
      fechar()
      continue
    }
    if (c === "'") {
      const fim = texto.indexOf(c, i + 1)
      // A quote that never closes is a character (an apostrophe in prose).
      atual += fim === -1 ? c : texto.slice(i + 1, fim)
      if (fim !== -1) i = fim
      tem = true
      continue
    }
    if (c === '"' || c === '`') {
      let j = i + 1
      let parte = ''
      while (j < n && texto[j] !== c) {
        if (texto[j] === '\\' && j + 1 < n) j++
        parte += texto[j]
        j++
      }
      atual += j < n ? parte : c
      if (j < n) i = j
      tem = true
      continue
    }
    if (c === '\\' && i + 1 < n && /[\s"'`\\;&|<>()$]/.test(texto[i + 1])) {
      atual += texto[++i]
      tem = true
      continue
    }
    if (c === '<' || c === '>' || (c === '&' && texto[i + 1] === '>')) {
      // `2>` names a descriptor; any other word before the operator is a word.
      if (/^\d+$/.test(atual)) {
        atual = ''
        tem = false
      } else fechar()
      let j = i
      while (j < n && /[<>&|]/.test(texto[j])) j++
      if (texto[j - 1] === '&' && /[\d-]/.test(texto[j] ?? '')) {
        // `>&2`, `<&0`, `>&-`: the target is a descriptor.
        while (j < n && /[\d-]/.test(texto[j])) j++
      } else {
        while (j < n && /\s/.test(texto[j])) j++
        // The target: one word, quoted parts included, is dropped.
        while (j < n && !/\s/.test(texto[j])) {
          const q = texto[j]
          const fim = q === '"' || q === "'" ? texto.indexOf(q, j + 1) : -1
          j = fim === -1 ? j + 1 : fim + 1
        }
      }
      i = j - 1
      continue
    }
    atual += c
    tem = true
  }
  fechar()
  return saida
}

// ──────────────────────────────────────── which agent a shell command starts
//
// ai-workflow-untrusted-input asks a narrower question than the tables: does
// this `run:` step START an agent CLI at all, whatever its switches. A first-
// word reading was measured against 74 real CLI steps and missed 13 of them in
// 6 files, 5 of those failures: the agent sat inside a command substitution
// (`result=$(<agent> -p ...)`, `if raw=$(timeout 1200s <agent> -p ...)`), or
// behind `timeout --signal=TERM --kill-after=30s 20m env -u X`. So the text of
// every substitution is a command too, and the launcher words are skipped with
// their own options.

/**
 * The text inside each `$(...)` and each pair of backticks of `texto`, quotes
 * read the POSIX way: a `)` or a backtick inside quotes closes nothing. An
 * unclosed substitution runs to the end of the text, which a line cut at a
 * shell operator inside the substitution needs.
 */
function substituicoes(texto) {
  const saida = []
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === "'") {
      const fim = texto.indexOf("'", i + 1)
      if (fim !== -1) i = fim
      continue
    }
    const crase = c === '`'
    if (!crase && !(c === '$' && texto[i + 1] === '(')) continue
    let j = crase ? i + 1 : i + 2
    let profundidade = 1
    let aspa = null
    for (; j < texto.length; j++) {
      const d = texto[j]
      if (d === '\\') {
        j++
        continue
      }
      if (aspa) {
        if (d === aspa) aspa = null
        continue
      }
      if (d === '"' || d === "'") aspa = d
      else if (crase && d === '`') break
      else if (!crase && d === '(') profundidade++
      else if (!crase && d === ')' && --profundidade === 0) break
    }
    const dentro = texto.slice(crase ? i + 1 : i + 2, j)
    saida.push(dentro, ...substituicoes(dentro))
    i = j
  }
  return saida
}

/**
 * The commands of a shell text as a shell splits them: logical lines (a
 * backslash continuation joins lines), cut at `;`, `&&`, `||`, `|` and `&`
 * outside quotes, plus the text of every command substitution, each as the
 * words the program receives. `linha` is the 1-based physical line where the
 * command's logical line starts.
 */
export function comandosDoShell(texto, dialeto = 'posix') {
  const saida = []
  for (const logica of linhasLogicas(String(texto))) {
    const linha = logica.partes[0].linha + 1
    const textos = [logica.texto.replace(/\r$/, '')]
    if (/[$`]/.test(textos[0])) textos.push(...substituicoes(textos[0]))
    for (const t of textos) {
      for (const comando of comandosDe(t, dialeto)) {
        const palavras = palavrasDoShell(comando.texto)
        if (palavras.length) saida.push({ linha, palavras })
      }
    }
  }
  return saida
}

/** Shell words that open a compound command: the command proper comes after them. */
const PALAVRAS_DE_CONTROLE = new Set([
  'if',
  'then',
  'elif',
  'else',
  'while',
  'until',
  'do',
  '!',
  '{',
  '(',
])

/**
 * Launchers that start the next word as the program, with the options each one
 * takes a value for. `timeout` also takes its duration before the program.
 */
const LANCADORES = {
  sudo: new Set(['-u', '-g', '-C', '-h', '-p', '-U', '-r', '-t', '-D', '-R', '-T']),
  env: new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string']),
  nohup: new Set(),
  time: new Set(),
  exec: new Set(['-a']),
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  npx: new Set(['-p', '--package', '-c', '--call']),
  bunx: new Set(['-p', '--package']),
  pnpx: new Set(['-p', '--package']),
  stdbuf: new Set(['-i', '-o', '-e']),
}
/** Two-word launchers: `pnpm dlx`, `yarn dlx`, `npm exec`, `npm x`. */
const LANCADORES_DUPLOS = { pnpm: ['dlx'], yarn: ['dlx'], npm: ['exec', 'x'] }

/** The binary names of every CLI, one word or two (`q chat`), to the CLI id. */
const NOMES_DE_AGENTE = new Map(CLIS.flatMap((cli) => cli.nomes.map((nome) => [nome, cli.id])))

/** A program word with its Windows shim extension and npm version taken off. */
function semVersao(palavra) {
  const semExtensao = palavra.replace(/\.(?:exe|cmd)$/i, '')
  // `@scope/pkg@1.2` keeps the first `@`; `pkg@latest` loses what follows the only one.
  const arroba = semExtensao.indexOf('@', semExtensao.startsWith('@') ? 1 : 0)
  return arroba > 0 ? semExtensao.slice(0, arroba) : semExtensao
}

/**
 * The id of the agent CLI that the words of one command start, or null. It skips
 * `NAME=value` assignments, the shell's compound-command words, and the
 * launchers above with their options (`sudo`, `env -u X -i`, `nohup`, `time`,
 * `exec`, `timeout --signal=TERM 20m`, `npx -y -p pkg`, `bunx`, `pnpx`,
 * `pnpm dlx`, `yarn dlx`, `npm exec --`). The program word is compared whole
 * (a scoped package) and by its basename (a path to the binary).
 */
export function agenteDoComando(palavras) {
  const lista = Array.isArray(palavras) ? palavras.filter((p) => typeof p === 'string') : []
  let i = 0
  while (i < lista.length) {
    const w = lista[i].replace(/^[({]+/, '')
    if (w === '') {
      i++
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/.test(w) || PALAVRAS_DE_CONTROLE.has(w)) {
      i++
      continue
    }
    const nome = posix.basename(w.replace(/\\/g, '/'))
    const duplo = LANCADORES_DUPLOS[nome]
    if (duplo && duplo.includes(lista[i + 1])) {
      i += 2
      while (lista[i] === '--' || /^-/.test(lista[i] || '')) i++
      continue
    }
    const opcoesComValor = LANCADORES[nome]
    if (opcoesComValor) {
      i++
      while (i < lista.length) {
        const o = lista[i]
        if (o === '--') {
          i++
          break
        }
        if (!/^-/.test(o)) break
        i += !o.includes('=') && opcoesComValor.has(o) ? 2 : 1
      }
      if (nome === 'timeout' && i < lista.length) i++
      continue
    }
    const inteiro = semVersao(w)
    const base = semVersao(nome)
    for (const candidato of [inteiro, base]) {
      if (NOMES_DE_AGENTE.has(candidato)) return NOMES_DE_AGENTE.get(candidato)
      const dois = `${candidato} ${lista[i + 1] ?? ''}`
      if (NOMES_DE_AGENTE.has(dois)) return NOMES_DE_AGENTE.get(dois)
    }
    return null
  }
  return null
}

/**
 * The extensions of the files each interpreter runs as a program. After an
 * option of unknown arity, a word past the first one counts as the entry only
 * when the tracked file it names has one of these.
 */
const EXTENSOES_EXECUTAVEIS = {
  node: ['.js', '.cjs', '.mjs'],
  nodejs: ['.js', '.cjs', '.mjs'],
  tsx: ['.js', '.cjs', '.mjs', '.ts', '.mts', '.cts', '.tsx', '.jsx'],
  'ts-node': ['.js', '.cjs', '.mjs', '.ts', '.mts', '.cts', '.tsx', '.jsx'],
  bun: ['.js', '.cjs', '.mjs', '.ts', '.mts', '.cts', '.tsx', '.jsx'],
  deno: ['.js', '.mjs', '.ts', '.mts', '.tsx', '.jsx'],
  python: ['.py', '.pyw'],
  python3: ['.py', '.pyw'],
  sh: ['.sh', '.bash', '.zsh', '.dash', '.ksh'],
  bash: ['.sh', '.bash', '.zsh', '.dash', '.ksh'],
  zsh: ['.sh', '.bash', '.zsh', '.dash', '.ksh'],
  dash: ['.sh', '.bash', '.zsh', '.dash', '.ksh'],
  pwsh: ['.ps1'],
  powershell: ['.ps1'],
}

/**
 * What an interpreter's arguments start, as lists of words to try in order
 * (the first word that names a tracked file wins in each list), plus the command
 * strings a shell runs with `-c`. A word is { palavra, soExecutavel }:
 * - the value of each preload option of the Node family, as a list of its own;
 * - the entry: the first word that is not an option or an option's value. After
 *   an option of unknown arity that word may be the option's value instead, so
 *   the word after it is tried too, but only when it names a tracked file the
 *   interpreter runs as a program (`soExecutavel`). Measured before: with
 *   `node --inspect dist/build.js docs/prompt.txt` the untracked build was
 *   skipped and the tracked text file, an argument of the build, was taken as
 *   the file the lifecycle script runs.
 */
function entradasDepois(resto, interpretador) {
  const comValor = new Set(OPCOES_COM_VALOR[interpretador] || [])
  const palavras = palavrasDoShell(resto).map((w) => w.replace(/^\(+|\)+$/g, ''))
  const listas = []
  const internos = []
  const principal = []
  let aposOpcaoIncerta = false
  for (let i = 0; i < palavras.length; i++) {
    const w = palavras[i]
    if (!w) continue
    if (principal.length === 0 && w === 'run') continue
    if (w === '--') {
      aposOpcaoIncerta = false
      continue
    }
    // A shell also turns an option off with `+` (`bash +e +o posix x`).
    const opcaoDeShell = SHELLS.has(interpretador) && /^\+[A-Za-z]/.test(w)
    if ((w.startsWith('-') && w.length > 1) || opcaoDeShell) {
      const igual = w.indexOf('=')
      const nome = igual > 0 ? w.slice(0, igual) : w
      if (FAMILIA_NODE.has(interpretador) && OPCOES_DE_PRELOAD.has(nome)) {
        const valor = igual > 0 ? w.slice(igual + 1) : palavras[++i]
        if (valor) listas.push([{ palavra: valor, soExecutavel: false }])
        aposOpcaoIncerta = false
        continue
      }
      if (SHELLS.has(interpretador) && /^-[A-Za-z]*c[A-Za-z]*$/.test(w)) {
        if (palavras[i + 1]) internos.push(palavras[i + 1])
        break
      }
      // A short group of a shell: each `o`/`O` in it takes one word
      // (`-eo pipefail`, `-oO pipefail extglob`).
      const grupoDeShell = SHELLS.has(interpretador) && /^[-+][A-Za-z]{2,}$/.test(w)
      if (grupoDeShell) {
        i += (w.match(/o/gi) || []).length
        aposOpcaoIncerta = false
      } else if (igual < 0 && comValor.has(w)) {
        i++
        aposOpcaoIncerta = false
      } else {
        aposOpcaoIncerta = igual < 0
      }
      continue
    }
    principal.push({ palavra: w, soExecutavel: principal.length > 0 })
    if (!aposOpcaoIncerta) break
    aposOpcaoIncerta = false
  }
  if (principal.length) listas.push(principal)
  return { listas, internos }
}
const PREFIXOS_DE_PASTA =
  /^(?:"?\$\{?(?:CLAUDE_PROJECT_DIR|workspaceFolder|workspaceRoot|PWD)\}?"?\/|\.\/)+/

/**
 * The extensions a runtime adds to an entry named without one, in the order it
 * tries them. Measured: `node scripts/t` ran scripts/t.js and `node scripts` ran
 * scripts/index.js, with and without "type": "module" in package.json, so a
 * lifecycle script that dropped the extension turned its file from a failure
 * into a warning. tsx, ts-node and bun add the TypeScript ones.
 */
const EXTENSOES_DO_NODE = ['.js', '.cjs', '.mjs', '.json']
const EXTENSOES_DE_ENTRADA = {
  node: EXTENSOES_DO_NODE,
  nodejs: EXTENSOES_DO_NODE,
  tsx: [...EXTENSOES_DO_NODE, '.ts', '.mts', '.cts', '.tsx'],
  'ts-node': [...EXTENSOES_DO_NODE, '.ts', '.mts', '.cts', '.tsx'],
  bun: [...EXTENSOES_DO_NODE, '.ts', '.mts', '.cts', '.tsx'],
}

/**
 * The tracked file an interpreter runs for the word `p`: `p` itself, then, for
 * the Node family, `p` plus an extension, the `main` of a tracked
 * `p/package.json`, and `p/index` plus an extension; for Python, the
 * `__main__.py` of a folder. null when nothing tracked answers.
 */
function entradaDoInterpretador(p, interpretador, porCaminho) {
  if (p !== '.' && porCaminho.has(p)) return p
  // `.` is the folder the command runs in: `node .` starts the root main.
  const dentro = (nome) => (p === '.' ? nome : `${p}/${nome}`)
  if (interpretador === 'python' || interpretador === 'python3') {
    return porCaminho.has(dentro('__main__.py')) ? dentro('__main__.py') : null
  }
  const extensoes = EXTENSOES_DE_ENTRADA[interpretador]
  if (!extensoes) return null
  const comExtensao = (q) => extensoes.map((x) => q + x).find((x) => porCaminho.has(x)) || null
  const pacote = porCaminho.get(dentro('package.json'))
  let principal = null
  if (pacote && pacote.texto !== null) {
    const r = lerJsonc(pacote.texto, { estrito: true })
    const main = !r.erro && r.valor && typeof r.valor === 'object' ? r.valor.main : null
    if (typeof main === 'string' && main.trim()) {
      const alvo = posix.normalize(posix.join(p, main.trim()))
      if (alvo !== '..' && !alvo.startsWith('../')) {
        principal = porCaminho.has(alvo) ? alvo : comExtensao(alvo) || comExtensao(`${alvo}/index`)
      }
    }
  }
  return (p === '.' ? null : comExtensao(p)) || principal || comExtensao(dentro('index'))
}

function arquivosDoComando(comando, base, porCaminho, profundidade = 0) {
  // Each candidate is a list of words tried in order; the first one that names
  // a tracked file is the file the command starts.
  const candidatos = []
  const internos = []
  for (const { texto } of String(comando)
    .split(/\r?\n/)
    .flatMap((l) => comandosDe(l))) {
    for (const m of texto.matchAll(RE_INTERPRETADOR)) {
      const achados = entradasDepois(texto.slice(m.index + m[0].length), m[1])
      for (const brutos of achados.listas) candidatos.push({ brutos, interpretador: m[1] })
      internos.push(...achados.internos)
    }
    const primeira = palavrasDoShell(texto).find((p) => !/^\w+=/.test(p))
    if (primeira && primeira.includes('/')) {
      candidatos.push({ brutos: [{ palavra: primeira, soExecutavel: false }], interpretador: null })
    }
  }
  const bases = [...new Set([base, posix.dirname(base), ''].map((b) => (b === '.' ? '' : b)))]
  const achados = []
  const resolver = (bruto, interpretador) => {
    const limpo = bruto.replace(PREFIXOS_DE_PASTA, '')
    if (!limpo || /^(?:[\\/]|[A-Za-z]:|~)/.test(limpo)) return null
    for (const b of bases) {
      const p = posix.normalize(posix.join(b, limpo)).replace(/(.)\/+$/, '$1')
      if (p === '..' || p.startsWith('../')) continue
      const alvo = entradaDoInterpretador(p, interpretador, porCaminho)
      if (alvo) return alvo
    }
    return null
  }
  for (const { brutos, interpretador } of candidatos) {
    for (const { palavra, soExecutavel } of brutos) {
      const alvo = resolver(palavra, interpretador)
      const extensao = posix.extname(alvo || '').toLowerCase()
      // A shell script often has no extension (scripts/bootstrap, bin/setup):
      // for a shell, a tracked file with none is a program too.
      const programa =
        (EXTENSOES_EXECUTAVEIS[interpretador] || []).includes(extensao) ||
        (SHELLS.has(interpretador) && extensao === '')
      if (alvo && (!soExecutavel || programa)) {
        achados.push(alvo)
        break
      }
    }
  }
  // `sh -c "node scripts/t.js"`: the string a shell runs is a command too.
  if (profundidade < 3) {
    for (const interno of internos) {
      achados.push(...arquivosDoComando(interno, base, porCaminho, profundidade + 1))
    }
  }
  return achados
}

/**
 * Every string VALUE of a document that strict JSON already parsed, with the
 * path of keys and indices that leads to it and its [inicio, fim) offsets,
 * quotes included. Duplicated keys yield every copy, which is what lets a
 * caller judge the copy a lenient reader keeps and the one it drops.
 */
function cadeiasDoJson(texto) {
  const saida = []
  const n = texto.length
  let i = texto.charCodeAt(0) === 0xfeff ? 1 : 0
  const branco = () => {
    while (
      i < n &&
      (texto[i] === ' ' || texto[i] === '\t' || texto[i] === '\r' || texto[i] === '\n')
    )
      i++
  }
  const cadeia = () => {
    const inicio = i
    i++
    while (i < n && texto[i] !== '"') i += texto[i] === '\\' ? 2 : 1
    i++
    return [inicio, i]
  }
  // Iterative on purpose: lerJsonc allows 512 levels, and the walk must not be
  // the part that overflows the stack.
  const pilha = []
  const valor = (caminho) => {
    branco()
    const c = texto[i]
    if (c === '"') {
      const [inicio, fim] = cadeia()
      saida.push({ caminho, inicio, fim })
      return null
    }
    if (c === '{' || c === '[') {
      i++
      return { caminho, objeto: c === '{', indice: 0 }
    }
    while (i < n && !',}] \t\r\n'.includes(texto[i])) i++
    return null
  }
  const raiz = valor([])
  if (raiz) pilha.push(raiz)
  while (pilha.length) {
    const topo = pilha[pilha.length - 1]
    branco()
    if (texto[i] === ',') {
      i++
      branco()
    }
    if (i >= n || texto[i] === '}' || texto[i] === ']') {
      i++
      pilha.pop()
      continue
    }
    let chave = topo.indice++
    if (topo.objeto) {
      const [inicio, fim] = cadeia()
      chave = JSON.parse(texto.slice(inicio, fim))
      branco()
      i++ // the colon
    }
    const filho = valor([...topo.caminho, chave])
    if (filho) pilha.push(filho)
  }
  return saida
}

/** The scripts of one package.json, every occurrence of a duplicated key included. */
function scriptsDe(r) {
  const lista = []
  const duplicados = new Set()
  for (const d of r.duplicatas) {
    if (d.ponteiro === '/scripts') {
      duplicados.add('/scripts')
      for (const o of d.ocorrencias) {
        if (!o.valor || typeof o.valor !== 'object') continue
        for (const [nome, valor] of Object.entries(o.valor)) {
          lista.push({ nome, valor, linha: o.linha, coluna: o.coluna })
        }
      }
      continue
    }
    const m = /^\/scripts\/([^/]+)$/.exec(d.ponteiro)
    if (!m) continue
    duplicados.add(d.ponteiro)
    for (const o of d.ocorrencias) {
      lista.push({ nome: desfazerSegmento(m[1]), valor: o.valor, linha: o.linha, coluna: o.coluna })
    }
  }
  const scripts = r.valor && typeof r.valor === 'object' ? r.valor.scripts : null
  if (
    scripts &&
    typeof scripts === 'object' &&
    !Array.isArray(scripts) &&
    !duplicados.has('/scripts')
  ) {
    for (const [nome, valor] of Object.entries(scripts)) {
      const ponteiro = `/scripts/${segmento(nome)}`
      if (duplicados.has(ponteiro)) continue
      const pos = r.posicoes.get(ponteiro) || { linha: 1, coluna: 1 }
      lista.push({ nome, valor, linha: pos.linha, coluna: pos.coluna })
    }
  }
  return lista.filter((s) => typeof s.valor === 'string')
}

/**
 * The package-script runners, with the options that change WHICH package.json
 * a script name is looked up in. Each runner has its own table because the
 * same letter means different things: `npm -w <name>` is a workspace, and
 * `pnpm -w` is --workspace-root, a switch with no value (measured before one
 * shared table: `pnpm -w run ai` in a hook took `run` as a package name and
 * the script fell from a failure to a warning).
 *   pasta   the value is a folder holding the package.json
 *   pacote  the value is a workspace folder or a package name
 *   raiz    no value: the workspace root (pnpm)
 *   valor   the value is taken and says nothing about the package
 */
const EXECUTORES_DE_SCRIPT = (() => {
  const valor = ['--userconfig', '--cache', '--registry', '--loglevel', '--reporter']
  const tabela = (pasta, pacote, raiz = []) => ({
    pasta: new Set(pasta),
    pacote: new Set(pacote),
    raiz: new Set(raiz),
    valor: new Set(valor),
  })
  return new Map([
    ['npm', tabela(['--prefix', '-C'], ['-w', '--workspace'])],
    ['pnpm', tabela(['-C', '--dir'], ['-F', '--filter'], ['-w', '--workspace-root'])],
    ['yarn', tabela(['--cwd'], [])],
    ['bun', tabela(['--cwd'], ['-F', '--filter'])],
  ])
})()
const ALIASES_DE_RUN = new Set(['run', 'run-script', 'rum', 'urn'])

/**
 * The package scripts a command calls by name, each with where its package is
 * when an option says so: `{ nome, pasta, pacote, raiz }`. The words are the
 * shell's (quotes removed, redirections dropped), so `npm run --silent ai`,
 * `npm --prefix . run ai`, `/usr/local/bin/npm run ai`, `npm.cmd run ai`,
 * `yarn workspace x run ai` and a runner behind another command (`npx --no --
 * npm run ai`, `cross-env X=1 npm run ai`) all name `ai`. Measured before,
 * with a regular expression over the raw line: the option forms and the full
 * path passed a hook calling a script that starts an agent CLI with its
 * approval switch off, with only a warning. An option this table does not know
 * is read as a switch, so the word after it can be taken as the script name,
 * which then names nothing.
 *
 * Each line is read twice and the calls of both readings are kept. The first
 * reading cuts at the shell's separators outside quotes. The second one ignores
 * quotes, cuts also at `(`, `)` and a backtick, and blanks every quote and
 * backslash: a subshell, a command substitution (inside double quotes too) and
 * a quoted `sh -c` body are commands, and the words of the first reading keep
 * `(npm` and `ai)` glued. Measured with the first reading alone, over 26 hook
 * lines: 12 that main's quote-blind regular expression followed passed with a
 * warning, among them `(npm run ai)`, `x=$(npm run ai)`, `echo "$(npm run ai)"`,
 * `(cd . && npm run ai)`, `cat <(npm run ai)` and `sh -c 'x;npm run ai'`. The
 * second reading can name a script inside an echoed string, as main did; it
 * only makes the rule follow a script, which still fails only when it starts an
 * agent CLI with its approval switch off.
 */
function chamadasDeScript(comando) {
  const saida = []
  const vistas = new Set()
  for (const linha of String(comando).split(/\r?\n/)) {
    const textos = [
      ...comandosDe(linha, 'posix').map((c) => c.texto),
      ...linha.replace(/["'\\]/g, ' ').split(/[;&|()`]/),
    ]
    for (const texto of textos) {
      const w = palavrasDoShell(texto)
      for (let i = 0; i < w.length; i++) {
        const programa = w[i]
          .split(/[\\/]/)
          .pop()
          .toLowerCase()
          .replace(/\.(?:cmd|exe)$/, '')
        const opcoes = EXECUTORES_DE_SCRIPT.get(programa)
        if (!opcoes) continue
        let pasta = null
        let pacote = null
        let raiz = false
        let passouRun = false
        let k = i + 1
        for (; k < w.length; k++) {
          const p = w[k]
          if (p === '--') break
          if (p.length > 1 && p.startsWith('-')) {
            const igual = p.indexOf('=')
            const nome = igual > 0 ? p.slice(0, igual) : p
            if (opcoes.raiz.has(nome)) {
              raiz = true
              continue
            }
            const comValor =
              opcoes.pasta.has(nome) || opcoes.pacote.has(nome) || opcoes.valor.has(nome)
            if (!comValor) continue
            const v = igual > 0 ? p.slice(igual + 1) : w[++k]
            if (v && opcoes.pasta.has(nome)) pasta = v
            if (v && opcoes.pacote.has(nome)) pacote = v
            continue
          }
          if (programa === 'yarn' && p === 'workspace' && !passouRun && pacote === null) {
            pacote = w[++k] || null
            continue
          }
          if (!passouRun && ALIASES_DE_RUN.has(p)) {
            passouRun = true
            continue
          }
          const chave = JSON.stringify([p, pasta, pacote, raiz])
          if (!vistas.has(chave)) saida.push({ nome: p, pasta, pacote, raiz })
          vistas.add(chave)
          break
        }
        i = k
      }
    }
  }
  return saida
}

/**
 * Commands an editor, a devcontainer or an agent runs by itself, with their JSON
 * pointer and the quote models of the shell that runs them: a platform variant
 * names its shell (`linux`, `osx`, `bash`, `sh` are POSIX; `powershell` is
 * PowerShell), and a command whose shell depends on the machine (a task's
 * default and its `windows` variant, which run in the user's terminal profile,
 * a devcontainer's initializeCommand, which runs on the host, an agent hook's
 * `command`) reads with both.
 */
function comandosAutomaticos(caminho, valor) {
  const saida = []
  if (!valor || typeof valor !== 'object') return saida
  const empurrar = (comando, ponteiro, rotulo, dialetos = AMBOS_OS_SHELLS) => {
    if (comando && comando.trim()) saida.push({ comando, ponteiro, rotulo, dialetos })
  }
  const dialetosDaChave = (chave) =>
    ['linux', 'osx', 'bash', 'sh'].includes(chave)
      ? ['posix']
      : chave === 'powershell'
        ? ['pwsh']
        : AMBOS_OS_SHELLS

  const tarefas = (lista, base) => {
    if (!Array.isArray(lista)) return
    const porRotulo = new Map()
    lista.forEach((t, i) => {
      if (t && typeof t === 'object' && typeof t.label === 'string') porRotulo.set(t.label, i)
    })
    const rodam = new Set()
    lista.forEach((t, i) => {
      if (t && typeof t === 'object' && t.runOptions?.runOn === 'folderOpen') rodam.add(i)
    })
    // A task started on folder open also starts what it depends on.
    for (let mudou = true; mudou;) {
      mudou = false
      for (const i of [...rodam]) {
        const dep = lista[i]?.dependsOn
        for (const d of [dep].flat()) {
          const rotulo = typeof d === 'string' ? d : d && typeof d === 'object' ? d.label : null
          const k = porRotulo.get(rotulo)
          if (k !== undefined && !rodam.has(k)) {
            rodam.add(k)
            mudou = true
          }
        }
      }
    }
    for (const i of rodam) {
      const t = lista[i]
      for (const [chave, variante] of [
        ['', t],
        ['windows', t.windows],
        ['linux', t.linux],
        ['osx', t.osx],
      ]) {
        if (!variante || typeof variante !== 'object') continue
        const args = Array.isArray(variante.args) ? variante.args.map(textoDeComando) : []
        empurrar(
          [textoDeComando(variante.command), ...args].filter(Boolean).join(' '),
          `${base}/${i}`,
          'task run on folder open',
          dialetosDaChave(chave),
        )
      }
    }
  }

  if (TAREFAS.test(caminho)) tarefas(valor.tasks, '/tasks')
  if (WORKSPACE.test(caminho) && valor.tasks && typeof valor.tasks === 'object') {
    tarefas(valor.tasks.tasks, '/tasks/tasks')
  }
  if (DEVCONTAINER.test(caminho)) {
    for (const chave of COMANDOS_DO_DEVCONTAINER) {
      const v = valor[chave]
      const rotulo = `devcontainer ${chave}`
      // Every command but initializeCommand runs inside the Linux container.
      const dialetos = chave === 'initializeCommand' ? AMBOS_OS_SHELLS : ['posix']
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [nome, sub] of Object.entries(v)) {
          empurrar(textoDeComando(sub), `/${chave}/${segmento(nome)}`, rotulo, dialetos)
        }
      } else {
        empurrar(textoDeComando(v), `/${chave}`, rotulo, dialetos)
      }
    }
  }
  if (GANCHOS.test(caminho)) {
    const andar = (no, ponteiro, profundidade) => {
      if (profundidade > 64 || !no || typeof no !== 'object') return
      if (Array.isArray(no)) {
        no.forEach((x, i) => andar(x, `${ponteiro}/${i}`, profundidade + 1))
        return
      }
      if (typeof no.command === 'string') {
        const args = Array.isArray(no.args) ? no.args.filter((a) => typeof a === 'string') : []
        empurrar([no.command, ...args].join(' '), ponteiro, 'agent hook command')
      }
      for (const k of ['bash', 'powershell', 'sh', 'windows', 'linux', 'osx']) {
        if (typeof no[k] === 'string') {
          empurrar(no[k], `${ponteiro}/${k}`, 'agent hook command', dialetosDaChave(k))
        }
      }
      for (const [k, v] of Object.entries(no))
        andar(v, `${ponteiro}/${segmento(k)}`, profundidade + 1)
    }
    andar(valor.hooks, '/hooks', 0)
    for (const k of ['statusLine', 'subagentStatusLine', 'fileSuggestion']) {
      andar(valor[k], `/${k}`, 0)
    }
  }
  return saida
}

function soCercas(texto) {
  const saida = []
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
        saida.push('')
      } else {
        saida.push(bruta)
      }
      continue
    }
    if (abre) cerca = abre[1]
    saida.push('')
  }
  return saida.join('\n')
}

// ─────────────────────────────────────── the official agent actions' inputs
//
// The vendor GitHub Actions start the same CLIs, and take the approval setting
// as an INPUT instead of a switch on a `run:` line, so the rows above, which
// need the binary and the switch in one command, never saw them. Measured on
// 1,660 workflows of agent adopters: 22 files turn the Codex sandbox off
// through the action's input and 1 turns the Claude permission prompts off
// through its settings input. Each input is rebuilt here into the command the
// action itself runs, and that command goes through the same rows.

/**
 * Validates ACOES_DE_AGENTE, the table of agent actions that
 * ai-workflow-untrusted-input owns and this rule reads: rows of
 * [RegExp, explicacao, dados]. Missing or malformed THROWS, which the executor
 * reports as quebrou.
 */
export function validarAcoesDeAgente(tabela) {
  if (!Array.isArray(tabela) || tabela.length === 0) {
    throw new Error('table ACOES_DE_AGENTE is missing or empty')
  }
  tabela.forEach((row, i) => {
    const dados = Array.isArray(row) ? row[2] : null
    const lista = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')
    const ok =
      Array.isArray(row) &&
      row.length === 3 &&
      row[0] instanceof RegExp &&
      typeof row[1] === 'string' &&
      dados !== null &&
      typeof dados === 'object' &&
      typeof dados.agente === 'string' &&
      lista(dados.texto) &&
      lista(dados.autenticacao) &&
      lista(dados.saidas) &&
      (dados.aprovacao === null || typeof dados.aprovacao === 'string') &&
      (dados.portao === null ||
        (dados.portao !== undefined &&
          Array.isArray(dados.portao.abridores) &&
          dados.portao.abridores.every(
            (a) => Array.isArray(a) && typeof a[0] === 'string' && typeof a[1] === 'string',
          )))
    if (!ok) throw new Error(`ACOES_DE_AGENTE[${i}] is not [RegExp, explicacao, dados]`)
  })
  return tabela
}

/**
 * The ACOES_DE_AGENTE row a step's `uses` names, or null: trimmed, with the
 * `@ref` and a trailing slash dropped, lowercased, the first row that matches.
 * A local action (`./`) and a container (`docker://`) are never a vendor action.
 */
export function acaoDoUses(uses, ACOES_DE_AGENTE) {
  if (typeof uses !== 'string') return null
  const bruto = uses.trim()
  if (bruto.startsWith('./') || /^docker:\/\//i.test(bruto)) return null
  const arroba = bruto.indexOf('@')
  const alvo = (arroba === -1 ? bruto : bruto.slice(0, arroba)).replace(/\/+$/, '').toLowerCase()
  for (const row of ACOES_DE_AGENTE) {
    if (row[0].test(alvo)) return { explicacao: row[1], dados: row[2] }
  }
  return null
}

const ACAO_LOCAL = /(?:^|\/)action\.ya?ml$/i
const ehMapa = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A shell word as POSIX reads it back: bare when it is safe, single-quoted otherwise. */
const citarPosix = (w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`)

/** The words `codex-args` holds: a JSON array of strings, else a shell-like string. */
function argumentosDoCodex(valor) {
  if (Array.isArray(valor)) return valor.filter((x) => typeof x === 'string')
  if (typeof valor !== 'string' || !valor.trim()) return []
  const lido = lerJsonc(valor.trim(), { estrito: true })
  if (!lido.erro && Array.isArray(lido.valor) && lido.valor.every((x) => typeof x === 'string')) {
    return lido.valor
  }
  return palavrasDeLancamento(valor)
}

const SWITCH_SEM_APROVACAO = dupla('dangerously-', 'bypass-', 'approvals-', 'and-', 'sandbox')
const SWITCH_SEM_FREIO = dupla(semFreio)

/**
 * The commands the approval inputs of the vendor agent steps of one workflow or
 * action file stand for, as segments of achadosDoIndice. openai/codex-action
 * (src/runCodexExec.ts on main, read 2026-09-13) runs `exec` with `--sandbox
 * <sandbox>`, or `--config default_permissions=<profile>` when a permission
 * profile is set; it passes `codex-args` along, and throws on the bypass switch
 * or its short alias when a profile is set or the sandbox or safety strategy
 * is read-only, so the switch counts only outside those. Its own `--sandbox` and
 * config roots in `codex-args` are never counted: the action appends its own
 * choice after them and rejects those roots under every strategy but unsafe.
 * anthropics/claude-code-action and both base actions write `settings` into
 * the user settings file (src/setup-settings.ts), where Claude Code honours its
 * default permission mode.
 */
function segmentosDeEntradas(e, ACOES_DE_AGENTE) {
  if (!/\buses\s*:/.test(e.texto)) return []
  const lido = lerYaml(e.texto, { ancoras: true })
  if (lido.erro || !ehMapa(lido.valor)) return []
  const raiz = lido.valor
  const passos = []
  if (ehMapa(raiz.jobs)) {
    for (const [id, job] of Object.entries(raiz.jobs)) {
      if (!ehMapa(job) || !Array.isArray(job.steps)) continue
      job.steps.forEach((p, i) => passos.push([`/jobs/${segmento(id)}/steps/${i}`, p]))
    }
  }
  if (ehMapa(raiz.runs) && Array.isArray(raiz.runs.steps)) {
    raiz.runs.steps.forEach((p, i) => passos.push([`/runs/steps/${i}`, p]))
  }
  const workflow = ehWorkflow(e.caminho)
  const severidade = workflow && !ehLockDoGhAw(e.texto) ? 'reprova' : 'avisa'
  const lugar = (ponteiro) => {
    for (let p = ponteiro; ; p = p.slice(0, p.lastIndexOf('/'))) {
      if (lido.posicoes.has(p)) return lido.posicoes.get(p)
      if (!p) return { linha: 1, coluna: 1 }
    }
  }
  const saida = []
  for (const [ponteiro, passo] of passos) {
    if (!ehMapa(passo)) continue
    const acao = acaoDoUses(passo.uses, ACOES_DE_AGENTE)
    if (!acao || !acao.dados.aprovacao) continue
    const com = ehMapa(passo.with) ? passo.with : Object.create(null)
    const valor = (k) => (typeof com[k] === 'string' ? com[k].trim() : '')
    const empurrar = (entrada, palavras) =>
      saida.push({
        e,
        texto: palavras.map(citarPosix).join(' '),
        dialetos: ['posix'],
        severidade,
        rotulo: `${acao.dados.aprovacao} action input in ${escaparSaida(e.caminho, { limite: 80 })}`,
        ...lugar(`${ponteiro}/with/${segmento(entrada)}`),
      })
    if (acao.dados.aprovacao === 'codex') {
      const base = [j('cod', 'ex'), 'exec']
      const perfil = valor('permission-profile')
      const sandbox = valor('sandbox')
      const estrategia = valor('safety-strategy')
      const soLeitura = estrategia === 'read-only'
      if (sandbox && !perfil && !soLeitura) {
        empurrar('sandbox', [...base, dupla('sand', 'box'), sandbox])
      }
      if (perfil)
        empurrar('permission-profile', [...base, '-c', `${j('default', '_permissions')}=${perfil}`])
      if (!perfil && sandbox !== 'read-only' && !soLeitura) {
        const args = argumentosDoCodex(com['codex-args'])
        const proibidos = args.filter((w) => w === SWITCH_SEM_APROVACAO || w === SWITCH_SEM_FREIO)
        if (proibidos.length) empurrar('codex-args', [...base, ...proibidos])
      }
    }
    if (acao.dados.aprovacao === 'claude' && typeof com.settings === 'string') {
      const lidas = lerJsonc(com.settings.trim(), { estrito: true })
      const modo =
        ehMapa(lidas.valor) && ehMapa(lidas.valor.permissions)
          ? lidas.valor.permissions.defaultMode
          : undefined
      if (!lidas.erro && typeof modo === 'string') {
        empurrar('settings', [j('cla', 'ude'), dupla('permission-', 'mode'), modo])
      }
    }
  }
  return saida
}

const PESO = { reprova: 2, avisa: 1 }

/** The entry whose bytes a link or a mounted path shows, for counting a finding once. */
function oidDoConteudo(e, porCaminho) {
  if (e.symlink && e.symlink.resolvido) return porCaminho.get(e.symlink.resolvido)?.oid || e.oid
  return e.oid
}

export function achadosDoIndice(indice, tabelas) {
  const t = prepararTabelas(tabelas)
  const acoes = validarAcoesDeAgente(tabelas.ACOES_DE_AGENTE)
  const { entradas, porCaminho } = indice
  const achados = []
  let lidos = 0
  let ausentes = 0
  let naoLidos = 0

  // 1. What runs by itself: lifecycle scripts, automatic commands, and the
  //    tracked files either of them starts.
  const executados = new Map() // caminho -> rotulo
  const executar = (caminho, rotulo) => {
    if (!executados.has(caminho)) executados.set(caminho, rotulo)
  }
  const segmentos = [] // { e, texto, dialetos, severidade, rotulo, linha, coluna }: read as shell
  const pacotes = []

  // Each config is read as the index holds it and, when working-tree-encoding
  // re-encodes it on checkout, as the disk holds it: npm and the editor read
  // the disk, and a package.json whose index blob is CJK text ran its
  // postinstall from the ASCII checkout wrote (measured: the rule passed).
  const versoes = (e) => [
    { texto: e.texto, sufixo: '' },
    ...textosNoDisco(e).map((texto) => ({ texto, sufixo: ', as checked out' })),
  ]

  // Package scripts an automatic command or a git hook calls by name
  // (`npm run setup`), per package.json path: they run as unwatched as the
  // command that calls them. Measured before: a postinstall calling a script
  // made that script fail, while a devcontainer postCreateCommand, a folder-open
  // task or a .husky hook calling the same script left it a warning.
  const chamadosDeFora = new Map() // package.json path -> Array<{ nome, origem }>
  const pacoteMaisProximo = (pasta) => {
    for (
      let d = pasta === '.' ? '' : pasta;
      ;
      d = posix.dirname(d) === '.' ? '' : posix.dirname(d)
    ) {
      const p = d ? `${d}/package.json` : 'package.json'
      if (porCaminho.has(p)) return p
      if (!d) return null
    }
  }
  // Package names, for `npm -w @acme/x` and `pnpm --filter @acme/x`.
  const nomesDePacote = new Map() // name -> package.json paths
  for (const e of entradas) {
    if (e.texto === null || e.symlink || e.viaSymlink) continue
    if (posix.basename(e.caminho) !== 'package.json') continue
    const lido = lerJsonc(e.texto, { estrito: true })
    const nome =
      !lido.erro && lido.valor && typeof lido.valor.name === 'string' ? lido.valor.name : null
    if (!nome) continue
    if (!nomesDePacote.has(nome)) nomesDePacote.set(nome, [])
    nomesDePacote.get(nome).push(e.caminho)
  }
  /** The package.json paths a call made from `pasta` looks its script up in. */
  const alvosDaChamada = (c, pasta) => {
    const base = pasta === '.' ? '' : pasta
    // A git hook runs at the root of the work tree, a task or a devcontainer
    // command in the workspace folder: a folder option is tried from both.
    const naPasta = (d) =>
      [...new Set([posix.join('.', d, 'package.json'), posix.join(base || '.', d, 'package.json')])]
        .map((p) => posix.normalize(p))
        .filter((p) => porCaminho.has(p))
    if (c.pasta) return [...new Set(naPasta(c.pasta))]
    if (c.pacote)
      return [...new Set([...naPasta(c.pacote), ...(nomesDePacote.get(c.pacote) || [])])]
    if (c.raiz) {
      // pnpm's workspace root: the folder of the nearest pnpm-workspace.yaml.
      for (let d = base; ; d = posix.dirname(d) === '.' ? '' : posix.dirname(d)) {
        if (porCaminho.has(d ? `${d}/pnpm-workspace.yaml` : 'pnpm-workspace.yaml')) {
          const p = d ? `${d}/package.json` : 'package.json'
          return porCaminho.has(p) ? [p] : []
        }
        if (!d) break
      }
      return porCaminho.has('package.json') ? ['package.json'] : []
    }
    const perto = pacoteMaisProximo(pasta)
    return perto ? [perto] : []
  }
  const chamarScripts = (comando, pasta, origem) => {
    for (const c of chamadasDeScript(comando)) {
      for (const alvo of alvosDaChamada(c, pasta)) {
        if (!chamadosDeFora.has(alvo)) chamadosDeFora.set(alvo, [])
        chamadosDeFora.get(alvo).push({ nome: c.nome, origem })
      }
    }
  }

  for (const e of entradas) {
    // A git hook file runs its lines with no dialog, and so does what those
    // lines start: a tracked file (`node scripts/t.js`) or a package script.
    if (e.texto !== null && ehGancho(e.caminho)) {
      const pasta = posix.dirname(e.caminho)
      const rotulo = `git hook ${escaparSaida(e.caminho, { limite: 80 })}`
      for (const { texto } of versoes(e)) {
        for (const logica of linhasLogicas(texto)) {
          const comando = logica.texto.replace(/\r$/, '')
          for (const p of arquivosDoComando(comando, pasta === '.' ? '' : pasta, porCaminho)) {
            executar(p, `started by ${rotulo}`)
          }
          chamarScripts(comando, pasta, rotulo)
        }
      }
    }
    if (e.texto === null || e.symlink || e.viaSymlink) continue
    if (posix.basename(e.caminho) === 'package.json') {
      pacotes.push(e)
      continue
    }
    if (
      !TAREFAS.test(e.caminho) &&
      !WORKSPACE.test(e.caminho) &&
      !DEVCONTAINER.test(e.caminho) &&
      !GANCHOS.test(e.caminho)
    ) {
      continue
    }
    for (const { texto, sufixo } of versoes(e)) {
      const r = lerJsonc(texto)
      if (r.erro) continue
      for (const { comando, ponteiro, rotulo, dialetos } of comandosAutomaticos(
        e.caminho,
        r.valor,
      )) {
        const pos = r.posicoes.get(ponteiro) || { linha: 1, coluna: 1 }
        segmentos.push({
          e,
          texto: comando,
          dialetos,
          severidade: 'reprova',
          rotulo: rotulo + sufixo,
          ...pos,
        })
        const base = posix.dirname(e.caminho)
        const lugar = `${rotulo} in ${escaparSaida(e.caminho, { limite: 80 })}`
        for (const p of arquivosDoComando(comando, base === '.' ? '' : base, porCaminho)) {
          executar(p, `started by ${lugar}`)
        }
        chamarScripts(comando, base, lugar)
      }
    }
  }

  // The approval inputs of the vendor agent actions, in workflows and in the
  // action files a workflow can call.
  for (const e of entradas) {
    if (e.texto === null || e.symlink || e.viaSymlink) continue
    if (!ehWorkflow(e.caminho) && !ACAO_LOCAL.test(e.caminho)) continue
    segmentos.push(...segmentosDeEntradas(e, acoes))
  }

  // package.json text that the script pass already judged, per text read: the
  // raw pass below blanks it, so one switch is not reported twice.
  const julgadoNoPacote = new Map() // texto -> Array<[inicio, fim]>
  for (const e of pacotes) {
    for (const { texto, sufixo } of versoes(e)) {
      const r = lerJsonc(texto, { estrito: true })
      // npm refuses a package.json it cannot parse, so no script of it runs;
      // the raw text is still read as ordinary text below.
      if (r.erro) continue
      segmentosDoPacote(e, texto, r, sufixo)
    }
  }

  function segmentosDoPacote(e, texto, r, sufixo) {
    const base = posix.dirname(e.caminho) === '.' ? '' : posix.dirname(e.caminho)
    const trechos = []
    const ganchosDoPacote = [] // { comando, origem } of the hook-manager strings below
    // Hook managers that install package.json strings as real git hooks:
    // simple-git-hooks (`"simple-git-hooks": { "pre-commit": "..." }`) and
    // husky before v5 (`"husky": { "hooks": { ... } }`). What they run starts
    // with no dialog, like a file under .husky/.
    for (const { caminho, inicio, fim } of cadeiasDoJson(texto)) {
      const gancho =
        (caminho.length === 2 &&
          caminho[0] === 'simple-git-hooks' &&
          NOMES_DE_HOOK.has(caminho[1])) ||
        (caminho.length === 3 &&
          caminho[0] === 'husky' &&
          caminho[1] === 'hooks' &&
          NOMES_DE_HOOK.has(caminho[2]))
      if (caminho.length === 2 && caminho[0] === 'scripts') trechos.push([inicio, fim])
      if (!gancho) continue
      trechos.push([inicio, fim])
      const comando = JSON.parse(texto.slice(inicio, fim))
      const nome = escaparSaida(caminho[caminho.length - 1], { limite: 40 })
      const rotulo = `git hook ${nome} in ${caminho[0]}`
      // Git runs a hook with sh, on Windows too (Git for Windows' own).
      segmentos.push({
        e,
        texto: comando,
        dialetos: ['posix'],
        severidade: 'reprova',
        rotulo: rotulo + sufixo,
        ...posicao(texto, inicio),
      })
      const lugar = `${rotulo} of ${escaparSaida(e.caminho, { limite: 80 })}`
      for (const p of arquivosDoComando(comando, base, porCaminho)) {
        executar(p, `started by ${lugar}`)
      }
      ganchosDoPacote.push({ comando, origem: lugar })
    }
    julgadoNoPacote.set(texto, trechos)

    const scripts = scriptsDe(r)
    const nomes = new Set(scripts.map((s) => s.nome))
    // Script name -> what starts it with no dialog: the lifecycle event itself,
    // or the automatic command, git hook or lifecycle script that calls it.
    const doCiclo = new Map()
    for (const s of scripts) {
      if (CICLO_DE_VIDA.has(s.nome)) {
        doCiclo.set(s.nome, `lifecycle script ${escaparSaida(s.nome, { limite: 40 })}`)
      }
    }
    // A hook-manager string or a script calls a script of THIS package: a call
    // whose options point at another package is not followed from here.
    const doProprio = (comando) =>
      chamadasDeScript(comando).filter((c) => alvosDaChamada(c, base || '.').includes(e.caminho))
    const chamados = [...(chamadosDeFora.get(e.caminho) || [])]
    for (const { comando, origem } of ganchosDoPacote) {
      for (const c of doProprio(comando)) chamados.push({ nome: c.nome, origem })
    }
    for (const { nome, origem } of chamados) {
      if (nomes.has(nome) && !doCiclo.has(nome)) doCiclo.set(nome, origem)
    }
    // A script started that way that calls `npm run x` runs x too, three calls deep.
    for (let volta = 0; volta < 3; volta++) {
      let cresceu = false
      for (const s of scripts) {
        if (!doCiclo.has(s.nome)) continue
        for (const { nome } of doProprio(s.valor)) {
          if (nomes.has(nome) && !doCiclo.has(nome)) {
            doCiclo.set(nome, doCiclo.get(s.nome))
            cresceu = true
          }
        }
      }
      if (!cresceu) break
    }
    for (const s of scripts) {
      const nome = escaparSaida(s.nome, { limite: 40 })
      const origem = doCiclo.get(s.nome)
      const proprio = `lifecycle script ${nome}`
      const rotulo = origem
        ? origem === proprio && CICLO_DE_VIDA.has(s.nome)
          ? proprio
          : `script ${nome} called by ${origem}`
        : `script ${nome}`
      // npm runs a script with sh, and on Windows with cmd, whose programs
      // read `\"` inside double quotes as a quote too: the POSIX model.
      segmentos.push({
        e,
        texto: s.valor,
        dialetos: ['posix'],
        severidade: origem ? 'reprova' : 'avisa',
        rotulo: rotulo + sufixo,
        linha: s.linha,
        coluna: s.coluna,
      })
      if (!origem) continue
      for (const p of arquivosDoComando(s.valor, base, porCaminho)) {
        executar(p, `started by ${rotulo} of ${escaparSaida(e.caminho, { limite: 80 })}`)
      }
    }
  }

  // 2. Every entry, judged by the place it lives in.
  const julgados = new Map() // oid|linha|id|texto -> severidade, for links and mounts
  const anotar = (e, bruto, severidade, rotulo, fixo) => {
    const sev = bruto.forca === 'fraca' ? 'avisa' : severidade
    achados.push({
      caminho: e.caminho,
      oid: e.oid,
      linha: fixo ? fixo.linha : bruto.linha,
      coluna: fixo ? fixo.coluna : bruto.coluna,
      id: bruto.id,
      texto: bruto.texto,
      severidade: sev,
      rotulo,
      conteudo: `${oidDoConteudo(e, porCaminho)}\0${bruto.linha}\0${bruto.id}\0${bruto.texto}`,
      real: !e.symlink && !e.viaSymlink,
    })
  }
  for (const s of segmentos) {
    for (const bruto of varrerShell(s.texto, tabelas, { dialetos: s.dialetos })) {
      anotar(s.e, bruto, s.severidade, s.rotulo, { linha: s.linha, coluna: s.coluna })
    }
  }
  /** A package.json text with the strings judged in step 1 turned to spaces. */
  const semTrechosJulgados = (texto) => {
    const trechos = julgadoNoPacote.get(texto)
    if (!trechos || !trechos.length) return texto
    let saida = ''
    let desde = 0
    for (const [inicio, fim] of [...trechos].sort((a, b) => a[0] - b[0])) {
      if (inicio < desde) continue
      // One space per code point: no line break is inside a JSON string, and the
      // columns after it on the same line stay where they were.
      saida += texto.slice(desde, inicio) + ' '.repeat([...texto.slice(inicio, fim)].length)
      desde = fim
    }
    return saida + texto.slice(desde)
  }

  for (const e of entradas) {
    if (e.texto === null) {
      if (e.estado === 'ausente') {
        ausentes++
        naoLidos++
      }
      continue
    }
    lidos++
    if (e.estado === 'truncado' && !e.symlink && !e.viaSymlink) naoLidos++
    const real = !e.symlink && !e.viaSymlink
    // An agent file that working-tree-encoding re-encodes on checkout is also
    // read the way an agent reads the disk: CJK text in the index can be an
    // ASCII command in the working tree.
    const discos = textosNoDisco(e).filter((d) => podeTerAchado(t, d))
    if (!podeTerAchado(t, e.texto) && !discos.length) continue

    let severidade = null
    let rotulo = null
    let lerComo = (texto) => texto
    if (executados.has(e.caminho)) {
      severidade = 'reprova'
      rotulo = executados.get(e.caminho)
    } else if (ehGancho(e.caminho)) {
      severidade = 'reprova'
      rotulo = 'git hook'
    } else if (e.tipo === 'agente') {
      severidade = 'reprova'
      rotulo = 'agent file'
    } else if (ehWorkflow(e.caminho)) {
      const lock = ehLockDoGhAw(e.texto)
      severidade = lock ? 'avisa' : 'reprova'
      rotulo = lock ? 'gh-aw lock file' : 'workflow'
    }
    // A link or a mounted path repeats a real entry's bytes; it only adds
    // something when its OWN path is a place that runs without a dialog.
    if (!real && severidade !== 'reprova') continue

    // The quote models of what reads this text (see dialetosDaEntrada); code is
    // read line by line, so it takes a list and never a workflow's function.
    const dialetosDe = (texto) => dialetosDaEntrada(e.caminho, texto, executados.has(e.caminho))
    const listaDe = (texto) => {
      const d = dialetosDe(texto)
      return typeof d === 'function' ? ['texto'] : d
    }
    let brutos
    if (severidade) {
      brutos =
        e.tipo === 'codigo'
          ? varrerCodigo(ehJs(e.caminho) ? semComentarioNemImport(e.texto) : e.texto, tabelas, {
              guarda: severidade !== 'reprova',
              dialetos: listaDe(e.texto),
            })
          : varrerShell(e.texto, tabelas, {
              guarda: severidade !== 'reprova',
              yaml: ehYaml(e.caminho),
              dialetos: dialetosDe(e.texto),
            })
    } else if (posix.basename(e.caminho) === 'package.json') {
      // Only the scripts and hook commands were judged above. Every other
      // member is still text a person reads and nothing starts, and a hook
      // manager or tool config can keep a command there: read raw, with the
      // strings judged above blanked so nothing is reported twice.
      severidade = 'avisa'
      rotulo = 'text nothing starts on its own'
      lerComo = semTrechosJulgados
      brutos = varrerShell(lerComo(e.texto), tabelas, { guarda: true })
    } else if (ehMarkdown(e.caminho)) {
      severidade = 'avisa'
      rotulo = 'fenced block'
      brutos = varrerShell(soCercas(e.texto), tabelas, { guarda: true })
    } else if (e.tipo === 'codigo') {
      severidade = 'avisa'
      rotulo = 'code nothing starts on its own'
      // I7: a comment runs nothing. Only the JavaScript family has a stripper
      // that knows strings; other languages are read raw, which can only warn more.
      const texto = ehJs(e.caminho) ? semComentarioNemImport(e.texto) : e.texto
      brutos = varrerCodigo(texto, tabelas, { guarda: true, dialetos: listaDe(e.texto) })
    } else {
      severidade = 'avisa'
      rotulo = 'text nothing starts on its own'
      brutos = varrerShell(e.texto, tabelas, {
        guarda: true,
        yaml: ehYaml(e.caminho),
        dialetos: dialetosDe(e.texto),
      })
    }
    for (const bruto of brutos) anotar(e, bruto, severidade, rotulo, null)
    for (const disco of discos) {
      const vistos =
        e.tipo === 'codigo'
          ? varrerCodigo(lerComo(disco), tabelas, { dialetos: listaDe(disco) })
          : varrerShell(lerComo(disco), tabelas, { dialetos: dialetosDe(disco) })
      for (const bruto of vistos) anotar(e, bruto, severidade, `${rotulo}, as checked out`, null)
    }
  }

  // 3. One finding per place: the worst severity wins, and a link or a mount
  //    is dropped when the real entry already says the same with equal weight.
  const porLugar = new Map()
  for (const a of achados) {
    const chave = `${a.caminho}\0${a.linha}\0${a.id}\0${a.texto}`
    const antes = porLugar.get(chave)
    if (!antes || PESO[a.severidade] > PESO[antes.severidade]) porLugar.set(chave, a)
  }
  for (const a of porLugar.values()) {
    if (!a.real) continue
    const antes = julgados.get(a.conteudo)
    if (!antes || PESO[a.severidade] > PESO[antes]) julgados.set(a.conteudo, a.severidade)
  }
  const finais = []
  for (const a of porLugar.values()) {
    if (!a.real) {
      const real = julgados.get(a.conteudo)
      if (real && PESO[real] >= PESO[a.severidade]) continue
    }
    const { conteudo, real, ...resto } = a
    finais.push(resto)
  }
  finais.sort((x, y) =>
    x.caminho < y.caminho ? -1 : x.caminho > y.caminho ? 1 : x.linha - y.linha,
  )
  return { achados: finais, lidos, ausentes, naoLidos }
}

// ─────────────────────────────────────────────────────────────── the rule

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

export function checarBypass(r, tabelas) {
  prepararTabelas(tabelas)
  validarAcoesDeAgente(tabelas.ACOES_DE_AGENTE)
  const indice = lerIndice(r.dir)
  const permitidas = lerAllowlist(r.dir)
  const { achados, lidos, ausentes, naoLidos } = achadosDoIndice(indice, tabelas)

  if (lidos === 0 && ausentes > 0) {
    throw new Error(`read none of the ${ausentes} tracked file(s): every blob is missing`)
  }
  if (lidos === 0 && permitidas.erros.length === 0) return na('no tracked text file')

  // A malformed allowlist exempts nothing, and fails by itself.
  const malformada = permitidas.erros.length > 0
  let usouEntrada = false
  const restantes = achados.filter((a) => {
    if (malformada || a.caminho === NOME_DA_ALLOWLIST) return true
    const aceito = permitidas.aceita(REGRA, { arquivo: a.caminho, oid: a.oid })
    if (aceito) usouEntrada = true
    return !aceito
  })
  const item = (a) => `${onde(a.caminho, a.linha, a.coluna)} ${a.id} ${a.texto} (${a.rotulo})`
  const reprova = restantes.filter((a) => a.severidade === 'reprova')
  const avisa = restantes.filter((a) => a.severidade === 'avisa')
  // A finding inside the allowlist is never exempt, so no key is suggested for it.
  for (const a of reprova) {
    if (a.caminho !== NOME_DA_ALLOWLIST)
      sugerirEntrada(r, REGRA, { arquivo: a.caminho, oid: a.oid })
  }

  const notas = []
  if (avisa.length) {
    notas.push(
      `${plural(avisa.length, 'agent CLI invocation', 'agent CLI invocations')} with approval ` +
        `turned off where nothing starts them on its own: ${resumir(avisa.map(item))}`,
    )
  }
  if (naoLidos) {
    notas.push(
      `${plural(naoLidos, 'file', 'files')} not read whole — the verdict does not cover them`,
    )
  }
  if (indice.gitlinks.length) {
    notas.push(`${plural(indice.gitlinks.length, 'submodule', 'submodules')} not read`)
  }
  const obsoletas = malformada ? 0 : permitidas.obsoletas(REGRA)
  if (obsoletas) {
    notas.push(
      `${plural(obsoletas, 'allowlist entry', 'allowlist entries')} for ${REGRA} ` +
        `no longer ${obsoletas === 1 ? 'matches' : 'match'} a finding`,
    )
  }
  if (permitidas.naoRastreada) {
    notas.push(`${NOME_DA_ALLOWLIST} exists on disk but is not tracked, so it is ignored`)
  }
  if (usouEntrada && permitidas.rastreada && !permitidas.cobertaPorCodeowners) {
    notas.push(`${NOME_DA_ALLOWLIST} is in use and no CODEOWNERS entry owns it`)
  }

  if (reprova.length || malformada) {
    const partes = []
    if (reprova.length) {
      partes.push(
        `${plural(reprova.length, 'agent CLI invocation', 'agent CLI invocations')} with approval ` +
          `turned off: ${resumir(reprova.map(item))} — an install script, git hook, editor task, ` +
          'workflow or agent file runs this with no dialog (the Nx s1ngularity postinstall, ' +
          'the Amazon Q 1.84.0 extension)',
      )
    }
    if (malformada) {
      const erros = permitidas.erros.map(
        (x) => `${onde(NOME_DA_ALLOWLIST, x.linha, x.coluna)} ${x.mensagem}`,
      )
      partes.push(`${NOME_DA_ALLOWLIST} is malformed, so it exempts nothing: ${resumir(erros)}`)
    }
    if (avisa.length) partes.push(`plus ${plural(avisa.length, 'warning', 'warnings')}`)
    return partes.join(' · ')
  }
  return notas.length ? { nota: notas.join(' · ') } : null
}
