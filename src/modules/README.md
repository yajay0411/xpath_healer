# Modules

The pipeline runs left to right. Each module owns one stage, exposes its public surface
through `index.ts`, and knows nothing about the stage after it.

```
Jenkins ──▶ intake ──▶ [event] ──▶ healing ──▶ pull request ──▶ human
                 │                     │
                 └──── platform ───────┘
```

| Module     | Owns                                                             | Depends on |
| ---------- | ---------------------------------------------------------------- | ---------- |
| `intake`   | What arrived from CI, and whether it looks like XPath drift       | `platform` |
| `healing`  | What to do about it, and every gate that says "no"                | `platform` |
| `platform` | Database, blob storage, event bus. No domain knowledge whatsoever | —          |

Import across a boundary through the barrel (`@/modules/intake`), never into another
module's internals. Within a module, import by path — barrels there would only invite cycles.

## `intake`

Ends the moment an event is published. It never heals anything, which is what lets a
normalizer bug be replayed from `webhook_log.raw_payload` without re-running a build.

- `normalize.ts` — payload → `NormalizedBuildFailure`, plus the diagnosis heuristic
- `publish.ts` — one event per broken locator; sanitizes the DOM and stores it by reference
- `types.ts` — the normalized shape

## `healing`

`workflow.ts` is orchestration only. Every decision lives in a pure module beside it, so each
gate is testable without Inngest, Jenkins or a network.

| Folder        | Question it answers | Contents                                     |
| ------------- | ------------------- | -------------------------------------------- |
| `candidates/` | What should we try? | `deterministic.ts` first, `llm/` only if empty |
| `gates/`      | What may we allow?  | `single-match.ts`, then `diff-policy.ts`     |
| `sources/`    | What is true?       | `repo.ts`, `locator.ts`, `dom.ts`            |
| `delivery/`   | What do we do?      | `jenkins-verify.ts`, `pull-request.ts`       |

Loose files are cross-cutting: `identity.ts` (the keys below), `budget.ts` (caps and the kill
switch), `audit.ts` (the trace every run writes).

### Three identity layers, deliberately

Each covers exactly what the one above it cannot. Collapsing them re-creates a bug we shipped:

1. **`idempotencyKey`** — scoped to the *build*. Collapses the many events one build emits for
   a single locator. Inngest compiles this to a fixed, non-configurable 24h rate limit, so
   keying it on the commit alone made re-running a job a silent no-op.
2. **`driftKey`** — scoped to the *drift*, stable across re-runs. The `singleton` lock, so two
   builds cannot heal one drift at once. Concurrency limits cannot do this: Inngest releases
   the slot during `waitForEvent`, which is most of a heal's wall clock.
3. **The `heal_run.pr_url` lookup** — the durable, across-time guarantee that one drift never
   gets two PRs, long after any in-memory lock expired.

### Rules that are not style preferences

- **Never nest `step.run` inside `step.run`.** Inngest does not throw on this; it *hangs the
  run* with no error anywhere. `@inngest/no-nested-steps` is set to `error` for this reason.
- **Non-deterministic work goes inside a step.** Code outside one re-runs on every invocation.
- **Never let a git error escape unscrubbed.** `execFile` puts the full argv in the message and
  the clone remote carries the token. All git routes through `sources/repo.ts` for this.
