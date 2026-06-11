#
# Multi-runtime image: Python 3.12 (ADK agent) + Node.js 22 LTS (MongoDB MCP server).
# Node.js is required to run `npx mongodb-mcp-server` as a stdio child process
# per DECISIONS_LOG §2.3.

FROM python:3.12-slim

# ---- Node.js 22 LTS (required for npx mongodb-mcp-server) ----
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install mongodb-mcp-server globally so runtime spawns the binary directly.
# `npx -y` re-resolves "latest" from the npm registry on cold starts — that
# blocked a brief ~3min in prod (2026-06-11) when the registry was slow.
# A global install is resolved entirely at build time. Hard failure on purpose:
# a broken install should fail the build, not degrade silently at runtime.
RUN npm install -g mongodb-mcp-server

# ---- Python / uv / ADK ----
RUN pip install --no-cache-dir uv==0.8.13

WORKDIR /code

COPY ./pyproject.toml ./README.md ./uv.lock* ./
COPY ./app ./app
COPY ./scripts ./scripts

RUN uv sync --frozen

ARG COMMIT_SHA=""
ENV COMMIT_SHA=${COMMIT_SHA}

ARG AGENT_VERSION=0.0.0
ENV AGENT_VERSION=${AGENT_VERSION}

EXPOSE 8080

CMD ["uv", "run", "uvicorn", "app.fast_api_app:app", "--host", "0.0.0.0", "--port", "8080"]
