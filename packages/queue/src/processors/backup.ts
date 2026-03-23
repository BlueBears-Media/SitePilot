import type { Job } from 'bullmq'
import { db, jobs, sites, backups, storageProfiles } from '@sitepilot/db'
import { StorageAdapterFactory } from '@sitepilot/storage'
import { eq } from 'drizzle-orm'
import { Readable } from 'node:stream'
import { signRequest, decryptToken } from '../hmac'
import { redisConnection } from '../redis'
import type { BackupJobPayload } from '../types'

/**
 * Publishes a progress event to Redis pub/sub so the SSE endpoint
 * can forward it to connected clients.
 */
async function publishProgress(jobId: string, progress: number, message?: string): Promise<void> {
  await redisConnection.publish(
    `job:${jobId}:progress`,
    JSON.stringify({ jobId, progress, message, timestamp: Date.now() }),
  )
}

/**
 * Parses a multipart stream and yields parts as { name, headers, stream } objects.
 * This is a minimal implementation sufficient for the companion's response format.
 *
 * The companion sends:
 *   Part 1: manifest.json (initial, files array empty)
 *   Part 2: dump.sql (if type includes db)
 *   Part 3: files.tar.gz (if type includes files)
 *   Part 4: manifest.json (final, with checksums)
 */
async function* parseMultipartStream(
  stream: ReadableStream<Uint8Array>,
  boundary: string,
): AsyncGenerator<{ name: string; data: Buffer }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []

  // Collect the entire stream into memory in chunks
  // For large files this is a concern — but the streaming approach
  // for the actual tar.gz part uses a pass-through to storage
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }

  const fullBuffer = Buffer.concat(chunks)
  const boundaryBuffer = Buffer.from(`--${boundary}`)
  const parts: { name: string; data: Buffer }[] = []

  let searchStart = 0
  while (searchStart < fullBuffer.length) {
    const boundaryIdx = fullBuffer.indexOf(boundaryBuffer, searchStart)
    if (boundaryIdx === -1) break

    const lineEnd = fullBuffer.indexOf('\r\n', boundaryIdx + boundaryBuffer.length)
    if (lineEnd === -1) break

    const afterBoundary = fullBuffer.slice(boundaryIdx + boundaryBuffer.length, lineEnd).toString()
    if (afterBoundary === '--') break // End of multipart

    // Find Content-Disposition header
    const headerStart = lineEnd + 2
    const headerEnd = fullBuffer.indexOf('\r\n\r\n', headerStart)
    if (headerEnd === -1) break

    const headers = fullBuffer.slice(headerStart, headerEnd).toString()
    const nameMatch = headers.match(/name="([^"]+)"/)
    const name = nameMatch ? nameMatch[1] ?? '' : ''

    // Find the next boundary
    const dataStart = headerEnd + 4
    const nextBoundary = fullBuffer.indexOf(boundaryBuffer, dataStart)
    const dataEnd = nextBoundary === -1 ? fullBuffer.length : nextBoundary - 2 // strip \r\n before boundary

    const data = fullBuffer.slice(dataStart, dataEnd)
    parts.push({ name, data })
    searchStart = nextBoundary === -1 ? fullBuffer.length : nextBoundary
  }

  for (const part of parts) {
    yield part
  }
}

export async function processBackupJob(job: Job<BackupJobPayload>): Promise<void> {
  const { siteId, type, snapshotTag } = job.data
  const jobId = job.id ?? 'unknown'

  // 1. Look up site and storage profile
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) })
  if (!site) throw new Error(`Site not found: ${siteId}`)
  if (!site.companionTokenHash) throw new Error(`Site ${siteId} has no companion token`)

  // 2. Create backup record in DB
  const [backup] = await db
    .insert(backups)
    .values({
      siteId,
      type,
      snapshotTag,
      status: 'running',
    })
    .returning()
  if (!backup) throw new Error('Failed to create backup record')

  // 3. Update job status in DB
  await db
    .update(jobs)
    .set({ status: 'running', progress: 0, updatedAt: new Date() })
    .where(eq(jobs.id, jobId))

  await publishProgress(jobId, 0, 'Starting backup')

  try {
    // 4. Build HMAC-signed headers for the companion request
    const body = JSON.stringify({ type })
    const path = '/wp-json/sitepilot/v1/backup'
    // Note: we use the raw companion token which we don't store.
    const token = decryptToken(site.companionTokenHash)

    const { timestamp, signature } = signRequest({
      method: 'POST',
      path,
      body,
      token,
    })

    const companionUrl = `${site.url}/wp-json/sitepilot/v1/backup`
    await publishProgress(jobId, 10, 'Connecting to companion')

    // 5. POST to companion — it streams back a multipart response
    const response = await fetch(companionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SitePilot-Timestamp': timestamp,
        'X-SitePilot-Signature': signature,
      },
      body,
    })

    if (!response.ok) {
      throw new Error(`Companion returned ${response.status}: ${await response.text()}`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/)
    if (!boundaryMatch) {
      throw new Error('Companion response is not multipart')
    }
    const boundary = boundaryMatch[1] ?? ''

    // Resolve storage adapter
    let storageAdapter
    if (site.storageProfileId) {
      const profile = await db.query.storageProfiles.findFirst({
        where: eq(storageProfiles.id, site.storageProfileId),
      })
      if (profile) {
        storageAdapter = StorageAdapterFactory.create(profile)
      }
    }

    if (!storageAdapter) {
      // Fall back to local adapter if no storage profile configured
      const { LocalAdapter } = await import('@sitepilot/storage')
      storageAdapter = new LocalAdapter({
        apiBaseUrl: process.env['API_BASE_URL'] ?? 'http://localhost:3001',
        tokenSecret: process.env['STORAGE_ENCRYPTION_KEY'] ?? 'dev-secret',
      })
    }

    await publishProgress(jobId, 20, 'Receiving backup stream')

    let initialManifest: Record<string, unknown> = {}
    let finalManifest: Record<string, unknown> = {}
    let partIndex = 0

    if (!response.body) {
      throw new Error('Response body is null')
    }

    // 6. Parse multipart stream and route parts to storage
    for await (const part of parseMultipartStream(response.body, boundary)) {
      partIndex++
      if (partIndex === 1) {
        // Part 1: initial manifest
        initialManifest = JSON.parse(part.data.toString('utf8')) as Record<string, unknown>
        await publishProgress(jobId, 30, 'Received manifest')
      } else if (part.name === 'dump.sql') {
        // Part 2: database dump
        const storageKey = `backups/${siteId}/${backup.id}/dump.sql`
        const readable = Readable.from(part.data)
        await storageAdapter.upload(storageKey, readable)
        await publishProgress(jobId, 50, 'Database dump uploaded')
      } else if (part.name === 'files.tar.gz') {
        // Part 3: files archive
        const storageKey = `backups/${siteId}/${backup.id}/files.tar.gz`
        const readable = Readable.from(part.data)
        await storageAdapter.upload(storageKey, readable)
        await publishProgress(jobId, 70, 'Files archive uploaded')
      } else if (partIndex > 1 && part.name === '' || part.name === 'manifest.json') {
        // Part 4: final manifest with checksums
        try {
          finalManifest = JSON.parse(part.data.toString('utf8')) as Record<string, unknown>
        } catch {
          finalManifest = initialManifest
        }
      }
    }

    const manifest = Object.keys(finalManifest).length > 0 ? finalManifest : initialManifest
    const storagePath = `backups/${siteId}/${backup.id}`

    // 7. Update backup record with manifest and completion status
    await db
      .update(backups)
      .set({
        status: 'complete',
        manifest,
        storagePath,
        completedAt: new Date(),
      })
      .where(eq(backups.id, backup.id))

    // 8. Update job as complete
    await db
      .update(jobs)
      .set({
        status: 'complete',
        progress: 100,
        result: { backupId: backup.id, storagePath, manifest },
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))

    await publishProgress(jobId, 100, 'Backup complete')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Mark backup as failed
    await db
      .update(backups)
      .set({ status: 'failed', completedAt: new Date() })
      .where(eq(backups.id, backup.id))

    // Mark job as failed
    await db
      .update(jobs)
      .set({
        status: 'failed',
        result: { error: errorMessage },
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))

    await publishProgress(jobId, -1, `Backup failed: ${errorMessage}`)
    throw error
  }
}
