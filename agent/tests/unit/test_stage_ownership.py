"""Only the brief pipeline (and finish_brief) may write coagent `stage`.

Chat tools writing stage flips the web panel into "building…" with a frozen
receipt mid-conversation, because nothing in a chat turn ever advances the
stage to "complete" (prod bug, 2026-06-10 review). The deterministic pipeline
writes its own stage transitions (brief_pipeline.py), so tools must not.
"""

from __future__ import annotations

import re
from pathlib import Path

_TOOLS_DIR = Path(__file__).resolve().parents[2] / "app" / "tools"
_STAGE_OWNERS = {"brief_pipeline.py", "finish_brief.py"}
_STAGE_WRITE = re.compile(r'state\[\s*[\'"]stage[\'"]\s*\]\s*=|[\'"]stage[\'"]\s*:')


def test_chat_tools_never_write_stage():
    offenders: list[str] = []
    for path in sorted(_TOOLS_DIR.glob("*.py")):
        if path.name in _STAGE_OWNERS:
            continue
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            if _STAGE_WRITE.search(line) and not line.lstrip().startswith("#"):
                offenders.append(f"{path.name}:{lineno}: {line.strip()}")
    assert not offenders, "stage writes outside the pipeline:\n" + "\n".join(offenders)
