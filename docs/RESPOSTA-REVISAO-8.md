# Eighth response — the pool was the hole, and my fix did not reach it

The three points hold. The second reveals that my previous fix was cosmetic, and the third is the most serious of the round: perfect correctness that still takes the backend down.

---

## 1. Extensions — I over-generalized, and the precision matters

You are right. The rule is not "extension objects belong to the bootstrap superuser". It is:

> **For a *trusted* extension installed by a *non-superuser* role,** the contained objects belong, by default, to the bootstrap superuser — unless the extension's script explicitly assigns them to the caller.

Normally, whoever runs `CREATE EXTENSION` becomes the owner of the objects. My sentence "it is the default, not an exception" was wrong as a general rule.

And you are right about `citext` — I confirmed it in the doc:

> *"This module is considered **"trusted"**, that is, it can be installed by non-superusers who have `CREATE` privilege on the current database."*

**A refinement the correction exposes.** In both configurations the audit remains necessary, for opposite reasons:

| Who installs | Owner of the objects | Problem |
|---|---|---|
| Superuser (what the compose file does today) | the superuser itself | superuser-owned object ACL, with `PUBLIC EXECUTE` by default |
| non-superuser `db_owner` (the target architecture) | **bootstrap superuser**, because `citext` is trusted | `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner` does not reach it |

That is: the post-`CREATE EXTENSION` ACL audit is not contingent on one case — it is mandatory in both. Only the reason changes. That reinforces your proposal instead of weakening it.

---

## 2. The versioned envelope was `result: unknown` in disguise

You are right and this is the kind of criticism I would not have made on my own. `{ version: 1, result: … }` does **not** tell the `v2` client how to parse the `result`. I solved the honesty and opened a type hole — **right inside the idempotency**, which is the worst possible place for one.

Your rule enters verbatim:

<!-- Quoted verbatim from the external reviewer: his Portuguese stays, the bracket is the translation. -->

> **`version` como discriminador só funciona se o contrato contiver os schemas que esse discriminador pode selecionar.** Sem isso, é `unknown` com nome bonito.
>
> [`version` as a discriminator only works if the contract contains the schemas that discriminator can select. Without that, it is `unknown` with a pretty name.]

### Option B adopted

Separate two things I had fused:

| | Stable across versions? | Content |
|---|---|---|
| **Idempotent outcome** | **Yes** | `commandId` · `status` · `operationVersion` · `resourceId` · `completedAt` |
| **Operation result** | No — it is typed per version | The response object of that version |

- **Replay on the same version** → the stable outcome **plus** the original typed result.
- **Cross-version replay** → **only the stable outcome.** It is enough to say *"it already executed, do not execute it again, and this was the resource created"*, which is the only thing the client needs to know in order not to charge twice.

This avoids forcing the current client to understand every historical response, and avoids maintaining a discriminated union of old schemas for the entire TTL — which was option A, rigorous and with a maintenance cost nobody pays for long.

The `resourceId` in the outcome is what makes option B work: the client that needs the resource's current state **fetches it**, in the current version's shape. There is no translation of a historical shape.

---

## 3. The pool — my previous fix did not reach the problem

This is the most important finding of the round, and you are right that I treated the symptom.

I wrote "bounded wait at the HTTP layer". But we **also** decided that the idempotency record, the business mutation and the outbox go in the same transaction. So:

```
A:  BEGIN · INSERT commandId=ABC · works 2 s · COMMIT
B:  INSERT commandId=ABC  →  blocks on the unique index, waiting for A to finish
```

The unique index cannot decide whether there is a conflict before knowing the fate of A's transaction. **B's connection has already been consumed.** An HTTP timeout does not give back a connection that Postgres is holding.

With 500 duplicates: 1 working, 499 pool connections stalled. **The exhaustion vector the bounded wait was supposed to prevent is still open** — it only changed layer.

### The invariant, stronger

> **A duplicate-in-flight never waits while occupying a transaction or a pool connection for the HTTP window.**

### The fail-fast coordination

I confirmed the mechanism in the doc:

> *"This will either obtain the lock immediately and return `true`, or **return `false` without waiting** if the lock cannot be acquired immediately."*

```
A  →  pg_try_advisory_xact_lock(hash(scope, commandId))  →  true   →  runs the transaction
B  →  pg_try_advisory_xact_lock(same key)                →  false  →  returns the connection
                                                                   →  409 · Retry-After
```

Three premises that need to be written down, because each one is a way for this to go wrong in silence:

1. **It has to be the `_xact_` variant.** It is released at the end of the transaction, with no manual release — the same instant the idempotency row becomes visible. The session variant would leak across requests on the pool's reused connection.
2. **The lock comes before the `INSERT`**, and is keyed on the same scope as the unique index. Out of order, B still blocks.
3. **Hash collision is acceptable, and why.** An advisory lock takes a `bigint`, so `commandId` has to be hashed, and two distinct commands can collide. The cost is a spurious `409` — the client tries again. **Correctness stays in the unique index**, not in the lock; the lock is only the fast path. Whoever does not know this will "fix" the collision by removing the lock, and the pool hole comes back.

### The test, with the assertion that was missing

```
500 concurrent requests · same commandId

→ 1 business mutation
→ 1 outbox row
→ no duplicated execution
→ peak database connections  ≤  declared limit     ← the one that was missing
→ excess duplicates receive a replay or 409
```

Without the peak-connections line, the test passes a correct implementation that takes the process down. With it, the test is about **correctness under concurrency**, which is what you pointed out.

---

## 4. On `Retry-After`

I accept your caveat that the RFC describes `Retry-After` mainly for `503` and `3xx`. It stays as an **application convention** alongside the Problem Details, and the contract makes it explicit that the client decides by the `type`, not by the status:

```
409 Conflict
Retry-After: 1
type: idempotency-command-in-progress
```

The stable `type` is the contract; the status is a courtesy to generic intermediaries.

---

## Scoreboard

| Item | Verdict |
|---|---|
| "Extension objects belong to the bootstrap superuser" | ❌ **I over-generalized** — it holds for trusted + non-superuser. `citext` is trusted (confirmed) |
| Post-extension ACL audit | ✅ mandatory in **both** configurations, for opposite reasons |
| Versioned envelope solves the typed replay | ❌ it was `unknown` in disguise |
| Stable idempotent outcome × typed result | ✅ option B adopted |
| Bounded wait at the HTTP layer solves the pool | ❌ **does not reach it** — the connection was already consumed at the unique index |
| `pg_try_advisory_xact_lock` fail-fast | ✅ adopted, with the three premises written down |
| Test with peak connections | ✅ adopted — without it the test passes a DoS |
| `Retry-After` as convention | ✅ with the `type` as the contract |

Your two questions are answered like this:

**How does a `v2` client interpret a historical `v1` result in a typed way?**
It does not. Cross-version returns only the stable outcome, and whoever needs the state fetches the resource in the current shape.

**How do 500 retries stop consuming 500 connections?**
They never reach the unique index. `pg_try_advisory_xact_lock` returns `false` without waiting, the connection goes back to the pool, and the duplicate receives a `409`.

Eight rounds. The last three followed the same format: I fix the mistake you point out, and the fix hides another one layer below — version in the scope, then an envelope with no schema, then a wait in the wrong place. **It is the exact description of why `Assumptions` needs to exist**: each of those fixes was true under a premise I did not write.
