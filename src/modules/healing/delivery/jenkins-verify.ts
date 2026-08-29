import { trace } from "@/modules/healing/audit";

/**
 * Triggers the Jenkins heal-verify job and returns. It does NOT wait: the workflow suspends
 * on step.waitForEvent, and the build reports back through the same webhook that started the
 * heal. Nothing polls anything.
 *
 * Jenkins is the executor rather than this process because it already has the JDK, Chrome,
 * the workspace and a route to the app — and because a GREEN from the pipeline that produced
 * the RED means exactly the negation of that RED.
 */
export async function triggerVerify(params: {
  runId: string;
  phase: "red" | "green";
  gitRef: string;
  repoFullName: string;
}): Promise<{ queued: boolean; detail: string }> {
  const base = process.env.JENKINS_URL;
  const user = process.env.JENKINS_USER;
  const token = process.env.JENKINS_API_TOKEN;
  const job = process.env.JENKINS_VERIFY_JOB ?? "heal-verify";

  if (!base || !user || !token) {
    throw new Error("JENKINS_URL, JENKINS_USER and JENKINS_API_TOKEN must be set");
  }

  const query = new URLSearchParams({
    GIT_REF: params.gitRef,
    HEAL_RUN_ID: params.runId,
    PHASE: params.phase,
    REPO: params.repoFullName,
  });

  const response = await fetch(`${base}/job/${job}/buildWithParameters?${query}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`,
    },
  });

  // Jenkins answers 201 with a queue URL; the build number is not known yet and is not needed,
  // because correlation is by HEAL_RUN_ID in the callback, not by build number.
  const detail = `${response.status} ${response.headers.get("location") ?? ""}`.trim();
  await trace(params.runId, `trigger-${params.phase}`, response.ok ? "queued" : "failed", {
    gitRef: params.gitRef,
    detail,
  });

  if (!response.ok) throw new Error(`Jenkins refused the ${params.phase} build: ${detail}`);
  return { queued: true, detail };
}
