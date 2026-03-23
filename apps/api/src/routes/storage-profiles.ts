import type { FastifyInstance } from 'fastify'
import { db, storageProfiles } from '@sitepilot/db'
import { eq } from 'drizzle-orm'
import { createStorageProfileSchema, updateStorageProfileSchema } from '@sitepilot/validators'
import { StorageAdapterFactory, encryptConfig } from '@sitepilot/storage'
import { requireAuth } from '../plugins/auth'

export async function storageProfilesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', requireAuth)

  // GET /storage-profiles
  fastify.get('/storage-profiles', async (_request, reply) => {
    const profiles = await db.query.storageProfiles.findMany({
      orderBy: (sp, { desc }) => [desc(sp.createdAt)],
    })
    // Never return the encrypted config to the client
    const safeProfiles = profiles.map(({ config: _, ...rest }) => rest)
    return reply.send(safeProfiles)
  })

  // POST /storage-profiles
  fastify.post('/storage-profiles', async (request, reply) => {
    const result = createStorageProfileSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() })
    }

    // Encrypt the config before storing
    const encryptedConfig = encryptConfig(result.data.config)

    const [profile] = await db
      .insert(storageProfiles)
      .values({
        name: result.data.name,
        type: result.data.type,
        config: encryptedConfig,
      })
      .returning()

    if (!profile) return reply.status(500).send({ error: 'Failed to create profile' })

    const { config: _, ...safeProfile } = profile
    return reply.status(201).send(safeProfile)
  })

  // PATCH /storage-profiles/:id
  fastify.patch('/storage-profiles/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateStorageProfileSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() })
    }

    const updateData: Record<string, unknown> = {}
    if (result.data.name !== undefined) updateData['name'] = result.data.name
    if (result.data.type !== undefined) updateData['type'] = result.data.type
    if (result.data.config !== undefined) {
      updateData['config'] = encryptConfig(result.data.config)
    }

    const [updated] = await db
      .update(storageProfiles)
      .set(updateData)
      .where(eq(storageProfiles.id, id))
      .returning()

    if (!updated) return reply.status(404).send({ error: 'Profile not found' })

    const { config: _, ...safeProfile } = updated
    return reply.send(safeProfile)
  })

  // DELETE /storage-profiles/:id
  fastify.delete('/storage-profiles/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const [deleted] = await db.delete(storageProfiles).where(eq(storageProfiles.id, id)).returning()
    if (!deleted) return reply.status(404).send({ error: 'Profile not found' })
    return reply.status(204).send()
  })

  // POST /storage-profiles/:id/test — test connectivity
  fastify.post('/storage-profiles/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string }
    const profile = await db.query.storageProfiles.findFirst({
      where: eq(storageProfiles.id, id),
    })
    if (!profile) return reply.status(404).send({ error: 'Profile not found' })

    try {
      const adapter = StorageAdapterFactory.create(profile)
      // Use a harmless probe key — just check if the adapter can communicate
      const probeKey = '.sitepilot-connection-test'
      const exists = await adapter.exists(probeKey)
      return reply.send({
        success: true,
        message: `Connection successful (probe key exists: ${exists})`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return reply.status(422).send({ success: false, message })
    }
  })
}
