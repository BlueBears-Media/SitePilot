import type { Job } from 'bullmq'
import { db, jobs, sites, updateChecks, notifications } from '@sitepilot/db'
import { eq } from 'drizzle-orm'
import { signRequest, decryptToken } from '../hmac'
import type { UpdateCheckJobPayload } from '../types'

interface PluginUpdate {
  slug: string
  name: string
  current_version: string
  available_version: string
  changelog_url: string
  is_active: boolean
}

interface ThemeUpdate {
  slug: string
  name: string
  current_version: string
  available_version: string
}

interface CoreUpdate {
  current_version: string
  available_version: string
  changelog_url: string
}

interface UpdatesResponse {
  core: CoreUpdate | null
  plugins: PluginUpdate[]
  themes: ThemeUpdate[]
}

export async function processUpdateCheckJob(job: Job<UpdateCheckJobPayload>): Promise<void> {
  const { siteId } = job.data
  const jobId = job.id ?? 'unknown'

  // Update job status
  await db
    .update(jobs)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(jobs.id, jobId))

  // Look up site
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) })
  if (!site) throw new Error(`Site not found: ${siteId}`)
  if (!site.companionTokenHash) throw new Error(`Site ${siteId} has no companion token`)

  try {
    const path = '/wp-json/sitepilot/v1/updates'
    const body = ''
    const token = decryptToken(site.companionTokenHash)

    const { timestamp, signature } = signRequest({
      method: 'GET',
      path,
      body,
      token,
    })

    // 1. GET updates from companion
    const response = await fetch(`${site.url}/wp-json/sitepilot/v1/updates`, {
      method: 'GET',
      headers: {
        'X-SitePilot-Timestamp': timestamp,
        'X-SitePilot-Signature': signature,
      },
    })

    if (!response.ok) {
      throw new Error(`Companion returned ${response.status}: ${await response.text()}`)
    }

    const data = (await response.json()) as UpdatesResponse

    // 2. Upsert update_checks record (insert or update for this site)
    const existing = await db.query.updateChecks.findFirst({
      where: eq(updateChecks.siteId, siteId),
    })

    if (existing) {
      await db
        .update(updateChecks)
        .set({
          coreUpdate: data.core,
          pluginUpdates: data.plugins,
          themeUpdates: data.themes,
          checkedAt: new Date(),
        })
        .where(eq(updateChecks.siteId, siteId))
    } else {
      await db.insert(updateChecks).values({
        siteId,
        coreUpdate: data.core,
        pluginUpdates: data.plugins,
        themeUpdates: data.themes,
        checkedAt: new Date(),
      })
    }

    // 3. Create notifications for critical updates
    if (data.core) {
      await db.insert(notifications).values({
        siteId,
        type: 'core_update_available',
        message: `WordPress core update available: ${data.core.current_version} → ${data.core.available_version}`,
      })
    }

    // Check for security-related plugin updates (heuristic: check changelog URL or name)
    const securityPlugins = data.plugins.filter(
      (p) =>
        p.changelog_url?.includes('security') ||
        p.name?.toLowerCase().includes('security'),
    )

    for (const plugin of securityPlugins) {
      await db.insert(notifications).values({
        siteId,
        type: 'security_update_available',
        message: `Security update available for plugin "${plugin.name}": ${plugin.current_version} → ${plugin.available_version}`,
      })
    }

    // 4. Mark job complete
    await db
      .update(jobs)
      .set({
        status: 'complete',
        progress: 100,
        result: { core: data.core, pluginCount: data.plugins.length, themeCount: data.themes.length },
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))

    // Update site last_seen
    await db
      .update(sites)
      .set({ status: 'active', lastSeenAt: new Date() })
      .where(eq(sites.id, siteId))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await db
      .update(jobs)
      .set({
        status: 'failed',
        result: { error: errorMessage },
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))

    throw error
  }
}
