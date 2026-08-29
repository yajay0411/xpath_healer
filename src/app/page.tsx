import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  received_at: string;
  http_status: number;
  auth_ok: boolean;
  job_name: string | null;
  build_number: number | null;
  build_url: string | null;
  build_result: string | null;
  tests_failed: number | null;
  xpath_related: boolean;
  suspect_xpaths: string[];
  parse_error: string | null;
};

const statusTone = (row: Row) =>
  !row.auth_ok || row.http_status >= 400
    ? "bg-red-100 text-red-800"
    : row.xpath_related
      ? "bg-amber-100 text-amber-900"
      : "bg-emerald-100 text-emerald-900";

export default async function Home() {
  const { data, error } = await db
    .from("webhook_log")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(50);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">xpath_healer</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Inbound CI webhooks. POST to <code>/api/v1/webhooks/jenkins</code>.
      </p>

      {error && (
        <p className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error.message}
        </p>
      )}

      {!error && (data ?? []).length === 0 && (
        <p className="mt-6 text-sm text-neutral-500">
          No webhooks received yet. Run a Jenkins build that fails.
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {((data ?? []) as Row[]).map((row) => (
          <li key={row.id} className="rounded-lg border border-neutral-200 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusTone(row)}`}>
                {row.http_status}
              </span>
              <strong>{row.job_name ?? "unknown job"}</strong>
              {row.build_number !== null && <span>#{row.build_number}</span>}
              <span className="text-neutral-500">{row.build_result ?? "—"}</span>
              <span className="ml-auto text-xs text-neutral-500">
                {new Date(row.received_at).toLocaleString("en-US")}
              </span>
            </div>

            {row.parse_error && <p className="mt-2 text-red-700">{row.parse_error}</p>}

            {row.xpath_related && (
              <div className="mt-2">
                <p className="font-medium text-amber-900">
                  XPath drift suspected, {row.tests_failed ?? 0} test(s) failed
                </p>
                <ul className="mt-1 space-y-0.5">
                  {row.suspect_xpaths.map((xp) => (
                    <li key={xp} className="break-all font-mono text-xs text-neutral-700">
                      {xp}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {row.build_url && (
              <a
                href={row.build_url}
                className="mt-2 inline-block text-xs text-blue-700 underline-offset-4 hover:underline"
              >
                {row.build_url}
              </a>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
