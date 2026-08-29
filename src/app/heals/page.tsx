import { AppShell, EmptyState } from "@/components/app-shell";
import { HealStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/modules/platform";

export const dynamic = "force-dynamic";

type Run = {
  id: string;
  created_at: string;
  status: string;
  reason: string | null;
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

type Attempt = { run_id: string; cost_usd: string | null; verdict: string };

export default async function HealsPage() {
  const [{ data: runs, error }, { data: attempts }] = await Promise.all([
    db.from("heal_run").select("*").order("created_at", { ascending: false }).limit(50),
    db.from("heal_attempt").select("run_id, cost_usd, verdict"),
  ]);

  const rows = (runs ?? []) as Run[];
  const tries = (attempts ?? []) as Attempt[];

  const byRun = new Map<string, Attempt[]>();
  for (const a of tries) byRun.set(a.run_id, [...(byRun.get(a.run_id) ?? []), a]);

  const spend = tries.reduce((sum, a) => sum + Number(a.cost_usd ?? 0), 0);
  const withModel = rows.filter((r) => r.strategy === "ai").length;
  const deterministic = rows.filter((r) => r.strategy === "deterministic").length;
  const opened = rows.filter((r) => r.pr_url).length;

  return (
    <AppShell
      active="heals"
      title="Heal runs"
      description={
        <>
          Every run ends at a human. <code className="font-mono text-xs">no candidate</code> and{" "}
          <code className="font-mono text-xs">skipped</code> are successful outcomes — the healer
          declining to guess.
        </>
      }
    >
      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Healed without a model"
          value={`${deterministic}`}
          hint={`of ${deterministic + withModel} with a strategy`}
        />
        <Stat label="PRs opened" value={`${opened}`} hint="each awaiting review" />
        <Stat label="Model spend" value={`$${spend.toFixed(3)}`} hint="all attempts, all time" />
      </dl>

      {error && (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Could not load heal runs</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!error && rows.length === 0 && (
        <div className="mt-6">
          <EmptyState>No heal runs yet. A build failing on an XPath locator starts one.</EmptyState>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {rows.map((run) => {
          const attempted = byRun.get(run.id) ?? [];
          const rejected = attempted.filter((a) => a.verdict === "rejected").length;

          return (
            <Card key={run.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <HealStatusBadge status={run.status} />
                  <CardTitle className="text-base">
                    {run.constant_name ?? run.job_name ?? "unknown locator"}
                  </CardTitle>
                  {run.strategy && <Badge variant="outline">{run.strategy}</Badge>}
                  <time
                    className="text-muted-foreground ml-auto text-xs"
                    dateTime={run.created_at}
                  >
                    {new Date(run.created_at).toLocaleString()}
                  </time>
                </div>
                <CardDescription>
                  {run.job_name}#{run.build_number} · {run.commit_sha.slice(0, 7)}
                  {run.source_file && <> · {run.source_file.split("/").pop()}</>}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-3">
                {/* The diff is the whole story: read it before the PR. */}
                <div className="bg-muted/50 space-y-1 overflow-x-auto rounded-md p-3 font-mono text-xs">
                  <div className="text-destructive whitespace-pre">− {run.broken_xpath}</div>
                  {run.candidate_xpath && (
                    <div className="whitespace-pre text-emerald-600 dark:text-emerald-400">
                      + {run.candidate_xpath}
                    </div>
                  )}
                </div>

                <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  {run.test_class && (
                    <span>
                      {run.test_class.split(".").pop()}.{run.test_name}
                    </span>
                  )}
                  <span>
                    {attempted.length} candidate{attempted.length === 1 ? "" : "s"}, {rejected}{" "}
                    rejected
                  </span>
                  {run.reason && <span className="text-foreground">{run.reason}</span>}
                  {run.pr_url && (
                    <a
                      href={run.pr_url}
                      className="text-foreground ml-auto font-medium underline underline-offset-4"
                    >
                      Review PR →
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <dt className="text-muted-foreground text-sm font-normal">{label}</dt>
      </CardHeader>
      <CardContent>
        <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}
