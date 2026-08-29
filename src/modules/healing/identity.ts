import { createHash } from "node:crypto";

/**
 * Pure naming and identity helpers. Deliberately importing nothing but node:crypto, so the
 * gate tests can load them without booting Supabase or an Inngest client.
 */

/** "https://github.com/owner/name.git" -> "owner/name". Null when it is not a GitHub remote. */
export function repoSlug(
  repoUrl: string | null,
): { owner: string; name: string; fullName: string } | null {
  if (!repoUrl) return null;
  const m = repoUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (!m) return null;
  return { owner: m[1], name: m[2], fullName: `${m[1]}/${m[2]}` };
}

/**
 * Collapses the many events one build emits for a single broken locator - a cascade of ten
 * failing tests naming the same XPath is ONE heal.
 *
 * Scoped to the build on purpose. This key feeds Inngest's `idempotency` config, whose cache
 * is in-process and 24h-lived; keying it on the commit alone made a re-run of the same build
 * a silent no-op, and made a crashed run unretryable until the commit changed. The durable
 * "never open two PRs for the same drift" guarantee is NOT here - it lives in the heal_run
 * lookup in workflow.ts, where it is inspectable and outlives any process.
 */
export function idempotencyKey(
  fullName: string,
  commitSha: string,
  brokenXpath: string,
  buildNumber: number,
): string {
  return createHash("sha256")
    .update(`${fullName}:${commitSha}:${buildNumber}:${brokenXpath}`)
    .digest("hex");
}

/**
 * One locator, broken at one commit - stable across re-runs of the build, unlike
 * idempotencyKey. Used as the `singleton` key so two builds reporting the same drift cannot
 * heal it concurrently: concurrency limits do not help here, because a slot is released while
 * the run waits on the Jenkins verify builds, which is most of a heal's wall clock.
 */
export function driftKey(fullName: string, commitSha: string, brokenXpath: string): string {
  return createHash("sha256").update(`${fullName}:${commitSha}:${brokenXpath}`).digest("hex");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function branchName(e: {
  jobName: string;
  buildNumber: number;
  constantName: string;
}): string {
  return `heal/${slug(e.jobName)}-${e.buildNumber}-${slug(e.constantName)}`;
}
