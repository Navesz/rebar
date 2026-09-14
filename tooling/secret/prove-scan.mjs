#!/usr/bin/env node
// The proofs of the secret scanner — by DETECTION, not by execution.
//
// WHY THIS FILE EXISTS, and it is a lesson that cost a P1 from an external
// audit. The gate's `secret` step is of the `comando:` kind, and the note in
// `prove-steps.mjs` says that a step like that "already proves itself: if the
// script it calls disappears or breaks, the step falls". True, and not enough:
// it proves the scanner RUNS, never that it FINDS.
//
// The hole that went underneath that: the same synthetic token in two files in
// the index, one UTF-8 and the other UTF-16LE with BOM. The first was found, the
// second passed — exit 0, zero findings, and the file still counted as "binary
// scanned", so that the silence looked like coverage. The `secret` step stayed
// green the whole run.
//
// Every test here is a detection that has to happen, or a false positive that
// cannot happen. None uses a real credential: the tokens are synthetic, with the
// vendor prefix and the right length, which is what the rules read.
//
// The 2026-09-13 audit reopened three holes (8, 9 and 10 in the scanner's
// header), and 25 tests below hold them: 23 fail on the scanner before the fix,
// and the other 2 are a false-positive control and a time guard, which say so.
// 3 of the 23 hold what the review of the fix found — the window seam, the late
// invisible, the refused-marker reason — and fail on the fix's first version
// too. Variants live in a TABLE inside one test and never in a loop of
// `test()`: tooling/numbers.mjs counts `test(` lines to print how many proofs
// this file holds.
//
// Usage:  node --test tooling/secret/prove-scan.mjs

import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { IGNORAVEIS, naFaixa } from '../security/texto-seguro.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const VARREDOR = join(AQUI, 'scan-secret.mjs')
const REBAR = join(AQUI, '..', '..')

// SYNTHETIC tokens. Prefix and length are what the `github-token` rule reads;
// the guts are a keyboard sequence, nobody's credential. Built by concatenation
// so this file is not a finding of the scanner it proves.
const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const TOKEN2 = 'ghp_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2'
const LINHA = `$Token = "${TOKEN}"`
const MARCA = 'rebar-segredo-' + 'ok: synthetic fixture of this proof'
const MARCA_SEM_MOTIVO = 'rebar-segredo-' + 'ok:'
const CASO_VALIDO = JSON.stringify({ rule: 'hardcoded-secret', why: 'fixture of this proof' })
const RAIZ_DE_SEGURANCA = 'tooling/security/proofs/cases/'

/** Code points never appear raw in this file: every invisible is built here. */
const cp = (...n) => String.fromCodePoint(...n)
const rotulo = (n) => `<U+${n.toString(16).toUpperCase().padStart(4, '0')}>`
const partir = (token, n, onde = 10) => token.slice(0, onde) + cp(n) + token.slice(onde)

/**
 * The machine's git config does not reach a fixture. tooling/rebar-check/proofs/
 * prove.mjs measured why: commit.gpgsign locks a commit (and `--no-verify` does
 * not bypass it), core.hooksPath fires a foreign hook, init.templateDir injects
 * files, and a global ignore silently dropped a fixture from `git add -A`. The
 * tests about untracked and ignored `caso.json` markers depend on exactly what
 * `git add -A` sees, so the same neutralization applies here, to git AND to the
 * scanner, which runs git itself. A missing config file is read as empty.
 */
const SEM_CONFIG = join(tmpdir(), 'rebar-secret-gitconfig-inexistente')
const AMBIENTE = {
  ...process.env,
  NO_COLOR: '1',
  GIT_CONFIG_GLOBAL: SEM_CONFIG,
  GIT_CONFIG_SYSTEM: SEM_CONFIG,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.excludesFile',
  GIT_CONFIG_VALUE_0: SEM_CONFIG,
  GIT_AUTHOR_NAME: 'Prova',
  GIT_AUTHOR_EMAIL: 'prova@rebar.local',
  GIT_COMMITTER_NAME: 'Prova',
  GIT_COMMITTER_EMAIL: 'prova@rebar.local',
  GIT_TERMINAL_PROMPT: '0',
}

function varrer(dir, argumentos, limiteMs) {
  const r = spawnSync(process.execPath, [VARREDOR, ...argumentos], {
    cwd: dir,
    encoding: 'utf8',
    env: AMBIENTE,
    maxBuffer: 64 * 1024 * 1024,
    timeout: limiteMs,
    windowsHide: true,
  })
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    codigo: r.status ?? 1,
    estourou: r.error?.code === 'ETIMEDOUT',
  }
}

/**
 * Builds a miniature repository, puts the files in the INDEX and runs
 * `--staged`. Index and not disk because that is how the hook calls it, and
 * because this scanner's own earlier audit found the case where the two
 * diverged.
 *
 * `rastreado` commits and runs WITHOUT `--staged`, which is the mode the
 * `hardcoded-secret` rule runs in CI. `depoisDoAdd(dir)` runs after `git add -A`,
 * so a test can leave the disk and the index saying different things. `json`
 * runs the scanner a second time with `--json`, so one test reads both the
 * printed summary and the structured lists.
 */
async function comArquivos(
  arquivos,
  { rastreado = false, json = false, depoisDoAdd, limiteMs } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'rebar-secret-'))
  try {
    const gitComEntrada = (entrada, ...a) => {
      const r = spawnSync('git', ['-C', dir, ...a], {
        encoding: 'utf8',
        env: AMBIENTE,
        input: entrada,
        windowsHide: true,
      })
      assert.equal(r.status, 0, `git ${a.join(' ')} failed: ${r.stderr}`)
      return r.stdout
    }
    const git = (...a) => gitComEntrada(undefined, ...a)
    git('init', '-q')
    git('config', 'core.autocrlf', 'false')
    for (const [rel, conteudo] of Object.entries(arquivos)) {
      const abs = join(dir, rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, conteudo)
    }
    git('add', '-A')
    if (depoisDoAdd) await depoisDoAdd(dir, gitComEntrada)
    if (rastreado) git('commit', '-q', '--no-verify', '-m', 'prova')
    const modo = rastreado ? [] : ['--staged']
    const texto = varrer(dir, modo, limiteMs)
    const resultado = {
      saida: `${texto.stdout}${texto.stderr}`,
      codigo: texto.codigo,
      estourou: texto.estourou,
      json: null,
    }
    if (json) {
      const estruturado = varrer(dir, [...modo, '--json'])
      assert.equal(estruturado.codigo, texto.codigo, 'the --json run disagreed on the exit code')
      resultado.json = JSON.parse(estruturado.stdout)
    }
    return resultado
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

const achadosDe = (json, caminho) => json.achados.filter((a) => a.caminho === caminho)

describe('the secret scanner · encoding', { concurrency: 4 }, () => {
  test('FINDS · token in UTF-8', async () => {
    const r = await comArquivos({ 'config.ps1': Buffer.from(LINHA, 'utf8') })
    assert.notEqual(r.codigo, 0, `token in UTF-8 passed clean:\n${r.saida}`)
    assert.match(r.saida, /github-token/)
  })

  // THE P1 CASE. Before the fix: exit 0, zero findings, and the file counted as
  // a scanned binary. If `decodificar()` disappears, this test goes back to red
  // and says exactly what started passing again.
  test('FINDS · the SAME token in UTF-16LE with BOM', async () => {
    const r = await comArquivos({ 'config.ps1': Buffer.from('\uFEFF' + LINHA, 'utf16le') })
    assert.notEqual(r.codigo, 0, `token in UTF-16LE passed clean — the P1 is back:\n${r.saida}`)
    assert.match(r.saida, /github-token/)
  })

  test('FINDS · the SAME token in UTF-16BE with BOM', async () => {
    const bruto = Buffer.from('\uFEFF' + LINHA, 'utf16le')
    bruto.swap16()
    const r = await comArquivos({ 'config.ps1': bruto })
    assert.notEqual(r.codigo, 0, `token in UTF-16BE passed clean:\n${r.saida}`)
    assert.match(r.saida, /github-token/)
  })

  test('FINDS · token in UTF-8 with BOM, and the column does not shift', async () => {
    const r = await comArquivos({ 'config.ts': Buffer.from('\uFEFF' + LINHA, 'utf8') })
    assert.notEqual(r.codigo, 0, `token in UTF-8 with BOM passed clean:\n${r.saida}`)
    // The column is the same as in the file without a BOM: the BOM is consumed,
    // not counted.
    assert.match(r.saida, /config\.ts:1:11/)
  })

  test('DOES NOT ACCUSE · an honest file, in the same encodings', async () => {
    const limpo = '$Url = "https://api.github.com"\n$Retries = 3\n'
    const r = await comArquivos({
      'a.ps1': Buffer.from(limpo, 'utf8'),
      'b.ps1': Buffer.from('\uFEFF' + limpo, 'utf16le'),
    })
    assert.equal(r.codigo, 0, `a file with no secret was accused:\n${r.saida}`)
  })

  test('COUNTS · a real binary still goes down the binary path', async () => {
    // Minimal PNG: NUL bytes without a BOM. It does not become text, and the
    // report has to say it went through there — absent coverage that declares
    // itself is different from faked coverage, which was the UTF-16 defect.
    //
    // The literal follows the summary line printed by scan-secret.mjs. If that
    // wording changes, this match has to change with it.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
    const r = await comArquivos({ 'i.png': png })
    assert.match(r.saida, /binary file\(s\)/)
  })
})

// HOLE 8 of the scanner's header. The marker was tested against the WHOLE line
// before any rule ran, and a minified bundle is one line: one escape written
// after the first value silenced a second one 48,050 characters later.
describe(
  'the secret scanner · the escape releases only the finding it follows',
  { concurrency: 4 },
  () => {
    test('FINDS · a minified line of 48 KB, with the marker after the first value', async () => {
      const linha =
        `var a="${TOKEN}";/* ${MARCA} */` + ';var q=0'.repeat(6000) + `;var b="${TOKEN2}";\n`
      const r = await comArquivos({ 'dist/app.min.js': linha }, { json: true })
      assert.equal(r.codigo, 1, `one marker silenced the whole minified line:\n${r.saida}`)
      assert.deepEqual(
        r.json.achados.map((a) => a.coluna),
        [linha.indexOf(TOKEN2) + 1],
      )
      assert.equal(r.json.pulos.liberados.length, 1)
    })

    test('RELEASES · a marker right after the value, and the summary counts it', async () => {
      const r = await comArquivos({ 'a.mjs': `const t = '${TOKEN}' // ${MARCA}\n` })
      assert.equal(r.codigo, 0, `the written escape stopped working:\n${r.saida}`)
      assert.match(r.saida, /1 finding\(s\) released by rebar-segredo-ok/)
    })

    test('FINDS · a marker before the value, and the earlier of two values before one marker', async () => {
      // One marker releases ONE finding: the nearest one that ends before it.
      // Every one of the 10 load-bearing escapes measured in 25 repositories had
      // a single finding on its line, so this costs none of them.
      const casos = [
        { caminho: 'antes.mjs', linha: `/* ${MARCA} */ const t = '${TOKEN}'\n`, token: TOKEN },
        {
          caminho: 'dois.mjs',
          linha: `const a = '${TOKEN}', b = '${TOKEN2}' // ${MARCA}\n`,
          token: TOKEN,
        },
      ]
      const r = await comArquivos(Object.fromEntries(casos.map((c) => [c.caminho, c.linha])), {
        json: true,
      })
      assert.equal(r.codigo, 1, r.saida)
      for (const c of casos) {
        const achados = achadosDe(r.json, c.caminho)
        assert.deepEqual(
          achados.map((a) => [a.regra, a.coluna]),
          [['github-token', c.linha.indexOf(c.token) + 1]],
          `${c.caminho}: ${JSON.stringify(achados)}`,
        )
      }
      assert.deepEqual(
        r.json.pulos.liberados.map((l) => [l.caminho, l.coluna]),
        [['dois.mjs', casos[1].linha.indexOf(TOKEN2) + 1]],
      )
    })

    test('FINDS · reach boundary: a gap of 256 releases, 257 does not', async () => {
      // The gap runs from the END of the finding to the START of the marker: one
      // closing quote plus the spaces.
      const perto = `const t = '${TOKEN}'` + ' '.repeat(255) + MARCA + '\n'
      const longe = `const t = '${TOKEN}'` + ' '.repeat(256) + MARCA + '\n'
      const r = await comArquivos({ 'perto.mjs': perto, 'longe.mjs': longe }, { json: true })
      assert.equal(r.codigo, 1, r.saida)
      assert.equal(achadosDe(r.json, 'perto.mjs').length, 0, 'gap 256 was not released')
      assert.equal(achadosDe(r.json, 'longe.mjs').length, 1, 'gap 257 was released')
    })

    test('FINDS · at the 2000-unit window seam a match is the one the whole line gives', async () => {
      // A window cut at 2000 is an end of string to the regex, so a finding
      // crossing it was registered 4 units short and the reach was measured
      // from there. Each of those rows has a control at column 3, far from any
      // seam, that must agree with it. The last row is the other side of a
      // cut: the START of a window.
      const conexao = 'mysql:' + '//admin:S3cretPw9@db-' + 'rebar-segredo-' + 'ok:fixture.internal'
      const casos = [
        {
          // `ghp_` from 1964 to 2004, then a gap of 255: released on both.
          caminho: 'costura-gap.js',
          linha: ';'.repeat(1964) + TOKEN + ' '.repeat(255) + MARCA + '\n',
          achados: [],
          liberados: [['github-token', 1965]],
        },
        {
          caminho: 'longe-gap.js',
          linha: ';;' + TOKEN + ' '.repeat(255) + MARCA + ';'.repeat(2500) + '\n',
          achados: [],
          liberados: [['github-token', 3]],
        },
        {
          // The marker is glued INTO the host, at index 2002 of a match that
          // starts at 1975: inside the span, so it releases nothing.
          caminho: 'costura-dentro.js',
          linha: ';'.repeat(1974) + ` ${conexao} ` + ';'.repeat(2500) + '\n',
          achados: [['string-de-conexao', 1976]],
          liberados: [],
        },
        {
          caminho: 'longe-dentro.js',
          linha: `x ${conexao} ` + ';'.repeat(2500) + '\n',
          achados: [['string-de-conexao', 3]],
          liberados: [],
        },
        {
          // DOES NOT ACCUSE: a 49-character value from 1791 to 1840 is not a
          // 40-character AWS secret key. Window 1 starts at 1800, and without
          // the units before it the lookbehind read a string start there and
          // cut the value's last 40 characters out as a "key".
          caminho: 'costura-esquerda.js',
          linha:
            ';'.repeat(1780) +
            'aws secret ' +
            'Q7mZ2kP9xW4vB8nR1tY6u' +
            'L3hS5jD0fGa2Cc4Ee6Ii8Oo1Uu3K' +
            ';'.repeat(2500) +
            '\n',
          achados: [],
          liberados: [],
        },
      ]
      const r = await comArquivos(Object.fromEntries(casos.map((c) => [c.caminho, c.linha])), {
        json: true,
      })
      for (const c of casos) {
        const achados = achadosDe(r.json, c.caminho).map((a) => [a.regra, a.coluna])
        const liberados = r.json.pulos.liberados
          .filter((l) => l.caminho === c.caminho)
          .map((l) => [l.regra, l.coluna])
        assert.deepEqual(
          { achados, liberados },
          { achados: c.achados, liberados: c.liberados },
          c.caminho,
        )
      }
    })

    test('COUNTS · a 256 KiB line the regex cannot end is still one pass, not a frozen hook', async () => {
      // The seam fix first grew the slice until the match ended. On this line
      // the value of `credencial-atribuida-sem-aspas` runs to the `(`, its
      // lookahead fails there, and the regex backtracks over the whole run from
      // every `=`: more than 300 s, killed, against 409 ms before the fix. 60 s
      // is the ceiling so a loaded machine does not make this test lie.
      const r = await comArquivos(
        { 'igual.js': 'x=' + 'a='.repeat(131072) + '(\n' },
        {
          limiteMs: 60_000,
        },
      )
      assert.equal(r.estourou, false, 'the scan did not end in 60 s')
      assert.equal(r.codigo, 0, r.saida)
    })

    test('FINDS · a marker whose reason is only a zero-width space releases nothing', async () => {
      // `\s*\S+` accepted U+200B as the reason: a justification nobody can read.
      const r = await comArquivos({
        'a.mjs': `const t = '${TOKEN}' // ${MARCA_SEM_MOTIVO}${cp(0x200b)}\n`,
      })
      assert.equal(r.codigo, 1, `an invisible reason released the finding:\n${r.saida}`)
      assert.match(r.saida, /github-token/)
    })
  },
)

// HOLE 9 of the scanner's header. Any `caso.json` in any ancestor, read from the
// disk even under `--staged`: an empty untracked one hidden by info/exclude, or a
// directory with that name, gave exit 0 in the hook and passou in
// `hardcoded-secret`.
describe('the secret scanner · proof material needs a validated root', { concurrency: 4 }, () => {
  const fixture = { 'src/config.mjs': `export const t = '${TOKEN}'\n`, 'src/.env': 'X=1\n' }
  const marcadorEscondido = async (dir) => {
    await writeFile(join(dir, 'src', 'caso.json'), '')
    // `git init` without a template directory leaves no .git/info at all.
    await mkdir(join(dir, '.git', 'info'), { recursive: true })
    appendFileSync(join(dir, '.git', 'info', 'exclude'), 'caso.json\n')
  }

  test('FINDS · an empty untracked caso.json hidden by info/exclude exempts nothing (--staged)', async () => {
    const r = await comArquivos(fixture, { depoisDoAdd: marcadorEscondido })
    assert.equal(r.codigo, 1, r.saida)
    assert.match(r.saida, /github-token/)
    assert.match(r.saida, /env-committed/)
  })

  test('FINDS · the same hidden marker in tracked mode, which hardcoded-secret runs', async () => {
    const r = await comArquivos(fixture, { rastreado: true, depoisDoAdd: marcadorEscondido })
    assert.equal(r.codigo, 1, r.saida)
    assert.match(r.saida, /github-token/)
  })

  test('FINDS · a DIRECTORY named caso.json exempts nothing', async () => {
    const r = await comArquivos(
      { 'app/deep/config.mjs': `export const t = '${TOKEN}'\n` },
      { depoisDoAdd: (dir) => mkdir(join(dir, 'app', 'caso.json')) },
    )
    assert.equal(r.codigo, 1, r.saida)
  })

  test('FINDS · a tracked schema-valid caso.json outside the literal roots exempts nothing', async () => {
    const r = await comArquivos({ ...fixture, 'src/caso.json': CASO_VALIDO })
    assert.equal(r.codigo, 1, r.saida)
    assert.match(r.saida, /github-token/)
  })

  test('FINDS · a tracked {} under a literal root exempts nothing, and the refusal is printed', async () => {
    const r = await comArquivos({
      [`${RAIZ_DE_SEGURANCA}x/caso.json`]: '{}',
      [`${RAIZ_DE_SEGURANCA}x/fail/config.mjs`]: `export const t = '${TOKEN}'\n`,
    })
    assert.equal(r.codigo, 1, r.saida)
    assert.match(r.saida, /missing rule and why/)
  })

  test('PRINTS · a refused caso.json reason carries no byte of the file', async () => {
    // V8's JSON.parse message quotes up to 10 raw characters of the input, and
    // the refusal list goes to the hook's terminal: an ESC sequence and 10
    // characters of a token (the redaction prints 4) came through it.
    const esc = String.fromCharCode(0x1b)
    const r = await comArquivos({
      [`${RAIZ_DE_SEGURANCA}x/caso.json`]: `{"rule":"r","why":"w","k": ${TOKEN}}\n`,
      [`${RAIZ_DE_SEGURANCA}y/caso.json`]: `${esc}]0;hook${String.fromCharCode(7)}${esc}[2K\n`,
      [`${RAIZ_DE_SEGURANCA}y/fail/c.mjs`]: `export const t = '${TOKEN2}'\n`,
    })
    assert.equal(r.codigo, 1, r.saida)
    assert.equal((r.saida.match(/— invalid JSON/g) ?? []).length, 2, r.saida)
    const controles = [...r.saida].filter(
      (c) => c.codePointAt(0) < 0x20 && c !== '\n' && c !== '\r',
    )
    assert.equal(controles.length, 0, `raw control character(s) in the output: ${controles.length}`)
    assert.ok(
      !r.saida.includes(TOKEN.slice(0, 5)),
      'more of the token than the 4-character redaction',
    )
  })

  test('FINDS · a valid caso.json AT the folder that holds the cases exempts nothing', async () => {
    const r = await comArquivos({
      [`${RAIZ_DE_SEGURANCA}caso.json`]: CASO_VALIDO,
      [`${RAIZ_DE_SEGURANCA}x/fail/config.mjs`]: `export const t = '${TOKEN}'\n`,
    })
    assert.equal(r.codigo, 1, r.saida)
  })

  test('COUNTS · a valid marker under a root exempts the fixture AND the .env, and lists both', async () => {
    const base = `${RAIZ_DE_SEGURANCA}x/`
    const r = await comArquivos(
      {
        [`${base}caso.json`]: CASO_VALIDO,
        [`${base}fail/config.mjs`]: `export const t = '${TOKEN}'\n`,
        [`${base}fail/.env`]: 'X=1\n',
      },
      { json: true },
    )
    assert.equal(r.codigo, 0, r.saida)
    // The .env used to be exempted without being counted.
    assert.equal(r.json.pulos.provas.length, 2, JSON.stringify(r.json.pulos.provas))
    assert.match(r.saida, /2 proof fixture\(s\) not charged/)
  })

  test('FINDS · --staged reads the marker from the INDEX: {} staged over a valid disk file, or a valid blob staged as a symlink', async () => {
    const base = `${RAIZ_DE_SEGURANCA}x/`
    const r = await comArquivos(
      { [`${base}caso.json`]: '{}', [`${base}fail/config.mjs`]: `export const t = '${TOKEN}'\n` },
      { depoisDoAdd: (dir) => writeFile(join(dir, ...`${base}caso.json`.split('/')), CASO_VALIDO) },
    )
    assert.equal(r.codigo, 1, r.saida)

    // A symlink entry (mode 120000) whose blob — the link target — happens to
    // be schema-valid JSON. Written straight into the index, so no filesystem
    // symlink is needed on Windows. It is not a regular file, and it is refused
    // with the reason.
    const simbolico = await comArquivos(
      { [`${base}fail/config.mjs`]: `export const t = '${TOKEN}'\n` },
      {
        depoisDoAdd: (_dir, git) => {
          const oid = git(CASO_VALIDO, 'hash-object', '-w', '--stdin').trim()
          git(undefined, 'update-index', '--add', '--cacheinfo', `120000,${oid},${base}caso.json`)
        },
      },
    )
    assert.equal(simbolico.codigo, 1, simbolico.saida)
    assert.match(simbolico.saida, /index entry mode 120000 stage 0, not a regular file/)
  })

  test('COUNTS · --staged with a valid marker staged and {} on disk still exempts', async () => {
    const base = `${RAIZ_DE_SEGURANCA}x/`
    const r = await comArquivos(
      {
        [`${base}caso.json`]: CASO_VALIDO,
        [`${base}fail/config.mjs`]: `export const t = '${TOKEN}'\n`,
      },
      {
        json: true,
        depoisDoAdd: (dir) => writeFile(join(dir, ...`${base}caso.json`.split('/')), '{}'),
      },
    )
    assert.equal(r.codigo, 0, r.saida)
    assert.equal(r.json.pulos.provas.length, 1)
  })

  test('LOCKS · the literal roots are the list rebar-check validates', () => {
    // The scanner cannot import rebar-check: it is copied byte for byte into
    // every generated project's hooks. So the list is duplicated, and this
    // assertion is what keeps the two copies one list.
    const extrair = (arquivo) => {
      const fonte = readFileSync(arquivo, 'utf8')
      // Up to the `]` that ends a line: one line in the scanner, many in
      // rebar-check, whose comments inside the list carry no `]`.
      const bloco = fonte.match(/const RAIZES_DE_PROVA = \[([\s\S]*?)\]\r?\n/)
      assert.ok(bloco, `${arquivo} has no RAIZES_DE_PROVA literal`)
      return [...bloco[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    }
    const doVerificador = extrair(join(REBAR, 'tooling', 'rebar-check', 'index.mjs'))
    assert.ok(doVerificador.length >= 2, JSON.stringify(doVerificador))
    assert.deepEqual(extrair(VARREDOR), doVerificador)
  })
})

// HOLE 10 of the scanner's header. A Default_Ignorable code point inside a token
// is drawn as nothing, and it broke every vendor pattern: 8 of 8 variants inside
// a `ghp_` value gave 0 findings.
describe(
  'the secret scanner · an invisible code point does not hide a token',
  { concurrency: 4 },
  () => {
    test('FINDS · 8 invisible variants inside a token, one late in it, plus a credential assignment', async () => {
      const variantes = [0x200b, 0x200d, 0x2060, 0x00ad, 0xfeff, 0xe0041, 0x180e, 0x3164]
      const casos = variantes.map((n, i) => {
        const linha = `export const v = "${partir(TOKEN, n)}"\n`
        return {
          caminho: `v${i}.mjs`,
          linha,
          regra: 'github-token',
          coluna: linha.indexOf('ghp_') + 1,
          n,
        }
      })
      // LATE: after the 34th body character the normal pass already matches
      // the 38 characters before the code point (`{30,}`, and the lookahead
      // accepts U+200B). That piece must give way to the whole token, or the
      // finding says `‹38 chars›` and nothing about what is hidden.
      const tarde = `export const v = "${partir(TOKEN, 0x200b, 38)}"\n`
      casos.push({
        caminho: 'tarde.mjs',
        linha: tarde,
        regra: 'github-token',
        coluna: tarde.indexOf('ghp_') + 1,
        n: 0x200b,
      })
      // The same late token assigned to `$Token`: the normal pass's piece of
      // `github-token` came BEFORE `credencial-atribuida` in rule order, so the
      // token rule keeps the finding. A projected match replaces only a piece of
      // its own rule, never another rule's interval.
      const tardeAtribuida = `$Token = "${partir(TOKEN, 0x200b, 38)}"\n`
      casos.push({
        caminho: 'tarde.ps1',
        linha: tardeAtribuida,
        regra: 'github-token',
        coluna: tardeAtribuida.indexOf('ghp_') + 1,
        n: 0x200b,
      })
      // The normal pass runs first, and `credencial-atribuida` accepts U+200B
      // inside a quoted value (it is not `\s`): it takes the interval and the
      // projected `github-token` overlaps it. The finding must still say what is
      // hidden inside it.
      const atribuida = `$Token = "${partir(TOKEN, 0x200b)}"\n`
      casos.push({
        caminho: 'k.ps1',
        linha: atribuida,
        regra: 'credencial-atribuida',
        coluna: 1,
        n: 0x200b,
      })

      const r = await comArquivos(Object.fromEntries(casos.map((c) => [c.caminho, c.linha])), {
        json: true,
      })
      assert.equal(r.codigo, 1, r.saida.slice(0, 600))
      for (const c of casos) {
        const achados = achadosDe(r.json, c.caminho)
        assert.deepEqual(
          achados.map((a) => [a.regra, a.coluna, a.invisiveis]),
          [[c.regra, c.coluna, [rotulo(c.n)]]],
          `${c.caminho} (${rotulo(c.n)}): ${JSON.stringify(achados)}`,
        )
        if (c.regra === 'github-token') assert.match(achados[0].trecho, /‹40 chars›$/, c.caminho)
      }
    })

    test('FINDS · the column stays ORIGINAL with a surrogate-pair tag before the token', async () => {
      const linha = `x${cp(0xe0041)}y = 1; const v = "${partir(TOKEN, 0x200b, 5)}"\n`
      const r = await comArquivos({ 'v.mjs': linha }, { json: true })
      assert.equal(r.codigo, 1, r.saida.slice(0, 300))
      assert.deepEqual(
        r.json.achados.map((a) => a.coluna),
        [linha.indexOf('ghp_') + 1],
      )
    })

    test('PRINTS · the label of the hidden code point, never the code point itself', async () => {
      // The second file is a NORMAL-pass finding: JavaScript's `\s` includes
      // U+FEFF, so `credencial-atribuida` matches across it and the 4 characters
      // the redacted excerpt prints would carry it raw. The value is 8 units only
      // WITH its trailing U+200B, the rule's minimum: the projection has 7 and
      // does not match, so no projected finding replaces this one.
      const valor = 'Tr0' + 'ub4d' + cp(0x200b)
      const r = await comArquivos({
        'v.mjs': `export const v = "${partir(TOKEN, 0x200b)}"\n`,
        'w.ps1': `pwd${cp(0xfeff)}= '${valor}'\n`,
      })
      assert.equal(r.codigo, 1, r.saida)
      assert.match(r.saida, /<U\+200B>/)
      assert.match(r.saida, /w\.ps1:1:1 {2}credencial-atribuida/)
      assert.match(r.saida, /<U\+FEFF>/)
      const crus = [...r.saida].filter((c) => naFaixa(c.codePointAt(0), IGNORAVEIS))
      assert.equal(
        crus.length,
        0,
        `raw invisible code point(s) in the output: ${crus.map((c) => rotulo(c.codePointAt(0)))}`,
      )
    })

    test('DOES NOT ACCUSE · soft hyphens, a ZWJ emoji, a mid-file BOM, and a hidden code point outside the value', async () => {
      // A FALSE-POSITIVE CONTROL for the first three lines. The last line is the
      // gate of the projection: removing the soft hyphen from `se-cret` puts the
      // word `secret` next to a 40-character mixed value, and `aws-secret-key`
      // matches on the projection with no hidden code point INSIDE the value. A
      // projected match counts only when something was removed from its span.
      const valor = '9fA3kL0pQ7rT2vX8zB4n' + 'M6cW1eY5hJ0gD3sF7aK2'
      const texto =
        `Configura${cp(0xad)}ção do to${cp(0xad)}ken de acesso ${cp(0x1f468, 0x200d, 0x1f4bb)}\n` +
        `${cp(0xfeff)}const tokenUrl = 'https://api.github.com/oauth'\n` +
        `The se${cp(0xad)}cret rotation landed in commit ${valor} last week\n`
      const r = await comArquivos({ 'doc.md': texto, 'b.mjs': texto })
      assert.equal(r.codigo, 0, r.saida)
    })

    test('RELEASES · a marker right after a token found through the projection', async () => {
      const r = await comArquivos({ 'v.mjs': `const v = "${partir(TOKEN, 0x200b)}" // ${MARCA}\n` })
      assert.equal(r.codigo, 0, r.saida)
      assert.match(r.saida, /1 finding\(s\) released by rebar-segredo-ok/)
    })

    test('FINDS · inside a binary island, vendor rules still see through the projection', async () => {
      const corpo = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13]),
        Buffer.from(`k=${partir(TOKEN, 0x2060)};`, 'utf8'),
        Buffer.from([0, 1, 2]),
      ])
      const r = await comArquivos({ 'i.bin': corpo })
      assert.equal(r.codigo, 1, r.saida)
      assert.match(r.saida, /github-token/)
    })

    test('LOCKS · the table of invisible code points is the one texto-seguro proves', () => {
      // The scanner cannot import texto-seguro (it is copied alone into generated
      // projects), so the 17 ranges are duplicated and held equal here; texto-
      // seguro's own proof holds them equal to UCD 17.0.0.
      const fonte = readFileSync(VARREDOR, 'utf8')
      const bloco = fonte.match(/const IGNORAVEIS = \[([\s\S]*?)\r?\n\]/)
      assert.ok(bloco, 'scan-secret.mjs has no IGNORAVEIS literal')
      const faixas = [...bloco[1].matchAll(/\[\s*(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)\s*\]/gi)].map(
        (m) => [Number(m[1]), Number(m[2])],
      )
      assert.deepEqual(faixas, IGNORAVEIS)
      assert.equal(faixas.length, 17)
      assert.equal(
        faixas.reduce((soma, [a, b]) => soma + b - a + 1, 0),
        4174,
      )
    })
  },
)
