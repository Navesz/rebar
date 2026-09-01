#!/usr/bin/env node
// Instala os hooks do portão no repositório atual.
//
// Usa core.hooksPath em vez de copiar para .git/hooks: assim o hook é
// versionado, revisado como código e atualiza junto com o repositório. Hook que
// mora só na máquina de quem instalou não existe para mais ninguém.
//
// Uso:        node .githooks/instalar.mjs
// Desinstala: git config --unset core.hooksPath

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, não .pathname: no Windows o pathname vem como "/C:/Users/...",
// com barra antes da letra do drive. readdirSync então procura em C:\C:\Users\...
// e o instalador morre antes de configurar coisa alguma.
const DIRETORIO_HOOKS = dirname(fileURLToPath(import.meta.url))

// rev-parse a partir do diretório do PRÓPRIO script, não do cwd: o repositório
// que recebe o hook tem de ser o repositório onde o hook mora. Com cwd, rodar o
// instalador de dentro de outro clone configuraria o clone errado, em silêncio.
const RAIZ = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: DIRETORIO_HOOKS,
  encoding: 'utf8',
}).trim()

// git espera barra normal na config, inclusive no Windows.
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
    `core.hooksPath já aponta para "${jaConfigurado}".\n` +
      `Não vou sobrescrever configuração que não é minha.\n` +
      `Se quiser trocar: git config core.hooksPath ${caminhoRelativo}`,
  )
  process.exit(1)
}

// .git/hooks com hook ativo e core.hooksPath configurado = o de .git/hooks para
// de rodar em silêncio. Melhor avisar do que deixar alguém achando que roda.
const hooksAntigos = join(RAIZ, '.git', 'hooks')
if (existsSync(hooksAntigos)) {
  const ativos = readdirSync(hooksAntigos).filter((f) => !f.endsWith('.sample'))
  if (ativos.length) {
    console.warn(
      `Aviso: .git/hooks tem ${ativos.join(', ')}. Com core.hooksPath, esses deixam de rodar.`,
    )
  }
}

// O bit de execução no DISCO. O bit no ÍNDICE do git quem garante é o gerador,
// com `git update-index --chmod=+x`, porque no Windows o core.filemode é false
// e um chmod local não chega a virar modo 100755 no commit.
for (const arquivo of readdirSync(DIRETORIO_HOOKS)) {
  if (arquivo.endsWith('.mjs') || arquivo.endsWith('.md')) continue
  chmodSync(join(DIRETORIO_HOOKS, arquivo), 0o755)
}

execFileSync('git', ['config', 'core.hooksPath', caminhoRelativo], { cwd: RAIZ })
console.log(`Hooks instalados: core.hooksPath = ${caminhoRelativo}`)
console.log('Pular uma vez: git commit --no-verify')
