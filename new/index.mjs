#!/usr/bin/env node
// THE GENERATOR.  npx github:Navesz/rebar new <nome>
//
// IT DOES NOT WRITE THE APPLICATION, and that is the decision that governs the
// whole file. The scaffold is delegated to `shadcn create`, which already
// delivers exactly the stack decided in §12.2 — Next 16 App Router, React
// 19.2.4, Tailwind 4, base-nova style over @base-ui/react, zero Radix. Writing
// our own scaffold would mean keeping a copy of shadcn's work up to date
// forever, and it would start rotting on their first release.
//
// What this file does is what shadcn does not: it validates the name, calls the
// scaffold in a way that works on BOTH systems, applies the gate on top, makes
// the first commit and RUNS THE RULER on the result, printing the scoreboard. A
// generated project that does not pass rebar's own ruler is a generator that
// manufactures debt, so the scoreboard goes on screen, always, even when it is
// bad.
//
// Zero dependencies: Node built-ins only.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  aplicarPortao,
  marcarExecutaveis,
  normalizarFormato,
  PASTA_HOOKS,
  REGISTRO_REMOTO,
} from './gate/aplicar.mjs'
import { ambienteDeIdentidade } from './identidade.mjs'

// fileURLToPath, not .pathname: on Windows the pathname comes out as
// "/C:/Users/...", with a slash before the drive letter, and every join from it
// points at nothing.
const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ_REBAR = join(AQUI, '..')

const eco = (...t) => console.log(...t)

// ────────────────────────────────────────────────────────── 1. the project name
//
// The name is USER INPUT and it is the only variable value that comes anywhere
// near a child process. It is validated here, once, against a character
// allowlist — not against a list of forbidden things. A forbidden list is the
// form that is always missing a case; an allowlist errs by closing.
const NOME_VALIDO = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/

// Names Windows reserves for devices. `mkdir CON` fails with a message that does
// not say why, and the project dies in the middle of the scaffold.
const RESERVADOS_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i

function validarNome(nome) {
  if (!nome) return 'the project name is missing'
  if (nome.length > 64) return 'name longer than 64 characters'
  if (!NOME_VALIDO.test(nome)) {
    return (
      `"${nome}" will not do. Use lowercase letters, digits, dot, hyphen and underscore, ` +
      'starting and ending with a letter or a digit. No space, no slash, no accent — ' +
      'the name becomes a folder, an npm package and a repository name, and the three are ' +
      'narrower than the file system.'
    )
  }
  if (RESERVADOS_WINDOWS.test(nome)) return `"${nome}" is a name reserved by Windows`
  return null
}

// The domain goes through no shell at all — it becomes a string inside a content
// JSON. It is validated anyway, and for a reason that is not injection: it is
// concatenated as `https://${dominio}`, so a value carrying a slash, a space or
// a scheme produces a broken URL that only shows up on the share card, after
// publishing.
const HOST = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+'

// A PATH IS ALLOWED, and it is not a nicety: a GitHub Pages PROJECT site lives
// at `user.github.io/repo`. Without this the only way to generate one was to
// generate it wrong and edit the JSON afterwards — which is the "edit by hand"
// this generator exists to remove. The schema accepts the path since the same
// commit; the CLI was one level behind.
//
// The rest of the validation stands, and its reason does not change: the value
// is concatenated as `https://${dominio}`, so a scheme, a space, a query, a
// fragment or a trailing slash still produce a broken URL that only shows up on
// the share card, after publishing.
const CAMINHO = '(?:/[A-Za-z0-9._~-]+)*'
const DOMINIO_VALIDO = new RegExp(`^${HOST}${CAMINHO}$`)

function validarDominio(dominio) {
  // 253 is the DNS limit and it applies to the HOST, not to the path.
  const host = dominio.split('/')[0]
  if (DOMINIO_VALIDO.test(dominio) && host.length <= 253) return null
  return (
    `"${dominio}" is not a domain. Write the host, without https:// and without a trailing ` +
    'slash — for example: padaria.com.br. For a GitHub Pages project site the repository ' +
    'name comes after the host: navesz.github.io/assay'
  )
}

// ──────────────────────────────────────────────── 2. how to call `shadcn create`
//
// HERE LIVES THE DEFECT THAT KILLED THE PREVIOUS PROJECT, and the choice is
// written down so it is not undone by mistake.
//
// `execFileSync('npx', ...)` DOES NOT WORK on Windows. `npx` is not an
// executable there: it is `npx.cmd`, a batch shim, and Windows' CreateProcess
// does not execute a `.cmd` file without an interpreter. The error is `ENOENT`,
// which says "file not found" about a file that is on the PATH, and that is why
// it survived a year in the foundation — the CI over there only ran Linux, where
// `npx` is a real symlink and everything passes.
//
// TWO WAYS OUT, AND THE CHOSEN ONE IS THE FIRST:
//
//   (a) RESOLVE THE BINARY. The real `npx` is a Node script, `npx-cli.js`,
//       which lives together with npm next to Node itself. Once found, the call
//       becomes `process.execPath` + the script path — a real executable,
//       arguments passed as a VECTOR, with no shell in between. There is no
//       interpolation, so there is no injection surface, and the command is
//       literally the same on both systems.
//
//   (b) `spawnSync(..., { shell: true })`. It works, but it pays a price: with
//       a shell, the arguments stop being a vector and become a COMMAND LINE
//       that cmd.exe reparses. The project name is user input and would be on
//       that line. It can be armored — and it is armored, `validarNome` above
//       runs before everything —, but the armor is a second thing to keep right
//       forever.
//
// (a) is the default. (b) stays as a net, for the install layout I did not
// foresee, and is ONLY reached with the name already validated. The net is
// announced when it is used: falling back to the shell silently would be
// trading one defect for another.
function resolverNpx() {
  const dirNode = dirname(process.execPath)
  const candidatos = [
    // Windows: node.exe and node_modules/npm/ share the same folder.
    join(dirNode, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    // POSIX: /usr/bin/node or ~/.nvm/versions/node/vX/bin/node — npm sits in
    // ../lib/node_modules. Holds for nvm, fnm, volta and homebrew.
    join(dirNode, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    join(dirNode, '..', 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ]
  // Running from inside an npm script, npm itself says where it is.
  if (process.env.npm_execpath) {
    candidatos.unshift(join(dirname(process.env.npm_execpath), 'npx-cli.js'))
  }
  return candidatos.find((c) => existsSync(c)) || null
}

function rodarShadcn(nome, pasta) {
  // Fixed vector. The only variable element is `nome`, already validated, and
  // `pasta`, which is a path this process computed — neither of the two goes
  // through a shell on path (a).
  const args = [
    'shadcn@latest',
    'create',
    '-t',
    'next',
    '-b',
    'base',
    '-p',
    'nova',
    '--pointer',
    '-n',
    nome,
    '-y',
    '-c',
    pasta,
  ]

  const npx = resolverNpx()
  if (npx) {
    eco(`  npx resolved: ${npx}`)
    return spawnSync(process.execPath, [npx, '--yes', ...args], {
      cwd: pasta,
      stdio: 'inherit',
    })
  }

  eco('  WARNING: did not find npx-cli.js next to Node; falling back to shell:true.')
  eco('           The project name was already validated against a character allowlist.')
  return spawnSync('npx', ['--yes', ...args], { cwd: pasta, stdio: 'inherit', shell: true })
}

// ──────────────────────────────────────────────────────────────────── git

function git(cwd, args, env) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', ...(env ? { env } : {}) })
}

function configGit(cwd, chave) {
  const r = git(cwd, ['config', '--get', chave])
  return r.status === 0 ? r.stdout.trim() : ''
}

// ───────────────────────────────────────────────────────────────── the ruler

/**
 * Runs rebar-check on the generated project and returns the exit code.
 *
 * It prefers the checker from the local checkout — it is the same code that
 * `npx github:Navesz/rebar` would download, with no network and no stale cache
 * in between. The network only comes in if this file is running from a place
 * where `tooling/` did not come along, which should not happen and is announced
 * for that reason.
 */
function rodarRegua(destino) {
  const local = join(RAIZ_REBAR, 'tooling', 'rebar-check', 'index.mjs')
  if (existsSync(local)) {
    return spawnSync(process.execPath, [local, destino], { stdio: 'inherit' }).status
  }
  eco('  WARNING: did not find the local rebar-check; fetching via npx (needs network).')
  const npx = resolverNpx()
  const args = ['--yes', 'github:Navesz/rebar', destino]
  const r = npx
    ? spawnSync(process.execPath, [npx, ...args], { stdio: 'inherit' })
    : spawnSync('npx', args, { stdio: 'inherit', shell: true })
  return r.status
}

/**
 * The remote gate becomes a WARNING, and warnings drop the generator's exit code.
 *
 * WHAT THIS REPLACES. Until 2026-09-07 the generator printed a line telling the
 * human to open Settings › Rules, and that line ADMITTED the hole in its own
 * words — "without the ruleset, the CI is an optional green badge and the gate
 * closes nothing" — and then exited 0. Measured the same day on this owner's two
 * repositories: `Navesz/rebar` had the ruleset, `Navesz/assay` had none, and the
 * generator had said the same thing to both.
 *
 * The state is READ from the record the gate just wrote, never asserted here.
 * Two sources for "is the branch protected" is how one of them starts lying, and
 * the record is the one the project's own `npm run verificar` reads afterwards.
 *
 * It is a warning and not a failure because the generator CANNOT install it: the
 * ruleset touches the owner's account and the remote repository does not exist
 * yet. Accusing the owner of not having done something the tool never let them
 * do would be the automatic rule that is wrong, which costs more than an absent
 * rule. A warning is exit 1 with a name on screen — which is the whole point.
 */
function avisarPortaoRemoto(destino, avisos) {
  const caminho = join(destino, ...REGISTRO_REMOTO.split('/'))
  if (!existsSync(caminho)) {
    avisos.push(
      `${REGISTRO_REMOTO} was not written — the project has no record of its branch protection, ` +
        'and `npm run verificar` cannot check what it cannot compare',
    )
    return 'not written'
  }
  let registro
  try {
    registro = JSON.parse(readFileSync(caminho, 'utf8'))
  } catch (erro) {
    avisos.push(`${REGISTRO_REMOTO} came out as invalid JSON (${erro.message})`)
    return 'unreadable'
  }
  if (registro.estado === 'instalado') return registro.estado
  avisos.push(
    `the remote gate is "${registro.estado}": nobody has required the \`verificar\` check on ` +
      'GitHub yet, so a red CI still merges. This is item 2 of the list above, and the project ' +
      `now says so on every run — \`npm run verificar\` reads ${REGISTRO_REMOTO} and fails while ` +
      'it stays true',
  )
  return registro.estado
}

// ──────────────────────────────────────────────────────────────────── main

async function main(argv) {
  // Accepts both invocation forms, because both will exist:
  //   node new/index.mjs <nome>                (from the checkout)
  //   npx github:Navesz/rebar new <nome>       (with the bin wired to dispatch)
  const args = argv[0] === 'new' ? argv.slice(1) : argv
  const nome = args[0]

  const erroNome = validarNome(nome)
  if (erroNome) {
    console.error(`\n  ${erroNome}\n`)
    console.error('  usage: npx github:Navesz/rebar new <name> [domain[/path]]\n')
    return 2
  }

  // The domain is optional and the default is DELIBERATELY useless. It becomes
  // the content's `meta.urlBase`, that is, the site's `og:url` and `sitemap` —
  // and a plausible-but-wrong default is the worst of the options: it ships,
  // breaks nothing visible, and points the share card at the wrong place for
  // months. `.invalid` is a TLD reserved by RFC 2606 and never resolves, so
  // forgetting it is inert and loud instead of silent.
  const dominio = args[1] || `${nome}.exemplo.invalid`
  const erroDominio = validarDominio(dominio)
  if (erroDominio) {
    console.error(`\n  ${erroDominio}\n`)
    return 2
  }

  const pasta = process.cwd()
  const destino = resolve(pasta, nome)
  if (existsSync(destino)) {
    console.error(`\n  ${destino} already exists\n`)
    console.error('  The generator does not write over an existing folder: what it would do')
    console.error('  with whatever is already in there has no good answer.\n')
    return 2
  }

  eco(`\n▸ 1/6  name validated: ${nome}`)
  eco(`       destination: ${destino}`)

  eco('\n▸ 2/6  scaffold by shadcn (Next 16 · base-nova · @base-ui/react)')
  const r = rodarShadcn(nome, pasta)
  if (r.error) {
    console.error(`\n  shadcn create never got to run: ${r.error.message}\n`)
    return 127
  }
  if (r.status !== 0) {
    console.error(`\n  shadcn create exited ${r.status}. Nothing was applied on top.\n`)
    return r.status || 127
  }
  if (!existsSync(destino)) {
    console.error(`\n  shadcn exited 0 but ${destino} does not exist. No idea what it made.\n`)
    return 127
  }

  // The identity comes from the machine's git, and not from a fixed value in
  // the code: whoever shows up in the NOTICE and in the allowlist HAS to be
  // whoever is going to commit. If the two diverge, the project's first commit
  // is born failing the `coautoria-ia` rule — the allowlist would list one
  // person and the history would have another.
  //
  // The environment variables come in as a second source because CI runners and
  // containers usually have no `git config` at all and pass the identity through
  // GIT_AUTHOR_*. If both are missing, the generator DOES NOT INVENT: it warns,
  // does not commit, and leaves a marker that screams in place of the name.
  const nomeConfig = configGit(destino, 'user.name') || process.env.GIT_AUTHOR_NAME || ''
  const emailConfig = configGit(destino, 'user.email') || process.env.GIT_AUTHOR_EMAIL || ''
  // The marker and the placeholder e-mail go INTO the generated project's
  // NOTICE and allowlist, and they are a CONTRACT, not prose: the `placeholder`
  // rule of rebar-check greps audited repositories for `(NÃO|NAO) CONFIGURADO`
  // and `@exemplo.invalido` (tooling/rebar-check/index.mjs, const MARCA).
  // Translating either one here makes that rule stop seeing them.
  const dono = nomeConfig || 'DONO NÃO CONFIGURADO'
  const email = emailConfig || 'configure-git-user-email@exemplo.invalido'
  const semIdentidade = !emailConfig

  // THE `site` PRESET COMES BEFORE THE GATE, and the order is mandatory.
  //
  // `new/site/aplicar.mjs` copies its blocks with `cpSync(..., { force: true })`
  // — it OVERWRITES. The gate is idempotent and destroys nothing. In a stack of
  // layers, the destructive one runs first and the idempotent one last;
  // inverted, the `force: true` would erase the next.config.ts the gate had just
  // adjusted, silently. That is why the gate is "on top".
  //
  // Optional and defensive: if the preset is not present, or if it breaks, the
  // project still comes out — with the raw shadcn scaffold and the whole gate.
  // What cannot happen is the failure going unnoticed, so it becomes a warning,
  // and a warning drops the exit code at the end.
  eco('\n▸ 3/6  site preset, and the gate on top of it')
  const avisosSite = []
  if (!args[1]) {
    avisosSite.push(
      `no domain given — the content came out with "${dominio}", which does not resolve. ` +
        'Change `meta.urlBase` in conteudo/site.json before publishing, or generate again ' +
        `with: new ${nome} <domain>`,
    )
  }
  const caminhoSite = join(AQUI, 'site', 'aplicar.mjs')
  if (!existsSync(caminhoSite)) {
    eco('       site preset: missing — the raw shadcn scaffold comes out')
  } else {
    try {
      const { aplicarSite } = await import(pathToFileURL(caminhoSite).href)
      if (typeof aplicarSite !== 'function') {
        throw new Error('new/site/aplicar.mjs does not export aplicarSite')
      }
      const escritosSite = aplicarSite({ destino, nome, dominio, agora: new Date() }) || []
      eco(`       site preset: ${escritosSite.length} file(s) · domain ${dominio}`)

      // THE GENERATOR CANNOT SAY "project complete" FOR A PROJECT THAT DOES NOT
      // COMPILE. Finding from the 31/08 audit: with git configured — the normal
      // case — the output was `gerador: exit 0 — project complete` for a project
      // whose own `npm run verificar` exits 1 with nine placeholders.
      //
      // The function below already existed, exported and documented, and nobody
      // called it. A fix that is written and not wired is a fix that does not
      // exist — and it is the same class of defect the whole of rebar chases:
      // the rule is in the file and no machine executes it.
      const { pendenciasDoProjeto } = await import(pathToFileURL(caminhoSite).href)
      if (typeof pendenciasDoProjeto === 'function') {
        const pendentes = pendenciasDoProjeto(destino)
        if (pendentes.length) {
          avisosSite.push(
            `${pendentes.length} field(s) of conteudo/site.json came out with a PLACEHOLDER — ` +
              `this project's \`npm run build\` FAILS until you replace them, or until you ` +
              `DELETE the contact key this business does not have ` +
              `(that is on purpose: see the block above)`,
          )
        }
      }
    } catch (erro) {
      avisosSite.push(`the site preset failed (${erro.message}) — the raw shadcn scaffold came out`)
      eco(`       site preset: FAILED — ${erro.message}`)
    }
  }

  const { escritos, avisos, elos, exportEstatico } = aplicarPortao({
    destino,
    nome,
    raizRebar: RAIZ_REBAR,
    dono,
    email,
  })
  avisos.unshift(...avisosSite)
  for (const a of escritos) eco(`       + ${a}`)
  eco(`       next.config.ts output:"export" → ${exportEstatico}`)
  eco(`       verificar script → ${elos ? elos.join(' + ') : '(not written)'}`)

  // AFTER every write and BEFORE the first commit. The gate just replaced the
  // project's `.prettierrc` with the house one, and the files `shadcn create`
  // brought were written under the other. Without this pass the project is born
  // failing the `format-check` link the same gate just put in its chain — the
  // generator approving the debt it manufactured. See `normalizarFormato`.
  eco(`       prettier --write . → ${normalizarFormato(destino, avisos)}`)
  eco(`       remote gate → ${avisarPortaoRemoto(destino, avisos)}`)

  eco('\n▸ 4/6  git: init, hooks, first commit')
  // `git init` is idempotent and create-next-app already initialized — but it
  // committed nothing, so the first commit is ours. Running init again only
  // covers the case where the scaffold changes behavior.
  git(destino, ['init', '-q'])
  git(destino, ['add', '-A'])

  const modos = marcarExecutaveis(destino, avisos)
  if (modos) for (const m of modos) eco(`       mode ${m}`)

  // The hooks are installed BEFORE the first commit, on purpose: the
  // generator's commit goes through the gate the generator just assembled. A
  // gate that its own creation does not cross is an untested gate.
  const inst = spawnSync(process.execPath, [join(destino, PASTA_HOOKS, 'install.mjs')], {
    cwd: destino,
    encoding: 'utf8',
  })
  eco(`       ${(inst.stdout || inst.stderr || '').trim().split('\n').join('\n       ')}`)

  let commitou = false
  if (semIdentidade) {
    // `primeiro commit` stays in Portuguese: it is the command the owner types
    // in their own pt-BR repository, and it lands in that project's history —
    // the same reason as the commit message further down.
    avisos.push(
      'git without user.email on this machine — the first commit was NOT made. ' +
        'Configure it and run: git commit -m "primeiro commit"',
    )
  } else {
    // THE IDENTITY GOES THROUGH THE ENVIRONMENT, and the `-c` stays alongside as
    // belt and suspenders. The order matters and it was inverted here: in git,
    // `GIT_AUTHOR_*` BEATS `user.*`, and `-c user.email=` is config. So on a
    // machine with `git config user.email = a@x` and `GIT_AUTHOR_EMAIL = b@y` in
    // the environment, this block was writing `a@x` into the allowlist and into
    // the NOTICE — the config comes first in the `||` up above — and signing the
    // commit with `b@y`. The comment that used to be here claimed exactly the
    // opposite.
    //
    // See new/identidade.mjs for the precedence and for the proof.
    const c = git(
      destino,
      [
        '-c',
        `user.name=${dono}`,
        '-c',
        `user.email=${email}`,
        'commit',
        '-q',
        '-m',
        // The message goes into the GENERATED project's history, which is
        // pt-BR — it stays in Portuguese, like the NOTICE and the README.
        `${nome}: scaffold shadcn + portão do rebar`,
      ],
      ambienteDeIdentidade(dono, email),
    )
    commitou = c.status === 0
    if (!commitou) {
      avisos.push(`the first commit failed (${c.status}): ${(c.stderr || '').trim()}`)
    }
  }
  eco(`       first commit: ${commitou ? 'done' : 'NOT DONE'}`)

  eco('\n▸ 5/6  the rebar ruler over what was just generated\n')
  const placar = rodarRegua(destino)

  eco('\n▸ 6/6  what is left, and you are the one who does it')
  eco('')
  eco(`  cd ${nome}`)
  eco('  npm run verificar          # lint, typecheck, test and build — the same the CI runs')
  eco('  npm run dev')
  eco('')
  eco('  THE GENERATOR DOES NOT DO THESE, ON PURPOSE — they touch your account:')
  eco('   1. create the remote repository (gh repo create, or on the site) and push')
  // ONE COMMAND, and it is derived: `--corpo` prints the ruleset body built from
  // the check names this project's own workflow produces. The old version of
  // this line sent the owner to a settings page to retype two context strings by
  // hand, which is how a ruleset ends up requiring a check nobody runs.
  eco('   2. install the ruleset — the CI is a badge until somebody requires it:')
  eco(`        node ${REGISTRO_REMOTO.replace('.json', '.mjs')} --corpo \\`)
  eco('          | gh api --method POST repos/<owner>/<repo>/rulesets --input -')
  eco(`        node ${REGISTRO_REMOTO.replace('.json', '.mjs')} --gravar    # record the fact`)
  eco('   3. Settings › Pages › Source: GitHub Actions, if this site is going live.')
  eco('   4. check .rebar-coauthors: the git identity of this machine went in.')
  eco('')
  // Declared instead of deleted: they are THIRD-PARTY folders and the name
  // pattern may change on their next release. Blindly deleting a `shadcn-*` in
  // the tmpdir is deleting what we do not know. But the owner will see the trash
  // and attribute it to the generator, so the honest thing is to say whose it is.
  eco('  `shadcn create` leaves 2 `shadcn-*` directories in your Temp per run.')
  eco('  It is their trash, not rebar, and it goes away with a temp cleanup.')
  eco('')

  if (avisos.length) {
    eco('  WARNINGS:')
    for (const a of avisos) eco(`   · ${a}`)
    eco('')
  }

  // The generator's exit is the ruler's exit, and a warning drops it too. A
  // generated project that does not pass its own ruler cannot exit 0: that would
  // be the generator approving the debt it just manufactured. And a project
  // delivered half-done — no commit, no executable hook — exits 1 even with a
  // green ruler, because the ruler has no rule for what has not happened yet.
  const codigo = placar !== 0 ? placar || 1 : avisos.length ? 1 : 0
  eco(
    `  ruler: exit ${placar}` +
      (placar === 0 ? ' — passed' : ' — did NOT pass, read the scoreboard above'),
  )
  eco(
    `  generator: exit ${codigo}` +
      (codigo === 0
        ? ' — project complete'
        : placar !== 0
          ? ' — the ruler failed it'
          : ' — the ruler passed, but there is a warning above that needs a hand'),
  )
  eco('')

  return codigo
}

process.exit(await main(process.argv.slice(2)))
