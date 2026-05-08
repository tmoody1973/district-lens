# Google Agents CLI Research Notes for DistrictLens

Google's `agents-cli` is relevant and beneficial for the DistrictLens hackathon build. The official repository describes it as **"The CLI and skills for building agents on Gemini Enterprise Agent Platform"** and positions it as a tool that turns coding assistants such as Claude Code into expert builders for Google Cloud agents.

The README states that Agents CLI works with **Claude Code**, **Gemini CLI**, **Codex**, and other coding agents. This makes it appropriate for the current DistrictLens package, which is designed as a Claude Code handoff.

The documented workflow supports DistrictLens in four ways. First, `agents-cli scaffold <name>` can create the initial ADK agent project. Second, `agents-cli run "prompt"` can run local prompt tests during development. Third, `agents-cli eval run` can support hackathon-relevant evidence quality, citation, and guardrail evaluations. Fourth, `agents-cli deploy` can deploy to Google Cloud, including Cloud Run or Agent Runtime depending on the selected path.

The README also clarifies that Agents CLI is not a replacement for Claude Code or Gemini CLI. It is a tool **for** coding agents, and it provides commands and skills for building, evaluating, deploying, and publishing ADK agents on Google Cloud.

For DistrictLens, the recommended architecture update is to make Agents CLI the **primary implementation scaffold** while keeping the Google Cloud Agent Starter Pack as a compatible reference architecture. This means Claude Code should first install/setup Agents CLI skills, scaffold the `districtlens-agent` project, implement the FEC/Congress/search/MCP tools inside the scaffolded ADK structure, then add web/API surfaces and deployment.

Key documented commands relevant to DistrictLens:

| Command | DistrictLens Use |
|---|---|
| `uvx google-agents-cli setup` | Install CLI and skills for Claude Code. |
| `agents-cli scaffold districtlens-agent` | Create the Google Cloud ADK project scaffold. |
| `agents-cli install` | Install project dependencies. |
| `agents-cli run "prompt"` | Smoke-test agent behavior locally. |
| `agents-cli eval run` | Run citation, nonpartisanship, and tool-use evaluation cases. |
| `agents-cli deploy` | Deploy the hackathon demo to Google Cloud. |
| `agents-cli scaffold enhance` | Add deployment, CI/CD, or RAG to an existing project if needed. |

References:

[1]: https://github.com/google/agents-cli "google/agents-cli GitHub repository"
[2]: https://raw.githubusercontent.com/google/agents-cli/main/README.md "google/agents-cli README"
