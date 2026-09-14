// prove-workflow — ai-workflow-untrusted-input: an AI agent step in a GitHub
// workflow that outside text reaches, and what that agent can act with.
//
//   node --test tooling/security/injection/prove-workflow.mjs
//
// Every agent binary name, switch and value below is assembled at runtime, for
// the reason prove-bypass.mjs gives: this file is tracked, rebar's own run reads
// it raw, and prove-table.mjs holds every text table against it.
//
// Most tests call achadosDosWorkflows, the index-free core, over a map of
// files: a git spawn costs about 50 ms on Windows and the verdict logic needs
// none. The tests of what only the rule entry does (the index, the allowlist,
// the not-applicable branches, the final message) build index-only temp
// repositories the way prove-bypass.mjs does.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { describe } from 'node:test'
import { deflateSync } from 'node:zlib'

import {
  BINARIOS_DE_AGENTE,
  FLAGS_AMBIGUAS,
  FLAGS_FORTES,
  PARES_DE_FLAG,
  agenteDoComando,
  caminhoDoUses,
  comandosDoShell,
  invocacoesDeAgente,
} from './bypass.mjs'
import {
  ACOES_DE_AGENTE,
  CAMPOS_DO_EVENTO,
  GATILHOS_DE_FORA,
  achadosDosWorkflows,
  avaliarCondicao,
  checarWorkflowDeAgente,
  taintEm,
} from './workflow.mjs'

const TABELAS = {
  ACOES_DE_AGENTE,
  GATILHOS_DE_FORA,
  CAMPOS_DO_EVENTO,
  FLAGS_FORTES,
  FLAGS_AMBIGUAS,
  PARES_DE_FLAG,
  BINARIOS_DE_AGENTE,
}

// ───────────────────────────────────────────────────── the assembled vocabulary

const j = (...partes) => partes.join('')
const D = j('-', '-')
const CL = j('cla', 'ude')
const GE = j('gem', 'ini')
const CO = j('cod', 'ex')
const CP = j('copi', 'lot')
const ACAO_CLAUDE = j('anthropics/', CL, '-code-action@v1')
const BASE_CLAUDE = j('anthropics/', CL, '-code-action/base-action@v1')
const ACAO_GEMINI = j('google-github-actions/run-', GE, '-cli@v0')
const ACAO_CODEX = j('openai/', CO, '-action@v1')
const INFERENCIA = 'actions/ai-inference@v1'
const OPENCODE = j('sst/open', 'code/github@latest')
const SEM_SANDBOX = j('danger-', 'full-', 'access')
const SKIP = j(D, 'dangerously-', 'skip-', 'permissions')
const SEM_FREIO = j(D, 'yo', 'lo')
const BASH = j('Ba', 'sh')
const SHELL_GE = j('run', '_shell', '_command')
const SEGREDO = (nome) => `\${{ secrets.${nome} }}`

// ─────────────────────────────────────────────────────── building workflows

/** YAML for a `with:` or `env:` map, one level deep, values emitted as given. */
const mapa = (objeto, recuo) =>
  Object.entries(objeto)
    .map(([k, v]) => `${' '.repeat(recuo)}${k}: ${v}`)
    .join('\n')

/**
 * One workflow: `on` as YAML text, `permissions` as a map or a string or null
 * (no block), and `jobs` as { id: { if?, needs?, steps: [step] } }; each step is
 * { uses?, run?, id?, if?, with?, env? } with every value already YAML.
 */
function workflow({ on = 'issues', permissions = { contents: 'read' }, env, jobs }) {
  const linhas = ['name: proof', `on: ${on}`]
  if (permissions && typeof permissions === 'object') {
    linhas.push('permissions:', mapa(permissions, 2))
  } else if (typeof permissions === 'string') linhas.push(`permissions: ${permissions}`)
  if (env) linhas.push('env:', mapa(env, 2))
  linhas.push('jobs:')
  for (const [id, job] of Object.entries(jobs)) {
    linhas.push(`  ${id}:`, '    runs-on: ubuntu-latest')
    if (job.if !== undefined) linhas.push(`    if: ${job.if}`)
    if (job.needs !== undefined) linhas.push(`    needs: ${job.needs}`)
    if (job.permissions) linhas.push('    permissions:', mapa(job.permissions, 6))
    if (job.outputs) linhas.push('    outputs:', mapa(job.outputs, 6))
    if (job.uses) {
      linhas.push(`    uses: ${job.uses}`)
      if (job.with) linhas.push('    with:', mapa(job.with, 6))
      if (job.secrets) linhas.push(`    secrets: ${job.secrets}`)
      continue
    }
    linhas.push('    steps:')
    for (const passo of job.steps) {
      const campos = Object.entries(passo).filter(([k]) => !['with', 'env'].includes(k))
      campos.forEach(([k, v], i) => linhas.push(`${i === 0 ? '      - ' : '        '}${k}: ${v}`))
      for (const bloco of ['with', 'env']) {
        if (passo[bloco]) linhas.push(`        ${bloco}:`, mapa(passo[bloco], 10))
      }
    }
  }
  return `${linhas.join('\n')}\n`
}

/**
 * A workflow shaped like a gh-aw lock file: header, `activation` and `agent`
 * jobs with the agent needing the activation, and with `papeis` a
 * `pre_activation` job whose step env holds the roles (the shape of all 24 lock
 * files of the corpora). The agent job starts Codex with its bypass switch.
 */
function lockDoGhAw({ papeis, comentario = '' } = {}) {
  const linhas = [
    '# gh-aw-metadata: {"schema_version":"v4"}',
    '# This file was automatically generated by gh-aw. DO NOT EDIT.',
    comentario.replace(/\n$/, ''),
    'name: lock',
    'on: issues',
    'jobs:',
  ].filter(Boolean)
  if (papeis !== undefined) {
    linhas.push(
      '  pre_activation:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - env:',
      `          GH_AW_REQUIRED_ROLES: "${papeis}"`,
      '        run: echo check',
    )
  }
  linhas.push('  activation:', '    runs-on: ubuntu-latest')
  if (papeis !== undefined) linhas.push('    needs: pre_activation')
  linhas.push(
    '    steps:',
    '      - run: echo activate',
    '  agent:',
    '    needs: activation',
    '    runs-on: ubuntu-latest',
    '    steps:',
    `      - run: ${CO} exec ${j(D, 'dangerously-', 'bypass-', 'approvals-', 'and-', 'sandbox')} hi`,
  )
  return `${linhas.join('\n')}\n`
}

const analisar = (arquivos, opcoes) =>
  achadosDosWorkflows(new Map(Object.entries(arquivos)), TABELAS, opcoes)
const umWorkflow = (w) => analisar({ '.github/workflows/w.yml': w })

/** The verdicts of one workflow's items, in order. */
const vereditos = (w) => umWorkflow(w).itens.map((x) => x.severidade)
const textoDe = (w) =>
  umWorkflow(w)
    .itens.map((x) => x.texto)
    .join('\n')

const passoClaude = (com = {}) => ({ uses: ACAO_CLAUDE, with: com })
const aberto = { github_token: SEGREDO('GITHUB_TOKEN'), allowed_non_write_users: '"*"' }

// ═════════════════════════════════════════════════════════════ conditions

describe('avaliarCondicao, per trigger, in three values', () => {
  test('the gemini-cli dedup job condition: reachable from issues, closed to an outside comment', () => {
    // google-gemini/gemini-cli gemini-automated-issue-dedup.yml, the job `if`.
    const se = [
      "github.repository == 'google-gemini/gemini-cli' &&",
      "vars.TRIAGE_DEDUPLICATE_ISSUES != '' &&",
      "(github.event_name == 'issues' ||",
      " github.event_name == 'workflow_dispatch' ||",
      " (github.event_name == 'issue_comment' &&",
      " contains(github.event.comment.body, '@gemini-cli /deduplicate') &&",
      " (github.event.comment.author_association == 'OWNER' ||",
      "  github.event.comment.author_association == 'MEMBER' ||",
      "  github.event.comment.author_association == 'COLLABORATOR')))",
    ].join('\n')
    assert.equal(avaliarCondicao(se, 'issues'), 'U')
    assert.equal(avaliarCondicao(se, 'issue_comment'), 'F')
    assert.equal(avaliarCondicao(`\${{ ${se} }}`, 'issue_comment'), 'F')
  })

  test("Google's dispatch example: the association chain of comment, review and issue", () => {
    const se = [
      "(github.event_name == 'pull_request' && github.event.pull_request.head.repo.fork == false) ||",
      '(github.event_name == \'issues\' && contains(fromJSON(\'["opened", "reopened"]\'), github.event.action)) ||',
      "(github.event.sender.type == 'User' &&",
      " startsWith(github.event.comment.body || github.event.review.body || github.event.issue.body, '@gemini-cli') &&",
      ' contains(fromJSON(\'["OWNER", "MEMBER", "COLLABORATOR"]\'), github.event.comment.author_association || github.event.review.author_association || github.event.issue.author_association))',
    ].join('\n')
    assert.equal(avaliarCondicao(se, 'issue_comment'), 'F')
    assert.equal(avaliarCondicao(se, 'pull_request_review'), 'F')
    assert.equal(avaliarCondicao(se, 'issues'), 'U')
  })

  test('the inputs context is null outside dispatch and call, and unknown inside a called workflow', () => {
    const doris = "inputs.pr_number != '' || github.event.comment.author_association == 'MEMBER'"
    assert.equal(avaliarCondicao(doris, 'issue_comment'), 'F')
    assert.equal(
      avaliarCondicao("inputs.pr_number != ''", 'issue_comment', { comEntradas: true }),
      'U',
    )
    assert.equal(avaliarCondicao("inputs.pr == ''", 'issues'), 'T')
    assert.equal(avaliarCondicao('github.event.inputs.force', 'issues'), 'F')
    assert.equal(avaliarCondicao('!inputs.force', 'issues'), 'T')
  })

  test('actor and association checks bind to the account that fired THIS trigger', () => {
    assert.equal(avaliarCondicao("github.event.action == 'labeled'", 'issues'), 'F')
    assert.equal(avaliarCondicao("github.event.action == 'opened'", 'issues'), 'U')
    assert.equal(avaliarCondicao("github.event.action != 'labeled'", 'issues'), 'U')
    assert.equal(avaliarCondicao("github.actor == 'maintainer-proof'", 'issues'), 'F')
    assert.equal(avaliarCondicao("'maintainer-proof' == github.triggering_actor", 'issues'), 'F')
    assert.equal(avaliarCondicao('contains(fromJSON(\'["a","b"]\'), github.actor)', 'issues'), 'F')
    assert.equal(avaliarCondicao('github.repository_owner == github.actor', 'issues'), 'F')
    // A string search is a substring test: `ali` is inside 'alice,bob'.
    assert.equal(avaliarCondicao("contains('alice,bob', github.actor)", 'issues'), 'U')
    // Under issue_comment the issue's association is the issue author's.
    assert.equal(
      avaliarCondicao("github.event.issue.author_association == 'OWNER'", 'issue_comment'),
      'U',
    )
    assert.equal(
      avaliarCondicao("github.event.comment.author_association == 'OWNER'", 'issue_comment'),
      'F',
    )
    // CONTRIBUTOR is any account with a merged commit.
    assert.equal(
      avaliarCondicao(
        'contains(fromJSON(\'["OWNER","CONTRIBUTOR"]\'), github.event.comment.author_association)',
        'issue_comment',
      ),
      'U',
    )
    assert.equal(
      avaliarCondicao("github.event.comment.author_association != 'NONE'", 'issue_comment'),
      'U',
    )
    assert.equal(
      avaliarCondicao("github.event.issue.user.login == 'owner-proof'", 'issue_comment'),
      'U',
    )
  })

  test('the fork check decides only for pull_request_target', () => {
    const fork = 'github.event.pull_request.head.repo.fork == false'
    assert.equal(avaliarCondicao(fork, 'pull_request_target'), 'F')
    assert.equal(avaliarCondicao(fork, 'pull_request_review'), 'U')
    assert.equal(avaliarCondicao(fork, 'pull_request_review_comment'), 'U')
    assert.equal(
      avaliarCondicao(
        'github.event.pull_request.head.repo.full_name == github.repository',
        'pull_request_target',
      ),
      'F',
    )
    assert.equal(
      avaliarCondicao('!github.event.pull_request.head.repo.fork', 'pull_request_target'),
      'F',
    )
  })

  test('outputs, results, parse failures and literals', () => {
    assert.equal(avaliarCondicao("needs.gate.outputs.ok == 'true'", 'issues'), 'U')
    assert.equal(avaliarCondicao("steps.check.outcome == 'success'", 'issues'), 'U')
    assert.equal(avaliarCondicao('(github.actor &&', 'issues'), 'U')
    assert.equal(avaliarCondicao("github.event_name == 'issues' && false", 'issues'), 'F')
    assert.equal(avaliarCondicao(false, 'issues'), 'F')
    assert.equal(avaliarCondicao("github.event_name != 'issues' || true", 'issues'), 'T')
  })
})

// ═════════════════════════════════════════════════════════════════ taint

describe('taintEm', () => {
  test('normalises bracket forms and counts a whole object only where it becomes text', () => {
    assert.deepEqual(
      taintEm(
        "x ${{ github['event'].issue['title'] }} ${{ github.event.commits[0].message }}",
        CAMPOS_DO_EVENTO,
      ),
      ['github.event.issue.title', 'github.event.commits.*.message'],
    )
    assert.deepEqual(taintEm('${{ toJSON(github.event) }}', CAMPOS_DO_EVENTO), ['github.event'])
    assert.deepEqual(taintEm('${{ github.event.issue.number }}', CAMPOS_DO_EVENTO), [])
    assert.deepEqual(taintEm('${{ github.event.issue && 1 }}', CAMPOS_DO_EVENTO), [])
    assert.deepEqual(taintEm({ a: '${{ github.head_ref }}' }, CAMPOS_DO_EVENTO), [
      'github.head_ref',
    ])
    assert.deepEqual(
      taintEm('github.event.issue.title without an expression', CAMPOS_DO_EVENTO),
      [],
    )
  })
})

// ════════════════════════════════════════════════════ triggers and actions

describe('triggers, action rows and actor gates', () => {
  const claudeAberto = (on) =>
    workflow({
      on,
      jobs: { a: { steps: [passoClaude({ ...aberto, claude_args: `${D}allowedTools ${BASH}` })] } },
    })

  test('declared types narrow a trigger, and pull_request_target defaults to opened, synchronize, reopened', () => {
    assert.deepEqual(vereditos(claudeAberto('\n  issues:\n    types: [labeled]')), [])
    assert.deepEqual(vereditos(claudeAberto('\n  issues:\n    types: [labeled, opened]')), [
      'reprova',
    ])
    assert.deepEqual(vereditos(claudeAberto('\n  issues:\n    types: edited')), ['reprova'])
    assert.deepEqual(vereditos(claudeAberto('pull_request_target')), ['reprova'])
    assert.deepEqual(vereditos(claudeAberto('\n  pull_request_target:\n    types: [labeled]')), [])
    assert.deepEqual(
      vereditos(claudeAberto('[push, pull_request, workflow_dispatch, schedule]')),
      [],
    )
    assert.deepEqual(vereditos(claudeAberto('[push, discussion_comment]')), ['reprova'])
  })

  test('the base action matches before the gated one, whatever the case or a subpath', () => {
    const passo = (uses) =>
      workflow({
        jobs: { a: { steps: [{ uses, with: { claude_args: `${D}allowedTools ${BASH}` } }] } },
      })
    assert.match(
      textoDe(passo(BASE_CLAUDE)),
      /\(Anthropic Claude Code base action\): .*no actor check/,
    )
    assert.match(textoDe(passo(BASE_CLAUDE.toUpperCase())), /base action/)
    // The gated action keeps its actor check, so the same grant says nothing.
    assert.deepEqual(vereditos(passo(ACAO_CLAUDE)), [])
    assert.deepEqual(vereditos(passo(j('anthropics/', CL, '-code-action/some/sub@v1'))), [])
    assert.deepEqual(vereditos(passo(`./${j('anthropics/', CL, '-code-action')}`)), [])
  })

  test('each opener opens the gate, and a named list keeps it closed', () => {
    const grant = { claude_args: `${D}allowedTools ${BASH}` }
    const com = (extra) =>
      workflow({ jobs: { a: { steps: [passoClaude({ ...grant, ...extra })] } } })
    assert.match(textoDe(com(aberto)), /an actor check opened by allowed_non_write_users/)
    // "Only works when github_token input is provided" (action.yml).
    assert.deepEqual(vereditos(com({ allowed_non_write_users: '"*"' })), [])
    assert.deepEqual(vereditos(com({ ...aberto, allowed_non_write_users: '"alice,bob"' })), [])
    assert.match(
      textoDe(com({ ...aberto, allowed_non_write_users: '${{ vars.USERS }}' })),
      /opened by/,
    )
    assert.match(textoDe(com({ allowed_bots: '"*"' })), /opened by allowed_bots/)
    const codex = (extra) =>
      workflow({
        jobs: { a: { steps: [{ uses: ACAO_CODEX, with: { sandbox: SEM_SANDBOX, ...extra } }] } },
      })
    assert.match(textoDe(codex({ 'allow-users': '"*"' })), /opened by allow-users/)
    assert.deepEqual(vereditos(codex({ 'allow-users': 'alice' })), [])
    assert.deepEqual(vereditos(codex({ 'allow-bots': 'true', 'allow-bot-users': '"*"' })), [])
    // OpenCode checks write access with no input to open it.
    assert.deepEqual(vereditos(workflow({ jobs: { a: { steps: [{ uses: OPENCODE }] } } })), [])
  })
})

// ════════════════════════════════════════════════════════════ the verdicts

describe('what the agent can act with', () => {
  const um = (passo, extra = {}) => workflow({ ...extra, jobs: { a: { steps: [passo] } } })

  test('execution reasons fail at any permission level', () => {
    const casos = [
      [
        passoClaude({ ...aberto, claude_args: `"${SKIP}"` }),
        'the agent starts with its approval checks off',
      ],
      [
        passoClaude({ ...aberto, claude_args: `${D}allowedTools "${BASH}(npm:*),Read"` }),
        'a whole-shell tool grant',
      ],
      [
        passoClaude({
          ...aberto,
          settings: `'{"permissions":{"defaultMode":"${j('bypass', 'Permissions')}"}}'`,
        }),
        'settings that approve every tool call',
      ],
      [
        passoClaude({ ...aberto, settings: `'{"permissions":{"allow":["${BASH}"]}}'` }),
        'a whole-shell tool grant',
      ],
      [{ uses: ACAO_GEMINI }, 'every tool approved and no tool list'],
      [
        {
          uses: ACAO_GEMINI,
          with: { settings: `'{"tools":{"core":["${SHELL_GE}(gh issue edit)"]}}'` },
        },
        'every tool approved, a shell tool among them',
      ],
      [{ uses: ACAO_CODEX, with: { 'allow-users': '"*"', sandbox: SEM_SANDBOX } }, 'no sandbox'],
      [
        {
          uses: ACAO_CODEX,
          with: { 'allow-users': '"*"', 'permission-profile': `':${SEM_SANDBOX}'` },
        },
        'no sandbox',
      ],
      [
        { uses: ACAO_CODEX, with: { 'allow-users': '"*"', 'safety-strategy': 'unsafe' } },
        'the unsafe safety strategy',
      ],
      [
        { uses: ACAO_CODEX, with: { 'allow-users': '"*"', 'codex-args': `'["${SEM_FREIO}"]'` } },
        'codex-args turn approval and the sandbox off',
      ],
      [{ uses: INFERENCIA, with: { 'copilot-allow-tools': '"shell(git:*),write"' } }, null],
      [
        { uses: INFERENCIA, with: { 'copilot-allow-tools': '"shell,write"' } },
        'a whole-shell tool grant',
      ],
      [
        { uses: INFERENCIA, with: { 'copilot-allow-tools': '"shell(npx:*)"' } },
        'a whole-shell tool grant',
      ],
      [{ run: `"${CL} -p hi ${SKIP}"` }, 'the agent starts with its approval checks off'],
      [
        { run: `'${GE} -p "\${{ github.event.issue.title }}"'` },
        'event text interpolated into the shell that starts the agent',
      ],
    ]
    for (const [passo, motivo] of casos) {
      const texto = textoDe(um(passo, { permissions: {} }))
      if (motivo === null) assert.doesNotMatch(texto, /it can act through/, JSON.stringify(passo))
      else
        assert.match(
          texto,
          new RegExp(`it can act through .*${motivo.replace(/[()]/g, '\\$&')}`),
          JSON.stringify(passo),
        )
    }
  })

  test('a contained agent is a note even with contents write; process reach fails on it', () => {
    const vazio = `'{"tools":{"core":[]}}'`
    const comEscrita = { permissions: { contents: 'write', issues: 'write' } }
    const gemini = textoDe(um({ uses: ACAO_GEMINI, with: { settings: vazio } }, comEscrita))
    assert.match(
      gemini,
      /nothing found to act with beyond its model credential and write on issues/,
    )
    assert.deepEqual(vereditos(um({ uses: INFERENCIA }, comEscrita)), ['nota'])
    assert.deepEqual(
      vereditos(um({ uses: ACAO_CODEX, with: { 'allow-users': '"*"' } }, comEscrita)),
      ['nota'],
    )
    // read-only runs Codex as a user that likely keeps sudo (action.yml), so the job's reach counts.
    assert.deepEqual(
      vereditos(
        um(
          { uses: ACAO_CODEX, with: { 'allow-users': '"*"', 'safety-strategy': 'read-only' } },
          comEscrita,
        ),
      ),
      ['reprova'],
    )
    // An MCP server or an extension takes the gemini agent out of containment.
    assert.deepEqual(
      vereditos(
        um(
          {
            uses: ACAO_GEMINI,
            with: { settings: `'{"tools":{"core":[]},"mcpServers":{"g":{}}}'` },
          },
          comEscrita,
        ),
      ),
      ['reprova'],
    )
    // The same agents with only a comment scope: notes.
    assert.deepEqual(vereditos(um(passoClaude(aberto), { permissions: { issues: 'write' } })), [
      'nota',
    ])
    // Process reach: a write scope beyond text, no permissions block, a secret.
    assert.match(textoDe(um(passoClaude(aberto), comEscrita)), /write access: contents$/)
    assert.match(textoDe(um(passoClaude(aberto), { permissions: null })), /no permissions block/)
    assert.match(
      textoDe(um(passoClaude(aberto), { permissions: 'write-all' })),
      /write access: write-all/,
    )
    assert.match(
      textoDe(um(passoClaude(aberto), { permissions: { 'artifact-metadata': 'write' } })),
      /write access: artifact-metadata/,
    )
    assert.match(
      textoDe(
        um({
          ...passoClaude(aberto),
          env: {
            DEPLOY_KEY: SEGREDO('DEPLOY_KEY'),
            ANTHROPIC_API_KEY: SEGREDO('ANTHROPIC_API_KEY'),
          },
        }),
      ),
      /it can act through 1 secret besides the model credential$/,
    )
    assert.match(
      textoDe(um({ ...passoClaude(aberto), env: { ALL: '${{ toJSON(secrets) }}' } })),
      /every repository secret/,
    )
    assert.deepEqual(
      vereditos(um(passoClaude({ ...aberto, anthropic_api_key: SEGREDO('ANTHROPIC_API_KEY') }))),
      ['nota'],
    )
    // A model credential under an env name is auth for an action step too.
    assert.deepEqual(
      vereditos(um({ uses: INFERENCIA, env: { [j('COPI', 'LOT_GITHUB_TOKEN')]: SEGREDO('CP') } })),
      ['nota'],
    )
  })

  test('id-token write alone is no capability, except for the vendor App token it buys', () => {
    const idToken = { permissions: { contents: 'read', 'id-token': 'write' } }
    assert.deepEqual(
      vereditos(um({ uses: ACAO_GEMINI, with: { settings: `'{"tools":{"core":[]}}'` } }, idToken)),
      ['nota'],
    )
    assert.deepEqual(vereditos(um(passoClaude(aberto), idToken)), ['nota'])
    // With no github_token, claude-code-action trades the OIDC token for its App
    // token, which writes contents, pull requests and issues (token.ts).
    assert.match(
      textoDe(um(passoClaude({ allowed_bots: '"*"' }), idToken)),
      /write access through the vendor App token/,
    )
    // A personal token handed to the agent is a secret it holds.
    assert.match(
      textoDe(um(passoClaude({ ...aberto, github_token: SEGREDO('GH_PAT') }))),
      /it can act through a token passed to the agent$/,
    )
  })

  test('ai-inference v1 and v2 hand the model GitHub MCP tools with the token given', () => {
    // RSSNext/Folo similar-issues.yml: issues opened, enable-github-mcp and a PAT.
    const texto = textoDe(
      um({
        uses: 'actions/ai-inference@v2',
        with: { 'enable-github-mcp': 'true', 'github-mcp-token': SEGREDO('USER_PAT') },
      }),
    )
    assert.match(texto, /1 secret besides the model credential; GitHub MCP tools with a token/)
    assert.deepEqual(
      vereditos(um({ uses: 'actions/ai-inference@v2', with: { 'enable-github-mcp': 'false' } })),
      ['nota'],
    )
  })

  test('the text output spliced into a later run or github-script step fails, also through needs', () => {
    const resposta = '${{ steps.ai.outputs.response }}'
    const noRun = workflow({
      jobs: { a: { steps: [{ id: 'ai', uses: INFERENCIA }, { run: `"echo '${resposta}'"` }] } },
    })
    assert.match(
      textoDe(noRun),
      /its text output is interpolated into a later run or github-script step/,
    )
    const noScript = workflow({
      jobs: {
        a: {
          steps: [
            { id: 'ai', uses: INFERENCIA },
            {
              uses: 'actions/github-script@v7',
              with: { script: `"const body = \`${resposta}\`"` },
            },
          ],
        },
      },
    })
    assert.match(textoDe(noScript), /interpolated into a later run or github-script step/)
    const viaNeeds = workflow({
      jobs: {
        a: { outputs: { texto: `'${resposta}'` }, steps: [{ id: 'ai', uses: INFERENCIA }] },
        b: { needs: 'a', steps: [{ run: `"echo '\${{ needs.a.outputs.texto }}'"` }] },
      },
    })
    assert.match(textoDe(viaNeeds), /interpolated into a later run/)
    // Through env the output is data, as GitHub's current starter passes it.
    const env = workflow({
      jobs: {
        a: {
          steps: [
            { id: 'ai', uses: INFERENCIA },
            { run: '"echo $R"', env: { R: `'${resposta}'` } },
          ],
        },
      },
    })
    assert.deepEqual(vereditos(env), ['nota'])
  })
})

// ═══════════════════════════════════════════════════════ what reaches a step

describe('reachability across jobs, runs and files', () => {
  const grant = passoClaude({ ...aberto, claude_args: `${D}allowedTools ${BASH}` })

  test('a job inherits the conditions of the jobs it needs, unless it runs whatever they did', () => {
    const fechado = "github.event.comment.author_association == 'OWNER'"
    const cadeia = (se) =>
      workflow({
        on: 'issue_comment',
        jobs: {
          gate: { if: `"${fechado}"`, steps: [{ run: 'echo ok' }] },
          meio: { needs: 'gate', steps: [{ run: 'echo ok' }] },
          agent: { needs: 'meio', ...(se ? { if: se } : {}), steps: [grant] },
        },
      })
    assert.deepEqual(vereditos(cadeia()), [])
    assert.deepEqual(vereditos(cadeia('always()')), ['reprova'])
  })

  test('workflow_run is reachable unless every upstream runs only on its own', () => {
    const rodaDepois = (tipos) =>
      workflow({
        on: `\n  workflow_run:\n    workflows: [CI]${tipos ? `\n    types: ${tipos}` : ''}`,
        jobs: { a: { steps: [grant] } },
      })
    const upstream = (on) =>
      `name: CI\non: ${on}\njobs:\n  t:\n    runs-on: x\n    steps:\n      - run: echo\n`
    const com = (on, tipos) =>
      analisar({
        '.github/workflows/after.yml': rodaDepois(tipos),
        '.github/workflows/ci.yml': upstream(on),
      }).itens.map((x) => x.severidade)
    assert.deepEqual(com('pull_request'), ['reprova'])
    assert.deepEqual(com('pull_request', '[completed]'), ['reprova'])
    assert.deepEqual(com('[push, workflow_dispatch]'), [])
    assert.deepEqual(com('[push, workflow_dispatch]', '[completed]'), [])
    // A name nothing tracked answers to is reachable.
    assert.deepEqual(vereditos(rodaDepois()), ['reprova'])
    // Without `name:`, GitHub names a workflow by its path from the root.
    const semNome = analisar({
      '.github/workflows/after.yml': workflow({
        on: '\n  workflow_run:\n    workflows: [.github/workflows/ci.yml]',
        jobs: { a: { steps: [grant] } },
      }),
      '.github/workflows/ci.yml':
        'on: push\njobs:\n  t:\n    runs-on: x\n    steps:\n      - run: echo\n',
    })
    assert.deepEqual(semNome.itens, [])
  })

  test('a local reusable workflow and a composite action are read one level down', () => {
    const chamado = workflow({
      on: 'workflow_call',
      permissions: null,
      jobs: {
        agent: {
          if: "inputs.run != ''",
          steps: [{ uses: ACAO_GEMINI, env: { T: '${{ inputs.titulo }}' } }],
        },
      },
    })
    const chamador = (on, secrets) =>
      workflow({
        on,
        permissions: { contents: 'read' },
        jobs: {
          call: {
            uses: './.github/workflows/agent.yml',
            with: { titulo: '${{ github.event.issue.title }}', run: 'yes' },
            ...(secrets ? { secrets } : {}),
          },
        },
      })
    const r = analisar({
      '.github/workflows/call.yml': chamador('issue_comment', 'inherit'),
      '.github/workflows/agent.yml': chamado,
    })
    assert.equal(r.itens.length, 1)
    assert.match(
      r.itens[0].texto,
      /^\.github\/workflows\/call\.yml:\d+:\d+ job call via \.github\/workflows\/agent\.yml job agent step 1 \(Google Gemini CLI action\)/,
    )
    assert.match(
      r.itens[0].texto,
      /interpolates github\.event\.issue\.title; it can act through every tool approved and no tool list/,
    )
    assert.deepEqual(r.itens[0].arquivos, [
      '.github/workflows/call.yml',
      '.github/workflows/agent.yml',
    ])
    const despachado = analisar({
      '.github/workflows/call.yml': chamador('workflow_dispatch'),
      '.github/workflows/agent.yml': chamado,
    })
    assert.deepEqual(despachado.itens, [])

    const acao = `name: a\nruns:\n  using: composite\n  steps:\n    - uses: ${ACAO_GEMINI}\n      with:\n        prompt: \${{ inputs.texto }}\n    - uses: ./deeper\n`
    const usa = workflow({
      jobs: {
        a: {
          steps: [{ uses: './tools/agent', with: { texto: '${{ github.event.issue.body }}' } }],
        },
      },
    })
    const c = analisar({ '.github/workflows/w.yml': usa, 'tools/agent/action.yml': acao })
    assert.equal(c.itens.length, 1)
    assert.match(
      c.itens[0].texto,
      /job a step 1 via tools\/agent\/action\.yml step 1 \(Google Gemini CLI action\).*interpolates github\.event\.issue\.body/,
    )
    assert.match(
      c.notas.join(' '),
      /not read: \.github\/workflows\/w\.yml:\d+:\d+ nested local action/,
    )
  })

  test('an alias hides neither the agent action nor a whole steps list', () => {
    const w = [
      'name: proof',
      'on: issues',
      'permissions: {}',
      `x-agent: &agent ${BASE_CLAUDE}`,
      'jobs:',
      '  a:',
      '    runs-on: ubuntu-latest',
      '    steps: &passos',
      '      - uses: *agent',
      '        with:',
      `          claude_args: ${D}allowedTools ${BASH}`,
      '  b:',
      '    runs-on: ubuntu-latest',
      '    steps: *passos',
    ].join('\n')
    assert.deepEqual(vereditos(w), ['reprova', 'reprova'])
  })
})

// ═══════════════════════════════════════════ gh-aw and unreadable workflows

describe('files the rule cannot judge step by step', () => {
  test('a gh-aw lock file is a note only when its role check admits every account', () => {
    const LOCK = '.github/workflows/w.lock.yml'
    const itensDo = (texto, caminho = LOCK) => analisar({ [caminho]: texto }).itens
    assert.deepEqual(itensDo(lockDoGhAw({ papeis: 'admin,maintainer,write' })), [])
    assert.match(
      itensDo(lockDoGhAw({ papeis: 'all' }))[0].texto,
      /w\.lock\.yml:1:1 generated by gh-aw with its role check open to every account/,
    )
    // A lock with no role-check job admits every account, whatever a comment says.
    const semPapeis = lockDoGhAw({ comentario: '# GH_AW_REQUIRED_ROLES: "admin"\n' })
    assert.match(itensDo(semPapeis)[0].texto, /role check open to every account/)
  })

  test('the gh-aw header alone makes no lock file (review finding 1)', () => {
    // The spoof the review built: the header and a roles string pasted as
    // comments above a plain workflow with a skip-permissions agent on issues.
    const plano = workflow({
      permissions: 'write-all',
      jobs: { t: { steps: [{ uses: BASE_CLAUDE, with: { prompt: 'x', claude_args: SKIP } }] } },
    })
    const cabecalho =
      '# This file was automatically generated by gh-aw. DO NOT EDIT.\n# GH_AW_REQUIRED_ROLES: "admin"\n'
    for (const caminho of ['.github/workflows/w.yml', '.github/workflows/w.lock.yml']) {
      const r = analisar({ [caminho]: cabecalho + plano })
      assert.deepEqual(
        r.itens.map((x) => x.severidade),
        ['reprova'],
        caminho,
      )
    }
    // The lock structure under another name is no lock either.
    assert.deepEqual(
      analisar({ '.github/workflows/w.yml': lockDoGhAw({ papeis: 'admin' }) }).itens.map(
        (x) => x.severidade,
      ),
      ['reprova'],
    )
  })

  test('unsupported YAML fails only when it names an agent; invalid YAML is a note', () => {
    const comTag = (passo) =>
      `name: x\non: issues\njobs:\n  a:\n    runs-on: !!str x\n    steps:\n      - ${passo}\n`
    const falha = umWorkflow(comTag(`uses: ${BASE_CLAUDE}`))
    assert.equal(falha.itens[0].severidade, 'reprova')
    assert.match(
      falha.itens[0].texto,
      /w\.yml:5:14 names an AI agent in YAML this rule cannot read \(anchors, aliases and tags are not supported\)/,
    )
    const cli = umWorkflow(comTag(`run: timeout 20m ${CL} -p hi`))
    assert.equal(cli.itens[0].severidade, 'reprova')
    const semAgente = umWorkflow(comTag('run: echo hi'))
    assert.deepEqual(semAgente.itens, [])
    assert.match(
      semAgente.notas.join(),
      /1 workflow this rule cannot read: \.github\/workflows\/w\.yml:5:14/,
    )
    // GitHub refuses a tab indent too, so it is a note even with an agent in it.
    const tab = umWorkflow(`on: issues\njobs:\n\ta:\n    steps:\n      - uses: ${BASE_CLAUDE}\n`)
    assert.deepEqual(tab.itens, [])
    assert.match(tab.notas.join(), /1 workflow is not valid YAML, and GitHub does not run it/)
  })
})

describe('the agent CLI reader', () => {
  test('substitutions, launchers and scoped packages start the CLI', () => {
    const agentes = (texto) =>
      comandosDoShell(texto)
        .map((c) => agenteDoComando(c.palavras))
        .filter(Boolean)
    for (const [texto, id] of [
      [`result=$(${CL} -p "a (b)")`, CL],
      [`if raw=$(timeout 1200s ${CL} -p x); then echo; fi`, CL],
      [`RESULT=\`${GE} -p y\``, GE],
      [`timeout --signal=TERM --kill-after=30s 20m env -u X -i ${CO} exec hi`, CO],
      [`npx -y @google/${GE}-cli@latest -p x`, GE],
      [`sudo -E /usr/local/bin/${CL}.exe -p x`, CL],
      [`pnpm dlx ${j('@github/', CP)} -p x`, CP],
      [`(cd sub && ${CL} -p x)`, CL],
    ]) {
      assert.deepEqual(agentes(texto), [id], texto)
    }
    for (const texto of [
      `echo ${CL}`,
      `which ${CL}`,
      `npm install -g @anthropic-ai/${CL}-code`,
      `grep ${CO} file`,
    ]) {
      assert.deepEqual(agentes(texto), [], texto)
    }
  })
})

// ════════════════════════════════════════════════ the rule over an index

const SEM_CONFIG = join(tmpdir(), 'rebar-prove-workflow-gitconfig-inexistente')
const AMBIENTE = { ...process.env, GIT_CONFIG_GLOBAL: SEM_CONFIG, GIT_CONFIG_SYSTEM: SEM_CONFIG }

function git(dir, argumentos, entrada) {
  const r = spawnSync('git', argumentos, {
    cwd: dir,
    input: entrada,
    env: AMBIENTE,
    windowsHide: true,
    encoding: 'buffer',
  })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`git ${argumentos[0]}: ${String(r.stderr)}`)
  return String(r.stdout).trim()
}

let MOLDE = null
function molde() {
  if (!MOLDE) {
    MOLDE = mkdtempSync(join(tmpdir(), 'rebar-prove-workflow-molde-'))
    process.once('exit', () => rmSync(MOLDE, { recursive: true, force: true }))
    git(MOLDE, ['init', '--quiet'])
  }
  return join(MOLDE, '.git')
}

/** The blob id git gives these bytes. */
const oidDe = (texto) => {
  const bytes = Buffer.from(texto, 'utf8')
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex')
}

/** An index-only repository (loose objects written here, one update-index), as prove-bypass.mjs builds it. */
function repo(arquivos, { links = {}, origem = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-prove-workflow-'))
  cpSync(molde(), join(dir, '.git'), { recursive: true })
  if (origem) git(dir, ['config', 'remote.origin.url', origem])
  const entradas = [
    ...Object.entries(arquivos).map(([caminho, texto]) => [caminho, texto, '100644']),
    ...Object.entries(links).map(([caminho, alvo]) => [caminho, alvo, '120000']),
  ]
  if (!entradas.length) return dir
  const registros = entradas.map(([caminho, texto, modo]) => {
    const bytes = Buffer.from(texto, 'utf8')
    const objeto = Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, 'utf8'), bytes])
    const oid = createHash('sha1').update(objeto).digest('hex')
    const pasta = join(dir, '.git', 'objects', oid.slice(0, 2))
    mkdirSync(pasta, { recursive: true })
    writeFileSync(join(pasta, oid.slice(2)), deflateSync(objeto))
    return `${modo} ${oid}\t${caminho}\0`
  })
  git(dir, ['update-index', '-z', '--add', '--index-info'], Buffer.from(registros.join('')))
  return dir
}

function checar(arquivos, opcoes) {
  const dir = repo(arquivos, opcoes)
  try {
    return checarWorkflowDeAgente({ dir }, TABELAS)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('checarWorkflowDeAgente', () => {
  const agente = workflow({
    jobs: { a: { steps: [passoClaude({ ...aberto, claude_args: `${D}allowedTools ${BASH}` })] } },
  })

  test('not applicable with no workflow, and with no agent step', () => {
    assert.deepEqual(checar({ 'README.md': '# x\n' }), { na: 'no workflow in .github/workflows/' })
    assert.deepEqual(checar({ 'docs/.github/workflows/w.yml': agente }), {
      na: 'no workflow in .github/workflows/',
    })
    assert.deepEqual(
      checar({
        '.github/workflows/ci.yml':
          'on: push\njobs:\n  t:\n    runs-on: x\n    steps:\n      - run: echo\n',
      }),
      {
        na: 'no known AI agent step in 1 workflow',
      },
    )
    // An agent step nothing outside reaches is a pass, not na.
    assert.equal(
      checar({ '.github/workflows/w.yml': agente.replace('on: issues', 'on: push') }),
      null,
    )
  })

  test('the failure names the steps and the remedy, and escapes what the repository wrote', () => {
    const invisivel = String.fromCodePoint(0x200b)
    const saida = checar({ '.github/workflows/w.yml': agente.replace('  a:', `  a${invisivel}b:`) })
    assert.equal(typeof saida, 'string')
    assert.match(
      saida,
      /^1 AI agent step that outside text reaches with power to act: \.github\/workflows\/w\.yml:\d+:\d+ job a<U\+200B>b step 1/,
    )
    assert.match(
      saida,
      /PromptPwnd, Clinejection\); take the power or the outside trigger away, or allowlist the workflow by \{arquivo, oid\}$/,
    )
    assert.ok(!saida.includes(invisivel))
  })

  test('an allowlist entry exempts a finding only when every file it depends on has one', () => {
    const chamado = workflow({
      on: 'workflow_call',
      permissions: null,
      jobs: { agent: { steps: [{ uses: ACAO_GEMINI }] } },
    })
    const chamador = workflow({
      on: 'issues',
      jobs: { call: { uses: './.github/workflows/agent.yml' } },
    })
    const entrada = (arquivo, texto) =>
      JSON.stringify({
        regra: 'ai-workflow-untrusted-input',
        motivo: 'reviewed in a proof',
        arquivo,
        oid: oidDe(texto),
      })
    const base = { '.github/workflows/call.yml': chamador, '.github/workflows/agent.yml': chamado }
    const soChamador = checar({
      ...base,
      '.rebar-injection-allowlist': `${entrada('.github/workflows/call.yml', chamador)}\n`,
    })
    assert.equal(typeof soChamador, 'string', JSON.stringify(soChamador))
    // The caller entry exempted nothing alone, so it is stale, not "in use".
    assert.match(soChamador, /^1 AI agent step/)
    const ambos = checar({
      ...base,
      '.rebar-injection-allowlist': `${entrada('.github/workflows/call.yml', chamador)}\n${entrada('.github/workflows/agent.yml', chamado)}\n`,
    })
    assert.match(
      ambos.nota,
      /\.rebar-injection-allowlist is in use and no CODEOWNERS entry owns it/,
    )
    assert.deepEqual(
      checar({
        ...base,
        '.rebar-injection-allowlist': '{"regra":"ai-workflow-untrusted-input"}\n',
      }).slice(0, 13),
      '1 AI agent st',
    )
  })

  test('a missing table breaks the rule instead of running blind', () => {
    assert.throws(
      () => checarWorkflowDeAgente({ dir: '.' }, { ...TABELAS, GATILHOS_DE_FORA: [] }),
      /GATILHOS_DE_FORA is missing or empty/,
    )
    assert.throws(
      () => checarWorkflowDeAgente({ dir: '.' }, { ...TABELAS, ACOES_DE_AGENTE: undefined }),
      /ACOES_DE_AGENTE is missing or empty/,
    )
    assert.throws(
      () => checarWorkflowDeAgente({ dir: '.' }, { ...TABELAS, FLAGS_FORTES: undefined }),
      /FLAGS_FORTES is missing/,
    )
  })

  test('every table row is anchored, and no explanation spells what a row matches', () => {
    for (const [nome, tabela] of Object.entries({
      ACOES_DE_AGENTE,
      GATILHOS_DE_FORA,
      CAMPOS_DO_EVENTO,
    })) {
      for (const [re, explicacao] of tabela) {
        assert.ok(
          re.source.startsWith('^') && re.source.endsWith('$') && !re.flags.includes('m'),
          `${nome} ${re}`,
        )
        assert.equal(re.test(explicacao), false, `${nome} ${re} matches its own explanation`)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════ the review findings
//
// Each test below failed on c390523, the commit the review read: the finding
// number is the review's.

describe('review findings on c390523', () => {
  const concede = j(D, 'allowed', 'Tools')
  const baseComShell = {
    uses: BASE_CLAUDE,
    with: { prompt: 'x', claude_args: `${concede} ${BASH}` },
  }
  const um = (passo, extra = {}) => workflow({ ...extra, jobs: { a: { steps: [passo] } } })

  test('2: a job that calls a status function runs past a skipped gate, unless success() needs it', () => {
    const w = (se) =>
      workflow({
        on: 'issue_comment',
        jobs: {
          gate: {
            if: "github.event.comment.author_association == 'OWNER'",
            steps: [{ run: 'echo ok' }],
          },
          agent: { needs: 'gate', ...(se === null ? {} : { if: se }), steps: [baseComShell] },
        },
      })
    for (const se of [
      'always()',
      'Always()',
      "success() || needs.gate.result == 'skipped'",
      '!cancelled()',
      'FAILURE() || true',
    ]) {
      assert.deepEqual(vereditos(w(se)), ['reprova'], se)
    }
    for (const se of [
      null,
      'success()',
      "SUCCESS() && github.event_name == 'issue_comment'",
      "contains('always()', github.actor)",
    ]) {
      assert.deepEqual(vereditos(w(se)), [], String(se))
    }
  })

  test('3: uses is read the way the runner splits it', () => {
    assert.equal(
      caminhoDoUses(j('anthropics/', CL, '-code-action//base-action@v1')),
      j('anthropics/', CL, '-code-action/base-action'),
    )
    for (const uses of [
      BASE_CLAUDE.replace('action/base', 'action//base'),
      BASE_CLAUDE.replace('action/base', 'action/./base'),
      BASE_CLAUDE.replace('action/base', 'action/x/../base'),
      BASE_CLAUDE.replace(/\//g, '\\'),
      `${BASE_CLAUDE.replace('@', '/@')}`,
    ]) {
      const w = um({ ...baseComShell, uses })
      assert.deepEqual(vereditos(w), ['reprova'], uses)
      assert.match(textoDe(w), /Anthropic Claude Code base action/, uses)
    }
    // A `..` that climbs out of the repository names no action row.
    assert.equal(caminhoDoUses('a/b/../../c@v1'), 'a/b/../../c')
  })

  test('4: a flow list wrapped over two lines is valid YAML, and the agent in the file still fails', () => {
    const texto = [
      'name: w',
      'on:',
      '  issues:',
      '  push:',
      '    branches: [main, release',
      '      candidate]',
      'permissions: write-all',
      'jobs:',
      '  t:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      `      - uses: ${BASE_CLAUDE}`,
      '        with:',
      `          claude_args: ${concede} ${BASH}`,
      '',
    ].join('\n')
    assert.deepEqual(vereditos(texto), ['reprova'])
  })

  test('5: a scoped Gemini exclusion keeps the rest of the shell', () => {
    const gem = (settings) => um({ uses: ACAO_GEMINI, with: { settings: `'${settings}'` } })
    assert.deepEqual(
      vereditos(gem(`{"tools":{"core":["${SHELL_GE}"],"exclude":["${SHELL_GE}(rm)"]}}`)),
      ['reprova'],
    )
    assert.deepEqual(vereditos(gem(`{"tools":{"exclude":["${j('Shell', 'Tool')}(rm -rf)"]}}`)), [
      'reprova',
    ])
    // The bare name removes the tool: with no core list left to grant a shell, a note.
    assert.deepEqual(
      vereditos(gem(`{"tools":{"core":["${SHELL_GE}"],"exclude":["${SHELL_GE}"]}}`)),
      ['nota'],
    )
  })

  test('6: an unreadable workflow names its agent behind an anchor or in a flow step', () => {
    const cabeca =
      'name: w\non: issues\npermissions: write-all\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n'
    for (const passos of [
      `      - name: !!str step\n        uses: &a ${BASE_CLAUDE}\n`,
      `      - name: !!str step\n      - {uses: ${BASE_CLAUDE}, with: {prompt: x}}\n`,
      `      - name: !!str step\n        uses: >-\n          ${BASE_CLAUDE}\n`,
    ]) {
      const r = umWorkflow(cabeca + passos)
      assert.deepEqual(
        r.itens.map((x) => x.severidade),
        ['reprova'],
        passos,
      )
      assert.match(r.itens[0].texto, /names an AI agent in YAML this rule cannot read/)
    }
  })

  test('8: the agent behind sh -c, eval or xargs is an agent step', () => {
    const titulo = '${{ github.event.issue.title }}'
    for (const run of [
      `bash -c '${CL} -p "triage ${titulo}"'`,
      `sh -ec "${CL} -p 'triage ${titulo}'"`,
      `eval "${CL} -p 'triage ${titulo}'"`,
      `echo "triage ${titulo}" | xargs -0 ${CL} -p`,
      `nice -n 5 setsid ${CL} -p "triage ${titulo}"`,
    ]) {
      const w = um({ run: `|\n          ${run}` }, { permissions: { contents: 'write' } })
      assert.deepEqual(vereditos(w), ['reprova'], run)
      assert.match(textoDe(w), /\(agent CLI\)/, run)
    }
  })

  test('9, 10: the CLI and claude_args are judged by the same grants and settings as the action', () => {
    const cli = (resto) => textoDe(um({ run: `|\n          ${CL} -p "triage" ${resto}` }))
    const modo = `{"permissions":{"defaultMode":"${j('bypass', 'Permissions')}"}}`
    assert.match(cli(`${concede} ${BASH}`), /it can act through a whole-shell tool grant/)
    assert.match(
      cli(`${D}settings '${modo}'`),
      /it can act through settings that approve every tool call/,
    )
    assert.doesNotMatch(cli(`${concede} "${BASH}(git log *)"`), /it can act through/)
    const copilot = textoDe(um({ run: `|\n          ${CP} -p "triage" ${D}allow-tool shell` }))
    assert.match(copilot, /it can act through a whole-shell tool grant/)
    const escopado = textoDe(
      um({ run: `|\n          ${CP} -p "triage" ${D}allow-tool "shell(git status)"` }),
    )
    assert.doesNotMatch(escopado, /it can act through/)

    const acao = textoDe(
      um({
        uses: BASE_CLAUDE,
        with: { prompt: 'x', claude_args: `>-\n            ${D}settings '${modo}'` },
      }),
    )
    assert.match(acao, /it can act through settings that approve every tool call/)
    const permitido = `{"permissions":{"allow":["${BASH}"]}}`
    assert.match(
      textoDe(
        um({
          uses: BASE_CLAUDE,
          with: { claude_args: `>-\n            ${D}settings='${permitido}'` },
        }),
      ),
      /a whole-shell tool grant/,
    )
  })

  test('11: the model output reaches a later script in bracket spelling and through an env key', () => {
    const inferencia = (depois) =>
      workflow({
        jobs: {
          a: {
            steps: [{ id: 'inference', uses: INFERENCIA, with: { prompt: 'summarize' } }, depois],
          },
        },
      })
    for (const depois of [
      { run: `"echo '\${{ steps.inference.outputs['response'] }}'"` },
      { run: `"echo '\${{ steps['inference'].outputs.response }}'"` },
      { env: { R: '${{ steps.inference.outputs.response }}' }, run: `"echo '\${{ env.R }}'"` },
    ]) {
      const texto = textoDe(inferencia(depois))
      assert.match(
        texto,
        /its text output is interpolated into a later run/,
        JSON.stringify(depois),
      )
    }
    // The shell variable is no splice: the value never becomes script text.
    const variavel = textoDe(
      inferencia({ env: { R: '${{ steps.inference.outputs.response }}' }, run: `'echo "$R"'` }),
    )
    assert.doesNotMatch(variavel, /interpolated into a later run/)
  })

  test('15: a job gated on another repository is closed when the clone names its own', () => {
    const w = workflow({
      permissions: { contents: 'write' },
      jobs: {
        triage: {
          if: "github.repository == 'upstream-org/upstream'",
          steps: [{ run: `'${CL} -p "label this issue"'` }],
        },
      },
    })
    const arquivos = { '.github/workflows/w.yml': w }
    const sev = (opcoes) => analisar(arquivos, opcoes).itens.map((x) => x.severidade)
    assert.deepEqual(sev(), ['reprova'])
    assert.deepEqual(sev({ repositorio: 'someone/fork' }), [])
    assert.deepEqual(sev({ repositorio: 'Upstream-Org/Upstream' }), ['reprova'])
    const dono = w.replace(
      "github.repository == 'upstream-org/upstream'",
      "'upstream-org' == github.repository_owner",
    )
    assert.deepEqual(
      analisar({ '.github/workflows/w.yml': dono }, { repositorio: 'someone/fork' }).itens,
      [],
    )
    // The rule reads the name from the clone's origin remote.
    assert.equal(checar(arquivos, { origem: 'git@github.com:someone/fork.git' }), null)
    assert.equal(
      typeof checar(arquivos, { origem: 'https://github.com/upstream-org/upstream' }),
      'string',
    )
  })

  test('16: a here-document body is data unless a shell reads it', () => {
    const agentes = (texto) => invocacoesDeAgente(texto).map((x) => x.agente)
    assert.deepEqual(
      agentes(
        `cat > note.md <<'EOF'\nThanks! \`${CO} exec\` is not used here.\nEOF\ngh issue comment 1 --body-file note.md`,
      ),
      [],
    )
    assert.deepEqual(agentes(`python3 - <<'PY'\n${GE} = 1\nPY`), [])
    assert.deepEqual(agentes(`node <<NODE\nif (/${CO} exited)/i.test(line)) x()\nNODE`), [])
    assert.deepEqual(agentes(`cat <<-EOF\n\t${CL} -p x\n\tEOF\n${GE} -p y`), [GE])
    assert.deepEqual(agentes(`bash <<EOF\n${CL} -p x\nEOF`), [CL])
    assert.deepEqual(agentes(`cat <<EOF > prompt.md\n$(${CL} -p x)\nEOF`), [CL])
    assert.deepEqual(agentes(`cat <<'EOF' > prompt.md\n$(${CL} -p x)\nEOF`), [])
    assert.deepEqual(agentes(`echo $((1<<2))\n${CL} -p y`), [CL])
    const heredoc = um(
      {
        run: `|\n          cat > "$RUNNER_TEMP/n.md" <<'EOF2'\n          Thanks! \`${CO} exec\` is not used.\n          EOF2\n          gh issue comment 1 --body-file "$RUNNER_TEMP/n.md"`,
      },
      { permissions: null },
    )
    assert.deepEqual(vereditos(heredoc), [])
  })

  test('17: the AWS Copilot CLI is no agent, and a Copilot session is', () => {
    const agentes = (texto) => invocacoesDeAgente(texto).map((x) => x.agente)
    assert.deepEqual(agentes(`${CP} svc deploy ${D}name api ${D}env prod`), [])
    assert.deepEqual(agentes(`${CP} job deploy`), [])
    assert.deepEqual(agentes(`${CP} -p "triage"`), [CP])
    assert.deepEqual(agentes(`${CP} ${D}model x -p "deploy"`), [CP])
    assert.deepEqual(agentes(`npx ${j('@github/', CP)} -p x`), [CP])
  })

  test('13: a composite action behind a tracked folder link is read, and a broken link is said', () => {
    const acao = `name: agent\nruns:\n  using: composite\n  steps:\n    - uses: ${BASE_CLAUDE}\n      with:\n        claude_args: ${concede} ${BASH}\n`
    const w = um({ uses: './.github/actions/agent' })
    const ligado = checar(
      { '.github/workflows/w.yml': w, 'tools/agent/action.yml': acao },
      { links: { '.github/actions/agent': '../../tools/agent' } },
    )
    assert.equal(typeof ligado, 'string', JSON.stringify(ligado))
    assert.match(ligado, /via tools\/agent\/action\.yml step 1/)
    const quebrado = checar(
      { '.github/workflows/w.yml': w },
      { links: { '.github/actions/agent': '../../../fora' } },
    )
    assert.match(quebrado.nota, /local action behind a link that resolves nowhere/)
  })
})
