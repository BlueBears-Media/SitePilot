You are a senior full-stack engineer bootstrapping SitePilot — an open-source, self-hosted web agency management platform. Your task is to scaffold the entire project and implement the first two core modules: WordPress site management (updates and backups) and the SitePilot Companion WordPress plugin that runs on each managed site.

=== PART 1: SITEPILOT PLATFORM ===

## Stack

- Runtime: Node.js (v22+) with TypeScript throughout
- Package manager: Bun (bun workspaces for monorepo)
- Backend: Fastify with @fastify/jwt, @fastify/cors, @fastify/multipart
- Frontend: Next.js 15.1.x (App Router), Tailwind CSS v4, shadcn/ui@canary components
- Database: PostgreSQL via Drizzle ORM (drizzle-orm@0.36, drizzle-kit@0.27, postgres.js driver)
- Queue: BullMQ backed by Redis
- Storage adapters: S3-compatible (AWS/MinIO), NFS mount, local filesystem
- Containerisation: Docker Compose (postgres, redis, minio, api, web)
- Auth: JWT access tokens + refresh tokens, bcrypt password hashing

## Monorepo structure

sitepilot/
├── apps/
│   ├── api/               # Fastify backend
│   └── web/               # Next.js frontend
├── packages/
│   ├── db/                # Drizzle schema + migrations
│   ├── queue/             # BullMQ job definitions + processors
│   ├── storage/           # Storage adapter interface + implementations
│   └── validators/        # Zod schemas shared between api and web
├── companion/             # WordPress companion plugin (PHP — see Part 2)
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
└── package.json           # bun workspace root

## Database setup (packages/db)

Use `postgres` (postgres.js) as the Drizzle driver — it has better Bun
compatibility than `pg` and ships its own types. Pin versions:
  drizzle-orm@0.36, drizzle-kit@0.27, postgres@3

Add these scripts to packages/db/package.json:
  "db:generate": "bunx drizzle-kit generate"
  "db:migrate":  "bunx drizzle-kit migrate"

## Database schema (packages/db)

Design and migrate the following tables using Drizzle ORM:

users
  id uuid PK, email text unique, password_hash text, name text,
  role text (admin|viewer), created_at timestamptz

sites
  id uuid PK, name text, url text, wp_version text, php_version text,
  companion_token_hash text, last_seen_at timestamptz,
  status text (active|unreachable|unknown),
  storage_profile_id uuid FK → storage_profiles,
  created_at timestamptz

storage_profiles
  id uuid PK, name text, type text (s3|nfs|local),
  config jsonb (AES-256-GCM encrypted before insert),
  created_at timestamptz

backups
  id uuid PK, site_id uuid FK → sites,
  status text (pending|running|complete|failed),
  type text (full|db_only|files_only),
  snapshot_tag text nullable (e.g. "pre-rollback", "pre-update"),
  size_bytes bigint, storage_path text,
  manifest jsonb, created_at timestamptz, completed_at timestamptz

jobs
  id uuid PK, type text (backup|update_check|apply_update|rollback),
  site_id uuid FK → sites, status text (pending|running|complete|failed),
  payload jsonb, result jsonb, progress integer default 0,
  created_at timestamptz, updated_at timestamptz

update_checks
  id uuid PK, site_id uuid FK → sites,
  core_update jsonb nullable,
  plugin_updates jsonb array,
  theme_updates jsonb array,
  checked_at timestamptz

notifications
  id uuid PK, site_id uuid FK nullable, type text, message text,
  read_at timestamptz nullable, created_at timestamptz

## Storage adapter interface (packages/storage)

Define TypeScript interface StorageAdapter:
  upload(key: string, stream: Readable, meta?: object): Promise<void>
  download(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  signedUrl(key: string, expiresInSeconds: number): Promise<string>

Implement three adapters:

S3Adapter — uses @aws-sdk/client-s3 + getSignedUrl
  Config: bucket, region, endpoint (MinIO compat), accessKeyId, secretAccessKey

NfsAdapter — reads/writes to a mounted filesystem path
  signedUrl generates a time-limited token served by the API at
  GET /api/storage/serve/:token

LocalAdapter — same as NFS, defaults to ./data/backups
  For development and single-server installs

StorageAdapterFactory reads a storage_profile record, decrypts the config
jsonb using AES-256-GCM (key from STORAGE_ENCRYPTION_KEY env var),
and returns the correct adapter instance.

## Queue workers (packages/queue)

backup-queue
  Job payload: { siteId, type, snapshotTag? }
  Processor:
    1. Set job status → running in DB, progress → 0
    2. POST /sitepilot/v1/backup to companion (HMAC signed)
    3. Companion streams multipart response: manifest.json first, then archive chunks
    4. Stream chunks directly to storage adapter — never buffer full zip in memory
    5. Verify checksums from manifest against uploaded bytes
    6. Write backup record to DB with manifest jsonb, progress → 100
    7. Set job status → complete or failed

update-check-queue
  Job payload: { siteId }
  Processor:
    1. GET /sitepilot/v1/updates from companion (HMAC signed)
    2. Parse: { core, plugins[], themes[] } each with current_version,
       available_version, changelog_url
    3. Upsert update_checks record
    4. Create notification if critical updates found

apply-update-queue
  Job payload: { siteId, updateType (core|plugin|theme), slug? }
  Processor:
    1. Enqueue backup job with snapshotTag "pre-update", AWAIT completion
    2. POST /sitepilot/v1/apply-update to companion (HMAC signed)
    3. Poll /sitepilot/v1/update-status until done or 5 min timeout
    4. Re-run update check to confirm version bumped
    5. Record result in job

rollback-queue
  Job payload: { siteId, backupId, scope (full|db_only|files_only) }
  Processor:
    1. Enqueue backup job with snapshotTag "pre-rollback", AWAIT completion
    2. Fetch backup record + resolve storage adapter for that backup
    3. Generate signed URL for the archive (10 min expiry)
    4. POST /sitepilot/v1/restore to companion with { signedUrl, manifest, scope }
    5. Poll /sitepilot/v1/restore-status until done or 10 min timeout
    6. Update job status

All queues: exponential backoff, max 3 retries, dead-letter queue on final failure.
Emit job progress events to Redis pub/sub so SSE endpoint can forward them.

## Companion plugin authentication

Every request from the SitePilot backend to a companion plugin is authenticated
with HMAC-SHA256:

  Header X-SitePilot-Timestamp: unix timestamp (reject if >5 min clock drift)
  Header X-SitePilot-Signature: HMAC-SHA256(
    timestamp + "." + METHOD + "." + path + "." + sha256(body),
    companion_token
  )

companion_token is generated per-site at site creation:
  crypto.randomBytes(32).toString('hex')
Stored as bcrypt hash in sites.companion_token_hash.
Displayed raw exactly once to the user (to paste into WP plugin settings).
Never stored or transmitted in plaintext again.

## API routes (apps/api)

Auth:
  POST /auth/login          → { accessToken, refreshToken }
  POST /auth/refresh        → { accessToken }
  POST /auth/logout

Sites:
  GET    /sites
  POST   /sites
  GET    /sites/:id
  PATCH  /sites/:id
  DELETE /sites/:id
  GET    /sites/:id/token   (raw token shown once on creation only)
  POST   /sites/:id/check-updates
  POST   /sites/:id/apply-update
  POST   /sites/:id/rollback
  GET    /sites/:id/jobs

Backups:
  GET    /sites/:id/backups
  POST   /sites/:id/backups
  GET    /backups/:id
  DELETE /backups/:id
  GET    /backups/:id/download  (returns signed storage URL)

Storage profiles:
  GET    /storage-profiles
  POST   /storage-profiles
  PATCH  /storage-profiles/:id
  DELETE /storage-profiles/:id
  POST   /storage-profiles/:id/test

Jobs:
  GET    /jobs/:id
  GET    /jobs/:id/stream    (SSE — streams progress events from Redis pub/sub)

Storage serve (NFS/local signed tokens):
  GET    /storage/serve/:token

## Frontend (apps/web)

Next.js 15 App Router. shadcn/ui for all components. next-themes for dark mode.
Design language: clean, minimal, high contrast. Think Linear meets Vercel — not
WordPress admin. Use Tanstack Query for data fetching. Sonner for toasts.
SSE via native EventSource for job progress.

Pages:

/login
  Centered card. Email + password. JWT stored in httpOnly cookie via
  Next.js API route proxy. Redirect to /dashboard on success.

/dashboard
  Summary metric cards: total sites, sites with pending updates,
  oldest un-backed-up site, failed jobs in last 24h.
  Recent activity feed (last 20 jobs across all sites).

/sites
  Table: name, URL, status badge, WP version, update count badge,
  last backup timestamp, actions (view, trigger backup, check updates).
  "Add site" button opens slide-over with: name, URL fields +
  companion token display (one-time, copy button, warning that it
  will not be shown again).

/sites/[id]
  Tabbed layout — four tabs:

  Overview
    Site health card: status badge, last seen, companion version.
    Current versions: WP core, PHP, active theme.
    Storage profile badge.
    Quick-action buttons: Check updates, Trigger backup.

  Updates
    Three sections: Core / Plugins / Themes.
    Each row: name, current version → available version,
    changelog link, "Apply update" button.
    Apply update opens confirmation modal with warning:
    "A backup will be taken automatically before this update is applied."
    Show pre-update backup snapshot in Backups tab after.

  Backups
    Timeline list newest → oldest.
    Each row: type badge (full/db/files), snapshot_tag badge if present
    (pre-rollback, pre-update styled differently), size, timestamp,
    status badge, two action buttons:
      "Roll back" — only if site status is active (companion reachable).
        Opens modal: scope selector (Full / DB only / Files only),
        warning text, confirm button. Shows live progress via SSE.
      "Prepare restore" — always available.
        Opens slide-over: target domain field (pre-filled with site URL,
        editable), storage type display, "Generate package" button.
        On generate: calls backend, gets signed download URL,
        shows download button + instructions for using restore-helper.php.

  Jobs
    Paginated log of all jobs for this site.
    Columns: type, status badge, started, duration, actions (view result).

/storage
  List of storage profiles with type badge and test-connection status.
  "Add profile" slide-over: type selector reveals correct fields.
    S3: endpoint, bucket, region, access key, secret key
    NFS: mount path
    Local: directory path (default shown)
  Test connection button before save.

/settings
  Sections: Users (list, invite, delete), SMTP (host, port, user, pass,
  from address, test send button), Backup schedule defaults
  (default frequency per site type), Danger zone (reset).

## Security requirements

- All routes except /auth/* require valid JWT. Validate on every request.
- Rate limit /auth/login: 10 attempts per IP per 15 min (@fastify/rate-limit)
- Storage config jsonb encrypted at rest with AES-256-GCM before DB insert
- companion_token stored as bcrypt hash, raw value shown once at site creation
- HMAC signature validation on all outbound companion requests
- Timestamp window check (±5 min) for replay attack prevention
- All Docker containers run as non-root users
- @fastify/helmet for security headers
- Input validation on all routes via Zod (packages/validators shared with web)
- CORS locked to SITEPILOT_ORIGIN env var in production
- Backup archive download URLs are signed and short-lived (max 15 min)

## Docker Compose

Services: postgres:16-alpine, redis:7-alpine, minio (dev only), api, web.
Healthchecks on postgres and redis. API waits for both to be healthy.
Named volumes for postgres data and minio data.
All containers non-root.
Dev override: source mounts for hot reload, minio console on :9001.
.env.example documents every variable with descriptions and safe defaults.

Required env vars:
  DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET,
  STORAGE_ENCRYPTION_KEY (32-byte hex), SITEPILOT_ORIGIN,
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM

=== PART 2: COMPANION WORDPRESS PLUGIN ===

The companion plugin lives in companion/ in the monorepo root.
It is a standard WordPress plugin written in PHP 8.1+, no build step required,
distributable as a single zip. It should work on any WordPress 6.0+ site.

## Plugin file structure

companion/
├── sitepilot-companion.php     # Plugin header + bootstrap
├── includes/
│   ├── Auth.php                # HMAC signature verification
│   ├── Backup.php              # Backup creation + streaming
│   ├── Updates.php             # WP update detection
│   ├── Restore.php             # Restore + rollback handler
│   ├── HealthCheck.php         # Environment info endpoint
│   └── Router.php              # REST route registration
├── admin/
│   ├── SettingsPage.php        # WP admin settings UI
│   └── views/
│       └── settings.php        # Settings page HTML
└── readme.txt

## Plugin bootstrap (sitepilot-companion.php)

Plugin header:
  Plugin Name: SitePilot Companion
  Description: Connects this WordPress site to a SitePilot instance for
               automated backups, updates, and monitoring.
  Version: 1.0.0
  Requires at least: 6.0
  Requires PHP: 8.1
  License: GPL-2.0+

On activation: create DB option sitepilot_token (empty), sitepilot_enabled (false).
On deactivation: do not delete options (preserve config across deactivate/activate).
On uninstall (uninstall.php): delete all sitepilot_* options.

Register REST routes on rest_api_init via Router.php.
Add settings page via admin_menu via SettingsPage.php.

## Authentication (includes/Auth.php)

Method: verify_request(WP_REST_Request $request): bool

Steps:
  1. Read X-SitePilot-Timestamp header. Return false if missing.
  2. Check abs(time() - timestamp) <= 300. Return false if outside window.
  3. Read X-SitePilot-Signature header. Return false if missing.
  4. Retrieve token from get_option('sitepilot_token'). Return false if empty.
  5. Reconstruct signature:
       $body_hash = hash('sha256', $request->get_body());
       $message   = $timestamp . '.' . $request->get_method()
                    . '.' . $request->get_route() . '.' . $body_hash;
       $expected  = hash_hmac('sha256', $message, $token);
  6. Return hash_equals($expected, $provided_signature)

All REST endpoints use this as their permission_callback.
If get_option('sitepilot_enabled') is false, return 403 on all routes.

## REST routes (includes/Router.php)

All routes under namespace: sitepilot/v1
All routes: permission_callback → Auth::verify_request

GET  /health
  Returns: {
    status: "ok",
    wp_version: get_bloginfo('version'),
    php_version: PHP_VERSION,
    plugin_version: SITEPILOT_VERSION,
    site_url: get_site_url(),
    companion_enabled: bool,
    active_theme: { name, version },
    disk_free_bytes: disk_free_space(ABSPATH)
  }

GET  /updates
  Returns: {
    core: { current_version, available_version, changelog_url } | null,
    plugins: [{ slug, name, current_version, available_version,
                changelog_url, is_active }],
    themes:  [{ slug, name, current_version, available_version }]
  }
  Use wp_get_update_data(), get_site_transient('update_plugins'),
  get_site_transient('update_themes'), get_site_transient('update_core').
  Force a fresh check by calling wp_version_check(), wp_update_plugins(),
  wp_update_themes() before reading transients.

POST /backup
  Body: { type: "full"|"db_only"|"files_only" }
  Handled by Backup.php — see below.
  Streams multipart response. Do not buffer in memory.

POST /apply-update
  Body: { update_type: "core"|"plugin"|"theme", slug?: string }
  Handled by Updates.php — see below.
  Returns: { job_id: string, status: "started" }

GET  /update-status
  Query: { job_id: string }
  Returns: { status: "running"|"complete"|"failed", message?: string }

POST /restore
  Body: { signed_url: string, manifest: object, scope: "full"|"db_only"|"files_only" }
  Handled by Restore.php — see below.
  Returns: { job_id: string, status: "started" }

GET  /restore-status
  Query: { job_id: string }
  Returns: { status: "running"|"complete"|"failed", message?: string, 
             health_check?: object }

## Backup handler (includes/Backup.php)

POST /sitepilot/v1/backup must stream a multipart response. Never load the
full archive into memory — the site may have gigabytes of uploads.

Steps:
  1. Set time limit: set_time_limit(0). Disable output buffering.
  2. Start multipart response with boundary. Send Content-Type header.
  3. Part 1 — manifest.json:
     Build manifest array:
       site_url, wp_version, php_version, backup_type, created_at (ISO8601),
       token_version: 1,
       files: [] (populated as files are added, with path + sha256 + size),
       db_tables: [] (list of table names included)
     Encode and stream as first multipart part.
  4. Part 2 — database dump (if type is full or db_only):
     Use $wpdb to iterate all tables with SHOW TABLES.
     For each table: stream "CREATE TABLE IF NOT EXISTS..." + row-by-row
     INSERT statements in chunks of 100 rows.
     Do not use mysqldump binary — not available on all hosts.
     Stream SQL directly as a multipart part named "dump.sql".
     Track tables in manifest.db_tables.
  5. Part 3 — files archive (if type is full or files_only):
     Use a pure-PHP streaming tar+gzip writer — do NOT use ZipArchive.
     ZipArchive requires a full temp-file write before streaming, which
     fails on shared hosts with limited disk/tmp quotas.
     Instead, build the tar stream manually:
       - Open a gzip output stream with gzopen() to a temp file
         (sys_get_temp_dir() + uniqid() + '.tar.gz')
       - For each file: write a 512-byte POSIX tar header block, then
         the file content in 512-byte chunks, then padding to 512-byte boundary
       - Write the two 512-byte end-of-archive blocks at the end
       - Flush and close the gzip stream, then stream the temp file
         as the multipart part named "files.tar.gz"
     Include: wp-content/ directory, wp-config.php.
     Exclude: wp-content/cache/, wp-content/upgrade/, any .log files,
     node_modules if present.
     For each file added, append { path, sha256, size } to manifest.files.
     Clean up temp file after streaming.
  6. Part 4 — updated manifest.json (with checksums now populated):
     Re-stream manifest as final part so receiver can verify.
  7. End multipart response.

## Update handler (includes/Updates.php)

POST /sitepilot/v1/apply-update

Generate a unique job_id (wp_generate_uuid4()).
Store job state in a transient: sitepilot_job_{job_id} with 10 min expiry.
Set initial state: { status: "running", message: "Starting update" }

Spawn a background process immediately after returning the HTTP response.
Do NOT rely solely on wp_schedule_single_event — WP-cron only fires on
site visits and will time out on low-traffic or staging sites.

Background execution strategy (try in order):
  1. Primary: use popen() to spawn a detached PHP CLI process:
       $cmd = 'php ' . ABSPATH . 'wp-cron.php > /dev/null 2>&1 &';
       popen($cmd, 'r');
     This fires cron immediately, independent of site traffic.
  2. Fallback: if popen() is disabled (common on some shared hosts),
     fall back to wp_schedule_single_event(time(), 'sitepilot_run_update',
     [$job_id, $update_type, $slug]) and document the unreliability risk.

Return { job_id, status: "started" } immediately so the HTTP request closes.

Hook sitepilot_run_update action:

  For core update:
    require_once ABSPATH . 'wp-admin/includes/update.php';
    require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
    $upgrader = new Core_Upgrader(new Automatic_Upgrader_Skin());
    $result = $upgrader->upgrade($update_object);

  For plugin update:
    require plugin upgrader classes.
    $upgrader = new Plugin_Upgrader(new Automatic_Upgrader_Skin());
    $result = $upgrader->upgrade($plugin_file);

  For theme update:
    $upgrader = new Theme_Upgrader(new Automatic_Upgrader_Skin());
    $result = $upgrader->upgrade($slug);

  On success: update transient to { status: "complete", message: "Updated" }
  On failure: update transient to { status: "failed", message: $error }

GET /sitepilot/v1/update-status reads the transient and returns it.

## Restore handler (includes/Restore.php)

POST /sitepilot/v1/restore

The SitePilot backend provides a signed URL to the backup archive and the manifest.
The plugin fetches and applies it — this is the automated companion-based restore path
(used for one-click rollback). The manual restore path uses restore-helper.php
(see Part 3) and does NOT go through this endpoint.

Generate job_id, store state transient.

Use the same background execution strategy as the update handler:
  1. Primary: popen() to spawn detached PHP CLI process firing wp-cron.php
  2. Fallback: wp_schedule_single_event → sitepilot_run_restore action

Return { job_id, status: "started" } immediately.

Hook sitepilot_run_restore:
  1. Update state: "Downloading backup archive"
  2. Download archive from signed_url using wp_remote_get() with stream => true.
     Save to sys_get_temp_dir()/sitepilot_restore_{job_id}.tar.gz
  3. Verify file checksums against manifest.files entries using sha256_file().
     Abort and set failed state if any mismatch.
  4. Update state: "Restoring files" (if scope is full or files_only)
     Use PharData to extract files.tar.gz into ABSPATH, overwriting existing files.
     Restore wp-config.php only if it is in the archive and scope is full.
  5. Update state: "Importing database" (if scope is full or db_only)
     Extract dump.sql from archive.
     Parse and execute SQL in chunks using $wpdb->query().
     Import line by line — avoid loading entire dump into memory.
  6. Update state: "Flushing caches"
     wp_cache_flush(). If WP_CACHE defined, attempt to flush object cache.
     Delete all transients via SQL: DELETE FROM wp_options WHERE option_name
     LIKE '_transient_%'.
  7. Clean up temp files.
  8. Update state: { status: "complete", health_check: [run HealthCheck] }

GET /sitepilot/v1/restore-status returns transient.

## Admin settings page (admin/SettingsPage.php)

Add menu item under Settings → "SitePilot" using add_options_page().

Settings page sections:

  Connection status banner
    Green if get_option('sitepilot_enabled') true + last_seen within 10 min.
    Yellow if enabled but last_seen > 10 min.
    Red if disabled or token empty.
    Shows: companion version, site URL, last contact time.

  SitePilot token field
    Text input (password type) for the token.
    Save button. On save: store with update_option('sitepilot_token', $token).
    Never display saved token — show only "Token saved (hidden)" with a
    "Replace token" button that clears and shows the input again.
    Enable/disable toggle for the companion. When disabled all endpoints
    return 403 regardless of token.

  Environment info panel (read-only)
    PHP version, WordPress version, active theme, disk free space,
    writeable temp dir (yes/no), PharData (tar) available (yes/no).
    These are the same fields returned by /health. Show warnings if
    PharData is not available (backups will fail).

  Danger zone
    "Remove SitePilot" button — deletes all sitepilot_* options and
    deactivates the plugin.

Style the settings page to look clean and modern using only WordPress
admin CSS classes. No external CSS dependencies. Use postbox divs,
notice divs for status messages. The page should not look out of place
in WP admin but should feel cleaner than the default WP settings pages.

=== PART 3: RESTORE-HELPER.PHP ===

restore-helper.php lives in companion/restore-helper.php.
It is a standalone PHP file — no WordPress required.
It is included inside the backup archive (added by Backup.php at build time).
The SitePilot backend also makes it available for separate download.

This file enables the manual restore path: upload archive.zip and
restore-helper.php to any web host, visit it in a browser, follow
the 4-step wizard, and the site is restored or installed fresh.

## Security

The file reads its one-time token and expiry from manifest.json inside
the archive. On every page load:
  1. Find archive.tar.gz in the same directory (glob for *.tar.gz, take first match).
  2. Extract manifest.json from the tar.gz using PharData (no full extraction).
  3. Read token and expires_at from manifest.
  4. Compare GET param ?t= against manifest token using hash_equals().
     Show nothing and exit if mismatch.
  5. Check expires_at. Show expiry error and exit if past.
  6. Check if manifest.used === true. Show "already used" error and exit.

After successful restore: reopen archive, update manifest.json with used = true,
re-add to archive. Then delete the archive and the restore-helper.php file itself.

## Wizard steps (single PHP file, inline CSS + JS)

The file renders a clean single-page wizard. Inline CSS only —
no external dependencies. Must work with no internet connection
(the target host may be brand new with no WP installed).

Design: white card centered on a dark background. Progress indicator
at top (Step 1 of 4). Clean sans-serif font (system font stack).
Green/amber/red status indicators. Mobile friendly.

Step 1 — Preflight check

Read manifest.json from the archive (no extraction needed, read from zip).
Display a table of checks. Each row: check name, status icon, detail.

  PHP version (from manifest): required X.X, detected Y.Y  → pass/warn
  PharData (tar) extension: required, detected yes/no        → pass/fail
  PDO or mysqli extension: required                          → pass/fail
  Archive file found: archive.tar.gz present                 → pass/fail
  Archive checksum: sha256 of archive vs manifest            → pass/fail
  Disk space: manifest.estimated_size vs disk_free_space()  → pass/warn
  WordPress already installed: wp-config.php present        → info (not fail)

If any hard fails (PharData missing, archive missing, checksum fail):
show error and do not allow proceeding.
If only warnings: show "Proceed with caution" option.

"Continue to Step 2" button.

Step 2 — Configuration

Form fields:
  Target domain (pre-filled from manifest.site_url, editable)
    Shown with note: "Change this if you are restoring to a different domain.
    Leave as-is if restoring to the same domain."
  Database host (default: localhost)
  Database name
  Database user
  Database password
  Table prefix (pre-filled from manifest, editable, default wp_)
  Restore scope: radio buttons — Full restore / Database only / Files only
    Full restore is default and recommended.

"Test database connection" button (AJAX POST to same file with action=test_db).
On success show green "Connection successful". On failure show error message.

"Continue to Step 3" button (disabled until DB test passes).

Step 3 — Restore

Show progress log — a <pre> block that updates via AJAX polling.
POST to same file with action=run_restore. Process runs synchronously
(set_time_limit(0)) and writes progress lines to a temp file.
AJAX polls GET ?action=progress every 2 seconds and appends new lines.

Progress steps logged:
  [OK]  Reading manifest
  [OK]  Extracting files (if scope includes files)
  [OK]  Importing database — table wp_posts (120 rows)
  [OK]  Importing database — table wp_options (800 rows)
  ... (one line per table)
  [OK]  Running search-replace: old-domain.com → new-domain.com
  [OK]  Serialized string search-replace complete
  [OK]  Flushing caches
  [OK]  Writing wp-config.php
  [DONE] Restore complete

Search-replace must handle serialized PHP strings correctly.
Implement a recursive serialized string replacer — do not use simple
str_replace on serialized data (it breaks string length metadata).

For the DB import: parse dump.sql line by line using fgets() on a stream.
Accumulate lines into statements (split on semicolons outside string literals).
Execute each statement. Log errors but continue (some CREATE TABLE errors
are expected on existing installs).

Step 4 — Complete

Show success panel:
  Checkmark icon
  "Your site has been restored successfully."
  Target URL as a clickable link (the new domain from Step 2)
  Warning box: "This restore file has been deleted for security.
                Log in to your SitePilot instance to verify the restore."

Run a basic health check before showing complete:
  Attempt to fetch the target URL with file_get_contents or curl.
  Show "Site is responding" or "Site URL not yet reachable — DNS may
  still be propagating" depending on result.

Cleanup:
  Mark manifest.used = true inside the archive.
  Delete archive.tar.gz.
  Delete restore-helper.php (use register_shutdown_function to delete
  the file after the response is sent).
  Delete the temp progress file.

=== BUILD ORDER ===

Build in this exact sequence to keep dependencies satisfied:

1.  packages/validators     — Zod schemas (no deps)
2.  packages/db             — Drizzle schema + migration (needs validators)
3.  packages/storage        — adapter interface + S3 + NFS + local + factory
4.  packages/queue          — job types + all processors (needs db + storage)
5.  apps/api                — Fastify setup + all routes + SSE endpoint
6.  apps/web                — Next.js layout + all pages (needs validators)
7.  companion/              — full WordPress plugin (standalone PHP)
8.  companion/restore-helper.php — standalone wizard (standalone PHP)
9.  docker-compose.yml + docker-compose.dev.yml
10. .env.example + README.md

## README.md must cover

  Prerequisites (Docker, Bun)
  Clone + first run (bun install, docker compose up, db migrate)
  How to add a WordPress site:
    1. Install SitePilot Companion plugin on the WP site
    2. Add site in SitePilot dashboard → copy the one-time token
    3. Paste token into Companion plugin settings → save → enable
    4. Return to SitePilot → site should show as Active
  Storage profile setup (S3 / MinIO / NFS / local)
  How restore-helper.php works
  Environment variables reference
  Contributing guide

Write idiomatic TypeScript throughout the Node.js code. No `any` types.
Export clean types from packages so apps consume them without duplication.
Write clean, well-commented PHP 8.1+ throughout the plugin code.
Use strict types (declare(strict_types=1)) in every PHP file.

Start by outputting the full directory structure and all package.json /
composer.json files. Then implement each module in the build order above,
completing each one fully before moving to the next.
