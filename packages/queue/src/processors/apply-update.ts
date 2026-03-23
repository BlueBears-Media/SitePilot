import type { Job } from 'bullmq'
import { db, jobs, sites } from '@sitepilot/db'
import { eq } from 'drizzle-orm'
import { signRequest, decryptToken } from '../hmac'
import { updateCheckQueue } from '../queues'
import type { ApplyUpdateJobPayload } from '../types'

const POLL_INTERVAL_MS = 10_000 // 10 seconds
const UPDATE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Waits for a BullMQ job to reach 'complete' or 'failed' status.
 * Polls the DB every 5 seconds up to the specified timeout.
 */
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

export async function processApplyUpdateJob(job: Job<ApplyUpdateJobPayload>): Promise<void> {
  const { siteId, updateType, slug } = job.data
  const jobId = job.id ?? 'unknown'

  await db
    .update(jobs)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(jobs.id, jobId))

  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) })
  if (!site) throw new Error(`Site not found: ${siteId}`)
  if (!site.companionTokenHash) throw new Error(`Site ${siteId} has no companion token`)

  try {
    // 1. POST apply-update to companion
    const body = JSON.stringify({ update_type: updateType, slug })
    const path = '/wp-json/sitepilot/v1/apply-update'
    const token = decryptToken(site.companionTokenHash)

    const { timestamp, signature } = signRequest({ method: 'POST', path, body, token })

    const applyResponse = await fetch(`${site.url}/wp-json/sitepilot/v1/apply-update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SitePilot-Timestamp': timestamp,
        'X-SitePilot-Signature': signature,
      },
      body,
    })

    if (!applyResponse.ok) {
      throw new Error(`Companion apply-update returned ${applyResponse.status}`)
    }

    const applyData = (await applyResponse.json()) as { job_id: string; status: string }
    const companionJobId = applyData.job_id

    // 2. Poll update-status until complete or timeout
    const updateDeadline = Date.now() + UPDATE_TIMEOUT_MS
    let updateStatus = 'running'
    let updateMessage: string | undefined

    while (Date.now() < updateDeadline && updateStatus === 'running') {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

      const statusBody = ''
      const statusPath = `/wp-json/sitepilot/v1/update-status`
      const statusSigned = signRequest({ method: 'GET', path: statusPath, body: statusBody, token })

      const statusResponse = await fetch(
        `${site.url}/wp-json/sitepilot/v1/update-status?job_id=${companionJobId}`,
        {
          headers: {
            'X-SitePilot-Timestamp': statusSigned.timestamp,
            'X-SitePilot-Signature': statusSigned.signature,
          },
        },
      )

      if (!statusResponse.ok) {
        const responseText = await statusResponse.text()
        throw new Error(
          `Companion update-status returned ${statusResponse.status}${
            responseText ? `: ${responseText}` : ''
          }`,
        )
      }

      const statusData = (await statusResponse.json()) as { status: string; message?: string }
      updateStatus = statusData.status
      updateMessage = statusData.message
    }

    if (updateStatus !== 'complete') {
      throw new Error(
        updateMessage
          ? `Update failed: ${updateMessage}`
          : `Update timed out or failed with status: ${updateStatus}`,
      )
    }

    // 3. Re-run update check to confirm version bumped
    const [updateCheckJobRecord] = await db
      .insert(jobs)
      .values({
        type: 'update_check',
        siteId,
        status: 'pending',
        payload: { siteId },
      })
      .returning()

    if (updateCheckJobRecord) {
      await updateCheckQueue.add('update-check', { siteId }, { jobId: updateCheckJobRecord.id })
      await waitForJob(updateCheckJobRecord.id, 60_000)
    }

    // 4. Mark job complete
    await db
      .update(jobs)
      .set({
        status: 'complete',
        progress: 100,
        result: { updateType, slug, companionJobId, updateStatus, message: updateMessage },
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
