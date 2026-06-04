"""Schema, hashing, and indexes for the ``candidate_positions`` cache.

A ``candidate_positions`` doc is one cached research result per candidate: the
extracted per-issue stances (each citing an archived ``source_documents`` page
via the T4 source shape), the disambiguation string used to find them, a
content hash for change detection, and an append-only ``retrieval_history``.

Mirrors ``app.services.evidence.schema``: idempotent ``create_index`` (safe to
call on every startup) and a ``sha256_text``-based content hash reused verbatim.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, TypedDict

from app.services.evidence.schema import sha256_text

COLLECTION_NAME = "candidate_positions"

RESEARCH_TIERS = ("deep", "shallow", "discovery_only")
EVIDENCE_TYPES = ("direct_quote", "questionnaire", "voting_record", "reported")
STATUS_FOUND = "found"
STATUS_EMPTY = "no_positions_found"

# Source-provenance catalogs — the single source of truth shared by the ranker
# (research) and the evidence-type tagger (extract).
QUESTIONNAIRE_DOMAINS = ("vote411.org", "lwv.org", "ballotpedia.org")
AGGREGATOR_DENY = (
    "wikipedia.org",
    "opensecrets.org",
    "fec.gov",
    "govtrack.us",
    "votesmart.org",
)


class PositionSource(TypedDict, total=False):
    """A cited source on a position — the T4 EvidenceCard source shape verbatim."""

    title: str
    url: str
    date: str | None
    snippet: str
    archived: bool
    archivedAt: str | None
    sourceDocumentId: str | None


class Position(TypedDict):
    """One extracted per-issue stance with its supporting sources."""

    issue: str
    answer: str
    evidenceType: str
    sources: list[PositionSource]


class PositionsRetrievalRecord(TypedDict):
    """One append-only audit entry recording a research pass."""

    researched_at: datetime
    content_hash: str
    research_tier: str
    status: str


class CandidatePositions(TypedDict):
    """A cached per-candidate research result (one doc per candidate)."""

    candidate_id: str
    race_key: str
    candidate_name: str
    researched_at: datetime
    research_tier: str
    disambiguation: str
    status: str
    positions: list[Position]
    content_hash: str
    retrieval_history: list[PositionsRetrievalRecord]


def positions_content_hash(positions: list[dict[str, Any]]) -> str:
    """Return a stable, change-sensitive hash of a positions list.

    Canonical JSON (sorted keys) makes the hash order-insensitive to dict key
    order while remaining sensitive to any change in the extracted content. This
    is the change-detection key that keeps unchanged research from churning the
    cache (mirrors ``source_documents`` content hashing).
    """
    canonical = json.dumps(positions, sort_keys=True, separators=(",", ":"), default=str)
    return sha256_text(canonical)


def ensure_indexes(db: Any) -> None:
    """Create the ``candidate_positions`` indexes idempotently.

    ``{candidate_id: 1}`` backs the per-candidate cache read, ``{race_key: 1}``
    backs race-scoped scans, and ``{researched_at: -1}`` backs freshness/refresh
    ordering. ``create_index`` is a no-op when the index already exists.
    """
    collection = db[COLLECTION_NAME]
    collection.create_index([("candidate_id", 1)])
    collection.create_index([("race_key", 1)])
    collection.create_index([("researched_at", -1)])
