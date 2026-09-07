# Domain · Database privilege

**Status: PROVEN** · 16/16 assertions green against a real PostgreSQL 17.2 · 26/08/2026

The first closed domain of rebar. Not "the document looks correct" — the criterion is the
one agreed in the review: `Claim` + `Assumptions` + migration + positive test +
hostile test + observed failure mode + no known bypass.

---

## Claim

> Abandoning the operational role **never elevates privilege**.

| | |
|---|---|
| **Owner** | PostgreSQL — `sql-set-role`, `ddl-priv`, `sql-createextension` |
| **Evidence** | `migrations/0001_papeis.sql`, `migrations/0002_tabela_protegida.sql`, and the 16 assertions of `privilegio.test.mjs` running against PostgreSQL 17.2 |

### Assumptions — each one becomes an assertion

| Premise | Executable proof |
|---|---|
| `session_user = app_login` | `SELECT session_user` |
| `app_login` cannot become `db_owner` | `pg_has_role('app_login','db_owner','SET') = false` |
| `app_login` does not inherit `app` | `pg_has_role('app_login','app','USAGE') = false` |
| `app_login` can become `app` | `pg_has_role('app_login','app','SET') = true` |
| **There is no connection-time `role`** | `current_setting('role', true)` empty after `RESET ROLE` |
| `PUBLIC` offers no privileged path | `has_function_privilege(…,'EXECUTE') = false` on the `SECURITY DEFINER` bait |
| None of the three roles is a superuser or bypasses RLS | `pg_roles` |
| The set of memberships is exactly `{app_login → app}` | `pg_auth_members` |

The connection-time premise is the one that decides the case, and it came **hidden behind
an ellipsis** in the document's quotation. There are three vectors, and the third does not
go through SQL: `ALTER ROLE`, `ALTER DATABASE`, and `options=-c role=app` in the connection
string or `PGOPTIONS`.

---

## What to run

```bash
npm test
```

It needs a PostgreSQL at `127.0.0.1:55432` with the `rebar_teste` database and the two
migrations applied — 0001 as superuser, **0002 as `db_owner`**. That 0002 runs as
`db_owner` is part of what the test proves.

---

## The finding only the code found

Neither the human review nor the six agents caught it, because it only shows up when the
connection goes back to the pool:

> **`onConnect` is a barrier per PHYSICAL connection, not per checkout.**

```
checkout            current_user = app          ✓
RESET ROLE          current_user = app_login
release  →  pool
NEXT checkout       current_user = app_login    ← onConnect did not run again
```

In this design it **fails closed**: the next request loses privilege and takes a `42501`.
But in a design where the `session_user` were privileged — **prumo's current state**, where
`POSTGRES_USER=prumo` is the cluster superuser — it would fail **open**: one pool
connection running as superuser for *every request that follows*, not only for the one
that called `RESET ROLE`.

This aggravates the original finding. It is not "`RESET ROLE` gives superuser in this
request", it is "**in this request and in every next one on that connection**".

### The fix, and why it fits

```sql
BEGIN;
SET LOCAL ROLE app;   -- first statement of every transaction, in the UnitOfWork
…
COMMIT;               -- reverts on its own, nobody has to remember to clean up
```

Measured: `SET LOCAL ROLE` **cures an already poisoned connection** and reverts at COMMIT.
The Stack already demands *"uma transação por caso de uso, aberta só no `UnitOfWork`"*
[one transaction per use case, opened only in the `UnitOfWork`] — so the fix adds no new
discipline, it only moves the existing one to where it already was.

`onConnect` stays, as an acquisition barrier and defense in depth.

---

## Boundary still open

**The tenant channel is not closed.** A custom GUC is `USERSET`: the session itself swaps
its own tenant context. There is a test that **documents the failure** instead of hiding
it — when the channel is closed, that test inverts.

That is why the domain closes on **role isolation**, not on tenant isolation. They are two
domains, and mixing them into a single commit is what the review advised against.

---

## Scoreboard

| Category | Assertions |
|---|---|
| Positive | 3 |
| Hostile | 5 |
| Catalog (effective privilege) | 3 |
| Acquisition barrier (driver layer) | 1 |
| RLS | 2 — one passes, one documents the open boundary |
| Finding + fix | 2 |
| **Total** | **16 green** |
