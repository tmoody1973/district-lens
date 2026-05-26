

## US House

This is the race I have the *most* leverage in and the *least* information about, because national press ignores 90% of House races. What I want:

**District-specific framing.** "This district is rated R+4 by Cook, flipped D in 2018, R in 2022." Tell me whether my vote is in a competitive district or a safe one — that changes how I think about strategic voting in a primary vs. general.

**The incumbent's actual record, scored honestly:**

- Vote attendance percentage (this is a real signal nobody surfaces).
- Party-line voting percentage — did they break with their party on anything meaningful?
- Bills they actually authored vs. co-sponsored vs. just voted on. Most members author nothing.
- Committee assignments and whether they showed up to hearings.
- Constituent services record if available (casework volume, town halls held).

**For challengers in primaries:** who are they *really*? Primary challengers fall into archetypes — establishment heir, ideological insurgent, self-funder, name-recognition celebrity, perennial candidate. Tell me which.

**Money story specific to House races:**

- In-district vs. out-of-district small donor ratio.
- Leadership PAC money (signals party establishment backing).
- Single-issue PAC concentration (crypto, AIPAC, LCV, etc. — these moved a lot of 2024 House primaries).
- Self-funding percentage.

**The "what committee will they sit on" question.** A freshman from a safe district gets very different committee assignments than a freshman from a swing district. This affects what they can actually do for the district.

## US Senate

Different game. Senators are quasi-national figures, so I need help cutting through the noise:

**Their actual Senate behavior, not their TV behavior.** Lots of senators perform one way on cable and vote another. Show me the gap. Cloture votes, judicial confirmations, and committee votes reveal more than floor speeches.

**The "what would they do with the gavel" question.** If their party wins the majority, what committee would they likely chair? Senate races are partly about institutional power, not just one vote.

**Senate-specific money signals:**

- Out-of-state money is the norm here, so the more interesting cut is *which* states and *which* industries.
- Joint fundraising committee participation (signals coordination with national party).
- Bundlers, if disclosed.

**Coalition math.** Senate races in purple states are won on the margins — show me which constituencies they've historically over- or underperformed with, and where this cycle's targeting seems to be heading.

**The judicial question.** Senators vote on lifetime federal judges. For many voters this is the single highest-stakes thing a senator does, and it almost never makes it into voter guides.

## Governor

This is the race where voter guides are usually *worst*, because national templates don't fit and state-specific stakes get flattened. What I want:

**What this governor can actually do in this state.** Governors' powers vary wildly. Line-item veto? Appointment power over state supreme court? Control of National Guard deployment? Budget impoundment authority? Emergency powers post-COVID reforms? Tell me the specific tools this person would hold.

**State-specific stakes that are live right now.** In Wisconsin, that might be the legislative maps, the WEC, Act 10 legacy questions, shared revenue, the UW system. In Texas, it's the border, the grid, abortion enforcement. National issue grids miss all of this. The brief should be *state-aware*.

**Their record as an executive, not a legislator.** If they were a mayor, AG, or business executive — what did they actually run, what's the audit trail, who did they hire, who did they fire, what blew up on their watch?

**Appointment philosophy.** Governors appoint hundreds of people — agency heads, judges, regents, board members. Past appointment patterns predict future ones better than campaign promises.

**Veto record if incumbent.** What did they block, what did they let through, where did they negotiate.

**Relationship with the legislature.** A governor of the opposite party from the legislature is structurally different from a trifecta governor. Tell me what gets done vs. what gets vetoed vs. what's pure signaling.

## Cross-cutting things for all three

**A "stakes if this seat flips" callout.** For House, it might be majority math. For Senate, committee chairs and judicial confirmations. For Governor, veto pen and appointments. This is the single most under-served piece of voter information.

**Primary vs. general framing.** In a primary, I'm choosing within a coalition — so intra-party fault lines matter. In a general, I'm choosing between coalitions — so cross-party contrasts matter. Same candidate, different brief.

**A "national money flooding in" flag.** When outside spending exceeds candidate spending, that's a story. Surface it.

## On the CopilotKit dynamic UI angle

Since you're doing dynamic UI rather than static documents, the most valuable thing you can do that static voter guides *can't* is **progressive disclosure driven by the voter's questions.** A few things that get more interesting when the UI is generative:

- **Comparison on demand** — "compare these two on housing" generates a side-by-side just for that issue, with sources, instead of a pre-built grid.
- **"Why should I care about this race?"** — the agent reads my stated interests (or registration data) and explains stakes in my terms.
- **Drill-down on a single donor cluster** — "who is this 'Securities & Investment' bucket actually?" expands into the underlying employers. This is where Donor DNA could plug in directly.
- **"What changed since last week?"** — diff view against the prior brief. Vote happened, new endorsement, new ad buy, new filing.
- **Receipts on hover** — every claim has a source, but it only appears when I want it, so the brief stays readable.

The trap to avoid: generative UI makes it tempting to let the LLM *write* the analysis on the fly. For a voter brief, you want the LLM composing and presenting from a verified data layer, not generating claims. The model picks the layout and the framing; the facts come from FEC, Congress.gov, state SOS, ProPublica, OpenStates, etc. Otherwise you'll ship hallucinated voting records, and that's a credibility event you don't recover from.

Want me to sketch what the data layer would need to look like to back this — i.e., which sources feed which sections, and where the gaps are that you'd need to either scrape or accept as "not available"?