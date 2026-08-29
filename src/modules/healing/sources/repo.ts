import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Redacts the token before anything reaches a log, an error or an audit row. */
export const scrub = (s: string) =>
  process.env.GITHUB_TOKEN ? s.split(process.env.GITHUB_TOKEN).join("«token»") : s;

/**
 * Every git invocation goes through here, and every failure is scrubbed on the way out.
 *
 * execFile puts the full argv in both `message` and `cmd`, and the clone remote carries the
 * token - so an unscrubbed git failure writes the PAT verbatim into the run output, the
 * console and the audit trace. Scrubbing at each call site is one forgotten catch away from
 * leaking; doing it here is not.
 */
async function run(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch (e) {
    const err = e as { message?: string; stderr?: string };
    throw new Error(scrub(err.stderr?.trim() || err.message || "git failed"));
  }
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return run(cwd, args);
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

  await run(tmpdir(), ["init", "-q", dir]);
  await git(dir, "remote", "add", "origin", url);
  await git(dir, "fetch", "--depth", "1", "origin", commitSha);
  await git(dir, "checkout", "-q", "FETCH_HEAD");

  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}),
  };
}
