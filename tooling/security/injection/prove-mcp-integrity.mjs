// THE MCP SERVER INTEGRITY RULE, PROVED AGAINST THE BLOBS IT HAS TO TELL APART
//
// tooling/security/injection/mcp-integrity.mjs accepts the `.rebar/mcp.mjs` a
// tracked MCP config launches only when its bytes are a version of rebar's
// template. Four things would fail in silence if they drifted: the lookup (a
// real older version failing would turn rebar-site, assay and navesz-portfolio
// red on their next pin bump), the resolution of the launched path (a config in
// a subfolder or with `${workspaceFolder}` judged the wrong file), the refusals
// that are not a hash (untracked, a symbolic link), and the table itself (a
// missing or ambiguous table must break the rule, not pass every blob).
//
// Every repository is built in os.tmpdir() with INDEX-ONLY entries, the way the
// proof runner builds `gerados`.
//
//   node --test tooling/security/injection/prove-mcp-integrity.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { pathToFileURL } from 'node:url'

import { checarMcpIntegrity } from './mcp-integrity.mjs'

const criados = []
after(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, maxRetries: 3, force: true })
})

const NUL = String.fromCodePoint(0)
const LF = String.fromCharCode(10)
const MODELO = readFileSync(new URL('../../../new/gate/arquivos/mcp-rebar.mjs', import.meta.url))
const MCP_JSON = readFileSync(
  new URL('../../../new/gate/arquivos/mcp.json', import.meta.url),
  'utf8',
)
const sha256 = (b) => createHash('sha256').update(b).digest('hex')

const SEM_CONFIG = join(tmpdir(), 'rebar-prove-mcp-integrity-gitconfig-inexistente')
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
    maxBuffer: 1 << 30,
    windowsHide: true,
  })
  if (r.status !== 0) throw new Error(`git ${argumentos.join(' ')}: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

/** Index-only repository: { caminho: string | Buffer | { symlink } }. */
function repositorio(arquivos) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-mcp-integrity-'))
  criados.push(dir)
  git(dir, ['init', '-q'])
  const lista = Object.entries(arquivos)
  if (!lista.length) return dir
  const pasta = mkdtempSync(join(tmpdir(), 'rebar-mcp-integrity-blobs-'))
  criados.push(pasta)
  const link = (c) => c && typeof c === 'object' && !Buffer.isBuffer(c)
  const caminhos = lista.map(([, conteudo], k) => {
    const arquivo = join(pasta, String(k))
    writeFileSync(arquivo, link(conteudo) ? Buffer.from(conteudo.symlink) : Buffer.from(conteudo))
    return arquivo
  })
  const oids = git(
    dir,
    ['hash-object', '-w', '--no-filters', '--stdin-paths'],
    `${caminhos.join(LF)}${LF}`,
  ).split(LF)
  const linhas = lista.map(
    ([caminho, conteudo], k) =>
      `${link(conteudo) ? '120000' : '100644'} ${oids[k]}\t${caminho}${NUL}`,
  )
  git(dir, ['update-index', '-z', '--add', '--index-info'], linhas.join(''))
  return dir
}

/** A version table written to a temp file, for the cases the real table cannot pose. */
function tabela(versoes) {
  const pasta = mkdtempSync(join(tmpdir(), 'rebar-mcp-integrity-tabela-'))
  criados.push(pasta)
  const arquivo = join(pasta, 'modelos-mcp.json')
  writeFileSync(arquivo, JSON.stringify({ esquema: 2, versoes }))
  return pathToFileURL(arquivo)
}

const versao = (ordem, bytes, atual, extra = {}) => ({
  ordem,
  sha256: sha256(bytes),
  blob: String(ordem).repeat(40).slice(0, 40),
  bytes: bytes.length,
  desde: atual ? null : 'b'.repeat(40),
  data: atual ? null : '2026-09-01',
  atual,
  recusada: null,
  regua_sem_pino: false,
  ganchos_antigos: false,
  ...extra,
})

const A = Buffer.from(`// version A${LF}`)
const B = Buffer.from(`// version B${LF}`)
const SINTETICA = () => tabela([versao(1, B, false), versao(2, A, true)])
const checar = (arquivos, opcoes) => checarMcpIntegrity({ dir: repositorio(arquivos) }, opcoes)

describe('mcp-integrity over the launched server', () => {
  test('1. the current template, launched by the template config, passes with no note', () => {
    assert.equal(checar({ '.mcp.json': MCP_JSON, '.rebar/mcp.mjs': MODELO }), null)
  })

  test('2. an older known version passes with a note on how to update', () => {
    const r = checar({ '.mcp.json': MCP_JSON, '.rebar/mcp.mjs': B }, { tabela: SINTETICA() })
    assert.ok(r && typeof r === 'object' && r.nota, JSON.stringify(r))
    assert.match(r.nota, /version 1 of 2/)
    assert.match(r.nota, /copy new\/gate\/arquivos\/mcp-rebar\.mjs/)
  })

  test('3. unknown bytes fail, naming blob and hash and never the content', () => {
    const conteudo = `// a server nobody reviewed${LF}`
    const r = checar({ '.mcp.json': MCP_JSON, '.rebar/mcp.mjs': conteudo }, { tabela: SINTETICA() })
    assert.equal(typeof r, 'string', JSON.stringify(r))
    assert.match(
      r,
      /\.rebar\/mcp\.mjs \(blob [0-9a-f]{7}, sha256:[0-9a-f]{12}\) matches none of the 2/,
    )
    assert.ok(!r.includes('nobody reviewed'), r)
  })

  test('4. a config launching an untracked server fails', () => {
    assert.match(String(checar({ '.mcp.json': MCP_JSON })), /does not track/)
  })

  test('5. no config is not applicable, even with the server tracked', () => {
    const na = { na: 'no MCP configuration launches .rebar/mcp.mjs' }
    assert.deepEqual(checar({ LICENSE: 'Apache' }), na)
    assert.deepEqual(checar({ '.rebar/mcp.mjs': MODELO }), na)
  })

  test('6. a Cursor config launching unknown bytes fails', () => {
    const r = checar(
      { '.cursor/mcp.json': MCP_JSON, '.rebar/mcp.mjs': `// other${LF}` },
      { tabela: SINTETICA() },
    )
    assert.match(String(r), /\.cursor\/mcp\.json:\d+:\d+|matches none/)
  })

  test('7. a config in a subfolder judges the server of that subfolder', () => {
    const r = checar(
      { 'site/.mcp.json': MCP_JSON, 'site/.rebar/mcp.mjs': B, '.rebar/mcp.mjs': `// root${LF}` },
      { tabela: SINTETICA() },
    )
    assert.match(String(r?.nota), /site\/\.rebar\/mcp\.mjs is version 1 of 2/)
  })

  test('8. ${workspaceFolder} in a VS Code config resolves to the project root', () => {
    const vscode = JSON.stringify({
      servers: { rebar: { command: 'node', args: ['${workspaceFolder}/.rebar/mcp.mjs'] } },
    })
    const r = checar(
      { '.vscode/mcp.json': vscode, '.rebar/mcp.mjs': `// x${LF}` },
      { tabela: SINTETICA() },
    )
    assert.match(String(r), /matches none of the 2/)
  })

  test('9. a server tracked as a symbolic link fails', () => {
    const r = checar({
      '.mcp.json': MCP_JSON,
      '.rebar/mcp.mjs': { symlink: 'outro.mjs' },
      'outro.mjs': A,
    })
    assert.match(String(r), /symbolic link/)
  })

  test('10. a missing table and a table with two current entries break the rule', () => {
    const dir = repositorio({ '.mcp.json': MCP_JSON, '.rebar/mcp.mjs': A })
    assert.throws(
      () =>
        checarMcpIntegrity(
          { dir },
          { tabela: new URL('./there-is-no-table-here.json', import.meta.url) },
        ),
      /malformed: the file is missing/,
    )
    assert.throws(
      () =>
        checarMcpIntegrity({ dir }, { tabela: tabela([versao(1, B, true), versao(2, A, true)]) }),
      /2 entries are marked atual/,
    )
  })

  test('11. two configs launching one file give one finding', () => {
    const r = checar(
      { '.mcp.json': MCP_JSON, '.cursor/mcp.json': MCP_JSON, '.rebar/mcp.mjs': `// x${LF}` },
      { tabela: SINTETICA() },
    )
    assert.match(String(r), /^1 MCP server integrity finding/)
  })

  test('12. a malformed allowlist line fails this rule too, not exemptable', () => {
    const r = checar({
      '.mcp.json': MCP_JSON,
      '.rebar/mcp.mjs': MODELO,
      '.rebar-injection-allowlist': `not json${LF}`,
    })
    assert.match(String(r), /\.rebar-injection-allowlist:1:\d+ .*\(not exemptable\)/)
  })

  // Measured by review on 2026-09-13: a commit that put blob 6cf8634 (version 1)
  // back as .rebar/mcp.mjs passed every rule, and that file runs
  // `npx --yes github:Navesz/rebar --mcp` whenever the client starts it.
  test('13. version 1 of the real table fails; versions 2 and 6 pass with a note that says what they run', () => {
    const raiz = new URL('../../../', import.meta.url)
    const blob = (id) =>
      spawnSync('git', ['cat-file', 'blob', id], { cwd: raiz, encoding: 'buffer', env: AMBIENTE })
        .stdout
    const v1 = checar({
      '.mcp.json': MCP_JSON,
      '.rebar/mcp.mjs': blob('6cf8634287ff62b56d3a648be161e41c783809b1'),
    })
    assert.equal(typeof v1, 'string', JSON.stringify(v1))
    assert.match(v1, /version 1 of \d+ .*which this rule refuses: it starts npx --yes/)
    const v2 = checar({
      '.mcp.json': MCP_JSON,
      '.rebar/mcp.mjs': blob('8bc5d7fe440e73c26c3e332ae11bf0a0669357ee'),
    })
    assert.ok(v2?.nota, JSON.stringify(v2))
    assert.match(v2.nota, /version 2 of \d+ .*runs github:Navesz\/rebar unpinned when/)
    const v6 = checar({
      '.mcp.json': MCP_JSON,
      '.rebar/mcp.mjs': blob('ea75237df44a0f6c06d8cd634541ff3f1434af8e'),
    })
    assert.ok(v6?.nota, JSON.stringify(v6))
    assert.doesNotMatch(v6.nota, /rebar-coautores/)
  })

  // Measured on a clone of rebar-site on 2026-09-13: copying the server file
  // alone, as the note used to say, made rebar_verificar report two rules
  // DESARMADA; the server plus the hook files passed.
  test('14. a version with the old hook names gets the note that names the hook files too', () => {
    const tab = tabela([versao(1, B, false, { ganchos_antigos: true }), versao(2, A, true)])
    const r = checar({ '.mcp.json': MCP_JSON, '.rebar/mcp.mjs': B }, { tabela: tab })
    assert.match(String(r?.nota), /rename \.rebar-coautores to \.rebar-coauthors/)
    assert.match(String(r?.nota), /server file alone reports two rules DESARMADA/)
    assert.doesNotMatch(String(r?.nota), /nothing else in the project changes/)
    const semGanchos = checar(
      { '.mcp.json': MCP_JSON, '.rebar/mcp.mjs': B },
      { tabela: SINTETICA() },
    )
    assert.match(
      String(semGanchos?.nota),
      /reads that pin from \.github\/workflows\/verificar\.yml/,
    )
  })

  test('15. a refused version fails with its reason, and a table whose current entry is refused breaks', () => {
    const motivo = 'it runs something at start-up'
    const tab = tabela([versao(1, B, false, { recusada: motivo }), versao(2, A, true)])
    const r = checar({ '.mcp.json': MCP_JSON, '.rebar/mcp.mjs': B }, { tabela: tab })
    assert.match(String(r), /which this rule refuses: it runs something at start-up/)
    const dir = repositorio({ '.mcp.json': MCP_JSON, '.rebar/mcp.mjs': A })
    assert.throws(
      () =>
        checarMcpIntegrity({ dir }, { tabela: tabela([versao(1, A, true, { recusada: motivo })]) }),
      /the atual entry is recusada/,
    )
  })
})
