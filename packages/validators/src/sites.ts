import { z } from 'zod'

export const createSiteSchema = z.object({
  name: z.string().min(1, 'Site name is required'),
  url: z.string().url('Must be a valid URL'),
})

export const updateSiteSchema = createSiteSchema
  .partial()
  .extend({
    storageProfileId: z.string().uuid('Must be a valid UUID').optional(),
  })

export type CreateSiteInput = z.infer<typeof createSiteSchema>
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>
