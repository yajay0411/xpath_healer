-- Every inbound webhook hit, accepted or rejected, lands here exactly once.
-- Rejected hits are logged too: an attacker probing the endpoint is data we want.

create table if not exists public.webhook_log (
  id            uuid primary key default gen_random_uuid(),
  received_at   timestamptz not null default now(),

  -- transport: what arrived and how we answered
  source        text        not null default 'jenkins',
  event         text,
  delivery_id   text,
  http_status   int         not null,
  auth_ok       boolean     not null,
  headers       jsonb       not null default '{}'::jsonb,
  raw_payload   jsonb,
  normalized    jsonb,
  parse_error   text,

  -- lifted out of the payload so the common queries need no jsonb digging
  job_name      text,
  build_number  int,
  build_url     text,
  build_result  text,
  branch        text,
  commit_sha    text,
  tests_total   int,
  tests_failed  int,

  -- the signal the healer keys off: does this look like XPath drift?
  xpath_related boolean     not null default false,
  suspect_xpaths text[]     not null default '{}'
);

comment on table public.webhook_log is
  'Inbound CI webhook deliveries. raw_payload is kept verbatim so a normalizer bug is always recoverable.';

create index if not exists webhook_log_received_at_idx on public.webhook_log (received_at desc);
create index if not exists webhook_log_job_build_idx   on public.webhook_log (job_name, build_number desc);
create index if not exists webhook_log_xpath_idx       on public.webhook_log (received_at desc) where xpath_related;

-- Jenkins can retry a delivery; the same delivery must not create a second row.
create unique index if not exists webhook_log_delivery_id_key
  on public.webhook_log (source, delivery_id) where delivery_id is not null;

-- No policies on purpose: only the secret key reaches this table, never a browser.
alter table public.webhook_log enable row level security;

-- Created as `postgres`, so Supabase's default grants do not apply. Grant explicitly.
-- Only service_role: anon and authenticated must never touch this table.
grant select, insert, update, delete on table public.webhook_log to service_role;
