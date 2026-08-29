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
 * The durable identity of a heal: one locator, broken at one commit, forever.
 * A Jenkins replay produces zero additional runs; a new commit produces a new one.
 */
export function idempotencyKey(fullName: string, commitSha: string, brokenXpath: string): string {
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
