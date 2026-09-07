# rebar — the alicerce v2

> **What this file is.** The project's single manuscript, in the planning phase.
> The owner's analogy: *"é como um livro — primeiro o cara escreve tudo, depois pega o que ficou bom e publica."* [it is like a book — first the guy writes everything, then he takes what turned out good and publishes it.]
> We plan everything here; **afterwards** this file becomes a tree of files in the repository.
> In the meantime, no decision that lives only in the conversation.
>
> **Status:** planning · **Updated:** 25/08/2026

---

# 0. Repository objectives

1. **Make wrong code not pass.** Everything typed, everything testable, and an error that **blocks** instead of becoming an ignored warning.
2. **`npm create rebar`** — generate a web project that is born with the right stack and the gate closed, with no manual editing.
3. **Keep imposing after day 1.** The generator does not leave the stage; it stays in the project as MCP and as commit and CI gate.
4. **Push the rules down a level.** Everything that today is asked of the AI in prose and would fit in a compiler, lint or test becomes compiler, lint or test.
5. **Keep the MCP alive.** When the project rule changes, the MCP regenerates itself — and the gate fails if it is old. *(See §7.2 — it is the defect the owner lived through in Herz and in BMB Compras.)*
6. **Be navigable by a new agent** without reading everything: index, README and MCP as entry points.

---

# Index

| § | Section | What for |
|---|---|---|
| [1](#1-how-we-work) | How we work | The rules of this collaboration. Read before acting |
| [2](#2-context) | Context | Where the project came from and what the pain is |
| [3](#3-the-three-findings-that-reframe-the-project) | The three findings | What changed in understanding during the survey |
| [4](#4-the-n0n7-taxonomy--the-most-valuable-asset) | N0–N7 taxonomy | The spine of everything. Without it nothing makes sense |
| [5](#5-the-full-panel--120-decisions) | The panel — 120 decisions | The inventory. Becomes `perfil.esquema.json` |
| [6](#6-inventory-of-the-complete-application) | Complete application | What the app needs to have, and what is missing in the alicerce |
| [7](#7-rebar-architecture) | Architecture | Profile-as-compiler, live MCP, gate layers |
| [8](#8-what-we-take-from-each-repository) | What we take | Inheritance inventory: alicerce and herz |
| [9](#9-build-order) | Build order | Sequence with a done criterion |
| [10](#10-verification) | Verification | How to know it worked |
| [11](#11-decision-log) | Decision log | Dated log. **Every change goes in here** |
| [12](#12-review--holes-found) | **Review — holes** | What the adversarial review knocked down. **Read before implementing** |
| [13](#13-open) | Open | What we still do not know |

**When this becomes a tree of files**, the planned cut is: §4 and §5 → `manual/`; §5 → also `perfil.esquema.json`; §6 → `manual/aplicativo-completo.md`; §7 → `arquitetura/`; §11 → `adr/`.

---

# 1. How we work

The owner's instructions, in force for the whole project. They are here because **both of us forget** — his words: *"eu também sou igual você, cara. Eu vou esquecer de algumas coisas que estou falando, assim como você esquece."* [I am just like you, man. I am going to forget some of the things I am saying, just as you forget.]

1. **Centralize.** One file, or three at most. At the start there is too much and you forget which file to edit. Centralizing avoids pivoting for nothing.
2. **Index and cross-reference.** So neither of us has to reread everything, and so a new agent can guide itself.
3. **Living document.** Information changes over time; the file keeps up. A change goes into the [Decision log](#11-decision-log).
4. **Plan everything first, publish afterwards.** Only turn it into a tree of files when the plan is closed.
5. **Objectives at the top**, always visible.
6. **The MCP is the priority right after the README** — it is what stops the AI from ignoring what was agreed.

## 1.1 The owner's criticism of my work, on the record

> *"Eu estou vendo que você está mais arrumando o bug do que implementando novas."* [I am seeing that you are fixing the bug more than implementing new things.]

It stands. In this session I audited, fixed `openparts`, fixed the alicerce hook installer, and licensed five repositories — a lot of fixing, little building. Part of it was asked for, but the observation holds as a course correction: **rebar is construction, not audit.**

He also points at the cause and the cure, and both matter for the design:

> *"No Herz e no BMB Compras eu não tive esse problema porque elaborei um MCP com todas as regras de projeto, pra ele sempre ficar na memória e forçar a ser usadas."* [In Herz and in BMB Compras I did not have this problem because I built an MCP with all the project rules, so it would always stay in memory and force them to be used.]

And the defect that was left over:

> *"O MCP não era reescrito quando as regras de projeto foram modificadas. Não tem a capacidade de reescrever o MCP em tempo real."* [The MCP was not rewritten when the project rules were modified. It has no capacity to rewrite the MCP in real time.]

**That defect is requirement nº 5 of the project.** See [§7.2](#72-the-mcp-that-regenerates-itself).

---

# 2. Context

The owner builds sites with AI help. He has two repositories that should solve this and do not:

- **`alicerce`** — the method: a panel of 120 decisions, a constitution of 23 invariants, the N0–N7 taxonomy, and a `ferramental/` of checkers.
- **`herz`** — a real PCP, with the best-thought-out stack he has and an interface that works very well.

The complaint of origin: *"todos os sites que peço para usar o alicerce como referência, muita coisa é ignorada, hardcoded, esquecendo alguma coisa da stack, colocando o claude como colaborador, esquecendo do shadcn"* [in every site where I ask for the alicerce to be used as reference, a lot is ignored, hardcoded, forgetting something in the stack, putting claude in as co-author, forgetting about shadcn].

The diagnosis was already written by the alicerce itself, in `perfis/herz.md:14`: **"decisão que mora onde nenhuma máquina lê"** [a decision that lives where no machine reads].

## 2.1 Locked decisions

| Decision | Choice |
|---|---|
| Nature | Generates **and** keeps watching |
| Target | Presets `site` / `app` / `api`, common core |
| Hardness | **Blocks commit and CI** |
| AI co-authorship | Blocked in new projects; the alicerce history stays as it is |
| Name | `rebar` — the steel bar inside the concrete |
| Database | **Postgres.** SQL Server requires a license; and there is no migration, the herz backend was never built |
| Interface | **Reuse the herz one** — *"funciona muito bem, está bem animada, os botões estão bem legais"* [it works very well, it is nicely animated, the buttons are really cool] |
| Repo base | New. **Do not build on top of the current alicerce** |
| Sequence | Inventory → agent review → README → **MCP** → the rest |

---

# 3. The three findings that reframe the project

## 3.1 The herz stack is, in good part, document — not code

| `Stack.md` claims | Reality | Evidence |
|---|---|---|
| Fastify, layers `domain/ app/ http/ db/` | Does not exist. `apps/` only has `web` | `Stack.md:153-176` |
| Kysely + MssqlDialect + tedious | Not installed | `Stack.md:234` |
| Playwright on 3 flows | Not installed | `Stack.md:607` |
| shadcn/ui + **Radix** | It is **`@base-ui/react`**; Radix only transitively via `cmdk` | `apps/web/package.json:16` |
| `responseValidation` on | Ignored with a custom `api`; redone by hand | `apps/web/src/dados/cliente.ts:8-30` |

**There is no backend to port.** Postgres comes in with zero migration cost.

## 3.2 The alicerce imposes less than 7% of what it documents

- **120 decisions** in the panel (not 117 — four files claim 117).
- **~8 decisions** have a real gate. **5 of the 23 invariants** have code that runs.
- `base/`, `orquestracao/`, `adr/` are **empty**.
- **`perfil.esquema.json` does not exist.** The validator engine passes on 10 fixtures, but the default points at a missing file → exit 2.
- `fronteiras/provas/provar.mjs` breaks on Windows: `execFileSync('npx', …)` without `shell:true`. It takes down the `fronteiras` step **and** `provar-portao.mjs`. Invisible because CI only runs Linux.

**The inversion that defines rebar:** in the alicerce the generator is M8, last and never reached. In rebar, **the generator is the product**.

## 3.3 The alicerce's blind spot is where the owner's projects live

The alicerce was written for an internal corporate system. The owner builds **public sites**. The panel does not have one line about:

> terms of use · privacy policy · cookies · legal basis · data-subject channel · DPO · DPA · SEO · `<title>`/description · favicon · `og:image` · sitemap · `robots.txt` · manifest/PWA · LICENSE · README as a deliverable

Grep over the whole repository: **zero occurrences**. By the panel's own criterion (*o inimigo é "não perceber que havia uma escolha"* [the enemy is "not perceiving that there was a choice"]), it is its failure mode happening to itself. **Rebar's biggest original contribution.**

---

# 4. The N0–N7 taxonomy — the most valuable asset

From `manual/02-quem-impoe.md`. Mother rule (`:8`): **"Se uma regra pode descer um nível, ela deve descer."** [If a rule can go down a level, it must go down.]

| Level | What it is | Fails as | Cost/session |
|---|---|---|---|
| **N0** | Compiler — types, typed contract, exhaustiveness | "does not compile" | zero |
| **N1** | Static analysis — lint, boundaries, cycles, literal color | "does not pass lint" | zero |
| **N2** | Runtime contract — Zod at the edge, env at boot | "does not pass at the edge" | ~zero |
| **N3** | Test | "does not pass the suite" | zero |
| **N4** | CI — blocks merge | "does not get into main" | zero |
| **N5** | Hook — prevents it **before** it happens | "the action does not happen" | ~zero |
| **N6** | AI rule — `CLAUDE.md`, MCP | "depends on reading and obeying" | **high and recurring** |
| **N7** | Human gate | "depends on someone paying attention" | high |

**The determinism boundary is between N5 and N6.** Above it is machine; below it is a request.

1. **The arithmetic** (`:43-54`): 100 lines of rule ≈ 1.5k tokens. 30 sessions/week for a year ≈ **2.3 million tokens**. *"Toda regra que mora em N6 e caberia em N0–N5 é dívida."* [Every rule that lives in N6 and would fit in N0–N5 is debt.] Target: always-present instruction **< 200 lines**.
2. **The limit** (`:103-114`): *"Regra automática errada custa mais que regra ausente."* [A wrong automatic rule costs more than a missing rule.] **Every rule that goes up to N1 is born with two cases — one that fails, one that passes.**

**This is what answers the complaint.** The AI ignores because almost everything is in N6. The answer is not to write better — it is to **go down a level**.

---

# 5. The full panel — 120 decisions

Transcription of `manual/00-painel-de-decisoes.md`. ✅ house default · ⬜ the project decides · 🔴 expensive to reverse.

*(This section becomes `perfil.esquema.json`. Each row gains two fields the alicerce does not have: **N0–N7 level** and **generated artifact**.)*

## Axis 0 · Product and limits — 9
> Before any technology. Half of architecture errors are errors of assumed scope.

| Decision | House default | Imposed at | Cost of getting it wrong |
|---|---|---|---|
| ⬜🔴 What problem it solves, in one sentence | — | N7 | Scope grows without limit |
| ⬜🔴 What the system does **not** do | Explicit list, versioned | N7 | Every request becomes a feature |
| ⬜ Actors and what each one can do | List before RBAC | N7 | Permission becomes a patch |
| ⬜🔴 Criticality: money, time or life? | — | N7 | Defines the rigor of everything below |
| ⬜ Expected volume | Order of magnitude is enough | N7 | Optimization invented or absent |
| ⬜🔴 Multi-tenant? | No, absent proof | N0/N2 | Tenant retrofit is a rewrite |
| ✅ Language of the code and of the domain | Portuguese, one only | N1 | Duplicated name in two languages |
| ⬜ Systems it integrates with, and who is in charge | List with a human owner | N7 | Coupling discovered late |
| ⬜ Expected lifetime | — | N7 | Rigor out of proportion to the disposable |

## Axis 1 · Contract — 13
> Where the AI invents most: it creates `POST /pedido/iniciar` when the server expects `POST /pedidos/:id/iniciar-montagem`.

| Decision | House default | Imposed at | Cost of getting it wrong |
|---|---|---|---|
| ✅🔴 Single source, imported by both ends | `contracts` package, no intermediate generation | N0 | Divergence discovered by the user |
| ⬜ Contract tooling | ts-rest + Zod | N0 | — |
| ✅ Contract describes the whole route | method, path, params, query, body, status, error | N0 | A loose schema validates a payload, not an API |
| ✅🔴 **Response** validation, in production too | Yes | N2 | `as any` goes straight through |
| ✅ Error format | Problem Details RFC 9457 | N2 | The screen matches on a message string |
| ✅🔴 `commandId` generated by the **client** | Yes | N0/N2 | Retry duplicates the effect |
| ✅ `request`·`response`·`event`·`error` separated | Yes | N1 | Life cycles in the same type |
| ✅ `z.input` on the client, `z.output` on the server | Yes | N0 | Works by accident |
| ⬜ API versioning | Additive; a break requires an ADR | N7 | Old client breaks in silence |
| ✅ Pagination/filter/ordering | Shared primitive | N0 | Every route invents its own |
| ✅ Zero Node dependency in the contract | Yes | N0/N1 | The browser bundle breaks |
| ⬜ Date and time zone | ISO 8601 with offset, always | N2 | A time-zone bug is the most expensive to find |
| ⬜ Money | Integer in cents, never float | N0/N2 | A cent error in a report |

## Axis 2 · Data and persistence — 15

| Decision | House default | Imposed at | Cost of getting it wrong |
|---|---|---|---|
| ⬜🔴 Database and dialect | — | — | Reversible only early |
| ✅🔴 Query builder over an ORM that hides SQL | Kysely | N7 | An abstraction that hides what executes |
| ✅ One pool, one transaction API | Yes | N1 | Two transactional models |
| ✅🔴 One transaction per use case, via `UnitOfWork` | Yes | N1/N3 | A transaction opened anywhere |
| ✅🔴 No external I/O inside a transaction | Outbox after commit | N1/N3 | A lock held by a third party's HTTP |
| ✅ Concurrency: conditional `UPDATE` | Yes | N3 | Negative balance under concurrency |
| ✅🔴 A version conflict is `409`, **never** a retry | Yes | N3 | Retry overwrites someone else's intent |
| ✅ Retry only on transients, of the whole use case | In the `UnitOfWork` | N3 | A partial retry corrupts state |
| ⬜🔴 Migrations: tooling, reversibility | Reversible or with an ADR | N4/N7 | A destructive migration with no way back |
| ✅ An existing migration is never edited | A new migration | N1/N4 | Environments diverge in silence |
| ⬜ Deterministic seed | Yes, fixed seed | N3 | A test that passes on Tuesdays |
| ⬜ Invariant in the database (CHECK, FK, unique) | Yes, beyond the code | N2 | Code is one gate; the database is the last |
| ⬜ Soft delete? | No, absent a legal requirement | N7 | `WHERE deleted_at IS NULL` forgotten |
| ⬜🔴 Backup — **who has actually tested a restore?** | Restore tested before go-live | N7 | A backup never tested does not exist |
| ⬜ Retention and purge | Before the first write | N7 | LGPD and a 400 GB table |

## Axis 3 · Boundaries and composition — 9

| Decision | House default | Imposed at | Cost of getting it wrong |
|---|---|---|---|
| ✅🔴 Layers and fixed import direction | domain → nothing; data → no UI; component → no fetching | N1 | Everything imports everything in 3 months |
| ✅🔴 Boundary imposed by tooling | `dependency-cruiser` in CI | N1/N4 | A README is intent |
| ✅ Business rule in pure code | Yes | N1/N3 | A rule only testable by booting the world |
| ✅ Import cycle failed | Yes | N1 | Works until it stops working |
| ✅ Orphan module flagged | Warning | N1 | Unreviewed code in the repository |
| ✅ Mutable global state does not exist | Explicit dependency | N1/N7 | The AI does not foresee the effect |
| ⬜ Monorepo: who depends on whom | Declared graph | N1 | A package becomes the common dumpster |
| ✅🔴 Search radius: a feature spans how many files | Target ≤ 10 | N6/N7 | It is **the** token-cost metric |
| ⬜ Organization: by layer or by feature | By feature where there is a real domain | N7 | Changing a feature touches 8 folders |

## Axis 4 · Verification — 18
> The axis that gets forgotten. Not because it is hard — because you ask for "tests" and you get a unit test.

**Different columns in this axis.**

| Check | House default | What it catches | Trigger |
|---|---|---|---|
| ✅ Strict typing | `strict`, no exception without an ADR | Divergence of shape | Always |
| ✅ Formatting | Automatic, not discussed | Review noise | Always |
| ✅ Static + boundaries | Lint + `dependency-cruiser` | Crossed layer, cycle, orphan | Always |
| ✅ Domain unit test | Yes | Wrong business rule | There is a business rule |
| ⬜🔴 **Contract test** | Yes | A handler that diverged from the schema | There is an API |
| ⬜🔴 **Integration with a real database** | Yes | SQL, transaction, missing index | There is a database |
| ⬜ **Migration test** (with existing data) | Yes | A migration that breaks in production | There is a migration |
| ⬜ Component test | Where there is interaction logic | Broken UI state | Component with state |
| ⬜ E2E of the critical path | 3 to 7 flows, no more | Integration between everything | There is an end user |
| ⬜ Error path (409, 422, 503, timeout) | Yes | What only breaks when things go wrong | Whenever there is a foreseen error |
| ⬜ Accessibility | Declared target level | Keyboard, focus, contrast, reader | Public or corporate interface |
| ⬜ Visual regression | Only on a stable design system | CSS that leaks | Shared design system |
| ⬜ Load / limit | Before go-live | Missing index, N+1, pool | Known volume |
| ⬜🔴 Security: dependencies, secret, static | Yes, in CI | Committed secret, CVE | Always |
| ⬜ Post-deploy smoke | Yes | A deploy that went up broken | There is a deploy |
| ⬜ Coverage: target and where to require it | Domain high; UI with no goal | False sense | Always declare |
| ✅🔴 Single command that decides whether it is done | `verificar` | — | Always |
| ✅ Determinism: fake clock, fixed seed, no network | Yes | Flaky test | Always |

> A test per file is **not** required. What is required is verification per **important behavior**.

## Axis 5 · Security, access and LGPD — 12

| Decision | House default | Imposed at | Cost of getting it wrong |
|---|---|---|---|
| ⬜🔴 IdP and session model | Hello (corporate) | N7 | Homemade auth is a liability |
| ⬜ Session duration, refresh, revocation | Declared | N3 | Eternal session |
| ✅🔴 Access policy in pure, testable domain code | Yes | N1/N3 | RBAC scattered across route `if`s |
| ✅ External input validated at the edge | Yes | N2 | The type does not exist at runtime |
| ✅🔴 Secret never in the repository nor in a log | Vault + check in CI | N4/N5 | Rotate everything, and hope |
| ⬜🔴 Personal data: fields, where, for how long | Inventory before the 1st write | N7 | LGPD — expensive afterwards |
| ✅🔴 Personal data does not go into a log | Masking on output | N1/N3 | A leak through observability |
| ⬜ Audit: who did what, when | On sensitive operations | N3 | Does not answer the investigation |
| ⬜ Rate limit and abuse | Wherever there is a public edge | N3 | — |
| ⬜ Upload: type, size, scan, destination | Declared | N2 | Classic vector |
| ⬜ Headers, CORS, CSP | Restrictive by default | N3 | — |
| ⬜ Dependencies: policy and CVE | Weekly check in CI | N4 | Silent debt |

## Axis 6 · Operation — 10

| Decision | House default | Imposed at | Cost of getting it wrong |
|---|---|---|---|
| ✅🔴 Config validated at boot | Schema at boot | N2 | An env error becomes a midnight bug |
| ⬜ Environments and how they differ | Explicit list | N7 | "Works locally" |
| ✅ Structured log with correlation | Yes | N1/N3 | An unreadable log during an incident |
| ⬜ Minimum metrics | Latency, error, saturation | N7 | Diagnosis by guesswork |
| ⬜ Alert — **for whoever the phone rings** | Defined with a name | N7 | An error nobody reads |
| ⬜🔴 Deploy: how it goes up and how it comes back | Rollback tested | N7 | An improvised rollback at 11pm |
| ⬜ Feature flag | Only where there is real risk | N7 | An eternal flag is debt |
| ⬜ Async: queue, outbox, scheduled | Outbox after commit | N1/N3 | Effect lost or duplicated |
| ⬜ Consumer idempotency | Mandatory | N3 | Reprocessing duplicates |
| ⬜ Maintenance and degradation window | Declared | N7 | An expectation never agreed |

## Axis 7 · Interface — 11

| Decision | House default | Imposed at | Cost of getting it wrong |
|---|---|---|---|
| ⬜🔴 Component library, one only | shadcn/ui + Radix ⚠️ | N6/N7 | Two libraries is the road to none |
| ✅ Third-party component not edited in place | Own layer on top | N1/N6 | An update overwrites it |
| ✅🔴 Literal color failed; semantic token only | Yes | N1 | Works in light, breaks in dark |
| ✅ Icons: one family only | Lucide | N1 | Two families, two weights |
| ✅🔴 Every data component has 4 states | loading·empty·error·with data | N3/N6 | A white screen in production |
| ✅ Component receives data by prop | Yes | N1 | It stops being testable |
| ⬜ Modal and filter state in the URL | Validated by schema | N2 | A link that cannot be shared |
| ⬜ Form: validation coming from the contract | Same schema on both ends | N0 | A rule that diverges screen/server |
| ⬜ Accessibility: target level | Declared | N3 | Retrofit is expensive |
| ⬜ Light/dark theme | Both checked | N6/N7 | Half of the visual bugs |
| ⬜ i18n | No, absent a need | N7 | Retrofit is expensive; premature adoption too |

> ⚠️ **Contradiction to resolve:** the panel says Radix; herz uses `@base-ui/react`. Rebar decides **Base UI**.

## Axis 8 · Working with AI — 15
> The axis that does not exist in market standards, and the one that decides the cost of year two.

| Decision | House default | Imposed at | Cost of getting it wrong |
|---|---|---|---|
| ✅🔴 The always-present instruction is short | < 200 lines | N6 | A giant permanent context |
| ✅ A specific rule loads by path | Yes | N6 | Another 20k of context |
| ✅🔴 MCP of the project's own standards | Yes, **generated from the profile** | N6 | The AI reads the whole repo |
| ⬜🔴 Another project's MCP never counts as norm | Explicit rule | N6 | Cost 5 reverted decisions in Herz |
| ✅🔴 Kludge protocol with human approval | Yes | N5/N7 | An invisible kludge |
| ✅ A suppression requires a justification | `any`, `ts-ignore`, skipped test | N1/N4 | Nobody knows if it was error or intent |
| ⬜🔴 Task state in the repository | `.ai/` | N4 | Compacting is expensive |
| ⬜ Handoff at the end of every task | Automatic | N4 | A new session rereads the soap opera |
| ⬜ ADR mandatory for which class | Architecture, contract, database, security | N7 | A decision becomes folklore |
| ✅🔴 Comment the why, never the what | Yes | N6 | An outdated comment lies |
| ✅ Density decided in the 1st files | Phase 2 | N7 | The AI imitates its surroundings |
| ⬜ JSDoc only on the public boundary | Yes | N1 | Prose repeating the signature |
| ⬜ Model routing by complexity | Measured experiment | — | Orchestration costing more |
| ⬜🔴 Token and cost telemetry per task | Yes | N4 | Optimizing without measuring |
| ✅🔴 "Done" = the verification command passed | Yes | N4/N6 | Optimistic reporting |

## Axis 9 · Process and delivery — 8

| Decision | House default | Imposed at | Cost of getting it wrong |
|---|---|---|---|
| ⬜🔴 CI exists and blocks merge | Yes | N4 | ~~"O Herz hoje não tem"~~ [Herz today does not have one] ⚠️ **False.** `herz/.github/workflows/verificar.yml` runs on push to `main` and on every PR. The panel is out of date and I copied it without rechecking |
| ✅ CI = what `verificar` runs, plus the expensive parts | Yes | N4 | Local and CI diverge |
| ⬜ Branch and PR | PR always; no direct push | N4/N5 | — |
| ⬜🔴 When human review is mandatory | Migration, security, contract, kludge | N7 | Review becomes a rubber stamp |
| ✅ The commit describes the effect | Yes, in Portuguese | N6 | History useless as memory |
| ⬜ Versioning and changelog | Where there is an external consumer | N4 | — |
| ⬜ Local hook before the commit | Fast: format and type | N5 | A slow hook is a disabled hook |
| ⬜ Onboarding | Target: one command | N7 | Knowledge in a single head |

---

# 6. Inventory of the complete application

## 6.1 What the alicerce covers well

**Personal data (technical):** inventory before the 1st write · retention and purge · masking in logs · audit · soft delete only on legal requirement · secret in a vault.

**Operation:** config at boot · environments · log with correlation · metrics · alert with a named owner · **health check that checks its dependencies** (*"saúde que responde 200 fixo mente"* [a health endpoint that answers a fixed 200 lies]) · post-deploy smoke · **backup with a tested restore** · tested rollback · feature flag · maintenance window · outbox · idempotency · load before go-live.

**Security:** headers/CORS/CSP · declared upload · rate limit · vault + scan in CI · weekly CVE · IdP · session/refresh/revocation · access in pure domain code · input and response validation.

**Delivery:** CI that blocks · a single `verificar` · PR always · protected branch · mandatory human review · an ADR per divergence · `CLAUDE.md` < 200 lines · `.ai/` with handoff · MCP generated from the profile · token telemetry.

**The catalog of 13 checks**, each with the column *"o que ela NÃO pega"* [what it does NOT catch] — which is what nobody writes:
typing · formatting (*"absolutamente nada de correção"* [absolutely nothing about correctness]) · static/boundaries · unit · contract **in both directions** · integration with a real database (*"mock de banco testa o mock"* [a database mock tests the mock]) · **migration with existing data** (*"a mais esquecida do catálogo"* [the most forgotten one in the catalog]) · component · E2E 3–7 flows · error path · accessibility (*"automática pega talvez metade"* [automated catches maybe half]) · visual regression · load · security · smoke.

**Determinism:** injectable clock · `Date.now()` failed by lint · explicit fixed seed · network forbidden in unit tests · every test creates and destroys its own data · wait for a condition, never for a duration · time zone pinned · quarantine **with a deadline and an owner**, never a bare `skip`.

**Seven antipatterns seen in a real project:** asking for tests and getting unit tests · a database mock in an integration test · a large E2E suite · a test written afterwards by the same agent that wrote the code · a `skip` with no deadline · CI that runs less than the dev does · **an automatic rule with a false positive**.

**Kludge block, ready to become a regex** — the field names below stay in Portuguese because they are the literal marker the regex will match in audited code, not prose:
```
// @gambiarra
// motivo: ...
// alternativa-recusada: ...
// remover-quando: ...
// issue: INT-143
// revisao-humana: obrigatória
```

**The "instead of commenting, promote it to" table** — the comments are quoted verbatim from the owner's requirements, so the original stands and the translation follows in brackets:

| Comment | Becomes |
|---|---|
| "precisa continuar idempotente" [it has to stay idempotent] | a test that sends the same `commandId` twice |
| "mantenha dentro da transação" [keep it inside the transaction] | the `sem-io-externo-no-caso-de-uso` rule |
| "não normalizar o e-mail" [do not normalize the e-mail] | a test with a real legacy case |
| "nunca revele se o e-mail existe" [never reveal whether the e-mail exists] | an error-path test |
| "componente não busca dado" [a component does not fetch data] | the `componente-nao-busca-dado` rule |

## 6.2 What is missing — what rebar adds

**Legal and public content:** terms of use · privacy policy · cookies · legal basis · data-subject channel · DPO · DPA/subprocessor · international transfer · export of the data subject's data.

**Identity and discovery:** SEO · `<title>` and description per route · favicon · `og:image` · sitemap · `robots.txt` · manifest/PWA.

**Still absent:** LICENSE · README as a deliverable · CHANGELOG and SemVer · transactional e-mail · user notification · status page · runbook · SLO/SLA · infra cost cap · **health check with no line of its own in the panel** · **accessibility level never named** (it says "declared", never WCAG A/AA/AAA).

## 6.3 The forensics — what actually fails in the six sites

161 commits measured across Galegos (GAL), decima-edicoes (DEC), navesz.github.io (NAV), openparts (OPP), hug-brasil-propostas (HUG) and constellation (CON).

### The central finding

**The 3 repos with no CI are exactly the 3 with broken lint right now.**

| repo | Does CI run lint? | eslint today |
|---|---|---|
| GAL | no | **3 errors, 4 warnings** |
| OPP | no | **35 errors** + prettier fails on 3 files |
| HUG | no | **2 errors, 9 warnings** |
| DEC | yes | gated |
| NAV | yes (build with `tsc`) | has no eslint |
| CON | yes (lint+tsc+test+audit) | **0 problems** |

The most eloquent case is **OPP**: the only one with a real `AGENTS.md` (39 lines, "Hard rules", "Definition of done"), the only one with `SECURITY.md`/`GOVERNANCE.md`/`CONTRIBUTING.md`, the only one with prettier, the only one with a `check` script that chains `format:check && lint && typecheck && test:run && build`. **Nothing ever runs that `check`.**

> **Derived rule, and it is rebar's thesis in one line:** a rule in markdown has near-zero compliance; a rule in CI has 100%. **The scaffold generates the workflow, not the document.**

### Correcting two premises

**1. It is not Claude — it is Cursor.** The complaint was "colocando o claude como colaborador" [putting claude in as co-author]. Measured:

| agent | commits |
|---|---|
| Cursor | **35** |
| Claude | 6 |
| total with AI co-authorship | 41 of 161 (25.5%) |

OPP has 22/22 commits co-signed by Cursor and **zero** by Claude. Trailers with different casing: `Co-authored-by: Cursor` vs `Co-Authored-By: Claude`. **A regex that only catches "Claude" covers 15% of the problem.**

**And the 6 from Claude are mine, from this session** — almost all of them show up in "Adiciona LICENSE Apache-2.0" [Adds LICENSE Apache-2.0] commits, the subject quoted as the history has it, which I made today. You were right to raise it; I was producing exactly the defect while cataloging it.

**2. No hardcoded secret in the six.** `gh[pousr]_`, `sk-`, `AKIA`, `AIza` — zero occurrences. Also zero `TODO/FIXME/HACK`, zero `: any`, zero `@ts-ignore`, zero versioned build artifact. **The sloppiness is not in the code — it is in configuration, contract and enforcement.**

### Ranking by frequency

| # | Failure | Repos | How to detect |
|---|---|---|---|
| 1 | no `.editorconfig` | **6/6** | `test -f` |
| 1 | no dependabot/renovate | **6/6** | `test -f .github/dependabot.yml` |
| 3 | no `.env.example` even though it reads env | **5/6** | grep of `process.env` vs the file |
| 3 | no formatter | **5/6** | prettier in devDeps + script |
| 3 | `AGENTS.md` absent or boilerplate only | **5/6** | useful lines < 15 or the `BEGIN:nextjs-agent-rules` marker |
| 3 | production URL hardcoded | **5/6** | `git grep -PE 'https?://(?!localhost…)'` |
| 3 | raw hex instead of a token | **5/6** | `comm -12` between the CSS hex and the TS hex |
| 8 | no tests | **4/6** | `git ls-files '*.test.*'` |
| 8 | no `typecheck` script | **4/6** | `package.json.scripts` |
| 8 | mixed language in the same repo | **4/6** | PT/EN stopwords per file |
| 11 | **no CI** | **3/6** | `ls .github/workflows/` |
| 11 | **lint broken right now** | **3/6** (the same ones) | `eslint . --max-warnings 0` |
| 11 | `NOTICE` absent with an Apache license | 3/6 | `grep Apache LICENSE && test -f NOTICE` |
| 16 | AI co-authorship | **41/161 commits** | `commit-msg` hook |
| 17 | inconsistent git identity | **4 combos** from the same owner | `git log --format='%an <%ae>' \| sort -u` |
| 18 | version drift | TS 4 values · `@types/node` 4 · Next 4 · React 3 · Vite 3 · eslint 3 | aggregator job |

### The shadcn trap

**1 of 6 uses shadcn.** And the naive check would fail precisely the one that got it right:

- **GAL uses shadcn correctly and has ZERO `@radix-ui`** — it is on the `base-nova` style and imports `@base-ui/react`. Same as herz.
- **HUG has a fake shadcn**: a `src/components/ui/` folder (it imitates the convention) with no `components.json`, no `cn()`, no `cva`, no accessible primitive, with the same Tailwind string repeated 4 times, and a `<label>` that is a **sibling** of the `<input>` with no `htmlFor` — an accessibility bug, not just a styling one.

> **The correct check is `components.json` + (`@radix-ui` **or** `@base-ui/react`) + `cn()` resolvable through the alias.** Never `@radix-ui` alone.

That is the exact portrait of "esquecendo do shadcn" [forgetting about shadcn]: the AI reproduces the **appearance** of the convention with none of the **guarantees**.

### Individual cases that become test fixtures

| Case | Repo |
|---|---|
| A third party's personal data went into a commit, was removed later and **is still in the history** — a secret and PII are not fixed by a new commit. The commit and the fields stay out of this document on purpose: this repository is public and so is the other one, and pointing at the exact spot would republish the data. Detail in private, with the owner | HUG |
| 623 lines of catalog and prices in `.ts`; **zero `process.env` in the whole repo** | GAL |
| WhatsApp number hardcoded in two formats; the README documents the hardcode | GAL |
| The brand in two spellings — `Galegos` and `Gallegos` — in the same app, including in the `<title>` | GAL |
| `userScalable: false` + `maximumScale: 1` — violates WCAG 1.4.4 | GAL |
| A formal JSON Schema in `packages/schemas/` that **nothing in the code reads** | OPP |
| 3 overlapping animation libs: gsap + framer-motion + lenis + r3f | DEC |
| `vinext@0.0.50` — pre-1.0, patch 50 — in production | CON |
| `eslint-config-next 16.2.6` against `next ^16.3.2` | CON |
| personal e-mail (gmail) exposed in commit authorship | HUG |
| Actions with a floating tag (`@v4`) instead of a SHA | NAV |

### The three rules the evidence imposes on the scaffold

1. **Generate the CI before generating the code.** Correlation 3/3. `AGENTS.md` did not prevent 35 errors in the repo with the most governance documentation.
2. **Detect shadcn by `components.json` + primitive + `cn()`.** Never by `@radix-ui`.
3. **Block config-as-code in the hook, not in review.** The HUG leak went through in an early commit and the damage in the history is irreversible. A `git grep` for a phone number in `pre-commit` would cost 40 ms.

## 6.4 Alicerce inconsistencies, not to be reproduced

1. `04-ordem-de-construcao.md:56` says "117 respostas" [117 answers] — quoted as the source file has it, so the grep still finds it; the panel has **120**.
2. `03-verificacao.md:46` labels formatting as N1; in `02-quem-impoe.md:33` N1 is static analysis.
3. There is no correspondence table between panel ↔ constitution.
4. The panel says **Radix**; herz uses **Base UI**.

---

# 7. Rebar architecture

## 7.1 The profile is the compiler

```
panel (§5, versioned)
   │  answered once, at create time
   ▼
perfil.json  ─── validated against perfil.esquema.json
   │
   ├─► tsconfig + types            (N0)
   ├─► lint + depcruise            (N1)  + the TWO cases of every rule
   ├─► Zod schemas for edge and env (N2)
   ├─► skeleton suite              (N3)
   ├─► CI workflow                 (N4)
   ├─► pre-commit hooks            (N5)
   ├─► CLAUDE.md / AGENTS.md       (N6, < 200 lines)
   ├─► the project's MCP server    (N6)  ← see §7.2
   └─► an ADR for every divergence
```

Every schema entry gains an **N0–N7 level** and a **generated artifact**. That is what turns the panel from a checklist into a compiler.

## 7.2 The MCP that regenerates itself

**Requirement nº 5, and the concrete defect the owner lived through.** In Herz and in BMB Compras the MCP worked to keep the rules in the AI's memory — but when the rules changed, the MCP kept serving the old version, and nobody noticed.

Rebar solves this because the MCP is **not written by hand**: it is an artifact generated from `perfil.json`, like the `tsconfig` and the lint. And it gets the same treatment herz already gives to instruction files with `.ai/gerar.mjs --verificar`:

| Mechanism | What it does |
|---|---|
| **Generation** | `rebar gerar` rewrites the MCP server from `perfil.json` |
| **Freshness gate** | `verificar` runs `rebar gerar --verificar`: it regenerates in memory and compares against what is on disk. **Diverged, it fails.** It is impossible to change the rule and forget the MCP |
| **No stale `dist`** | The MCP runs from source, or the build goes into `verificar`. In herz, a stale `dist` is cause nº 1 of *"o guia não mudou"* [the guide did not change] (`pcp-herz/CLAUDE.md:147-153`) |
| **Derived, never duplicated** | The MCP keeps no copy of the rule: it reads `perfil.json`. There are not two sources to diverge |

This is herz's `guias-vs-realidade.test.ts` pattern, generalized: **derive the fact from the source and fail if the copy diverges.**

### The four tools

| Tool | Does |
|---|---|
| `rebar_verificar` | Runs the gate, returns structured findings. Same command as the hook and CI — calling it is a shortcut, not the barrier |
| `rebar_decidir` | "What did this project decide about X?" — reads `perfil.json`, not prose |
| `rebar_gerar` | Emits component/route/migration in **this** profile's stack |
| `rebar_porque` | Fetches the ADR for the divergence |

**The MCP is never the gate.** The gate is N0–N5. The herz MCP has 17 guides, 1961 lines, 80 KB, and is demonstrably ignorable — the repository itself admits it: *"ferramenta MCP é discricionária, o modelo decide se chama"* [an MCP tool is discretionary, the model decides whether to call it]. Rebar does not repeat that: no long guides, everything derived from the profile on demand.

## 7.3 The three gate layers

1. **`npm run verificar`** — single command. Port `verificar.mjs` from the alicerce (294 lines).
2. **Claude Code's `Stop` hook** — runs `verificar` at the end of **every AI turn**, not only at commit time.

   > ⚠️ **The herz hook does NOT block, and I claimed the opposite.** The command is
   > `npm run verificar 2>&1 | tail -25`. In a POSIX pipeline the exit code is that of the **last** command — `tail` always returns 0. Verified: `false | tail -25` → exit 0.
   > The herz guide calls this *"não é lembrete: é porta"* [it is not a reminder: it is a gate]; in the implementation it is literally a reminder.
   > **In rebar:** no pipe, or `set -o pipefail`, or capture the code before formatting. **And a fixture that proves the hook fails** — it is the two-case rule applied to the gate itself.

3. **CI with a Windows + Linux matrix.** The `npx` defect survived in the alicerce because CI only runs Linux.

4. **Branch protection.** ⚠️ It is not a file, it is **GitHub state**. `npm create` does not deliver it on its own — it needs `gh api` after create or a documented human step. Without it, half the promised hardness does not exist.

---

# 8. What we take from each repository

## 8.1 From the alicerce — as it is

`verificar/verificar.mjs` · `segredo/varrer-segredo.mjs` · `elos/verificar-elos.mjs` · `contexto/ai.mjs` · `hooks/` · the **15 boundary presets** (web 7 + api 8) with the **29 fixtures** · `ci/verificar.yml` as a template.

## 8.2 From the alicerce — fix while porting

- `provas/provar.mjs:39-43` → `execFileSync(process.execPath, [require.resolve('dependency-cruiser/bin/dependency-cruise.mjs'), …])`. Unblocks three things at once.
- `validar-perfil.mjs:25-27` → write the real schema.
- `verificar.config.mjs:12` → swap `find | xargs` for pure Node.
- `verificar.mjs:124` → distinguish "failed" from "broke".

## 8.3 From herz — stack and mechanics

React 19.2 · Vite 8.2 · TypeScript 6 · TanStack Router/Query/Table · Tailwind 4 CSS-first · **shadcn/ui over `@base-ui/react`**, style `base-nova` · Zod · react-hook-form · lucide · sonner · cmdk · TS strict with `noUncheckedIndexedAccess`.

Primitives: branded `rowVersion` · money as a decimal string · `commandId` · Problem Details.

Mechanics: **`.ai/gerar.mjs`** and **`guias-vs-realidade.test.ts`** — see §7.2.

## 8.4 From herz — the interface

### The animation was not written by hand

Zero `@keyframes`, zero `framer-motion`. It comes from three things, all reproducible:

1. **`tw-animate-css`** (`index.css:2`)
2. **Base UI data-attributes** — `data-open`, `data-closed`, `data-starting-style`, `data-ending-style`, `data-swiping`
3. **`transition-*`** for the continuous part

Popup pattern, literal in `dialog`, `popover`, `select`, `dropdown-menu`, `tooltip`:
```
duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95
             data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95
```

Drawer, the most sophisticated one (`drawer.tsx:133`) — exit derived from the physics of the gesture:
```
duration-450 ease-[cubic-bezier(0.22,1,0.36,1)]
data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)]
data-swiping:duration-0
```

**The "botões bem legais"** [really cool buttons] are `button.tsx:7`: `active:not-aria-[haspopup]:translate-y-px` — sinks 1px on click, except when it opens a menu — plus `focus-visible:ring-3` and the cursor block from `index.css:198-263`.

### The 33 components are stock shadcn

Zero Portuguese, zero `@pcp/*` imports, strings in English. **Consequence: the scaffold runs `shadcn add`, it does not copy files** — that way it gets updates for free.

### Generic, zero domain — take it

| Block | Lines | Note |
|---|---|---|
| `components/tabela/` | 1.262 | `TabelaDados<T>` over TanStack Table, six filters, pagination. Grep for domain: zero |
| `components/graficos/` | 633 | 9 charts + `MolduraGrafico`, which embeds the three mandatory states |
| `padroes/estados.tsx` | 118 | Empty·NoResults·Error·Skeleton, with `role="alert"` and `aria-busy` |
| `padroes/secao-galeria.tsx` | 57 | Catalog frame |
| `index.css` cursor `:198-263` | 66 | **The most transferable piece of polish** |
| `main.tsx` providers | 79 | ErrorBoundary › Theme › Query › Tooltip › Router+Toaster |
| `alternar-tema.tsx` | 38 | Switches by CSS, **not by state** — avoids the first-frame flash |
| `dados/use-comando.ts` | 69 | Mutation hub: toast, invalidation, 409 with a "Refresh" button |

### The five color families

`espera` · `execucao` · `bloqueio` · `retrabalho` · `concluido` — the token names stay in Portuguese because they are the CSS custom-property names in herz, not prose. Each one with `--x`, `--x-fg`, `--x-line`, in both themes, and `--chart-1..5` in the same hues. The **pattern** is generalizable; the **names** are PCP's. Rename them.

### Defects not to inherit

- `components.json` says `"baseColor": "neutral"`, but the CSS is zinc — the next `shadcn add` reintroduces gray.
- `--chart-1..5` declared **twice**; `--sidebar-*` are dead tokens.
- `"use client"` in 12 of the 33 files, in a Vite with no RSC.
- **There is no `form.tsx`.** The form pattern is raw RHF repeated — in a scaffold that gets lost on the first new screen.

## 8.5 Does not come in

The whole PCP domain: `packages/dominio/`, the `pedido/estoque/estrutura/cotacao` contracts, the 12 business components (~1.411 lines), `features/` (~2.412), `paginas/` (~2.668), `layout/` (406), the `protheus.md`/`rbac.md`/`bloqueios.md`/`deploy.md` guides.

---

# 9. Build order

> ⚠️ **The previous version of this section (7 steps, generator + 3 presets + MCP) was discarded by the scope review.** Reason in **§9.1**, right below — and the scope cut that goes with it is in §12.5 item 9. (Before, this line pointed at a §12.9 that never existed: §12 goes from 12.8 straight to §13.) What follows is the reduced version.

## 9.1 What the review knocked down

**Steps 1–4 did not fit in one session and delivered nothing you could look at.** They were 3–4 sessions for "a new, empty project that passes lint" — and none of the six existing sites gained a thing.

**The generator-first inversion was wrong.** The correction is not to *generate* a project — it is to **check the ones that already exist**. Checking is retroactive and idempotent; generating only serves project nº 8.

> ⚠️ **Premise correction, measured on 30/08.** This section's original diagnosis was *"o alicerce morreu porque a imposição nunca encostou num projeto"* [the alicerce died because the enforcement never touched a project]. **It is false.** The alicerce's `ferramental/` is installed in two repositories — the alicerce itself and `prumo` — and in `prumo` it really gates: `.github/workflows/ci.yml:113` runs `npm run verificar` → `node ferramental/verificar/verificar.mjs`, and line 207 runs `node ferramental/portao/provar-portao.mjs`. `prumo/ferramental/` has 8 directories, 7 with the same names as the alicerce's, and line 139 of the CI says the cases came from the upstream alicerce. The formulation the measurement supports: **rebar measures 12 repositories and imposes on none; the alicerce measures 2 and imposes on both.** The alicerce's problem is scale (2 of 12), not contact. The conclusion — consumer before generator — survives the correction, because scale is what `rebar-check` attacks.

> The right inversion is not generator-first. It is **consumer-first: write what reads before what writes.**

## 9.2 The slice: `rebar-check` — one file, no generator

A ~350-line `.mjs` that runs against **any existing repository** and prints a scoreboard — the rule ids below are identifiers, not prose, so they stay as written:

```
rebar-check · Galegos
  ✗ coautoria-ia          2 commits with AI Co-Authored-By
  ✓ shadcn                components.json, style=base-nova
  ✗ registry              registries: {} — the house has no published registry
  ✗ robots.txt            missing
  ✗ sitemap               missing
  ✗ politica-privacidade  route missing
  ✗ termos-de-uso         route missing
  ✗ cor-literal           11 raw color classes in .tsx
  ✓ LICENSE               present
                          4 of 12
```

Why this slice:

1. **It works on the six sites that already exist** — plus prumo, ducado and vectra-painel.
2. **It produces a number on day 1.** "Galegos: 4 of 12." **The scoreboard is rebar's screen** — and the predictor below says a screen is what survives.
3. It turns every finding of the forensics (§6.3) into **one line of code**, not a research task.
4. No schema, no templating, no CLI, no presets, no MCP.
5. **The generator falls out for free afterwards.** A checker that can say "robots.txt is missing" is one `--corrigir` away from being a generator. The reverse order does not work.
6. Distribution without npm: `npx github:Navesz/rebar`.

**The predictor that decided this:** of the owner's seven repositories, **the alicerce is the only one with no screen.** ducado, vectra-painel, prumo, decima-edicoes, Galegos, openkartline — all of them have something to look at. n=7, but it is 7 of 7. The previous plan had no screen until step 3.

The half-sentence "and it is the only dead one" was taken out of here: measured, the alicerce runs in `prumo`'s CI (see the premise correction in §9.1). What a screen predicts is adoption, not survival — and adoption is what `rebar-check`'s scoreboard attacks.

## 9.3 The numbered walkthrough

> Order requested by the owner. Every step has a **verifiable done criterion**. None starts before the previous one closes.

### Step 0 · This session's MCP — before any code

**Why first:** the owner identified that *"a gente não criou um MCP pra essa sessão, então pode ser que você se perca"* [we did not create an MCP for this session, so you might get lost]. He is right — and it is exactly what made `bmb-compras` work: it turned into a good, functional final application because it had a rules MCP from the start, with Composer 2.5.

| | |
|---|---|
| **What** | An MCP that serves **this document** by section, plus the decision log (§11), to any future session |
| **Tools** | `rebar_plano(secao)` · `rebar_decidido()` → reads §11 · `rebar_aberto()` → reads §13 |
| **Source** | This file. No prose inside the server |
| **Done when** | A new session answers "what has already been decided about the database?" without reading the whole file |

### Step 1 · Structure and Vite

`npm create vite` · folders · strict `tsconfig` · shadcn with `style: base-nova` and `baseColor: zinc` · the herz cursor block · `@fontsource-variable` (never a font CDN).

**Done when:** `npm run dev` comes up and `tsc --noEmit` passes.

### Step 2 · The CI, before the rules

**The evidence orders this:** 3 of 3 repos with no CI have broken lint. `openparts` has an `AGENTS.md` with "Hard rules" and 35 errors.

Workflow on a Windows + Linux matrix · `npm run verificar` with a **`12/12 passos` count** in the header.

**Done when:** an error planted on purpose fails the PR.

### Step 3 · The server-side gate (N4s)

> **The level the taxonomy was missing.** Only it resists the agent. Everything in N0–N5 lives in a file the agent edits; the workflow it deletes; `core.hooksPath` it removes **with no diff at all**.

Ruleset via `gh api`: required status check by name · PR required · force-push blocked · `commit_message_pattern` denying AI co-authorship · `CODEOWNERS` on `perfil.json` and `adr/`.

**Done when:** deleting the `.yml` leaves the PR stuck on "expected", not green.
**If it cannot be installed:** write `.rebar/portao-remoto.json: {estado:"ausente"}` and `verificar` screams for as long as that is true. **An open gate has to be a checked fact, not an omission.**

### Step 4 · The first rules — three, not thirty

Each one is born with **the two cases** and traceable to a failure measured in the forensics (§6.3):

| Rule | Failure it catches | Level |
|---|---|---|
| AI co-authorship | 41 of 161 commits | N5 + N4 + **N4s** |
| real shadcn | `components.json` + primitive + `cn()` — never `@radix-ui` alone | N1 |
| Legal/SEO presence | robots · sitemap · privacy · terms · `og:image` | N1 |

**Done when:** `provar-portao` plants the three violations and all three fail.

### Step 5 · `rebar-check` on the six sites

Runs against Galegos, decima, navesz.github.io, openparts, hug-brasil, constellation. Prints the scoreboard.

**Done when:** the six have a score. It is rebar's **screen**.

### Step 6 onwards

Only afterwards: `perfil.json` with a ratchet · generator · `app`/`api` presets.

---

## 9.4 The enforcement holes that change the design

Verified in the alicerce's code:

| Hole | What |
|---|---|
| **`opcional: true`** | One word in a `verificar.config` step makes it **fail and exit with code 0**. Any gate turns into a green warning |
| **`--passo=`** | Runs 1 of 12 steps and prints `APROVADO`, without saying that 11 did not run |
| **`perfil.json` is a nuclear route** | The plan creates it. Swap `"acessibilidade":"AA"` for `"nenhuma"`, regenerate, and everything is **consistent and green** with the gate removed. It needs a **ratchet**: every key with a declared ordering, and going down that ordering only with an ADR in the same commit |
| **`settings.local.json`** | It is git-ignored and it **overrides**. An empty hook in there turns everything off with zero diff |
| **`PreToolUse` — the biggest omission** | The plan only has the `Stop` hook, which is an after-the-fact report. `PreToolUse` **prevents the action**: it denies `git commit --no-verify`, denies writing to `src/components/ui/**`. It is the literal definition of N5, applied to the agent instead of to git |
| **Co-authorship: remove the source first** | `"includeCoAuthoredBy": false` in `.claude/settings.json`. The string never exists. Zero friction, zero false positives |
| **Never scan the whole history** | the alicerce has 11 commits with co-authorship, herz 17. A naive `git log \| grep` leaves every PR red forever |

## 9.5 Measured false positives — the rule I was going to ship and will not

**"Literal color failed"** looked like the most obvious N1 rule on the list. Measured in herz: **7 occurrences, 5 of them inside comments that document the rule itself**, 1 is a `bg-black/10` veil in stock shadcn code. **Zero true positives.** A naive rule would be ~100% false positive in the reference repository — the exact definition of *"regra automática errada custa mais que regra ausente"* [a wrong automatic rule costs more than a missing rule].

**Second:** the secret scanner **is going to fail on day 1** with Postgres. `postgres://user:senha@host` matches `string-de-conexao`, and the placeholder list does not have `senha`, `postgres`, `docker` or `local`. It collides head-on with step 1's acceptance criterion.

**Policy, then:** every rule is born as `warn` with a counter and only becomes `error` after N commits with no new hit. A single escape hatch (`// rebar-<regra>-ok: <motivo>` — the token stays in Portuguese because it is a contract with the user: renaming it invalidates every escape already written in the audited repositories), counted. **A reported false positive becomes a file in `aprovar/`** — which is already the FP regression suite, because `provar.mjs` fails any violation in there.

## 9.6 The simplification that eliminates fixture rot

> **`aprovar` = the generator's output. `reprovar` = mutations planted in that output, in a temporary directory.**

A new proof does not create a new directory. If a rule needs an app of its own to be provable, the rule has the wrong shape. This fixes `provar-portao.mjs` into the bargain, which today writes and runs `git add` **in the live repository**.

## 9.7 Abandonment condition

The owner already writes a "Reconsider if" clause in prumo's ADRs. Applied here, with dates:

| Milestone | Criterion | If it fails |
|---|---|---|
| **D+7** | `rebar-check` ran against ≥3 repositories that are not rebar | **Stop.** The alicerce's M5 has said *"falta instalar num projeto real"* [it still needs installing in a real project] since 12/08 and never changed. It is the only measurable difference between the two projects |
| **D+30** | ≥2 repositories with `rebar-check` in CI **failing merges**, with a run link | It becomes a checklist in `CLAUDE.md` and the repository is deleted |
| **D+60** | ≥1 check fired against something the owner wanted to do, **and he fixed the code instead of turning the check off** | The rule was wrong — this is the *"regra automática errada custa mais que regra ausente"* [a wrong automatic rule costs more than a missing rule] |
| **D+90** | Checks grew ≤50% **and** the nº of repositories using it grew | If the checks grow and adoption does not, it became the alicerce. Freeze the list |

**Hard stop:** two new repositories started without rebar, back to back, **after
the generator exists**.

> ⚠️ **This criterion FIRED on 31/08/2026, and it was amended — not ignored.**
>
> The original wording was "two new repositories started without rebar, back to back", without
> the last clause. Measured:
>
> ```
> rebar         first commit  25/08 23:35
> LinhaK        first commit  29/08 18:47
> VectraB-Lab   first commit  29/08 18:48
> ```
>
> Two new repositories, **one minute apart**, four days after rebar was
> born, neither using rebar. By the original text, the repository would be deleted today.
>
> The amendment has a reason and it is verifiable: **there is no command to start a
> repository with rebar.** `npx github:Navesz/rebar new` was never written. The criterion
> was measuring adoption of a capability the project never had — it measured the absence of the generator,
> not the rejection of the tool.
>
> What the amendment does NOT do: it does not stop the clock. D+30 and D+60 stand on the original dates.
> And from the day the generator exists, the clause comes back with teeth — two
> new repositories without it, back to back, and it is over.
>
> Recorded this way because the criterion exists precisely to prevent rationalization, and
> amending without leaving the minutes is the rationalization it forbids.

**Non-scope:** no `app` or `api` preset before `site` has been used **without modification** in two sites.

---

# 10. Verification

- **Of rebar itself:** `verificar` green on a Windows + Linux matrix; `provar-portao` plants one error per rule and demands a failure; `rebar gerar --verificar` fails an out-of-date MCP.
- **Of what it generates:** `npm create rebar` in a clean directory → `verificar` passes with no editing; then plant each forensic failure and confirm the commit is blocked.

---

# 11. Decision log

Every change of course goes in here, dated. It becomes `adr/` when the file becomes a tree.

| Date | Decision | Why |
|---|---|---|
| 25/08 | The name `rebar` | The steel bar inside the concrete: invisible enforcement. Natural sequel to "alicerce" |
| 25/08 | New repo, do not build on top of the alicerce | The owner's request |
| 25/08 | Postgres | SQL Server requires a license. And there is no migration — the herz backend never existed |
| 25/08 | Base UI, not Radix | The alicerce panel says Radix; herz **uses** Base UI. Reality wins |
| 25/08 | `shadcn add` instead of copying components | The 33 are stock; copying freezes them and loses updates |
| 25/08 | The gate blocks commit **and** CI | The owner's choice, the hardest level |
| 25/08 | The generator is the product, not the last module | Inverts the alicerce's error, which left `base/` empty |
| 25/08 | MCP with a freshness gate | A defect lived through in Herz and in BMB: the rule changed, the MCP did not |
| 25/08 | README and MCP moved up in the order | The owner's request: the MCP is what stops the AI from ignoring what was agreed |
| 25/08 | **Generate the CI before the code** | Forensics: 3/3 of the repos with no CI have broken lint. `AGENTS.md` did not prevent 35 errors |
| 25/08 | The co-authorship regex covers **every** agent | Cursor is 6× more frequent than Claude (35 vs 6), with different trailer casing |
| 25/08 | shadcn detection by `components.json` + primitive + `cn()` | `@radix-ui` alone fails the only repo that got it right (GAL uses Base UI) |

---

# 12. Review — holes found

First adversarial review pass. Everything below was **verified on disk**, not accepted from the reviewer.

## 12.1 The structural hole: N1 has no tooling

**The alicerce's `ferramental/` has no linter at all.** `devDependencies` = `dependency-cruiser` + `typescript`. Zero eslint/oxlint/biome config files. All the N1 that exists is the **import graph**, and the 29 fixtures are all boundary fixtures — **zero lint fixtures**.

Consequence: these ten panel lines say N1 and have no tooling, no implementation, and none of the two cases the mother rule demands:

> literal color · empty `catch` · loose `Date.now()` · suppression with a justification · JSDoc on the boundary · masking of personal data in logs · single language · log with correlation · mutable global state · migration never edited

**And the decision that would enable all of this — "which linter, with what capacity for custom rules" — does not exist in the panel.** The entire N1 level depends on a decision nobody made. It is the most urgent item in the schema.

## 12.2 ~~The `site` preset cannot use the herz stack as it is~~ · CLOSED on 31/08

The inherited stack is Vite + TanStack Router = **SPA**. The hole rebar exists to plug includes `<title>`, `og:image` and sitemap.

**WhatsApp, LinkedIn, Slack and Discord do not execute JavaScript.** An SPA's `og:image` simply does not work — the link preview comes up empty.

### The decision: stack split PER PRESET

| Preset | Build and routing | Why |
|---|---|---|
| `site` | **Next 16 App Router + `output: 'export'`** (SSG) | it is the only GA path that delivers `og:image` in HTML |
| `app` | Vite + TanStack Router | stays as it is |

**This section's premise was wrong in the part that decides.** It treated "the inherited stack
is Vite + TanStack Router" as a fact about the `site` preset. Measured on 31/08 across the owner's
repositories:

```
SITES   Galegos 16.2.12 · decima-edicoes 16.3.2 · hug-brasil 16.2.10   → Next App Router
APPS    ducado ^1.170.32 · LinhaK ^1.170.18                            → TanStack Router
```

The owner **had already split the stack per preset in practice**. It was the document that imposed
a single one. And the only site of his with correct metadata is the only one with `output: 'export'` —
`decima-edicoes/next.config.ts:6`, with a 1200×630 `og.jpg`, `sitemap.ts`, `robots.ts` and
`manifest.ts`.

### The spike that closed the material hole

Nobody had checked whether the three pieces work TOGETHER. Run on 31/08, in a temporary
directory:

```bash
npx shadcn@latest create -t next -b base -p nova --pointer -n spike -y
# → components.json  style: base-nova · rsc: true
# → @base-ui/react ^1.7.0 · ZERO @radix-ui · React 19.2.4 · Tailwind 4 · Next 16.2.6

# + output: 'export' and images.unoptimized in next.config.ts
npx next build
# → ✓ all routes prerendered as static content, exit 0

grep og:image out/index.html
# → <meta property="og:image" content="https://exemplo.com.br/og.jpg"/>
```

The `og:image` with an absolute URL arrives in a 12 KB static HTML, without a line of
JavaScript. It is exactly the property the section doubted.

Worth recording that `shadcn create -d` defaults to `--template=next --preset=base-nova`:
**the recommendation coincides with the upstream default**, it does not fight it.

### What this costs

**MAJOR on the Stack, and calling it MINOR would be convenience.** Swapping the `site` preset's
builder and router is the reversal of a closed decision, and the document exists to record that. What
is NOT touched, and is the most expensive piece: `Galegos/components.json:3` proves `style: base-nova`
with `rsc: true` running on Next 16 over `@base-ui/react`, with zero Radix. React 19,
Tailwind 4, shadcn over Base UI and the TanStack libs that are not routing — all intact.

## 12.3 ~~The decision the panel does not have and that IS the original complaint~~ · CLOSED on 31/08

**Content origin: hardcode · MD/MDX in the repo · CMS · database.** It is the *"hardcoded"* from the owner's complaint, verbatim. The panel does not have one line about where the site's text lives. Without that decision, the generator produces exactly what it exists to prevent — like Galegos's 623-line `menu.ts`.

### The decision: typed data in the repository, validated at build time

`site` preset: the content lives in `conteudo/*.json`, with a schema that **fails the build**
if it diverges. No MD/MDX by default, no hosted CMS, no database.

And the part that is not obvious: **the business's identity — phone, trade name, CNPJ,
address — is validated CONTENT, not an environment variable.**

### Why an env var is the wrong answer, and the proof is the owner's own

There is an open PR in Galegos that tried exactly that, and it is parked on purpose.
`Navesz/Galegos#1`, branch `chore/contact-out-of-source`, in its body:

> *"would build a wa.me link with no recipient, so a live menu would silently stop
> delivering orders"*

Taking the phone number out of the code into an env var swapped **visible hardcode** for **invisible
failure in production**: the build passes, the deploy goes up, the menu opens, and the order button generates a link
with no recipient. Nobody sees it in code review. That is the worst possible trade, and the owner
worked it out on his own — which is why the PR did not merge.

The discriminator left over from the adversarial review has two axes, and the data only goes into the
repository if both are true:

1. **it renders on a public route** — if it appears on screen for any visitor, it is not a secret
2. **it is first-party data** — the company's own, not a third-party individual's

Galegos's WhatsApp: renders on every page, belongs to the company. **Content.** Whereas the name and
mobile number of an employee that leaked in `hug-brasil-propostas` fail axis 2 —
third party — and go in neither as content nor as an env var: they do not go in.

### What the measurement supports, and what it does NOT support

It supports: `Galegos/src/lib/menu.ts` has **623 lines** of catalog inside `src/`, and
0 of 4 sites use MD/MDX, and none pays a CMS vendor.

**It does not support** the idea that changing a price is the bottleneck: of Galegos's 8 commits, 4 touch
`menu.ts` and **zero** touch only it. There is no pure-content commit. With 8 commits the
repository is too young to prove maintenance pain — and recording that matters more
than the convenience of having a number in favor.

The measured pain is another one, and it is literally the complaint: `src/lib/whatsapp.ts:7` has the number in
**two formats**, `src/lib/viacep.ts` has a production URL, and `process.env` appears **zero
times** in all of `src/`. It is not "where the text lives" — it is **configuration baked into the code**.

### What is missing for this decision to have teeth · STILL OPEN

Closing §12.3 in the text closes nothing. What was missing was the deterministic rule
**`conteudo-fora-do-codigo`**, with the two cases the mother rule demands: `aprovar/` is the generator's
output, `reprovar/` is that same output with a price and a sentence planted in a `.tsx`.
For as long as it did not exist, this was prose — which is exactly the defect the whole
repository exists to fight.

> ⚠️ **The rule exists and it is HEURISTIC. §12.3 is NOT closed.**
>
> It was born deterministic on 30/08 and was demoted on 31/08 by an adversarial audit.
> Three defects, all measured:
>
> - **Its proofs are decorative.** Of the 32 mutations applied to `index.mjs`, 16
>   survived — **nine of the 16 are in this rule**. Deleting the digit requirement from the price
>   pattern, dropping the sentence minimum from 25 to 1 character, and turning off the code-signal
>   filter: all three leave the suite 2 of 2 green. `aprovar/` does not even contain `R$`, so the
>   discrimination the `caso.json` claims to exercise is not exercised.
> - **It accuses interface vocabulary**, which is what its own comment promises to leave
>   out: 27 of the 185 sentences (15%) are an action label or an empty/loading/error state.
>   *"Não deu para abrir o cofre."* [Could not open the vault.] does not go into `conteudo/*.json`.
> - **17 of the 185 are a fragment, not a literal.** The match cuts at the first `<`, so a
>   sentence crossed by a `<strong>` turns into two or three findings.
>
> The deterministic version has to go up **before the generator exists** — it is the generator's output
> that it exists to watch. While it is heuristic, this decision is taken in the text and has no
> teeth in the code.

**The rule exists**, in `ferramental/rebar-check/index.mjs`, heuristic today, with the two
cases in `provas/casos/conteudo-fora-do-codigo/` and a third pair for the N/A branches in
`conteudo-fora-do-codigo__nao-adotou/`. The generator does not exist yet, so `aprovar/` was
written by hand in the shape decided here: `conteudo/inicio.json` with the text and the price in
cents, and an `app/pagina.tsx` that only READS that file.

Two measured things the decision has to carry along with it:

**1. The definition of "content literal" is narrow on purpose, and even narrow it
accuses everyone.** It recognizes two shapes — `R$` followed by a digit, and a JSX text
node with four words or more —, chosen for being impossible to confuse with
`className`, `import`, `aria-label` or an object key. Measured on 30/08 against the 11
repositories on the machine, **without** the applicability gate, it finds **188 literals in 45
files across 7 repositories** (the sum 147+13+12+9+3+3+1 closes at seven; `alicerce`,
`navesz.github.io`, `openkartline` and `VectraB-Lab` give zero), of which **147 in `decima-edicoes` alone, in 15 of its 25
files** — then `ducado` 13, `hug-brasil-propostas` 12, `vectra-painel` 9, `Galegos` 3,
`prumo` 3 and `LinhaK` 1. **This line's original claim — "nenhum dos 188 é falso" [none of the 188 is false] —
does not hold**, and the audit knocked it down by classifying the 185 sentences one by one: 27 are
interface vocabulary, which is the fifth category the definition itself promises to exclude.
The part that stands is real and worth recording: there is not a single string from `className`,
`import`, `aria-label` or an object key — excluding attributes by construction of the
JSX works. What the table proves is that **every hand-written site
violates this assertion**, and therefore the assertion cannot be charged against whoever did not
promise to meet it.

**2. Hence the gate: the rule only applies to whoever has `conteudo/*.json` tracked.** Same
shape as `notice` (it only charges a NOTICE against whoever chose Apache) and `ui-falso` (it only charges
`components.json` against whoever created `components/ui/`). With the gate, the 11 measured repositories
come out N/A with the reason printed, and the generator's output is charged in full.

**3. The inversion the measurement revealed, and that is worth recording against §12.3 itself.**
`Galegos` — the repository this section cites as the worst case, with the 623 lines of
`menu.ts` — gives only **3** literals under this definition, against 147 from `decima-edicoes`, and the
only one that touches `menu.ts` is a **price** (`src/lib/menu.ts:590`, `"+ R$ 4,00 para trocar o
refri por Coca lata."` [+ R$ 4.00 to swap the soda for a can of Coke.] — the source literal stays in
Portuguese because it is measured data from a third-party repository). The reason is that Galegos's
content lives in a DATA `.ts`, not in JSX. The definition measures "prose rendered inside a
component", which is not the same as "content inside `src/`". Detecting a catalog in a `.ts` object
literal is the hole that is left over, and it stays open on purpose: any pattern that catches it also
catches every constants table of every project, and a broad rule burns the tool.

What §12.3 also gained in teeth in the same pass: the `telefone` rule went up from
heuristic to **deterministic**, with 1 true and 0 false across 417 measured code
files. Galegos's number, which this section cites as the original pain, now fails merges.

### CMS: emitted and disconnected

The generator emits `.pages.yml` (Pages CMS, MIT) **always, and disconnected**. It is ~40 lines of
YAML that turn "connect an editor" into a five-minute decision instead of a
refactor. Connecting requires giving **write access** to the repository to a hosted third-party
service — decision taken on 31/08: **do not connect now.**

## 12.4 Three levels inherited wrong, violating the mother rule

| Line | Level in the panel | Should be | How |
|---|---|---|---|
| Query builder over an ORM (Kysely) | **N7** | **N1** | "Do not import an ORM" is a forbidden import. One line of depcruise |
| Component library, one only | **N6/N7** | **N1** | Forbid `@radix-ui/*`, `@mui/*`. One line |
| Every data component has 4 states | **N3/N6** | **N0** | Discriminated union + exhaustive `switch`. It **does not compile** without handling loading/empty/error/data |

In a document whose thesis is *"se pode descer, deve descer"* [if it can go down, it must go down], inheriting these three without correcting them is the most direct contradiction possible.

## 12.5 Other corrections

| # | Error | Correction |
|---|---|---|
| 1 | **Contradictory money.** §5 Axis 1 says *"integer in cents"*; §8.3 takes *"decimal string"* from herz | I wrote both without noticing. Same class as Radix/Base UI, and this one I did not catch |
| 2 | **`verificar.mjs` in two opposite lists** — §8.1 "as it is" and §8.2 "fix while porting" | It is take **and** fix |
| 3 | **Accessibility appears 2× in the panel** — lines 119 and 181 | They are **119 distinct decisions**, not 120. I corrected 117→120 and counted table rows, not decisions |
| 4 | **CSRF absent from the whole panel** | There is CORS, there is CSP, there is no CSRF |
| 5 | **Per-task token telemetry at N4** | No CI job measures cost per task. It is N6/N7 labeled N4 |
| 6 | **The context metric measures the wrong thing** | "< 200 lines" counts the always-present file. Herz passes with 153 lines **and serves 1961 lines of guide by MCP in the same session**. The right target is the resumption bundle in tokens, which `contexto/ai.mjs orcamento` already measures |
| 7 | **`shadcn add` writes into a zone with no rule** | `web-camadas.cjs` excludes `^src/components/ui/` from the analysis. And the proof that the update comes back wrong is already in the doc: `components.json` says `neutral`, the CSS is zinc |
| 8 | **`.ai/gerar.mjs` is the inverse pipeline** | In herz it distills prose → 3 copies. Rebar wants structured answers → prose. Reuse only the "N synchronized copies + `--verificar`" |
| 9 | **§8 step 1 designs the schema of a single preset** | Carve out the core **before** the vertical slice, otherwise the core is born crooked — the same error as M8 |

## 12.6 The collapse: 120 → ~71 decisions

Sixteen groups where separate lines are **the same decision**. The four of highest value:

| Group | Absorbs | Becomes |
|---|---|---|
| **Boundary** | Layers · tooling · cycle · orphan · data by prop · third party not edited · monorepo · zero-Node in the contract · pure business · static | **10 → 1.** They are not 10 decisions: it is 1 ("which boundary preset") with 10 rules inside. The alicerce already ships it as 15 presets + 29 fixtures |
| **Personal-field map** | Inventory · does not go into logs · retention · soft delete · audit **+ the 9 missing legal items** | **14 → 1.** One typed artifact marking every field. From it derive the masker (N1), the purge job (N3), the export endpoint (**N0 — it does not compile if a new field was not classified**) and **the generated privacy policy**. The "bigger hole" becomes mechanical |
| **Route metadata** | None today — it absorbs `<title>` · description · `og:image` · canonical · sitemap · `robots.txt` · JSON-LD · 404 · `hreflang` | **9 new → 1.** **N0**: the route type requires `meta`. Sitemap and robots become **generated, not decided** |
| **Third-party origin** | CORS/CSP + analytics · consent · font by CDN · video · map | **6 → 1.** The CSP and the cookie banner are **the same allowlist seen from two angles** |

The other twelve: design token · one schema per boundary · the effect happens once · time/random injected · declared escape · one command · context invoice · locale · transaction · migration · data state · CI security surface.

## 12.7 The preset cut, in numbers

| Preset | Of the current 120, how many apply | Exclusive today |
|---|---|---|
| `app` | **118** (98%) | 2 |
| `api` | **105** (88%) | 2 |
| `site` | **77** (64%) | **0** |

Axes 8 and 9 are **100% core** — 23 identical lines in every preset. The whole of axis 7 is N/A for `api`.

> **`site` is the worst-served preset, and it is the one the owner builds.** 36% of the panel does not apply and **nothing** takes its place: zero exclusive lines out of 120. It is §2.3 measured in numbers.

After the collapse and the gaps: `site` ≈ 68 · `app` ≈ 82 · `api` ≈ 64 — and `site` comes to have the second-largest exclusive set (~26).

## 12.8 What is missing and is 🔴

Besides the two from §12.2 and §12.3: rendering strategy · content origin · where it is hosted · end-user authentication method · payment processor · **scaffold drift** (the generated project knows which version of rebar it was born from, and `rebar doctor` fails if it diverges).

---

# 13. Open

| Item | State |
|---|---|
| Reviewer: completeness and what fits with what | Agent running |
| Reviewer: enforcement rigor and escape routes | Agent running |
| Reviewer: scope realism and sequence | Agent running |
| Cut of the 120 decisions across `site` / `app` / `api` | Not done |
| Neutral names for the five color families | Not decided |
| WCAG level to adopt as the house default | Not decided |
| Write the ~18 forensic checks as rules with two cases each | Not done — depends on the scope reviewer |
