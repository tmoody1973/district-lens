"""get_individual_donors — live FEC largest-itemized-contributions tool.

Tests use injected fakes only (no network, no Mongo): FakeCollection for the
cache/candidates, httpx.MockTransport for the FEC API.
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.tools.fec_donors import _dedupe_receipts, _donors_impl


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


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.saved: list[dict] = []

    def _matches(self, doc, query):
        return all(doc.get(k) == v for k, v in query.items())

    def find_one(self, query, projection=None):
        for doc in self.docs:
            if self._matches(doc, query):
                return doc
        return None

    def find(self, query, projection=None):
        return [doc for doc in self.docs if self._matches(doc, query)]

    def update_one(self, query, update, upsert=False):
        self.saved.append({"query": query, "set": update["$set"]})


class FakeDb:
    def __init__(self, candidates=None, cache=None):
        self.candidates = FakeCollection(candidates)
        self.fec_donor_cache = cache or FakeCollection()

    def __getitem__(self, name):
        return getattr(self, name)


def _fec_transport(committees=None, receipts=None, search=None, fail=False):
    def handler(request: httpx.Request) -> httpx.Response:
        if fail:
            return httpx.Response(500, json={"error": "boom"})
        path = request.url.path
        if "/committees/" in path:
            return httpx.Response(200, json={"results": committees or []})
        if "/schedules/schedule_a/" in path:
            return httpx.Response(200, json={"results": receipts or []})
        if "/candidates/search/" in path:
            return httpx.Response(200, json={"results": search or []})
        return httpx.Response(404, json={"results": []})

    return httpx.MockTransport(handler)


_MOORE = {"race_key": "2026-H-WI-04", "name": "MOORE, GWEN S",
          "candidate_id": "H4WI04183"}
_COMMITTEE = [{"committee_id": "C00397505", "name": "MOORE FOR CONGRESS"}]


def _rcpt(name, amount):
    return {"contributor_name": name, "contribution_receipt_amount": amount,
            "contribution_receipt_date": "2025-09-19",
            "contributor_employer": "ACME", "contributor_occupation": "CEO",
            "contributor_city": "MADISON", "contributor_state": "WI"}


def test_happy_path_returns_donors_with_committee():
    db = FakeDb(candidates=[_MOORE])
    result = _donors_impl(
        "Gwen Moore", "2026-H-WI-04", db=db,
        transport=_fec_transport(committees=_COMMITTEE,
                                 receipts=[_rcpt("BIG, JO", 3500)]),
    )
    assert result["status"] == "success"
    assert result["data"]["committee"] == "MOORE FOR CONGRESS"
    assert result["data"]["donors"][0]["name"] == "Big, Jo"
    assert result["data"]["cached"] is False
    assert "coverage_note" in result["data"]


def test_candidate_doc_matched_by_partial_name():
    # "Gwen Moore" (natural order) must match FEC-style "MOORE, GWEN S"
    db = FakeDb(candidates=[_MOORE])
    result = _donors_impl(
        "Gwen Moore", "2026-H-WI-04", db=db,
        transport=_fec_transport(committees=_COMMITTEE, receipts=[]),
    )
    assert result["data"]["candidate"] == "MOORE, GWEN S"


def test_fec_search_fallback_when_no_candidate_doc():
    db = FakeDb(candidates=[])  # nothing in Mongo
    result = _donors_impl(
        "Gwen Moore", "2026-H-WI-04", db=db,
        transport=_fec_transport(
            search=[{"candidate_id": "H4WI04183", "name": "MOORE, GWEN S"}],
            committees=_COMMITTEE, receipts=[_rcpt("BIG, JO", 1000)],
        ),
    )
    assert result["status"] == "success"
    assert result["data"]["donors"][0]["total"] == 1000


def test_empty_receipts_returns_honest_empty():
    db = FakeDb(candidates=[_MOORE])
    result = _donors_impl(
        "Gwen Moore", "2026-H-WI-04", db=db,
        transport=_fec_transport(committees=_COMMITTEE, receipts=[]),
    )
    assert result["status"] == "success"
    assert result["data"]["donors"] == []
    assert "Itemized" in result["data"]["coverage_note"]


def test_api_failure_degrades_to_honest_empty_never_raises():
    db = FakeDb(candidates=[_MOORE])
    result = _donors_impl(
        "Gwen Moore", "2026-H-WI-04", db=db, transport=_fec_transport(fail=True),
    )
    assert result["status"] == "success"
    assert result["data"]["donors"] == []


def test_cache_hit_skips_fec_api():
    cached_data = {"candidate": "MOORE, GWEN S", "committee": "MOORE FOR CONGRESS",
                   "cycle": 2026, "retrieved_at": "2026-06-10T20:00:00+00:00",
                   "cached": False, "donors": [], "coverage_note": "x"}
    cache = FakeCollection([{
        "key": "donors:2026-H-WI-04:H4WI04183",
        "data": cached_data,
        "retrieved_at": datetime.now(timezone.utc),
    }])
    db = FakeDb(candidates=[_MOORE], cache=cache)

    def explode(_req):
        raise AssertionError("FEC API must not be called on cache hit")

    result = _donors_impl("Gwen Moore", "2026-H-WI-04", db=db,
                          transport=httpx.MockTransport(explode))
    assert result["data"]["cached"] is True


def test_stale_cache_entry_is_ignored():
    cache = FakeCollection([{
        "key": "donors:2026-H-WI-04:H4WI04183",
        "data": {"donors": [], "cached": False},
        "retrieved_at": datetime(2026, 6, 1, tzinfo=timezone.utc),
    }])
    db = FakeDb(candidates=[_MOORE], cache=cache)
    result = _donors_impl(
        "Gwen Moore", "2026-H-WI-04", db=db,
        transport=_fec_transport(committees=_COMMITTEE,
                                 receipts=[_rcpt("BIG, JO", 700)]),
    )
    assert result["data"]["cached"] is False
    assert result["data"]["donors"][0]["total"] == 700


def test_result_written_to_cache():
    db = FakeDb(candidates=[_MOORE])
    _donors_impl("Gwen Moore", "2026-H-WI-04", db=db,
                 transport=_fec_transport(committees=_COMMITTEE,
                                          receipts=[_rcpt("BIG, JO", 500)]))
    assert db.fec_donor_cache.saved
    assert db.fec_donor_cache.saved[0]["query"]["key"] == \
        "donors:2026-H-WI-04:H4WI04183"


def test_tool_is_registered_on_chat_agent():
    from app.agent import _build_tools
    from app.tools.fec_donors import get_individual_donors
    assert get_individual_donors in _build_tools()


def test_tool_docstring_carries_guardrail_and_routing():
    from app.tools.fec_donors import get_individual_donors
    doc = get_individual_donors.__doc__ or ""
    assert "largest individual donors" in doc.lower()
    assert "never" in doc.lower() and "position" in doc.lower()
