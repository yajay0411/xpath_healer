import * as cheerio from "cheerio";

/** Never a locator target, always most of the bytes. */
const DROP = "script, style, noscript, link, meta, svg, path, iframe, template";

/** Fields whose value is a credential or PII. Redacted before storage, not just before a model call. */
const SENSITIVE_TYPES = new Set(["password", "email", "tel"]);

const MAX_CLASS = 60;
const MAX_OUT = 60_000;

/**
 * Shrink a captured page to something a model can read and a human can review, and strip
 * everything that must never leave this machine.
 *
 * Runs before the DOM is stored, so an unredacted credential never reaches Postgres or
 * object storage either. Total: malformed HTML yields a smaller string, never a throw.
 */
export function sanitizeDom(html: string): string {
  if (!html) return "";

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return "";
  }

  $(DROP).remove();
  $("*")
    .contents()
    .filter((_, node) => node.type === "comment")
    .remove();

  // Tailwind class soup is ~40% of the bytes here and no locator should ever key off it.
  $("[class]").each((_, el) => {
    const cls = $(el).attr("class") ?? "";
    if (cls.length > MAX_CLASS) $(el).attr("class", cls.slice(0, MAX_CLASS) + "…");
  });

  $("input").each((_, el) => {
    const type = ($(el).attr("type") ?? "").toLowerCase();
    // Redact any value: a filled field is a credential more often than it is a hint.
    if (SENSITIVE_TYPES.has(type) || $(el).attr("value") !== undefined) {
      $(el).attr("value", "«redacted»");
    }
    // Next.js server-action ids change every build. Anchoring on one guarantees a reheal.
    const name = $(el).attr("name") ?? "";
    if (name.startsWith("$ACTION_ID_")) $(el).attr("name", "$ACTION_ID_«volatile»");
  });

  const body = $("body").html() ?? $.html() ?? "";
  return body.length > MAX_OUT ? body.slice(0, MAX_OUT) + "\n<!-- truncated -->" : body;
}
