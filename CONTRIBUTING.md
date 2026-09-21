# Contributing to rebar

The most useful contribution is not a new rule. It is running rebar against a
repository of yours and telling us where it was wrong.

## Report a false positive

A false positive costs more than a missing rule: a check that accuses correct work
teaches people to switch the whole output off. If rebar accused something your
repository does right:

1. Run it on a clean clone, so the output is reproducible:

   ```bash
   npx github:Navesz/rebar .
   ```

2. Open an issue with the **False positive** template. Include the repository (or a
   minimal reproduction), the exact line rebar printed, and why it is wrong.

A minimal reproduction is the best report there is: a few files and a `git init` that
make the rule print the wrong thing. It becomes the proof case of the fix.

## Change a rule

Every rule is born with two cases, and every fix to a rule keeps or adds a pair:

- `tooling/rebar-check/proofs/cases/<rule>__<variant>/` holds `caso.json` with the
  `why`, plus a `pass/` and a `fail/` tree. The two trees differ in **one** thing:
  the thing the fix is about.
- A good case is proved by mutation in both directions: undoing the fix turns one
  side red, and the lazy version of the fix turns the other side red.

```bash
npm run prove            # rebar-check rules
npm run prove-security   # rebar-security rules
```

## Before opening a pull request

```bash
npm ci
npm run install-hooks    # points core.hooksPath at tooling/hooks
npm run verify           # the whole gate, the same sequence CI runs
```

`npm run verify` takes a few minutes. `node tooling/verify/verify.mjs --step=<name>`
runs a single step while you work, and says PARTIAL: it is not a pass.

Some files are **generated**. Never edit them by hand; regenerate them and commit them
together with the change that made them stale:

| File | Regenerate with |
|---|---|
| `mcp/rules.generated.json` | `node mcp/generate.mjs` |
| numbers in the READMEs and in `ESTADO.md` | `node tooling/numbers.mjs` |
| `docs/assets/rebar-scoreboard.svg` (the scoreboard image in the READMEs) | `node tooling/scoreboard.mjs` |

The gate names the right command when one of them is out of date.

## Versioning

SemVer does not answer the question this repository has to answer, so the bump is read
from the CONSUMER side rather than from the size of the diff. A new rule changes no API
and still turns a repository that passed yesterday red.

| Change | Bump | Why |
|---|---|---|
| A rule added, or an existing one tightened | minor while 0.x, major after 1.0 | it can turn green into red |
| A false positive fixed | patch | it can only turn red into green |
| Output, docs, internals with no verdict moved | patch | nobody downstream sees a different result |

Every version gets an entry in [`CHANGELOG.md`](CHANGELOG.md), newest first, and the entry
names the rule ids whose verdict can move. The `version` step of the gate fails when the
manifest and the newest entry disagree — a release cut from a tree in that state would tag
one number and ship another.

Consumers who pin `uses: Navesz/rebar@v0` follow the moving tag and get those minors.
Pinning the commit is the stricter form, and it is the one the README documents, because
`unpinned-remote-exec` is a rule this project fails others for.

## Co-authorship

The `commit-msg` hook only accepts `Co-authored-by` trailers from the humans listed in
[`.rebar-coauthors`](.rebar-coauthors). AI agents are not listed and are blocked. Commit
under your own identity; if you pair with another person, ask to be added to the list
in your pull request.

## License

By contributing you agree that your contribution is licensed under
[Apache-2.0](LICENSE), the license of this repository.
