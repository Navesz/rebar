#!/usr/bin/env node
// The proofs of the secret scanner — by DETECTION, not by execution.
//
// WHY THIS FILE EXISTS, and it is a lesson that cost a P1 from an external
// audit. The gate's `secret` step is of the `comando:` kind, and the note in
// `prove-steps.mjs` says that a step like that "already proves itself: if the
// script it calls disappears or breaks, the step falls". True, and not enough:
// it proves the scanner RUNS, never that it FINDS.
//
// The hole that went underneath that: the same synthetic token in two files in
// the index, one UTF-8 and the other UTF-16LE with BOM. The first was found, the
// second passed — exit 0, zero findings, and the file still counted as "binary
// scanned", so that the silence looked like coverage. The `secret` step stayed
// green the whole run.
//
// Every test here is a detection that has to happen, or a false positive that
// cannot happen. None uses a real credential: the tokens are synthetic, with the
// vendor prefix and the right length, which is what the rules read.
//
// Usage:  node --test tooling/secret/prove-scan.mjs

import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test, { describe } from 'node:test'

const AQUI = dirname(fileURLToPath(import.meta.url))
const VARREDOR = join(AQUI, 'scan-secret.mjs')

// SYNTHETIC token. Prefix and length are what the `github-token` rule reads;
// the guts are a keyboard sequence, nobody's credential.
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const LINHA = `$Token = "${TOKEN}"`

/**
 * Builds a miniature repository, puts the files in the INDEX and runs
 * `--staged`. Index and not disk because that is how the hook calls it, and
 * because this scanner's own earlier audit found the case where the two
 * diverged.
 */
async function comArquivos(arquivos) {
  const dir = await mkdtemp(join(tmpdir(), 'rebar-secret-'))
  try {
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
    git('init', '-q')
    git('config', 'user.email', 'prova@rebar.local')
    git('config', 'user.name', 'Prova')
    for (const [rel, conteudo] of Object.entries(arquivos)) {
      const abs = join(dir, rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, conteudo)
    }
    git('add', '-A')
    let saida = ''
    let codigo = 0
    try {
      saida = execFileSync(process.execPath, [VARREDOR, '--staged'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
      })
    } catch (e) {
      saida = `${e.stdout ?? ''}${e.stderr ?? ''}`
      codigo = e.status ?? 1
    }
    return { saida, codigo }
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

describe('the secret scanner · encoding', { concurrency: 4 }, () => {
  test('FINDS · token in UTF-8', async () => {
    const r = await comArquivos({ 'config.ps1': Buffer.from(LINHA, 'utf8') })
    assert.notEqual(r.codigo, 0, `token in UTF-8 passed clean:\n${r.saida}`)
    assert.match(r.saida, /github-token/)
  })

  // THE P1 CASE. Before the fix: exit 0, zero findings, and the file counted as
  // a scanned binary. If `decodificar()` disappears, this test goes back to red
  // and says exactly what started passing again.
  test('FINDS · the SAME token in UTF-16LE with BOM', async () => {
    const r = await comArquivos({ 'config.ps1': Buffer.from('﻿' + LINHA, 'utf16le') })
    assert.notEqual(r.codigo, 0, `token in UTF-16LE passed clean — the P1 is back:\n${r.saida}`)
    assert.match(r.saida, /github-token/)
  })

  test('FINDS · the SAME token in UTF-16BE with BOM', async () => {
    const bruto = Buffer.from('﻿' + LINHA, 'utf16le')
    bruto.swap16()
    const r = await comArquivos({ 'config.ps1': bruto })
    assert.notEqual(r.codigo, 0, `token in UTF-16BE passed clean:\n${r.saida}`)
    assert.match(r.saida, /github-token/)
  })

  test('FINDS · token in UTF-8 with BOM, and the column does not shift', async () => {
    const r = await comArquivos({ 'config.ts': Buffer.from('﻿' + LINHA, 'utf8') })
    assert.notEqual(r.codigo, 0, `token in UTF-8 with BOM passed clean:\n${r.saida}`)
    // The column is the same as in the file without a BOM: the BOM is consumed,
    // not counted.
    assert.match(r.saida, /config\.ts:1:11/)
  })

  test('DOES NOT ACCUSE · an honest file, in the same encodings', async () => {
    const limpo = '$Url = "https://api.github.com"\n$Retries = 3\n'
    const r = await comArquivos({
      'a.ps1': Buffer.from(limpo, 'utf8'),
      'b.ps1': Buffer.from('﻿' + limpo, 'utf16le'),
    })
    assert.equal(r.codigo, 0, `a file with no secret was accused:\n${r.saida}`)
  })

  test('COUNTS · a real binary still goes down the binary path', async () => {
    // Minimal PNG: NUL bytes without a BOM. It does not become text, and the
    // report has to say it went through there — absent coverage that declares
    // itself is different from faked coverage, which was the UTF-16 defect.
    //
    // The literal follows the summary line printed by scan-secret.mjs. If that
    // wording changes, this match has to change with it.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
    const r = await comArquivos({ 'i.png': png })
    assert.match(r.saida, /binary file\(s\)/)
  })
})
