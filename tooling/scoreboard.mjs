#!/usr/bin/env node
// scoreboard — draws docs/assets/rebar-scoreboard.svg from the real run.
//
// The README opens with that image and says it is "the real output, generated
// from the run". For its first weeks it was a hand-kept SVG, and it drifted the
// way every hand-kept copy in this repository drifted before a gate caught it:
// measured on 2026-09-16 the image said `14 of 14 · 4 not applicable`, with
// `ci-gates` as N/A and a `formatter` title that no longer exists, while
// `npx github:Navesz/rebar .` printed `15 of 15 · 3 not applicable`.
//
// So the image is now derived, never written by hand:
//
//   node tooling/scoreboard.mjs              runs rebar-check on this repository
//                                            and rewrites the SVG
//   node tooling/scoreboard.mjs --verificar  recomputes in memory, exits 1 when
//                                            the file on disk is stale
//
// It runs the CLI itself (`--json .`) instead of calling the rules in-process,
// because what the reader compares the image with is what `npx` prints, and the
// CLI is the only path that is guaranteed to be that. Which lines are shown and
// in which order comes from `placar()`, the same function the terminal output
// uses — a second renderer deciding on its own which heuristics are visible
// would be the same drift with one more step.

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { placar } from './rebar-check/index.mjs'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECKER = join(RAIZ, 'tooling', 'rebar-check', 'index.mjs')
export const DESTINO = join(RAIZ, 'docs', 'assets', 'rebar-scoreboard.svg')

const COR = {
  fundo: '#0e1117',
  borda: '#2f343c',
  passou: '#53be70',
  reprovou: '#ff6367',
  na: '#6f757e',
  quebrou: '#ec8435',
  id: '#c9ced6',
  titulo: '#8b9199',
  motivo: '#5c626b',
  cabecalho: '#ec8435',
  forte: '#f0f3f6',
}
const MARCA = { passou: '✓', reprovou: '✗', na: '–', quebrou: '⚠' }
const FONTE =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
const LARGURA_MINIMA = 1120
const PASSO = 22
// Monospace at 14px averages ~8.45px per character; the width grows with the
// longest line instead of letting a long reason run off the image.
const PX_POR_CARACTERE = 8.45

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Runs rebar-check on this repository and returns the report object. */
export function relatorio(raiz = RAIZ) {
  let saida
  try {
    saida = execFileSync(process.execPath, [CHECKER, '--json', '.'], {
      cwd: raiz,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (e) {
    // Exit 1 is a legitimate scoreboard: something failed, and the image has
    // to show it. Anything else (2 invalid target, 127 a rule broke) is not a
    // scoreboard to draw.
    if (e.status !== 1 || !e.stdout) throw e
    saida = e.stdout
  }
  const json = JSON.parse(saida)
  return Array.isArray(json) ? json[0] : json
}

/** Pure: report in, SVG text out. Same report, same bytes. */
export function desenhar(a) {
  const { det, heuVisiveis, nota: n } = placar(a)
  const linhas = []
  let y = 62
  let maior = `rebar-check · ${a.nome}`.length

  linhas.push(
    `  <text x="26" y="${y}" fill="${COR.cabecalho}" font-weight="600">rebar-check · ${xml(a.nome)}</text>`,
  )

  const regra = (x, texto, corTexto) => {
    y += PASSO
    const partes = [
      `<tspan x="26" fill="${COR[x.estado]}">${MARCA[x.estado]}</tspan>`,
      `<tspan x="52" fill="${COR.id}">${xml(x.id)}</tspan>`,
      `<tspan x="256" fill="${corTexto}">${xml(texto)}</tspan>`,
    ]
    maior = Math.max(maior, 24 + texto.length)
    return partes
  }

  for (const x of det) {
    const titulo = x.estado === 'na' ? COR.na : COR.titulo
    const partes = regra(x, x.titulo, titulo)
    if (x.motivo) {
      partes.push(`<tspan fill="${COR.motivo}" dx="12">${xml(x.motivo)}</tspan>`)
      maior = Math.max(maior, 24 + x.titulo.length + 2 + x.motivo.length)
    }
    linhas.push(`  <text y="${y}">${partes.join('')}</text>`)
  }

  if (heuVisiveis.length) {
    y += PASSO
    const aviso = '── heuristics (they do not enter the score, they do not drop the CI)'
    linhas.push(`  <text x="26" y="${y}" fill="${COR.na}" font-style="italic">${xml(aviso)}</text>`)
    for (const x of heuVisiveis) {
      const partes = regra(x, x.motivo || '', COR.titulo)
      linhas.push(`  <text y="${y}">${partes.join('')}</text>`)
    }
  }

  y += 28
  if (n.total === 0) {
    linhas.push(
      `  <text x="26" y="${y}" fill="${COR.na}">nothing evaluable in this repository</text>`,
    )
  } else {
    const pontos = `${n.ok} of ${n.total}`
    const resto =
      (n.na ? `  ·  ${n.na} not applicable` : '') +
      (heuVisiveis.length ? `  ·  ${heuVisiveis.length} warning(s)` : '')
    const cor = n.ok === n.total ? COR.passou : COR.reprovou
    linhas.push(
      `  <text x="26" y="${y}" font-weight="600"><tspan fill="${cor}">${pontos}</tspan><tspan fill="${COR.forte}">${xml(resto)}</tspan></text>`,
    )
  }
  if (n.quebrou) {
    y += PASSO
    linhas.push(
      `  <text x="26" y="${y}" fill="${COR.quebrou}">⚠ ${n.quebrou} rule(s) BROKE — defect of rebar-check, outside the score</text>`,
    )
  }

  const largura = Math.max(LARGURA_MINIMA, Math.ceil(52 + maior * PX_POR_CARACTERE))
  const altura = y + 42
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}" role="img" aria-label="rebar-check output on the rebar repository itself">`,
    '  <title>rebar-check on the rebar repository itself</title>',
    '  <!-- Generated by `node tooling/scoreboard.mjs` from the real run. Do not edit by hand: the `scoreboard` step of the verify fails when this file is stale. -->',
    '',
    `  <rect x="0.75" y="0.75" width="${largura - 1.5}" height="${altura - 1.5}" rx="14" fill="${COR.fundo}" stroke="${COR.borda}" stroke-width="1.5"/>`,
    '',
    '  <!-- Window chrome, so the image reads as a terminal at a glance -->',
    `  <circle cx="28" cy="26" r="6" fill="${COR.reprovou}"/>`,
    `  <circle cx="50" cy="26" r="6" fill="${COR.quebrou}"/>`,
    `  <circle cx="72" cy="26" r="6" fill="${COR.passou}"/>`,
    `  <text x="96" y="31" font-family="${FONTE}" font-size="13" fill="${COR.na}">npx github:Navesz/rebar .</text>`,
    `  <line x1="1" y1="44" x2="${largura - 1}" y2="44" stroke="${COR.borda}" stroke-width="1.5"/>`,
    '',
    `  <g font-family="${FONTE}" font-size="14" xml:space="preserve">`,
    ...linhas,
    '  </g>',
    '</svg>',
    '',
  ].join('\n')
}

function principal(args) {
  if (args.some((x) => x !== '--verificar')) {
    console.error('usage: node tooling/scoreboard.mjs [--verificar]')
    return 2
  }
  const a = relatorio()
  if (a.erro) {
    console.error(`scoreboard: rebar-check could not evaluate this repository: ${a.erro}`)
    return 2
  }
  const novo = desenhar(a)
  const { nota: n } = placar(a)
  const resumo = `${n.ok} of ${n.total} · ${n.na} not applicable`
  let atual = null
  try {
    atual = readFileSync(DESTINO, 'utf8').replace(/\r\n/g, '\n')
  } catch {
    /* absent: the write below creates it, the check below accuses it */
  }

  if (args.includes('--verificar')) {
    if (atual === novo) {
      console.log(`scoreboard --verificar: up to date · ${resumo}`)
      return 0
    }
    console.error(
      atual === null
        ? 'scoreboard --verificar: docs/assets/rebar-scoreboard.svg is missing.'
        : `scoreboard --verificar: DIVERGED. The image no longer matches the run (${resumo}).`,
    )
    return 1
  }

  if (atual === novo) {
    console.log(`scoreboard: already up to date · ${resumo}`)
    return 0
  }
  writeFileSync(DESTINO, novo, 'utf8')
  console.log(`scoreboard: wrote docs/assets/rebar-scoreboard.svg · ${resumo}`)
  return 0
}

const ehCli = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (process.argv[1] && ehCli()) {
  process.exitCode = principal(process.argv.slice(2))
}
