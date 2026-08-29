import { db } from "../supabase";
import type { HealStatus } from "../events";

/** Every state transition, appended. Independent of the Inngest dashboard on purpose. */
export async function trace(
  runId: string,
  step: string,
  status: string,
  detail: Record<string, unknown> = {},
) {
  const { error } = await db.from("heal_event").insert({ run_id: runId, step, status, detail });
  if (error) console.error("[audit] trace failed:", error.message);
}

export async function updateRun(runId: string, patch: Record<string, unknown>) {
  const { error } = await db
    .from("heal_run")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) console.error("[audit] updateRun failed:", error.message);
}

/** Terminal transition. `no_candidate` and `skipped` are successful outcomes, not errors. */
export async function finish(runId: string, status: HealStatus, reason?: string, prUrl?: string) {
  await updateRun(runId, {
    status,
    reason: reason ?? null,
    pr_url: prUrl ?? null,
    finished_at: new Date().toISOString(),
  });
  await trace(runId, "finish", status, { reason, prUrl });
}

export async function recordAttempt(runId: string, row: Record<string, unknown>) {
  const { error } = await db.from("heal_attempt").insert({ run_id: runId, ...row });
  if (error) console.error("[audit] recordAttempt failed:", error.message);
}

export async function recordVerify(runId: string, row: Record<string, unknown>) {
  const { error } = await db.from("verify_run").insert({ run_id: runId, ...row });
  if (error) console.error("[audit] recordVerify failed:", error.message);
}
