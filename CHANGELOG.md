# Changelog

What changed, and what it does to a repository that was passing. The bump is read
from the consumer's side, not from the size of the diff — the rule is in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

Counts are not written here on purpose: the numbers that belong to this tree live
in the READMEs and in `ESTADO.md`, where `node tooling/numbers.mjs` keeps them
honest. A number copied into a changelog is a number nothing regenerates.

## [0.1.0] — 2026-09-21

The first version with a name. Everything below already existed; what is new is
that it can be referenced.

- **`rebar-check`**, the format ruler: every rule ends as passed, failed or not
  applicable **with the reason printed**, and not applicable leaves the
  denominator instead of counting as a pass it never earned.
- **`rebar-security`**, the security ruler: known prompt-injection signatures in
  the files a repository versions — invisible Unicode, terminal control bytes,
  agent settings that run commands, MCP launches that are not allowlisted, agent
  CLIs started with approval off, and AI workflow steps that outside text
  reaches. A pass means "no known signature", never "free of injection".
- **The gate**: a pre-commit and a commit-msg hook, CI on a Windows and Linux
  matrix, and a GitHub ruleset whose bypass list is empty. Every step is proven
  by mutation: the defect is planted and the step is required to find it.
- **`rebar new`**, the generator: a project that is born with the gate inside and
  an MCP server that serves the rules to the agent before it writes code.
- **`action.yml`**: the rulers as a GitHub Action step, so adopting them in CI is
  a line in the workflow rather than an invocation to get right by hand. It reports
  `outputs.exit-code`, because a failed job does not say whether the repository
  violated a rule (1) or a rule broke (127), and those call for opposite reactions.

Known limits, unchanged and stated in the README: alpha, one maintainer, it
gates one repository for real — its own. It decides on a repository at rest: it
does not run your application, and it does not check Broken Access Control.
