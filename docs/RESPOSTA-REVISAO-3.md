# Third response — the pipeline, and an inversion

You are right about `pipeline: true`. I went to the primary PostgreSQL documentation and it contradicts me literally. But the source also brings something that inverts the conclusion on both sides.

---

## 1. Conceded — and the exact quote

`libpq-pipeline-mode`, official documentation:

> *"The server executes statements, and returns results, **in the order the client sends them**."*

Full stop. Pipelining removes the wait for the result, **not** the order. My sentence "with pipelining on, the ordering premise disappears" is wrong. Your formulation goes in its place:

> `pipeline: true` does not invalidate PostgreSQL's execution order, but it allows concurrent dispatch without waiting for the initialization result. The security boundary must not depend on ordering or on queueing: `onConnect` prevents the client from being acquired before the privileged initialization finishes **successfully**.

And your framing is the right one: **the problem was never ordering, it was the absence of an acquisition barrier.**

---

## 2. The inversion: pipelining is safer, not less safe

The same page carries the error behavior, and it dismantles what I had implied:

> *"If any statement encounters an error, the server aborts the current transaction and **does not execute any subsequent command in the queue** until the next synchronization point; a `PGRES_PIPELINE_ABORTED` result is produced for each such command."*

That is: **in a pipeline, a `SET ROLE` that fails aborts the queries that follow.** The failure path is protected for free.

The dangerous one is the **default** mode, without pipeline — where each query has its own Sync, and a `SET ROLE` that fails **does not stop** the next query from executing. With full privilege.

I had said that turning on `pipeline: true` would break the boundary. It is the opposite: it is today, without pipeline, that the window exists. I got it wrong twice in the same sentence — in the mechanism and in the direction.

What this reinforces is precisely your thesis, and in a harder form: **the correct behavior depends on a setting nobody declared explicitly, and it can change.** It is exactly the kind of accidental guarantee that cannot hold up a security boundary. `onConnect` makes the question irrelevant.

---

## 3. `@expect-rule` — adopted, and you close a hole I left

I agree entirely. A structured marker in place of a free-form comment, with the four validations you listed:

<!-- The rule id below stays in Portuguese: it is an identifier in the inherited rule set,
     not prose. Renaming it here would invalidate the markers already written in fixtures. -->

```ts
// @expect-rule sem-io-externo-no-caso-de-uso
```

- the rule exists in the declared set
- the fixture references N valid rules
- each declared rule **actually fired in that file**
- **no undeclared rule fired there**

The last item is the one I had not proposed, and it is the one that really closes the hole. Without it, a fixture can stay red for the wrong reason indefinitely.

And your point about the typo is concrete: `// viola: sem-io-externo-caso-de-uso` (missing one `-`) would today pass as free text and would create a second point of ambiguity. A marker validated against the rule registry eliminates that.

An implementation note: a fixture can legitimately violate two rules at once — a file that imports `db/` **and** closes a cycle. The `N rules` in your specification covers that, as long as they are declared. It is worth saying explicitly, otherwise someone writes the parser accepting only one.

---

## 4. The unified invariant — it is the best contribution of this round

Adopted as you wrote it:

> **Every idempotent mutation that produces an external effect must persist business state, idempotency record and outbox row in the same transaction.**

This connects two decisions that were being discussed separately, and the design becomes:

```
BEGIN
  claim commandId
  apply the domain change
  write the business state
  write the outbox row
  write the idempotency result
COMMIT
        ↓
outbox worker  →  external effect
```

One subtlety worth recording alongside it, otherwise someone discovers it in production: **on the replay path, no new outbox row may be written.** A retry with the same `commandId` and the same hash returns the stored result and does not re-enqueue the effect. Otherwise the database idempotency exists and the external effect duplicates all the same — which is precisely what the invariant exists to prevent.

---

## 5. Canonicalization — you are right not to let us invent it

<!-- The function name and the JSON keys in this section stay in Portuguese: they are
     identifiers and payload keys quoted as they exist, not prose. -->

A homemade `ordenarObjetoRecursivamente()` is exactly the kind of function that is born in fifteen minutes and turns into a reconciliation bug six months later.

Of your two options, I prefer the second, for the reason you gave yourself:

```
Zod parse → normalized DTO → canonical serialization → hash
```

Because what decides whether `{"quantidade":1}` and `{"quantidade":1,"campoIgnorado":"x"}` are the same command **is the contract**, not the hash. If the schema `strip`s the extra field, the two are the same request and must have the same hash. If the schema is `strict` and rejects it, it never reaches the hash. Hashing the raw text before the parse puts that decision in the wrong place — and in a contract-first design, it is the only place where it should not be.

JCS/RFC 8785 comes in as the canonical serialization **after** the parse, not in its place.

---

## 6. On RC not meaning "do not use"

I accept the nuance, and it matters for the real decision. The team declares the API stable and feature-complete; the defect of my first response was calling it GA, not recommending it.

It goes into the document like this: **TanStack Start is a strong candidate for the `site` preset, in RC, with an API the team itself declares stable.** Choosable, with the stage said out loud — not sold as stable.

---

## Scoreboard

| Item | Verdict |
|---|---|
| `pipeline: true` removes ordering | ❌ **I got it wrong** — the docs say "in the order the client sends them" |
| Pipelining makes the boundary worse | ❌ **I got it wrong backwards** — in a pipeline, an error **aborts** the ones that follow; the dangerous mode is the default |
| The problem is the acquisition barrier, not ordering | ✅ your framing, adopted |
| Structured `@expect-rule` | ✅ adopted, with "no unexpected rule fired" |
| Unified idempotency + outbox invariant | ✅ adopted — best contribution of the round |
| Canonicalization by the contract, not homemade | ✅ adopted |
| RC ≠ do not use | ✅ nuance accepted |

Two rounds, two factual errors of mine, both caught by you going to the primary source. The process is working — and it is literally the mechanism the stack tries to automate: **a claim with a number needs a source, and the source needs to be primary.** I failed at that twice in a document that preaches it, which is the most honest argument there is for the rule being machine and not discipline.

I will apply the corrections to `STACK.md` before it becomes an ADR.
