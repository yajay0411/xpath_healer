import { randomUUID } from "node:crypto";

import { inngest } from "@/modules/platform/events";
import { putDom } from "@/modules/platform/storage";
import { sanitizeDom } from "@/modules/healing/sources/dom";
import { driftKey, idempotencyKey, repoSlug } from "@/modules/healing/identity";
import type { NormalizedBuildFailure } from "./types";

type RawFailure = { domGz?: string; pageUrl?: string };

/**
 * Publish one event per broken locator. Called from the webhook after the row is written, so
 * a publish failure never costs us the record of what arrived.
 *
 * The DOM is sanitized here and stored by reference: events carry an ~80-byte path, and no
 * unredacted credential is ever written to storage.
 */
export async function publishFailures(
  normalized: NormalizedBuildFailure,
  raw: Record<string, unknown>,
  webhookId: string,
): Promise<number> {
  const repo = repoSlug(normalized.scm.repoUrl);
  const commitSha = normalized.scm.commit;
  if (!repo || !commitSha) return 0;

  const rawFailures = Array.isArray(raw.failures) ? (raw.failures as RawFailure[]) : [];
  const events = [];

  for (const [i, failure] of normalized.tests.failures.entries()) {
    if (failure.xpaths.length === 0) continue;

    const eventId = randomUUID();
    let domReference: string | undefined;

    const gz = rawFailures[i]?.domGz;
    if (gz) {
      const { gunzipSync } = await import("node:zlib");
      try {
        const html = gunzipSync(Buffer.from(gz, "base64")).toString("utf8");
        // Sanitize BEFORE upload: unredacted values must never reach storage.
        const stored = await putDom(`${eventId}/${failure.className}.${failure.testName}`, sanitizeDom(html));
        domReference = stored ?? undefined;
      } catch (e) {
        console.error("[publish] DOM decode failed:", e instanceof Error ? e.message : e);
      }
    }

    for (const brokenXpath of failure.xpaths) {
      events.push({
        name: "xpath/failure.detected" as const,
        data: {
          eventId,
          idempotencyKey: idempotencyKey(
            repo.fullName,
            commitSha,
            brokenXpath,
            normalized.build.number ?? 0,
          ),
          driftKey: driftKey(repo.fullName, commitSha, brokenXpath),
          repository: repo,
          scm: { commitSha, branch: normalized.scm.branch ?? undefined },
          build: {
            provider: "jenkins" as const,
            jobName: normalized.build.job,
            buildNumber: normalized.build.number ?? 0,
            buildUrl: normalized.build.url ?? undefined,
          },
          failure: {
            testClass: failure.className,
            testName: failure.testName,
            brokenXpath,
            failureMessage: failure.message,
            pageUrl: rawFailures[i]?.pageUrl,
            domReference,
          },
          metadata: { occurredAt: normalized.occurredAt, webhookId },
        },
      });
    }
  }

  if (events.length > 0) await inngest.send(events);
  return events.length;
}

/**
 * A heal-verify build reporting back. Correlated by HEAL_RUN_ID, not by build number, so a
 * queued or renumbered build still matches.
 */
export async function publishVerify(
  normalized: NormalizedBuildFailure,
  raw: Record<string, unknown>,
): Promise<boolean> {
  const healRunId = typeof raw.healRunId === "string" ? raw.healRunId : null;
  const phase = raw.phase === "red" || raw.phase === "green" ? raw.phase : null;
  if (!healRunId || !phase) return false;

  // GATE 3 needs more than "the build was red": it must be red for OUR locator.
  const targetFailedOnLocator = normalized.diagnosis.xpathRelated;

  await inngest.send({
    name: "jenkins/verify.completed",
    data: {
      healRunId,
      phase,
      buildNumber: normalized.build.number ?? 0,
      buildUrl: normalized.build.url ?? undefined,
      result: (normalized.build.result as "SUCCESS" | "FAILURE" | "UNSTABLE") ?? "FAILURE",
      tests: { total: normalized.tests.total, failed: normalized.tests.failed },
      targetFailedOnLocator,
    },
  });
  return true;
}
