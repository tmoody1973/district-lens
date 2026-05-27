import json
from pathlib import Path

from scripts.ingest_house_votes import _parse_members, aggregate_vote

FIXTURE = Path(__file__).parent / "fixtures" / "house_vote_members_sample.json"


def test_parse_members_returns_bioguide_position_party():
    payload = json.loads(FIXTURE.read_text())
    members = _parse_members(payload)
    assert len(members) > 100
    sample = members[0]
    assert set(sample) >= {"bioguide_id", "position", "party"}
    valid_positions = {"Yea", "Nay", "Present", "Not Voting"}
    assert all(member["position"] in valid_positions for member in members)


def test_aggregate_vote_computes_party_majorities_and_split():
    members = [
        {"bioguide_id": "D1", "position": "Yea", "party": "DEM"},
        {"bioguide_id": "D2", "position": "Yea", "party": "DEM"},
        {"bioguide_id": "R1", "position": "Nay", "party": "REP"},
        {"bioguide_id": "R2", "position": "Nay", "party": "REP"},
    ]
    agg = aggregate_vote(members)
    assert agg["dem_majority"] == "Yea"
    assert agg["rep_majority"] == "Nay"
    assert agg["party_split"] is True


def test_aggregate_vote_not_split_when_parties_agree():
    members = [
        {"bioguide_id": "D1", "position": "Yea", "party": "DEM"},
        {"bioguide_id": "R1", "position": "Yea", "party": "REP"},
    ]
    agg = aggregate_vote(members)
    assert agg["party_split"] is False
