import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    authenticate(): Promise<void>
    user: { id: string; email: string; role: string }
  }
}

export async function authPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('authenticate', async function (this: FastifyRequest) {
    await this.jwtVerify()
  })
}

/**
 * Pre-handler that can be used on individual routes to enforce authentication.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify()
  } catch {
    await reply.status(401).send({ error: 'Unauthorized' })
  }
}
