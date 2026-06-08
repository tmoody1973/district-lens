"""Unit tests for the discovery-only Ballotpedia MCP toolset factory."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.tools import ballotpedia_mcp_toolset as bp


def test_vendored_server_exists_at_default_path():
    """The server is vendored in-repo so it ships with the agent image."""
    assert bp._DEFAULT_SERVER_PATH.is_file()
    assert bp._DEFAULT_SERVER_PATH.name == "server.py"


def test_discovery_surface_excludes_compare_candidates():
    """compare_candidates synthesizes scraped text and must not be exposed."""
    assert "compare_candidates" not in bp._DISCOVERY_TOOLS
    assert "get_ballot_measures" in bp._DISCOVERY_TOOLS
    assert "get_elections_by_state" in bp._DISCOVERY_TOOLS
    assert "summarize_candidate_platform" in bp._DISCOVERY_TOOLS


def test_resolve_server_path_honors_env_override(tmp_path, monkeypatch):
    fake_server = tmp_path / "server.py"
    fake_server.write_text("# stub")
    monkeypatch.setenv("BALLOTPEDIA_MCP_SERVER", str(fake_server))
    assert bp._resolve_server_path() == fake_server


def test_resolve_server_path_raises_when_missing(monkeypatch):
    monkeypatch.setenv("BALLOTPEDIA_MCP_SERVER", "/nonexistent/server.py")
    with pytest.raises(RuntimeError, match="not found"):
        bp._resolve_server_path()


def test_create_toolset_uses_agent_interpreter_and_discovery_filter(monkeypatch):
    """Factory builds an McpToolset spawned with the agent's own interpreter."""
    captured: dict = {}

    class _FakeToolset:
        def __init__(self, *, connection_params, tool_filter, tool_name_prefix):
            captured["tool_filter"] = tool_filter
            captured["tool_name_prefix"] = tool_name_prefix
            captured["command"] = connection_params.server_params.command
            captured["args"] = connection_params.server_params.args

    monkeypatch.setattr(bp, "McpToolset", _FakeToolset)
    bp.create_ballotpedia_mcp_toolset()

    import sys

    assert captured["command"] == sys.executable
    assert captured["args"] == [str(bp._DEFAULT_SERVER_PATH)]
    assert captured["tool_filter"] == bp._DISCOVERY_TOOLS
    assert captured["tool_name_prefix"] == "ballotpedia"
    assert "compare_candidates" not in captured["tool_filter"]
