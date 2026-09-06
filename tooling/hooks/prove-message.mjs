// A PROVA DO HOOK DE MENSAGEM — a porta N5 da coautoria, exercitada de verdade.
//
// Ele é a única barreira que impede o trailer de coautoria de EXISTIR. As
// outras (`rebar-check`, o CI) auditam depois, e depois é tarde: trailer no
// histórico não se conserta com commit novo.
//
// Até 2026-09-06 nada o executava. O passo `hooks` do portão confere que os
// arquivos estão lá e são executáveis; o caso `ai-coauthorship__allowlist`
// prova a REGRA que audita o histórico, não este hook.
//
// O QUE ESCAPOU POR ISSO (P2 #8): ele lia a allowlist do DISCO. O comentário
// justificava — "exigir que ela já esteja em HEAD tornaria impossível o commit
// que ADICIONA um humano à lista" — e o motivo procede; a fonte é que estava
// errada. Entre HEAD e o disco existe o ÍNDICE, que é literalmente o que vai
// entrar neste commit. Ler do disco autorizava coautor por um arquivo nunca
// rastreado, e por uma linha acrescentada, usada e desfeita.
//
//   node --test tooling/hooks/prove-message.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const HOOK = join(AQUI, 'check-message.mjs')
const ALLOWLIST = '.rebar-coauthors'
const HUMANO = 'pessoa@exemplo.com'
const AGENTE = 'noreply@algum-agente.example'

/**
 * Um repositório de verdade num tmpdir. `git` de verdade porque o hook usa
 * `interpret-trailers` e `show :arquivo` — reimplementar isso na prova seria
 * provar a reimplementação.
 */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-msg-'))
  const vazio = join(dir, 'git-config-vazio')
  writeFileSync(vazio, '', 'utf8')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: vazio, GIT_CONFIG_SYSTEM: vazio }
  const git = (...args) =>
    spawnSync('git', args, { cwd: dir, encoding: 'utf8', env, windowsHide: true })

  git('init', '-q')
  git('config', 'user.email', 'dono@exemplo.com')
  git('config', 'user.name', 'dono')

  return {
    dir,
    env,
    git,
    /** Escreve no disco. Sozinho não coloca nada no índice — é esse o ponto. */
    escrever(rel, texto) {
      writeFileSync(join(dir, rel), texto, 'utf8')
    },
    preparar(rel) {
      git('add', '--', rel)
    },
    /** Roda o hook sobre uma mensagem, como o `commit-msg` faria. */
    checar(mensagem) {
      const arquivo = join(dir, 'MENSAGEM')
      writeFileSync(arquivo, mensagem, 'utf8')
      const r = spawnSync(process.execPath, [HOOK, arquivo], {
        cwd: dir,
        encoding: 'utf8',
        env,
        windowsHide: true,
      })
      return { status: r.status, saida: `${r.stdout}${r.stderr}` }
    },
    fim() {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    },
  }
}

const comCoautor = (email) => `um commit qualquer\n\nCo-authored-by: Alguém <${email}>\n`

test('sem trailer de coautoria o hook não tem o que dizer', () => {
  const r = repo()
  try {
    assert.equal(r.checar('um commit qualquer\n').status, 0)
  } finally {
    r.fim()
  }
})

test('allowlist EM STAGE autoriza — inclusive no commit que a cria', () => {
  // É o caso legítimo que a leitura do disco existia para atender, e que a
  // leitura do índice atende igual: a adição está preparada, então vale, sem
  // precisar já estar em HEAD.
  const r = repo()
  try {
    r.escrever(ALLOWLIST, `${HUMANO}\n`)
    r.preparar(ALLOWLIST)
    const saida = r.checar(comCoautor(HUMANO))
    assert.equal(saida.status, 0, saida.saida)
  } finally {
    r.fim()
  }
})

test('quem não está na allowlist continua barrado', () => {
  const r = repo()
  try {
    r.escrever(ALLOWLIST, `${HUMANO}\n`)
    r.preparar(ALLOWLIST)
    const saida = r.checar(comCoautor(AGENTE))
    assert.notEqual(saida.status, 0)
    assert.match(saida.saida, /fora da allowlist/)
  } finally {
    r.fim()
  }
})

test('ALLOWLIST NÃO RASTREADA NÃO AUTORIZA NINGUÉM', () => {
  // O primeiro buraco. Um `.rebar-coauthors` que nunca entrou no repositório
  // liberava coautor, e não aparecia em revisão nenhuma: quem clona não o vê e
  // o histórico não o tem.
  const r = repo()
  try {
    r.escrever(ALLOWLIST, `${AGENTE}\n`)
    // de propósito: NÃO preparar
    const saida = r.checar(comCoautor(AGENTE))
    assert.notEqual(saida.status, 0, 'arquivo só no disco não pode valer como allowlist')
    // E a mensagem tem de dizer o que fazer, porque esquecer o `git add` é o
    // engano honesto mais provável aqui.
    assert.match(saida.saida, /NÃO está em stage/)
    assert.match(saida.saida, /git add/)
  } finally {
    r.fim()
  }
})

test('LINHA ACRESCENTADA SÓ NO DISCO NÃO AUTORIZA', () => {
  // O segundo buraco, e o pior: acrescenta o e-mail no disco, comita com o
  // coautor, desfaz a linha. O commit passava e o repositório nunca teve a
  // linha — o trailer ficava no histórico sem nada que o justificasse.
  const r = repo()
  try {
    r.escrever(ALLOWLIST, `${HUMANO}\n`)
    r.preparar(ALLOWLIST)
    r.escrever(ALLOWLIST, `${HUMANO}\n${AGENTE}\n`) // no disco, fora do índice
    const saida = r.checar(comCoautor(AGENTE))
    assert.notEqual(saida.status, 0, 'a versão do índice é que decide, não a do disco')
    assert.match(saida.saida, /fora da allowlist/)
  } finally {
    r.fim()
  }
})

test('sem allowlist nenhuma, nenhum coautor passa — fail-closed', () => {
  const r = repo()
  try {
    const saida = r.checar(comCoautor(HUMANO))
    assert.notEqual(saida.status, 0)
    assert.match(saida.saida, /não está no índice/)
  } finally {
    r.fim()
  }
})
