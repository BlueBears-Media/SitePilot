export interface BackupJobPayload {
  siteId: string
  type: 'full' | 'db_only' | 'files_only'
  storageProfileId?: string
  snapshotTag?: string
}

export interface UpdateCheckJobPayload {
  siteId: string
}

export interface ApplyUpdateJobPayload {
  siteId: string
  updateType: 'core' | 'plugin' | 'theme'
  slug?: string
}

export interface RollbackJobPayload {
  siteId: string
  backupId: string
  scope: 'full' | 'db_only' | 'files_only'
}

export type QueueName = 'backup' | 'update-check' | 'apply-update' | 'rollback'
