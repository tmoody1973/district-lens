# Copyright 2026 Tarik Moody — Apache 2.0
#
# Multi-stage Next.js build for Cloud Run.
# Stage 1: install deps + build standalone output
# Stage 2: minimal runtime image (~150MB vs ~600MB full)

FROM node:24-slim AS builder

RUN npm install -g pnpm@10

WORKDIR /app

# Dependencies first (cached layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Source
COPY . .

# Build with standalone output (next.config.ts: output: "standalone")
# Pass placeholder env vars so build doesn't fail on missing secrets —
# real values are injected by Cloud Run at runtime.
#
# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is inlined into the client bundle at build
# time (that's what NEXT_PUBLIC_ means) so it MUST be present here, not just at
# runtime. It is a publishable key — public by design, shipped to every browser —
# so it is safe to commit. The matching secret (CLERK_SECRET_KEY) is runtime-only
# and injected by Cloud Run from Secret Manager.
RUN NEXT_TELEMETRY_DISABLED=1 \
    GOOGLE_CLOUD_PROJECT=civicsync-440613 \
    GOOGLE_CLOUD_LOCATION=global \
    MONGODB_URI=placeholder \
    GEOCODIO_API_KEY=placeholder \
    AGENT_URL=https://districtlens-agent-adewe5kxtq-uc.a.run.app \
    INTERNAL_API_TOKEN=placeholder \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_cXVhbGl0eS13aGlwcGV0LTc3LmNsZXJrLmFjY291bnRzLmRldiQ \
    pnpm build

# ---------------------------------------------------------------------------
# Stage 2: runtime — only the standalone output + public assets
# ---------------------------------------------------------------------------
FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Non-root user for Cloud Run best practice
RUN groupadd --system nodejs && useradd --system --gid nodejs nextjs

# Standalone includes its own node_modules copy
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 8080

CMD ["node", "server.js"]
