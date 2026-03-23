import type { FastifyInstance } from 'fastify'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { db, sites, jobs, backups, updateChecks, notifications, storageProfiles } from '@sitepilot/db'
import { eq } from 'drizzle-orm'
import { createSiteSchema, updateSiteSchema, applyUpdateSchema, rollbackSchema } from '@sitepilot/validators'
import { backupQueue, updateCheckQueue, applyUpdateQueue, rollbackQueue } from '@sitepilot/queue'
import { requireAuth } from '../plugins/auth'

// AES-256-GCM token encryption — key must be 32-byte hex from STORAGE_ENCRYPTION_KEY
const ENC_KEY = Buffer.from(
  process.env['STORAGE_ENCRYPTION_KEY'] ?? '0'.repeat(64),
  'hex',
)

export function encryptToken(raw: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', ENC_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptToken(stored: string): string {
  const [ivHex, tagHex, encHex] = stored.split(':')
  if (!ivHex || !tagHex || !encHex) throw new Error('Invalid encrypted token format')
  const decipher = createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8')
}

function generateCompanionToken(): { rawToken: string; encryptedToken: string } {
  const rawToken = randomBytes(32).toString('hex')
  return {
    rawToken,
    encryptedToken: encryptToken(rawToken),
  }
}

export async function sitesRoutes(fastify: FastifyInstance): Promise<void> {
  // All routes require authentication
  fastify.addHook('preHandler', requireAuth)

  // GET /sites
  fastify.get('/sites', async (_request, reply) => {
    const allSites = await db.query.sites.findMany({
      with: { storageProfile: true },
      orderBy: (sites, { desc }) => [desc(sites.createdAt)],
    })
    return reply.send(allSites)
  })

  // POST /sites
  fastify.post('/sites', async (request, reply) => {
    const result = createSiteSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() })
    }

    // Generate companion token — stored AES-256-GCM encrypted so backend can sign HMAC requests
    const { rawToken, encryptedToken } = generateCompanionToken()

    const [site] = await db
      .insert(sites)
      .values({
        name: result.data.name,
        url: result.data.url,
        companionTokenHash: encryptedToken,
        status: 'unknown',
      })
      .returning()

    // Return the raw token once — it will never be retrievable again
    return reply.status(201).send({
      ...site,
      companionToken: rawToken,
      _warning: 'Save this token now — it will not be shown again',
    })
  })

  // GET /sites/:id
  fastify.get('/sites/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const site = await db.query.sites.findFirst({
      where: eq(sites.id, id),
      with: { storageProfile: true },
    })
    if (!site) return reply.status(404).send({ error: 'Site not found' })
    return reply.send(site)
  })

  // POST /sites/:id/rotate-token — generate a new one-time companion token
  fastify.post('/sites/:id/rotate-token', async (request, reply) => {
    const { id } = request.params as { id: string }
    const existingSite = await db.query.sites.findFirst({ where: eq(sites.id, id) })
    if (!existingSite) return reply.status(404).send({ error: 'Site not found' })

    const { rawToken, encryptedToken } = generateCompanionToken()

    const [updatedSite] = await db
      .update(sites)
      .set({
        companionTokenHash: encryptedToken,
        status: 'unknown',
      })
      .where(eq(sites.id, id))
      .returning()

    if (!updatedSite) return reply.status(404).send({ error: 'Site not found' })

    return reply.send({
      ...updatedSite,
      companionToken: rawToken,
      _warning: 'Save this token now — the previous token was invalidated immediately',
    })
  })

  // GET /sites/:id/updates — latest stored update-check result for this site
  fastify.get('/sites/:id/updates', async (request, reply) => {
    const { id } = request.params as { id: string }
    const site = await db.query.sites.findFirst({ where: eq(sites.id, id) })
    if (!site) return reply.status(404).send({ error: 'Site not found' })

    const latestUpdateCheck = await db.query.updateChecks.findFirst({
      where: eq(updateChecks.siteId, id),
      orderBy: (updateChecks, { desc }) => [desc(updateChecks.checkedAt)],
    })

    return reply.send(
      latestUpdateCheck ?? {
        siteId: id,
        coreUpdate: null,
        pluginUpdates: [],
        themeUpdates: [],
        checkedAt: null,
      },
    )
  })

  // PATCH /sites/:id
  fastify.patch('/sites/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateSiteSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() })
    }

    const updateData: Record<string, unknown> = {}
    if (result.data.name !== undefined) updateData['name'] = result.data.name
    if (result.data.url !== undefined) updateData['url'] = result.data.url
    if (result.data.storageProfileId !== undefined) {
      if (result.data.storageProfileId !== null) {
        const storageProfile = await db.query.storageProfiles.findFirst({
          where: eq(storageProfiles.id, result.data.storageProfileId),
        })
        if (!storageProfile) {
          return reply.status(404).send({ error: 'Storage profile not found' })
        }
      }
      updateData['storageProfileId'] = result.data.storageProfileId
    }

    const [updated] = await db.update(sites).set(updateData).where(eq(sites.id, id)).returning()
    if (!updated) return reply.status(404).send({ error: 'Site not found' })
    return reply.send(updated)
  })

  // DELETE /sites/:id
  fastify.delete('/sites/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const deleted = await db.transaction(async (tx) => {
        await tx.delete(notifications).where(eq(notifications.siteId, id))
        await tx.delete(updateChecks).where(eq(updateChecks.siteId, id))
        await tx.delete(backups).where(eq(backups.siteId, id))
        await tx.delete(jobs).where(eq(jobs.siteId, id))

        const [site] = await tx.delete(sites).where(eq(sites.id, id)).returning()
        return site
      })

      if (!deleted) return reply.status(404).send({ error: 'Site not found' })
      return reply.status(204).send()
    } catch (error) {
      request.log.error({ error, siteId: id }, 'Failed to delete site')
      return reply.status(500).send({ error: 'Failed to delete site' })
    }
  })

  // POST /sites/:id/check-updates — enqueue update check job
  fastify.post('/sites/:id/check-updates', async (request, reply) => {
    const { id } = request.params as { id: string }
    const site = await db.query.sites.findFirst({ where: eq(sites.id, id) })
    if (!site) return reply.status(404).send({ error: 'Site not found' })

    const [jobRecord] = await db
      .insert(jobs)
      .values({
        type: 'update_check',
        siteId: id,
        status: 'pending',
        payload: { siteId: id },
      })
      .returning()

    if (!jobRecord) return reply.status(500).send({ error: 'Failed to create job' })

    await updateCheckQueue.add('update-check', { siteId: id }, { jobId: jobRecord.id })

    return reply.status(202).send({ jobId: jobRecord.id, status: 'pending' })
  })

  // POST /sites/:id/apply-update
  fastify.post('/sites/:id/apply-update', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = applyUpdateSchema.safeParse({ siteId: id, ...(request.body as object) })
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() })
    }

    const site = await db.query.sites.findFirst({ where: eq(sites.id, id) })
    if (!site) return reply.status(404).send({ error: 'Site not found' })

    const payload = { siteId: id, updateType: result.data.updateType, slug: result.data.slug }
    const [jobRecord] = await db
      .insert(jobs)
      .values({ type: 'apply_update', siteId: id, status: 'pending', payload })
      .returning()

    if (!jobRecord) return reply.status(500).send({ error: 'Failed to create job' })

    await applyUpdateQueue.add('apply-update', payload, { jobId: jobRecord.id })

    return reply.status(202).send({ jobId: jobRecord.id, status: 'pending' })
  })

  // POST /sites/:id/rollback
  fastify.post('/sites/:id/rollback', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = rollbackSchema.safeParse({ siteId: id, ...(request.body as object) })
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() })
    }

    const site = await db.query.sites.findFirst({ where: eq(sites.id, id) })
    if (!site) return reply.status(404).send({ error: 'Site not found' })
    if (site.status !== 'active') {
      return reply.status(409).send({ error: 'Site is not active — companion must be reachable for rollback' })
    }

    const payload = {
      siteId: id,
      backupId: result.data.backupId,
      scope: result.data.scope,
    }
    const [jobRecord] = await db
      .insert(jobs)
      .values({ type: 'rollback', siteId: id, status: 'pending', payload })
      .returning()

    if (!jobRecord) return reply.status(500).send({ error: 'Failed to create job' })

    await rollbackQueue.add('rollback', payload, { jobId: jobRecord.id })

    return reply.status(202).send({ jobId: jobRecord.id, status: 'pending' })
  })

  // GET /sites/:id/jobs
  fastify.get('/sites/:id/jobs', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { page = '1', limit = '20' } = request.query as { page?: string; limit?: string }

    const pageNum = Math.max(1, parseInt(page, 10))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)))

    const allJobs = await db.query.jobs.findMany({
      where: eq(jobs.siteId, id),
      orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    })

    return reply.send({ jobs: allJobs, page: pageNum, limit: limitNum })
  })
}
