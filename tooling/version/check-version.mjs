#!/usr/bin/env node
// The version is a claim made in three places, and they have to agree.
//
// WHY THIS EXISTS. `docs/PLANO.md` requires versioning and a changelog where
// there is an external consumer, at N4 — enforced by CI, not by memory. The
// Action created that consumer: a workflow that writes `uses: Navesz/rebar@v0`
// is pinned to a promise, and the promise is only worth what keeps it honest.
//
// WHAT A VERSION MEANS FOR A RULER, which SemVer does not answer on its own: a
// new rule changes no API and still turns a repository that passed yesterday
// red. So the bump is read from the CONSUMER's side, and CONTRIBUTING.md says
// it in one line: a rule added or tightened is a minor while 0.x and a major
// after 1.0, because it can turn green into red; a false-positive fix is a
// patch, because it can only turn red into green.
//
// WHAT THIS STEP CHECKS. Not the meaning — no program reads intent — but the
// three mechanical facts that rot first:
//   1. `package.json` carries a version, and it is valid SemVer;
//   2. the newest entry of `CHANGELOG.md` names that same version;
//   3. the changelog's versions descend, with no repeats.
//
// Usage: node tooling/version/check-version.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MANIFESTO = 'package.json'
const CHANGELOG = 'CHANGELOG.md'

/** `1.2.3` and nothing else: no leading `v`, no range, no pre-release for now. */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

/** `## [1.2.3] — 2026-09-21` and the forms around it, heading level two. */
const CABECALHO = /^##\s*\[?(\d+\.\d+\.\d+)\]?/

const erros = []
const ler = (rel) => {
  try {
    return readFileSync(join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n')
  } catch {
    erros.push(`${rel}: not found — the step needs it to compare anything.`)
    return null
  }
}

const manifesto = ler(MANIFESTO)
const changelog = ler(CHANGELOG)

let versao = null
if (manifesto !== null) {
  let json
  try {
    json = JSON.parse(manifesto)
  } catch (e) {
    erros.push(`${MANIFESTO}: does not parse — ${e.message}`)
  }
  if (json) {
    versao = json.version
    if (!versao) {
      erros.push(
        `${MANIFESTO}: no "version". npm's git installer does not require it, which is why ` +
          '`npx github:` always worked, but `npm pack` refuses the package and a release tag ' +
          'has nothing to agree with.',
      )
    } else if (!SEMVER.test(versao)) {
      erros.push(`${MANIFESTO}: version "${versao}" is not MAJOR.MINOR.PATCH.`)
    }
  }
}

const versoes = []
if (changelog !== null) {
  for (const linha of changelog.split('\n')) {
    const m = CABECALHO.exec(linha)
    if (m) versoes.push(m[1])
  }
  if (!versoes.length) {
    erros.push(`${CHANGELOG}: no "## [x.y.z]" heading — nothing to compare the manifest against.`)
  }
}

if (versao && versoes.length) {
  if (versoes[0] !== versao) {
    erros.push(
      `${CHANGELOG}: the newest entry is ${versoes[0]}, ${MANIFESTO} says ${versao}. ` +
        'A release cut from here would tag one number and ship the other.',
    )
  }

  const ordem = (v) => v.split('.').map(Number)
  for (let i = 1; i < versoes.length; i++) {
    const [aM, am, ap] = ordem(versoes[i - 1])
    const [bM, bm, bp] = ordem(versoes[i])
    const anterior = aM * 1e6 + am * 1e3 + ap
    const seguinte = bM * 1e6 + bm * 1e3 + bp
    if (seguinte === anterior) {
      erros.push(`${CHANGELOG}: ${versoes[i]} appears twice.`)
    } else if (seguinte > anterior) {
      erros.push(
        `${CHANGELOG}: ${versoes[i]} comes after ${versoes[i - 1]}, so the list does not descend.`,
      )
    }
  }
}

if (erros.length) {
  for (const e of erros) console.error(`  ✗ ${e}`)
  process.exit(1)
}

console.log(
  `  ✓ version ${versao} · ${CHANGELOG} with ${versoes.length} entr${versoes.length === 1 ? 'y' : 'ies'}, newest first`,
)
