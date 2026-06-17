-- supabase/seed.sql
-- Synthetic, public-clean demo data for the live (cognigate) path: the same genealogy fleet,
-- the Cason↔Causey hold, the ambiguous secondary hold, and both drift signals the simulator
-- shows. Idempotent (safe to re-run). Apply after 0001_*.sql. The audit chain starts empty —
-- decisions write to it. No real agents, no I(θ) internals; every value here is illustrative.

-- --- the fleet: 1 self-hosted open-weight (Scribe) + 9 API-backed ---
insert into agents (car_id, name, role, model_backing, hosting, attestation, tier, status, last_action) values
  ('CAR-7F3A-SCRIBE','Scribe','Record transcription & OCR normalization','llama-3.1-70b · self-hosted','SELF_HOSTED_OPEN_WEIGHT','WEIGHT_SPACE_ITHETA','T2','QUARANTINED','Quarantined — I(θ) divergence 14.7° (weight-space model-swap signature)'),
  ('CAR-2B11-MATCHER','Matcher','Candidate record matching','claude-sonnet-4-6 · API','API_BACKED','CANARY_PROBE','T3','ACTIVE','Proposed RECORD_MERGE(Cason, Causey) — held for cosign'),
  ('CAR-9C04-KEEPER','Keeper','Record-write gate','claude-sonnet-4-6 · API','API_BACKED','CANARY_PROBE','T5','ACTIVE','Wrote 1880 census citation to Pike Co. household #112'),
  ('CAR-4D77-LINEAGE','Lineage','Lineage inference','claude-opus-4-8 · API','API_BACKED','CANARY_PROBE','T4','ACTIVE','Resolved a 3-generation gap on the Tisdale branch'),
  ('CAR-1A29-SOURCER','Sourcer','Source retrieval & citation','claude-haiku-4-5 · API','API_BACKED','CANARY_PROBE','T3','QUARANTINED','Quarantined — canary-probe behavioral drift d=0.63 (provider model-swap signature)'),
  ('CAR-6E52-INDEXER','Indexer','Census & parish indexing','claude-haiku-4-5 · API','API_BACKED','CANARY_PROBE','T2','ACTIVE','Indexed 1850 slave schedule, Upson Co., GA'),
  ('CAR-3F8B-GEOCODER','Geocoder','Place & jurisdiction resolution','claude-haiku-4-5 · API','API_BACKED','CANARY_PROBE','T2','PAUSED','Paused — geocoding provider rate-limit backoff'),
  ('CAR-8B40-DEDUP','Dedup','Duplicate detection','claude-sonnet-4-6 · API','API_BACKED','CANARY_PROBE','T3','ACTIVE','Flagged 2 ambiguous Margaret records for cosign'),
  ('CAR-5C63-ARCHIVIST','Archivist','Document archival & provenance','claude-sonnet-4-6 · API','API_BACKED','CANARY_PROBE','T3','ACTIVE','Sealed provenance chain for 14 deed images'),
  ('CAR-0A17-HERALD','Herald','Family-facing summaries','claude-haiku-4-5 · API','API_BACKED','CANARY_PROBE','T1','ACTIVE','Drafted the Cason descendant summary (held pending merge)')
on conflict (car_id) do nothing;

-- --- the Cason↔Causey hold (the centerpiece) ---
insert into cosign_requests (id, agent_car_id, action_type, action_payload, trigger, context, status, ttl_expires_at) values (
  '11111111-1111-4111-8111-111111111111',
  'CAR-2B11-MATCHER',
  'RECORD_MERGE',
  $json${
    "left": {
      "recordId": "rec:cason-elias-1816",
      "name": "Elias Cason",
      "born": "abt 1816 · Edgefield District, South Carolina",
      "died": "1879 · Pike County, Georgia",
      "timeline": [
        {"year":"1816","place":"Edgefield District, SC","event":"Born; family in St. Paul's Parish"},
        {"year":"1838–1849","place":"Edgefield District, SC","event":"Appears on SC state tax rolls every year (continuous)"},
        {"year":"1841","place":"Edgefield District, SC","event":"Marries Sarah Holloway"},
        {"year":"1852","place":"Pike County, GA","event":"Migrates SC → GA; buys 80 acres on Flint River"},
        {"year":"1879","place":"Pike County, GA","event":"Dies; buried at Concord Primitive Baptist"}
      ]
    },
    "right": {
      "recordId": "rec:causey-elias-1818",
      "name": "Elias Causey",
      "born": "abt 1818 · Anne Arundel County, Maryland",
      "died": "1884 · Upson County, Georgia",
      "timeline": [
        {"year":"1818","place":"Anne Arundel County, MD","event":"Born; Causey family of West River"},
        {"year":"1834","place":"Anne Arundel County, MD","event":"Named in a Maryland chancery record (father's estate)"},
        {"year":"1837","place":"Wake County, NC","event":"Maryland detour: sells inherited MD land, settles in NC"},
        {"year":"1843","place":"Wake County, NC","event":"Marries Eliza Pratt"},
        {"year":"1856","place":"Upson County, GA","event":"Migrates NC → GA; adjacent county to Pike"},
        {"year":"1884","place":"Upson County, GA","event":"Dies; buried at Thomaston"}
      ]
    },
    "distinguishingEvidence": {
      "headline": "Maryland-detour fingerprint — the two lines are in different states at the same time",
      "detail": "The merge rests on a shared given name (Elias), birth years two apart, and co-location in adjacent Georgia counties by the mid-1850s. But the Causey line carries a Maryland origin and a documented 1834 Anne Arundel chancery record plus an 1837 Wake County, NC deed, while the Cason line sits on continuous Edgefield, SC tax rolls 1838–1849. Two men cannot be in Maryland/North Carolina and South Carolina simultaneously: these are distinct lineages whose paths only converge, coincidentally, in Georgia.",
      "divergencePoints": [
        "Birthplace: Edgefield District, SC (Cason) vs Anne Arundel County, MD (Causey)",
        "1834–1837: Causey documented in MD then NC; Cason on continuous SC tax rolls — same years, different states",
        "Spouses differ: Sarah Holloway (Cason) vs Eliza Pratt (Causey)",
        "Surnames are phonetic neighbors, not the same family — no shared record links them before Georgia"
      ]
    },
    "proposedConfidence": 0.71
  }$json$::jsonb,
  'BASIS T3 · distinct-lineage evidence above the merge-confidence band → REQUIRE_COSIGN',
  'Matcher proposes merging two "Elias" records co-located in adjacent Georgia counties by the 1850s. Distinct-lineage evidence (the Maryland-origin fingerprint) contradicts identity: the lines are documented in different states in the same years. A merge is hard to reverse.',
  'PENDING',
  now() + interval '24 hours'
) on conflict (id) do nothing;

-- --- the ambiguous secondary hold (fail-closed demonstrator) ---
insert into cosign_requests (id, agent_car_id, action_type, action_payload, trigger, context, status, ttl_expires_at) values (
  '22222222-2222-4222-8222-222222222222',
  'CAR-8B40-DEDUP',
  'RECORD_MERGE',
  $json${
    "left": {
      "recordId": "rec:margaret-cason-1849",
      "name": "Margaret Cason",
      "born": "abt 1849 · Pike County, Georgia",
      "died": null,
      "timeline": [
        {"year":"1849","place":"Pike County, GA","event":"Born (1850 census, household #112, age 1)"},
        {"year":"1870","place":"Pike County, GA","event":"Listed as 'Margaret Cason', age 21, keeping house"}
      ]
    },
    "right": {
      "recordId": "rec:margaret-cawson-1850",
      "name": "Margaret Cawson",
      "born": "abt 1850 · Upson County, Georgia",
      "died": null,
      "timeline": [
        {"year":"1850","place":"Upson County, GA","event":"Born (parish baptism, spelled 'Cawson')"},
        {"year":"1871","place":"Upson County, GA","event":"Marries; surname recorded 'Cawson'"}
      ]
    },
    "distinguishingEvidence": {
      "headline": "Ambiguous — evidence is thin both ways; fail closed (don't merge) on no human ack",
      "detail": "Same era, adjacent counties, a one-letter spelling difference, and no record that links or separates them. There is not enough to merge and not enough to rule it out. With no operator decision inside the window, the safe default is to NOT merge — fail closed.",
      "divergencePoints": [
        "Birth county differs by one (Pike vs Upson) — within normal record drift",
        "Spelling Cason vs Cawson — could be the same clerk's variance or two families",
        "No linking record, no separating record — genuinely undecidable from what's attached"
      ]
    },
    "proposedConfidence": 0.58
  }$json$::jsonb,
  'BASIS T3 · ambiguous near-duplicate, evidence below resolution band → REQUIRE_COSIGN',
  'Dedup flags two "Margaret" records that may or may not be the same person. The evidence is thin both ways; this hold shows the fail-closed posture — no decision inside the window auto-rejects (does not merge).',
  'PENDING',
  now() + interval '24 hours'
) on conflict (id) do nothing;

-- --- both drift signals (the two attestation paths) ---
insert into drift_events (id, agent_car_id, method, expected_signature, observed_signature, divergence_deg, behavioral_distance, probe_count, correlation_id) values
  ('33333333-3333-4333-8333-333333333331','CAR-7F3A-SCRIBE','WEIGHT_SPACE_ITHETA','θ̄-band ⟨0x7f3a…c1⟩ ±2.1°','⟨0x91b8…4e⟩ — outside band',14.7,null,null,'swap-seed-scribe'),
  ('33333333-3333-4333-8333-333333333332','CAR-1A29-SOURCER','CANARY_PROBE','probe-baseline ⟨0x4c…a2⟩ d≤0.15','⟨0xd9…07⟩ d=0.63',null,0.63,96,'swap-seed-sourcer')
on conflict (id) do nothing;
