from unittest.mock import MagicMock, patch

from app.tools import mongodb_tools


def _summary_doc():
    return {
        "member_name": "Jane Rep", "congress": 119,
        "attendance_pct": 97.5, "party_line_pct": 92.0,
        "votes_cast": 390, "votes_missed": 10, "total_roll_calls": 400,
        "as_of_date": "2026-05-20",
        "source_url": "https://www.congress.gov/roll-call-votes/119-2",
    }


def test_to_voting_record_camelcase():
    out = mongodb_tools._to_voting_record(_summary_doc())
    assert out["memberName"] == "Jane Rep"
    assert out["attendancePct"] == 97.5
    assert out["partyLinePct"] == 92.0
    assert out["congress"] == "119th"


def test_get_voting_record_pushes_state_and_returns_success():
    fake_db = MagicMock()
    fake_db.voting_record_summaries.find_one.return_value = _summary_doc()
    ctx = MagicMock()
    ctx.state = {}
    with patch.object(mongodb_tools, "_get_db", return_value=fake_db):
        res = mongodb_tools.get_voting_record("2026-H-WI-04", ctx)
    assert res["status"] == "success"
    assert ctx.state["votingRecord"]["attendancePct"] == 97.5


def test_get_voting_record_not_found_when_no_summary():
    fake_db = MagicMock()
    fake_db.voting_record_summaries.find_one.return_value = None
    ctx = MagicMock()
    ctx.state = {}
    with patch.object(mongodb_tools, "_get_db", return_value=fake_db):
        res = mongodb_tools.get_voting_record("2026-H-WI-04", ctx)
    assert res["status"] == "not_found"
    assert "votingRecord" not in ctx.state


def test_get_voting_record_null_party_line_is_honest_gap():
    summary = _summary_doc()
    summary["party_line_pct"] = None  # no party-split votes yet
    fake_db = MagicMock()
    fake_db.voting_record_summaries.find_one.return_value = summary
    ctx = MagicMock()
    ctx.state = {}
    with patch.object(mongodb_tools, "_get_db", return_value=fake_db):
        res = mongodb_tools.get_voting_record("2026-H-WI-04", ctx)
    assert res["status"] == "success"
    assert ctx.state["votingRecord"]["partyLinePct"] is None
    assert any(
        "Not enough party-split votes" in warning for warning in res["warnings"]
    )
