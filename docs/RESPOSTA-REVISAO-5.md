# Fifth response — the `RESET ROLE` is real, and worse than you thought

You found the most serious flaw of all five rounds. I went to check the code and the PostgreSQL documentation, and the hole exists — except the session identity is not "more privileged than `app`". It is the **cluster superuser**.

---

## 1. What is on disk

```
.env.example:12   DATABASE_URL=postgres://prumo:prumo@localhost:5432/prumo
ci.yml:52         POSTGRES_USER: prumo
main.ts:42        migration pool    → config.databaseUrl
main.ts:54        application pool  → config.databaseUrl   ← the SAME credential
```

And the comment in migration `0002` itself already documents half the problem:

> *"`POSTGRES_USER: prumo` in the compose file makes `prumo` the cluster **superuser**, so the app was connecting as a superuser and every policy was decoration."*

The author saw the symptom, created `prumo_app`, and closed off `current_user`. **He did not close off `session_user`** — and both pools still use the same connection string.

Real state of a runtime connection today:

```
session_user = prumo      ← SUPERUSER
current_user = prumo_app  ← restricted, via SET ROLE
```

And the test at `database.test.ts:192` asserts only `current_user`. `session_user` is never looked at.

---

## 2. The PostgreSQL documentation closes the case

I went to the layer that owns the semantics — `sql-set-role`:

> *"`RESET ROLE` sets the current user identifier to the connection-time setting … Otherwise, `RESET ROLE` sets the current user identifier to the current **session user** identifier."*

And, decisive:

> *"These forms can be executed by **any user**."*

`RESET ROLE` **is not privileged**. Any application code with raw SQL access emits that. In Kysely, it is one line.

That is, today:

```sql
SET ROLE prumo_app;   -- "safe" application
RESET ROLE;           -- current_user = prumo = SUPERUSER
                      -- RLS bypassed, DDL available
```

This needs no attacker. An agent trying to "solve a permission error" writes exactly that, and the commit message will say it solved it.

**Your sentence is right and I would harden it:** `SET ROLE` reduces `current_user`, but it does not erase the privileged identity that opened the session. And here the identity that opened the session is the most privileged one there is.

---

## 3. Your three-identity architecture — adopted

```
db_owner     schema owner · never used by the runtime
app          NOLOGIN · DML · NOBYPASSRLS · no DDL
app_login    LOGIN · NOINHERIT · zero direct privilege
```

```sql
GRANT app TO app_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
```

*(The separate `INHERIT`, `SET` and `ADMIN` options on membership landed in PostgreSQL **16**, not 17 — it works on both.)*

`INHERIT FALSE` is the piece that makes the thing work, and it is worth recording why: with `INHERIT TRUE`, `app_login` would have `app`'s privileges **automatically**, with no need for `SET ROLE` — and `RESET ROLE` would leave it still holding the DML. With `INHERIT FALSE`, it has nothing until it does an explicit `SET ROLE`.

Result:

```
RESET ROLE  →  current_user = app_login  →  zero privilege
```

**The escape hatch now reduces privilege, never elevates it.** It is exactly the property you want, and it is better than "block `RESET ROLE`", because it does not depend on blocking anything.

### An additional reinforcement the doc allows

The passage you did not quote: `RESET ROLE` falls back to *"the connection-time setting"* if one exists. So:

```sql
ALTER ROLE app_login SET role = app;
```

makes even `RESET ROLE` fall back into `app`. It is belt beyond suspenders — it **does not replace** the identity separation, because `SET ROLE app_login` is still possible. But with the two together, no path leads to greater privilege.

---

## 4. The hostile test — adopted, and it is the best thing you proposed

<!-- `tabela_protegida` is a SQL identifier in the audited codebase, not prose. -->

```sql
RESET ROLE;
SELECT * FROM tabela_protegida;
-- expected: PERMISSION DENIED
```

I agree this is worth more than checking `current_user`. Checking `current_user` proves the configuration was applied; the hostile test proves **the escape does not work**. They are different questions, and only the second is about security.

The assertion set becomes:

```
session_user == app_login
current_user == app

session_user:  not superuser · not BYPASSRLS · not CREATEDB
               not CREATEROLE · no direct DML

hostile:  RESET ROLE  →  protected SELECT  →  PERMISSION DENIED
          SET ROLE db_owner                →  PERMISSION DENIED
```

I added the last line: prove you cannot *climb* to the owner either, not only that the reset does not help.

---

## 5. `1 outbox ≠ 1 external effect` — you are right, and I nearly buried it

My "20 requests → 1 outbox row" test is correct, but the wording risked suggesting exactly-once on the external effect. It is not. The outbox is **at-least-once by construction**:

```
worker picks up the row  →  sends  →  recipient receives  →  PROCESS DIES
                                                             before marking delivered
        ↓ restart
worker picks up the same row  →  sends again
```

The rule that was already in the Stack — *"consumer idempotency is mandatory"* — cannot vanish now that idempotency and outbox have been unified. It goes explicit, at all three levels:

| Layer | Guarantee |
|---|---|
| API retry | does **not** create a second outbox row |
| Outbox retry | **may** resend the same row |
| Consumer | **must** deduplicate by `outboxId` |

Only with the recipient's cooperation does the external effect come close to exactly-once. Where the recipient does not cooperate, that becomes a conscious, documented decision, not an assumption.

---

## 6. Duplicate-in-flight — you caught the test making a decision on its own

Correct, and it is subtle. "20 semantically equal responses" picks the **wait and replay** semantics:

```
A executing · B..T arrive with the same commandId · wait · receive A's replay
```

The valid alternative would be `409` / `202 command in progress` and the client tries again.

I choose **wait/replay**, for the reason you gave — it is a simpler API for the agent and for the frontend, and it spares the client from implementing backoff for a case the server knows how to solve. But it goes **written into the ADR as a decision**, not deduced from the test. A test that decides architecture without the document noticing is exactly the class of thing the Stack exists to prevent.

---

## 7. Hash versioning — real hole

Your example is the right one:

```
v1: quantity default = 1
v2: quantity default = 10
```

Same raw payload, different normalizations, different hashes — and a `commandId` survives a deploy. In a long idempotency window, that becomes either a false conflict or an undue replay.

Persisted alongside: `operation`, `idempotencySchemaVersion`, `requestHash`. And the hash comparison is only valid within the same schema version; a different version is handled explicitly, never compared blindly.

---

## 8. Unicode in JCS — the detail that would have cost dearly

You are right: RFC 8785 does **not** do Unicode normalization; it preserves the strings. So `é` as `U+00E9` and `e` + combining accent are visually identical, byte-distinct, and produce different hashes.

The chain gains one step, and the contract decides where it applies:

```
contract parse
  ↓
semantic normalization  ← NFC only where the contract declares it
  ↓
JSON-safe projection
  ↓
RFC 8785
  ↓
hash
```

**Do not normalize everything blindly** — a filename, a cryptographic key and an external identifier may depend on the exact bytes. The contract marks which fields have human-text semantics.

---

## 9. `claim → owner → evidence` — adopted

Your naming enters as the mandatory citation format in ADRs:

```
Claim:     onConnect blocks client acquisition
Owner:     node-postgres
Evidence:  pg-pool@3.14.0 lib/index.js:288-301
```

This makes review mechanical, and forces the question I failed to ask twice: **does this layer own this?**

---

## Scoreboard

| Item | Verdict |
|---|---|
| `RESET ROLE` as an escape hatch | ✅ **real and confirmed** — and `session_user` is the cluster superuser, not just "more privileged" |
| `RESET ROLE` is unrestricted | ✅ confirmed in the doc: *"can be executed by any user"* |
| Three identities with `INHERIT FALSE` | ✅ adopted — the escape now reduces privilege |
| Hostile `RESET ROLE` test | ✅ adopted, plus `SET ROLE db_owner` |
| 1 outbox ≠ 1 external effect | ✅ you kept me from burying the consumer rule |
| Duplicate-in-flight is a product decision | ✅ wait/replay chosen, and written as a decision |
| Hash versioning | ✅ adopted |
| JCS does not normalize Unicode | ✅ adopted, with selective NFC by contract |
| `claim → owner → evidence` | ✅ adopted |

Your priority is right and becomes the next closed decision:

> **The runtime never authenticates with a credential more privileged than `app`. `RESET ROLE` must reduce privilege, or at worst keep it — never elevate it.**

Five rounds. The first three fixed mistakes of mine; this one fixed a mistake that had been in the code for a day and passed two green tests.
