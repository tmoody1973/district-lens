# DistrictLens — Data Layer Map

**Date:** 2026-05-26
**Status:** Research + design (Phase-2 entry point). Feeds the next ingestion plan — this doc does **not** implement ingestion.
**Scope:** All three offices — U.S. House, U.S. Senate, Governor (Governor confirmed in-scope this session; `STATE_LOCAL_ELECTION_STRATEGY.md` post-MVP exclusion is superseded).

## What this is

For every fact the voter brief wants to show, this map names: the desired datum → the source that provides it → how we'd get it → cost → refresh cadence → **what we actually have today** → an honest gap verdict. It is the source→brief-section→coverage inventory the brief redesign deferred. The brief consumer is `web/src/lib/brief-layout.ts` (`HeaderFacts` scoreboard cells + `SectionPlan`); the product asks are `docs/voter-brief-mod.md`; the architecture is `docs/voter-brief-architecture.md`.

## Civic-safety spine (non-negotiable)

The agent **composes from verified data; it never generates facts.** Every datum below lands in Mongo with `source_url` / `source_type` / `fetched_at` / `as_of_date` / `confidence`. `as_of_date` is tracked separately from `fetched_at` (FEC Q3 filed Oct 15 reflects activity through Sept 30 → brief says "donor data as of Q3 2025"). **Nothing breaks if a datum is not ingested** — the brief renders the gap explicitly ("not yet available"), never silence, never inference from party/donors. So every verdict below is a *value-vs-cost* call, not a correctness requirement.

## Verdict legend

| Verdict | Meaning |
|---|---|
| ✅ **HAVE** | In Mongo now, ready to surface |
| 🟦 **COMPUTE** | Raw data already in Mongo — derive it, no ingest |
| 🟩 **INGEST-CHEAP** | Small/clean ingest, days, free source |
| 🟨 **INGEST-MOD** | Real ingest, distinct pipeline, ~1–2 weeks |
| 🟥 **INGEST-HEAVY** | Large volume and/or licensing cost, multi-week |
| 🟧 **SCRAPE** | No API — scrape (Firecrawl), validate extracted numbers |
| ⬛ **N/A** | Not realistically available as structured data — render as honest gap or editorial |

---

## Section 0 — Verified current state (live Mongo, 2026-05-26)

Counts pulled live from prod `districtlens`. **`schemas/mongodb_collections.json` is aspirational — the live DB is leaner. Trust this, not the schema JSON.**

| Collection | Count | What it actually holds | Federal-only? |
|---|---|---|---|
| `races` | 504 | H 461 / S 43; race_key, incumbent_bioguide_id, Ballotpedia crosswalk | Yes — **no governor** |
| `candidates` | 3,963 | H 3,422 / S 541; FEC identity, party, incumbent status, ~463 w/ bioguide | Yes — **no governor/state** |
| `committees` | 3,632 | FEC committees (campaign committees) | Yes |
| `finance_summaries` | 2,562 | FEC Form-3 toplines **+ contribution-type breakdown** (individual / PAC / party / candidate / loans), `coverage_end_date` | Yes |
| `legislative_actions` | 8,373 | **100% `sponsored_bill`** — bills authored. `vote_position` populated = **0**. No cosponsorship, no votes | Yes |
| `legislator_profiles` | 536 | Identity + crosswalks (bioguide, govtrack, opensecrets, votesmart, FEC) + social handles. **No committees, no district offices** | Yes |
| `ballotpedia_races` | 470 | H 435 / S 35; embedded candidate arrays, incumbent | Yes — **no governor** |
| `race_status` / `_events` / `results_citations` | 185 / 233 / 199 | Nominee resolution (winners/losers/confidence/citation) | Yes |
| `primary_calendar` / `election_dates` | 50 / 50 | 2026 primary + election dates | — |
| `evidence_cache` | 10 | Ephemeral Perplexity issue/news answers (TTL'd) — **not a durable evidence store** | — |
| `district_lookups` | 10 | Geocod.io address→district cache | — |

**Bottom line on "what we have":** solid federal candidate identity + FEC summaries + bill *sponsorship* + nominee resolution. Everything behavioral (votes, committees, cosponsorship), everything itemized (donors, IE), all district context (lean, demographics), and **all governor/state data** are gaps.

---

## Section 1 — U.S. House

| Brief cell / ask (`voter-brief-mod.md`) | Desired datum | Source (2026-verified) | Access | Cost | Cadence | Have today | Verdict |
|---|---|---|---|---|---|---|---|
| Header → competitiveness (`competitivenessAvailable:false`) | Partisan lean / pres-by-CD ("R+4, flipped D 2018") | **The Downballot** (was Daily Kos Elections) pres-by-CD | Google Sheet @ the-db.co/presbycd | Free (cite+link) | Per redraw | ⬛ none | 🟩 INGEST-CHEAP |
| Header → competitiveness | Forecaster rating (tossup/lean/safe) | **270toWin** (aggregates Cook+Sabato+Inside) / **Sabato** free | HTML scrape | Free | As forecasters move | ⬛ none | 🟧 SCRAPE |
| Record → attendance | Vote attendance % | **Congress.gov API** `house-vote` (per-member, live since Dec 2025) | REST, key | Free (5k/hr) | As votes post | ⬛ none (votes=0) | 🟩 INGEST-CHEAP → 🟦 COMPUTE |
| Record → party discipline | Party-line voting % | Same House-vote rows | REST | Free | As votes post | ⬛ none | 🟩 INGEST-CHEAP → 🟦 COMPUTE |
| Record → authored | Bills authored | Congress.gov (already ingested) | — | Free | Nightly | ✅ 8,373 sponsored | ✅ HAVE |
| Record → cosponsored | Bills cosponsored | Congress.gov API `bill/.../cosponsors` | REST | Free (5k/hr) | Continuous | ⬛ none | 🟩 INGEST-CHEAP |
| Record → committees | Committee + subcommittee assignments | `unitedstates/congress-legislators` `committee-membership-current.yaml` (maintained, last commit Apr 2026) | Raw GitHub YAML | Free | Snapshot | ⬛ none | 🟩 INGEST-CHEAP |
| Record → hearings | Hearing attendance / "showed up" | — | — | — | — | ⬛ none | ⬛ N/A (no structured source) |
| Record → constituent services | Casework volume, town halls held | — | — | — | — | ⬛ none | ⬛ N/A |
| Candidates → challenger archetype | Establishment / insurgent / self-funder / celebrity / perennial | Self-funder = FEC (below); rest = editorial/scrape | Mixed | — | — | partial | 🟦 COMPUTE (self-funder) + ⬛ N/A (rest) |
| Money → small-donor geography | In-district vs out-of-district small-donor ratio | **FEC Schedule A** itemized (bulk file) + **own ZIP→CD crosswalk** | Bulk pipe-delimited | Free data | Weekly | ⬛ none | 🟥 INGEST-HEAVY |
| Money → establishment signal | Leadership-PAC money | OpenFEC `/committees` `designation=D` → contributions | REST | Free | Per filing | ⬛ none | 🟨 INGEST-MOD |
| Money → issue PACs | Single-issue PAC concentration (crypto, AIPAC, LCV…) | FEC has **raw employer text only**; clean sector codes = OpenSecrets/CRP (**API dead 4/2025; bulk = educational-only**) | Bulk + own normalization, or license CRP | Free data / **licensing risk** | Periodic | ⬛ none | 🟥 INGEST-HEAVY (+ licensing) |
| Money → self-funding | Self-funding % | **finance_summaries** (`candidate_contributions`+`loans_from_candidate`)/`receipts` | — | Free | Per filing | ✅ raw present | 🟦 COMPUTE (ship now) |
| Header → stakes | "1 of 435 seats" → majority math | Seat counts + control | Compute | Free | — | ✅ structural | 🟦 COMPUTE |
| Candidates → committee projection | "What committee will they sit on" | — | — | — | — | ⬛ none | ⬛ N/A (editorial) |

---

## Section 2 — U.S. Senate (deltas from House)

Senate shares House's identity/sponsorship/finance posture. The differences:

| Brief ask | Desired datum | Source (2026-verified) | Access | Cost | Have | Verdict |
|---|---|---|---|---|---|---|
| Senate behavior, attendance, party-line | Per-member roll-call votes | **Senate.gov LIS XML** — session menu `…/roll_call_lists/vote_menu_119_2.xml`, per-vote `vote_119_2_NNNNN.xml` ([landing](https://www.senate.gov/legislative/votes_new.htm)). **No Congress.gov API for Senate votes.** | Per-vote XML parse | Free | ⬛ none | 🟨 INGEST-MOD (separate parser from House) |
| "TV vs vote" gap, judicial question | Cloture votes, judicial-confirmation votes | Same LIS XML — filter `<question>`="On the Cloture Motion…" and `<document>` nomination fields | XML parse | Free | ⬛ none | 🟨 INGEST-MOD → 🟦 COMPUTE |
| "What would they do with the gavel" | Likely committee chair if majority | Seniority + committee membership (post-ingest) — partial; rest editorial | Derive | Free | ⬛ none | ⬛ N/A / 🟦 COMPUTE-partial |
| Money signals | Out-of-state money by state + industry | FEC Schedule A geo + sector | Bulk + crosswalk | Free / licensing | ⬛ none | 🟥 INGEST-HEAVY |
| Money signals | Joint Fundraising Committee participation | OpenFEC `/committees` `designation=J` → transfers | REST | Free | ⬛ none | 🟨 INGEST-MOD |
| Money signals | Bundlers | Rarely disclosed (lobbyist-bundler reports only) | — | — | ⬛ none | ⬛ N/A |
| Coalition math | Historical over/under-performance by constituency | Results modeling — out of scope | — | — | ⬛ none | ⬛ N/A |

---

## Section 3 — Governor (greenfield — full matrix)

**Zero governor data in Mongo today.** No unified national API exists; this is a *layered scrape stack*, not an API integration.

| Brief ask | Desired datum | Source (2026-verified) | Access | Cost | Verdict |
|---|---|---|---|---|---|
| Candidates + results | Governor primary/general candidates & results | **Per-state SOS scrape** seeded by `~/Downloads/official_2026_primary_results_urls_updated_clean.json` → `official_results_sources` collection; **NBC** per-page overlay (no public API, AP-fed desk); Ballotpedia metadata | Scrape; NBC scrape; Ballotpedia paid | Free + Firecrawl ~$83/mo + Ballotpedia license | 🟧 SCRAPE |
| What this governor can do | Gubernatorial powers (line-item veto, appointments, Guard, emergency, impoundment) | **CSG "Book of the States"** (veto Tbl 4.4, appts 4.10) + **NGA** + Ballotpedia | Prose/PDF → hand-built table | Free | 🟩 INGEST-CHEAP (one-time prose ETL, low churn) |
| State-specific live stakes | WI: maps, WEC, Act 10, shared revenue, UW | Curated/editorial per state | Editorial | — | ⬛ N/A (curated) |
| Executive record | Executive orders, veto messages, appointment announcements | **WI:** docs.legis.wisconsin.gov (`/code/executive_orders`, `/related/veto_messages`) — unusually clean. Other states scatter | Scrape (HTML+PDF) | Free + Firecrawl for blocked | 🟧 SCRAPE |
| Veto record (incumbent) | What blocked / let through / negotiated | WI veto messages (above) | Scrape | Free | 🟧 SCRAPE |
| Appointment philosophy | Past appointment patterns | Appointment announcements | Scrape | Free | 🟧 SCRAPE |
| Legislature relationship | Trifecta vs divided; what passes vs vetoed | OpenStates (composition) + veto record | API + scrape | Free tier | 🟨 INGEST-MOD |
| Money | State campaign finance | **WI: CFIS / Sunshine** (cfis.wi.gov) CSV export (≤65k rows, 2008→now, **no API**); CA Cal-Access, NY BOE, TX as contrasts; **FollowTheMoney** API (free, but **state data frozen at 2024**) | CSV export / API | Free | 🟨 INGEST-MOD (per-state) |
| State legislators (context) | Roster, party, committees | **Open States API v3** (Plural Policy) | REST + bulk CSV | Free tier (low limits) | 🟩 INGEST-CHEAP |

**Governor key facts:** WI is the *hardest* results case (no statewide results system — 72 county clerks + myvote.wi.gov). Your JSON is a strong seed (~15 states with live 2026 result URLs; rest are portal-known-but-not-yet-live; all official SOS source-type) — re-verify job flips them live as 2026 pages publish. AZ/DC/OH/PA/RI flag Cloudflare/captcha → route through Firecrawl. WI campaign finance (CFIS CSV) is fresher than any aggregator and is a near-term win.

---

## Section 4 — Cross-cutting (all offices)

| Brief ask | Desired datum | Source (2026) | Cost | Have | Verdict |
|---|---|---|---|---|---|
| Primary vs general framing | Phase-aware brief | `race_status` phase (already wired) | — | ✅ | ✅ HAVE |
| "National money flooding in" flag | Outside spending > candidate spending | **FEC Schedule E** independent expenditures (OpenFEC `/schedules/schedule_e`, **small volume**) vs receipts | Free | ⬛ none | 🟨 INGEST-MOD → 🟦 COMPUTE **(high value, low cost)** |
| Stakes if seat flips | Majority math / chairs / veto pen | Compute from control + committee + powers | Free | partial | 🟦 COMPUTE |
| District demographics | Pop, income, race, education | **Census ACS 5-yr API** (`acs5`, 119th CDs) tables B01003/B19013/B02001/B15003 | Free (key) | ⬛ none | 🟩 INGEST-CHEAP |
| District boundaries | Current CD lines | **Census TIGER** `cd119` (public domain) > Redistricting Data Hub | Free | ⬛ none | 🟩 INGEST-CHEAP |
| Endorsements | Org/news endorsements | No API — scrape candidate/org/news sites | Free + Firecrawl | ⬛ none | 🟧 SCRAPE (accept partial) |
| Ad spend | Google/Meta political ad spend | Google Ads Transparency Center + Meta Ad Library API | Free (terms) | ⬛ none | 🟨 INGEST-MOD |
| Recent news | Per-candidate news | Perplexity (current path) / GDELT / local feeds | Free/paid | ✅ ephemeral | 🟦 partial (durable store TBD) |
| Polls | Race polling | Mostly paywalled (Silver/RCP/DDHQ); Polymarket free | Mixed | ⬛ none | 🟧 SCRAPE / ⬛ N/A (use judiciously) |
| Issue positions | Cited candidate stances | Perplexity → `evidence_cache` (ephemeral) | Paid | ✅ thin | 🟦 (durable evidence store is its own gap) |

---

## Section 5 — Recommended ingestion sequence

Ordered cheap-and-high-value first. Each wave is independently shippable; the brief degrades honestly between waves.

**Wave 0 — Compute-only (ship now, zero ingest):** self-funding %, PAC/individual/party split (from `finance_summaries`); primary-vs-general framing (have); seat-count stakes. *Surfaces real money + record signals from data already in Mongo.*

**Wave 1 — Cheap high-value federal (the 80/20):**
1. **The Downballot partisan lean** + 270toWin/Sabato ratings → flip `competitivenessAvailable` to true.
2. **Census ACS demographics** + TIGER boundaries.
3. **Committee assignments** (one YAML) + **cosponsorship** (Congress.gov).
4. **House roll-call votes** (Congress.gov API) → compute attendance % + party-line %.
5. **FEC Schedule E independent expenditures** → "outside money exceeds candidate" flag.

**Wave 2 — Moderate federal:** Senate votes (Senate.gov LIS XML) → Senate attendance/party-line/cloture/judicial; leadership-PAC (designation D); JFC (designation J).

**Wave 3 — Governor track (scrape-heavy):** seed `official_results_sources` from your JSON + re-verify job; NBC per-page results overlay; WI executive record + veto + powers ETL; WI CFIS campaign finance; OpenStates legislators; then expand states outward from WI.

**Wave 4 — Itemized donor layer (heavy + licensing — DECISION PENDING):** FEC Schedule A bulk ingest + ZIP→CD crosswalk + employer→industry normalization (or license CRP/OpenSecrets). Unlocks in/out-district small-donor ratio + industry/single-issue-PAC concentration. **This is the one fork awaiting your call:** is the full Donor-DNA itemized layer worth its cost (multi-GB ingest, self-built sector dictionary, OpenSecrets educational-use licensing risk), or is "contribution-type breakdown (Wave 0) + outside-money flag (Wave 1)" enough voter value? If scoped down: ingest Schedule A only for top-N donors of contested/near-election races.

---

## Section 6 — Source access reference (2026-verified)

| Source | Provides | Access | Cost / limit | Key gotcha |
|---|---|---|---|---|
| **Congress.gov API** | House votes (NEW Dec 2025), bills, cosponsors, committees | REST, api.data.gov key | Free, 5,000/hr | **House votes only** — no Senate vote endpoint |
| **Senate.gov LIS XML** | Senate roll-call per-member votes | Per-vote XML scrape | Free | No API; parse `<question>`/`<document>` for cloture/judicial |
| **unitedstates/congress-legislators** | Identity, crosswalks, **committee membership** | Raw GitHub YAML | Free | "Current only," snapshot not historical |
| **unitedstates/congress (scraper)** | Both-chamber votes unified (alt to above) | Self-run Python → public-domain JSON | Free | Best-effort maintained; 2×/day |
| **OpenFEC API** | Schedule A/E, committee designation D/J | REST, api.data.gov key | Free; 1,000/hr (request 7,200/hr) | Schedule A = keyset pagination; **no district field** |
| **FEC bulk data** | Itemized base load | Pipe-delimited zip | Free | `indiv` = multi-GB, tens of M rows; ≥$200 only |
| **OpenSecrets / CRP** | Industry/sector codes | Bulk (registered) | **API dead 4/2025; bulk educational-only** | For-profit/campaign use prohibited → licensing risk |
| **The Downballot** (ex–Daily Kos) | Partisan lean / pres-by-CD | Google Sheet (the-db.co/presbycd) | Free (cite+link) | 2024 lines — verify 2026 redraws |
| **270toWin / Sabato** | Competitiveness ratings | HTML | Free | Cook/Inside Elections/Silver are paywalled — use aggregator |
| **Census ACS 5-yr API** | District demographics | REST `acs5` | Free (key lifts ~500/day cap) | 119th CDs in 2020–2024 vintage |
| **Census TIGER** | CD boundaries | Shapefile download | Free, public domain | Prefer over RDH (RDH adds noncommercial license) |
| **Your SOS-results JSON** | Per-state governor results seed | Local file → Mongo | Free | ~15 live 2026; rest portal-known; 5 captcha-blocked |
| **NBC News** | Governor results overlay | Per-page scrape | Free | No public API (AP-fed internal desk) |
| **CSG Book of the States / NGA** | Gubernatorial powers | Prose/PDF | Free | One-time hand-built table |
| **WI CFIS (cfis.wi.gov)** | WI state campaign finance | CSV export | Free | No API; ≤65k rows/file; fresher than aggregators |
| **FollowTheMoney.org** | State finance (history) | API w/ account | Free | **State data frozen at 2024** — not 2026 |
| **Open States API v3** | State legislators | REST + bulk CSV | Free tier (low) | ~500/day default; paid tiers for volume |
| **Firecrawl** | JS/PDF/Cloudflare scrape engine | Hosted API | Free 1k/mo; Standard ~$83/100k | JSON-extract = ~9 credits/page, not 1 |

---

## Appendix A — `official_results_sources` collection (proposed)

Seeded from `~/Downloads/official_2026_primary_results_urls_updated_clean.json`:

```
{ jurisdiction, postal_code, election_office_name, primary_results_url,
  verification_url, source_type, status, confidence, scraper_notes,
  last_verified_at, blocked /* set from captcha notes → route via Firecrawl */ }
```

Drive a re-verify job off `status != "live_2026_specific"` to flip portals live as 2026 result pages publish.

## Appendix B — Corrections to prior docs

- **`schemas/mongodb_collections.json` is aspirational**, not the live DB. ~14 collections it lists don't exist in prod. Verify live counts (`MONGODB_URI` in `web/.env.local`, db `districtlens`).
- **Committee assignments are a real gap** — the handoff was right; the schema's `congress_committees`/`legislator_committee_memberships` collections were never populated. (Source — `committee-membership-current.yaml` — is trivial to ingest.)
- **ProPublica Congress API stays dead** (don't recommend). **GovTrack's own API died in 2017** — use the `unitedstates/congress` scraper, not "the GovTrack API."
- **Congress.gov now serves per-member House votes** (live Dec 2025) — supersedes pre-2025 assumption that it had no member-level vote data.
