# xpath_healer

When a Selenium suite goes red because an element moved, this proposes the new locator and
opens a pull request. A human merges it. There is no auto-merge path, by design.

It is deliberately hard to make it do the wrong thing: a candidate has to survive four gates
and two real Jenkins builds before anyone is asked to look at it.

## How a heal happens

```
Jenkins build fails
   └─▶ webhook          is this XPath drift, or a genuine bug?
        └─▶ diagnose    a locator exception naming an XPath — not an assertion failure
             └─▶ heal
                  ├─ deterministic candidates first, a model only if they come up empty
                  ├─ GATE  candidate must match exactly ONE element in the captured DOM
                  ├─ GATE  diff must touch one locator constant, nothing else
                  ├─ GATE  RED   — the unpatched commit must reproduce the failure
                  ├─ GATE  GREEN — the patched branch must pass the whole suite
                  └─▶ pull request, with the evidence for all of it
```

Both verification builds run on Jenkins, not here: a GREEN from the pipeline that produced the
RED means exactly the negation of that RED. Nothing polls — the workflow suspends and the
builds report back through the same webhook that started the heal.

## What it refuses to do

- **Guess.** No candidate that matches zero or many elements is ever proposed. A run ending
  `no_candidate` is a success: the test stays loudly red for a human.
- **Touch anything but a locator.** The diff gate rejects any change to a test, an assertion,
  a build file or CI config — which is what stops a model "fixing" the build by weakening it.
- **Trust the page.** The captured DOM is sanitized and treated as untrusted data; the model
  is told so, and its output is a string that dies at the gates if it is wrong.
- **Believe a green suite.** A green suite is not proof of a correct locator. That warning is
  printed in every PR body.

## Getting started

```bash
cp .env.example .env.local     # fill in the blanks
npm install
npm run inngest                # local durable-workflow server, no account needed
npm run dev                    # http://localhost:3002
npm run check                  # gate tests: no framework, real captured fixtures
```

`.env.example` documents every variable. The ones without defaults are `SUPABASE_*`,
`JENKINS_*`, `GITHUB_TOKEN`, and one model key.

Point a Jenkins job at `POST /api/v1/webhooks/jenkins` with an `X-Webhook-Secret` header.
`ci/notify_xpath_healer.py` in the target repo builds the payload, including the DOM captured
at the moment of failure — without that DOM there is nothing to propose a locator from.

Two safety valves: `HEALER_ENABLED=false` stops every new run, and `HEAL_ALLOWED_REPOS` is an
allow-list — a repo not named there is skipped, never healed.

## Layout

`src/modules/README.md` has the real map. In short:

| Module     | Owns                                                           |
| ---------- | -------------------------------------------------------------- |
| `intake`   | What arrived from CI, and whether it looks like XPath drift     |
| `healing`  | What to do about it, and every gate that says "no"              |
| `platform` | Database, blob storage, event bus. No domain knowledge          |

Next.js · Inngest · Supabase · Playwright (for the XPath gate) · shadcn/ui.
Any OpenAI-compatible model provider works; the deterministic pass runs first and costs
nothing, so most heals never reach a model at all.
