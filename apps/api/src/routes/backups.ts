import type { FastifyInstance } from 'fastify'
import { db, backups, sites, storageProfiles, jobs } from '@sitepilot/db'
import { eq } from 'drizzle-orm'
import { createBackupSchema } from '@sitepilot/validators'
import { backupQueue } from '@sitepilot/queue'
import { StorageAdapterFactory } from '@sitepilot/storage'
import { requireAuth } from '../plugins/auth'

const DOWNLOAD_URL_EXPIRY = 15 * 60 // 15 minutes in seconds

export async function backupsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', requireAuth)

  // GET /sites/:id/backups
  fastify.get('/sites/:id/backups', async (request, reply) => {
    const { id } = request.params as { id: string }
    const siteBackups = await db.query.backups.findMany({
      where: eq(backups.siteId, id),
      orderBy: (backups, { desc }) => [desc(backups.createdAt)],
    })
    return reply.send(siteBackups)
  })

  // POST /sites/:id/backups — trigger manual backup
  fastify.post('/sites/:id/backups', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = createBackupSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() })
    }

    const site = await db.query.sites.findFirst({ where: eq(sites.id, id) })
    if (!site) return reply.status(404).send({ error: 'Site not found' })

    const payload = {
      siteId: id,
      type: result.data.type,
      snapshotTag: result.data.snapshotTag,
    }

    const [jobRecord] = await db
      .insert(jobs)
      .values({ type: 'backup', siteId: id, status: 'pending', payload })
      .returning()

    if (!jobRecord) return reply.status(500).send({ error: 'Failed to create job' })

    await backupQueue.add('backup', payload, { jobId: jobRecord.id })

    return reply.status(202).send({ jobId: jobRecord.id, status: 'pending' })
  })

  // GET /backups/:id
  fastify.get('/backups/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const backup = await db.query.backups.findFirst({ where: eq(backups.id, id) })
    if (!backup) return reply.status(404).send({ error: 'Backup not found' })
    return reply.send(backup)
  })

  // DELETE /backups/:id
  fastify.delete('/backups/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const backup = await db.query.backups.findFirst({ where: eq(backups.id, id) })
    if (!backup) return reply.status(404).send({ error: 'Backup not found' })

    // Attempt to delete from storage as well
    const site = await db.query.sites.findFirst({ where: eq(sites.id, backup.siteId) })
    if (site?.storageProfileId) {
      const profile = await db.query.storageProfiles.findFirst({
        where: eq(storageProfiles.id, site.storageProfileId),
      })
      if (profile) {
        try {
          const adapter = StorageAdapterFactory.create(profile)
          if (backup.storagePath) {
            await adapter.delete(`${backup.storagePath}/dump.sql`).catch(() => undefined)
            await adapter.delete(`${backup.storagePath}/files.tar.gz`).catch(() => undefined)
          }
        } catch {
          // Log but don't fail the delete if storage cleanup fails
          fastify.log.warn(`Failed to delete storage files for backup ${id}`)
        }
      }
    }

    await db.delete(backups).where(eq(backups.id, id))
    return reply.status(204).send()
  })

  // GET /backups/:id/download — returns a short-lived signed URL
  fastify.get('/backups/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { file = 'files.tar.gz' } = request.query as { file?: string }

    const backup = await db.query.backups.findFirst({ where: eq(backups.id, id) })
    if (!backup) return reply.status(404).send({ error: 'Backup not found' })
    if (!backup.storagePath) return reply.status(409).send({ error: 'Backup has no storage path' })

    const site = await db.query.sites.findFirst({ where: eq(sites.id, backup.siteId) })
    if (!site) return reply.status(404).send({ error: 'Site not found' })

    let storageAdapter
    if (site.storageProfileId) {
      const profile = await db.query.storageProfiles.findFirst({
        where: eq(storageProfiles.id, site.storageProfileId),
      })
      if (profile) {
        storageAdapter = StorageAdapterFactory.create(profile)
      }
    }

    if (!storageAdapter) {
      const { LocalAdapter } = await import('@sitepilot/storage')
      storageAdapter = new LocalAdapter({
        apiBaseUrl: process.env['API_BASE_URL'] ?? 'http://localhost:3001',
        tokenSecret: process.env['STORAGE_ENCRYPTION_KEY'] ?? 'dev-secret',
      })
    }

    const key = `${backup.storagePath}/${file}`
    const url = await storageAdapter.signedUrl(key, DOWNLOAD_URL_EXPIRY)

    return reply.send({ url, expiresIn: DOWNLOAD_URL_EXPIRY })
  })
}
