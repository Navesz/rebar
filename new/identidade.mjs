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
