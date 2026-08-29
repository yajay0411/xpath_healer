/**
 * Deterministic locator repair. Tried before any model call, because most real drift is
 * trivial (an attribute dropped, a wrapper added) and a heuristic that costs nothing is
 * strictly better than a model that costs money.
 *
 * Nothing here is trusted: every candidate goes through the identical gates an AI candidate
 * does. A wrong guess is therefore free.
 */

/** Most stable first. Anything not on this list is not an anchor. */
const STABLE_ATTRS = ["data-testid", "data-test", "id", "name", "for", "href", "type"] as const;

/** Never anchor on these, whatever the source. Asserted in the tests. */
const FORBIDDEN = /nth-child|\bclass\b|\[\d+\]|position\(\)|@style/;

type Parsed = {
  tag: string;
  attrs: Record<string, string>;
  text: string | null;
};

/** Parse the last step of a simple XPath. Total: anything unrecognised yields empty fields. */
export function parseLastStep(xpath: string): Parsed {
  const last = xpath.split(/\/(?=[^/])/).pop() ?? "";
  const tag = (last.match(/^([A-Za-z_*][\w.:-]*)/)?.[1] ?? "*").trim();

  const attrs: Record<string, string> = {};
  for (const m of last.matchAll(/@([\w-]+)\s*=\s*'([^']*)'|@([\w-]+)\s*=\s*"([^"]*)"/g)) {
    const key = m[1] ?? m[3];
    const value = m[2] ?? m[4];
    if (key) attrs[key] = value ?? "";
  }

  const text =
    last.match(/normalize-space\(\)\s*=\s*'([^']*)'/)?.[1] ??
    last.match(/text\(\)\s*=\s*'([^']*)'/)?.[1] ??
    null;

  return { tag, attrs, text };
}

/** Drop one predicate at a time: `[@id='e' and @type='email']` -> `[@id='e']`, `[@type='email']`. */
function relaxPredicates(xpath: string): string[] {
  const m = xpath.match(/^(.*?)\[([^\]]*)\]$/);
  if (!m) return [];
  const [, head, body] = m;

  const parts = body.split(/\s+and\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [];

  return parts.map((keep) => `${head}[${keep}]`);
}

const quote = (v: string) => (v.includes("'") ? `"${v}"` : `'${v}'`);

/**
 * Ordered cheapest-and-most-likely first. Deduplicated, and never returns the broken locator
 * itself or anything matching FORBIDDEN.
 */
export function deterministicCandidates(brokenXpath: string): string[] {
  if (!brokenXpath) return [];
  const p = parseLastStep(brokenXpath);
  const out: string[] = [];

  // 1. The original minus one predicate. Covers "they removed an attribute".
  out.push(...relaxPredicates(brokenXpath));

  // 2. The single most stable attribute, alone.
  for (const attr of STABLE_ATTRS) {
    const v = p.attrs[attr];
    if (v) out.push(`//${p.tag}[@${attr}=${quote(v)}]`);
  }

  // 3. Text anchor, tag-agnostic: survives a div -> span refactor.
  if (p.text) out.push(`//*[normalize-space()=${quote(p.text)}]`);

  // 4. Same identity, any tag: the element moved but kept its id.
  if (p.attrs.id) out.push(`//*[@id=${quote(p.attrs.id)}]`);

  return [...new Set(out)].filter((c) => c !== brokenXpath && !FORBIDDEN.test(c));
}

export { FORBIDDEN };
