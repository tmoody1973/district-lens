# Devpost — About the project (copy-paste body below)

## Inspiration

I work at a radio station in Milwaukee, and every election cycle I watch smart, busy people give up on researching their own ballot. The information exists. FEC filings are public. Congress.gov is public. Candidate websites are public. But it's spread across a dozen sites with a dozen interfaces, and nobody has three hours per race. So people fall back on party labels, a friend's opinion, or nothing.

I wanted an agent that does the assembly work without doing the deciding. That second part mattered as much as the first. Most civic AI either tells you who to vote for or hides behind "I can't discuss politics." Both felt wrong. The tool I wanted shows you the evidence, cites where every claim came from, and stops there.

## What it does

You give DistrictLens your address. It resolves your congressional district, then builds a brief: who's running, what each candidate has raised and from whom, the incumbent's voting record and sponsored bills, and each candidate's positions on the issues, with citations. Every cited page gets fetched and stored with a date and content hash, so a citation points to what the source said when we read it, not whatever the page says next month.

You can keep asking questions. "Who are Gwen Moore's largest individual donors?" triggers a live FEC API call and renders a card with names, employers, amounts, and dates. The card carries its own disclaimer: contributions provide context, they don't establish policy positions.

Ask "who should I vote for?" and it declines, then offers to compare the candidates' own words on any issue you pick. When evidence doesn't exist, it says so. Low-profile challengers with no public statements get an honest "no public positions found in indexed sources yet" instead of generated filler.

When you're done you can copy the brief as cited markdown, export it, or share a permalink that rebuilds the race for anyone who opens it.

## How we built it

A code-first ADK agent running Gemini 3.1 Pro, with Gemini 3.5 Flash doing Google Search-grounded research for candidate positions. The web app is Next.js with CopilotKit streaming agent state, so you watch the brief assemble step by step. Everything runs on Cloud Run.

MongoDB is the agent's memory, not just storage: 3,100+ candidates and 470 races bulk-imported from FEC and Congress.gov, plus the archived evidence store and research caches. When the agent researches a cold race, it writes the results back, so the first person to look up a district warms it for everyone after. The MongoDB MCP server runs as a subprocess of the agent, and every brief includes a read-only verification call through it, visible in the activity trace.

One architecture decision I'd defend anywhere: the brief is a deterministic pipeline, not an LLM choosing which tools to call. Early versions asked the model to chain seven tools and it would skip steps, usually the positions search, which is the part voters care about most. So the brief became a fixed sequence that always runs every step, and the LLM handles what it's actually good at: conversation, follow-ups, and synthesis. 750 tests and a civic-safety eval suite gate every change.

## Challenges we ran into

The FEC bulk data includes about 1,400 phantom candidates, people with inactive registrations and no money, who polluted every roster until we built reconciliation against a verified candidate list.

Perplexity's API, our first research engine, couldn't find low-profile challengers at all. Whole states came back empty. Gemini 3.5 Flash with Google Search grounding found them on the first try, at a fraction of the cost. We swapped engines mid-build.

The night before the deadline, briefs started freezing mid-build. Three separate root causes, found by reading production logs at 1am: chat tools were writing pipeline state they didn't own, a cold container was re-resolving an npm package from the registry and blocking for three minutes, and a 30-second timeout was cancelling position research so cold races could never finish warming. Each fix was small. Finding them wasn't.

Also, at midnight we discovered we'd never provisioned an FEC API key. It turns out Congress.gov keys work on the FEC API, since both run on api.data.gov. That one was luck.

## Accomplishments that we're proud of

The refusal works and we can prove it: three enforcement layers, tested in the eval suite on every commit, demoed live. The honest-empty states might be the thing I'm proudest of, because shipping "we found nothing" as a designed feature goes against every instinct to fill the screen. And the citation archive means this tool's receipts will still exist when campaign websites get scrubbed after the primary.

## What we learned

Determinism and LLMs aren't rivals. The right split is deterministic where correctness is non-negotiable and generative where flexibility pays. Grounded search beats general search APIs badly for low-profile entities. And an agent that writes its research back to the database gets cheaper and faster the more people use it, which is the closest thing to a flywheel a civic tool can have.

## What's next for DistrictLens

Roll-call votes filtered by issue, so "what did she actually vote on for healthcare" gets a direct answer. Senate and governor's races for the full 2026 cycle. Competitiveness ratings for context. And richer exports for local newsrooms, who need this assembled evidence as much as voters do.
