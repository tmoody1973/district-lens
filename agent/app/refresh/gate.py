"""Deterministic confirm-or-flag gate for primary nominee resolution.

Pure function — no I/O, no Mongo, no network calls.

Decision order (first match wins):
1. sources_disagree         → contested   / genuine_uncertainty
2. runoff_indicated OR
   (runoff_rule != "none" AND no clear winner)
                            → runoff_pending / newsworthy_signal
3. no winner OR confidence < threshold OR citation_id is None OR fec_contradicts
                            → provisional / genuine_uncertainty
4. else                     → confirmed
       presentation_class = "newsworthy_signal" if a winner != incumbent_id
                             else "routine"

Civic-safety invariant (enforced by assert):
    decide() NEVER returns to_status="confirmed" when citation_id is None.
"""

from __future__ import annotations

from dataclasses import dataclass

_CONFIRMED = "confirmed"
_PROVISIONAL = "provisional"
_RUNOFF_PENDING = "runoff_pending"
_CONTESTED = "contested"

_ROUTINE = "routine"
_NEWSWORTHY = "newsworthy_signal"
_UNCERTAINTY = "genuine_uncertainty"

DEFAULT_CONFIDENCE_THRESHOLD = 0.7


@dataclass(frozen=True)
class GateDecision:
    """Output of the gate's single decision point."""

    to_status: str
    winners: dict[str, str]
    reason: str
    presentation_class: str
    confidence: float
    confirmation_basis: list[str]


def decide(
    *,
    winners_by_party: dict[str, str],
    confidence: float,
    runoff_indicated: bool,
    citation_id: object,
    runoff_rule: str,
    incumbent_id: str | None,
    sources_disagree: bool,
    fec_contradicts: bool,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
) -> GateDecision:
    """Return a GateDecision for one race.  First matching rule wins.

    Parameters
    ----------
    winners_by_party:
        Mapping of party abbreviation → candidate name/id from the resolver.
        Empty dict means the resolver found no clear winner.
    confidence:
        Resolver confidence score in [0, 1].
    runoff_indicated:
        True when the resolver detected explicit runoff language in the answer.
    citation_id:
        ObjectId (or any truthy value) of the stored results citation, or None
        if no authoritative page was fetched+stored.
    runoff_rule:
        One of "majority_50", "nc_30_threshold", "la_specific", "none".
        Anything other than "none" means this state can trigger a runoff.
    incumbent_id:
        Candidate id of the incumbent in this race, or None if no incumbent /
        open seat.
    sources_disagree:
        True when the resolver detected conflicting sources.
    fec_contradicts:
        True when the FEC status conflicts with the resolver's winner.
    confidence_threshold:
        Minimum confidence required to confirm.  Defaults to 0.7.

    Returns
    -------
    GateDecision
    """
    has_winner = bool(winners_by_party)
    basis: list[str] = []

    # ------------------------------------------------------------------
    # Rule 1 — Sources disagree: highest uncertainty flag
    # ------------------------------------------------------------------
    if sources_disagree:
        return GateDecision(
            to_status=_CONTESTED,
            winners=winners_by_party,
            reason="sources_disagree",
            presentation_class=_UNCERTAINTY,
            confidence=confidence,
            confirmation_basis=[],
        )

    # ------------------------------------------------------------------
    # Rule 2 — Runoff territory
    # ------------------------------------------------------------------
    runoff_state_no_winner = runoff_rule != "none" and not has_winner
    if runoff_indicated or runoff_state_no_winner:
        reason = "runoff_indicated" if runoff_indicated else "runoff_state_no_majority_winner"
        return GateDecision(
            to_status=_RUNOFF_PENDING,
            winners=winners_by_party,
            reason=reason,
            presentation_class=_NEWSWORTHY,
            confidence=confidence,
            confirmation_basis=[],
        )

    # ------------------------------------------------------------------
    # Rule 3 — Insufficient evidence → provisional
    # ------------------------------------------------------------------
    must_flag = (
        not has_winner
        or confidence < confidence_threshold
        or citation_id is None
        or fec_contradicts
    )
    if must_flag:
        flag_reasons: list[str] = []
        if not has_winner:
            flag_reasons.append("no_winner_parsed")
        if confidence < confidence_threshold:
            flag_reasons.append("low_confidence")
        if citation_id is None:
            flag_reasons.append("no_citation")
        if fec_contradicts:
            flag_reasons.append("fec_contradicts")

        return GateDecision(
            to_status=_PROVISIONAL,
            winners=winners_by_party,
            reason=", ".join(flag_reasons),
            presentation_class=_UNCERTAINTY,
            confidence=confidence,
            confirmation_basis=[],
        )

    # ------------------------------------------------------------------
    # Rule 4 — Confirm
    # ------------------------------------------------------------------
    # Belt-and-suspenders: citation_id must be present at this point.
    # Rule 3 already guards this, but we assert here as a hard invariant.
    assert citation_id is not None, (
        "civic-safety violation: gate reached confirmed branch with citation_id=None"
    )

    basis = ["results_page", "perplexity"]
    if fec_contradicts is False and has_winner:
        basis.append("fec_status")

    # Detect incumbent defeat: any winner value differs from incumbent_id
    incumbent_defeated = incumbent_id is not None and any(
        w != incumbent_id for w in winners_by_party.values()
    )
    p_class = _NEWSWORTHY if incumbent_defeated else _ROUTINE

    return GateDecision(
        to_status=_CONFIRMED,
        winners=winners_by_party,
        reason="incumbent_defeated" if incumbent_defeated else "clean_winner",
        presentation_class=p_class,
        confidence=confidence,
        confirmation_basis=basis,
    )
