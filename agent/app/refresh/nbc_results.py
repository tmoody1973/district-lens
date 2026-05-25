"""NBC Decision-Desk structured results client + confirm decider.

The PRIMARY results source for nominee confirmation. NBC's "Decision 2026" app
exposes a public JSON API the site itself uses:

    https://www.nbcnews.com/firecracker/api/v2/state-results/2026-primary-elections/{slug}

Each race object carries a structured `isWinner` flag per candidate, so winners
come from data — never from LLM prose. That eliminates the hallucination risk
that makes Perplexity unsafe for auto-confirm (an LLM can confidently report a
wrong winner; a boolean field cannot).

Two responsibilities:
  - fetch + parse the per-seat results (`fetch_nbc_results`)
  - decide whether a party's winner is confirm-grade (`decide_party_race`,
    `decide_seat`) using the locked policy below.

Confirm policy (locked with Tarik 2026-05-25):
  - An NBC called/uncontested result is confirm-grade on its own (Decision Desk
    is NEP/AP-grade race-call data).
  - A district race confirms when a candidate isWinner AND (callStatus == "P"
    OR percent_in >= PERCENT_IN_THRESHOLD with a margin >= MARGIN_THRESHOLD),
    OR it is uncontested (a sole candidate).
  - isWinner alone NEVER confirms a CONTESTED race (NBC sets isWinner even at
    0% reporting for presumptive/uncontested winners).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from app.refresh.nominee_resolver import STATE_NAMES

logger = logging.getLogger(__name__)

NBC_API_BASE = (
    "https://www.nbcnews.com/firecracker/api/v2/state-results/2026-primary-elections"
)

# Confirm thresholds (locked policy).
PERCENT_IN_THRESHOLD = 95.0
MARGIN_THRESHOLD = 1.0  # percentage-point gap between the top two candidates

# NBC race-call status: "P" = projected/called, "O" = open (uncalled). Often null
# on district races, which is why percent_in + margin carry the district decision.
_CALL_STATUS_CALLED = "P"

# Party letter in the raceId ("2026-05-19R~ID001~H") → our canonical party code.
_RACEID_PARTY_TO_CODE: dict[str, str] = {
    "R": "REP",
    "D": "DEM",
    "L": "LIB",
    "G": "GRN",
    "I": "IND",
}

# Per-party-race outcome tags.
NBC_CALLED = "called"
NBC_UNCONTESTED = "uncontested"
NBC_RUNOFF = "runoff"
NBC_INSUFFICIENT = "insufficient"

# Seat-level outcome tags.
NBC_CONFIRMABLE = "confirmable"  # at least one party called/uncontested, no runoff


_HEADERS = {
    "User-Agent": (
        "DistrictLens/1.0 (+https://github.com/districtlens) civic-data-bot"
    ),
    "Accept": "application/json,*/*;q=0.8",
}
_TIMEOUT_SECONDS = 30.0


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParsedRaceId:
    date: str
    party_code: str
    state: str
    district: str
    office: str


@dataclass(frozen=True)
class NbcCandidate:
    first_name: str
    last_name: str
    party: str
    percent_vote: float
    is_winner: bool
    is_incumbent: bool

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


@dataclass(frozen=True)
class NbcRaceResult:
    race_id: str
    party_code: str
    state: str
    office: str
    district: str
    percent_in: float
    call_status: str | None
    is_runoff: bool
    candidates: tuple[NbcCandidate, ...]


@dataclass(frozen=True)
class NbcSeatDecision:
    status: str
    winners_by_party: dict[str, str]
    is_runoff: bool
    reason: str


# ---------------------------------------------------------------------------
# Slug + raceId
# ---------------------------------------------------------------------------


def _state_slug(state: str) -> str:
    """Return the NBC URL slug for a state code ('ID' -> 'idaho')."""
    name = STATE_NAMES.get(state.upper(), state)
    return name.lower().replace(" ", "-")


def build_page_slug(*, state: str, office: str, district: str) -> str:
    """Build the NBC results page slug for a single seat.

    House: '{state}-us-house-district-{N}-results' (leading zeros stripped).
    Senate: '{state}-senate-results'.
    """
    slug = _state_slug(state)
    if office.upper() == "S":
        return f"{slug}-senate-results"
    district_number = int(district) if str(district).strip().isdigit() else district
    return f"{slug}-us-house-district-{district_number}-results"


def parse_race_id(race_id: str) -> ParsedRaceId:
    """Parse an NBC raceId like '2026-05-19R~ID001~H' into its components.

    The dedicated state/office fields are null on district race objects, so the
    raceId is the source of truth for party, state, district, and office.
    """
    head, locus, office = race_id.split("~")
    date = head[:10]
    party_letter = head[10:]
    party_code = _RACEID_PARTY_TO_CODE.get(party_letter, party_letter)

    state = "".join(ch for ch in locus if ch.isalpha())
    digits = "".join(ch for ch in locus if ch.isdigit())
    district = f"{int(digits):02d}" if digits else "00"

    return ParsedRaceId(
        date=date,
        party_code=party_code,
        state=state,
        district=district,
        office=office,
    )


# ---------------------------------------------------------------------------
# Fetch + parse
# ---------------------------------------------------------------------------


def _find_race_objects(payload: object) -> list[dict]:
    """Recursively collect every dict that looks like a race (has raceId + candidates)."""
    found: list[dict] = []
    if isinstance(payload, dict):
        if "raceId" in payload and "candidates" in payload:
            found.append(payload)
        for value in payload.values():
            found.extend(_find_race_objects(value))
    elif isinstance(payload, list):
        for item in payload:
            found.extend(_find_race_objects(item))
    return found


def _parse_candidate(raw: dict) -> NbcCandidate:
    return NbcCandidate(
        first_name=raw.get("firstName", "") or "",
        last_name=raw.get("lastName", "") or "",
        party=raw.get("party", "") or "",
        percent_vote=float(raw.get("percentVote") or 0.0),
        is_winner=bool(raw.get("isWinner")),
        is_incumbent=bool(raw.get("isIncumbent")),
    )


def _parse_race(raw: dict) -> NbcRaceResult:
    parsed = parse_race_id(raw["raceId"])
    return NbcRaceResult(
        race_id=raw["raceId"],
        party_code=parsed.party_code,
        state=parsed.state,
        office=parsed.office,
        district=parsed.district,
        percent_in=float(raw.get("percentIn") or 0.0),
        call_status=raw.get("callStatus"),
        is_runoff=bool(raw.get("isRunoff")),
        candidates=tuple(_parse_candidate(c) for c in (raw.get("candidates") or [])),
    )


async def fetch_nbc_results(
    slug: str,
    *,
    client_factory=httpx.AsyncClient,
) -> list[NbcRaceResult] | None:
    """GET the NBC state-results API for one seat slug and parse the race objects.

    Returns the parsed races on HTTP 200, or None on non-200, timeout, or any
    error — a missing feed must flag the race, never crash the batch.
    """
    url = f"{NBC_API_BASE}/{slug}"
    try:
        async with client_factory(timeout=_TIMEOUT_SECONDS, headers=_HEADERS) as client:
            response = await client.get(url)
        if response.status_code != 200:
            logger.warning("fetch_nbc_results: non-200 for %s (%d)", url, response.status_code)
            return None
        payload = response.json()
    except Exception as exc:
        logger.warning("fetch_nbc_results: error for %s: %s", url, exc)
        return None
    return [_parse_race(obj) for obj in _find_race_objects(payload)]


def results_url(slug: str) -> str:
    """The public NBC results page URL for a seat slug (used as the citation URL)."""
    parsed = urlparse(NBC_API_BASE)
    return f"{parsed.scheme}://{parsed.netloc}/politics/2026-primary-elections/{slug}"


# ---------------------------------------------------------------------------
# Confirm decider
# ---------------------------------------------------------------------------


def decide_party_race(race: NbcRaceResult) -> tuple[str, str | None]:
    """Decide whether one party's primary winner is confirm-grade.

    Returns (status, winner_name) where status is one of NBC_CALLED,
    NBC_UNCONTESTED, NBC_RUNOFF, NBC_INSUFFICIENT. winner_name is None unless
    the status is a confirmable one.
    """
    if race.is_runoff:
        return NBC_RUNOFF, None

    winners = [c for c in race.candidates if c.is_winner]
    if not winners:
        return NBC_INSUFFICIENT, None
    winner = winners[0]
    winner_name = winner.full_name

    # Uncontested: a sole candidate is the nominee regardless of reporting.
    if len(race.candidates) == 1:
        return NBC_UNCONTESTED, winner_name

    # An explicit NBC race call is confirm-grade on its own.
    if race.call_status == _CALL_STATUS_CALLED:
        return NBC_CALLED, winner_name

    # District races: require near-complete reporting AND a clear margin — measured
    # from the isWinner candidate to the best OTHER candidate. If the isWinner flag
    # is not actually the vote leader (a data anomaly), the margin goes non-positive
    # and we refuse to confirm rather than vouch for an unverified name.
    others = [c.percent_vote for c in race.candidates if c is not winner]
    best_other = max(others) if others else 0.0
    margin = winner.percent_vote - best_other
    if race.percent_in >= PERCENT_IN_THRESHOLD and margin >= MARGIN_THRESHOLD:
        return NBC_CALLED, winner_name

    return NBC_INSUFFICIENT, None


def decide_seat(races: list[NbcRaceResult]) -> NbcSeatDecision:
    """Combine the per-party race decisions for one seat into a seat decision."""
    winners_by_party: dict[str, str] = {}
    any_runoff = False
    reasons: list[str] = []

    for race in races:
        status, winner = decide_party_race(race)
        reasons.append(f"{race.party_code}:{status}")
        if status == NBC_RUNOFF:
            any_runoff = True
        elif status in (NBC_CALLED, NBC_UNCONTESTED) and winner:
            winners_by_party[race.party_code] = winner

    if any_runoff:
        status = NBC_RUNOFF
    elif winners_by_party:
        status = NBC_CONFIRMABLE
    else:
        status = NBC_INSUFFICIENT

    return NbcSeatDecision(
        status=status,
        winners_by_party=winners_by_party,
        is_runoff=any_runoff,
        reason=", ".join(reasons),
    )
