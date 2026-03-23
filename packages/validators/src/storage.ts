import { z } from 'zod'

export const storageTypeSchema = z.enum(['s3', 'nfs', 'local'])

export const s3ConfigSchema = z.object({
  type: z.literal('s3'),
  bucket: z.string().min(1, 'Bucket is required'),
  region: z.string().min(1, 'Region is required'),
  endpoint: z.string().min(1, 'Endpoint is required'),
  accessKeyId: z.string().min(1, 'Access key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret access key is required'),
})

export const nfsConfigSchema = z.object({
  type: z.literal('nfs'),
  mountPath: z.string().min(1, 'Mount path is required'),
})

export const localConfigSchema = z.object({
  type: z.literal('local'),
  directory: z.string().min(1, 'Directory is required'),
})

export const storageConfigSchema = z.discriminatedUnion('type', [
  s3ConfigSchema,
  nfsConfigSchema,
  localConfigSchema,
])

export const createStorageProfileSchema = z.object({
  name: z.string().min(1, 'Profile name is required'),
  type: storageTypeSchema,
  config: storageConfigSchema,
})

export const updateStorageProfileSchema = createStorageProfileSchema.partial()

export type StorageType = z.infer<typeof storageTypeSchema>
export type S3Config = z.infer<typeof s3ConfigSchema>
export type NfsConfig = z.infer<typeof nfsConfigSchema>
export type LocalConfig = z.infer<typeof localConfigSchema>
export type StorageConfig = z.infer<typeof storageConfigSchema>
export type CreateStorageProfileInput = z.infer<typeof createStorageProfileSchema>
export type UpdateStorageProfileInput = z.infer<typeof updateStorageProfileSchema>
