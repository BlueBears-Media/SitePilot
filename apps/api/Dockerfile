# ─── Stage 1: Dependencies ───────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock* ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/queue/package.json ./packages/queue/
COPY packages/storage/package.json ./packages/storage/
COPY packages/validators/package.json ./packages/validators/

RUN bun install

# ─── Stage 2: Development (hot reload) ──────────────────────────────────────
FROM oven/bun:1 AS development
WORKDIR /app

COPY . .
RUN bun install

USER bun
EXPOSE 3001
CMD ["bun", "--watch", "apps/api/src/index.ts"]

# ─── Stage 3: Production ─────────────────────────────────────────────────────
FROM oven/bun:1 AS production
WORKDIR /app

# Copy only required files for production
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/src ./apps/api/src
COPY apps/api/package.json ./apps/api/
COPY packages ./packages
COPY package.json ./

# Create non-root user
RUN addgroup --system --gid 1001 sitepilot && \
    adduser --system --uid 1001 --ingroup sitepilot sitepilot

# Create data directory for local storage adapter
RUN mkdir -p /app/data/backups && chown -R sitepilot:sitepilot /app/data

USER sitepilot
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["bun", "apps/api/src/index.ts"]
