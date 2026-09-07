#!/usr/bin/env node
// Installs the gate hooks into the current repository.
//
// Uses core.hooksPath instead of copying into .git/hooks: that way the hook is
// versioned, reviewed as code and updated along with the repository. A hook that
// lives only on the machine of whoever installed it exists for nobody else.
//
// Use:       node .githooks/install.mjs
// Uninstall: git config --unset core.hooksPath

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, not .pathname: on Windows the pathname comes as "/C:/Users/...",
// with a slash before the drive letter. readdirSync then looks in C:\C:\Users\...
// and the installer dies before configuring anything at all.
const DIRETORIO_HOOKS = dirname(fileURLToPath(import.meta.url))

// rev-parse from the SCRIPT'S OWN directory, not from the cwd: the repository
// that gets the hook has to be the repository where the hook lives. With cwd,
// running the installer from inside another clone would configure the wrong
// clone, in silence.
const RAIZ = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: DIRETORIO_HOOKS,
  encoding: 'utf8',
}).trim()

// git expects a forward slash in the config, Windows included.
const caminhoRelativo = relative(RAIZ, DIRETORIO_HOOKS).split(sep).join('/')

const jaConfigurado = (() => {
  try {
    return execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: RAIZ,
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
})()

if (jaConfigurado && jaConfigurado !== caminhoRelativo) {
  console.error(
    `core.hooksPath already points at "${jaConfigurado}".\n` +
      `I will not overwrite configuration that is not mine.\n` +
      `To switch it: git config core.hooksPath ${caminhoRelativo}`,
  )
  process.exit(1)
}

// .git/hooks with an active hook and core.hooksPath configured = the one in
// .git/hooks stops running, in silence. Better to warn than to leave someone
// thinking it runs.
const hooksAntigos = join(RAIZ, '.git', 'hooks')
if (existsSync(hooksAntigos)) {
  const ativos = readdirSync(hooksAntigos).filter((f) => !f.endsWith('.sample'))
  if (ativos.length) {
    console.warn(
      `Warning: .git/hooks has ${ativos.join(', ')}. With core.hooksPath, those stop running.`,
    )
  }
}

// The execute bit on DISK. The bit in git's INDEX is the generator's to
// guarantee, with `git update-index --chmod=+x`, because on Windows
// core.filemode is false and a local chmod never becomes mode 100755 in the
// commit.
for (const arquivo of readdirSync(DIRETORIO_HOOKS)) {
  if (arquivo.endsWith('.mjs') || arquivo.endsWith('.md')) continue
  chmodSync(join(DIRETORIO_HOOKS, arquivo), 0o755)
}

execFileSync('git', ['config', 'core.hooksPath', caminhoRelativo], { cwd: RAIZ })
console.log(`Hooks installed: core.hooksPath = ${caminhoRelativo}`)
console.log('Skip once: git commit --no-verify')
