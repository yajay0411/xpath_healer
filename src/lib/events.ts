import { Inngest, eventType } from "inngest";
import { z } from "zod";

/**
 * Event contracts. Inngest v4 builds triggers on StandardSchema, which zod implements, so
 * these schemas are both the compile-time type and the runtime validation of every payload.
 */

export const HEAL_STATUSES = [
  "received",
  "diagnosed",
  "healing",
  "no_candidate",
  "skipped",
  "rejected",
  "verified",
  "pr_open",
  "failed",
] as const;

export type HealStatus = (typeof HEAL_STATUSES)[number];

export const xpathFailureDetected = eventType("xpath/failure.detected", {
  schema: z.object({
    eventId: z.string(),
    /** sha256("<fullName>:<commitSha>:<brokenXpath>"). The durable identity of a heal. */
    idempotencyKey: z.string(),

    repository: z.object({
      owner: z.string(),
      name: z.string(),
      fullName: z.string(),
    }),
    scm: z.object({
      commitSha: z.string(),
      branch: z.string().optional(),
    }),
    build: z.object({
      provider: z.literal("jenkins"),
      jobName: z.string(),
      buildNumber: z.number(),
      buildUrl: z.string().optional(),
    }),

    failure: z.object({
      testClass: z.string(),
      testName: z.string(),
      brokenXpath: z.string(),
      failureMessage: z.string(),
      pageUrl: z.string().optional(),
      /** Supabase Storage path. Never the DOM itself: events have payload limits. */
      domReference: z.string().optional(),
    }),

    metadata: z.object({
      occurredAt: z.string(),
      webhookId: z.string().optional(),
    }),
  }),
});

/** Emitted when a heal-verify build reports back through the same webhook. */
export const jenkinsVerifyCompleted = eventType("jenkins/verify.completed", {
  schema: z.object({
    healRunId: z.string(),
    phase: z.enum(["red", "green"]),
    buildNumber: z.number(),
    buildUrl: z.string().optional(),
    result: z.enum(["SUCCESS", "FAILURE", "UNSTABLE"]),
    tests: z.object({
      total: z.number().nullable(),
      failed: z.number().nullable(),
    }),
    /** Did a failure in this build raise a locator exception naming our XPath? */
    targetFailedOnLocator: z.boolean(),
  }),
});

/** Terminal. Nothing subscribes yet; it exists so notifications need no schema change. */
export const xpathHealCompleted = eventType("xpath/heal.completed", {
  schema: z.object({
    healRunId: z.string(),
    status: z.enum(HEAL_STATUSES),
    prUrl: z.string().optional(),
    reason: z.string().optional(),
  }),
});

export const inngest = new Inngest({ id: "xpath-healer" });
