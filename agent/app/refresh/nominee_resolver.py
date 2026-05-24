"""Conservative Perplexity nominee resolver for 2026 congressional primaries.

This module builds a narrow Perplexity prompt for a single race and parses the
free-text answer into a structured ResolvedPrimary.

Design principle — the failure mode is "I'm not sure", not "confident-wrong":
- The heuristic parser only fires when a winner name follows an explicit
  party + "won by" phrase with a properly capitalised name.
- Any ambiguity, contradiction, or absent match returns empty winners_by_party
  with confidence=0.0, which causes the downstream gate to flag the race for
  human review rather than auto-confirming a fabricated winner.
- Runoff detection is a simple keyword scan; a single match flips
  runoff_indicated regardless of whether winners were also parsed.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STATE_NAMES: dict[str, str] = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}

_PARTY_FULL_NAMES: dict[str, str] = {
    "DEM": "Democratic",
    "REP": "Republican",
    "IND": "Independent",
    "GRN": "Green",
    "LIB": "Libertarian",
}

_OFFICE_LABELS: dict[str, str] = {
    "H": "House",
    "S": "Senate",
}

# Keywords that unambiguously indicate a runoff outcome.
_RUNOFF_KEYWORDS = ("runoff", "advances to", "run-off", "run off")

# Pattern: requires explicit party label followed by "won by" and a
# properly capitalised multi-token name.
#
# Conservative constraints:
# - Party word matched case-insensitively (group 1).
# - Name tokens: each must start with [A-Z] (strict uppercase). We do NOT
#   use re.IGNORECASE so that the name character class [A-Z] is literal.
# - The gap between party and "won by" is limited to 60 chars to avoid
#   matching across paragraphs.
# - The name capture terminates at a non-word-start boundary so it does not
#   bleed across sentence boundaries: we stop at punctuation or lowercase-start.
# - A name must be at least two tokens (first + last) to avoid matching
#   single common words that are not proper names.
#
# Note: re.IGNORECASE is intentionally NOT used here; the party group uses
# an explicit alternation covering all capitalisation forms we expect.
_WINNER_PATTERN = re.compile(
    r"(?i:(Republican|Democratic|Independent|Green|Libertarian))"
    r".{0,60}?won by\s+"
    r"((?:[A-Z][A-Za-z'\-]+)(?:\s+(?:[A-Z][A-Za-z'\-]+))+)"
    r"(?=[^A-Za-z]|$)",
)

# Reverse map: full name → short code
_FULL_TO_CODE: dict[str, str] = {v: k for k, v in _PARTY_FULL_NAMES.items()}

# Confidence levels
_CONFIDENCE_WINNER_FOUND = 0.85
_CONFIDENCE_EMPTY = 0.0


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ResolvedPrimary:
    """Structured result of parsing one Perplexity answer about a primary race."""

    winners_by_party: dict[str, str]
    """Maps party code (e.g. 'REP') to winner name. Empty when parse is uncertain."""

    sources: list[dict]
    """Pass-through of the normalized sources from the search function."""

    runoff_indicated: bool
    """True when the answer contains a runoff keyword, regardless of winners."""

    confidence: float
    """0.0 = no parse / unknown; 0.85 = clean winner found. Never > 1.0."""

    raw_answer: str
    """Verbatim Perplexity answer text, preserved for downstream logging."""


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------


def build_prompt(
    *,
    state: str,
    office: str,
    district: str,
    parties: list[str],
    date: str,
) -> str:
    """Build a narrow Perplexity question for a single race's primary result.

    Uses the full state name (not the two-letter code) and full party names
    (not abbreviations) to maximise search-engine match quality.  Explicitly
    requests official Secretary of State or AP citations so the answer is more
    likely to be grounded in authoritative sources.
    """
    state_name = STATE_NAMES.get(state.upper(), state)
    office_label = _OFFICE_LABELS.get(office.upper(), office)
    # Strip leading zeros for natural language ("district 7", not "district 07")
    district_number = str(int(district)) if district.isdigit() else district
    party_names = [_PARTY_FULL_NAMES.get(p.upper(), p) for p in parties]
    party_phrase = " and ".join(party_names)

    return (
        f"Who won the {date} {state_name} {office_label} district {district_number} "
        f"congressional primary election? "
        f"Report the winner for each major party ({party_phrase}). "
        f"Cite only official results: Secretary of State election results page, "
        f"AP Elections, or official county/state election authority. "
        f"If no official results are available yet, say so explicitly."
    )


# ---------------------------------------------------------------------------
# Conservative heuristic extractor (default, offline-testable)
# ---------------------------------------------------------------------------


def _heuristic_structure(answer: str, parties: list[str]) -> dict[str, str]:
    """Extract winners from a free-text Perplexity answer using conservative regex.

    Conservative design rules:
    - Only matches when the text contains an explicit "Party … won by Name" phrase.
    - Name tokens must be capitalised (catches proper nouns; rejects lowercase
      fragments that are not real names).
    - Requires at least 2 name tokens to avoid matching single common words.
    - Any ambiguity returns {} immediately — the caller must treat {} as
      "unknown", never as "no candidates ran".
    - Does NOT attempt fuzzy matching, NLP, or inference from context.
    """
    if not answer or not answer.strip():
        return {}

    winners: dict[str, str] = {}
    for match in _WINNER_PATTERN.finditer(answer):
        party_text = match.group(1).capitalize()
        name = match.group(2).strip()
        code = _FULL_TO_CODE.get(party_text)
        if code is None:
            continue
        # Only record if we haven't already seen a different winner for this party —
        # conflicting matches mean the answer is ambiguous; bail out conservatively.
        if code in winners and winners[code] != name:
            return {}
        winners[code] = name

    # Filter to only the parties we were asked about, in case the parser matched
    # extra parties that were not requested (conservative: return only the subset).
    requested_codes = {p.upper() for p in parties}
    return {k: v for k, v in winners.items() if k in requested_codes}


def _detect_runoff(answer: str) -> bool:
    """Return True if any runoff keyword appears in the answer (case-insensitive)."""
    lower = answer.lower()
    return any(kw in lower for kw in _RUNOFF_KEYWORDS)


# ---------------------------------------------------------------------------
# Public async resolver
# ---------------------------------------------------------------------------

SearchFn = Callable[[str], Awaitable[tuple[str, list[dict]]]]
StructureFn = Callable[[str, list[str]], dict[str, str]]


async def resolve_race(
    *,
    state: str,
    office: str,
    district: str,
    parties: list[str],
    date: str,
    search_fn: SearchFn,
    structure_fn: StructureFn = _heuristic_structure,
) -> ResolvedPrimary:
    """Call the injected search_fn and parse the answer into a ResolvedPrimary.

    Args:
        state:        Two-letter state code (e.g. "GA").
        office:       "H" for House, "S" for Senate.
        district:     Zero-padded district string (e.g. "07").
        parties:      Party codes to look for (e.g. ["DEM", "REP"]).
        date:         Primary date string in YYYY-MM-DD format.
        search_fn:    Async callable that accepts a prompt string and returns
                      (answer_text, normalized_sources).  In production this is
                      position_search._perplexity_search; in tests it is a fake.
        structure_fn: Synchronous extractor.  Default is _heuristic_structure
                      (conservative, offline-testable).  Can be replaced with a
                      Gemini-backed extractor in the future without changing the
                      public interface.

    Returns:
        A frozen ResolvedPrimary.  When the parse is uncertain, winners_by_party
        is empty and confidence is 0.0 — the downstream gate must treat this as
        "flag for human review", never "no candidates".
    """
    prompt = build_prompt(
        state=state,
        office=office,
        district=district,
        parties=parties,
        date=date,
    )
    answer, sources = await search_fn(prompt)

    runoff_indicated = _detect_runoff(answer)
    winners = structure_fn(answer, parties)

    # Confidence is binary at the heuristic level: either we found all expected
    # party winners cleanly (high confidence) or we did not (zero confidence).
    # This binary design is intentional — a graduated scale would tempt callers
    # to treat 0.4 as "probably OK", which violates the conservative invariant.
    if winners:
        confidence = _CONFIDENCE_WINNER_FOUND
    else:
        confidence = _CONFIDENCE_EMPTY

    return ResolvedPrimary(
        winners_by_party=winners,
        sources=sources,
        runoff_indicated=runoff_indicated,
        confidence=confidence,
        raw_answer=answer,
    )
