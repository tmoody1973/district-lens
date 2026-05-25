"""Unit tests for the NBC Decision-Desk results client + confirm decider.

NBC's firecracker `state-results` JSON API is the PRIMARY results source for
nominee confirmation: structured `isWinner` data, so no LLM prose parsing and
no hallucination risk. Fixtures in tests/unit/fixtures/nbc/ are trimmed real
API responses captured 2026-05-25.

Confirm policy (locked with Tarik 2026-05-25):
  - NBC called/uncontested result is confirm-grade on its own.
  - A district race confirms when isWinner AND (callStatus=="P" OR
    percent_in >= 95 with a clear margin) OR it is uncontested (sole candidate).
  - isWinner alone (e.g. at 0% in for a CONTESTED race) NEVER confirms.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from app.refresh import nbc_results as nbc

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "nbc"


def _load(slug: str) -> dict:
    return json.loads((FIXTURES / f"{slug}.json").read_text())


# ---------------------------------------------------------------------------
# Fake async HTTP client (mirrors citation_fetch test conventions)
# ---------------------------------------------------------------------------


class _FakeResp:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict:
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class _FakeClient:
    """Async context-manager client returning a canned response (or raising)."""

    def __init__(self, *, resp: _FakeResp | None = None, raise_exc: Exception | None = None):
        self._resp = resp
        self._raise = raise_exc

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url: str):
        if self._raise is not None:
            raise self._raise
        return self._resp


# ---------------------------------------------------------------------------
# Phase A — slug builder + race_id parser
# ---------------------------------------------------------------------------


def test_build_page_slug_house_strips_leading_zero():
    assert nbc.build_page_slug(state="GA", office="H", district="07") == (
        "georgia-us-house-district-7-results"
    )


def test_build_page_slug_house_idaho_district_1():
    assert nbc.build_page_slug(state="ID", office="H", district="01") == (
        "idaho-us-house-district-1-results"
    )


def test_build_page_slug_senate_ignores_district():
    assert nbc.build_page_slug(state="KY", office="S", district="00") == (
        "kentucky-senate-results"
    )


def test_parse_race_id_house():
    p = nbc.parse_race_id("2026-05-19R~ID001~H")
    assert p.date == "2026-05-19"
    assert p.party_code == "REP"
    assert p.state == "ID"
    assert p.district == "01"
    assert p.office == "H"


def test_parse_race_id_senate_has_no_district():
    p = nbc.parse_race_id("2026-05-19D~AL~S")
    assert p.party_code == "DEM"
    assert p.state == "AL"
    assert p.office == "S"
    assert p.district == "00"


# ---------------------------------------------------------------------------
# Phase A — fetch + parse
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_parses_idaho_house_1_winners():
    client = _FakeClient(resp=_FakeResp(200, _load("idaho-us-house-district-1-results")))
    races = await nbc.fetch_nbc_results("idaho-us-house-district-1-results", client_factory=client)
    assert races is not None and len(races) == 2
    by_party = {r.party_code: r for r in races}
    rep_winner = next(c for c in by_party["REP"].candidates if c.is_winner)
    dem_winner = next(c for c in by_party["DEM"].candidates if c.is_winner)
    assert rep_winner.full_name == "Russ Fulcher"
    assert dem_winner.full_name == "Kaylee Peterson"
    assert by_party["REP"].percent_in == 99


@pytest.mark.asyncio
async def test_fetch_returns_none_on_404():
    client = _FakeClient(resp=_FakeResp(404, text="not found"))
    assert await nbc.fetch_nbc_results("nope", client_factory=client) is None


@pytest.mark.asyncio
async def test_fetch_returns_none_on_exception():
    client = _FakeClient(raise_exc=TimeoutError("boom"))
    assert await nbc.fetch_nbc_results("x", client_factory=client) is None


# ---------------------------------------------------------------------------
# Phase B — confirm decider
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_decide_seat_called_idaho_1():
    races = await nbc.fetch_nbc_results(
        "idaho-us-house-district-1-results",
        client_factory=_FakeClient(resp=_FakeResp(200, _load("idaho-us-house-district-1-results"))),
    )
    decision = nbc.decide_seat(races)
    assert decision.status == nbc.NBC_CONFIRMABLE
    assert decision.winners_by_party == {"REP": "Russ Fulcher", "DEM": "Kaylee Peterson"}
    assert decision.is_runoff is False


def test_decide_party_race_called_high_percent_clear_margin():
    race = nbc.NbcRaceResult(
        race_id="2026-05-19R~XX001~H", party_code="REP", state="XX", office="H",
        district="01", percent_in=99.0, call_status=None, is_runoff=False,
        candidates=(
            nbc.NbcCandidate("Ada", "Lovelace", "gop", 70.0, True, False),
            nbc.NbcCandidate("Bob", "Loser", "gop", 30.0, False, False),
        ),
    )
    status, winner = nbc.decide_party_race(race)
    assert status == nbc.NBC_CALLED
    assert winner == "Ada Lovelace"


def test_decide_party_race_uncontested_confirms_at_zero_in():
    race = nbc.NbcRaceResult(
        race_id="2026-05-19D~XX006~H", party_code="DEM", state="XX", office="H",
        district="06", percent_in=0.0, call_status=None, is_runoff=False,
        candidates=(nbc.NbcCandidate("Sole", "Runner", "dem", 0.0, True, True),),
    )
    status, winner = nbc.decide_party_race(race)
    assert status == nbc.NBC_UNCONTESTED
    assert winner == "Sole Runner"


def test_decide_party_race_contested_winner_at_zero_in_is_insufficient():
    """CIVIC-SAFETY (ISC-A2): isWinner at 0% in for a CONTESTED race must NOT confirm."""
    race = nbc.NbcRaceResult(
        race_id="2026-05-19R~XX008~H", party_code="REP", state="XX", office="H",
        district="08", percent_in=0.0, call_status=None, is_runoff=False,
        candidates=(
            nbc.NbcCandidate("Pre", "Sumptive", "gop", 0.0, True, True),
            nbc.NbcCandidate("Other", "Challenger", "gop", 0.0, False, False),
        ),
    )
    status, winner = nbc.decide_party_race(race)
    assert status == nbc.NBC_INSUFFICIENT
    assert winner is None


def test_decide_party_race_close_margin_is_insufficient():
    race = nbc.NbcRaceResult(
        race_id="2026-05-19R~XX002~H", party_code="REP", state="XX", office="H",
        district="02", percent_in=99.0, call_status=None, is_runoff=False,
        candidates=(
            nbc.NbcCandidate("Near", "Winner", "gop", 50.2, True, False),
            nbc.NbcCandidate("Close", "Second", "gop", 49.8, False, False),
        ),
    )
    status, _ = nbc.decide_party_race(race)
    assert status == nbc.NBC_INSUFFICIENT


def test_decide_party_race_winner_flag_not_leader_is_insufficient():
    """CIVIC-SAFETY: if NBC's isWinner is NOT the actual vote leader (data anomaly),
    refuse to confirm — the margin must be measured from the winner we'd vouch for."""
    race = nbc.NbcRaceResult(
        race_id="2026-05-19R~XX004~H", party_code="REP", state="XX", office="H",
        district="04", percent_in=99.0, call_status=None, is_runoff=False,
        candidates=(
            nbc.NbcCandidate("Flagged", "Winner", "gop", 30.0, True, False),
            nbc.NbcCandidate("Actual", "Leader", "gop", 70.0, False, False),
        ),
    )
    status, winner = nbc.decide_party_race(race)
    assert status == nbc.NBC_INSUFFICIENT
    assert winner is None


def test_decide_party_race_callstatus_p_confirms_outright():
    race = nbc.NbcRaceResult(
        race_id="2026-05-19R~XX~S", party_code="REP", state="XX", office="S",
        district="00", percent_in=40.0, call_status="P", is_runoff=False,
        candidates=(
            nbc.NbcCandidate("Called", "Early", "gop", 55.0, True, True),
            nbc.NbcCandidate("Trailing", "Two", "gop", 45.0, False, False),
        ),
    )
    status, winner = nbc.decide_party_race(race)
    assert status == nbc.NBC_CALLED
    assert winner == "Called Early"


def test_decide_party_race_runoff():
    race = nbc.NbcRaceResult(
        race_id="2026-05-19R~XX003~H", party_code="REP", state="XX", office="H",
        district="03", percent_in=99.0, call_status=None, is_runoff=True,
        candidates=(
            nbc.NbcCandidate("First", "Place", "gop", 40.0, False, False),
            nbc.NbcCandidate("Second", "Place", "gop", 35.0, False, False),
        ),
    )
    status, _ = nbc.decide_party_race(race)
    assert status == nbc.NBC_RUNOFF


def test_decide_seat_runoff_when_any_party_runoff():
    races = [
        nbc.NbcRaceResult(
            race_id="2026-05-19R~XX003~H", party_code="REP", state="XX", office="H",
            district="03", percent_in=99.0, call_status=None, is_runoff=True,
            candidates=(nbc.NbcCandidate("A", "B", "gop", 40.0, False, False),),
        ),
    ]
    decision = nbc.decide_seat(races)
    assert decision.is_runoff is True
    assert decision.status == nbc.NBC_RUNOFF


def test_decide_seat_insufficient_when_no_party_confirmable():
    races = [
        nbc.NbcRaceResult(
            race_id="2026-05-19R~XX008~H", party_code="REP", state="XX", office="H",
            district="08", percent_in=10.0, call_status=None, is_runoff=False,
            candidates=(
                nbc.NbcCandidate("Lead", "Er", "gop", 51.0, True, False),
                nbc.NbcCandidate("Trail", "Er", "gop", 49.0, False, False),
            ),
        ),
    ]
    decision = nbc.decide_seat(races)
    assert decision.status == nbc.NBC_INSUFFICIENT
    assert decision.winners_by_party == {}
