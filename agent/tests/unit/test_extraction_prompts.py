"""Guards on the position-extraction system prompts.

Two prompts turn page/summary text into per-issue stances:
- ``position_search._STRUCTURE_SYSTEM`` — the LIVE voter-brief structuring pass.
- ``extract._EXTRACT_SYSTEM`` — the cached positions pipeline (T1-T3).

Both must hold two properties at once:
1. **No inference** (the civic-safety spine): never infer a stance from party,
   donors, or omission.
2. **Exhaustive coverage**: extract EVERY issue the text supports — don't stop at
   the first one or two — so a multi-issue page yields multiple cited positions.

These are co-present invariants; a prompt edit that drops either should fail here.
"""

from __future__ import annotations

import pytest

from app.services.positions.extract import _EXTRACT_SYSTEM
from app.tools.position_search import _STRUCTURE_SYSTEM

_PROMPTS = {
    "_STRUCTURE_SYSTEM": _STRUCTURE_SYSTEM,
    "_EXTRACT_SYSTEM": _EXTRACT_SYSTEM,
}


@pytest.mark.unit
@pytest.mark.parametrize("name", _PROMPTS)
def test_prompt_keeps_no_inference_guardrail(name):
    prompt = _PROMPTS[name].lower()
    assert "infer" in prompt  # speaks to inference at all
    assert "never infer" in prompt or "do not infer" in prompt or "not guess" in prompt


@pytest.mark.unit
@pytest.mark.parametrize("name", _PROMPTS)
def test_prompt_demands_exhaustive_coverage(name):
    prompt = _PROMPTS[name].lower()
    assert "every" in prompt  # extract EVERY issue the text supports
    assert "stop after" in prompt or "do not stop" in prompt or "exhaustive" in prompt
