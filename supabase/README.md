# Supabase — the live persistence path

The demo runs on the **simulator** (`GOVERNANCE_SOURCE=simulator`, the default) with zero
infrastructure. This directory is the **live path**: the schema, RLS, and grants the
CogniGate/ASTS adapter (`governance/sources/cognigate.ts`) persists to once G2/G3 land.

## What's here

- `migrations/0001_cosign_intervention_surface.sql` — the four tables (`agents`,
  `cosign_requests`, `audit_events`, `drift_events`), RLS policies, append-only grants on
  the audit log, and the Realtime publication on `cosign_requests` + `drift_events`.
- `seed.sql` — synthetic, public-clean demo data (the genealogy fleet, the Cason↔Causey
  hold, the ambiguous secondary hold, both drift signals). Idempotent, safe to re-run.

## Apply it

```bash
supabase db push                 # migrations, with the Supabase CLI linked to your project
psql "$DATABASE_URL" -f supabase/seed.sql    # then the demo seed (or paste in the SQL editor)
```

Use a **dedicated** project — don't drop these tables into an existing app's `public` schema.

## Wire the app to it

The adapter (`governance/sources/cognigate.ts`) is **implemented** against Supabase — reads,
Realtime, decisions, audit, and the fail-closed sweep all go through it. To run the live path
you only set env (server-side only, never `NEXT_PUBLIC_` for the service-role key):

- `GOVERNANCE_SOURCE=cognigate`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (writes are server-side; the key is in the
  Supabase dashboard under Project Settings → API)
- `OPERATOR_ID` (+ optional `OPERATOR_NAME`) — live mode refuses decisions without one
- `CRON_SECRET` — the TTL sweeper requires `Authorization: Bearer $CRON_SECRET` in live mode

If the Supabase env is absent the adapter stays inert (`{ ok: false,
reason: "cognigate-not-configured" }`) — it never fabricates an approval.

The remaining **private-plane** half (not in this repo): CogniGate parks holds into / consumes
decisions from these tables (G2), and the ASTS sink writes fleet + drift into them (G3). Both
sides meet only at the four tables.

## Security model (enforced by the grants)

- `anon` (the browser) has **SELECT only** — fleet, PENDING holds, drift. No insert/update/delete anywhere.
- All writes go through Server Actions using the **service-role key, server-side only** — never in the client bundle.
- `audit_events` has **UPDATE/DELETE revoked from every role**; it is append-only. This is
  tamper-**evident** (an edit breaks the hash chain) but not tamper-**proof** — a
  service-role holder could rewrite it. True WORM needs an external ledger.
- `drift_events` stores a **consumed** divergence signal only. No I(θ) computation,
  aggregation, or threshold calibration is in this repo — that is private-plane.
