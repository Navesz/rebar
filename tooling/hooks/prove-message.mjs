// THE PROOF OF THE MESSAGE HOOK — the N5 co-authorship gate, actually exercised.
//
// It is the only barrier that stops the co-authorship trailer from EXISTING. The
// others (`rebar-check`, the CI) audit afterwards, and afterwards is too late: a
// trailer in history is not fixed by a new commit.
//
// Until 2026-09-06 nothing ran it. The gate's `hooks` step checks that the files
// are there and are executable; the `ai-coauthorship__allowlist` case proves the
// RULE that audits history, not this hook.
//
// WHAT GOT THROUGH BECAUSE OF THAT (P2 #8): it read the allowlist from DISK. The
// comment justified it — "demanding that it already be in HEAD would make the
// commit that ADDS a human to the list impossible" — and the reason holds; the
// source is what was wrong. Between HEAD and the disk there is the INDEX, which
// is literally what goes into this commit. Reading from disk authorized a
// co-author by a file that was never tracked, and by a line added, used and
// undone.
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
 * A real repository in a tmpdir. Real `git`, because the hook uses
 * `interpret-trailers` and `show :file` — reimplementing that inside the proof
 * would be proving the reimplementation.
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
    /** Writes to disk. Alone it puts nothing in the index — that is the point. */
    escrever(rel, texto) {
      writeFileSync(join(dir, rel), texto, 'utf8')
    },
    preparar(rel) {
      git('add', '--', rel)
    },
    /** Runs the hook over a message, the way `commit-msg` would. */
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

const comCoautor = (email) => `some commit\n\nCo-authored-by: Someone <${email}>\n`

test('with no co-authorship trailer the hook has nothing to say', () => {
  const r = repo()
  try {
    assert.equal(r.checar('some commit\n').status, 0)
  } finally {
    r.fim()
  }
})

test('a STAGED allowlist authorizes — including in the commit that creates it', () => {
  // It is the legitimate case that reading from disk existed to serve, and that
  // reading the index serves just as well: the addition is staged, so it counts,
  // without having to be in HEAD already.
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

test('whoever is not in the allowlist stays blocked', () => {
  const r = repo()
  try {
    r.escrever(ALLOWLIST, `${HUMANO}\n`)
    r.preparar(ALLOWLIST)
    const saida = r.checar(comCoautor(AGENTE))
    assert.notEqual(saida.status, 0)
    assert.match(saida.saida, /outside the human allowlist/)
  } finally {
    r.fim()
  }
})

test('AN UNTRACKED ALLOWLIST AUTHORIZES NOBODY', () => {
  // The first hole. A `.rebar-coauthors` that never entered the repository
  // cleared a co-author, and showed up in no review at all: whoever clones does
  // not see it and history does not have it.
  const r = repo()
  try {
    r.escrever(ALLOWLIST, `${AGENTE}\n`)
    // on purpose: do NOT stage it
    const saida = r.checar(comCoautor(AGENTE))
    assert.notEqual(saida.status, 0, 'a file only on disk cannot count as an allowlist')
    // And the message has to say what to do, because forgetting the `git add` is
    // the most likely honest mistake here.
    assert.match(saida.saida, /is NOT staged/)
    assert.match(saida.saida, /git add/)
  } finally {
    r.fim()
  }
})

test('A LINE ADDED ONLY ON DISK AUTHORIZES NOBODY', () => {
  // The second hole, and the worse one: add the e-mail on disk, commit with the
  // co-author, undo the line. The commit passed and the repository never had the
  // line — the trailer stayed in history with nothing justifying it.
  const r = repo()
  try {
    r.escrever(ALLOWLIST, `${HUMANO}\n`)
    r.preparar(ALLOWLIST)
    r.escrever(ALLOWLIST, `${HUMANO}\n${AGENTE}\n`) // on disk, outside the index
    const saida = r.checar(comCoautor(AGENTE))
    assert.notEqual(saida.status, 0, 'the index version is what decides, not the disk one')
    assert.match(saida.saida, /outside the human allowlist/)
  } finally {
    r.fim()
  }
})

test('with no allowlist at all, no co-author passes — fail-closed', () => {
  const r = repo()
  try {
    const saida = r.checar(comCoautor(HUMANO))
    assert.notEqual(saida.status, 0)
    assert.match(saida.saida, /is not in the git index/)
  } finally {
    r.fim()
  }
})
