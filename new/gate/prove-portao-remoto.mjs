#!/usr/bin/env node
// THE PROOFS OF THE REMOTE GATE — five cases, no network, no GitHub account.
//
// WHY THIS FILE EXISTS. Until 2026-09-07 the generator's answer to branch
// protection was a line of prose telling the human to open Settings › Rules, and
// the prose ADMITTED the hole: "without the ruleset, the CI is an optional green
// badge and the gate closes nothing". It printed that and exited 0. Measured the
// same day: `Navesz/rebar` had the ruleset, `Navesz/assay` had none, and both
// looked identical from the outside — a green badge on the README.
//
// `new/gate/arquivos/portao-remoto.mjs` turns that into a verdict. What this file
// proves is that the verdict is the RIGHT one in both directions:
//
//   THE CASE THAT FAILS — the assay of today, a repository with no ruleset. If
//     this one does not go red, the whole file is decoration.
//   THE CASE THAT PASSES — the rebar of today, the ruleset measured by
//     `gh api repos/Navesz/rebar/rulesets`. Without it, a checker that fails
//     everything would look correct, and that is the classic way an automatic
//     rule ships wrong. An automatic rule that is wrong costs more than an
//     absent one.
//   THREE CONTOUR CASES, each closing one way of turning green for free: gh
//     missing from PATH, the record deleted, and a ruleset that exists but does
//     not require what it should.
//
// The `gh` is faked by PATH, in a repository built in the tmpdir — the same
// technique `new/prove-identidade.mjs` uses with GIT_CONFIG_GLOBAL to keep the
// machine's own identity from deciding the result. The harness itself lives in
// the shipped file, because the generated project needs it for `--provar`: a
// second copy here would be the copy that ages.
//
//   node --test new/gate/prove-portao-remoto.mjs

import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  checksDoFluxo,
  repoFalso,
  resolverNoPath,
  rodarNoRepoFalso,
} from './arquivos/portao-remoto.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const MOLDES = join(AQUI, 'arquivos')

// THE REAL TEMPLATES, not a copy written here. What is being proved is that the
// checker reads THESE two files right; a fixture invented in this file would age
// apart from them and would prove the fixture.
const FLUXO = readFileSync(join(MOLDES, 'verificar.yml'), 'utf8')
const REGISTRO = JSON.parse(readFileSync(join(MOLDES, 'portao-remoto.json'), 'utf8'))

const ROTA_REGRAS = 'repos/exemplo/projeto/rules/branches/main'
const ROTA_RULESET = 'repos/exemplo/projeto/rulesets/1'

/** The check names as the workflow produces them — derived, never typed here. */
const CHECKS = checksDoFluxo(FLUXO, REGISTRO.exigido.job)

/** The four rules of the ruleset measured on Navesz/rebar on 2026-09-07. */
const regrasCompletas = (checks = CHECKS) => [
  { type: 'deletion', ruleset_id: 1 },
  { type: 'non_fast_forward', ruleset_id: 1 },
  { type: 'pull_request', parameters: { required_approving_review_count: 0 }, ruleset_id: 1 },
  {
    type: 'required_status_checks',
    parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: checks.map((context) => ({ context })),
    },
    ruleset_id: 1,
  },
]

function comRepo(opcoes, corpo) {
  const falso = repoFalso({ fluxo: FLUXO, registro: REGISTRO, ...opcoes })
  try {
    return corpo(falso)
  } finally {
    falso.limpar()
  }
}

test('THE CASE THAT FAILS · no ruleset — the branch is open and the step says so', () => {
  const r = comRepo({ respostas: { [ROTA_REGRAS]: [] } }, (f) => rodarNoRepoFalso(f))

  assert.equal(r.status, 1, `expected exit 1 and got ${r.status}:\n${r.saida}`)
  // FAILED and BROKE are different verdicts and get confused exactly when nobody
  // asserts them apart: 127 dominates 1 precisely because a repository must not
  // be accused by a ruler that broke. A checker that crashed would also be
  // "non-zero", and without these two lines it would pass for a correct verdict.
  assert.notEqual(r.status, 0, 'an open gate cannot exit 0')
  assert.notEqual(r.status, 127, `the checker broke instead of failing:\n${r.saida}`)
  assert.match(r.saida, /AUSENTE/, 'the output does not name the state it found')
  // The message has to carry the cure, or it is a complaint. The fix is one
  // command and the command is in the output.
  assert.match(
    r.saida,
    /gh api --method POST repos\/exemplo\/projeto\/rulesets/,
    'the message does not name the command that fixes it',
  )
})

test('THE CASE THAT PASSES · the ruleset of Navesz/rebar — the step goes green and records it', () => {
  const { r, gravado } = comRepo(
    {
      respostas: {
        [ROTA_REGRAS]: regrasCompletas(),
        [ROTA_RULESET]: { enforcement: 'active', bypass_actors: [] },
      },
    },
    (f) => ({
      r: rodarNoRepoFalso(f, ['--gravar']),
      gravado: JSON.parse(readFileSync(join(f.dir, '.rebar', 'portao-remoto.json'), 'utf8')),
    }),
  )

  assert.equal(r.status, 0, `expected exit 0 and got ${r.status}:\n${r.saida}`)
  assert.match(r.saida, /ok —/, `the output does not announce the pass:\n${r.saida}`)
  assert.equal(gravado.estado, 'instalado', 'the record was not rewritten with the new state')
  assert.deepEqual(gravado.exigido.checks, CHECKS, 'the record did not keep the derived checks')
  assert.deepEqual(gravado.observado.checks, CHECKS, 'the record did not keep what was observed')
  assert.ok(gravado.verificadoEm, 'the record has no timestamp — it says nothing about when')
})

test('CONTOUR · gh not on PATH — a warning that shows, and never a mute pass', () => {
  // Passing in silence here is worse than the file not existing: the owner would
  // read a green verify as "the branch is protected" when nobody asked anything.
  const r = comRepo({ comGh: false, respostas: {} }, (f) => {
    assert.equal(
      resolverNoPath('gh', f.env),
      null,
      'could not build a PATH without gh — THIS CASE DID NOT RUN, and a case that does not run ' +
        'is not a case that passed',
    )
    return rodarNoRepoFalso(f)
  })

  assert.equal(r.status, 0, `not being able to ask is not the repository failing:\n${r.saida}`)
  assert.match(
    r.saida,
    /⚠/,
    'the pass came out mute — nothing on screen says the gate was not checked',
  )
  assert.match(
    r.saida,
    /could not ascertain/i,
    'the output does not say what it failed to ascertain',
  )
})

test('CONTOUR · the record deleted — failure, and it is not "not applicable"', () => {
  const r = comRepo({ registro: null, respostas: { [ROTA_REGRAS]: regrasCompletas() } }, (f) =>
    rodarNoRepoFalso(f),
  )

  assert.equal(r.status, 1, `a deleted record is the cheapest way to go green:\n${r.saida}`)
  // The absence of information never becomes n/a. Reading it that way is a
  // measured attack: it took a repository from 9 of 10 to 6 of 6.
  //
  // What is asserted is the VERDICT MARKER `na(`, not the phrase "not
  // applicable" — and that distinction cost a red run here. The checker's
  // message denies the excuse in words ('this is not "not applicable"'), so a
  // scan for that phrase fails on the very message that gets it right. It is the
  // trap this repository has already fallen into three times: the note that
  // explains a rule quotes what the rule forbids.
  assert.doesNotMatch(r.saida, /\bna\(/, 'the missing record came back as an n/a verdict')
  assert.match(
    r.saida,
    /portao-remoto\.json is missing/,
    'the message does not name what is missing',
  )
})

test('CONTOUR · one check short, and a bypass list — failure naming which', () => {
  const r = comRepo(
    {
      respostas: {
        [ROTA_REGRAS]: regrasCompletas([CHECKS[0]]),
        [ROTA_RULESET]: {
          enforcement: 'active',
          bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
        },
      },
    },
    (f) => rodarNoRepoFalso(f),
  )

  assert.equal(r.status, 1, `a half-installed gate cannot pass:\n${r.saida}`)
  assert.notEqual(r.status, 127, `the checker broke instead of failing:\n${r.saida}`)
  // Naming WHICH one is the difference between a verdict and a complaint. The
  // missing context is the one the workflow produces and the ruleset does not
  // require — a check nobody demands is the whole defect, in one line.
  assert.ok(
    r.saida.includes(CHECKS[1]),
    `the message does not name the missing check ${CHECKS[1]}:\n${r.saida}`,
  )
  assert.match(
    r.saida,
    /bypass_actors has 1 entry/,
    'the message says nothing about the bypass list',
  )
})

test('the shipped `--provar` runs its two cases inside a generated project', () => {
  // The generated project carries its own proof, and it has to work THERE — with
  // no rebar checkout, no network and no account. This runs it exactly as the
  // project's `npm run verificar` would.
  const falso = repoFalso({ fluxo: FLUXO, registro: REGISTRO, comGh: false })
  try {
    const r = rodarNoRepoFalso(falso, ['--provar'])
    assert.equal(r.status, 0, `the shipped self-proof did not pass:\n${r.saida}`)
    assert.match(r.saida, /2 case\(s\) proved/, `the self-proof ran no cases:\n${r.saida}`)
  } finally {
    falso.limpar()
  }
})

test('MUTATION · with the derivation broken, the case that passes goes red', () => {
  // The proof of the proof. If the required check names stopped being derived
  // from the workflow — someone renames the matrix, or hard-codes the names —
  // the ruleset would go on requiring contexts nobody produces, and the step
  // above would still be green. Here the workflow is mutated and the SAME
  // ruleset that passed has to fail.
  const fluxoMutado = FLUXO.replace('so: [windows-latest, ubuntu-latest]', 'so: [macos-latest]')
  assert.notEqual(fluxoMutado, FLUXO, 'the mutation did not apply — this test went blind, fix it')

  const falso = repoFalso({
    fluxo: fluxoMutado,
    registro: REGISTRO,
    respostas: {
      [ROTA_REGRAS]: regrasCompletas(),
      [ROTA_RULESET]: { enforcement: 'active', bypass_actors: [] },
    },
  })
  try {
    const r = rodarNoRepoFalso(falso)
    assert.equal(r.status, 1, `the checker did not notice the renamed matrix:\n${r.saida}`)
    assert.match(
      r.saida,
      /macos-latest/,
      'the message does not name the check the workflow now produces',
    )
  } finally {
    falso.limpar()
  }
})

test('the temporary repositories left nothing behind', () => {
  // Cheap, and it is the one thing the `finally` blocks above cannot assert
  // about themselves.
  const falso = repoFalso({ fluxo: FLUXO, registro: REGISTRO, comGh: false })
  const dir = falso.dir
  falso.limpar()
  assert.throws(() => rmSync(join(dir, '.rebar', 'portao-remoto.mjs'), { recursive: false }))
})
