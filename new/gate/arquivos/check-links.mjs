#!/usr/bin/env node
// Every relative link and every image of this project's Markdown resolves — and
// resolves IN THE REPOSITORY, which is not the same as resolving on your disk.
//
// WHERE THIS CAME FROM. rebar has had `tooling/links/check-links.mjs` since PR
// #24, whose title is the whole reason: "o README tinha dois badges saindo como
// texto, e eu nunca olhei a página" [the README had two badges coming out as
// text, and I never looked at the page]. That checker never came down into the
// generated projects, so every project born from this generator shipped with a
// README nobody had ever verified.
//
// TWO THINGS ARE CHECKED HERE THAT THE REBAR ONE DOES NOT CHECK, and both are
// about the difference between a repository and a working copy:
//
//   IMAGES COUNT. The rebar version skips `![...]` on purpose — over there the
//   product is prose and an image is decoration. Here the README is the front
//   page of a public repository, and a broken image is what the visitor sees
//   first. It is the same defect as a broken link, one line higher on the page.
//
//   THE TARGET HAS TO BE TRACKED BY GIT, not merely present on the disk. This is
//   the failure this file exists for: GitHub renders the README from the
//   REPOSITORY. A screenshot that was generated, referenced and never committed
//   — or one that landed under a path .gitignore covers, which is exactly what
//   happens to anything under `/out` — is on your machine, renders fine in your
//   editor, and comes out as a broken image icon for everybody else. `existsSync`
//   would call that verified.
//
// Zero dependencies.  node .rebar/check-links.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))

// rev-parse from the SCRIPT'S OWN directory and not from the cwd, for the same
// reason as `.githooks/install.mjs`: the repository being read has to be the
// repository where this file lives.
const RAIZ = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: AQUI,
  encoding: 'utf8',
}).trim()

/**
 * Everything git tracks, as a Set of repo-relative paths with forward slashes.
 *
 * `-z` is mandatory and not a nicety: without it git C-quotes any path with an
 * accent — and this project writes in Portuguese — so `documentação.md` comes
 * back escaped, never matches, and the step reports it checked a file it never
 * opened. Same hole as HOLE 7 in .githooks/scan-secret.mjs.
 */
function rastreados(padrao) {
  const args = ['ls-files', '-z']
  if (padrao) args.push(padrao)
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
}

const noIndice = new Set(rastreados())
const documentos = rastreados('*.md')

/**
 * On the disk but not in the index — the distinction that makes the message
 * useful. That case is one `git add` away; a target that is nowhere is a
 * different fix, and saying which one is half the job.
 */
function existeNoDisco(relativo) {
  try {
    readFileSync(join(RAIZ, ...relativo.split('/')))
    return true
  } catch {
    return false
  }
}

// [text](target) and ![alt](target). The optional title in quotes is part of the
// syntax and is not part of the path.
const ALVO = /(!)?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

const quebrados = []

for (const documento of documentos) {
  const linhas = readFileSync(join(RAIZ, ...documento.split('/')), 'utf8').split('\n')

  let dentroDeBloco = false
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    // A fenced block is example text, not a reference. Checking inside it turns
    // every tutorial that shows a path into a false failure, and a checker that
    // cries wolf is a checker somebody switches off.
    if (/^\s*```/.test(linha)) dentroDeBloco = !dentroDeBloco
    if (dentroDeBloco) continue

    for (const achado of linha.matchAll(ALVO)) {
      const imagem = Boolean(achado[1])
      const destino = achado[2]
      // Absolute, mail and same-page anchors are somebody else's to resolve.
      if (/^(https?:|mailto:|#|\/)/.test(destino)) continue

      const semAncora = destino.split('#')[0]
      if (!semAncora) continue

      // posix.normalize and not path.normalize: the index speaks forward slashes
      // on both systems, and normalizing with `\` on Windows produces a key that
      // never matches — a checker that passes everything, silently.
      const alvo = posix.normalize(
        posix.join(posix.dirname(documento), decodeURIComponent(semAncora)),
      )
      if (noIndice.has(alvo)) continue
      // A link to a directory is legitimate on GitHub; the index has no entry
      // for a folder, so it is proved by having something under it.
      if (!imagem && [...noIndice].some((a) => a.startsWith(`${alvo}/`))) continue

      quebrados.push({
        documento,
        linha: i + 1,
        destino,
        tipo: imagem ? 'image' : 'link',
        noDisco: existeNoDisco(alvo),
      })
    }
  }
}

if (quebrados.length === 0) {
  console.log(`[links] ${documentos.length} document(s), no broken relative link or image.`)
  process.exit(0)
}

console.error(`\n[links] ${quebrados.length} broken reference(s):\n`)
for (const q of quebrados) {
  const causa = q.noDisco
    ? 'on your disk and NOT in the repository — it renders here and breaks on GitHub'
    : 'does not exist'
  console.error(`  error  ${q.documento}:${q.linha}  ${q.tipo} ${q.destino} — ${causa}`)
}
console.error('')
console.error('  GitHub renders these documents from the REPOSITORY, not from your working copy.')
console.error('  If the file is only on the disk, it is one `git add` away from being real.')
console.error('')
process.exit(1)
