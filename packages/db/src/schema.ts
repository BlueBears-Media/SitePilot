import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  bigint,
  integer,
} from 'drizzle-orm/pg-core'

// Convenience wrapper — all timestamps in this schema are timezone-aware
const timestamptz = (name: string) => timestamp(name, { withTimezone: true })
import { relations } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

// ─── users ──────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('viewer'), // 'admin' | 'viewer'
  createdAt: timestamptz('created_at').notNull().defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

// ─── storage_profiles ───────────────────────────────────────────────────────

export const storageProfiles = pgTable('storage_profiles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  type: text('type').notNull(), // 's3' | 'nfs' | 'local'
  // Config is stored as AES-256-GCM encrypted JSON: { iv, tag, data }
  config: jsonb('config').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
})

export type StorageProfile = typeof storageProfiles.$inferSelect
export type NewStorageProfile = typeof storageProfiles.$inferInsert

// ─── sites ──────────────────────────────────────────────────────────────────

export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  url: text('url').notNull(),
  wpVersion: text('wp_version'),
  phpVersion: text('php_version'),
  companionTokenHash: text('companion_token_hash'),
  lastSeenAt: timestamptz('last_seen_at'),
  status: text('status').notNull().default('unknown'), // 'active' | 'unreachable' | 'unknown'
  storageProfileId: uuid('storage_profile_id').references(() => storageProfiles.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
})

export type Site = typeof sites.$inferSelect
export type NewSite = typeof sites.$inferInsert

// ─── backups ─────────────────────────────────────────────────────────────────

export const backups = pgTable('backups', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  storageProfileId: uuid('storage_profile_id').references(() => storageProfiles.id),
  status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'complete' | 'failed'
  type: text('type').notNull(), // 'full' | 'db_only' | 'files_only'
  snapshotTag: text('snapshot_tag'), // e.g. 'pre-rollback', 'pre-update'
  sizeBytes: bigint('size_bytes', { mode: 'bigint' }),
  storagePath: text('storage_path'),
  manifest: jsonb('manifest'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  completedAt: timestamptz('completed_at'),
})

export type Backup = typeof backups.$inferSelect
export type NewBackup = typeof backups.$inferInsert

// ─── jobs ─────────────────────────────────────────────────────────────────────

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  type: text('type').notNull(), // 'backup' | 'update_check' | 'apply_update' | 'rollback'
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'complete' | 'failed'
  payload: jsonb('payload').notNull(),
  result: jsonb('result'),
  progress: integer('progress').notNull().default(0),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})

export type Job = typeof jobs.$inferSelect
export type NewJob = typeof jobs.$inferInsert

// ─── update_checks ───────────────────────────────────────────────────────────

export const updateChecks = pgTable('update_checks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  coreUpdate: jsonb('core_update'), // null if no core update available
  pluginUpdates: jsonb('plugin_updates').notNull().default(sql`'[]'::jsonb`),
  themeUpdates: jsonb('theme_updates').notNull().default(sql`'[]'::jsonb`),
  checkedAt: timestamptz('checked_at').notNull().defaultNow(),
})

export type UpdateCheck = typeof updateChecks.$inferSelect
export type NewUpdateCheck = typeof updateChecks.$inferInsert

// ─── notifications ───────────────────────────────────────────────────────────

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  siteId: uuid('site_id').references(() => sites.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  message: text('message').notNull(),
  readAt: timestamptz('read_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
})

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert

// ─── relations ───────────────────────────────────────────────────────────────

export const sitesRelations = relations(sites, ({ one, many }) => ({
  storageProfile: one(storageProfiles, {
    fields: [sites.storageProfileId],
    references: [storageProfiles.id],
  }),
  backups: many(backups),
  jobs: many(jobs),
  updateChecks: many(updateChecks),
  notifications: many(notifications),
}))

export const backupsRelations = relations(backups, ({ one }) => ({
  site: one(sites, {
    fields: [backups.siteId],
    references: [sites.id],
  }),
  storageProfile: one(storageProfiles, {
    fields: [backups.storageProfileId],
    references: [storageProfiles.id],
  }),
}))

export const jobsRelations = relations(jobs, ({ one }) => ({
  site: one(sites, {
    fields: [jobs.siteId],
    references: [sites.id],
  }),
}))

export const updateChecksRelations = relations(updateChecks, ({ one }) => ({
  site: one(sites, {
    fields: [updateChecks.siteId],
    references: [sites.id],
  }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  site: one(sites, {
    fields: [notifications.siteId],
    references: [sites.id],
  }),
}))
