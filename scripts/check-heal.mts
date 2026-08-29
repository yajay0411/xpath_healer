/**
 * Run: npm run check:heal
 * Same idiom as check-normalize: node:assert, no framework, real captured data.
 * scripts/fixtures/login-page.html is a genuine DOM dump from a failing suite run.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { sanitizeDom } from "../src/modules/healing/sources/dom.ts";
import { deterministicCandidates, FORBIDDEN, parseLastStep } from "../src/modules/healing/candidates/deterministic.ts";
import { findLocator } from "../src/modules/healing/sources/locator.ts";
import { applyLocator, diffIsSafe } from "../src/modules/healing/gates/diff-policy.ts";
import { branchName, driftKey, idempotencyKey, repoSlug } from "../src/modules/healing/identity.ts";
import { git, scrub } from "../src/modules/healing/sources/repo.ts";

const FIXTURE = join(import.meta.dirname, "fixtures", "login-page.html");
const realDom = readFileSync(FIXTURE, "utf8");

// --- dom.ts: sanitize + redact -------------------------------------------
{
  const out = sanitizeDom(realDom);

  assert.ok(!out.includes("<script"), "every script tag is stripped");
  assert.ok(!out.includes("<style"), "every style tag is stripped");
  assert.ok(out.length < realDom.length, "sanitizing shrinks the page");
  assert.ok(out.includes('id="email"'), "the locator targets survive");
  assert.ok(out.includes("Sign in"), "visible text survives, it is an anchor");

  // Tailwind soup truncated, so no candidate can key off a full class string.
  const longestClass = Math.max(
    0,
    ...[...out.matchAll(/class="([^"]*)"/g)].map((m) => m[1].length),
  );
  assert.ok(longestClass <= 61, `classes truncated, longest was ${longestClass}`);

  // The volatile Next.js server-action id must not look like an anchor.
  assert.ok(!/\$ACTION_ID_[0-9a-f]{8}/.test(out), "volatile action ids are masked");

  // Credentials never leave, and never reach storage.
  const withSecret = `<html><body>
    <input type="password" value="hunter2">
    <input type="email" value="real.user@example.com">
    <input type="text" name="token" value="ghp_liveSecretValue">
    <script>const KEY="sk-live-abc";</script>
  </body></html>`;
  const redacted = sanitizeDom(withSecret);
  assert.ok(!redacted.includes("hunter2"), "password values redacted");
  assert.ok(!redacted.includes("real.user@example.com"), "email values redacted");
  assert.ok(!redacted.includes("ghp_liveSecretValue"), "any input value redacted");
  assert.ok(!redacted.includes("sk-live-abc"), "script contents never survive");

  assert.equal(sanitizeDom(""), "", "empty input is empty output");
  assert.doesNotThrow(() => sanitizeDom("<<<not html"), "malformed input does not throw");
}

// --- candidates.ts -------------------------------------------------------
{
  const parsed = parseLastStep("//input[@id='email' and @type='email']");
  assert.equal(parsed.tag, "input");
  assert.equal(parsed.attrs.id, "email");
  assert.equal(parsed.attrs.type, "email");

  const cands = deterministicCandidates("//input[@id='email' and @type='email']");
  assert.ok(cands.includes("//input[@id='email']"), "predicate relaxation is tried first");
  assert.ok(cands.includes("//*[@id='email']"), "identity-only fallback is offered");
  assert.ok(!cands.includes("//input[@id='email' and @type='email']"), "never re-proposes the broken locator");

  // The order matters: relaxation before the broader guesses.
  assert.ok(
    cands.indexOf("//input[@id='email']") < cands.indexOf("//*[@id='email']"),
    "narrower candidates are ranked before broader ones",
  );

  const textual = deterministicCandidates(
    "//button[@type='submit' and normalize-space()='Sign in']",
  );
  assert.ok(textual.some((c) => c.includes("Sign in")), "visible text becomes an anchor");

  // The rule that keeps healed locators maintainable.
  for (const c of [...cands, ...textual]) {
    assert.ok(!FORBIDDEN.test(c), `no forbidden anchor in ${c}`);
  }

  assert.deepEqual(deterministicCandidates(""), [], "empty in, empty out");
}

// --- locator.ts: exact literal match -------------------------------------
{
  const repo = mkdtempSync(join(tmpdir(), "heal-test-"));
  const pages = join(repo, "src/test/java/com/nextlogin/pages");
  mkdirSync(pages, { recursive: true });
  writeFileSync(
    join(pages, "LoginPage.java"),
    `package com.nextlogin.pages;
public class LoginPage extends BasePage {
  public static final String EMAIL_INPUT = "//input[@id='email' and @type='email']";
  public static final String SUBMIT =
      "//button[@type='submit' and normalize-space()='Sign in']";
  public static final String ALERT_TEXT =
      "//div[@role='alert']"
          + "//div[@data-slot='alert-description']";
}`,
  );

  const found = findLocator(repo, "//input[@id='email' and @type='email']");
  assert.equal(found?.constantName, "EMAIL_INPUT");
  assert.equal(found?.file, "src/test/java/com/nextlogin/pages/LoginPage.java");

  const split = findLocator(repo, "//div[@role='alert']//div[@data-slot='alert-description']");
  assert.equal(split?.constantName, "ALERT_TEXT", "a literal split across + lines is found");

  assert.equal(findLocator(repo, "//input[@id='nope']"), null, "a runtime-built XPath is not found");
  assert.equal(findLocator("/nonexistent", "//x"), null, "a missing repo returns null, never throws");
}

// --- patch.ts: GATE 4 ----------------------------------------------------
{
  const src = `public class LoginPage {
  public static final String EMAIL_INPUT = "//input[@id='email' and @type='email']";
  public static final String OTHER = "//input[@id='email' and @type='email']";
}`;

  const ok = applyLocator(src, "EMAIL_INPUT", "//input[@id='email' and @type='email']", "//input[@id='email']");
  assert.ok(ok.ok, "the identified constant is replaced");
  assert.ok(ok.ok && ok.source.includes('EMAIL_INPUT = "//input[@id=\'email\']"'));
  assert.ok(
    ok.ok && ok.source.includes(`OTHER = "//input[@id='email' and @type='email']"`),
    "an identical literal under a different name is NOT touched",
  );

  assert.equal(
    applyLocator(src, "MISSING", "//x", "//y").ok, false, "an unknown constant is refused");
  assert.equal(
    applyLocator(src, "EMAIL_INPUT", "//stale", "//new").ok, false,
    "a literal that changed since diagnosis is refused");
  assert.equal(
    applyLocator(src, "EMAIL_INPUT", "//input[@id='email' and @type='email']", 'a"b').ok, false,
    "a candidate needing escaping is refused");
  assert.equal(
    applyLocator(src, "EMAIL_INPUT", "//input[@id='email' and @type='email']", "notanxpath").ok,
    false, "a non-XPath is refused");
}

// --- patch.ts: GATE 6, the last line of defence --------------------------
{
  const good = `diff --git a/src/test/java/com/nextlogin/pages/LoginPage.java b/src/test/java/com/nextlogin/pages/LoginPage.java
--- a/src/test/java/com/nextlogin/pages/LoginPage.java
+++ b/src/test/java/com/nextlogin/pages/LoginPage.java
@@ -5,1 +5,1 @@
-  public static final String EMAIL_INPUT = "//input[@id='email' and @type='email']";
+  public static final String EMAIL_INPUT = "//input[@id='email']";`;
  assert.ok(diffIsSafe(good).ok, "a one-line locator change passes");
  assert.equal(diffIsSafe(good).changedLines, 2);

  // THE test. An AI that "fixed" the build by weakening an assertion dies here.
  const assertionEdit = `diff --git a/src/test/java/com/nextlogin/tests/LoginTest.java b/src/test/java/com/nextlogin/tests/LoginTest.java
--- a/src/test/java/com/nextlogin/tests/LoginTest.java
+++ b/src/test/java/com/nextlogin/tests/LoginTest.java
@@ -12,1 +12,1 @@
-    Assert.assertEquals(page.errorText(), "Invalid login credentials");
+    Assert.assertTrue(true);`;
  const verdict = diffIsSafe(assertionEdit);
  assert.equal(verdict.ok, false, "a test-file edit is REJECTED");
  assert.match(verdict.reason!, /path_not_allowed/);

  const pom = `diff --git a/pom.xml b/pom.xml
--- a/pom.xml
+++ b/pom.xml
@@ -1,1 +1,1 @@
-  <skipTests>false</skipTests>
+  <skipTests>true</skipTests>`;
  assert.equal(diffIsSafe(pom).ok, false, "a build-file edit is REJECTED");

  const twoFiles = good + "\n" + good.replace(/LoginPage/g, "RegisterPage");
  assert.equal(diffIsSafe(twoFiles).ok, false, "a two-file diff is REJECTED");

  const extraLine = `diff --git a/src/test/java/com/nextlogin/pages/LoginPage.java b/src/test/java/com/nextlogin/pages/LoginPage.java
--- a/src/test/java/com/nextlogin/pages/LoginPage.java
+++ b/src/test/java/com/nextlogin/pages/LoginPage.java
@@ -5,1 +5,2 @@
-  public static final String EMAIL_INPUT = "//input[@id='email']";
+  public static final String EMAIL_INPUT = "//input[@id='email']";
+  System.exit(0);`;
  assert.equal(diffIsSafe(extraLine).ok, false, "a non-locator line is REJECTED");

  assert.equal(diffIsSafe("").ok, false, "an empty diff is REJECTED");
}

// --- the token never reaches an error string ------------------------------
{
  // execFile puts the full argv in the error, and the clone remote carries the token.
  process.env.GITHUB_TOKEN = "ghp_TESTTOKENVALUE0000000000000000000000";
  let message = "";
  try {
    await git("/tmp", "ls-remote", `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/nope/nope.git`);
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  assert.ok(message.length > 0, "the failing git call must throw");
  assert.ok(!message.includes(process.env.GITHUB_TOKEN), "a git failure must NOT leak the token");

  // The fallback path. git redacts credentials in its own stderr, so the dangerous string is
  // execFile's message - which is what we use whenever stderr is empty.
  assert.ok(
    !scrub(`Command failed: git remote add origin https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/o/r.git`)
      .includes(process.env.GITHUB_TOKEN),
    "scrub removes the token from an execFile-style message",
  );
  assert.ok(scrub(`x${process.env.GITHUB_TOKEN}y`) === "x\u00abtoken\u00bby", "scrub marks the redaction");
  delete process.env.GITHUB_TOKEN;
}

// --- idempotency (§J) ----------------------------------------------------
{
  const a = idempotencyKey("o/r", "abc123", "//input[@id='email']", 7);
  const b = idempotencyKey("o/r", "abc123", "//input[@id='email']", 7);
  assert.equal(a, b, "the same failure in the same build yields a byte-identical key");
  assert.notEqual(a, idempotencyKey("o/r", "def456", "//input[@id='email']", 7), "a new commit is a new run");
  assert.notEqual(a, idempotencyKey("o/r", "abc123", "//input[@id='pass']", 7), "a new locator is a new run");
  // The regression this guards: a re-run of the same build used to dedupe to nothing, so a
  // crashed heal could never be retried without pushing a new commit.
  assert.notEqual(a, idempotencyKey("o/r", "abc123", "//input[@id='email']", 8), "a re-run is a new run");

  // driftKey is the singleton lock: it must be STABLE across re-runs (so two builds cannot
  // heal one drift concurrently) while idempotencyKey varies (so a re-run is a real retry).
  const d1 = driftKey("o/r", "abc123", "//input[@id='email']");
  assert.equal(d1, driftKey("o/r", "abc123", "//input[@id='email']"), "driftKey is stable across builds");
  assert.notEqual(d1, driftKey("o/r", "def456", "//input[@id='email']"), "a new commit is a new drift");
  assert.notEqual(d1, driftKey("o/r", "abc123", "//input[@id='pass']"), "a new locator is a new drift");
  assert.notEqual(d1, a, "the two keys are not interchangeable");

  assert.equal(repoSlug("https://github.com/yajay0411/next_login_javatestcase.git")?.fullName,
    "yajay0411/next_login_javatestcase");
  assert.equal(repoSlug("git@github.com:o/r.git")?.fullName, "o/r");
  assert.equal(repoSlug(null), null);
  assert.equal(repoSlug("https://gitlab.com/o/r.git"), null, "non-GitHub remotes are not healed");

  assert.equal(
    branchName({ jobName: "next_login_javatestcase", buildNumber: 42, constantName: "EMAIL_INPUT" }),
    "heal/next-login-javatestcase-42-email-input",
  );
}

console.log("heal: all checks passed");
