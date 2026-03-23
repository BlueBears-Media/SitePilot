import { z } from 'zod'

export const backupTypeSchema = z.enum(['full', 'db_only', 'files_only'])

export const createBackupSchema = z.object({
  type: backupTypeSchema,
  storageProfileId: z.string().uuid('Must be a valid UUID'),
  snapshotTag: z.string().optional(),
})

export type BackupType = z.infer<typeof backupTypeSchema>
export type CreateBackupInput = z.infer<typeof createBackupSchema>
