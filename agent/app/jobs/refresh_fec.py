"""Scheduled Cloud Run Job entrypoint: re-run the FEC bulk import and audit it.

Wraps the existing idempotent importer (scripts/ingest_fec.py::run_import) so a
Cloud Scheduler-triggered Cloud Run Job can refresh the FEC snapshot on a cron
and leave an auditable record in the refresh_runs collection. This is Job A
(P0) of docs/plans/2026-05-24-data-refresh-design.md.
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import pymongo

from scripts.ingest_fec import run_import

logger = logging.getLogger(__name__)

JOB_NAME = "refresh_fec"


def _utcnow() -> datetime:
    return datetime.now(UTC)


def execute_refresh(
    *,
    mongo_uri: str,
    trigger: str = "scheduled",
    import_fn: Callable[[str], dict[str, int]] = run_import,
    client_factory: Callable[[str], pymongo.MongoClient] = pymongo.MongoClient,
    now_fn: Callable[[], datetime] = _utcnow,
) -> dict[str, Any]:
    """Run the FEC import and record a refresh_runs audit doc.

    Writes a `running` doc before the import, then updates it to `completed`
    (with counts) or `failed` (with the error). Re-raises on failure so the
    process exits non-zero and Cloud Run marks the execution failed.
    """
    run_id = uuid.uuid4().hex
    started_at = now_fn()
    client = client_factory(mongo_uri)
    runs_col = client["districtlens"]["refresh_runs"]
    try:
        runs_col.insert_one(
            {
                "run_id": run_id,
                "job_name": JOB_NAME,
                "trigger": trigger,
                "status": "running",
                "started_at": started_at,
                "completed_at": None,
                "counts": None,
                "error": None,
            }
        )

        try:
            counts = import_fn(mongo_uri)
        except Exception as exc:
            runs_col.update_one(
                {"run_id": run_id},
                {"$set": {"status": "failed", "completed_at": now_fn(), "error": str(exc)}},
            )
            logger.exception("refresh_fec run %s failed", run_id)
            raise

        runs_col.update_one(
            {"run_id": run_id},
            {"$set": {"status": "completed", "completed_at": now_fn(), "counts": counts}},
        )
        logger.info("refresh_fec run %s completed: %s", run_id, counts)
        return {"run_id": run_id, "status": "completed", "counts": counts}
    finally:
        client.close()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    mongo_uri = os.environ.get("MONGODB_URI")
    if not mongo_uri:
        logger.error("MONGODB_URI not set; cannot run refresh_fec job")
        return 1
    trigger = os.environ.get("REFRESH_TRIGGER", "scheduled")
    try:
        execute_refresh(mongo_uri=mongo_uri, trigger=trigger)
    except Exception:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
