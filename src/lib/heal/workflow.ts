import { NonRetriableError } from "inngest";

import { inngest, jenkinsVerifyCompleted, xpathFailureDetected } from "../events";
import { db } from "../supabase";
import { getDom } from "../storage";
import { finish, recordAttempt, recordVerify, trace, updateRun } from "./audit";
import { checkBudget, repoAllowed } from "./budget";
import { deterministicCandidates } from "./candidates";
import { findLocator } from "./locator";
import { applyLocator, diffIsSafe } from "./patch";
import { branchName, deleteBranch, openPullRequest, type PrEvidence } from "./pr";
import { checkoutCommit, git } from "./repo";
import { triggerVerify } from "./verify";
import { gateSingleMatch } from "./xpath-eval";
import { provider } from "./providers";

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERIFY_TIMEOUT = process.env.HEAL_VERIFY_TIMEOUT ?? "30m";

/**
 * The PR already open for this exact drift, if there is one.
 *
 * Checked twice: once at STEP A as a cheap early-out, and again immediately before the PR is
 * opened. Once is not enough - a heal takes minutes and waitForEvent releases the concurrency
 * slot while it waits, so a second build clears STEP A long before the first records its PR.
 * The late check narrows that window from minutes to the round trip below.
 */
async function existingPrUrl(
  repoFullName: string,
  commitSha: string,
  brokenXpath: string,
): Promise<string | null> {
  const { data } = await db
    .from("heal_run")
    .select("pr_url")
    .eq("repo_full_name", repoFullName)
    .eq("commit_sha", commitSha)
    .eq("broken_xpath", brokenXpath)
    .not("pr_url", "is", null)
    .limit(1)
    .maybeSingle();
  return (data?.pr_url as string | undefined) ?? null;
}

/**
 * The durable healing workflow. Orchestration only: every decision lives in a pure module
 * beside this one, so each gate is testable without Inngest, Jenkins or a network.
 *
 * There is no polling anywhere. The two verification builds run on Jenkins and report back
 * through the same webhook that started the heal; this function suspends on waitForEvent
 * in between and is not resident while it waits.
 */
export const healXpath = inngest.createFunction(
  {
    id: "heal-xpath",
    triggers: [{ event: xpathFailureDetected }],
    // Three layers, each covering what the one below cannot:
    //
    // 1. idempotency - collapses the many events a SINGLE build emits for one locator.
    //    Scoped to the build, so re-running the job is a real retry, not a silent no-op.
    // 2. singleton   - no two heals for the SAME drift run at once. concurrency cannot do
    //    this: its slot is released during waitForEvent, which is most of a heal's wall
    //    clock, so a second build would sail straight past it and open a duplicate PR.
    // 3. the heal_run pr_url check in STEP A - the durable, across-time guarantee that one
    //    drift never gets two PRs, long after any in-memory lock has expired.
    idempotency: "event.data.idempotencyKey",
    singleton: { key: "event.data.driftKey", mode: "skip" },
    // Two heals must never race the same checkout.
    concurrency: { key: "event.data.repository.fullName", limit: 1 },
    retries: 3,
  },
  async ({ event, step }) => {
    const d = event.data;

    // ---- STEP A: validate ------------------------------------------------
    const runId = await step.run("validate", async () => {
      if (!repoAllowed(d.repository.fullName)) {
        throw new NonRetriableError(`repo_not_allowed:${d.repository.fullName}`);
      }
      const budget = await checkBudget();
      if (!budget.ok) throw new NonRetriableError(`budget:${budget.reason}`);

      // The durable guarantee, and the only one that must survive a restart: never open a
      // second PR for a drift that already has one. Anything short of an open PR - a crash, a
      // failed gate, a rejected candidate - is retryable, so re-running the Jenkins job is a
      // real retry rather than a silent no-op. Re-checked before the PR is actually opened.
      const already = await existingPrUrl(
        d.repository.fullName,
        d.scm.commitSha,
        d.failure.brokenXpath,
      );
      if (already) throw new NonRetriableError(`already_healed:${already}`);

      const { data, error } = await db
        .from("heal_run")
        .upsert(
          {
            event_id: d.eventId,
            idempotency_key: d.idempotencyKey,
            repo_full_name: d.repository.fullName,
            commit_sha: d.scm.commitSha,
            branch: d.scm.branch ?? null,
            job_name: d.build.jobName,
            build_number: d.build.buildNumber,
            build_url: d.build.buildUrl ?? null,
            test_class: d.failure.testClass,
            test_name: d.failure.testName,
            broken_xpath: d.failure.brokenXpath,
            failure_msg: d.failure.failureMessage,
            page_url: d.failure.pageUrl ?? null,
            dom_reference: d.failure.domReference ?? null,
            status: "healing",
          },
          { onConflict: "idempotency_key" },
        )
        .select("id")
        .single();

      if (error || !data) throw new Error(`could not open heal_run: ${error?.message}`);
      return data.id as string;
    });

    if (!d.failure.domReference) {
      await step.run("no-dom", () => finish(runId, "skipped", "no_dom_captured"));
      return { status: "skipped", reason: "no_dom_captured" };
    }

    // ---- STEP B+C: source and locator ------------------------------------
    const located = await step.run("find-locator", async () => {
      const { dir, cleanup } = await checkoutCommit(d.repository.fullName, d.scm.commitSha);
      try {
        const found = findLocator(dir, d.failure.brokenXpath);
        await trace(runId, "find-locator", found ? "found" : "not_found", { ...found });
        return found;
      } finally {
        await cleanup();
      }
    });

    if (!located) {
      await step.run("locator-missing", () => finish(runId, "skipped", "locator_not_found"));
      return { status: "skipped", reason: "locator_not_found" };
    }

    await step.run("record-locator", () =>
      updateRun(runId, { source_file: located.file, constant_name: located.constantName }),
    );

    // ---- fetch the sanitized DOM ----------------------------------------
    const dom = await step.run("fetch-dom", async () => {
      const html = await getDom(d.failure.domReference!);
      if (!html) throw new NonRetriableError("dom_unreadable");
      return html;
    });

    // ---- STEP D: deterministic first, AI only if it comes up empty -------
    const chosen = await step.run("choose-candidate", async () => {
      for (const xpath of deterministicCandidates(d.failure.brokenXpath)) {
        const gate = await gateSingleMatch(dom, xpath);
        await recordAttempt(runId, {
          strategy: "deterministic",
          candidate: xpath,
          match_count: gate.matchCount,
          verdict: gate.ok ? "accepted" : "rejected",
          reject_reason: gate.reason ?? null,
        });
        if (gate.ok) return { xpath, strategy: "deterministic" as const };
      }
      return null;
    });

    const candidate =
      chosen ??
      (await step.run("ai-fallback", async () => {
        const budget = await checkBudget();
        if (!budget.ok) throw new NonRetriableError(`budget:${budget.reason}`);

        const llm = provider();

        // Inline, NOT a nested step.run: Inngest forbids nesting step tooling, and a nested
        // call hangs the run rather than failing it. This block is already durable - it is
        // inside the ai-fallback step.
        const { dir, cleanup } = await checkoutCommit(d.repository.fullName, d.scm.commitSha);
        let sourceFile: string;
        try {
          sourceFile = readFileSync(join(dir, located.file), "utf8");
        } finally {
          await cleanup();
        }

        const request = {
          brokenXpath: d.failure.brokenXpath,
          constantName: located.constantName,
          sourceFile,
          failureMessage: d.failure.failureMessage,
          sanitizedDom: dom,
          pageUrl: d.failure.pageUrl,
        };

        const { proposal, usage } = await llm.propose(request);

        for (const c of proposal.candidates) {
          const gate = await gateSingleMatch(dom, c.xpath);
          await recordAttempt(runId, {
            strategy: "ai",
            provider: llm.name,
            model: llm.model,
            prompt: { ...request, sanitizedDom: `«${dom.length} chars»` },
            response: proposal,
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            cached_tokens: usage.cachedTokens,
            cost_usd: usage.costUsd,
            latency_ms: usage.latencyMs,
            candidate: c.xpath,
            match_count: gate.matchCount,
            verdict: gate.ok ? "accepted" : "rejected",
            reject_reason: gate.reason ?? null,
          });
          if (gate.ok) {
            return {
              xpath: c.xpath,
              strategy: "ai" as const,
              rationale: c.rationale,
              provider: llm.name,
              model: llm.model,
            };
          }
        }
        return null;
      }));

    if (!candidate) {
      // A successful outcome: the test stays loudly red for a human.
      await step.run("no-candidate", () => finish(runId, "no_candidate", "no_candidate_passed_gates"));
      return { status: "no_candidate" };
    }

    await step.run("record-candidate", () =>
      updateRun(runId, { candidate_xpath: candidate.xpath, strategy: candidate.strategy }),
    );

    // ---- GATE 3: prove RED -----------------------------------------------
    await step.run("trigger-red", () =>
      triggerVerify({
        runId,
        phase: "red",
        gitRef: d.scm.commitSha,
        repoFullName: d.repository.fullName,
      }),
    );

    const red = await step.waitForEvent("await-red", {
      event: jenkinsVerifyCompleted,
      timeout: VERIFY_TIMEOUT,
      if: `async.data.healRunId == "${runId}" && async.data.phase == "red"`,
    });

    if (!red) {
      await step.run("red-timeout", () => finish(runId, "failed", "verify_timeout_red"));
      return { status: "failed", reason: "verify_timeout_red" };
    }

    await step.run("record-red", () =>
      recordVerify(runId, {
        phase: "red",
        git_ref: d.scm.commitSha,
        build_number: red.data.buildNumber,
        build_url: red.data.buildUrl ?? null,
        result: red.data.result,
        tests_total: red.data.tests.total,
        tests_failed: red.data.tests.failed,
        target_failed_on_locator: red.data.targetFailedOnLocator,
        finished_at: new Date().toISOString(),
      }),
    );

    if (!red.data.targetFailedOnLocator) {
      // It passed, or it failed for another reason. Never PR a flake.
      await step.run("not-reproducible", () => finish(runId, "skipped", "not_reproducible"));
      return { status: "skipped", reason: "not_reproducible" };
    }

    // ---- GATE 4 + 6: apply, check the diff, push -------------------------
    const branch = branchName({
      jobName: d.build.jobName,
      buildNumber: d.build.buildNumber,
      constantName: located.constantName,
    });

    const patched = await step.run("apply-and-push", async () => {
      const { dir, cleanup } = await checkoutCommit(d.repository.fullName, d.scm.commitSha);
      try {
        const abs = join(dir, located.file);
        const applied = applyLocator(
          readFileSync(abs, "utf8"),
          located.constantName,
          located.oldXpath,
          candidate.xpath,
        );
        if (!applied.ok) throw new NonRetriableError(`apply:${applied.reason}`);
        writeFileSync(abs, applied.source);

        const verdict = diffIsSafe(await git(dir, "diff"));
        await trace(runId, "gate-diff", verdict.ok ? "pass" : "fail", { ...verdict });
        // This gate should never fire. If it does, something upstream is wrong.
        if (!verdict.ok) throw new NonRetriableError(`diff_policy:${verdict.reason}`);

        await git(dir, "config", "user.name", "xpath-healer[bot]");
        await git(dir, "config", "user.email", "xpath-healer@users.noreply.github.com");
        await git(dir, "checkout", "-q", "-b", branch);
        await git(dir, "add", located.file);
        // The only commit on this branch: it is what GATE 5 verifies and what the PR shows.
        await git(
          dir,
          "commit",
          "-q",
          "-m",
          `fix(locators): heal ${located.constantName} after markup change\n\n` +
            `${d.build.jobName}#${d.build.buildNumber} · run ${runId}\n` +
            `Was:  ${located.oldXpath}\nNow:  ${candidate.xpath}\n\n` +
            `Opened by xpath_healer. Review before merging.`,
        );
        await git(dir, "push", "-q", "-f", "-u", "origin", branch);

        return { changedLines: verdict.changedLines };
      } finally {
        await cleanup();
      }
    });

    await step.run("record-branch", () => updateRun(runId, { branch_name: branch }));

    // ---- GATE 5: prove GREEN on the full suite ---------------------------
    await step.run("trigger-green", () =>
      triggerVerify({ runId, phase: "green", gitRef: branch, repoFullName: d.repository.fullName }),
    );

    const green = await step.waitForEvent("await-green", {
      event: jenkinsVerifyCompleted,
      timeout: VERIFY_TIMEOUT,
      if: `async.data.healRunId == "${runId}" && async.data.phase == "green"`,
    });

    if (!green) {
      await step.run("green-timeout", async () => {
        const { dir, cleanup } = await checkoutCommit(d.repository.fullName, d.scm.commitSha);
        await deleteBranch(dir, branch).finally(cleanup);
        await finish(runId, "failed", "verify_timeout_green");
      });
      return { status: "failed", reason: "verify_timeout_green" };
    }

    await step.run("record-green", () =>
      recordVerify(runId, {
        phase: "green",
        git_ref: branch,
        build_number: green.data.buildNumber,
        build_url: green.data.buildUrl ?? null,
        result: green.data.result,
        tests_total: green.data.tests.total,
        tests_failed: green.data.tests.failed,
        target_failed_on_locator: green.data.targetFailedOnLocator,
        finished_at: new Date().toISOString(),
      }),
    );

    if (green.data.result !== "SUCCESS") {
      await step.run("green-failed", async () => {
        const { dir, cleanup } = await checkoutCommit(d.repository.fullName, d.scm.commitSha);
        await deleteBranch(dir, branch).finally(cleanup);
        await finish(runId, "rejected", `green_failed:${green.data.tests.failed}_tests`);
      });
      return { status: "rejected", reason: "green_failed" };
    }

    await step.run("mark-verified", () => updateRun(runId, { status: "verified" }));

    // ---- open the PR. A human merges it; there is no auto-merge path. ----
    // No checkout, no re-apply: the branch is already pushed and already proved green. This
    // step only asks GitHub to open the PR for it.
    const prUrl = await step.run("create-pr", async () => {
      // Last check before the irreversible bit. STEP A cleared minutes ago; another build for
      // the same drift may have opened its PR since.
      const raced = await existingPrUrl(
        d.repository.fullName,
        d.scm.commitSha,
        d.failure.brokenXpath,
      );
      if (raced) throw new NonRetriableError(`already_healed:${raced}`);

      const evidence: PrEvidence = {
        repoFullName: d.repository.fullName,
        runId,
        jobName: d.build.jobName,
        buildNumber: d.build.buildNumber,
        buildUrl: d.build.buildUrl,
        commitSha: d.scm.commitSha,
        testClass: d.failure.testClass,
        testName: d.failure.testName,
        file: located.file,
        constantName: located.constantName,
        oldXpath: located.oldXpath,
        newXpath: candidate.xpath,
        strategy: candidate.strategy,
        provider: "provider" in candidate ? candidate.provider : undefined,
        model: "model" in candidate ? candidate.model : undefined,
        rationale: "rationale" in candidate ? candidate.rationale : undefined,
        matchCount: 1,
        redTests: `${red.data.tests.failed}/${red.data.tests.total} failed`,
        greenTests: `${green.data.tests.total}/${green.data.tests.total} passed`,
        changedLines: patched.changedLines,
      };
      return await openPullRequest(evidence);
    });

    await step.run("finish", () => finish(runId, "pr_open", undefined, prUrl));
    await step.sendEvent("announce", {
      name: "xpath/heal.completed",
      data: { healRunId: runId, status: "pr_open", prUrl },
    });

    return { status: "pr_open", prUrl };
  },
);
