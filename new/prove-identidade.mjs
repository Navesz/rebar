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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ambienteDeIdentidade } from './identidade.mjs'

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
