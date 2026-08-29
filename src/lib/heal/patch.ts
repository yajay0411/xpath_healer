const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GATE 4 and GATE 6.
 *
 * This module, not the model, performs every write. The model's output type has no field
 * for a file path, a diff, or a command, so the worst a bad proposal can be is a bad string
 * — and a bad string dies here or at the RED/GREEN gates.
 */

/** The only path shape the healer may write to. */
const ALLOWED_FILE = /^src\/test\/java\/com\/nextlogin\/pages\/\w+\.java$/;

/** The only line shape that may change inside it. */
const LOCATOR_LINE = /^[+-]\s*(public\s+static\s+final\s+String\s+\w+\s*=|\s*"|\s*\+\s*")/;

/** A one-line locator swap is 2 changed lines. Six allows a wrapped literal, nothing more. */
const MAX_CHANGED_LINES = 6;

export type ApplyResult =
  | { ok: true; source: string }
  | { ok: false; reason: string };

/**
 * GATE 4 — replace exactly one literal, inside the constant already identified by
 * findLocator. Refuses if the literal is absent or appears more than once.
 */
export function applyLocator(
  source: string,
  constantName: string,
  oldXpath: string,
  newXpath: string,
): ApplyResult {
  if (oldXpath === newXpath) return { ok: false, reason: "candidate_identical_to_broken" };
  if (!newXpath.startsWith("/")) return { ok: false, reason: "candidate_not_an_xpath" };
  // A literal carrying a quote or backslash would need escaping we deliberately do not do.
  if (/["\\\n]/.test(newXpath)) return { ok: false, reason: "candidate_needs_escaping" };

  // Anchor on the constant so an identical literal under a different name is never touched.
  const declaration = new RegExp(
    String.raw`(public\s+static\s+final\s+String\s+${escapeRe(constantName)}\s*=\s*)("(?:[^"\\]|\\.)*"(?:\s*\+\s*"(?:[^"\\]|\\.)*")*)(\s*;)`,
  );

  const found = source.match(declaration);
  if (!found) return { ok: false, reason: "constant_not_found" };

  const literalValue = found[2].replace(/"\s*\+\s*"/g, "").slice(1, -1);
  if (literalValue !== oldXpath) return { ok: false, reason: "literal_changed_since_diagnosis" };

  const patched = source.replace(declaration, `$1${JSON.stringify(newXpath)}$3`);
  if (patched === source) return { ok: false, reason: "substitution_was_a_noop" };
  return { ok: true, source: patched };
}

export type DiffVerdict = { ok: boolean; reason?: string; files: string[]; changedLines: number };

/**
 * GATE 6 — the last line of defence, run on the real `git diff` immediately before push.
 * Whatever happened upstream, this is what physically leaves the machine.
 */
export function diffIsSafe(diff: string): DiffVerdict {
  const files = [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((m) => m[2]);

  if (files.length === 0) return { ok: false, reason: "empty_diff", files, changedLines: 0 };
  if (files.length !== 1) {
    return { ok: false, reason: `expected_1_file_got_${files.length}`, files, changedLines: 0 };
  }
  if (!ALLOWED_FILE.test(files[0])) {
    return { ok: false, reason: `path_not_allowed:${files[0]}`, files, changedLines: 0 };
  }

  const changed = diff
    .split("\n")
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));

  if (changed.length > MAX_CHANGED_LINES) {
    return {
      ok: false,
      reason: `too_many_changed_lines:${changed.length}`,
      files,
      changedLines: changed.length,
    };
  }

  for (const line of changed) {
    if (!LOCATOR_LINE.test(line)) {
      return { ok: false, reason: `non_locator_line:${line.trim().slice(0, 80)}`, files, changedLines: changed.length };
    }
  }

  return { ok: true, files, changedLines: changed.length };
}

export { ALLOWED_FILE, MAX_CHANGED_LINES };
