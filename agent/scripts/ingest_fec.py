"""FEC 2026 bulk import — candidates, committees, finance summaries, races.

Reads three FEC bulk download files (no API key, no rate limit):
  cn26.zip  — candidate master (all federal candidates)
  cm26.zip  — committee master (all PACs/campaign committees)
  weball26.zip — financial summaries (receipts, disbursements, CoH)

Writes into MongoDB collections (upsert-safe, idempotent):
  races            — one doc per race_key
  candidates       — one doc per CAND_ID
  committees       — one doc per CMTE_ID
  finance_summaries — one doc per CAND_ID
  official_import_batches — one batch audit record

DECISIONS_LOG §3.2: bulk-everything-cheap. No API key required.
DATA_STRATEGY: race_key format is {cycle}-{office}-{state}-{district:02d}
"""

from __future__ import annotations

import csv
import hashlib
import io
import logging
import os
import sys
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pymongo
from dotenv import load_dotenv
from pymongo import UpdateOne

# Load agent .env so MONGODB_URI is available when running locally
load_dotenv(Path(__file__).parent.parent / "app" / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

FEC_BULK_BASE = "https://www.fec.gov/files/bulk-downloads/2026"
CYCLE = "2026"
TARGET_OFFICES = {"H", "S"}

# Pipe-delimited FEC column headers (no header row in the files)
CN_COLS = [
    "CAND_ID", "CAND_NAME", "CAND_PTY_AFFILIATION", "CAND_ELECTION_YR",
    "CAND_OFFICE_ST", "CAND_OFFICE", "CAND_OFFICE_DISTRICT", "CAND_ICI",
    "CAND_STATUS", "CAND_PCC", "CAND_ST1", "CAND_ST2", "CAND_CITY", "CAND_ST", "CAND_ZIP",
]
CM_COLS = [
    "CMTE_ID", "CMTE_NM", "TRES_NM", "CMTE_ST1", "CMTE_ST2", "CMTE_CITY",
    "CMTE_ST", "CMTE_ZIP", "CMTE_DSGN", "CMTE_TP", "CMTE_PTY_AFFILIATION",
    "CMTE_FILING_FREQ", "ORG_TP", "CONNECTED_ORG_NM", "CAND_ID",
]
WEBALL_COLS = [
    "CAND_ID", "CAND_NAME", "CAND_ICI", "PTY_CD", "CAND_PTY_AFFILIATION",
    "TTL_RECEIPTS", "TRANS_FROM_AUTH", "TTL_DISB", "TRANS_TO_AUTH",
    "COH_BOP", "COH_COP", "CAND_CONTRIB", "CAND_LOANS", "OTHER_LOANS",
    "CAND_LOAN_REPAY", "OTHER_LOAN_REPAY", "DEBTS_OWED_BY", "TTL_INDIV_CONTRIB",
    "CAND_OFFICE_ST", "CAND_OFFICE_DISTRICT", "SPEC_ELECTION", "PRIM_ELECTION",
    "RUN_ELECTION", "GEN_ELECTION", "GEN_ELECTION_PRECENT", "OTHER_POL_CMTE_CONTRIB",
    "POL_PTY_CONTRIB", "CVG_END_DT", "INDIV_REFUNDS", "CMTE_REFUNDS",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _race_key(office: str, state: str, district: str) -> str:
    """Build the canonical race key. DATA_STRATEGY: {cycle}-{office}-{state}-{district:02d}."""
    try:
        d = int(district) if district.strip() else 0
    except ValueError:
        d = 0
    return f"{CYCLE}-{office.upper()}-{state.upper()}-{d:02d}"


def _checksum(data: dict) -> str:
    """Stable MD5 of relevant fields for change detection."""
    payload = "|".join(str(data.get(k, "")) for k in sorted(data))
    return hashlib.md5(payload.encode()).hexdigest()


def _money(val: str) -> float | None:
    """Parse pipe-file dollar strings to float, None if blank/invalid."""
    v = val.strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _parse_zip(path: str, inner_name: str, columns: list[str]) -> list[dict]:
    """Read a pipe-delimited FEC zip file, return list of dicts."""
    rows = []
    with zipfile.ZipFile(path) as z:
        with z.open(inner_name) as f:
            reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"), delimiter="|")
            for raw in reader:
                if len(raw) >= len(columns) - 2:  # allow minor trailing-column variance
                    # strict=False: row length intentionally varies; zip truncates to the shorter.
                    rows.append(dict(zip(columns, raw, strict=False)))
    return rows


def _download(url: str, dest: str, max_age_hours: int = 24) -> str:
    """Download url to dest if not cached or stale. Returns dest path."""
    p = Path(dest)
    if p.exists() and (datetime.now().timestamp() - p.stat().st_mtime) < max_age_hours * 3600:
        logger.info("Using cached %s (%s)", dest, p.stat().st_size)
        return dest
    logger.info("Downloading %s → %s", url, dest)
    with httpx.Client(follow_redirects=True, timeout=120) as client:
        resp = client.get(url)
        resp.raise_for_status()
        p.write_bytes(resp.content)
    logger.info("Downloaded %s bytes", len(resp.content))
    return dest


# ---------------------------------------------------------------------------
# Main import
# ---------------------------------------------------------------------------

def run_import(mongo_uri: str, *, cache_dir: str = "/tmp") -> dict[str, int]:
    now = datetime.now(UTC)
    batch_id = now.strftime("fec-2026-%Y%m%d-%H%M%S")
    stale_after = now + timedelta(days=30)

    # Download files
    cn_path = _download(f"{FEC_BULK_BASE}/cn26.zip", f"{cache_dir}/cn26.zip")
    cm_path = _download(f"{FEC_BULK_BASE}/cm26.zip", f"{cache_dir}/cm26.zip")
    fin_path = _download(f"{FEC_BULK_BASE}/weball26.zip", f"{cache_dir}/weball26.zip")

    # Parse
    logger.info("Parsing cn26 (candidates)…")
    all_cn = _parse_zip(cn_path, "cn.txt", CN_COLS)
    cn_2026 = [r for r in all_cn if r.get("CAND_ELECTION_YR") == CYCLE and r.get("CAND_OFFICE") in TARGET_OFFICES]
    logger.info("  %d total → %d 2026 H+S candidates", len(all_cn), len(cn_2026))

    logger.info("Parsing cm26 (committees)…")
    all_cm = _parse_zip(cm_path, "cm.txt", CM_COLS)
    # Index committees by CAND_ID (a candidate can have multiple committees)
    cand_to_cmtes: dict[str, list[dict]] = {}
    for c in all_cm:
        cid = c.get("CAND_ID", "").strip()
        if cid:
            cand_to_cmtes.setdefault(cid, []).append(c)
    logger.info("  %d committees, %d linked to candidates", len(all_cm), sum(len(v) for v in cand_to_cmtes.values()))

    logger.info("Parsing weball26 (finance summaries)…")
    all_fin = _parse_zip(fin_path, "weball26.txt", WEBALL_COLS)
    fin_by_id = {r["CAND_ID"]: r for r in all_fin if r.get("CAND_ID")}
    logger.info("  %d finance summary rows", len(all_fin))

    # Connect to MongoDB
    client: pymongo.MongoClient = pymongo.MongoClient(mongo_uri)
    db = client["districtlens"]

    races_col = db["races"]
    candidates_col = db["candidates"]
    committees_col = db["committees"]
    finance_col = db["finance_summaries"]
    batches_col = db["official_import_batches"]

    # Ensure indexes
    candidates_col.create_index([("candidate_id", 1)], unique=True)
    candidates_col.create_index([("race_key", 1)])
    candidates_col.create_index([("name", "text")])
    races_col.create_index([("race_key", 1)], unique=True)
    committees_col.create_index([("committee_id", 1)], unique=True)
    committees_col.create_index([("candidate_id", 1)])
    finance_col.create_index([("candidate_id", 1)], unique=True)
    logger.info("Indexes ensured")

    # Build race → candidates map
    race_map: dict[str, list[dict]] = {}
    for r in cn_2026:
        rk = _race_key(r["CAND_OFFICE"], r["CAND_OFFICE_ST"], r["CAND_OFFICE_DISTRICT"])
        race_map.setdefault(rk, []).append(r)

    # Upsert races
    race_ops = []
    for rk, cands in race_map.items():
        sample = cands[0]
        doc = {
            "race_key": rk,
            "cycle": CYCLE,
            "office": sample["CAND_OFFICE"].upper(),
            "state": sample["CAND_OFFICE_ST"].upper(),
            "district": sample["CAND_OFFICE_DISTRICT"].strip(),
            "candidate_count": len(cands),
            "source_system": "fec_bulk",
            "source_url": f"{FEC_BULK_BASE}/cn26.zip",
            "import_batch_id": batch_id,
            "ingested_at": now,
            "last_checked_at": now,
            "stale_after": stale_after,
            "freshness_status": "fresh",
        }
        race_ops.append(
            UpdateOne({"race_key": rk}, {"$set": doc, "$setOnInsert": {"created_at": now}}, upsert=True)
        )

    if race_ops:
        result = races_col.bulk_write(race_ops, ordered=False)
        logger.info("Races upserted: %d inserted, %d updated", result.upserted_count, result.modified_count)

    # Upsert candidates
    cand_ops = []
    for r in cn_2026:
        rk = _race_key(r["CAND_OFFICE"], r["CAND_OFFICE_ST"], r["CAND_OFFICE_DISTRICT"])
        doc = {
            "candidate_id": r["CAND_ID"],
            "race_key": rk,
            "name": r["CAND_NAME"].title(),
            "name_raw": r["CAND_NAME"],
            "party": r["CAND_PTY_AFFILIATION"].upper(),
            "office": r["CAND_OFFICE"].upper(),
            "state": r["CAND_OFFICE_ST"].upper(),
            "district": r["CAND_OFFICE_DISTRICT"].strip(),
            "incumbent_challenge_status": {
                "I": "incumbent", "C": "challenger", "O": "open_seat",
            }.get(r.get("CAND_ICI", "").upper(), "unknown"),
            "fec_status": r.get("CAND_STATUS", "").upper(),
            "primary_committee_id": r.get("CAND_PCC", "").strip() or None,
            "source_system": "fec_bulk",
            "source_url": f"{FEC_BULK_BASE}/cn26.zip",
            "source_record_id": r["CAND_ID"],
            "import_batch_id": batch_id,
            "ingested_at": now,
            "last_checked_at": now,
            "stale_after": stale_after,
            "freshness_status": "fresh",
        }
        doc["checksum"] = _checksum(doc)
        cand_ops.append(
            UpdateOne({"candidate_id": r["CAND_ID"]}, {"$set": doc, "$setOnInsert": {"created_at": now}}, upsert=True)
        )

    if cand_ops:
        result = candidates_col.bulk_write(cand_ops, ordered=False)
        logger.info("Candidates upserted: %d inserted, %d updated", result.upserted_count, result.modified_count)

    # Upsert committees (only those linked to 2026 H+S candidates)
    cand_2026_ids = {r["CAND_ID"] for r in cn_2026}
    cmte_ops = []
    for cid in cand_2026_ids:
        for c in cand_to_cmtes.get(cid, []):
            doc = {
                "committee_id": c["CMTE_ID"],
                "candidate_id": cid,
                "name": c.get("CMTE_NM", "").strip(),
                "designation": c.get("CMTE_DSGN", "").upper(),
                "committee_type": c.get("CMTE_TP", "").upper(),
                "party": c.get("CMTE_PTY_AFFILIATION", "").upper(),
                "state": c.get("CMTE_ST", "").upper(),
                "city": c.get("CMTE_CITY", "").strip(),
                "source_system": "fec_bulk",
                "source_url": f"{FEC_BULK_BASE}/cm26.zip",
                "source_record_id": c["CMTE_ID"],
                "import_batch_id": batch_id,
                "ingested_at": now,
                "last_checked_at": now,
                "stale_after": stale_after,
                "freshness_status": "fresh",
            }
            cmte_ops.append(
                UpdateOne({"committee_id": c["CMTE_ID"]}, {"$set": doc, "$setOnInsert": {"created_at": now}}, upsert=True)
            )

    if cmte_ops:
        result = committees_col.bulk_write(cmte_ops, ordered=False)
        logger.info("Committees upserted: %d inserted, %d updated", result.upserted_count, result.modified_count)

    # Upsert finance summaries
    fin_ops = []
    for cid in cand_2026_ids:
        fin = fin_by_id.get(cid)
        if not fin:
            continue
        cvg = fin.get("CVG_END_DT", "").strip()
        doc = {
            "candidate_id": cid,
            "cycle": CYCLE,
            "receipts": _money(fin.get("TTL_RECEIPTS", "")),
            "disbursements": _money(fin.get("TTL_DISB", "")),
            "cash_on_hand": _money(fin.get("COH_COP", "")),
            "cash_on_hand_beginning": _money(fin.get("COH_BOP", "")),
            "debts": _money(fin.get("DEBTS_OWED_BY", "")),
            "individual_contributions": _money(fin.get("TTL_INDIV_CONTRIB", "")),
            "candidate_contributions": _money(fin.get("CAND_CONTRIB", "")),
            "loans_from_candidate": _money(fin.get("CAND_LOANS", "")),
            "other_loans": _money(fin.get("OTHER_LOANS", "")),
            "pac_contributions": _money(fin.get("OTHER_POL_CMTE_CONTRIB", "")),
            "party_contributions": _money(fin.get("POL_PTY_CONTRIB", "")),
            "coverage_end_date": cvg,
            "source_system": "fec_bulk",
            "source_url": f"{FEC_BULK_BASE}/weball26.zip",
            "source_record_id": cid,
            "import_batch_id": batch_id,
            "retrieved_at": now,
            "last_checked_at": now,
            "stale_after": stale_after,
            "freshness_status": "fresh",
        }
        fin_ops.append(
            UpdateOne({"candidate_id": cid, "cycle": CYCLE}, {"$set": doc, "$setOnInsert": {"created_at": now}}, upsert=True)
        )

    if fin_ops:
        result = finance_col.bulk_write(fin_ops, ordered=False)
        logger.info("Finance summaries upserted: %d inserted, %d updated", result.upserted_count, result.modified_count)

    # Write import batch record
    counts = {
        "races": len(race_map),
        "candidates": len(cand_2026_ids),
        "committees": len(cmte_ops),
        "finance_summaries": len(fin_ops),
    }
    batches_col.insert_one({
        "batch_id": batch_id,
        "source_system": "fec_bulk",
        "cycle": CYCLE,
        "offices": list(TARGET_OFFICES),
        "source_files": [
            f"{FEC_BULK_BASE}/cn26.zip",
            f"{FEC_BULK_BASE}/cm26.zip",
            f"{FEC_BULK_BASE}/weball26.zip",
        ],
        "counts": counts,
        "started_at": now,
        "completed_at": datetime.now(UTC),
        "status": "completed",
    })
    logger.info("Import batch %s complete: %s", batch_id, counts)

    client.close()
    return counts


if __name__ == "__main__":
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        logger.error("MONGODB_URI not set. Run: uv run scripts/ingest_fec.py")
        sys.exit(1)
    results = run_import(uri)
    print("\nImport complete:")
    for k, v in results.items():
        print(f"  {k}: {v:,}")
