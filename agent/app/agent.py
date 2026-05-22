# Copyright 2026 Tarik Moody
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# DistrictLens root agent.
# Civic-safety system prompt: app/prompts/civic_safety.md (Layer 1).
# Refusal architecture: before/after model callbacks (Layers 2–3).
# See docs/REFUSAL_DESIGN.md for the full layered design.

from __future__ import annotations

import logging
from pathlib import Path

from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.genai import types

from app.middleware import check_input, check_output
from app.tools.district_lookup import lookup_district
from app.tools.position_search import search_candidate_positions
from app.tools.mongodb_mcp_toolset import create_mongodb_mcp_toolset
from app.tools.mongodb_tools import (
    find_candidate,
    get_candidate_finance,
    get_incumbent_legislation,
    get_race_candidates,
    get_race_finance_brief,
)

logger = logging.getLogger(__name__)

_PROMPT_PATH = Path(__file__).parent / "prompts" / "civic_safety.md"


def _load_system_instruction() -> str:
    """Load the civic-safety system prompt from the committed file."""
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _build_tools() -> list:
    """Build the full tool list including the MongoDB MCP toolset.

    MongoDB MCP Server (partner integration, DECISIONS_LOG §2.3) is added
    as a McpToolset spawning mongodb-mcp-server via stdio. Custom tools
    provide structured civic-specific wrappers on top of the raw MCP access.
    """
    tools: list = [
        lookup_district,
        get_race_candidates,
        get_race_finance_brief,
        get_candidate_finance,
        get_incumbent_legislation,
        find_candidate,
        search_candidate_positions,
    ]
    try:
        mcp_toolset = create_mongodb_mcp_toolset()
        tools.append(mcp_toolset)
        logger.info("MongoDB MCP toolset registered (partner integration)")
    except Exception as exc:
        # Non-fatal: agent works without MCP, but judging may note its absence
        logger.warning("MongoDB MCP toolset not available: %s", exc)
    return tools


root_agent = Agent(
    name="districtlens_root",
    model=Gemini(
        model="gemini-3.1-pro-preview",
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    instruction=_load_system_instruction(),
    tools=_build_tools(),
    before_model_callback=check_input,
    after_model_callback=check_output,
)


app = App(
    root_agent=root_agent,
    name="app",
)
