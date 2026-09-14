#!/usr/bin/env node
// gravar-moldes — records the AGENTS.md template the generator renders today as
// a new version of moldes-agentes.json, when it differs from the last one.
//
// WHY A SEPARATE STEP. instruction-provenance fails a root AGENTS.md that carries
// the generator marker and matches no recorded template version. A template edit
// that nobody records would make every project generated after it fail, so
// prove-proveniencia.mjs fails first, in rebar's own gate, with the command to
// run: this one.
//
// The table is APPEND-ONLY. Older entries are never edited: a project generated
// by an older rebar keeps matching the version it was generated with (rebar-site
// tracks version 3 byte for byte). A new entry starts with `commits: []`, since
// the commit that ships it does not exist yet; a later edit may fill it in.
//
// This file owns the table's bytes (JSON.stringify with one space of indent, raw
// UTF-8), which is why .prettierignore leaves the table alone.
//
//   node tooling/security/injection/gravar-moldes.mjs [--moldes=<path to the table>]

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { MOLDES, SLOT_BLOCO, SLOT_COMMIT, SLOT_NOME } from './proveniencia.mjs'

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

/**
 * The table with the renders appended as v<N+1>, or the same table when they
 * equal the last version. Never mutates `moldes`.
 * @returns {{ moldes: object, gravou: boolean }}
 */
export function gravar(moldes, comBloco, semBloco) {
  const ultima = moldes.versoes[moldes.versoes.length - 1]
  if (ultima && ultima.comBloco === comBloco && ultima.semBloco === semBloco) {
    return { moldes, gravou: false }
  }
  const versao = {
    versao: `v${moldes.versoes.length + 1}`,
    commits: [],
    comBloco,
    semBloco,
    sha256ComBloco: sha256(comBloco),
    sha256SemBloco: sha256(semBloco),
  }
  return { moldes: { ...moldes, versoes: [...moldes.versoes, versao] }, gravou: true }
}

/** The bytes the table is written with. */
export const serializar = (moldes) => `${JSON.stringify(moldes, null, 1)}\n`

async function principal(argv) {
  const arg = argv.find((a) => a.startsWith('--moldes='))
  const caminho = arg ? arg.slice('--moldes='.length) : fileURLToPath(MOLDES)
  // The generator lives in new/, which the security engines never import; this
  // CLI runs only inside a rebar checkout, where new/ exists.
  const { moldeAgents } = await import(
    new URL('../../../new/gate/aplicar.mjs', import.meta.url).href
  )
  const atual = JSON.parse(readFileSync(caminho, 'utf8'))
  const { moldes, gravou } = gravar(
    atual,
    moldeAgents(SLOT_NOME, SLOT_BLOCO, SLOT_COMMIT),
    moldeAgents(SLOT_NOME, '', SLOT_COMMIT),
  )
  if (!gravou) {
    console.log('nothing to record')
    return 0
  }
  writeFileSync(caminho, serializar(moldes))
  console.log(`recorded ${moldes.versoes[moldes.versoes.length - 1].versao} in ${caminho}`)
  return 0
}

if (pathToFileURL(process.argv[1] || '').href === import.meta.url) {
  process.exitCode = await principal(process.argv.slice(2))
}
