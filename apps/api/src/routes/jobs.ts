import type { FastifyInstance } from 'fastify'
import { db, jobs } from '@sitepilot/db'
import { eq } from 'drizzle-orm'
import { redisPubSub } from '@sitepilot/queue'
import { requireAuth } from '../plugins/auth'

export async function jobsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', requireAuth)

  // GET /jobs/:id
  fastify.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, id) })
    if (!job) return reply.status(404).send({ error: 'Job not found' })
    return reply.send(job)
  })

  // GET /jobs/:id/stream — SSE endpoint for real-time progress
  fastify.get('/jobs/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string }

    // Verify job exists
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, id) })
    if (!job) return reply.status(404).send({ error: 'Job not found' })

    // Set SSE headers
    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    })

    // Send initial job state
    const sendEvent = (data: object): void => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    sendEvent({ type: 'connected', jobId: id, status: job.status, progress: job.progress })

    // If job is already in a terminal state, send final event and close
    if (job.status === 'complete' || job.status === 'failed') {
      sendEvent({ type: 'terminal', jobId: id, status: job.status, result: job.result })
      reply.raw.end()
      return
    }

    // Subscribe to Redis pub/sub for progress events
    const channel = `job:${id}:progress`
    const subscriber = redisPubSub.duplicate()

    await subscriber.subscribe(channel)

    const cleanup = (): void => {
      void subscriber.unsubscribe(channel)
      subscriber.disconnect()
    }

    subscriber.on('message', (ch: string, message: string) => {
      if (ch !== channel) return
      try {
        const data = JSON.parse(message) as Record<string, unknown>
        sendEvent({ type: 'progress', ...data })

        // Close stream when job reaches terminal state
        if (data['progress'] === 100 || data['progress'] === -1) {
          cleanup()
          reply.raw.end()
        }
      } catch {
        // Ignore malformed messages
      }
    })

    // Handle client disconnect
    request.raw.on('close', cleanup)

    // Heartbeat every 30 seconds to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n')
    }, 30_000)

    request.raw.on('close', () => {
      clearInterval(heartbeat)
      cleanup()
    })
  })
}
