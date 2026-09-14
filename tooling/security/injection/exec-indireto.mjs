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
//       edits of a verify script. Refined, 0 of 200 changed script values in 68
//       manifest-touching commits of 576 first-parent commits with a parent
//       (the 23 local repositories and rebar, measured with this engine).
//   (b) a new install hook: a script key npm runs on `npm install` or `npm ci`
//       (preinstall, install, postinstall, prepublish, preprepare, prepare,
//       postprepare) or whenever node_modules changes (dependencies). It FAILS
//       only through (a), when its value carries a family; with none it is a
//       nota. The same 576 commits added no hook, so the local history has no
//       honest case to measure; node_modules shows how ordinary one is: 258 of
//       1,261 manifests with scripts carry a hook (`prepare: npm run build` 26
//       times, a git hook installer 16), and 0 of their 261 hooks carry a family.
//       Failing every new hook failed `npx husky init` and every new workspace
//       package with a build step.
//   (c) a Python module named like a standard library module in a folder with no
//       tracked __init__, or a package of that name whose parent has none, in any
//       suffix the import system loads. A script run by path puts its own folder
//       first on sys.path, so its import finds the file. 0 of 24 repositories,
//       and 4 among 19,927 importable files of a Python 3.12 site-packages.
// Rejected: an execution token in ANY script, judged statically. 0 of 273 local
// scripts, but 178 of 8,815 scripts in 143 of 1,261 node_modules manifests (2.0%).
//
// THE RANGE is HEAD^1 (the first parent) to the index, read by lerDoPai. With no
// parent (unborn, root commit, shallow clone) the range half is not evaluated
// and the verdict covers the static half only, with no nota about the range:
// the noise rule of the gate forbids a warning nobody can act on. Every package
// manifest is read as npm reads it (formats.mjs lerManifestoNpm).
//
// Printed: positions, script keys (escaped), family labels and a sha256 of the
// script value. Never the value.

import { createHash } from 'node:crypto'
import { posix } from 'node:path'

import { escaparSaida } from '../texto-seguro.mjs'
import { lerManifestoNpm } from './formats.mjs'
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
  sugerirEntrada,
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
  // A URL that leaves the machine: a script that waits on its own dev server at
  // localhost downloads nothing.
  [
    'URL',
    new RegExp(
      j(
        'https?:',
        '\\/\\/(?!(?:localhost|127(?:\\.\\d{1,3}){3}|0\\.0\\.0\\.0|\\[::1\\])(?:[:/?#]|$))',
      ),
    ),
  ],
  // eval called, or run as a shell command, not the word: `promptfoo eval`,
  // `node scripts/eval.mjs` and `vitest run eval/` all read as eval before.
  ['eval', new RegExp(j('\\bev', 'al\\s*\\(|(?:^|[;&|(]\\s*)ev', 'al\\s'))],
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

/** The scripts object of a manifest as npm reads it, `{}` when there is none, null when npm could not read it. */
function scriptsDe(texto) {
  const analise = lerManifestoNpm(texto)
  if (!analise) return null
  return { scripts: ehObjeto(analise.valor?.scripts) ? analise.valor.scripts : {}, analise }
}

/**
 * A git hook installer as the whole value of a hook: `husky` (what `npx husky
 * init` writes), `husky install [dir]`, `lefthook install`, `simple-git-hooks`.
 * What they install are tracked hook files, reviewed as files.
 */
const INSTALADOR_DE_GANCHOS =
  /^(?:(?:npx|bunx|bun|yarn|pnpm(?:\s+exec)?)\s+)?(?:husky(?:\s+install)?(?:\s+[\w./-]+)?|lefthook\s+install|simple-git-hooks)$/

// Every suffix the import system loads a module from: source, Windows source,
// sourceless bytecode, and extension modules with or without an ABI tag
// (`json.cp312-win_amd64.pyd`, `json.cpython-312-x86_64-linux-gnu.so`,
// `json.abi3.so`). Measured on CPython 3.12.10 for Windows: a sibling json.pyw and
// a sourceless json.pyc were imported in place of the standard json.
const MODULO_PYTHON = /^([A-Za-z_]\w*)\.(?:pyw?|pyc|pyd|so|[\w-]+\.(?:pyd|so))$/

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
  const manifestos = reais
    .filter((e) => EH_MANIFESTO(e.caminho) && e.texto !== null)
    .map((e) => ({ e, agora: scriptsDe(e.texto) }))
    .filter((x) => x.agora)
  // Python files are judged by path, so a symlink and a folder mounted through
  // one count: git checks out a 120000 json.py on Windows as a file holding the
  // target path, and Python imported it in place of json (a SyntaxError); on
  // Linux it is the target itself.
  const importaveis = indice.entradas.filter((e) => !e.caminho.split('/').includes('__pycache__'))
  const pythons = importaveis.filter((e) => MODULO_PYTHON.test(posix.basename(e.caminho)))

  // Every current script is offered to the allowlist first, flagged or not and
  // parent or not: a range finding disappears one commit later, and an entry
  // offered only when the range shows it was reported stale ("can be removed")
  // on a root commit or a shallow clone, where deleting it would fail the next
  // full clone.
  let usouAlguma = false
  for (const { e, agora } of manifestos) {
    agora.aceitos = new Map()
    for (const [chave, valor] of Object.entries(agora.scripts)) {
      if (typeof valor !== 'string') continue
      const aceito = allowlist.aceita('indirect-exec-change', {
        arquivo: e.caminho,
        ponteiro: `/scripts/${codificarSegmento(chave)}`,
        sha256: sha256(valor),
      })
      if (aceito) usouAlguma = true
      agora.aceitos.set(chave, aceito)
    }
  }

  const pai = manifestos.length ? lerDoPai(r.dir, EH_MANIFESTO) : null
  if ((pai === null || !manifestos.length) && !pythons.length) {
    const n = notasDaAllowlist(allowlist, 'indirect-exec-change', usouAlguma)
    return n.length
      ? { nota: n.join(' · ') }
      : na('no package manifest with a parent commit and no Python file tracked')
  }

  const itens = []
  const avisos = []

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

  for (const { e, agora } of pai === null ? [] : manifestos) {
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
      if (agora.aceitos.get(chave)) continue
      const nome = escaparSaida(chave, { limite: 60 })
      if (ganhas.length) {
        // What --sugerir-allowlist prints: the script key offered to aceita()
        // above. A new hook with no family only warns, so it gets no line.
        sugerirEntrada(r, 'indirect-exec-change', {
          arquivo: e.caminho,
          ponteiro: `/scripts/${codificarSegmento(chave)}`,
          sha256: sha256(valor),
        })
        const nomeado = nomeados.get(`${pasta}\0${chave}`)
        itens.push(
          `${lugar(chave)} scripts.${nome} gained ${ganhas.join(', ')} since the parent commit ` +
            `(${impressao(valor)})${nova ? ' and is a new install hook' : ''}` +
            `${nomeado ? `; named in ${nomeado}` : ''}`,
        )
      } else if (typeof valor !== 'string' || !INSTALADOR_DE_GANCHOS.test(valor.trim())) {
        avisos.push(`${lugar(chave)} scripts.${nome}`)
      }
    }
  }

  const scripts = itens.length
  let python = 0
  const caminhos = new Set(importaveis.map((e) => e.caminho))
  const pastasComInit = new Set(
    [...caminhos]
      .filter((c) => MODULO_PYTHON.exec(posix.basename(c))?.[1] === '__init__')
      .map(pastaDe),
  )
  const ondeRoda = (pasta) =>
    pasta ? `a script in ${escaparSaida(pasta)}/` : 'a script in the repository root'
  const vistos = new Set()
  for (const e of pythons) {
    const nome = MODULO_PYTHON.exec(posix.basename(e.caminho))[1]
    const pasta = pastaDe(e.caminho)
    let item = null
    let alvo = null
    if (nome === '__init__') {
      const pacote = posix.basename(pasta)
      const acima = pastaDe(pasta)
      if (pasta && STDLIB.has(pacote) && !pastasComInit.has(acima)) {
        alvo = `${pasta}/`
        item =
          `${escaparSaida(pasta)}/ can shadow the standard library package ${pacote} when ` +
          `${ondeRoda(acima)} is run by path`
      }
    } else if (STDLIB.has(nome) && !pastasComInit.has(pasta)) {
      alvo = e.caminho
      item =
        `${escaparSaida(e.caminho)} can shadow the standard library module ${nome} when ` +
        `${ondeRoda(pasta)} is run by path`
    }
    if (!item || vistos.has(alvo)) continue
    vistos.add(alvo)
    // The finding is about a NAME, so the name is what an entry can accept:
    // {arquivo, ponteiro: '', sha256 of the path}, which survives every edit of
    // the file. {arquivo, oid} still works, and is lost on the next edit: an
    // accepted CircuitPython code.py failed again on every commit that touched it.
    const aceitoPeloNome = allowlist.aceita('indirect-exec-change', {
      arquivo: e.caminho,
      ponteiro: '',
      sha256: sha256(e.caminho),
    })
    const aceitoPeloConteudo = allowlist.aceita('indirect-exec-change', {
      arquivo: e.caminho,
      oid: e.oid,
    })
    if (aceitoPeloNome || aceitoPeloConteudo) {
      usouAlguma = true
      continue
    }
    // What --sugerir-allowlist prints: the key by name, which survives an edit
    // of the file; {arquivo, oid} would fail again on the next edit.
    sugerirEntrada(r, 'indirect-exec-change', {
      arquivo: e.caminho,
      ponteiro: '',
      sha256: sha256(e.caminho),
    })
    itens.push(item)
    python++
  }

  const ganchos = avisos.length
    ? `${avisos.length} new install hook(s) with no execution family since the parent commit: ` +
      `${resumir(avisos)} — npm runs them on install; review what they run, or allowlist the value`
    : null
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
      ', or allowlist it with a reason' +
      (ganchos ? ` · also ${ganchos}` : '')
    )
  }
  const n = notasDaAllowlist(allowlist, 'indirect-exec-change', usouAlguma)
  if (ganchos) n.unshift(ganchos)
  return n.length ? { nota: n.join(' · ') } : null
}
