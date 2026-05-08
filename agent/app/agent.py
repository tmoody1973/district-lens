# Copyright 2026 Tarik Moody
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# DistrictLens root agent. Real tools (FEC, Congress.gov, MongoDB MCP,
# Geocodio, source discovery, claim extraction) are added in subsequent
# build phases. The civic-safety system prompt at app/prompts/civic_safety.md
# is the canonical refusal-rule source. See docs/REFUSAL_DESIGN.md for the
# layered refusal architecture wired below via before/after model callbacks.

from __future__ import annotations

from pathlib import Path

from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.genai import types

from app.middleware import check_input, check_output

_PROMPT_PATH = Path(__file__).parent / "prompts" / "civic_safety.md"


def _load_system_instruction() -> str:
    """Load the civic-safety system prompt from the committed file."""
    return _PROMPT_PATH.read_text(encoding="utf-8")


def lookup_district_placeholder(address_or_zip: str) -> str:
    """Placeholder tool for address-to-district resolution.

    The real implementation will call Geocod.io with `cd120,cd` field append
    and return the resolved race_key plus boundary source. See
    docs/DECISIONS_LOG.md §3.5 for the locked behavior.

    Args:
        address_or_zip: A full street address, ZIP code, or "lat,lng" pair.

    Returns:
        A short string describing what the real tool will return. Always
        ends with a "(placeholder)" tag so the agent never claims real data
        from this stub.
    """
    return (
        f"Resolved district for input '{address_or_zip}' would appear here. "
        "(placeholder — real Geocod.io integration pending)"
    )


root_agent = Agent(
    name="districtlens_root",
    model=Gemini(
        model="gemini-3.1-pro-preview",
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    instruction=_load_system_instruction(),
    tools=[lookup_district_placeholder],
    before_model_callback=check_input,
    after_model_callback=check_output,
)


app = App(
    root_agent=root_agent,
    name="app",
)
