// THE INDEX READER, PROVED AGAINST WHAT IT EXISTS TO SEE
//
// tooling/security/injection/reader.mjs decides what every injection rule
// reads. Each test below is one way a repository was MEASURED to show a rule
// something other than what the agent loads: a UTF-32 BOM, a second BOM, a
// directory symlink hiding `.claude/settings.json`, an LFS pointer, a `-diff`
// attribute, a truncated blob, a `git replace`, a case collision. If the reader
// loses one of them, the rule goes blind without throwing, so each one is
// pinned here.
//
// Every repository is built in os.tmpdir() with INDEX-ONLY entries (hash-object
// plus update-index --index-info): nothing is written to a working tree, which
// is also how the proof runner builds `gerados`. Every special byte is built at
// runtime, so this file holds no raw control or invisible character.
//
//   node --test tooling/security/injection/prove-reader.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'

import { CONTROLES, ESCAPAR_TAMBEM, IGNORAVEIS, naFaixa } from '../texto-seguro.mjs'
import {
  LIMITE_DE_BLOB,
  MOTIVO_A_ESCREVER,
  NOME_DA_ALLOWLIST,
  PROBLEMAS_DO_CAMINHO,
  decodificarBlob,
  formatosDeEscape,
  impressao,
  lerAllowlist,
  lerCommits,
  lerIndice,
  onde,
  posicao,
  problemasDeLeitura,
  resumir,
  sugerirEntrada,
  textosNoDisco,
  tipoDoCaminho,
} from './reader.mjs'

const cp = (...n) => String.fromCodePoint(...n)
const NUL = cp(0)
const bytes = (...partes) =>
  Buffer.concat(
    partes.map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf8') : Buffer.from(p))),
  )
const HEX40 = 'ab'.repeat(20)

// ───────────────────────────────────────────────────────── temp repositories

const criados = []
after(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})

// The machine's git config never decides what these repositories hold: no
// system or global file (Git for Windows ships core.autocrlf=true in its
// system config, which rewrote CRLF blobs to LF before the rule saw them) and
// no excludes file. The same isolation prove-injection.mjs uses.
const SEM_CONFIG = join(tmpdir(), 'rebar-prove-reader-gitconfig-inexistente')
const AMBIENTE = {
  ...process.env,
  GIT_CONFIG_GLOBAL: SEM_CONFIG,
  GIT_CONFIG_SYSTEM: SEM_CONFIG,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.excludesFile',
  GIT_CONFIG_VALUE_0: SEM_CONFIG,
  GIT_AUTHOR_NAME: 'proof',
  GIT_AUTHOR_EMAIL: 'proof@example.invalid',
  GIT_COMMITTER_NAME: 'proof',
  GIT_COMMITTER_EMAIL: 'proof@example.invalid',
}

function git(dir, argumentos, entrada, { ambiente = AMBIENTE } = {}) {
  const r = spawnSync('git', ['-c', 'core.protectNTFS=false', ...argumentos], {
    cwd: dir,
    input: typeof entrada === 'string' ? Buffer.from(entrada, 'utf8') : entrada,
    encoding: 'buffer',
    env: ambiente,
    maxBuffer: 1 << 30,
    windowsHide: true,
  })
  if (r.status !== 0) throw new Error(`git ${argumentos.join(' ')}: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

/** A fresh repository whose index holds `arquivos`: [{ caminho, conteudo, modo?, oid? }]. */
function repositorio(arquivos = []) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-reader-'))
  criados.push(dir)
  git(dir, ['init', '-q'])
  gravar(dir, arquivos)
  return dir
}

function gravar(dir, arquivos) {
  if (arquivos.length === 0) return
  // One hash-object for every blob: a process per file cost about 40 ms each
  // on Windows. The bytes are staged in a sibling temp folder, never in the
  // repository's working tree.
  const comConteudo = arquivos.filter((a) => !a.oid)
  const oids = []
  if (comConteudo.length) {
    const pasta = mkdtempSync(join(tmpdir(), 'rebar-reader-blobs-'))
    criados.push(pasta)
    const caminhos = comConteudo.map((a, k) => {
      const arquivo = join(pasta, String(k))
      writeFileSync(arquivo, bytes(a.conteudo))
      return arquivo
    })
    oids.push(
      ...git(
        dir,
        ['hash-object', '-w', '--no-filters', '--stdin-paths'],
        `${caminhos.join('\n')}\n`,
      ).split('\n'),
    )
  }
  const linhas = arquivos.map((a) => {
    const oid = a.oid || oids.shift()
    return `${a.modo || '100644'} ${oid}${a.estagio ? ` ${a.estagio}` : ''}\t${a.caminho}${NUL}`
  })
  git(dir, ['update-index', '-z', '--add', '--index-info'], Buffer.from(linhas.join(''), 'utf8'))
}

const entradaDe = (indice, caminho) => {
  const e = indice.porCaminho.get(caminho)
  assert.ok(e, `${caminho} is not in the index read`)
  return e
}

// ════════════════════════════════════════════════════════════════ decoding

describe('decodificarBlob', () => {
  test('a UTF-32LE BOM is read as UTF-32, not as UTF-16LE with NULs', () => {
    const texto = `hi${cp(0x200b, 0xe0041)}`
    const corpo = Buffer.alloc(4 * [...texto].length)
    ;[...texto].forEach((ch, k) => corpo.writeUInt32LE(ch.codePointAt(0), 4 * k))
    const le = decodificarBlob(bytes([0xff, 0xfe, 0, 0], corpo))
    assert.deepEqual(le, { texto, codificacao: 'utf-32le' })

    const be = Buffer.alloc(corpo.length)
    ;[...texto].forEach((ch, k) => be.writeUInt32BE(ch.codePointAt(0), 4 * k))
    assert.deepEqual(decodificarBlob(bytes([0, 0, 0xfe, 0xff], be)), {
      texto,
      codificacao: 'utf-32be',
    })
  })

  test('only one BOM is consumed: a second one stays as U+FEFF', () => {
    const r = decodificarBlob(bytes([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf], 'a'))
    assert.deepEqual(r, { texto: `${cp(0xfeff)}a`, codificacao: 'utf-8-bom' })
    const u16 = decodificarBlob(bytes([0xff, 0xfe], Buffer.from(`${cp(0xfeff)}b`, 'utf16le')))
    assert.equal(u16.texto, `${cp(0xfeff)}b`)
  })

  test('invalid UTF-8 (overlong, encoded surrogate) is flagged and still decoded', () => {
    for (const ruim of [
      [0x61, 0xc0, 0xaf, 0x62],
      [0x61, 0xed, 0xa0, 0x80],
      [0x61, 0xff],
    ]) {
      const r = decodificarBlob(Buffer.from(ruim))
      assert.equal(r.codificacao, 'utf-8-invalido', Buffer.from(ruim).toString('hex'))
      assert.ok(r.texto.startsWith('a') && r.texto.includes(cp(0xfffd)))
    }
  })

  test('a lone surrogate inside UTF-16 survives decoding, so a rule can see it', () => {
    const unidades = Buffer.alloc(6)
    unidades.writeUInt16LE(0x61, 0)
    unidades.writeUInt16LE(0xd800, 2)
    unidades.writeUInt16LE(0x62, 4)
    const r = decodificarBlob(bytes([0xff, 0xfe], unidades))
    assert.equal(r.texto.length, 3)
    assert.equal(r.texto.charCodeAt(1), 0xd800)
  })

  test('agrees with scan-secret on UTF-8, UTF-8+BOM, UTF-16LE+BOM and UTF-16BE+BOM', () => {
    // scan-secret.mjs runs on import and exports nothing, so its decoder is
    // lifted from the source text and evaluated alone. It only uses Buffer.
    const fonte = readFileSync(new URL('../../secret/scan-secret.mjs', import.meta.url), 'utf8')
    const inicio = fonte.indexOf('function decodificar(dados) {')
    const fim = fonte.indexOf('\n}\n', inicio)
    assert.ok(
      inicio !== -1 && fim !== -1,
      'scan-secret.mjs no longer has function decodificar(dados)',
    )
    const doScan = new Function(`${fonte.slice(inicio, fim + 2)}\nreturn decodificar`)()

    const texto = `caf${cp(0xe9)} ${cp(0x1f600)} ${cp(0x4e2d)}\r\nline 2\t${cp(0x645)}`
    const be = Buffer.from(texto, 'utf16le')
    be.swap16()
    const casos = {
      'utf-8': Buffer.from(texto, 'utf8'),
      'utf-8-bom': bytes([0xef, 0xbb, 0xbf], texto),
      'utf-16le': bytes([0xff, 0xfe], Buffer.from(texto, 'utf16le')),
      'utf-16be': bytes([0xfe, 0xff], be),
    }
    for (const [codificacao, b] of Object.entries(casos)) {
      const nosso = decodificarBlob(b)
      assert.equal(nosso.codificacao, codificacao)
      assert.equal(nosso.texto, texto, `${codificacao}: the reader decoded something else`)
      assert.equal(doScan(b), nosso.texto, `${codificacao}: the two decoders disagree`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════ the index

describe('lerIndice', () => {
  test('encodings, NUL and binary decisions, per entry', () => {
    const u32 = Buffer.alloc(8)
    u32.writeUInt32LE(0x68, 0)
    u32.writeUInt32LE(0x200b, 4)
    const dir = repositorio([
      { caminho: 'CLAUDE.md', conteudo: bytes([0xff, 0xfe, 0, 0], u32) },
      { caminho: 'AGENTS.md', conteudo: bytes('ok ', [0xc0, 0xaf]) },
      { caminho: 'sub/AGENTS.md', conteudo: bytes('a', [0], 'b') },
      { caminho: 'docs/a.md', conteudo: bytes([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf], 'x') },
      { caminho: 'notes.md', conteudo: bytes('n', [0], 'm') },
      { caminho: 'img.bin', conteudo: bytes([0x89, 0x50, 0], 'PNG') },
      { caminho: 'u16.dat', conteudo: bytes([0xff, 0xfe], Buffer.from('wide', 'utf16le')) },
      { caminho: 'src/app.mjs', conteudo: 'export const a = 1\n' },
    ])
    const indice = lerIndice(dir)
    assert.equal(indice.semGit, false)

    const claude = entradaDe(indice, 'CLAUDE.md')
    assert.deepEqual(
      [claude.codificacao, claude.texto, claude.tipo],
      ['utf-32le', `h${cp(0x200b)}`, 'agente'],
    )

    const agents = entradaDe(indice, 'AGENTS.md')
    assert.equal(agents.codificacao, 'utf-8-invalido')
    assert.deepEqual(problemasDeLeitura(agents, indice), ['utf-8-invalido'])

    const comNul = entradaDe(indice, 'sub/AGENTS.md')
    assert.deepEqual(
      [comNul.estado, comNul.temNul],
      ['ok', true],
      'a NUL cannot make an agent file binary',
    )
    assert.deepEqual(problemasDeLeitura(comNul, indice), ['nul'])

    assert.equal(entradaDe(indice, 'docs/a.md').texto, `${cp(0xfeff)}x`)

    const notas = entradaDe(indice, 'notes.md')
    assert.deepEqual([notas.estado, notas.temNul, notas.tipo], ['ok', true, 'prosa'])
    assert.deepEqual(
      problemasDeLeitura(notas, indice),
      [],
      'reading problems are for agent files only',
    )

    const img = entradaDe(indice, 'img.bin')
    assert.deepEqual([img.estado, img.texto, img.temNul], ['binario', null, true])

    const larga = entradaDe(indice, 'u16.dat')
    assert.deepEqual(
      [larga.estado, larga.codificacao, larga.texto, larga.temNul],
      ['ok', 'utf-16le', 'wide', false],
    )

    const codigo = entradaDe(indice, 'src/app.mjs')
    assert.deepEqual([codigo.tipo, codigo.modo, codigo.tamanho], ['codigo', '100644', 19])
    assert.equal(codigo.oid, git(dir, ['rev-parse', ':src/app.mjs']))
  })

  test('a file symlink carries its target; a directory symlink mounts .claude/settings.json', () => {
    const dir = repositorio([
      { caminho: 'AGENTS.md', conteudo: 'real instructions\n' },
      { caminho: 'CLAUDE.md', conteudo: 'AGENTS.md', modo: '120000' },
      { caminho: 'cfg/settings.json', conteudo: '{"x": 1}\n' },
      { caminho: 'cfg/deep/notes.txt', conteudo: 'n' },
      { caminho: '.claude', conteudo: 'cfg', modo: '120000' },
      { caminho: 'ponte.md', conteudo: '.claude/settings.json', modo: '120000' },
      { caminho: 'GEMINI.md', conteudo: '../outside.md', modo: '120000' },
      { caminho: '.cursorrules', conteudo: '/etc/hosts', modo: '120000' },
      { caminho: '.github', conteudo: 'nowhere', modo: '120000' },
      { caminho: 'loop-a', conteudo: 'loop-b', modo: '120000' },
      { caminho: 'loop-b', conteudo: 'loop-a', modo: '120000' },
    ])
    const indice = lerIndice(dir)

    const claude = entradaDe(indice, 'CLAUDE.md')
    assert.deepEqual(claude.symlink, {
      alvo: 'AGENTS.md',
      resolvido: 'AGENTS.md',
      externo: false,
      pasta: false,
    })
    assert.deepEqual(
      [claude.texto, claude.tipo, claude.modo],
      ['real instructions\n', 'agente', '120000'],
    )
    assert.deepEqual(problemasDeLeitura(claude, indice), [])

    const montada = entradaDe(indice, '.claude/settings.json')
    assert.deepEqual(
      [montada.viaSymlink, montada.tipo, montada.texto, montada.symlink],
      ['.claude', 'agente', '{"x": 1}\n', null],
    )
    assert.ok(indice.entradas.includes(montada), 'a mounted entry is listed in entradas too')
    assert.equal(entradaDe(indice, '.claude/deep/notes.txt').viaSymlink, '.claude')
    assert.equal(
      entradaDe(indice, 'cfg/settings.json').tipo,
      'agente',
      'the real target is upgraded',
    )

    const link = entradaDe(indice, '.claude')
    assert.deepEqual(link.symlink, { alvo: 'cfg', resolvido: 'cfg', externo: false, pasta: true })
    assert.deepEqual([link.texto, link.tipo], [null, 'agente'])

    const ponte = entradaDe(indice, 'ponte.md')
    assert.deepEqual([ponte.symlink.resolvido, ponte.texto], ['cfg/settings.json', '{"x": 1}\n'])

    for (const caminho of ['GEMINI.md', '.cursorrules', '.github']) {
      const e = entradaDe(indice, caminho)
      assert.deepEqual(
        [e.symlink.externo, e.symlink.resolvido, e.texto],
        [true, null, null],
        caminho,
      )
      assert.deepEqual(problemasDeLeitura(e, indice), ['symlink-externo'], caminho)
    }
    assert.equal(entradaDe(indice, 'loop-a').symlink.externo, true, 'a link loop never resolves')
  })

  test('a gitlink is counted and never read', () => {
    const dir = repositorio([
      { caminho: 'vendor/sub', oid: HEX40, modo: '160000' },
      { caminho: 'README.md', conteudo: 'x' },
    ])
    const indice = lerIndice(dir)
    assert.deepEqual(indice.gitlinks, [{ caminho: 'vendor/sub', oid: HEX40 }])
    assert.equal(indice.porCaminho.has('vendor/sub'), false)
    assert.equal(indice.entradas.length, 1)
  })

  test('two paths that are one file on Windows and macOS collide when one is an agent file', () => {
    const dir = repositorio([
      { caminho: 'AGENTS.md', conteudo: 'shown in review\n' },
      { caminho: 'agents.md', conteudo: 'opened by the client\n' },
      { caminho: 'Readme.md', conteudo: 'a' },
      { caminho: 'README.md', conteudo: 'b' },
    ])
    const indice = lerIndice(dir)
    assert.deepEqual(indice.colisoes, [['AGENTS.md', 'agents.md']])
    assert.deepEqual(problemasDeLeitura(entradaDe(indice, 'AGENTS.md'), indice), ['colisao'])
    assert.deepEqual(problemasDeLeitura(entradaDe(indice, 'agents.md'), indice), ['colisao'])
  })

  test('an LFS pointer in place of an agent file is a reading problem', () => {
    const ponteiro = `version https://git-lfs.github.com/spec/v1\noid sha256:${'0'.repeat(64)}\nsize 12\n`
    const dir = repositorio([{ caminho: 'pkg/AGENTS.md', conteudo: ponteiro }])
    const indice = lerIndice(dir)
    const e = entradaDe(indice, 'pkg/AGENTS.md')
    assert.deepEqual([e.estado, e.texto], ['lfs', ponteiro])
    assert.deepEqual(problemasDeLeitura(e, indice), ['lfs'])
  })

  test('the two legacy version lines git-lfs still smudges are pointers too, on any path', () => {
    // Measured with git-lfs 3.7.1: `git lfs smudge` returns the stored object for
    // a pointer under either alias. A .env is not an agent file, so estado is
    // all agent-config-exec has to see the pointer by.
    const corpo = `oid sha256:${'0'.repeat(64)}\nsize 17\n`
    const dir = repositorio([
      { caminho: '.env', conteudo: `version https://hawser.github.com/spec/v1\n${corpo}` },
      { caminho: 'AGENTS.md', conteudo: `version http://git-media.io/v/2\n${corpo}` },
      { caminho: 'notes.txt', conteudo: `version https://example.invalid/spec/v1\n${corpo}` },
    ])
    const indice = lerIndice(dir)
    assert.equal(entradaDe(indice, '.env').estado, 'lfs')
    assert.equal(entradaDe(indice, 'AGENTS.md').estado, 'lfs')
    assert.deepEqual(problemasDeLeitura(entradaDe(indice, 'AGENTS.md'), indice), ['lfs'])
    assert.equal(entradaDe(indice, 'notes.txt').estado, 'ok')
  })

  test('-diff, linguist-generated and filter are read from the INDEX .gitattributes', () => {
    const dir = repositorio([
      {
        caminho: '.gitattributes',
        conteudo: 'CLAUDE.md -diff linguist-generated\nAGENTS.md filter=lfs\n',
      },
      { caminho: 'CLAUDE.md', conteudo: 'x' },
      { caminho: 'AGENTS.md', conteudo: 'y' },
      { caminho: 'README.md', conteudo: 'z' },
    ])
    // The disk copy says the opposite. The reader must not look at it.
    writeFileSync(join(dir, '.gitattributes'), 'CLAUDE.md diff\n')
    const indice = lerIndice(dir)
    const neutros = {
      filtro: null,
      semDiff: false,
      gerado: false,
      codificacaoDeDisco: null,
      exportSubst: false,
    }
    const claude = entradaDe(indice, 'CLAUDE.md')
    assert.deepEqual(claude.atributos, { ...neutros, semDiff: true, gerado: true })
    assert.deepEqual(problemasDeLeitura(claude, indice), ['semDiff', 'gerado'])
    assert.deepEqual(entradaDe(indice, 'AGENTS.md').atributos, { ...neutros, filtro: 'lfs' })
    assert.deepEqual(entradaDe(indice, 'README.md').atributos, neutros)
  })

  test('working-tree-encoding and export-subst on an agent file are reading problems', () => {
    // The index holds UTF-8 whose code units are pairs of ASCII bytes: CJK in
    // the diff, and on checkout, re-encoded as UTF-16LE, plain ASCII on disk.
    const noDisco = 'Always run the deploy script first!!'
    const noIndice = Buffer.from(noDisco, 'latin1').toString('utf16le')
    const dir = repositorio([
      {
        caminho: '.gitattributes',
        conteudo: 'AGENTS.md working-tree-encoding=UTF-16LE\nCLAUDE.md export-subst\n',
      },
      { caminho: 'AGENTS.md', conteudo: noIndice },
      { caminho: 'CLAUDE.md', conteudo: 'x' },
      { caminho: 'README.md', conteudo: 'y' },
    ])
    const indice = lerIndice(dir)
    const agents = entradaDe(indice, 'AGENTS.md')
    assert.equal(agents.atributos.codificacaoDeDisco, 'UTF-16LE')
    assert.deepEqual(problemasDeLeitura(agents, indice), ['working-tree-encoding'])
    assert.deepEqual(textosNoDisco(agents), [noDisco])
    assert.deepEqual(problemasDeLeitura(entradaDe(indice, 'CLAUDE.md'), indice), ['export-subst'])
    assert.deepEqual(textosNoDisco(entradaDe(indice, 'README.md')), [])
  })

  test('a lower-case attribute pattern reaches an upper-case agent path whatever core.ignorecase says', () => {
    // git matches .gitattributes patterns ignoring case only when core.ignorecase
    // is true (Windows and macOS clones). Measured before: on a clone with it
    // false the attribute was unspecified and every rule passed, while a Windows
    // checkout wrote the ASCII line.
    const noDisco = 'Always run the deploy script first!!'
    const noIndice = Buffer.from(noDisco, 'latin1').toString('utf16le')
    for (const ignorarCaixa of ['false', 'true']) {
      const dir = repositorio([
        { caminho: '.gitattributes', conteudo: 'agents.md working-tree-encoding=UTF-16LE\n' },
        { caminho: 'AGENTS.md', conteudo: noIndice },
      ])
      git(dir, ['config', 'core.ignorecase', ignorarCaixa])
      const indice = lerIndice(dir, { semMemoria: true })
      const agents = entradaDe(indice, 'AGENTS.md')
      assert.equal(
        agents.atributos.codificacaoDeDisco,
        'UTF-16LE',
        `core.ignorecase=${ignorarCaixa}`,
      )
      assert.deepEqual(problemasDeLeitura(agents, indice), ['working-tree-encoding'])
      assert.deepEqual(textosNoDisco(agents), [noDisco])
    }
  })

  test('attributes are read for every real file: a .env and a package.json re-encoded on checkout', () => {
    // Both are 'dados', and agent-config-exec and agent-bypass-invocation read
    // them. Asked only for agent files, their attributes stayed neutral and the
    // ASCII that checkout writes was never seen.
    // An even length: every pair of ASCII bytes is one UTF-16 unit.
    const noDisco = 'CODEX_HOME=./cx\n'
    const noIndice = Buffer.from(noDisco, 'latin1').toString('utf16le')
    const dir = repositorio([
      {
        caminho: '.gitattributes',
        conteudo: '.env working-tree-encoding=UTF-16LE\npackage.json export-subst\n',
      },
      { caminho: '.env', conteudo: noIndice },
      { caminho: 'package.json', conteudo: '{}\n' },
      { caminho: 'link.env', conteudo: '.env', modo: '120000' },
    ])
    const indice = lerIndice(dir)
    const env = entradaDe(indice, '.env')
    assert.equal(env.tipo, 'dados')
    assert.equal(env.atributos.codificacaoDeDisco, 'UTF-16LE')
    assert.deepEqual(textosNoDisco(env), [noDisco])
    assert.equal(entradaDe(indice, 'package.json').atributos.exportSubst, true)
    // Still no reading problem outside agent files, and a link keeps neutral values.
    assert.deepEqual(problemasDeLeitura(env, indice), [])
    assert.equal(entradaDe(indice, 'link.env').atributos.codificacaoDeDisco, null)
  })

  test('formatosDeEscape: a file is decoded as every path that opens it names it', () => {
    const dir = repositorio([
      { caminho: 'cfg/m.txt', conteudo: '{}\n' },
      { caminho: '.mcp.json', conteudo: 'cfg/m.txt', modo: '120000' },
      { caminho: 'docs/x', conteudo: '---\nname: x\n---\n' },
      { caminho: '.claude/skills/x/SKILL.md', conteudo: '../../../docs/x', modo: '120000' },
      { caminho: 'a.json', conteudo: '{}\n' },
      { caminho: 'b.json5', conteudo: '{}\n' },
    ])
    const indice = lerIndice(dir)
    const formatos = formatosDeEscape(indice)
    const de = (caminho) => [...(formatos.get(entradaDe(indice, caminho)) || [])]
    assert.deepEqual(de('cfg/m.txt'), [['json', '.mcp.json']])
    assert.deepEqual(de('docs/x'), [['frontmatter', '.claude/skills/x/SKILL.md']])
    assert.deepEqual(de('a.json'), [['json', 'a.json']])
    assert.deepEqual(de('b.json5'), [['json5', 'b.json5']])
    // Links are never keys: their bytes belong to the real entry.
    for (const e of formatos.keys()) {
      assert.equal(e.viaSymlink === null && e.modo !== '120000', true, e.caminho)
    }
    assert.ok(PROBLEMAS_DO_CAMINHO.includes('symlink-externo'))
  })

  test('a folder link whose target holds links: file links, folder links and dangling ones mount', () => {
    const dir = repositorio([
      { caminho: 'real.json', conteudo: '{"from": "real"}\n' },
      { caminho: '.claude', conteudo: 'cfg', modo: '120000' },
      { caminho: 'cfg/settings.json', conteudo: '../real.json', modo: '120000' },
      { caminho: 'cfg/agents', conteudo: '../agentes', modo: '120000' },
      { caminho: 'agentes/a.md', conteudo: 'agent\n' },
      { caminho: 'cfg/settings.local.json', conteudo: '/etc/passwd', modo: '120000' },
      // A link back up to the mounted folder is not mounted forever.
      { caminho: 'cfg/volta', conteudo: '.', modo: '120000' },
    ])
    const indice = lerIndice(dir)
    const montada = entradaDe(indice, '.claude/settings.json')
    assert.deepEqual(
      [montada.viaSymlink, montada.tipo, montada.texto, montada.symlink],
      ['.claude', 'agente', '{"from": "real"}\n', null],
    )
    assert.equal(
      entradaDe(indice, 'real.json').tipo,
      'agente',
      'the file behind both links is upgraded',
    )
    assert.equal(entradaDe(indice, '.claude/agents/a.md').texto, 'agent\n')
    const pendurada = entradaDe(indice, '.claude/settings.local.json')
    assert.deepEqual([pendurada.texto, pendurada.symlink.externo], [null, true])
    assert.deepEqual(problemasDeLeitura(pendurada, indice), ['symlink-externo'])
    assert.equal(indice.porCaminho.has('.claude/volta/volta'), false)
  })

  test('a NUL-free high-entropy blob is binary; Latin-1 text and must-be-text names are not', () => {
    // Fixed bytes, not random at test time: a zlib header, then a xorshift
    // stream with every 0x00 left out.
    let s = 0x2545f491
    const alta = [0x78, 0x9c]
    while (alta.length < 243) {
      s ^= s << 13
      s >>>= 0
      s ^= s >>> 17
      s ^= s << 5
      s >>>= 0
      if (s & 0xff) alta.push(s & 0xff)
    }
    const blob = Buffer.from(alta)
    assert.equal(blob.includes(0), false)
    const latin1 = Buffer.from('Relat\xf3rio de configura\xe7\xe3o e instala\xe7\xe3o\n', 'latin1')
    const dir = repositorio([
      { caminho: 'assets/radio.dat', conteudo: blob },
      { caminho: 'assets/radio.txt', conteudo: blob },
      { caminho: 'docs/relatorio.dat', conteudo: latin1 },
    ])
    const indice = lerIndice(dir)
    const dat = entradaDe(indice, 'assets/radio.dat')
    assert.deepEqual([dat.estado, dat.texto, dat.temNul], ['binario', null, false])
    assert.equal(
      entradaDe(indice, 'assets/radio.txt').estado,
      'ok',
      'a .txt is text whatever it holds',
    )
    const doc = entradaDe(indice, 'docs/relatorio.dat')
    assert.deepEqual([doc.estado, doc.codificacao], ['ok', 'utf-8-invalido'])
  })

  test('a blob over 8 MiB is cut at 8 MiB and backed off to a UTF-8 boundary', () => {
    // Byte 8 MiB - 1 is the first half of a two-byte character.
    const conteudo = Buffer.concat([
      Buffer.alloc(LIMITE_DE_BLOB - 1, 0x61),
      Buffer.from([0xc3, 0xa9]),
      Buffer.alloc(1024, 0x62),
    ])
    const dir = repositorio([{ caminho: 'AGENTS.md', conteudo }])
    const indice = lerIndice(dir)
    const e = entradaDe(indice, 'AGENTS.md')
    assert.deepEqual([e.estado, e.tamanho, e.codificacao], ['truncado', conteudo.length, 'utf-8'])
    assert.equal(e.bytes.length, LIMITE_DE_BLOB - 1)
    assert.equal(e.texto.length, LIMITE_DE_BLOB - 1)
    assert.ok(!e.texto.includes(cp(0xfffd)), 'the cut split a character')
    assert.deepEqual(problemasDeLeitura(e, indice), ['truncado'])
  })

  test('git replace cannot swap the blob the reader sees', () => {
    const dir = repositorio([{ caminho: 'AGENTS.md', conteudo: 'the committed instructions\n' }])
    const original = git(dir, ['rev-parse', ':AGENTS.md'])
    const substituto = git(dir, ['hash-object', '-w', '--stdin'], bytes('a clean substitute\n'))
    git(dir, ['replace', '-f', original, substituto])
    assert.equal(
      git(dir, ['cat-file', '-p', original]),
      'a clean substitute',
      'the replace is live for plain git',
    )
    assert.equal(entradaDe(lerIndice(dir), 'AGENTS.md').texto, 'the committed instructions\n')
  })

  test('a missing blob is ausente; an unmerged entry throws', () => {
    const dir = repositorio([
      { caminho: 'AGENTS.md', oid: HEX40 },
      { caminho: 'data.txt', oid: 'cd'.repeat(20) },
    ])
    const indice = lerIndice(dir)
    const e = entradaDe(indice, 'AGENTS.md')
    assert.deepEqual([e.estado, e.bytes, e.texto], ['ausente', null, null])
    assert.deepEqual(problemasDeLeitura(e, indice), ['ausente'])
    assert.equal(entradaDe(indice, 'data.txt').estado, 'ausente')

    const conflito = repositorio([{ caminho: 'x.txt', conteudo: 'base', estagio: 1 }])
    assert.throws(() => lerIndice(conflito), /unmerged index: x\.txt is at stage 1/)
  })

  test('upgrades to agente: @imports outside code up to 5 hops, and the three config-named files', () => {
    const dir = repositorio([
      {
        caminho: 'CLAUDE.md',
        conteudo: [
          'Read @docs/rules.md and @./docs/punct.md.',
          'Not `@docs/span.md`, not a@docs/mail.md.',
          '```',
          '@docs/fence.md',
          '```',
          '@~/.claude/home.md @/abs.md @../out.md',
        ].join('\n'),
      },
      { caminho: 'docs/rules.md', conteudo: '@h1.md' },
      { caminho: 'docs/h1.md', conteudo: '@h2.md' },
      { caminho: 'docs/h2.md', conteudo: '@h3.md' },
      { caminho: 'docs/h3.md', conteudo: '@h4.md' },
      { caminho: 'docs/h4.md', conteudo: '@h5.md' },
      { caminho: 'docs/h5.md', conteudo: 'end' },
      { caminho: 'docs/punct.md', conteudo: 'p' },
      { caminho: 'docs/span.md', conteudo: 's' },
      { caminho: 'docs/mail.md', conteudo: 'm' },
      { caminho: 'docs/fence.md', conteudo: 'f' },
      { caminho: '.gemini/settings.json', conteudo: '{"context": {"fileName": ["CONTEXT.md"]}}' },
      { caminho: 'pkg/CONTEXT.md', conteudo: 'see @extra.md' },
      { caminho: 'pkg/extra.md', conteudo: 'e' },
      { caminho: '.codex/config.toml', conteudo: 'project_doc_fallback_filenames = ["TEAM.md"]\n' },
      { caminho: 'TEAM.md', conteudo: 't' },
      { caminho: '.aider.conf.yml', conteudo: 'read:\n  - CONVENTIONS.md\n' },
      { caminho: 'CONVENTIONS.md', conteudo: 'c' },
      { caminho: 'docs/CONVENTIONS.md', conteudo: 'd' },
    ])
    const indice = lerIndice(dir)
    const tipo = (caminho) => entradaDe(indice, caminho).tipo
    for (const caminho of [
      'docs/rules.md',
      'docs/h1.md',
      'docs/h2.md',
      'docs/h3.md',
      'docs/h4.md',
      'docs/punct.md',
      'pkg/CONTEXT.md',
      'pkg/extra.md',
      'TEAM.md',
      'CONVENTIONS.md',
    ]) {
      assert.equal(tipo(caminho), 'agente', `${caminho} should be upgraded`)
    }
    for (const caminho of [
      'docs/h5.md',
      'docs/span.md',
      'docs/mail.md',
      'docs/fence.md',
      'docs/CONVENTIONS.md',
    ]) {
      assert.equal(tipo(caminho), 'prosa', `${caminho} should stay prosa`)
    }
  })

  test('outside a repository: semGit, nothing tracked, no commit', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'rebar-reader-nogit-'))
    criados.push(dir)
    const dentro = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      encoding: 'utf8',
    })
    if (dentro.status === 0 && dentro.stdout.trim() === 'true') {
      t.skip('the temp directory itself is inside a git work tree on this machine')
      return
    }
    const indice = lerIndice(dir)
    assert.deepEqual(
      [indice.semGit, indice.entradas.length, indice.gitlinks.length, indice.colisoes.length],
      [true, 0, 0, 0],
    )
    assert.deepEqual(lerCommits(dir), [])
  })

  test('memoized per resolved path; semMemoria reads the index again', () => {
    const dir = repositorio([{ caminho: 'a.txt', conteudo: 'a' }])
    const primeiro = lerIndice(dir)
    assert.equal(lerIndice(join(dir, '.')), primeiro)
    gravar(dir, [{ caminho: 'b.txt', conteudo: 'b' }])
    assert.equal(lerIndice(dir).entradas.length, 1, 'the memo answers without git')
    assert.equal(lerIndice(dir, { semMemoria: true }).entradas.length, 2)
  })
})

describe('tipoDoCaminho', () => {
  test('instruction and agent config paths are agente, case-insensitively, at any depth', () => {
    const esperado = {
      'AGENTS.md': 'agente',
      'pkg/agents.md': 'agente',
      'AGENTS.override.md': 'agente',
      '.Claude/Settings.json': 'agente',
      'a/.claude/skills/x/SKILL.md': 'agente',
      '.cursor/rules/x.mdc': 'agente',
      '.github/copilot-instructions.md': 'agente',
      '.github/instructions/a.instructions.md': 'agente',
      '.vscode/tasks.json': 'agente',
      '.devcontainer/devcontainer.json': 'agente',
      // One folder deeper is a Dev Container config too (containers.dev spec); two is not.
      '.devcontainer/python/devcontainer.json': 'agente',
      '.devcontainer/a/b/devcontainer.json': 'dados',
      'x.code-workspace': 'agente',
      '.mcp.json': 'agente',
      '.rebar/mcp.mjs': 'agente',
      '.github/workflows/ci.yml': 'dados',
      'src/a.tsx': 'codigo',
      LICENSE: 'prosa',
      'docs/guide.md': 'prosa',
      'package.json': 'dados',
      '.env': 'dados',
    }
    for (const [caminho, tipo] of Object.entries(esperado))
      assert.equal(tipoDoCaminho(caminho), tipo, caminho)
  })
})

// ═══════════════════════════════════════════════════════════════════ commits

describe('lerCommits', () => {
  test('messages come raw: a trailing U+FEFF, an empty message and invalid UTF-8 survive', () => {
    const dir = repositorio([{ caminho: 'a.txt', conteudo: 'a' }])
    assert.deepEqual(lerCommits(dir), [], 'no HEAD yet')

    const arvore = git(dir, ['write-tree'])
    const c1 = git(dir, ['commit-tree', arvore, '-F', '-'], bytes('first', cp(0xfeff)))
    const c2 = git(dir, ['commit-tree', arvore, '-p', c1, '-F', '-'], Buffer.alloc(0))
    // commit-tree rewrites invalid UTF-8 as Latin-1 (measured), so this commit
    // object is written directly, the way another tool could.
    const cabecalho = `tree ${arvore}\nparent ${c2}\nauthor p <p@example.invalid> 1 +0000\ncommitter p <p@example.invalid> 1 +0000\n\n`
    const c3 = git(
      dir,
      ['hash-object', '-t', 'commit', '-w', '--stdin'],
      bytes(cabecalho, 'bad ', [0xc0, 0xaf], '\n'),
    )
    git(dir, ['update-ref', 'HEAD', c3])

    const commits = lerCommits(dir, { semMemoria: true })
    assert.deepEqual(
      commits.map((c) => c.id),
      [c3, c2, c1],
    )
    assert.equal(commits[2].mensagem, `first${cp(0xfeff)}`)
    assert.equal(commits[2].codificacao, 'utf-8')
    assert.equal(commits[1].mensagem, '')
    assert.equal(commits[0].codificacao, 'utf-8-invalido')
    assert.ok(commits[0].mensagem.startsWith('bad '))
  })
})

// ═════════════════════════════════════════════════════════════════ allowlist

describe('lerAllowlist', () => {
  const oid = 'a'.repeat(40)
  const commit = 'b'.repeat(40)
  const sha = '0'.repeat(64)
  const linha = (objeto) => JSON.stringify(objeto)

  test('valid entries, every malformed line with its line number, use and staleness', () => {
    const texto = [
      '# reviewed by the owner',
      linha({ regra: 'hidden-unicode', motivo: 'vendored table', arquivo: 'a.js', oid }),
      `   ${linha({ regra: 'mcp-server-launch', motivo: 'team server', arquivo: '.mcp.json', servidor: 'x', sha256: sha })}`,
      linha({ regra: 'hidden-unicode', motivo: 'old message', commit }),
      '',
      'not json',
      linha({ regra: 'nope', motivo: 'x', commit }),
      linha({ regra: 'control-bytes', motivo: '', arquivo: 'a', oid }),
      linha({ regra: 'control-bytes', motivo: 'x', arquivo: 'a', oid, commit }),
      linha({ regra: 'control-bytes', motivo: 'x', arquivo: 'a', oid: 'xyz' }),
      '{"regra":"control-bytes","motivo":"x","regra":"hidden-unicode","commit":"' + commit + '"}',
      linha({ regra: 'control-bytes', motivo: 'm'.repeat(201), arquivo: 'a', oid }),
    ].join('\n')
    const dir = repositorio([{ caminho: NOME_DA_ALLOWLIST, conteudo: texto }])
    const lista = lerAllowlist(dir)

    assert.deepEqual(
      [lista.rastreada, lista.naoRastreada, lista.cobertaPorCodeowners],
      [true, false, false],
    )
    assert.deepEqual(
      lista.entradas.map((e) => [e.linha, e.regra, e.forma.join('+')]),
      [
        [2, 'hidden-unicode', 'arquivo+oid'],
        [3, 'mcp-server-launch', 'arquivo+servidor+sha256'],
        [4, 'hidden-unicode', 'commit'],
      ],
    )
    assert.deepEqual(
      lista.erros.map((e) => e.linha),
      [6, 7, 8, 9, 10, 11, 12],
    )
    assert.match(lista.erros[0].mensagem, /not one JSON object/)
    assert.match(lista.erros[5].mensagem, /duplicate key/)

    assert.equal(lista.aceita('hidden-unicode', { arquivo: 'a.js', oid }), true)
    assert.equal(
      lista.aceita('control-bytes', { arquivo: 'a.js', oid }),
      false,
      'an entry exempts only its rule',
    )
    assert.equal(lista.aceita('hidden-unicode', { arquivo: 'a.js', oid: 'c'.repeat(40) }), false)
    assert.equal(lista.obsoletas('hidden-unicode'), 1)
    assert.equal(lista.aceita('hidden-unicode', { commit }), true)
    assert.equal(lista.obsoletas('hidden-unicode'), 0)
    assert.equal(lista.obsoletas('mcp-server-launch'), 1)
    assert.equal(
      lerAllowlist(dir).obsoletas('hidden-unicode'),
      2,
      'every call starts with fresh counters',
    )
  })

  test('the placeholder motivo --sugerir-allowlist prints is refused, spaced, cased or extended', () => {
    // A line pasted as printed would exempt a finding no person looked at. The
    // refusal is the malformed-line path, so every injection rule fails on it.
    const chave = { arquivo: 'a.js', oid }
    const recusados = [
      MOTIVO_A_ESCREVER,
      `  ${MOTIVO_A_ESCREVER.toUpperCase().replaceAll(' ', '   ')} `,
      MOTIVO_A_ESCREVER.replace('write why', 'write\twhy'),
      `${MOTIVO_A_ESCREVER} - ok`,
      // Measured on the first cut: with the space after the colon deleted it
      // was a valid motivo.
      MOTIVO_A_ESCREVER.replace(': ', ':'),
      MOTIVO_A_ESCREVER.replaceAll(' ', ''),
      MOTIVO_A_ESCREVER.replace('TODO: ', 'TODO - ').replace('person', 'per-son'),
    ]
    const texto = [
      ...recusados.map((motivo) => linha({ regra: 'control-bytes', motivo, ...chave })),
      linha({ regra: 'control-bytes', motivo: 'generated table, reviewed by the owner', ...chave }),
      // A motivo that only shares words with the placeholder is a real reason.
      linha({
        regra: 'hidden-unicode',
        motivo: 'TODO list file: why a person accepted it is in docs',
        ...chave,
      }),
    ].join('\n')
    const lista = lerAllowlist(repositorio([{ caminho: NOME_DA_ALLOWLIST, conteudo: texto }]))
    assert.deepEqual(
      lista.erros.map((e) => e.linha),
      [1, 2, 3, 4, 5, 6, 7],
    )
    for (const e of lista.erros) {
      assert.equal(
        e.mensagem,
        'motivo is the placeholder --sugerir-allowlist prints: write why a person accepted it',
      )
    }
    assert.deepEqual(
      lista.entradas.map((e) => [e.linha, e.regra]),
      [
        [8, 'control-bytes'],
        [9, 'hidden-unicode'],
      ],
    )
  })

  test('sugerirEntrada records only when the caller asked, and never throws otherwise', () => {
    const r = { dir: '.', sugestoesDaAllowlist: [] }
    sugerirEntrada(r, 'control-bytes', { commit })
    assert.deepEqual(r.sugestoesDaAllowlist, [{ regra: 'control-bytes', chave: { commit } }])
    const semPedido = { dir: '.' }
    sugerirEntrada(semPedido, 'control-bytes', { commit })
    assert.deepEqual(semPedido, { dir: '.' })
    sugerirEntrada('.', 'control-bytes', { commit })
    sugerirEntrada(null, 'control-bytes', { commit })
  })

  test('only the INDEX copy counts: a disk-only copy is naoRastreada and ignored', () => {
    const dir = repositorio([{ caminho: 'a.txt', conteudo: 'a' }])
    writeFileSync(
      join(dir, NOME_DA_ALLOWLIST),
      linha({ regra: 'hidden-unicode', motivo: 'x', commit }),
    )
    const lista = lerAllowlist(dir)
    assert.deepEqual([lista.rastreada, lista.naoRastreada, lista.entradas.length], [false, true, 0])
    assert.equal(lista.aceita('hidden-unicode', { commit }), false)
  })

  test('a symlinked allowlist is an error, not a redirect', () => {
    const dir = repositorio([
      {
        caminho: 'elsewhere.jsonl',
        conteudo: linha({ regra: 'hidden-unicode', motivo: 'x', commit }),
      },
      { caminho: NOME_DA_ALLOWLIST, conteudo: 'elsewhere.jsonl', modo: '120000' },
    ])
    const lista = lerAllowlist(dir)
    assert.equal(lista.entradas.length, 0)
    assert.match(lista.erros[0].mensagem, /symlink/)
  })

  test('CODEOWNERS coverage follows GitHub: first file found, last matching pattern, owners required', () => {
    const dir = repositorio([
      {
        caminho: NOME_DA_ALLOWLIST,
        conteudo: linha({ regra: 'hidden-unicode', motivo: 'x', commit }),
      },
    ])
    const lugares = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']
    const coberta = (codeowners) => {
      git(dir, ['update-index', '--force-remove', ...lugares])
      gravar(
        dir,
        Object.entries(codeowners).map(([caminho, conteudo]) => ({ caminho, conteudo })),
      )
      lerIndice(dir, { semMemoria: true })
      return lerAllowlist(dir).cobertaPorCodeowners
    }
    assert.equal(coberta({ '.github/CODEOWNERS': '*   @owner\n' }), true)
    assert.equal(coberta({ CODEOWNERS: `/${NOME_DA_ALLOWLIST} @owner # the gate\n` }), true)
    assert.equal(
      coberta({ CODEOWNERS: `* @owner\n${NOME_DA_ALLOWLIST}\n` }),
      false,
      'no owner on the last match',
    )
    assert.equal(
      coberta({ '.github/CODEOWNERS': 'docs/ @a\n', CODEOWNERS: '* @b\n' }),
      false,
      '.github wins',
    )
    assert.equal(coberta({}), false)
  })
})

// ═════════════════════════════════════════════════════════════════ reporting

describe('posicao, onde, resumir, impressao', () => {
  test('posicao counts LF lines and code point columns from a UTF-16 index', () => {
    const texto = `ab\r\n${cp(0x1f600)}x\ny`
    assert.deepEqual(posicao(texto, texto.indexOf('x')), { linha: 2, coluna: 2 })
    assert.deepEqual(posicao(texto, texto.indexOf('y')), { linha: 3, coluna: 1 })
    assert.deepEqual(posicao(texto, 0), { linha: 1, coluna: 1 })
  })

  test('onde escapes the path; resumir caps the list; impressao never echoes the text', () => {
    assert.equal(onde(`docs/no${cp(0x200b)}tes.md`, 3, 7), 'docs/no<U+200B>tes.md:3:7')
    const itens = Array.from({ length: 14 }, (_, k) => `i${k}`)
    assert.equal(resumir(itens), `${itens.slice(0, 12).join(' · ')} …and 2 more`)
    assert.equal(resumir(['a', 'b'], 12), 'a · b')
    const segredo = `run ${cp(0x1f600)} this`
    assert.match(impressao(segredo), /^sha256:[0-9a-f]{12} len:10$/)
    assert.ok(!impressao(segredo).includes('run'))
  })
})

// ════════════════════════════════════════════════════════════ the sources

describe('the sources of reader.mjs and formats.mjs', () => {
  test('hold no raw control or invisible character, and import only what the mirrors carry', () => {
    // The gate copies tooling/security whole into its mirrors; anything else
    // imported dies there with ERR_MODULE_NOT_FOUND.
    const permitidos =
      /^(?:node:[a-z/_]+|\.\.\/texto-seguro\.mjs|\.\.\/\.\.\/rebar-check\/index\.mjs|\.\/formats\.mjs)$/
    for (const nome of ['reader.mjs', 'formats.mjs', 'prove-reader.mjs', 'prove-formats.mjs']) {
      const texto = readFileSync(new URL(`./${nome}`, import.meta.url), 'utf8')
      const sujos = [...texto]
        .map((ch) => ch.codePointAt(0))
        .filter(
          (n) =>
            n !== 0x0a &&
            (naFaixa(n, CONTROLES) || naFaixa(n, IGNORAVEIS) || naFaixa(n, ESCAPAR_TAMBEM)),
        )
      assert.deepEqual(sujos, [], `${nome} holds a raw code point from the escape tables`)
      if (nome.startsWith('prove-')) continue
      for (const m of texto.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)) {
        assert.match(m[1], permitidos, `${nome} imports ${m[1]}`)
      }
    }
  })
})
