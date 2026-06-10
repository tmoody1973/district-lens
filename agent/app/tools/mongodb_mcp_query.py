"""Read-only MongoDB MCP query helper for the deterministic brief pipeline.

The brief pipeline reads its data via pymongo, but the hackathon MongoDB track
requires a visible partner-MCP call in the demo path. This helper makes one real
read-only `count` call through the same `mongodb-mcp-server` the chat agent uses,
so a genuine MCP round-trip appears in the voter-brief activity trace.

Any failure returns None — an MCP hiccup must never abort the brief.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from app.tools.mongodb_mcp_toolset import mcp_server_command

logger = logging.getLogger(__name__)

# Hard ceiling on the whole MCP round-trip (spawn + initialize + count). A cold
# Cloud Run instance once blocked ~3min resolving the server via npx, which
# outlived the SSE stream and froze the brief receipt (2026-06-11 incident).
_MCP_TIMEOUT_S = 12.0

# The MCP server replies with prose: 'Found N documents in the collection "x" …'.
_COUNT_RE = re.compile(r"Found (\d+) document")


def parse_count_text(text: str) -> int | None:
    """Extract the integer from the MCP count tool's 'Found N documents…' reply."""
    match = _COUNT_RE.search(text or "")
    return int(match.group(1)) if match else None


async def mongodb_mcp_count(
    collection: str, query: dict, timeout_s: float = _MCP_TIMEOUT_S
) -> int | None:
    """Count documents via the read-only MongoDB MCP server. None on any failure.

    Bounded by ``timeout_s`` end to end — a slow or hung server spawn degrades
    to None instead of blocking the brief pipeline.
    """
    uri = os.environ.get("MONGODB_URI", "")
    if not uri:
        return None

    command, args = mcp_server_command()
    params = StdioServerParameters(
        command=command,
        args=args,
        env={**os.environ, "MDB_MCP_CONNECTION_STRING": uri},
    )

    try:
        return await asyncio.wait_for(_run_count(params, collection, query), timeout_s)
    except TimeoutError:
        logger.warning("mongodb_mcp_count timed out after %.0fs", timeout_s)
        return None
    except Exception as exc:  # MCP/subprocess failure must never abort the brief
        logger.warning("mongodb_mcp_count failed: %s", exc)
        return None


async def _run_count(
    params: StdioServerParameters, collection: str, query: dict
) -> int | None:
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(
                "count",
                {
                    "database": "districtlens",
                    "collection": collection,
                    "query": query,
                },
            )
            for chunk in result.content:
                parsed = parse_count_text(getattr(chunk, "text", ""))
                if parsed is not None:
                    return parsed
    return None
