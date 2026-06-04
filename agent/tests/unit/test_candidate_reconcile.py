"""Reconcile the FEC filing roster against NBC's actual ballot roster (Phase 2).

NBC's per-seat results are the real ballot (vote shares + winner). We prefer that
list and enrich each candidate with their FEC record (finance, photo, incumbency)
matched by last name + party — because the name FORMS differ (NBC "Steve
Marshall" vs FEC "Marshall, Steven T"). The real AL-Senate field is the fixture.
"""

from __future__ import annotations

import pytest

from app.tools.candidate_reconcile import reconcile_roster

# FEC candidates for AL Senate (status C). Note: Tuberville is FEC-active but NOT
# on NBC's ballot (he's running for Governor); "Dale Deas" is on NBC but has no
# FEC record.
FEC = [
    {"candidate_id": "S6AL00476", "name": "Moore, Felix Barry", "party": "REP",
     "incumbent_challenge_status": "open_seat", "fec_status": "C"},
    {"candidate_id": "S6AL00450", "name": "Marshall, Steven T", "party": "REP",
     "incumbent_challenge_status": "open_seat", "fec_status": "C"},
    {"candidate_id": "S6AL00484", "name": "Murphy, Morgan W. W.", "party": "REP",
     "incumbent_challenge_status": "open_seat", "fec_status": "C"},
    {"candidate_id": "S0AL00230", "name": "Tuberville, Thomas H", "party": "REP",
     "incumbent_challenge_status": "incumbent", "fec_status": "C"},
    {"candidate_id": "S6AL00518", "name": "Wess, Everett W", "party": "DEM",
     "incumbent_challenge_status": "challenger", "fec_status": "C"},
]

# NBC's actual GOP + DEM primary ballot (subset), with results.
NBC = [
    {"name": "Barry Moore", "party": "gop", "percent_vote": 39.2, "is_winner": True},
    {"name": "Steve Marshall", "party": "gop", "percent_vote": 24.5, "is_winner": False},
    {"name": "Morgan Murphy", "party": "gop", "percent_vote": 1.3, "is_winner": False},
    {"name": "Dale Deas", "party": "gop", "percent_vote": 2.1, "is_winner": False},
    {"name": "Everett Wess", "party": "dem", "percent_vote": 39.6, "is_winner": False},
]


def _by_name(rows, fragment):
    return next(r for r in rows if fragment.lower() in r["name"].lower())


@pytest.mark.unit
def test_matches_by_last_name_and_party_despite_name_form():
    out = reconcile_roster(FEC, NBC)
    moore = _by_name(out, "moore")
    assert moore["candidate_id"] == "S6AL00476"  # matched FEC despite "Barry" vs "Felix Barry"
    marshall = _by_name(out, "marshall")
    assert marshall["candidate_id"] == "S6AL00450"  # "Steve" vs "Steven"


@pytest.mark.unit
def test_carries_vote_share_and_winner_flag():
    out = reconcile_roster(FEC, NBC)
    moore = _by_name(out, "moore")
    assert moore["vote_share"] == 39.2
    assert moore["is_primary_winner"] is True
    assert _by_name(out, "murphy")["is_primary_winner"] is False


@pytest.mark.unit
def test_fec_only_candidate_not_on_ballot_is_dropped():
    # Tuberville is FEC-active for Senate but not on NBC's ballot → dropped.
    out = reconcile_roster(FEC, NBC)
    assert all("tuberville" not in r["name"].lower() for r in out)


@pytest.mark.unit
def test_nbc_only_candidate_is_kept_without_fec_record():
    out = reconcile_roster(FEC, NBC)
    deas = _by_name(out, "deas")
    assert deas["candidate_id"] == ""  # no FEC match
    assert deas["party"] == "REP"  # normalized from "gop"
    assert deas["vote_share"] == 2.1
    assert deas["roster_source"] == "nbc"


@pytest.mark.unit
def test_matched_candidate_keeps_fec_enrichment():
    out = reconcile_roster(FEC, NBC)
    wess = _by_name(out, "wess")
    assert wess["candidate_id"] == "S6AL00518"
    assert wess["incumbent_challenge_status"] == "challenger"  # from FEC
    assert wess["roster_source"] == "nbc+fec"
