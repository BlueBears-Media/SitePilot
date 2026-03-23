# SitePilot

SitePilot is an open-source, self-hosted web agency management platform. It gives you a single dashboard to manage WordPress core, plugin, and theme updates across all your client sites, trigger and store backups, and roll back any site to a previous state — all from your own infrastructure, with no third-party SaaS dependency.

## Features

- **Site management** — Track WordPress version, PHP version, and companion plugin status across all sites
- **Update management** — Check for and apply core, plugin, and theme updates with one click
- **Pre-update backups** — Every update automatically takes a backup snapshot before proceeding
- **Backups** — Full, database-only, or files-only backups streamed directly to S3, NFS, or local storage
- **One-click rollback** — Roll back any site to any previous backup via the companion plugin
- **Manual restore** — Use `restore-helper.php` to restore a site on a fresh host with no WordPress installed
- **Storage adapters** — S3-compatible (AWS, MinIO), NFS mounts, local filesystem
- **Real-time progress** — SSE-powered live job progress in the dashboard
- **Security** — HMAC-SHA256 companion authentication, AES-256-GCM storage encryption, bcrypt tokens

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/) v2
- [Bun](https://bun.sh) 1.x (for development and running scripts)

## Quick start

```bash
# 1. Clone the repository
git clone https://github.com/sitepilot/sitepilot.git
cd sitepilot

# 2. Install dependencies
bun install

# 3. Configure environment
cp .env.example .env
# Edit .env — at minimum set POSTGRES_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET, STORAGE_ENCRYPTION_KEY

# 4. Start services (development mode with MinIO)
docker compose -f docker-compose.dev.yml up -d

# 5. Run database migrations
bun run db:migrate

# 6. Open the dashboard
# Web: http://localhost:3000
# API: http://localhost:3001
# MinIO console: http://localhost:9001
```

## Adding a WordPress site

1. **Install the companion plugin** on your WordPress site
   - Upload the `companion/` directory (or zip it) to `wp-content/plugins/sitepilot-companion/`
   - Activate the plugin in the WordPress admin

2. **Add the site in SitePilot**
   - Go to Sites → Add site
   - Enter the site name and URL
   - Click "Create site" — a one-time companion token will be displayed

3. **Paste the token into the plugin**
   - In WordPress admin: Settings → SitePilot
   - Paste the companion token into the token field
   - Enable the companion and click Save

4. **Verify the connection**
   - Return to SitePilot
   - Click "Check updates" on the site — if the companion is configured correctly, the site status will change to "active"

## Storage profile setup

### S3 / AWS

1. Go to Storage → Add profile
2. Select "S3-compatible"
3. Enter your bucket name, region, and AWS credentials
4. For the endpoint, use `https://s3.amazonaws.com`
5. Click "Test connection" then "Create profile"

### MinIO (local development)

1. Access the MinIO console at `http://localhost:9001` (credentials from `.env`)
2. Create a bucket (e.g., `sitepilot-backups`)
3. Create an access key
4. Add a storage profile in SitePilot with endpoint `http://minio:9000` (from inside Docker) or `http://localhost:9000` (from outside)

### NFS

1. Mount your NFS share to a path on the API server (e.g., `/mnt/backups`)
2. Add a storage profile with type "NFS" and the mount path

### Local filesystem

1. Add a storage profile with type "Local"
2. The default path is `./data/backups` relative to the API container

## How restore-helper.php works

`restore-helper.php` is a standalone PHP file included inside every backup archive. It enables the manual restore path — restoring a site to a fresh host with no WordPress installed.

**Steps:**

1. Download the backup archive and `restore-helper.php` from SitePilot (Backups tab → Prepare restore)
2. Upload both files to the target web host's document root
3. Visit `restore-helper.php` in your browser (include `?t=TOKEN` if the archive has a security token)
4. Follow the 4-step wizard:
   - **Step 1** — Preflight checks (PHP version, PharData, disk space)
   - **Step 2** — Configure database credentials and target domain
   - **Step 3** — Restore with live progress log
   - **Step 4** — Success + site health check
5. The archive and helper file are automatically deleted after successful restore

Domain search-replace is performed correctly on serialized PHP data (handles WordPress's serialized option values).

## Environment variables reference

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@localhost:5432/sitepilot` |
| `POSTGRES_USER` | PostgreSQL username (Docker) | `sitepilot` |
| `POSTGRES_PASSWORD` | PostgreSQL password (Docker) | `strong_password` |
| `POSTGRES_DB` | PostgreSQL database name (Docker) | `sitepilot` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `REDIS_PASSWORD` | Redis password (optional) | `redis_password` |
| `JWT_SECRET` | Secret for signing access tokens | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens | `openssl rand -hex 32` |
| `STORAGE_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM encryption | `openssl rand -hex 32` |
| `SITEPILOT_ORIGIN` | Frontend URL for CORS | `https://sitepilot.yourdomain.com` |
| `API_BASE_URL` | Public API URL (for signed storage URLs) | `https://api.sitepilot.yourdomain.com` |
| `API_PORT` | API server port | `3001` |
| `WEB_PORT` | Web frontend port | `3000` |
| `SMTP_HOST` | SMTP server hostname | `smtp.example.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | `user@example.com` |
| `SMTP_PASS` | SMTP password | `password` |
| `SMTP_FROM` | From address for emails | `noreply@sitepilot.io` |
| `MINIO_ROOT_USER` | MinIO root username (dev) | `sitepilot` |
| `MINIO_ROOT_PASSWORD` | MinIO root password (dev) | `sitepilot_dev` |
| `LOCAL_STORAGE_PATH` | Path for local storage adapter | `./data/backups` |

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes following the existing code style
4. Run `bun run typecheck` in all affected packages
5. Submit a pull request with a clear description

### Development setup

```bash
bun install
docker compose -f docker-compose.dev.yml up -d
bun run db:migrate
# API: bun --cwd apps/api run dev
# Web: bun --cwd apps/web run dev
```

## License

MIT — see [LICENSE](LICENSE)
