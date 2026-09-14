// THE PROOF OF PRECEDENCE — made against git, not against git's documentation.
//
// P2 #13. The generator wrote the identity into the NOTICE and into the
// allowlist and committed with `-c user.name=… -c user.email=…`, thinking that
// pinned the author. The comment over there said: "Sem isto, uma máquina com
// config global e GIT_AUTHOR_* divergentes escreveria um nome no arquivo e outro
// no histórico" [without this, a machine with a global config and diverging
// GIT_AUTHOR_* would write one name into the file and another into the history].
// It was backwards — in git the environment variable BEATS the config, and `-c`
// is config.
//
// The first case down below is the one that measures this, and it does NOT
// exercise the fix: it measures plain git. If git's precedence ever changes, it
// is the one that warns, and the rest of this file becomes unnecessary instead
// of silently wrong.
//
//   node --test new/prove-identidade.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ambienteDeIdentidade, commitDoRebar } from './identidade.mjs'

const DOS_ARQUIVOS = { nome: 'Dona Do Projeto', email: 'dona@projeto.exemplo' }
const DO_AMBIENTE = { nome: 'Outra Pessoa', email: 'outra@maquina.exemplo' }

/** A repository with one file staged, ready to take a commit. */
function repoPronto() {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-ident-'))
  const vazio = join(dir, 'git-config-vazio')
  writeFileSync(vazio, '', 'utf8')
  // Global and system config out of the way: the identity of the machine
  // running the proof would decide the result.
  const limpo = { ...process.env, GIT_CONFIG_GLOBAL: vazio, GIT_CONFIG_SYSTEM: vazio }
  for (const k of [
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'GIT_COMMITTER_NAME',
    'GIT_COMMITTER_EMAIL',
  ])
    delete limpo[k]

  const rodar = (args, env = limpo) =>
    spawnSync('git', args, { cwd: dir, encoding: 'utf8', env, windowsHide: true })

  rodar(['init', '-q'])
  // The repository's LOCAL config is what the generator would read with
  // `configGit`, and it is what it writes into the files.
  rodar(['config', 'user.name', DOS_ARQUIVOS.nome])
  rodar(['config', 'user.email', DOS_ARQUIVOS.email])
  writeFileSync(join(dir, 'LEIAME.md'), '# projeto\n', 'utf8')
  rodar(['add', '-A'])

  return {
    dir,
    limpo,
    rodar,
    autorDoUltimoCommit: () => rodar(['log', '-1', '--format=%an <%ae>']).stdout.trim(),
    fim: () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }),
  }
}

const ARGS_DO_COMMIT = (nome, email) => [
  '-c',
  `user.name=${nome}`,
  '-c',
  `user.email=${email}`,
  'commit',
  '-q',
  '-m',
  'primeiro commit',
]

test('THE PRECEDENCE, measured in git: GIT_AUTHOR_* beats `-c user.*`', () => {
  // This case does NOT use the fix. It measures git, and it is the premise of
  // everything that comes after: if it stops holding, the rest turns
  // unnecessary instead of wrong in silence.
  const r = repoPronto()
  try {
    const comAmbienteDivergente = {
      ...r.limpo,
      GIT_AUTHOR_NAME: DO_AMBIENTE.nome,
      GIT_AUTHOR_EMAIL: DO_AMBIENTE.email,
    }
    r.rodar(ARGS_DO_COMMIT(DOS_ARQUIVOS.nome, DOS_ARQUIVOS.email), comAmbienteDivergente)
    assert.equal(
      r.autorDoUltimoCommit(),
      `${DO_AMBIENTE.nome} <${DO_AMBIENTE.email}>`,
      'if `-c` won, the old generator would be right and this fix would be unnecessary',
    )
  } finally {
    r.fim()
  }
})

test('THE FIX · the commit comes out with the identity from the FILES, despite the environment', () => {
  const r = repoPronto()
  try {
    // The hostile machine: local config saying one thing, environment saying
    // another. It is the situation of a CI runner and of a container, which is
    // where the generator runs.
    const maquina = {
      ...r.limpo,
      GIT_AUTHOR_NAME: DO_AMBIENTE.nome,
      GIT_AUTHOR_EMAIL: DO_AMBIENTE.email,
      GIT_COMMITTER_NAME: DO_AMBIENTE.nome,
      GIT_COMMITTER_EMAIL: DO_AMBIENTE.email,
    }
    r.rodar(
      ARGS_DO_COMMIT(DOS_ARQUIVOS.nome, DOS_ARQUIVOS.email),
      ambienteDeIdentidade(DOS_ARQUIVOS.nome, DOS_ARQUIVOS.email, maquina),
    )
    assert.equal(r.autorDoUltimoCommit(), `${DOS_ARQUIVOS.nome} <${DOS_ARQUIVOS.email}>`)
  } finally {
    r.fim()
  }
})

test('the committer too, because the history keeps both', () => {
  const r = repoPronto()
  try {
    const maquina = { ...r.limpo, GIT_COMMITTER_EMAIL: DO_AMBIENTE.email }
    r.rodar(
      ARGS_DO_COMMIT(DOS_ARQUIVOS.nome, DOS_ARQUIVOS.email),
      ambienteDeIdentidade(DOS_ARQUIVOS.nome, DOS_ARQUIVOS.email, maquina),
    )
    assert.equal(
      r.rodar(['log', '-1', '--format=%cn <%ce>']).stdout.trim(),
      `${DOS_ARQUIVOS.nome} <${DOS_ARQUIVOS.email}>`,
    )
  } finally {
    r.fim()
  }
})

test('with no hostile environment nothing changes — the fix does not invent an identity', () => {
  const r = repoPronto()
  try {
    r.rodar(
      ARGS_DO_COMMIT(DOS_ARQUIVOS.nome, DOS_ARQUIVOS.email),
      ambienteDeIdentidade(DOS_ARQUIVOS.nome, DOS_ARQUIVOS.email, r.limpo),
    )
    assert.equal(r.autorDoUltimoCommit(), `${DOS_ARQUIVOS.nome} <${DOS_ARQUIVOS.email}>`)
  } finally {
    r.fim()
  }
})

test('`process.env` is not mutated — the identity does not leak into the other children', () => {
  const antes = process.env.GIT_AUTHOR_EMAIL
  ambienteDeIdentidade('Alguém', 'alguem@exemplo.com')
  assert.equal(process.env.GIT_AUTHOR_EMAIL, antes)
})

// ─────────────────────────────────────────── the rebar commit the project pins
//
// `commitDoRebar` answers which rebar commit is RUNNING, from the two layouts
// measured on 2026-09-13: a git checkout, and npx over the commit tarball or the
// git spec (npm 10 and 11 both leave `_npx/<hash>/package-lock.json` and
// `node_modules/.package-lock.json`, whose `resolved` names the commit). The
// lock fixtures below copy the shape of those files; the real npm 11.6.2 run
// over 134f112 resolved from `node_modules/.package-lock.json` in 150 ms.

const COMMIT = 'a'.repeat(40)

function pastaTemporaria() {
  return mkdtempSync(join(tmpdir(), 'rebar-commit-'))
}

/** A rebar-shaped git repository with one commit; returns its dir, HEAD and a git runner. */
function checkoutDoRebar() {
  const r = repoPronto()
  mkdirSync(join(r.dir, 'new'), { recursive: true })
  writeFileSync(join(r.dir, 'new', 'index.mjs'), '// gerador\n', 'utf8')
  r.rodar(['add', '-A'])
  r.rodar(['commit', '-q', '-m', 'primeiro commit'])
  return { ...r, cabeca: r.rodar(['rev-parse', 'HEAD']).stdout.trim() }
}

/** `_npx/<hash>/node_modules/rebar` with the given lock files. */
function instalacaoNpx(resolved, { lock = true, oculto = true } = {}) {
  const base = pastaTemporaria()
  const npx = join(base, '_npx', 'fbcce5f66646c6b6')
  const raiz = join(npx, 'node_modules', 'rebar')
  mkdirSync(raiz, { recursive: true })
  writeFileSync(join(raiz, 'package.json'), '{"name":"rebar"}\n', 'utf8')
  const conteudo = JSON.stringify({
    name: 'fbcce5f66646c6b6',
    lockfileVersion: 3,
    packages: { 'node_modules/rebar': { resolved } },
  })
  if (lock) writeFileSync(join(npx, 'package-lock.json'), conteudo, 'utf8')
  if (oculto) writeFileSync(join(npx, 'node_modules', '.package-lock.json'), conteudo, 'utf8')
  return {
    raiz,
    fim: () => rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }),
  }
}

test('commitDoRebar · a git checkout pins its HEAD', () => {
  const r = checkoutDoRebar()
  try {
    const c = commitDoRebar(r.dir)
    assert.equal(c.fonte, 'git')
    assert.equal(c.sha, r.cabeca)
    assert.equal(c.sujo, false)
  } finally {
    r.fim()
  }
})

test('commitDoRebar · a tracked change under new/ is reported as dirty', () => {
  const r = checkoutDoRebar()
  try {
    writeFileSync(join(r.dir, 'new', 'index.mjs'), '// gerador mudado\n', 'utf8')
    assert.equal(commitDoRebar(r.dir).sujo, true)
  } finally {
    r.fim()
  }
})

test('commitDoRebar · a folder inside another repository does not take the parent HEAD', () => {
  const r = checkoutDoRebar()
  try {
    const dentro = join(r.dir, 'vendor', 'rebar')
    mkdirSync(dentro, { recursive: true })
    const c = commitDoRebar(dentro)
    assert.equal(c.sha, null, `took ${c.sha} from the repository around it`)
    assert.ok(c.motivo)
  } finally {
    r.fim()
  }
})

test('commitDoRebar · an exported GIT_DIR of another repository is not followed', () => {
  const r = checkoutDoRebar()
  const outro = checkoutDoRebar()
  const antes = process.env.GIT_DIR
  try {
    process.env.GIT_DIR = join(outro.dir, '.git')
    assert.equal(commitDoRebar(r.dir).sha, r.cabeca)
  } finally {
    if (antes === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = antes
    r.fim()
    outro.fim()
  }
})

test('commitDoRebar · npx over the commit tarball, from package-lock.json', () => {
  const i = instalacaoNpx(`https://codeload.github.com/Navesz/rebar/tar.gz/${COMMIT}`, {
    oculto: false,
  })
  try {
    const c = commitDoRebar(i.raiz)
    assert.equal(c.sha, COMMIT)
    assert.match(c.fonte, /package-lock\.json → node_modules\/rebar/)
  } finally {
    i.fim()
  }
})

test('commitDoRebar · npx, from node_modules/.package-lock.json alone', () => {
  const i = instalacaoNpx(`https://codeload.github.com/Navesz/rebar/tar.gz/${COMMIT}`, {
    lock: false,
  })
  try {
    assert.equal(commitDoRebar(i.raiz).sha, COMMIT)
  } finally {
    i.fim()
  }
})

test('commitDoRebar · npx over the git spec, as npm 11 records it', () => {
  const i = instalacaoNpx(`git+ssh://git@github.com/Navesz/rebar.git#${COMMIT}`)
  try {
    assert.equal(commitDoRebar(i.raiz).sha, COMMIT)
  } finally {
    i.fim()
  }
})

test('commitDoRebar · a lock that resolves to another repository pins nothing', () => {
  const i = instalacaoNpx(`https://codeload.github.com/Outro/rebar/tar.gz/${COMMIT}`)
  try {
    const c = commitDoRebar(i.raiz)
    assert.equal(c.sha, null)
    assert.match(c.motivo, /not a Navesz\/rebar commit/)
  } finally {
    i.fim()
  }
})

test('commitDoRebar · no checkout and no lock pins nothing, and says why', () => {
  const base = pastaTemporaria()
  try {
    const c = commitDoRebar(base)
    assert.equal(c.sha, null)
    assert.match(c.motivo, /no git checkout and no npm lock/)
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
})
