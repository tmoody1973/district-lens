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
# Refusal architecture: before/after model callbacks (Layers 2-3).
# See docs/REFUSAL_DESIGN.md for the full layered design.

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from pathlib import Path

from google.adk.agents import Agent, BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.apps import App
from google.adk.events import Event
from google.adk.models import Gemini
from google.adk.utils.context_utils import Aclosing
from google.genai import types

from app.middleware import check_input, check_output
from app.tools.brief_pipeline import (
    VoterBriefPipeline,
    _latest_user_text,
    is_brief_trigger,
)
from app.tools.ballotpedia_mcp_toolset import create_ballotpedia_mcp_toolset
from app.tools.district_by_city import find_district_by_city
from app.tools.district_lookup import lookup_district
from app.tools.finish_brief import finish_brief
from app.tools.mongodb_mcp_toolset import create_mongodb_mcp_toolset
from app.tools.mongodb_tools import (
    find_candidate,
    get_candidate_finance,
    get_incumbent_legislation,
    get_race_candidates,
    get_race_finance_brief,
    get_voting_record,
)
from app.tools.position_search import search_candidate_positions
from app.tools.state_races import get_state_races

logger = logging.getLogger(__name__)

_CHAT_AGENT_NAME = "districtlens_chat"
_PIPELINE_AGENT_NAME = "voter_brief_pipeline"


def _is_brief_trigger(message_text: str) -> bool:
    """True when the message is a voter-brief trigger (address or race key)."""
    return is_brief_trigger(message_text)

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
        find_district_by_city,
        get_state_races,
        get_race_candidates,
        get_race_finance_brief,
        get_candidate_finance,
        get_incumbent_legislation,
        get_voting_record,
        find_candidate,
        search_candidate_positions,
        finish_brief,
    ]
    try:
        mcp_toolset = create_mongodb_mcp_toolset()
        tools.append(mcp_toolset)
        logger.info("MongoDB MCP toolset registered (partner integration)")
    except Exception as exc:
        # Non-fatal: agent works without MCP, but judging may note its absence
        logger.warning("MongoDB MCP toolset not available: %s", exc)
    try:
        ballotpedia_toolset = create_ballotpedia_mcp_toolset()
        tools.append(ballotpedia_toolset)
        logger.info("Ballotpedia MCP toolset registered (discovery-only)")
    except Exception as exc:
        # Non-fatal: chat works without Ballotpedia discovery tools
        logger.warning("Ballotpedia MCP toolset not available: %s", exc)
    return tools


class DistrictLensRouter(BaseAgent):
    """Routes each turn: deterministic brief pipeline, or LLM chat delegation.

    A "Build a complete voter brief for: <address>" message runs the
    VoterBriefPipeline (which guarantees stances always run, ADR 0001).
    Every other message delegates to the chat LlmAgent (journalist mode,
    issue follow-ups, refusals) — keeping the input/output guardrails on it.
    Both paths stream the chosen sub-agent's events to the AG-UI client.
    """

    def _sub_agent(self, name: str) -> BaseAgent:
        agent = self.find_sub_agent(name)
        if agent is None:
            raise RuntimeError(f"Router sub-agent '{name}' is not registered")
        return agent

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        message_text = _latest_user_text(ctx)
        target_name = (
            _PIPELINE_AGENT_NAME if _is_brief_trigger(message_text) else _CHAT_AGENT_NAME
        )
        target = self._sub_agent(target_name)
        async with Aclosing(target.run_async(ctx)) as agen:
            async for event in agen:
                yield event


def _build_chat_agent() -> Agent:
    """The LLM-driven chat agent: journalist mode, follow-ups, and guardrails."""
    return Agent(
        name=_CHAT_AGENT_NAME,
        model=Gemini(
            model="gemini-3.1-pro-preview",
            retry_options=types.HttpRetryOptions(attempts=3),
        ),
        instruction=_load_system_instruction(),
        tools=_build_tools(),
        before_model_callback=check_input,
        after_model_callback=check_output,
    )


root_agent = DistrictLensRouter(
    name="districtlens_root",
    sub_agents=[
        VoterBriefPipeline(name=_PIPELINE_AGENT_NAME),
        _build_chat_agent(),
    ],
)


app = App(
    root_agent=root_agent,
    name="app",
)
