import type { Diagnosis, NormalizedBuildFailure, TestFailure } from "./types";

/**
 * Selenium reports a missing element three different ways depending on which call failed,
 * so we look for all three rather than guessing which one Jenkins will hand us.
 */
const XPATH_PATTERNS: RegExp[] = [
  // ExpectedConditions: "waiting for visibility of element located by By.xpath: //input[@id='email']"
  /By\.xpath:\s*(\S[^\n]*?)(?=\s*\(tried for|\s*$)/gm,
  // NoSuchElementException: {"method":"xpath","selector":"//input[@id='email']"}
  /"method"\s*:\s*"xpath"\s*,\s*"selector"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
];

/**
 * A bare XPath sitting in a message. The lookbehind keeps it from matching the "//" in a URL,
 * and predicates are matched non-greedily to the first "]" since our locators never nest them.
 */
const BARE_XPATH =
  /(?<!:)(\/\/[A-Za-z_*][\w.:-]*(?:\[[^\]]*\])*(?:\/{1,2}[A-Za-z_*][\w.:-]*(?:\[[^\]]*\])*)*)/g;

/** Exceptions that mean "the locator did not find what it expected", as opposed to a real bug. */
const LOCATOR_ERROR =
  /NoSuchElementException|TimeoutException|StaleElementReferenceException|ElementNotInteractableException|ElementClickInterceptedException|Unable to locate element|no such element/i;

export function extractXpaths(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];

  for (const pattern of XPATH_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) found.push(match[1].trim());
    }
  }
  for (const match of text.matchAll(BARE_XPATH)) {
    if (match[1]) found.push(match[1].trim());
  }

  return [...new Set(found)];
}

export function diagnose(failures: TestFailure[]): Diagnosis {
  const suspectXpaths = [...new Set(failures.flatMap((f) => f.xpaths))];

  if (failures.length === 0) {
    return { xpathRelated: false, suspectXpaths: [], reason: "No test failures reported." };
  }

  const locatorFailures = failures.filter((f) =>
    LOCATOR_ERROR.test(`${f.message}\n${f.stackTrace}`),
  );

  if (locatorFailures.length === 0) {
    return {
      xpathRelated: false,
      suspectXpaths,
      reason:
        "No locator exception in any failure. This reads as a genuine assertion or app failure, not XPath drift.",
    };
  }
  if (suspectXpaths.length === 0) {
    return {
      xpathRelated: false,
      suspectXpaths,
      reason: `${locatorFailures.length} locator failure(s), but no XPath could be extracted. Likely a CSS or id locator.`,
    };
  }

  return {
    xpathRelated: true,
    suspectXpaths,
    reason: `${locatorFailures.length} of ${failures.length} failure(s) raised a locator exception naming ${suspectXpaths.length} XPath(s). The element likely moved or the markup changed.`,
  };
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

function toFailure(raw: Record<string, unknown>): TestFailure {
  const message = str(raw.message) ?? "";
  const stackTrace = str(raw.stackTrace) ?? "";
  return {
    className: str(raw.className) ?? "unknown",
    testName: str(raw.testName) ?? str(raw.name) ?? "unknown",
    message,
    stackTrace,
    xpaths: extractXpaths(`${message}\n${stackTrace}`),
  };
}

/** Jenkins' wire format in, our stable shape out. Never throws: bad input yields empty fields. */
export function normalize(raw: Record<string, unknown>): NormalizedBuildFailure {
  const rawFailures = Array.isArray(raw.failures) ? raw.failures : [];
  const failures = rawFailures
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map(toFailure);

  const result = str(raw.result)?.toUpperCase() ?? null;
  const event =
    result === "SUCCESS"
      ? "build.succeeded"
      : result === "UNSTABLE"
        ? "build.unstable"
        : "build.failed";

  return {
    source: "jenkins",
    event,
    occurredAt: str(raw.occurredAt) ?? new Date().toISOString(),
    build: {
      job: str(raw.job) ?? "unknown",
      number: num(raw.build),
      url: str(raw.url),
      result,
      durationMs: num(raw.durationMs),
    },
    scm: {
      repoUrl: str(raw.repoUrl),
      // Jenkins hands back "origin/main"; downstream wants the branch name alone.
      branch: str(raw.branch)?.replace(/^origin\//, "") ?? null,
      commit: str(raw.commit),
    },
    tests: {
      total: num(raw.testsTotal),
      passed: num(raw.testsPassed),
      failed: num(raw.testsFailed),
      skipped: num(raw.testsSkipped),
      failures,
    },
    consoleTail: str(raw.consoleTail),
    diagnosis: diagnose(failures),
  };
}
