# SitePilot Tech Stack

Living reference document for all major technology choices in the SitePilot monorepo.

## Runtime and Tooling

| Tool | Version | Role |
|---|---|---|
| Bun | 1.x | Package manager, monorepo workspace runner, development runtime |
| TypeScript | 5.5 | Strict mode throughout all TypeScript packages |
| Node.js | 22+ | Compatibility target for the Docker production images |

All TypeScript code uses `strict: true` with no `any` types.

## Backend

| Package | Version | Role |
|---|---|---|
| Fastify | 4.x | HTTP framework for the API server |
| @fastify/jwt | 9.x | JWT authentication (access tokens 15min, refresh tokens 7d) |
| @fastify/cors | 9.x | CORS, locked to `SITEPILOT_ORIGIN` in production |
| @fastify/helmet | 11.x | Security headers |
| @fastify/rate-limit | 9.x | Rate limiting on `/auth/login` (10 req/15min/IP) |
| @fastify/cookie | 9.x | httpOnly cookie support for web client |
| drizzle-orm | 0.36.4 | ORM — pinned for API stability |
| drizzle-kit | 0.27.2 | Schema generation and migrations — pinned |
| postgres | 3.x | PostgreSQL driver (postgres.js — better Bun compatibility than `pg`) |
| BullMQ | 5.x | Job queues backed by Redis |
| ioredis | 5.x | Redis client (BullMQ connection + pub/sub for SSE) |
| bcrypt | 5.x | Password hashing for user accounts and companion token storage |

## Frontend

| Package | Version | Role |
|---|---|---|
| Next.js | 15.1.7 | App Router, server components, API routes |
| React | 19.x | UI library |
| Tailwind CSS | 4.x | CSS-first config (`@import "tailwindcss"` — no `tailwind.config.js`) |
| TanStack Query | 5.x | Data fetching, caching, and invalidation |
| Sonner | 1.x | Toast notifications |
| next-themes | 0.3.x | Dark mode (default: dark) |
| lucide-react | 0.400+ | Icon library |
| clsx + tailwind-merge | latest | `cn()` utility for conditional class merging |

## Storage

| Package | Version | Role |
|---|---|---|
| @aws-sdk/client-s3 | 3.600+ | S3 and MinIO operations |
| @aws-sdk/s3-request-presigner | 3.600+ | Pre-signed download URLs for S3 |
| Node.js fs streams | built-in | NFS and local filesystem adapter I/O |

**Encryption**: Storage profile credentials (config JSONB column) are encrypted with AES-256-GCM before insert. The encryption key is a 32-byte hex string from the `STORAGE_ENCRYPTION_KEY` environment variable. The encrypted payload is stored as `{ iv: hex, tag: hex, data: hex }`.

## WordPress Plugin (PHP)

| Technology | Version | Role |
|---|---|---|
| PHP | 8.1+ (strict_types) | Plugin runtime |
| WordPress | 6.0+ | Host platform |
| WordPress REST API | built-in | Route registration and request handling |
| PharData | built-in PHP extension | tar.gz extraction during restore |
| gzopen / RecursiveIteratorIterator | built-in | Pure-PHP streaming tar+gzip writer for backups |
| popen() | built-in | Background process execution for updates and restores |
| WP-cron | built-in | Fallback when popen() is disabled |
| HMAC-SHA256 | built-in (hash_hmac) | Companion request authentication |

**No Composer dependencies.** The companion plugin is a single PHP directory with no external packages — installable by uploading the directory to `wp-content/plugins/`.

## Infrastructure

| Service | Image | Role |
|---|---|---|
| PostgreSQL | postgres:16-alpine | Primary data store |
| Redis | redis:7-alpine | BullMQ job queues + pub/sub for SSE job progress |
| MinIO | minio/minio:latest | S3-compatible storage for development |
| Docker Compose | v2 | Container orchestration |

All containers run as non-root users.

## Security model

| Mechanism | Implementation | Protects |
|---|---|---|
| JWT access tokens | 15-minute expiry, HS256 | API route authentication |
| JWT refresh tokens | 7-day expiry, different secret | Token renewal |
| bcrypt (cost 12) | companion_token_hash in DB | Companion tokens at rest |
| AES-256-GCM | STORAGE_ENCRYPTION_KEY env var | Storage profile credentials at rest |
| HMAC-SHA256 | Per-request signature header | Outbound companion API calls |
| Timestamp window | ±5 minutes | Replay attack prevention |
| Rate limiting | 10 req/15min/IP | Brute-force protection on /auth/login |
| @fastify/helmet | Default security headers | XSS, clickjacking, etc. |
| CORS | SITEPILOT_ORIGIN env var | Cross-origin request restriction |
| Signed URLs | HMAC token, short-lived | Backup download URL access control |
