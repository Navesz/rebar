# Second response — what I got wrong and what stays

You are right on the four changes you asked for. One of them is a factual error of mine, and the other three improve the design. I went and verified all of them, and at two points the evidence is stronger than the one you brought.

---

## 1. TanStack Start — I got it wrong, you were right from the start

I went to the official documentation. It says, verbatim:

> *"TanStack Start is currently in the **Release Candidate** stage! This means it is considered feature-complete and its API is considered stable."*

Still RC. Your original caveat held, and I knocked it down with a bad source.

The diagnosis of my error is exactly what you supposed: I accepted a search summary that mixed Medium articles with `1.x` version numbers from the TanStack Router repository. **A 1.x version dated 2026 is not the project declaring GA** — and I treated it as if it were, in a document whose entire thesis is that a claim with a number needs a source.

Scoreboard corrected: **TanStack Start in RC → your caveat was right.**

Practical consequence: the split `app` → SPA and `site` → SSR/prerender stays, but TanStack Start enters as a candidate under evaluation, not as the conservative choice. It is still the most natural one inside the ecosystem; it just cannot be sold as stable.

---

## 2. `_queryQueue` — you are right, and the reason is worse than you said

I fully accept not using a private internal as a security argument. But I went to the `pg@8.23.0` source and found something that closes the discussion for good. There are **two** relevant deprecations in `lib/client.js`, not one:

```
'Client.queryQueue is deprecated and will be removed in pg@9.0.'

'Calling client.query() when the client is already executing a query is
 deprecated and will be removed in pg@9.0. Use async/await or an external
 async flow control mechanism instead.'
```

The second one is what kills the current pattern. `pool.on('connect')` depends **exactly** on firing a query and letting the following ones queue up behind it. That is not just "a private internal" — it is behavior **with a removal date already marked**.

And I confirmed the `pipeline` you cited: it exists in 8.23 (`this.pipeline = Boolean(c.pipeline)`, and `pipeline?: boolean` in the types). With pipelining on, the ordering premise disappears.

There is one argument for `onConnect` that neither of us made explicitly: **it is immune to pipelining.** `onConnect` does not depend on queue order — it blocks the *handover* of the client. Turning on `pipeline: true` tomorrow does not break the security boundary. With `pool.on('connect')`, it breaks in silence.

Your formulation is adopted, with this addition:

> The current success flow did not demonstrate a bypass because, without pipelining, queries are processed in order — but that behavior is deprecated with removal marked for `pg@9.0`, and `pipeline: true` already invalidates it today. `onConnect` is adopted because it provides the semantics directly: no connection is made available before the privileged initialization finishes, regardless of queue order.

---

## 3. Fixtures declaring the expected rule — right, and cheaper than you imagine

Your failure mode is real: a fixture proves rule A, rule A breaks, rule B fires by accident, the fixture stays red, the harness is satisfied.

I went to look at the harness. Today it checks two things:

1. every **declared** rule fired somewhere in `fail/`
2. **zero** violations in `pass/` — the false positive assertion

That is coverage at the set level, not per file. Your hole exists.

But the missing convention **is already written**. Every negative fixture opens with the rule name in a comment:

<!-- The marker `// viola:` and the rule id below stay in Portuguese: they are the literal
     string written in the inherited fixtures and the rule id itself. Translating them would
     misquote the convention and break the file→rule pairing the harness is meant to read. -->

```ts
// viola: sem-io-externo-no-caso-de-uso
import { readFileSync } from 'node:fs'
export const ler = () => readFileSync('x')
```

That is: the 29 fixtures already declare what they expect. What is missing is the harness **reading that comment and asserting the file→rule pair**. It is ~15 lines, and it turns the fixtures into contract tests of the rules themselves, as you proposed. Adopted.

---

## 4. MCP — your reformulation is better than mine, and mine was literally impossible

You are right twice.

"MCP is expensive" is the wrong generalization. The correct one is: **an MCP that pushes static documentation into the context is expensive.** A `get_adr("0013")` tool pays only for what was asked.

And "no prose lives inside the server" is impossible to comply with — tool name, description, schema and argument description *are* prose, and they are exactly what the model reads to decide to call. I wrote a rule that the server itself violates by construction.

Your formulation goes in its place:

> **No duplicated normative documentation lives in the MCP.** The server explains the semantics of the tool itself. Architectural rule, decision, guide and invariant come from the versioned source — there are never two truths.

---

## 5. Rule classes — accepted, and I add a trap

Your correction is right and my generalization was lazy. Three classes:

| Class | Entry | Examples |
|---|---|---|
| **Deterministic** | born `error`, after the fixtures | `domain/` imports `db/` · `@ts-nocheck` · old migration edited · `process.env` outside `config/` |
| **Heuristic** | born `warn` + counter | literal color · search radius · comment density |
| **Informational** | stays a metric | token telemetry · coverage |

And your point about a warning also training the agent is the best argument against my proposal: **40 warnings a day turn into noise**, and noise teaches you to ignore the whole output. A warning is not neutral; it is attention debt.

**The trap I would add:** a deterministic rule can have perfect *detection* and incomplete *specification*. "`http/` does not reach `db/`" is mathematics — until someone needs a type-only import from `db/tipos`, which is legitimate. The preset we are inheriting already handles this, opening an exception exactly for `db/tipos`.

<!-- `db/tipos` is a folder path in the inherited preset, not prose. Renaming it here would
     make the document describe a path that does not exist. -->

Hence the construction rule: **a deterministic rule is born `error`, but the fixture set has to include the legitimate edge case in `pass/`, not only the violation in `fail/`.** Without that, what is born `error` is your confidence in the specification, not the rule.

---

## 6. Idempotency — you closed the hole I had left

Correct, and it is serious: if the key record and the business mutation are not in the **same transaction**, a crash between the two produces a double charge. My design did not say that. Adopted in the form you wrote it — claim, replay, divergent hash check, execution and persistence of the result, all in a single commit.

And the canonicalization of the `requestHash` is the detail that makes the difference between working and looking like it works: `{"a":1,"b":2}` and `{"b":2,"a":1}` are the same request and different text hashes. It goes documented, with the canonicalization defined explicitly — not left for the agent to invent.

---

## 7. Migration — your distinction is correct

Accepted: **forward-only is a migration strategy; expand/contract is a version-compatibility strategy.** They are not synonyms, and treating them as if they were hides that the real problem is `N` and `N+1` coexisting during the rolling deploy. The sequence you wrote goes into the ADR in almost visual form, for the same reason as the outbox: it is hard for an agent to invent anything else while looking at a diagram.

---

## 8. The combined principle

Adopted as it stands:

> **If a rule can go down from prose to enforcement, it must go down — but the enforcement has to be more reliable than the rule it replaces.**

It is better than the two separate formulations. The first half alone produces an idiotic CI; the second alone produces paralysis. Together they describe the only path that works.

---

## Final scoreboard

| Item | Verdict |
|---|---|
| TanStack Start in RC | ❌ **I got it wrong** — the official docs say RC. Your original caveat held |
| `_queryQueue` as an argument | ✅ you are right — and there is a second deprecation, with removal in `pg@9.0`, that closes the case |
| `pipeline: true` invalidates the ordering | ✅ confirmed in the source — and `onConnect` is immune to it |
| A fixture must declare the expected rule | ✅ right — and the convention already exists in a comment, the harness just has to read it |
| "MCP is expensive" | ✅ your reformulation is better — and mine was self-contradictory |
| Every rule is born `warn` | ✅ you are right — three classes, and a warning is attention debt too |
| Idempotency in the same transaction | ✅ my hole, closed |
| Canonicalization of the `requestHash` | ✅ adopted |
| forward-only ≠ expand/contract | ✅ adopted |
| The agent harness is a documentation boundary | ✅ correction accepted on both sides |

Of the four changes you asked for, all four go in. The document will be corrected before a single line of code is written on top of it — which is, after all, the point of the exercise.
