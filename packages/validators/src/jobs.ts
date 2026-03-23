import { z } from 'zod'

export const jobTypeSchema = z.enum(['backup', 'update_check', 'apply_update', 'rollback'])

export const jobStatusSchema = z.enum(['pending', 'running', 'complete', 'failed'])

export const applyUpdateSchema = z.object({
  siteId: z.string().uuid('Must be a valid UUID'),
  updateType: z.enum(['core', 'plugin', 'theme']),
  slug: z.string().optional(),
})

export const rollbackSchema = z.object({
  siteId: z.string().uuid('Must be a valid UUID'),
  backupId: z.string().uuid('Must be a valid UUID'),
  scope: z.enum(['full', 'db_only', 'files_only']),
})

export type JobType = z.infer<typeof jobTypeSchema>
export type JobStatus = z.infer<typeof jobStatusSchema>
export type ApplyUpdateInput = z.infer<typeof applyUpdateSchema>
export type RollbackInput = z.infer<typeof rollbackSchema>
