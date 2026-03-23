import Redis from 'ioredis'

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379'

/**
 * Shared IORedis connection for BullMQ queues and workers.
 * BullMQ requires maxRetriesPerRequest: null for blocking commands.
 */
export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
})

/**
 * Separate pub/sub Redis connection for job progress events.
 * This must be a separate connection since subscribed clients cannot
 * issue other Redis commands.
 */
export const redisPubSub = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
})
