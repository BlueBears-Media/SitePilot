import { Queue } from 'bullmq'
import { redisConnection } from './redis'
import type {
  BackupJobPayload,
  UpdateCheckJobPayload,
  ApplyUpdateJobPayload,
  RollbackJobPayload,
} from './types'

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
}

export const backupQueue = new Queue<BackupJobPayload>('backup', {
  connection: redisConnection,
  defaultJobOptions,
})

export const updateCheckQueue = new Queue<UpdateCheckJobPayload>('update-check', {
  connection: redisConnection,
  defaultJobOptions,
})

export const applyUpdateQueue = new Queue<ApplyUpdateJobPayload>('apply-update', {
  connection: redisConnection,
  defaultJobOptions,
})

export const rollbackQueue = new Queue<RollbackJobPayload>('rollback', {
  connection: redisConnection,
  defaultJobOptions,
})
