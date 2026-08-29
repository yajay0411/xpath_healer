import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Run = {
  id: string;
  created_at: string;
  status: string;
  reason: string | null;
  repo_full_name: string;
  commit_sha: string;
  job_name: string | null;
  build_number: number | null;
  test_class: string | null;
  test_name: string | null;
  broken_xpath: string;
  candidate_xpath: string | null;
  constant_name: string | null;
  source_file: string | null;
  strategy: string | null;
  pr_url: string | null;
};

type Attempt = { run_id: string; strategy: string; cost_usd: string | null; verdict: string };

/** Terminal states are not all failures: no_candidate and skipped are correct outcomes. */
const TONE: Record<string, string> = {
  pr_open: "bg-emerald-100 text-emerald-900",
  verified: "bg-emerald-50 text-emerald-800",
  healing: "bg-blue-100 text-blue-900",
  no_candidate: "bg-neutral-200 text-neutral-800",
  skipped: "bg-neutral-100 text-neutral-600",
  rejected: "bg-amber-100 text-amber-900",
  failed: "bg-red-100 text-red-800",
};

export default async function Heals() {
  const [{ data: runs, error }, { data: attempts }] = await Promise.all([
    db.from("heal_run").select("*").order("created_at", { ascending: false }).limit(50),
    db.from("heal_attempt").select("run_id, strategy, cost_usd, verdict"),
  ]);

  const byRun = new Map<string, Attempt[]>();
  for (const a of (attempts ?? []) as Attempt[]) {
    byRun.set(a.run_id, [...(byRun.get(a.run_id) ?? []), a]);
  }

  const rows = (runs ?? []) as Run[];
  const spend = (attempts ?? []).reduce((s, a) => s + Number(a.cost_usd ?? 0), 0);
  const withModel = rows.filter((r) => r.strategy === "ai").length;
  const deterministic = rows.filter((r) => r.strategy === "deterministic").length;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">heal runs</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Every run is human-reviewed. <code>no_candidate</code> and <code>skipped</code> are
        successful outcomes — the healer declining to guess.
      </p>

      <dl className="mt-6 grid grid-cols-3 gap-4 text-sm">
        <div className="rounded-lg border border-neutral-200 p-3">
          <dt className="text-neutral-500">healed without a model</dt>
          <dd className="text-xl font-semibold">
            {deterministic}
            <span className="text-sm font-normal text-neutral-500"> / {deterministic + withModel}</span>
          </dd>
        </div>
        <div className="rounded-lg border border-neutral-200 p-3">
          <dt className="text-neutral-500">PRs opened</dt>
          <dd className="text-xl font-semibold">{rows.filter((r) => r.pr_url).length}</dd>
        </div>
        <div className="rounded-lg border border-neutral-200 p-3">
          <dt className="text-neutral-500">model spend</dt>
          <dd className="text-xl font-semibold">${spend.toFixed(3)}</dd>
        </div>
      </dl>

      {error && (
        <p className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error.message}
        </p>
      )}

      {!error && rows.length === 0 && (
        <p className="mt-6 text-sm text-neutral-500">
          No heal runs yet. A build that fails on an XPath locator starts one.
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {rows.map((run) => {
          const tried = byRun.get(run.id) ?? [];
          return (
            <li key={run.id} className="rounded-lg border border-neutral-200 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[run.status] ?? "bg-neutral-100"}`}
                >
                  {run.status}
                </span>
                <strong>{run.constant_name ?? run.job_name ?? "unknown"}</strong>
                <span className="text-neutral-500">
                  {run.job_name}#{run.build_number} · {run.commit_sha.slice(0, 7)}
                </span>
                {run.strategy && (
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{run.strategy}</span>
                )}
                <span className="ml-auto text-xs text-neutral-400">
                  {new Date(run.created_at).toLocaleString()}
                </span>
              </div>

              <div className="mt-2 space-y-1 font-mono text-xs">
                <div className="text-red-700">− {run.broken_xpath}</div>
                {run.candidate_xpath && <div className="text-emerald-700">+ {run.candidate_xpath}</div>}
              </div>

              <div className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-500">
                {run.test_class && (
                  <span>
                    {run.test_class.split(".").pop()}.{run.test_name}
                  </span>
                )}
                {run.source_file && <span>{run.source_file.split("/").pop()}</span>}
                <span>
                  {tried.length} candidate(s), {tried.filter((a) => a.verdict === "rejected").length} rejected
                </span>
                {run.reason && <span className="text-amber-700">{run.reason}</span>}
                {run.pr_url && (
                  <a className="text-blue-700 underline" href={run.pr_url}>
                    review PR →
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
