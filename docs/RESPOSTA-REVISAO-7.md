# Seventh response — I opened a hole trying to close another

You are right, and this is the worst of my mistakes so far: the earlier ones were imprecision or incoherence. This one **created a correctness failure in production**.

---

## 1. Idempotency — conceded, and the root cause is worse than the symptom

My text:

> *"A retry arriving in `v2` with a key issued in `v1` **does not collide** — distinct scope, new command."*

Your counter-example kills it:

```
10:00  charge/v1/ABC  →  charge executed  →  response is lost
       deploy v1 → v2
10:05  retry commandId=ABC  →  scope (charge, v2, ABC)  →  not found
                             →  CHARGES AGAIN
```

**Idempotency protection dies exactly at the deploy** — the moment when responses are lost most often, because that is when connections drop.

### The root cause: I never said who determines the version

I wrote `operationVersion` without specifying the source. The natural reading — and the one I had in my head — is *the version of the server that is processing*. And that is precisely the one that breaks: **the key comes to identify the implementation that served it, not the command the client issued.**

Your sentence becomes a principle, and enters verbatim:

<!-- Quoted verbatim from the external reviewer: his Portuguese stays, the bracket is the translation. -->

> **Idempotência deve sobreviver a deploys. Se uma alteração de versão pode converter um retry em nova execução, a chave não está identificando o comando — está identificando a implementação que o processou.**
>
> [Idempotency must survive deploys. If a version change can convert a retry into a new execution, the key is not identifying the command — it is identifying the implementation that processed it.]

### The corrected policy

`UNIQUE (scope, commandId)` **stable across versions**. The version is an attribute of the record, not part of the key.

| Situation | Behavior |
|---|---|
| Same version · same hash | **Replay** |
| Same version · different hash | **Error** — key reused |
| **Different version** | **Never executes.** Replay of the historical result, or explicit `version_mismatch` |

Never "version changed → execute again". Whoever really wants a new `v2` operation **generates a new `commandId`**.

### Your alternative is valid, with one condition that has to be written down

Version as part of the scope works **if and only if** `operationVersion` is a **client** field, immutable, carried on every retry:

```json
{ "commandId": "ABC", "operationVersion": 1 }
```

Then the post-deploy retry still looks for `charge/v1/ABC` and finds it. But that has to be **in the contract** — never inferred from the version of the running server. Since it was not written, the natural implementation would be the wrong one.

### A hole in your own correction, and it matters

<!-- Quoted verbatim from the external reviewer: his Portuguese stays, the bracket is the translation. -->

You wrote *"replay histórico, se semanticamente possível"* [historical replay, if semantically possible]. When is it possible?

If `v1` produced a result whose shape the `v2` response contract does not express, returning that object to a `v2` client is silent shape divergence — exactly what the contract-first design exists to prevent.

But **always failing is wrong too**: the client would be left not knowing whether it was charged. It needs to learn the outcome.

So the way out is for the replay to be **self-describing about the version**:

```
replay  →  historical result  +  the version that produced it, in the envelope
```

The `v2` client receives a result marked as `v1` and knows how to interpret it. Without the mark, it parses wrong in silence — which is the same defect, one layer up. There is a `version_mismatch` error only when not even the envelope resolves it.

---

## 2. Extensions — confirmed, and it is worse than "may not govern"

I went to the `CREATE EXTENSION` doc:

> *"In this case the extension object itself will be owned by the calling user, but **the contained objects will be owned by the bootstrap superuser** (unless the extension's script explicitly assigns them to the calling user)."*

It is not "may not obey" — it is the **default behavior**. `ALTER DEFAULT PRIVILEGES FOR ROLE db_owner` only governs objects created by `db_owner`, and the extension's functions do not belong to it.

Your approach adopted: do not presume configuration, **enumerate the ACL after `CREATE EXTENSION` and after every extension upgrade**, and compare against a whitelist. It becomes a fitness test, not a migration line.

---

## 3. `pgcrypto` — you are right, it goes out

Confirmed in pgcrypto's own doc, about its `gen_random_uuid()`:

> *"**(Obsolete, this function internally calls the core function of the same name.)**"*

If that was the only reason, the extension goes out. And the gain **compounds with item 2**: one extension fewer is an entire set of functions owned by the bootstrap superuser that vanishes from the ACL surface to be audited.

It fits the Stack's criterion without reservation: fewer extensions, fewer objects, fewer ACLs, less for the agent to understand. `citext` stays, and that is a separate discussion.

---

## 4. `SECURITY DEFINER` — deterministic rule added

You are right that revoking `EXECUTE` is not the whole story. The rule ends up with four conditions, all verifiable by catalog:

```
SECURITY DEFINER  →  safe search_path declared, with pg_temp last
                  →  PUBLIC without EXECUTE
                  →  explicit owner
                  →  grant in whitelist
```

**Deterministic** class — born `error`, not `warn`.

---

## 5. `409`, not `202` — decided

You are right that I left open what are two distinct semantics.

**`409` chosen**, with `Retry-After` and Problem Details with a stable `type`:

```
409 Conflict
Retry-After: 1
type: idempotency-command-in-progress
```

`202 Accepted` implies the API **offers** asynchronous processing with a later query mechanism. That is not the case: here the command is synchronous and the client only needs to try again. Using `202` would promise a status endpoint that does not exist.

---

## 6. Your correction about `Assumptions` holds

*"The only ADR field that proves itself"* is imprecise. What is correct is what you drew: **`Claim` and `Assumptions` together produce a test obligation.**

```
Claim
  ↓ depends on
Assumptions
  ↓ each one with proof
Fitness test validates the property
```

The `Claim` alone is not testable — it is the conclusion. The `Assumptions` alone are testable but do not say what for. Together they become an executable specification, which is the point.

---

## Scoreboard

| Item | Verdict |
|---|---|
| `v1` retry turning into a new command in `v2` | ❌ **my bug, and the worst of them** — double charge at the deploy |
| Key stable across versions, version as attribute | ✅ adopted |
| Version in the scope only if it comes from the client, in the contract | ✅ adopted, with the condition written down |
| "Replay if semantically possible" | ⚠️ undefined on both sides — resolved with a versioned envelope |
| Extensions: bootstrap superuser objects | ✅ confirmed in the doc — it is the default, not an exception |
| `pgcrypto` goes out | ✅ confirmed obsolete |
| `SECURITY DEFINER` + `search_path` | ✅ adopted as a deterministic rule |
| `409` with `Retry-After` | ✅ decided |
| `Claim` + `Assumptions` = test obligation | ✅ your formulation is the correct one |

Seven rounds. This mistake is different from the other six: the earlier ones were imprecision, wrong source or internal contradiction — **this one would have charged the same client twice, during a deploy, in silence.** And it was born from the omission of one word: I wrote `operationVersion` without saying whose.

It is the strongest argument that has appeared in favor of the `Assumptions` field. The unwritten premise was *"the version comes from the client"* — and without it written, the natural implementation is the one that breaks.
