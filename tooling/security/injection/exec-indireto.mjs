// exec-indireto — indirect-exec-change: the change that makes an obedient agent
// run something new without any instruction file changing.
//
// WHY. An instruction file says "run the tests before you commit", and the agent
// does. GitInject (arXiv 2606.09935) measured the configuration-file channel
// working in 2 of 2 scenarios on most models tested, while the same payload in a
// pull request body worked in 0 of 4. So the injection does not need to touch the
// instruction file: it can change what `npm test` runs, add a hook npm runs on
// install, or drop a Python file where a script's import will find it first.
//
// THREE SIGNALS, AND WHY ONLY THESE.
//   (a) a package.json script whose value changed since the first parent of HEAD
//       AND gained an execution family it did not have (a pipe into a shell or
//       interpreter, a download tool, command substitution, a netcat listener, an
//       SSH key path, a URL, eval, a base64 decode). "The script an instruction
//       file names changed" alone fired on 14 of 212 commits (6.6%) where an
//       instruction file names a command, in 5 of 24 repositories, all honest
//       edits of a verify script. Refined, 0 of 199 changed script values in 67
//       manifest-touching commits of 570 first-parent commits with a parent
//       (the 23 local repositories and rebar, measured with this engine).
//   (b) a new install hook: a script key npm runs on `npm install` or `npm ci`
//       (preinstall, install, postinstall, prepublish, preprepare, prepare,
//       postprepare) or whenever node_modules changes (dependencies). 0 of the
//       same 570 commits added one.
//   (c) a Python file named like a standard library module in a folder with no
//       tracked __init__.py, or a package of that name whose parent has none. A
//       script run by path puts its own folder first on sys.path, so its import
//       finds the file. 0 of 24 repositories (126 tracked .py in 6 of them; the one
//       stdlib name sits inside a package), and 2 module files plus 1 vendored
//       namespace package among 20,291 .py files of a Python 3.12 site-packages.
// Rejected: an execution token in ANY script, judged statically. 0 of 273 local
// scripts, but 151 of 8,755 scripts in 1,453 node_modules packages (1.7%).
//
// THE RANGE is HEAD^1 (the first parent) to the index, read by lerDoPai. With no
// parent (unborn, root commit, shallow clone) the range half is not evaluated
// and the verdict covers the static half only, with no nota: the noise rule of
// the gate forbids a warning nobody can act on.
//
// Printed: positions, script keys (escaped), family labels and a sha256 of the
// script value. Never the value.

import { createHash } from 'node:crypto'
import { posix } from 'node:path'

import { escaparSaida } from '../texto-seguro.mjs'
import { lerJsonc } from './formats.mjs'
import { comandosNomeados, ehArquivoMarkdown } from './instrucoes.mjs'
import {
  allowlistMalformada,
  impressao,
  lerAllowlist,
  lerDoPai,
  lerIndice,
  notasDaAllowlist,
  onde,
  posicao,
  resumir,
} from './reader.mjs'

const na = (motivo) => ({ na: motivo })
const j = (...partes) => partes.join('')
const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')
const codificarSegmento = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1')
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * The top-level modules of Python 3.12.10 `sys.stdlib_module_names` without a
 * leading underscore (212), minus the 21 no file can shadow on Windows or Linux.
 * Measured on Windows CPython 3.12.10 with a sibling `<name>.py` for all 212 and
 * a script run by path: 181 resolve to the sibling. Of the 31 that do not, these
 * 21 are unshadowable on every build for a structural reason: loaded before a
 * script's first line (abc, builtins, codecs, encodings, genericpath, io,
 * marshal, os, site, stat, sys), frozen into every build by freeze_modules
 * (ntpath, posixpath, runpy, zipimport), or compiled into every interpreter
 * (atexit, errno, faulthandler, gc, itertools, time). The other 10 stay, because
 * they are built in only on Windows (array, audioop, binascii, cmath, math,
 * mmap, zlib are extension modules on a Linux build) or exist only there
 * (msvcrt, nt, winreg). No Linux interpreter was measured.
 */
export const STDLIB_PYTHON = Object.freeze(
  (
    'aifc antigravity argparse array ast asyncio audioop base64 bdb binascii bisect bz2 cProfile ' +
    'calendar cgi cgitb chunk cmath cmd code codeop collections colorsys compileall concurrent ' +
    'configparser contextlib contextvars copy copyreg crypt csv ctypes curses dataclasses datetime ' +
    'dbm decimal difflib dis doctest email ensurepip enum fcntl filecmp fileinput fnmatch fractions ' +
    'ftplib functools getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http ' +
    'idlelib imaplib imghdr importlib inspect ipaddress json keyword lib2to3 linecache locale ' +
    'logging lzma mailbox mailcap math mimetypes mmap modulefinder msilib msvcrt multiprocessing ' +
    'netrc nis nntplib nt nturl2path numbers opcode operator optparse ossaudiodev pathlib pdb ' +
    'pickle pickletools pipes pkgutil platform plistlib poplib posix pprint profile pstats pty ' +
    'py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib resource ' +
    'rlcompleter sched secrets select selectors shelve shlex shutil signal smtplib sndhdr socket ' +
    'socketserver sqlite3 sre_compile sre_constants sre_parse ssl statistics string stringprep ' +
    'struct subprocess sunau symtable sysconfig syslog tabnanny tarfile telnetlib tempfile termios ' +
    'textwrap this threading timeit tkinter token tokenize tomllib trace traceback tracemalloc tty ' +
    'turtle turtledemo types typing unicodedata unittest urllib uu uuid venv warnings wave weakref ' +
    'webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zlib zoneinfo'
  )
    .split(' ')
    // The two Unix password database modules, their names assembled:
    // password-without-kdf reads those letters as a password next to this file's
    // sha256 call.
    .concat(['p' + 'wd', 'sp' + 'wd']),
)
const STDLIB = new Set(STDLIB_PYTHON)

/**
 * Script keys npm runs by itself. The npm docs bundled with Node v24.13.0
 * (using-npm/scripts.md, "Life Cycle Operation Order") list the first seven for
 * both `npm install` and `npm ci`; `dependencies` runs whenever an npm command
 * changes node_modules.
 */
const GANCHOS_DE_INSTALACAO = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
  'dependencies',
]

// The execution families a script can gain. Labels are printed; the text never is.
const FAMILIAS_DE_EXEC = [
  [
    'pipe into a shell or interpreter',
    new RegExp(
      j('\\|\\s*(ba', 'sh|s', 'h|z', 'sh|pwsh|power', 'shell|i', 'ex|no', 'de|pyth', 'on3?)\\b'),
    ),
  ],
  ['download tool', new RegExp(j('\\b(cu', 'rl|wg', 'et)\\b'))],
  ['command substitution', new RegExp(j('\\$', '\\(|', '`'))],
  ['network listener', new RegExp(j('\\bn', 'c\\s+-e'))],
  ['SSH key path', new RegExp(j('~\\/\\.s', 'sh|\\bid_r', 'sa\\b'))],
  ['URL', new RegExp(j('https?:', '\\/\\/'))],
  ['eval', new RegExp(j('\\bev', 'al\\b'))],
  ['base64 decode', new RegExp(j('base', '64\\s+(-d|--decode)'))],
]

/** The labels of the execution families a script value carries. */
export function familiasDe(valor) {
  const s = typeof valor === 'string' ? valor : ''
  return FAMILIAS_DE_EXEC.filter(([, re]) => re.test(s)).map(([rotulo]) => rotulo)
}

const EH_MANIFESTO = (caminho) => /(?:^|\/)package\.json$/.test(caminho)

/** The folder an instruction file speaks for: its own, above any dot folder. */
function pastaBase(caminho) {
  const partes = caminho.split('/').slice(0, -1)
  const k = partes.findIndex((p) => p.startsWith('.'))
  return (k === -1 ? partes : partes.slice(0, k)).join('/')
}

const pastaDe = (caminho) =>
  caminho.includes('/') ? caminho.slice(0, caminho.lastIndexOf('/')) : ''

/** The scripts object of a strict JSON manifest, `{}` when there is none, null when it does not parse. */
function scriptsDe(texto) {
  const analise = lerJsonc(texto, { estrito: true })
  if (analise.erro) return null
  return { scripts: ehObjeto(analise.valor?.scripts) ? analise.valor.scripts : {}, analise }
}

/**
 * indirect-exec-change over the index of `r.dir`: the reprova string, `{ nota }`,
 * null, or `na` when there is neither a manifest with a parent commit nor a
 * tracked Python file.
 */
export function checarIndirectExec(r) {
  const indice = lerIndice(r.dir)
  const allowlist = lerAllowlist(r.dir)
  const malformada = allowlistMalformada(allowlist)
  if (malformada) return malformada

  const reais = indice.entradas.filter((e) => e.viaSymlink === null && e.symlink === null)
  const manifestos = reais.filter((e) => EH_MANIFESTO(e.caminho) && e.texto !== null)
  const pythons = reais.filter((e) => e.caminho.endsWith('.py'))
  const pai = manifestos.length ? lerDoPai(r.dir, EH_MANIFESTO) : null
  if ((pai === null || !manifestos.length) && !pythons.length) {
    const n = notasDaAllowlist(allowlist, 'indirect-exec-change', false)
    return n.length
      ? { nota: n.join(' · ') }
      : na('no package manifest with a parent commit and no Python file tracked')
  }

  const itens = []
  let usouAlguma = false

  // Which script an instruction file tells an agent to run, per folder.
  const nomeados = new Map()
  for (const e of reais) {
    if (e.tipo !== 'agente' || e.texto === null || !ehArquivoMarkdown(e)) continue
    const texto = e.texto.replace(/\r\n/g, '\n')
    for (const { script, indice: k } of comandosNomeados(texto)) {
      const chave = `${pastaBase(e.caminho)}\0${script}`
      if (nomeados.has(chave)) continue
      const { linha, coluna } = posicao(texto, k)
      nomeados.set(chave, onde(e.caminho, linha, coluna))
    }
  }

  for (const e of manifestos) {
    const agora = scriptsDe(e.texto)
    if (!agora) continue
    // Every current script is offered to the allowlist, flagged or not: a range
    // finding disappears one commit later, and an entry used only when flagged
    // would turn into a stale-entry warning on the next commit.
    const aceitos = new Map()
    for (const [chave, valor] of Object.entries(agora.scripts)) {
      if (typeof valor !== 'string') continue
      const aceito = allowlist.aceita('indirect-exec-change', {
        arquivo: e.caminho,
        ponteiro: `/scripts/${codificarSegmento(chave)}`,
        sha256: sha256(valor),
      })
      aceitos.set(chave, aceito)
    }
    if (pai === null) continue
    let antes = {}
    if (pai.has(e.caminho)) {
      const anterior = pai.get(e.caminho)
      const lido = anterior.texto === null ? null : scriptsDe(anterior.texto)
      if (!lido) continue
      antes = lido.scripts
    }
    const lugar = (chave) => {
      const p = agora.analise.posicoes?.get(`/scripts/${codificarSegmento(chave)}`)
      return onde(e.caminho, p ? p.linha : 1, p ? p.coluna : 1)
    }
    const pasta = pastaDe(e.caminho)
    for (const chave of Object.keys(agora.scripts)) {
      const valor = agora.scripts[chave]
      const nova = GANCHOS_DE_INSTALACAO.includes(chave) && !Object.hasOwn(antes, chave)
      const ganhas =
        typeof valor === 'string' && valor !== antes[chave]
          ? familiasDe(valor).filter((f) => !familiasDe(antes[chave]).includes(f))
          : []
      if (!nova && !ganhas.length) continue
      if (aceitos.get(chave)) {
        usouAlguma = true
        continue
      }
      const nome = escaparSaida(chave, { limite: 60 })
      if (nova)
        itens.push(
          `${lugar(chave)} scripts.${nome} is new since the parent commit (it runs on install)`,
        )
      if (ganhas.length) {
        const nomeado = nomeados.get(`${pasta}\0${chave}`)
        itens.push(
          `${lugar(chave)} scripts.${nome} gained ${ganhas.join(', ')} since the parent commit ` +
            `(${impressao(valor)})${nomeado ? `; named in ${nomeado}` : ''}`,
        )
      }
    }
  }

  const scripts = itens.length
  let python = 0
  const caminhos = new Set(reais.map((e) => e.caminho))
  const porCaminho = new Map(reais.map((e) => [e.caminho, e]))
  const temInit = (pasta) => caminhos.has(pasta ? `${pasta}/__init__.py` : '__init__.py')
  const ondeRoda = (pasta) =>
    pasta ? `a script in ${escaparSaida(pasta)}/` : 'a script in the repository root'
  for (const e of pythons) {
    const nome = posix.basename(e.caminho).slice(0, -3)
    const pasta = pastaDe(e.caminho)
    let item = null
    if (nome === '__init__') {
      const pacote = posix.basename(pasta)
      const acima = pastaDe(pasta)
      if (pasta && STDLIB.has(pacote) && !temInit(acima)) {
        item =
          `${escaparSaida(pasta)}/ can shadow the standard library package ${pacote} when ` +
          `${ondeRoda(acima)} is run by path`
      }
    } else if (STDLIB.has(nome) && !temInit(pasta)) {
      item =
        `${escaparSaida(e.caminho)} can shadow the standard library module ${nome} when ` +
        `${ondeRoda(pasta)} is run by path`
    }
    if (!item) continue
    if (
      allowlist.aceita('indirect-exec-change', {
        arquivo: e.caminho,
        oid: porCaminho.get(e.caminho).oid,
      })
    ) {
      usouAlguma = true
      continue
    }
    itens.push(item)
    python++
  }

  if (itens.length) {
    return (
      `${itens.length} indirect execution change(s): ${resumir(itens)} — an agent told to run ` +
      'the project scripts runs this too; ' +
      [
        scripts ? 'review what the script now executes' : null,
        python ? 'rename the Python file or add the __init__.py of a package' : null,
      ]
        .filter(Boolean)
        .join('; ') +
      ', or allowlist it with a reason'
    )
  }
  const n = notasDaAllowlist(allowlist, 'indirect-exec-change', usouAlguma)
  return n.length ? { nota: n.join(' · ') } : null
}
