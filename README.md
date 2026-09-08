# rebar

![rebar — checker, gate, generator](docs/assets/rebar-banner.svg)

> **Makes wrong code fail.** A checker that runs against any repository, a gate that blocks
> the commit when a rule is ignored, and a generator that builds the next project already on
> the right side of the ruler.

[![verificar](https://github.com/Navesz/rebar/actions/workflows/verificar.yml/badge.svg)](https://github.com/Navesz/rebar/actions/workflows/verificar.yml)
[![License](https://img.shields.io/github/license/Navesz/rebar)](LICENSE)
[![Rules](https://img.shields.io/badge/rules-27-blue)](#what-it-checks)
[![Gate](https://img.shields.io/badge/gate-25%20steps-blue)](#the-gate)
[![Status](https://img.shields.io/badge/status-alpha-orange)](ESTADO.md)

[Leia em português](README.pt-BR.md) · [Léelo en español](README.es.md) ·
[Website](https://navesz.github.io/rebar-site/) · [State of the project](ESTADO.md) ·
[Plan](docs/PLANO.md)

![rebar-check running on the rebar repository itself: 14 of 14, 4 not applicable, 1 warning](docs/assets/rebar-scoreboard.svg)

That is the real output, generated from the run — not a screenshot drawn by hand.
Three states, and the third is what stops the score from lying: a rule that does not
apply prints `–` **with the reason** and leaves the denominator, instead of counting
as a pass it never earned.

```bash
npx github:Navesz/rebar .                    # audit what already exists
npx github:Navesz/rebar new padaria-do-ze   # start on the right side
```

Zero runtime dependencies. The checker never writes to the repository it audits.

---

## The problem, measured

This project started from a concrete complaint:

> Every site I ask to use the standard as a reference — a lot gets ignored, hardcoded,
> forgetting something in the stack, listing the AI as a co-author, forgetting shadcn.

The usual answer is to write the rule better. It does not work, and that is measurable. In a
forensic pass over **161 commits across six repositories**:

| Measurement | Result |
|---|---|
| Repositories without CI | 3 of 6 |
| Repositories with broken lint right now | **the same 3** |
| Commits with AI co-authorship | 41 of 161 (25.5%) |
| Repository with the most governance documents | **35 lint errors** |

_Historical measurement from 2026-08-25, taken across the owner's other repositories. It is
not a property of this tree, is not derivable from here, and must not be updated: it is the
evidence that started the project, with the date it was collected._

That last row is the case that decides the design. It had `AGENTS.md` with "Hard rules",
`SECURITY.md`, `GOVERNANCE.md`, `CONTRIBUTING.md`, and a `check` script chaining format,
lint, types, test and build. **Nothing ever ran that `check`.**

> A rule written in markdown has close to zero compliance. A rule in CI has 100%.

Hence the thesis: **if a rule can move down a level, it must — but the enforcement has to be
more reliable than the rule it replaces.**

## Three states, and the third is the one that stops the score from lying

```
rebar-check · prumo
  ✓ editorconfig       has .editorconfig
  ✗ dependabot         automated dependency updates  no dependabot, no renovate
  ✓ ci                 has CI
  ✓ ci-gates           CI reaches the verification the repository declares
  – typecheck          has a typecheck script  no TypeScript here
  11 of 13  ·  1 not applicable
```

_Sample output against `prumo`, measured on 2026-08-30. It illustrates the format; it is not
this tree's score._

**"Not applicable" leaves the denominator.** Before that state existed, an empty folder with
an empty `.git/` scored 8 of 14 — tying with rebar itself and beating the strictest
repository on the machine. Nothing does not comply; nothing does not apply.

### Exit codes

| | |
|---|---|
| `0` | everything applicable passed |
| `1` | failed — real violation |
| `2` | invalid target or bad invocation |
| `127` | **broke** — a rule threw |

`127` dominates `1`: you do not accuse a repository with a ruler that broke.

## What it checks

There are <!--n rules.total-->23<!--/n--> rules in two classes.

**<!--n rules.deterministicas-->18<!--/n--> deterministic** drive the exit code:

They are: <!--n rules.lista-deterministicas-->`editorconfig` · `dependabot` · `ci` · `ci-gates` · `tests` · `typecheck` · `formatter` · `env-example` · `license` · `readme` · `notice` · `hooks-executable` · `gate-with-placeholder` · `ai-coauthorship` · `git-identity` · `fake-ui` · `orphan-schema` · `phone`<!--/n-->

**<!--n rules.heuristicas-->5<!--/n--> heuristic** only report, and the split is measured, not aesthetic:

They are: <!--n rules.lista-heuristicas-->`content-outside-code` · `shadcn-complete` · `production-url` · `raw-hex` · `single-language`<!--/n-->

A naive literal-color rule, measured on a real repository, produced **7 hits and zero true
positives** — five of them were comments documenting the rule itself. A wrong automatic rule
costs more than a missing one, and a heuristic that blocks teaches people to switch the whole
output off.

### Every rule is born with two cases

There are <!--n proofs.casos-->68<!--/n--> cases, one pair per rule, and all <!--n rules.total-->23<!--/n--> rules are covered:

```bash
npm run prove
```

Each case builds a miniature repository in a temporary directory, with its own `git init`,
and checks the rule's **state** — passed, failed, not applicable, or broke. It never writes
to the live repository.

Reading the exit code alone was not enough: `passed` and `not applicable` both come out as
`0`, so **13 of the 20 rules were unprovable by construction** — measured on 2026-08-30, when
there were 20 rules. Today, restoring any one of those 13 branches by hand makes the suite
fail.

## The three rulers

| Command | What it answers | What it does not |
|---|---|---|
| `npx github:Navesz/rebar .` | Is the repository in the right shape? | Does not look at security, does not run the app |
| `npx -p github:Navesz/rebar rebar-security .` | Does it have a security flaw? | Does not check Broken Access Control — OWASP #1 |
| `npx github:Navesz/rebar new <name>` | Start a project already gated | One preset only: `site` |

The `-p` on the second one is not a detail. Without it `npx` runs the package's default bin —
the format checker — and the "security ruler" step silently repeats the one above it.

**`rebar-security` is honest about its hole.** IDOR and object-level authorization stayed out
because the defense usually lives in middleware, a policy, or RLS: two byte-identical trees on
disk can have opposite verdicts. Saying so is more useful than pretending to check.

## The gate

The checker is one layer, not the only one.

| Layer | What | Who blocks |
|---|---|---|
| **N5** | `pre-commit` — staged secrets and co-authorship | git, on your machine |
| **N5** | `commit-msg` — AI co-authorship | git, before the commit exists |
| **N4** | CI on a Windows + Linux matrix, running the whole `verify` | GitHub Actions |
| **N4s** | ruleset with a required check | **the server** |

`npm run verify` **is not a new layer**: it is the sequence CI runs and that you run before
it, today with <!--n verify.passos-->25<!--/n--> steps.

In order: <!--n verify.lista-passos-->`hygiene` · `hooks` · `commit-msg` · `syntax` · `blocks` · `mcp-server` · `mcp` · `numbers` · `format` · `links` · `secret` · `secret-proofs` · `steps` · `strip` · `proofs` · `generator-map` · `site-paths` · `remote-gate` · `chain` · `generator-identity` · `mcp-template` · `security` · `security-table` · `security-self` · `self`<!--/n-->

N4s exists because everything below it lives in a file the agent edits: it deletes the
workflow, it removes `core.hooksPath` without leaving a diff. Only the ruleset resists — and
here it has `bypass_actors: []`, so not even the owner goes around it.

```bash
npm run verify          # the whole sequence, one command
npm run install-hooks   # points core.hooksPath at tooling/hooks
```

### The step that was missing, and what its absence cost

During a rename, `aplicar.mjs` started reading `verify.yml` from a folder where the file is
called `verificar.yml`. **`rebar new` died with ENOENT** — and `npm run verify` stayed green
for six commits, because no step generated a project. The checker proves itself, the rules
prove themselves, the MCP proves itself, the gate proves itself by mutation — and the product
did not.

`generator-map` closes that, and it is proved by mutation: replanting the original defect
makes two of its five tests fail with the exact message.

## The MCP

The generated project ships a server that reads the project's own rules, so the AI that opens
it is told before it writes, not after.

The artifact is **derived, never duplicated**: `npm run verify` regenerates it in memory and
fails if the disk diverges. It is impossible to change a rule and forget the MCP.

It carries <!--n mcp.artefato.regras-->27<!--/n--> rules from two modules, <!--n mcp.artefato.passos-->25<!--/n--> gate steps and <!--n mcp.artefato.provas-->74<!--/n--> proofs, exposed through <!--n mcp.ferramentas-->5<!--/n--> tools.

## Repository map

| Path | What |
|---|---|
| `tooling/rebar-check/` | the format ruler and its <!--n proofs.casos-->68<!--/n--> proof cases |
| `tooling/security/` | the security ruler |
| `tooling/verify/` | the gate runner and the mutation proofs of its steps |
| `tooling/secret/` | the secret scanner, and the six detection proofs |
| `new/` | the generator: templates, gate, and the file-map proofs |
| `mcp/` | the generated artifact and the server that serves it |
| `docs/PLANO.md` | the single manuscript: taxonomy, decisions, and the adversarial review |
| `ESTADO.md` | what is done, what is missing, and what is not proved |

## What this project does not do

Stating the limit is worth more than stating the capability, so:

- It does not check **Broken Access Control**, OWASP #1. It is out of reach for a static
  checker and is written down as such.
- It does not run your application. Every rule decides on a repository at rest.
- It has **one generator preset**, `site`. `app` and `api` are blocked by a declared
  non-scope until `site` is used unmodified on two sites.
- One heuristic still only warns because close to 12% of what it flags is interface
  vocabulary. If that does not change, the abandonment criterion says stop.

## Support

There is no donation destination, and none will be published until the repository owner
activates and verifies one. The useful contribution today is running the ruler against a
repository of yours and opening an issue with the output — a false positive reported is worth
more than a rule added.

## License

[Apache-2.0](LICENSE), with the attribution notice in [NOTICE](NOTICE).

AI co-authorship trailers are blocked by an allowlist of humans in
[`.rebar-coauthors`](.rebar-coauthors), enforced by the `commit-msg` hook before the commit
exists and by the `ai-coauthorship` rule over history afterwards.
