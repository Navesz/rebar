// CONTROL-BYTES AND MCP-ANSI-ESCAPE, PROVED AGAINST WHAT THEY EXIST TO SEE
//
// tooling/security/injection/control.mjs holds two rules. control-bytes fails a
// terminal control character in tracked text, in a name, in a commit message,
// or behind a format escape that a JSON, YAML or TOML parser turns back into
// one. mcp-ansi-escape flags an escaped ESC or CSI spelled in the source of an
// MCP server. Each test below pins one measured way a control reaches a
// terminal or an agent, or one measured false positive the rules must not
// raise: the 15 proofs of a phase-1 prototype are ported first,
// then the edges added after it.
//
// Every repository is built in os.tmpdir() with INDEX-ONLY entries (hash-object
// plus update-index --index-info), which is also how the proof runner builds
// `gerados`. Scenarios that do not mask each other share one repository: each
// git process costs about 45 ms on Windows (measured), and the rule output names
// every file it accuses, so an absent path is as checkable as a present one.
//
// Every control character, every escape spelling and every server marker is
// assembled at runtime, so this file holds none of them: the last tests assert
// that neither table matches this file or control.mjs.
//
//   node --test tooling/security/injection/prove-control.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CONTROLES, IGNORAVEIS, naFaixa } from '../texto-seguro.mjs'
import {
  ESCAPES_DE_CONTROLE,
  MARCADORES_DE_SERVIDOR,
  checarControlBytes,
  checarMcpAnsiEscape,
} from './control.mjs'
import { NOME_DA_ALLOWLIST, lerIndice } from './reader.mjs'

const cp = (...n) => String.fromCodePoint(...n)
const NUL = cp(0x00)
const BEL = cp(0x07)
const BS = cp(0x08)
const FF = cp(0x0c)
const CR = cp(0x0d)
const ESC = cp(0x1b)
const DEL = cp(0x7f)
const NEL = cp(0x85)
const CSI = cp(0x9b)
/** One backslash, so no escape spelling ever appears in this file's source. */
const B = String.fromCharCode(92)

const bytes = (...partes) =>
  Buffer.concat(
    partes.map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf8') : Buffer.from(p))),
  )

const TABELAS = { MARCADORES_DE_SERVIDOR, ESCAPES_DE_CONTROLE }
const controle = (dir) => checarControlBytes({ dir })
const heuristica = (dir) => checarMcpAnsiEscape({ dir }, TABELAS)
const NENHUM_SERVIDOR = { na: 'no MCP server source tracked' }

// Server vocabulary, assembled.
const REGISTRA = 'server.' + 'register' + 'Tool('
const CLASSE = 'Mcp' + 'Server'
const SDK = '@model' + 'contextprotocol/sdk'
const PY_FRAMEWORK = 'Fast' + 'MCP'

// ───────────────────────────────────────────────────────── temp repositories

const criados = []
after(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
})

// The machine's git config never decides what these repositories hold: no
// system or global file (Git for Windows ships core.autocrlf=true in its
// system config, which rewrote CRLF blobs to LF before the rule saw them) and
// no excludes file. The same isolation prove-injection.mjs uses.
const SEM_CONFIG = join(tmpdir(), 'rebar-prove-control-gitconfig-inexistente')
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

function git(dir, argumentos, entrada) {
  const r = spawnSync('git', ['-c', 'core.protectNTFS=false', ...argumentos], {
    cwd: dir,
    // A string input would be encoded with `encoding`, and 'buffer' is not a
    // text encoding (reader.mjs measured the same throw).
    input: typeof entrada === 'string' ? Buffer.from(entrada, 'utf8') : entrada,
    encoding: 'buffer',
    env: AMBIENTE,
    maxBuffer: 1 << 30,
    windowsHide: true,
  })
  if (r.status !== 0) throw new Error(`git ${argumentos.join(' ')}: ${r.stderr}`)
  return r.stdout.toString('utf8').trim()
}

/**
 * One `git init` for the whole file, copied into every repository. It lives in
 * os.tmpdir(), the same volume as the copies, because the config git init
 * writes records that file system's detection.
 */
let MOLDE = null
function molde() {
  if (!MOLDE) {
    MOLDE = mkdtempSync(join(tmpdir(), 'rebar-control-molde-'))
    criados.push(MOLDE)
    git(MOLDE, ['init', '-q'])
  }
  return join(MOLDE, '.git')
}

/**
 * A fresh repository whose index holds `arquivos` ([{ caminho, conteudo, modo? }])
 * and, when `mensagens` is given, one commit per message on top of that index.
 */
function repositorio(arquivos = [], { mensagens = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rebar-control-'))
  criados.push(dir)
  cpSync(molde(), join(dir, '.git'), { recursive: true })
  gravar(dir, arquivos)
  let pai = null
  for (const mensagem of mensagens) {
    const arvore = git(dir, ['write-tree'])
    const argumentos = ['commit-tree', arvore, ...(pai ? ['-p', pai] : []), '-F', '-']
    pai = git(dir, argumentos, bytes(mensagem))
    git(dir, ['update-ref', 'HEAD', pai])
  }
  return dir
}

/** Adds `arquivos` to the index of `dir`, one hash-object for every blob. */
function gravar(dir, arquivos) {
  if (!arquivos.length) return
  // The bytes are staged in a sibling folder, never in the working tree.
  const pasta = mkdtempSync(join(tmpdir(), 'rebar-control-blobs-'))
  criados.push(pasta)
  const caminhos = arquivos.map((a, k) => {
    const arquivo = join(pasta, String(k))
    writeFileSync(arquivo, bytes(a.conteudo))
    return arquivo
  })
  const oids = git(
    dir,
    ['hash-object', '-w', '--no-filters', '--stdin-paths'],
    `${caminhos.join('\n')}\n`,
  )
  const lista = oids.split('\n')
  const linhas = arquivos.map((a, k) => `${a.modo || '100644'} ${lista[k]}\t${a.caminho}${NUL}`)
  git(dir, ['update-index', '-z', '--add', '--index-info'], Buffer.from(linhas.join(''), 'utf8'))
}

/** The blob id git gives these bytes, computed here instead of asking a git process. */
const oidDe = (conteudo) => {
  const b = bytes(conteudo)
  return createHash('sha1').update(`blob ${b.length}${NUL}`).update(b).digest('hex')
}

const linhaDaAllowlist = (objeto) => `${JSON.stringify(objeto)}\n`

/** `<U+XXXX>` as regex source. */
const rotuloDe = (c) => `<U\\+${c.toString(16).toUpperCase().padStart(4, '0')}>`

/** A reported string must never carry a control or invisible code point itself. */
function limpo(texto) {
  for (const ch of String(texto)) {
    const c = ch.codePointAt(0)
    assert.ok(
      !naFaixa(c, CONTROLES) && !naFaixa(c, IGNORAVEIS),
      `the output carries U+${c.toString(16).toUpperCase()}`,
    )
  }
  return texto
}

/** Asserts a reprova string and returns it. */
function reprovou(resultado) {
  assert.equal(typeof resultado, 'string', `expected a reprova, got ${JSON.stringify(resultado)}`)
  return limpo(resultado)
}

/** Asserts a passou-with-nota and returns the nota. */
function comNota(resultado) {
  assert.ok(
    resultado && typeof resultado === 'object' && typeof resultado.nota === 'string',
    `expected a nota, got ${JSON.stringify(resultado)}`,
  )
  return limpo(resultado.nota)
}

// ════════════════════════════════════════════ the prototype proofs, ported

describe('control-bytes: the 15 proofs measured in phase 1', () => {
  const AGENTES = fileURLToPath(new URL('../../../new/gate/arquivos/agentes.md', import.meta.url))

  test('pass: the AGENTS.md rebar generates', { skip: !existsSync(AGENTES) }, () => {
    const dir = repositorio([{ caminho: 'AGENTS.md', conteudo: readFileSync(AGENTES) }])
    assert.equal(controle(dir), null)
  })

  test('pass: a PNG header is binary, and its ESC bytes are not judged', () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x1b, 0x1b]
    const dir = repositorio([
      { caminho: 'public/og.png', conteudo: png },
      { caminho: 'README.md', conteudo: '# site\n' },
    ])
    assert.equal(lerIndice(dir).porCaminho.get('public/og.png').estado, 'binario')
    assert.equal(controle(dir), null)
  })

  test('fail: a NUL cannot turn AGENTS.md into a binary', () => {
    const dir = repositorio([
      { caminho: 'AGENTS.md', conteudo: `${NUL}# title\ntext ${ESC}[31m marker\n` },
    ])
    const r = reprovou(controle(dir))
    assert.match(r, /AGENTS\.md:1:1 <U\+0000>/)
    assert.match(r, /AGENTS\.md:2:6 <U\+001B>/)
  })

  test('fail: a raw ESC in a README, reported at line:column', () => {
    // SGR 8 conceals: a visible colour in prose passes now (see "page breaks and
    // visible colour" below), so the prototype's red became the concealing form.
    const dir = repositorio([{ caminho: 'README.md', conteudo: `line one\nabc${ESC}[8m marker\n` }])
    assert.match(reprovou(controle(dir)), /^1 control character: README\.md:2:4 <U\+001B> — /)
  })

  test('fail: UTF-16LE with a BOM is decoded, not skipped', () => {
    const corpo = Buffer.from(`# x\n${ESC}[31m marker\n`, 'utf16le')
    const dir = repositorio([{ caminho: 'CLAUDE.md', conteudo: bytes([0xff, 0xfe], corpo) }])
    assert.match(reprovou(controle(dir)), /CLAUDE\.md:2:1 <U\+001B>/)
  })

  test('fail: C1 CSI (U+009B) and BS in Markdown', () => {
    const dir = repositorio([{ caminho: 'docs/a.md', conteudo: `a${CSI}31m b${BS}c` }])
    const r = reprovou(controle(dir))
    assert.match(r, /docs\/a\.md:1:2 <U\+009B>/)
    assert.match(r, /docs\/a\.md:1:8 <U\+0008>/)
  })

  test('fail: a JSON escape that JSON.parse turns into ESC', () => {
    const src = `{"mcpServers":{"x":{"command":"node","description":"a ${B}u001b[31m marker"}}}`
    assert.equal(JSON.parse(src).mcpServers.x.description.charCodeAt(2), 0x1b)
    const dir = repositorio([{ caminho: '.mcp.json', conteudo: src }])
    const coluna = src.indexOf(B) + 1
    assert.ok(
      reprovou(controle(dir)).startsWith(
        `1 control character: .mcp.json:1:${coluna} <U+001B> as a json:u escape`,
      ),
    )
  })

  test('pass: an escaped backslash before the escape is literal text', () => {
    const src = `{"pattern":"${B}${B}u001b ${B}${B}bword${B}${B}b"}`
    assert.equal(JSON.parse(src).pattern.charCodeAt(0), 92)
    assert.equal(controle(repositorio([{ caminho: 'x.json', conteudo: src }])), null)
  })

  test('pass: a shell colour inside a YAML block scalar (workflow run: |)', () => {
    const src = `jobs:\n  a:\n    steps:\n      - run: |\n          echo -e "${B}e[31mred${B}033[0m"\n      - name: "plain"\n`
    const dir = repositorio([{ caminho: '.github/workflows/ci.yml', conteudo: src }])
    assert.equal(controle(dir), null)
  })

  test('fail: a YAML escape in SKILL.md frontmatter; the same text in the body is prose', () => {
    const src = `---\nname: x\ndescription: "does x ${B}e[31m marker"\n---\nbody ${B}e[31m is prose, not decoded\n`
    const dir = repositorio([{ caminho: '.claude/skills/x/SKILL.md', conteudo: src }])
    assert.match(
      reprovou(controle(dir)),
      /^1 control character: \.claude\/skills\/x\/SKILL\.md:3:22 <U\+001B> as a yaml:e escape — /,
    )
  })

  test('pass: YAML single-quoted is literal', () => {
    const dir = repositorio([{ caminho: 'a.yaml', conteudo: `k: '${B}e[31m'\n` }])
    assert.equal(controle(dir), null)
  })

  test('fail/pass: TOML basic string decodes, literal string does not', () => {
    const src = `a = "${B}u001B[31m"\nb = '${B}e[31m'\n`
    const dir = repositorio([{ caminho: '.codex/config.toml', conteudo: src }])
    assert.match(
      reprovou(controle(dir)),
      /^1 control character: \.codex\/config\.toml:1:6 <U\+001B> as a toml:u escape — /,
    )
  })

  test('heuristic: an escaped ESC fires in a server source, not in a CLI', () => {
    const servidor = `${REGISTRA}'t', { description: 'x ' + '${B}x1b[31m' + 'marker' }, h)\n`
    const cli = `const cor = (n, s) => '${B}x1b[' + n + 'm' + s\n`
    const dir = repositorio([
      { caminho: 'srv/index.mjs', conteudo: servidor },
      { caminho: 'tooling/cli.mjs', conteudo: cli },
    ])
    const r = reprovou(heuristica(dir))
    assert.match(r, /^1 escaped terminal control in MCP server source: srv\/index\.mjs:1:\d+ /)
    assert.doesNotMatch(r, /tooling\/cli\.mjs/)
  })

  test('a colour helper that spells the escape passes control-bytes, same runtime value', () => {
    const corrigida = 'const cor = (n, s) => (c ? `' + B + 'x1b[${n}m${s}' + B + 'x1b[0m` : s)\n'
    const dir = repositorio([{ caminho: 'tooling/cli.mjs', conteudo: corrigida }])
    assert.equal(controle(dir), null)
    assert.deepEqual(heuristica(dir), NENHUM_SERVIDOR)
    const cor = new Function('c', `return ${corrigida.slice(corrigida.indexOf('(n, s)'))}`)(true)
    assert.equal(cor(31, 'x'), `${ESC}[31mx${ESC}[0m`)
  })

  test('a form feed fails in prose and is outside the code set', () => {
    const dir = repositorio([
      { caminho: 'docs/f.md', conteudo: `a${FF}b` },
      { caminho: 'src/x.c', conteudo: `a${FF}b\n` },
    ])
    const r = reprovou(controle(dir))
    assert.match(r, /^1 control character: docs\/f\.md:1:2 <U\+000C> — /)
    assert.doesNotMatch(r, /src\/x\.c/)
  })
})

// ═════════════════════════════════════════════════ character sets, endings

describe('control-bytes: which set a file gets', () => {
  test('code keeps its sentinels, prose and agent files do not, code fails the introducers', () => {
    const introdutores = [0x00, 0x08, 0x1b, 0x8d, 0x90, 0x98, 0x9b, 0x9d, 0x9e, 0x9f]
    const dir = repositorio([
      { caminho: 'src/a.mjs', conteudo: `export const S = '${cp(0x02, 0x1f)}${DEL}${NEL}'\n` },
      { caminho: 'docs/a.txt', conteudo: `x${cp(0x02)}${DEL}${NEL}\n` },
      // An agent file with a code extension is held to the prose set.
      { caminho: '.claude/hooks/h.mjs', conteudo: `const S = '${cp(0x02)}'\n` },
      { caminho: 'src/b.ts', conteudo: `const s = '${cp(...introdutores)}'\n` },
    ])
    const r = reprovou(controle(dir))
    assert.match(r, /^14 control characters: /)
    assert.doesNotMatch(r, /src\/a\.mjs/)
    assert.match(r, /\.claude\/hooks\/h\.mjs:1:12 <U\+0002>/)
    // 14 items, 12 shown: the four prose and agent items sort first, so eight
    // introducers are visible and the last two are counted.
    for (const c of introdutores.slice(0, 8)) {
      assert.match(r, new RegExp(`src/b\\.ts:1:\\d+ ${rotuloDe(c)}`))
    }
    assert.match(r, / …and 2 more — /)
    for (const c of [0x02, 0x7f, 0x85]) {
      assert.match(r, new RegExp(`docs/a\\.txt:1:\\d+ ${rotuloDe(c)}`))
    }
  })

  test('a bare CR fails in prose, CRLF does not', () => {
    const dir = repositorio([
      { caminho: 'README.md', conteudo: `a\r\nb\r\n` },
      { caminho: 'docs/b.md', conteudo: `draft${CR}final\n` },
    ])
    const r = reprovou(controle(dir))
    assert.match(r, /^1 control character: docs\/b\.md:1:6 <U\+000D> not followed by LF — /)
  })

  test('in code a bare CR fails next to LF endings, and a CR-only file is a nota', () => {
    const misto = repositorio([{ caminho: 'src/a.js', conteudo: `a\nb${CR}c\n` }])
    assert.match(reprovou(controle(misto)), /src\/a\.js:2:2 <U\+000D> not followed by LF/)
    const soCr = repositorio([{ caminho: 'src/old.c', conteudo: `int a;${CR}int b;${CR}` }])
    assert.match(
      comNota(controle(soCr)),
      /^1 code file ends every line with a bare carriage return.*: src\/old\.c$/,
    )
  })

  test('a raw cp1252 byte is only a nota outside agent files, and fails inside one', () => {
    const conteudo = bytes('Next ', [0x9b], ' step\n')
    assert.match(
      comNota(controle(repositorio([{ caminho: 'docs/a.md', conteudo }]))),
      /not valid UTF-8.*: docs\/a\.md$/,
    )
    assert.match(
      reprovou(controle(repositorio([{ caminho: 'AGENTS.md', conteudo }]))),
      /agent file this rule cannot read the way the agent does: AGENTS\.md \(utf-8-invalido\)/,
    )
  })

  test('an LFS pointer standing in for an agent file fails as a reading problem', () => {
    const ponteiro =
      'version https://git-lfs.github.com/spec/v1\noid sha256:' + '0'.repeat(64) + '\nsize 12\n'
    const r = reprovou(controle(repositorio([{ caminho: 'CLAUDE.md', conteudo: ponteiro }])))
    assert.match(r, /CLAUDE\.md \(lfs\)/)
  })

  test('a blob over 8 MiB is read in its first 8 MiB and named in a nota', () => {
    const grande = Buffer.alloc(9 * 1024 * 1024, 0x61)
    assert.equal(
      comNota(controle(repositorio([{ caminho: 'data/big.txt', conteudo: grande }]))),
      '1 file above 8 MiB was read only in the first 8 MiB: data/big.txt',
    )
  })
})

describe('control-bytes: page breaks and visible colour in prose and data files', () => {
  // Two false positives of main, each a shape that hides nothing. A form feed
  // alone on its line is how GNU license files, Emacs Lisp and Python separate
  // pages (xterm treats FF like LF, less prints ^L). A colour sequence of
  // visible parameters is what a CLI test snapshot records. Everything around
  // them keeps failing: the reason is in control.mjs's header.
  const VT = cp(0x0b)
  const snap = (corpo) => ({
    caminho: 'src/__snapshots__/cli.test.js.snap',
    conteudo: `exports[\`e 1\`] = \`"${corpo}"\`;\n`,
  })

  test('a form feed alone on its line passes in prose and data, with LF or CRLF, at either end', () => {
    const dir = repositorio([
      { caminho: 'COPYING', conteudo: `part 1\n${FF}\npart 2\n` },
      { caminho: 'docs/LICENSE.txt', conteudo: `a\r\n${FF}\r\nb\r\n` },
      { caminho: 'lisp/my-mode.el', conteudo: `${FF}\n;;; Code:\n${FF}` },
    ])
    assert.equal(controle(dir), null)
  })

  test('a form feed fails in an agent file, in a run, mid-line, in the allowlist and as an escape', () => {
    const casos = [
      [{ caminho: 'AGENTS.md', conteudo: `# a\n${FF}\nb\n` }, /AGENTS\.md:2:1 <U\+000C>/],
      [
        { caminho: 'README.md', conteudo: `a\n${FF}${FF}\nb\n` },
        /README\.md:2:1 <U\+000C> \(\+1 more\)/,
      ],
      [{ caminho: 'docs/a.md', conteudo: `see${FF}this\n` }, /docs\/a\.md:1:4 <U\+000C>/],
      [{ caminho: 'docs/a.md', conteudo: `see\n${FF} this\n` }, /docs\/a\.md:2:1 <U\+000C>/],
      [{ caminho: 'docs/a.md', conteudo: `a\n${VT}\nb\n` }, /docs\/a\.md:2:1 <U\+000B>/],
      [{ caminho: 'docs/a.md', conteudo: `a\n${BEL}\nb\n` }, /docs\/a\.md:2:1 <U\+0007>/],
      [
        { caminho: 'cfg/a.json', conteudo: `{"a": "x${B}f"}\n` },
        /cfg\/a\.json:1:\d+ <U\+000C> as a json/,
      ],
    ]
    for (const [arquivo, esperado] of casos) {
      assert.match(reprovou(controle(repositorio([arquivo]))), esperado, arquivo.caminho)
    }
    const allowlist = repositorio([{ caminho: NOME_DA_ALLOWLIST, conteudo: `# a\n${FF}\n` }])
    const r = reprovou(controle(allowlist))
    assert.match(r, /\.rebar-injection-allowlist:2:1 <U\+000C>/)
    assert.doesNotMatch(r, /add \{regra, motivo, arquivo, oid\}/)
  })

  test('a snapshot and a golden file with visible colours pass', () => {
    const dir = repositorio([
      snap(
        `${ESC}[31mError:${ESC}[39m ${ESC}[2mdim${ESC}[22m ${ESC}[1mbold${ESC}[22m ${ESC}[32mok${ESC}[39m`,
      ),
      {
        caminho: 'testdata/x.golden',
        conteudo: `${ESC}[1mTitle${ESC}[0m\n${ESC}[36mitem${ESC}[m\n${ESC}[1;4;91mx${ESC}[;0m\n`,
      },
    ])
    assert.equal(controle(dir), null)
  })

  test('what conceals, matches a theme background, moves the cursor or links fails in a snapshot', () => {
    const casos = [
      ['conceal', `ok${ESC}[8m hidden ${ESC}[28m`],
      ['black', `${ESC}[30mx${ESC}[0m`],
      ['bright black (Solarized Dark background)', `${ESC}[90mx${ESC}[0m`],
      ['bright white (Solarized Light background)', `${ESC}[97mx${ESC}[0m`],
      ['white', `${ESC}[37mx${ESC}[0m`],
      ['a background colour', `${ESC}[41mx${ESC}[0m`],
      ['a 256-colour foreground', `${ESC}[38;5;1mx${ESC}[0m`],
      ['a visible and a concealing parameter together', `${ESC}[1;8mx${ESC}[0m`],
      ['cursor up', `line${ESC}[1Areplaced`],
      ['erase line', `line${ESC}[2Kreplaced`],
      ['an OSC 8 link', `${ESC}]8;;https://example.invalid${ESC}${B}text${ESC}]8;;${ESC}${B}`],
      ['a colon sub-parameter', `${ESC}[38:2:0:0:0mx${ESC}[0m`],
      ['a private marker', `${ESC}[?31mx`],
      ['a parameter string past 40 characters', `${ESC}[${'1;'.repeat(20)}1mx`],
      ['an ESC with no sequence at the end of the file', `x${ESC}`],
      ['the one-byte CSI', `${CSI}31mx`],
    ]
    for (const [nome, corpo] of casos) {
      const r = reprovou(controle(repositorio([snap(corpo)])))
      assert.match(r, /src\/__snapshots__\/cli\.test\.js\.snap:1:\d+ <U\+00(?:1B|9B)>/, nome)
    }
  })

  test('a visible colour still fails in an agent file, code, a name, a commit message and the allowlist', () => {
    const dir = repositorio(
      [
        { caminho: 'AGENTS.md', conteudo: `${ESC}[31mred${ESC}[0m\n` },
        { caminho: 'src/a.mjs', conteudo: `console.log('${ESC}[31mred${ESC}[0m')\n` },
        { caminho: `docs/a${ESC}[31m.md`, conteudo: 'fine\n' },
        { caminho: NOME_DA_ALLOWLIST, conteudo: `# ${ESC}[31mred${ESC}[0m\n` },
      ],
      { mensagens: [`subject ${ESC}[32mgreen${ESC}[0m\n`] },
    )
    const r = reprovou(controle(dir))
    assert.match(r, /AGENTS\.md:1:1 <U\+001B>/)
    assert.match(r, /src\/a\.mjs:1:14 <U\+001B>/)
    assert.match(r, /\.rebar-injection-allowlist:1:3 <U\+001B>/)
    assert.match(r, /name docs\/a<U\+001B>\[31m\.md <U\+001B>/)
    assert.match(r, /commit [0-9a-f]{12} message <U\+001B>/)
  })

  test('the remedy: mojibake is UTF-8 decoded twice, but RI and the introducers still hide text', () => {
    // A Portuguese heading saved through UTF-8 twice: c-cedilla and a-tilde
    // become U+00C3 plus U+0087 and U+00C3 plus U+0083. Measured on main:
    // "<U+0087> · <U+0083> — a terminal acts on it and hides text".
    const duasVezes = (s) => Buffer.from(Buffer.from(s, 'utf8').toString('latin1'), 'utf8')
    const atencao = reprovou(
      controle(
        repositorio([{ caminho: 'docs/a.md', conteudo: duasVezes(`ATEN${cp(0xc7, 0xc3)}O\n`) }]),
      ),
    )
    assert.match(atencao, /<U\+0087>/)
    assert.match(atencao, /UTF-8 text decoded twice, so re-save the file as UTF-8; remove it/)
    assert.doesNotMatch(atencao, /hides text/)
    // I-acute leaves RI, U+008D, which moves the cursor up: the hiding claim
    // stays, and the remedy also says the text was decoded twice. Measured on
    // the first cut of this remedy: only the hiding claim was printed.
    const indice = reprovou(
      controle(
        repositorio([
          {
            caminho: 'docs/b.md',
            conteudo: duasVezes(`${cp(0xcd)}NDICE E SE${cp(0xc7, 0xc3)}O\n`),
          },
        ]),
      ),
    )
    assert.match(indice, /<U\+008D>/)
    assert.match(indice, /hides text from the review/)
    assert.match(indice, /can also be UTF-8 text decoded twice, so re-save the file as UTF-8/)
    // A double-encoded letter before a real CSI still hides text.
    const csi = reprovou(
      controle(repositorio([{ caminho: 'docs/c.md', conteudo: `${cp(0xc2, 0x9b)}8mx\n` }])),
    )
    assert.match(csi, /hides text from the review/)
    // Mojibake next to a concealing sequence: the hiding claim wins.
    const junto = reprovou(
      controle(
        repositorio([
          { caminho: 'docs/a.md', conteudo: duasVezes(`ATEN${cp(0xc7, 0xc3)}O\n`) },
          { caminho: 'docs/d.md', conteudo: `${ESC}[8mx\n` },
        ]),
      ),
    )
    assert.match(junto, /hides text from the review/)
    assert.doesNotMatch(junto, /decoded twice/)
    // A page break and mojibake together get both reasons, and no hiding claim.
    const ambos = reprovou(
      controle(
        repositorio([
          { caminho: 'docs/a.md', conteudo: duasVezes(`ATEN${cp(0xc7, 0xc3)}O\n`) },
          { caminho: 'docs/e.md', conteudo: `a${FF}b\n` },
        ]),
      ),
    )
    assert.match(ambos, /hides no text/)
    assert.match(ambos, /decoded twice/)
    assert.doesNotMatch(ambos, /hides text/)
  })
})

describe('control-bytes: format escapes', () => {
  test('backslash parity, the escapes left out, and Markdown without frontmatter', () => {
    const dir = repositorio([
      // An even run of backslashes is text; an odd run ends in an escape.
      { caminho: 'par.json', conteudo: `{"k":"${B}${B}${B}${B}u001b"}` },
      { caminho: 'impar.json', conteudo: `{"k":"${B}${B}${B}u001b"}` },
      // Line feed, tab and the JSON NUL escape (code-page tables) are not reported.
      { caminho: 'a.json', conteudo: `{"a":"${B}u000A${B}u0009${B}n${B}t${B}u0000"}` },
      // YAML NUL, BEL and NEL escapes are; a TOML literal string is not decoded.
      { caminho: 'a.yml', conteudo: `a: "x${B}0"\nb: "x${B}a"\nc: "x${B}N"\n` },
      { caminho: 'a.toml', conteudo: `a = "${B}x1b"\nb = '''${B}e'''\n` },
      { caminho: 'docs/a.md', conteudo: `# t\n\n"x ${B}e[31m"\n` },
    ])
    const r = reprovou(controle(dir))
    assert.match(r, /^5 control characters: /)
    assert.match(r, /impar\.json:1:9 <U\+001B> as a json:u escape/)
    assert.match(r, /a\.yml:1:6 <U\+0000> as a yaml:0 escape/)
    assert.match(r, /a\.yml:2:6 <U\+0007> as a yaml:a escape/)
    assert.match(r, /a\.yml:3:6 <U\+0085> as a yaml:N escape/)
    assert.match(r, /a\.toml:1:6 <U\+001B> as a toml:x escape/)
    assert.doesNotMatch(r, /(?:^|[ /])(?:par\.json|a\.json|docs\/a\.md)/)
  })

  test('a link is decoded the way the client opens it: .mcp.json -> m.txt is JSON, SKILL.md -> x is frontmatter', () => {
    const json = `{"mcpServers": {"x": {"command": "node", "env": {"A": "x${B}u001b[8m"}}}}\n`
    const skill = `---\nname: x\ndescription: "hi ${B}e[31m"\n---\nbody\n`
    for (const [link, alvo, conteudo, esperado] of [
      ['.mcp.json', 'm.txt', json, /m\.txt:1:\d+ <U\+001B> as a json:u escape read as \.mcp\.json/],
      ['.mcp.json', 'cfg/m', json, /cfg\/m:1:\d+ <U\+001B> as a json:u escape read as \.mcp\.json/],
      [
        '.claude/skills/x/SKILL.md',
        'docs/x.txt',
        skill,
        /docs\/x\.txt:3:\d+ <U\+001B> as a yaml:e escape read as \.claude\/skills\/x\/SKILL\.md/,
      ],
    ]) {
      const relativo = link.includes('/') ? `../../../${alvo}` : alvo
      const comLink = repositorio([
        { caminho: alvo, conteudo },
        { caminho: link, conteudo: relativo, modo: '120000' },
      ])
      assert.match(reprovou(controle(comLink)), esperado)
      // The same bytes where no client parses them are plain text with no control.
      assert.equal(controle(repositorio([{ caminho: alvo, conteudo }])), null, alvo)
    }
    // A link that keeps a JSON name reads once, under the target's own name.
    const mesmoNome = repositorio([
      { caminho: 'cfg/m.json', conteudo: json },
      { caminho: '.mcp.json', conteudo: 'cfg/m.json', modo: '120000' },
    ])
    const r = reprovou(controle(mesmoNome))
    assert.match(r, /^1 control character: cfg\/m\.json:1:\d+ <U\+001B> as a json:u escape — /)
  })
})

describe('control-bytes: names, link targets and commit messages', () => {
  test('a path and a link target with a control fail, printed as labels', () => {
    const dir = repositorio([
      { caminho: `docs/a${ESC}[31m.md`, conteudo: 'fine\n' },
      { caminho: 'docs/link', conteudo: `target${BEL}`, modo: '120000' },
    ])
    const r = reprovou(controle(dir))
    assert.match(r, /name docs\/a<U\+001B>\[31m\.md <U\+001B>/)
    assert.match(r, /link target of docs\/link <U\+0007>/)
  })

  test('a commit message fails on a control, not on its line endings', () => {
    const limpa = repositorio([{ caminho: 'a.txt', conteudo: 'a\n' }], {
      mensagens: ['subject\r\n\r\nbody\ttabbed\n'],
    })
    assert.equal(controle(limpa), null)
    const suja = repositorio([{ caminho: 'a.txt', conteudo: 'a\n' }], {
      mensagens: ['clean first\n', `subject ${ESC}[8mhidden${ESC}[0m\n`],
    })
    assert.match(reprovou(controle(suja)), /commit [0-9a-f]{12} message <U\+001B>/)
  })

  test('in a commit message a bell, vertical tab or form feed warns; what hides text still fails', () => {
    // The PowerShell shape measured in a real history: a double-quoted -m where
    // a backtick opened a Markdown code span, so the backtick and the letter
    // after it became BEL. Nothing a terminal does with BEL, VT or FF hides
    // text, and a published commit cannot be reworded. Measured before: the
    // whole repository failed on it.
    const VT = cp(0x0b)
    const powershell = `ci: upload with ${BEL}ctions/upload-artifact\n\nPin ${BEL}ctions/checkout${BEL} too\n`
    for (const mensagem of [powershell, `page${FF}break\n`, `tab${VT}stop\n`]) {
      const dir = repositorio([{ caminho: 'a.txt', conteudo: 'a\n' }], { mensagens: [mensagem] })
      const nota = comNota(controle(dir))
      assert.match(
        nota,
        /^1 commit message carries a bell, vertical tab or form feed, which hides no text: commit [0-9a-f]{12} message <U\+000[7BC]>/,
      )
      assert.match(nota, /PowerShell backtick escape/)
      assert.match(nota, /\{regra, motivo, commit\}/)
      limpo(nota)
    }
    // BS, ESC, a lone CR, DEL and C1 can overwrite or hide what a terminal
    // printed, so they still fail in a message, and a bell next to one of them
    // is listed with it. (git commit-tree refuses a NUL in a message, so no
    // proof commit can carry one.)
    for (const [mensagem, rotulo] of [
      [`a${BS}b\n`, '<U\\+0008>'],
      [`a${ESC}[8mb\n`, '<U\\+001B>'],
      [`a${CR}b\n`, '<U\\+000D>'],
      [`a${DEL}b\n`, '<U\\+007F>'],
      [`a${CSI}8mb\n`, '<U\\+009B>'],
      [`a${BEL}b${BS}c\n`, '<U\\+0007> <U\\+0008>'],
    ]) {
      const dir = repositorio([{ caminho: 'a.txt', conteudo: 'a\n' }], { mensagens: [mensagem] })
      assert.match(reprovou(controle(dir)), new RegExp(`commit [0-9a-f]{12} message ${rotulo}`))
    }
  })

  test('in a file, the remedy says a form feed or a bell is a page-break or bell control, not hidden text', () => {
    // Measured before: a license file with a form feed on its own line was told
    // its control "hides text from the review", which misleads a maintainer
    // about tampering. That form feed passes now, so the one that still fails
    // sits in the middle of a line.
    const pagina = reprovou(
      controle(repositorio([{ caminho: 'COPYING.LIB', conteudo: `part 1${FF}part 2\n` }])),
    )
    assert.match(
      pagina,
      /^1 control character: COPYING\.LIB:1:7 <U\+000C> — a page-break or bell control hides no text, and only a form feed alone on its line in a prose or data file is left alone; remove it/,
    )
    assert.doesNotMatch(pagina, /hides text/)
    // With an ESC among the findings the hiding claim is true, and it stays.
    const junto = reprovou(
      controle(repositorio([{ caminho: 'notes.txt', conteudo: `${FF}\n${ESC}[8mx\n` }])),
    )
    assert.match(junto, /hides text from the review/)
  })

  test('na with nothing tracked and no commit, and with only a binary and no commit', () => {
    assert.deepEqual(controle(repositorio()), { na: 'no tracked text file' })
    const binario = repositorio([{ caminho: 'a.bin', conteudo: [0, 1, 2, 0x1b] }])
    assert.deepEqual(controle(binario), { na: 'no tracked text file' })
  })
})

describe('control-bytes: the allowlist', () => {
  const bundle = { caminho: 'vendor/app.js', conteudo: `var e='${ESC}[31m'\n` }
  const entrada = linhaDaAllowlist({
    regra: 'control-bytes',
    motivo: 'vendored bundle, colours its own CLI output',
    arquivo: 'vendor/app.js',
    oid: oidDe(bundle.conteudo),
  })

  test('an {arquivo, oid} entry exempts that blob; a nota names the missing owner', () => {
    const isento = repositorio([bundle, { caminho: NOME_DA_ALLOWLIST, conteudo: entrada }])
    assert.match(comNota(controle(isento)), /^no CODEOWNERS entry owns/)

    const dono = repositorio([
      bundle,
      { caminho: NOME_DA_ALLOWLIST, conteudo: entrada },
      { caminho: '.github/CODEOWNERS', conteudo: `/${NOME_DA_ALLOWLIST} @security\n` },
    ])
    assert.equal(controle(dono), null)
  })

  test('another blob under the same path is not exempt, and the stale entry is not a nota', () => {
    const outro = repositorio([
      { ...bundle, conteudo: `var e='${ESC}[32m'\n` },
      { caminho: NOME_DA_ALLOWLIST, conteudo: entrada },
    ])
    const r = reprovou(controle(outro))
    assert.match(r, /^1 control character: vendor\/app\.js:1:8 <U\+001B> — /)
    // The remedy names the allowlist and the key that exempts a bundle.
    assert.ok(
      r.endsWith(
        `for a generated or vendored file add {regra, motivo, arquivo, oid} to ${NOME_DA_ALLOWLIST}`,
      ),
      r,
    )
  })

  test('a stale entry is a nota', () => {
    const obsoleta = linhaDaAllowlist({
      regra: 'control-bytes',
      motivo: 'removed bundle',
      arquivo: 'gone.js',
      oid: 'a'.repeat(40),
    })
    const dir = repositorio([
      { caminho: 'a.txt', conteudo: 'a\n' },
      { caminho: NOME_DA_ALLOWLIST, conteudo: obsoleta },
    ])
    assert.match(comNota(controle(dir)), /^1 allowlist entry for control-bytes matches nothing/)
  })

  test('a malformed line fails; a control inside the allowlist itself fails', () => {
    const dir = repositorio([
      {
        caminho: NOME_DA_ALLOWLIST,
        conteudo: `# reviewed ${ESC}[8m\n{"regra": "control-bytes"\n`,
      },
    ])
    const r = reprovou(controle(dir))
    assert.match(r, /\.rebar-injection-allowlist:1:12 <U\+001B>/)
    // Nothing exempts a control inside the allowlist, so no entry is offered.
    assert.doesNotMatch(r, /add \{regra, motivo, arquivo, oid\}/)
    assert.match(
      r,
      /\.rebar-injection-allowlist is malformed, and that is never exempt: \.rebar-injection-allowlist:2:/,
    )
  })

  test('a {commit} entry exempts that commit message', () => {
    // A backspace, which overwrites what was printed: a bell only warns in a message.
    const mensagens = [`imported ${BS} history\n`]
    const sem = repositorio([{ caminho: 'a.txt', conteudo: 'a\n' }], { mensagens })
    const r = reprovou(controle(sem))
    assert.match(r, /commit [0-9a-f]{12} message <U\+0008>/)
    // A published commit is not reworded: the remedy names the key that exempts it.
    assert.ok(
      r.endsWith(
        `rename the file or reword the commit; for a commit already published add ` +
          `{regra, motivo, commit} to ${NOME_DA_ALLOWLIST}`,
      ),
      r,
    )

    // The entry goes into the index AFTER the commit and before the first read:
    // the rule reads the index, and the id must already be in history.
    const com = repositorio([{ caminho: 'a.txt', conteudo: 'a\n' }], { mensagens })
    const id = git(com, ['rev-parse', 'HEAD'])
    const linha = linhaDaAllowlist({ regra: 'control-bytes', motivo: 'imported', commit: id })
    gravar(com, [{ caminho: NOME_DA_ALLOWLIST, conteudo: linha }])
    assert.match(comNota(controle(com)), /^no CODEOWNERS entry owns/)
  })
})

// ═══════════════════════════════════════════════════════════ the heuristic

describe('mcp-ansi-escape', () => {
  const servidor = (descricao) =>
    [
      `import { ${CLASSE} } from '${SDK}/server/mcp.js'`,
      `const server = new ${CLASSE}({ name: 'w', version: '1.0.0' })`,
      `${REGISTRA}'forecast', { description: ${descricao} }, async () => ({ content: [] }))`,
      '',
    ].join('\n')

  test('JS and Python servers: an escape in code fires, plain text and comments do not', () => {
    const py = (linha) =>
      `from mcp${'.server'}.fastmcp import ${PY_FRAMEWORK}\napp = ${PY_FRAMEWORK}('w')\n${linha}\n`
    const dir = repositorio([
      { caminho: 'srv/suja.mjs', conteudo: servidor(`'hot${B}x1b[31m'`) },
      { caminho: 'srv/limpa.mjs', conteudo: servidor(`'hot'`) },
      { caminho: 'srv/comentada.mjs', conteudo: `${servidor(`'hot'`)}// was '${B}x1b[31m'\n` },
      { caminho: 'srv/suja.py', conteudo: py(`DESC = "hot ${B}033[31m"`) },
      { caminho: 'srv/comentada.py', conteudo: py(`# "${B}033[31m" # "x"`) },
      // A server under an agent folder is still source; prose that quotes a
      // server and an escape is not a server.
      { caminho: '.rebar/mcp.mjs', conteudo: servidor(`'hot${B}u{1b}[31m'`) },
      { caminho: 'docs/servers.md', conteudo: servidor(`'hot${B}x1b[31m'`) },
    ])
    const r = reprovou(heuristica(dir))
    assert.match(r, /^3 escaped terminal controls in MCP server source: /)
    assert.match(r, /\.rebar\/mcp\.mjs:3:\d+ code point escape of ESC/)
    assert.match(r, /srv\/suja\.mjs:3:\d+ hex escape of ESC/)
    assert.match(r, /srv\/suja\.py:3:\d+ octal escape of ESC/)
    assert.doesNotMatch(r, /limpa|comentada|docs\/servers\.md/)
    assert.equal(
      heuristica(repositorio([{ caminho: 'srv/limpa.mjs', conteudo: servidor(`'hot'`) }])),
      null,
    )
  })

  test('Go servers of the official SDK and of mcp-go are candidates (backlog 14)', () => {
    // Before the Go rows, both gave na('no MCP server source tracked'): the
    // TypeScript and Python markers matched 8 and 2 of 400 measured Go servers.
    const goSdk = (descricao) =>
      [
        'package main',
        '',
        `import "github.com/model${'contextprotocol'}/go-sdk/mcp"`,
        '',
        'func main() {',
        `\tserver := mcp.New${'Server'}(&mcp.Implementation{Name: "w"}, nil)`,
        `\tmcp.AddTool(server, &mcp.Tool{Name: "forecast", Description: ${descricao}}, nil)`,
        '}',
        '',
      ].join('\n')
    const suja = reprovou(
      heuristica(repositorio([{ caminho: 'main.go', conteudo: goSdk(`"hot${B}x1b[31m"`) }])),
    )
    assert.match(
      suja,
      /^1 escaped terminal control in MCP server source: main\.go:7:\d+ hex escape of ESC/,
    )
    assert.equal(heuristica(repositorio([{ caminho: 'main.go', conteudo: goSdk('"hot"') }])), null)
    const mcpGo = [
      'package main',
      '',
      `import "github.com/mark3${'labs'}/mcp-go/server"`,
      '',
      `var s = server.New${'MCPServer'}("w", "1.0.0")`,
      `var d = "hot${B}u001b[31m"`,
      '',
    ].join('\n')
    assert.match(
      reprovou(heuristica(repositorio([{ caminho: 'cmd/srv/main.go', conteudo: mcpGo }]))),
      /cmd\/srv\/main\.go:6:\d+ unicode escape of ESC/,
    )
  })

  test('the Go SDK import selects server code, not a client, and Go number constructors fail (review findings 14, 18)', () => {
    const IMPORTACAO = `"github.com/model${'contextprotocol'}/go-sdk/mcp"`
    // A server under a package alias: only the import row can select it.
    const servidor = (descricao) =>
      [
        'package main',
        '',
        `import sdk ${IMPORTACAO}`,
        '',
        'func main() {',
        `\ts := sdk.New${'Server'}(&sdk.Implementation{Name: "w"}, nil)`,
        `\tsdk.AddTool(s, &sdk.Tool{Name: "t", Description: ${descricao}}, nil)`,
        '}',
        '',
      ].join('\n')
    const construcoes = [
      `"a" + string(ru${'ne'}(27)) + "[8m"`,
      `"a" + string([]by${'te'}{0x1b}) + "[8m"`,
      `fmt.Sprintf("a%${'c'}[8m", 27)`,
    ]
    for (const descricao of construcoes) {
      const r = reprovou(
        heuristica(repositorio([{ caminho: 'main.go', conteudo: servidor(descricao) }])),
      )
      assert.match(r, /main\.go:7:\d+ ESC or CSI built from its number/, descricao)
    }
    assert.equal(heuristica(repositorio([{ caminho: 'main.go', conteudo: servidor('"t"') }])), null)
    // A client that prints colour: measured, 2 of 5 public client files failed
    // with 28 findings while the bare import made them candidates.
    const cliente = [
      'package main',
      '',
      `import ${IMPORTACAO}`,
      '',
      'func main() {',
      '\tclient := mcp.NewClient(&mcp.Implementation{Name: "c"}, nil)',
      `\tfmt.Println("${B}033[32mconnected${B}033[0m", client)`,
      '}',
      '',
    ].join('\n')
    const semServidor = heuristica(repositorio([{ caminho: 'cli/main.go', conteudo: cliente }]))
    assert.ok(semServidor && semServidor.na, JSON.stringify(semServidor))
  })

  test('a file launched by a tracked MCP config is judged without a marker', () => {
    const escapado = `const t = 'hot${B}u001b[31m'\n`
    const dir = repositorio([
      { caminho: 'tools/a.mjs', conteudo: escapado },
      { caminho: 'tools/b.mjs', conteudo: escapado },
      { caminho: 'tools/c.mjs', conteudo: escapado },
      // The same file with no config pointing at it and no marker is no candidate.
      { caminho: 'tools/d.mjs', conteudo: escapado },
      {
        caminho: '.mcp.json',
        conteudo: '{"mcpServers":{"x":{"command":"node","args":["tools/a.mjs"]}}}',
      },
      {
        caminho: '.cursor/mcp.json',
        conteudo:
          '{"mcpServers":{"x":{"command":"node","args":["${workspaceFolder}/tools/b.mjs"]}}}',
      },
      {
        caminho: '.codex/config.toml',
        conteudo: '[mcp_servers.x]\ncommand = "node"\nargs = ["./tools/c.mjs"]\n',
      },
    ])
    const r = reprovou(heuristica(dir))
    for (const nome of ['a', 'b', 'c']) {
      assert.match(r, new RegExp(`tools/${nome}\\.mjs:1:\\d+ unicode escape of ESC`))
    }
    assert.doesNotMatch(r, /tools\/d\.mjs/)
  })

  test('a launch as one command string or through a shell wrapper names its file too', () => {
    // The words are split the way mcp-server-launch splits them; before, each
    // string was one token and a hand-written server launched like this was
    // never examined.
    const escapado = `const t = 'hot${B}x1b[31m'\n`
    const sh = 'ba' + 'sh'
    const dir = repositorio([
      { caminho: 'srv/a.mjs', conteudo: escapado },
      { caminho: 'srv/b.mjs', conteudo: escapado },
      {
        caminho: '.mcp.json',
        conteudo: JSON.stringify({
          mcpServers: {
            um: { command: 'node srv/a.mjs' },
            dois: { command: sh, args: ['-c', 'node ./srv/b.mjs'] },
          },
        }),
      },
    ])
    const r = reprovou(heuristica(dir))
    assert.match(r, /srv\/a\.mjs:1:\d+ hex escape of ESC/)
    assert.match(r, /srv\/b\.mjs:1:\d+ hex escape of ESC/)
  })

  test('with no server file, a malformed allowlist still fails and a stale entry is a nota', () => {
    const quebrada = repositorio([
      { caminho: 'README.md', conteudo: 'plain\n' },
      { caminho: NOME_DA_ALLOWLIST, conteudo: 'this is not json\n' },
    ])
    assert.match(
      reprovou(heuristica(quebrada)),
      /^\.rebar-injection-allowlist is malformed, and that is never exempt: \.rebar-injection-allowlist:1:/,
    )
    const velha = repositorio([
      { caminho: 'README.md', conteudo: 'plain\n' },
      {
        caminho: NOME_DA_ALLOWLIST,
        conteudo: linhaDaAllowlist({
          regra: 'mcp-ansi-escape',
          motivo: 'a server that was removed',
          arquivo: 'gone.mjs',
          oid: '0'.repeat(40),
        }),
      },
    ])
    assert.match(
      comNota(heuristica(velha)),
      /^1 allowlist entry for mcp-ansi-escape matches nothing/,
    )
    assert.deepEqual(
      heuristica(repositorio([{ caminho: 'README.md', conteudo: 'plain\n' }])),
      NENHUM_SERVIDOR,
    )
  })

  test('an {arquivo, oid} entry exempts a server file', () => {
    const arquivo = { caminho: 'srv/index.mjs', conteudo: servidor(`'hot${B}x1b[31m'`) }
    const linha = linhaDaAllowlist({
      regra: 'mcp-ansi-escape',
      motivo: 'SDK example that colours its console',
      arquivo: 'srv/index.mjs',
      oid: oidDe(arquivo.conteudo),
    })
    const dir = repositorio([arquivo, { caminho: NOME_DA_ALLOWLIST, conteudo: linha }])
    assert.match(comNota(heuristica(dir)), /^no CODEOWNERS entry owns/)
  })

  test('every escape row matches its own sample, and near misses match none', () => {
    const amostras = [
      `${B}x1` + 'b[',
      `${B}U000000` + '1b',
      `${B}u{` + '1b}',
      `${B}x9` + 'b',
      `${B}u00` + '9B',
      `${B}u{0` + '9b}',
      `${B}0` + '33[',
      `${B}e` + '[31m',
      '&#' + '27;',
      '&#x' + '1b;',
      'String.from' + 'CodePoint(155)',
      'ch' + 'r(27)',
      'string(ru' + 'ne(27))',
      '[]by' + 'te{0x1b}',
      'fmt.Sprintf("%' + 'c[8m", 27)',
    ]
    assert.equal(amostras.length, ESCAPES_DE_CONTROLE.length)
    amostras.forEach((amostra, k) => {
      assert.ok(ESCAPES_DE_CONTROLE[k][0].test(amostra), `row ${k} misses its sample`)
    })
    const quase = [
      'x1' + 'b[',
      `${B}33` + '7',
      '&#' + '270;',
      'from' + 'CharCode(270)',
      `${B}ex`,
      'ru' + 'ne(270)',
      '[]by' + 'te{1, 127}',
      'Sprintf("%' + 'd", 27)',
    ]
    for (const q of quase) {
      assert.ok(
        !ESCAPES_DE_CONTROLE.some(([re]) => re.test(q)),
        `a row matches ${JSON.stringify(q)}`,
      )
    }
  })

  // rebar-check spells an escaped ESC for its own colours and has no server
  // marker, so it is no candidate. tooling/security/index.mjs
  // takes its colours from node:util and spells none, because prove-table.mjs
  // holds every exported table against that file; it rides along to prove it
  // is no candidate either, now that it re-exports the marker table by name.
  test('does not fire on tooling/rebar-check/index.mjs nor tooling/security/index.mjs', () => {
    const ler = (rel) =>
      readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8')
    const check = ler('tooling/rebar-check/index.mjs')
    assert.ok(
      ESCAPES_DE_CONTROLE.some(([re]) => re.test(check)),
      'tooling/rebar-check/index.mjs no longer spells an escaped ESC, so this proof proves nothing',
    )
    const seguranca = ler('tooling/security/index.mjs')
    assert.ok(
      !ESCAPES_DE_CONTROLE.some(([re]) => re.test(seguranca)),
      'tooling/security/index.mjs spells an escaped ESC again; prove-table.mjs fails on that',
    )
    const arquivos = [
      { caminho: 'tooling/rebar-check/index.mjs', conteudo: check },
      { caminho: 'tooling/security/index.mjs', conteudo: seguranca },
    ]
    assert.deepEqual(heuristica(repositorio(arquivos)), NENHUM_SERVIDOR)
  })

  test('the tables are refused when they do not arrive as [RegExp, string] rows', () => {
    assert.throws(() => checarMcpAnsiEscape({ dir: tmpdir() }, {}), /MARCADORES_DE_SERVIDOR/)
  })
})

// ═════════════════════════════════════════════════════════ no self-accusal

describe('the tables do not accuse their own sources', () => {
  const fontes = ['./control.mjs', './prove-control.mjs'].map((rel) => [
    rel,
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'),
  ])

  test('no row of either table matches the raw text of control.mjs or of this file', () => {
    for (const [rel, texto] of fontes) {
      for (const [nome, tabela] of Object.entries(TABELAS)) {
        for (const [re, explicacao] of tabela) {
          assert.ok(!re.test(texto), `${nome} row "${explicacao}" matches ${rel}`)
        }
      }
    }
  })

  test('no explanation matches any row', () => {
    const linhas = [...MARCADORES_DE_SERVIDOR, ...ESCAPES_DE_CONTROLE]
    for (const [, explicacao] of linhas) {
      for (const [re] of linhas) assert.ok(!re.test(explicacao), `"${explicacao}" matches ${re}`)
    }
  })

  test('neither source holds a raw control character other than LF', () => {
    for (const [rel, texto] of fontes) {
      for (const ch of texto) {
        const c = ch.codePointAt(0)
        assert.ok(c === 0x0a || !naFaixa(c, CONTROLES), `${rel} holds U+${c.toString(16)}`)
      }
    }
  })
})
