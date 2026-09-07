# Sixth response — the contradiction is mine, and it is the most instructive

You found a logic bug inside my own response. I accept the three points, and the first deserves a diagnosis beyond the fix.

---

## 1. The contradiction — and how it was born

You are right, and the two things are mutually exclusive:

<!-- `tabela_protegida` is a SQL identifier in the audited codebase, not prose. -->

```sql
ALTER ROLE app_login SET role = app;   -- §3, "reinforcement"
```
```sql
RESET ROLE;  SELECT * FROM tabela_protegida;  -- §4, expected: PERMISSION DENIED
```

If the `ALTER ROLE` exists, `RESET ROLE` falls back to the *connection-time setting*, which is `app` — and `app` **has** the DML. The `SELECT` would succeed. The test I wrote would fail the configuration I had just proposed.

**Adopted resolution: the `ALTER ROLE` goes out.**

```
normal state       session_user = app_login    current_user = app
RESET ROLE     →   current_user = app_login    →  fail closed
```

<!-- Quoted verbatim from the external reviewer: his Portuguese stays, the bracket is the translation. -->

Your formulation is the right one: *qualquer tentativa de abandonar a role operacional deixa a conexão inútil, não mais privilegiada.* [any attempt to abandon the operational role leaves the connection useless, not more privileged]. And it is worth recording the contrast you raised — in the alternative architecture, with the `ALTER ROLE`, the test would have to be `SET ROLE NONE` and not `RESET ROLE`. Not mixing the two is the right decision; the Stack has been winning precisely by reducing accidental dependency.

### The diagnosis, which is worth more than the fix

I added that `ALTER ROLE` as a "belt beyond suspenders", in one paragraph, **without checking it against the test I had written two sections earlier, in the same document, in the same session.**

This is not drift between documents over months. It is internal incoherence in a single text written in one sitting. And it is the most direct argument there is in favor of the project's thesis: **you cannot trust human review to keep two sections of one document consistent with each other.**

Concrete consequence, and it goes into the ADR standard: **the configuration and the test that proves it live in the same block.** Split across sections, nothing guarantees they keep talking about the same thing — as it just failed to guarantee.

---

## 2. "Zero privilege" is wrong — confirmed in the doc

I went to `ddl-priv`. The documentation is explicit:

> *"PostgreSQL grants privileges on some types of objects to `PUBLIC` by default … `CONNECT` and `TEMPORARY` privileges for databases; `EXECUTE` privilege for **functions and procedures**; and `USAGE` privilege for languages and data types."*

So `app_login` never had zero privilege. The corrected wording is yours: **zero application privilege, granted directly or inherited** — and `PUBLIC` needs to be audited, not presumed.

And your point about `SECURITY DEFINER` is the real escalation path: a function created by the owner, with `EXECUTE` to `PUBLIC` by default, runs **with the owner's privileges**. An `app_login` "with no DML" calls it.

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE db_owner
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE TEMP ON DATABASE prumo FROM PUBLIC;   -- if no temporary table is used
```

### Two practical traps I would add

**`ALTER DEFAULT PRIVILEGES` only affects the future.** It changes what will be created from then on; **functions that already exist need an explicit `REVOKE`**. The doc itself reinforces the timing: *"For maximum security, issue the `REVOKE` in the same transaction that creates the object; then there is no window in which another user can use the object."* So the revoke goes into the same migration that creates the function, and there is a one-off sweep for what already exists.

**The extensions will break on day 1.** `pgcrypto` and `citext` create functions, and they are born with `EXECUTE` to `PUBLIC`. Revoking in bulk takes `gen_random_uuid()` away from the application. That is: the revoke comes accompanied by an explicit `GRANT EXECUTE` to `app` on the short list of what it actually uses. This is good — it turns "which functions the application calls" from an assumption into a versioned list — but if it is not anticipated, the first deploy breaks and someone reverts the whole hardening out of haste.

---

## 3. Effective privilege, not attribute — adopted

Your distinction is the right one: my list proved **configuration**, not **capability**.

<!-- `public.pedido` and `f_sensivel()` are SQL identifiers in the audited codebase, not prose. -->

```sql
-- catalog: effective capability
pg_has_role('app_login', 'db_owner', 'SET')     → false
pg_has_role('app_login', 'app',      'USAGE')   → false   -- due to INHERIT FALSE
pg_has_role('app_login', 'app',      'SET')     → true
has_table_privilege('app_login', 'public.pedido', 'SELECT') → false
has_function_privilege('app_login', 'f_sensivel()', 'EXECUTE') → false

-- behavior: the escape does not work
RESET ROLE        → protected SELECT → PERMISSION DENIED
SET ROLE db_owner                    → PERMISSION DENIED
```

**A catalog assertion catches configuration; hostile execution catches reality.** Both, not one.

---

## 4. Duplicate-in-flight needs a limit — real hole

You are right, and the scenario is concrete: 500 requests with the same `commandId`, the first one stuck for 25 seconds, all of them holding an HTTP connection and possibly a pool connection. **Idempotency becomes a resource-exhaustion vector.**

And the aggravating factor you named is what matters most here: in a stack for agents, one wrong loop generates duplicates in volume, not one or two.

```
duplicate-in-flight
  → bounded wait
  → A finishes inside the window   → replay
  → blows the window               → explicit 409/202, client tries later
```

The normal path keeps the simple API that motivated the choice; the pathological case stops taking the process down.

---

## 5. Cross-version — you are right, I identified it and did not decide

*"A different version is handled explicitly"* is not a policy, it is postponement with the appearance of a decision. Closing it with your proposal:

**The identity of idempotency is `(operation, operationVersion, commandId)`.** It is not the `commandId` alone with the version attached as metadata — the version is part of the **scope**.

```
createOrder · v1 · uuid     ← its own scope
createOrder · v2 · uuid     ← another scope
```

Consequences, and they are what makes the policy usable:

- A hash is only compared **inside the same scope**. There is never a comparison between normalizations of different versions.
- A retry arriving during `v2` with a key issued in `v1` **does not collide** — it falls into a distinct scope and executes as a new command.
- The old version stays processable throughout the entire idempotency TTL.

That is more mechanical for the agent than any rule about "handling it explicitly", which is the real test of a good policy in this stack.

---

## 6. `Assumptions` as a fourth field — adopted, with one requirement

Your argument is the strongest of the round: **several failures across these six rounds were not in the claim, they were in a hidden premise.** `RESET ROLE` is the pure case — the statement "SET ROLE restricts current_user" was true; the premise "and the session identity is not more privileged" was never written nor checked.

```
Claim:        RESET ROLE does not elevate privilege
Owner:        PostgreSQL
Evidence:     sql-set-role · ddl-priv
Assumptions:  session_user = app_login
              app_login has no SET to db_owner
              app_login does not inherit app  (INHERIT FALSE)
              PUBLIC offers no privileged path
```

The requirement I would add: **each `Assumptions` line has to be individually testable, and becomes an assertion in the fitness test.** The four above already do, respectively: `session_user`, `pg_has_role(...,'SET')`, `pg_has_role(...,'USAGE')` and the `PUBLIC` sweep.

Without that, `Assumptions` becomes more prose — and prose is exactly what the Stack is trying to get off the critical path. With it, it is the only ADR field that proves itself.

---

## Scoreboard

| Item | Verdict |
|---|---|
| `ALTER ROLE` × hostile test contradiction | ✅ **my bug** — the `ALTER ROLE` goes out, fail closed on `app_login` |
| Do not mix the two architectures | ✅ adopted |
| "Zero privilege" is wrong | ✅ confirmed — PUBLIC gives CONNECT, TEMPORARY, EXECUTE, USAGE |
| `SECURITY DEFINER` as escalation | ✅ adopted, with explicit revoke + grant |
| Effective privilege via `pg_has_role` | ✅ adopted — catalog **and** hostile execution |
| Bounded wait on duplicate-in-flight | ✅ real hole, closed |
| Scope `(operation, version, commandId)` | ✅ adopted |
| `Assumptions` in the ADR | ✅ adopted, with the requirement that it be testable |

The new principle enters as it stands:

> **The fallback role must be less privileged than the operational role, and the effective privileges — including those inherited from `PUBLIC` — need to be proved, not presumed.**

Six rounds. Three factual mistakes of mine, one logic bug of mine, and one real vulnerability in the code. The pattern of the five is the same: **the failure was never in the statement, it was in the premise nobody wrote.** That is why the fourth ADR field is the one that will pay off most.
