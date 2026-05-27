from app.tools.voting_metrics import MemberVoteContext, compute_metrics, party_majority


def test_party_majority_picks_higher_count():
    assert party_majority(["Yea", "Yea", "Nay"]) == "Yea"
    assert party_majority(["Nay", "Nay", "Yea"]) == "Nay"


def test_party_majority_none_when_no_votes():
    assert party_majority(["Not Voting", "Present"]) is None


def test_attendance_counts_present_as_cast_not_missed():
    ctxs = [
        MemberVoteContext("Yea", "Yea", True),
        MemberVoteContext("Present", "Yea", True),
        MemberVoteContext("Not Voting", "Nay", True),
    ]
    m = compute_metrics(ctxs)
    assert m["total_roll_calls"] == 3
    assert m["votes_cast"] == 2
    assert m["votes_missed"] == 1
    assert m["attendance_pct"] == 66.7


def test_party_line_only_counts_party_split_yea_nay_votes():
    ctxs = [
        MemberVoteContext("Yea", "Yea", True),
        MemberVoteContext("Nay", "Yea", True),
        MemberVoteContext("Yea", "Yea", False),
        MemberVoteContext("Present", "Yea", True),
    ]
    m = compute_metrics(ctxs)
    assert m["party_line_eligible"] == 2
    assert m["party_line_with_party"] == 1
    assert m["party_line_pct"] == 50.0


def test_party_line_is_none_when_no_eligible_votes():
    ctxs = [MemberVoteContext("Yea", "Yea", False)]
    m = compute_metrics(ctxs)
    assert m["party_line_pct"] is None
    assert m["party_line_eligible"] == 0
