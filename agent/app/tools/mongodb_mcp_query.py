"""Read-only MongoDB MCP query helper for the deterministic brief pipeline.

The brief pipeline reads its data via pymongo, but the hackathon MongoDB track
requires a visible partner-MCP call in the demo path. This helper makes one real
read-only `count` call through the same `mongodb-mcp-server` the chat agent uses,
so a genuine MCP round-trip appears in the voter-brief activity trace.

Any failure returns None — an MCP hiccup must never abort the brief.
"""

from __future__ import annotations

import logging
import os
import re

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from app.tools.mongodb_mcp_toolset import _find_npx

logger = logging.getLogger(__name__)

# The MCP server replies with prose: 'Found N documents in the collection "x" …'.
_COUNT_RE = re.compile(r"Found (\d+) document")


def parse_count_text(text: str) -> int | None:
    """Extract the integer from the MCP count tool's 'Found N documents…' reply."""
    match = _COUNT_RE.search(text or "")
    return int(match.group(1)) if match else None


async def mongodb_mcp_count(collection: str, query: dict) -> int | None:
    """Count documents via the read-only MongoDB MCP server. None on any failure."""
    uri = os.environ.get("MONGODB_URI", "")
    if not uri:
        return None

    params = StdioServerParameters(
        command=_find_npx(),
        args=["-y", "mongodb-mcp-server", "--readOnly"],
        env={**os.environ, "MDB_MCP_CONNECTION_STRING": uri},
    )

    count: int | None = None
    try:
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
                        count = parsed
                        break
    except Exception as exc:  # MCP/subprocess failure must never abort the brief
        logger.warning("mongodb_mcp_count failed: %s", exc)
        return None
    return count
