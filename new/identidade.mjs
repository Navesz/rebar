// THE IDENTITY OF THE FIRST COMMIT — one single piece, because it has to match
// what was written into the files, and "match" here is literal.
//
// Whoever shows up in the NOTICE and in the allowlist HAS to be who commits. If
// they diverge, the project is born with the allowlist listing one person and
// the history holding another — and the divergence only shows up months later,
// when the `git-identity` rule accuses, in a repository where nobody remembers
// where it came from.
//
// THE GENERATOR ALREADY TRIED TO GUARANTEE THIS, with `-c user.name=… -c
// user.email=…` on the commit call, and the comment over there said: "Sem isto,
// uma máquina com config global e GIT_AUTHOR_* divergentes escreveria um nome
// no arquivo e outro no histórico" [without this, a machine with a global config
// and diverging GIT_AUTHOR_* would write one name into the file and another into
// the history]. It was exactly backwards.
//
// GIT'S PRECEDENCE (P2 #13 of the external audit):
//
//   GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL          ← wins
//   user.name / user.email  (config, and `-c` is config)
//
// So on a machine with `git config user.email = a@x` AND `GIT_AUTHOR_EMAIL =
// b@y` in the environment, the generator wrote `a@x` into the files (the config
// comes first in that `||` over there) and git signed the commit with `b@y`. The
// `-c` fixed nothing: it loses to the environment variable.
//
// The fix is to use the source that beats all of them. All four variables,
// because author and committer are different people to git and the history keeps
// both.

import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * The environment that makes the commit come out with EXACTLY this identity.
 *
 * Returns a copy of the environment it was given — it never mutates
 * `process.env`, which would leak the identity into every child process of the
 * generator from then on.
 */
export function ambienteDeIdentidade(dono, email, base = process.env) {
  return {
    ...base,
    GIT_AUTHOR_NAME: dono,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: dono,
    GIT_COMMITTER_EMAIL: email,
  }
}

// ─────────────────────────────────────────── THE REBAR COMMIT THAT IS RUNNING
//
// The generated project pins every reference to rebar to one commit (see
// MARCA_DO_COMMIT in new/gate/aplicar.mjs), and that commit has to be the code
// that is running NOW, not a guess about it. Two install layouts exist, and
// both were measured on 2026-09-13 against
// 134f1126e65758781f962681b2e01a7b753c1689:
//
//   A GIT CHECKOUT. `git rev-parse --show-toplevel` from rebar's root must BE
//   rebar's root, compared by real path on both sides (git prints
//   `C:/Users/...`, realpath gives `C:\Users\...`). Without that check a rebar
//   unpacked inside some other repository (an npx cache under a home folder
//   that is a git repo) would pin the PARENT's HEAD. Measured: 352 ms with the
//   status and the remote-branch lookup.
//
//   NPX. npm 10 and npm 11 leave `_npx/<hash>/package-lock.json` and
//   `_npx/<hash>/node_modules/.package-lock.json`, and in both
//   `packages["node_modules/rebar"].resolved` is the spec npm fetched:
//   `https://codeload.github.com/Navesz/rebar/tar.gz/<commit>` for the tarball,
//   `git+ssh://git@github.com/Navesz/rebar.git#<commit>` for the git form.
//   The installed package.json carries no `_resolved` and no `gitHead`, and
//   there is no `.git`. Measured: 66-72 ms.
//
// Anything else answers null with the reason, and the caller writes a marker
// that fails loudly. It NEVER falls back to an unpinned spec, and never to
// `git ls-remote`, which would pin code that is not the code running.

/**
 * The environment git runs with here: a GIT_DIR or GIT_WORK_TREE exported by a
 * hook or a tool that called the generator would make `--show-toplevel` answer
 * the cwd and `HEAD` come from another repository.
 */
function ambienteGitLimpo() {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  for (const k of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_CEILING_DIRECTORIES',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_NAMESPACE',
  ]) {
    delete env[k]
  }
  return env
}

const real = (p) => {
  try {
    return realpathSync.native(p)
  } catch {
    return null
  }
}

function gitEm(dir, args) {
  const r = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
    env: ambienteGitLimpo(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return r.status === 0 ? r.stdout : null
}

const TARBALL_DO_REBAR = /^https:\/\/codeload\.github\.com\/Navesz\/rebar\/tar\.gz\/([0-9a-f]{40})$/
const GIT_DO_REBAR =
  /^git\+(?:ssh:\/\/git@|https:\/\/)github\.com\/Navesz\/rebar\.git#([0-9a-f]{40})$/

/**
 * @returns {{ sha: string|null, fonte?: string, sujo?: boolean, noRemoto?: boolean, motivo?: string }}
 */
export function commitDoRebar(raizRebar) {
  const raiz = real(raizRebar)
  if (!raiz) return { sha: null, motivo: `${raizRebar} does not exist` }

  const topo = gitEm(raiz, ['rev-parse', '--show-toplevel'])
  if (topo !== null && real(topo.trim()) === raiz) {
    const cabeca = (gitEm(raiz, ['rev-parse', '--verify', 'HEAD^{commit}']) || '').trim()
    if (/^[0-9a-f]{40}$/.test(cabeca)) {
      // What the generator COPIES or DERIVES from rebar: the templates and
      // generator (new/), the hooks and scanner it copies (tooling/), the root
      // manifest, the LICENSE it copies and the .prettierrc it derives from.
      const sujo = Boolean(
        (
          gitEm(raiz, [
            'status',
            '--porcelain',
            '--untracked-files=no',
            '--',
            'new',
            'tooling',
            'package.json',
            'LICENSE',
            '.prettierrc',
          ]) || ''
        ).trim(),
      )
      const noRemoto = Boolean((gitEm(raiz, ['branch', '-r', '--contains', cabeca]) || '').trim())
      return { sha: cabeca, fonte: 'git', sujo, noRemoto }
    }
  }

  const base = join(raiz, '..', '..')
  const locks = [
    [join(raiz, '..', '.package-lock.json'), 'node_modules/.package-lock.json'],
    [join(raiz, '..', '..', 'package-lock.json'), 'package-lock.json'],
  ]
  for (const [arquivo, rotulo] of locks) {
    let lock
    try {
      lock = JSON.parse(readFileSync(arquivo, 'utf8'))
    } catch {
      continue
    }
    const pacotes = lock && typeof lock.packages === 'object' ? lock.packages : {}
    for (const [chave, entrada] of Object.entries(pacotes)) {
      if (!chave.endsWith(`node_modules/${basename(raiz)}`)) continue
      if (real(join(base, ...chave.split('/'))) !== raiz) continue
      const resolvido = String(entrada?.resolved ?? '')
      const m = TARBALL_DO_REBAR.exec(resolvido) || GIT_DO_REBAR.exec(resolvido)
      if (m) return { sha: m[1], fonte: `${rotulo} → ${chave}` }
      return {
        sha: null,
        motivo: 'the npm lock resolves this package to something that is not a Navesz/rebar commit',
      }
    }
  }
  return {
    sha: null,
    motivo:
      'no git checkout and no npm lock names this package (pnpm dlx, yarn and bun leave none reachable)',
  }
}
