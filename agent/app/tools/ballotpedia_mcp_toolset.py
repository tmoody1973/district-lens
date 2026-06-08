"""Ballotpedia MCP toolset factory (discovery-only) for the DistrictLens agent.

Spawns the vendored Ballotpedia MCP server (app/mcp_servers/ballotpedia/server.py)
as a stdio child using the agent's OWN Python interpreter (sys.executable), then
wraps it with ADK's McpToolset. Running under the agent interpreter means no
second virtualenv and no extra runtime (the server needs only mcp + httpx +
beautifulsoup4, all agent dependencies), so it deploys to Cloud Run unchanged.

DISCOVERY ONLY — governance contract (see citations.md, civic_safety.md):
These tools surface WHAT races and ballot measures exist and WHERE the
underlying Ballotpedia pages live. Ballotpedia is a secondary wiki source and
its scraped output is never a citation. Anything the agent cites must first be
fetched and stored through the Firecrawl evidence store. `compare_candidates`
is deliberately NOT exposed: it synthesizes scraped platform text, which invites
treating an un-stored snippet as evidence.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from google.adk.tools.mcp_tool.mcp_toolset import (
    McpToolset,
    StdioConnectionParams,
    StdioServerParameters,
)

logger = logging.getLogger(__name__)

_DEFAULT_SERVER_PATH = (
    Path(__file__).resolve().parent.parent / "mcp_servers" / "ballotpedia" / "server.py"
)

# Discovery surface only — compare_candidates is intentionally withheld.
_DISCOVERY_TOOLS = [
    "get_ballot_by_zip",
    "get_elections_by_state",
    "get_ballot_measures",
    "search_candidates",
    "summarize_candidate_platform",
]


def _resolve_server_path() -> Path:
    """Locate the vendored server, allowing an env override for non-default layouts."""
    override = os.environ.get("BALLOTPEDIA_MCP_SERVER", "")
    server_path = Path(override) if override else _DEFAULT_SERVER_PATH
    if not server_path.is_file():
        raise RuntimeError(
            f"Ballotpedia MCP server not found at {server_path} "
            "(set BALLOTPEDIA_MCP_SERVER to override)."
        )
    return server_path


def create_ballotpedia_mcp_toolset() -> McpToolset:
    """Create the discovery-only Ballotpedia MCP toolset.

    Spawns the vendored server with the agent's interpreter and exposes only the
    discovery tools, namespaced under the `ballotpedia` prefix so they are easy
    to spot in the ADK activity trace.

    Returns:
        McpToolset wired to the vendored Ballotpedia stdio server.
    """
    server_path = _resolve_server_path()
    logger.info("Starting Ballotpedia MCP server via %s", server_path)

    return McpToolset(
        connection_params=StdioConnectionParams(
            server_params=StdioServerParameters(
                command=sys.executable,
                args=[str(server_path)],
                env={**os.environ},
            ),
            timeout=30.0,
        ),
        tool_filter=_DISCOVERY_TOOLS,
        tool_name_prefix="ballotpedia",
    )
