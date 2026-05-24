"""Tests for the race_status store: transitions, events, citation invariant."""

import pytest

from app.refresh import race_status_store as store


class FakeCol:
    def __init__(self):
        self.docs = []
    def find_one(self, flt):
        return next((d for d in self.docs if all(d.get(k) == v for k, v in flt.items())), None)
    def update_one(self, flt, update, upsert=False):
        d = self.find_one(flt)
        if d is None and upsert:
            d = dict(flt)
            self.docs.append(d)
        if d is not None:
            d.update(update.get("$set", {}))
    def insert_one(self, doc):
        self.docs.append(dict(doc))
        return type("R", (), {"inserted_id": len(self.docs)})()


def _stores():
    return store.RaceStatusStore(status_col=FakeCol(), events_col=FakeCol(), citations_col=FakeCol())


@pytest.mark.unit
def test_confirm_requires_citation():
    s = _stores()
    with pytest.raises(ValueError, match="citation"):
        s.apply_resolution(race_key="2026-H-GA-07", to_status="confirmed",
                           winners={"REP": "H0GA07001"}, citation_id=None, reason="clean")


@pytest.mark.unit
def test_confirm_with_citation_writes_status_and_event():
    s = _stores()
    s.apply_resolution(race_key="2026-H-GA-07", to_status="confirmed",
                       winners={"REP": "H0GA07001"}, citation_id=123, reason="clean",
                       presentation_class="routine", prev_status="pre_primary")
    st = s.status_col.find_one({"race_key": "2026-H-GA-07"})
    assert st["status"] == "confirmed" and st["citation_id"] == 123
    assert len(s.events_col.docs) == 1
    assert s.events_col.docs[0]["to_status"] == "confirmed"


@pytest.mark.unit
def test_no_event_when_status_unchanged():
    s = _stores()
    s.apply_resolution(race_key="2026-H-GA-07", to_status="provisional", winners={},
                       citation_id=None, reason="runoff", prev_status="provisional")
    assert len(s.events_col.docs) == 0  # no transition → no event


@pytest.mark.unit
def test_flag_provisional_allowed_without_citation():
    s = _stores()
    s.apply_resolution(race_key="2026-H-GA-07", to_status="provisional", winners={},
                       citation_id=None, reason="incumbent_defeated",
                       presentation_class="newsworthy_signal", prev_status="pre_primary")
    assert s.status_col.find_one({"race_key": "2026-H-GA-07"})["status"] == "provisional"
    assert s.events_col.docs[0]["presentation_class"] == "newsworthy_signal"
