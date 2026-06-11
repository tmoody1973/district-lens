#
# Layer 3 of the refusal architecture. See docs/REFUSAL_DESIGN.md.
#
# This module is wired as the agent's `after_model_callback`. It inspects the
# LLM's draft response and replaces it with a generic refusal if a Gemini
# Flash-Lite classifier detects a voting recommendation, partisan persuasion,
# or unsupported policy attribution. Latency budget: 150-250 ms.
#
# Fail-secure: if the classifier itself raises, we treat the response as
# unsafe and replace it. Better to refuse a legitimate answer than to ship
# unsafe output.

from __future__ import annotations

import json
import logging
from typing import Any

from google.adk.agents.callback_context import CallbackContext
from google.adk.models import LlmResponse
from google.genai import Client, types

logger = logging.getLogger(__name__)


_CLASSIFIER_MODEL = "gemini-3.1-flash-lite"

_CLASSIFIER_PROMPT = (
    "You are a civic-safety classifier for an election-information assistant. "
    "Given an answer that the assistant is about to send to a user, decide "
    "whether the answer contains any of: a voting recommendation, partisan "
    "persuasion content, or a policy attribution to a candidate that is not "
    "supported by a cited source. Reply with strict JSON of the form "
    '{"violation": true|false, "category": "vote_recommendation"|"persuasion"|'
    '"unsupported_attribution"|null, "reason": "<short reason>"}. '
    "The candidate answer is below."
)


_GENERIC_REFUSAL = (
    "I drafted a response but caught a civic-safety issue and replaced it. "
    "I don't make voting recommendations, generate persuasion content, or "
    "attribute positions to candidates without a cited source. Tell me which "
    "issue you'd like cited evidence on, and I'll start over with the source "
    "documents I have indexed."
)


def _draft_text(llm_response: LlmResponse) -> str:
    """Extract text from an LlmResponse."""
    content = getattr(llm_response, "content", None)
    if content is None:
        return ""
    for part in getattr(content, "parts", None) or []:
        text = getattr(part, "text", None)
        if text:
            return text
    return ""


def _classify(draft: str, client: Client) -> dict[str, Any]:
    """Run the classifier against a draft. Returns parsed JSON dict."""
    full_prompt = f"{_CLASSIFIER_PROMPT}\n\n---\n{draft}\n---"
    result = client.models.generate_content(
        model=_CLASSIFIER_MODEL,
        contents=full_prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,
        ),
    )
    raw = result.text or "{}"
    return json.loads(raw)


def _refusal_response() -> LlmResponse:
    """Build a generic refusal LlmResponse."""
    return LlmResponse(
        content=types.Content(
            role="model",
            parts=[types.Part(text=_GENERIC_REFUSAL)],
        ),
    )


def check_output(
    callback_context: CallbackContext,
    llm_response: LlmResponse,
) -> LlmResponse | None:
    """ADK after_model_callback for civic-safety output filtering.

    Wired in agent.py as `Agent(..., after_model_callback=check_output)`.
    Returns a replacement LlmResponse if the classifier flags the draft.
    Returns None to keep the original draft.

    Fail-secure: if the classifier raises, replaces the draft with a refusal
    rather than letting potentially unsafe output ship.
    """
    draft = _draft_text(llm_response)
    if not draft:
        return None

    try:
        client = Client()
        classifier_result = _classify(draft, client)
    except Exception:
        logger.exception(
            "civic_safety.layer3.classifier_error",
            extra={"agent": getattr(callback_context, "agent_name", None)},
        )
        # Fail-secure: replace with generic refusal rather than ship draft.
        return _refusal_response()

    if classifier_result.get("violation") is True:
        logger.warning(
            "civic_safety.layer3.violation",
            extra={
                "category": classifier_result.get("category"),
                "reason": classifier_result.get("reason"),
                "draft_len": len(draft),
                "agent": getattr(callback_context, "agent_name", None),
            },
        )
        return _refusal_response()

    return None
