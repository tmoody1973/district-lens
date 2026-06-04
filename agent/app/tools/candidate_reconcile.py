"""Reconcile the FEC filing roster against NBC's actual ballot roster (Phase 2).

NBC's per-seat results are the real ballot. We prefer that list, enrich each
candidate with their FEC record (finance/photo/incumbency) matched by **last name
+ party** (the name forms differ — NBC "Steve Marshall" vs FEC "Marshall, Steven
T"), drop FEC filers who aren't on the ballot (e.g. someone running for a
different office), and keep NBC candidates with no FEC record.

A pure function: no I/O. The caller supplies the FEC docs and the stored NBC
roster; the result is a candidate-doc list ready for ``_to_candidate_card``.
"""

from __future__ import annotations

from typing import Any

_PARTY_ALIASES = {"gop": "REP", "rep": "REP", "r": "REP", "dem": "DEM", "dem.": "DEM", "d": "DEM"}


def _norm_party(party: str | None) -> str:
    p = (party or "").strip().lower()
    return _PARTY_ALIASES.get(p, (party or "").strip().upper())


def _last_name(name: str) -> str:
    """Lowercased alpha last name from either 'Last, First' or 'First Last'."""
    raw = name.split(",", 1)[0] if "," in name else name.split(" ")[-1] if name else ""
    return "".join(ch for ch in raw.lower() if ch.isalpha())


def _first_tokens(name: str) -> set[str]:
    """The given-name tokens, for disambiguating same-last-name collisions."""
    if "," in name:
        rest = name.split(",", 1)[1]
    else:
        parts = name.split(" ")
        rest = " ".join(parts[:-1])
    return {t for t in (tok.lower().strip(".") for tok in rest.split()) if t}


def _pick(matches: list[dict[str, Any]], nbc_name: str) -> dict[str, Any]:
    """Choose among same-(last, party) FEC docs — by first-name overlap, else first."""
    if len(matches) == 1:
        return matches[0]
    nbc_first = _first_tokens(nbc_name)
    for candidate in matches:
        fec_first = _first_tokens(candidate.get("name", ""))
        if nbc_first & fec_first or any(
            a.startswith(b) or b.startswith(a) for a in nbc_first for b in fec_first
        ):
            return candidate
    return matches[0]


def reconcile_roster(
    fec_candidates: list[dict[str, Any]], nbc_candidates: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Return the NBC ballot, FEC-enriched. Phantoms (FEC-only) are dropped."""
    index: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for candidate in fec_candidates:
        key = (_last_name(candidate.get("name", "")), _norm_party(candidate.get("party")))
        index.setdefault(key, []).append(candidate)

    reconciled: list[dict[str, Any]] = []
    for nbc in nbc_candidates:
        name = nbc.get("name", "")
        party = _norm_party(nbc.get("party"))
        matches = index.get((_last_name(name), party), [])
        fec = _pick(matches, name) if matches else None

        result_fields = {
            "vote_share": nbc.get("percent_vote"),
            "is_primary_winner": bool(nbc.get("is_winner")),
        }
        if fec is not None:
            reconciled.append({**fec, **result_fields, "roster_source": "nbc+fec"})
        else:
            reconciled.append(
                {
                    "candidate_id": "",
                    "name": name,
                    "party": party,
                    "incumbent_challenge_status": "unknown",
                    "fec_status": None,
                    **result_fields,
                    "roster_source": "nbc",
                }
            )
    return reconciled
