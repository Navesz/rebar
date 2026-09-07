#!/usr/bin/env node
// Checks that every relative link between Markdown files resolves.
//
// In a repository whose product is the manual, a broken link is the equivalent of
// a broken import: the AI follows the reference, does not find it, and rebuilds
// from scratch what was already written — paying context for information that
// already existed.
//
// Zero dependencies. Usage: node tooling/links/check-links.mjs [root]

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'

const raiz = resolve(process.argv[2] ?? process.cwd())

// Only what Git tracks: an ignored file is not part of the product.
// `-z` is mandatory: without it a document with an accent in its name comes back
// C-quoted, the read fails, and the step says it checked the links of a file it
// never opened. See HOLE 7 in tooling/secret/scan-secret.mjs.
//
// No `.trim()` either: with `-z` there is no line break to trim, and trimming
// would erase a space that is part of the name.
const arquivos = execFileSync('git', ['ls-files', '-z', '*.md'], {
  cwd: raiz,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)

// [text](target) — ignores images (![...]) and absolute links.
const LINK = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

const quebrados = []

for (const relativo of arquivos) {
  const absoluto = join(raiz, relativo)
  const linhas = readFileSync(absoluto, 'utf8').split('\n')

  let dentroDeBloco = false
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    if (/^\s*```/.test(linha)) dentroDeBloco = !dentroDeBloco
    if (dentroDeBloco) continue

    for (const achado of linha.matchAll(LINK)) {
      const destino = achado[1]
      if (/^(https?:|mailto:|#)/.test(destino)) continue

      // An anchor inside the target file is not verified: only its existence.
      const semAncora = destino.split('#')[0]
      if (!semAncora) continue

      const alvo = normalize(join(dirname(absoluto), decodeURIComponent(semAncora)))
      if (!existsSync(alvo)) {
        quebrados.push({ arquivo: relativo, linha: i + 1, destino })
      }
    }
  }
}

if (quebrados.length === 0) {
  console.log(`[links] ${arquivos.length} files, no broken relative link.`)
  process.exit(0)
}

console.error(`\n[links] ${quebrados.length} broken link(s):\n`)
for (const q of quebrados) {
  console.error(`  error  ${q.arquivo}:${q.linha}  target does not exist: ${q.destino}`)
}
console.error('')
process.exit(1)
