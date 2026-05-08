# DistrictLens Refusal Design

> Canonical decisions live in [DECISIONS_LOG.md](./DECISIONS_LOG.md) §4.1. The behaviors DistrictLens must refuse are listed in [GUARDRAILS.md](./GUARDRAILS.md). This document explains the engineering architecture that makes those refusals reliable.

**Audience:** developers, civic-AI researchers, and hackathon judges who want to verify that the refusal claims are real.

## The problem

DistrictLens is a civic-information tool. Tools in this category cause real harm when they recommend votes, generate persuasion content, or fabricate candidate positions. The tool needs to refuse those requests every time, including when users paraphrase, role-play, frame requests as hypotheticals, or apply pressure across multiple turns.

System-prompt-level refusals alone do not survive that kind of pressure. Modern LLMs can be coaxed past prompt rules; a civic AI tool whose entire refusal posture is one prompt rule has one point of failure. So DistrictLens uses a layered refusal design. Each layer catches different failure modes, and a request that bypasses one layer still has to pass the next.

## Layer 1: System prompt rules

The agent's system instruction lists the prohibited behaviors from `GUARDRAILS.md` and shows example refusal responses. This handles cooperative requests and most paraphrases.

What's public: that this layer exists, the prohibited behaviors (in `GUARDRAILS.md`), and the structure of the safe-language examples.

What's not in this design doc: the full prompt text. Revealing it would help adversaries craft inputs that lexically bypass the prompt. The prompt is committed to the public repository at `agent/app/prompts/civic_safety.md`, so anyone who clones the repo can read it, but it isn't pasted into this document.

## Layer 2: Pre-LLM input middleware

Before the user's message reaches the LLM, a Python middleware at `agent/app/middleware/refusal_input.py` checks for refusal-required patterns. If the message matches a high-confidence pattern (a direct vote-recommendation question, an explicit campaign-content request, a donor-to-position inference, etc.), the middleware short-circuits the agent loop and returns a canned, neutral refusal without invoking the LLM at all.

This layer catches obvious cases cheaply, with no model token cost. It reduces the LLM's exposure surface to jailbreak attempts. It is deterministic, so the same input always produces the same refusal.

What's public: that this layer exists, plus the pattern categories (vote recommendation, persuasion content, donor inference, partisan microtargeting). The exact regex patterns are in the public repository but are not enumerated here, for the same reason as the prompt text.

## Layer 3: Post-LLM output classifier

After the LLM produces a draft answer but before it streams to the user, a lightweight classifier runs a single Gemini 3.1 Flash-Lite call against the draft. The classifier asks: does this answer contain a voting recommendation, partisan persuasion, or unsupported policy attribution?

If the classifier says yes, the draft gets replaced with a generic refusal, and the original draft is logged for review.

This layer catches cases where Layers 1 and 2 missed something, for example when the LLM rolled along with a subtly framed request. Latency cost is roughly 150 to 250 ms per request, since Flash-Lite is fast. The cost is acceptable because shipping unsafe output is not.

The classifier itself is fail-secure. If the Flash-Lite call raises (timeout, quota, network error), the layer treats the draft as unsafe and replaces it with a generic refusal rather than letting the draft ship. This means a Flash-Lite outage degrades the agent toward refusal, not toward leaking unchecked output. The trade-off is intentional: in civic AI, false-positive refusals are recoverable; false-negative passes are not.

## Layer 4: Tier 1 evaluation gate

Layers 1 through 3 run at request time. Layer 4 is a regression gate.

The repository ships a Tier 1 civic-safety evaluation suite at `agent/tests/eval/`. It contains explicit test cases for every prohibited behavior in `GUARDRAILS.md`, including jailbreak attempts and multi-turn pressure. CI runs `agents-cli eval run --tier=blocking` on every pull request, and any Tier 1 case that fails blocks the PR from merging.

That means the layers above cannot silently degrade over time. Behavior changes that break refusals are caught before deployment.

## Cost summary

| Layer | Cost per request | What it catches |
|---|---|---|
| 1: System prompt | $0 (existing call) | Most cooperative requests; obvious paraphrases |
| 2: Input middleware | <1 ms | Direct, lexically clear refusal triggers |
| 3: Output classifier | ~150–250 ms, ~$0.0001 | LLM slips through Layers 1–2 |
| 4: CI eval gate | 0 runtime cost; ~30 s per PR | Behavior regression over time |

## Failure modes and what they look like

| Failure | What happens |
|---|---|
| User finds a novel jailbreak the layers miss | Unsafe output reaches the user. The agent's response is logged. A new eval case is added and the layers are updated. Disclosure of the failure happens through the public issue tracker, not silently. |
| Layer 3 has a false positive (legitimate answer flagged as unsafe) | The user sees a generic refusal where a real answer was expected. Logged so the classifier can be tuned. For a civic AI tool, false positives are preferable to false negatives. |
| CI eval gate breaks (test infrastructure) | PRs cannot merge until evals run again. Acceptable failure mode. |

## What we will not do

Layer 3 will not be relaxed to "improve latency" unless it is replaced by an equally strong check. No refusal layer will ship behind a feature flag, since refusal posture has to be on by default for every request. And no single layer will be allowed to carry the whole refusal contract. Defense-in-depth or nothing.

## Reporting failures

If you can demonstrate a refusal failure on the live or hosted DistrictLens, please file an issue with the prompt and the response attached. The tool gets better when people poke at it.
