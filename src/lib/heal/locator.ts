import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type FoundLocator = {
  /** Repo-relative path. */
  file: string;
  constantName: string;
  oldXpath: string;
};

/** The only directory the healer may ever write to. */
const PAGES_DIR = join("src", "test", "java", "com", "nextlogin", "pages");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Find the `public static final String NAME = "<xpath>"` that produced this failure.
 *
 * Matched on the exact literal, because Selenium echoes back the string it was handed. The
 * model is never asked which file to edit: if this returns null the run stops, which is the
 * correct outcome for a locator built at runtime or living outside the page objects.
 */
export function findLocator(repoDir: string, brokenXpath: string): FoundLocator | null {
  if (!brokenXpath) return null;

  let files: string[];
  try {
    files = readdirSync(join(repoDir, PAGES_DIR)).filter((f) => f.endsWith(".java"));
  } catch {
    return null;
  }

  // Java allows a literal to be split across concatenated lines; join them before matching.
  const pattern = new RegExp(
    String.raw`public\s+static\s+final\s+String\s+(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;`,
    "g",
  );

  for (const name of files.sort()) {
    const rel = join(PAGES_DIR, name);
    let src: string;
    try {
      src = readFileSync(join(repoDir, rel), "utf8");
    } catch {
      continue;
    }

    const joined = src.replace(/"\s*\+\s*"/g, "");
    for (const m of joined.matchAll(pattern)) {
      if (m[2] === brokenXpath) {
        return { file: rel, constantName: m[1], oldXpath: m[2] };
      }
    }
  }
  return null;
}

export const PAGE_OBJECT_DIR = PAGES_DIR;
