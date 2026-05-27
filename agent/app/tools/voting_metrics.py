"""Pure voting-record math for House roll-call votes.

No I/O, no network — fed parsed positions, returns attendance % and
party-line %. party_line_pct is None (not 0) when a member has no
party-split Yea/Nay votes, so the brief can render an honest gap.
"""

from __future__ import annotations

from dataclasses import dataclass

_CAST = {"Yea", "Nay", "Present"}
_DECISIVE = {"Yea", "Nay"}


@dataclass(frozen=True)
class MemberVoteContext:
    """One member's situation on one roll call."""

    position: str  # "Yea" | "Nay" | "Present" | "Not Voting"
    own_party_majority: str  # that member's party's majority position
    party_split: bool  # did the two major parties' majorities differ?


def party_majority(positions: list[str]) -> str | None:
    """The majority Yea/Nay position among a party's members, or None."""
    yea = positions.count("Yea")
    nay = positions.count("Nay")
    if yea == 0 and nay == 0:
        return None
    return "Yea" if yea >= nay else "Nay"


def compute_metrics(contexts: list[MemberVoteContext]) -> dict:
    """Attendance % and party-line % for one member across many votes."""
    total = len(contexts)
    cast = sum(1 for c in contexts if c.position in _CAST)
    missed = total - cast
    attendance = round(100 * cast / total, 1) if total else 0.0

    eligible = [c for c in contexts if c.party_split and c.position in _DECISIVE]
    with_party = sum(1 for c in eligible if c.position == c.own_party_majority)
    party_line = round(100 * with_party / len(eligible), 1) if eligible else None

    return {
        "total_roll_calls": total,
        "votes_cast": cast,
        "votes_missed": missed,
        "attendance_pct": attendance,
        "party_line_eligible": len(eligible),
        "party_line_with_party": with_party,
        "party_line_pct": party_line,
    }
