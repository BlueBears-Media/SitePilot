import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyCookie from '@fastify/cookie'
import { startWorkers } from '@sitepilot/queue'
import { authPlugin } from './plugins/auth'
import { authRoutes } from './routes/auth'
import { sitesRoutes } from './routes/sites'
import { backupsRoutes } from './routes/backups'
import { storageProfilesRoutes } from './routes/storage-profiles'
import { jobsRoutes } from './routes/jobs'
import { storageServeRoutes } from './routes/storage-serve'

const PORT = parseInt(process.env['PORT'] ?? '3001', 10)
const HOST = process.env['HOST'] ?? '0.0.0.0'

async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const fastify = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  })

  // Security headers
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false, // Managed by frontend
  })

  // CORS — locked to SITEPILOT_ORIGIN in production
  await fastify.register(fastifyCors, {
    origin: process.env['SITEPILOT_ORIGIN'] ?? true,
    credentials: true,
  })

  // Cookie support (for httpOnly accessToken)
  await fastify.register(fastifyCookie)

  // JWT authentication
  await fastify.register(fastifyJwt, {
    secret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
    cookie: {
      cookieName: 'accessToken',
      signed: false,
    },
  })

  // Rate limiting — enabled per-route only (global: false)
  await fastify.register(fastifyRateLimit, {
    global: false,
    redis: undefined, // Uses in-memory store by default; swap for Redis in production
  })

  // Auth plugin — decorates request with authenticate()
  await fastify.register(authPlugin)

  // Routes
  await fastify.register(authRoutes)
  await fastify.register(sitesRoutes)
  await fastify.register(backupsRoutes)
  await fastify.register(storageProfilesRoutes)
  await fastify.register(jobsRoutes)
  await fastify.register(storageServeRoutes)

  // Health check endpoint (no auth required)
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  return fastify
}

async function main(): Promise<void> {
  const app = await buildApp()

  // Start BullMQ workers
  startWorkers()

  try {
    await app.listen({ port: PORT, host: HOST })
    app.log.info(`SitePilot API listening on ${HOST}:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

void main()
