"""Unit tests for the scheduled FEC refresh job entrypoint."""

import pytest

from app.jobs import refresh_fec


class FakeCollection:
    """Minimal stand-in for a pymongo collection that records writes."""

    def __init__(self):
        self.docs = []

    def insert_one(self, doc):
        self.docs.append(dict(doc))

    def update_one(self, flt, update):
        for d in self.docs:
            if d["run_id"] == flt["run_id"]:
                d.update(update["$set"])


class FakeDB:
    def __init__(self, col):
        self._col = col

    def __getitem__(self, name):
        assert name == "refresh_runs"
        return self._col


class FakeClient:
    def __init__(self, col):
        self._db = FakeDB(col)
        self.closed = False

    def __getitem__(self, name):
        assert name == "districtlens"
        return self._db

    def close(self):
        self.closed = True


@pytest.mark.unit
def test_execute_refresh_success_writes_audit_doc_with_correct_fields():
    col = FakeCollection()
    client = FakeClient(col)
    counts = {"races": 503, "candidates": 3900}

    result = refresh_fec.execute_refresh(
        mongo_uri="mongodb://x",
        import_fn=lambda uri: counts,
        client_factory=lambda uri: client,
    )

    assert result["status"] == "completed"
    assert result["counts"] == counts
    assert len(col.docs) == 1
    doc = col.docs[0]
    assert doc["job_name"] == "refresh_fec"
    assert doc["trigger"] == "scheduled"
    assert doc["status"] == "completed"
    assert doc["counts"] == counts
    assert doc["completed_at"] is not None
    assert client.closed is True


@pytest.mark.unit
def test_execute_refresh_records_failure_and_reraises():
    col = FakeCollection()
    client = FakeClient(col)

    def boom(uri):
        raise RuntimeError("download failed")

    with pytest.raises(RuntimeError, match="download failed"):
        refresh_fec.execute_refresh(
            mongo_uri="mongodb://x",
            import_fn=boom,
            client_factory=lambda uri: client,
        )

    assert len(col.docs) == 1
    doc = col.docs[0]
    assert doc["status"] == "failed"
    assert doc["error"] == "download failed"
    assert doc["completed_at"] is not None
    assert client.closed is True


@pytest.mark.unit
def test_main_returns_1_when_uri_missing(monkeypatch):
    monkeypatch.delenv("MONGODB_URI", raising=False)
    assert refresh_fec.main() == 1


@pytest.mark.unit
def test_main_returns_0_on_success(monkeypatch):
    monkeypatch.setenv("MONGODB_URI", "mongodb://x")
    monkeypatch.setattr(refresh_fec, "execute_refresh", lambda **kw: {"status": "completed"})
    assert refresh_fec.main() == 0


@pytest.mark.unit
def test_main_returns_1_on_failure(monkeypatch):
    monkeypatch.setenv("MONGODB_URI", "mongodb://x")

    def boom(**kw):
        raise RuntimeError("x")

    monkeypatch.setattr(refresh_fec, "execute_refresh", boom)
    assert refresh_fec.main() == 1
