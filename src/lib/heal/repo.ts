import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

/** Token in the remote, never in a committed file or a log line. */
function authedUrl(repoFullName: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return `https://x-access-token:${token}@github.com/${repoFullName}.git`;
}

/**
 * Shallow-clone the exact failing commit. Never `main`: the drift is a property of that
 * commit, and healing against a moved HEAD would verify something nobody reported.
 */
export async function checkoutCommit(repoFullName: string, commitSha: string) {
  const dir = await mkdtemp(join(tmpdir(), "heal-"));
  const url = authedUrl(repoFullName);

  await exec("git", ["init", "-q", dir]);
  await git(dir, "remote", "add", "origin", url);
  await git(dir, "fetch", "--depth", "1", "origin", commitSha);
  await git(dir, "checkout", "-q", "FETCH_HEAD");

  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}),
  };
}

/** Redacts the token before anything reaches a log or an audit row. */
export const scrub = (s: string) =>
  process.env.GITHUB_TOKEN ? s.split(process.env.GITHUB_TOKEN).join("«token»") : s;
