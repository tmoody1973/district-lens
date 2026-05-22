"""ADK tool: mark a voter brief as complete."""

from __future__ import annotations

from google.adk.tools import ToolContext


def finish_brief(race_key: str, tool_context: ToolContext) -> str:
    """Mark a voter brief as complete after all evidence has been gathered.

    Call this as the final step after completing all data gathering:
    candidates, finance, legislation, and position searches. Sets the
    brief stage to 'complete' so the frontend receipt shows a green bar
    and the Share Brief button becomes available.

    Args:
        race_key: The race identifier, e.g. '2026-H-WI-04'.
    """
    tool_context.state["stage"] = "complete"
    tool_context.state["briefReady"] = True
    tool_context.state["status_message"] = ""
    return f"Brief for {race_key} is complete."
