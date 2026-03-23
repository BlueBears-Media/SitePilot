import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import { db, users } from '@sitepilot/db'
import { eq } from 'drizzle-orm'
import { loginSchema, refreshSchema } from '@sitepilot/validators'

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /auth/login — rate limited to 10 requests per 15 minutes per IP
  fastify.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const result = loginSchema.safeParse(request.body)
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() })
      }

      const { email, password } = result.data

      const user = await db.query.users.findFirst({ where: eq(users.email, email) })
      if (!user) {
        // Use constant-time comparison to prevent user enumeration
        await bcrypt.compare(password, '$2b$12$invalidhashinvalidhashinvalidh')
        return reply.status(401).send({ error: 'Invalid credentials' })
      }

      const valid = await bcrypt.compare(password, user.passwordHash)
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid credentials' })
      }

      const payload = { id: user.id, email: user.email, role: user.role }

      const accessToken = fastify.jwt.sign(payload, { expiresIn: '15m' })
      const refreshToken = fastify.jwt.sign(
        { ...payload, tokenType: 'refresh' },
        {
          expiresIn: '7d',
          secret: process.env['JWT_REFRESH_SECRET'] ?? process.env['JWT_SECRET'] ?? '',
        },
      )

      // Set httpOnly cookie for web client
      void reply.setCookie('accessToken', accessToken, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 15 * 60, // 15 minutes
      })

      return reply.send({ accessToken, refreshToken })
    },
  )

  // POST /auth/refresh
  fastify.post('/auth/refresh', async (request, reply) => {
    const result = refreshSchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input' })
    }

    try {
      const payload = fastify.jwt.verify<{
        id: string
        email: string
        role: string
        tokenType: string
      }>(result.data.refreshToken, {
        secret: process.env['JWT_REFRESH_SECRET'] ?? process.env['JWT_SECRET'] ?? '',
      })

      if (payload.tokenType !== 'refresh') {
        return reply.status(401).send({ error: 'Invalid token type' })
      }

      const accessToken = fastify.jwt.sign(
        { id: payload.id, email: payload.email, role: payload.role },
        { expiresIn: '15m' },
      )

      void reply.setCookie('accessToken', accessToken, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 15 * 60,
      })

      return reply.send({ accessToken })
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' })
    }
  })

  // POST /auth/logout
  fastify.post('/auth/logout', async (_request, reply) => {
    void reply.clearCookie('accessToken', { path: '/' })
    return reply.send({ success: true })
  })
}
