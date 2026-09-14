// workflow — an AI agent step in a GitHub workflow that any account can start,
// and what that agent can do once someone else's text is steering it.
//
// WHY THIS IS A RULE. Three public findings used the same shape. PromptPwnd
// (Aikido, 2025-12-04) steered the Gemini CLI inside Google's own issue triage
// workflows with the text of a new issue. Clinejection (Adnan Khan,
// 2026-02-09) led Claude Code, running with a shell tool grant on an issue
// trigger, from an issue title to a poisoned Actions cache that reached release
// tokens. Comment and Control (2026-04-15) did it from a comment. The agent
// reads the issue, the comment or the pull request, and the author of that
// text is whoever opened it.
//
// WHY INTERPOLATION IS NOT REQUIRED. Measured over the vendors' own examples,
// 11 of 13 agent steps on those triggers interpolate no event text at all:
// Clinejection had none, and claude-code-action loads the triggering issue or
// comment by itself. So a step is exposed when a trigger any account can fire
// reaches it and its actor check is absent or opened by an input; the event
// text it interpolates is reported, not required.
//
// WHY THE VERDICT FOLLOWS THE AGENT'S REACH. Every agent step holds its own
// model credential, so that credential never fails a step by itself. Above it,
// three tiers:
//   execution    the agent can run commands (a shell grant, approvals off, no
//                sandbox, its text output spliced into a later script). It
//                reaches every secret of its process and the runner's own
//                token, so it fails at any permission level.
//   contained    the vendor keeps it away from both: ai-inference with no
//                tool, run-gemini-cli with an empty core tool list and no MCP
//                server or extension, codex-action in its sandbox with sudo
//                dropped. A note, whatever the job holds.
//   process      everything else reads its own environment and workspace, so
//                a write scope beyond issues, pull requests and discussions,
//                a missing permissions block, or a secret other than the model
//                credential fails.
//
// Measured with this engine on 2026-09-13 over 1,660 workflows of 1,394 agent
// adopters, each read with its own repository as the origin: 150 steps in 124
// files fail, and 126 of those 150 carry execution or code injection, not only
// a token scope; 154 steps warn. Read with no origin, 170 steps in 142 files
// fail: the 20 steps between are copies of Gemini CLI's triage workflows gated
// on its repository name. Over 1,571 workflows of 49 well-known repositories,
// 3 files fail. Over the 29 workflows of 24 local repositories, the rebar
// worktree and the gate template: none.
//
// WHY EVERY WORD IS ASSEMBLED. Like bypass.mjs, this file is read raw by the
// text tables prove-table.mjs holds against it, so every agent binary, switch
// and value is joined from pieces.
//
// ─────────────────────────────────────────────────────────────── the API
//
/**
 * ACOES_DE_AGENTE    [RegExp, explicacao, dados]: vendor agent actions, matched
 *                    whole against the path a step's `uses` names, read as the
 *                    runner splits it (bypass.mjs caminhoDoUses), the first row wins.
 *   dados = { agente, portao: null | { abridores: [input, 'estrela'|'estrelaComToken'][] },
 *             texto: input[], autenticacao: input[], saidas: output[],
 *             aprovacao: 'claude'|'codex'|null, tokenDoApp?: input, mcpDoGithub?: input }
 * GATILHOS_DE_FORA   [RegExp, explicacao, tiposDeFora: string[], tiposPadrao: string[]|null]
 * CAMPOS_DO_EVENTO   [RegExp, explicacao, { objeto?: true }]: expression leaves
 *                    whose text an outside account wrote.
 *
 * taintEm(valor, CAMPOS_DO_EVENTO) -> string[]   the event leaves interpolated in `valor`
 * avaliarCondicao(expr, gatilho, { comEntradas = false, sucesso = 'U', repositorio = null })
 *   -> 'T' | 'F' | 'U'    `sucesso` is what success() means here; `repositorio`
 *   the 'owner/name' the run belongs to, when known.
 * achadosDosWorkflows(arquivos: Map<caminho, texto>, tabelas,
 *                     { repositorio = null, apelidos = Map<caminho, real>, ligacoesQuebradas = [] })
 *   -> { itens: Item[], notas: string[], agentes: number, workflows: number }
 *   Item = { severidade: 'reprova'|'nota', texto, arquivos: string[] }. Pure: the
 *   index-free core, which the corpus measurements call directly. `apelidos`
 *   maps an action file reached through a tracked link to the file it ends at,
 *   and `ligacoesQuebradas` lists the links that end nowhere.
 *   checarWorkflowDeAgente fills all three from the index and the origin remote.
 * checarWorkflowDeAgente(r, { ACOES_DE_AGENTE, GATILHOS_DE_FORA, CAMPOS_DO_EVENTO,
 *                             FLAGS_FORTES, FLAGS_AMBIGUAS, PARES_DE_FLAG, BINARIOS_DE_AGENTE })
 *   -> string (reprova) | { nota } | null | { na }
 */

import { posix } from 'node:path'

import { escaparSaida } from '../texto-seguro.mjs'
import { ehRegraAmpla } from './agent-config.mjs'
import {
  acaoDoUses,
  caminhoDoUses,
  invocacoesDeAgente,
  lockDoGhAw,
  palavrasDosArgs,
  settingsDasPalavras,
  validarAcoesDeAgente,
  varrerShell,
} from './bypass.mjs'
import { lerJsonc, lerYaml } from './formats.mjs'
import {
  NOME_DA_ALLOWLIST,
  lerAllowlist,
  lerIndice,
  onde,
  repositorioDeOrigem,
  resumir,
  sugerirEntrada,
} from './reader.mjs'

const REGRA = 'ai-workflow-untrusted-input'
const na = (motivo) => ({ na: motivo })
const j = (...partes) => partes.join('')
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

// ═══════════════════════════════════════════════════════════════ the tables

const acao = (fonte, explicacao, dados) => [new RegExp(fonte), explicacao, Object.freeze(dados)]

const BASE_DO_CLAUDE = {
  agente: j('cla', 'ude'),
  portao: null,
  texto: ['prompt', j('cla', 'ude_args'), 'settings'],
  autenticacao: ['anthropic_api_key', j('cla', 'ude_code_oauth_token')],
  saidas: ['structured_output'],
  aprovacao: j('cla', 'ude'),
}

/**
 * The agent actions, with the inputs and outputs each action.yml declares
 * (fetched from each default branch on 2026-09-13). The actor check is the
 * action's own: claude-code-action and codex-action run only for accounts with
 * write access unless an input opens them, and opencode's GitHub action checks
 * the same with no input to open it. `tokenDoApp` names the input without which
 * the action trades the job's OIDC token for its vendor App token, which holds
 * contents, pull request and issue write whatever the permissions block says
 * (claude-code-action src/github/token.ts; opencode's handler).
 * actions/ai-inference v1 and v2 send the prompt to GitHub Models and can hand
 * the model the GitHub MCP tools; v3 goes through the Copilot CLI.
 */
export const ACOES_DE_AGENTE = [
  acao(
    j('^anthropics\\/cla', 'ude-code-action\\/base-action$'),
    'Anthropic Claude Code base action: starts the agent with the inputs given and checks no actor',
    BASE_DO_CLAUDE,
  ),
  acao(
    j('^anthropics\\/cla', 'ude-code-base-action$'),
    'Anthropic Claude Code base action: starts the agent with the inputs given and checks no actor',
    BASE_DO_CLAUDE,
  ),
  acao(
    j('^anthropics\\/cla', 'ude-code-action(?:\\/.*)?$'),
    'Anthropic Claude Code action: runs only for accounts with write access unless an input opens it',
    {
      ...BASE_DO_CLAUDE,
      portao: {
        abridores: [
          ['allowed_non_write_users', 'estrelaComToken'],
          ['allowed_bots', 'estrela'],
        ],
      },
      texto: [...BASE_DO_CLAUDE.texto, 'direct_prompt', 'override_prompt', 'custom_instructions'],
      tokenDoApp: 'github_token',
    },
  ),
  acao(
    j('^anthropics\\/cla', 'ude-code-security-review$'),
    'Anthropic Claude Code security review action: reads the pull request it runs on and checks no actor',
    {
      agente: j('cla', 'ude'),
      portao: null,
      texto: [],
      autenticacao: [j('cla', 'ude-api-key')],
      saidas: [],
      aprovacao: null,
    },
  ),
  acao(
    j('^google-github-actions\\/run-gem', 'ini-cli$'),
    'Google Gemini CLI action: starts the CLI approving every tool call and checks no actor',
    {
      agente: j('gem', 'ini'),
      portao: null,
      texto: ['prompt', 'settings'],
      autenticacao: [j('gem', 'ini_api_key'), 'google_api_key'],
      saidas: ['summary', 'error'],
      aprovacao: null,
    },
  ),
  acao(
    j('^openai\\/cod', 'ex-action$'),
    'OpenAI Codex action: runs only for accounts with write access unless an input opens it',
    {
      agente: j('cod', 'ex'),
      portao: { abridores: [['allow-users', 'estrela']] },
      texto: ['prompt', j('cod', 'ex-args')],
      autenticacao: ['openai-api-key'],
      saidas: ['final-message'],
      aprovacao: j('cod', 'ex'),
    },
  ),
  acao(
    '^actions\\/ai-inference$',
    'GitHub AI inference action: sends the prompt to a model, through GitHub Models or the Copilot CLI, and checks no actor',
    {
      agente: j('copi', 'lot'),
      portao: null,
      texto: ['prompt', 'system-prompt', 'input'],
      autenticacao: ['token'],
      saidas: ['response'],
      aprovacao: null,
      mcpDoGithub: 'enable-github-mcp',
    },
  ),
  acao(
    j('^(?:anomalyco|sst)\\/open', 'code\\/github$'),
    'OpenCode GitHub action: runs only for accounts with write access',
    {
      agente: j('open', 'code'),
      portao: { abridores: [] },
      texto: ['prompt'],
      autenticacao: [],
      saidas: [],
      aprovacao: null,
      tokenDoApp: 'use_github_token',
    },
  ),
]

const gatilho = (nome, explicacao, tiposDeFora, tiposPadrao) => [
  new RegExp(`^${nome}$`),
  explicacao,
  Object.freeze(tiposDeFora),
  tiposPadrao === null ? null : Object.freeze(tiposPadrao),
]

/**
 * The events any account can cause, with the activity types that account can
 * cause on its own (GitHub "Events that trigger workflows"). A type like
 * `labeled` or `assigned` needs triage access, so a trigger narrowed to those
 * types does not count. `pull_request`, `push`, `schedule`, `workflow_dispatch`,
 * `repository_dispatch` and `workflow_call` never count: a fork's
 * `pull_request` run gets no secret and a read-only token, and the others need
 * write access or a caller.
 */
export const GATILHOS_DE_FORA = [
  gatilho(
    'issues',
    'any account can open, edit, close or reopen its own issue',
    ['opened', 'edited', 'closed', 'reopened'],
    null,
  ),
  gatilho(
    'issue_comment',
    'any account can comment on an issue or pull request',
    ['created', 'edited', 'deleted'],
    null,
  ),
  gatilho(
    'discussion',
    'any account can start or edit a discussion',
    ['created', 'edited', 'deleted', 'answered', 'unanswered'],
    null,
  ),
  gatilho(
    'discussion_comment',
    'any account can comment on a discussion',
    ['created', 'edited', 'deleted'],
    null,
  ),
  gatilho(
    'pull_request_target',
    'any account can open a pull request from a fork, and the run gets the base secrets',
    [
      'opened',
      'edited',
      'closed',
      'reopened',
      'synchronize',
      'converted_to_draft',
      'ready_for_review',
    ],
    ['opened', 'synchronize', 'reopened'],
  ),
  gatilho(
    'pull_request_review',
    'any account can review a pull request',
    ['submitted', 'edited'],
    null,
  ),
  gatilho(
    'pull_request_review_comment',
    'any account can comment on a pull request diff',
    ['created', 'edited', 'deleted'],
    null,
  ),
  gatilho(
    'workflow_run',
    'runs after another workflow with the base secrets, whoever started that one',
    ['completed', 'requested', 'in_progress'],
    null,
  ),
]

/**
 * Expression leaves whose text an outside account wrote, from the GitHub
 * Security Lab list of untrusted input. An `objeto` row is a whole object with
 * such text inside, and counts only where it is turned into text.
 */
export const CAMPOS_DO_EVENTO = [
  [
    /^github\.event\.(?:issue|pull_request|discussion)\.(?:title|body)$/,
    'a title or body its author wrote',
    Object.freeze({}),
  ],
  [
    /^github\.event\.(?:comment|review|review_comment)\.body$/,
    'a comment or review its author wrote',
    Object.freeze({}),
  ],
  [
    /^github\.event\.pull_request\.head\.(?:ref|label|repo\.default_branch)$/,
    'a branch or label name a fork chose',
    Object.freeze({}),
  ],
  [/^github\.head_ref$/, 'the branch name a fork chose', Object.freeze({})],
  [
    /^github\.event\.(?:head_commit|workflow_run\.head_commit)\.(?:message|author\.name|author\.email)$/,
    'a commit message or author a pusher chose',
    Object.freeze({}),
  ],
  [
    /^github\.event\.commits\.\*\.(?:message|author\.name|author\.email)$/,
    'a commit message or author a pusher chose',
    Object.freeze({}),
  ],
  [/^github\.event\.pages\.\*\.page_name$/, 'a wiki page name an editor chose', Object.freeze({})],
  [
    /^github\.event\.workflow_run\.(?:head_branch|display_title|pull_requests\.\*\.head\.ref)$/,
    'a branch or title from the run that started this one',
    Object.freeze({}),
  ],
  [
    /^github\.event(?:\.(?:issue|pull_request|comment|review|review_comment|discussion|head_commit|commits|workflow_run))?$/,
    'a whole event object, author text included',
    Object.freeze({ objeto: true }),
  ],
]

// ═══════════════════════════════════════════════════════════ table checks

function validarTabelas(tabelas) {
  if (!tabelas || typeof tabelas !== 'object') {
    throw new Error('checarWorkflowDeAgente needs its seven tables as the second argument')
  }
  const { ACOES_DE_AGENTE: acoes, GATILHOS_DE_FORA: gatilhos, CAMPOS_DO_EVENTO: campos } = tabelas
  validarAcoesDeAgente(acoes)
  const lista = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')
  const tabela = (nome, t, linhaOk) => {
    if (!Array.isArray(t) || t.length === 0) throw new Error(`table ${nome} is missing or empty`)
    t.forEach((row, i) => {
      if (
        !Array.isArray(row) ||
        !(row[0] instanceof RegExp) ||
        typeof row[1] !== 'string' ||
        !linhaOk(row)
      ) {
        throw new Error(`${nome}[${i}] is malformed`)
      }
    })
  }
  tabela(
    'GATILHOS_DE_FORA',
    gatilhos,
    (r) => r.length === 4 && lista(r[2]) && (r[3] === null || lista(r[3])),
  )
  tabela(
    'CAMPOS_DO_EVENTO',
    campos,
    (r) => r.length === 3 && r[2] !== null && typeof r[2] === 'object',
  )
  // The bypass tables are validated by the engine that owns them: an empty
  // text runs every check and returns nothing.
  const bypass = {
    FLAGS_FORTES: tabelas.FLAGS_FORTES,
    FLAGS_AMBIGUAS: tabelas.FLAGS_AMBIGUAS,
    PARES_DE_FLAG: tabelas.PARES_DE_FLAG,
    BINARIOS_DE_AGENTE: tabelas.BINARIOS_DE_AGENTE,
  }
  varrerShell('', bypass)
  return { acoes, gatilhos, campos, bypass }
}

// ═══════════════════════════════════════════════════════════════ small helpers

const ehMapa = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const temChave = (o, k) => ehMapa(o) && Object.prototype.hasOwnProperty.call(o, k)
const comoTexto = (v) =>
  v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
const segmento = (chave) => String(chave).replace(/~/g, '~0').replace(/\//g, '~1')
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text of every `${{ ... }}` in a value (JSON text for a non-string). */
function expressoesEm(valor) {
  const texto = comoTexto(valor)
  return [...texto.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1])
}

// ═══════════════════════════════════════════════════════════════════ taint

export function taintEm(valor, campos) {
  const folhas = []
  for (const expr of expressoesEm(valor)) {
    const cadeias = /\bgithub(?:\s*\.\s*[\w-]+|\s*\[\s*(?:'[^']*'|"[^"]*"|\d+|\*)\s*\])+/g
    for (const m of expr.matchAll(cadeias)) {
      const folha = m[0]
        .replace(/\s+/g, '')
        .replace(/\[(?:\d+|\*)\]/g, '.*')
        .replace(/\[['"]([^'"]*)['"]\]/g, '.$1')
      for (const [re, , dados] of campos) {
        if (!re.test(folha)) continue
        if (dados.objeto) {
          const antes = expr.slice(0, m.index)
          const inteira = expr.trim() === m[0].trim()
          if (!inteira && !/\b(?:toJSON|join|format)\s*\(\s*$/.test(antes)) continue
        }
        folhas.push(folha)
        break
      }
    }
  }
  return [...new Set(folhas)]
}

// ══════════════════════════════════════════════════════════ the conditions
//
// A condition is judged per trigger in three values: T, F, and U for "cannot
// tell". A step is reachable from a trigger unless one of its conditions is F.
// Every atom this file cannot decide is U, which keeps the step reachable:
// an unknown condition is resolved fail-closed.

const T = 'T'
const F = 'F'
const U = 'U'
const nao = (a) => (a === T ? F : a === F ? T : U)
const e = (a, b) => (a === F || b === F ? F : a === T && b === T ? T : U)
const ou = (a, b) => (a === T || b === T ? T : a === F && b === F ? F : U)

/** The event object whose author fired each trigger (GitHub webhook payloads). */
const OBJETO_DO_GATILHO = {
  issues: 'issue',
  issue_comment: 'comment',
  pull_request_target: 'pull_request',
  pull_request_review: 'review',
  pull_request_review_comment: 'comment',
  discussion: 'discussion',
  discussion_comment: 'comment',
}
/** The objects each trigger's payload carries that have an author association. */
const OBJETOS_DO_EVENTO = {
  issues: ['issue'],
  issue_comment: ['comment', 'issue'],
  pull_request_target: ['pull_request'],
  pull_request_review: ['review', 'pull_request'],
  pull_request_review_comment: ['comment', 'pull_request'],
  discussion: ['discussion'],
  discussion_comment: ['comment', 'discussion'],
}
const CONFIAVEIS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

function tiposDeFora(gatilhoNome, gatilhos) {
  const row = gatilhos.find(([re]) => re.test(gatilhoNome))
  return row ? row[2] : []
}

function avaliarAtomo(bruto, gatilhoNome, comEntradas, gatilhos, sucesso, repositorio) {
  const s = bruto.trim()
  if (s === 'true') return T
  if (s === 'false') return F
  // 0. The status functions, in any letter case (the runner compares their
  // names ignoring case). always() is true; success() is what the caller knows
  // of the jobs this one needs (avaliarItem), unknown for a step.
  const status = /^(always|success|failure|cancelled)\s*\(\s*\)$/i.exec(s)
  if (status) {
    const nome = status[1].toLowerCase()
    if (nome === 'always') return T
    return nome === 'success' ? sucesso : U
  }
  // 1. A gate on a job or step output, or on a job result, cannot be decided
  // from the text: an output check was measured to be a draft or duplicate
  // check, not an actor check, in 9 exposed Codex steps with the sandbox off.
  if (/\bneeds\s*\.\s*[\w-]+\s*\.\s*(?:outputs|result)\b/.test(s)) return U
  if (/\bsteps\s*\.\s*[\w-]+\s*\.\s*(?:outputs|outcome|conclusion)\b/.test(s)) return U

  // 2. The event name.
  let m =
    /^github\.event_name\s*(==|!=)\s*'([^']*)'$/.exec(s) ||
    /^'([^']*)'\s*(==|!=)\s*github\.event_name$/.exec(s)
  if (m) {
    const [op, nome] = m[1] === '==' || m[1] === '!=' ? [m[1], m[2]] : [m[2], m[1]]
    return (nome.toLowerCase() === gatilhoNome) === (op === '==') ? T : F
  }

  // 3. The inputs context exists only for workflow_dispatch and workflow_call
  // (GitHub "Contexts"): on any other event it is null, and null coerces to 0,
  // as '' and false do (GitHub "Expressions", comparisons).
  const ENTRADA = '(?:github\\.event\\.)?inputs\\.[\\w-]+'
  const FALSO = `(?:''|""|null|false|0)`
  m =
    new RegExp(`^${ENTRADA}(?:\\s*(==|!=)\\s*${FALSO})?$`).exec(s) ||
    new RegExp(`^${FALSO}\\s*(==|!=)\\s*${ENTRADA}$`).exec(s)
  if (m) {
    if (comEntradas) return U
    if (!m[1]) return F
    return m[1] === '==' ? T : F
  }

  const objeto = OBJETO_DO_GATILHO[gatilhoNome]
  // 4. The author association of the account that fired THIS trigger, compared
  // only against trusted values. Under issue_comment the issue's association
  // is the issue author's, not the commenter's, so it decides nothing.
  // A string search counts here, unlike for logins below: no association an
  // outside account can have is a substring of OWNER, MEMBER or COLLABORATOR.
  // Google's dispatch example tests `comment || review || issue` associations in
  // one call; the first object the event carries decides, so the chain counts
  // when every object before the bound one is absent from this event.
  if (objeto && !s.includes('!=')) {
    const ASSOCIACAO = 'github\\.event\\.[\\w-]+\\.author_association'
    const cadeia = `${ASSOCIACAO}(?:\\s*\\|\\|\\s*${ASSOCIACAO})*`
    const m4 =
      new RegExp(`^(${ASSOCIACAO})\\s*==\\s*'[^']*'$`).exec(s) ||
      new RegExp(`^'[^']*'\\s*==\\s*(${ASSOCIACAO})$`).exec(s) ||
      new RegExp(
        `^contains\\(\\s*(?:fromJSON\\(\\s*'[^']*'\\s*\\)|'[^']*')\\s*,\\s*(${cadeia})\\s*\\)$`,
      ).exec(s)
    if (m4) {
      const objetos = [...m4[1].matchAll(/github\.event\.([\w-]+)\.author_association/g)].map(
        (x) => x[1],
      )
      const presentes = OBJETOS_DO_EVENTO[gatilhoNome] || []
      const decide = objetos.find((o) => presentes.includes(o))
      const literais = s.replace(m4[1], '')
      const palavras = [...literais.matchAll(/'([^']*)'/g)].flatMap(
        (x) => x[1].match(/[A-Za-z_]+/g) || [],
      )
      if (
        decide === objeto &&
        palavras.length &&
        palavras.every((p) => CONFIAVEIS.has(p.toUpperCase()))
      ) {
        return F
      }
    }
  }

  // 5. The login of the account that fired the run, against a literal or a
  // JSON list. A string search is a substring test (GitHub "Expressions",
  // contains), so `contains('alice,bob', github.actor)` also lets `ali` in.
  const QUEM = [
    'github\\.actor',
    'github\\.triggering_actor',
    'github\\.event\\.sender\\.login',
    ...(objeto ? [`github\\.event\\.${objeto}\\.user\\.login`] : []),
  ].join('|')
  if (
    new RegExp(`^(?:${QUEM})\\s*==\\s*'[^']+'$`).test(s) ||
    new RegExp(`^'[^']+'\\s*==\\s*(?:${QUEM})$`).test(s) ||
    new RegExp(`^contains\\(\\s*fromJSON\\(\\s*'[^']*'\\s*\\)\\s*,\\s*(?:${QUEM})\\s*\\)$`).test(
      s,
    ) ||
    /^github\.repository_owner\s*==\s*github\.actor$/.test(s) ||
    /^github\.actor\s*==\s*github\.repository_owner$/.test(s)
  ) {
    return F
  }

  // 6. A fork check, for pull_request_target only: an outside account cannot
  // push a branch to the base repository. The review triggers get no secret
  // from a fork (GitHub "Events"), so there the same check selects the
  // same-repository runs, which any account can review or comment on.
  if (gatilhoNome === 'pull_request_target') {
    const FORK = 'github\\.event\\.pull_request\\.head\\.repo\\.fork'
    const NOME = 'github\\.event\\.pull_request\\.head\\.repo\\.full_name'
    if (new RegExp(`^${FORK}$`).test(s)) return T
    m = new RegExp(`^${FORK}\\s*(==|!=)\\s*(true|false)$`).exec(s)
    if (m) return (m[1] === '==') === (m[2] === 'true') ? T : F
    m =
      new RegExp(`^${NOME}\\s*(==|!=)\\s*github\\.repository$`).exec(s) ||
      new RegExp(`^github\\.repository\\s*(==|!=)\\s*${NOME}$`).exec(s)
    if (m) return m[1] === '==' ? F : T
  }

  // 7. An activity type the outside account cannot cause.
  m =
    /^github\.event\.action\s*==\s*'([^']*)'$/.exec(s) ||
    /^'([^']*)'\s*==\s*github\.event\.action$/.exec(s)
  if (m && !tiposDeFora(gatilhoNome, gatilhos).includes(m[1])) return F

  // 8. The repository the run belongs to, when the caller knows it (the origin
  // remote of the clone the rule reads). A job gated on another repository's
  // name never runs in a copy or a fork: measured over the adopter corpus, 20
  // failing steps in 18 files were copies of Gemini CLI's own triage workflows
  // gated on 'google-gemini/gemini-cli'. GitHub compares strings ignoring case
  // (GitHub "Expressions", operators). Unknown stays unknown.
  if (repositorio) {
    const REPO = '(github\\.repository|github\\.event\\.repository\\.full_name)'
    const DONO = '(github\\.repository_owner|github\\.event\\.repository\\.owner\\.login)'
    for (const [contexto, valor] of [
      [REPO, repositorio],
      [DONO, repositorio.split('/')[0]],
    ]) {
      const direita = new RegExp(`^${contexto}\\s*(==|!=)\\s*'([^']*)'$`).exec(s)
      const esquerda = direita ? null : new RegExp(`^'([^']*)'\\s*(==|!=)\\s*${contexto}$`).exec(s)
      if (!direita && !esquerda) continue
      const [op, literal] = direita ? [direita[2], direita[3]] : [esquerda[2], esquerda[1]]
      return (literal.toLowerCase() === valor.toLowerCase()) === (op === '==') ? T : F
    }
  }

  return U
}

export function avaliarCondicao(
  expr,
  gatilhoNome,
  {
    comEntradas = false,
    GATILHOS_DE_FORA: gatilhos = GATILHOS_DE_FORA,
    sucesso = U,
    repositorio = null,
  } = {},
) {
  if (expr === true) return T
  if (expr === false) return F
  if (typeof expr === 'number') return expr === 0 ? F : T
  if (typeof expr !== 'string') return U
  let s = expr.trim()
  const inteira = /^\$\{\{([\s\S]*)\}\}$/.exec(s)
  if (inteira && !inteira[1].includes('${{')) s = inteira[1]
  else if (s.includes('${{')) return U
  if (!s.trim()) return U

  const fichas = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (s.startsWith('&&', i) || s.startsWith('||', i)) {
      fichas.push(s.slice(i, i + 2))
      i += 2
      continue
    }
    if (c === '(' || c === ')') {
      fichas.push(c)
      i++
      continue
    }
    if (c === '!' && s[i + 1] !== '=') {
      fichas.push('!')
      i++
      continue
    }
    let k = i
    let profundidade = 0
    let aspa = false
    while (k < s.length) {
      const d = s[k]
      if (aspa) {
        if (d === "'") {
          if (s[k + 1] === "'") k++
          else aspa = false
        }
        k++
        continue
      }
      if (d === "'") aspa = true
      else if (d === '(') profundidade++
      else if (d === ')') {
        if (profundidade === 0) break
        profundidade--
      } else if (profundidade === 0 && (s.startsWith('&&', k) || s.startsWith('||', k))) break
      k++
    }
    if (aspa || k === i) return U
    fichas.push({ atomo: s.slice(i, k) })
    i = k
  }

  let p = 0
  const ouExpr = () => {
    let v = eExpr()
    while (fichas[p] === '||') {
      p++
      v = ou(v, eExpr())
    }
    return v
  }
  const eExpr = () => {
    let v = unario()
    while (fichas[p] === '&&') {
      p++
      v = e(v, unario())
    }
    return v
  }
  const unario = () => {
    if (fichas[p] === '!') {
      p++
      return nao(unario())
    }
    if (fichas[p] === '(') {
      p++
      const v = ouExpr()
      if (fichas[p] !== ')') throw new Error('unbalanced')
      p++
      return v
    }
    const ficha = fichas[p++]
    if (!ficha || typeof ficha !== 'object') throw new Error('expected an operand')
    return avaliarAtomo(ficha.atomo, gatilhoNome, comEntradas, gatilhos, sucesso, repositorio)
  }
  try {
    const v = ouExpr()
    return p === fichas.length ? v : U
  } catch {
    return U
  }
}

// ═════════════════════════════════════════════════════════════════ triggers

function gatilhosDeclarados(on) {
  if (typeof on === 'string') return { [on]: null }
  if (Array.isArray(on))
    return Object.fromEntries(on.filter((x) => typeof x === 'string').map((x) => [x, null]))
  return ehMapa(on) ? on : {}
}

/** The outside triggers of a workflow root, by the types each one declares. */
function gatilhosDeFora(raiz, gatilhos) {
  const saida = []
  for (const [nome, config] of Object.entries(gatilhosDeclarados(raiz.on))) {
    const row = gatilhos.find(([re]) => re.test(nome))
    if (!row) continue
    let tipos = ehMapa(config) ? config.types : undefined
    if (typeof tipos === 'string') tipos = [tipos]
    if (!Array.isArray(tipos) || tipos.length === 0) tipos = row[3]
    if (tipos && !tipos.some((t) => row[2].includes(String(t)))) continue
    saida.push(nome)
  }
  return saida
}

// ═══════════════════════════════════════════════════════════ agent analysis

/** The effective permissions of a job, from the first holder that declares the key. */
function permissoesDe(...donos) {
  for (const dono of donos) if (temChave(dono, 'permissions')) return { valor: dono.permissions }
  return { ausente: true }
}

/** Write scopes that reach code or releases, plus the ones that only post text. */
const SO_TEXTO = new Set(['issues', 'pull-requests', 'discussions'])
const NUNCA_CAPACIDADE = new Set([...SO_TEXTO, 'id-token', 'models', 'copilot-requests'])

function escopos(permissoes) {
  if (permissoes.ausente) return { ausente: true, capazes: [], texto: [], idToken: false }
  const v = permissoes.valor
  if (v === 'write-all') return { capazes: ['write-all'], texto: [], idToken: true }
  if (!ehMapa(v)) return { capazes: [], texto: [], idToken: false }
  const capazes = []
  const texto = []
  for (const [k, nivel] of Object.entries(v)) {
    if (String(nivel) !== 'write') continue
    if (!NUNCA_CAPACIDADE.has(k)) capazes.push(k)
    if (SO_TEXTO.has(k)) texto.push(k)
  }
  return { capazes, texto, idToken: String(v['id-token']) === 'write' }
}

/** Env variable names that carry an agent's own model credential. */
const ENV_DE_AUTENTICACAO = new RegExp(
  j(
    '^(ANTHROPIC_API_KEY|CLA',
    'UDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|COD',
    'EX_API_KEY|GEM',
    'INI_API_KEY|GOOGLE_API_KEY|COPI',
    'LOT_GITHUB_TOKEN)$',
  ),
)

/** Secret names referenced in the expressions of a value, and whether `toJSON(secrets)` is. */
function segredosEm(valor) {
  const nomes = []
  let todos = false
  for (const expr of expressoesEm(valor)) {
    if (/\btoJSON\s*\(\s*secrets\s*\)/.test(expr)) todos = true
    for (const m of expr.matchAll(/\bsecrets\s*(?:\.\s*([A-Za-z_][\w-]*)|\[\s*'([^']+)'\s*\])/g)) {
      nomes.push(m[1] || m[2])
    }
  }
  return { nomes: nomes.filter((n) => n.toUpperCase() !== 'GITHUB_TOKEN'), todos }
}

function segredosDoEnv(env) {
  const nomes = []
  let todos = false
  if (!ehMapa(env)) return { nomes, todos }
  for (const [nome, valor] of Object.entries(env)) {
    if (ENV_DE_AUTENTICACAO.test(nome)) continue
    const s = segredosEm(valor)
    nomes.push(...s.nomes)
    todos ||= s.todos
  }
  return { nomes, todos }
}

const verdadeiro = (v) =>
  v === true || (typeof v === 'string' && (/^\s*true\s*$/i.test(v) || v.includes('${{')))

/** JSON text a vendor input holds, or undefined when it is absent or not strict JSON. */
function jsonDaEntrada(v) {
  if (ehMapa(v) || Array.isArray(v)) return v
  if (typeof v !== 'string' || !v.trim()) return undefined
  const r = lerJsonc(v.trim(), { estrito: true })
  return r.erro ? undefined : r.valor
}

/** The tool entries of `--allowedTools`/`--allowed-tools` among the words, split as the CLI splits them. */
function ferramentasDasPalavras(palavras) {
  const saida = []
  const OPCAO = new RegExp(j('^--allowed', '(?:Tools|-tools)(?:=(.*))?$'))
  for (let i = 0; i < palavras.length; i++) {
    const m = OPCAO.exec(palavras[i])
    if (!m) continue
    if (m[1] !== undefined) saida.push(m[1])
    else {
      for (let k = i + 1; k < palavras.length && !palavras[k].startsWith('-'); k++)
        saida.push(palavras[k])
    }
  }
  return saida.flatMap(dividirFerramentas)
}

/**
 * The entries of Copilot CLI's `--allow-tool`, one value per option, a quoted
 * comma-separated list allowed (GitHub Copilot CLI command reference).
 */
function ferramentasDoCopilot(palavras) {
  const saida = []
  const OPCAO = new RegExp(j('^--allow', '-tool(?:=(.*))?$'))
  for (let i = 0; i < palavras.length; i++) {
    const m = OPCAO.exec(palavras[i])
    if (!m) continue
    const v = m[1] !== undefined ? m[1] : palavras[i + 1]
    if (typeof v === 'string') saida.push(...dividirFerramentasPorVirgula(v))
  }
  return saida
}

/** Splits a tool list at commas and blanks outside parentheses. */
function dividirFerramentas(texto) {
  const saida = []
  let atual = ''
  let profundidade = 0
  for (const c of String(texto)) {
    if (c === '(') profundidade++
    if (c === ')') profundidade = Math.max(0, profundidade - 1)
    if (profundidade === 0 && (c === ',' || /\s/.test(c))) {
      if (atual.trim()) saida.push(atual.trim())
      atual = ''
      continue
    }
    atual += c
  }
  if (atual.trim()) saida.push(atual.trim())
  return saida
}

const SHELL_DO_GEMINI = new RegExp(j('^\\s*(?:run', '_shell', '_command|Shell', 'Tool)\\b'))
const SHELL_INTEIRO_DO_GEMINI = new RegExp(
  j('^\\s*(?:run', '_shell', '_command|Shell', 'Tool)\\s*$'),
)
const BYPASS_DO_CODEX = j('-', '-', 'dangerously-', 'bypass-', 'approvals-', 'and-', 'sandbox')
const FREIO_DO_CODEX = j('-', '-', 'yo', 'lo')
const SEM_SANDBOX = j('danger-', 'full-', 'access')

/** Whether a Copilot tool entry (`copilot-allow-tools`, `--allow-tool`) grants the whole shell. */
function copilotAmplo(t) {
  if (t === 'shell') return true
  const m = /^shell\s*\(([\s\S]*)\)$/.exec(t)
  return m !== null && ehRegraAmpla(j('cla', 'ude'), j('Ba', 'sh(', m[1], ')'))
}

/**
 * The Claude Code reasons in the words given to the CLI (claude_args, or the
 * command a `run:` step starts) and in settings objects: the `settings` input,
 * and each inline JSON `--settings` value among the words.
 */
function motivosDoClaude(palavras, settingsExtra, motivos) {
  let amplo = ferramentasDasPalavras(palavras).some((f) => ehRegraAmpla(j('cla', 'ude'), f))
  let aprova = false
  for (const settings of [...settingsExtra, ...settingsDasPalavras(palavras)]) {
    const permissoes =
      ehMapa(settings) && ehMapa(settings.permissions) ? settings.permissions : null
    if (permissoes && [j('bypass', 'Permissions'), 'auto'].includes(permissoes.defaultMode)) {
      aprova = true
    }
    if (permissoes && Array.isArray(permissoes.allow)) {
      amplo ||= permissoes.allow.some((f) => ehRegraAmpla(j('cla', 'ude'), f))
    }
  }
  if (aprova) motivos.push('settings that approve every tool call')
  return amplo
}

/** The reasons an agent step can run commands, from its inputs or its run text. */
function motivosDeExecucao(dados, com, run, tabelas, campos) {
  const motivos = []
  const valor = (k) => (typeof com[k] === 'string' ? com[k].trim() : comoTexto(com[k]).trim())
  if (dados.agente === j('cla', 'ude')) {
    const args = `${comoTexto(com[j('cla', 'ude_args')])} ${comoTexto(com.allowed_tools)}`.replace(
      /\r?\n/g,
      ' ',
    )
    const achados = varrerShell(`${j('cla', 'ude')} ${args}`, tabelas, { dialetos: ['posix'] })
    if (achados.some((a) => a.forca !== 'fraca'))
      motivos.push('the agent starts with its approval checks off')
    const settings = jsonDaEntrada(com.settings)
    let amplo = motivosDoClaude(
      palavrasDosArgs(comoTexto(com[j('cla', 'ude_args')])),
      ehMapa(settings) ? [settings] : [],
      motivos,
    )
    if (com.allowed_tools !== undefined) {
      amplo ||= dividirFerramentas(comoTexto(com.allowed_tools)).some((f) =>
        ehRegraAmpla(j('cla', 'ude'), f),
      )
    }
    if (amplo) motivos.push('a whole-shell tool grant')
  }
  if (dados.agente === j('gem', 'ini')) {
    const settings = jsonDaEntrada(com.settings)
    if (!ehMapa(settings)) motivos.push('every tool approved and no tool list')
    else {
      const ferramentas = ehMapa(settings.tools) ? settings.tools : {}
      const nucleo = Array.isArray(ferramentas.core) ? ferramentas.core : settings.coreTools
      const excluidas = [
        ...(Array.isArray(ferramentas.exclude) ? ferramentas.exclude : []),
        ...(Array.isArray(settings.excludeTools) ? settings.excludeTools : []),
      ]
      // Only the bare tool name removes the shell: a scoped entry such as
      // `run_shell_command(rm)` blocks that command prefix and keeps the rest
      // (Gemini CLI docs/tools/shell.md, "Block specific command prefixes").
      const shellExcluido = excluidas.some((x) => SHELL_INTEIRO_DO_GEMINI.test(String(x)))
      if (!Array.isArray(nucleo)) {
        if (!shellExcluido) motivos.push('every tool approved and no tool list')
      } else if (!shellExcluido && nucleo.some((x) => SHELL_DO_GEMINI.test(String(x)))) {
        motivos.push('every tool approved, a shell tool among them')
      }
    }
  }
  if (dados.agente === j('cod', 'ex')) {
    const perfil = valor('permission-profile')
    const sandbox = valor('sandbox')
    const estrategia = valor('safety-strategy')
    if ((sandbox === SEM_SANDBOX && estrategia !== 'read-only') || perfil === `:${SEM_SANDBOX}`) {
      motivos.push('no sandbox')
    }
    if (estrategia === 'unsafe') motivos.push('the unsafe safety strategy')
    if (!perfil && sandbox !== 'read-only' && estrategia !== 'read-only') {
      const bruto = com[j('cod', 'ex-args')]
      const lidos = Array.isArray(jsonDaEntrada(bruto)) ? jsonDaEntrada(bruto) : null
      const palavras = lidos
        ? lidos.filter((x) => typeof x === 'string')
        : palavrasDosArgs(comoTexto(bruto))
      if (palavras.some((w) => w === BYPASS_DO_CODEX || w === FREIO_DO_CODEX)) {
        motivos.push('codex-args turn approval and the sandbox off')
      }
    }
  }
  if (dados.agente === j('copi', 'lot')) {
    if (dividirFerramentasPorVirgula(valor('copilot-allow-tools')).some(copilotAmplo))
      motivos.push('a whole-shell tool grant')
  }
  if (dados.agente === 'cli') {
    const achados = varrerShell(run, tabelas, { dialetos: ['posix', 'pwsh'] })
    if (achados.some((a) => a.forca !== 'fraca'))
      motivos.push('the agent starts with its approval checks off')
    if (taintEm(run, campos).length)
      motivos.push('event text interpolated into the shell that starts the agent')
    // The same grants the actions are judged by, read from the command itself:
    // measured before, `--allowedTools Bash` failed the base action and was a
    // note on the CLI.
    let amplo = false
    for (const { agente, palavras } of invocacoesDeAgente(run)) {
      if (agente === j('cla', 'ude')) amplo ||= motivosDoClaude(palavras, [], motivos)
      if (agente === j('copi', 'lot')) amplo ||= ferramentasDoCopilot(palavras).some(copilotAmplo)
    }
    if (amplo) motivos.push('a whole-shell tool grant')
  }
  return [...new Set(motivos)]
}

/** copilot-allow-tools splits at commas outside parentheses. */
function dividirFerramentasPorVirgula(texto) {
  const saida = []
  let atual = ''
  let profundidade = 0
  for (const c of String(texto)) {
    if (c === '(') profundidade++
    if (c === ')') profundidade = Math.max(0, profundidade - 1)
    if (c === ',' && profundidade === 0) {
      if (atual.trim()) saida.push(atual.trim())
      atual = ''
      continue
    }
    atual += c
  }
  if (atual.trim()) saida.push(atual.trim())
  return saida
}

/** Whether the vendor keeps the agent away from commands and from its own environment. */
function contido(dados, com) {
  const valor = (k) => (typeof com[k] === 'string' ? com[k].trim() : comoTexto(com[k]).trim())
  if (dados.agente === j('copi', 'lot')) {
    return (
      valor('copilot-allow-tools') === '' &&
      !(dados.mcpDoGithub && verdadeiro(com[dados.mcpDoGithub]))
    )
  }
  if (dados.agente === j('gem', 'ini')) {
    const settings = jsonDaEntrada(com.settings)
    if (!ehMapa(settings)) return false
    const ferramentas = ehMapa(settings.tools) ? settings.tools : {}
    const nucleo = Array.isArray(ferramentas.core) ? ferramentas.core : settings.coreTools
    const servidores = ehMapa(settings.mcpServers) ? Object.keys(settings.mcpServers) : []
    return (
      Array.isArray(nucleo) &&
      nucleo.length === 0 &&
      servidores.length === 0 &&
      valor('extensions') === ''
    )
  }
  if (dados.agente === j('cod', 'ex')) {
    // read-only runs Codex as a user that "likely has sudo privileges, so it
    // could read openai-api-key from memory" (codex-action action.yml), and
    // unprivileged-user leaves the privileges to the caller.
    const estrategia = valor('safety-strategy')
    return estrategia === '' || estrategia === 'drop-sudo'
  }
  return false
}

// ════════════════════════════════════════════════════════════════ the walk

const ACAO_SCRIPT = /^actions\/github-script(?:@|$)/i

/**
 * The expressions of a text with property indexing written as dots, the way
 * taintEm reads chains: `steps['x'].outputs["y"]` reads as `steps.x.outputs.y`.
 */
const expressoesNormalizadas = (texto) =>
  expressoesEm(texto).map((expr) =>
    expr.replace(/\s*\[\s*(?:'([^']*)'|"([^"]*)")\s*\]/g, (_, a, b) => `.${a ?? b}`),
  )

/**
 * Where an output of step `id` is spliced into a later script: its own job and,
 * through job outputs, any job. A script splices it when one of its `${{ }}`
 * expressions names the output, in dot or bracket spelling, or names an
 * `env.<K>` whose value maps the output: the expression is substituted into the
 * script before the shell reads it, unlike `$K`. The mapping counts from the
 * step's own env and, for another job reading `needs`, from that job's env.
 * Measured before: `outputs['response']`, `steps['inference']` and the
 * `${{ env.R }}` hop were each a note where the dot spelling failed.
 */
function saidaEmExecucao(passos, indice, id, nomes, jobId, jobs) {
  if (typeof id !== 'string' || !nomes.length) return false
  const alternativas = nomes.join('|')
  const refPasso = new RegExp(
    `\\bsteps\\s*\\.\\s*${escapar(id)}\\s*\\.\\s*outputs\\s*\\.\\s*(?:${alternativas})(?![\\w-])`,
  )
  const nomeia = (texto, ref) => expressoesNormalizadas(texto).some((e) => ref.test(e))
  const textosQueExecutam = (passo) => {
    if (!ehMapa(passo)) return []
    const saida = []
    if (typeof passo.run === 'string') saida.push(passo.run)
    if (
      typeof passo.uses === 'string' &&
      ACAO_SCRIPT.test(passo.uses.trim()) &&
      ehMapa(passo.with)
    ) {
      if (typeof passo.with.script === 'string') saida.push(passo.with.script)
    }
    return saida
  }
  /** Whether a later step's scripts splice the output, directly or through an env key. */
  const splica = (passo, ref, envDoJob) => {
    const textos = textosQueExecutam(passo)
    if (!textos.length) return false
    if (textos.some((t) => nomeia(t, ref))) return true
    const chaves = [envDoJob, ehMapa(passo) ? passo.env : null]
      .filter(ehMapa)
      .flatMap((env) => Object.entries(env).filter(([, v]) => nomeia(comoTexto(v), ref)))
      .map(([k]) => escapar(k))
    if (!chaves.length) return false
    const refEnv = new RegExp(`\\benv\\s*\\.\\s*(?:${chaves.join('|')})(?![\\w-])`)
    return textos.some((t) => nomeia(t, refEnv))
  }
  if (passos.slice(indice + 1).some((p) => splica(p, refPasso, null))) return true
  const job = jobs && jobId !== null ? jobs[jobId] : null
  if (!ehMapa(job) || !ehMapa(job.outputs)) return false
  const mapeadas = Object.entries(job.outputs)
    .filter(([, v]) => nomeia(comoTexto(v), refPasso))
    .map(([n]) => escapar(n))
  if (!mapeadas.length) return false
  const refJob = new RegExp(
    `\\bneeds\\s*\\.\\s*${escapar(jobId)}\\s*\\.\\s*outputs\\s*\\.\\s*(?:${mapeadas.join('|')})(?![\\w-])`,
  )
  return Object.values(jobs).some(
    (outro) =>
      ehMapa(outro) &&
      Array.isArray(outro.steps) &&
      outro.steps.some((p) => splica(p, refJob, outro.env)),
  )
}

/** A condition's text with its string literals blanked, for looking at its function calls. */
const semLiterais = (c) => String(c).replace(/'(?:[^']|'')*'/g, "''")

/**
 * The conditions a job inherits. The runner keeps a job `if` as written when it
 * calls a status function (always, cancelled, failure or success, in any letter
 * case) and otherwise runs `success() && (<if>)` (actions/runner
 * PipelineTemplateConverter.ConvertToIfCondition), and success() is false once
 * a job it needs was skipped. So a job with no status function inherits the
 * conditions of every job it needs, and one that calls one gets its own `if`
 * with those conditions attached as `herdadas`, which decide its success()
 * atoms: measured before, `if: Always()` and `if: success() || needs.gate.result
 * == 'skipped'` behind an association gate job read as closed.
 * Items are a condition, or { se, herdadas } (see avaliarItem).
 */
function condicoesDoJob(jobs, id, vistos = new Set()) {
  if (vistos.has(id)) return []
  vistos.add(id)
  const job = jobs[id]
  if (!ehMapa(job)) return []
  const precisa =
    typeof job.needs === 'string' ? [job.needs] : Array.isArray(job.needs) ? job.needs : []
  const herdadas = precisa
    .filter((n) => typeof n === 'string')
    .flatMap((n) => condicoesDoJob(jobs, n, vistos))
  if (job.if === undefined || job.if === null) return herdadas
  const status =
    typeof job.if === 'string' &&
    /(?<![\w.])(?:always|failure|cancelled|success)\s*\(\s*\)/i.test(semLiterais(job.if))
  return status ? [{ se: job.if, herdadas }] : [job.if, ...herdadas]
}

/**
 * One inherited condition judged for a trigger: a plain condition, or a job `if`
 * with a status function, whose success() is false when any condition it
 * inherits is false and unknown otherwise.
 */
function avaliarItem(item, gatilhoNome, opcoes) {
  if (ehMapa(item) && 'se' in item) {
    const sucesso = item.herdadas.some((h) => avaliarItem(h, gatilhoNome, opcoes) === F) ? F : U
    return avaliarCondicao(item.se, gatilhoNome, { ...opcoes, sucesso })
  }
  return avaliarCondicao(item, gatilhoNome, opcoes)
}

/** The `inputs.<name>` references in the expressions of a value. */
function entradasReferidas(valor) {
  const nomes = new Set()
  for (const expr of expressoesEm(valor)) {
    for (const m of expr.matchAll(/\binputs\s*\.\s*([\w-]+)/g)) nomes.add(m[1])
  }
  return nomes
}

/**
 * Everything one workflow says, as items and notes. `contexto` reads the other
 * files: `yaml(caminho)` -> the parsed file or null, and `porNome(nome)` -> the
 * tracked workflows GitHub knows by that name.
 */
function analisarWorkflow(caminho, texto, contexto, t) {
  const itens = []
  const notas = { ilegiveis: [], invalidos: [], aninhados: [] }
  let agentes = 0
  const lido = lerYaml(texto, { ancoras: true })

  // A file of comments only (one adopter keeps its whole CI commented out)
  // holds no workflow at all: nothing to read and nothing to say.
  if (!lido.erro && lido.valor === null) return { itens, notas, agentes }
  if (lido.erro || !ehMapa(lido.valor)) {
    const onde0 = lido.erro ? onde(caminho, lido.erro.linha, lido.erro.coluna) : onde(caminho, 1, 1)
    const semSuporte =
      !lido.erro ||
      /not supported|more than one YAML document|alias expansion too large|nesting deeper/.test(
        lido.erro.mensagem,
      )
    if (!semSuporte) {
      notas.invalidos.push(onde0)
      return { itens, notas, agentes }
    }
    if (nomeiaAgente(texto, t)) {
      itens.push({
        severidade: 'reprova',
        texto:
          `${onde0} names an AI agent in YAML this rule cannot read ` +
          `(${escaparSaida(lido.erro ? lido.erro.mensagem : 'the root is not a mapping', { limite: 80 })})`,
        arquivos: [caminho],
      })
    } else notas.ilegiveis.push(onde0)
    return { itens, notas, agentes }
  }

  const raiz = lido.valor
  const lugar = (ponteiro) => {
    for (let p = ponteiro; ; p = p.slice(0, p.lastIndexOf('/'))) {
      if (lido.posicoes.has(p)) return lido.posicoes.get(p)
      if (!p) return { linha: 1, coluna: 1 }
    }
  }

  // Outside triggers, with workflow_run resolved against the tracked upstreams.
  let fora = gatilhosDeFora(raiz, t.gatilhos)
  const acima = []
  if (fora.includes('workflow_run')) {
    const nomes =
      ehMapa(raiz.on) && ehMapa(raiz.on.workflow_run) ? raiz.on.workflow_run.workflows : undefined
    const lista = typeof nomes === 'string' ? [nomes] : Array.isArray(nomes) ? nomes : null
    let seguro = lista !== null && lista.length > 0
    for (const nome of lista || []) {
      const encontrados = contexto.porNome(String(nome))
      if (!encontrados.length) {
        seguro = false
        continue
      }
      for (const f of encontrados) {
        acima.push(f.caminho)
        const declarados = Object.keys(gatilhosDeclarados(f.raiz.on))
        if (
          gatilhosDeFora(f.raiz, t.gatilhos).length ||
          declarados.includes('pull_request') ||
          declarados.includes('workflow_run')
        ) {
          seguro = false
        }
      }
    }
    if (seguro) fora = fora.filter((g) => g !== 'workflow_run')
  }

  // gh-aw lock files: the compiler writes its own role check; never a failure.
  // Recognised by the structure it writes (lockDoGhAw), and the roles are read
  // from the parsed env of the jobs the agent job needs: a pasted header comment
  // and a roles string in a comment made a plain workflow silent before.
  const lock = lockDoGhAw(texto, caminho)
  if (lock) {
    if (!fora.length) return { itens, notas, agentes }
    const papeis = lock.papeis
    const restrito = papeis.length > 0 && papeis.every((p) => !/(?:^|,)\s*all\s*(?:,|$)/i.test(p))
    if (!restrito) {
      itens.push({
        severidade: 'nota',
        texto: `${onde(caminho, 1, 1)} generated by gh-aw with its role check open to every account`,
        arquivos: [caminho],
      })
    }
    return { itens, notas, agentes }
  }

  const jobs = ehMapa(raiz.jobs) ? raiz.jobs : {}
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!ehMapa(job)) continue
    const ponteiroDoJob = `/jobs/${segmento(jobId)}`
    const condicoesDoCaller = condicoesDoJob(jobs, jobId)

    // A local reusable workflow, one level down.
    if (typeof job.uses === 'string' && job.uses.trim().startsWith('./')) {
      const alvo = posix.normalize(job.uses.trim().replace(/@.*$/, ''))
      const lidoAlvo = contexto.yaml(alvo)
      if (!lidoAlvo) continue
      const onde1 = lugar(`${ponteiroDoJob}/uses`)
      const jobsAlvo = ehMapa(lidoAlvo.valor.jobs) ? lidoAlvo.valor.jobs : {}
      const com = ehMapa(job.with) ? job.with : {}
      const taintDasEntradas = new Map(
        Object.entries(com).map(([k, v]) => [k, taintEm(v, t.campos)]),
      )
      const herdaSegredos = job.secrets === 'inherit'
      const segredosMapeados = ehMapa(job.secrets) ? new Set(Object.keys(job.secrets)) : new Set()
      for (const [idAlvo, jobAlvo] of Object.entries(jobsAlvo)) {
        if (!ehMapa(jobAlvo)) continue
        if (typeof jobAlvo.uses === 'string' && jobAlvo.uses.trim().startsWith('./')) {
          if (fora.length)
            notas.aninhados.push(
              `${onde(caminho, onde1.linha, onde1.coluna)} nested local workflow`,
            )
          continue
        }
        const passos = Array.isArray(jobAlvo.steps) ? jobAlvo.steps : []
        passos.forEach((passo, i) => {
          if (
            ehMapa(passo) &&
            typeof passo.uses === 'string' &&
            passo.uses.trim().startsWith('./')
          ) {
            if (fora.length)
              notas.aninhados.push(
                `${onde(caminho, onde1.linha, onde1.coluna)} nested local action`,
              )
            return
          }
          const r = julgarPasso({
            passo,
            indice: i,
            passos,
            jobId: idAlvo,
            jobs: jobsAlvo,
            condicoes: [
              ...condicoesDoCaller.map((c) => [c, false]),
              ...condicoesDoJob(jobsAlvo, idAlvo).map((c) => [c, true]),
              ...(ehMapa(passo) && passo.if !== undefined && passo.if !== null
                ? [[passo.if, true]]
                : []),
            ],
            fora,
            permissoes: permissoesDe(jobAlvo, lidoAlvo.valor, job, raiz),
            envs: [lidoAlvo.valor.env, jobAlvo.env],
            entradas: taintDasEntradas,
            segredoConta: (nome) => herdaSegredos || segredosMapeados.has(nome),
            t,
          })
          if (!r) return
          agentes++
          if (!r.veredito) return
          const cabeca =
            `${onde(caminho, onde1.linha, onde1.coluna)} job ${escaparSaida(jobId, { limite: 40 })} ` +
            `via ${escaparSaida(alvo, { limite: 80 })} job ${escaparSaida(idAlvo, { limite: 40 })} ` +
            `step ${i + 1} (${r.rotulo})`
          itens.push({
            severidade: r.veredito,
            texto: cabeca + r.cauda,
            arquivos: [caminho, contexto.real(alvo), ...acima],
          })
        })
      }
      continue
    }

    const passos = Array.isArray(job.steps) ? job.steps : []
    passos.forEach((passo, i) => {
      const ponteiro = `${ponteiroDoJob}/steps/${i}`
      const condicoesDoPasso =
        ehMapa(passo) && passo.if !== undefined && passo.if !== null ? [passo.if] : []

      // A local composite action, one level down.
      if (ehMapa(passo) && typeof passo.uses === 'string' && passo.uses.trim().startsWith('./')) {
        const pasta = posix.normalize(passo.uses.trim().replace(/\/+$/, ''))
        const candidatos = [`${pasta}/action.yml`, `${pasta}/action.yaml`].map((c) =>
          c.startsWith('./') ? c.slice(2) : c,
        )
        const achado = candidatos.find((c) => contexto.yaml(c))
        if (!achado) {
          // The runner reads a local action from the checked-out workspace, where
          // the file system follows a link; one this reader cannot follow is said.
          if (fora.length && candidatos.some((c) => contexto.quebrado(c))) {
            const onde2 = lugar(ponteiro)
            notas.aninhados.push(
              `${onde(caminho, onde2.linha, onde2.coluna)} local action behind a link that resolves nowhere`,
            )
          }
          return
        }
        // Measured before: a composite action behind a tracked folder link read
        // as no agent step at all; the finding names the file the link ends at.
        const arquivoAcao = contexto.real(achado)
        const acaoLida = contexto.yaml(arquivoAcao).valor
        const runs = ehMapa(acaoLida.runs) ? acaoLida.runs : {}
        if (String(runs.using).toLowerCase() !== 'composite' || !Array.isArray(runs.steps)) return
        const com = ehMapa(passo.with) ? passo.with : {}
        const taintDasEntradas = new Map(
          Object.entries(com).map(([k, v]) => [k, taintEm(v, t.campos)]),
        )
        const onde1 = lugar(ponteiro)
        runs.steps.forEach((interno, k) => {
          if (
            ehMapa(interno) &&
            typeof interno.uses === 'string' &&
            interno.uses.trim().startsWith('./')
          ) {
            if (fora.length)
              notas.aninhados.push(
                `${onde(caminho, onde1.linha, onde1.coluna)} nested local action`,
              )
            return
          }
          const r = julgarPasso({
            passo: interno,
            indice: k,
            passos: runs.steps,
            jobId: null,
            jobs: null,
            condicoes: [
              ...condicoesDoCaller.map((c) => [c, false]),
              ...condicoesDoPasso.map((c) => [c, false]),
              ...(ehMapa(interno) && interno.if !== undefined && interno.if !== null
                ? [[interno.if, true]]
                : []),
            ],
            fora,
            permissoes: permissoesDe(job, raiz),
            envs: [raiz.env, job.env, passo.env],
            entradas: taintDasEntradas,
            segredoConta: () => true,
            t,
          })
          if (!r) return
          agentes++
          if (!r.veredito) return
          const cabeca =
            `${onde(caminho, onde1.linha, onde1.coluna)} job ${escaparSaida(jobId, { limite: 40 })} ` +
            `step ${i + 1} via ${escaparSaida(arquivoAcao, { limite: 80 })} step ${k + 1} (${r.rotulo})`
          itens.push({
            severidade: r.veredito,
            texto: cabeca + r.cauda,
            arquivos: [caminho, arquivoAcao, ...acima],
          })
        })
        return
      }

      const r = julgarPasso({
        passo,
        indice: i,
        passos,
        jobId,
        jobs,
        condicoes: [...condicoesDoCaller, ...condicoesDoPasso].map((c) => [c, false]),
        fora,
        permissoes: permissoesDe(job, raiz),
        envs: [raiz.env, job.env],
        entradas: new Map(),
        segredoConta: () => true,
        t,
      })
      if (!r) return
      agentes++
      if (!r.veredito) return
      const p = lugar(ponteiro)
      const cabeca =
        `${onde(caminho, p.linha, p.coluna)} job ${escaparSaida(jobId, { limite: 40 })} ` +
        `step ${i + 1} (${r.rotulo})`
      itens.push({ severidade: r.veredito, texto: cabeca + r.cauda, arquivos: [caminho, ...acima] })
    })
  }
  return { itens, notas, agentes }
}

/**
 * Whether the raw text of a workflow names an agent action or starts an agent
 * CLI. Every token of a line that holds a path separator is tried as a `uses`,
 * wherever it sits: after an anchor or tag, inside a flow mapping step, or on
 * the line below a folded `uses: >-`. Measured before: `uses: &a <action>` and
 * `- {uses: <action>}` in a workflow with a tag this reader refuses were a note.
 */
function nomeiaAgente(texto, t) {
  for (const bruta of String(texto).split('\n')) {
    const semComentario = bruta.replace(/(?:^|\s)#.*$/, '')
    for (const ficha of semComentario.split(/[\s"'{}[\],]+/)) {
      const alvo = ficha.replace(/^(?:[&!*][^\s]*$|uses:)/, '')
      if (/[/\\]/.test(alvo) && acaoDoUses(alvo, t.acoes)) return true
    }
    const linha = bruta.replace(/^\s*(?:-\s+)?(?:["']?run["']?\s*:\s*[|>]?[-+0-9]*)?\s*/, '')
    if (!linha || linha.startsWith('#')) continue
    if (invocacoesDeAgente(linha).length) return true
  }
  return false
}

/**
 * One step judged: null when it is no agent step; otherwise the row label, the
 * verdict ('reprova' | 'nota' | null when nothing outside reaches it) and the
 * tail of its item.
 */
function julgarPasso({
  passo,
  indice,
  passos,
  jobId,
  jobs,
  condicoes,
  fora,
  permissoes,
  envs,
  entradas,
  segredoConta,
  t,
}) {
  if (!ehMapa(passo)) return null
  const row = acaoDoUses(passo.uses, t.acoes)
  let rotulo = row ? row.explicacao.slice(0, row.explicacao.indexOf(':')) : null
  let dados = row ? row.dados : null
  const run = typeof passo.run === 'string' ? passo.run : ''
  if (!dados && run && invocacoesDeAgente(run).length) {
    dados = {
      agente: 'cli',
      portao: null,
      texto: [],
      autenticacao: [],
      saidas: [],
      aprovacao: null,
    }
    rotulo = 'agent CLI'
  }
  if (!dados) return null
  const com = ehMapa(passo.with) ? passo.with : Object.create(null)

  const alcance = fora.filter((g) =>
    condicoes.every(
      ([c, comEntradas]) =>
        avaliarItem(c, g, {
          comEntradas,
          GATILHOS_DE_FORA: t.gatilhos,
          repositorio: t.repositorio,
        }) !== F,
    ),
  )
  let abertoPor = null
  if (dados.portao) {
    for (const [entrada, modo] of dados.portao.abridores) {
      const v = comoTexto(com[entrada]).trim()
      const estrela = v === '*' || v.includes('${{')
      if (modo === 'estrela' && estrela) abertoPor = entrada
      if (modo === 'estrelaComToken' && estrela && comoTexto(com.github_token).trim() !== '')
        abertoPor = entrada
      if (abertoPor) break
    }
  }
  const exposto = alcance.length > 0 && (dados.portao === null || abertoPor !== null)
  if (!exposto) return { rotulo, veredito: null }

  // Event text it interpolates, and the outside inputs of a reusable workflow
  // or composite action that the caller fills with event text.
  const textos = [
    ...dados.texto.map((k) => com[k]),
    passo.env,
    ...envs,
    ...(dados.agente === 'cli' ? [run] : []),
  ]
  const folhas = new Set(textos.flatMap((v) => taintEm(v, t.campos)))
  for (const v of textos) {
    for (const nome of entradasReferidas(v)) for (const f of entradas.get(nome) || []) folhas.add(f)
  }

  const motivos = motivosDeExecucao(dados, com, run, t.bypass, t.campos)
  const saidas = dados.agente === 'cli' ? ['[\\w-]+'] : dados.saidas.map(escapar)
  if (saidaEmExecucao(passos, indice, passo.id, saidas, jobId, jobs)) {
    motivos.push('its text output is interpolated into a later run or github-script step')
  }

  const e0 = escopos(permissoes)
  const estaContido = !motivos.length && contido(dados, com)
  if (!estaContido) {
    if (e0.ausente) motivos.push('no permissions block, so the token may be write-all')
    else if (e0.capazes.length) motivos.push(`write access: ${e0.capazes.join(', ')}`)
    const nomes = new Set()
    let todos = false
    const somar = ({ nomes: n, todos: tt }) => {
      for (const x of n) if (segredoConta(x)) nomes.add(x)
      todos ||= tt
    }
    for (const [k, v] of Object.entries(com)) {
      if (
        dados.autenticacao.includes(k) ||
        (dados.tokenDoApp === 'github_token' && k === 'github_token')
      )
        continue
      somar(segredosEm(v))
    }
    for (const env of [passo.env, ...envs]) somar(segredosDoEnv(env))
    if (dados.agente === 'cli') {
      const s = segredosEm(run)
      somar({ nomes: s.nomes.filter((n) => !ENV_DE_AUTENTICACAO.test(n)), todos: s.todos })
    }
    if (dados.tokenDoApp === 'github_token') {
      const token = segredosEm(com.github_token)
      if (token.nomes.some((n) => segredoConta(n)) || token.todos)
        motivos.push('a token passed to the agent')
    }
    if (todos) motivos.push('every repository secret')
    if (nomes.size)
      motivos.push(`${plural(nomes.size, 'secret', 'secrets')} besides the model credential`)
    if (dados.tokenDoApp) {
      const semToken =
        dados.tokenDoApp === 'github_token'
          ? comoTexto(com.github_token).trim() === ''
          : !verdadeiro(com[dados.tokenDoApp])
      if (semToken && e0.idToken && !e0.capazes.includes('write-all')) {
        motivos.push('write access through the vendor App token (contents, pull-requests, issues)')
      }
    }
    if (
      dados.mcpDoGithub &&
      verdadeiro(com[dados.mcpDoGithub]) &&
      (motivos.length || e0.texto.length)
    ) {
      motivos.push('GitHub MCP tools with a token')
    }
  }

  const porta = dados.portao === null ? 'no actor check' : `an actor check opened by ${abertoPor}`
  const interpola = folhas.size
    ? `; interpolates ${escaparSaida([...folhas].join(', '), { limite: 120 })}`
    : ''
  const cabeca = `: outside text reaches it through ${alcance.join(', ')} (${porta})${interpola}`
  if (motivos.length)
    return {
      rotulo,
      veredito: 'reprova',
      cauda: `${cabeca}; it can act through ${motivos.join('; ')}`,
    }
  const texto = e0.texto.length ? ` and write on ${e0.texto.join(', ')}` : ''
  return {
    rotulo,
    veredito: 'nota',
    cauda: `${cabeca}; nothing found to act with beyond its model credential${texto}`,
  }
}

// ════════════════════════════════════════════════════════════════ the rule

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/

export function achadosDosWorkflows(
  arquivos,
  tabelas,
  { repositorio = null, apelidos = new Map(), ligacoesQuebradas = [] } = {},
) {
  const t = { ...validarTabelas(tabelas), repositorio }
  const cache = new Map()
  // A path reached through a tracked link reads the file the link ends at.
  const real = (caminho) => apelidos.get(caminho) || caminho
  const yaml = (caminho) => {
    caminho = real(caminho)
    if (cache.has(caminho)) return cache.get(caminho)
    const texto = arquivos.get(caminho)
    let r = null
    if (typeof texto === 'string') {
      const lido = lerYaml(texto, { ancoras: true })
      if (!lido.erro && ehMapa(lido.valor)) r = lido
    }
    cache.set(caminho, r)
    return r
  }
  const workflows = [...arquivos.keys()].filter((c) => WORKFLOW.test(c)).sort()
  // GitHub names a workflow by `name:`, and by its path from the repository
  // root when it has none (workflow syntax, `name`).
  const porNome = (nome) =>
    workflows
      .map((c) => ({ caminho: c, lido: yaml(c) }))
      .filter(
        ({ caminho, lido }) =>
          lido &&
          (typeof lido.valor.name === 'string' ? lido.valor.name === nome : caminho === nome),
      )
      .map(({ caminho, lido }) => ({ caminho, raiz: lido.valor }))
  const quebrado = (caminho) =>
    ligacoesQuebradas.some((a) => caminho === a || caminho.startsWith(`${a}/`))
  const contexto = { yaml, porNome, real, quebrado }
  const itens = []
  const notas = { ilegiveis: [], invalidos: [], aninhados: [] }
  let agentes = 0
  for (const caminho of workflows) {
    const r = analisarWorkflow(caminho, arquivos.get(caminho), contexto, t)
    itens.push(...r.itens)
    for (const k of Object.keys(notas)) notas[k].push(...r.notas[k])
    agentes += r.agentes
  }
  const textos = []
  if (notas.ilegiveis.length) {
    textos.push(
      `${plural(notas.ilegiveis.length, 'workflow', 'workflows')} this rule cannot read: ${resumir(notas.ilegiveis)}`,
    )
  }
  if (notas.invalidos.length) {
    textos.push(
      `${plural(notas.invalidos.length, 'workflow is', 'workflows are')} not valid YAML, and GitHub does not run ` +
        `${notas.invalidos.length === 1 ? 'it' : 'them'}: ${resumir(notas.invalidos)}`,
    )
  }
  if (notas.aninhados.length) {
    textos.push(`not read: ${resumir([...new Set(notas.aninhados)])}`)
  }
  return { itens, notas: textos, agentes, workflows: workflows.length }
}

export function checarWorkflowDeAgente(r, tabelas) {
  validarTabelas(tabelas)
  const indice = lerIndice(r.dir)
  if (indice.semGit) return na('no workflow in .github/workflows/')
  const permitidas = lerAllowlist(r.dir)
  const malformada = permitidas.erros.length > 0
  const errosDaLista = () =>
    `${NOME_DA_ALLOWLIST} is malformed, so it exempts nothing: ` +
    resumir(
      permitidas.erros.map((x) => `${onde(NOME_DA_ALLOWLIST, x.linha, x.coluna)} ${x.mensagem}`),
    )

  const reais = indice.entradas.filter((e) => !e.symlink && !e.viaSymlink)
  const workflows = reais.filter((e) => WORKFLOW.test(e.caminho))
  if (!workflows.length)
    return malformada ? errosDaLista() : na('no workflow in .github/workflows/')
  if (workflows.every((e) => e.estado === 'ausente')) {
    throw new Error(
      `read none of the ${workflows.length} tracked workflow(s): every blob is missing`,
    )
  }

  const arquivos = new Map()
  for (const e of reais) {
    if (e.texto === null || e.estado === 'lfs' || e.estado === 'binario') continue
    if (WORKFLOW.test(e.caminho) || /(?:^|\/)action\.ya?ml$/.test(e.caminho))
      arquivos.set(e.caminho, e.texto)
  }
  const notasDeLeitura = []
  const truncados = workflows.filter((e) => e.estado === 'truncado').length
  const naoYaml = workflows.filter((e) => e.estado === 'lfs' || e.estado === 'binario').length
  if (truncados) notasDeLeitura.push(`${plural(truncados, 'workflow', 'workflows')} not read whole`)
  if (naoYaml)
    notasDeLeitura.push(`${plural(naoYaml, 'workflow is', 'workflows are')} not YAML text`)

  // Action files behind a tracked link, by the path a workflow names, to the
  // real file the link ends at; and the links that end nowhere.
  const apelidos = new Map()
  const ligacoesQuebradas = []
  for (const e of indice.entradas) {
    if (!e.symlink && !e.viaSymlink) continue
    if (e.symlink && e.symlink.externo) {
      ligacoesQuebradas.push(e.caminho)
      continue
    }
    const fonte = indice.origem.get(e)
    if (fonte && arquivos.has(fonte.caminho) && /(?:^|\/)action\.ya?ml$/.test(e.caminho))
      apelidos.set(e.caminho, fonte.caminho)
  }
  const {
    itens,
    notas,
    agentes,
    workflows: lidos,
  } = achadosDosWorkflows(arquivos, tabelas, {
    repositorio: repositorioDeOrigem(r.dir),
    apelidos,
    ligacoesQuebradas,
  })
  const oids = new Map(reais.map((e) => [e.caminho, e.oid]))

  // An exemption needs an entry for EVERY file the finding depends on: the
  // workflow, the reusable workflow or composite action it resolved, and the
  // workflow_run upstream that made it reachable. Checked before marking, so an
  // entry that did not exempt anything alone is not counted as used.
  let usouEntrada = false
  const chavesDe = (item) =>
    [...new Set(item.arquivos)].map((arquivo) => ({ arquivo, oid: oids.get(arquivo) }))
  const restantes = itens.filter((item) => {
    if (malformada) return true
    const chaves = chavesDe(item)
    const cobre = (chave) =>
      permitidas.entradas.some(
        (x) => x.regra === REGRA && x.forma.every((campo) => chave[campo] === x[campo]),
      )
    if (!chaves.every(cobre)) return true
    for (const chave of chaves) permitidas.aceita(REGRA, chave)
    usouEntrada = true
    return false
  })
  // What --sugerir-allowlist prints: one {arquivo, oid} line for every file a
  // failing step depends on, since the exemption above wants them all. A line
  // the allowlist already holds is dropped by the printer, so a finding one
  // entry short gets exactly the missing line. Warnings fail nothing and get none.
  for (const item of restantes) {
    if (item.severidade !== 'reprova') continue
    for (const chave of chavesDe(item)) if (chave.oid) sugerirEntrada(r, REGRA, chave)
  }
  const reprova = restantes.filter((x) => x.severidade === 'reprova').map((x) => x.texto)
  const avisa = restantes.filter((x) => x.severidade === 'nota').map((x) => x.texto)

  const partesDaNota = []
  if (avisa.length) {
    partesDaNota.push(
      `${plural(avisa.length, 'AI agent step', 'AI agent steps')} that outside text reaches with nothing ` +
        `found to act with: ${resumir(avisa)}`,
    )
  }
  partesDaNota.push(...notasDeLeitura, ...notas)
  const obsoletas = malformada ? 0 : permitidas.obsoletas(REGRA)
  if (obsoletas) {
    partesDaNota.push(
      `${plural(obsoletas, 'allowlist entry', 'allowlist entries')} for ${REGRA} ` +
        `no longer ${obsoletas === 1 ? 'matches' : 'match'} a finding`,
    )
  }
  if (permitidas.naoRastreada) {
    partesDaNota.push(`${NOME_DA_ALLOWLIST} exists on disk but is not tracked, so it is ignored`)
  }
  if (usouEntrada && permitidas.rastreada && !permitidas.cobertaPorCodeowners) {
    partesDaNota.push(`${NOME_DA_ALLOWLIST} is in use and no CODEOWNERS entry owns it`)
  }

  if (reprova.length || malformada) {
    const partes = []
    if (reprova.length) {
      partes.push(
        `${plural(reprova.length, 'AI agent step', 'AI agent steps')} that outside text reaches with power ` +
          `to act: ${resumir(reprova)} — anyone who can open an issue, comment or pull request steers an ` +
          'agent that holds this power (PromptPwnd, Clinejection); take the power or the outside trigger ' +
          'away, or allowlist the workflow by {arquivo, oid}',
      )
    }
    if (malformada) partes.push(errosDaLista())
    if (avisa.length) partes.push(`plus ${plural(avisa.length, 'warning', 'warnings')}`)
    return partes.join(' · ')
  }
  if (!agentes && !itens.length && !partesDaNota.length) {
    return na(`no known AI agent step in ${plural(lidos, 'workflow', 'workflows')}`)
  }
  return partesDaNota.length ? { nota: partesDaNota.join(' · ') } : null
}
