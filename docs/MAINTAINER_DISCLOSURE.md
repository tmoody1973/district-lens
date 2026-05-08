# Maintainer Disclosure

> Canonical decisions for DistrictLens live in [DECISIONS_LOG.md](./DECISIONS_LOG.md). This document covers who maintains the project and why that information is public.

DistrictLens is built and maintained by Tarik Moody.

## Day job

I work at Radio Milwaukee, a public media organization in Milwaukee, Wisconsin. DistrictLens is a personal open-source project. It is not affiliated with Radio Milwaukee, was not commissioned or funded by Radio Milwaukee, and Radio Milwaukee has not reviewed the software.

## Why this is public

DistrictLens makes claims about congressional candidates and races. If you're going to use those claims, you should know who built the tool. Civic tools that hide their maintainers leave room for everyone else to fill in the blanks, usually badly.

I'm a journalist. I think that's a useful background for a transparency tool, but it's also the kind of thing that has to be on the page, not buried in a commit history.

## Why a Wisconsin race is in the demo set

The 2026 Wisconsin 3rd Congressional District (WI-3) race is one of four demo races that get deep issue-evidence enrichment. I chose it for verifiability. Wisconsin readers can fact-check the agent's claims against local reporting I also follow, which means errors will surface fast.

Including WI-3 is not an endorsement of any candidate. The other three demo slots are one Senate race, one swing-incumbent House race outside Wisconsin, and one open-seat House race. They're picked to cover the office types and classifications a voter might encounter.

## What's public

This is an Apache 2.0 project. Anything that shapes the agent's behavior is in the public repository:

- Agent prompts in `agent/app/prompts/`
- Refusal middleware in `agent/app/middleware/` (input pattern matching plus output classifier)
- Civic safety evaluation cases in `agent/tests/eval/`
- This document, versioned with the repo

Found a refusal failure, a citation gap, an evidence error? File an issue. The tool gets better when people poke at it.

## Conflicts I'll flag here if they happen

If Radio Milwaukee's editorial coverage ever overlaps directly with a race DistrictLens covers, I'll note it in this document and remove the affected race from the demo set. Today there's no such overlap.
