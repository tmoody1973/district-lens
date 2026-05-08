# Copyright 2026 Tarik Moody
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Layer 2 of the refusal architecture. See docs/REFUSAL_DESIGN.md.
#
# This module is wired as the agent's `before_model_callback`. It runs before
# the LLM is invoked. If the user's last message matches a high-confidence
# refusal pattern, the callback returns an LlmResponse that short-circuits
# the model call. Otherwise it returns None and the agent loop proceeds.
#
# The exact regex patterns are intentionally not in the public design doc;
# they are reviewable here in source.

from __future__ import annotations

import logging
import re

from google.adk.agents.callback_context import CallbackContext
from google.adk.models import LlmRequest, LlmResponse
from google.genai import types

logger = logging.getLogger(__name__)


# TODO(districtlens): tune patterns against Tier 1 eval cases. Keep these as
# high-confidence triggers only. False positives here block legitimate use,
# and Layer 3 (output classifier) catches the subtler cases.
_VOTE_RECOMMENDATION_RE = re.compile(
    r"\b(who should i vote for|who do you recommend|"
    r"who is better|who would you (pick|vote for|choose))\b",
    re.IGNORECASE,
)

_PERSUASION_CONTENT_RE = re.compile(
    r"\b(write (an?|the) (ad|campaign ad|talking points|door[- ]knock\w*)|"
    r"draft (a )?fundraising|persuasive (email|message|copy))\b",
    re.IGNORECASE,
)

_DONOR_INFERENCE_RE = re.compile(
    r"\btook (oil|fossil|big[- ]?\w*|nra|union|corporate)\s+\w*\s*money\s+"
    r"(so|therefore|that means|which means)\b",
    re.IGNORECASE,
)

_TURNOUT_TARGETING_RE = re.compile(
    r"\b(microtarget|turnout strategy|mobilize \w+ voters|"
    r"talking points (for|to) (mobilize|persuade))\b",
    re.IGNORECASE,
)

_CANNED_RESPONSES: dict[str, str] = {
    "vote_recommendation": (
        "I don't make voting recommendations. I can compare what each candidate "
        "has said about an issue you care about, and show the source for each "
        "statement. Which issue would you like to start with?"
    ),
    "persuasion_content": (
        "I don't write campaign content. I can summarize what each candidate "
        "has publicly said about this topic, with citations to the original sources."
    ),
    "donor_inference": (
        "Finance records show contributions and spending. They don't prove a "
        "candidate's policy position. I can look at what the candidate has said "
        "directly, what they've voted on if they are an incumbent, and the finance "
        "data side by side."
    ),
    "turnout_targeting": (
        "I don't generate targeted persuasion or turnout strategy. I can show "
        "neutral, cited evidence about a race so you can evaluate it yourself."
    ),
}


def _match_refusal_category(message: str) -> str | None:
    """Return the refusal category name for a message, or None."""
    if _VOTE_RECOMMENDATION_RE.search(message):
        return "vote_recommendation"
    if _PERSUASION_CONTENT_RE.search(message):
        return "persuasion_content"
    if _DONOR_INFERENCE_RE.search(message):
        return "donor_inference"
    if _TURNOUT_TARGETING_RE.search(message):
        return "turnout_targeting"
    return None


def _last_user_text(llm_request: LlmRequest) -> str:
    """Extract the most recent user-text message from the LLM request."""
    contents = getattr(llm_request, "contents", None) or []
    for content in reversed(contents):
        if getattr(content, "role", None) == "user":
            for part in getattr(content, "parts", None) or []:
                text = getattr(part, "text", None)
                if text:
                    return text
    return ""


def check_input(
    callback_context: CallbackContext,
    llm_request: LlmRequest,
) -> LlmResponse | None:
    """ADK before_model_callback for civic-safety input filtering.

    Wired in agent.py as `Agent(..., before_model_callback=check_input)`.
    Returning a non-None LlmResponse short-circuits the LLM call.
    """
    message = _last_user_text(llm_request)
    if not message:
        return None

    category = _match_refusal_category(message)
    if category is None:
        return None

    logger.info(
        "civic_safety.layer2.refused",
        extra={"category": category, "agent": getattr(callback_context, "agent_name", None)},
    )

    return LlmResponse(
        content=types.Content(
            role="model",
            parts=[types.Part(text=_CANNED_RESPONSES[category])],
        ),
    )
