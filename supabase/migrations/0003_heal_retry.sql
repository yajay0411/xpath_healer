-- Re-running a Jenkins job must be a real retry, not a silent no-op.
--
-- heal_run.idempotency_key is now scoped to the build, so it only collapses the many events
-- one build emits for a single locator. The durable "never open two PRs for the same drift"
-- guarantee moved to a lookup in STEP A, which this index serves.
create index if not exists heal_run_drift_idx
  on public.heal_run (repo_full_name, commit_sha, broken_xpath)
  where pr_url is not null;
