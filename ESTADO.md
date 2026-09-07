# rebar — project state

> **Read this file first.** It is the entry point of any new session.
> Measured and rewritten on **30/08/2026** · repo: `~\OneDrive\Documents\rebar`
>
> **31/08/2026 revision:** the generator came into existence and runs — §4.11. Sections 4.2,
> 4.3 and 5.1 were remeasured on this date because the generator changed what they counted.
> What was not remeasured on 31/08 keeps the date and the number of 30/08, and it is said where.
>
> **02/09/2026 revision:** the numbers in this file **stopped being typed** — read
> §0, which changed entirely. Every number that is property of this tree now comes from
> `node tooling/numbers.mjs` and is checked by the `numeros` step of `verificar`. What
> is not derivable kept the date beside it, saying it is historical.

> **06/09/2026 revision:** rebar's paths and usage commands were updated
> to the names of the `nomes-em-ingles` branch. The measurements keep their original dates;
> commands of other repositories and of the generated projects keep their own names.

<!-- Translation note: the prose here is English. What stays in Portuguese stays on purpose:
     verbatim program output and printed messages (they are the record of a measurement),
     rule ids, step names, file paths, JSON keys, the value inside every number marker
     (written by tooling/numbers.mjs, which formats it as "N de M"), quoted comments and test
     names as the source read on the day of each measurement (since translated — see the
     note above the table of §10), and the owner's own words — those carry an English
     translation in square brackets beside them. Do not "fix" any of it by translating it. -->

---

## 0. The rule of this file

**No number that is property of this tree is typed here.** It is derived from the
source by `tooling/numbers.mjs`, written between invisible markers, and checked on
every `npm run verify`:

```bash
node tooling/numbers.mjs              # rewrites the numbers of the README and of this file
node tooling/numbers.mjs --verificar   # the `numeros` step of the gate: exits 1 if it diverged
node tooling/numbers.mjs --fatos       # the catalog: each fact, its value and its source
```

In the raw markdown the number shows up like this, and the HTML comment is invisible on GitHub:

    **<!--n rules.deterministicas-->18<!--/n--> deterministic** take down the exit code

The marker **names the fact**, so whoever opens the raw file to edit the number reads
`regras.deterministicas` before touching it — the warning lives at the exact spot where the
temptation happens. And the meter refuses a marker inside a code fence, because there the
comment would be printed literally: **the fence shows the command, the prose beside it shows
the number.**

### Why this replaced the previous rule

The previous rule was good and it failed. It said: _"every number comes with the command that
reproduces it"_ — and it still holds for what is **not** derivable, further down. What it could
not do was stop the number from ageing between the day it was measured and the day
someone reads it.

**This file and the README got a number wrong SIX times.** The previous version of this section
admitted three and promised more care; the care lasted two days and another three came:

| # | When | What was written | What was true |
| --- | --- | --- | --- |
| 1 | 30/08 | "20 checks" | 19 |
| 2 | 30/08 | scoreboard taken from an uncalibrated ruler, in which an empty folder tied with rebar | the N/A was not out of the denominator |
| 3 | 30/08 | a table that adds up to 56, with the text beside it saying 55 | 56 |
| 4 | 02/09 | README: "16 deterministic", and the list omitting `hooks-executaveis` | 17 |
| 5 | 02/09 | README: "50 cases · 21 of 21 rules with proof" | 52 cases · 22 of 22 |
| 6 | 02/09 | README: "the 8 steps" of `verificar` | there were 12 at that moment, and there are 13 now |

And, beside the six, the defect that makes them all predictable: **this file carried
FOUR different counts of proof cases — 13, 33, 47 and 50 — scattered through the same
text.** Of the four, at most one could be right.

**The cause is structural, and writing with more care is the answer that has already failed six times.**
The numbers were written by hand and the truth changes at every commit. This whole repository
exists to say that a rule in markdown has compliance close to zero and a rule in a gate
has 100%; keeping its own numbers in markdown was the exception the ruler granted itself.

**The answer this time was not to recount. It was to take the number out of human hands** — the
same doctrine that `mcp/generate.mjs` had already applied to the MCP, in §4.12:

1. the fact is **derived** from the source, never typed;
2. **one command regenerates** — `node tooling/numbers.mjs`;
3. **one `--verificar` command** compares against the disk and **fails** if it diverges;
4. a **step of `verificar`** runs that `--verificar`, so committing with a stale document
   stopped being possible.

The seventh error will not depend on someone remembering. It will be a red step.

### What is still written by hand, and why

Not every number in a document is a fact of this tree. A number enters the derived
catalog if, and only if, it passes the three tests of `tooling/numbers.mjs`: **(1)** it is
property of this tree now; **(2)** it changes when the code changes, and only then — not with
the clock, and not by the very act of being recorded; **(3)** it has a one-line derivation,
without network and without running the product.

What does not pass stays written by hand, **with the date beside it and said to be historical**:

| Stays by hand | Why |
| --- | --- |
| "161 commits across six repositories", "8 of 9 real credentials passed", the scoreboard of the 19 repositories in §4.8 | measurement of **another tree**, another machine, another day. Deriving it is impossible; overwriting it would be erasing history, and history is what gives the rule its authority |
| the commit count | fails test 2: the commit that records "36" turns the count into 37, and the CI, which runs **after** the commit, would be red forever. A fact that changes by being recorded is a gate that never closes |
| "13 of 13 on its own ruler" | fails test 3: it comes out of **running** `rebar-check`, and what already locks it is the `auto` step. Deriving it here would duplicate the most expensive step of the gate inside the cheapest |
| sizes in bytes, line counts of `docs/`, timings | convenience measurement, remeasured when someone touches the section. Each one carries the date of the measurement |

For those the old rule holds, unchanged: **the command that reproduces it comes along**, and
where a claim came from a report and not from an execution it is marked as **not measured**.

---

## 1. The final objective

`rebar` is **alicerce v2**. A new repository, not built on top of the current alicerce.

The pain it exists to solve, in the owner's words:

> _"Todos os sites que peço para usar o alicerce como referência, muita coisa é ignorada,
> hardcoded, esquecendo alguma coisa da stack, colocando o claude como colaborador,
> esquecendo do shadcn."_ [Every site I ask to use alicerce as a reference, a lot gets
> ignored, hardcoded, forgetting something of the stack, putting claude as a collaborator,
> forgetting shadcn.]

The diagnosis was already written by alicerce itself: **"decisão que mora onde nenhuma
máquina lê"** [a decision that lives where no machine reads].

### The six objectives

1. **Make wrong code not pass.** An error that **blocks**, not one that turns into an ignored warning.
2. **`npm create rebar`** — a project born with the right stack and the gate closed.
3. **Keep enforcing after day 1** — the generator does not leave the stage; it stays as MCP and gate.
4. **Take the rules down a level** — what is asked in prose and would fit in a lint, becomes lint.
5. **Keep the MCP alive** — a rule changed, the MCP regenerates itself, and the gate fails if it is stale.
6. **Navigable by a new agent** without reading everything.

**Nº 5 closed on 01/09/2026** (§4.12): the MCP became a generated artifact, and the `mcp` step
of the gate regenerates in memory and fails if the disk diverges. With it, **nº 3 gained its
second half** — the gate already went into the generated project, the MCP now goes along by pointer.

---

## 2. The three principles

They came out of the review rounds with the external reviewer — `ls docs/RESPOSTA-REVISAO*.md | wc -l`
returns **8**. The last two principles were born of **errors committed in this very
document**, not of theory.

**1 · Go down a level, with one condition.**

> If a rule can go down from prose to enforcement, it must go down — **but the
> enforcement has to be more reliable than the rule it replaces.**

**2 · Nothing important lives only in text.**

> Any rule too important for the AI to forget is too important to exist
> only as text.

**3 · Provenance belongs to the layer, not to the source.**

> A verifiable claim needs a primary source **from the layer responsible for the property
> being claimed.** Do not skip a layer.

| Property                          | Owner         |
| --------------------------------- | ------------- |
| MVCC, `SKIP LOCKED`, `RESET ROLE` | PostgreSQL    |
| Sync per query, `onConnect`       | node-postgres |
| Serialization, status map         | oRPC          |
| Generated SQL                     | Kysely        |

Mandatory citation format in an ADR: **`Claim` · `Owner` · `Evidence` · `Assumptions`**,
and each `Assumptions` line becomes an assertion in the fitness test.

---

## 3. Locked decisions

| Decision         | Choice                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Nature           | Generates **and** keeps watching                                                              |
| Target           | Presets `site` / `app` / `api`                                                                |
| Hardness         | Blocks commit **and** CI                                                                      |
| Database         | **Postgres.** SQL Server requires a license, and there is no migration — herz's backend never existed |
| Contract         | **oRPC 1.15.0**, not ts-rest (prumo's ADR 0011 superseded it)                                 |
| Components       | **shadcn on `@base-ui/react`**, style `base-nova`. **It is not Radix**                        |
| Interface        | Reuse herz's — animation by `tw-animate-css` + data-attributes, no `@keyframes`               |
| Linter           | fast oxlint + small ESLint for its own rules                                                  |
| Order            | **Consumer before generator** — check what exists before generating the next                  |
| Checker posture  | **Reports only.** Never writes in any repository                                              |

### The three decisions locked on 30/08

**Prettier is the repository's only dependency.** There are
<!--n package.dependencias-->0<!--/n--> runtime dependencies and, in development, only <!--n package.dev-dependencias-->`prettier` 3.9.6<!--/n-->.

```bash
cat package.json    # the dependencies field does not exist; devDependencies has one entry
```

The boundary is deliberate: `tooling/rebar-check/index.mjs` keeps importing only
built-ins, so `npx github:Navesz/rebar` runs without installing anything. Zero dependency is
property of what **checks**, not of what is checked.

The two alternatives were discarded with a reason: accepting the 90% would leave `verificar`
red forever, and a gate that never goes green is a gate people learn to ignore;
narrowing the rule to excuse a repository with no dependency would be opening an exception for
itself in the one ruler the project ships.

**AI co-authorship becomes an allowlist of humans, not an enumeration of agents.**

```bash
git ls-files .rebar-coautores              # tracked — if it is not, the checker ignores it
grep -vE '^\s*#|^\s*$' .rebar-coautores    # 1 human identity; the rest is comment
```

The policy was a list of 9 AI agents, and the attack of 30/08 pierced both places
where it lived (§10, lines 10 and 11). Now the file is `.rebar-coautores`, at the root, with
accepted **human** identities; any `Co-authored-by:` trailer outside the list fails.
It stays at the root and not in `tooling/` because `rebar-check` runs against a third-party
repository, and a third party has no `tooling/`. Same family as `.rebarignore`.

**The repository is public, at `https://github.com/Navesz/rebar`.** Created, pushed and
gated — **no longer empty, as this file said until 02/09/2026.**

```bash
git remote -v         # origin  https://github.com/Navesz/rebar.git
git ls-remote origin  # exit 0
```

Measured on 02/09/2026: `git ls-remote origin` returns **15 refs** — `HEAD`, `refs/heads/main`
and 13 `refs/pull/*/head`. `main` points at the same commit as the local `HEAD`. This is a
**network** number, not one of this tree, and that is why it stays by hand with the date: it
changes when someone opens a PR, without a line of this repository changing.

---

## 4. What is DONE

Split into **PROVEN** — it has a test that runs, and that I ran now — and **EXISTS** — it is
on disk, and nobody exercises it.

### 4.1 PROVEN · Database privilege domain

The suite has <!--n domain.privilegio.testes-->16<!--/n--> assertions, and on 30/08/2026 the <!--n domain.privilegio.testes-->16<!--/n--> passed, `fail 0`, exit 0. The `duration_ms`
varies with every run; what counts is the count/exit pair.

```bash
cd domains/privilegio-de-banco && npm test
```

Against a **real** PostgreSQL 17.2, not a mock. Three identities: `db_owner` (migrations) ·
`app` (NOLOGIN, DML) · `app_login` (LOGIN, **NOINHERIT**, zero application privilege).

```sql
GRANT app TO app_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;   -- PG 16+
```

`INHERIT FALSE` is the piece: `RESET ROLE` lands on `app_login` with nothing → **fails closed**.

**A finding only the code found** — neither the human review nor six agents caught it:

> `onConnect` is a barrier per **PHYSICAL** connection, not per checkout.

```
checkout          current_user = app
RESET ROLE        current_user = app_login
release → pool
next checkout     current_user = app_login   ← onConnect did not run again
```

Here it fails closed. In a design with a privileged `session_user` — **prumo's current
state** — it would fail **open**.

**Measured fix:** `SET LOCAL ROLE app` as the first statement of the transaction, in the
`UnitOfWork`. Two of the <!--n domain.privilegio.testes-->16<!--/n--> tests are exactly
that pair, and they came out green in this measurement:

```
✔ ACHADO · onConnect é barreira por conexão FÍSICA — RESET ROLE sobrevive ao release
✔ CONSERTO · SET LOCAL ROLE no UnitOfWork cura a conexão envenenada e reverte sozinho
```

A third one documents the boundary that remains open (these lines are the suite's own test
names, printed verbatim):

```
✔ RLS · ACHADO CONHECIDO: o GUC de tenant é USERSET — app troca o próprio contexto
```

### 4.2 PROVEN · `rebar-check` — <!--n rules.total-->23<!--/n--> checks, zero dependency

_Remeasured on 31/08/2026 · numbers derived since 02/09/2026._
`tooling/rebar-check/index.mjs`, <!--n lines.rebar-check-->3.029<!--/n--> lines.
Runs in any repository, **never writes**.

There are <!--n rules.deterministicas-->18<!--/n--> deterministic and <!--n rules.heuristicas-->5<!--/n--> heuristic, and both lists come out of the `REGRAS`
array exported by `index.mjs` itself — the same source the MCP derives from.

**Do not count with `grep`.** This file has already published "16 deterministic" because of
that: the grep for `classe: 'determinística'` returns <!--n rules.deterministicas-->18<!--/n--> + 1
today, because it also matches the comment that explains the distinction. The count that holds
is the array's, and it is the one the marker above carries:

```bash
node tooling/numbers.mjs --fatos                                        # the catalog
node tooling/rebar-check/index.mjs --json . | grep -c '"classe": "determinística"'
node tooling/rebar-check/index.mjs --json . | grep -c '"classe": "heurística"'
```

Deterministic, and they take down the exit code:
<!--n rules.lista-deterministicas-->`editorconfig` · `dependabot` · `ci` · `ci-gates` · `tests` · `typecheck` · `formatter` · `env-example` · `license` · `readme` · `notice` · `hooks-executable` · `gate-with-placeholder` · `ai-coauthorship` · `git-identity` · `fake-ui` · `orphan-schema` · `phone`<!--/n-->

Heuristic, and they only inform:
<!--n rules.lista-heuristicas-->`content-outside-code` · `shadcn-complete` · `production-url` · `raw-hex` · `single-language`<!--/n-->

The previous version of this section swapped the two lists at one point: it gave
`conteudo-fora-do-codigo` as deterministic, when it is heuristic, and omitted
`hooks-executaveis` entirely. The two lists above became derived precisely
because getting the **composition** wrong is quieter than getting the total wrong.

`telefone` went up from heuristic to deterministic on 2026-08-30, with the number that
promoted it written in the rule itself: 1 true and 0 false in 417 measured code files.
`url-producao` did NOT go up, and the why is there too — 6 true accusations, of which only
2 are the defect the rule's name promises.

The separation is measured, and the reason is written in the header of the `as regras`
section of `index.mjs` — `grep -n "SETE ocorrências"`: the naive literal-color rule gave 7
occurrences and zero true positives in herz, measured on 30/08/2026, and five were
comments documenting the rule itself.

**rebar on its own ruler.** Measured on **02/09/2026**, already with `new/` tracked:

```bash
node tooling/rebar-check/index.mjs .     # this is the `auto` step of verificar
```

| | |
| --- | --- |
| score | **13 of 13** · 4 not applicable · exit 0 |
| proof cases out of the evaluation | 261 files |
| generator template out of the evaluation | 22 files · `new/gate/arquivos/`, `new/site/blocks/` |
| code out of the content rules for being test | 3 files |

**This pair of numbers stays by hand on purpose, with the date above.** It comes out of
RUNNING the ruler, not of reading the source, and what already locks it is the `auto` step of
`verificar` — deriving it in `numbers.mjs` would create the second source that §7.2 of the
plan forbids and would duplicate the most expensive step of the gate inside the cheapest. See §0.

The 4 that are not applicable: `ci-gateia` (the `package.json` has no lint, typecheck
or test script), `typecheck` (there is no TypeScript), `ui-falso` (there is no `components/ui/`)
and `schema-orfao` (no `.schema.json`).

**The score counts only the deterministic ones.** `13 of 13` is about the
<!--n rules.deterministicas-->18<!--/n--> deterministic minus the 4 that are not applicable.
The <!--n rules.heuristicas-->5<!--/n--> heuristic ones stay out of the denominator and show
up as a warning.

**What changed since 31/08, and the prediction that came true.** On that date `new/` was not
yet tracked, the ruler read `git ls-files` and did not see a single line of the generator: the
score was **11 of 11 · 5 n/a**, with 227 case files out of the evaluation. To predict the effect
of tracking it without touching `.git`, a mirror of the tree was set up in an `os.tmpdir()`, with
its own `git init` and everything committed, and it gave **12 of 12 · 4 n/a**, with 318 tracked
files and 24 in `new/`. Today the mirror is no longer necessary — the real tree has 340 *(measured on 02/09; not derived — it changes by the very commit that records it)* tracked files, of which <!--n new.arquivos-->32<!--/n--> in `new/`, and the score went up one more point with the
`hooks-executaveis` rule, which came in later.

`env-example` left N/A and started to **PASS**: the generator reads `GIT_AUTHOR_NAME` and
`GIT_AUTHOR_EMAIL` as a second source of the owner's identity, and both are documented
in `.env.example`. The ruler got more exercised, not less.

**What the generator broke on the way, and the fix.** In the mirror's first measurement, on
31/08/2026, the result was **11 of 13, exit 1** — the three numbers in this table are from that
day and describe a state that no longer exists:

| rule | without the fix | why |
| --- | --- | --- |
| `typecheck` | ✗ no tracked `package.json` has a typecheck script | the `.tsx`/`.ts` of `new/site/blocks/` |
| `env-example` | ✗ not documented: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | `new/index.mjs` |
| `idioma-unico` | ⚠ comments in pt (21) and en (3) | 3 comments in Portuguese quoting `User-Agent`, `<input type="file">`, `cat-file --batch` |

It is **"proof material is not product"** back again, one floor up: `new/site/blocks/` and
`new/gate/arquivos/` are files the generator **copies** into the created project.
They are not compiled here, they have no `tsconfig` here. The way out is the same one that
already existed for the proof cases, with the same discipline: double lock and printed count.

- **Lock 1** — the prefix has to be **exactly** one of the literal roots
  (`RAIZES_DE_MODELO`), not "starts with", not "any folder called blocos".
- **Lock 2** — a tracked `modelo.json` has to exist, with `para` and `porque`.
- **Printed count** — the line `N arquivo(s) de modelo do gerador, fora da avaliação`
  always comes out, naming the roots; today the `N` is
  <!--n new.arquivos-modelo-->24<!--/n-->. An exclusion nobody sees is an exclusion nobody
  checks.

Nothing was loosened: `env-example` became real documentation, and the templates keep being
checked **where they land** — step 5 of the generator runs this same ruler inside the
generated project, with Next's `tsconfig.json` and `package.json` around it. The two new proof
cases lock the two locks (§4.3).

`idioma-unico` was a false positive of the heuristic itself: it tested the language on top of
the **whole** comment text, backticks and all, so a comment in Portuguese quoting
an English identifier counted as a comment in English. It now discards the stretch
between backticks before the test. Measured on the mirror: `en` from **3 to 0**, and the three
were `index.mjs`, `scan-secret.mjs` and `new/index.mjs`, all with prose in Portuguese. The
`idioma-unico` proof case has not one backtick and does not change because of this.

### 4.3 PROVEN · The proofs — <!--n proofs.casos-->60<!--/n--> cases, <!--n proofs.cobertura-->23 de 23<!--/n--> rules

_Remeasured on 31/08/2026 · numbers derived since 02/09/2026._

There are <!--n proofs.casos-->60<!--/n--> cases and <!--n proofs.regras-com-prova-->23<!--/n--> rules with proof — coverage <!--n proofs.cobertura-->23 de 23<!--/n-->, with no uncovered rule. The runner counts the folders
in `tooling/rebar-check/proofs/cases/`, which is exactly what the number meter reads:

```bash
npm run prove
ls tooling/rebar-check/proofs/cases | wc -l
```

**This file carried FOUR different case counts — 13, 33, 47 and 50 — in
different sections of the same text.** All four are gone: the number is now a single one,
derived, and the `numeros` step fails if it ages. It is the case that justified §0.

Of the <!--n proofs.casos-->60<!--/n-->, **two are from 31/08 and lock the template exclusion**
described in §4.2. Running only the `typecheck` rule, on 02/09/2026, it came out 5 of 5:

```bash
node tooling/rebar-check/proofs/prove.mjs typecheck
# ✓ typecheck · ✓ typecheck__modelo-do-gerador · ✓ typecheck__modelo-fora-da-raiz
# ✓ typecheck__nao-se-aplica · ✓ typecheck__nome-em-portugues
```

`__modelo-do-gerador` proves the mechanism: the same tree with and without the `modelo.json`
at the root. `__modelo-fora-da-raiz` proves the **lock**: the same marker one level below,
in `new/site/blocks/app/`, has to be refused and the tree has to stay evaluated. Without that
second case, turning the exclusion into a generic bypass would go unnoticed.

The path is `tooling/rebar-check/proofs/cases/`, **not** `provas/casos/` at the root.

Every rule has a case, deterministic and heuristic. The false-positive hunt of 2026-08-30
added 13 cases and left no hole: `telefone`, `url-producao`, `idioma-unico` and the
new rule `conteudo-fora-do-codigo` were the four that were missing.

**The format of the proofs changed, and the change is the fix of a hole.** The runner now reads
the `estado` the rule emits in the `--json`, and not the exit code. The reason is in
the comment `O ESTADO que cada lado tem de produzir` in `provas/provar.mjs`: `index.mjs` collapses `passou` and `na` into the
same exit 0, so no "not applicable" branch could be locked. That is why cases with the
`__nao-se-aplica` suffix exist. The same comment records that `quebrou` can never
be expected — a crash is a defect of the instrument, not a result of it.

### 4.4 PROVEN · `verificar` — <!--n verify.passos-->22<!--/n--> steps

_Remeasured on 02/09/2026. This file said "8 of 8" and the README said "the 8 steps"; there
were 12 when the count was redone, and there are <!--n verify.passos-->22<!--/n--> now. The
count is now derived from the `default export` of `verify.config.mjs`._

In the order they run:
<!--n verify.lista-passos-->`hygiene` · `hooks` · `commit-msg` · `syntax` · `blocks` · `mcp-server` · `mcp` · `numbers` · `format` · `links` · `secret` · `secret-proofs` · `steps` · `strip` · `proofs` · `generator-map` · `generator-identity` · `mcp-template` · `security` · `security-table` · `security-self` · `self`<!--/n-->

```bash
npm run verify
```

On 02/09/2026: **APROVADO <!--n verify.passos-->22<!--/n--> de <!--n verify.passos-->22<!--/n--> passos · 22,3 s · exit 0.** The duration varies with the
machine and the cache — on 31/08/2026, with 50 proof cases and 8 steps, two runs gave **13,5
s** and **15,7 s**, against **51,9 s with 47 cases** on 30/08. The likely cause is the
parallelization of the fixtures in the `provas` step, but **the isolated step was never
timed**; what is measured is the total. Timing is a machine measurement and stays by hand,
with the date — see §0.

**The five steps that came in after 31/08**, and what each one covers:

| Step | Position | What it blocks |
| --- | --- | --- |
| `blocos` | <!--n verify.posicao.blocks-->5 de 22<!--/n--> | syntax and `modelo.json` of the files the generator copies into every created project — a defect here is born replicated in all of them |
| `mcp-servidor` | <!--n verify.posicao.mcp-server-->6 de 22<!--/n--> | the MCP server **comes up and answers the protocol**. Without `mcp/node_modules` the step BREAKS (127), it does not fail: missing tooling is not the repository erring |
| `mcp` | <!--n verify.posicao.mcp-->7 de 22<!--/n--> | the MCP artifact diverging from the source — §4.12 |
| `numeros` | <!--n verify.posicao.numbers-->8 de 22<!--/n--> | a number in this file or in the README diverging from the source — §0 |
| `passos` | <!--n verify.posicao.steps-->13 de 22<!--/n--> | the steps that are the **function** of the gate, proven by mutation. `checarBlocos` came in with 410 lines and zero tests, and swapping the body for `return { codigo: 0 }` kept `verificar` APROVADO |

The first two steps check the **gate**, not the content: `higiene` (clean tree,
index without `skip-worktree`, hash of the gate's files against HEAD) and `hooks`
(`core.hooksPath` points at the right place and both hooks are there).

**No step is optional** — the field does not exist, and `verify.mjs` refuses the key with exit
2; `--passo=` prints PARCIAL and exits 3, never 0. The two unlocked doors of the alicerce
original were left out on purpose. Where there is loosening it is **inside** the step, and it
is said so:

- `higiene` **only warns** with a dirty tree outside CI; inside CI it fails. A hash
  divergence that does not show up in `git status` always fails — it is the signature of `skip-worktree`.
  It warned in this measurement: `⚠ árvore com 4 alteração(ões) não commitada(s)`.
- `hooks` — `core.hooksPath` **only warns** inside CI, because the runner does not commit.
- `numeros` — a group of facts the tree does not know how to derive **only warns**, naming
  what was missing.
- `auto` — a heuristic **does not enter the denominator**, it comes out as a warning.

The warnings do not vanish for being warnings: each step's `avisar` field prints them **even
when the step passes**, in a section of its own below the scoreboard.

### 4.5 PROVEN · Hooks — installed and active

```bash
git config --get core.hooksPath  # tooling/hooks
git ls-files tooling/hooks   # check-message.mjs · commit-msg · install.mjs · pre-commit
```

`pre-commit` scans for a secret in the index and checks co-authorship. `commit-msg` is new and
did not exist in alicerce: `rebar-check` reads `git log` and does not see the commit in flight,
so it stopped the trailer from **staying**, not from **entering**.

This was, until this session, the "next step" of this document. It has been done.

### 4.6 PROVEN · The three ports from alicerce

| Port                         | Proof that it runs                                       |
| ---------------------------- | -------------------------------------------------------- |
| `segredo/varrer-segredo.mjs` | the `segredo` step of `npm run verify`, and the `pre-commit` |
| `elos/verificar-elos.mjs`    | direct execution, below                                   |
| `hooks/`                     | `git config --get core.hooksPath` → `tooling/hooks`   |

```bash
node tooling/links/check-links.mjs
```

On 02/09/2026: **56 files, no broken relative link, exit 0** — there were 45 on 30/08.
The count is the scanner's and is not in the derived catalog; it stays by hand, with the date.

`scan-secret.mjs` got seven fixes documented in its own header; the two
most expensive are in §10, lines 8 and 9.

### 4.7 EXISTS, and nobody exercises it

| Item                              | State                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `rebar-backup-20260825/`          | It exists, and **it is not a git repository** — it is a loose copy of files, without `.git`      |

```bash
ls -d ../rebar-backup-20260825/.git      # No such file or directory
```

**Left this list on 02/09/2026:** `.github/workflows/verificar.yml`. It **ran** — the
remote stopped being empty, the `windows-latest` + `ubuntu-latest` matrix went green and the
merge was blocked with a planted PR (§9, D+30). The size this file published, 2.163
bytes, was stale too: on 02/09/2026 it is **2.506**. Size in bytes is a convenience
measurement and stays by hand with the date — see §0.

### 4.8 The scoreboard — 19 repositories on the machine

_**Historical measurement of 30/08/2026**, and it has not been redone since. No number in this
section is derivable: they are property of **other** trees, on the owner's machine, and the
number meter does not leave this repository (§0). If they are remeasured, the date above
changes along — and do not subtract a new number from an old one, per the caveat at the end of
the section._

There are **19** git repositories, not 12. The previous ESTADO left 7 out.

```bash
# FROM Documents/, not from the rebar root — where the same command returns 1.
# Every command in this document runs from the rebar root, EXCEPT these two.
cd ~/OneDrive/Documents
find . -maxdepth 10 -name ".git" -not -path "*/node_modules/*" | sort | wc -l    # 19
find . -maxdepth 10 -name ".git" -not -path "*/node_modules/*" | sed "s|/[.]git$||" \n  | xargs node rebar/tooling/rebar-check/index.mjs --json
```

The `--json` accepts several directories at once and returns an array. The `Score` column is
the `nota` field the tool itself emits, repo by repo, and the denominator is the number of
**applicable deterministic** rules in that repository.

| Repo                               | Score    | Applicable | N/A | Warnings |
| ---------------------------------- | -------- | ---------- | --- | ------ |
| **rebar (itself)**                 | **100%** | 10/10      | 4   | 0      |
| prumo                              | 85%      | 11/13      | 1   | 2      |
| ducado                             | 73%      | 8/11       | 3   | 1      |
| Xthird/tools/obsidian-second-brain | 67%      | 4/6        | 8   | 0      |
| openkartline                       | 62%      | 8/13       | 1   | 2      |
| vectra-painel                      | 50%      | 5/10       | 4   | 0      |
| decima-edicoes                     | 42%      | 5/12       | 2   | 2      |
| LinhaK                             | 36%      | 4/11       | 3   | 0      |
| openkartline-notes                 | 33%      | 2/6        | 8   | 0      |
| VectraB-Lab                        | 33%      | 2/6        | 8   | 0      |
| Xthird/sites/constellation         | 33%      | 4/12       | 2   | 1      |
| Galegos                            | 27%      | 3/11       | 3   | 3      |
| alicerce                           | 20%      | 2/10       | 4   | 0      |
| navesz.github.io                   | 20%      | 2/10       | 4   | 2      |
| hug-brasil-propostas (client's)     | 17%      | 2/12       | 2   | 2      |
| Xthird/sites/navesz-profile        | 17%      | 1/6        | 8   | 0      |
| Readme                             | 13%      | 1/8        | 6   | 2      |
| Xthird/sites/climatic              | **0%**   | 0/6        | 8   | 1      |
| (client folder, no commits)        | **0%**   | 0/4        | 10  | 0      |

**Aggregate: 74 of 177 applicable checks pass — 41,8%.** N/A summed: 89. Warnings
summed: 18.

The arithmetic closes with the table: summing the `Applicable` column gives 74 in the numerator
and 177 in the denominator; 74 ÷ 177 = 0,4180. **This sum was checked by summing the column**,
which is exactly the verification that was missing in the previous version — where the table
gave 56 and the text beside it said 55.

**Median: 33%.** The 19 ordered values are
`0, 0, 13, 17, 17, 20, 20, 27, 33, 33, 33, 36, 42, 50, 62, 67, 73, 85, 100`; the tenth is 33.

**Ceiling: 100%, rebar, and it is the only one.** Outside the tool itself the ceiling is **85%
in prumo** — not 69%, as this file published.

**Floor: 0%, a tie between a client's folder and `Xthird/sites/climatic`.** Both were outside
the old list, and that is why the published floor (17%, `hug-brasil-propostas`) was wrong.
Honest caveat: that folder has 0 commits, so its 0% measures a practically empty
folder — it is the arithmetic floor. The truly worst repository is `climatic`, which has
5 commits and even so passes none of the 6 applicable checks.

**CI that reaches the verification the repository itself declares: four.** `prumo`,
`openkartline`, `decima-edicoes` and `Xthird/sites/constellation`. `constellation` was left
out because only 12 repositories were being looked at.

```bash
# from the same --json, `estado` field of the ci-gateia rule, repo by repo:
# passou 4 · reprovou 1 (ducado, "o CI não alcança: lint") · na 14
```

The 14 `na` split into two reasons: **eight have no CI at all** (`Galegos`, `LinhaK`,
the client folder and the `hug-brasil-propostas` inside it, `VectraB-Lab`, `Xthird/sites/climatic`,
`openkartline-notes`, `vectra-painel`) and **six have CI and have no lint, typecheck
or test script for it to reach** (`rebar`, `Readme`, `alicerce`, `navesz.github.io`,
`Xthird/sites/navesz-profile`, `Xthird/tools/obsidian-second-brain`). rebar itself is in
the second group. 4 + 1 + 8 + 6 = 19.

> ⚠️ **The ruler was recalibrated on 30/08 and an old number is not comparable with a new one.**
> The previous table came out of a ruler in which `null` meant two things at the same
> time — "passed" and "there was nothing to check". Measured consequence, recorded in
> the comment of the `na()` helper in `index.mjs`: an empty folder with an empty `.git/` scored
> 8 of 14 and tied with rebar. Nothing does not conform. Three fixes came in together: the N/A
> left the **denominator** (that is why the score is a percentage and the denominator varies
> per repository), the git crash became an explicit error instead of a silent approval, and the
> class of false positive described at the end of §10 fell. **Do not subtract one number from the other.**

### 4.9 Size of the repository

| Measure                                                          | Value                                                        | Origin |
| ---------------------------------------------------------------- | ------------------------------------------------------------ | --- |
| Tracked files                                                    | 340 *(measured on 02/09; not derived — it changes by the very commit that records it)*                  | derived |
| Tracked files, excluding the proof cases                         | 79 *(measured on 02/09)*               | derived |
| Commits with a `Co-Authored-By` trailer                          | <!--n git.commits-com-coautoria-->0<!--/n-->                  | derived |
| First commit                                                     | <!--n git.primeiro-commit-->2026-08-25 23:35:43<!--/n-->      | derived |
| Non-empty code lines (.mjs .cjs .js .ts .json .yml .yaml)        | 14.727                                                        | measured on 02/09/2026 |
| Non-empty prose lines (.md .txt)                                 | 3.997                                                         | measured on 02/09/2026 |
| Prose/code ratio                                                 | 0,27 — or 3,68 code lines per prose line                     | measured on 02/09/2026 |
| Commits                                                          | 36                                                            | measured on 02/09/2026 · **not derivable**, see below |

```bash
git ls-files | grep -v '^tooling/rebar-check/proofs/cases/' \
  | grep -E '\.(mjs|cjs|js|ts|json|yml|yaml)$' | xargs grep -chv '^[[:space:]]*$' \
  | awk '{s+=$1}END{print s}'
# the same line with  \.(md|txt)$  in place of the extension list
git rev-list --all --count
git log --all --format='%B' | grep -icE 'Co-Authored-By:'
```

**The commit count is the case that defines the boundary of what can be derived**, and it
fails test 2 of §0: if this document recorded `36` automatically, the commit that records
`36` would turn the count into `37`, and the CI — which runs **after** the commit — would be
red forever. A fact that changes by the very act of being recorded is a gate that never closes.
It stays by hand, with the date. In its place came two numbers that only change when someone
touches the repository: **tracked files** (the index already reflects the `git add` before the
commit) and **commits with a co-authorship trailer**, which the allowlist keeps at zero and
which only leaves zero when the invariant is violated — and then going red is the right thing.

The zero is stronger than the policy demands: there is no `Co-Authored-By` trailer at all in
the history, neither AI's nor human's.

**The prose count includes this file**, so it changes with every edit of the ESTADO. The
values measured above are of the version you are reading, already on disk — and that is why
they carry the date instead of pretending to be always up to date. The previous numbers, of
30/08 (44 files, 5.957 lines of code, 3.071 of prose, 13 commits), stay here as a
reference of how much the repository grew in one week.

### 4.10 Documents

_Counts measured on **02/09/2026**. A document's line count is not in the derived catalog — it
is a convenience measurement, remeasured when someone touches this section (§0)._

```bash
wc -l docs/*.md
```

| File                        | Lines                      | What                                                         |
| --------------------------- | -------------------------- | ------------------------------------------------------------ |
| `docs/PLANO.md`             | 1.115 (912 on 30/08)       | Decision panel, forensics of the six sites, N0–N7 taxonomy    |
| `docs/STACK.md`             | 899                        | v1.2, with history from 0.1 to 1.2 (not "~780 lines")         |
| `docs/REVISAO-AGENTES.md`   | 528                        | Review by 6 agents                                            |
| `docs/RESPOSTA-REVISAO*.md` | 1.235 in total, 8 files    | The 8 rounds with the external reviewer                       |

**One internal section reference is still broken:** `docs/PLANO.md:1095` points at
`§2.3`, and the document's 2.x series goes from `2.1` straight to `§3`. (The line was 892 on
30/08; the target did not change, the line number did — one more reason to cite by content and
not by position.)

```bash
grep -n '§2\.3' docs/PLANO.md
grep -nE '^#+ (2|3)(\.[0-9]+)*[ .]' docs/PLANO.md
# 74:# 2. Contexto · 85:## 2.1 Decisões travadas · 101:# 3. … — there is no 2.2 and no 2.3
```

By the subject — the `site` preset being the worst served — the intended target was probably
`§3.3 O ponto cego do alicerce é onde os projetos do dono vivem`. **I did not fix it: this
session's task is only ESTADO.md.** The other occurrences of `§N.N` that a raw grep turns up
were checked and are not breakage: `§12.9` has already become self-documentation, the
`§44/68/86` of REVISAO-AGENTES are pointers to a line and not to a section, and
`§9.27.2`/`§13.3.2` are citations of PostgreSQL's documentation.

### 4.11 PROVEN · The generator — `rebar new`, run end to end

_The two end-to-end runs are from **31/08/2026**, with network, in `os.tmpdir()`, and
they were not redone: everything this block reports about them is historical. The file
counts below, those are derived and up to date._

The generator announces <!--n new.passos-->6<!--/n--> steps and `new/` has <!--n new.arquivos-->32<!--/n--> files, of which <!--n new.arquivos-modelo-->24<!--/n--> are **template** — what it copies into the
created project, and which for that reason is not evaluated here. That leaves 4 of its own
code: `new/index.mjs` (433 lines) · `new/gate/aplicar.mjs` (829) · `new/site/aplicar.mjs`
(239) · `new/site/og.mjs` (227), 1.728 in total — line count measured on 02/09/2026,
by hand (§0); it was 405/391/135/227 on 31/08.

```bash
wc -l new/index.mjs new/gate/aplicar.mjs new/site/aplicar.mjs new/site/og.mjs
find new -type f | wc -l
```

#### How `npx` gets to the generator

The `bin` of `package.json` had a single command and the checker knew no subcommand: `npx
github:Navesz/rebar new meu-site` treated `new` as a path to audit and exited **2**.
The correction is dispatch inside `index.mjs`, and not a second `bin`, because that is how
npx resolves: it executes the bin with the **package name** and hands `new` over as `argv[0]`.
The extra `bin` (`rebar-new`) exists as an unambiguous form, but it is only reachable through
`npx -p github:Navesz/rebar rebar-new …`, which nobody types.

The dispatch comes **before** the option parsing (otherwise the generator's command line would
become "opção desconhecida") and the `import` is **dynamic** (otherwise the hot path, `npx
github:Navesz/rebar .` in CI, would pay for the generator existing).

Proven on both paths. The real `github:`, against the public remote:

```bash
cd $(mktemp -d) && git init -q && git add -A && git commit -q -m t
npx -y github:Navesz/rebar .     # scoreboard printed · exit 1 (empty repo, it is what is expected)
```

And the generator's path, against a local git clone of this session's tree — same
installer, same `bin` resolution, without depending on my having pushed:

```bash
npx -y "git+file:///$ESPELHO" .                              # the checker, exit 1
npx -y "git+file:///$ESPELHO" new padaria-do-ze padaria-do-ze.com.br
# rebar: subcomando "new" → gerador (para auditar a pasta "new", use ./novo)
```

`npm pack` does **not** serve as proof here: it refuses this package with "Invalid package, must
have name and version", because the `package.json` has no `version`. npm's git installer
does not require `version` — that is why `npx github:` always worked in spite of it.

#### Run 1 — `padaria-do-ze`, with no git identity on the machine

```
▸ 2/6  scaffold pelo shadcn (Next 16 · base-nova · @base-ui/react)
  npx resolvido: C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js
▸ 3/6  preset site: 13 arquivo(s) · domínio padaria-do-ze.com.br  + 17 do portão
▸ 4/6  modo 100755 … .githooks/commit-msg · .githooks/pre-commit
       Hooks instalados: core.hooksPath = .githooks
       primeiro commit: NÃO FEITO
▸ 5/6  12 de 12 · 4 não se aplica
  AVISOS: git sem user.email nesta máquina — o primeiro commit NÃO foi feito.
  régua: exit 0 — passou      gerador: exit 1
```

**It is not a defect of the generator, it is the machine** — and it is the check working (the
block above is the generator's own output, printed verbatim):

```bash
git config --global -l
# fatal: unable to read config file '~/.gitconfig': No such file or directory
```

This machine has no global `.gitconfig`; rebar's identity lives in the `.git/config` of the
repository itself. The generator **refuses to invent an author**: it warns, does not commit,
and exits 1 even with the ruler green. `coautoria-ia` and `identidade-git` become N/A because
there is no commit, and the score drops from 14 to 12 in the denominator — 12 of 12, not 12 of 14.

#### Run 2 — `linhak-motos`, through the second identity source

```bash
GIT_AUTHOR_NAME="…" GIT_AUTHOR_EMAIL="…" npx -y "git+file:///$ESPELHO" novo linhak-motos linhak.com.br
```

```
▸ 4/6  primeiro commit: feito
▸ 5/6  rebar-check · linhak-motos
  ✓ editorconfig ✓ dependabot ✓ ci ✓ ci-gateia ✓ testes ✓ typecheck ✓ formatter
  – env-example  ✓ licenca ✓ readme ✓ notice ✓ coautoria-ia ✓ identidade-git
  ✓ ui-falso     – schema-orfao ✓ telefone
  14 de 14 · 2 não se aplica
  régua: exit 0 — passou      gerador: exit 0 — projeto completo
```

Checked also with the checkout's checker, outside the generator:

```bash
node tooling/rebar-check/index.mjs "$TMP/linhak-motos"    # 14 de 14 · exit 0
```

#### The generated project passes its own gate

```bash
cd "$TMP/linhak-motos" && npm run verificar     # lint && typecheck && test && build
# ℹ tests 6 · pass 6 · fail 0
# ✓ Compiled successfully in 12.3s · Finished TypeScript in 2.8s
# ○  (Static)  prerendered as static content   — 5 rotas
# exit 0
```

#### The static build and the `og:image`

```bash
cd "$TMP/padaria-do-ze" && npx next build       # exit 0
# ┌ ○ /  ├ ○ /_not-found  ├ ○ /manifest.webmanifest  ├ ○ /robots.txt  └ ○ /sitemap.xml
# ○  (Static)  prerendered as static content

grep -o '<meta property="og:[^>]*>' out/index.html
# og:title · og:description · og:url · og:site_name · og:locale
# og:image  content="https://padaria-do-ze.com.br/og.png"
# og:image:width 1200 · og:image:height 630 · og:image:alt · og:type
```

`out/index.html` has 15.255 bytes; `out/og.png`, 5.720 — generated with `node:zlib` alone,
without a dependency. The `wa.me` comes out **with a recipient**:
`https://wa.me/5500000000000?text=Ola!%20Vim%20pelo%20site…`

#### Content broken on purpose — 5 mutations, 5 builds exit 1

It is §12.3 of the plan exercised: business identity is **content validated at build**, not an
environment variable. One mutation at a time in `conteudo/site.json`, `next build` on each
(the right-hand column is what the build printed, verbatim):

| mutation | exit | what the build said |
| --- | --- | --- |
| `barra-no-fim` | 1 | `"site.meta.urlBase": esperava texto no formato https://dominio.com.br (sem barra no fim)` |
| `telefone-pontuado` | 1 | `"site.identidade.whatsapp.e164": esperava texto no formato só dígitos, com DDI` |
| `apaga-alt` | 1 | `"site.meta.og.alt": esperava texto, veio nada (campo ausente)` |
| `campo-desconhecido` | 1 | `"site.meta": campo(s) que o esquema não conhece — "corDeFundo"` |
| `descricao-curta` | 1 | `"site.meta.descricao": esperava texto com ao menos 50 caractere(s)` |
| _restored_ | **0** | — |

`5 of 5 mutations failed the build`. With an env var, each of those would have gone up silent —
which is exactly what happened in PR `Navesz/Galegos#1`, and why it was parked.

#### What the generator does NOT do, on purpose

Create the remote repository, turn the ruleset on and turn Pages on. All three touch the
account of whoever runs it, and it prints all three in step 6 instead of doing them.

### 4.12 PROVEN · The MCP that regenerates itself — objective nº 5, closed

_Measured on 01/09/2026. Before this date `mcp/` had 1.412 lines on disk and **had never
run**: the dependencies were never installed, no step of `verificar` touched it
and no rule covered it. It served PROSE of the plan by section._

The defect this module exists in order not to repeat, in the owner's words: _"no Herz e no
BMB Compras eu elaborei um MCP com todas as regras de projeto, pra ele sempre ficar na
memória"_ [in Herz and in BMB Compras I put together an MCP with all the project rules, so it
would always stay in memory] — and _"o MCP não era reescrito quando as regras de projeto foram
modificadas"_ [the MCP was not rewritten when the project rules were modified].

**The design, and it is §7.2's of the PLANO:** the MCP is not written by hand, it is a
GENERATED artifact; the gate regenerates it in memory and fails if the disk diverges; and the
artifact is derived from the source, never a copy of it.

| Piece                     | What it is                                                              |
| ------------------------- | ----------------------------------------------------------------------- |
| `tooling/rebar-check/index.mjs` | **The source.** <!--n lines.rebar-check-->3.029<!--/n--> lines, <!--n rules.total-->23<!--/n--> rules, with the measured why of each one |
| `mcp/generate.mjs`           | **The generator.** <!--n lines.mcp-gerador-->1.072<!--/n--> lines, **zero dependency** |
| `mcp/rules.generated.json`  | **The artifact.** <!--n mcp.artefato.tamanho-->113 KB<!--/n--> · <!--n mcp.artefato.regras-->26<!--/n--> rules · <!--n mcp.artefato.niveis-->8<!--/n--> levels · <!--n mcp.artefato.passos-->22<!--/n--> steps · <!--n mcp.artefato.provas-->64<!--/n--> proofs |
| `mcp/src/`                | **The server.** <!--n lines.mcp-servidor-->1.157<!--/n--> lines, <!--n mcp.ferramentas-->5<!--/n--> tools. Reads the artifact, never the source |

The artifact's five numbers are checked by **two** independent gates: the `mcp` step
compares the artifact with the source, and the `numeros` step compares this table with the
artifact. A stale artifact fails before this line is accused — it is the `mcp` →
`numeros` order of `verify.config.mjs`, and it exists so that the accusation does not point at
whoever did not err.

```bash
node mcp/generate.mjs              # writes the artifact
node mcp/generate.mjs --verificar  # the `mcp` step: regenerates in memory and compares with the disk
node mcp/src/prova-cliente.mjs  # the `mcp-servidor` step: brings the server up and speaks the protocol
```

`prova-cliente.mjs` does, in 6 blocks: handshake, `tools/list`, seven `tools/call`, the
server **without** an artifact, the README's `.mcp.json` snippet, and the source tampered with
to prove that the freshness warning sticks to every answer.

**The cycle that defines objective nº 5, run end to end.** One rule is really changed
— the title of `readme`, line 1404 of `index.mjs` — and the gate accuses:

```
✗ mcp        4 erros  167 ms
    - regras.readme.titulo = tem README                    (disco, velho)
    + regras.readme.titulo = tem README na raiz do repositorio   (fonte, hoje)
```

`node mcp/generate.mjs` — **one command** — and `verificar` goes back to PASSING the <!--n verify.passos-->22<!--/n--> steps.

**Zero dependency, checked in the worst case.** The freshness gate runs in the root's
`verificar` and cannot require `mcp/node_modules`. Proven in a clone in `tmpdir` with the
folder deleted: `--verificar` answered `em dia` (exit 0) and, with the rule mutated, `DIVERGIU`
(exit 1) — in both cases without a single dependency installed. `git clone` does not bring
`mcp/node_modules` either: the `node_modules/` of `.gitignore` already covers it at any level.

**Measured cost of the step:** 175–213 ms in 5 runs (median 206 ms) on 01/09/2026, against
prettier's 1,0 s and the seconds of `provas` and `auto` — timing is a machine measurement and
stays by hand, with the date (§0). It is the <!--n verify.posicao.mcp-->7 de 22<!--/n--> of
the list, after `sintaxe` — with the file not compiling, "o artefato divergiu" would be a
false accusation.

**What was fixed in this round**, because it was delivered and did not work:

1. **The cycle did not close in one command.** The generator writes `JSON.stringify(…, 2)` and
   prettier folds a short array onto one line: after `node mcp/generate.mjs` the
   `formato` step went **red**, and the `mcp` step's hint told you to run only the generator.
   There were two owners of the same bytes. The artifact went into `.prettierignore` — it is
   machine output, and what checks its content is the `mcp` step, which compares FACT, not
   white space.
2. **`rebar --mcp` did not exist.** Every project generated by `rebar new` writes a
   `.mcp.json` that runs `.rebar/mcp.mjs`, which calls `rebar --mcp` — and the parser answered
   `opção desconhecida: --mcp`, exit 2. The pointer existed on both sides and the target did
   not answer. The dispatch went into `index.mjs`, next to the `new` subcommand, and hands the
   stdio to the server with `stdio: 'inherit'`. Checked end to end: the `.mcp.json` of
   a generated project brings the server up and answers `tools/call`.

**Objective nº 3 — "keep enforcing after day 1" — now has both halves.** The
gate already went along into the generated project; the MCP now goes too, by pointer. The
generated project does **not** get an MCP of its own, and the reason is §7.2: it has zero rules
of its own, so a local MCP would serve a **copy** of rebar's <!--n rules.total-->23<!--/n--> rules — which
is the Herz defect all over again.

**What stays partial, and is said here instead of hidden:**

- **A header `porque` in 5 of <!--n rules.total-->23<!--/n--> rules** (measured on
  01/09/2026). The others have the why extracted from the body of `checar` or from the proof
  case — `0` rules were left with no reason at all —, but the classification is positional, not
  semantic: a pure implementation comment comes along, labeled `onde: "implementacao"`. The
  better form is a `porque:` field inside each rule — zero parsing, checked by prettier
  —, and it costs <!--n rules.total-->23<!--/n--> edits in `index.mjs`.
- **`npx --yes github:Navesz/rebar --mcp` does not bring the server up** on a machine without a
  checkout: `npx` installs only the root's dependencies, and `mcp/` is a separate package. The
  failure is loud and names the fix (`cd mcp && npm install`) and the alternative without MCP
  (`--json`). Closing this for good asks for a zero-dependency server — the proof client
  already shows that the protocol fits in that, it is the server that still uses the SDK.
- **`perfil.json` still does not exist.** §7.2 derived the MCP from it; the machine-readable
  source that exists today is `index.mjs`, and it is from it that the generator derives.

---

## 5. What is MISSING

### 5.1 Blocking for rebar to be usable

_Remeasured on 31/08/2026: the first two lines came out of "does not exist"._

| Item                           | State                                                |
| ------------------------------ | ------------------------------------------------------ |
| The generator — `rebar new`   | **EXISTS and runs.** §4.11. It is not `npm create rebar`: it is a subcommand of the same `bin`, because that is what `npx` resolves |
| `site` preset                  | **EXISTS and runs.** Next 16 SSG, content validated at build |
| `app` / `api` presets          | None, and they are **out of scope** until `site` runs without modification on two sites |
| MCP                            | **EXISTS, runs, and the gate keeps it up to date.** §4.12 |
| `perfil.esquema.json`          | Does not exist. The panel→profile→generator pipeline is prose |

```bash
find . -name "*.schema.json" -not -path "*/node_modules/*"
# only the ones inside provas/casos/schema-orfao — no perfil.esquema.json
```

**Correction of an error of the previous ESTADO:** it said that rebar's own CI "fails
itself in 5 checks". It does not fail. On 02/09/2026, `npm run check` comes out **13 of 13 · 4
n/a · exit 0** (§4.2); on 30/08 it came out 11 of 11 · 6 n/a, which is the number this
paragraph published.

### 5.2 The seven items of §8.1 of the PLANO — what was supposed to come from alicerce

State verified on disk on **02/09/2026**. The sizes in bytes are a convenience measurement
and stay by hand, with this date (§0).

| Item of §8.1                                          | Real state                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `verificar/verificar.mjs`                             | **PRESENT.** 34.566 bytes, tracked. Rewritten, not ported. Today with <!--n verify.passos-->22<!--/n--> steps |
| `segredo/varrer-segredo.mjs`                          | **PRESENT.** 35.855 bytes, tracked (34.483 on 30/08). Runs in `verificar` and in `pre-commit` |
| `elos/verificar-elos.mjs`                             | **PRESENT.** 2.191 bytes, tracked. Clean execution                             |
| `hooks/`                                              | **PRESENT, and installed.** 4 tracked files, `core.hooksPath` active           |
| `ci/verificar.yml` as a template                      | **PRESENT.** `.github/workflows/verificar.yml`, and it **has already run** — §9, D+30 |
| `contexto/ai.mjs`                                     | **ABSENT.** `ferramental/contexto/` does not exist                             |
| 15 boundary presets (web 7 + api 8) + 29 fixtures     | **ABSENT.** `ferramental/fronteiras/` does not exist                           |

```bash
ls tooling    # hooks  links  numbers.mjs  rebar-check  secret  verify
```

`numbers.mjs` came in on 02/09/2026 and is not an item of §8.1: it did not come from alicerce,
it was born here, out of the defect of §0.

**TWO of the seven are left**, not three nor four: `contexto/ai.mjs` and the boundary presets.
`perfil.esquema.json`, which the previous ESTADO added in here, is not an item of §8.1 — it is
blocking in §5.1 above. It does not exist indeed, but counting it twice inflated the hole.

The source of the two absent ones exists: `alicerce/ferramental/contexto/ai.mjs` and
`alicerce/ferramental/fronteiras/`.

### 5.3 The two 🔴 red decisions — CLOSED, and exercised

_Updated on 31/08/2026. They were open on 30/08 and were blocking the `site` preset; they were
closed in §12.2 and §12.3 of the PLANO and are now RUNNING, not just decided._

**1 · Rendering strategy — closed on Next 16 App Router with `output: "export"`.**
The argument that decided it still holds: an SPA **does not deliver `og:image`**, because
WhatsApp, LinkedIn, Slack and Discord do not execute JS. Exercised: the `out/index.html` of the
generated project carries an absolute `og:image` with `width`/`height`/`alt` and **without a
line of JS** — §4.11. The `app` preset (Vite + TanStack Router) is not in scope now.

**2 · Origin of the content — closed on `conteudo/*.json` validated at build.** The business
identity (phone, CNPJ, address) is **validated content**, not an environment variable.
Exercised: 5 mutations in `conteudo/site.json`, 5 builds exit 1 — §4.11. The cost of getting
this one wrong is known and has a number: in PR `Navesz/Galegos#1`, with an env var, the
`wa.me` went up without a recipient and the menu stopped delivering orders **in silence**.

### 5.4 Other open boundaries

**Authorization** — the panel only has corporate auth. What is missing is the distinction the
AI gets wrong most: `if (!user) throw 401` does not answer _"can this user modify **this**
resource"_.

**Tenant isolation** — an open boundary, and **documented in a test that passes on
purpose**: the custom GUC is `USERSET`, so the session itself swaps its own context.
When the channel is closed, the test flips.

**Tier 2 of the agents' review**, in `docs/REVISAO-AGENTES.md`: TTL of the idempotency
table, outbox purge, `statement_timeout`,
`idle_in_transaction_session_timeout`, pool size against `max_connections`. Exact
quantity: **not measured** in this session.

---

## 6. How to run

The commands below reflect the current paths; the original measurements are from 02/09/2026.
**The numbers they print do not live in the fence's comments**, and the reason is concrete:
GitHub shows the fence literally, so a `# 50 casos` copied along with the command hands the
person a number that is no longer the one they will see on the screen. The fence shows the
command; the number goes in the prose beside it, where the `numeros` step reaches. Today:
<!--n verify.passos-->22<!--/n--> steps
in `verificar`, <!--n proofs.casos-->60<!--/n--> cases in `provar`, <!--n domain.privilegio.testes-->16<!--/n--> assertions in the privilege domain, and 56
files swept by `elos` (this last one measured by hand, §0).

```bash
# the checker against any repository
node tooling/rebar-check/index.mjs /path/to/repo         # text
node tooling/rebar-check/index.mjs --json /path/...      # JSON; accepts several paths
node tooling/rebar-check/index.mjs .                     # rebar itself
npm run check                                                # identical to the line above

# the generator — IT WRITES. It creates the folder <nome> INSIDE THE CWD, so run it from
# where you want the project, never from inside rebar. That is why there is NO npm script
# for it: `npm run` always runs at the package root, and it would create rebar/<nome>.
cd /where/the/project/will/live
npx github:Navesz/rebar new <nome> [dominio]                       # the owner's path
node /path/to/rebar/new/index.mjs <nome> [dominio]                 # the same, from the checkout

# the whole sequence
npm run verify

# the checker's proofs
npm run prove

# the numbers of this file and of the README — there is no npm script, it is a direct call
node tooling/numbers.mjs              # rewrites
node tooling/numbers.mjs --verificar  # the `numeros` step of the gate
node tooling/numbers.mjs --fatos      # the catalog

# format
npm run format-check          # prettier --check .  → "All matched files use Prettier code style!"
npm run format         # prettier --write .  — IT WRITES in the files

# elos
node tooling/links/check-links.mjs

# privilege domain (needs Postgres up)
cd domains/privilegio-de-banco && npm test
```

`.md` is in `.prettierignore`, so `formato` does not touch these documents: what rules the
bytes of the numbers is `numbers.mjs`, and two owners of the same bytes is the defect the
MCP artifact has already paid for once (§4.12).

**About the checker's exit code, because it is easy to get wrong:** it exits **1** whenever
some deterministic rule fails, and that holds equally for `--json`. Measured in this session:
`. → exit 0`, `../prumo → exit 1`, `--json ../prumo → exit 1`, the 19 paths at once →
exit 1. Whoever consumes the `--json` in a script needs to read stdout even with a non-zero
exit.

Two scripts exist and were **not executed in this measurement**, because they write state:

- `npm run format` writes in the files. `npm run format-check` — same binary, `--check` —
  passes, so `--write` would have nothing to change.
- `npm run install-hooks` changes `core.hooksPath`. Its effect is already applied.

---

## 7. Environment

_Checked on 30/08/2026, and not remeasured since. Nothing here is property of this
tree — it is the owner's machine, and that is why no number in this section is derivable (§0)._

### PostgreSQL 17.2 — up, checked field by field

```bash
"~/pg17/pgsql/bin/pg_isready.exe" -h 127.0.0.1 -p 55432
# 127.0.0.1:55432 - aceitando conexões · exit 0

"~/pg17/pgsql/bin/psql.exe" \
  "postgresql://postgres:bootstrap_dev_only@127.0.0.1:55432/rebar_teste" \
  -tAc "select version(), current_database();"
# PostgreSQL 17.2 on x86_64-windows, compiled by msvc-19.41.34123, 64-bit|rebar_teste
```

Installed without Docker and without admin.

```
binaries  ~\pg17\pgsql\bin
cluster   ~\pg17\data
port      127.0.0.1:55432
log       ~\pg17\pg.log
database  rebar_teste

superuser     postgres   / bootstrap_dev_only    ← authenticated in this measurement
db_owner      db_owner   / owner_dev_only        ← not tested in isolation
runtime       app_login  / app_dev_only          ← not tested in isolation
```

The last two identities are exercised by the suite of <!--n domain.privilegio.testes-->16<!--/n--> tests, which passes. That validates them
indirectly, not directly.

Restart — **command not executed**, the server was already up:

```bash
"~/pg17/pgsql/bin/pg_ctl.exe" -D "~/pg17/data" \
  -o "-p 55432 -c listen_addresses=127.0.0.1" -l "~/pg17/pg.log" start
```

### Docker is broken on this machine, and it stays broken

Every restart failed on a different socket, always error 123. **Two directories were
renamed** on 26/08, and both renames are still on disk:

```bash
ls -d "$LOCALAPPDATA/Docker/"* "$LOCALAPPDATA/docker-secrets-engine"* | grep -E 'run|secrets'
# …/AppData/Local/Docker/run
# …/AppData/Local/Docker/run.quebrado-20260826
# …/AppData/Local/docker-secrets-engine.quebrado-20260826
# (without the grep it is 12 lines: Docker leaves lock, log and install-log in the same folder)
```

Docker recreated a new `Docker/run` beside the renamed one. Nothing was deleted — the
originals are preserved under the `.quebrado-20260826` suffix.

**It is not blocking.** The native Postgres covers everything the project needs. This record
exists so that the next session does not spend time rediscovering the same defect nor deletes
the preserved directories.

---

## 8. Working method

1. **Centralize.** One file, three at most. Centralizing avoids pivoting for nothing.
2. **Living document.** A new decision goes into the file, it does not stay in the conversation.
3. **Review by multiple agents**, looking for the hole and for what fits with what.
4. **Verify what an agent returns.** _"Não adianta o agente retornar coisas falsas e você
   acreditar."_ [It is no use for the agent to return false things and you to believe them.]
   — and it holds: a reviewer claimed "50 vs 159 commits"; measured, it was 61 vs 125.
   This rewrite followed the rule: it started from a measurement made by another agent and did
   **not** accept it as given — scoreboard, rule count, proof cases, `verificar`, hooks,
   remote, Postgres and the code excerpts cited in §10 were all re-executed here.
5. **Backup before touching.** It exists in `rebar-backup-20260825/` — which is a loose copy of
   files, **not** a git repository — and in the git history, today with 36 commits (measured
   on 02/09/2026; it was 13 on 30/08, and the count stays by hand for the reason of §4.9).
6. **The invariant matrix is worth something if it is generated from the code, not written
   before it.** A closed domain = Claim + Assumptions + mechanism + positive test + hostile
   test + failure mode + rollback, **with the tests existing and passing**.

---

## 9. Abandonment criterion

From the plan, §9.7. **First commit:
<!--n git.primeiro-commit-->2026-08-25 23:35:43<!--/n-->** — the date is derived, and it is
what anchors every milestone below. On 02/09/2026 the project is at **D+8**.

```bash
git log --reverse --format='%ad %s' --date=iso | head -1
# … Importa o plano, a stack e as oito rodadas de revisao
```

The "today" of this section is **not** derived, and the reason is the same as the commit
count's (§0, test 2): a D+N calculated at every run would change on its own, with the clock,
without a line of the repository changing — and the gate would go red every day at midnight.

| Milestone | Due     | Literal criterion                                                                | If it fails                        |
| ----- | ---------- | ------------------------------------------------------------------------------------ | --------------------------------- |
| D+7   | 01/09/2026 | `rebar-check` ran against ≥3 repositories that are not rebar                          | **Stop**                          |
| D+30  | 24/09/2026 | ≥2 repositories with `rebar-check` in CI **failing a merge**, with a run link         | Becomes a checklist and the repo is deleted |
| D+60  | 24/10/2026 | ≥1 check fired and the owner **fixed the code instead of turning the check off**      | The rule was wrong                |
| D+90  | 23/11/2026 | Checks grew ≤50% **and** the number of repositories using it grew                     | Freeze the list                   |

**Hard stop:** two new repositories started without rebar, one after the other.

**Out of scope:** no `app` or `api` preset before `site` has been used **without
modification** on two sites.

### D+7 — MET on 30/08/2026, before the deadline came due

The checker ran on 30/08/2026 against **18 repositories that are not rebar** — 19 minus itself.
Six times the minimum of 3, not four times as this file said. The number it
published, 12, was wrong. The table in §4.8 is the output, and it is a historical measurement
of other trees (§0).

### D+30 — 1 of 2. The first repository is gated for real

On 30/08/2026 rebar went from ZERO to ONE. The three demands of the criterion, met
for the first repository and with a link:

**(1) `rebar-check` runs in CI.** `.github/workflows/verificar.yml`, matrix
`windows-latest` + `ubuntu-latest`, calling `node tooling/verify/verify.mjs`,
whose last step is `rebar-check` pointed at the repository itself.

**(2) There is a run, and it is green on both systems.**

```bash
gh run view 33341062882 --json conclusion,jobs
# success · windows-latest 57 s · ubuntu-latest 14 s
```
https://github.com/Navesz/rebar/actions/runs/33341062882

It was the **first time anything in this repository ran outside Windows.** I
had recorded that I expected it to break on Linux; it did not break. The likely reason is the
two fixes of step 1: the `.gitattributes` with `eol=lf` and the `+x` bit on the hooks, which
were exactly the two defects that would break there.

**(3) The merge is failed for real, with a planted PR.** I deleted the `.editorconfig` on
purpose in a branch and opened a PR:

```bash
gh pr view 3 --json mergeStateStatus,statusCheckRollup
# state: BLOCKED
# verificar (windows-latest): FAILURE · verificar (ubuntu-latest): FAILURE
```
https://github.com/Navesz/rebar/pull/3 — closed after the proof.

And the direct push to `main` is refused as well:

```
! [remote rejected] main -> main (push declined due to repository rule violations)
```

The ruleset is https://github.com/Navesz/rebar/rules/21884527, with
`bypass_actors: []` and `current_user_can_bypass: "never"` — **not even the owner gets past it.**
It is the N4s of §9.3: the only level that does not live in a file the agent edits.

**The second repository is missing.** The criterion demands ≥2, and the scoreboard is **1 of 19**.

The comparison that dismantles the vanity of D+7: **rebar measures 19 repositories and enforces
in 1 — itself; alicerce measures 2 and enforces in both.** Measuring is reading; enforcing is
blocking. D+7 counts readings, and that is why it is easy.

```bash
for r in <the 18>; do [ -d "$r/ferramental" ] && echo "$r"; done
# alicerce · prumo
```

In `prumo` alicerce's tooling **gates for real**:
`prumo/.github/workflows/ci.yml:113` runs `npm run verificar`, and `prumo/ferramental/` has 8
directories — `contexto`, `controle`, `elos`, `fronteiras`, `hooks`, `portao`, `segredo`,
`verificar`. That is, the premise "alicerce never touched a real project" is **false**.
It survived in the header of `tooling/rebar-check/index.mjs`, and **that was
fixed**: the header today records the correction itself — _"a versão antiga deste
comentário dizia que ele morreu porque a imposição nunca encostou num projeto, e isso foi
MEDIDO e é FALSO"_ [the old version of this comment said it died because the enforcement never
touched a project, and that was MEASURED and is FALSE]. In `docs/PLANO.md` §9.1 it had been
corrected since 30/08; this paragraph was billing the code comment, and the bill is paid
(checked on 02/09/2026). It touched, and in the highest-scoring repository outside the tool
(85%, measurement of 30/08). What alicerce did not do was **scale**: 2 of 19. That is the
defensible diagnosis.

### D+60 — NOT MEASURABLE YET

The trigger mechanism exists: the hooks are installed and they block a commit for real. But
rebar's commits leave no trace of a check that fired and was obeyed, and
the criterion speaks of the owner's repositories in general, not of rebar. No evidence on disk
on 02/09/2026.

### D+90 — NOT MEASURABLE, the baseline is missing

The criterion's baseline is the one of 30/08/2026: **19 checks**, ceiling of ≤50% at **28**.
Today there are <!--n rules.total-->23<!--/n-->, still below the ceiling, and the milestone
only comes due on 23/11/2026 — compare the marker with the 28 and the arithmetic is done. The
second term — "number of repositories using it" — is at **1**. Measuring 19 repositories is not
being used by 19 repositories.

---

## 10. What has already been tried against this repository

This section exists for two people: the next session, which must not reopen a hole already
closed, and the next auditor, who must start where this one stopped.

Each line is an attack that was **reproduced** and then closed, between 30/08 and 31/08/2026.
The numbers inside the table are from that measurement and stay as they are: they are history,
and history is what gives the fix its authority (§0).

**The pointers into the code stopped being line numbers on 02/09/2026.** They cited
`arquivo:48-81`, and this date's check found **9 of 16** pointing at the wrong line
— the same defect as the counts, from the same cause: the target moves and the document does not.
Now each one names the **block** or brings the `grep` that finds it, which is what does not age.
The block names and the quoted messages stay in Portuguese: they are the record of that
measurement, quoted as the code read and as the tool printed on 30–31/08. Checked on
06/09/2026: those comments, test names and messages have since been translated to English, so
**the `grep` of the literal string no longer finds them** — the block is still there, the
string that names it is not.

| #   | Attack                                                                                                                                                                                                                                                                                                                                    | What was done                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Forging `--config`.** Six steps `() => ({ codigo: 0 })` in a config in `$TEMP` and `--config=` pointing there: output byte-indistinguishable from a real approval, exit 0                                                                                                                                                                | The config's path and the resolved root are **always printed**, approved or not; a config that is not a tracked file in the git tree becomes CONFIG EXTERNO and never exits 0; an empty `--config=` is exit 2. the `FURO 3 — a forja de config` block of `verify.mjs`                                     |
| 2   | **`skip-worktree`.** `git update-index --skip-worktree verify.config.mjs` + rewriting the file on disk ⇒ `git status`, `git diff` and `git diff HEAD` all empty, and APROVADO on the screen                                                                                                                                             | Runs `git ls-files -v`, the only command that sees, and translates every anomalous letter — including the lowercase one, which is `assume-unchanged`, the silent sibling. `LEGENDA_LS_FILES` in `verify.config.mjs` and the `ls-files -v` block of `verify.mjs`                                                             |
| 3   | **A dirty tree coming out APROVADO.** 4 uncommitted files ⇒ APROVADO 6 de 6                                                                                                                                                                                                                                                               | The `higiene` step, new. "APROVADO" and "clean tree" are two independent claims, and the gate only made one. `checarHigiene` in `verify.config.mjs`                                                                                                                                                          |
| 4   | **Mute warnings.** `extrairErros` only ran when the step did **not** pass, so the stdout of an approved step was discarded — including the "⚠ N arquivo(s) escondidos por .rebarignore", which is the only channel that denounces a ruler turned off                                                                                       | The `avisar` field: a RegExp per step, extracted and printed **even when the step passes**, in a section of its own below the scoreboard. each step's `avisar` field, in `verify.config.mjs`                                                                                                                                 |
| 5   | **`caso.json` as a bypass.** A `caso.json` at the repository root produces an empty prefix, and `''.startsWith` matches everything: the whole repository would vanish from the evaluation with a three-byte file                                                                                                                           | A marker only counts under `provas/casos/<caso>/`, never at the root, and only with the minimum schema. A refused marker becomes a **warning naming the file**. the `Onde um caso.json tem significado de marcador` block of `index.mjs`                                                                                                            |
| 6   | **Untracked `.rebarignore`.** A loose file on disk — or hidden behind `.git/info/exclude` — blinded the checker without entering a diff, a review or the `git status`                                                                                                                                                                      | The list is read from **git**, not from disk. Untracked is ignored entirely, and the fact becomes a warning. the `Lido do GIT, não do disco` block of `index.mjs`                                                                                                                                                               |
| 7   | **`ehTeste` as a third bypass.** A test file leaves the content rules; renaming a folder to `provas/` took its content out of five rules **and** still satisfied `testes` — "2 of 8 + 2 warnings" became "3 of 7 + 0 warnings", without a line saying what vanished                                                                         | The exclusion is **counted and printed** on the scoreboard, with a sample of the paths. the `arquivo(s) de código fora das regras de conteúdo por serem teste` line of `index.mjs` — the "2 arquivo(s) … por serem teste" line of `npm run check` is that count                                                                                                      |
| 8   | **Secret reading the disk instead of the index.** `--staged` took the NAMES from the index and the CONTENT from the disk: it read one file and committed another. It is not only an attack — it happens on its own when you edit after the `git add`                                                                                       | In `--staged` the content comes from the **index blob**. The disk is only read in normal mode. fix 1 of the header of `scan-secret.mjs`                                                                                                                                                                              |
| 9   | **PLACEHOLDER turning off the whole line.** Measured: 8 of 9 **real** credentials passed. The worst case was `{ host: "localhost", token: "ghp_…" }`, a line any project writes                                                                                                                                                            | The placeholder is tested against the **matched stretch**, never against the line. Turning off the whole line only through the explicit escape hatch `rebar-segredo-ok:`. fix 2 of the header of `scan-secret.mjs`                                                                                                   |
| 10  | **Co-authorship by enumeration.** The policy was a list of 9 AI agents. Windsurf, ChatGPT, Cody, Codeium, Amazon Q and Tabnine got into the history with a trailer that `git log --format=%(trailers)` recognizes: hook approving, exit 0 on all six                                                                                       | It became an **allowlist of humans** in `.rebar-coautores`, compared by lowercased e-mail, and the file has to be tracked. Enumerating agents is a race that is lost every week                                                                                                                  |
| 11  | **Smuggling below the scissors.** A `Co-authored-by:` written **after** the `>8` comment line that git cuts: the trailer parser missed it, and the commit went in                                                                                                                                                                          | `check-message.mjs` **does not cut at the scissors** — it uses `git stripspace --strip-comments` and then `git interpret-trailers --parse`, in that order. Measured on both sides: it finds the hidden trailer and does not generate a false positive with the `commit -v` diff. the `SEGUNDO FURO: O CONTRABANDO ABAIXO DA TESOURA` block of `check-message.mjs` |
| 12  | **The proofs read the exit code.** `index.mjs` collapses `passou` and `na` into the same exit 0, so no "not applicable" branch could be locked. Measured: of the **70 mutations** applied to `index.mjs`, **30 survived** with the suite 15 of 15 green — among them the `na()` helper and the `catch` of `git()`, the two most expensive fixes in the file | Each side of the case declares an **`estado`** (`passou`/`reprovou`/`na`) and the runner reads it from the `--json`. `quebrou` can never be expected: a crash is a defect of the instrument. `provas/provar.mjs:74-95`                                                                            |

Three of these attacks have the same shape, and the pattern is worth naming: **an open gate
has to be a checked fact, not an omission.** `.rebarignore`, `caso.json` and `ehTeste` go on
existing as a legitimate way out — what changed is that using them leaves a mark printed on
the scoreboard.

A whole class of false positive also died in this session: **"a defect looked for
recursively, a defense looked for only at the root"**. It is documented in
the comment in `index.mjs` that ends with "Cinco achados, cinco falsos" (`grep -n "Cinco achados"`):
`prumo`, `ducado` and `LinhaK` accused of "components/ui/ sem components.json" while all three
had the file tracked, `openkartline` accused of "sem prettier" with prettier declared in
`apps/web/package.json`, and `LinhaK` accused in `typecheck` too. It is part of the reason the new scoreboard is not comparable with the old one.
**There is no comparable old scoreboard to subtract from** — the number in §4.8 is the new one, and that is that.

---

## 11. Next step

_Rewritten on 02/09/2026. The previous list had the push and the ruleset as item 1; both
were done, and keeping them here would be the same stale-number defect, one floor up._

Where the repository stands, on 02/09/2026: rebar passes on its own ruler with **13 of 13 · 4
n/a** (§4.2), `verificar` closes <!--n verify.passos-->22<!--/n--> of <!--n verify.passos-->22<!--/n--> steps, the proofs are <!--n proofs.casos-->60<!--/n--> cases covering <!--n proofs.cobertura-->23 de 23<!--/n--> rules, the hooks are installed, twelve attacks
are closed, and the repository is pushed, with green CI on both systems and a ruleset
without `bypass_actors` (§9, D+30).

What is missing is what turns this into real enforcement, and the first item continues not to
be code:

**1 · Install `rebar-check` in the CI of two repositories that are not rebar.** It is the
literal wording of D+30, and it is the only milestone that can still kill the project: the
scoreboard is **1 of 2**. The two obvious candidates are `prumo` (85%, already has CI that
gates) and `openkartline` (62%, likewise) — both scores are from 30/08 (§4.8). Comes due on
**24/09/2026**.

**2 · Close the tenant isolation domain**, which is where the only known failure documented in
a test is (§5.4).

**3 · The two absent items of §8.1** — `contexto/ai.mjs` and the boundary presets. They come
**after** the two above. Locked order: consumer before generator, and enforcement before a new
tool.

**4 · The `porque:` as a field of the rule**, instead of a comment extracted by position
(§4.12). It is <!--n rules.total-->23<!--/n--> edits in `index.mjs`, and they take out the
last positional heuristic left in the MCP generator.
