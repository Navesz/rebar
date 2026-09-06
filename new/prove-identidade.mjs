// A PROVA DA PRECEDÊNCIA — feita contra o git, não contra a documentação dele.
//
// P2 #13. O gerador escrevia a identidade no NOTICE e na allowlist e commitava
// com `-c user.name=… -c user.email=…`, achando que isso fixava o autor. O
// comentário lá dizia: "Sem isto, uma máquina com config global e GIT_AUTHOR_*
// divergentes escreveria um nome no arquivo e outro no histórico". Estava
// invertido — no git a variável de ambiente GANHA da config, e `-c` é config.
//
// O primeiro caso aqui embaixo é o que mede isso, e ele NÃO exercita o conserto:
// ele mede o git puro. Se um dia a precedência do git mudar, é ele que avisa, e
// o resto deste arquivo passa a ser desnecessário em vez de silenciosamente
// errado.
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

/** Um repositório com um arquivo em stage, pronto para receber um commit. */
function repoPronto() {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-ident-'))
  const vazio = join(dir, 'git-config-vazio')
  writeFileSync(vazio, '', 'utf8')
  // Config global e de sistema fora do caminho: a identidade da máquina de quem
  // roda a prova decidiria o resultado.
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
  // A config LOCAL do repositório é o que o gerador leria com `configGit`, e é
  // o que ele escreve nos arquivos.
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

test('A PRECEDÊNCIA, medida no git: GIT_AUTHOR_* ganha de `-c user.*`', () => {
  // Este caso NÃO usa o conserto. Ele mede o git, e é a premissa de tudo o que
  // vem depois: se ele parar de valer, o resto vira desnecessário em vez de
  // errado em silêncio.
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
      'se o `-c` ganhasse, o gerador antigo estaria certo e este conserto seria desnecessário',
    )
  } finally {
    r.fim()
  }
})

test('O CONSERTO · o commit sai com a identidade dos ARQUIVOS, apesar do ambiente', () => {
  const r = repoPronto()
  try {
    // A máquina hostil: config local dizendo uma coisa, ambiente dizendo outra.
    // É a situação de runner de CI e de container, que é onde o gerador roda.
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

test('o committer também, porque o histórico guarda os dois', () => {
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

test('sem ambiente hostil nada muda — o conserto não inventa identidade', () => {
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

test('`process.env` não é mutado — a identidade não vaza para os outros filhos', () => {
  const antes = process.env.GIT_AUTHOR_EMAIL
  ambienteDeIdentidade('Alguém', 'alguem@exemplo.com')
  assert.equal(process.env.GIT_AUTHOR_EMAIL, antes)
})
