# DistrictLens Demo Video Shot List

> Canonical decisions live in [DECISIONS_LOG.md](./DECISIONS_LOG.md) §5.2 and §5.3. This is the production shot list for the 3-minute hackathon submission video.

**Total runtime:** 180 seconds (3:00)
**Live moments:** 3 (agent answer composition, FEC live refresh, refusal demo)
**Retake budget:** 3–5 takes; cuts between clean takes are fine
**Recording prerequisites:** Cloud Run min-instances=1 on both web and agent services; Atlas M10 active; pre-warmed via demo-prep workflow

---

## Beat-by-beat

| # | Time | Beat | Shot | Source on screen | Live? |
|---|---|---|---|---|---|
| 1 | 0:00–0:12 | **Problem** | Voice-over montage: FEC site, Congress.gov bills page, candidate websites, a confused-voter-search screenshot. | External sites (publicly accessible); fade quickly. | No |
| 2 | 0:12–0:25 | **Identity + setup** | Title card: *"DistrictLens — nonpartisan election intelligence."* Cut to the DistrictLens landing page; click a demo race button. | DistrictLens landing page. | No |
| 3 | 0:25–0:38 | **Race workspace renders** | Race overview, candidate cards (with photos), finance bars all populate from MongoDB cache. Visible "FEC: imported 2026-05-07" timestamp on cards. | DistrictLens race workspace. | No (instant render from cache) |
| 4 | 0:38–1:08 | **🔴 Live moment 1: Agent answer** | User types: *"Compare these candidates' positions on housing."* Agent thinks visibly. ToolTraceTimeline fills in: `geocodio.lookup` → `mongodb.find races` → `mongodb.find candidates` → `mongodb.find finance` → `mongodb.search issue_claims`. Cited answer renders with source links. | DistrictLens agent panel + tool trace. | **YES — actual agent call** |
| 5 | 1:08–1:25 | **Citation drill-down** | Click a claim → evidence drawer opens. Show quote, source URL, retrieved date, confidence label. | DistrictLens evidence drawer. | No (reads cached evidence) |
| 6 | 1:25–1:50 | **🔴 Live moment 2: FEC live refresh** | Click "Refresh latest FEC totals." Spinner. Tool trace shows `fec.refresh` tool call. Finance bars update with new timestamp. | DistrictLens finance panel + tool trace. | **YES — actual FEC API call** |
| 7 | 1:50–2:15 | **Voter brief generation** | Click "Generate voter brief." Markdown brief renders inline with all sections + citations + Limitations + non-removable disclaimer. User clicks export. File downloads. | DistrictLens BriefCard + browser download tray. | No (composes from already-retrieved evidence) |
| 8 | 2:15–2:40 | **🔴 Live moment 3: Refusal** | User types: *"Who should I vote for?"* Agent refuses with neutral redirect, offers evidence comparison. | DistrictLens agent panel. | **YES — actual refusal demo** |
| 9 | 2:40–3:00 | **Impact + close** | Voice-over: *"DistrictLens — built on Gemini 3.1, MongoDB MCP, Google ADK. Public repository, Apache 2.0 license. Try it at [hosted-URL]."* End card with hosted URL, GitHub link, and "Built with Google Cloud Agent Builder + MongoDB" partner badges. | End card. | No |

**Timing math:** 12 + 13 + 13 + 30 + 17 + 25 + 25 + 25 + 20 = **180 s** ✓

---

## Recording-day checklist

### 30 minutes before recording
- [ ] Run `prepare-demo` GitHub Actions workflow → sets `--min-instances=1` on web and agent services
- [ ] Verify Atlas cluster is M10 (paused → active); wait for cluster to be in `IDLE` state
- [ ] Hit hosted URL once to warm the web service container
- [ ] Hit `/api/agent/ask` with a throwaway query to warm the agent service container
- [ ] Run all 4 demo addresses through district lookup; cache should be populated
- [ ] Verify all 4 demo race workspaces load in <500 ms from cache
- [ ] Verify "Refresh latest FEC totals" button completes in <3 s

### Recording environment
- [ ] Browser: clean Chrome profile (no extensions visible in chrome)
- [ ] Resolution: 1920×1080 minimum
- [ ] Microphone: tested for clean voice-over
- [ ] Screen recording: 60 fps for smooth UI animation
- [ ] Quiet room; do-not-disturb on phone and OS

### Live moments: pre-take rehearsal
For each of the 3 live moments, do 2 dry runs before recording. The first run confirms the response is on-tone. The second confirms the timing fits the budgeted seconds. Then record.

### Retake decisions
Cut between takes is acceptable. Faking responses is not. If a live moment produces an unexpected answer:
- If the answer is still accurate, narrate around it ("here the agent picked a slightly different framing, also valid").
- If the answer is wrong, stop recording, file an issue, and fix before submitting. A demo of broken civic AI is worse than no demo.

### Post-record checklist
- [ ] Review all 3 live moments — agent did not produce a recommendation, persuasion, or unsupported claim
- [ ] All citations on screen are real, retrievable URLs
- [ ] Disclaimer ("not an endorsement") visible on the brief artifact
- [ ] Hosted URL on end card is the actual production URL
- [ ] Run `teardown-demo` workflow → sets `--min-instances=0` on both services to stop billing
- [ ] Pause Atlas M10 (resumable) or drop to M0

---

## What this demo proves to judges

| Beat | Hackathon judging criterion |
|---|---|
| 4 (live agent answer) | Technological Implementation — multi-tool agent with visible MCP-backed retrieval |
| 5 (citation drill-down) | Design — evidence-first UI, civic-safety story |
| 6 (live FEC refresh) | Technological Implementation — bulk-cache + live-refresh pattern with real official-source data |
| 7 (voter brief) | Quality of Idea + Potential Impact — tangible deliverable artifact, not just a chat |
| 8 (refusal) | Civic safety + Potential Impact — refusal is on tape, not narrated |
| 9 (close) | Submission completeness — partner integration, public repo, license |

## What this demo does NOT show (intentional cuts)

- The bulk import pipeline (~6–7 hour one-time job; uninteresting on camera)
- The eval suite running in CI (judges can read it in the repo)
- Address privacy implementation (covered by [PRIVACY_POLICY.md](./PRIVACY_POLICY.md))
- The refusal architecture internals (covered by [REFUSAL_DESIGN.md](./REFUSAL_DESIGN.md))

These docs are submitted alongside the video and the hosted URL. They prove what the video doesn't have time to.
