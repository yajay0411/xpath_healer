import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { normalize, publishFailures, publishVerify } from "@/modules/intake";
import { db } from "@/modules/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET = process.env.JENKINS_WEBHOOK_SECRET;

/** Constant time, and length-safe: timingSafeEqual throws on a length mismatch. */
function secretMatches(presented: string | null): boolean {
  if (!SECRET || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Header allow-list: logging every header would capture the secret itself. */
const LOGGED_HEADERS = [
  "content-type",
  "user-agent",
  "x-jenkins-job",
  "x-jenkins-build",
  "x-delivery-id",
];

/**
 * raw_payload is kept verbatim so a normalizer bug is always recoverable - but the attached
 * DOM is not ours to keep unredacted. It is sanitized and stored by reference instead.
 */
function withoutDom(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.failures)) return raw;
  return {
    ...raw,
    failures: raw.failures.map((f) =>
      f && typeof f === "object" && "domGz" in f
        ? { ...f, domGz: `«${String((f as { domGz: string }).domGz).length} chars, stored by reference»` }
        : f,
    ),
  };
}

export async function POST(request: Request) {
  const headers = Object.fromEntries(
    LOGGED_HEADERS.map((h) => [h, request.headers.get(h)]).filter(([, v]) => v !== null),
  );
  const deliveryId = request.headers.get("x-delivery-id");
  const authOk = secretMatches(request.headers.get("x-webhook-secret"));

  const body = await request.text();
  let raw: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      parseError = "Body is valid JSON but not an object.";
    } else {
      raw = parsed as Record<string, unknown>;
    }
  } catch (e) {
    parseError = e instanceof Error ? e.message : "Body is not valid JSON.";
  }

  const status = !authOk ? 401 : parseError ? 400 : 202;

  // Normalize even a rejected hit, so the log row is still queryable.
  const normalized = raw ? normalize(raw) : null;

  // A rejected or malformed hit is still recorded: probes and bad senders are what we want to see.
  const { data, error } = await db
    .from("webhook_log")
    .insert({
      source: "jenkins",
      event: normalized?.event ?? null,
      delivery_id: deliveryId,
      http_status: status,
      auth_ok: authOk,
      headers,
      raw_payload: raw ? withoutDom(raw) : null,
      normalized,
      parse_error: parseError,
      job_name: normalized?.build.job ?? null,
      build_number: normalized?.build.number ?? null,
      build_url: normalized?.build.url ?? null,
      build_result: normalized?.build.result ?? null,
      branch: normalized?.scm.branch ?? null,
      commit_sha: normalized?.scm.commit ?? null,
      tests_total: normalized?.tests.total ?? null,
      tests_failed: normalized?.tests.failed ?? null,
      xpath_related: normalized?.diagnosis.xpathRelated ?? false,
      suspect_xpaths: normalized?.diagnosis.suspectXpaths ?? [],
    })
    .select("id")
    .single();

  // A replayed delivery is not an error; the first row already holds the data.
  if (error?.code === "23505") {
    return NextResponse.json({ ok: true, duplicate: true, deliveryId }, { status: 200 });
  }
  if (error) {
    console.error("[webhooks/jenkins] insert failed:", error.message);
    return NextResponse.json({ ok: false, error: "Could not record webhook." }, { status: 500 });
  }

  if (!authOk) {
    return NextResponse.json({ ok: false, error: "Bad or missing secret." }, { status: 401 });
  }
  if (parseError) {
    return NextResponse.json({ ok: false, error: parseError }, { status: 400 });
  }

  // Publish, then return. The workflow runs asynchronously: this handler never waits for a
  // Maven run, a model call, a clone or a PR. A publish failure is logged, not raised - the
  // webhook_log row is already durable, so nothing is lost that cannot be replayed.
  let published = 0;
  let verify = false;
  try {
    if (typeof raw!.healRunId === "string") {
      verify = await publishVerify(normalized!, raw!);
    } else if (normalized!.diagnosis.xpathRelated) {
      published = await publishFailures(normalized!, raw!, data.id);
    }
  } catch (e) {
    console.error("[webhooks/jenkins] publish failed:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json(
    {
      ok: true,
      id: data.id,
      event: normalized!.event,
      diagnosis: normalized!.diagnosis,
      published,
      verify,
    },
    { status: 202 },
  );
}

export async function GET() {
  return NextResponse.json(
    { ok: true, endpoint: "jenkins webhook", method: "POST", auth: "X-Webhook-Secret header" },
    { status: 200 },
  );
}
