/**
 * Run: npm run check:gates
 *
 * Kept out of `npm run check` because it launches a real browser. The XPath gate is
 * evaluated with Chromium's own document.evaluate - the engine Selenium's By.xpath drives -
 * so this is the only check that proves a candidate will behave in CI the way it behaves here.
 *
 * Fixture is a genuine DOM dump from a failing next_login_javatestcase run.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sanitizeDom } from "../src/modules/healing/sources/dom.ts";
import { deterministicCandidates } from "../src/modules/healing/candidates/deterministic.ts";
import { gateSingleMatch, matchCount } from "../src/modules/healing/gates/single-match.ts";

const dom = sanitizeDom(
  readFileSync(join(import.meta.dirname, "fixtures", "login-page.html"), "utf8"),
);

// --- GATE 1: the expression must parse ------------------------------------
assert.equal(await matchCount(dom, "//input[@id="), -1, "a malformed XPath is -1, never a match");
assert.equal(await matchCount(dom, ""), -1, "an empty XPath is -1");

// --- GATE 2: exactly one match, against the real captured page -------------
// These are the live locators from LoginPage.java. They must still resolve.
assert.equal(
  await matchCount(dom, "//input[@id='email' and @type='email']"), 1,
  "LoginPage.EMAIL_INPUT matches exactly one element",
);
assert.equal(
  await matchCount(dom, "//button[@type='submit' and normalize-space()='Sign in']"), 1,
  "LoginPage.SUBMIT matches exactly one element",
);
assert.equal(await matchCount(dom, "//input[@id='nonexistent']"), 0, "an absent element is 0");
assert.ok((await matchCount(dom, "//input")) > 1, "a broad locator matches many");

assert.deepEqual(
  await gateSingleMatch(dom, "//input[@id='email']"), { ok: true, matchCount: 1 },
  "the relaxed candidate passes the gate",
);
const ambiguous = await gateSingleMatch(dom, "//input");
assert.equal(ambiguous.ok, false, "an ambiguous candidate is REJECTED");
assert.match(ambiguous.reason!, /ambiguous/);
assert.equal((await gateSingleMatch(dom, "//nope")).reason, "no_match");
assert.equal((await gateSingleMatch(dom, "//[bad")).reason, "xpath_unparseable");

// --- the end-to-end deterministic path, on real data -----------------------
// Simulate the drift: the app drops type="email" from the input.
const drifted = dom.replace('type="email"', 'type="text"');
const broken = "//input[@id='email' and @type='email']";

assert.equal(await matchCount(drifted, broken), 0, "the drift really does break the locator");

const candidates = deterministicCandidates(broken);
let healed: string | null = null;
for (const c of candidates) {
  if ((await gateSingleMatch(drifted, c)).ok) { healed = c; break; }
}
assert.equal(healed, "//input[@id='email']", "the heuristics heal it with no model call");

console.log("gates: real Chromium document.evaluate, all gates behave");
