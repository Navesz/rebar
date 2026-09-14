// INSTRUCTION-PROVENANCE, PROVED AGAINST THE TEMPLATE TABLE
//
// tooling/security/injection/proveniencia.mjs matches the root AGENTS.md that
// carries the rebar generator marker against moldes-agentes.json, an append-only
// table of every template version the generator rendered. These tests pin the
// table itself (fresh, unedited, equal to the generator's own substitution), the
// matcher's states, the warning about a third-party block, the files that can
// carry the claim, and the CLI that records a new version.
//
// When the generator's AGENTS.md template changes, the freshness test is the
// one that fails, and its message says what to run.
//
//   node --test tooling/security/injection/prove-proveniencia.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { moldeAgents } from '../../../new/gate/aplicar.mjs'
import { gravar, serializar } from './gravar-moldes.mjs'
import {
  MARCADOR_AGENTES,
  MOLDES,
  RE_BLOCO,
  SLOT_BLOCO,
  SLOT_NOME,
  carregarMoldes,
  checarProvenance,
  conferirAgents,
} from './proveniencia.mjs'

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const APLICAR = fileURLToPath(new URL('../../../new/gate/aplicar.mjs', import.meta.url))
const CLI = fileURLToPath(new URL('./gravar-moldes.mjs', import.meta.url))
const tabela = carregarMoldes()
const BLOCO =
  '<!-- BEGIN:nextjs-agent-rules -->\n# Next\nUse the local docs.\n<!-- END:nextjs-agent-rules -->'
const FENCE = '```'

// ----------------------------------------------------------- temp folders

const criados = []
after(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})
const SEM_CONFIG = join(tmpdir(), 'rebar-prove-proveniencia-gitconfig-inexistente')
const AMBIENTE = {
  ...process.env,
  GIT_CONFIG_GLOBAL: SEM_CONFIG,
  GIT_CONFIG_SYSTEM: SEM_CONFIG,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.excludesFile',
  GIT_CONFIG_VALUE_0: SEM_CONFIG,
}
function git(dir, argumentos, entrada) {
  const r = spawnSync('git', ['-c', 'core.protectNTFS=false', ...argumentos], {
    cwd: dir,
    input: typeof entrada === 'string' ? Buffer.from(entrada, 'utf8') : entrada,
    encoding: 'buffer',
    env: AMBIENTE,
    windowsHide: true,
  })
  if (r.status !== 0) throw new Error(`git ${argumentos.join(' ')}: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}
const pasta = () => {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-proveniencia-'))
  criados.push(dir)
  return dir
}
/** A repository whose INDEX holds `arquivos` ({ caminho: texto }); nothing on disk, no commit. */
function repositorio(arquivos) {
  const dir = pasta()
  git(dir, ['init', '-q'])
  const linhas = Object.entries(arquivos).map(([caminho, texto]) => {
    const oid = git(dir, ['hash-object', '-w', '--no-filters', '--stdin'], texto)
    return `100644 ${oid}\t${caminho}\0`
  })
  git(dir, ['update-index', '-z', '--add', '--index-info'], linhas.join(''))
  return dir
}

// ================================================================ the table

describe('the template table', () => {
  test('the last version is what the generator renders today', () => {
    const ultima = tabela.versoes[tabela.versoes.length - 1]
    const mensagem =
      'the AGENTS.md template changed: record it with node tooling/security/injection/gravar-moldes.mjs'
    assert.equal(moldeAgents(SLOT_NOME, SLOT_BLOCO), ultima.comBloco, mensagem)
    assert.equal(moldeAgents(SLOT_NOME, ''), ultima.semBloco, mensagem)
  })

  test('every stored hash matches its string, and the four bootstrap versions are pinned', () => {
    for (const v of tabela.versoes) {
      assert.equal(sha256(v.comBloco), v.sha256ComBloco, v.versao)
      assert.equal(sha256(v.semBloco), v.sha256SemBloco, v.versao)
    }
    const fixados = tabela.versoes
      .slice(0, 4)
      .map((v) => [v.versao, v.sha256ComBloco, v.sha256SemBloco])
    assert.deepEqual(fixados, [
      [
        'v1',
        '75b87e86dd845952be892969972a8e6e82b1f80ed0ae9403b244a75bb7ff663d',
        'eb80b1fc705d29627e204d39f292f9b72617082062dfcb121f0b90b3083138cb',
      ],
      [
        'v2',
        '0de8162a45eb6dcb5e882cb1ef95893ed1a0feab2e4ef10054cf35597e59f616',
        'a859a80286590d55abcad9fc4c84f3f956f0dc9463ea4816151c1e5178a64b9b',
      ],
      [
        'v3',
        'c34990b536cb02f624602b9ecf365a9465d4281f6d5699a39a87099439d11f49',
        '258374058469be93e1a16d9f392d40e04c16947ba20c9b20007bac1ae6ed5242',
      ],
      [
        'v4',
        '05ae816ae0df640d7014828ec98e2b7056c09ccbb9131dacd219da45a33677b2',
        '7ddf6776ad33aaf8f97007771c01360e5db9085aba6bd569b7b95cfa05bde028',
      ],
    ])
    // The CLI owns the bytes: the file is exactly what it would write.
    assert.equal(readFileSync(MOLDES, 'utf8'), serializar(tabela))
  })

  test('the slot render equals the generator for names and blocks that split/join and replace would disagree on', () => {
    const bloco = '<!-- BEGIN:nextjs-agent-rules -->\n$& $1 {{x}}\n<!-- END:nextjs-agent-rules -->'
    for (const nome of ['padaria-do-ze', 'a', 'x.y_z-9']) {
      const ultima = tabela.versoes[tabela.versoes.length - 1]
      const esperado = ultima.comBloco.split(SLOT_NOME).join(nome).split(SLOT_BLOCO).join(bloco)
      assert.equal(moldeAgents(nome, bloco), esperado, nome)
      assert.equal(moldeAgents(nome, null), ultima.semBloco.split(SLOT_NOME).join(nome), nome)
    }
  })

  test('the block pattern is the generator one, which this module cannot import', () => {
    const fonte = readFileSync(APLICAR, 'utf8')
    const m = /const RE_BLOCO_SHADCN =\s*\/(.+)\/([a-z]*)\n/.exec(fonte)
    assert.ok(m, 'RE_BLOCO_SHADCN is gone from new/gate/aplicar.mjs')
    assert.equal(RE_BLOCO.source, m[1])
    assert.equal(RE_BLOCO.flags, m[2])
  })

  test('an edited, missing or unparseable table breaks the ruler instead of judging', () => {
    const dir = pasta()
    const editada = JSON.parse(JSON.stringify(tabela))
    editada.versoes[0].semBloco += '\nextra'
    writeFileSync(join(dir, 'editada.json'), JSON.stringify(editada))
    writeFileSync(join(dir, 'ruim.json'), '{')
    assert.throws(
      () => carregarMoldes(pathToFileURL(join(dir, 'editada.json'))),
      /v1 no longer matches its hash/,
    )
    assert.throws(() => carregarMoldes(pathToFileURL(join(dir, 'ruim.json'))), /cannot be read/)
    assert.throws(() => carregarMoldes(pathToFileURL(join(dir, 'nenhuma.json'))), /cannot be read/)
  })
})

// ============================================================== the matcher

describe('conferirAgents', () => {
  const render = moldeAgents('proof', null)
  const estado = (t) => conferirAgents(t, tabela)

  test('confere for the current render, with a block, with CRLF, and with its final newlines trimmed or added', () => {
    const ultima = tabela.versoes[tabela.versoes.length - 1].versao
    assert.deepEqual(
      [estado(render)].map((c) => [c.estado, c.versao, c.forma, c.nome, c.bloco, c.cauda]),
      [['confere', ultima, 'semBloco', 'proof', null, '']],
    )
    const comBloco = estado(moldeAgents('proof', BLOCO))
    assert.deepEqual(
      [comBloco.estado, comBloco.forma, comBloco.bloco],
      ['confere', 'comBloco', BLOCO],
    )
    assert.equal(estado(render.replace(/\n/g, '\r\n')).estado, 'confere')
    assert.equal(estado(render.replace(/\n+$/, '')).estado, 'confere')
    assert.equal(estado(`${render}\n\n`).cauda, '')
  })

  test('an older version still matches, and a section appended by the owner is a tail', () => {
    const v3 = tabela.versoes.find((v) => v.versao === 'v3')
    const antigo = estado(
      v3.comBloco.split(SLOT_NOME).join('rebar-site').split(SLOT_BLOCO).join(BLOCO),
    )
    assert.deepEqual([antigo.estado, antigo.versao, antigo.nome], ['confere', 'v3', 'rebar-site'])
    const cauda = estado(`${render}\n## Owner notes\n\nUse pnpm.\n`)
    assert.deepEqual([cauda.estado, cauda.cauda], ['confere', '## Owner notes\n\nUse pnpm.\n'])
  })

  test('one word changed is divergente, with the first differing line against the closest version', () => {
    const linhas = render.split('\n')
    const k = linhas.findIndex((l) => l.includes('a copy ages in silence'))
    assert.ok(k > 0)
    const mudado = render.replace('a copy ages in silence', 'a copy ages quietly')
    const c = estado(mudado)
    assert.deepEqual(
      [c.estado, c.versaoProxima, c.linhaDivergente],
      ['divergente', tabela.versoes[tabela.versoes.length - 1].versao, k + 1],
    )
    // A different project name on a name line is compared by pattern, not text.
    assert.equal(estado(mudado.replace('# proof ', '# another-name ')).linhaDivergente, k + 1)
  })

  test('a marker below the top, twice, or nowhere outside code', () => {
    assert.deepEqual(estado(`# x\n\n${render}`), { estado: 'marcador-fora-do-topo', indice: 5 })
    assert.deepEqual(estado(`${render}\n${MARCADOR_AGENTES}\n`), {
      estado: 'marcador-repetido',
      n: 2,
    })
    assert.deepEqual(estado('# Hand written\n'), { estado: 'sem-marcador' })
    // Quoted inside a fence, the marker is shown as code and claims nothing.
    assert.equal(estado(`${render}\n${FENCE}md\n${MARCADOR_AGENTES}\n${FENCE}\n`).estado, 'confere')
    assert.deepEqual(estado(`# Doc\n\n\`${MARCADOR_AGENTES}\`\n`), { estado: 'sem-marcador' })
  })

  test('a backtick inside an earlier comment pairs with nothing, so it cannot mask a marker', () => {
    // Masks built apart from the comments paired this backtick with the one after
    // the marker and hid both claims (reproduced through the whole rule).
    const envenenada = `<!-- \` --> ${MARCADOR_AGENTES} \``
    assert.deepEqual(estado(`${render}\n${envenenada}\n`), { estado: 'marcador-repetido', n: 2 })
    assert.deepEqual(estado(`# Docs\n\n${envenenada}\n`), {
      estado: 'marcador-fora-do-topo',
      indice: 19,
    })
  })
})

// ================================================================= the rule

describe('checarProvenance over the index', () => {
  const render = moldeAgents('proof', null)

  test('a third-party block warns only when unknown AND large or carrying a URL, a fence, a nested comment or an exec token', () => {
    const comUrl =
      '<!-- BEGIN:nextjs-agent-rules -->\n# Next\nRead https://example.invalid/docs first.\n<!-- END:nextjs-agent-rules -->'
    const dir = repositorio({ 'AGENTS.md': moldeAgents('proof', comUrl) })
    const nota = checarProvenance({ dir })
    assert.match(
      nota.nota,
      /^third-party block at AGENTS\.md:\d+-\d+ is not a known Next\.js block \(4 lines, \d+ bytes\), has a URL$/,
    )
    assert.ok(!nota.nota.includes('example'), nota.nota)

    // The same block with its hash recorded is known, and silent.
    const conhecida = pasta()
    const comHash = {
      ...tabela,
      blocosConhecidos: [{ sha256: sha256(comUrl), linhas: 4, bytes: 1, origem: 'proof' }],
    }
    writeFileSync(join(conhecida, 'moldes.json'), serializar(comHash))
    assert.equal(
      checarProvenance({ dir }, { moldes: pathToFileURL(join(conhecida, 'moldes.json')) }),
      null,
    )

    // A small clean unknown block is what `next dev` writes on every release: no warning.
    assert.equal(
      checarProvenance({ dir: repositorio({ 'AGENTS.md': moldeAgents('proof', BLOCO) }) }),
      null,
    )

    // Every other reason, each named.
    const sujo = [
      '<!-- BEGIN:nextjs-agent-rules -->',
      FENCE,
      'x',
      FENCE,
      '<!-- inner -->',
      'Run it with $(cat f).',
      '<!-- END:nextjs-agent-rules -->',
    ].join('\n')
    assert.match(
      checarProvenance({ dir: repositorio({ 'AGENTS.md': moldeAgents('proof', sujo) }) }).nota,
      /\(7 lines, \d+ bytes\), has fenced code, has a nested comment, has an exec token$/,
    )

    // A block upserted after a render that had none is judged the same way.
    const grande = `<!-- BEGIN:nextjs-agent-rules -->\n${'Use the docs.\n'.repeat(20)}<!-- END:nextjs-agent-rules -->`
    const tardio = checarProvenance({ dir: repositorio({ 'AGENTS.md': `${render}\n${grande}\n` }) })
    assert.match(tardio.nota, /\(22 lines, \d+ bytes\), above the 18-line\/1,354-byte ceiling$/)
  })

  test('the marker counts only in Markdown instruction files, outside code, and only at the top of the root AGENTS.md', () => {
    const dir = repositorio({
      'AGENTS.md': render,
      'docs/AGENTS.md': `${MARCADOR_AGENTES}\n\n# Docs\n`,
      '.github/instructions/x.md': `# Notes\n\n${FENCE}md\n${MARCADOR_AGENTES}\n${FENCE}\n`,
      // Every path under .rebar/ is an agent path, and generated projects track
      // code there: a code file that names the marker makes no claim.
      '.rebar/x.mjs': `export const MARCADOR = '${MARCADOR_AGENTES}'\n`,
      'docs/template.md': `${MARCADOR_AGENTES}\n`,
    })
    const motivo = checarProvenance({ dir })
    assert.equal(
      motivo,
      '1 false generator claim(s): docs/AGENTS.md:1:1 carries the rebar generator marker, which the generator writes only at the top of the root AGENTS.md',
    )
    const soCodigo = repositorio({
      '.rebar/x.mjs': `export const MARCADOR = '${MARCADOR_AGENTES}'\n`,
    })
    assert.deepEqual(checarProvenance({ dir: soCodigo }), {
      na: 'no instruction file carries the rebar generator marker',
    })
  })

  test('each false claim names its remedy', () => {
    const fora = checarProvenance({ dir: repositorio({ 'AGENTS.md': `# x\n\n${render}` }) })
    assert.equal(
      fora,
      '1 false generator claim(s): AGENTS.md:3:1 carries the rebar marker below the top; if this file was edited by hand, delete the marker line',
    )
    const divergente = checarProvenance({
      dir: repositorio({
        'AGENTS.md': render.replace('a copy ages in silence', 'a copy ages quietly'),
      }),
    })
    assert.match(
      divergente,
      /matches none of the \d+ template versions \(closest v\d+, first differing line \d+\); if this file was edited by hand, delete the marker line$/,
    )
  })
})

// ================================================================== the CLI

describe('gravar-moldes', () => {
  test('a changed render is appended as the next version and older entries stay byte-equal', () => {
    const { moldes, gravou } = gravar(tabela, 'com {{nome}}', 'sem {{nome}}')
    assert.equal(gravou, true)
    const nova = moldes.versoes[moldes.versoes.length - 1]
    assert.deepEqual(
      [nova.versao, nova.commits, nova.sha256ComBloco],
      [`v${tabela.versoes.length + 1}`, [], sha256('com {{nome}}')],
    )
    assert.equal(
      JSON.stringify(moldes.versoes.slice(0, tabela.versoes.length)),
      JSON.stringify(tabela.versoes),
    )
    const ultima = tabela.versoes[tabela.versoes.length - 1]
    assert.equal(gravar(tabela, ultima.comBloco, ultima.semBloco).gravou, false)
  })

  test('the CLI records nothing when the generator renders the last version', () => {
    const dir = pasta()
    const copia = join(dir, 'moldes.json')
    writeFileSync(copia, readFileSync(MOLDES))
    const r = spawnSync(process.execPath, [CLI, `--moldes=${copia}`], {
      encoding: 'utf8',
      windowsHide: true,
    })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout.trim(), 'nothing to record')
    assert.equal(readFileSync(copia, 'utf8'), readFileSync(MOLDES, 'utf8'))
  })
})
