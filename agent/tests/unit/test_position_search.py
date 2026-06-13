

def test_search_candidate_positions_uses_gemini_not_perplexity(monkeypatch):
    """search_candidate_positions must call gemini_grounded_search, not _perplexity_search."""
    from app.tools import position_search
    from app.tools.position_search import search_candidate_positions

    gemini_calls = []

    async def fake_grounded(prompt, **_):
        gemini_calls.append(prompt)
        return ("Supports single payer. [1]", [
            {"title": "campaign.com", "url": "https://campaign.com/health", "snippet": "", "date": None}
        ])

    monkeypatch.setattr(position_search, "_grounded_search", fake_grounded)

    import asyncio
    from unittest.mock import MagicMock
    ctx = MagicMock()
    ctx.state = {}
    result = asyncio.run(search_candidate_positions("Gwen Moore", "WI", "health care", ctx))
    assert gemini_calls, "gemini grounded search was never called"
    assert "DIRECT STATEMENT FOUND" in result
