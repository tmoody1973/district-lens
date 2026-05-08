# DistrictLens Tool Specifications

> **Note:** Some sections superseded by 2026-05-08 grilling decisions. Elastic-related tools are dropped — Atlas Vector Search handles semantic retrieval via `vector_search_issue_claims`. Source discovery uses Gemini grounding (not Perplexity) for MVP. Models: Gemini 3.1 Pro / Flash-Lite. See [DECISIONS_LOG.md](../docs/DECISIONS_LOG.md) §3.1, §3.3, §3.4.

## Tool architecture

Every external capability should be wrapped as a typed tool. The agent should call tools through stable interfaces rather than directly calling API clients from prompts or UI handlers.

## Tool contracts

### `resolve_race`

| Field | Description |
|---|---|
| Input | `query`, optional `cycle`, optional `state`, optional `district`. |
| Output | `race_key`, candidates, ambiguity flag. |
| Uses | MongoDB candidate and race collections. |

### `import_fec_candidates`

| Field | Description |
|---|---|
| Input | `cycle`, `office`, optional `state`, optional `district`, optional `incumbent_challenge`. |
| Output | Normalized candidate records persisted to MongoDB with `import_batch_id`, source metadata, and freshness envelope. |
| Source | FEC bulk/selective import using OpenFEC-compatible source data. |
| Guardrail | Default app reads must use MongoDB; live FEC calls should be refresh-only. |

### `fetch_fec_finance_summary`

| Field | Description |
|---|---|
| Input | `candidate_id`, `cycle`. |
| Output | Committee totals, receipts, disbursements, cash on hand, debt, outside-spending context where available. |
| Source | FEC bulk/selective import plus OpenFEC API refresh. |
| Guardrail | Do not infer issue positions from finance data; include import/check timestamps. |

### `import_congress_record`

| Field | Description |
|---|---|
| Input | `bioguide_id`, optional `congress`. |
| Output | Member profile, sponsored legislation, cosponsored legislation, bill subjects, bill summaries, committees, related bills, laws, bill text links, and votes where available. |
| Source | Congress.gov/GovInfo import plus API refresh. |
| Guardrail | Use only for incumbents or former members with mapped Bioguide IDs. |

### `refresh_fec_record`

| Field | Description |
|---|---|
| Input | `candidate_id`, optional `committee_id`, optional `race_key`, optional `cycle`, optional `force`. |
| Output | Updated MongoDB record IDs, `freshness_status`, `last_checked_at`, and changed-field summary. |
| Source | FEC OpenFEC API. |
| Guardrail | Use only when data is missing, stale, or user-requested; upsert into MongoDB before answering. |

### `refresh_congress_record`

| Field | Description |
|---|---|
| Input | `bioguide_id` or bill key fields such as `congress`, `bill_type`, and `bill_number`, optional `force`. |
| Output | Updated MongoDB record IDs, `freshness_status`, `last_checked_at`, and changed-field summary. |
| Source | Congress.gov API and GovInfo/GPO where applicable. |
| Guardrail | Use only for official legislative records; do not invent legislative context for non-incumbents. |

### `discover_candidate_sources`

| Field | Description |
|---|---|
| Input | `candidate_name`, `race_key`, optional `issue_area`, optional `source_type`. |
| Output | URLs, titles, snippets, provider metadata, confidence of source relevance. |
| Source | Perplexity or other search provider. |
| Guardrail | Search output is not evidence until the URL is fetched and stored. |

### `fetch_source_document`

| Field | Description |
|---|---|
| Input | `url`, `candidate_id`, `race_key`. |
| Output | Clean text, title, canonical URL, content hash, retrieved timestamp. |
| Guardrail | If content cannot be retrieved, store metadata and mark unavailable. |

### `extract_issue_claims`

| Field | Description |
|---|---|
| Input | `source_document_id`, `candidate_id`, `race_key`, issue taxonomy. |
| Output | Validated `IssueClaim[]`. |
| Method | LLM structured extraction plus schema validation. |
| Guardrail | Claim must include evidence quote or be marked `no_direct_statement`. |

### `answer_race_question`

| Field | Description |
|---|---|
| Input | User question, optional race/candidate context. |
| Output | Cited answer, claim IDs, source IDs, limitations. |
| Guardrail | Must pass civic guardrail check before display. |

## Provider abstraction for search

Use a provider interface so Perplexity can be swapped later.

```ts
export interface SourceDiscoveryProvider {
  search(input: SourceDiscoveryInput): Promise<SourceDiscoveryResult[]>;
}
```

Normalized result:

```ts
export interface SourceDiscoveryResult {
  url: string;
  title?: string;
  snippet?: string;
  domain?: string;
  publishedAt?: string;
  provider: 'perplexity' | 'tavily' | 'brave' | 'manual';
  relevanceReason?: string;
}
```


## Geocod.io district resolver tool

The Geocod.io tool resolves user-provided addresses or coordinates into congressional district context. It is a convenience and enrichment service, not the authority for candidate, finance, legislative-action, or issue-position claims.

| Contract item | Requirement |
|---|---|
| Tool name | `resolve_district_with_geocodio` |
| Required secret | `GEOCODIO_API_KEY` |
| Default fields | `cd120` for 2026 election workflows; `cd` or `cd119` for current incumbent context. |
| Inputs | `address` or `coordinates`, optional `fields`, optional `cycle`. |
| Outputs | Normalized address, coordinates, district list, OCD-ID, Congress number, proportion, legislator metadata when returned, and raw response cache key. |
| Guardrail | Never use ZIP-only output as a single definitive district when multiple districts are returned. |
| Cache rule | Cache by normalized address hash or coordinate hash, field set, cycle, and response timestamp. |

The tool should return a structured warning when the API key is missing, the field append fails, a ZIP-only lookup is ambiguous, or Geocod.io returns a congressional district that does not map to a stored `race_key`.


## CopilotKit frontend tools and generative UI

DistrictLens should expose a narrow set of client-side tools to the ADK/Gemini agent through CopilotKit. These tools control UI state only; they must not create unsupported civic claims or bypass citation rules.

| Tool | Purpose | Guardrail |
|---|---|---|
| `selectRace` | Change the active race after district lookup or search. | Race must exist in the stored race index or be clearly labeled as unresolved. |
| `openEvidenceDrawer` | Show source quote, source URL, retrieval date, and confidence for a claim. | Drawer must require a valid `source_id` or `claim_id`. |
| `focusCandidate` | Highlight one candidate card in the comparison view. | Highlighting must not imply endorsement. |
| `setIssueFilter` | Filter issue evidence cards by topic. | Filter labels must come from the approved issue taxonomy. |
| `requestFullAddress` | Ask the user for a more precise address when ZIP-only Geocod.io output is ambiguous. | Do not store raw address beyond the configured lookup cache policy. |

Agent-rendered UI should be limited to registered components such as `DistrictBriefCard`, `CandidateCompareCard`, `FinanceSnapshotChart`, `IssueEvidenceCard`, `ToolTraceTimeline`, and `DistrictAmbiguityPrompt`.

## State and local election tools

### `lookup_ballot_by_address`

**Purpose:** Resolve a full address into federal, state, local, and ballot-measure contests by combining Geocod.io geography with BallotReady/CivicEngine, Ballotpedia, official seed data, or labeled Google Civic fallback data.

| Field | Type | Notes |
|---|---|---|
| `address` | string | Full address strongly preferred. |
| `election_id` | string/null | Provider-specific election ID. |
| `cycle` | number | Election cycle. |
| `providers` | string[] | Default `['geocodio', 'ballotready_civicengine']`; use `ballotpedia`, `official_seed`, `democracy_works_calendar`, or `google_civic_fallback` when configured. |
| `allow_curated_fallback` | boolean | Enables official CSV/JSON demo seeds. |

**Output:** `district_context`, `election_events`, `contests`, `contest_candidates`, `ballot_items`, `polling_locations`, `source_freshness`, and `warnings`.

### `ingest_ballotready_or_civicengine_ballot`

**Purpose:** Cache a BallotReady/CivicEngine response for a demo address or district/election date, then normalize contests into DistrictLens `contest_key` records.

### `ingest_ballotpedia_point_ballot`

**Purpose:** Cache a Ballotpedia geographic API response for a lat/long/election date, then normalize races, candidates, ballot measures, offices, districts, and people into DistrictLens contest records.

### `ingest_google_civic_fallback_ballot`

**Purpose:** Cache a Google Civic `voterInfoQuery` response only as fallback data. Mark all derived contests with `source_confidence=fallback` and never overwrite fresher provider or official records.

### `ingest_local_official_seed`

**Purpose:** **Post-MVP only.** Import official state, county, municipal, school-board, or ballot-measure records from a curated CSV/JSON file when national APIs do not cover a selected jurisdiction.

### `enrich_state_legislator_openstates`

**Purpose:** Attach OpenStates incumbent identity, bills, votes, committees, and legislative context to a state senate or state house contest.

The agent must label these tools as state/local coverage tools and must not use them to infer support for elections that the source provider did not return.

## HeroUI Pro component contract

All CopilotKit generative UI components should be implemented as approved HeroUI Pro / HeroUI-based React components rather than free-form model-generated layouts. The MVP should include HeroUI-backed versions of `DistrictBriefCard`, `CandidateCompareCard`, `FinanceSnapshotChart`, `IssueEvidenceCard`, `ToolTraceTimeline`, `DistrictAmbiguityPrompt`, and `BallotContestGroup`. Components must accept typed props from retrieved DistrictLens data and must not create unsupported political claims, issue labels, or finance values.

The HeroUI Pro MCP can be used during development to confirm exact component APIs, Brutalism theme variables, CSS class conventions, and examples. This MCP is documentation tooling only; the runtime civic-memory MCP story remains MongoDB or Elastic.


## Optional Perplexity + TabStack Local Race Bridge Tools

DistrictLens should **not include these tools in the hackathon MVP**. Post-MVP, internal tools for long-tail local-race coverage may be added when primary ballot providers are unavailable or stale. `perplexity_official_local_race_search` should restrict queries to official election-office domains where possible and return ranked URLs with recency metadata. `tabstack_official_page_extract` should accept only reviewed or allowlisted URLs and a versioned JSON schema, then return structured contest, candidate, and ballot-item fields plus validation errors.

These tools are fallback and verification tools, not primary election providers. Their outputs must carry source URLs, retrieval timestamps, schema versions, confidence states, and review status before they appear in the user interface.


## User workspace tools

These tools are optional Clerk-backed helpers. They should be available only when the current user is signed in, except for feature-availability checks. They must never block public district lookup, race pages, evidence viewing, or basic agent answers.

### `get_current_user_profile`

| Field | Contract |
|---|---|
| Input | Current Clerk session claims. |
| Output | `clerk_user_id`, role, saved-feature availability, preferences, and privacy-safe profile metadata. |
| Guardrail | Do not expose email or private profile fields unless explicitly needed by the UI. |

### `save_district`

| Field | Contract |
|---|---|
| Input | `clerk_user_id`, `district_key`, optional `race_key`, optional `label`. |
| Output | Saved district record. |
| Guardrail | Store district/race identifiers only; do not store raw residential address. |

### `save_brief`

| Field | Contract |
|---|---|
| Input | `clerk_user_id`, `race_key`, `question`, `answer_snapshot`, `source_refs`, `freshness`. |
| Output | Saved brief record. |
| Guardrail | Save the citation graph and freshness labels with the answer snapshot. |

### `submit_correction`

| Field | Contract |
|---|---|
| Input | `clerk_user_id`, `target_type`, `target_id`, correction text, optional source URL. |
| Output | Review-queue record. |
| Guardrail | Treat submissions as unverified until reviewed; never overwrite official records directly from user input. |

### `authorize_admin_operation`

| Field | Contract |
|---|---|
| Input | Clerk session claims and/or `ADMIN_API_SECRET`. |
| Output | Authorization decision for import, refresh, extraction, indexing, and review tools. |
| Guardrail | Deny by default. Public users and normal signed-in users must not run admin tools. |


## `import_legislator_identity_enrichment`

**Purpose:** Import `unitedstates/congress-legislators` current-member identity enrichment into MongoDB for profile cards, official webpages, social media links, district offices, committee assignments, FEC crosswalks, and photo resolver metadata.

| Field | Type | Required | Notes |
|---|---|---:|---|
| `scope` | enum | Yes | `current_members`, `social`, `district_offices`, `committees`, `committee_membership`, or `all_current`. |
| `source_ref` | string | No | Git commit SHA, branch, or published data URL used for provenance. |
| `dry_run` | boolean | No | When true, validates transforms and returns counts without writing records. |

**Returns:** `import_batch_id`, `source_system`, `source_ref`, `record_counts`, `changed_records`, `skipped_records`, `unresolved_photo_ids`, `checksum_manifest`, `errors`, and `completed_at`.

**Guardrail:** This tool may enrich identity and contact context only. It must not overwrite FEC finance records or Congress.gov/GovInfo/GPO legislative facts.
