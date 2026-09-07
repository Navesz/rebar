# Fourth response — I got the layer wrong, and that is worth more than the error

You are right, and the way in which you are right is the most useful thing that came out of these four rounds.

---

## 1. Conceded, and confirmed in the source that owns the semantics

I went to the installed `pg@8.23.0`, not to the PostgreSQL documentation. `lib/query.js`:

```js
// line 114
// since we pipeline sync immediately after execute we don't need to do anything here

// lines 198-201
// if we're not reading pages of rows send the sync command
connection.sync()
```

**Sync per query.** Confirmed in the driver's code. Each pipelined query has its own error boundary, and a failure in the middle does not stop the ones that follow.

Applied to the case:

```
SET ROLE app     → ERROR
SELECT secret    → EXECUTES
```

My "inversion" from the previous round is dead. node-postgres's pipeline saves nobody.

And your conclusion is the right one, simpler than the two I tried:

> Neither `pipeline off = dangerous`, nor `pipeline on = safe`.
> **`pool.on('connect')` + async initialization is not a boundary, period — regardless of pipeline.**

The formulation that goes into the ADR is yours:

> Security does not depend on ordering, on the query queue, on pipelining, nor on error propagation between commands. **`onConnect` constitutes an acquisition barrier:** the client only becomes acquirable after the privileged initialization completes successfully; if it fails, the connection is destroyed and the `acquire` rejects.

That removes the whole pipeline from the security proof, which is what a good invariant does — it reduces the number of things it depends on.

---

## 2. The real error, and why it is worth more than being right

You diagnosed it better than I would have: **the source was primary, but primary for the wrong abstraction.**

```
property I was claiming:  node-postgres error behavior
source I used:            libpq documentation / PostgreSQL protocol
```

`node-postgres` is not a libpq binding — it is its own implementation of the protocol in JS, and it **chose** Sync per query instead of Sync per segment. The PostgreSQL docs describe what the *server* does in a pipeline; they do not describe, and cannot describe, what the *driver* decides to send.

It was a plausible, well-grounded and wrong conclusion — exactly the class of failure the stack exists to make hard. I did it in a document about not doing it.

Your new principle goes in, and replaces mine:

> **A verifiable claim needs a primary source from the layer responsible for the property claimed.**

With the operational rule that follows from it: **do not skip a layer.**

| Property claimed | Who owns it |
|---|---|
| MVCC, isolation, `SKIP LOCKED` | PostgreSQL |
| Sync per query, error boundary, `onConnect` | node-postgres |
| Serialization, status map | oRPC |
| Generated SQL | Kysely |
| Link preview does not execute JS | crawler / OG specification |

My "the source needs to be primary" was insufficient and you showed it with a live case. Recorded as the stack's third principle, next to the other two.

And there is a practical consequence I would draw from it: **in an ADR, the citation has to name the component, not just the URL.** "PostgreSQL docs" and "node-postgres source" answer different questions, and writing down which of the two is being invoked forces the question "does that layer own this?".

---

## 3. `@expect-rule` — adopted with the strict grammar

I agree with closing it by grammar, including the item you added: **the harness rejects any fixture in `fail/` without at least one marker.** Without that, a new file lands in the folder, goes red for whatever reason, and nobody notices it proves nothing.

Multiple markers per fixture, as you wrote:

```ts
// @expect-rule no-db-import
// @expect-rule no-cycle
```

---

## 4. The concurrency test — adopted, and it is what was missing

Your suggestion becomes a mandatory integration test:

```
20 concurrent requests · same commandId · same payload
  → 1 business mutation
  → 1 outbox row
  → 20 semantically equal responses
```

This is better than any prose about idempotency, because it really fails when the design is wrong. And it covers both modes: `UNIQUE (scope, commandId)` on its own stops the second mutation, but only the concurrent test proves the replay does not enqueue a second outbox.

---

## 5. Canonicalization — your refinement is right and I had let it slip

You are right that "DTO after Zod" is not enough. Zod returns a JavaScript object, and JavaScript carries `undefined`, `Date`, `bigint`, `NaN`, `Infinity` — none of that exists in the JSON model RFC 8785 operates on. Handing it straight to JCS is a bug waiting for its date.

The chain stays as you wrote it:

```
Contract parse
  ↓
normalized semantic input
  ↓
JSON-safe hash projection
  ↓
RFC 8785
  ↓
hash
```

And the strongest point is the last one: **the contract declares explicitly what enters the command's identity.** `correlationId`, `clientTimestamp` and trace metadata are valid in the request and do **not** make the command semantically different. If the hash is over the whole payload, two retries with a different trace become different commands and idempotency does not exist.

So: `idempotencyPayload(input)` as an explicit projection, versioned alongside the contract and tested — not the whole payload.

---

## Scoreboard

| Item | Verdict |
|---|---|
| "pipeline is safer" | ❌ **I got it wrong** — `pg` sends Sync per query; confirmed in `lib/query.js:198-201` |
| `pool.on('connect')` is not a boundary, regardless of pipeline | ✅ your conclusion, adopted |
| Primary source **from the right layer** | ✅ new principle, replaces mine |
| `@expect-rule` with strict grammar + a fixture without a marker is an error | ✅ adopted |
| Concurrent idempotency test | ✅ adopted |
| Explicit projection for the hash | ✅ adopted |

Three rounds, three factual errors of mine, all three caught by you. The pattern in all three is the same: I stopped verifying too early, at the layer where the answer *looked* like it was. If it serves as an argument for the project — the whole stack exists because discipline does not scale, and I have just supplied three samples.
