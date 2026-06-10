"""MongoDB MCP toolset factory for the DistrictLens ADK agent.

Spawns mongodb-mcp-server (Node.js) as a stdio child process and wraps
it with ADK's McpToolset. This is the visible partner integration for the
hackathon — tool calls appear in the ADK activity trace and satisfy the
"at least one MCP-backed workflow" judging requirement.

DECISIONS_LOG §2.3: Python ADK process spawns mongodb-mcp-server as a
stdio subprocess. Uses --readOnly flag for demo safety.

Usage:
    from app.tools.mongodb_mcp_toolset import create_mongodb_mcp_toolset
    # In agent.py, add to tools list via get_mcp_tools() at startup.
"""

from __future__ import annotations

import logging
import os
import shutil

from google.adk.tools.mcp_tool.mcp_toolset import (
    McpToolset,
    StdioConnectionParams,
    StdioServerParameters,
)

logger = logging.getLogger(__name__)


def _find_npx() -> str:
    """Resolve the npx binary path robustly."""
    npx = shutil.which("npx")
    if npx:
        return npx
    # Fallback for Cloud Run where PATH may differ
    for candidate in ["/usr/local/bin/npx", "/usr/bin/npx", "/opt/homebrew/bin/npx"]:
        if os.path.isfile(candidate):
            return candidate
    return "npx"  # last resort — let it fail with a clear error


def mcp_server_command() -> tuple[str, list[str]]:
    """Resolve how to spawn mongodb-mcp-server: installed binary first.

    The Dockerfile installs mongodb-mcp-server globally, so the binary spawns
    with no npm-registry resolution. `npx -y` re-resolves "latest" from the
    registry on cold starts, which blocked a brief ~3min in prod (2026-06-11).
    """
    binary = shutil.which("mongodb-mcp-server")
    if binary:
        return binary, ["--readOnly"]
    return _find_npx(), ["-y", "mongodb-mcp-server", "--readOnly"]


def create_mongodb_mcp_toolset() -> McpToolset:
    """Create a read-only MongoDB MCP toolset connected to the Atlas cluster.

    Spawns `npx -y mongodb-mcp-server --readOnly` as a stdio child and
    registers its tools with the ADK agent. The MDB_MCP_CONNECTION_STRING
    env var is set from MONGODB_URI (same credential, different key name
    expected by the MCP server).

    Returns:
        McpToolset wired to the MongoDB Atlas M0 cluster.
    """
    mongo_uri = os.environ.get("MONGODB_URI", "")
    if not mongo_uri:
        raise RuntimeError("MONGODB_URI not set — cannot start MongoDB MCP server")

    command, args = mcp_server_command()
    logger.info("Starting MongoDB MCP server via %s", command)

    return McpToolset(
        connection_params=StdioConnectionParams(
            server_params=StdioServerParameters(
                command=command,
                args=args,
                env={
                    **os.environ,
                    # MongoDB MCP server reads MDB_MCP_CONNECTION_STRING
                    "MDB_MCP_CONNECTION_STRING": mongo_uri,
                },
            ),
            timeout=30.0,
        ),
        # Only expose database query tools — skip Atlas admin/cluster tools
        tool_filter=[
            "find",
            "aggregate",
            "count",
            "listCollections",
            "listDatabases",
        ],
        tool_name_prefix="mongodb",
    )
