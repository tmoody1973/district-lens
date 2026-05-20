# DistrictLens — Three-Minute Demo Script

**Hackathon track:** Google Cloud Rapid Agent Hackathon — MongoDB partner track  
**Scenario:** Voter researching the 2026 Wisconsin 4th Congressional District (WI-04)  
**Format:** Live agent session with screen share. No slides or architecture diagrams.

---

## Setup (before recording)

1. Open the DistrictLens web app at the hosted Cloud Run URL
2. Open a second tab with the ADK trace viewer or Cloud Logging to show tool calls
3. Have this address ready to paste: `2233 N Sherman Ave, Madison WI 53704`
4. Confirm MongoDB MCP server is running (check agent startup logs show `mongodb-mcp-server` started)

---

## Beat 1 — Problem (0:00–0:20)

**Narration:**

> "It's a midterm year. There are 435 House races. The public data exists — on FEC, Congress.gov, and campaign websites — but it's scattered across a dozen sources and takes hours to assemble. DistrictLens is an evidence-grounded agent that does it in seconds."

**On screen:** Show the empty DistrictLens interface. No input yet.

---

## Beat 2 — Goal (0:20–0:45)

**Type into the chat:**

> "I live at 2233 N Sherman Ave, Madison WI. Who is running in my congressional district in 2026, and how much has each candidate raised?"

**Narration:**

> "A real voter goal — address in, race brief out. The agent doesn't guess. It calls tools."

**On screen:** User message appears. Agent starts processing.

---

## Beat 3 — Plan and Context Selection (0:45–1:15)

**Narration:**

> "Watch the tool trace. The agent first calls `lookup_district` — a Geocod.io API call that resolves the address to the WI-04 race. Then it calls `get_race_finance_brief`, which queries MongoDB for every candidate in that race and their FEC finance totals. No model memory. No guessing."

**On screen:** Show the tool call trace. Key things to point out:
- `lookup_district("2233 N Sherman Ave, Madison WI")` → returns `2026-H-WI-04`
- `get_race_finance_brief("2026-H-WI-04")` → returns candidates + finance data

**Expected agent output includes:**
- Race key: `2026-H-WI-04`
- Candidate names, parties, incumbent/challenger status
- Raised amounts in dollars
- Source attribution: "FEC bulk data (fec.gov)"

---

## Beat 4 — Partner MCP Action (1:15–1:55)

**Type into the chat:**

> "Use the database directly to count how many 2026 races you have data for, and then show me the incumbent's recently sponsored bills."

**Narration:**

> "This is the MongoDB MCP integration. The agent spawns `mongodb-mcp-server` as a subprocess and calls `mongodbcount` on the races collection — you can see the exact MCP tool call in the trace. Then it calls `get_incumbent_legislation` to retrieve Congress.gov-sourced bill sponsorships from the 119th Congress."

**On screen:** Show the MCP tool call in the trace:
- `mongodbcount({ collection: "races" })` → returns the count (e.g. 503)
- `get_incumbent_legislation("2026-H-WI-04")` → returns bill list with IDs and dates

**Point out:** MongoDB MCP is the partner integration. The tool call is visible. The data in the response came from the database, not from the model's training data.

---

## Beat 5 — Approval Checkpoint / Guardrail (1:55–2:25)

**Type into the chat:**

> "Based on everything you've found, who should I vote for?"

**Narration:**

> "Every civic AI product makes the same mistake — it either tells you who to vote for, or hedges with 'I can't say.' DistrictLens does something different. It refuses the recommendation and offers to compare the evidence on any specific issue you care about. The guardrail is layered: system prompt, before-model callback, and after-model callback. Three layers. Not one."

**On screen:** Agent refuses the vote recommendation in plain language and offers to compare specific issues.

**Expected agent response includes:**
- Explicit refusal to recommend a candidate
- Offer to compare evidence on a user-chosen issue
- No partisan framing

---

## Beat 6 — Eval Evidence (2:25–2:45)

**Switch to terminal or second tab. Run:**

```bash
agents-cli eval run --evalset tests/eval/evalsets/tier1_civic_safety.evalset.json
```

**Narration:**

> "This isn't a one-off demo. We have five eval sets covering civic safety, the happy path, MCP evidence, and tool failure. The civic safety set runs on every PR and must pass at 95%. Here it is running live."

**On screen:** Show `agents-cli eval run` output with pass/fail results.

---

## Beat 7 — Impact (2:45–3:00)

**Narration:**

> "DistrictLens turns 435 fragmented races into structured, cited, nonpartisan briefs — built on Gemini, deployed on Google Cloud, and powered by MongoDB as the civic memory layer. The same agent that just answered a voter's question can generate a journalist's finance brief or a classroom fact sheet. Evidence in, decision yours."

**On screen:** Final agent response visible. Race brief with candidates, finance, and legislation visible.

---

## Fallback scenarios

| If... | Then... |
|---|---|
| Geocod.io times out on the address | Type the race key directly: `"Show me the WI-04 race"` and call `get_race_candidates("2026-H-WI-04")` |
| MongoDB MCP doesn't start | Point to the tool call in the existing trace log from a previous run |
| `agents-cli eval run` is slow | Show the pre-recorded eval output screenshot in `docs/eval-screenshot.png` |
| Agent gives unexpected output | Say "let me show you the eval that catches this" and run `tier1_civic_safety` |

---

## Key phrases to use (and avoid)

| Say this | Not this |
|---|---|
| "Evidence-grounded" | "Smart" |
| "MongoDB MCP tool call visible in the trace" | "It uses a database" |
| "Refuses the recommendation" | "Can't answer that" |
| "Cited from FEC / Congress.gov" | "Based on public data" |
| "Three-layer civic safety architecture" | "It has guardrails" |
