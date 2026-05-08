# DistrictLens Decisions Log

**Status:** Canonical — supersedes prior planning docs where they conflict
**Source session:** 2026-05-08 grilling session (23 questions, 27 locked decisions)
**Maintainer:** Tarik Moody

This file is the single source of truth for DistrictLens architectural decisions made during the 2026-05-08 grilling session. Where any other doc in this repo conflicts with the entries below, this file wins. Other docs are being updated to match. Banners are added to docs that contain superseded content.

---

## How to read this log

| Column | Meaning |
|---|---|
| Decision | The locked choice |
| Rationale | Why this choice over alternatives |
| Supersedes | Prior doc statements that no longer apply |

---

## 1. Frontend & UI

### 1.1 UI kit: OSS HeroUI + custom Civic Brutal Tailwind theme
- **Decision:** Use `@heroui/react` (MIT, OSS) with a hand-rolled Civic Brutal Tailwind theme. Drop HeroUI Pro from MVP runtime entirely.
- **Rationale:** The hackathon mandates a public Apache 2.0 repo; HeroUI Pro forbids redistributing source. OSS HeroUI is license-clean, free, and sufficient for the Civic Brutal aesthetic.
- **Supersedes:** `HEROUI_PRO_DECISION.md`, `HEROUI_PRO_ADOPTION_SCOPE.md`, `HEROUI_PRO_RESEARCH_NOTES.md`, and HeroUI Pro mentions in `HACKATHON_TECHNICAL_ARCHITECTURE.md`, `UI_RECOMMENDATION.md`, `MVP_SCOPE_DECISION.md`, `STATE_LOCAL_ELECTION_STRATEGY.md`, `COPILOTKIT_UI_DECISION.md`, `specs/MCP_INTEGRATION.md`, `specs/TOOLS.md`, `tasks/BUILD_PLAN.md`.

### 1.2 Agent UI layer: CopilotKit with registered typed components only
- **Decision:** CopilotKit owns the right-side agent panel and typed generative UI. Only registered components may be agent-rendered.
- **Rationale:** Civic safety — agent cannot generate arbitrary persuasion UI.

### 1.3 Voter brief: inline + markdown export
- **Decision:** Ship a voter brief feature for MVP. Inline `BriefCard` component + downloadable markdown export. Mandatory `## Limitations` section. Non-removable disclaimer.
- **Rationale:** Tangible deliverable artifact strengthens the demo's closing beat.

### 1.4 Source contradiction handling: bifurcated UI
- **Decision:** When sources disagree on a candidate's position, render a "Conflicting evidence" UI state with both claims side-by-side. Agent prose acknowledges conflict and refuses to pick. Tier 1 eval enforces this.
- **Rationale:** Most civic-AI products silently resolve conflicts. Visibly preserving them is the strongest evidence-first differentiator.

### 1.5 ZIP-only ambiguity: show all candidate districts with proportions
- **Decision:** When a ZIP code touches multiple districts, display all with proportions; CopilotKit `requestFullAddress` frontend tool prompts for full address. Don't silently pick. Don't hard-block.
- **Rationale:** Honors evidence-first principle and public-first auth.

### 1.6 Photo strategy: tiered, no binary assets in repo
- **Decision:** GPO Pictorial Directory URLs for incumbents (public domain), manually curated CC-licensed photos for ~8 demo challengers (URLs only with attribution metadata in `data/photo_attributions.json`), deterministic SVG initial-avatar placeholders for everyone else.
- **Rationale:** Apache 2.0 license doesn't cover image copyrights. URL-only references keep the repo license-clean.

---

## 2. Stack & Deployment

### 2.1 Topology: monorepo with two Cloud Run services
- **Decision:** `agent/` (Python ADK from `agents-cli scaffold`) + `web/` (Next.js 15, TypeScript, HeroUI OSS, CopilotKit). Both deploy to Cloud Run as separate services.
- **Rationale:** Matches CLAUDE.md mandate for Agents CLI as primary scaffold; matches CopilotKit's documented ADK + Next.js pattern.

### 2.2 Auth + streaming wiring: Next.js proxies CopilotKit → ADK
- **Decision:** Next.js API routes own Clerk verification (saved-features only) and Upstash rate-limiting (public agent path). ADK service has `--ingress=internal-and-cloud-load-balancing`. Internal auth via shared bearer token (`INTERNAL_API_TOKEN`).
- **Rationale:** Clerk JS is mature; ADK runs cleanly behind internal ingress; matches CopilotKit's documented Next.js setup.

### 2.3 MongoDB MCP runtime: stdio child of Python ADK
- **Decision:** Python ADK process spawns `mongodb-mcp-server` as a stdio subprocess on startup. Single Cloud Run service. Multi-stage Dockerfile (Python + Node).
- **Rationale:** Standard MCP pattern; ADK MCPToolset registers tools natively; tool calls auto-appear in trace.

### 2.4 Embeddings: Gemini, manually generated
- **Decision:** Generate embeddings with the current Google embedding model (e.g., `gemini-embedding-001` — confirm exact name at scaffold time) in the extraction pipeline. Store on `claim_embedding` field. Atlas Vector Search uses precomputed embeddings via `$vectorSearch`.
- **Rationale:** All-Gemini stack story for hackathon judging; one less vendor than Voyage AI auto-embedding.

### 2.5 CI/CD: GitHub Actions, WIF-keyless deploys to Cloud Run
- **Decision:** PR gates: Tier 1 evals + lint + types + tests + Docker build. Main branch: build → push to Artifact Registry → deploy both Cloud Run services. Workload Identity Federation (no service-account JSON keys). `prepare-demo` and `teardown-demo` workflow_dispatch jobs for min-instances control.
- **Rationale:** Repo-internal config is judge-readable; Tier 1 eval gating is a single job; WIF avoids key surface.

### 2.6 Cost strategy: hybrid build vs demo week
- **Decision:** Build phase: Atlas M0 + Cloud Run min-instances=0. Demo week: Atlas M10 + min-instances=1 on both services (~$40–50 one-time). Drop back after.
- **Rationale:** Buys reliable demo without sustained spend.

### 2.7 GCP region: us-central1 (Iowa)
- **Decision (2026-05-08):** All Cloud Run services, the Atlas M0/M10 cluster, and Vertex AI calls deploy to `us-central1`. Terraform `region` variable defaults to `us-central1`.
- **Rationale:** Vertex AI and Gemini features land in `us-central1` first and reach feature parity faster than other regions; it sits at the geographic center of US users and is Google's de facto default. `us-east1` was considered for marginal cost savings but trades AI feature parity for it, which is the wrong trade for a Gemini-throughout submission.
- **Affects:** `agent/deployment/terraform/cicd/` variables, GitHub repo vars, README quickstart, BUILD_PLAN Phase A1.

### 2.8 GCP project: civicsync-440613 (display name districtlens-prod)
- **Decision (2026-05-08):** Reuse the existing GCP project `civicsync-440613` rather than creating a new one. Set the display name to `districtlens-prod` so the console reads as the current product. The immutable project ID stays `civicsync-440613` and is what every gcloud, Terraform, and CI command references.
- **Rationale:** Billing, organization placement, and any prior IAM grants on `civicsync-440613` are reusable, which avoids a billing-account re-link and a fresh org-policy review. Creating a new project would have meant re-doing those steps for no functional gain. GCP project IDs cannot be renamed; only the display name is mutable, so we get a clean console label without losing the existing project's history.
- **Affects:** `gcloud config set project` value, Terraform `project_id` variable, GitHub repo var `GCP_PROJECT_ID`, README quickstart, BUILD_PLAN Phase A1, all `--project=` flags in build/deploy scripts.

### 2.9 Gemini auth: Vertex AI via ADC, location=global
- **Decision (2026-05-08):** Authenticate to Gemini through Vertex AI using Application Default Credentials, not the AI Studio API key path. Set `GOOGLE_GENAI_USE_VERTEXAI=True`, `GOOGLE_CLOUD_PROJECT=civicsync-440613`, `GOOGLE_CLOUD_LOCATION=global` in `agent/app/.env`. In Cloud Run production, the runtime service account auto-authenticates via the metadata server — no secrets to manage.
- **Rationale:** ADC piggybacks on the gcloud auth we already did for Phase A1, removes the need to create, store, rotate, and Secret-Manager-mount a `GEMINI_API_KEY`, and gives Cloud Run zero-config auth in production. AI Studio API key was considered for its free tier but loses the auto-auth benefit and adds a real secret to manage.
- **Why `location=global` and not `us-central1`:** Gemini 3.x preview models on Vertex AI (`gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`) are exposed only on the global endpoint `aiplatform.googleapis.com`. Regional endpoints like `us-central1-aiplatform.googleapis.com` return 404 for these IDs. The `us-central1` region lock from §2.7 still applies to where the Cloud Run services and Atlas cluster live; only the Vertex API call routing is global. Verified end-to-end with a live `gemini-3.1-pro-preview` call returning "PONG" through `google-genai` from the agent venv on 2026-05-08.
- **Affects:** `agent/app/.env` (three vars instead of `GOOGLE_API_KEY`), `agent/app/agent.py` (no code change required; ADK reads env), Cloud Run runtime service account needs `roles/aiplatform.user` on the project (Phase A5 Terraform), GitHub Actions does not need a Gemini secret.

---

## 3. Data & Models

### 3.1 Partner track: MongoDB primary; drop Elastic from MVP
- **Decision:** MongoDB Atlas Search + Atlas Vector Search handle all retrieval. MongoDB MCP is the visible partner integration. Devpost track: MongoDB.
- **Rationale:** Hackathon requires one partner MCP, not two. Two infrastructures = two demo failure modes. Atlas Search + Vector Search covers the corpus.
- **Supersedes:** Elastic alternate-track sections in `HACKATHON_TECHNICAL_ARCHITECTURE.md`, `HACKATHON_REQUIREMENTS.md`, `HACKATHON_REQUIREMENTS_AUDIT.md`, `ARCHITECTURE.md`, `DATA_STRATEGY.md`, `PRD.md`, `AGENTS_CLI_IMPLEMENTATION.md`, `UI_WIREFRAME_SPEC.md`, `specs/API_SPEC.md`, `specs/MCP_INTEGRATION.md`, `specs/TOOLS.md`, `tasks/BUILD_PLAN.md`, `tasks/DEVPOST_SUBMISSION_CHECKLIST.md`.

### 3.2 Ingestion strategy: bulk-everything-cheap, selective-on-deep
- **Decision:** Bulk-import all 2026 House+Senate FEC candidates, committees, and finance summaries from FEC bulk download files (free, no API key). Bulk all 535 current Congress members from `unitedstates/congress-legislators` JSON. Bulk all 535 Congress.gov sponsorship/cosponsorship/votes (overnight ~6–7hr at 5k req/hr). Selective: detailed FEC filings, issue evidence per demo race.
- **Rationale:** FEC bulk files have no rate limit. National backbone is free; demo enrichment is per-race.
- **Supersedes:** PRD.md line 50's standalone "all-candidate ingestion" claim (now means *identities + finance summaries*, not all data classes).

### 3.3 Models: Gemini 3.1 family throughout
- **Decision:** Gemini 3.1 Pro for agent reasoning + answer composition. Gemini 3.1 Flash-Lite for issue claim extraction. Drop OpenAI entirely.
- **Rationale:** Hackathon judges Gemini usage; ADK is Gemini-native; Flash-Lite is 10x cheaper than alternatives.
- **Current API identifiers (May 2026):** `gemini-3.1-pro-preview` and `gemini-3.1-flash-lite`. Gemini 3.1 Pro is in **Preview** as of May 2026. When it reaches GA, drop the `-preview` suffix in `agent/app/agent.py` and any deployment configs. Track via [ai.google.dev/gemini-api/docs/changelog](https://ai.google.dev/gemini-api/docs/changelog).
- **Supersedes:** `OPENAI_API_KEY` in `ARCHITECTURE.md`. Generic "Gemini" references in `AGENTS_CLI_IMPLEMENTATION.md` and `HACKATHON_TECHNICAL_ARCHITECTURE.md` should be made specific.

### 3.4 Source discovery: Gemini built-in Google Search grounding
- **Decision:** Use Gemini's native grounding for source discovery during MVP. Wrap behind a `SourceDiscoveryProvider` interface. Perplexity moves to post-MVP for local-race extraction only.
- **Rationale:** In-stack, free with Gemini call, no extra vendor key. Perplexity's value is more useful for post-MVP local races where its `search_domain_filter` matters.
- **Supersedes:** `PERPLEXITY_API_KEY` in primary env list of `ARCHITECTURE.md`. Perplexity-as-default mentions in `DATA_STRATEGY.md`, `HACKATHON_TECHNICAL_ARCHITECTURE.md`, `AGENTS_CLI_IMPLEMENTATION.md`, `MVP_SCOPE_DECISION.md`, `STATE_LOCAL_ELECTION_STRATEGY.md`, `specs/API_SPEC.md`, `specs/TOOLS.md`, `tasks/BUILD_PLAN.md`. The `PERPLEXITY_TABSTACK_*.md` doc set remains valid as post-MVP reference.

### 3.5 Geocod.io: compound `cd120,cd` request with `cd` fallback
- **Decision:** Single request returns both 2026-election (cd120) and current 119th-Congress (cd) boundaries. Use cd120 if populated; fall back to cd. UI always shows which boundary set was used. Weekly self-heal as states publish new maps.
- **Rationale:** Some states' cd120 boundaries are still in litigation/unpublished as of May 2026. Compound request avoids a second roundtrip.

---

## 4. Civic Safety

### 4.1 Refusal mechanism: layered (system prompt + input regex + output classifier + evals)
- **Decision:** System prompt rules + pre-LLM input regex middleware + post-LLM output classifier (Flash-Lite) + Tier 1 eval gating in CI.
- **Rationale:** Single-layer defense (prompt-only) is jailbroken in <10 prompts. Civic AI failures become news. Defense in depth at ~200ms latency cost is correct.
- **Doc:** `docs/REFUSAL_DESIGN.md` (to be written).

### 4.2 Eval suite: 3 tiers (~23 cases), Tier 1 CI-blocking
- **Decision:** Tier 1 (10 blocking cases) gates every PR via `agents-cli eval run --tier=blocking`. Tier 2 (8 advisory cases). Tier 3 (5+ stretch cases). I (Claude) draft Tier 1 + Tier 2; Tarik reviews civic-language framing.
- **File layout (matches scaffold convention, not original plan):** Eval cases live at `agent/tests/eval/evalsets/tier1_civic_safety.evalset.json` and `tier2_advisory.evalset.json`. The scaffold's ADK eval format is one JSON evalset file with multiple `eval_cases` inside, not one YAML per case. Rubrics live in `agent/tests/eval/eval_config.json` with three criteria: `civic_safety_v1` (8 sub-rubrics, 0.95 threshold), `tool_use_quality_v1` (4 sub-rubrics), `rubric_based_final_response_quality_v1`.
- **Rationale:** Refusal behavior is the hackathon's credibility bedrock. CI-blocking is the only way to prevent regression.

### 4.3 Address privacy: six-rule policy R1–R6
- **Decision:** R1 normalize-then-hash addresses (USPS-style, salted SHA-256). R2 salt in Secret Manager. R3 store `lookup_hash` + truncated lat/lng (~1km precision); never raw address. R4 saved-district records store `race_key` not address. R5 logs strip address fields. R6 cache TTLs (30 days fresh / 7 days cd120-empty).
- **Rationale:** A civic AI tool that leaks home addresses through logs becomes a surveillance vector overnight.
- **Doc:** `docs/PRIVACY_POLICY.md` (to be written, public-facing).

### 4.4 Maintainer disclosure
- **Decision:** Ship `docs/MAINTAINER_DISCLOSURE.md`. Explicit Radio Milwaukee COI statement. Explanation of WI-3 inclusion as maintainer's local district. Methodology pointers (prompts, refusals, evals committed to repo). README links it.
- **Rationale:** Honest disclosure prevents future accusation; models the evidence-first transparency the agent demands of candidates.

### 4.5 License: Apache 2.0
- **Decision:** Apache 2.0 + `LICENSE` + `NOTICE` files at repo root.
- **Rationale:** Permissive + explicit patent grant. Civic-tech norm (18F, Code for America, OpenStates).

---

## 5. Demo

### 5.1 Demo race slots: 4 (Senate + swing-incumbent House + open-seat House + WI-3)
- **Decision:** Lock the slots now. Specific candidate names finalized post-FEC bulk import once 2026 filing activity is visible.
- **Rationale:** Mix of office and classification. Wisconsin race adds local relevance and maintainer-disclosure verifiability.

### 5.2 Demo flow: hybrid with 3 live moments
- **Decision:** Pre-imported data + live agent answer composition + live FEC refresh + live refusal demo. Min-instances=1 during recording window. 3–5 retakes allowed; cuts between clean takes are fine.
- **Rationale:** Fully-live single-take is too risky given Cloud Run cold-start variability; fully-scripted screencast is the weakest hackathon submission category.

### 5.3 Shot list: 9-beat 3-minute video
- **Decision:** Documented in `docs/DEMO_VIDEO_SHOTLIST.md` (to be written). 9 timed beats. 3 live moments. Voter brief generation as the closing artifact.
- **Rationale:** Improvising during retakes burns time.

### 5.4 Demo addresses: 5 public landmarks
- **Decision:** Documented in `data/demo_addresses.json` (to be written). One per demo race + one ZIP-only for ambiguity demo. Public landmarks (capitols, universities, city halls) — never residential addresses.
- **Rationale:** Civic-safety + reproducibility + judge-pasteable.

### 5.5 Trace granularity: L2 (PII-stripped)
- **Decision:** Tool name + arg summary + result summary + latency + status. AG-UI emitter strips fields matching `address|street|zip|coordinates|email` before emission. Renders in CopilotKit `ToolTraceTimeline`.
- **Rationale:** Strongest "this is a real agent, not a chatbot" demo asset; civic-safety guards prevent accidental PII surfacing.

### 5.6 Observability: Cloud Run logs + Cloud Trace, no SaaS APM
- **Decision:** ADK exports OTLP to Cloud Trace; Cloud Run logs auto-collect. No Sentry, Datadog, LangSmith, etc.
- **Rationale:** Free, sufficient, and one fewer key surface.

### 5.7 Demo URL: Cloud Run default (no custom domain for hackathon)
- **Decision (2026-05-08):** Use the auto-generated Cloud Run URL (e.g., `districtlens-web-<hash>-uc.a.run.app`) for the hosted demo and Devpost submission. No custom domain mapping for the hackathon window.
- **Rationale:** Zero setup, no DNS verification step, judges grade on functionality and not URL aesthetics. Custom domain mapping remains a clean post-hackathon add: the README and demo video can be updated without touching deployment infra.
- **Affects:** README quickstart, `docs/DEMO_VIDEO_SHOTLIST.md`, BUILD_PLAN Phase L.

---

## 6. Items deferred

These follow naturally from the locked decisions; not design choices:

- Specific demo race candidate names (after FEC bulk import lands)
- Specific 5 demo addresses (public landmarks for chosen races)
- Specific Tier 1+2 eval prompt wording (drafting work)
- Specific challenger photo curation (manual work; ~8 photos)
- README final content
- `docs/PRIVACY_POLICY.md` final wording
- `docs/REFUSAL_DESIGN.md` final wording
- `docs/MAINTAINER_DISCLOSURE.md` final wording
- `docs/DEMO_VIDEO_SHOTLIST.md` final wording

---

## 7. Anti-decisions (what was explicitly NOT chosen)

| Considered | Rejected | Reason |
|---|---|---|
| HeroUI Pro as private dep with token gate | Rejected | Reproducibility friction for judges who clone |
| shadcn/ui | Rejected | User chose OSS HeroUI; consistency with existing HeroUI mental model |
| Single Python service serving everything | Rejected | Clerk + CopilotKit on Python is friction-heavy |
| Vercel AI SDK / skip ADK | Rejected | Violates CLAUDE.md mandatory Agents CLI rule without documented blocker |
| Pure-bulk all 2026 finance with deep filings | Rejected | API quota for detailed filings is real; selective on deep is correct |
| Pure-selective only demo races | Rejected | Empty state for non-demo lookups looks bad in demo |
| OpenAI for extraction | Rejected | Dilutes Gemini-throughout judging story |
| Voyage AI auto-embedding via MongoDB MCP | Rejected | Same |
| Perplexity primary discovery | Rejected | Gemini grounding is in-stack; Perplexity is post-MVP |
| AGPL or copyleft license | Rejected | Discourages civic adoption |
| Free tier everything for hackathon | Rejected | Cold-start risk during recording and judge access |
| System-prompt-only refusals | Rejected | Jailbroken too easily for a civic AI product |
| Storing raw addresses anywhere | Rejected | Surveillance vector concern |
| Skipping maintainer disclosure | Rejected | Looks evasive for journalist-built civic AI |

---

## How to update this log

When a future decision changes anything above:
1. Add the new decision to the relevant section with date stamp
2. Mark the prior decision as superseded with reason
3. Update affected docs (preferably with banners pointing here, not inline rewrites)
4. Update `MAINTAINER_DISCLOSURE.md` if the change affects civic-safety posture
