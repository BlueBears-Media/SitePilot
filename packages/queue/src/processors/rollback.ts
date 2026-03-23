import type { Job } from 'bullmq'
import { db, jobs, sites, backups, storageProfiles } from '@sitepilot/db'
import { StorageAdapterFactory } from '@sitepilot/storage'
import { eq } from 'drizzle-orm'
import { signRequest, decryptToken } from '../hmac'
import { backupQueue } from '../queues'
import type { RollbackJobPayload } from '../types'

const POLL_INTERVAL_MS = 10_000 // 10 seconds
const RESTORE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const BACKUP_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const SIGNED_URL_EXPIRY = 10 * 60 // 10 minutes in seconds

async function waitForJob(jobId: string, timeoutMs: number): Promise<'complete' | 'failed'> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) })
    if (job?.status === 'complete') return 'complete'
    if (job?.status === 'failed') return 'failed'

    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`)
}

export async function processRollbackJob(job: Job<RollbackJobPayload>): Promise<void> {
  const { siteId, backupId, scope } = job.data
  const jobId = job.id ?? 'unknown'

  await db
    .update(jobs)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(jobs.id, jobId))

  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) })
  if (!site) throw new Error(`Site not found: ${siteId}`)
  if (!site.companionTokenHash) throw new Error(`Site ${siteId} has no companion token`)

  try {
    // 1. Create a pre-rollback backup and wait for it
    const [preRollbackJobRecord] = await db
      .insert(jobs)
      .values({
        type: 'backup',
        siteId,
        status: 'pending',
        payload: {
          siteId,
          type: 'full',
          storageProfileId: site.storageProfileId ?? undefined,
          snapshotTag: 'pre-rollback',
        },
      })
      .returning()

    if (!preRollbackJobRecord) throw new Error('Failed to create pre-rollback backup job')

    await backupQueue.add(
      'backup',
      {
        siteId,
        type: 'full',
        storageProfileId: site.storageProfileId ?? undefined,
        snapshotTag: 'pre-rollback',
      },
      { jobId: preRollbackJobRecord.id },
    )

    const backupResult = await waitForJob(preRollbackJobRecord.id, BACKUP_TIMEOUT_MS)
    if (backupResult === 'failed') {
      throw new Error('Pre-rollback backup failed — aborting rollback')
    }

    // 2. Fetch the target backup record
    const backup = await db.query.backups.findFirst({ where: eq(backups.id, backupId) })
    if (!backup) throw new Error(`Backup not found: ${backupId}`)

    // 3. Resolve storage adapter for the backup
    let storageAdapter
    const backupStorageProfileId = backup.storageProfileId ?? site.storageProfileId
    if (backupStorageProfileId) {
      const profile = await db.query.storageProfiles.findFirst({
        where: eq(storageProfiles.id, backupStorageProfileId),
      })
      if (profile) {
        storageAdapter = StorageAdapterFactory.create(profile)
      }
    }

    if (!storageAdapter) {
      const { LocalAdapter } = await import('@sitepilot/storage')
      storageAdapter = new LocalAdapter({
        apiBaseUrl: process.env['API_BASE_URL'] ?? 'http://localhost:3001',
        tokenSecret: process.env['STORAGE_ENCRYPTION_KEY'] ?? 'dev-secret',
      })
    }

    // 4. Generate a signed URL for the backup archive
    const archiveKey = scope === 'db_only'
      ? `${backup.storagePath}/dump.sql`
      : `${backup.storagePath}/files.tar.gz`

    const signedUrl = await storageAdapter.signedUrl(archiveKey, SIGNED_URL_EXPIRY)

    // 5. POST restore to companion
    const body = JSON.stringify({
      signed_url: signedUrl,
      manifest: backup.manifest,
      scope,
    })
    const path = '/wp-json/sitepilot/v1/restore'
    const token = decryptToken(site.companionTokenHash)

    const { timestamp, signature } = signRequest({ method: 'POST', path, body, token })

    const restoreResponse = await fetch(`${site.url}/wp-json/sitepilot/v1/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SitePilot-Timestamp': timestamp,
        'X-SitePilot-Signature': signature,
      },
      body,
    })

    if (!restoreResponse.ok) {
      throw new Error(`Companion restore returned ${restoreResponse.status}`)
    }

    const restoreData = (await restoreResponse.json()) as { job_id: string; status: string }
    const companionJobId = restoreData.job_id

    // 6. Poll restore-status until complete or timeout
    const restoreDeadline = Date.now() + RESTORE_TIMEOUT_MS
    let restoreStatus = 'running'

    while (Date.now() < restoreDeadline && restoreStatus === 'running') {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

      const statusBody = ''
      const statusPath = '/wp-json/sitepilot/v1/restore-status'
      const statusSigned = signRequest({ method: 'GET', path: statusPath, body: statusBody, token })

      const statusResponse = await fetch(
        `${site.url}/wp-json/sitepilot/v1/restore-status?job_id=${companionJobId}`,
        {
          headers: {
            'X-SitePilot-Timestamp': statusSigned.timestamp,
            'X-SitePilot-Signature': statusSigned.signature,
          },
        },
      )

      if (statusResponse.ok) {
        const statusData = (await statusResponse.json()) as { status: string; message?: string }
        restoreStatus = statusData.status
      }
    }

    if (restoreStatus !== 'complete') {
      throw new Error(`Restore timed out or failed with status: ${restoreStatus}`)
    }

    // 7. Mark job complete
    await db
      .update(jobs)
      .set({
        status: 'complete',
        progress: 100,
        result: { backupId, scope, companionJobId, restoreStatus },
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await db
      .update(jobs)
      .set({
        status: 'failed',
        result: { error: errorMessage },
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))

    throw error
  }
}
