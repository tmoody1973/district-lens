from app.tools.mongodb_mcp_query import parse_count_text


def test_parse_count_text_extracts_number():
    text = 'Found 4 documents in the collection "candidates" that matched the query.'
    assert parse_count_text(text) == 4


def test_parse_count_text_handles_singular():
    assert parse_count_text("Found 1 document in the collection.") == 1


def test_parse_count_text_none_when_no_match():
    assert parse_count_text("no count here") is None
    assert parse_count_text("") is None


def test_mcp_count_times_out_instead_of_blocking(monkeypatch):
    """A hung MCP server spawn must degrade to None within the timeout,
    never block the brief pipeline (prod incident 2026-06-11: cold-start npx
    blocked ~3min, the SSE stream died, receipt froze at Candidates loaded)."""
    import asyncio
    from contextlib import asynccontextmanager

    from app.tools import mongodb_mcp_query as q

    @asynccontextmanager
    async def hung_stdio_client(_params):
        await asyncio.sleep(3600)
        yield (None, None)

    monkeypatch.setenv("MONGODB_URI", "mongodb://example.invalid/db")
    monkeypatch.setattr(q, "stdio_client", hung_stdio_client)

    async def run():
        return await asyncio.wait_for(
            q.mongodb_mcp_count("candidates", {}, timeout_s=0.2), timeout=2.0
        )

    assert asyncio.run(run()) is None


def test_mcp_server_command_prefers_installed_binary(monkeypatch):
    """When mongodb-mcp-server is installed globally (Dockerfile), spawn it
    directly — no npx, no npm-registry resolution on cold start."""
    from app.tools import mongodb_mcp_toolset as t

    monkeypatch.setattr(
        t.shutil, "which",
        lambda name: "/usr/bin/mongodb-mcp-server" if name == "mongodb-mcp-server" else None,
    )
    command, args = t.mcp_server_command()
    assert command == "/usr/bin/mongodb-mcp-server"
    assert args == ["--readOnly"]


def test_mcp_server_command_falls_back_to_npx(monkeypatch):
    from app.tools import mongodb_mcp_toolset as t

    monkeypatch.setattr(
        t.shutil, "which",
        lambda name: "/usr/bin/npx" if name == "npx" else None,
    )
    command, args = t.mcp_server_command()
    assert command == "/usr/bin/npx"
    assert args == ["-y", "mongodb-mcp-server", "--readOnly"]
