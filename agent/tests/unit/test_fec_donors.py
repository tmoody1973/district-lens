"""get_individual_donors — live FEC largest-itemized-contributions tool.

Tests use injected fakes only (no network, no Mongo): FakeCollection for the
cache/candidates, httpx.MockTransport for the FEC API.
"""

from __future__ import annotations

from app.tools.fec_donors import _dedupe_receipts


def _receipt(name, amount, date="2025-09-01", employer=None, occupation=None,
             city="MILWAUKEE", state="WI"):
    return {
        "contributor_name": name,
        "contribution_receipt_amount": amount,
        "contribution_receipt_date": date,
        "contributor_employer": employer,
        "contributor_occupation": occupation,
        "contributor_city": city,
        "contributor_state": state,
    }


def test_dedupe_merges_same_name_summing_amounts():
    rows = _dedupe_receipts([
        _receipt("KLEIN, DENNIS J", 3300, date="2025-03-01"),
        _receipt("Klein,  Dennis J", 3300, date="2025-09-22", employer="CD SMITH",
                 occupation="EXECUTIVE"),
    ])
    assert len(rows) == 1
    assert rows[0]["total"] == 6600
    assert rows[0]["transactions"] == 2
    assert rows[0]["latest_date"] == "2025-09-22"
    # metadata comes from the latest-dated receipt
    assert rows[0]["employer"] == "CD SMITH"


def test_dedupe_orders_by_total_descending():
    rows = _dedupe_receipts([
        _receipt("SMALL, PAT", 500),
        _receipt("BIG, JO", 3500),
        _receipt("SMALL, PAT", 500, date="2025-10-01"),
        _receipt("MID, LEE", 2000),
    ])
    assert [r["total"] for r in rows] == [3500, 2000, 1000]


def test_dedupe_caps_at_ten_donors():
    rows = _dedupe_receipts([_receipt(f"DONOR, N{i}", 100 + i) for i in range(15)])
    assert len(rows) == 10


def test_dedupe_formats_city_state_and_amount():
    rows = _dedupe_receipts([_receipt("KLEIN, DENNIS J", 3500)])
    assert rows[0]["city_state"] == "Milwaukee, WI"
    assert rows[0]["total_fmt"] == "$3.5K"
