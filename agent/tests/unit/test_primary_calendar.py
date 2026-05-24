"""Tests for primary_calendar seed rows and window selection."""

import datetime as dt

import pytest

from app.refresh import calendar


@pytest.mark.unit
def test_calendar_rows_well_formed():
    rows = calendar.FVAP_2026_ROWS
    # 50 states + DC + territories minus territory rows that have no primary.
    assert len(rows) >= 50
    runoff_states = {r["state"] for r in rows if r["runoff_date"]}
    assert runoff_states == {"AL", "AR", "GA", "LA", "MS", "NC", "OK", "SC", "TX"}
    for r in rows:
        assert isinstance(r["primary_date"], dt.date)
        assert r["runoff_rule"] in {"majority_50", "nc_30_threshold", "la_specific", "none"}
        assert (r["runoff_date"] is None) == (r["runoff_rule"] == "none")


@pytest.mark.unit
def test_states_with_closed_contest_selects_primary_in_window():
    rows = [
        {"state": "GA", "primary_date": dt.date(2026, 5, 19), "runoff_date": dt.date(2026, 6, 16)},
        {"state": "WI", "primary_date": dt.date(2026, 8, 11), "runoff_date": None},
    ]
    today = dt.date(2026, 5, 22)
    closed = calendar.states_with_closed_contest(rows, today=today, window_days=10)
    assert closed == [("GA", "primary", dt.date(2026, 5, 19))]


@pytest.mark.unit
def test_states_with_closed_contest_selects_runoff_in_window():
    rows = [{"state": "GA", "primary_date": dt.date(2026, 5, 19), "runoff_date": dt.date(2026, 6, 16)}]
    closed = calendar.states_with_closed_contest(rows, today=dt.date(2026, 6, 18), window_days=10)
    assert closed == [("GA", "runoff", dt.date(2026, 6, 16))]


@pytest.mark.unit
def test_states_with_closed_contest_ignores_future_and_old():
    rows = [{"state": "TX", "primary_date": dt.date(2026, 3, 3), "runoff_date": dt.date(2026, 5, 26)}]
    # today far after both → nothing in a 10-day window
    assert calendar.states_with_closed_contest(rows, today=dt.date(2026, 7, 1), window_days=10) == []


@pytest.mark.unit
def test_states_with_closed_contest_prefers_runoff_when_both_in_window():
    rows = [{"state": "AL", "primary_date": dt.date(2026, 6, 8), "runoff_date": dt.date(2026, 6, 14)}]
    closed = calendar.states_with_closed_contest(rows, today=dt.date(2026, 6, 16), window_days=10)
    assert closed == [("AL", "runoff", dt.date(2026, 6, 14))]
