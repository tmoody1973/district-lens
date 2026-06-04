"""Evidence archive: fetch, hash, and store cited source pages as dated evidence.

Pure data layer for DistrictLens Phase 1. Operationalizes the citation and
data-integrity rules: every cited source is fetched, content-hashed, stamped
with a retrieval timestamp, and stored append-only so raw evidence is never
overwritten.
"""
