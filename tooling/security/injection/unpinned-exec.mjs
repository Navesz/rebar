// unpinned-exec — a git or tarball package that a workflow, an MCP config, a
// package script or an agent instruction RUNS is addressed by a commit id.
//
// WHY A COMMIT AND NOT A BRANCH. `npx --yes github:<owner>/<repo> .` runs
// whatever the default branch of that repository holds at the instant the job
// starts: a push there changes what every consumer executes, with no diff in the
// consumer. rebar's own generated projects ran the ruler that way until
// 2026-09-13, three sites at once. A 40-hex commit id cannot move.
//
// WHY THE TARBALL COUNTS AS A PIN. Measured on 2026-09-13 against
// 134f1126e65758781f962681b2e01a7b753c1689 with an isolated cache each time:
// npm 10.9.3, the npm that ships with Node 22 on the runners, exits 1 on
// `github:<owner>/<repo>#<sha>` ("GitFetcher requires an Arborist constructor to
// pack a tarball"), and both npm 10.9.3 and npm 11.6.2 run the commit tarball
// `https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>`. So the fix this rule
// asks for has to be a spelling npm 10 runs, and codeload by commit is one.
//
// WHAT IS JUDGED, AND WHAT IS NOT. Four places execute a command without a
// person retyping it: root workflows, MCP server launches, package.json scripts
// and agent instruction files (an agent runs the command it is told to run).
// Prose is not judged: rebar's README carries 5 command lines that run rebar
// unpinned for the people who read it (lines 27, 28, 133, 134 and 135,
// measured), and a README command is read before it is typed. Registry specs by
// tag or version, container images and Deno modules are other questions; so are
// `uses:` action tags and git hooks. The README limits table lists each.
//
// WHAT IS NEVER PRINTED. The spec text: a finding names the file, the line, the
// family and the kind of reference, and the spec only as `sha256:<12> len:<n>`.
//
// ─────────────────────────────────────────────────────────────── the API
//
/**
 * checarUnpinnedExec(r, { EXECUTORES_REMOTOS, SINAIS_DE_SHELL })
 *   -> string (reprova) | null | { na }
 *   The two tables are mcp-server-launch's, received as parameters and handed
 *   to classificarLancamento, which decides what a command runs. No nota: a
 *   remote execution is pinned or it is not.
 *
 * fixacao(pacote, familia) -> true | false | null
 *   One package record of classificarLancamento. null when this rule does not
 *   judge the spec (registry, local path, image, Deno module).
 *
 * segmentosDeComando(texto) -> string[]
 *   The simple commands of a shell text: backslash-newline joined, comment lines
 *   dropped, cut at unquoted && || ; | & ( ) and backtick, stopped at an
 *   unquoted # after whitespace.
 */

import { posix } from 'node:path'

import { escaparSaida } from '../texto-seguro.mjs'
import { lerJsonc, lerYaml } from './formats.mjs'
import { classificarLancamento, lerConfigsMcp, palavras } from './mcp-launch.mjs'
import { NOME_DA_ALLOWLIST, impressao, lerAllowlist, lerIndice, onde, resumir } from './reader.mjs'

const na = (motivo) => ({ na: motivo })

/**
 * The two readings of a command string: `palavras`, which keeps a backslash
 * as cmd and PowerShell do, and `palavrasPosix`, as bash reads it. A spec
 * either reading runs is judged, once.
 */
const LEITURAS = [palavras, (texto) => palavrasPosix(texto)]

const HEX_DE_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/**
 * The tarball URLs that name one immutable content. codeload and the archive
 * URL by commit id are what GitHub serves for a commit; a registry tarball with
 * an exact version is immutable because the registry refuses to republish a
 * version. http://, a branch or tag archive and any other host are not.
 */
const TARBALLS_FIXADOS = [
  /^https:\/\/codeload\.github\.com\/[\w.-]+\/[\w.-]+\/tar\.gz\/(?:[0-9a-f]{40}|[0-9a-f]{64})$/,
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/archive\/(?:[0-9a-f]{40}|[0-9a-f]{64})\.tar\.gz$/,
  /^https:\/\/registry\.npmjs\.org\/(?:@[^/]+\/)?[^/]+\/-\/[^/]+-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.tgz$/,
]

/** The ref of a pip-style `git+<scheme>://[user@]host/path@ref#fragment`, or ''. */
function refPython(espec) {
  const semFragmento = String(espec).split('#')[0]
  const semEsquema = semFragmento.replace(/^git\+[A-Za-z][A-Za-z0-9+.-]*:\/\//, '')
  // The `user@` of an ssh URL comes before the first `/` or `:`; the ref's `@`
  // comes after the path starts. Measured before this parse: the reader of
  // mcp-launch.mjs stopped at `git@` and read every pinned ssh spec as unpinned.
  const corte = semEsquema.search(/[/:]/)
  const usuario = semEsquema.indexOf('@')
  const resto =
    usuario !== -1 && (corte === -1 || usuario < corte) ? semEsquema.slice(usuario + 1) : semEsquema
  const arroba = resto.lastIndexOf('@')
  const barra = resto.search(/[/:]/)
  return arroba > barra && barra !== -1 ? resto.slice(arroba + 1) : ''
}

/**
 * The hosts npm's hosted-git-info knows. A URL on one of them that names only
 * `<owner>/<repo>` (with `.git`, or GitHub's `/tree/<ref>`) is a git
 * repository to npm, not a tarball, so its ref decides the pin.
 */
const HOSPEDEIROS_GIT = new Set([
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'gist.github.com',
  'git.sr.ht',
])
const ATALHOS_GIT = new Set(['github:', 'gitlab:', 'bitbucket:', 'gist:', 'sourcehut:'])
const PROTOCOLOS_GIT = new Set([
  'git:',
  'git+http:',
  'git+https:',
  'git+rsync:',
  'git+ftp:',
  'git+file:',
  'git+ssh:',
  'ssh:',
])

const EH_URL = /^(?:git[+])?[a-z]+:/i
const EH_SCP = /^[^@]+@[^:.]+\.[^:]+:.+$/i
const EH_ARQUIVO_TAR = /[.](?:tgz|tar\.gz|tar)$/i

/** The commit-ish of a git fragment: `a::path:b` keeps `a`; `semver:` is no commit. */
function commitish(fragmento) {
  for (const parte of String(fragmento ?? '').split('::')) {
    if (parte && !parte.includes(':')) return parte
  }
  return ''
}

/** hosted-git-info's GitHub shorthand test: `o/r`, `o/r#ref`, no scheme, no second slash. */
function ehAtalhoGithub(e) {
  const hash = e.indexOf('#')
  const antes = hash === -1 ? e : e.slice(0, hash)
  const barra = antes.indexOf('/')
  return (
    barra > 0 &&
    antes.indexOf('/', barra + 1) === -1 &&
    !/\s/.test(antes) &&
    !antes.includes(':') &&
    !antes.includes('@') &&
    !antes.startsWith('.') &&
    !antes.endsWith('/')
  )
}

/**
 * What npm does with a package spec, ported from npm-package-arg (npm 11.6.2):
 * `{ tipo: 'git', ref }`, `{ tipo: 'tarball', url }`, or `{ tipo: 'outro' }`
 * for a registry name, an alias, a local path or a URL npm refuses.
 *
 * WHY A PORT. The first reader matched a few lowercase prefixes, and npm reads
 * more spellings as git than that. Measured with npm-package-arg from npm
 * 11.6.2 and `npm exec --offline` on 2026-09-13: `foo@github:Navesz/rebar`,
 * `git@github.com:Navesz/rebar.git`, `ssh://git@github.com/Navesz/rebar.git`,
 * `git+HTTPS://github.com/Navesz/rebar.git` and `GITHUB:Navesz/rebar` all
 * resolved to the default branch, and `HTTPS://codeload.../tar.gz/main` to a
 * branch tarball, while the rule read each as a registry name and passed.
 */
export function especDoNpm(espec) {
  const e = String(espec)
  const fimDoNome = e.indexOf('@', 1)
  const parteDoNome = fimDoNome > 0 ? e.slice(0, fimDoNome) : e
  let alvo
  if (EH_URL.test(e)) alvo = e
  else if (EH_SCP.test(e)) alvo = `git+ssh://${e}`
  else if (
    !parteDoNome.startsWith('@') &&
    (/[\\/]/.test(parteDoNome) || EH_ARQUIVO_TAR.test(parteDoNome))
  )
    alvo = e
  else if (fimDoNome > 0) alvo = e.slice(fimDoNome + 1)
  else return { tipo: 'outro' }

  if (/^file:/i.test(alvo) || /^(?:[.]|~[\\/]|[\\/]|[a-zA-Z]:)/.test(alvo)) return { tipo: 'outro' }
  if (/^npm:/i.test(alvo)) return { tipo: 'outro' }
  if (ehAtalhoGithub(alvo)) {
    return { tipo: 'git', ref: commitish(alvo.split('#').slice(1).join('#')) }
  }

  const esquema = /^([a-z][a-z0-9+.-]*:)/i.exec(alvo)
  if (!esquema) return { tipo: 'outro' }
  const protocolo = esquema[1].toLowerCase()
  const hash = alvo.indexOf('#')
  const fragmento = hash === -1 ? '' : alvo.slice(hash + 1)
  const semFragmento = hash === -1 ? alvo : alvo.slice(0, hash)
  if (ATALHOS_GIT.has(protocolo) || PROTOCOLOS_GIT.has(protocolo)) {
    return { tipo: 'git', ref: commitish(fragmento) }
  }
  if (protocolo !== 'http:' && protocolo !== 'https:') return { tipo: 'outro' }
  let url
  try {
    url = new URL(semFragmento)
  } catch {
    return { tipo: 'outro' }
  }
  const host = url.hostname.replace(/^www\./, '')
  const partes = url.pathname.split('/').filter(Boolean)
  if (HOSPEDEIROS_GIT.has(host)) {
    if (partes.length === 2) return { tipo: 'git', ref: commitish(fragmento) }
    if (host === 'github.com' && partes[2] === 'tree') {
      return { tipo: 'git', ref: commitish(fragmento) || partes.slice(3).join('/') }
    }
  }
  // The WHATWG parser lowercases the scheme and the host, which is what npm
  // fetches; the path keeps its case.
  return { tipo: 'tarball', url: `${url.protocol}//${url.host}${url.pathname}${url.search}` }
}

/** What kind of unpinned reference, for the finding; null when it is pinned or not judged. */
function tipoDaFalha(pacote, familia) {
  const espec = String(pacote.espec)
  let tipo = null
  if (familia === 'python') {
    if (!/^git\+/i.test(espec)) return null
    const ref = refPython(espec)
    if (HEX_DE_COMMIT.test(ref)) return null
    tipo = ref ? 'git ref that is not a commit id' : 'git spec with no commit ref'
  } else if (familia === 'npm') {
    const c = especDoNpm(espec)
    if (c.tipo === 'git') {
      if (HEX_DE_COMMIT.test(c.ref)) return null
      tipo = c.ref ? 'git ref that is not a commit id' : 'git spec with no commit ref'
    } else if (c.tipo === 'tarball') {
      if (TARBALLS_FIXADOS.some((re) => re.test(c.url))) return null
      tipo = 'tarball not addressed by a commit'
    } else return null
  } else return null
  // A commit spelled through a variable (`${REBAR}`, `${{ env.REBAR }}`) may
  // well be a commit, and this rule reads no environment: the kind says so
  // instead of calling the ref a branch. Measured before: an env-pinned
  // codeload URL failed as "tarball not addressed by a commit".
  return espec.includes('$')
    ? 'reference built from a variable, which this rule does not resolve (spell the commit in the command)'
    : tipo
}

export function fixacao(pacote, familia) {
  const espec = String(pacote?.espec ?? '')
  if (familia === 'python')
    return /^git\+/i.test(espec) ? tipoDaFalha(pacote, familia) === null : null
  if (familia !== 'npm') return null
  const c = especDoNpm(espec)
  if (c.tipo !== 'git' && c.tipo !== 'tarball') return null
  return tipoDaFalha(pacote, familia) === null
}

// ───────────────────────────────────────────────────────── the POSIX words

// ESC as a sum: control-bytes flags the escape built from its literal number in
// source, and this file would otherwise accuse itself (security-table, measured).
const ESC = String.fromCharCode(26 + 1)

const ESCAPES_ANSI = {
  a: String.fromCharCode(7),
  b: String.fromCharCode(8),
  e: ESC,
  E: ESC,
  f: String.fromCharCode(12),
  n: String.fromCharCode(10),
  r: String.fromCharCode(13),
  t: String.fromCharCode(9),
  v: String.fromCharCode(11),
}

/** One ANSI-C escape at `t[j]` (a backslash): [decoded text, characters consumed]. */
function escapeAnsi(t, j) {
  const resto = t.slice(j + 1)
  const hex = /^x([0-9a-fA-F]{1,2})/.exec(resto)
  if (hex) return [String.fromCharCode(parseInt(hex[1], 16)), 1 + hex[0].length]
  const uni = /^u([0-9a-fA-F]{1,4})|^U([0-9a-fA-F]{1,8})/.exec(resto)
  if (uni) {
    const cp = parseInt(uni[1] ?? uni[2], 16)
    return [cp <= 0x10ffff ? String.fromCodePoint(cp) : '', 1 + uni[0].length]
  }
  const oct = /^[0-7]{1,3}/.exec(resto)
  if (oct) return [String.fromCharCode(parseInt(oct[0], 8) & 0xff), 1 + oct[0].length]
  const n = resto[0] ?? ''
  return [Object.hasOwn(ESCAPES_ANSI, n) ? ESCAPES_ANSI[n] : n, 2]
}

/**
 * Shell words as bash reads them: a backslash outside quotes keeps the next
 * character, `'...'` is literal, `"..."` unescapes only dollar, backtick,
 * quote, backslash and a line break, and `$'...'` decodes ANSI-C escapes.
 * Measured on 2026-09-13 with bash's printf: `gith\ub:Navesz/rebar` and
 * `$'github:Navesz/rebar'` both reach npx as `github:Navesz/rebar`, and
 * `palavras` read them as other words. A Windows shell keeps the backslash,
 * which is `palavras`' reading; the rule judges both.
 */
export function palavrasPosix(s) {
  const saida = []
  const t = String(s)
  let atual = ''
  let tem = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === '\\') {
      if (t[i + 1] === '\n') i++
      else if (i + 1 < t.length) {
        atual += t[++i]
        tem = true
      }
      continue
    }
    if (c === "'") {
      const fim = t.indexOf("'", i + 1)
      atual += t.slice(i + 1, fim === -1 ? t.length : fim)
      i = fim === -1 ? t.length : fim
      tem = true
      continue
    }
    if (c === '$' && t[i + 1] === "'") {
      let j = i + 2
      while (j < t.length && t[j] !== "'") {
        if (t[j] === '\\' && j + 1 < t.length) {
          const [texto, consumidos] = escapeAnsi(t, j)
          atual += texto
          j += consumidos
          continue
        }
        atual += t[j]
        j++
      }
      i = j
      tem = true
      continue
    }
    if (c === '"' || (c === '$' && t[i + 1] === '"')) {
      let j = c === '$' ? i + 2 : i + 1
      while (j < t.length && t[j] !== '"') {
        if (t[j] === '\\' && ['$', '`', '"', '\\', '\n'].includes(t[j + 1])) {
          if (t[j + 1] !== '\n') atual += t[j + 1]
          j += 2
          continue
        }
        atual += t[j]
        j++
      }
      i = j
      tem = true
      continue
    }
    if (/\s/.test(c)) {
      if (tem || atual) saida.push(atual)
      atual = ''
      tem = false
      continue
    }
    atual += c
    tem = true
  }
  if (tem || atual) saida.push(atual)
  return saida
}

// ─────────────────────────────────────────────────────────── the segmenter

/**
 * The here-document a shell line opens, or null: its terminator, whether tabs
 * before the terminator are stripped (`<<-`), and whether the body only becomes
 * a file (`cat` or `tee` with no pipe on the line). A body that becomes a file
 * is data: measured before, `cat > NOTES.md <<'NOTE'` failed the rule on a
 * sentence inside the note. A body fed to anything else (`bash <<EOF`,
 * `cat <<EOF | sh`) is still read as commands, because a shell runs it.
 */
function heredocDaLinha(linha) {
  const m = /(?<!<)<<(?!<)(-?)\s*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z0-9_.-]+))/.exec(linha)
  if (!m) return null
  const antes = linha.slice(0, m.index)
  const aspasSimples = (antes.match(/'/g) || []).length
  const aspasDuplas = (antes.match(/(?<!\\)"/g) || []).length
  if (aspasSimples % 2 || aspasDuplas % 2) return null
  const primeira = palavras(antes.replace(/[<>]+\s*\S+/g, ' '))[0] ?? ''
  const comando = primeira.replace(/\\/g, '/').split('/').pop()
  return {
    fim: m[2] ?? m[3] ?? m[4],
    tabs: m[1] === '-',
    paraArquivo: (comando === 'cat' || comando === 'tee') && !/(?<!\|)\|(?!\|)/.test(linha),
  }
}

export function segmentosDeComando(texto) {
  const saida = []
  const juntado = String(texto).replace(/\\\r?\n/g, ' ')
  const linhas = juntado.split(/\r?\n/)
  for (let n = 0; n < linhas.length; n++) {
    const linha = linhas[n]
    if (/^\s*#/.test(linha)) continue
    const heredoc = heredocDaLinha(linha)
    if (heredoc?.paraArquivo) {
      let k = n + 1
      while (k < linhas.length) {
        const candidata = heredoc.tabs ? linhas[k].replace(/^\t+/, '') : linhas[k]
        if (candidata === heredoc.fim) break
        k++
      }
      // The body and its terminator are blanked; the line that opened it is
      // still read below.
      for (let j = n + 1; j <= k && j < linhas.length; j++) linhas[j] = ''
    }
    let atual = ''
    let aspas = null
    let anterior = ' '
    const empurrar = () => {
      if (atual.trim()) saida.push(atual.trim())
      atual = ''
      anterior = ' '
    }
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i]
      if (aspas) {
        atual += c
        if (c === '\\' && aspas === '"' && i + 1 < linha.length) atual += linha[++i]
        else if (c === aspas) aspas = null
        continue
      }
      if (c === "'" || c === '"') {
        aspas = c
        atual += c
        anterior = c
        continue
      }
      if (c === '\\' && i + 1 < linha.length) {
        atual += c + linha[++i]
        anterior = linha[i]
        continue
      }
      if (c === '#' && /\s/.test(anterior)) break
      if ('&|;()`'.includes(c)) {
        empurrar()
        continue
      }
      atual += c
      anterior = c
    }
    empurrar()
  }
  return saida
}

// ─────────────────────────────────────────────────────────── the sources

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/i
const REGRAS_SEM_EXTENSAO = /^\.(?:cursorrules|windsurfrules|clinerules|roorules(?:-[^/]*)?)$/i

/** Whether an index entry is an agent instruction file this rule reads. */
function ehInstrucao(e) {
  if (e.tipo !== 'agente') return false
  const nome = posix.basename(e.caminho)
  return /\.(?:md|mdc)$/i.test(nome) || REGRAS_SEM_EXTENSAO.test(nome)
}

const pontosAte = (linha, k) => [...linha.slice(0, k)].length + 1

/**
 * The line and column of `espec` in the raw text, searching from `desde`
 * (1-based) forward; `recurso` when it is not spelled verbatim (an escape).
 */
function localizar(linhas, desde, espec, recurso) {
  for (let n = Math.max(0, desde - 1); n < linhas.length; n++) {
    const k = linhas[n].indexOf(espec)
    if (k !== -1) return { linha: n + 1, coluna: pontosAte(linhas[n], k) }
  }
  return recurso
}

/** The `run:` strings of a parsed workflow, with the position of each key. */
function runsDoWorkflow(lido) {
  const saida = []
  const jobs = lido.valor && typeof lido.valor === 'object' ? lido.valor.jobs : null
  if (!jobs || typeof jobs !== 'object') return saida
  for (const [job, corpo] of Object.entries(jobs)) {
    const passos = corpo && typeof corpo === 'object' ? corpo.steps : null
    if (!Array.isArray(passos)) continue
    passos.forEach((passo, i) => {
      if (!passo || typeof passo !== 'object' || typeof passo.run !== 'string') return
      const chave = `/jobs/${String(job).replace(/~/g, '~0').replace(/\//g, '~1')}/steps/${i}/run`
      saida.push({ texto: passo.run, ...(lido.posicoes.get(chave) || { linha: 1, coluna: 1 }) })
    })
  }
  return saida
}

/**
 * The line reader, for a workflow the YAML subset cannot parse (anchors,
 * aliases, tags): the value of every `run:` key, inline (a whole quoted scalar
 * unwrapped), as a `|` block (lines kept) or as a `>` block or a plain
 * multi-line scalar (lines joined with a space, as YAML folds them), and for
 * `run: *name` the value the anchor `&name` holds.
 *
 * ONLY `run:` VALUES, and until 2026-09-13 every line of the file. GitHub
 * Actions accepts anchors, and measured before: a workflow with one `&os` /
 * `*os` pair failed on an example command inside a pull request comment body,
 * while the same file without the anchor passed.
 */
function runsPorLinha(texto) {
  const linhas = texto.split(/\r?\n/)
  const indentacao = (l) => /^\s*/.exec(l)[0].length
  const comentario = (l) => /^\s*#/.test(l)

  /** The scalar that starts after `k` characters of line `n`: [{ texto, linha }]. */
  const valorEm = (n, coluna, valor) => {
    const v = valor.replace(/\s+#.*$/, '').trim()
    const bloco = /^[|>][-+0-9]*$/.exec(v)
    const filhos = []
    for (let j = n + 1; j < linhas.length; j++) {
      if (!linhas[j].trim() || comentario(linhas[j])) {
        if (bloco) filhos.push({ texto: '', linha: j + 1 })
        continue
      }
      if (indentacao(linhas[j]) <= coluna) break
      filhos.push({ texto: linhas[j].trim(), linha: j + 1 })
    }
    if (bloco && v[0] === '|') return filhos.filter((f) => f.texto)
    const partes = bloco ? filhos : [{ texto: v, linha: n + 1 }, ...filhos]
    const junto = partes
      .map((p) => p.texto)
      .filter(Boolean)
      .join(' ')
    const citado = /^(["'])([\s\S]*)\1$/.exec(junto)
    return junto
      ? [{ texto: citado ? citado[2] : junto, linha: (partes[0] ?? { linha: n + 1 }).linha }]
      : []
  }

  const ancoras = new Map()
  linhas.forEach((l, n) => {
    if (comentario(l)) return
    for (const m of l.matchAll(/(?:^|[\s:[{,-])&([^\s,[\]{}]+)(?:\s+(.*))?$/g)) {
      const coluna = indentacao(l)
      ancoras.set(m[1], valorEm(n, coluna, m[2] ?? ''))
    }
  })

  const saida = []
  linhas.forEach((l, n) => {
    if (comentario(l)) return
    const m = /^(\s*(?:-\s+)*)(?:(["']?)run\2)\s*:(?:\s+(.*))?$/.exec(l)
    const emFluxo = !m && /[{,]\s*(["']?)run\1\s*:\s*(.*)$/.exec(l)
    if (!m && !emFluxo) return
    const bruto = m ? (m[3] ?? '') : emFluxo[2].replace(/\s*}\s*$/, '')
    const alias = /^\*([^\s,[\]{}]+)\s*$/.exec(bruto.trim())
    const valores = alias
      ? (ancoras.get(alias[1]) ?? [])
      : valorEm(n, m ? m[1].length : indentacao(l), bruto.replace(/^&[^\s]+\s*/, ''))
    for (const v of valores) saida.push({ texto: v.texto, linha: v.linha, coluna: 1 })
  })
  return saida
}

/**
 * Fenced blocks, indented code blocks and inline code spans of a Markdown
 * text; every line of a rules file.
 *
 * CONTAINERS COUNT. Measured before: a fence indented four spaces inside a
 * list item (the usual shape of step-by-step agent instructions, which GitHub
 * renders as code), a fence inside a `>` blockquote, an indented code block and
 * a code span that crosses a line break were never read. So a fence opens at
 * any indentation, `>` markers are stripped before a line is read, a line
 * indented four spaces or a tab after a blank line is code (inside a list that
 * may be a paragraph: read anyway, the conservative side), and code spans are
 * matched over the whole paragraph.
 */
function trechosDeInstrucao(caminho, texto) {
  const linhas = texto.split('\n')
  const saida = []
  if (REGRAS_SEM_EXTENSAO.test(posix.basename(caminho))) {
    linhas.forEach((l, n) => saida.push({ texto: l, linha: n + 1, coluna: 1 }))
    return saida
  }
  let cerca = null
  let paragrafo = []
  let anteriorEmBranco = true
  let emCodigo = false
  const fecharParagrafo = () => {
    if (!paragrafo.length) return
    const junto = paragrafo.map((p) => p.texto).join('\n')
    const inicios = []
    let k = 0
    for (const p of paragrafo) {
      inicios.push(k)
      k += p.texto.length + 1
    }
    for (const m of junto.matchAll(/(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g)) {
      const pos = m.index + m[1].length
      let i = inicios.length - 1
      while (i > 0 && inicios[i] > pos) i--
      const p = paragrafo[i]
      saida.push({
        texto: m[2].replace(/\n/g, ' '),
        linha: p.linha,
        coluna: p.deslocamento + pontosAte(p.texto, pos - inicios[i]),
      })
    }
    paragrafo = []
  }
  linhas.forEach((bruta, n) => {
    const l = bruta.replace(/\r$/, '')
    const citacao = /^(?:\s{0,3}>\s?)+/.exec(l)
    const prefixo = citacao ? citacao[0].length : 0
    const corpo = l.slice(prefixo)
    const abre = /^\s*(`{3,}|~{3,})(.*)$/.exec(corpo)
    if (cerca) {
      if (abre && abre[1][0] === cerca[0] && abre[1].length >= cerca.length && !abre[2].trim()) {
        cerca = null
      } else saida.push({ texto: corpo, linha: n + 1, coluna: 1 })
      return
    }
    if (abre && !(abre[1][0] === '`' && abre[2].includes('`'))) {
      fecharParagrafo()
      cerca = abre[1]
      anteriorEmBranco = false
      emCodigo = false
      return
    }
    if (!corpo.trim()) {
      fecharParagrafo()
      anteriorEmBranco = true
      return
    }
    if ((anteriorEmBranco || emCodigo) && /^(?: {4}|\t)/.test(corpo)) {
      fecharParagrafo()
      emCodigo = true
      anteriorEmBranco = false
      saida.push({ texto: corpo, linha: n + 1, coluna: 1 })
      return
    }
    emCodigo = false
    anteriorEmBranco = false
    paragrafo.push({ texto: corpo, linha: n + 1, deslocamento: prefixo })
  })
  fecharParagrafo()
  return saida
}

// ─────────────────────────────────────────────────────────────── the rule

export function checarUnpinnedExec(r, { EXECUTORES_REMOTOS, SINAIS_DE_SHELL } = {}) {
  const tabelas = { EXECUTORES_REMOTOS, SINAIS_DE_SHELL }
  const dir = r && typeof r === 'object' ? r.dir : r
  const indice = lerIndice(dir)
  if (indice.semGit)
    return na('no workflow, MCP config, package script or agent instruction file tracked')

  // A malformed allowlist line fails every injection rule, this one included,
  // although this rule exempts nothing: a bypass that cannot be read is refused
  // everywhere, and a rule that stayed green over it would be the exception an
  // attacker looks for.
  const duros = lerAllowlist(dir).erros.map(
    (x) =>
      `${onde(NOME_DA_ALLOWLIST, x.linha, x.coluna)} ${escaparSaida(x.mensagem, { limite: 120 })} ` +
      '(not exemptable)',
  )

  const achados = new Map()
  let fontes = 0

  /** Classifies every simple command of `trecho` and records the unpinned specs. */
  const julgar = (caminho, linhas, trecho) => {
    const cursores = new Map()
    for (const segmento of segmentosDeComando(trecho.texto)) {
      const falhas = new Map()
      for (const dividir of LEITURAS) {
        for (const execucao of classificarLancamento(dividir(segmento), tabelas, { dividir })
          .execucoes) {
          for (const pacote of execucao.pacotes) {
            const tipo = tipoDaFalha(pacote, execucao.familia)
            const espec = String(pacote.espec)
            if (tipo && !falhas.has(espec)) falhas.set(espec, { familia: execucao.familia, tipo })
          }
        }
      }
      for (const [espec, { familia, tipo }] of falhas) {
        const desde = cursores.get(espec) ?? trecho.linha
        const pos = localizar(linhas, desde, espec, { linha: trecho.linha, coluna: trecho.coluna })
        cursores.set(espec, pos.linha + 1)
        const chave = `${caminho}\0${pos.linha}\0${espec}`
        if (!achados.has(chave)) {
          achados.set(
            chave,
            `${onde(caminho, pos.linha, pos.coluna)} ${familia}-family runner, ${tipo} ${impressao(espec)}`,
          )
        }
      }
    }
  }

  for (const e of indice.entradas) {
    if (e.symlink || e.viaSymlink || e.texto === null) continue
    const linhas = e.texto.split('\n')

    if (WORKFLOW.test(e.caminho)) {
      fontes++
      const lido = lerYaml(e.texto)
      const runs = lido.erro ? runsPorLinha(e.texto) : runsDoWorkflow(lido)
      for (const run of runs) julgar(e.caminho, linhas, run)
      continue
    }

    if (posix.basename(e.caminho) === 'package.json') {
      // npm refuses a manifest it cannot parse, so it runs none of its scripts.
      const lido = lerJsonc(e.texto, { estrito: true })
      const scripts = lido.erro ? null : lido.valor?.scripts
      if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) continue
      fontes++
      for (const [nome, corpo] of Object.entries(scripts)) {
        if (typeof corpo !== 'string') continue
        const ponteiro = `/scripts/${nome.replace(/~/g, '~0').replace(/\//g, '~1')}`
        julgar(e.caminho, linhas, {
          texto: corpo,
          ...(lido.posicoes.get(ponteiro) || { linha: 1, coluna: 1 }),
        })
      }
      continue
    }

    if (ehInstrucao(e)) {
      fontes++
      for (const trecho of trechosDeInstrucao(e.caminho, e.texto)) julgar(e.caminho, linhas, trecho)
    }
  }

  // Every server of every MCP config, with no exemption: an allowlist entry for
  // mcp-server-launch pins the TEXT of a launch, and the text of an unpinned
  // spec keeps running whatever the branch holds next.
  const { servidores } = lerConfigsMcp(indice)
  for (const s of servidores) {
    const entrada = indice.porCaminho.get(s.arquivo)
    if (!entrada || entrada.symlink || entrada.viaSymlink || entrada.texto === null) continue
    fontes++
    const linhas = entrada.texto.split('\n')
    for (const argv of [s.argv, s.argvInteiro].filter(Boolean)) {
      const execucoes = LEITURAS.flatMap(
        (dividir) => classificarLancamento(argv, tabelas, { dividir }).execucoes,
      )
      for (const execucao of execucoes) {
        for (const pacote of execucao.pacotes) {
          const tipo = tipoDaFalha(pacote, execucao.familia)
          if (!tipo) continue
          const espec = String(pacote.espec)
          const pos = localizar(linhas, s.linha, espec, { linha: s.linha, coluna: s.coluna })
          const chave = `${s.arquivo}\0${pos.linha}\0${espec}`
          if (!achados.has(chave)) {
            achados.set(
              chave,
              `${onde(s.arquivo, pos.linha, pos.coluna)} ${execucao.familia}-family runner, ${tipo} ${impressao(espec)}`,
            )
          }
        }
      }
    }
  }

  const itens = [...duros, ...achados.values()]
  if (itens.length) {
    const partes = [`${itens.length} remote execution(s) without a commit pin: ${resumir(itens)}`]
    if (achados.size) {
      partes.push(
        ' — pin a 40-hex commit: #<commit> on a git spec, or the commit tarball ' +
          'https://codeload.github.com/<owner>/<repo>/tar.gz/<commit>, which npm 10 and npm 11 ' +
          'both run (not exemptable)',
      )
    }
    return partes.join('')
  }
  if (!fontes)
    return na('no workflow, MCP config, package script or agent instruction file tracked')
  return null
}
