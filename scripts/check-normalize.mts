/**
 * Run: npm run check
 * Real Selenium failure text, taken from actual next_login_javatestcase runs.
 */
import assert from "node:assert/strict";
import { diagnose, extractXpaths, normalize } from "../src/lib/normalize.ts";

// --- extractXpaths -------------------------------------------------------
assert.deepEqual(
  extractXpaths(
    "Expected condition failed: waiting for visibility of element located by By.xpath: //input[@id='email' and @type='email'] (tried for 30 second(s))",
  ),
  ["//input[@id='email' and @type='email']"],
  "By.xpath form, with the 'tried for' suffix trimmed",
);

assert.deepEqual(
  extractXpaths(
    'no such element: Unable to locate element: {"method":"xpath","selector":"//button[@type=\'submit\']"}',
  ),
  ["//button[@type='submit']"],
  "NoSuchElementException JSON form",
);

assert.deepEqual(
  extractXpaths("//dt[normalize-space()='User ID']/following-sibling::dd[1]"),
  ["//dt[normalize-space()='User ID']/following-sibling::dd[1]"],
  "axis steps and chained predicates survive intact",
);

assert.deepEqual(
  extractXpaths("Could not reach http://localhost:3000/login"),
  [],
  "a URL's double slash is not an XPath",
);

assert.deepEqual(extractXpaths(""), [], "empty input is empty output");

// --- diagnose ------------------------------------------------------------
const locatorFailure = {
  className: "com.nextlogin.tests.ElementPresenceTest",
  testName: "loginPageShowsAllElements",
  message:
    "Expected condition failed: waiting for visibility of element located by By.xpath: //input[@id='email']",
  stackTrace: "org.openqa.selenium.TimeoutException: Expected condition failed",
  xpaths: ["//input[@id='email']"],
};

const assertionFailure = {
  className: "com.nextlogin.tests.DeliberateFailureTest",
  testName: "headingTextIsWrongOnPurpose",
  message: "expected [Welcome back, friend] but found [Welcome back]",
  stackTrace: "java.lang.AssertionError\n\tat org.testng.Assert.fail(Assert.java:111)",
  xpaths: [],
};

assert.equal(diagnose([locatorFailure]).xpathRelated, true, "locator exception + XPath is drift");
assert.deepEqual(diagnose([locatorFailure]).suspectXpaths, ["//input[@id='email']"]);

// The whole point: a plain wrong-expectation failure must NOT be sent to the healer.
assert.equal(
  diagnose([assertionFailure]).xpathRelated,
  false,
  "an assertion failure is a real bug, not XPath drift",
);
assert.equal(diagnose([]).xpathRelated, false, "no failures means nothing to heal");

// A locator exception with no extractable XPath is not ours to fix either.
assert.equal(
  diagnose([{ ...assertionFailure, message: "NoSuchElementException: by css .foo" }]).xpathRelated,
  false,
  "locator failure without an XPath is not XPath drift",
);

// --- normalize -----------------------------------------------------------
const out = normalize({
  job: "next_login_javatestcase",
  build: "7",
  url: "http://localhost:8080/job/next_login_javatestcase/7/",
  result: "failure",
  branch: "origin/main",
  commit: "abc123",
  testsTotal: 17,
  testsFailed: 1,
  failures: [locatorFailure],
});

assert.equal(out.event, "build.failed");
assert.equal(out.build.number, 7, "a numeric string becomes a number");
assert.equal(out.build.result, "FAILURE", "result is upper-cased");
assert.equal(out.scm.branch, "main", "the origin/ prefix is stripped");
assert.equal(out.diagnosis.xpathRelated, true);

assert.equal(normalize({ result: "SUCCESS" }).event, "build.succeeded");
assert.equal(normalize({}).build.job, "unknown", "garbage in does not throw");
assert.deepEqual(normalize({ failures: "not-an-array" }).tests.failures, []);

console.log("normalize: all checks passed");
