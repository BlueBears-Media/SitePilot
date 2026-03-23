import { jobsApi, type Job } from './api'

const DEFAULT_POLL_INTERVAL_MS = 2_500
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getJobErrorMessage(result: unknown): string | null {
  if (typeof result === 'string' && result.trim().length > 0) {
    return result
  }

  if (!isRecord(result)) {
    return null
  }

  const error = result['error']
  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  const message = result['message']
  if (typeof message === 'string' && message.trim().length > 0) {
    return message
  }

  return null
}

export function getJobResultSummary(job: Pick<Job, 'type' | 'status' | 'result'>): string | null {
  const errorMessage = getJobErrorMessage(job.result)
  if (errorMessage) {
    return errorMessage
  }

  if (!isRecord(job.result)) {
    return job.status === 'complete' ? 'Completed successfully' : null
  }

  if (job.type === 'update_check') {
    const pluginCount = job.result['pluginCount']
    const themeCount = job.result['themeCount']
    const core = job.result['core']
    const parts: string[] = []

    if (typeof pluginCount === 'number') {
      parts.push(`${pluginCount} plugin update${pluginCount === 1 ? '' : 's'}`)
    }
    if (typeof themeCount === 'number') {
      parts.push(`${themeCount} theme update${themeCount === 1 ? '' : 's'}`)
    }
    if (core) {
      parts.push('core update available')
    }

    return parts.length > 0 ? parts.join(', ') : 'Update check completed'
  }

  if (job.type === 'backup' && typeof job.result['backupId'] === 'string') {
    const storageTarget = job.result['storageTarget']
    const uploadedObjects = job.result['uploadedObjects']
    const uploadedCount = Array.isArray(uploadedObjects) ? uploadedObjects.length : null

    if (isRecord(storageTarget)) {
      const summary = storageTarget['summary']
      if (typeof summary === 'string' && summary.trim().length > 0) {
        return uploadedCount !== null
          ? `Stored ${uploadedCount} object${uploadedCount === 1 ? '' : 's'} in ${summary}`
          : `Stored in ${summary}`
      }
    }

    return uploadedCount !== null
      ? `Backup completed (${uploadedCount} object${uploadedCount === 1 ? '' : 's'})`
      : 'Backup completed'
  }

  if (job.type === 'apply_update') {
    const updateType = job.result['updateType']
    if (typeof updateType === 'string') {
      return `${updateType.replace(/_/g, ' ')} update completed`
    }
  }

  if (job.type === 'rollback' && typeof job.result['scope'] === 'string') {
    return `${job.result['scope']} rollback completed`
  }

  return job.status === 'complete' ? 'Completed successfully' : null
}

export async function waitForTerminalJob(
  jobId: string,
  options?: {
    intervalMs?: number
    timeoutMs?: number
  },
): Promise<Job> {
  const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const job = await jobsApi.get(jobId)
    if (job.status === 'complete' || job.status === 'failed') {
      return job
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Job ${jobId} did not finish within ${Math.round(timeoutMs / 1000)} seconds`)
}
