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
from app.tools.district_lookup import lookup_district
from app.tools.mongodb_tools import (
    find_candidate,
    get_candidate_finance,
    get_race_candidates,
    get_race_finance_brief,
)

_PROMPT_PATH = Path(__file__).parent / "prompts" / "civic_safety.md"


def _load_system_instruction() -> str:
    """Load the civic-safety system prompt from the committed file."""
    return _PROMPT_PATH.read_text(encoding="utf-8")


root_agent = Agent(
    name="districtlens_root",
    model=Gemini(
        model="gemini-3.1-pro-preview",
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    instruction=_load_system_instruction(),
    tools=[
        lookup_district,
        get_race_candidates,
        get_race_finance_brief,
        get_candidate_finance,
        find_candidate,
    ],
    before_model_callback=check_input,
    after_model_callback=check_output,
)


app = App(
    root_agent=root_agent,
    name="app",
)
