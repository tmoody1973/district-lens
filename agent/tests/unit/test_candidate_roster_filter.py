"""Phantom-filing filter for the candidate roster.

FEC's candidate master includes anyone who filed Form 2, including not-yet-
statutory ('N') filings that were abandoned (e.g. a person who filed for one
office then ran for another). A status-'N' filing with no finance activity is a
phantom and must not show as a real ballot candidate. Status 'C', or 'N' WITH
finance, are kept.
"""

from __future__ import annotations

import pytest

from app.tools.mongodb_tools import _is_phantom_filing


@pytest.mark.unit
def test_status_n_with_no_finance_is_phantom():
    # The exact AL-07 case: Murphy's House filing (status N, $0).
    cand = {"candidate_id": "H6AL07190", "fec_status": "N"}
    assert _is_phantom_filing(cand, funded_ids=set()) is True


@pytest.mark.unit
def test_status_n_with_finance_is_kept():
    # A real early grassroots candidate: not yet statutory but has raised money.
    cand = {"candidate_id": "H9XX01001", "fec_status": "N"}
    assert _is_phantom_filing(cand, funded_ids={"H9XX01001"}) is False


@pytest.mark.unit
def test_status_c_is_always_kept():
    cand = {"candidate_id": "H0AL07086", "fec_status": "C"}
    assert _is_phantom_filing(cand, funded_ids=set()) is False


@pytest.mark.unit
def test_missing_status_is_kept():
    # Never drop a candidate just because the status field is absent.
    assert _is_phantom_filing({"candidate_id": "Z"}, funded_ids=set()) is False
