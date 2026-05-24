"""Tests for nominee_resolver: prompt building and conservative answer parsing.

The most important invariant: ambiguous or vague answers MUST yield empty
winners and low confidence — never a fabricated winner.  All Perplexity calls
are replaced by injected fake_search functions; no network I/O.
"""

from __future__ import annotations

import pytest

from app.refresh import nominee_resolver as nr

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DEFAULT_SOURCES = [{"url": "https://sos.ga.gov/results", "title": "GA SoS Results"}]


def _fake_search(answer: str, sources: list[dict] | None = None):
    """Return a coroutine that yields (answer, sources) — no network."""
    resolved_sources = sources if sources is not None else _DEFAULT_SOURCES

    async def _inner(prompt: str) -> tuple[str, list[dict]]:
        return answer, resolved_sources

    return _inner


# ---------------------------------------------------------------------------
# build_prompt
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_build_prompt_includes_key_facts():
    """Prompt must name the state, district, party full names, date, and 'official'."""
    p = nr.build_prompt(
        state="GA",
        office="H",
        district="07",
        parties=["DEM", "REP"],
        date="2026-05-19",
    )
    for token in ["Georgia", "7", "Democratic", "Republican", "2026-05-19", "official"]:
        assert token in p, f"Expected token {token!r} not found in prompt"


@pytest.mark.unit
def test_build_prompt_senate_uses_senate_label():
    """Senate office should appear as 'Senate', not 'House'."""
    p = nr.build_prompt(
        state="AL",
        office="S",
        district="00",
        parties=["DEM", "REP"],
        date="2026-05-19",
    )
    assert "Senate" in p
    assert "House" not in p


@pytest.mark.unit
def test_build_prompt_uses_full_state_name():
    """Two-letter codes must expand to full names (spot-check a few)."""
    assert "Wisconsin" in nr.build_prompt(
        state="WI", office="H", district="01", parties=["DEM"], date="2026-08-11"
    )
    assert "Texas" in nr.build_prompt(
        state="TX", office="H", district="07", parties=["REP"], date="2026-03-03"
    )


# ---------------------------------------------------------------------------
# resolve_race — clean single-winner answer
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_race_parses_single_winners():
    """Clean answer with both party winners → parsed into winners_by_party."""
    answer = (
        "The Republican primary was won by Jane Doe. "
        "The Democratic primary was won by John Roe."
    )
    res = await nr.resolve_race(
        state="GA",
        office="H",
        district="07",
        parties=["DEM", "REP"],
        date="2026-05-19",
        search_fn=_fake_search(answer),
        structure_fn=nr._heuristic_structure,
    )
    assert res.winners_by_party.get("REP") == "Jane Doe"
    assert res.winners_by_party.get("DEM") == "John Roe"
    assert res.sources and res.sources[0]["url"].startswith("https://sos.ga.gov")
    assert res.runoff_indicated is False
    assert res.confidence > 0.5


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_race_raw_answer_preserved():
    """raw_answer must be the verbatim string returned by the search function."""
    answer = "The Republican primary was won by Alice Smith."
    res = await nr.resolve_race(
        state="GA",
        office="H",
        district="07",
        parties=["REP"],
        date="2026-05-19",
        search_fn=_fake_search(answer),
        structure_fn=nr._heuristic_structure,
    )
    assert res.raw_answer == answer


# ---------------------------------------------------------------------------
# resolve_race — runoff detection
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_race_detects_runoff_advances_to():
    """'advances to a June 16 runoff' must set runoff_indicated=True."""
    answer = (
        "No candidate reached 50 percent. Bob Jones advances to a June 16 runoff "
        "against Carol Brown."
    )
    res = await nr.resolve_race(
        state="GA",
        office="H",
        district="07",
        parties=["REP"],
        date="2026-05-19",
        search_fn=_fake_search(answer),
        structure_fn=nr._heuristic_structure,
    )
    assert res.runoff_indicated is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_race_detects_runoff_keyword():
    """Bare 'runoff' keyword in the answer must set runoff_indicated=True."""
    answer = "The race is headed to a runoff election scheduled for later this year."
    res = await nr.resolve_race(
        state="GA",
        office="H",
        district="07",
        parties=["REP"],
        date="2026-05-19",
        search_fn=_fake_search(answer),
        structure_fn=nr._heuristic_structure,
    )
    assert res.runoff_indicated is True


# ---------------------------------------------------------------------------
# resolve_race — conservative failure mode (THE MOST IMPORTANT TESTS)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_race_no_winner_returns_empty_low_confidence():
    """Vague answer with no winner → empty winners_by_party + low confidence.

    This is the critical conservative failure mode: the resolver must NEVER
    fabricate a winner when the answer is ambiguous. 'I'm not sure' must map
    to empty winners so the downstream gate flags the race for human review.
    """
    answer = "Results are still being tallied and no official winner has been declared."
    res = await nr.resolve_race(
        state="GA",
        office="H",
        district="07",
        parties=["DEM", "REP"],
        date="2026-05-19",
        search_fn=_fake_search(answer),
        structure_fn=nr._heuristic_structure,
    )
    assert res.winners_by_party == {}
    assert res.confidence < 0.5


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_race_ambiguous_conflicting_answer_returns_empty():
    """Conflicting / ambiguous signals must not produce a confident winner.

    If the answer mentions multiple possible winners without clarity, the
    conservative parser should return empty winners and low confidence.
    """
    answer = (
        "Some sources indicate Alice may have won, while others suggest Bob leads. "
        "The race outcome remains unclear as of this report."
    )
    res = await nr.resolve_race(
        state="TX",
        office="H",
        district="07",
        parties=["REP"],
        date="2026-03-03",
        search_fn=_fake_search(answer),
        structure_fn=nr._heuristic_structure,
    )
    # Must not confidently name a winner when the answer is contradictory
    assert res.confidence < 0.5


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_race_empty_answer_returns_empty_winners():
    """Empty or whitespace-only answer must yield empty winners + zero confidence."""
    res = await nr.resolve_race(
        state="GA",
        office="H",
        district="07",
        parties=["DEM", "REP"],
        date="2026-05-19",
        search_fn=_fake_search(""),
        structure_fn=nr._heuristic_structure,
    )
    assert res.winners_by_party == {}
    assert res.confidence == 0.0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_race_only_lowercase_names_not_matched():
    """Names that are all-lowercase should not be matched (likely not proper nouns).

    The regex requires a capital first letter on each name token, so a parser
    fooled by lowercase fragments must not return a winner.
    """
    answer = "The republican primary was won by jane doe."
    res = await nr.resolve_race(
        state="GA",
        office="H",
        district="07",
        parties=["REP"],
        date="2026-05-19",
        search_fn=_fake_search(answer),
        structure_fn=nr._heuristic_structure,
    )
    # lowercase-only names → no match → empty winners
    assert res.winners_by_party == {}


# ---------------------------------------------------------------------------
# Adversarial: negated / speculative "won by" phrasing must NOT name a winner
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.parametrize(
    "answer",
    [
        "The Republican primary was NOT won by Jane Doe.",
        "The Democratic primary could be won by John Roe.",
        "The Republican seat is expected to be won by Tom Smith.",
        "Although the Republican race was not officially won by John Doe, counting continues.",
    ],
)
def test_heuristic_rejects_negated_and_speculative_phrasing(answer):
    """Negation/modal/speculative markers between party and 'won by' → empty.

    These are plausible Perplexity phrasings when the result is uncertain.
    The conservative contract requires they all yield NO winner, never a
    confident-but-wrong fabrication.
    """
    assert nr._heuristic_structure(answer, ["DEM", "REP"]) == {}


@pytest.mark.unit
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "answer",
    [
        "The Republican primary was NOT won by Jane Doe.",
        "The Democratic primary could be won by John Roe.",
        "The Republican seat is expected to be won by Tom Smith.",
        "Although the Republican race was not officially won by John Doe, counting continues.",
    ],
)
async def test_resolve_race_rejects_negated_and_speculative(answer):
    """End-to-end: negated/speculative answers → empty winners + confidence 0.0."""
    res = await nr.resolve_race(
        state="GA",
        office="H",
        district="07",
        parties=["DEM", "REP"],
        date="2026-05-19",
        search_fn=_fake_search(answer),
        structure_fn=nr._heuristic_structure,
    )
    assert res.winners_by_party == {}
    assert res.confidence == 0.0


@pytest.mark.unit
def test_heuristic_positive_control_still_extracts_winner():
    """Regression guard: a clean affirmative phrasing must still parse a winner."""
    answer = "The Republican primary was won by Jane Doe."
    assert nr._heuristic_structure(answer, ["REP"]) == {"REP": "Jane Doe"}


# ---------------------------------------------------------------------------
# sources pass-through
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_resolve_race_sources_contain_expected_keys():
    """Sources returned must have at least 'url' and 'title' keys."""
    answer = "The Republican primary was won by Jane Doe."
    custom_sources = [
        {"url": "https://apnews.com/elections/ga", "title": "AP Results", "date": "2026-05-20"},
    ]
    res = await nr.resolve_race(
        state="GA",
        office="H",
        district="07",
        parties=["REP"],
        date="2026-05-19",
        search_fn=_fake_search(answer, sources=custom_sources),
        structure_fn=nr._heuristic_structure,
    )
    assert len(res.sources) == 1
    assert res.sources[0]["url"] == "https://apnews.com/elections/ga"
    assert res.sources[0]["title"] == "AP Results"
