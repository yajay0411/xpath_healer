import { db } from "@/modules/platform/supabase";

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export type BudgetVerdict = { ok: boolean; reason?: string };

/**
 * Caps and the kill switch, checked before a run starts and again before every model call.
 * Over budget is permanent: the run ends `failed/budget_exceeded` rather than retrying.
 */
export async function checkBudget(): Promise<BudgetVerdict> {
  if (process.env.HEALER_ENABLED === "false") return { ok: false, reason: "disabled" };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count } = await db
    .from("heal_run")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  if ((count ?? 0) >= num(process.env.HEAL_MAX_RUNS_PER_DAY, 10)) {
    return { ok: false, reason: "daily_run_cap" };
  }

  const { data } = await db.from("heal_attempt").select("cost_usd").gte("created_at", since);
  const spent = (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);

  if (spent >= num(process.env.HEAL_MAX_USD_PER_DAY, 5)) {
    return { ok: false, reason: "daily_cost_cap" };
  }

  return { ok: true };
}

/** Repo allowlist. Anything not named here is skipped, never healed. */
export function repoAllowed(fullName: string): boolean {
  const allowed = (process.env.HEAL_ALLOWED_REPOS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(fullName);
}
