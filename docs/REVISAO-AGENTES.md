# Review consolidation — `docs/STACK.md` v1.0

**Lead reviewer · 26/08/2026 · six lenses: factual verification, concurrency, security, internal coherence, production/deploy, frontend.**
Document read in full (757 lines). Third-party evidence re-checked by sampling the code installed in `~/OneDrive/Documents/prumo/node_modules` and in the two reference repositories; the re-checked items are marked **[re-verified]**.

The prose here is English; the Portuguese that remains is not prose. Column names (`entregue_em`, `criado_em`, `tentar_apos`), rule ids (`sem-ciclo`, `componente-nao-busca-dado`), fixture directories (`aprovar/`, `reprovar/`), script names (`verificar`) and routes (`/saude/vivo`) are identifiers in the audited repositories — translating them renames something that exists, which is a different job with a different risk. Quotes from the project owner keep the original wording, with the English in brackets after it.

---

## 1. VERDICT

**No. 34 blocking items are missing** — 15 where the text, as it stands, instructs you to build something defective, and 19 absent decisions whose postponement closes a door (schema, deploy or contract).

The document is strong where it was attacked and empty in what sits adjacent. The three things it celebrates most — the unified invariant of §3.1, the three identities of §4.6, the three-phase outbox of §5.1 — are exactly where the gap hurts most, because each one is a step away from becoming code. Concretely: **the capture SQL published in §5.1 does not read the lease column that the diagram right below it orders you to write**, and that combination, copied literally, resends the same message on every polling tick. **The health gate on line 564 omits `session_user`** — the exact defect the whole of §4.6 exists to diagnose, reproduced in the one assertion that runs in production. **Line 225 declares in bold a decision that lines 229-234 demolish**, and line 225 was never rewritten.

What survives the audit, and is worth recording before the bad news: the 14 version numbers of §2 check out against herz's lockfile; `pg` 8.23.0 · `pg-pool` 3.14.0 · `@types/pg` 8.23.1 · Kysely 0.29.5 · oRPC 1.15.0 are installed as claimed **[re-verified]**; the literal PostgreSQL citations (`ddl-priv`, `sql-createextension`, `citext`, `pg_try_advisory_xact_lock`) are faithful; the three node-postgres citations (`pg-pool@3.14.0:288-301`, `lib/query.js:198-201`, removal in `pg@9.0`) check out line by line; the oRPC status map covers the seven cited codes **[re-verified]**; `GRANT … WITH INHERIT FALSE, SET TRUE, ADMIN FALSE` is valid syntax; and `pg_has_role(…,'SET')` is transitive, so the `SET ROLE` chain is indeed closed. The two warnings in §2 (it is not Radix; `components.json` says `neutral` and the CSS is zinc) check out.

The structural failure is a single one, and it is as uncomfortable as it gets: **line 44 says the last two principles were born of mistakes made in this document — and the document commits the same class of mistake three more times.** An ellipsis in the `RESET ROLE` citation erases precisely the clause that opens the exception (§4.6:433). The principles' provenance table attributes *"Link preview does not execute JS"* to *"crawler / OG specification"* (line 68), and none of the four named sources says this — the owning layer is the framework. Line 748 attributes to oRPC a cookie property (`SameSite`) that oRPC does not have.

---

## 2. BLOCKERS

### Tier 1 — the text, as it stands, instructs you to build something defective (15)

---

**1 · §5.1 — The outbox capture SELECT does not read `lease_until`. The lease is written and never consulted.** `critical`

*Problem.* The published predicate is `WHERE entregue_em IS NULL AND tentar_apos <= now()`. The diagram right below orders TX 1 to `SET lease_until` and COMMIT. After the COMMIT the row lock from `FOR UPDATE` dies, and the row goes back to satisfying the predicate unchanged — `SKIP LOCKED` only skips a row locked by an **open** transaction, and there is none. 1 s poller, two workers, 5 s POST: the same message goes out ~10 times. That is not the at-least-once §3.1 declares and bounds; it is N sends per second per worker while the I/O is in flight. Second defect in the same query: with `SKIP LOCKED` and N workers the `ORDER BY criado_em` does not produce delivery order, and the guarantees table on line 217 requires only dedupe from the consumer — dedupe is not reordering.

*Evidence.* STACK.md:589-595 (the SQL) against STACK.md:604-619 (the diagram). Grep over the whole file: `lease_until` appears **exactly once**, on line 607, never in a predicate **[re-verified]**. Owner: PostgreSQL, `sql-select`, The Locking Clause — *"With SKIP LOCKED, any selected rows that cannot be immediately locked are skipped."*

*Fix.* Publish the predicate of the three-phase design: `AND (lease_until IS NULL OR lease_until <= now())`, and in TX 1 write `lease_until` **and** `lease_by`. Put in writing that the §5.1 SQL is invalid on its own — the document shows both queries together or neither. Declare out loud that the outbox **does not preserve order** and add the consumer's third obligation to the guarantees table (sequence number per aggregate key), or swap global `SKIP LOCKED` for partitioning by key.

---

**2 · §5.1 — TX 2 is unconditional: it does not validate lease ownership, and two workers write over each other.** `critical`

*Problem.* The diagram describes TX 2 as "mark delivered / COMMIT", with no condition. With the lease expiring during in-flight I/O — a situation prumo's ADR 0008 documents as routine, not exceptional — W1 returns 200 at t=45 and marks it delivered; W2 returns 500 at t=62 and reschedules the same row; if `tentativas` crosses N on that increment, a **delivered** message goes to the dead-letter queue and fires an alert. There is no ownership column in the document (`lease_by` is not mentioned), so W1 has no way to find out it lost the lease. Clock aggravator: `now()` is `transaction_timestamp()` and does not change during the transaction, so in a batch capture the lease of every item starts counting from the start of TX 1 — with a batch of 10 and sequential 5 s calls, item 10 gets a negative lease.

*Evidence.* STACK.md:616-618 (TX 2 with no condition); STACK.md:623 is the only line about the lease in the file. PostgreSQL, `functions-datetime`: *"now() is a traditional PostgreSQL equivalent to transaction_timestamp()"* and *"their values do not change during the transaction."* Context: `prumo/adr/0008-task-lease-per-type.md`.

*Fix.* `UPDATE outbox SET entregue_em = now() WHERE id = $1 AND lease_by = $2 AND lease_until > now()`, with 0 rows affected treated as "I lost the lease: I do not write, I do not increment, I only log" — same on the failure path. `clock_timestamp()` when writing the lease in a batch capture, or one item per transaction. And write down the test consequence: since the lease is measured by the **database** clock, the expiry test seeds `lease_until` in the past — it never manipulates the application clock. Without that sentence, §7's deterministic regime passes a mechanism that was never exercised.

---

**3 · §3.1 — Duplicate-in-flight has three simultaneous answers in the document, and the mandatory test passes the rejected architecture.** `critical`

*Problem.* Line 225 declares in bold **"Chosen: wait and replay — with bounded waiting"**. Four lines further on the document demolishes that choice (499 stalled connections) and adopts the opposite. The sentence "Chosen" is never rewritten nor marked as a rejected candidate, so it remains the only decision explicitly labelled as a decision in the section. The table on line 179 describes the rejected behaviour, and the acceptance criterion on line 208 accepts **"replay or 409"** — that is, an implementation that blocks on the unique index and replays **passes the test**, which is exactly the DoS vector the section exists to eliminate.

*Evidence.* STACK.md:179, :208, :225, :229-234, :237-239.

*Fix.* Rewrite line 225 as a rejected candidate (the document already uses that format in "The case that almost passed", line 293); change line 179 to "One executes; the second gets a 409 and does not wait"; harden line 208 to "excess duplicates: 409, never replay".

---

**4 · §4.6 — The premise that decides the `RESET ROLE` case is hidden behind an ellipsis, and never became an assertion.** `critical`

*Problem.* The `Assumptions` block on lines 78-81 lists four premises, and line 84 requires each one to become an assertion. The one that decides the case is missing: that no connection-time `role` exists. The citation on line 433 is presented as settling the matter, and the ellipsis elides the main clause. The document **knows this** — line 450 forbids `ALTER ROLE app_login SET role = app` for exactly that reason — and even so neither the premise nor the assertion exists. Two vectors remain with the same failure signature (silent fail-open) and neither goes through `ALTER ROLE`: `ALTER DATABASE <db> SET role = app`, and `options=-c role=app` in the connection string (or `PGOPTIONS` in the environment). The second is deploy config — the kind of thing someone adds to "solve" a permission error without touching SQL. With either of them the hostile test on lines 516-527 stays green and `RESET ROLE` lands on `app`, with the whole DML.

*Evidence.* STACK.md:433 cites *"`RESET ROLE` sets the current user identifier to … the current **session user** identifier."* The PostgreSQL 17 doc (`sql-set-role`) says: *"RESET ROLE sets the current user identifier to the connection-time setting specified by the command-line options, ALTER ROLE, or ALTER DATABASE, if any such settings exist. Otherwise, RESET ROLE sets the current user identifier to the current session user identifier."* The ellipsis erases the entire first sentence. STACK.md:78-81, :84, :450, :516-527.

*Fix.* Reproduce the citation without the ellipsis. Add the fifth Assumption and the three assertions it produces: `pg_db_role_setting` empty for the (role, database) pair; `current_setting('role', true)` null right after the connect and after `RESET ROLE`; connection string with no `options=`. The behavioural test (`RESET ROLE` → protected `SELECT` → PERMISSION DENIED) catches all three at once, but the written threat model has to name them — that is principle 3 itself.

---

**5 · §4.6 — The boot health gate omits `session_user`: the exact defect the section diagnoses.** `critical`

*Problem.* The whole section exists because prumo's test asserted only `current_user` and therefore did not see that `session_user` was a superuser. Line 514 repeats the lesson out loud. And line 564 — the assertion that decides whether the application is healthy, the only gate that runs in production — lists `current_user`, `rolsuper`, `rolbypassrls` and `TimeZone`, and **does not list `session_user`**. Worse: it does not say which role `rolsuper`/`rolbypassrls` are read from. If they come from `current_user` (= `app`), the gate passes even with `app_login` as superuser — which is prumo's scenario, word for word.

*Evidence.* STACK.md:438, :514, :522 (the hostile test, correct, includes `session_user`), :564 (the gate, which does not). Confirmed that the described defect is real: `prumo/docker-compose.yml:52` `POSTGRES_USER: prumo`. Grep for `session_user` in `prumo/apps` and `prumo/packages`: **zero occurrences** **[re-verified]**.

*Fix.* `SELECT session_user, current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = session_user` — the negative attributes read from `session_user`, not from `current_user`.

---

**6 · §10/§4.6 — The RLS tenant context is a `PGC_USERSET` GUC: the restricted role rewrites its own context with no privilege.** `critical`

*Problem.* The document has one line about tenant context (747) and it requires only that it be transaction-local, treating connection pooling as the only failure mode. Transaction-local is necessary and is not sufficient. A policy keyed on `current_setting('app.user_id')` is evaluated against a parameter the restricted session itself can write: a two-part custom parameter is born as a placeholder with `PGC_USERSET` context, with no privilege check. A `set_config('app.user_id', <another uuid>, true)` — by injection, by a use case that did not go through `UnitOfWork`, or by carelessness — swaps the tenant and RLS hands over someone else's rows, with no error. In the reference implementation there is also a **literal bypass switch used as a policy predicate**. The hostile test's seven assertions stay green the whole time, because none of them looks at the GUC.

*Evidence.* PostgreSQL, `src/backend/utils/misc/guc.c` REL_17_STABLE, `add_placeholder_variable`: `gen->context = PGC_USERSET`. Doc `runtime-config-custom`: *"PostgreSQL will accept a setting for any two-part parameter name"*, with no privilege clause. Reference: `prumo/apps/server/src/db/migrations/20260824_0001_base.ts:159-173` creates `CREATE POLICY users_bootstrap ON users USING (current_setting('app.bypass_rls', true) = 'on')`; `prumo/apps/server/src/db/unit-of-work.ts:45` writes `set_config('app.bypass_rls','on',true)` **[re-verified]**. STACK.md:747 is the only mention in the entire document.

*Fix.* Raise the tenant GUC to a privileged channel, written in exactly one place: (a) a deterministic lint rule that fails `set_config('app.` and `SET LOCAL app.` outside `UnitOfWork`; (b) forbid bypass as a policy predicate — the bootstrap path uses another role or another connection, never a flag the restricted session turns on by itself; (c) the hostile test gains the execution case it lacks: inside tenant A's scope, run `set_config('app.user_id', <B's uuid>)` and assert zero rows or an error.

---

**7 · §4.6 — The hostile test is a whitelist of two role edges; the 15 predefined roles pass underneath it.** `critical`

*Problem.* The block enumerates two edges (`app_login`→`db_owner`, `app_login`→`app`) and five negative attributes. Privilege in PostgreSQL 16+ is a graph, and the predefined roles appear in neither check: none is a superuser, none has BYPASSRLS, none is `db_owner` or `app`. `GRANT pg_read_all_data TO app` leaves the seven assertions green and gives read access to every table, view and sequence in the database — including the outbox and the idempotency record, which the document never puts under RLS. `GRANT pg_execute_server_program TO app` leaves the seven green and gives `COPY … FROM PROGRAM`. That is the hurried agent's move: it hits "permission denied for table X" and grants the predefined role that solves it, because it "looks safe" by the five attributes the document itself taught it to measure.

*Evidence.* PostgreSQL, `predefined-roles`: `pg_read_all_data` — *"Read all data (tables, views, sequences), as if having SELECT rights on those objects… This role does not have the role attribute BYPASSRLS set."* `pg_execute_server_program` — *"Allow executing programs on the database server as the user the database runs as with COPY…"* Contrast with STACK.md:518-522.

*Fix.* Swap the edge whitelist for an assertion about the set: `SELECT roleid::regrole::text, member::regrole::text FROM pg_auth_members WHERE member IN ('app_login'::regrole,'app'::regrole)` has to be exactly the declared pair, plus an assertion that neither `app` nor `app_login` belongs, directly or indirectly, to any role whose name starts with `pg_`. Record the Assumption nobody wrote: *"app and app_login belong to no predefined system role"*. **In the same fitness test, add the extension-set assertion** — `SELECT extname FROM pg_extension ORDER BY 1` equal to the declared list (`plpgsql`, `citext`, `unaccent`): the audit on line 497 checks the ACL of what exists and does not detect that something came into existence, and a `CREATE EXTENSION plpython3u`/`dblink`/`file_fdw` in a migration reintroduces DDL or file access without touching a single role attribute.

---

**8 · §4.6/§7 — `GRANT` on a new table is automatic, RLS on a new table is manual: fail-open asymmetry.** `critical`

*Problem.* Line 531 uses `ALTER DEFAULT PRIVILEGES` so future tables inherit DML. There is no equivalent for RLS: `ENABLE`, `FORCE` and the policy are per table, manual, in every migration. A table created in migration N+5 is born readable and writable by `app` and with no policy at all — the privilege arrives on its own, the protection does not. Nothing in §7 catches this: `tsc` does not see a policy, `dependency-cruiser` does not see a policy. The opposite direction (RLS enabled with no policy) fails loudly and is always found; the dangerous direction fails in silence. The document also does not handle views: a view over a table with RLS applies the policies of the **view's owner**, and the owner is `db_owner`.

*Evidence.* PostgreSQL, `ddl-rowsecurity`; `sql-createview`, Notes: *"If any of the underlying base relations has row-level security enabled, then by default, the row-level security policies of the view owner are applied… unless the view has security_invoker set to true."* Empirical proof of the asymmetry: `prumo/…/20260824_0001_base.ts:131-132` does a manual ENABLE+FORCE loop; `20260825_0002_app_role.ts` uses `ALTER DEFAULT PRIVILEGES` for the GRANTs. The fail-closed-side incident is documented in the repo itself: `20260825_0004_bootstrap_commands.ts`, docstring — *"The bootstrap policy migration 0001 forgot… Nothing caught it."*

*Fix.* A catalogue fitness test, deterministic class, next to the hostile test: (a) every table with a tenant column needs `relrowsecurity AND relforcerowsecurity` in `pg_class` and at least one row in `pg_policy`; (b) every view whose base relations have RLS needs `security_invoker=true`; (c) the list of exempt tables is literal and versioned in the test, never a comment in the migration.

---

**9 · §4.5 — Kysely 0.29.5 runs ALL pending migrations in a single transaction, and the `lock_timeout` it configures does not hold inside it.** `critical`

*Problem.* The document settles migration-at-boot in one line and does not say what the prescribed tool does. Kysely acquires the advisory lock **outside** the transaction and runs all pending migrations **inside** a single one. `lock_timeout = 3600000` is configured with `set_config(..., true)` — `is_local = true`, so it holds only in the implicit transaction of the lock statement itself; by the time the migration transaction opens, the value is already back to the server default, which is **0**. Consequence in a rolling deploy: an `ALTER TABLE` that needs ACCESS EXCLUSIVE waits indefinitely behind a report in progress and, once it gets the lock, **holds ACCESS EXCLUSIVE for the entire backfill that runs in the same transaction**. ACCESS EXCLUSIVE conflicts with every mode: instance N, which is serving traffic, cannot get so much as a `SELECT` on the table. A migration "compatible with the old version" produces total unavailability of the table.

*Evidence.* `kysely/dist/migration/migrator.js:442-445` — `if (adapter.supportsTransactionalDdl && !disableTransactions) { … .execute((db) => runWithLock(db, (db) => db.transaction().execute((trx) => run(trx)))) }`; `kysely/dist/dialect/postgres/postgres-adapter.js:4-5,20-22` — `LOCK_ID = BigInt('3853314791062309107')`, `LOCK_TIMEOUT_MILLISECONDS = 60*60*1000`, `select set_config('lock_timeout', '3600000', true)` **[re-verified]**. PostgreSQL, `functions-admin`: *"If is_local is true, the new value will only apply during the current transaction."* `runtime-config-client`, `lock_timeout`: *"A value of zero (the default) disables the timeout."* Grep in STACK.md: `lock_timeout` = **0 occurrences** **[re-verified]**.

*Fix.* Write in §4.5 that (a) grouping into one transaction is a property of the tool, not a project choice; (b) every migration that emits DDL starts with `SET LOCAL lock_timeout = '3s'` and `SET LOCAL statement_timeout`, with failure by timeout being the desired behaviour; (c) backfill does **not** go in the same transaction as the DDL — it becomes a separate migration, in batches; (d) if the policy is one transaction per migration, pass `disableTransactions` and accept the partially applied migration. This is a rule that comes down from prose into enforcement by principle 1: a `reprovar/` fixture with `@expect-rule` for DDL without `SET LOCAL lock_timeout`.

---

**10 · §4.4 — §4.4's central premise is false at three points: `numeric[]`, `jsonb` and the binary protocol.** `high`

*Problem.* §4.4 rests the whole section on *"`pg` returns `numeric` as a string by default. It is the safe behaviour, and it is a net gain"*, and lists **two** remaining traps. Three are missing, all silent, all from the same layer. (1) `numeric[]` (OID 1231) **does** have a registered parser and it is `parseFloatArray` — every element goes through `parseFloat`. An `array_agg(valor)` returns `number[]` with precision loss, with no warning, and the "no floats" rule does not catch it because nobody wrote a float. (2) `jsonb` (OID 3802) goes through `JSON.parse`: a number in `jsonb` is `numeric`, exact on the PostgreSQL side, and becomes an IEEE754 double at the driver boundary. This attacks the document's strongest invariant — idempotency's `resultado` is a `jsonb` column, so **the replay returns a different value from the original above 2⁵³**. (3) In the binary protocol the scalar also becomes a `number`, and `binary` is a supported `Pool` option.

*Evidence.* `pg-types/lib/textParsers.js:189` → `register(1231, parseFloatArray); // _numeric`; `:203` → `register(3802, JSON.parse.bind(JSON)); // jsonb`; OID 1700 **does not appear** in `textParsers.js` (which is why the scalar comes back as a string — the part the document got right) and does appear in `binaryParsers.js:241` → `register(1700, parseNumeric)` **[re-verified]**. Real column: `prumo/…/20260824_0001_base.ts:115` `result jsonb NOT NULL`. Reproduced: `JSON.parse('{"v":1234567890123456789}').v` → `1234567890123456800`.

*Fix.* Correct the text: `pg` returns **scalar** `numeric` as a string, in the **text** protocol. Add three items to the list: `numeric[]` comes back as `number[]`; `binary: true` reverts the scalar; a monetary value and a 64-bit id inside `jsonb` are **strings**, never JSON numbers. Swap "no floats" for a verifiable rule: forbid `numeric[]`/`float4`/`float8` on the money path by catalogue, or register `setTypeParser(1231, …)` returning `string[]`. And close the boundary test with a case that writes an idempotency result with a value near 2⁵³, replays it and asserts byte-for-byte equality — without that, §3.1 declares an invariant the driver breaks in silence.

---

**11 · §3.1/§4.1/§6 — The 409 carries three incompatible contracts, and the document orders the client to obey both opposites.** `high`

*Problem.* The document emits 409 in three situations that demand opposite behaviours: duplicate-in-flight (the client **must** retry, or the command is lost), a different hash with the same `commandId` (retrying is useless and masks a bug), and optimistic version conflict (the document says, in bold, "never an automatic retry"). Lines 239 and 355 contradict each other directly. None of the three gets a distinct `type`, even though §3 requires an error to be "classifiable without reading the message". A generated client implements one policy only: if it picks "never retry", it loses every command that fell into duplicate-in-flight; if it picks "retry with Retry-After", it starts automatically repeating concurrency conflicts. Layer aggravator: the oRPC map has `PRECONDITION_FAILED` → 412 and `TOO_MANY_REQUESTS` → 429, both unused; and RFC 9110's `Retry-After` is defined for 503, 3xx and 429 — on a 409 it is semantically undefined and no generic proxy honours it. Side note: `Retry-After` also **does not travel in `ORPCError`** (`toJSON` serializes `defined`, `code`, `status`, `message`, `data`), and the "202 in progress" offered on line 223 is not expressible as an `ORPCError`, because the constructor requires `status < 200 || status >= 400`.

*Evidence.* STACK.md:239, :288, :355, :651, :671. `@orpc/client/dist/shared/client.CZlviB0y.mjs:54` `CONFLICT: { status: 409 }`, `:58` `PRECONDITION_FAILED`, `:74` `TOO_MANY_REQUESTS`, `:123` status validation, `:133` `toJSON`, `:173` `isORPCErrorStatus` **[re-verified]**. Existing header channel: `@orpc/server/dist/plugins/index.mjs:331` exports `ResponseHeadersPlugin` **[re-verified]**.

*Fix.* One status per semantics: duplicate-in-flight → 429 or 503 with `Retry-After`; optimistic conflict → 412 `PRECONDITION_FAILED`; key reuse with a different hash → 409 `CONFLICT`, alone and not retryable. Two RFC 9457 `type`s fixed in the contract. Note that `Retry-After` goes out via `ResponseHeadersPlugin`, not through the error, and that the error-path test asserts both separately. Split line 670 of §7 into two cases.

---

**12 · §10 — The oRPC CSRF plugin is not what line 748 describes. Three errors in one sentence.** `high`

*Problem.* The line says *"oRPC has a plugin for GET with `SameSite=Lax`, which does not cover `SameSite=None`"*. The real plugin is `SimpleCsrfProtectionHandlerPlugin` and (a) it **filters no method at all** — it registers `rootInterceptor` and `clientInterceptor`, which apply to every procedure; (b) it **has no relation to `SameSite`** — it is a custom header check, whose protection comes from the CORS preflight, not from a cookie attribute; (c) the default value is the constant string `"orpc"`, not a secret token. Whoever implements CSRF from that line believes the defence is a cookie property and that POST mutations are out of scope — both backwards. And §10 lists the wrong dependency: the variable that forces `SameSite=None` is not the authentication choice, it is the **origin topology**, which is line 744.

*Evidence.* `@orpc/server/dist/plugins/index.mjs:289-320` — `class SimpleCsrfProtectionHandlerPlugin`, `this.headerName = options.headerName ?? "x-csrf-token"`, `this.headerValue = options.headerValue ?? "orpc"`, error `new ORPCError("CSRF_TOKEN_MISMATCH", { status: 403 })`; **zero occurrences of `SameSite`/`sameSite` in the file** **[re-verified]**. The real dependency is written in the reference: `prumo/apps/server/src/http/session-cookie.ts:5-11` — *"Host-only is possible because the SPA is served by this same Fastify process… Putting the front end on another host would force SameSite=None, which is strictly worse for no gain."*

*Fix.* Rewrite: *"oRPC ships `SimpleCsrfProtectionHandlerPlugin` (+ `SimpleCsrfProtectionLinkPlugin` on the client) — a custom header check (`x-csrf-token`, constant value by default), applied to every procedure. The guarantee comes from the CORS preflight, not from `SameSite`. The cookie's `SameSite` policy is a decision of the authentication layer and of the browser."* Merge with line 744, or write that 748 depends on 744, and record that **keeping a single origin is a security decision**, not a deploy convenience. Bonus: `CSRF_TOKEN_MISMATCH` is not in `COMMON_ORPC_ERROR_DEFS` and therefore passes an explicit `status: 403` — it is living proof of §3's claim.

---

**13 · §10 — The proof of the single blocking 🔴 violates principle 3, and the document's own provenance table carries the wrong attribution.** `critical`

*Problem.* §10 declares the SPA blocking for the `site` preset and the table on line 68 attributes *"Link preview does not execute JS"* to *"crawler / OG specification"*. The OG specification does not own that property, and none of the four named platforms publishes the claim. Two consequences. First: no premise is testable, and the document's most expensive architectural decision carries no test obligation. Second: the document merges `og:image` with SEO, and the SEO half is wrong — Googlebot renders JS. Treated as one, you pay for full SSR when what is missing may be only meta in the initial document. And the indicated way out does not solve it: in TanStack Start's **SPA mode** the prerender emits a single shell (`/_shell.html`), that is, identical meta for every URL — exactly the defect you wanted to fix. What solves it is prerender with `crawlLinks`, or SSR.

*Evidence.* Read and with no mention of JavaScript: `ogp.me`; `developers.facebook.com/docs/sharing/webmasters/web-crawlers/`; `api.slack.com/robots` (*"It fetches as little of the page as it can… looking for oEmbed and Twitter Card / Open Graph tags"*); `linkedin.com/help/linkedin/answer/a521928`. Against: Google Search Central, *javascript-seo-basics* — *"Once Google's resources allow, a headless Chromium renders the page and executes the JavaScript."* The owning layer says what is missing: TanStack Start doc, SPA mode — *"Robots, crawlers and link unfurlers may have a harder time indexing your application unless they are configured to execute JS."*

*Fix.* Rewrite in the mandatory format: Claim = "a link preview does not see meta injected on the client"; Owner = TanStack Start (what is emitted) + each crawler (what is consumed); testable Assumptions — the build HTML does not contain `og:image` per route; `curl -A facebookexternalhit/1.1 <url>` does not return the tag; LinkedIn's Post Inspector does not find it. Separate preview (blocking) from indexing (non-blocking). And list three ways out by cost **before** switching frameworks: (a) meta at the origin — §6's Fastify injects `og:*` per route into the document, cost ~zero; (b) prerender at build time with `crawlLinks`; (c) meta at the edge. Record that an OG image service (`@vercel/og`, satori) is **orthogonal** — it generates the image, it does not deliver the tag; without that sentence it is the way out the agent picks first. Record the version pairing too: `@tanstack/react-start` is at 1.168.49 and the router herz pins is at 1.170.18 — Start and Router go up together.

---

**14 · §4/§9.5 — `shadcn add` in the scaffold: the question's premise is false, and the decision contradicts §9.5.** `critical`

*Problem.* Two stacked failures. (a) §4's question is framed as "`shadcn add` writes into `src/components/ui`, which the boundaries preset excludes". A registry item can write into the CSS, into `package.json`, into environment files and into an arbitrary project path, and pull registry dependencies by URL or GitHub repository. The real tension is not "unanalysed code in a directory"; it is a command that writes anywhere in the repository with content downloaded from a remote server at scaffold time. (b) §9.5 pins the image digest because a moving tag *"contradicts the determinism philosophy of everything else"*. `shadcn add` is a moving tag with no digest: a live registry, no lock, no hash, no version per item. Two scaffolds of the same preset on different dates produce different `ui/`. Aggravator: the `dependency-cruiser` exclusion lives in `options.exclude`, which removes the modules from the whole cruise — `sem-ciclo` and `sem-orfao` never look at `ui/`, and the `componente-nao-busca-dado` rule uses a `(?!/ui/)` lookahead that **can never fire**.

*Evidence.* `registry-item.json` specification: `cssVars`, `css`, `dependencies`, `envVars` (*"Adds environment variables to .env.local or .env"*), `registryDependencies` (*"bare names, namespaced items, GitHub repos, URLs, or local files"*), `files[].target` with `~` for the root. Installed CLI `shadcn@4.19.0`: `dist/index.js:42,47,52` carries `target:"src/routes/index.tsx"`; `dist/chunk-CDOZT3OO.js:132` writes the env file. `herz/apps/web/components.json:24` `"registries": {}` — an open field. `herz/apps/web/.dependency-cruiser.cjs:41` dead lookahead and `:76` `exclude: { path: '(\\.test\\.ts$|^src/components/ui/)' }` **[re-verified]**. `shadcn ^4.16.0` is in `dependencies`, not in `devDependencies` **[re-verified]**.

*Fix.* (1) `shadcn add` runs **once**, at scaffold time, and the output is vendored and committed, with a `ui/.registro.json` manifest (registry URL, date, SHA-256 per file) recomputed by a `verificar` step. (2) `registries` locked to the official registry; items by URL or GitHub forbidden by policy, verifiable by reading `components.json`. (3) `--dry-run` mandatory before any `add`, with the diff of `index.css`, `package.json` and `.env*` reviewed as an architecture change. (4) Take `^src/components/ui/` out of `options.exclude` and exempt it by rule, keeping `sem-ciclo` and creating `ui-nao-conhece-o-app`, with the `aprovar/`/`reprovar/` pair §9.3 requires. (5) Move `shadcn` to `devDependencies`.

---

**15 · §4.6 — The `onConnect` snippet interpolates the role name into SQL; the code it is supposed to reflect does not.** `medium · costs one line`

*Problem.* The example block is `await client.query(`SET ROLE ${role}`)` — raw concatenation of an identifier into SQL, in the only executable code of the document's strongest section, run with the connection's privileged identity, before the barrier. prumo's real code does the opposite and explains why in a comment. In a document whose thesis is "wrongly generated code must *look* wrong", this is the section's most copyable artifact and it teaches the pattern the repository has already rejected. `SET ROLE` does not accept a bound parameter, so there is no safety net further down.

*Evidence.* STACK.md:535-542. Against `prumo/apps/server/src/db/connection.ts:79` — `client.query(`SET ROLE ${quoteIdentifier(role)}`)`, function at `:93` **[re-verified]**, with the comment: *"The role name is ours, not user input — but building SQL by concatenation is a habit, and habits leak into places where the value is not ours."* `pg` itself exports the utility (`pg/lib/client.js:608 escapeIdentifier`).

*Fix.* `await client.query(`SET ROLE ${pg.escapeIdentifier(role)}`)`, with the one-line justification alongside.

---

### Tier 2 — absent decision whose postponement closes a door (19)

---

**16 · §3.1/§8 — The "declared limit" of connections does not exist, and the pool's wait queue is unbounded and has no deadline.** `critical`

*Problem.* Line 207 requires "database connection peak ≤ declared limit" and observes that without that assertion "the test passes a DoS". The document **never declares** a pool size, an instance count or `max_connections`: a test that compares against a non-existent number always passes. And the assertion measures the wrong metric: in `pg-pool` 3.14.0, when the pool is full and `connectionTimeoutMillis` is not configured, the request is pushed onto a `_pendingQueue` array **with no timer and no cap**. With 500 duplicates: 10 executing, 490 promises that never resolve nor reject, each one holding an HTTP socket. The database connection peak was 10 and the test passes — the whole DoS happens above the line the assertion measures. Aggravator: §4.5 requires N and N+1 to coexist during a rolling deploy, doubling demand in exactly the window where nobody is watching; with the defaults (pool 10, typical `max_connections` 100, 3 reserved) it fits today and does not fit with eight instances — and the failure is not degradation, it is `FATAL: sorry, too many clients already` at boot, which the liveness healthcheck does not see.

*Evidence.* `pg-pool/index.js:206-208` — `if (!this.options.connectionTimeoutMillis) { this._pendingQueue.push(new PendingItem(response.callback)); return result }`, with no timer; `:89` `max = … || 10`; no occurrence of `maxWaitingClients` **[re-verified]**. The mitigation already exists in the reference and not in the document: `prumo/…/connection.ts:60,64,65` — `max: options.max ?? 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000` **[re-verified]**. Grep in STACK.md: `connectionTimeout` = 0 occurrences **[re-verified]**.

*Fix.* Write the formula and the number: `(max_instances_during_rolling × app_pool) + (instances × migration_pool_at_boot) + workers + slack ≤ max_connections − superuser_reserved_connections`. Pin `max_connections` explicitly in the compose file and `max` explicitly in the code. `connectionTimeoutMillis` **mandatory and non-zero**, plus an explicit application-level queue ceiling that returns 503 before calling `pool.connect()`. And fix the test's assertion: beyond the connection peak, "no request exceeded the declared latency budget", "maximum `pool.waitingCount` ≤ limit" and "no acquire promise was left pending at the end of the test".

---

**17 · §4.6 — The three server timeouts are not declared, all default to 0, and `SET` in `onConnect` is revocable by `RESET ALL`.** `critical`

*Problem.* The document devotes a section to proving that `onConnect` is a reliable **acquisition** barrier, and has not one line about the **release** side — which is where the design is exposed, because it now depends on the transaction actually ending: `pg_try_advisory_xact_lock` is released only at the end of the transaction, the outbox row locks likewise, and the unique index blocks for as long as the first writer's transaction lives. `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout` are all 0 by default, in both layers, and none is mentioned. `pg-pool` does not emit a ROLLBACK when returning a client, and the Kysely driver always releases without error: a ROLLBACK that fails returns the client to the pool **with the transaction open**, and every retry of the same `commandId` gets a fail-fast 409 forever, with no alert. Second point, applying §4.6's own reasoning where it was not applied: if the timeouts are set with `SET` inside `onConnect`, any raw SQL emitting `RESET ALL` erases them — and the document already assumes that threat model. The same holds for `SET TIME ZONE 'UTC'`.

*Evidence.* PostgreSQL, `runtime-config-client`: all three with *"A value of zero (the default) disables the timeout."* `sql-reset`: *"The default value is defined as the value that the parameter would have had, if no SET had ever been issued… The actual source of this value might be… per-database or per-user default settings."* `pg/lib/defaults.js:65,69,73` — `statement_timeout: false`, `lock_timeout: false`, `idle_in_transaction_session_timeout: false`. `pg-pool/index.js:384-400` `_release` with no state cleanup at all; grep for `ROLLBACK` in the file: 0. Grep in STACK.md: all three = **0 occurrences** **[re-verified]**.

*Fix.* Declare the four numbers and **the mechanism that applies them**. Since `RESET ALL` goes back to the role default, the mechanism that fails closed is `ALTER ROLE app_login SET statement_timeout = …` — not `SET` in `onConnect`. Distinct values for the migration pool (long statement, short lock). It becomes an assertion in the hostile test, next to `pg_has_role`: emit `RESET ALL` and re-assert `current_setting('statement_timeout')` and `current_setting('TimeZone')`. Write the symmetry out loud: `onConnect` is the acquisition barrier, `idle_in_transaction_session_timeout` is the release barrier.

---

**18 · §4.5/§8 — Migration at boot eliminates deploy rollback, and the word "rollback" does not appear in the document.** `critical`

*Problem.* Grep over the whole STACK.md for `rollback`: **zero** **[re-verified]**. PLANO.md marks *"Deploy: como sobe e como volta — Rollback testado"* [Deploy: how it goes up and how it comes back — Rollback tested] as a red blocker. Worse than the absence is the silent contradiction: before migrating, Kysely validates that every migration already executed in the database exists in the image's list, and throws `corrupted migrations` if it does not. The standard recovery move — going back to image R1 — makes the pod die at boot in a crash loop, and the only way out becomes roll-forward written under pressure or a manual DELETE in the migrations table in production. The same guard fires in canary: an R1 pod that restarts for any reason after R2 has migrated does not come back.

*Evidence.* `kysely/dist/migration/migrator.js:449-455` (`#ensureNoMissingMigrations` called unconditionally by `#getState`), `:500` `throw new Error('corrupted migrations: previously executed migration … is missing')` **[re-verified]**. Reference: `prumo/apps/server/src/main.ts:47` `await migrateToLatest(createDb(adminPool))` before any server comes up **[re-verified]**. STACK.md:389, :390, :755.

*Fix.* Choose explicitly between two policies and write down the one that wins: (a) migration stays at boot and **application rollback stops being a recovery path** — which has to be in the runbook, with roll-forward as the only path and a test proving image N−1 comes up against schema N (that is, expand/contract becomes mandatory for every migration); or (b) migration leaves boot and becomes a separate deploy step, with the application only checking the schema at boot. Either way, the one-line rule that is missing: **the app version can only go back as far as the last EXPAND; past the CONTRACT, going back is a new migration forward.** Consequence: CONTRACT never ships in the same deploy as the EXPAND, and the interval between the two is the declared rollback window.

---

**19 · §4.5/§4.6/§8 — Migration at boot forces the runtime to carry a `db_owner` credential, which the rule on line 429 forbids.** `critical`

*Problem.* Line 429 is categorical: *"the runtime never authenticates with a credential of higher privilege than `app`."* But the migrations run at boot, as owner, in a pool inside the same process, and §8 declares **two** services only. So the application container carries the `db_owner` credential in its environment for its entire life, and at boot it opens a session whose `session_user` is `db_owner`. Closing the pool removes neither the credential nor the code path that uses it. It is the same shape as the defect measured in prumo, only with two strings — the privileged `session_user` remains reachable from inside the runtime, and the health gate only runs afterwards.

*Evidence.* STACK.md:429, :389, :562, :682. `prumo/adr/0005:22` — *"Migrations run at boot under an advisory lock."*

*Fix.* Either the migration becomes a separate deploy step (init container / job / `docker compose run --rm app migrate`), with the owner credential outside the application's environment — and §8 gains a third unit; or the rule on line 429 is rewritten to "after boot", assuming in writing that the owner credential lives in the process. As it stands, the two statements cannot both be true and the document does not choose.

---

**20 · §8 — Readiness that answers a fixed 200, and graceful shutdown in reverse order.** `critical`

*Problem.* §8 lists "health and readiness" and "graceful shutdown and pool drain" as pending and does not say the one thing that matters in each. Degraded readiness has to answer a **non-2xx** HTTP code: in the reference the route really checks the database and returns **HTTP 200** with `{status:'degraded'}` in the body — orchestrator and load balancer read the status, not the body, so the instance keeps receiving traffic with the database down; and the container healthcheck points at the liveness route, which never touches the database, so **nothing consumes the readiness signal**. On shutdown, two defects: `pool.end()` sets `ending = true` and from then on `_pulseQueue()` returns early and never drains `_pendingQueue` again — every request that was already waiting hangs forever, with no error (that is abandonment, not drain); and the reference drains the pool **before** closing HTTP, with no `app.close()`, calling `process.exit(0)` — in-flight requests lose the database out from under them.

*Evidence.* `prumo/packages/contract/src/index.ts:41-47` and `apps/server/src/http/router.ts:85` `status: 'degraded'` with no `ORPCError` **[re-verified]**; `prumo/docker-compose.yml:35-46` healthcheck on `/saude/vivo`. `prumo/apps/server/src/main.ts:97-100` — `await pool.end(); process.exit(0)`, **with no `app.close`** in `apps/server/src` **[re-verified]**. `pg-pool/index.js:488-499` and `:133-145` (the `return` precedes the logic that consumes `_pendingQueue`). PLANO.md:355 already names the antipattern: *"saúde que responde 200 fixo mente"* [health that answers a fixed 200 lies].

*Fix.* Two decision lines: liveness = the process is alive, never touches a dependency, is what the container restarts; readiness = 200/503, checks the database, is what the load balancer consults. And the shutdown sequence as a diagram, in §5.1's style: SIGTERM → readiness switches to 503 → wait the scrape interval → `app.close()` → `pool.end()` → exit, with `terminationGracePeriod` greater than Fastify's `keepAliveTimeout` (72 s by default) or the keepAlive lowered on purpose.

---

**21 · §8 — Backup and restore: the item the document itself calls the most important is the only one with no decision at all, and the reference proof is false.** `critical`

*Problem.* The document says *"a tested restore is as important as a tested migration"* and decides nothing: not what gets copied (logical `pg_dump` × volume snapshot × WAL archiving/PITR), not where it goes, not the frequency, not RPO/RTO, not who proves it. And the three options have different consequences for the rest of the document — only the logical dump survives a major upgrade, and PITR changes the disk arithmetic. Choosing after real data already exists closes doors. In the reference, the declared command points at a non-existent file: "a backup exists" is false and nothing flags it.

*Evidence.* STACK.md:755, :757. `prumo/package.json:41` `"backup": "node scripts/backup.mjs"`; `prumo/scripts/` contains only `coletar.mjs`.

*Fix.* Before the first byte of real data: method (logical `pg_dump` is the safe default for "two services"), destination off the host, frequency, RPO and RTO as numbers, and the restore test as a `verificar` step — restore into an empty database and run the integration suite against it, next to "Migration with existing data".

---

**22 · §4.1/§5.1/§6 — The isolation level is never declared, and under REPEATABLE READ the 409 becomes an auto-retryable 40001 and `SKIP LOCKED` aborts.** `high`

*Problem.* The document is about concurrency and does not say once which level `UnitOfWork` opens. Under READ COMMITTED the `UPDATE … WHERE id=$2 AND version=$3` re-evaluates the WHERE, returns 0 rows and becomes a 409, as §4.1 wants. Under REPEATABLE READ the same statement is aborted with SQLSTATE 40001 — the canonical transient-failure error, which every retry library retries. §6 orders "retry only on transient failure, of the whole use case", and under RR the version conflict **arrives dressed as a transient failure**: the use case is retried, re-reads the row at version=8, and if the `version` in the WHERE comes from the fresh read instead of the client's token, the UPDATE goes through and overwrites the concurrent write. Second effect: under RR the `SELECT … FOR UPDATE SKIP LOCKED` does not skip — it aborts with 40001 when it reaches a row updated after the snapshot, that is, the outbox worker dies under contention, which is precisely when it needs to work.

*Evidence.* Grep in STACK.md: `isolation` 0, `SERIALIZABLE` 0, `REPEATABLE` 0, `READ COMMITTED` 0 **[re-verified]**. PostgreSQL, `transaction-iso`, Repeatable Read: *"…the repeatable read transaction will be rolled back with the message ERROR: could not serialize access due to concurrent update"*; Read Committed: *"The search condition of the command (the WHERE clause) is re-evaluated…"*. The tool allows the choice: `kysely/dist/dialect/postgres/postgres-driver.js:42-53` builds `start transaction isolation level …` when `settings.isolationLevel` is passed — it is an explicit parameter, not an inherited default.

*Fix.* Declare **READ COMMITTED** as `UnitOfWork`'s level, in text and as an assertion (`SHOW transaction_isolation` inside a UnitOfWork transaction), with the exact justification. Where some use case needs RR or SERIALIZABLE, the choice is local, written down, and comes with the rule that 40001 is never retried by a use case that uses a client version token. And add the assertion missing from §6: the retry policy classifies by SQLSTATE, and the retryable list is closed and versioned.

---

**23 · §3.1 — Three owners contend for the same `bigint` advisory lock key space, and premise 3 is false for two of those collisions.** `high`

*Problem.* Premise 3 says a hash collision costs "one spurious 409". True between two commands. False for a collision with a lock that is **not** a command lock, and there are two in the same 64-bit space: migration's hand-rolled key `8140772301` and Kysely's internal key `3853314791062309107`. Command blocking deploy: a mutation with a colliding hash holds the xact lock, the new replica falls into the blocking `pg_advisory_lock` with no `lock_timeout` and hangs at boot. Deploy blocking commands: a 4-minute migration makes every mutation with a colliding hash receive a 409 for 4 minutes straight, and the client burns through its retry budget — that is not a spurious 409, it is a permanently lost command. The probability is ~2⁻⁶⁴ and that is not the point: the point is that the **reasoning recorded as a decision is wrong**, and the fix is free.

*Evidence.* PostgreSQL, `functions-admin`: *"…identified either by a single 64-bit key value or two 32-bit key values (note that these two key spaces do not overlap)."* `kysely/dist/dialect/postgres/postgres-adapter.js:4` `LOCK_ID = BigInt('3853314791062309107')` **[re-verified]**; `prumo/apps/server/src/db/migrate.ts:43` `ADVISORY_LOCK_KEY = 8_140_772_301n` **[re-verified]**, with the comment *"Arbitrary but fixed. Any other process using this same key would be a bug"* — which is exactly the assumption that needs to become a rule. STACK.md:237, :249-251.

*Fix.* Partition by construction: the application uses the **two int4** form — `pg_try_advisory_xact_lock(NAMESPACE_IDEMPOTENCIA, hash32(scope, commandId))` — and migrations stay alone in the `bigint` form. Rewrite premise 3: *"a collision between commands costs one spurious 409; a collision with an infrastructure lock costs a hung deploy or a lost command, and that is why the spaces are disjoint."*

---

**24 · §3.1/§3.2 — The idempotency record has no retention, no TTL and no purge rule, and the purge someone will add reintroduces double execution in silence.** `high`

*Problem.* Grep: `TTL` 0, `expira` 0, `purg` 0, `retenc` 0 **[re-verified]**; the only mention is "in a long idempotency window" (line 317), and the window is never defined. With no purge the table grows forever and the unique index that **is** the design's fix becomes the hottest, most bloated object in the database — and the persisted `resultado` is not a key, it is a full copy of the body of every successful response. With a purge — and someone will add one, because the absence forces it — the purge job becomes the double-execution path: record deleted at 03:00, the agent's retry at 03:00:10 finds nothing, acquires the lock uncontested, inserts, executes and **charges again**. It is literally the same outcome as v0.7's "case that almost passed", through the side door. TTL is not a maintenance parameter: it is a contract clause, because deleting a row converts a replay into a new execution — and if the value is not in the contract from day 1, there is no safe moment to choose it later.

*Evidence.* STACK.md:173, :181, :293-295, :317. Proof that the problem is real in the reference: `prumo/…/20260824_0001_base.ts:110-122` creates `processed_commands` with `result jsonb NOT NULL` and an index on `created_at` — the index a purge would use — and there is no purge routine in the repository.

*Fix.* (a) Retention declared per `scope`, the number justified by the maximum retry window of the slowest client, and that window becomes a declared field in the contract, like `operationVersion`. (b) The purge never deletes a record whose associated outbox row has not yet been delivered or has already died (see #26). (c) Once the window expires, the behaviour is **explicit**, not "executes again because it found nothing": either a tombstone (`commandId` + `status` + `completedAt`, `resultado` deleted — preserves the stable outcome cheaply and indefinitely), or a named refusal for a command older than the window. (d) Partition by `criado_em` so that expunging is `DROP PARTITION`, not a mass `DELETE`. (e) The §3.1 test gains a case: the same `commandId` resent after the TTL executes again, and that is correct and documented.

---

**25 · §3.2 — The word "version" names two different things, and the idempotency record has three field lists that do not intersect.** `high`

*Problem.* The table decides by "same version / different version" and the document defines version as `operationVersion` (a client field, immutable). Three paragraphs later it persists `idempotencySchemaVersion` and says that "hash comparison is only valid within the same version" — and that second version is the **server's**. The two rules use the same word and disagree on the case the document uses as its example. Sequence: the client sends the same bytes with the same `operationVersion: 1`; during a rolling deploy the retry lands on an N+1 pod whose schema changed the default; the projection changes, the hash changes; `operationVersion` matches → "same version" → different hashes → **"Error — key reused"**. The client sent exactly the same thing twice and was accused of reusing the key, deterministically. And the record is described three times with disjoint field sets, with two names for the scope (`scope` in the key and in the lock, `operation` in the persisted form) and two naming conventions (`criadoEm` × `completedAt`).

*Evidence.* STACK.md:173, :283, :285-289, :297-298, :309, :317, :237. The factor that makes the example inevitable: STACK.md:270 — *"If the contract does `strip`, the two are identical"*, and `strip` is Zod's object default.

*Fix.* One single table definition, with all the columns, in one place, saying whether `scope` and `operation` are the same thing. Separate the two versions into **two independent columns** in the decision table, with all four quadrants decided: the quadrant that breaks today — same `operationVersion`, different `idempotencySchemaVersion` — has to be a **replay of the stable outcome**, never a key-reuse error. And draw out the operational consequence: since the hash guard does not cross schema versions, it is not the defence against `commandId` reuse during a deploy; the defence in that window is the client's `operationVersion`, and that is why it is mandatory in the contract.

---

**26 · §3.1/§3.2/§5.1 — The stable outcome's `status` claims "completed" for an external effect that may have died, and nothing links the idempotency record to the outbox row.** `high`

*Problem.* The `resultado` and the `status` are written **before** the external effect exists, by construction. The stable outcome exposed on replay is `commandId · status · operationVersion · resourceId · completedAt`, and the document says it is enough to say "already executed". Already executed **what**? If the webhook failed N times and the row went to the dead-letter queue, the replay returns `status: concluído, resourceId: chg_123` and the client concludes the charge was processed — it was not, and the only evidence is in a dead row the record does not reference. The outbox has no `commandId`, the record has no `outboxId`, and the two halves of the "unified invariant" meet at the INSERT and never again: there is no reconciliation path, neither in the document nor possible from the described schema. And the guarantees table says the consumer must deduplicate by `outboxId` — the identity that crosses the boundary — which is not in the stable outcome the client receives.

*Evidence.* STACK.md:181, :190-197, :217, :309, :590-595, :607, :623.

*Fix.* Separate two states that today are one: `commandStatus` (the business transaction committed — always completed on replay) and `effectStatus` (`pendente`/`entregue`/`morto`), both in the stable outcome. Add `commandId` to the outbox row and `outboxId` to the record. Define the reconciliation: when a row goes to the dead-letter queue, the command's `effectStatus` becomes `morto` in the same transaction. Without the three, "unified invariant" describes an INSERT, not an invariant.

---

**27 · §4.1 — "Zero rows affected = conflict" is false: a non-existent row, or one invisible under RLS, produces the same zero.** `high`

*Problem.* The `UPDATE … WHERE id=$2 AND version=$3` returns zero in at least four cases: stale version (a real conflict), non-existent id, deleted row, and an existing row that is invisible under the RLS policy the document adopts as "the second door". A legitimate client that passes a deleted id gets a 409 ("your state is stale, re-read") instead of a 404, and enters a re-read loop that never converges — in an agent client, an infinite loop. And if some route implements the obvious path of re-reading the row to produce a 404, the oracle shows up immediately: another tenant's id → 404; your own stale id → 409, and the difference answers "does this id exist in some tenant?". The document does not say which of the two paths to follow, and both are wrong in different ways.

*Evidence.* STACK.md:349-355; RLS is a declared premise at STACK.md:104 and :747. `prumo/adr/0005` — *"Row-level security as the second door behind user_id in every repository WHERE."*

*Fix.* Distinguish the causes in a single transaction, with no second trip to the database: `WITH alvo AS (SELECT version FROM pedido WHERE id = $2) UPDATE … RETURNING …`, with three outcomes — `alvo` empty → **404** (the row does not exist *for this caller*, which is the only question the server has any right to answer, and under RLS a 404 closes the oracle by construction); `alvo` present and 0 rows → 412/real conflict; 1 row → 200. Write that under RLS "does not exist" and "is not yours" **must** be indistinguishable in the response, and that this is the reason for 404 and not 403.

---

**28 · §4.1 — Nothing guarantees the `version` increment: the discipline `rowversion` gave for free became prose.** `high`

*Problem.* The document picks the `version bigint` column and says it is "incremented in the conditional `UPDATE` itself". That describes **that** UPDATE. It describes no other write path, and there is no CHECK, trigger, lint or fitness test forcing any other one to increment. Standard failure mode of a project that generates code: a new use case does `UPDATE pedido SET estado='cancelado' WHERE id=$1` without touching `version` (it did not need to, it is an administrator transition); the client with a version=7 token matches, overwrites the cancellation and gets a 200. No 409 appeared. Under `rowversion` this was impossible. prumo's ADR 0005 lists that loss under "What we give up"; STACK.md, which inherits the ADR, erases the consequence and presents the column as equivalent. And principle 1 decides the case — a trigger is strictly more reliable than the discipline it replaces, and it was not even considered among the three candidates.

*Evidence.* STACK.md:340-355 (no mention of a trigger in the whole file). `prumo/adr/0005-postgres-over-sql-server.md`, "What we give up" — *"`generation.version` is an explicit integer column instead, which means every writer must remember to bump it — a discipline the database used to provide for free."* Principle violated: STACK.md:47-49.

*Fix.* Add the fourth candidate and pick it: a `version bigint` column **plus** a `BEFORE UPDATE` trigger per versioned table doing `NEW.version := OLD.version + 1` unconditionally. The `UPDATE … WHERE version = $3` stays the same (the barrier is the WHERE, not the increment). If the trigger is refused, enforcement moves down to somewhere else measurable — a fitness test that scans the migrations and fails a table with a `version` column and no trigger, plus a lint that fails a literal `UPDATE` on those tables outside the designated repository. What cannot stay is the sentence in prose.

---

**29 · §4.5/§3.1 — The reference implementation's migration advisory lock is session-scoped, runs on an unpinned connection and waits with no deadline.** `high`

*Problem.* §3.1's premise 1 says, in bold, that the `_xact_` variant is mandatory and that "the session one would leak between requests on the reused connection". The migration-at-boot reference does the opposite, and without the protection that would make it safe: `pg_try_advisory_lock`, `pg_advisory_lock` and `pg_advisory_unlock` as three loose statements against the `Kysely` object, not against a pinned connection. A session advisory lock belongs to the session: if the unlock lands on a different connection, it returns false with a WARNING and the lock stays — and the code discards the return value. The unrecoverable case does not depend on pool luck: a SIGKILL between the lock and the `finally` leaves the lock held until the backend dies, which with a half-open socket is TCP keepalive. And when the `try` fails, the code falls into a blocking `pg_advisory_lock` **with no `lock_timeout`**: one instance with a stuck migration makes every new instance hang at boot indefinitely, with no log and no error. The document also does not say what happens when the migration fails.

*Evidence.* `prumo/apps/server/src/db/migrate.ts:53,58,81` — three `.execute(db)` against `db: Kysely<Database>`, none inside `db.connection()` **[re-verified]**. The contrast that shows pinning is the requirement: Kysely itself pins (`migrator.js:443-447`, `this.#props.db.connection().execute(...)`) **[re-verified]**. `prumo/apps/server/src/main.ts:44` `max: 2` **[re-verified]**. PostgreSQL, `functions-admin`: locks *"can be taken at session level (so that they are held until released or the session ends)…"*; `pg_advisory_unlock`: *"If the lock was not held, false is returned, and in addition, an SQL warning will be reported by the server."*

*Fix.* Extend premise 1 to hold at boot and say how: either the migration lock becomes `pg_advisory_xact_lock` in a transaction that wraps the entire migration, or the three calls go inside a single `db.connection().execute(...)` with the unlock's return value **checked**. `lock_timeout` on the blocking wait, with the process exiting with an error code instead of hanging. And record that the hand-rolled lock is redundant with Kysely's internal one — today it is pure error surface.

---

**30 · §4.7/§4.6 — FK and UNIQUE cut through RLS: a schema decision, not a runtime one.** `high`

*Problem.* §4.7 orders invariants into the database with CHECK, FK and UNIQUE, and §4.6 puts RLS on top. The two do not compose the way the document assumes, and the PostgreSQL doc says so in one sentence. First consequence: an FK from a tenant A row to a tenant B row **succeeds**, because the parent row lookup ignores the policy — RLS hides the row from the SELECT and allows it to be referenced. Second: a UNIQUE on a table with RLS is a **global** namespace across tenants, so a 23505 is an existence oracle. None of this is cheaply retrofittable once the first migration exists.

*Evidence.* PostgreSQL, `ddl-rowsecurity`, literal: *"Referential integrity checks, such as unique or primary key constraints and foreign key references, always bypass row security to ensure that data integrity is maintained."* Owner's requirement: `rebar/docs/PLANO.md:383` — *"nunca revele se o e-mail existe"* [never reveal whether the e-mail exists] becomes an error-path test.

*Fix.* Add to §4.7: under RLS, an FK between tables with a tenant is **composite** and carries the tenant column at both ends (with a matching UNIQUE on the parent), never a simple FK by id; and every UNIQUE on a table with RLS is either globally unique **by written decision**, or composite with the tenant column. The e-mail case becomes the fixture PLANO already asked for.

---

**31 · §4.8/§8 — §4.8 orders the collation to be declared in `CREATE DATABASE`, and §8's deploy has no `CREATE DATABASE`.** `high · irreversible`

*Problem.* §4.8 decides to declare the ICU collation in `CREATE DATABASE` and to check it at boot, and does the same for the encoding. §8 ships `postgres:17-alpine` with `POSTGRES_DB`, and in that configuration the database is created by the image's entrypoint at first boot — there is no `CREATE DATABASE` under the project's control. `initdb` only runs with an empty data directory, and a database's locale provider does not change afterwards. The boot check §4.8 asks for detects the problem at the one moment when it no longer has a cheap fix: in development it means destroying the volume; in any environment with data it is a whole migration.

*Evidence.* Docker Hub `_/postgres`: `POSTGRES_DB` *"can be used to define a different name for the default database that is created when the image is first started"*; initialization *"will only run if you start the container with a data directory that is empty"*; `POSTGRES_INITDB_ARGS` *"can be used to send arguments to `postgres initdb`"*. `prumo/docker-compose.yml:48-54` defines `postgres:17-alpine`, `POSTGRES_DB`, and **no** `POSTGRES_INITDB_ARGS`.

*Fix.* Swap "declare in `CREATE DATABASE`" for `POSTGRES_INITDB_ARGS: "--locale-provider=icu --icu-locale=pt-BR --encoding=UTF8"` in the compose file, and move the check to **before the first migration**, with a message that says explicitly "the volume has to be recreated". A note that reinforces §9.5: changing base image is changing libc.

---

**32 · §4.3/§4.1 — The driver truncates `timestamptz` from microsecond to millisecond, and §4.3 does not mention it.** `high`

*Problem.* §4.3 treats time entirely as a PostgreSQL property. Not a word about the driver boundary, which is where the loss happens: `timestamptz` becomes a JavaScript `Date`, millisecond resolution; PostgreSQL stores microseconds. `12:00:00.123456+00` arrives as `.123`, with no error. It is the same class of defect §4.4 documents for money in `tedious`, only for time and with no corresponding paragraph. **It aggravates §4.1**: there, `updated_at timestamptz` is rejected as a token because "two writes in the same microsecond collide in silence"; through this driver the window is a **millisecond**, a thousand times larger than the argument assumes. Adjacent detail: `register(1114, parseDate)` builds `timestamp without time zone` with `new Date(year, month, …)`, that is, in the Node process's local time zone.

*Evidence.* `pg-types/lib/textParsers.js:176` → `register(1184, parseDate)`; `:175` → `register(1114, parseDate)` **[re-verified]**. `postgres-date@1.0.7/index.js:33` — `ms = ms ? 1000 * parseFloat(ms) : 0`, `:38` `new Date(Date.UTC(…, ms))`; `MakeTime` applies `ToIntegerOrInfinity`, so `123.456` becomes `123` **[re-verified]**.

*Fix.* A driver-boundary block in §4.3: where precision matters (idempotency window, outbox ordering, `completedAt`), read as text (`::text` or `setTypeParser(1184, s => s)`) and never assume the instant that came back is the one the database stored. And fix §4.1's argument — the right number makes the argument **stronger**.

---

**33 · §6 — The HTTP security configuration prumo already has in code is not in the document, against the document's own precedence rule on line 28.** `high`

*Problem.* Line 28 establishes that where the ADR fell behind `package.json`, the code wins. By that very criterion, prumo's Fastify configuration is the source, and it has already decided headers, rate limit, body limit, log redaction and cookie topology. §6 has five layer lines and four bullets and reproduces none of it; §10 does not list those decisions even as open. The practical result is regression: an agent scaffolding from §6 builds a Fastify with no helmet, no rate limit and the default `bodyLimit`. And §3.1 makes it worse: the document explicitly designs for 500 concurrent requests and answers with a fast 409 **at the database layer**, without ever putting a ceiling at the edge.

*Evidence.* Grep in STACK.md: `helmet` 0, `CSP` 0, `CORS` 0, `rate` 0, `cookie` 0, `ssl`/`TLS`/`sslmode` 0 **[re-verified]**. Already in code: `prumo/apps/server/src/http/server.ts:40` `bodyLimit: 2*1024*1024`, `:43` `register(helmet, …)`, `:50-58` `register(rateLimit, { max: 300, timeWindow: '1 minute' })` with a written note that the in-memory store breaks when the process is split, `:34-37` `redact`; `apps/server/package.json:15-16` declares `@fastify/helmet` and `@fastify/rate-limit`; `http/session-cookie.ts:29-35` httpOnly/sameSite lax/secure/host-only. Owner's inventory: `PLANO.md:273-275`.

*Fix.* An edge table in §6 with the same weight as the layers: helmet with a declared CSP, rate limit with the store named and the multiprocess caveat, a numeric `bodyLimit`, an upload policy. None of these is "open" — all of them are already decided in the repository the document says wins.

---

**34 · §2/§3 — Zod is cited four times and never versioned, and the two ends are on different majors.** `high`

*Problem.* §2 promises the numbers of what is installed and lists 14 packages; Zod is not among them, even though it is named in §2 (router search), in §3 (contract), in §3 (react-hook-form + resolvers) and in §3.2 (the JSON-safe projection). It is the only dependency that crosses contract, server and browser, and it is the only one with no version — and the two ends the document merges are on different majors. Porting herz's frontend on top of prumo's `packages/contract`, the app ends up with Zod 3 and Zod 4 in the same bundle: `z.infer` does not cross, `zodResolver` has to know which instance the schema came from, and the error shows up as a type incompatibility in places with no apparent relation to Zod. oRPC does not protect against this — `@orpc/contract` is agnostic via Standard Schema and declares no zod peer at all.

*Evidence.* herz `apps/web/package.json` → `"zod": "^3.25.76"` **[re-verified]**; prumo `packages/contract/package.json:24` and `apps/server/package.json:26` → `^4.4.3`, installed **4.4.3** **[re-verified]**. `@orpc/contract/package.json`: no zod peer; zod only in devDependencies.

*Fix.* Add the line to §2's table and decide explicitly: Zod 4 across the whole repository (prumo's contract and server are already there), with herz's frontend migrated at the door — or 3.25.x using the `zod/v4` subpath as a bridge. What it cannot do is stay implicit.

---

## 3. FACTUAL CORRECTIONS

| What the document says | What is true | Confirmed in |
|---|---|---|
| §10:748 — *"oRPC has a plugin for GET with `SameSite=Lax`, which does not cover `SameSite=None`"* | The plugin is `SimpleCsrfProtectionHandlerPlugin`; it applies to **every** procedure (not only GET); it is a header check (`x-csrf-token`, constant value `"orpc"`); **zero relation to `SameSite`**, which is a cookie attribute | `@orpc/server/dist/plugins/index.mjs:289-320`; grep `SameSite` in the file = 0 **[re-verified]** |
| §68 (provenance table) — *"Link preview does not execute JS · crawler / OG specification"* | The owning layer is the **framework** (what is emitted). None of the four named sources states this; the TanStack Start doc does | `ogp.me`; `developers.facebook.com/…/web-crawlers/`; `api.slack.com/robots`; `linkedin.com/help/…/a521928`; TanStack Start, SPA mode |
| §10:744 — *"An SPA does not deliver `og:image` — WhatsApp, LinkedIn, Slack and Discord do not execute JS"* (implying SEO along with it) | Googlebot **renders JS**: *"a headless Chromium renders the page and executes the JavaScript."* Indexing and unfurling are two problems with different owners and costs | Google Search Central, *javascript-seo-basics* |
| §10:744 — TanStack Start as the way out | In **SPA mode** Start prerenders only the root and saves a single `/_shell.html`: identical meta for every URL. What solves it is prerender with `crawlLinks` or SSR | TanStack Start doc, SPA mode and static-prerendering |
| §4.4:375 — *"`pg` returns `numeric` as a string by default"* presented as a driver property | Holds for the **scalar** and only in the **text protocol**. `numeric[]` (1231) → `parseFloat`; `jsonb` (3802) → `JSON.parse`; binary `numeric` (1700) → `Math.round(result*scale)/scale` | `pg-types/lib/textParsers.js:189,203`; absence of 1700 in textParsers; `binaryParsers.js:241` **[re-verified]** |
| §4.3 — time treated only as a PostgreSQL property; §4.1:345 — *"same microsecond"* | `timestamptz` → **millisecond** `Date`. The collision window of §4.1's argument is a thousand times larger than it assumes | `textParsers.js:176`; `postgres-date@1.0.7/index.js:33,38` **[re-verified]** |
| §4.6:433 — `RESET ROLE` citation with an ellipsis | The ellipsis elides the main clause: *"RESET ROLE sets the current user identifier to the connection-time setting specified by the command-line options, ALTER ROLE, or ALTER DATABASE, if any such settings exist."* | PostgreSQL 17, `sql-set-role` |
| §4.6:438 — *"The test asserts only `current_user`"* | The test asserts **three** things (`current_user`, `rolsuper`, `rolbypassrls`). The correct and stronger observation is another one: all three are scoped by `WHERE rolname = current_user`, and `session_user` is not inspected anywhere in the repository | `prumo/apps/server/tests/database.test.ts:184-194`; grep `session_user` in `prumo/apps`+`packages` = 0 **[re-verified]** |
| §4.6:477 — *"Revoking in bulk takes `gen_random_uuid()` away from the application"* | With `pgcrypto` removed (decided in §4:323), `gen_random_uuid()` is a core function in `pg_catalog`, not created by `db_owner`, therefore out of reach of `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner`. The described deploy does not break; the real risk is `citext` | PostgreSQL, `functions-uuid`, `pgcrypto`, `sql-alterdefaultprivileges` |
| §5.2:630 — *"Payload limited to 8 kB"* | 8000 bytes, not 8192 — *"In the default configuration it must be shorter than 8000 bytes."* | PostgreSQL, `sql-notify` |
| §5.1:589-595 — `FOR UPDATE SKIP LOCKED LIMIT $1` | Accepted, but **not the synopsis order**: the locking clause comes after LIMIT/OFFSET/FETCH. It is undocumented legacy syntax, in a block written to be copied | PostgreSQL, `sql-select`, synopsis; jOOQ issue #15826 |
| §3.1:239 — 409 · `Retry-After` | `ORPCError` does not carry a header: `toJSON` serializes `defined`, `code`, `status`, `message`, `data`. The header goes out via `ResponseHeadersPlugin`. And the *"202 in progress"* of line 223 is not expressible as an `ORPCError` (`isORPCErrorStatus`: `status < 200 \|\| status >= 400`) | `@orpc/client/…/client.CZlviB0y.mjs:123,133,173`; `@orpc/server/…/plugins/index.mjs:331` **[re-verified]** |
| §4.4:378 — *"`pg` also returns `bigint` (`int8`) as a string. Expecting `number` breaks"* | True as the driver default; **false as a description of the repository**: prumo already registers `setTypeParser(INT8, BigInt)`. The override is global to the process (`pg.types` is a module singleton) and applies to both pools and to the tests | `textParsers.js:167`; `prumo/…/connection.ts:32` **[re-verified]**; `pg-types/index.js:11-14,33-39` |
| §2:125 — *"Components · shadcn/ui over `@base-ui/react` · 1.6"* | 1.6 is `@base-ui/react`; every other line versions the package it names first. The `shadcn` CLI is at 4.16.0 (herz) and 4.19.0 (prumo) | herz `apps/web/package.json`; `prumo/node_modules/shadcn/package.json` **[re-verified]** |
| §2:114 — *"These numbers are what is installed"* | It does not say **where**. Against herz, the 14 match; against prumo, four already diverge (`@base-ui/react` 1.7, lucide 1.34, react-query 5.102, shadcn 4.19) and the table describes an app prumo does not have. Six real dependencies are also missing: `recharts`, `react-error-boundary`, `date-fns`, `class-variance-authority`, `tailwind-merge`, `clsx`, plus `zod` and `@ts-rest/core` (revoked in §3 and still installed) | herz `pcp-herz/apps/web/package.json` **[re-verified]**; prumo `node_modules` |
| §2 — *"33 stock shadcn components over `@base-ui/react`"* | 23 of the 33 import `@base-ui/react`; 3 wrap another library (`chart`→recharts, `command`→cmdk, `sonner`→sonner); 7 have no primitive | count in `herz/apps/web/src/components/ui/` **[re-verified]** |
| §2:135 — *"the animation comes for free — zero `@keyframes`, zero framer-motion"* | Correct in essence. Caveat: the 12 occurrences of `animate-spin` are **Tailwind core**, not `tw-animate-css`; and `prefers-reduced-motion` has zero occurrences in the whole app | grep in `herz/apps/web/src` |
| §7:659 — `APROVADO 12/12` | The table below has **10** rows. In a section whose thesis is that the denominator has to be true, the example has the wrong denominator | STACK.md:662-672 **[re-verified]** |
| History:16 — *"Eight rounds"* · §44 and §86 — *"six rounds"* | There are eight round files in `rebar/docs` (`RESPOSTA-REVISAO.md` + `-2..-8`). And line 44 says the last two principles were born of mistakes in this document, but principle 2 is justified as a measurement over six repositories | `ls rebar/docs` **[re-verified]** |
| §4:326 — Kysely `^0.29.5` + `pg` `^8.23.0`, ADR 0005 says "0.28/8.13" | **Correct.** Installed: kysely 0.29.5, pg 8.23.0, pg-pool 3.14.0, @types/pg 8.23.1, @orpc/* 1.15.0 | prumo's `node_modules` **[re-verified]** |
| §3:150 — oRPC status map covers 400/401/403/404/409/422/429/503 | **Correct** | `client.CZlviB0y.mjs:25-102` **[re-verified]** |
| §4.6:447 — `GRANT app TO app_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE` | **Valid syntax** (PostgreSQL 16+); the doc carries `GRANT island TO joe WITH INHERIT TRUE, SET FALSE;` | PostgreSQL, `role-membership` |
| §4.6:518-520 — the three `pg_has_role` assertions | **Correct**, and `MEMBER` covers indirect membership, which closes the chained `SET ROLE` | PostgreSQL, `functions-info` §9.27.2; `role-membership` |

---

## 4. INTERNAL CONTRADICTIONS

Ordered by cost. Each one is worth more than any external finding, because none of them needs an outside source to be resolved — and all of them went through eight rounds of review without being seen.

| # | Contradiction | Section A | Section B |
|---|---|---|---|
| 1 | **Duplicate-in-flight:** "Chosen: wait and replay" × "duplicate-in-flight never waits holding a transaction or a pool connection". The table and the acceptance criterion follow the rejected version | §3.1:225 (+ :179, :208) | §3.1:229-234, :237-239 |
| 2 | **409:** "409 · Retry-After" (retry) × "409, never an automatic retry" (do not retry) × §6 "a version conflict is not transient" | §3.1:239 | §4.1:355, §6:651 |
| 3 | **`pgcrypto`:** "`pgcrypto` goes" × "`pgcrypto` and `citext` create functions with EXECUTE for PUBLIC… takes `gen_random_uuid()` away from the application" — the example that justifies the hardening uses an object §4's decision has already removed | §4:323-325 | §4.6:477 |
| 4 | **Owner credential in the runtime:** "the runtime never authenticates with a credential of higher privilege than `app`" × migrations at boot, in a pool inside the same process, with two services only | §4.6:429 | §4.5:389, §4.6:562, §8:682 |
| 5 | **RLS:** classified as a "**Real gain**" with a pointer to §4.6 × listed as an open 🔴 and conditional ("If RLS is used…"). And §4.6 contains no RLS design at all | §1:104 | §10:747, all of §4.6 |
| 6 | **The health gate:** "Checking `current_user` proves the configuration was applied. Only the hostile test proves the escape does not work" × the boot gate checks `current_user` and does not check `session_user` | §4.6:514, :522 | §4.6:564 |
| 7 | **Role attributes:** the table declares `NOSUPERUSER · NOBYPASSRLS · NOCREATEDB · NOCREATEROLE` on `app` (which is `NOLOGIN`) × the hostile test asserts those four on `app_login`, the only role that logs in. The table becomes a migration, the test becomes CI | §4.6:443-444 | §4.6:522 |
| 8 | **"Version":** the decision table discriminates by `operationVersion` (a client field) × "hash comparison is only valid within the same version", where the version is `idempotencySchemaVersion` (the server's). Opposite outputs for the same input | §3.2:285-289, :297-298 | §3.2:317 |
| 9 | **Determinism:** image digest pinned because a moving tag "contradicts the determinism philosophy of everything else" × `shadcn add` in the scaffold, which is a moving tag with no lock, no hash and no version per item | §9.5:736 | §4 (the decision to run `shadcn add`) |
| 10 | **Versioning:** "MAJOR goes up when a closed decision is reverted or swapped" × 0.6 removes the `ALTER ROLE … SET role`, 0.7 removes `pgcrypto` and swaps the key scope, 0.8 swaps bounded waiting for fail-fast — three reversals, all MINOR. And the only MAJOR bump is no reversal at all | Header:6-8 | History:16-19 |
| 11 | **Round count:** "Eight rounds" × "Came out of six rounds" × "in these six rounds" | History:16 | Principles:44, :86 |
| 12 | **Step count:** `APROVADO 12/12`, in a section whose thesis is that the denominator has to be true × a table of 10 rows | §7:659 | §7:662-672 |
| 13 | **`config/`:** deterministic rule "`process.env` outside `config/`" × the layer table `dependency-cruiser` enforces has no `config/` | §9.2:706 | §6:644-648 |
| 14 | **Impossible fixture:** "old migration edited" listed as a deterministic rule × the harness requires an `aprovar/`/`reprovar/` pair with `@expect-rule`, and no file in `reprovar/` can represent a property of the VCS history | §9.2:706 | §9.3:717, :724 |
| 15 | **`int8`:** "`pg` returns `bigint` as a string; expecting `number` breaks" × the precedence rule on line 28 ("the code wins"), and the code already overrides to `BigInt` | §4.4:378 | Precedence:28 + `prumo/…/connection.ts:32` |
| 16 | **§2 against itself:** "These numbers are what is **installed**" × the table does not say where, omits six dependencies, and is already behind prumo on four packages — the line 28 rule is applied to Kysely and to `pg` in §4 and is not applied here | §2:114 | Precedence:28 |
| 17 | **CSRF × topology:** "CSRF is born together with the authentication decision" × the variable that forces `SameSite=None` is the origin topology (line 744), not authentication. And §2 keeps Vite SPA while §10 pushes TanStack Start | §10:748 | §10:744, §2 |
| 18 | **Wrong pointer:** "Driver — Direct swap — see §4.6" × §4.6 is the privilege section; the driver is in §4's preamble and in §4.4 | §1:95 | §4, §4.4 |
| 19 | **"Zero rows = conflict":** a rule with no caveat × RLS adopted as "the second door", under which an invisible row produces the same zero | §4.1:355 | §1:104, §4.6, §10:747 |

---

## 5. NOT VERIFIED — verification debt, **not** a finding

Nothing below entered BLOCKERS. Each item is a claim an agent **could not confirm in the owning layer**, listed here so nobody treats it as fact.

**Environment.** No agent managed to run against a real PostgreSQL: Docker Desktop is installed (29.4.3) but the daemon does not run, and there is no `psql` on the PATH. Every claim about server behaviour comes from the official PostgreSQL 17 doc or from `REL_17_STABLE` source, not from command output. The driver claims come from the code installed in `prumo/node_modules`, with reproduction in `node` where applicable.

1. **The simultaneity that holds up all of §3.1.** Premise 1 (STACK.md:246-247) claims the advisory xact lock is released "the same instant the idempotency row becomes visible". If the release happens **before** the commit enters the proc array, there is a window in which B acquires the lock, does not see A's row, and falls into the INSERT that blocks on the unique index — the pool hole v0.8 closed, now with no fail-fast path. The PostgreSQL doc does not make that claim in `functions-admin`, `explicit-locking`, `transaction-iso` or `mvcc`. Confirming it requires reading `src/backend/access/transam/xact.c` (order of `RecordTransactionCommit` / `ProcArrayEndTransaction` / `ResourceOwnerRelease`). **It is the same error pattern the document says it committed twice.** Top priority in the verification queue.
2. **`has_table_privilege('app_login','public.pedido','SELECT') → false` under `GRANT … WITH INHERIT FALSE`.** The "Access Privilege Inquiry Functions" section of the 17 doc does not specify whether those functions count privilege reachable only via `SET ROLE`, unlike `pg_has_role`, which is explicit. It is an unwritten premise holding up a fitness test assertion. If it comes back `true`, the correct catalogue assertion is `pg_has_role(…,'USAGE') = false` — which **is** documented. Run it once against a real PostgreSQL 17 and pin the result as a fixture, with the command and output recorded.
3. **Whether `kysely-ctl` wraps the `Migrator` some other way.** The document prescribes "Kysely + kysely-ctl", and `kysely-ctl` is **not installed** in `prumo/node_modules`. Everything claimed about the single transaction, the lock key and `lock_timeout` comes from kysely 0.29.5's `Migrator` and `PostgresAdapter`. If the CLI wraps it differently, blocker #9 has to be re-checked against it.
4. **Whether prumo's admin pool hands the same physical connection to the three advisory lock statements.** With `max: 2` and serial execution `pg-pool` reuses the idle client, so #29's defect is **latent**, not observable today. What is verified: nothing in the code prevents it, and Kysely itself pins the connection for its internal lock.
5. **There is no outbox or idempotency record implementation in either repository.** Grep for `outbox` in `prumo/apps` and `prumo/packages` finds neither table nor worker. Every §5.1 and §3.1 finding is against the **described design**, not against running code.
6. **Whether the hostile test really stays green with `pg_read_all_data` granted.** #7's conclusion comes from composing `predefined-roles.html` (no predefined role is a superuser nor has BYPASSRLS) with the literal text of the seven assertions. It is a deduction from two primary sources, not an execution.
7. **Whether `postgres:17-alpine`'s musl libc specifically degrades the non-C collations of the libc provider.** Confirmed that the libc provider's behaviour varies by platform and that ICU is OS-independent; no primary source found (musl or docker-library/postgres) on the concrete behaviour on alpine. **Blocker #31 does not depend on this** — it depends on the database being created by the entrypoint, which is documented.
8. **PostgreSQL's grammar for `FOR UPDATE` before `LIMIT`.** `src/backend/parser/gram.y` of `REL_17_STABLE` came back truncated before `select_no_parens`. Verified: the synopsis puts the locking clause last, the Compatibility section says nothing about the reverse order, and a jOOQ issue describes it as an accepted undocumented order.
9. **Whether PostgreSQL redacts values in the `errdetail` of a CHECK and NOT NULL violation** (`ExecBuildSlotValueDescription`) the same way it does for indexes. That is why the log finding restricts the claim to `where`, `internalQuery`, `constraint` and `hint`, which demonstrably do not go through redaction.
10. **The effective `max_connections` of the `postgres:17-alpine` image.** The 100 comes from the doc ("typically 100"); not verified whether the alpine image overrides it in the `postgresql.conf` generated by `initdb`.
11. **The default `TimeZone` of the `postgres:17-alpine` container.** The mechanism of `RESET ALL` erasing `SET TIME ZONE 'UTC'` is proven; if the cluster default is already UTC, the practical effect in that case is nil (the timeouts one is not).
12. **Whether Docker Compose stops restarting an `unhealthy` container with `restart: unless-stopped`.** The claim about "boot hung with nobody restarting" rests on reading the compose file, not on a test.
13. **An official statement that the crawler does not execute JavaScript.** Not found on any of the four named platforms; there is no public doc for Discord; `developer.x.com` returned HTTP 402. The claim is almost certainly true in practice, but today it has only a secondary source — and that is why blocker #13 is about provenance, not about the conclusion.
14. **herz's installed versions.** The repository has no `node_modules`; `package-lock.json` and `package.json` were used, which carry pinned versions and agree with each other, but are not an installed tree.
15. **`npm install` resolves with no peer conflict and no override** (§3:153). Verified that there is no `overrides` key and that the relevant `@orpc/tanstack-query` peer is satisfied in both repositories; `npm install`/`npm ls` were not run.
16. **Byte-for-byte against the shadcn registry:** only `badge.tsx` was diffed (identical). The other 32 have indirect evidence (no Portuguese comment, conventions intact). **`shadcn add` was not executed** — the evidence of where the command writes comes from the `registry-item` specification and from CLI 4.19.0's `dist`.
17. **`tsc` with `exactOptionalPropertyTypes` on herz** was not run (no `node_modules`). The error volume in `src/components/ui` is **declared risk, not measurement** — and the collision with §4 (regenerating `ui/` with `shadcn add`) is real: either the flag gets a declared exception for `ui/`, or every `add` can break `tsc`.
18. **Bundle, LCP, CLS and INP were not measured.** The claims are about the absence of configuration and of a verification step, not about values.
19. **The WCAG contrast numbers** come from a homegrown script (OKLCH → sRGB → relative luminance, no gamut mapping, with clamping). Not checked against an independent reference tool.
20. **`oxlint --rules`** produced no capturable output; verified only that `--jsx-a11y-plugin` exists and is off by default. §9.1's claim that oxlint's JS plugins are in alpha and get no type-awareness **was not checked against oxlint's doc**, which is the owning layer.
21. **The alicerce panel** was not accessible. The document cites it five times, including to revoke it, without ever saying what it is or where it is — which collides with principle 3's own requirement that the citation name the component.
22. **The bodies of prumo's ADRs 0003, 0011 and 0013** were not read (only titles, which match). ADR 0005 was checked word by word and checks out.
23. **Whether §7's Windows + Linux CI matrix can run "Integration with a real Postgres" on both sides.** The document does not name the provider, so there is no owning layer to consult. A tension to check once the provider is chosen.
24. **`@fastify/compress` with SSE** — the package is not installed; it entered only as an absent decision tied to the non-existence of a decision about reverse proxy / TLS terminator.
25. **prumo's suite and `verificar` were not run.** Every claim about the reference code is file reading, with path and line.

---

## 6. DUPLICATES AND DISAGREEMENTS

### Consolidated (same finding from two or more lenses)

| Consolidated finding | Lenses | What each one added |
|---|---|---|
| **Outbox: `lease_until` written and never read** (#1) | Concurrency (critical), Coherence (high) | Concurrency brought the two-worker temporal sequence and the `sql-select` literal about SKIP LOCKED; Coherence brought `explicit-locking` §13.3.2 on row lock release at commit. **Severity adopted: critical** |
| **Three server timeouts absent** (#17) | Concurrency (high), Production (critical), Security (implicit) | Concurrency brought the failing-ROLLBACK path and pg-pool's `_release` with no cleanup; Production brought the `RESET ALL` vector and the fix via `ALTER ROLE` instead of `SET`. **Production's fix is the one that closes it** |
| **Unbounded pool queue + non-existent connection budget** (#16) | Concurrency (high), Production (critical ×2) | Concurrency showed the DoS migrated from the unique index to `_pendingQueue`; Production added the rolling deploy doubling demand and `max_connections`. Merged because the fix is the same |
| **Idempotency retention** (#24) | Concurrency (high), Production (high) | Concurrency brought the sequence of the purge job reintroducing double charging; Production brought the decisive argument — **TTL is a contract clause, not housekeeping**, and that is why there is no safe moment to choose it later |
| **CSRF: the described plugin does not exist** (#12) | Factual (high), Coherence (medium), Security (coupling) | Factual and Coherence reached the same code, independently; Security contributed the real dependency (origin topology, not authentication). All three confirmed in the code **[re-verified]** |
| **`numeric[]` comes back as float** (#10) | Factual (high), Security (high) | Factual added the binary protocol; Security added the `jsonb` → `JSON.parse` and the attack on the idempotency replay, which is the graver half |
| **`SET ROLE ${role}` without quoting** (#15) | Factual (medium), Security (low) | Identical. Security added "it is the only executable code of the strongest section, therefore it will be copied literally" |
| **`pgcrypto` as a live example after being removed** (#3 in the contradictions) | Factual (high), Coherence (high) | Identical. Factual added that `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner` does not reach `pg_catalog` |
| **`int8` already overridden in prumo** | Factual (low), Security (low) | Security added the failure mode that makes the fix get reverted: `count(*)` becomes `BigInt` and `JSON.stringify` throws at the oRPC boundary, on a path with no money in it at all |
| **409 with incompatible semantics** (#11) | Concurrency (high), Coherence (high) | Concurrency brought RFC 9110 and the unused `PRECONDITION_FAILED`; Coherence brought the RFC 9457 `type` framing and §7's orphan line. Merged |
| **Migration at boot** (#9, #18, #19, #29) | Concurrency ×3, Production ×2, Coherence ×1 | Four **distinct** mechanisms over the same decision, not duplicates: single transaction + `lock_timeout`; `corrupted migrations` killing the rollback; owner credential in the runtime; session lock on an unpinned connection. Kept separate because the fixes are different |
| **§2 frontend out of date/incomplete** (#34 and factual corrections) | Factual (medium), Frontend (medium) | Factual measured the divergence against prumo; Frontend enumerated the six omitted dependencies and `shadcn` in `dependencies`. Complementary |

### Resolved disagreements

**(a) "prumo's test asserts only `current_user`" — the Factual lens against the Coherence lens.**
Coherence treated line 438 as a correct description of the measured defect and concentrated the finding on line 564. Factual claimed line 438 is **factually false**: the test asserts three things. **Factual wins**, by the document's own criterion — it cited the property's owning layer (prumo's test file) with path and line, and I re-checked: `database.test.ts:184-194` carries three `expect`, and all three are scoped by `WHERE rolname = current_user` **[re-verified]**. Both findings survive, though, because they are different things: line 438's wording is wrong **and** line 564's gate is incomplete. The correct observation is stronger than the document's: it is the scope of the `WHERE`, not the assertion count, that leaves the escape open — and `session_user` is not read anywhere in the repository.

**(b) Does Kysely's `Migrator` pin the connection? — Concurrency against Production.**
Production recorded it as not verified and framed the migration lock finding as an "absent premise". Concurrency claimed Kysely **does pin** (`migrator.js:443-447`, `this.#props.db.connection().execute(...)`) and used that as a contrast to show pinning is the requirement. **Concurrency wins**, with a code citation in the owning layer; re-checked: `migrator.js:445` and `:447` execute inside `this.#props.db.connection()` **[re-verified]**. The consequence is that the finding gets **stronger**, not weaker: `migrate.ts`'s hand-rolled lock is the only piece that does not pin, and it is redundant with an internal lock that already does — that is, pure error surface.

**(c) How many traps remain in §4.4?**
Factual said four (the two listed + `numeric[]` + binary); Security said three (the two + `numeric[]` + `jsonb`). Neither is wrong; both lists are partial. Consolidated: **five** — `bigint` (already overridden in prumo, so the text is wrong about the repository), `float8`, `numeric[]`, `jsonb`, `binary: true`.

**(d) Severity of the WCAG finding.**
Frontend marked it critical. As lead reviewer, **downgraded to CAN WAIT** with the decision highlighted: the four failures are retrofittable (OKLCH tokens in a text file), so they do not close a door. What cannot wait is **naming the level** — "AA" with no version decides neither SC 2.4.11 nor 2.5.8.

**(e) No real disagreement:** the Concurrency and Coherence lenses reached the outbox finding by different paths (one through `SKIP LOCKED` semantics, the other through a literal reading of the predicate) and converged on the same fix. That is the strongest signal of the entire review.

---

## 7. CAN WAIT

Real, verified, and not blocking the first line of code. Each item with the trigger that turns it into a blocker.

| Item | Where | Becomes a blocker when |
|---|---|---|
| **WCAG level not named**, and four computable failures in the inherited base: `lang="en"` in a pt-BR app (SC 3.1.1, A); focus in the light theme at 2.54:1 and the real default `ring-ring/50` at 1.53:1; `border-input` at 1.27:1; `--chart-1` at 2.52:1 (SC 1.4.11, AA). The five background/text pairs of the families **pass** AA in both themes | §10:750, `herz/apps/web/src/index.css`, `index.html:2` | Before writing the first component. **Decide the level now** (WCAG 2.2 AA), turn `jsx-a11y` on in oxlint (one line), and the contrast test over the tokens is cheap because the palette is data, not pixels |
| **`FOR UPDATE`/`LIMIT` clause order** and **"8 kB" → 8000 bytes** | §5.1:594, §5.2:630 | Never — but they are two lines, and §5.1's block is what agents copy. Take them along with #1's fix |
| **`LISTEN` over the pool dies in silence** (registration is per session; `idleTimeoutMillis` discards the connection and the LISTEN vanishes with no error) | §5.2 | When NOTIFY is implemented. The poller saves you from the worst, and that is why it does not block — but the latency gain §5.2 promises simply does not happen. Fix: a dedicated `pg.Client`, outside the pool, with re-LISTEN after a drop, and a test that kills the listener's connection |
| **Outbox retention not decided** (the row is marked, not deleted → it grows forever); **partial index never named** alongside the query; `autovacuum_vacuum_scale_factor` 0.2 is too late for a high-churn table | §5.1 | Before the first real load. Partition by date so that expunging is `DROP PARTITION`, not a mass `DELETE` — which generates exactly the bloat you want to avoid |
| **Observability with not a single named metric.** The two this design needs cost nothing: the pool already exposes `totalCount`/`idleCount`/`waitingCount`/`expiredCount` as getters, and outbox lag is a one-line query | §8:755 | At the first incident. Without `waitingCount` there is no way to tell "the database is slow" from "the pool is full" |
| **No TLS decision for the database**, and `pg` 8.23 already treats `prefer`/`require`/`verify-ca` as aliases of `verify-full` with a deprecation warning — in `pg@9.0` the semantics change to libpq's, and the shortest fix an agent finds is `?sslmode=no-verify`, which is `rejectUnauthorized = false` | §4, §8 | The day Postgres stops being a sibling container. Put the 9.0 change in the same paragraph as the `@types/pg` shim (§4.6:556), which is already the list of things to revisit |
| **Log rotation and a full disk are the same item.** Docker's `json-file` driver does not rotate by default (`max-size` default `-1`), and a full WAL disk causes a **PANIC**, not degradation | §8:755 | Before the first deploy that stays up more than a week. Three lines in the compose file |
| **The `pg` error carries `detail`/`where`/`internalQuery` and pino's serializer copies every own property** (`for..in`) and attaches `raw`. "Masked in the output" is the HTTP response; the log is another path | §6:653 | When there is personal data in production. The reference's `redact` uses fixed paths, which do not reach the shape of `DatabaseError` |
| **`SECURITY DEFINER` written as four conditions about how the team writes a function**, and not as a catalogue scan — so it does not see the function the team did not write, which is the dangerous one | §4.6:500-510 | Along with #7's fitness test. It becomes a query: `pg_proc` join `pg_namespace`, `prosecdef = true`, asserting `proconfig`, `proacl` and `proowner` |
| **Postgres major upgrade and secret rotation.** From 17→18 even the volume path changes; and `pg.Pool` captures the options at construction, so a password rotation is a rolling restart, and in that window the pool does not grow | §8:755, §9.5 | In the first year. Record that two passwords never coexist for the same role — therefore a new role + GRANT, not `ALTER PASSWORD` |
| **Check catalogue: 10 in §7, "12/12" in the header, 15 in PLANO called "13".** The five missing are component, accessibility, visual regression, **load** and **smoke** — and the last two are exactly the ones that would catch blockers #16, #20 and #23 before the user does | §7, PLANO.md:359-360 | Along with the count fix. Add load (criterion = #16's "declared limit") and post-deploy smoke; component/a11y/visual may stay out **with a written justification** |
| **`config/` is not a layer** and **"old migration edited" cannot have a fixture** | §9.2:706, §9.3:724 | When the fitness test harness is built. Separate content rules (lint, with fixtures) from history rules (diff check in CI) |
| **Versioning rule × history; "six" × "eight" rounds; the driver pointer to §4.6; decisions in the body with no history entry** (NFC→JCS, `exactOptionalPropertyTypes`, digest, CI matrix) | Header, History, §1:95 | Never functionally — but the document claims a document with no history does not prove it did not derive, and its own history derived |
| **Names of the five colour families.** A proposal that serves all three presets: `status-pending` / `status-active` / `status-blocked` / `status-retry` / `status-done`, with the suffix unified with shadcn's (`-foreground`, `-border`), the split written down between `destructive` (intent) and `status-blocked` (state), and lint restricting `bg-status-*` to the map. Delete along with it the duplicate declaration of `--chart-1..5` in both themes, before a `shadcn add` decides for you | §10:751 | Before the first new component. The palette itself does not need to change — only `--chart-1` |
| **i18n does not exist, and number formatting is already non-deterministic:** six `toLocaleString()` with no locale use the runtime's locale. §7 pins the clock, the seed and the time zone and **does not pin the locale** | §7:674 | Immediately **if** the `site` preset goes to SSR or prerender — it is a silent hydration mismatch. A `formato.ts` module with an explicit locale, plus lint forbidding `toLocaleString` outside it |
| **Frontend gaps badly inventoried.** These already exist in herz: error boundary (`main.tsx:68`) and loading state (`padroes/estados.tsx`, with `role="alert"` and `aria-busy`). What is genuinely missing: `form.tsx` (and the explicit decision **not** to adopt it), a **bundle budget** (`vite.config.ts` has 17 lines, no `build`, no `size-limit`, and §7 has no size step), **font preload**, an **image policy** (zero `<img>`, `loading`, `srcset` in the whole app) and **Core Web Vitals** | §2, §10 | When the `site` preset leaves paper. Bundle and CWV depend on #13 being resolved, because only then do you know which HTML to measure |
| **`prefers-reduced-motion`: zero occurrences in the whole app.** Outside AA scope (it is SC 2.3.3, AAA), but the `site` preset will have more motion than a PCP app | §2:135 | Along with the family rename. A `@media` block in `index.css`, by the same argument herz already uses for the cursor block |

---

### Lead reviewer's closing note

The document is not ready, and **it is not far off**. Twelve of the thirty-four blockers are text fixes to things the document already knows: rewrite line 225, take the ellipsis out of 433, add `session_user` to 564, swap the example on 477, adjust the snippet on 538. Another nine are one-line decisions that only need to exist (isolation, timeouts, retention, connection budget, TLS, collation in the compose file). The rest — lease ownership in the outbox, partitioning the key space, `effectStatus`, the `version` trigger, the RLS/GRANT asymmetry — is real design, and each of those five is the kind that is cheap now and expensive once data exists.

The operational recommendation is the one the document itself would prescribe: **do not open v1.1**. Open **v2.0**, because three closed decisions will be reverted (wait-and-replay, migration at boot as it stands, and the single 409), and the versioning rule on line 6 says exactly that — a rule the history has never once applied.