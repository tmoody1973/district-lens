# DistrictLens — Three-Minute Demo Script (voter cut)

**Hackathon track:** Google Cloud Rapid Agent Hackathon — MongoDB partner track
**Narrator:** a Milwaukee voter (first person)
**Format:** live prod footage, captioned, voiceover. The automated pipeline in
`demo-video/` produces this cut end-to-end; this document is the canonical
script it reads from (`demo-video/narration/script.json`).

All six beats were verified working in production before capture
(web 00075-rpn / agent 00042-9l2, 2026-06-11).

---

## Beat 1 — Problem (≈0:04–0:25) · *Impact*

**Visual:** landing page, cursor settles on the address box.

> "I'm a voter in Milwaukee. Every election, the information I need is
> technically public — FEC filings, Congress.gov, campaign websites — but it's
> scattered across a dozen sites, and I have a life. DistrictLens is a
> nonpartisan agent that assembles the evidence in seconds, cites every claim,
> and refuses to do the one thing it never should."

## Beat 2 — The brief builds (≈0:25–1:09) · *Tech + Design*

**Visual:** "Milwaukee, WI 53202" typed live → receipt runs (District resolved
→ Candidates → **Verified via MongoDB MCP** → Finance → Legislation →
Positions → Archived → Complete) → scroll through the finished brief.

> "I give it my address. Watch the receipt — this is a real multi-step plan
> running live. It resolves my district, loads the candidates, and verifies
> them through the MongoDB MCP server — that's the partner call, right there
> in the default path. Everything this agent knows lives in MongoDB: three
> thousand candidates, four hundred seventy races, campaign finance, voting
> records, and every archived source it cites. The research it does writes
> back to the database, so each race it studies makes the next answer faster.
> Seconds later: candidates, money, the incumbent's record, and issue
> positions — every stance carries a citation with an archived, dated copy of
> the source."

## Beat 3 — Follow the money (≈1:09–1:35) · *Tech + Idea*

**Visual:** donor question typed in chat → tool trace → DonorContributionsCard
renders; hold on the guardrail footer.

> "Now the question I always wondered about: who actually funds these
> campaigns? I ask for Gwen Moore's largest individual donors. The agent calls
> the live FEC API, merges repeat contributions, and renders the answer as a
> card — names, employers, amounts, dates. And read the fine print:
> contributions provide context — they do not establish a candidate's policy
> positions. The guardrail ships with the data."

## Beat 4 — The refusal (≈1:35–1:56) · *Quality of the Idea*

**Visual:** "Who should I vote for in this race?" → the agent declines and
offers cited comparison.

> "And the question every civic AI gets wrong: who should I vote for?
> DistrictLens refuses — and offers to compare the candidates' own words on
> any issue I choose. That refusal is enforced in three layers: the system
> prompt, a before-model callback, and an after-model callback. Three layers.
> Not one."

## Beat 5 — Take it with you (≈1:56–2:07) · *Design + Impact*

**Visual:** Copy brief → "Copied ✓", Share → "Link copied ✓", paste
`/w?race=2026-H-WI-04` — the race rebuilds from the bare URL.

> "When I'm done, one click copies the whole brief as cited markdown, one
> click exports it, and Share gives me a permanent link — I can send my race
> to anyone in my district, and the agent rebuilds it on demand."

## Beat 6 — Close (≈2:07–2:36) · *Impact + platform vocabulary*

**Visual:** 6s of the finished brief, then the end card.

> "DistrictLens is built with the Gemini agent platform developer SDK — a
> code-first ADK agent running Gemini 3.1 Pro, with Gemini 3.5 Flash doing
> Google-Search-grounded evidence research. MongoDB MCP is the partner
> integration, it runs on Cloud Run, and civic-safety evals gate every change.
> Four hundred thirty-five House races today — every Senate and governor's
> race next. For voters like me, and for the local journalists who cover these
> races. Evidence in. Decision yours."

---

## Judging criteria coverage

| Criterion | Where it lands |
|---|---|
| Technological Implementation | Beat 2 (MCP in the default path, MongoDB as the agent's memory), Beat 3 (live FEC + generative card), Beat 6 (Gemini 3.1/3.5 + ADK named) |
| Design | Beat 2 (live receipt, archived citations), Beat 5 (copy/export/share, permalinks) |
| Potential Impact | Beats 1 and 6 (435 races; voters + local journalists) |
| Quality of the Idea | Beat 4 (three-layer refusal), Beat 3 (guardrail on the data itself) |

## Regenerating the video

See `demo-video/README.md` — swap narration MP3s or edit
`demo-video/narration/script.json`, then `node cards.js && python3 compose.py`.
Re-capture visuals with `node capture.js` only if the app changes.
