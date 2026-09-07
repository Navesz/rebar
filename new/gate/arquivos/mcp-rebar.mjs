#!/usr/bin/env node
// THE MCP SERVER OF THIS PROJECT. Zero dependencies, offline, and nothing frozen inside.
//
// ═════════════════════════════════════════ 1. what this file was, and why it changed
//
// Until 2026-09-02 this file was a LAUNCHER: it served nothing, it only called
// `npx --yes github:Navesz/rebar --mcp` and handed stdio to rebar's MCP server.
// The audit of 2026-08-31 suspected the chain could not work. It was measured,
// and it could not. The exact command and the exact output — verbatim, as
// measured, not translated — from a freshly generated project in a tmpdir:
//
//   $ node .rebar/mcp.mjs
//   rebar: --mcp pede as dependências do pacote mcp/, que não estão instaladas.
//          Instale uma vez: cd mcp && npm install
//   rebar-mcp: o rebar não respondeu como servidor MCP (saída 2).
//
// And the defect is STRUCTURAL, not an oversight. rebar's root has ZERO
// dependencies by house rule, so the MCP SDK lives in `mcp/`, which is a
// SEPARATE package. `npx` installs the root package and only it: the checkout it
// assembles in the cache has the files of `mcp/` and does not have
// `mcp/node_modules` — 22 MB, 93 packages, 3,399 files, measured 2026-09-02.
// There is no version of this chain that works without adding a 22 MB
// `npm install` to every invocation of rebar, including the ones that only want
// to run the ruler.
//
// ═══════════════════════════════════════════════ 2. the two ways out, and the sum
//
// (a) POINT AT REBAR — one source, always current. That is what was tried. Cost
//     measured 2026-09-02, on this machine, with the npx cache ALREADY WARM:
//     8.4 s and 9.1 s per startup. On top of that: it needs network in every
//     session, it needs `github:Navesz/rebar` to stay public and under that
//     name, and — the deciding one — IT DOES NOT WORK TODAY, per the paragraph
//     above. An MCP client that waits 9 s for a handshake usually gives up
//     first; one that waits 9 s to receive exit 2 gives up for sure.
//
// (b) THE PROJECT CARRIES ITS OWN — offline, instant, and it is what this file
//     is now. The price stated in the request was: "passa a ter um arquivo que
//     envelhece, e aí precisa do portão de frescor dele também" [it comes to
//     have a file that ages, and then it needs its freshness gate too].
//
// THAT PRICE IS NOT PAID HERE, and that is the design decision. There is no
// artifact. No rule is written in this file as frozen text: every answer is
// DERIVED, at call time, from this project's files on disk. The placeholder rule
// is read from `conteudo/esquema.ts`; the list of placeholders still missing is
// scanned in `conteudo/site.json` in that second; the stack comes from the real
// versions in `package.json`; the gate steps come from `package.json → scripts`;
// what blocks the commit comes from the hooks in `.githooks/`. There is no copy
// to age, so there is no freshness gate to write — which is a better answer to
// the Herz defect than a gate would be, because a freshness gate proves the copy
// matches the source, and here there is no second copy.
//
// The consequence is harsh on purpose and it is exposed in every answer: when
// the file that enforces a rule IS NOT on disk, the tool does not recite the
// rule — it answers DESARMADA (unarmed). A rule recited with the guard gone is
// worse than silence, because it sounds exactly like a rule in force.
//
// ══════════════════════════════════════════════════ 3. and rebar's 22 rules?
//
// They stay reachable, and by execution, never by copy: `rebar_verificar` with
// `{ regua: true }` runs the SAME line this project's CI runs, and returns the
// scoreboard. Measured 2026-09-02: 9.3 s for `npx` alone, 17.2 s end to end in
// one tool call. Network mandatory. That is why it is an option, not the
// default. With no network it says it could not, and it names the command — it
// never invents a green.
//
// ══════════════════════════════════════════ 4. why without the MCP SDK
//
// This project's `AGENTS.md` forbids installing an MCP SDK, and this is the
// reason the ban is possible: MCP's stdio transport is JSON-RPC 2.0 in lines
// terminated by `\n`, and a server that only publishes tools needs four
// methods — `initialize`, `tools/list`, `tools/call` and `ping`. That is the ~90
// lines of section 6. The SDK would solve the same thing with 22 MB and a
// dependency tree this project would have to audit, update and explain forever,
// in a repository that goes into a client's hands.
//
// ═══════════════════════════════════════════════ 5. what stdout is here
//
// stdout is the PROTOCOL CHANNEL and nothing else. A line of prose in it does
// not become a warning: it becomes a malformed message, and the client drops the
// session without saying why. That is why there is exactly ONE write to stdout
// in this file, inside `enviar()`, and `testes/portao.test.mjs` counts that
// occurrence and fails if a second one shows up — or if the console logging call
// shows up, which writes to the same channel. It is not named here on purpose:
// the ruler scans the text of this file, and it failed once already because of a
// comment that quoted the forbidden call instead of describing it. Every notice
// meant for a human goes to stderr, through `grito()`.

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────── 1. where we are
//
// The root comes from THIS FILE'S PATH, not from `process.cwd()`. The MCP client
// picks the working directory on its own and it is not always the project root;
// this file, however, always sits at `<root>/.rebar/mcp.mjs` — the gate is what
// puts it there, and `conferirPonteiroMcp` fails the generation if `.mcp.json`
// and the disk disagree. Going up two levels is, therefore, a fact of the generator.
//
// fileURLToPath, not `.pathname`: on Windows the pathname comes as "/C:/Users/...",
// with a slash before the drive letter, and every join from it points at nothing.
const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = dirname(AQUI)

// The folder `core.hooksPath` has to point at for this project's gate to exist
// for real. The generator writes it with this name; if it changes there, it
// changes here.
const PASTA_HOOKS = '.githooks'

// The published ruler. It is the command this project's CI runs and the only
// thing this file knows about rebar: an address, no rules.
const ESPEC_REBAR = 'github:Navesz/rebar'
const REGUA = `npx --yes ${ESPEC_REBAR} .`
// A DIFFERENT binary of the same package, hence the `-p`: without it npx runs
// the default bin and the "security ruler" would be the format one under another
// name. The two answer separately because they fail for separate reasons — wrong
// format and a security failure are not fixed the same way nor with the same hurry.
const REGUA_SEGURANCA = `npx --yes -p ${ESPEC_REBAR} rebar-security .`

// Everything meant for a human goes to stderr. See section 5 of the header.
const grito = (t) => process.stderr.write(`mcp: ${t}\n`)

// ────────────────────────────────────── 2. reading the project, always at call time
//
// No cache, on purpose and with the cost measured: the files read add up to less
// than 40 KB in a freshly generated project (2026-09-02), and a full read lands
// in the millisecond range. Keeping that in memory would bring back, through the
// back door, exactly the defect this design exists not to have — the session
// that started in the morning would go on answering with the morning's
// `site.json` after the owner swapped the placeholders in the afternoon.

const caminho = (rel) => join(RAIZ, ...rel.split('/'))
const tem = (rel) => existsSync(caminho(rel))

function ler(rel) {
  try {
    return readFileSync(caminho(rel), 'utf8')
  } catch {
    return null
  }
}

function lerJson(rel) {
  const bruto = ler(rel)
  if (bruto === null) return null
  try {
    return JSON.parse(bruto)
  } catch {
    // Broken JSON is NOT the same as a missing file, and the two answers that
    // follow are different: missing is "the rule is unarmed", broken is "the
    // build is going to die here". The caller tells them apart by the `undefined`.
    return undefined
  }
}

/**
 * `file:line` of the first line that contains the needle.
 *
 * It is what replaces the quotation: instead of copying the text that enforces
 * the rule over here — a copy that would age —, the answer sends the agent to
 * LOOK at the line that enforces it today. When the needle disappears from the
 * file, the function returns the file with no line, and the answer starts saying
 * it did not find it; it never points at the wrong line.
 */
function ondeEsta(rel, agulha) {
  const texto = ler(rel)
  if (texto === null) return null
  const linhas = texto.split('\n')
  const i = linhas.findIndex((l) => l.includes(agulha))
  return i === -1 ? rel : `${rel}:${i + 1}`
}

// ─────────────────────────── 3. the placeholder sentinel, read from the build
//
// The rule "the build fails if the placeholder is not swapped" is enforced by
// `conteudo/esquema.ts`, and its shape is a regular expression declared there.
// IT IS READ FROM THERE, not copied over here, and the reason is the same as the
// whole file's: if the schema loosens or tightens the sentinel, this tool moves
// with it in the same instant. A second copy of the regex would give yesterday's
// answer with today's face — and that answer is precisely "your build is going
// to pass", the worst of all to be wrong about.
// The needle is the DECLARATION as it is written in `conteudo/esquema.ts`, so it
// stays Portuguese: it is an identifier of that file, not prose. Translating it
// here makes the search miss and every answer come back "no sentinel".
const DECL_SENTINELA = 'export const SENTINELA'

function sentinela() {
  const fonte = ler('conteudo/esquema.ts')
  if (fonte === null) return { re: null, motivo: 'conteudo/esquema.ts is not on disk' }
  const linha = fonte.split('\n').find((l) => l.includes(DECL_SENTINELA))
  if (!linha) {
    return { re: null, motivo: `did not find \`${DECL_SENTINELA}\` in conteudo/esquema.ts` }
  }
  // Slices between the first and the last slash of the line. `new RegExp` over a
  // literal of the PROJECT ITSELF, never over input from whoever calls the tool.
  const abre = linha.indexOf('/')
  const fecha = linha.lastIndexOf('/')
  if (abre === -1 || fecha <= abre) {
    return { re: null, motivo: 'the SENTINELA line has no recognizable regex literal' }
  }
  try {
    return {
      re: new RegExp(linha.slice(abre + 1, fecha)),
      motivo: null,
      onde: ondeEsta('conteudo/esquema.ts', DECL_SENTINELA),
    }
  } catch (e) {
    return { re: null, motivo: `SENTINELA of conteudo/esquema.ts does not compile: ${e.message}` }
  }
}

/** Every field of `conteudo/site.json` that still matches the sentinel, with its path in the JSON. */
function placeholdersPendentes() {
  const s = sentinela()
  const dado = lerJson('conteudo/site.json')
  if (dado === null) return { erro: 'conteudo/site.json is not on disk', itens: [] }
  if (dado === undefined)
    return { erro: 'conteudo/site.json is not valid JSON — the build dies here', itens: [] }
  if (!s.re) return { erro: s.motivo, itens: [] }

  const itens = []
  const andar = (no, trilha) => {
    if (typeof no === 'string') {
      if (s.re.test(no)) itens.push({ campo: trilha, valor: no })
      return
    }
    if (Array.isArray(no)) return no.forEach((v, i) => andar(v, `${trilha}[${i}]`))
    if (no && typeof no === 'object') {
      for (const [k, v] of Object.entries(no)) andar(v, trilha ? `${trilha}.${k}` : k)
    }
  }
  andar(dado, '')
  return { erro: null, itens, imposta_em: s.onde }
}

// ─────────────────────────────────────────────── 4. the gate state, derived

/** Same directory, answered by the file system and not by string.
 *
 * `realpathSync.native` resolves the symlink AND canonicalizes letter case on
 * Windows, where `.GITHOOKS` and `.githooks` are the same folder and a text
 * comparison would say they are not. It falls back to the text comparison only
 * when one of the two sides does not exist — and by then the difference was
 * already decided before reaching here.
 */
function mesmaPasta(a, b) {
  try {
    return realpathSync.native(a) === realpathSync.native(b)
  } catch {
    return resolve(a) === resolve(b)
  }
}

/**
 * The hooks only count if git knows about them. `core.hooksPath` is what ties
 * `.githooks/` to git, and it does NOT come along in the clone — whoever clones
 * this project gets the files and no armed hook. It is the difference between
 * "the file exists" and "the commit is blocked", and the answer has to say which
 * of the two is the case.
 *
 * READING THE VALUE IS NOT ENOUGH, and that is what this function did until
 * 2026-09-06: it returned `valor`, and the caller concluded
 * `armado = valor !== null`. Except `core.hooksPath` is a free string — git
 * writes it without checking anything:
 *
 *   $ git config core.hooksPath .hooks-que-nunca-existiram   # exits 0, silent
 *   $ git commit ...                                          # no hook runs
 *
 * From there on git executes no hook and does not warn, and this MCP answered
 * `armado_no_git: true` — which is worse than not knowing, because it is
 * precisely what makes the agent stop asking. Same outcome when the value points
 * at a folder that EXISTS but is another one: git runs the hooks from there and
 * this project's `.githooks/` sit inert on disk.
 *
 * So there are three states, and the answer says which one it is along with the why.
 */
function hooksArmados() {
  let bruto = null
  try {
    bruto =
      execFileSync('git', ['config', '--get', 'core.hooksPath'], {
        cwd: RAIZ,
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null
  } catch {
    // Exits non-zero when the key does not exist — the common case, and not a failure.
    bruto = null
  }

  // THE THREE `motivo` STRINGS BELOW ARE A CONTRACT, not prose.
  // `new/gate/prove-mcp-template.mjs` matches them by regex over `porque_nao`
  // (/is not configured/, /does NOT exist on disk/, /and not to \.githooks\//),
  // one per case. Change a word here and change it there IN THE SAME COMMIT:
  // separately, the proof goes green over a gate wide open, which is the one
  // outcome this whole file exists to prevent.
  //
  // They were kept in Portuguese for a while precisely because the proof matched
  // them — the tail wagging the dog. These strings are served to an AI by the
  // MCP, and what the AI reads is the whole reason this repository is in
  // English.
  if (bruto === null) {
    return {
      valor: null,
      armado: false,
      motivo: '`core.hooksPath` is not configured — the files are on disk and git ignores them.',
    }
  }

  // A relative path in `core.hooksPath` resolves from the TOP of the work tree,
  // not from the directory where the command runs. It is what git documents, and
  // resolving from the cwd would say "armed" or "broken" depending on the folder
  // this server happened to be called from.
  const destino = resolve(RAIZ, bruto)

  if (!existsSync(destino)) {
    return {
      valor: bruto,
      armado: false,
      motivo:
        `\`core.hooksPath\` points at ${JSON.stringify(bruto)}, which does NOT exist on disk. ` +
        'Git accepts any string here and checks nothing: no hook runs, and with no error at all.',
    }
  }

  if (!mesmaPasta(destino, join(RAIZ, PASTA_HOOKS))) {
    return {
      valor: bruto,
      armado: false,
      motivo:
        `\`core.hooksPath\` points at ${JSON.stringify(bruto)}, and not to ${PASTA_HOOKS}/. ` +
        'Git runs the hooks from there; the ones in this project are on disk and never run.',
    }
  }

  return { valor: bruto, armado: true, motivo: null }
}

/** The real dependencies, with the real versions. Never a hand-written list. */
function pilha() {
  const pkg = lerJson('package.json')
  if (!pkg) return null
  const deps = { ...(pkg.dependencies || {}) }
  const devs = { ...(pkg.devDependencies || {}) }
  const next = ler('next.config.ts') || ler('next.config.mjs') || ler('next.config.js') || ''
  return {
    nome: pkg.name || '(no name in package.json)',
    deps,
    devs,
    scripts: pkg.scripts || {},
    // `output: "export"` changes what it is POSSIBLE to write, not just how it is published.
    exportEstatico: /output\s*:\s*['"]export['"]/.test(next),
    baseUi: Boolean(deps['@base-ui/react'] || devs['@base-ui/react']),
  }
}

/**
 * The rules of THIS project, derived from the files that enforce them.
 *
 * Each entry declares who enforces it. If the file is not on disk, the state is
 * DESARMADA and the entry says so to your face — see section 2 of the header.
 */
function regrasDoProjeto() {
  const p = pilha()
  const ph = placeholdersPendentes()
  const hooks = hooksArmados()
  const armadoNoGit = hooks.armado

  const regra = (id, titulo, imposta, corpo) => {
    const presentes = imposta.filter((rel) => tem(rel))
    return {
      id,
      titulo,
      imposta_por: imposta,
      // `ativa` / `DESARMADA` STAY PORTUGUESE — they are the state token, not
      // prose: `testes/portao.test.mjs` asserts /DESARMADA/ over this answer, and
      // two filters further down compare against it by string. Renaming the token
      // makes the mutation test pass on a project with no guard left.
      estado: presentes.length === imposta.length ? 'ativa' : 'DESARMADA',
      falta: imposta.filter((rel) => !tem(rel)),
      ...corpo,
    }
  }

  const regras = [
    regra(
      'conteudo-fora-do-codigo',
      'Text, phone, address, price and URL do not live in the component',
      ['conteudo/site.json', 'conteudo/esquema.ts', 'conteudo/carregar.ts'],
      {
        onde: 'conteudo/site.json — it is the only place. `conteudo/esquema.ts` says the format of each field.',
        porque:
          'A literal in .tsx makes the build PASS and the site publish with the wrong data. The ' +
          'failure shows up nowhere: it shows up in the client who calls the old phone number. ' +
          'In validated JSON, the same mistake stops the build before publishing.',
        como:
          'Import from `conteudo/carregar.ts`, which validates at module scope — `next build` ' +
          'evaluates that module to pre-render the route, so a missing field throws before any HTML comes out.',
        nunca:
          'Neither `.tsx` with raw text, nor an environment variable: both vanish in production with no warning.',
      },
    ),
    regra(
      'placeholder-barra-o-build',
      // `TROQUE-` STAYS PORTUGUESE: it is the literal placeholder token the
      // generator writes into the site.json of Brazilian projects, and the one
      // the SENTINELA of `conteudo/esquema.ts` matches. Translating it here would
      // name a token that exists in no generated file.
      'The build fails while one TROQUE-… is left',
      ['conteudo/esquema.ts', 'conteudo/site.json'],
      {
        imposta_em: ph.imposta_em || 'conteudo/esquema.ts',
        pendentes_agora: ph.erro ? `could not scan: ${ph.erro}` : ph.itens.length,
        campos: ph.itens.map((i) => i.campo),
        porque:
          'The placeholder is INERT on purpose — impossible to mistake for a real value. A ' +
          'plausible value invented to shut the build up ships, looks right and delivers no order at all.',
        como:
          'Ask the user for the real value and swap it in `conteudo/site.json`. NEVER invent, ' +
          'and NEVER loosen the SENTINELA so the build passes.',
      },
    ),
    regra(
      'segredo-nao-entra-no-commit',
      'Key, token and .env are blocked before the commit exists',
      ['.githooks/pre-commit', '.githooks/scan-secret.mjs'],
      {
        armado_no_git: armadoNoGit,
        core_hooksPath: hooks.valor,
        porque:
          'A secret in history is not fixed by a new commit: it demands ROTATING the credential. ' +
          'That is why it is the only thing blocked BEFORE it exists, and not audited afterwards.',
        como: armadoNoGit
          ? 'Already armed. The hook scans only what is staged, to fit in under 5 s.'
          : // `hooks.motivo` is one of the three Portuguese state strings above — see the note there.
            `${hooks.motivo} ARM IT NOW: \`node .githooks/install.mjs\`.`,
      },
    ),
    regra(
      'coautoria-e-de-humano',
      'You do not sign the commit',
      ['.githooks/commit-msg', '.githooks/check-message.mjs', '.rebar-coauthors'],
      {
        armado_no_git: armadoNoGit,
        porque:
          'The `.rebar-coauthors` allowlist is of PEOPLE on the project. A `Co-authored-by` trailer ' +
          'from an AI is blocked twice: by the hook, before the commit exists, and by the ruler ' +
          'afterwards, in history — where it can no longer be undone without rewriting.',
        como: 'Do not add any trailer in your own name. The owner is the one who edits the allowlist.',
      },
    ),
    regra(
      'pilha-fechada',
      'The stack is already decided; a new component comes from shadcn',
      ['package.json'],
      {
        instalado: p
          ? Object.entries(p.deps)
              .map(([n, v]) => `${n}@${v}`)
              .sort()
          : [],
        nao_instale: [
          ...(p?.baseUi ? ['@radix-ui/* — the styling here is base-nova over @base-ui/react'] : []),
          'any second library for UI, for state, for dates or for forms',
          'an MCP SDK — this server uses none, on purpose (see the top of .rebar/mcp.mjs)',
        ],
        porque:
          'A new dependency needs a written reason. If a built-in of Node or of Next itself solves ' +
          'it, that is the one — this repository goes into the hands of a client and every ' +
          'dependency becomes an audit and an update forever.',
      },
    ),
    regra(
      'export-estatico',
      'The build is static, and that forbids half of Next',
      ['next.config.ts'],
      {
        ativo: Boolean(p?.exportEstatico),
        porque:
          'With `output: "export"` `next build` emits files; without it it emits a server, and ' +
          'static hosting publishes an empty folder. That failure does NOT show up in the build: it shows up in the deploy.',
        nao_use: p?.exportEstatico
          ? [
              'route handlers (app/**/route.ts) and middleware — they do not exist in the export',
              'server actions and any per-request render',
              'optimized next/image — the optimizer demands a server; here `images.unoptimized` is on',
            ]
          : ['(the export is not on in this next.config — check before publishing)'],
      },
    ),
    regra(
      'portao-antes-de-pronto',
      'Nothing is "done" before `npm run verificar`',
      ['package.json'],
      {
        comando: p?.scripts?.verificar || '(there is no `verificar` script in package.json)',
        passos: p?.scripts?.verificar ? p.scripts.verificar.split('&&').map((s) => s.trim()) : [],
        porque:
          'It is the SAME command the CI runs. Green bought by switching a rule off is debt, not a conclusion.',
        como: 'Run it and paste the output. This MCP is a shortcut against getting it wrong; the door is this command.',
      },
    ),
    regra('idioma-unico', 'Brazilian Portuguese, in everything', ['AGENTS.md'], {
      porque:
        'Code, comment, file name and commit message. The comment explains the WHY, with the ' +
        'measured number when there is one — it does not repeat what the line below it already says.',
      cobrada_por: `rebar's ruler, rule \`idioma-unico\`: ${REGUA}`,
    }),
  ]

  return regras
}

// ───────────────────────────────────────────────────────── 5. the five tools
//
// The names are the same ones this project's `AGENTS.md` orders to be called,
// and that is a contract: the text that instructs the agent and the tools it
// finds have to match, otherwise the instruction becomes noise in the first session.
//
// The SUBJECT, though, is ANOTHER one — and that is the point of the request.
// The same five questions, answered about THIS SITE and not about rebar's
// repository: whoever opens this project six months from now wants to know where
// the content here lives, what fails the build here and what blocks the commit here.

const emJson = (v) => JSON.stringify(v, null, 2)

const FERRAMENTAS = [
  {
    name: 'rebar_regras',
    title: 'The rules that fail THIS project, derived from disk right now',
    description:
      "Lists this project's rules: where the content lives, what blocks the build, what blocks the " +
      'commit and what the stack is. CALL BEFORE THE FIRST LINE OF CODE. Each rule names the ' +
      'file that enforces it and says whether it is `ativa` or `DESARMADA` (unarmed) in this ' +
      'checkout — nothing here is frozen text, everything is read from disk at the instant of the call.',
    inputSchema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'term in the id or title, so as not to list all' },
      },
    },
    executar: ({ busca }) => {
      let regras = regrasDoProjeto()
      if (busca) {
        const t = String(busca).toLowerCase()
        regras = regras.filter((r) => `${r.id} ${r.titulo}`.toLowerCase().includes(t))
        if (!regras.length) {
          return `No rule of this project matches "${busca}". Call with no filter to see all ${regrasDoProjeto().length}.`
        }
      }
      const desarmadas = regras.filter((r) => r.estado === 'DESARMADA')
      const cabeca = [
        `The rules of ${pilha()?.nome ?? 'this project'}, derived from disk at ${new Date().toISOString()}.`,
        // `DESARMADA(S)` and the closing `Avise o usuário.` STAY PORTUGUESE:
        // `testes/portao.test.mjs` asserts /DESARMADA/ and /Avise o usuário/ over
        // this very line to prove the server warns instead of reciting. They are
        // the contract with that proof, not prose.
        desarmadas.length
          ? `WARNING: ${desarmadas.length} rule(s) DESARMADA(S) — the file that enforces them is not here. Avise o usuário.`
          : 'Every rule below has the file that enforces it present on disk.',
        `These are the rules of THIS site. The rebar-check ones run through \`${REGUA}\`, and the security ones through \`${REGUA_SEGURANCA}\` — use rebar_verificar { regua: true }.`,
        '',
      ].join('\n')
      return cabeca + emJson(regras)
    },
  },

  {
    name: 'rebar_porque',
    title: 'Why this rule exists, with the file that enforces it',
    description:
      'Returns the reason for a rule by id, and the file:line that enforces it TODAY. CALL WHEN ' +
      'THE GATE FAILS and you are tempted to work around the rule, and BEFORE proposing to ' +
      'loosen, ignore or delete any check.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'the rule id, e.g. "placeholder-barra-o-build"' },
      },
      required: ['id'],
    },
    executar: ({ id }) => {
      const regras = regrasDoProjeto()
      const r = regras.find((x) => x.id === id)
      if (!r) {
        return {
          erro: true,
          texto: `"${id}" is not a rule of this project.\nAvailable: ${regras.map((x) => x.id).join(', ')}`,
        }
      }
      // The size in lines, and not a quotation: quoting here would be the copy
      // this whole file exists not to have. The answer orders the file to be
      // READ, which is the source the gate uses.
      const provas = r.imposta_por.map((rel) => {
        const fonte = ler(rel)
        return {
          arquivo: rel,
          no_disco: fonte !== null,
          linhas: fonte === null ? null : fonte.split('\n').length,
        }
      })
      return emJson({ ...r, provas, leia_estes_arquivos: r.imposta_por })
    },
  },

  {
    name: 'rebar_decidir',
    title: 'What this project has already decided about X',
    description:
      "Searches a subject among this project's already-closed decisions — stack, content, " +
      'publishing, commit, language — and answers with the file that proves the decision. CALL ' +
      'BEFORE PROPOSING any choice of library, format or process. When nothing matches, it SAYS ' +
      'that nothing enforces it, instead of inventing.',
    inputSchema: {
      type: 'object',
      properties: {
        assunto: {
          // The examples STAY PORTUGUESE, and they are examples on purpose: the
          // matcher vocabulary below is Portuguese, so a subject asked in English
          // matches nothing. Ask in the words the project is written in.
          type: 'string',
          description: 'in words, in Portuguese: "cor", "imagem", "rota", "commit", "teste"',
        },
      },
      required: ['assunto'],
    },
    executar: ({ assunto }) => {
      const p = pilha()
      const t = String(assunto).toLowerCase()
      // EVERY `sobre` LIST STAYS PORTUGUESE — it is not prose: it is the
      // matcher's vocabulary, compared word by word against `assunto` down below.
      // The project it answers about is written in Portuguese and so is the
      // question the agent asks. Translating these lists makes the tool answer
      // "nothing decides about this" for every subject that does have a decision.
      const decisoes = [
        {
          sobre: [
            'pilha',
            'framework',
            'next',
            'react',
            'tailwind',
            'ui',
            'componente',
            'radix',
            'biblioteca',
            'dependencia',
            'dependência',
          ],
          decisao: p
            ? `Closed. Installed today: ${
                Object.entries(p.deps)
                  .map(([n, v]) => `${n}@${v}`)
                  .join(', ') || '(nothing in dependencies)'
              }.` +
              ` A new component comes from \`shadcn add\`, not hand-written. A new dependency needs a written reason.`
            : 'Could not read package.json — decision undetermined.',
          prova: 'package.json',
        },
        {
          sobre: [
            'conteudo',
            'conteúdo',
            'texto',
            'telefone',
            'endereco',
            'endereço',
            'preco',
            'preço',
            'url',
            'cnpj',
            'json',
          ],
          decisao:
            'Closed. Every business datum lives in `conteudo/site.json`, validated by ' +
            '`conteudo/esquema.ts` at module scope. A literal in `.tsx` or in an environment ' +
            'variable is forbidden — both forms break in silence after publishing.',
          prova: 'conteudo/esquema.ts',
        },
        {
          sobre: [
            'publicar',
            'deploy',
            'build',
            'export',
            'estatico',
            'estático',
            'rota',
            'route',
            'middleware',
            'imagem',
            'image',
            'servidor',
          ],
          decisao: p?.exportEstatico
            ? 'Closed: `output: "export"`. The build emits files, not a server. So there are NO ' +
              'route handlers, middleware, server actions or image optimization in this project.'
            : '`output: "export"` is NOT on in this next.config — check before publishing, ' +
              'because static hosting would publish an empty folder.',
          prova: 'next.config.ts',
        },
        {
          sobre: [
            'commit',
            'coautoria',
            'autor',
            'segredo',
            'chave',
            'token',
            'env',
            'hook',
            'git',
          ],
          decisao:
            'Closed. `.githooks/pre-commit` blocks a secret before the commit exists; ' +
            '`.githooks/commit-msg` blocks a co-authorship trailer that is not in the allowlist of ' +
            'humans in `.rebar-coauthors`. To arm: `node .githooks/install.mjs`.',
          prova: '.githooks/pre-commit',
        },
        {
          sobre: [
            'idioma',
            'lingua',
            'língua',
            'portugues',
            'português',
            'ingles',
            'inglês',
            'comentario',
            'comentário',
          ],
          decisao:
            'Closed: Brazilian Portuguese in code, comment, file name and commit. The comment ' +
            'explains the WHY, with the measured number when there is one.',
          prova: 'AGENTS.md',
        },
        {
          sobre: ['teste', 'verificar', 'portao', 'portão', 'ci', 'lint', 'typecheck'],
          decisao: p?.scripts?.verificar
            ? `Closed: \`npm run verificar\` = ${p.scripts.verificar}. It is the same command as the CI.`
            : "There is no `verificar` script in package.json — this project's gate is incomplete.",
          prova: 'package.json',
        },
      ]

      // MATCHES BY WORD, and not by substring, and the reason is a measured false
      // positive: with `t.includes(s)` the question "build" matched the STACK
      // decision, because "b-u-i-l-d" contains "ui". A wrong answer with the face
      // of an answer is the defect this whole server hunts.
      const palavras = t.split(/[^a-zà-ú]+/i).filter(Boolean)
      const casou = decisoes.filter((d) =>
        d.sobre.some((s) => palavras.some((p) => p === s || (p.length >= 4 && s.startsWith(p)))),
      )
      if (!casou.length) {
        return (
          `Nothing in this project decides about "${assunto}".\n\n` +
          'That is an answer, not a gap: pick whatever is reasonable and WRITE THE WHY in the ' +
          `comment. To check it against rebar's ruler, run \`${REGUA}\`.\n` +
          `Subjects that do have a closed decision here: ${decisoes.map((d) => d.sobre[0]).join(', ')}.`
        )
      }
      return emJson(
        casou.map(({ sobre, ...resto }) => ({
          assunto: sobre[0],
          ...resto,
          no_disco: tem(resto.prova),
        })),
      )
    },
  },

  {
    name: 'rebar_portao',
    title: "This project's gate, in order, and what to do when a step fails",
    description:
      'Returns the steps of `npm run verificar` READ from package.json, plus the state of the git ' +
      'hooks. CALL WHEN VERIFICAR FAILS and the message is not enough, and before saying that ' +
      'something "passed". This MCP is not the door: the door is the command this tool returns.',
    inputSchema: {
      type: 'object',
      properties: {
        passo: { type: 'string', description: 'the step name, e.g. "build" or "lint"' },
      },
    },
    executar: ({ passo }) => {
      const p = pilha()
      const hooks = hooksArmados()
      const cadeia = p?.scripts?.verificar
      const passos = cadeia
        ? cadeia.split('&&').map((s) => {
            const cmd = s.trim()
            const nome = cmd.replace(/^npm (run )?/, '')
            return { nome, comando: cmd, roda: p.scripts[nome] || '(script not found)' }
          })
        : []

      if (passo) {
        const alvo = passos.find((x) => x.nome === String(passo).trim())
        if (!alvo) {
          return {
            erro: true,
            texto: `"${passo}" is not a step of this gate. They are: ${passos.map((x) => x.nome).join(', ') || '(none)'}`,
          }
        }
        const dica = {
          lint: 'Fix the code. Switching the rule off in eslint.config is debt, not a fix.',
          typecheck: 'Type `any` to shut the error up is the same defect under another name.',
          test: 'A test that started failing after a change of yours is right until proven otherwise.',
          build:
            'The most common cause here is NOT code: it is a placeholder. `conteudo/esquema.ts` throws at ' +
            'module scope and the build stops before any HTML comes out. Call rebar_verificar to see which ones are missing.',
        }[alvo.nome]
        return emJson({
          ...alvo,
          quando_reprova: dica || 'Read the command output; it names the file.',
        })
      }

      return emJson({
        a_porta: cadeia || "(there is no `verificar` script — this project's gate is incomplete)",
        passos,
        hooks_de_git: {
          core_hooksPath: hooks.valor,
          armado: hooks.armado,
          // Present only when it is NOT armed, and it is the field that says which
          // of the three unarmed states it is: no configuration, nonexistent
          // target, or another folder. Its text is Portuguese on purpose — see
          // the note in `hooksArmados`.
          porque_nao: hooks.motivo,
          arquivos_no_disco: ['.githooks/pre-commit', '.githooks/commit-msg'].filter((r) => tem(r)),
          como_armar: 'node .githooks/install.mjs',
          porque:
            'The hook does NOT come armed in the clone. Without `core.hooksPath` the file is on ' +
            'disk and git does not execute it: the gate looks installed and checks zero.',
        },
        regua_do_rebar: `${REGUA}   (format; network required)`,
        // A separate binary because it fails for a separate reason: wrong format
        // and a security failure are not fixed the same way nor with the same
        // hurry.
        regua_de_seguranca: `${REGUA_SEGURANCA}   (security; network required)`,
        aviso: 'This MCP is a shortcut. What blocks is the command above, the hook and the CI.',
      })
    },
  },

  {
    name: 'rebar_verificar',
    title: 'Scan this project now and return the scoreboard',
    description:
      'LOCAL and instant scan: placeholders still missing in conteudo/site.json, unarmed rules ' +
      'and hooks that are not armed. With { regua: true } it also runs the published rebar ruler ' +
      `(\`${REGUA}\`), which costs ~17 s and DEMANDS NETWORK. ` +
      'CALL AFTER TOUCHING the project and before claiming you are done. SHORTCUT, NOT BARRIER: ' +
      'what blocks is `npm run verificar`, the hook and the CI.',
    inputSchema: {
      type: 'object',
      properties: {
        regua: {
          type: 'boolean',
          description: 'also runs the published rebar ruler (~17 s, network required)',
        },
      },
    },
    executar: async ({ regua }) => {
      const ph = placeholdersPendentes()
      const regras = regrasDoProjeto()
      const hooks = hooksArmados()

      const reprovas = []
      if (ph.erro) reprovas.push(`content: ${ph.erro}`)
      else if (ph.itens.length) {
        reprovas.push(
          `content: ${ph.itens.length} placeholder(s) in conteudo/site.json — \`next build\` STOPS here. ` +
            `Fields: ${ph.itens.map((i) => i.campo).join(', ')}`,
        )
      }
      // `DESARMADA` is the state token, not prose — see the note in `regrasDoProjeto`.
      for (const r of regras.filter((x) => x.estado === 'DESARMADA')) {
        reprovas.push(`rule ${r.id}: DESARMADA — missing ${r.falta.join(', ')}`)
      }
      if (hooks.valor === null && tem('.githooks/pre-commit')) {
        reprovas.push(
          'hooks: the files are in .githooks/ but `core.hooksPath` is not configured — ' +
            'git does not execute them. Arm with `node .githooks/install.mjs`.',
        )
      }

      const local = {
        placar_local: reprovas.length ? 'FAIL' : 'pass',
        reprovas,
        placeholders_pendentes: ph.erro ? null : ph.itens,
        conferido_em: new Date().toISOString(),
        aviso:
          'This is the local scan, and it does NOT replace `npm run verificar` (lint, typecheck, ' +
          "test and build) nor rebar's ruler.",
      }

      if (!regua) return emJson(local)
      return emJson({ ...local, regua_do_rebar: await rodarRegua() })
    },
  },
]

// ──────────────────────────────────────── the only thing that runs the network
//
// It stays apart and is called only on explicit request, because it costs 9.3 s
// measured on 2026-09-02 with the npx cache warm, and because it fails when
// there is no network — and a tool that sometimes takes 9 s and sometimes fails
// cannot be the default path of anything.
//
// `process.execPath` over the real `npx-cli.js`, never the `npx` from the PATH:
// on Windows `npx` is `npx.cmd`, a batch script, and CreateProcess does not run
// `.cmd` without an interpreter. The error is ENOENT over a command that IS on
// the PATH, and it survived a year in the previous project because only Linux
// was tested.
function resolverNpx() {
  const dirNode = dirname(process.execPath)
  const candidatos = [
    // Windows: node.exe and node_modules/npm/ share the same folder.
    join(dirNode, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    // POSIX: npm sits in ../lib/node_modules. Holds for nvm, fnm and homebrew.
    join(dirNode, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    join(dirNode, '..', 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ]
  return candidatos.find((c) => existsSync(c)) || null
}

/**
 * ASYNCHRONOUS, and the first version of this was synchronous. The swap is not style.
 *
 * Node runs on a single thread. With the synchronous variant of `spawn`, the
 * WHOLE process stands still while `npx` resolves — and what stands still with
 * it is the loop that reads stdin, that is, the server stops answering any other
 * question from the agent, including the `ping` the client uses to decide
 * whether the session is alive. Measured on 2026-09-02, that stall is 9.3 s with
 * the npx cache warm, and it grows with no known ceiling on a bad network: a
 * shortcut that freezes the session when the network gets worse is worse than no
 * shortcut at all, which is the thesis of this file.
 *
 * With `execFile` the child runs alongside, the stdin loop keeps spinning and
 * the time ceiling is REAL. 90 s is generous for a cold `npx` resolution and
 * short enough for the agent to get a refusal instead of waiting without knowing
 * — measured on 2026-09-02 against a nonexistent spec: refusal naming the
 * command in 4.3 s, with no invented green.
 */
function rodarRegua() {
  const args = ['--yes', ESPEC_REBAR, '.', '--json']
  const npx = resolverNpx()
  const comando = `npx ${args.join(' ')}`
  const opcoes = {
    cwd: RAIZ,
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  }

  return new Promise((resolver) => {
    // The command line is a CONSTANT of this file — nothing coming from the MCP
    // client enters it. The `shell: true` of plan B exists only for the install
    // layout where npx-cli.js is not next to Node.
    const chamada = npx
      ? [process.execPath, [npx, ...args], opcoes]
      : ['npx', args, { ...opcoes, shell: true }]

    execFile(...chamada, (erro, stdout, stderr) => {
      // The checker exits 1 when it FAILS, and that is a result, not a failure of
      // the call: the `--json` is still on stdout and it is what matters.
      if (erro && !stdout) {
        const expirou = erro.killed || erro.signal
        return resolver({
          rodou: false,
          motivo: expirou
            ? `the ruler did not answer in ${opcoes.timeout / 1000} s and was terminated`
            : `the ruler never got to run: ${erro.message}`,
          comando,
          leia:
            'With no network the ruler does not run. The local rules above still hold, and the CI ' +
            'runs this same line — its verdict does not change because of this.',
          stderr: (stderr || '').slice(0, 1000),
        })
      }
      let placar
      try {
        placar = JSON.parse(stdout)
      } catch {
        return resolver({
          rodou: false,
          motivo: 'the ruler answered something that is not JSON',
          saida: (stdout || stderr || '').slice(0, 2000),
          comando,
        })
      }
      resolver({ rodou: true, saida_do_processo: erro?.code ?? 0, comando, placar })
    })
  })
}

// ──────────────────────── 6. the transport: JSON-RPC 2.0 over stdio, by hand
//
// The contract of MCP's stdio transport: one JSON message per line, with no
// embedded newline. `JSON.stringify` never emits a raw newline, so serializing
// and concatenating `\n` already satisfies the framing — there is no case to handle.
//
// A notification is a message WITHOUT `id`, and the answer to it is NONE.
// Answering a notification is the error that hangs strict clients, because they
// have no one to hand the answer to.

const VERSAO = '1.0.0'

// The protocol versions this server serves. It only uses `tools`, which exists
// the same in all three, so negotiating is picking the one the client asked for
// when it is here — and falling back to the newest when it is not, which is what
// the spec orders for an unknown version.
const PROTOCOLOS = ['2024-11-05', '2025-03-26', '2025-06-18']

// What the client shows the model the moment the session opens. It is the ONLY
// text of this server that reaches the agent without it having called anything,
// so this is where the starting order lives — and the sentence it passes on to
// the user when something is unarmed.
const INSTRUCOES = [
  'This is the MCP server of this project. It answers about THIS site, reading the files from disk on every call — nothing here is a frozen copy.',
  '',
  'BEFORE THE FIRST LINE OF CODE, call `rebar_regras`. It says where the content lives, what blocks the build, what blocks the commit and what the stack is.',
  'AFTER TOUCHING anything and before saying you are done, call `rebar_verificar`.',
  '',
  'If any rule comes back as DESARMADA (unarmed), or if the hooks are not armed, TELL THE USER before going on: the gate looks installed and checks zero.',
  '',
  `This server is a shortcut, not a door. What blocks is \`npm run verificar\`, the commit hook and the CI — and the published ruler, \`${REGUA}\`.`,
].join('\n')

// The ONLY write to stdout in this file. See section 5 of the header.
const enviar = (m) => process.stdout.write(`${JSON.stringify(m)}\n`)

const responder = (id, result) => enviar({ jsonrpc: '2.0', id, result })
const falhar = (id, code, message) => enviar({ jsonrpc: '2.0', id, error: { code, message } })

function despachar(m) {
  const { id, method, params } = m
  // Notification: no `id`. Nothing goes back, not even for an unknown method.
  const ehNotificacao = id === undefined || id === null

  if (method === 'initialize') {
    const pedida = params?.protocolVersion
    return responder(id, {
      protocolVersion: PROTOCOLOS.includes(pedida) ? pedida : PROTOCOLOS[PROTOCOLOS.length - 1],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'rebar', title: 'rebar — the rules of this project', version: VERSAO },
      instructions: INSTRUCOES,
    })
  }

  if (ehNotificacao) return

  if (method === 'ping') return responder(id, {})

  if (method === 'tools/list') {
    return responder(id, {
      tools: FERRAMENTAS.map(({ name, title, description, inputSchema }) => ({
        name,
        title,
        description,
        inputSchema,
      })),
    })
  }

  if (method === 'tools/call') {
    const alvo = FERRAMENTAS.find((f) => f.name === params?.name)
    if (!alvo) {
      return falhar(id, -32602, `unknown tool: ${params?.name}`)
    }
    // `Promise.resolve` covers both shapes without duplicating the path: four
    // tools only read disk and return a string on the spot; `rebar_verificar`
    // with `{ regua: true }` returns a promise, because it runs a child process
    // and CANNOT stop the loop that reads stdin — see `rodarRegua`.
    return Promise.resolve()
      .then(() => alvo.executar(params?.arguments ?? {}))
      .then((saida) => {
        // A USAGE error — an id that does not exist, a subject with no decision —
        // comes back as a result with `isError`, and not as a JSON-RPC error. The
        // difference matters: a protocol error the client hides from the model,
        // and the model is left not knowing it got the argument wrong.
        const corpo = typeof saida === 'string' ? { texto: saida } : saida
        responder(id, {
          content: [{ type: 'text', text: corpo.texto }],
          ...(corpo.erro ? { isError: true } : {}),
        })
      })
      .catch((e) => {
        // A disk read failure cannot drop the session: it turns into an answer,
        // with the tool name, so the agent can fix it.
        responder(id, {
          content: [
            { type: 'text', text: `mcp: ${alvo.name} failed reading this project: ${e.message}` },
          ],
          isError: true,
        })
      })
  }

  return falhar(id, -32601, `method not implemented: ${method}`)
}

// How many calls are in flight. It exists because of the shutdown just below, and
// it holds for the real case, not only for the test: the client can close the
// pipe while `rebar_verificar { regua: true }` still has the child process
// running, and exiting there would deliver silence in place of the answer.
let noAr = 0
let canoFechado = false

const talvezSair = () => {
  if (canoFechado && noAr === 0) process.exit(0)
}

let pendente = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (pedaco) => {
  pendente += pedaco
  let corte
  while ((corte = pendente.indexOf('\n')) !== -1) {
    const linha = pendente.slice(0, corte).trim()
    pendente = pendente.slice(corte + 1)
    if (!linha) continue
    let m
    try {
      m = JSON.parse(linha)
    } catch {
      // With no `id` there is no one to answer, so the parse error goes to
      // stderr and the session carries on: one dirty line is no reason to drop
      // a server the agent is going to need on the next question.
      grito(`unreadable line on stdin, ignored (${linha.length} bytes)`)
      continue
    }
    noAr += 1
    try {
      const talvez = despachar(m)
      if (talvez && typeof talvez.then === 'function') {
        talvez.then(() => {
          noAr -= 1
          talvezSair()
        })
        continue
      }
    } catch (e) {
      if (m?.id !== undefined && m?.id !== null)
        falhar(m.id, -32603, `internal error: ${e.message}`)
      else grito(`internal error in a notification: ${e.message}`)
    }
    noAr -= 1
  }
})

// The client closed the pipe: the session is over and the process exits clean —
// BUT only after answering what was already in flight. Without `talvezSair` it
// would stay alive holding a dead stdin until someone killed it; without the
// counter, it would exit mid-call and the agent would see the session drop with
// no answer and no error.
process.stdin.on('end', () => {
  canoFechado = true
  talvezSair()
})

grito(
  `server ready in ${relative(process.cwd(), RAIZ) || '.'} — ${FERRAMENTAS.length} tools, zero dependencies`,
)
