"""One-time bulk warm: broad-tier positions for every active candidate nationwide.

Why: a judge's FIRST view of a cold race shows honest-empty positions (the
detached lazy fill only helps the SECOND view). Warming every active candidate
ahead of judging means no race greets a judge empty (2026-06-11, MI-07 report).

Policy:
- Active candidates only (phantom status-N/unfunded filings dropped).
- Skip anyone whose cached doc already has positions (cheap, resumable).
- Re-research empty docs (stale honest-empties from the pre-grounding engine).
- Races ordered by prominence (top receipts first) so the most clickable races
  warm earliest; --first races jump the queue.

Run:
  MONGODB_URI=... uv run python scripts/warm_all_positions.py --first 2026-H-MI-07
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
from typing import Any

import pymongo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.positions.research import research_candidate_positions  # noqa: E402
from app.services.positions.store import upsert_positions  # noqa: E402
from app.tools.mongodb_tools import _active_candidate_docs  # noqa: E402

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("warm_all")

CONCURRENCY = 14
PER_CANDIDATE_TIMEOUT_S = 360.0

_RESEARCH_FIELDS = (
    "candidate_id", "name", "party", "race_key", "incumbent_challenge_status",
)


def research_view(candidate: dict[str, Any]) -> dict[str, Any]:
    view = {field: candidate.get(field) for field in _RESEARCH_FIELDS}
    view["ballotpedia_url"] = candidate.get("ballotpedia_profile_url")
    return view


def ordered_race_keys(db: Any, first: list[str]) -> list[str]:
    """All race keys, most prominent (top receipts) first; `first` jumps the queue."""
    top_receipts: dict[str, float] = {}
    cand_race = {
        c["candidate_id"]: c.get("race_key")
        for c in db.candidates.find({}, {"candidate_id": 1, "race_key": 1})
    }
    for fin in db.finance_summaries.find({}, {"candidate_id": 1, "receipts": 1}):
        race = cand_race.get(fin.get("candidate_id"))
        if race:
            top_receipts[race] = max(top_receipts.get(race, 0), fin.get("receipts") or 0)
    all_keys = db.candidates.distinct("race_key")
    rest = sorted(
        (k for k in all_keys if k not in first),
        key=lambda k: top_receipts.get(k, 0), reverse=True,
    )
    return [k for k in first if k in all_keys] + rest


async def warm_candidate(sem: asyncio.Semaphore, view: dict[str, Any],
                         stats: dict[str, int]) -> None:
    async with sem:
        try:
            doc = await asyncio.wait_for(
                research_candidate_positions(view, tier="broad"),
                PER_CANDIDATE_TIMEOUT_S,
            )
            await upsert_positions(doc)
            found = len(doc.get("positions") or [])
            stats["done"] += 1
            stats["with_positions"] += 1 if found else 0
            print(f"[{stats['done']}/{stats['todo']}] {view['race_key']} "
                  f"{view['name']}: {found} positions", flush=True)
        except Exception as exc:
            stats["done"] += 1
            stats["failed"] += 1
            print(f"[{stats['done']}/{stats['todo']}] {view['race_key']} "
                  f"{view['name']}: FAILED {type(exc).__name__}: {exc}", flush=True)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--first", nargs="*", default=[])
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    db = pymongo.MongoClient(os.environ["MONGODB_URI"])["districtlens"]
    warm_ids = {
        d["candidate_id"]
        for d in db.candidate_positions.find(
            {"positions.0": {"$exists": True}}, {"candidate_id": 1})
    }

    queue: list[dict[str, Any]] = []
    for race_key in ordered_race_keys(db, args.first):
        for cand in _active_candidate_docs(db, race_key):
            if cand["candidate_id"] in warm_ids:
                continue
            view = research_view(cand)
            view["race_key"] = race_key  # projection drops it; research needs it
            queue.append(view)
    if args.limit:
        queue = queue[: args.limit]

    stats = {"todo": len(queue), "done": 0, "with_positions": 0, "failed": 0}
    print(f"WARM-ALL: {stats['todo']} candidates to research "
          f"({len(warm_ids)} already warm, concurrency {CONCURRENCY})", flush=True)
    started = time.time()
    sem = asyncio.Semaphore(CONCURRENCY)
    await asyncio.gather(*(warm_candidate(sem, v, stats) for v in queue))
    minutes = (time.time() - started) / 60
    print(f"WARM-ALL COMPLETE in {minutes:.0f}min: {stats['done']} researched, "
          f"{stats['with_positions']} with positions, {stats['failed']} failed", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
