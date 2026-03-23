# SitePilot Installation Guide

## 1. System requirements

| Requirement | Minimum version | Notes |
|---|---|---|
| Docker | 24.0+ | Required for all deployment modes |
| Docker Compose | v2.0+ | Ships with Docker Desktop |
| Bun | 1.x | Package manager + dev runtime |
| Node.js | 22+ | Optional — only needed outside Bun |

The API and web containers run on Bun. The PostgreSQL, Redis, and MinIO containers are standard Alpine-based images.

## 2. Clone and install dependencies

```bash
git clone https://github.com/sitepilot/sitepilot.git
cd sitepilot
bun install
```

This installs all workspace dependencies for `apps/api`, `apps/web`, and all `packages/*`.

## 3. Environment configuration

```bash
cp .env.example .env
```

Edit `.env` and set the following required variables:

| Variable | How to generate | Why it's needed |
|---|---|---|
| `POSTGRES_PASSWORD` | Choose a strong password | PostgreSQL database password |
| `JWT_SECRET` | `openssl rand -hex 32` | Signs access tokens (15 min expiry) |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` | Signs refresh tokens (7 day expiry), must differ from JWT_SECRET |
| `STORAGE_ENCRYPTION_KEY` | `openssl rand -hex 32` | AES-256-GCM key for encrypting storage profile credentials at rest |
| `SITEPILOT_ORIGIN` | Your frontend URL | CORS restriction (e.g., `http://localhost:3000`) |

All other variables have sensible defaults for local development.

## 4. Database setup

Generate and run migrations:

```bash
bun run db:generate  # Generates SQL migration files (only needed after schema changes)
bun run db:migrate   # Applies pending migrations
```

The `db:migrate` command uses `drizzle-kit migrate` internally. It reads `DATABASE_URL` from your `.env` file.

## 5. Docker Compose startup

### Development (recommended for first run)

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts PostgreSQL, Redis, MinIO (S3-compatible storage), the API, and the web frontend. Source directories are mounted for hot reload.

### Production

```bash
docker compose up -d
```

This builds production Docker images and starts all services except MinIO. Configure an external S3 bucket or NFS share for backup storage.

Check service health:

```bash
docker compose ps
docker compose logs api
docker compose logs web
```

## 6. First login

SitePilot does not have a built-in setup wizard yet. Create the first admin user directly in the database:

```bash
# 1. Generate a bcrypt hash for your password
bun -e "import bcrypt from 'bcrypt'; console.log(await bcrypt.hash('your_password', 12))"

# 2. Insert the user
docker compose exec postgres psql -U sitepilot sitepilot -c "
  INSERT INTO users (email, password_hash, name, role)
  VALUES ('admin@example.com', '\$2b\$12\$...your_hash...', 'Admin', 'admin');
"
```

Then log in at `http://localhost:3000` with those credentials.

## 7. Companion plugin installation

### From the monorepo

1. Zip the `companion/` directory:
   ```bash
   cd companion && zip -r ../sitepilot-companion.zip . && cd ..
   ```
2. Log in to the WordPress admin of your target site
3. Go to Plugins → Add New → Upload Plugin
4. Upload `sitepilot-companion.zip` and activate

### Manual installation

1. Copy the `companion/` directory to `wp-content/plugins/sitepilot-companion/` on the target server
2. Activate the plugin in WordPress admin

### Configure the companion token

1. In SitePilot: go to Sites → Add site → create the site
2. Copy the one-time companion token displayed after creation
3. In WordPress admin: Settings → SitePilot → paste the token → enable → save

## 8. Storage configuration

### Local storage (default)

No configuration needed. Backups are stored in `./data/backups` inside the API container.

### S3 / AWS

1. Create an S3 bucket in your AWS account
2. Create an IAM user with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:HeadObject` permissions on the bucket
3. In SitePilot: Storage → Add profile → S3-compatible
4. Enter the endpoint (`https://s3.amazonaws.com`), bucket, region, access key ID, and secret access key
5. Click "Test connection" before saving

### MinIO (development)

1. Access `http://localhost:9001` with credentials from `.env`
2. Create a bucket and access key
3. In SitePilot: Storage → Add profile → S3-compatible
4. Endpoint: `http://minio:9000` (from inside Docker network) or `http://localhost:9000`

### NFS

1. Mount your NFS share on the API server host
2. Configure the Docker volume mount in `docker-compose.yml`
3. In SitePilot: Storage → Add profile → NFS → enter the mount path inside the container

## 9. Verify everything works

```bash
# API health check
curl http://localhost:3001/health

# Expected response:
# {"status":"ok","timestamp":"2026-03-23T..."}
```

In SitePilot:

1. Add a WordPress site and configure the companion token
2. On the site detail page, click "Check updates" — the site should change to "active"
3. Trigger a manual backup — it should complete within a few minutes
4. Verify the backup appears in the Backups tab

## 10. Upgrade procedure

```bash
# 1. Pull latest changes
git pull

# 2. Reinstall dependencies (in case package.json changed)
bun install

# 3. Run any new migrations
bun run db:migrate

# 4. Rebuild and restart containers
docker compose build
docker compose up -d
```

Always run `bun run db:migrate` after upgrading to apply schema changes.

## 11. Backup and restore procedures

### Creating a backup

- **Dashboard**: Sites → [site name] → Backups tab → Backup now
- **API**: `POST /sites/:id/backups` with body `{ "type": "full" }`

### Restoring via companion (automated rollback)

1. Sites → [site name] → Backups tab
2. Click "Roll back" on the desired backup
3. Select scope (Full / DB only / Files only)
4. Confirm — a pre-rollback backup is taken automatically, then the restore runs

### Restoring manually (restore-helper.php)

1. Sites → [site name] → Backups tab
2. Click "Prepare restore" on the desired backup
3. Download the archive
4. Upload the archive and `companion/restore-helper.php` to the target host
5. Visit `restore-helper.php` in a browser and follow the wizard
