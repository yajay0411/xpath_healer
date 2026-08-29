# Deployment

## Vercel will not run this

Not a configuration problem — three things the healing path does that serverless cannot:

| Code                        | Needs                                           |
| --------------------------- | ----------------------------------------------- |
| `sources/repo.ts`           | the `git` CLI, and a writable tmpdir per heal    |
| `gates/single-match.ts`     | a real Chrome binary (`playwright-core` bundles none) |
| `workflow.ts` `apply-and-push` | writing the patched file to disk before committing |

The `/api/v1/webhooks/jenkins` route alone *would* run on Vercel — it only touches Supabase
and `inngest.send`. But `/api/inngest`, where the actual healing happens, needs a container.
Splitting the two buys nothing once you need the container anyway.

Use **Fly** or **Railway**. Both build the `Dockerfile` in this repo, on amd64, remotely.

## Fly

```bash
fly launch --no-deploy          # keeps fly.toml; edit app name / region as you like
fly secrets set \
  SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
  JENKINS_WEBHOOK_SECRET=... JENKINS_USER=... JENKINS_API_TOKEN=... \
  GITHUB_TOKEN=... GROQ_API_KEY=... \
  INNGEST_EVENT_KEY=... INNGEST_SIGNING_KEY=...
fly deploy
```

`fly.toml` already sets `memory = "1gb"`. Do not lower it: the XPath gate launches Chromium,
and 256MB OOMs the moment it does.

## Railway

New Project → Deploy from GitHub → pick this repo. `railway.json` selects the Dockerfile.
Add the same variables under **Variables**. Railway injects `PORT`; the image honours it.

## Environment: local → production

| Variable                                | Local           | Production                                     |
| --------------------------------------- | --------------- | ---------------------------------------------- |
| `INNGEST_DEV`                            | `1`             | **remove it.** v4 defaults to Cloud and fails closed without a signing key — it will not silently serve unauthenticated |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | empty        | from Inngest Cloud. Signature verification is built into `serve()` |
| `JENKINS_URL`                            | `localhost:8080`| a host the container can actually reach         |
| `CHROME_PATH`                            | unset           | `/usr/bin/chromium` — already set in the image  |
| `HEAL_ALLOWED_REPOS`                     | one repo        | keep it narrow; this is the blast radius        |
| `HEALER_ENABLED`                         | `true`          | `false` is the kill switch — stops every new run at STEP A |
| `SUPABASE_*`, `GITHUB_TOKEN`, model key  | `.env.local`    | platform secrets, never an image layer          |

## The networking, which is the actual work

Three links, not one:

1. **Jenkins → healer.** Set `XPATH_HEALER_URL` in the Jenkins job to the deployed URL.
2. **healer → Jenkins.** `delivery/jenkins-verify.ts` triggers the RED/GREEN builds. If Jenkins
   is on a laptop, a cloud container cannot reach it. Either expose Jenkins, put both on the
   same network, or run the healer next to Jenkins.
3. **Inngest ↔ healer.** `serve()` means Inngest Cloud calls *in*, so the app needs public
   ingress. `inngest@4` also ships `inngest/connect`, where the worker dials *out* and needs
   no ingress at all — the better fit when Jenkins is not publicly reachable.

Because both (1) and (2) point at Jenkins, running the healer beside Jenkins removes most of
this problem. `docker run` the same image there.

## Verify a deployment

```bash
curl https://<host>/api/v1/webhooks/jenkins     # {"ok":true,...}
curl -sI https://<host>/heals | head -1         # 200
```

Then run a build that breaks a locator and watch `/heals`. The gate is the thing worth
confirming — it launches a browser, so it is the first thing to fail on a too-small machine.

## Two things that will bite

- **Chrome fidelity.** The gate deliberately uses the same engine Selenium drives. The image
  pins Debian's Chromium; if that drifts far from your Jenkins agent's Chrome, the gate stops
  proving what it claims. Check both after any base-image bump.
- **`playwright-core` and file tracing.** `next.config.ts` force-includes the whole package.
  Without it, tracing copies the JS and leaves `browsers.json` behind, and the container boots
  fine then dies on the first heal with `MODULE_NOT_FOUND`. Do not remove that include.
