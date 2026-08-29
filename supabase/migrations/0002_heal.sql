-- The event-driven healing pipeline. webhook_log (0001) is unchanged and still the
-- transport-level record; these tables are the domain-level one.

create table if not exists public.heal_run (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  event_id        text not null,
  webhook_id      uuid references public.webhook_log(id) on delete set null,
  idempotency_key text not null,

  repo_full_name  text not null,
  commit_sha      text not null,
  branch          text,
  job_name        text,
  build_number    int,
  build_url       text,

  test_class      text,
  test_name       text,
  broken_xpath    text not null,
  failure_msg     text,
  page_url        text,
  dom_reference   text,               -- storage path, never the DOM itself

  -- filled in as the workflow advances
  source_file     text,
  constant_name   text,
  strategy        text,               -- deterministic | ai
  candidate_xpath text,
  branch_name     text,

  status          text not null default 'received',
  reason          text,
  pr_url          text,
  gates           jsonb not null default '{}'::jsonb,
  finished_at     timestamptz,

  constraint heal_run_status_ck check (status in (
    'received','diagnosed','healing','no_candidate','skipped',
    'rejected','verified','pr_open','failed'
  ))
);

-- The durable idempotency layer. The same locator, broken at the same commit, is ONE run.
-- Even if Inngest replays and the webhook double-fires, a second PR is impossible.
create unique index if not exists heal_run_idempotency_key
  on public.heal_run (idempotency_key);
create index if not exists heal_run_status_idx on public.heal_run (created_at desc, status);

-- One row per candidate evaluated, whether it came from the heuristics or a model.
create table if not exists public.heal_attempt (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  run_id        uuid not null references public.heal_run(id) on delete cascade,

  strategy      text not null,        -- deterministic | ai
  provider      text,
  model         text,
  prompt        jsonb,                -- post-redaction, exactly as sent
  response      jsonb,
  input_tokens  int,
  output_tokens int,
  cached_tokens int,
  cost_usd      numeric(10,5),
  latency_ms    int,

  candidate     text,
  match_count   int,                  -- GATE 2: -1 unparseable, 0, 1, or >1
  verdict       text not null,        -- accepted | rejected
  reject_reason text
);
create index if not exists heal_attempt_run_idx on public.heal_attempt (run_id, created_at);

-- One row per Jenkins verification build.
create table if not exists public.verify_run (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  run_id        uuid not null references public.heal_run(id) on delete cascade,

  phase         text not null,        -- red | green
  git_ref       text not null,
  build_number  int,
  build_url     text,
  result        text,
  tests_total   int,
  tests_failed  int,
  target_failed_on_locator boolean,
  finished_at   timestamptz,

  constraint verify_run_phase_ck check (phase in ('red','green'))
);
create index if not exists verify_run_run_idx on public.verify_run (run_id, created_at);

-- Append-only state transitions. Every step the workflow takes is observable here,
-- independently of the Inngest dashboard.
create table if not exists public.heal_event (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  run_id uuid not null references public.heal_run(id) on delete cascade,
  step   text not null,
  status text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists heal_event_run_idx on public.heal_event (run_id, at);

alter table public.heal_run     enable row level security;
alter table public.heal_attempt enable row level security;
alter table public.verify_run   enable row level security;
alter table public.heal_event   enable row level security;

grant select, insert, update, delete
  on table public.heal_run, public.heal_attempt, public.verify_run, public.heal_event
  to service_role;
grant usage, select on sequence public.heal_event_id_seq to service_role;

-- Private bucket for captured DOM. Sanitized and redacted BEFORE it is written here,
-- so an unredacted credential never reaches storage in the first place.
insert into storage.buckets (id, name, public)
values ('heal-dom', 'heal-dom', false)
on conflict (id) do nothing;
