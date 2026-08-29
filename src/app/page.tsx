import { AppShell, EmptyState } from "@/components/app-shell";
import { DeliveryStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/modules/platform";

export const dynamic = "force-dynamic";

type Delivery = {
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

export default async function DeliveriesPage() {
  const { data, error } = await db
    .from("webhook_log")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as Delivery[];

  return (
    <AppShell
      active="deliveries"
      title="Inbound deliveries"
      description={
        <>
          Every webhook hit, accepted or rejected, exactly once. POST to{" "}
          <code className="font-mono text-xs">/api/v1/webhooks/jenkins</code> with an{" "}
          <code className="font-mono text-xs">X-Webhook-Secret</code> header.
        </>
      }
    >
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load deliveries</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!error && rows.length === 0 && (
        <EmptyState>No deliveries yet. Run a Jenkins build that fails.</EmptyState>
      )}

      <div className="space-y-3">
        {rows.map((row) => (
          <Card key={row.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <DeliveryStatusBadge
                  httpStatus={row.http_status}
                  authOk={row.auth_ok}
                  xpathRelated={row.xpath_related}
                />
                <CardTitle className="text-base">{row.job_name ?? "unknown job"}</CardTitle>
                {row.build_number !== null && (
                  <span className="text-muted-foreground text-sm">#{row.build_number}</span>
                )}
                {row.build_result && <Badge variant="outline">{row.build_result}</Badge>}
                <time className="text-muted-foreground ml-auto text-xs" dateTime={row.received_at}>
                  {new Date(row.received_at).toLocaleString()}
                </time>
              </div>
              {!row.auth_ok && (
                <CardDescription className="text-destructive">
                  Rejected: bad or missing secret. Logged on purpose — probes are what we want to
                  see.
                </CardDescription>
              )}
            </CardHeader>

            {(row.parse_error || row.xpath_related || row.build_url) && (
              <CardContent className="space-y-3">
                {row.parse_error && (
                  <p className="text-destructive text-sm">{row.parse_error}</p>
                )}

                {row.xpath_related && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      XPath drift suspected · {row.tests_failed ?? 0} test
                      {row.tests_failed === 1 ? "" : "s"} failed
                    </p>
                    <ul className="bg-muted/50 space-y-0.5 overflow-x-auto rounded-md p-3">
                      {row.suspect_xpaths.map((xpath) => (
                        <li key={xpath} className="font-mono text-xs whitespace-pre">
                          {xpath}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {row.build_url && (
                  <a
                    href={row.build_url}
                    className="text-muted-foreground hover:text-foreground inline-block text-xs underline underline-offset-4"
                  >
                    {row.build_url}
                  </a>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
