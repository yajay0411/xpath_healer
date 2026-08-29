import { gunzipSync, gzipSync } from "node:zlib";

import { db } from "./supabase";

const BUCKET = "heal-dom";

/**
 * Store a sanitized DOM and return the reference the event carries.
 *
 * The caller sanitizes first: nothing unredacted is ever written here. Events carry this
 * ~80-byte path instead of a 300KB payload, so event size limits stop being a consideration.
 */
export async function putDom(key: string, sanitizedHtml: string): Promise<string | null> {
  const path = `${key}.html.gz`;
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, gzipSync(Buffer.from(sanitizedHtml, "utf8")), {
      contentType: "application/gzip",
      upsert: true,
    });

  if (error) {
    // A missing DOM degrades the heal to "no candidate"; it must not fail the webhook.
    console.error("[storage] DOM upload failed:", error.message);
    return null;
  }
  return path;
}

export async function getDom(path: string): Promise<string | null> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) {
    console.error("[storage] DOM download failed:", error?.message);
    return null;
  }
  return gunzipSync(Buffer.from(await data.arrayBuffer())).toString("utf8");
}
