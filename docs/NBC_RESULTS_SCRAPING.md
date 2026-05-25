# How DistrictLens Reads Election Results from NBC (Plain English)

This explains, in plain language, how DistrictLens figures out **who won a primary**
by reading NBC News' election results — and why we do it this way instead of
asking an AI.

It's written so you can hand it to someone non-technical and they'll understand
the *why*, then keep reading for the *how*.

---

## 1. The problem we were trying to solve

DistrictLens has a background job (`resolve_nominees`) that runs every day. Its
job is to look at primary elections that recently happened and decide, for each
race, **"do we know who the nominee is yet?"** If yes, mark the race `confirmed`.
If not, leave it flagged for a human.

The first version asked **Perplexity** (an AI web-search tool): *"Who won the
Idaho House District 1 primary?"* and tried to pull the winner's name out of the
AI's written answer.

Two things went wrong, and we proved both with real data:

1. **The AI usually refused to answer.** We told it "only trust official
   government results pages." Six days after a primary, those official pages
   often aren't published yet (one state's site literally said "check back on
   election day"). So the AI correctly said "I can't confirm a winner" — and we
   confirmed **0%** of races.

2. **When the AI *did* answer, it was sometimes confidently wrong.** We asked who
   won the 2024 Ohio Republican Senate primary (the real answer is Bernie
   Moreno). Perplexity said "Jon Husted" — a different person from a different
   year — and cited **two YouTube videos**. If we had trusted that, we'd have
   published a **fabricated winner**. For a nonpartisan civic tool, that's the
   worst possible failure.

The lesson: **an AI writing prose is the wrong tool for "who won."** We need
*structured data with an explicit winner flag*, from a source that actually has
the results.

---

## 2. The insight: NBC already publishes this as data

NBC News runs a "Decision 2026" results site. Their **Decision Desk** is one of
the outfits that officially "calls" races (the same caliber of data the TV
networks use on election night). Crucially, their website is powered by a
**public data feed** — the same feed their own page reads to draw the charts.

That feed gives us, for every race, a clean list of candidates with a true/false
**`isWinner`** flag, the **percent of precincts reporting**, the **vote
percentages**, and whether the race is going to a **runoff**.

Because the winner is a *data field*, not a sentence an AI wrote, **it cannot
hallucinate**. A boolean can't confidently make something up. That's the whole
point.

---

## 3. Where the data lives (the URL)

NBC has one results page per race, with predictable web addresses:

```
House race:   https://www.nbcnews.com/politics/2026-primary-elections/idaho-us-house-district-1-results
Senate race:  https://www.nbcnews.com/politics/2026-primary-elections/kentucky-senate-results
```

Behind each of those pages is a matching **data feed** (JSON — just structured
text a computer reads). Same address, different prefix:

```
https://www.nbcnews.com/firecracker/api/v2/state-results/2026-primary-elections/idaho-us-house-district-1-results
```

We fetch the data feed directly. **No web browser needed** — it's a plain
download, fast and reliable. (The visible web page is built with JavaScript,
which would be slow and fragile to scrape; the feed avoids all of that.)

### Turning our race ID into NBC's address

Internally a DistrictLens race is named like `2026-H-ID-01` (2026, House, Idaho,
district 1). NBC names the page `idaho-us-house-district-1-results`. The function
`build_page_slug()` does that translation:

- Look up the full state name: `ID` → `idaho`.
- House → `{state}-us-house-district-{number}-results` (we drop the leading
  zero, so `01` becomes `1`).
- Senate → `{state}-senate-results` (no district).

---

## 4. What a race looks like in the feed

Each race in the feed looks like this (trimmed to the parts we use):

```json
{
  "raceId": "2026-05-19R~ID001~H",
  "percentIn": 99,
  "callStatus": null,
  "isRunoff": null,
  "candidates": [
    { "firstName": "Russ", "lastName": "Fulcher", "party": "gop", "percentVote": 78.1, "isWinner": true },
    { "firstName": "Andy", "lastName": "Briner",  "party": "gop", "percentVote": 11.3, "isWinner": false }
  ]
}
```

A few things worth knowing:

- **One race object per party.** The Republican primary and the Democratic
  primary for the *same seat* are two separate entries. So Idaho District 1
  returns two race objects (`...R~ID001~H` and `...D~ID001~H`).

- **The `raceId` is the source of truth.** On these district feeds, the tidy
  `state`/`district` fields are often blank — but the `raceId` always encodes
  everything. `parse_race_id()` reads `2026-05-19R~ID001~H` as:
  - date = `2026-05-19`
  - party = `R` → `REP`
  - state = `ID`
  - district = `001` → `01`
  - office = `H` (House)

- **`callStatus`** is `"P"` when NBC has officially *projected/called* the race.
  It's reliably filled in for big statewide races (Senate, Governor) but is
  usually **blank for individual House districts** — which is why we don't rely
  on it alone for House races (see the next section).

- **`isWinner`** is the candidate-level winner flag. Important catch: NBC sets it
  to `true` even at **0% reporting** when a candidate is running *unopposed*
  (they're the automatic nominee). So `isWinner = true` by itself does **not**
  mean "the votes are counted." We handle that carefully below.

---

## 5. The rules for declaring a winner (the confirm policy)

This is the heart of it, and the rules were chosen deliberately for **civic
safety** (locked with Tarik on 2026-05-25). For each party's race, we decide one
of four outcomes:

| Outcome | When | Confirms? |
|---|---|---|
| **Runoff** | NBC marks the race as headed to a runoff | No — it's not settled |
| **Uncontested** | Only one candidate ran (sole nominee) | **Yes** |
| **Called** | A candidate is the winner **and** NBC called it (`callStatus = "P"`) **OR** ≥ 95% of precincts are in **with a clear margin** (the lead over second place is at least 1 point) | **Yes** |
| **Insufficient** | None of the above (too few votes counted, too close, or no winner marked) | No — stays flagged |

The two safety guardrails baked into these rules:

1. **A winner flag alone is never enough for a contested race.** If two or more
   people ran and only 0% of votes are counted, we say *Insufficient* — even
   though NBC flagged a "winner." We require either real reporting (95%+ with a
   clear margin) or an explicit NBC call. This is the rule that stops us from
   publishing a "winner" before the votes exist.

2. **A close race waits.** Even at 99% reporting, if the top two are within a
   point of each other, we don't confirm — late-counted ballots could flip it.

For a whole **seat**, `decide_seat()` combines the parties: if any party is in a
runoff, the seat is "runoff." Otherwise, if at least one party has a confirmable
winner, the seat is "confirmable" and we record those winners. If nobody
qualifies, it stays "insufficient" and falls back to the older flow.

### Worked examples (real data, captured 2026-05-25)

- **Idaho District 1 → CONFIRMED.** Russ Fulcher (R) at 78.1%, Kaylee Peterson
  (D) at 87.1%, both at 99% reporting with huge margins. Clear winners.
- **Oregon District 6 → CONFIRMED as uncontested.** Andrea Salinas (D) was the
  only candidate, so she's the nominee even though vote counting shows 0%.
- **A hypothetical nail-biter at 99% in, 50.2% vs 49.8% → NOT confirmed.** The
  margin (0.4 points) is under our 1-point bar, so we wait.

---

## 6. Why this is safer than the AI approach

| | AI prose (old) | NBC data feed (new) |
|---|---|---|
| Where the winner comes from | A sentence the AI wrote | A `true/false` field from the Decision Desk |
| Can it invent a winner? | **Yes** (we saw it cite YouTube) | No — it's structured data |
| Needs the official SoS page to exist? | Yes (often missing for weeks) | No — NBC calls races on election night |
| How we read it | Fragile text parsing | Read named fields directly |

The winner's name comes straight from the data, so it's **inherently grounded** —
there's no separate "does this name appear on the page?" check to worry about,
because the name *is* the result.

---

## 7. Where this lives in the code

All of it is in **`agent/app/refresh/nbc_results.py`**:

- `build_page_slug(...)` — turn a DistrictLens race into NBC's page name.
- `parse_race_id(...)` — decode `2026-05-19R~ID001~H` into date/party/state/district/office.
- `fetch_nbc_results(slug)` — download the feed and parse it into clean
  `NbcRaceResult` objects. Returns nothing (and never crashes) if the feed is
  missing or times out.
- `decide_party_race(race)` — apply the rules above to one party's race.
- `decide_seat(races)` — combine both parties into a single seat decision.

Tests live in **`agent/tests/unit/test_nbc_results.py`** and run against **real,
trimmed feed responses** saved in `agent/tests/unit/fixtures/nbc/`. They cover
the happy path, uncontested races, runoffs, close margins, and the critical
"winner-flag-at-0%-doesn't-confirm" safety case.

---

## 8. Honest limitations

- **It's an unofficial feed.** We're reading a public endpoint NBC's own site
  uses. We're polite about it: a clear identifying User-Agent, once-a-day
  cadence, and we save what we fetch with a timestamp. If NBC changes the feed,
  we fall back gracefully (the race just stays flagged for a human).
- **NBC doesn't cover every race.** Very minor or third-party-only contests may
  not be in the feed. Those fall through to the older Perplexity flow — but only
  as a *"projected (unofficial)"* signal shown to journalists, **never** an
  automatic confirm (because of the hallucination risk in section 1).
- **`callStatus` is sparse for House districts.** That's why our House rule
  leans on "95% reporting + clear margin" rather than waiting for an explicit
  call that often never comes at the district level.
- **A confirmed result is still a *projection*, not legal certification.**
  Official certification by a Secretary of State can take weeks. NBC's call is
  the same standard newsrooms use to report winners — good enough to display
  with confidence, which is the bar we chose.

---

## 9. The one-sentence version

> Instead of asking an AI "who won?" (which can lie), we read NBC's structured
> results feed, trust their explicit winner flag **only** when the votes are
> actually in (or the race is uncontested or officially called), and never
> confirm a contested race before the count supports it.
