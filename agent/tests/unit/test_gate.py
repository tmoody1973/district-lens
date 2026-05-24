"""Table-driven tests for the deterministic confirm-or-flag gate.

Each test maps to one row in the decision table from the P1 plan (Task 5).
The gate is a pure function — no I/O, no Mongo, no network.
"""

from __future__ import annotations

import pytest

from app.refresh import gate

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _inp(**kw) -> dict:
    """Return a full set of gate.decide inputs with clean defaults, overridable."""
    base = {
        "winners_by_party": {"REP": "c1"},
        "confidence": 0.9,
        "runoff_indicated": False,
        "citation_id": 1,
        "runoff_rule": "none",
        "incumbent_id": None,
        "sources_disagree": False,
        "fec_contradicts": False,
    }
    base.update(kw)
    return base


# ---------------------------------------------------------------------------
# Table-driven scenario tests (one per decision-table row)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_clean_confirms_as_routine():
    """Clean winner + citation + no runoff + FEC agrees → confirmed / routine."""
    d = gate.decide(**_inp())
    assert d.to_status == "confirmed"
    assert d.presentation_class == "routine"


@pytest.mark.unit
def test_no_citation_is_provisional_with_genuine_uncertainty():
    """Winners present but no authoritative citation fetched → provisional / genuine_uncertainty."""
    d = gate.decide(**_inp(citation_id=None))
    assert d.to_status == "provisional"
    assert d.presentation_class == "genuine_uncertainty"


@pytest.mark.unit
def test_runoff_indicated_is_pending_and_newsworthy():
    """Resolver signals runoff → runoff_pending / newsworthy_signal."""
    d = gate.decide(**_inp(runoff_indicated=True))
    assert d.to_status == "runoff_pending"
    assert d.presentation_class == "newsworthy_signal"


@pytest.mark.unit
def test_runoff_state_no_majority_winner_is_pending_and_newsworthy():
    """Runoff-rule state with no parsed winner → runoff_pending / newsworthy_signal."""
    d = gate.decide(**_inp(runoff_rule="majority_50", winners_by_party={}, confidence=0.3, citation_id=None))
    assert d.to_status == "runoff_pending"
    assert d.presentation_class == "newsworthy_signal"


@pytest.mark.unit
def test_incumbent_loss_confirms_as_newsworthy():
    """Winner differs from incumbent_id + citation stored → confirmed / newsworthy_signal."""
    d = gate.decide(**_inp(winners_by_party={"REP": "challenger1"}, incumbent_id="incumbent1"))
    assert d.to_status == "confirmed"
    assert d.presentation_class == "newsworthy_signal"


@pytest.mark.unit
def test_low_confidence_flags_as_provisional():
    """Resolver returns low confidence (no clear winner, not a runoff state) → provisional / genuine_uncertainty."""
    d = gate.decide(**_inp(winners_by_party={}, confidence=0.2))
    assert d.to_status == "provisional"
    assert d.presentation_class == "genuine_uncertainty"


@pytest.mark.unit
def test_sources_disagree_is_contested_with_genuine_uncertainty():
    """Sources-disagree flag overrides everything → contested / genuine_uncertainty."""
    d = gate.decide(**_inp(sources_disagree=True))
    assert d.to_status == "contested"
    assert d.presentation_class == "genuine_uncertainty"


# ---------------------------------------------------------------------------
# FEC-contradicts scenario
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_fec_contradicts_flags_as_provisional():
    """FEC data contradicts resolver winner → provisional / genuine_uncertainty."""
    d = gate.decide(**_inp(fec_contradicts=True))
    assert d.to_status == "provisional"
    assert d.presentation_class == "genuine_uncertainty"


# ---------------------------------------------------------------------------
# Civic-safety invariant: NEVER confirm without a citation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_never_confirmed_without_citation_civic_invariant():
    """decide() must never return confirmed when citation_id is None.

    We supply inputs that would otherwise confirm (high confidence, winners
    present, no disagreement, no runoff) but strip the citation — the result
    MUST be provisional, and the internal assert must not fire.
    """
    d = gate.decide(**_inp(citation_id=None, winners_by_party={"REP": "c1"}, confidence=0.99))
    assert d.to_status != "confirmed", (
        "civic-safety violation: gate returned 'confirmed' with citation_id=None"
    )
    assert d.to_status == "provisional"
    assert d.presentation_class == "genuine_uncertainty"


@pytest.mark.unit
def test_gate_decision_dataclass_fields():
    """GateDecision exposes all expected fields."""
    d = gate.decide(**_inp())
    assert hasattr(d, "to_status")
    assert hasattr(d, "winners")
    assert hasattr(d, "reason")
    assert hasattr(d, "presentation_class")
    assert hasattr(d, "confidence")
    assert hasattr(d, "confirmation_basis")


@pytest.mark.unit
def test_confirmation_basis_populated_for_confirmed():
    """Confirmed decisions must list at least one confirmation signal."""
    d = gate.decide(**_inp(citation_id=42))
    assert d.to_status == "confirmed"
    assert len(d.confirmation_basis) >= 1
