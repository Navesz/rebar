# Stack v1.2

> **The Postgres version.** A file separate from [PLANO.md](./PLANO.md).
> **State:** reviewed · 25/08/2026
>
> **Versioning.** MAJOR goes up when a closed decision is reverted or swapped;
> MINOR when a new decision enters or a hole is closed. Every change enters the
> history below — a document without history has no way to prove it did not drift.
>
---

## History

| Version | What changed |
|---|---|
| **1.2** | **Idempotency:** `409 never replay` was an overcorrection — they are two states, with a **recheck** after the lock. **Advisory lock** in the `(int4,int4)` namespace, separate from the migration lock in `bigint`. **DoS:** three ceilings, not one — the pool queue fills up too. **`version`** gets a trigger, otherwise it depends on memory. **The outcome** separates `commandStatus` from `effectStatus`. **TTL** with a long-retention tombstone |
| 1.1 | Review by six agents: 89 findings, 19 critical. **Outbox** resent on every tick (the `SELECT` did not read the lease) and TX 2 did not validate ownership. **Duplicate-in-flight** had three simultaneous answers and the test approved the rejected architecture. **`RESET ROLE`**: the quotation elided the clause that decides the case, and two vectors were missing. **Money**: `numeric[]` and `binary:true`. The oRPC **CSRF** described wrong |
| 1.0 | First version that survived adversarial review. Eight rounds, summarized below |
| 0.8 | **Pool:** a bounded wait in HTTP did not reach the block on the unique index → `pg_try_advisory_xact_lock` fail-fast. **Replay:** a versioned envelope was `unknown` in disguise → stable outcome separated from the typed result. **Extensions:** rule made precise for *trusted* + non-superuser |
| 0.7 | **Idempotency:** version in the scope caused double charging on deploy → key stable across versions. `pgcrypto` removed. `SECURITY DEFINER` with `search_path`. `409` decided |
| 0.6 | Internal contradiction: `ALTER ROLE … SET role` invalidated the hostile test itself → removed. `PUBLIC` audited. Effective privilege via `pg_has_role` |
| 0.5 | **Three identities** — `RESET ROLE` gave superuser back. `INHERIT FALSE` makes the escape hatch reduce privilege |
| 0.4 | `pipeline` does not remove ordering; the problem is the absence of an acquisition barrier. Owning-layer principle |
| 0.3 | `onConnect` in place of `pool.on('connect')`. Unified invariant idempotency + outbox |
| 0.2 | TanStack Start is RC, not GA. Double linter. Three rule classes. `@expect-rule` |
| 0.1 | Pivot from `herz/planejamento/Stack.md` v4.3, SQL Server → Postgres |

**Origin.** Pivoted from `herz/planejamento/Stack.md` (788 lines, v4.3), the best piece of architecture in the collection — written for **SQL Server on Windows Server**. Swapping the database reopened concurrency, migrations, types and async.

**Precedence.** The 13 ADRs of `prumo` (24/08) solve part of this, and better. Where there is an ADR, **the ADR wins** — it is applied, and herz never got as far as building the backend. Where the ADR fell behind `package.json`, **the code wins**.

---

## O critério único <!-- Portuguese on purpose: this heading is matched verbatim by mcp/generate.mjs (the `stack-postgres` reference anchor). Translate it and the generation finds nothing and exits 2. -->

Inherited from herz, and it still holds:

> **Qual opção faz com que código gerado errado *pareça* errado?** [Which option makes wrongly generated code *look* wrong?]

Refined on 21/08: *the abstraction must reduce the error space without hiding an invariant or an important effect.* That is what knocked down Prisma, NestJS and the contract-generation pipeline.

Second criterion, subordinate: *does this solve a problem that exists today, or one I imagine having later?*

## The three principles

They came out of six rounds of adversarial review. The last two were born from mistakes made **in this document**.

**1 · Go down a level, with one condition.**

> If a rule can descend from prose to enforcement, it must descend — **but the enforcement needs to be more reliable than the rule it replaces.**

The first half alone produces idiot CI. The second alone produces paralysis. Together they describe the only path that works.

**2 · Nothing important lives only in text.**

> Any rule too important for the AI to forget is too important to exist only as text.

It is not intuition — it is measurement. Across the six real repositories, the **three without CI are exactly the three with broken lint**. And the repository with the most governance documents — `AGENTS.md` with "Hard rules", `SECURITY.md`, `GOVERNANCE.md`, prettier and a `check` script chaining everything — piled up **35 lint errors**, because nothing ever runs that `check`.

**3 · Provenance belongs to the layer, not to the source.**

> A verifiable claim needs a primary source **from the layer responsible for the property claimed.** Do not skip a layer.

| Property | Who owns it |
|---|---|
| MVCC, isolation, `SKIP LOCKED` | PostgreSQL |
| Sync per query, error boundary, `onConnect` | node-postgres |
| Serialization, status map | oRPC |
| Generated SQL | Kysely |
| Link preview does not execute JS | crawler / OG specification |

This principle exists because the review of this document produced a plausible conclusion, backed by official PostgreSQL documentation — and **wrong**, because the property claimed belonged to node-postgres, which implements the protocol on its own and chose Sync per query. The source was primary; it was primary for the wrong abstraction.

**Practical consequence:** in an ADR, the citation names **the component**, not just the URL. Mandatory format:

```
Claim:        RESET ROLE does not elevate privilege
Owner:        PostgreSQL
Evidence:     sql-set-role · ddl-priv
Assumptions:  session_user = app_login
              app_login has no SET to db_owner
              app_login does not inherit app  (INHERIT FALSE)
              PUBLIC offers no privileged path
```

**Every line of `Assumptions` has to be individually testable, and becomes an assertion in the fitness test.** The four above become `session_user`, `pg_has_role(…,'SET')`, `pg_has_role(…,'USAGE')` and the `PUBLIC` scan. **`Claim` and `Assumptions` together produce a test obligation**: the Claim is the conclusion and is not testable alone; the Assumptions are testable but do not say what for. Together they become an executable specification.

It exists because, across these six rounds, **the failure was never in the claim — it was in the premise nobody wrote.** `RESET ROLE` is the pure case: *"SET ROLE restricts the current_user"* was true; *"and the session identity is not more privileged"* was never written nor checked.

---

## 1. What changes because of the database — the table you asked for

| Topic | SQL Server (herz) | Postgres | Impact |
|---|---|---|---|
| **License** | Paid | Free | **The reason for the switch** |
| Driver | `MssqlDialect` + `tedious` | `PostgresDialect` + `pg` **^8.23.0** | Direct swap — see §4.6 |
| **Optimistic concurrency** | `rowversion` — a binary column the engine increments by itself | **No equivalent exists.** See §4.1 | **Rewrite** |
| Reader does not block writer | `READ_COMMITTED_SNAPSHOT ON` | **MVCC is the default** | **Gone.** One config line less |
| Instant | `datetime2(3)` UTC | `timestamptz` | Swap, with a trap in §4.3 |
| Money | `decimal(19,4)` | `numeric` | See §4.4 — and the driver bug **flips sides** |
| Schema | `dbo.` | `public.` or a named schema | Cosmetic |
| Filtered index | `filtered index` | `partial index` | Same thing, better syntax |
| **Queue claim** | `WITH (UPDLOCK, READPAST)` | **`FOR UPDATE SKIP LOCKED`** | **Simplifies a lot.** §5.1 |
| Change notice | Polling only | **`LISTEN`/`NOTIFY`** | New — with a caveat in §5.2 |
| Row security | RLS exists, little used | **RLS + restricted role** | **Real gain.** §4.6 |
| Portuguese search | Heavy full-text | `unaccent` + `portuguese` dictionary | Gain |
| Deploy | Windows Server, IIS, ARR, WinSW | Container | The most fragile half of herz disappears |

**What is lost:** nothing herz was using. The backend was never built — there is no migration, only free decision.

---

## 2. Frontend — inherited from herz, which is real and works

These numbers are what is **installed**, not what the document claims.

| Role | Choice | Version |
|---|---|---|
| Framework | React | 19.2 |
| Build | Vite | 8.2 |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | 6.0 |
| Routes | TanStack Router, **code-based**, search validated by Zod | 1.170 |
| Data | TanStack Query | 5.101 |
| Table | TanStack Table | 8.21 |
| Style | Tailwind, CSS-first | 4.3 |
| Components | **shadcn/ui over `@base-ui/react`**, style `base-nova` | 1.6 |
| Icons | Lucide, single family | 1.28 |
| Form | react-hook-form + `@hookform/resolvers` + Zod | 7.83 |
| Toast | sonner | 2.0 |
| ⌘K palette | cmdk | 1.1 |
| Theme | next-themes, `attribute="class"` | 0.4 |
| Font | `@fontsource-variable/geist` — **self-host, never CDN** | 5.3 |

> ⚠️ **It is not Radix.** The alicerce panel says "shadcn/ui + Radix"; herz uses Base UI and Radix only enters transitively through `cmdk`. Reality beats the document.

**The animation comes for free** — `tw-animate-css` + Base UI data-attributes (`data-open`, `data-closed`, `data-starting-style`, `data-swiping`). Zero `@keyframes`, zero framer-motion.

**Fix when porting:** `components.json` says `baseColor: neutral` and the CSS is zinc — the next `shadcn add` reintroduces pure gray. Pin it to `zinc`.

---

## 3. Contract — oRPC, not ts-rest

> **A change relative to herz.** ADR 0011 of prumo, 24/08, supersedes the contract line.

`@orpc/contract` · `@orpc/server` · `@orpc/openapi` · `@orpc/client` · `@orpc/tanstack-query` — **1.15.0**.

It keeps everything ts-rest had been chosen for:

- **Contract-first.** One object in `packages/contract`; the server implements it with `implement(contract)` and the browser client is built from the same object. **Divergence is a compile error on both ends.**
- **Real HTTP semantics.** `ORPCError` carries `status`, the default map covers 400/401/403/404/409/422/429/503, and `status` is overridable — that is how a code outside the default map (402, for example) becomes possible.
- **OpenAPI generated FROM the contract**, never the other way around.
- Official Fastify adapter and official TanStack Query integration.
- `npm install` resolves with no peer conflict and no override.

**Why abandon ts-rest:** in herz, `validateResponse: true` is **silently ignored** when a custom `api` is passed — the validation had to be redone by hand in `cliente.ts:16-30`. herz never felt the rest of the problem because the backend never existed.

### Shared primitives

| Primitive | Form |
|---|---|
| Error | **Problem Details RFC 9457**, `type` stable and classifiable without reading the message |
| Idempotency | `commandId` UUID **generated by the client**, on every mutation — see §3.1 |
| Concurrency | `version` — see §4.1 |
| Instant | ISO 8601 **with offset**, always |
| Pagination/filter/ordering | A single primitive, shared |

**Zero Node dependency in the contract package** — otherwise the browser bundle breaks.

### 3.1 Idempotency — `commandId` alone is not idempotency

A field travelling on the wire does not stop the backend from processing twice. The invariant is in the database:

`UNIQUE (scope, commandId)` plus `requestHash`, `resultado` and `criadoEm` persisted.

| Situation | Result |
|---|---|
| Same `commandId`, same hash | **Replay** of the stored result |
| Same `commandId`, different hash | **Error** — it is another command with a reused id |
| Two concurrent, the first **in flight** | One executes; the second gets `409 IN_PROGRESS` and **does not wait** |
| The second arrives **after the commit** | **Replay** — the completed record exists |

> **The unified invariant.** Every idempotent mutation that produces an external effect persists **business state, idempotency record and outbox row in the same transaction.**

```
command arrives
     ↓
already completed?
 ┌───┴────┐
yes       no
 ↓        ↓
replay   BEGIN
         claim commandId
         change the domain
         write business state
         write outbox row
         write idempotency result
         COMMIT
```

**On replay: zero domain change and zero new outbox row.** Without that, the database idempotency exists and the external effect duplicates anyway — which is exactly what it was supposed to prevent.

**Mandatory integration test:** 500 concurrent requests, same `commandId`, same payload →

```
1 business mutation
1 outbox row
no duplicate execution
peak database connections ≤ declared limit     ← without this, the test approves a DoS
no duplicate waits holding a resource          ← the property, not the status count
peak pool.waitingCount ≤ declared limit
pending requests at the end = 0
```

> ⚠️ **An outbox row is not an external effect.** The outbox is **at-least-once by construction**: the worker sends, the recipient receives, the process dies before marking it delivered, and on restart it sends again.

| Layer | Guarantee |
|---|---|
| API retry | does **not** create a second outbox row |
| Outbox retry | **may** resend the same row |
| Consumer | **must** deduplicate by `outboxId` |

Only with the recipient's cooperation does the external effect come close to exactly-once. Where it does not cooperate, that becomes a conscious, written decision — never an assumption.

### Duplicate-in-flight — a decision, not a by-product of the test

`A` is executing; `B` arrives with the same `commandId`. Two valid semantics: **wait and replicate**, or answer `409`/`202 in progress` and let the client try again.

~~**Rejected candidate: wait and replicate.**~~ It looked like a simpler API for the agent and for the frontend.
**It was discarded** for the reason in the box below: the wait consumes a pool connection before any HTTP
timeout applies.

**Chosen: fail-fast.** The second request **does not wait** — it gives the connection back.

The order matters, and there are three steps, not one:

```
1. does a completed record exist?        → yes   → REPLAY
2. pg_try_advisory_xact_lock(…)          → false → 409 IN_PROGRESS, gives the connection back
3. got the lock                          → RECHECK — another may have committed between 1 and 2
                                         → executes only if it still does not exist
```

> ⚠️ **The recheck in step 3 is not optional.** Without it, two requests that pass step 1 before A's commit
> both execute — the lock serializes, it does not prevent.
>
> And **the acceptance criterion does not count statuses.** In a 500-concurrent test, scheduling makes some
> arrive after the commit and receive a replay legitimately. The property is *no duplicate waits holding a
> resource*, never *499 receive 409*.

> ⚠️ **The wait needs a ceiling.** 500 requests with the same `commandId`, the first one hanging for 25 s, all holding an HTTP connection and a pool connection: idempotency becomes a resource-exhaustion vector. In a stack for agents this is worse, because one wrong loop generates duplicates in volume.

> ⚠️ **A bounded wait in HTTP does not solve it.** Since the idempotency record, the mutation and the outbox go in the
> same transaction, the second `INSERT` of the same `commandId` **blocks on the unique index** waiting for the first
> transaction to finish. The connection is already consumed; an HTTP timeout does not give back a connection the
> Postgres is holding. With 500 duplicates: 1 working, **499 pool connections stopped.**

**The invariant:** duplicate-in-flight **never waits indefinitely — not in PostgreSQL, not in the pool, not at the
HTTP edge.** Limiting only the database leaves 490 requests in the pool queue: with `max: 10`, ten take a client and
the rest go to `pg-pool`'s `pending queue`. There are three ceilings, and all three need to exist:

```
HTTP concurrency budget
        ↓
application queue ceiling
        ↓
pool max + connectionTimeoutMillis     ← without the timeout, the queue has no timer
        ↓
pg_try_advisory_xact_lock             ← only this one protects the database
```

```
A  →  pg_try_advisory_xact_lock(NS_IDEMPOTENCIA, hash32(scope, commandId))  →  true   →  executes
B  →  same key                                            →  false  →  gives the connection back
                                                              →  409 · Retry-After
```

Doc: *"either obtain the lock immediately and return `true`, or **return `false` without waiting**"*.

Three premises that need to be written down, because each one fails silently:

1. **The `_xact_` variant, mandatorily.** The session one would leak between requests on the pool's reused connection.
   And the property that holds the design up is stronger than "same instant": in `CommitTransaction()` the order is
   `RecordTransactionCommit()` → `ProcArrayEndTransaction()` → `ResourceOwnerRelease(RESOURCE_RELEASE_LOCKS)`.
   **The commit state is published before the transaction locks are released** — so, when B acquires the lock
   A dropped, A has already left the proc array. *(Owning layer: PostgreSQL, `xact.c`.)*
2. **The lock comes before the `INSERT`**, keyed on the same scope as the unique index. Out of order, B still blocks.
3. **The two-`int4` form, never the `bigint` one.** PostgreSQL keeps **two lock spaces that do not
   overlap**: `(bigint)` and `(int4, int4)`. **Two** infrastructure locks already occupy the first:

   | Who | Key | Where |
   |---|---|---|
   | Project migrations | `8_140_772_301` | `migrate.ts:43,53,58,81` — *"Any other process using this same key would be a bug"* |
   | **Kysely's internal lock** | `3853314791062309107` | `kysely/dist/dialect/postgres/postgres-adapter.js:4` |

   If idempotency hashes into `bigint`, a command can collide with **either of the two** and jam a
   deploy. Using `pg_try_advisory_xact_lock(NS_IDEMPOTENCIA, hash32(…))` turns
   improbability into **structural impossibility between lock classes**.
4. **Collision inside the namespace is acceptable.** Two commands can hash the same; the cost is a spurious `409`.
   **Correctness stays in the unique index** — the lock is only the fast path. Whoever does not know this will
   "fix" the collision by removing the lock, and the pool hole comes back. Recorded here as a decision — a test that decides architecture without the document noticing is the class of thing this Stack exists to prevent.

### 3.2 The hash — canonicalization defined by the contract

`{"a":1,"b":2}` and `{"b":2,"a":1}` are the same request and produce different text hashes. But the fix is not to sort keys by hand:

```
contract parse
  ↓
semantic normalization  ← NFC only where the contract declares it
  ↓
JSON-safe projection
  ↓
RFC 8785 (JCS)
  ↓
hash
```

> ⚠️ **RFC 8785 does not normalize Unicode** — it preserves the strings. `é` as `U+00E9` and `e` + combining accent are visually identical, byte-distinct, and generate different hashes. NFC goes **before** the JCS, and **not on everything**: a file name, a cryptographic key and an external identifier can depend on the exact bytes. The contract marks which fields have human-text semantics.

Two reasons for each stage:

1. **After the parse, not before.** What decides whether `{"quantidade":1}` and `{"quantidade":1,"campoIgnorado":"x"}` are the same command is the **schema**, not the hash. If the contract does `strip`, the two are identical.
2. **JSON-safe projection before the JCS.** Zod returns a JavaScript object, which carries `undefined`, `Date`, `bigint`, `NaN` and `Infinity` — none of that exists in the JSON model RFC 8785 operates on.

**And the contract explicitly declares what enters the command's identity.** `correlationId`, `clientTimestamp` and trace metadata are valid in the request and do **not** make the command different. A hash over the whole payload turns two retries with distinct traces into distinct commands, and idempotency stops existing.

So: `idempotencyPayload(input)` as an **explicit projection**, versioned alongside the contract and tested. Never the whole payload, never home-made canonicalization.

> **Idempotency has to survive deploys.** If a version change can convert a retry into a new
> execution, the key is not identifying the **command** — it is identifying the **implementation that processed it**.

`UNIQUE (scope, commandId)` **stable across versions**. The version is an **attribute of the record**, never part of the key.

| Situation | Behavior |
|---|---|
| Same version · same hash | **Replay** |
| Same version · different hash | **Error** — key reused |
| **Different version** | **Never executes.** Historical replay, or an explicit `version_mismatch` |

Whoever really wants a new operation in `v2` **generates a new `commandId`**.

> ⚠️ **The case that almost passed.** Version in the scope *looks* right and creates double charging:
> `charge/v1/ABC` executes at 10:00, the response is lost, the deploy goes out, the retry at 10:05 becomes `charge/v2/ABC`,
> finds no record and **charges again** — at the exact moment when responses are most often lost.
>
> It only works if `operationVersion` is a **client field**, immutable and carried on every retry, **declared in the
> contract**. Never inferred from the version of the server that is running.

### TTL — part of the contract, not housekeeping

`UNIQUE (scope, commandId)` forever makes the table grow without bound. And the naive fix creates the worst bug
possible:

```
DELETE FROM comandos WHERE criado_em < now() - interval '30 days';
        ↓
old retry arrives  →  does not find the commandId  →  EXECUTES AGAIN
```

Two retentions, not one:

| What | Retention |
|---|---|
| **Detailed result** (payload, hash, response) | Short TTL — it is what weighs |
| **Tombstone**: `scope` · `commandId` · `commandStatus` · `completedAt` | Very long, or permanent for a sensitive operation |

Deleting the payload is housekeeping. Deleting the tombstone is **reopening the double-execution window**, and the
tombstone's TTL has to be longer than any retry the client can emit.

### The cross-version replay — stable outcome, not typed result

> **`version` as a discriminator only works if the contract contains the schemas it can select.**
> Without that, it is `result: unknown` with a pretty name — a type hole exactly in the idempotency.

Two separate things:

| | Stable across versions? | Content |
|---|---|---|
| **Idempotent outcome** | **Yes** | `commandId` · `commandStatus` · `effectStatus` · `outboxId` · `operationVersion` · `resourceId?` · `completedAt` |
| **Operation result** | No — typed per version | The response object of that version |

- **Same version** → stable outcome **plus** the original typed result.
- **Cross-version** → **only the stable outcome.** Enough to say *"it already executed, do not execute it again"*. Whoever
  needs the current state **fetches the resource** in its current shape — there is never a translation of a historical shape.

> ⚠️ **`commandStatus` is not `effectStatus`.** The business transaction commits **before** the external effect is
> delivered — that is the whole premise of the outbox. An outcome that says only `status: completed` makes the client read
> *"the charge went out"* when what completed was the local commit, and the webhook may be in the dead-letter queue.
>
> `commandStatus: committed` · `effectStatus: pending | delivered | dead` · `outboxId`. `resourceId` remains
> useful where it exists, but **it is not a universal base of the contract**.

**Why this matters.** A `commandId` survives a deploy; the normalization does not. If `v1` has `quantity` defaulting to `1` and `v2` has `10`, the same raw payload produces different hashes — and in a long idempotency window that becomes a false conflict or an undue replay. Persisted alongside: `operation`, `idempotencySchemaVersion`, `requestHash`. Hash comparison only holds **within the same version**; a different version is handled explicitly, never compared blindly.

---

## 4. Database — PostgreSQL 17

> ADR 0005 of prumo. **`pgcrypto` goes out** — its own doc calls its `gen_random_uuid()`
> *"Obsolete, this function internally calls the core function of the same name"*. One extension less
> is a whole set of functions off the ACL surface. `citext` for e-mail stays.
> Kysely **^0.29.5** + `pg` **^8.23.0** — ADR 0005 says "0.28 / 8.13" and fell behind
> `package.json`; the code wins. **One pool, one transaction API, one `UnitOfWork`** as
> the only place a transaction opens.
>
> **There is no SQLite path.** Not "later", not "for testing", not "for single-user
> mode". SQLite has no row lock to skip, no `LISTEN`/`NOTIFY`,
> no RLS, no `jsonb` operator and no partial index over an expression. A SQLite
> mode would be a second implementation of the concurrency design — and the concurrency
> design is the product.

### 4.1 Optimistic concurrency — the real rewrite

SQL Server's `rowversion` is an 8-byte binary column that **the engine increments by itself** on every `UPDATE`. Postgres does not have that.

Three candidates, and only one is any good:

| Option | Verdict |
|---|---|
| `xmin` (system column) | **No.** It is the transaction id; it wraps around and changes on `VACUUM FULL`. Using it as a concurrency token is a bug waiting for its date |
| `updated_at timestamptz` | **No.** Two writes in the same microsecond collide silently |
| **Explicit `version bigint` column** | **Yes.** Incremented in the conditional `UPDATE` itself |

```sql
UPDATE pedido
   SET estado = $1, version = version + 1
 WHERE id = $2 AND version = $3
RETURNING version;
```

Zero rows affected = conflict = **`409`, never an automatic retry**. That part is inherited intact from herz and is still right.

> ⚠️ **The increment cannot depend on memory.** The `SET version = version + 1` protects *that* UPDATE. An
> agent writes `UPDATE pedido SET estado = 'cancelado' WHERE id = $1` and the whole protection dies **with no error**
> — exactly what the first principle forbids.
>
> That is why the increment becomes a **`BEFORE UPDATE` trigger**: `NEW.version := OLD.version + 1`. The
> `WHERE version = $token` remains the optimistic barrier, but incrementing stops being something to remember and
> becomes a property of the table. Deterministic rule: **a table with a `version` column and no trigger fails.**

Exposed in the contract as an **opaque, branded** value — the client returns what it received, never builds it and never compares it.

### 4.2 What disappears

`READ_COMMITTED_SNAPSHOT ON` was half the slowness symptom of herz's old system. **In Postgres MVCC is the default**: a reader never blocks a writer. One decision less, with no trade-off.

### 4.3 Time

`timestamptz` always — **never `timestamp`**. Postgres stores in UTC internally and converts on display according to the session's `TimeZone`.

- `SET TimeZone = 'UTC'` at boot, verified by a test.
- The **display** time zone is an interface decision, not a database one.
- Injectable clock in the domain; `Date.now()` forbidden outside `relogio.ts`.

### 4.4 Money — and the driver bug flips sides

In herz there was a real trap: **`tedious` returns `decimal` as a JavaScript `number` by default**, and the precision SQL Server stored is lost at the driver boundary, silently.

**`pg` does the opposite: it returns `numeric` as a string by default.** It is the safe behavior, and it is a net gain.

**But the gain holds only for the scalar, and only in the text protocol.** Four traps, all with a test:

1. `pg` returns **`bigint` (`int8`) as a string**. Expecting `number` breaks.
2. `pg` returns `float8` as `number` — never a float on the money path.
3. **`numeric[]` comes back as `number[]`.** OID 1231 has a registered parser, and it is `parseFloatArray` — every
   element goes through `parseFloat`. An `array_agg(valor)` loses precision **silently**. Aggregate as
   `text[]` or a `jsonb` of strings.
4. **`binary: true` on the Pool reverts the scalar.** OID 1700 has a binary parser that ends in
   `Math.round(result * scale) / scale`. The flag is forbidden on the money path, and that goes into a test.

> A boundary test that covers only `SELECT valor` passes the driver and lets `array_agg` through. The test asserts
> `typeof` over a **real row**, with an aggregate.

**Rule:** no float at any point of the money path — not in the domain, not in a `jsonb` payload, not in a chart.

> ⬜ **To decide:** storage unit. The alicerce panel says *"inteiro em centavos"* [integer in cents]; herz uses a *decimal string*; ADR 0003 of prumo chooses **integer in nano-USD**, because in API pricing there are US$ 0.0005 values that truncate to zero in cents. For a generic site or app, cents is enough. **The preset decides, and the decision becomes a profile field.**

### 4.5 Migrations

- **Kysely + `kysely-ctl`.** A TS module exporting `up`/`down`, with explicit SQL inside.
- Name `YYYYMMDDHHMM_descricao.ts` — loose numbering breaks at the tenth.
- **They run at boot, under an advisory lock** (ADR 0005) — two instances coming up together do not corrupt anything.
- **An existing migration is never edited.** Always a new one.
- `kysely-codegen` runs against a database **rebuilt by the migrations in CI**, never against production. Production is *compared* against git, never used to redefine it.

### Reversibility — and why a lossless `down` is fiction

Requiring **every** migration to revert without loss forces the agent to fabricate a feeling of reversibility. `DROP COLUMN cpf` does not revert. The real policy:

| Type | Rule |
|---|---|
| Reversible | **Test the `down`** — up, down, up with a seeded row, assert zero loss |
| Destructive | **Forward-only**, with expand/contract |

### Two different things that usually turn into synonyms

**Forward-only is a migration strategy. Expand/contract is a version-compatibility strategy.** The advisory lock prevents two simultaneous migrations; it does **not** solve `N` and `N+1` coexisting during a rolling deploy.

```
Migration A — EXPAND
  adds new structure, compatible with the old version
        ↓
  App N and N+1 coexist
        ↓
  backfill
        ↓
  App N disappears
        ↓
Migration B — CONTRACT
  removes the old structure
```

- **Migration test with existing data** — the alicerce itself calls it *"a verificação mais esquecida do catálogo"* [the most forgotten check in the catalog].

### 4.6 Privilege — the gain SQL Server did not give for free

> ADR 0013 of prumo, and it is the strongest part of the design.

### Three identities, not two — and the why

> **The rule:** the runtime never authenticates with a credential of privilege higher than `app`.
> **`RESET ROLE` must reduce privilege, or at worst keep it — never elevate it.**

`SET ROLE` reduces the `current_user`. **It does not erase the identity that opened the session.** And the PostgreSQL documentation is explicit on the two points that close the case:

> *"`RESET ROLE` sets the current user identifier to the **connection-time setting** specified by the
> command-line options, `ALTER ROLE`, or `ALTER DATABASE`, if any such settings exist. **Otherwise**,
> `RESET ROLE` sets the current user identifier to the current session user identifier."*
>
> ⚠️ **The first clause decides the case, and it came elided.** The whole architecture depends on there being **no**
> connection-time setting for `role`. There are three vectors, and only one goes through `ALTER ROLE`:
>
> | Vector | Where it lives |
> |---|---|
> | `ALTER ROLE app_login SET role = app` | SQL — already forbidden below |
> | `ALTER DATABASE <db> SET role = app` | SQL — **was not covered** |
> | `options=-c role=app` in the connection string, or `PGOPTIONS` | **deploy configuration, no SQL at all** |
>
> The third is the dangerous one: it is what someone adds to "solve" a permission error without touching SQL,
> and the hostile test stays **green**.
> *"These forms can be executed by **any user**."*

`RESET ROLE` **is not privileged**. Any code with raw SQL emits that — and an agent trying to solve a permission error writes exactly this.

**The defect measured in `prumo`, today:** `DATABASE_URL=postgres://prumo:…`, and `POSTGRES_USER: prumo` is the **cluster superuser**. Both pools — migration and application — use the same string. So `session_user = prumo` (superuser) and `current_user = prumo_app`. A `RESET ROLE` gives superuser back, with RLS bypassed and DDL available. The test asserts only `current_user`.

| Identity | Configuration | Role |
|---|---|---|
| `db_owner` | owner of the schema | migrations, **never** used by the runtime |
| `app` | `NOLOGIN` · `NOSUPERUSER` · `NOBYPASSRLS` · `NOCREATEDB` · `NOCREATEROLE` | DML. No DDL |
| `app_login` | `LOGIN` · **`NOINHERIT`** · zero **application** privilege | only good for authenticating |

```sql
GRANT app TO app_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;  -- PostgreSQL 16+
```

> ⚠️ **Do not use `ALTER ROLE app_login SET role = app`.** It looks like reinforcement and is the opposite: `RESET ROLE` would then land on `app`, which **does** have the DML — and the hostile test below would stop making sense. The two architectures are valid in isolation and **do not mix**. The one that fails closed was chosen.

**`INHERIT FALSE` is the piece that makes it work.** With `INHERIT TRUE`, `app_login` would have `app`'s privileges automatically and `RESET ROLE` would leave it with the DML. With `INHERIT FALSE`, it has nothing until it does an explicit `SET ROLE`:

```
normal state      session_user = app_login    current_user = app
RESET ROLE    →   current_user = app_login    →  fail closed
```

The escape hatch **reduces** privilege. Better than trying to prevent `RESET ROLE`, because it does not depend on preventing anything.

### `PUBLIC` — the privilege nobody granted

`app_login` **never had zero privilege**. The PostgreSQL doc (`ddl-priv`):

> *"`CONNECT` and `TEMPORARY` privileges for databases; `EXECUTE` privilege for **functions and procedures**; and `USAGE` privilege for languages and data types."*

The escalation path is `SECURITY DEFINER`: a function created by the owner, `EXECUTE` to `PUBLIC` by default, **runs with the owner's privileges**. An `app_login` with no DML calls it.

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE db_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE TEMP ON DATABASE <db> FROM PUBLIC;   -- if temporary tables are not used
```

Two practical traps:

- **`ALTER DEFAULT PRIVILEGES` only affects the future.** A function that already exists needs an explicit `REVOKE`. The doc recommends the revoke **in the same transaction that creates the object**, "so that there is no window".
- **The extensions break on day 1.** `citext` creates functions with `EXECUTE` to `PUBLIC`; revoking in bulk takes away `citext_eq`, `citext_cmp` and the comparison operators — and case-insensitive e-mail equality stops working. *(`gen_random_uuid()` does **not** serve as an example: it is a core function in `pg_catalog`, not created by `db_owner`, therefore immune to `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner`.)* The revoke comes together with an explicit `GRANT EXECUTE` to `app` on the short list of what it uses — which is good, it becomes a versioned list, but if it is not foreseen the first deploy breaks and someone reverts the whole hardening out of haste.

### Extensions — `ALTER DEFAULT PRIVILEGES` does not reach

`CREATE EXTENSION` doc:

> *"the extension object itself will be owned by the calling user, but **the contained objects will be owned
> by the bootstrap superuser** (unless the extension's script explicitly assigns them to the calling user)."*

It holds for a ***trusted* extension installed by a *non-superuser* role** — not for every extension. Normally whoever
runs `CREATE EXTENSION` becomes the owner. But `citext` **is trusted** (*"can be installed by non-superusers who have
`CREATE` privilege"*), so the case hits us.

The audit is mandatory in **both** configurations, for opposite reasons:

| Who installs | Owner of the objects | Problem |
|---|---|---|
| Superuser (today's compose) | the superuser itself | superuser-object ACL, with `PUBLIC EXECUTE` |
| non-superuser `db_owner` (the target) | **bootstrap superuser** | `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner` does not reach |

So: **enumerate the ACL after `CREATE EXTENSION` and after every upgrade**, comparing against a whitelist.
Fitness test, not a migration line.

### `SECURITY DEFINER` — deterministic rule

Revoking `EXECUTE` is not enough. Four conditions, all verifiable by catalog, **deterministic** class
(born `error`):

```
safe search_path declared, with pg_temp last
PUBLIC without EXECUTE
explicit owner
grant in whitelist
```

### The hostile test — catalog **and** execution

Checking `current_user` proves the configuration was applied. Only the hostile test proves that **the escape hatch does not work**.

```sql
-- catalog: effective capability, not attribute
pg_has_role('app_login', 'db_owner', 'SET')                   → false
pg_has_role('app_login', 'app',      'USAGE')                 → false  -- INHERIT FALSE
pg_has_role('app_login', 'app',      'SET')                   → true
has_table_privilege('app_login', 'public.pedido', 'SELECT')   → false
session_user = app_login · not superuser · not BYPASSRLS · not CREATEDB · not CREATEROLE
current_setting('role', true)  →  null or empty     ← otherwise the RESET lands on app

-- behavior: the escape hatch does not work
RESET ROLE  → protected SELECT → PERMISSION DENIED
SET ROLE db_owner              → PERMISSION DENIED
```

### Privileges of the `app` role

It gets `SELECT/INSERT/UPDATE/DELETE` on the tables and `USAGE, SELECT` on the sequences, plus `ALTER DEFAULT PRIVILEGES` to inherit them on future tables. **No DDL.**

### The acquisition barrier — `onConnect`, never `pool.on('connect')`

```ts
new Pool({
  onConnect: async (client) => {
    await client.query(`SET ROLE ${role}`)
    await client.query(`SET TIME ZONE 'UTC'`)
  },
})
```

> **The security does not depend on ordering, on a query queue, on pipelining, nor on error propagation between commands.** `onConnect` constitutes an **acquisition barrier**: the client only becomes acquirable after the privileged initialization completes **successfully**; if it fails, the connection is destroyed and the `acquire` rejects.

Confirmed in `pg-pool@3.14.0:288-301` — `_promiseTry(() => onConnect(client)).then(ok → _afterConnect, err → filters it out of the pool, client.end(), rejects the acquire)`.

**Why `pool.on('connect')` does not do the job**, even emitting `error` on failure: the client **has already been handed out**. Three things that do not hold the boundary up:

| Assumption | Reality |
|---|---|
| "The queue serializes, so `SET ROLE` runs first" | It runs — but `Client.queryQueue` is **deprecated with removal marked for `pg@9.0`**, and so is firing `client.query()` with another one running |
| "With `pipeline: true` the error aborts the following ones" | **False for this driver.** `pg` sends **Sync per query** (`lib/query.js:198-201`), so each one has its own error boundary: `SET ROLE` fails, `SELECT segredo` executes |
| "Order is enough" | Order was never the problem. The problem is the **absence of a barrier**: nothing prevents use before the initialization result is validated |

> ⚠️ **Type shim, temporary.** `@types/pg` 8.23.1 declares `onConnect?: ((client: ClientBase) => void)` — **without `Promise`** — while the node-postgres doc declares `(client: Client) => void | Promise<void>`. It works at runtime because `pg-pool` wraps it in `_promiseTry`, but the type does not express the contract. A local typed wrapper, marked as a shim, removed when `@types/pg` fixes it.

**Version:** `pg ^8.23.0`. `onConnect` landed in **8.20**; `8.19` deprecated the internal queue. The project's own sequence is *"stop doing this"* → *"do it this way"*.

### Pool separation

Migrations run as owner, in a **separate, short-lived pool**, closed before the application pool is born. The separation is a security boundary, not tidying up.

A test asserts `current_user`, `rolsuper`, `rolbypassrls` and `current_setting('TimeZone')` directly, before the application is considered healthy.

### 4.7 Types and invariants

- Discrete quantity: `integer`.
- Invariant in the database: `CHECK`, `FK`, `UNIQUE` — *"código é uma porta; banco é a última"* [code is one door; the database is the last].
- **Every FK indexed.** In herz's old system there was not a single index beyond the `UNIQUE` ones, and that is what made the dashboard quadratic.
- Partial and composite indexes as the model requires.

### 4.8 Portuguese — a decision the panel does not have

- **Collation.** `ORDER BY nome` with pt-BR accents and no correct ICU collation sorts wrong, silently. Declare it in `CREATE DATABASE` and verify it at boot.
- **Search:** `unaccent` + the `portuguese` dictionary for full-text.
- Encoding `UTF8`, verified at boot together with the collation.

---

## 5. Async

### 5.1 Outbox — and the simplification Postgres gives

Inherited, non-negotiable rule: **no external I/O inside a transaction.** An external effect becomes a row in the outbox, in the same commit; delivery comes later.

The queue claim, which on SQL Server required `WITH (UPDLOCK, READPAST)`:

```sql
-- TX 1: the claim. The predicate MUST read the lease.
SELECT id, payload
  FROM outbox
 WHERE entregue_em IS NULL
   AND tentar_apos <= now()
   AND (lease_until IS NULL OR lease_until <= now())   -- without this, a resend on every tick
   FOR UPDATE SKIP LOCKED
 LIMIT $1;

UPDATE outbox
   SET lease_until = clock_timestamp() + $2, lease_by = $3
 WHERE id = ANY($4);
COMMIT;
```

`FOR UPDATE SKIP LOCKED` is native, legible, and solves the atomic claim with no proprietary hint. **The most fragile part of herz's design becomes standard SQL.**

### The three phases, and why the diagram is mandatory

Showing the `SELECT ... FOR UPDATE SKIP LOCKED` and then "talking about delivery" invites exactly the mistake rule 1 forbids: an agent reads that and writes `BEGIN → take with lock → call API → mark delivered → COMMIT`, holding a transaction during external I/O.

```
TX 1
  claim the jobs
  SET lease_until
COMMIT

        ↓  NO TRANSACTION

  HTTP · e-mail · webhook

        ↓

TX 2
  UPDATE outbox SET entregue_em = now()
   WHERE id = $1 AND lease_by = $2 AND lease_until > now()
COMMIT
```

**claim → commit → I/O → acknowledge.** The diagram stays in the ADR in this almost visual form, because it is hard for
an agent to invent something else while looking at it.

> ⚠️ **Three things the naive design gets wrong, and all three are silent.**
>
> **1 · The lease has to be in the predicate.** After TX 1's COMMIT the `FOR UPDATE` lock dies, and
> `SKIP LOCKED` only skips a row locked by an **open** transaction. Without `AND (lease_until IS NULL OR
> lease_until <= now())`, the row satisfies the predicate again and comes out again **on every poller tick**
> while the I/O is in flight. That is not the declared at-least-once — it is N sends per second per worker.
>
> **2 · TX 2 validates ownership.** If the lease expired during the I/O, two workers write over each other —
> and a late `500` from W2 can send to the dead-letter queue a message W1 **delivered**. Zero rows
> affected means *"I lost the lease: I do not write, I do not increment the attempt, I only log"*.
>
> **3 · `now()` does not advance inside the transaction.** It is `transaction_timestamp()`. In a batch claim of 10
> with 5 s calls, the tenth item gets a lease that already expired. Use `clock_timestamp()` when writing, or one
> item per transaction.
>
> **Test consequence:** the lease is measured by the **database** clock. The expiration test seeds
> `lease_until` in the past — it never manipulates the application clock. Without this sentence, the deterministic
> regime of §7 passes a mechanism that was never exercised.

**The outbox does not preserve order.** With `SKIP LOCKED` and N workers, `ORDER BY criado_em` orders the *claim*,
never the *delivery*. If some message depends on order, the consumer needs a sequence number per
aggregate key — dedupe does not reorder.

- Lease with a deadline, exponential backoff, dead-letter queue after N attempts.
- **Consumer idempotency is mandatory** — reprocessing happens.

### 5.2 `LISTEN`/`NOTIFY` — with a caveat

New in Postgres, and tempting. But:

> **`NOTIFY` is a notice, never a delivery.** It is not durable: if nobody is listening, the message is gone. Payload limited to 8 kB.

Correct use: **wake the outbox poller** to cut latency. The poller keeps existing and keeps being the guarantee. Whoever swaps polling for `NOTIFY` loses an event on the first restart.

SSE to the browser remains an **invalidation signal, not an event replay** — same as herz.

---

## 6. Backend

Fastify. Layers with import direction enforced by `dependency-cruiser` in CI:

| Layer | Rule |
|---|---|
| `packages/contract` | oRPC + Zod. **Zero Node dependency** |
| `domain/` | Pure TS. No import of Fastify, Kysely or the contract |
| `app/` | Use cases. Receives `UnitOfWork`; every write receives `trx` |
| `http/` | Routes: parse → use case → response |
| `db/` | Kysely, migrations, `UnitOfWork` adapter |

- **One transaction per use case**, opened only in the `UnitOfWork`.
- **Retry only on transient failure**, of the whole use case. A version conflict is **not** transient.
- Config validated at boot: **the process does not come up with an invalid env.**
- Structured log with a correlation id; **personal data masked on output**.

---

## 7. Verification

A single `verificar` command, with a **step count in the header** — `APROVADO 12/12`, so that running one step alone does not look like total approval.

| Step | Catches |
|---|---|
| `tsc --noEmit` | Shape divergence |
| Formatting | Review noise. **No fixing** |
| Lint + boundaries | Crossed layer, cycle, orphan |
| Domain unit tests | Wrong business rule |
| **Contract, in both directions** | A handler that diverged from the schema |
| **Integration with a real Postgres** | SQL, transaction, isolation, index. *A database mock tests the mock* |
| **Migration with existing data** | The most forgotten one |
| Error path | 409, 422, 503, timeout |
| Secret + CVE | Committed credential |
| E2E, 3 to 7 flows | The seams |

**Determinism:** fake clock, fixed seed, no network in unit tests, each test creates and destroys its own data, wait on a condition and never on a duration, time zone pinned.

**CI in a Windows + Linux matrix.** The `npx` defect survived for months in alicerce because CI only ran Linux.

---

## 8. Deploy

Container. Two services: the application and `postgres:17-alpine`, two volumes.

**Gone from herz:** IIS, ARR, WinSW, and the proxy buffering that broke SSE — the most fragile and least portable part of the previous design.

---

## 9. Decisions closed in the review

### 9.1 Linter — two, on purpose

| Tool | Role |
|---|---|
| **oxlint** | Fast general lint |
| **Small ESLint** | Only our own policy / architectural rules |
| **`tsc`** | Type-checking authority |

Reason: oxlint's JS plugins are in **alpha**, do not follow semver, and **custom rules get no type-awareness**. Since almost every architectural rule of ours is our own, we cannot depend on that yet.

**But the rule of choice is not "architectural rule = ESLint".** It is: **use the cheapest mechanism that can prove the property.** `domain/` does not import `db/`, `Date.now()` forbidden and `@ts-nocheck` are import graph or simple AST — they need no types. When oxlint's plugin API matures, the second linter goes.

### 9.2 Rule classes

| Class | Entry | Examples |
|---|---|---|
| **Deterministic** | born `error`, after the fixtures | `domain/` imports `db/` · `@ts-nocheck` · old migration edited · `process.env` outside `config/` |
| **Heuristic** | born `warn` + counter | literal color · search radius |
| **Informational** | stays a metric | token telemetry · coverage |

Two traps on record:

1. **A warning also trains the agent.** Forty warnings a day become noise, and noise teaches you to ignore the entire output. A warning is attention debt, not neutral.
2. **Perfect detection ≠ perfect specification.** `http/` does not touch `db/` is mathematics — until someone needs a type-only import of `db/tipos`, which is legitimate. Hence: a deterministic rule is born `error`, **but the fixture set has to include the legitimate edge case in `aprovar/`**, not only the violation in `reprovar/`.

### 9.3 Architecture fitness tests <!-- `aprovar/` and `reprovar/` below stay in Portuguese: they are the fixture directory names this document prescribes, not prose. Grepping this tree will not find them — rebar's own proof fixtures use `pass/` and `fail/`. -->

`aprovar/` proves the rule does **not** catch a legitimate case. `reprovar/` proves it catches the error. And each negative fixture declares, in a structured marker, which rule it expects to fire:

```ts
// @expect-rule sem-io-externo-no-caso-de-uso
// @expect-rule sem-ciclo
```

The harness validates four things: the rule exists in the registry · every declared rule fired **in that file** · no undeclared rule fired there · **a fixture in `reprovar/` with no marker is an error**.

Without the third, a fixture stays red for the wrong reason indefinitely. Without the fourth, a new file lands in the folder and proves nothing.

### 9.4 TypeScript

`strict` · `noUncheckedIndexedAccess` · **`exactOptionalPropertyTypes`**.

The last one matters especially here: in a PATCH with Zod and a database, the difference between `{ name: undefined }` and `{}` is exactly where the bug is born.

### 9.5 Pinned infrastructure

`postgres:17-alpine` is a **moving tag** and contradicts the determinism philosophy of everything else. Digest pinned, conscious update. Same rule for the Node image.

---

## 10. What is still open

| Decision | Note |
|---|---|
| ⬜🔴 **Rendering strategy** | Vite + TanStack Router is an **SPA**, and an SPA does not deliver `og:image` — WhatsApp, LinkedIn, Slack and Discord do not execute JS. For the `site` preset that is blocking. **TanStack Start is a strong candidate: in Release Candidate, with the API declared stable and feature-complete by the team itself.** Choosable — but the stage gets said out loud, not sold as GA |
| ⬜🔴 **Content origin** | hardcode · MD/MDX in the repo · CMS · database. It is literally the *"hardcoded"* of the original complaint |
| ⬜🔴 **Authorization** | The panel only has **corporate** auth. What is missing is the model above that, and the distinction the AI gets wrong most: `if (!user) throw 401` does not answer *"can this user modify **this** resource"*. Authorization becomes a primitive of `app/`, not an invention of each route |
| ⬜🔴 **Tenant context in RLS** | If RLS is used for multi-tenancy, the context has to be **transaction-local** — otherwise it leaks through connection pooling |
| ⬜ CSRF | It is born together with the authentication decision, never on its own. oRPC brings `SimpleCsrfProtectionHandlerPlugin` + `SimpleCsrfProtectionLinkPlugin`: a **custom header** check (`x-csrf-token`, constant value `"orpc"` by default), applied to **every** procedure — not only GET, and **with no relation to `SameSite`**. The guarantee comes from the CORS preflight. It does not replace a per-session token |
| ⬜ Money unit | Cents, decimal or nano. See §4.4 |
| ⬜ WCAG level | The panel says "declarado" [declared] and never names A/AA/AAA |
| ⬜ Names of the five color families | Today they are PCP's |

### Deploy — the most immature section, admittedly

A container and two services are enough for development. For production it remains to decide: backup and **tested restore** · health and readiness · graceful shutdown and pool drain · observability · full disk · log retention · outbox lag · migration failure · Postgres upgrade · secret rotation.

It does not have to become Kubernetes. But **a tested restore is as important as a tested migration** — the software can be 100% correct and the volume can be lost.
