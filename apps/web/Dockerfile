# ─── Stage 1: Dependencies ───────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock* ./
COPY apps/web/package.json ./apps/web/
COPY packages/validators/package.json ./packages/validators/

RUN bun install

# ─── Stage 2: Development ─────────────────────────────────────────────────────
FROM oven/bun:1 AS development
WORKDIR /app

COPY . .
RUN bun install

EXPOSE 3000
CMD ["sh", "-c", "cd /app/apps/web && bun run dev"]

# ─── Stage 3: Builder ─────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN bun --cwd apps/web run build

# ─── Stage 4: Production runtime (standalone) ────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 sitepilot && \
    adduser --system --uid 1001 --ingroup sitepilot sitepilot

# Copy Next.js standalone output
COPY --from=builder --chown=sitepilot:sitepilot /app/apps/web/.next/standalone ./
COPY --from=builder --chown=sitepilot:sitepilot /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=sitepilot:sitepilot /app/apps/web/public ./apps/web/public

USER sitepilot
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
