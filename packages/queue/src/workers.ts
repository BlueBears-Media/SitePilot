import { Worker } from 'bullmq'
import { redisConnection } from './redis'
import { db, jobs } from '@sitepilot/db'
import { eq } from 'drizzle-orm'
import { processBackupJob } from './processors/backup'
import { processUpdateCheckJob } from './processors/update-check'
import { processApplyUpdateJob } from './processors/apply-update'
import { processRollbackJob } from './processors/rollback'
import type { BackupJobPayload, UpdateCheckJobPayload, ApplyUpdateJobPayload, RollbackJobPayload } from './types'

const WORKER_CONCURRENCY = 2

export const backupWorker = new Worker<BackupJobPayload>(
  'backup',
  processBackupJob,
  {
    connection: redisConnection,
    concurrency: WORKER_CONCURRENCY,
  },
)

export const updateCheckWorker = new Worker<UpdateCheckJobPayload>(
  'update-check',
  processUpdateCheckJob,
  {
    connection: redisConnection,
    concurrency: WORKER_CONCURRENCY,
  },
)

export const applyUpdateWorker = new Worker<ApplyUpdateJobPayload>(
  'apply-update',
  processApplyUpdateJob,
  {
    connection: redisConnection,
    concurrency: WORKER_CONCURRENCY,
  },
)

export const rollbackWorker = new Worker<RollbackJobPayload>(
  'rollback',
  processRollbackJob,
  {
    connection: redisConnection,
    concurrency: WORKER_CONCURRENCY,
  },
)

// Handle failed jobs: update the DB job status on terminal failure
// (after all retries are exhausted)
function handleFailed(worker: Worker, queueName: string): void {
  worker.on('failed', async (job, error) => {
    if (!job) return
    const jobId = job.id
    if (!jobId) return

    // Only mark as failed after all attempts are exhausted
    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      console.error(`[${queueName}] Job ${jobId} permanently failed:`, error.message)
      try {
        await db
          .update(jobs)
          .set({
            status: 'failed',
            result: { error: error.message },
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, jobId))
      } catch (dbError) {
        console.error(`Failed to update DB for job ${jobId}:`, dbError)
      }
    }
  })
}

handleFailed(backupWorker, 'backup')
handleFailed(updateCheckWorker, 'update-check')
handleFailed(applyUpdateWorker, 'apply-update')
handleFailed(rollbackWorker, 'rollback')

/**
 * Start all workers. Call this from your application entry point.
 */
export function startWorkers(): void {
  console.log('SitePilot queue workers started')
  console.log(`  backup worker: concurrency=${WORKER_CONCURRENCY}`)
  console.log(`  update-check worker: concurrency=${WORKER_CONCURRENCY}`)
  console.log(`  apply-update worker: concurrency=${WORKER_CONCURRENCY}`)
  console.log(`  rollback worker: concurrency=${WORKER_CONCURRENCY}`)
}
