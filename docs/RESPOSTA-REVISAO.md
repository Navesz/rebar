# Response to the Stack review

> Everything below that says "verified" was checked against the installed source code or a
> primary source, not accepted on plausibility. Where I did not verify, it says so.

Thank you — this is the most useful review the Stack has received. I went and checked the technical claims one by one. You got the main things right, including things I had not seen. Two facts are out of date, and at one point your conclusion is right but the argument is weaker than it needed to be.

---

## 1. The `SET ROLE` bug — you are right, and the reason is even better than yours

**Adopted.** But with three corrections.

### The version premise is wrong, and the fault is ours

You read `pg 8.13` in the Stack. The project's real `package.json` says **`pg ^8.23.0`**, and what is installed is **8.23.0**. The number 8.13 came from an ADR that fell behind the code, and I propagated it into the Stack without rechecking.

That is: **there is no version incompatibility.** The version already has `onConnect`. The defect is not using it.

*(As a bonus, this is a clean case of documentation drift — exactly the class of problem the tool exists to catch. It will become a check.)*

### The success path is not the problem

You wrote that the connection "can theoretically be handed over before the `SET ROLE` finishes". Handed over, yes — but **harmlessly**, on the success path.

`pg`'s `Client` serializes through `_queryQueue` (I confirmed it in `pg/lib/client.js`). A `client.query()` fired from inside the `connect` handler enters the queue **first**, and every later query on that same client sits behind it. The comment in our code says this, and it is correct.

### The failure path is the problem, and there you are entirely right

With `pool.on('connect')`, the client **has already been handed** to the caller. If the `SET ROLE` rejects, the `.catch` emits `error` on the client — but that is a race against already-queued queries, and the failure mode is serving a query **with full privilege and RLS bypassed**. It is precisely what the mechanism exists to prevent.

With `onConnect` this stops being a race. I went to the `pg-pool@3.14.0` source, lines 288–301:

```js
if (this.options.onConnect) {
  this._promiseTry(() => this.options.onConnect(client)).then(
    () => { this._afterConnect(client, pendingItem, idleListener) },   // only HERE is the client handed over
    (hookErr) => {
      this._clients = this._clients.filter((c) => c !== client)
      client.end(() => {
        this._pulseQueue()
        if (!pendingItem.timedOut) pendingItem.callback(hookErr, undefined, NOOP)  // the acquire REJECTS
      })
    }
  )
}
```

The client only reaches the caller **after** the hook resolves, and on failure the `acquire` **rejects**. That is exactly the semantics a security boundary needs. Your recommendation is adopted.

### A trap neither you nor I had seen

`@types/pg` types the hook as:

```ts
onConnect?: ((client: ClientBase) => void) | undefined;
```

**It returns `void`, not `Promise<void>`.** It works at runtime because `pg-pool` wraps it in `_promiseTry`, but the type does not express the contract — and in a design where "the type is the executable documentation", that is exactly the kind of thing that misleads. We will use a locally typed wrapper.

---

## 2. TanStack Start — this fact is out of date

You wrote that TanStack Start is "still in Release Candidate, not stable v1" as of 25/08/2026.

**It left RC and reached stable v1.0 in March 2026.** It was RC in September 2025; the stable release came five months ago, and there are releases published on 22/08/2026.

This moves your own recommendation in its favor: the caveat that made you say "I would not automatically replace your entire base with it" falls away. For the `site` preset, TanStack Start stops being a bet and becomes the conservative option inside the ecosystem we already use.

Source: [RC announcement](https://tanstack.com/blog/announcing-tanstack-start-v1) · [releases](https://github.com/TanStack/router/releases)

---

## 3. Oxlint — you are right, and I checked

Your reading holds, and it is worse than it looks:

- JS plugins entered **alpha in March 2026**, and the documentation says explicitly that they **do not follow semver**.
- The API is compatible with ESLint v9+.
- **Custom rules with type-awareness are not supported.** Type-aware linting exists, but only for the TS-ESLint rules that already come built in.

Since almost every architectural rule we want to write is our own — "no transaction outside the `UnitOfWork`", "no `fetch` in the domain" —, and several of them would benefit from types, the split you proposed is the right one: **oxlint for the fast general lint, a small ESLint only for the policy rules, `tsc` as the type authority.** Adopted.

Source: [Oxlint JS Plugins Alpha](https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha) · [docs](https://oxc.rs/docs/guide/usage/linter/js-plugins)

---

## 4. Where you are right and I had not seen it

**`commandId` is not idempotency.** Correct, and it is a real hole. Today it is just a field riding along. It becomes a database invariant: `UNIQUE (scope, commandId)` plus `requestHash`, result and `createdAt` stored. Same id + same payload → replay of the result. Same id + different payload → error. Two concurrent ones → one executes.

**The outbox is ambiguous for an agent.** I agree, and it is serious. Showing `FOR UPDATE SKIP LOCKED` and then talking about delivery invites exactly the error of holding a transaction during I/O — which is rule no. 1 of the document. It becomes the three explicit phases: `TX1 claim + lease → COMMIT → I/O with no transaction → TX2 acknowledge`.

**`exactOptionalPropertyTypes`.** Adopted. In a PATCH with Zod and a database, the difference between `{name: undefined}` and `{}` is exactly where the bug is born.

**Migrations: expand/contract, and a lossless `down` is fiction.** You are right. Demanding that every migration revert without loss forces the agent to manufacture a feeling of reversibility — `DROP COLUMN cpf` does not revert. The policy becomes: reversible → test the `down`; destructive → forward-only with expand/contract. And the advisory lock solves migration concurrency, not compatibility between versions during a rolling deploy. Fair distinction.

**Authorization is not authentication.** A real hole. `if (!user) throw 401` does not answer "can this user modify **this** resource". It becomes an `app/` primitive, not something each route invents. And the point about the tenant context in RLS being **transaction-local** so it does not leak through connection pooling is exactly the kind of detail that only shows up in production.

**Deploy is the most immature section.** I agree without reservation. And "a tested restore matters as much as a tested migration" is the sentence that was missing — a backup never restored is a backup that does not exist.

**Moving tag.** `postgres:17-alpine` contradicts the determinism philosophy of everything else. It goes to a pinned digest. *(I did not check the numbers 18.6 / 17.11 you cited; the criticism does not depend on them.)*

**Architecture Fitness Tests.** Here you arrived on your own at the most important mechanism in the project — and it already exists, half built. The tooling we are inheriting has 15 boundary rules with **29 fixtures**, split into `pass/` and `fail/`, and a harness that **fails any declared rule that did not fire on any bad case**. It is literally the architectural prison being tested. Your list of twelve assertions becomes the expansion roadmap.

**"Everything typed" cannot turn into an illusion.** Your four levels — shape, boundary, business, system — go into the document as they are. It is better than what was written.

---

## 5. Where I disagree, or qualify

**"The agent architecture is incomplete" — right, but it is a separate document, not a gap.** The Stack is deliberately only the bottom half. The agent layer exists and is the rest of the project: an eight-level enforcement taxonomy, a decisions panel, and the generator. You described from the outside, precisely, something that already is the product. That is a good sign.

**On the MCP: I agree with the conclusion, but the problem is worse than you described.** You say you would not make an architectural guarantee depend on the agent remembering to call a tool — right. Except the measurement in the previous repository shows the MCP is not neutral, it is **expensive**: 17 guides, 1961 lines, 80 KB served per session, and the repository itself records that it turned into *"texto pago em token toda sessão"* [text paid for in tokens every session]. The rule we adopted is harder than yours: **no prose lives inside the MCP server.** Every response is derived from a versioned source at call time. A response that cannot be derived is not an MCP response — it is an ADR.

**On "a rule in Markdown will eventually be violated": we have the number.** Across the owner's six real repositories, the **three without CI are exactly the three with a broken lint right now**. And the most eloquent case is the repository that has an `AGENTS.md` with "Hard rules" and "Definition of done", `SECURITY.md`, `GOVERNANCE.md`, prettier, and a `check` script chaining it all together — **that nothing ever runs**. It has 35 lint errors. Your intuition is right; the evidence is stronger than the intuition.

**Your closing sentence becomes the second principle, with one adjustment.** You proposed: *"any rule too important for the AI to forget is too important to exist only as text."* The method we are using already has an operational formulation of that — *"se uma regra pode descer um nível, ela deve descer"* [if a rule can go down a level, it must go down] —, but yours says **why** better. Both go in.

One caveat that experience imposes, and that you do not mention: **a wrong automatic rule costs more than a missing rule.** We measured the "literal color fails" rule, which looked like the most obvious of them all — seven occurrences in the reference repository, **five of them inside comments that document the rule itself**, one a legitimate overlay veil. **Zero true positives.** If that rule had gone to production as `error`, it would have taught people to switch the gate off in the first week. Every new rule is born as a warning with a counter, and only becomes an error after proving it does not shout for nothing.

---

## Scoreboard

| Item | Verdict |
|---|---|
| `SET ROLE` needs `onConnect` | ✅ right — verified in the `pg-pool@3.14.0` source |
| The `pg 8.13` premise | ❌ the real one is `^8.23.0`; out-of-date ADR, our fault |
| Reason for the bug (unawaited promise) | ⚠️ the success path is safe because of the queue; the failure path is what breaks |
| TanStack Start in RC | ❌ stable v1.0 since March/2026 |
| Oxlint: alpha plugins, no type-aware custom rules | ✅ right — verified in the docs |
| `commandId` ≠ idempotency | ✅ adopted |
| Ambiguous outbox | ✅ adopted |
| `exactOptionalPropertyTypes` | ✅ adopted |
| Expand/contract, a lossless `down` is fiction | ✅ adopted |
| Authorization ≠ authentication | ✅ real hole |
| Immature deploy | ✅ I agree |
| Postgres moving tag | ✅ right (numbers not checked) |
| Fitness tests | ✅ and it already exists, half built |
| Splitting the `site` preset from `app` | ✅ and now with a stable TanStack Start |
| CSRF together with auth | ✅ adopted |
