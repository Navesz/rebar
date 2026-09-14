// opcoes-npm — which npm options take the next word as their value, so a
// reader of `npx <options> <package>` knows which word npm runs.
//
// WHY A TABLE, AND WHY THIS ONE. mcp-launch.mjs skipped any unknown dash word
// as a switch and took the next word as the package. Measured on 2026-09-13
// with npm 11.6.2 and an isolated offline cache: `npx --omit dev
// github:Navesz/rebar .`, `--script-shell bash`, `--node-options --no-warnings`
// and `--tag latest` all made npm request the tarball of the default branch of
// github:Navesz/rebar, while the reader judged `dev`, `bash` or `latest` as a
// registry name and never saw the git spec. The lists below are npm's own
// config definitions (@npmcli/config/lib/definitions), the union over the npm
// versions measured on this machine: 10.9.3 (Node 22 on the runners), 10.9.4,
// 11.6.2 and 12.0.2. A key whose type includes Boolean is a switch; every other
// key takes a value. prove-unpinned-exec.mjs holds these lists against the
// definitions of the npm that runs the proof, so a new npm option fails the
// gate instead of reopening the hole.
//
// TWO PARSERS READ THE SAME WORDS. `npx` rewrites its arguments in
// bin/npx-cli.js (identical logic in the four versions, measured): a dash word
// that is not a switch takes the next word unless that word starts with a dash,
// shorthands expand first, and `-p` names a package. `npm exec` hands the words
// to nopt, where an unknown option is a switch. The reader in mcp-launch.mjs
// takes the package each parser would take and judges both.

/** Keys whose type includes Boolean: they never take the next word. */
export const CHAVES_SEM_VALOR_NPM = new Set([
  'all',
  'allow-same-version',
  'allow-scripts-pending',
  'allow-scripts-pin',
  'allow-unused-patches',
  'audit',
  'bin-links',
  'browser',
  'bypass-2fa',
  'color',
  'commit-hooks',
  'dangerously-allow-all-scripts',
  'description',
  'dev',
  'diff-ignore-all-space',
  'diff-name-only',
  'diff-no-prefix',
  'diff-text',
  'dry-run',
  'engine-strict',
  'expect-results',
  'force',
  'foreground-scripts',
  'format-package-lock',
  'fund',
  'git-tag-version',
  'global',
  'global-style',
  'if-present',
  'ignore-existing',
  'ignore-extension',
  'ignore-patch-failures',
  'ignore-scripts',
  'include-attestations',
  'include-staged',
  'include-workspace-root',
  'init-private',
  'install-links',
  'json',
  'keep-edit-dir',
  'legacy-bundling',
  'legacy-peer-deps',
  'link',
  'long',
  'offline',
  'omit-lockfile-registry-resolved',
  'optional',
  'package-lock',
  'package-lock-only',
  'packages-all',
  'parseable',
  'prefer-dedupe',
  'prefer-offline',
  'prefer-online',
  'production',
  'progress',
  'provenance',
  'read-only',
  'rebuild-bundle',
  'save',
  'save-bundle',
  'save-dev',
  'save-exact',
  'save-optional',
  'save-peer',
  'save-prod',
  'shrinkwrap',
  'sign-git-commit',
  'sign-git-tag',
  'strict-allow-scripts',
  'strict-npmrc',
  'strict-peer-deps',
  'strict-ssl',
  'timing',
  'unicode',
  'update-notifier',
  'usage',
  'version',
  'versions',
  'workspaces',
  'workspaces-update',
  'yes',
])

/** Every other defined key: nopt and npx both take the next word as its value. */
export const CHAVES_COM_VALOR_NPM = new Set([
  '_auth',
  'access',
  'allow-directory',
  'allow-file',
  'allow-git',
  'allow-remote',
  'allow-scripts',
  'also',
  'audit-level',
  'auth-type',
  'before',
  'ca',
  'cache',
  'cache-max',
  'cache-min',
  'cafile',
  'call',
  'cert',
  'cidr',
  'cpu',
  'depth',
  'diff',
  'diff-dst-prefix',
  'diff-src-prefix',
  'diff-unified',
  'edit-dir',
  'editor',
  'expect-result-count',
  'expires',
  'extension-file',
  'fetch-retries',
  'fetch-retry-factor',
  'fetch-retry-maxtimeout',
  'fetch-retry-mintimeout',
  'fetch-timeout',
  'git',
  'global-ignore-file',
  'globalconfig',
  'heading',
  'https-proxy',
  'include',
  'init-author-email',
  'init-author-name',
  'init-author-url',
  'init-license',
  'init-module',
  'init-type',
  'init-version',
  'init.author.email',
  'init.author.name',
  'init.author.url',
  'init.license',
  'init.module',
  'init.version',
  'install-strategy',
  'key',
  'libc',
  'local-address',
  'location',
  'lockfile-version',
  'loglevel',
  'logs-dir',
  'logs-max',
  'maxsockets',
  'message',
  'min-release-age',
  'min-release-age-exclude',
  'name',
  'node-gyp',
  'node-options',
  'noproxy',
  'omit',
  'only',
  'orgs',
  'orgs-permission',
  'os',
  'otp',
  'pack-destination',
  'package',
  'packages',
  'packages-and-scopes-permission',
  'password',
  'patches-dir',
  'prefix',
  'preid',
  'provenance-file',
  'proxy',
  'registry',
  'replace-registry-host',
  'save-prefix',
  'sbom-format',
  'sbom-type',
  'scope',
  'scopes',
  'script-shell',
  'searchexclude',
  'searchlimit',
  'searchopts',
  'searchstaleness',
  'shell',
  'tag',
  'tag-version-prefix',
  'to',
  'token-description',
  'umask',
  'user-agent',
  'userconfig',
  'viewer',
  'which',
  'workspace',
])

/** npm's shorthands, the same 40 in the four versions measured. */
export const ATALHOS_NPM = Object.freeze({
  '?': ['--usage'],
  B: ['--save-bundle'],
  C: ['--prefix'],
  D: ['--save-dev'],
  E: ['--save-exact'],
  H: ['--usage'],
  L: ['--location'],
  O: ['--save-optional'],
  P: ['--save-prod'],
  S: ['--save'],
  a: ['--all'],
  c: ['--call'],
  d: ['--loglevel', 'info'],
  dd: ['--loglevel', 'verbose'],
  ddd: ['--loglevel', 'silly'],
  desc: ['--description'],
  'enjoy-by': ['--before'],
  f: ['--force'],
  g: ['--global'],
  h: ['--usage'],
  help: ['--usage'],
  iwr: ['--include-workspace-root'],
  l: ['--long'],
  local: ['--no-global'],
  m: ['--message'],
  n: ['--no-yes'],
  no: ['--no-yes'],
  p: ['--parseable'],
  porcelain: ['--parseable'],
  q: ['--loglevel', 'warn'],
  quiet: ['--loglevel', 'warn'],
  readonly: ['--read-only'],
  reg: ['--registry'],
  s: ['--loglevel', 'silent'],
  silent: ['--loglevel', 'silent'],
  v: ['--version'],
  verbose: ['--loglevel', 'verbose'],
  w: ['--workspace'],
  ws: ['--workspaces'],
  y: ['--yes'],
})

// bin/npx-cli.js adds these to npm's definitions before it reads the words.
const REMOVIDAS_DO_NPX = new Set(['npm', 'node-arg', 'n'])
const SEM_VALOR_DO_NPX = new Set([
  'always-spawn',
  'ignore-existing',
  'shell-auto-fallback',
  'no-install',
  'quiet',
  'q',
  'version',
  'v',
  'help',
  'h',
])
const COM_VALOR_DO_NPX = new Set([
  'npm',
  'node-arg',
  'n',
  'package',
  'p',
  'cache',
  'userconfig',
  'call',
  'c',
  'shell',
])

/**
 * The package specs `npx` itself would run for the words after it: a port of
 * the argument loop of bin/npx-cli.js followed by npm exec's rule (the
 * `--package` values when there are any, the first positional word otherwise).
 */
export function pacotesComoNpx(lista) {
  const args = [...lista]
  const pacotes = []
  let posicional = null
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (a === '--') {
      posicional = args[i + 1] ?? null
      break
    }
    if (!a.startsWith('-')) {
      posicional = a
      break
    }
    const [chave, ...v] = a.replace(/^-+/, '').split('=')
    if (chave === 'p' || chave === 'package') {
      if (v.length) pacotes.push(v.join('='))
      else if (args[i + 1] !== undefined) pacotes.push(String(args[++i]))
      continue
    }
    if (
      chave !== 'shell' &&
      chave !== 'no-install' &&
      Object.hasOwn(ATALHOS_NPM, chave) &&
      !REMOVIDAS_DO_NPX.has(chave)
    ) {
      args.splice(i, 1, ...ATALHOS_NPM[chave], ...(v.length ? [v.join('=')] : []))
      i--
      continue
    }
    const semValor = CHAVES_SEM_VALOR_NPM.has(chave) || SEM_VALOR_DO_NPX.has(chave)
    if (
      !v.length &&
      !semValor &&
      (COM_VALOR_DO_NPX.has(chave) || !/^-/.test(String(args[i + 1] ?? '-')))
    ) {
      i++
    }
  }
  if (!pacotes.length && posicional !== null) pacotes.push(String(posicional))
  return pacotes
}

/**
 * The package specs `npm exec` would run: nopt reads a defined value option
 * with its next word (unless that word looks like an option), expands a
 * shorthand or a group of one-letter shorthands, and treats anything else as
 * a switch.
 */
export function pacotesComoNopt(lista) {
  const args = [...lista]
  const pacotes = []
  let posicional = null
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (a === '--') {
      posicional = args[i + 1] ?? null
      break
    }
    if (a === '-' || !a.startsWith('-')) {
      posicional = a
      break
    }
    if (a.startsWith('--')) {
      const igual = a.indexOf('=')
      const chave = (igual === -1 ? a.slice(2) : a.slice(2, igual)).toLowerCase()
      if (chave === 'package') {
        if (igual !== -1) pacotes.push(a.slice(igual + 1))
        else if (args[i + 1] !== undefined && !/^-{1,2}[^-]/.test(String(args[i + 1]))) {
          pacotes.push(String(args[++i]))
        }
        continue
      }
      if (
        igual === -1 &&
        CHAVES_COM_VALOR_NPM.has(chave) &&
        args[i + 1] !== undefined &&
        !/^-{1,2}[^-]/.test(String(args[i + 1]))
      ) {
        i++
      }
      continue
    }
    const curta = a.slice(1).split('=')[0]
    if (Object.hasOwn(ATALHOS_NPM, curta)) {
      args.splice(i, 1, ...ATALHOS_NPM[curta])
      i--
      continue
    }
    const letras = [...curta]
    if (letras.length > 1 && letras.every((l) => Object.hasOwn(ATALHOS_NPM, l))) {
      args.splice(i, 1, ...letras.flatMap((l) => ATALHOS_NPM[l]))
      i--
    }
  }
  if (!pacotes.length && posicional !== null) pacotes.push(String(posicional))
  return pacotes
}
