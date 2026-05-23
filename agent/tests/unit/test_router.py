"""Unit tests for the DistrictLens root router.

The router inspects the latest user message: a "Build a complete voter brief
for: <addr>" message runs the deterministic pipeline; anything else delegates
to the chat LlmAgent. Both paths must stream the chosen sub-agent's events.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import AsyncGenerator

import pytest
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from app.agent import DistrictLensRouter, _is_brief_trigger
from app.tools.brief_pipeline import extract_brief_address


def _make_ctx(user_text: str) -> SimpleNamespace:
    session = SimpleNamespace(state={})
    content = SimpleNamespace(parts=[SimpleNamespace(text=user_text)])
    return SimpleNamespace(session=session, user_content=content)


@pytest.mark.unit
def test_brief_trigger_detection():
    assert _is_brief_trigger("Build a complete voter brief for: 123 Oak St, WI")
    assert not _is_brief_trigger("Show me all 2026 congressional races in WI")
    assert not _is_brief_trigger("What did the incumbent say about housing?")


@pytest.mark.unit
def test_extract_brief_address():
    assert (
        extract_brief_address("Build a complete voter brief for: 123 Oak St, Racine WI")
        == "123 Oak St, Racine WI"
    )
    assert extract_brief_address("hello there") is None
    assert extract_brief_address("Build a complete voter brief for:   ") is None


_RAN: list[str] = []


class _FakeSubAgent(BaseAgent):
    """Real BaseAgent test double: records that it ran and yields a sentinel event.

    Overrides run_async (not @final) so the router's delegation path is exercised
    without standing up a real InvocationContext.
    """

    async def run_async(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        _RAN.append(self.name)
        yield Event(author=self.name)


def _make_router() -> DistrictLensRouter:
    _RAN.clear()
    return DistrictLensRouter(
        name="districtlens_root",
        sub_agents=[
            _FakeSubAgent(name="voter_brief_pipeline"),
            _FakeSubAgent(name="districtlens_chat"),
        ],
    )


async def _run_router(router, ctx) -> list:
    events = []
    async for event in router._run_async_impl(ctx):
        events.append(event)
    return events


@pytest.mark.unit
@pytest.mark.asyncio
async def test_router_runs_pipeline_on_brief_trigger():
    router = _make_router()
    ctx = _make_ctx("Build a complete voter brief for: 123 Oak St, Racine WI")

    events = await _run_router(router, ctx)

    assert _RAN == ["voter_brief_pipeline"]
    assert [e.author for e in events] == ["voter_brief_pipeline"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_router_delegates_to_chat_on_other_messages():
    router = _make_router()
    ctx = _make_ctx("What has the incumbent said about housing?")

    events = await _run_router(router, ctx)

    assert _RAN == ["districtlens_chat"]
    assert [e.author for e in events] == ["districtlens_chat"]
