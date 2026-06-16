-- 0001_cosign_intervention_surface.sql
-- Schema + RLS for the live path of the Cosign Intervention Surface. The simulator needs
-- none of this (it is in-memory, zero-infra); this is what GOVERNANCE_SOURCE=cognigate
-- persists to. Apply with the Supabase CLI (supabase db push) or paste into the SQL editor.
--
-- Security posture, baked into the grants:
--   * anon (the browser) can SELECT read-only data and NOTHING else — no insert/update/delete.
--   * every write goes through a Server Action using the service-role key, server-side only.
--   * audit_events is append-only: UPDATE/DELETE are revoked from every role.
--   * cosign_requests is published to Realtime so the queue surfaces holds live.
--
-- Public-tier note: drift_events stores a CONSUMED divergence signal. No I(θ) computation,
-- aggregation, or threshold calibration lives here or anywhere in this repo.

-- ----------------------------------------------------------------------------
-- agents — the fleet
-- ----------------------------------------------------------------------------
create table if not exists agents (
  car_id        text primary key,
  name          text not null,
  role          text not null,
  model_backing text not null,
  hosting       text not null check (hosting in ('SELF_HOSTED_OPEN_WEIGHT', 'API_BACKED')),
  -- attestation is constrained by hosting: only self-hosted open-weight agents may be
  -- fingerprinted in weight space; API-backed agents must use canary-probe.
  attestation   text not null check (attestation in ('WEIGHT_SPACE_ITHETA', 'CANARY_PROBE')),
  tier          text not null check (tier in ('T1','T2','T3','T4','T5','T6')),
  status        text not null check (status in ('ACTIVE','PAUSED','QUARANTINED')),
  last_seen     timestamptz not null default now(),
  last_action   text,
  constraint attestation_matches_hosting check (
    (hosting = 'SELF_HOSTED_OPEN_WEIGHT' and attestation = 'WEIGHT_SPACE_ITHETA') or
    (hosting = 'API_BACKED' and attestation = 'CANARY_PROBE')
  )
);

-- ----------------------------------------------------------------------------
-- cosign_requests — held actions awaiting a human
-- ----------------------------------------------------------------------------
create table if not exists cosign_requests (
  id             uuid primary key default gen_random_uuid(),
  agent_car_id   text not null references agents(car_id),
  action_type    text not null,
  action_payload jsonb not null,
  trigger        text not null,
  context        text not null,
  status         text not null default 'PENDING'
                   check (status in ('PENDING','APPROVED','REJECTED','TIMEOUT')),
  created_at     timestamptz not null default now(),
  ttl_expires_at timestamptz not null,
  decided_at     timestamptz,
  decided_by     text
);
create index if not exists cosign_requests_pending_idx
  on cosign_requests (status, ttl_expires_at)
  where status = 'PENDING';

-- ----------------------------------------------------------------------------
-- audit_events — the Truth Chain: append-only, hash-linked
-- ----------------------------------------------------------------------------
create table if not exists audit_events (
  id           uuid primary key default gen_random_uuid(),
  ts           timestamptz not null default now(),
  agent_car_id text,
  event_type   text not null,
  actor        text not null,
  payload      jsonb not null,
  prev_hash    text,
  -- sha256(prev_hash || canonical({id, ts, agent_car_id, event_type, actor, payload}))
  -- The app computes this (governance/audit.ts); the column stores it for verification.
  hash         text not null
);

-- ----------------------------------------------------------------------------
-- drift_events — a consumed divergence signal (read-only to the UI)
-- ----------------------------------------------------------------------------
create table if not exists drift_events (
  id                  uuid primary key default gen_random_uuid(),
  agent_car_id        text not null references agents(car_id),
  ts                  timestamptz not null default now(),
  method              text not null check (method in ('WEIGHT_SPACE_ITHETA', 'CANARY_PROBE')),
  expected_signature  text not null,
  observed_signature  text not null,
  -- weight-space rotation in degrees; present only for WEIGHT_SPACE_ITHETA
  divergence_deg      numeric,
  -- canary-probe behavioral distance [0,1] + probe count; present only for CANARY_PROBE
  behavioral_distance numeric,
  probe_count         integer,
  action_taken        text not null default 'QUARANTINE',
  correlation_id      text not null,
  -- the method dictates which measure is present — a canary event can never carry degrees
  constraint drift_measure_matches_method check (
    (method = 'WEIGHT_SPACE_ITHETA' and divergence_deg is not null and behavioral_distance is null) or
    (method = 'CANARY_PROBE' and behavioral_distance is not null and divergence_deg is null)
  )
);

-- ============================================================================
-- RLS + grants
-- ============================================================================
alter table agents          enable row level security;
alter table cosign_requests enable row level security;
alter table audit_events    enable row level security;
alter table drift_events    enable row level security;

-- anon (browser) gets SELECT only, nothing else. The service role bypasses RLS, so all
-- writes happen server-side through Server Actions.
revoke all on agents, cosign_requests, audit_events, drift_events from anon, authenticated;
grant select on agents to anon, authenticated;
grant select on cosign_requests to anon, authenticated;  -- the queue may filter to PENDING in the policy below
grant select on drift_events to anon, authenticated;
-- NOTE: no select grant on audit_events to anon — the chain is read back server-side only.

-- Read-only policies. The browser sees the fleet, holds (PENDING for display), and drift.
create policy agents_select_all on agents
  for select to anon, authenticated using (true);

create policy cosign_select_pending on cosign_requests
  for select to anon, authenticated using (status = 'PENDING');

create policy drift_select_all on drift_events
  for select to anon, authenticated using (true);

-- Tamper-evidence at the table level: revoke UPDATE/DELETE on the audit log from every
-- role (the service role still bypasses RLS, hence "tamper-evident, not tamper-proof").
revoke update, delete on audit_events from anon, authenticated, service_role;

-- ============================================================================
-- Realtime — surface new PENDING holds to the cosign queue without polling
-- ============================================================================
alter publication supabase_realtime add table cosign_requests;
