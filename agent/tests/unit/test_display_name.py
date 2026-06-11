"""FEC raw names can carry doubled commas ("BRINK,, BRIDGET") — candidate
cards must render a single comma so the UI never shows "Brink,, Bridget"."""

from app.tools.mongodb_tools import _display_name, _to_candidate_card


def test_display_name_collapses_double_commas():
    assert _display_name("Brink,, Bridget") == "Brink, Bridget"


def test_display_name_leaves_normal_names_alone():
    assert _display_name("Moore, Gwen S") == "Moore, Gwen S"


def test_candidate_card_uses_display_name():
    card = _to_candidate_card(
        {"candidate_id": "X1", "name": "Brink,, Bridget", "party": "DEM"},
        "2026-H-MI-07",
    )
    assert card["name"] == "Brink, Bridget"
