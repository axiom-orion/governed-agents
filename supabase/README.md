# Supabase — the live persistence path

The demo runs on the **simulator** (`GOVERNANCE_SOURCE=simulator`, the default) with zero
infrastructure. This directory is the **live path**: the schema, RLS, and grants the
CogniGate/ASTS adapter (`governance/sources/cognigate.ts`) persists to once G2/G3 land.

## What's here

- `migrations/0001_cosign_intervention_surface.sql` — the four tables (`agents`,
  `cosign_requests`, `audit_events`, `drift_events`), RLS policies, append-only grants on
  the audit log, and the Realtime publication on `cosign_requests`.

## Apply it

```bash
supabase db push                 # with the Supabase CLI linked to your project
# or paste the migration into the Supabase SQL editor
```

## Wire the app to it

1. Set, server-side only (never `NEXT_PUBLIC_`):
   - `GOVERNANCE_SOURCE=cognigate`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (writes are server-side)
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (read-only Realtime in the client)
   - `OPERATOR_ID` (+ optional `OPERATOR_NAME`) — live mode refuses decisions without one
   - `CRON_SECRET` — the TTL sweeper requires `Authorization: Bearer $CRON_SECRET` in live mode
2. Implement the marked sections in `governance/sources/cognigate.ts` against the Supabase
   client and the CogniGate REQUIRE_COSIGN consumer / ASTS sink. Until then the adapter is
   inert by design (`submitDecision` returns `{ ok: false, reason: "cognigate-not-wired" }`).

## Security model (enforced by the grants)

- `anon` (the browser) has **SELECT only** — fleet, PENDING holds, drift. No insert/update/delete anywhere.
- All writes go through Server Actions using the **service-role key, server-side only** — never in the client bundle.
- `audit_events` has **UPDATE/DELETE revoked from every role**; it is append-only. This is
  tamper-**evident** (an edit breaks the hash chain) but not tamper-**proof** — a
  service-role holder could rewrite it. True WORM needs an external ledger.
- `drift_events` stores a **consumed** divergence signal only. No I(θ) computation,
  aggregation, or threshold calibration is in this repo — that is private-plane.
