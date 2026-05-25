"""2026 primary calendar (FVAP source) + window selection.

Source: FVAP "2026 Primary Elections by state and territory"
https://www.fvap.gov/uploads/FVAP/VAO/PrimaryElectionsCalendar.pdf  (current as of 2026-05).
Territories (AS, GU, PR, VI) and DC delegate-only rows are omitted: no Senate/House
primary contest to resolve.
"""

from __future__ import annotations

import datetime as dt

_MAJORITY = "majority_50"
_NONE = "none"

# (state, primary M/D, runoff M/D or None, runoff_rule, has_senate, house_seats)
_RAW: list[tuple[str, tuple[int, int], tuple[int, int] | None, str, bool, int]] = [
    ("AL", (5, 19), (6, 16), _MAJORITY, True, 7),
    ("AK", (8, 18), None, _NONE, True, 1),
    ("AZ", (7, 21), None, _NONE, False, 9),
    ("AR", (3, 3), (3, 31), _MAJORITY, True, 4),
    ("CA", (6, 2), None, _NONE, False, 52),
    ("CO", (6, 30), None, _NONE, True, 8),
    ("CT", (8, 11), None, _NONE, False, 5),
    ("DE", (9, 15), None, _NONE, True, 1),
    ("FL", (8, 18), None, _NONE, True, 28),
    ("GA", (5, 19), (6, 16), _MAJORITY, True, 14),
    ("HI", (8, 8), None, _NONE, False, 2),
    ("ID", (5, 19), None, _NONE, True, 2),
    ("IL", (3, 17), None, _NONE, True, 17),
    ("IN", (5, 5), None, _NONE, False, 9),
    ("IA", (6, 2), None, _NONE, True, 4),
    ("KS", (8, 4), None, _NONE, True, 4),
    ("KY", (5, 19), None, _NONE, True, 6),
    ("LA", (5, 16), (6, 27), "la_specific", True, 6),
    ("ME", (6, 9), None, _NONE, True, 2),
    ("MD", (6, 23), None, _NONE, False, 8),
    ("MA", (9, 1), None, _NONE, True, 9),
    ("MI", (8, 4), None, _NONE, True, 13),
    ("MN", (8, 11), None, _NONE, True, 8),
    ("MS", (3, 10), (4, 7), _MAJORITY, True, 4),
    ("MO", (8, 4), None, _NONE, False, 8),
    ("MT", (6, 2), None, _NONE, True, 2),
    ("NE", (5, 12), None, _NONE, True, 3),
    ("NV", (6, 9), None, _NONE, False, 4),
    ("NH", (9, 8), None, _NONE, True, 2),
    ("NJ", (6, 2), None, _NONE, True, 12),
    ("NM", (6, 2), None, _NONE, True, 3),
    ("NY", (6, 23), None, _NONE, False, 26),
    ("NC", (3, 3), (5, 12), "nc_30_threshold", True, 14),
    ("ND", (6, 9), None, _NONE, False, 1),
    ("OH", (5, 5), None, _NONE, True, 15),
    ("OK", (6, 16), (8, 25), _MAJORITY, True, 5),
    ("OR", (5, 19), None, _NONE, True, 6),
    ("PA", (5, 19), None, _NONE, True, 17),
    ("RI", (9, 9), None, _NONE, True, 2),
    ("SC", (6, 9), (6, 23), _MAJORITY, True, 7),
    ("SD", (6, 2), None, _NONE, True, 1),
    ("TN", (8, 6), None, _NONE, True, 9),
    ("TX", (3, 3), (5, 26), _MAJORITY, True, 38),
    ("UT", (6, 23), None, _NONE, False, 4),
    ("VT", (8, 11), None, _NONE, False, 1),
    ("VA", (8, 4), None, _NONE, True, 11),
    ("WA", (8, 4), None, _NONE, False, 10),
    ("WV", (5, 12), None, _NONE, True, 2),
    ("WI", (8, 11), None, _NONE, False, 8),
    ("WY", (8, 18), None, _NONE, True, 1),
]

CYCLE = "2026"
SOURCE = "fvap_2026"
SOURCE_URL = "https://www.fvap.gov/uploads/FVAP/VAO/PrimaryElectionsCalendar.pdf"


def _d(md: tuple[int, int] | None) -> dt.date | None:
    return dt.date(2026, md[0], md[1]) if md else None


def _as_date(v: dt.date | dt.datetime | None) -> dt.date | None:
    """Normalize a date or datetime to date, returning None for None.

    MongoDB deserializes stored datetime fields as datetime.datetime objects.
    This helper makes comparison logic robust to both types.
    """
    if isinstance(v, dt.datetime):
        return v.date()
    return v


FVAP_2026_ROWS: list[dict] = [
    {
        "state": s,
        "cycle": CYCLE,
        "primary_date": _d(p),
        "runoff_date": _d(r),
        "runoff_rule": rule,
        "has_senate_race": sen,
        "house_seat_count": seats,
        "source": SOURCE,
        "source_url": SOURCE_URL,
    }
    for (s, p, r, rule, sen, seats) in _RAW
]


def states_with_closed_contest(
    rows: list[dict],
    *,
    today: dt.date | dt.datetime,
    window_days: int = 10,
) -> list[tuple[str, str, dt.date]]:
    """Return (state, contest_kind, contest_date) for primaries/runoffs that fell
    within the last `window_days` (inclusive, not in the future). Runoff takes
    precedence when both a state's primary and runoff are in-window.

    Accepts both ``datetime.date`` and ``datetime.datetime`` for ``today`` and
    for ``primary_date``/``runoff_date`` in each row. MongoDB deserializes stored
    datetime fields as ``datetime.datetime``; this function normalizes to
    ``datetime.date`` before comparison so callers never hit a TypeError.
    """
    today_date = _as_date(today)
    out: list[tuple[str, str, dt.date]] = []
    lo = today_date - dt.timedelta(days=window_days)
    for r in rows:
        chosen: tuple[str, dt.date] | None = None
        runoff_date = _as_date(r.get("runoff_date"))
        primary_date = _as_date(r.get("primary_date"))
        if runoff_date and lo <= runoff_date <= today_date:
            chosen = ("runoff", runoff_date)
        elif primary_date and lo <= primary_date <= today_date:
            chosen = ("primary", primary_date)
        if chosen:
            out.append((r["state"], chosen[0], chosen[1]))
    return out
