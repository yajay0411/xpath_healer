import { chromium, type Browser } from "playwright-core";

/**
 * GATE 1 + GATE 2, in one call.
 *
 * Evaluated with Chromium's own `document.evaluate`, which is the engine Selenium's
 * `By.xpath` drives. A pure-Node XPath library would be lighter but would give a different
 * answer than CI does, and this is a gate: fidelity beats convenience.
 *
 * Returns -1 when the expression does not parse (GATE 1), otherwise the match count (GATE 2).
 */
export async function matchCount(html: string, xpath: string): Promise<number> {
  if (!html || !xpath) return -1;

  let browser: Browser | undefined;
  try {
    // The system Chrome, so no 150MB browser download is needed; Selenium uses it too.
    browser = await chromium.launch({
      channel: process.env.CHROME_CHANNEL ?? "chrome",
      executablePath: process.env.CHROME_PATH || undefined,
      args: ["--no-sandbox", "--disable-gpu"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    return await page.evaluate((xp) => {
      try {
        return document.evaluate(xp, document, null, 7 /* ORDERED_NODE_SNAPSHOT_TYPE */, null)
          .snapshotLength;
      } catch {
        return -1; // malformed expression
      }
    }, xpath);
  } catch (e) {
    console.error("[xpath-eval] evaluation failed:", e instanceof Error ? e.message : e);
    return -1;
  } finally {
    await browser?.close();
  }
}

export type GateVerdict = { ok: boolean; matchCount: number; reason?: string };

/** The gate as the workflow reads it: only exactly one match may proceed. */
export async function gateSingleMatch(html: string, xpath: string): Promise<GateVerdict> {
  const n = await matchCount(html, xpath);
  if (n < 0) return { ok: false, matchCount: n, reason: "xpath_unparseable" };
  if (n === 0) return { ok: false, matchCount: n, reason: "no_match" };
  if (n > 1) return { ok: false, matchCount: n, reason: `ambiguous_${n}_matches` };
  return { ok: true, matchCount: 1 };
}
