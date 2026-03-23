const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((error as { error?: string }).error ?? `HTTP ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ─── Auth ─────────────────────────────────────────────────────────────────

export interface LoginResponse {
  accessToken: string
  refreshToken: string
}

export const auth = {
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }).then(() => undefined),
  refresh: (refreshToken: string) =>
    apiFetch<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),
}

// ─── Sites ────────────────────────────────────────────────────────────────

export interface Site {
  id: string
  name: string
  url: string
  wpVersion: string | null
  phpVersion: string | null
  companionTokenHash: string | null
  lastSeenAt: string | null
  status: string
  storageProfileId: string | null
  createdAt: string
}

export interface SiteWithToken extends Site {
  companionToken: string
  _warning: string
}

export const sitesApi = {
  list: () => apiFetch<Site[]>('/sites'),
  get: (id: string) => apiFetch<Site>(`/sites/${id}`),
  create: (data: { name: string; url: string }) =>
    apiFetch<SiteWithToken>('/sites', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; url: string; storageProfileId: string }>) =>
    apiFetch<Site>(`/sites/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => apiFetch<void>(`/sites/${id}`, { method: 'DELETE' }),
  checkUpdates: (id: string) =>
    apiFetch<{ jobId: string; status: string }>(`/sites/${id}/check-updates`, { method: 'POST' }),
  applyUpdate: (id: string, data: { updateType: string; slug?: string }) =>
    apiFetch<{ jobId: string; status: string }>(`/sites/${id}/apply-update`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  rollback: (id: string, data: { backupId: string; scope: string }) =>
    apiFetch<{ jobId: string; status: string }>(`/sites/${id}/rollback`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  jobs: (id: string, page = 1) =>
    apiFetch<{ jobs: Job[]; page: number; limit: number }>(`/sites/${id}/jobs?page=${page}`),
}

// ─── Backups ──────────────────────────────────────────────────────────────

export interface Backup {
  id: string
  siteId: string
  status: string
  type: string
  snapshotTag: string | null
  sizeBytes: bigint | null
  storagePath: string | null
  manifest: unknown | null
  createdAt: string
  completedAt: string | null
}

export const backupsApi = {
  list: (siteId: string) => apiFetch<Backup[]>(`/sites/${siteId}/backups`),
  get: (id: string) => apiFetch<Backup>(`/backups/${id}`),
  create: (siteId: string, data: { type: string; snapshotTag?: string }) =>
    apiFetch<{ jobId: string; status: string }>(`/sites/${siteId}/backups`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => apiFetch<void>(`/backups/${id}`, { method: 'DELETE' }),
  download: (id: string, file?: string) =>
    apiFetch<{ url: string; expiresIn: number }>(
      `/backups/${id}/download${file ? `?file=${file}` : ''}`,
    ),
}

// ─── Storage Profiles ─────────────────────────────────────────────────────

export interface StorageProfile {
  id: string
  name: string
  type: string
  createdAt: string
}

export const storageApi = {
  list: () => apiFetch<StorageProfile[]>('/storage-profiles'),
  create: (data: { name: string; type: string; config: unknown }) =>
    apiFetch<StorageProfile>('/storage-profiles', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; type: string; config: unknown }>) =>
    apiFetch<StorageProfile>(`/storage-profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => apiFetch<void>(`/storage-profiles/${id}`, { method: 'DELETE' }),
  test: (id: string) =>
    apiFetch<{ success: boolean; message: string }>(`/storage-profiles/${id}/test`, {
      method: 'POST',
    }),
}

// ─── Jobs ─────────────────────────────────────────────────────────────────

export interface Job {
  id: string
  type: string
  siteId: string
  status: string
  payload: unknown
  result: unknown | null
  progress: number
  createdAt: string
  updatedAt: string
}

export const jobsApi = {
  get: (id: string) => apiFetch<Job>(`/jobs/${id}`),
}

// ─── Update checks ────────────────────────────────────────────────────────

export interface UpdateCheck {
  id: string
  siteId: string
  coreUpdate: unknown | null
  pluginUpdates: unknown[]
  themeUpdates: unknown[]
  checkedAt: string
}

// ─── Dashboard ────────────────────────────────────────────────────────────

export async function getDashboardStats() {
  const [allSites, allJobs] = await Promise.all([
    sitesApi.list(),
    apiFetch<Job[]>('/jobs?limit=20'),
  ])

  const sitesWithUpdates = allSites.filter((s) => s.status !== 'active').length
  const failedJobs = allJobs.filter(
    (j) =>
      j.status === 'failed' &&
      new Date(j.createdAt).getTime() > Date.now() - 24 * 60 * 60 * 1000,
  ).length

  return {
    totalSites: allSites.length,
    sitesWithUpdates,
    failedJobsLast24h: failedJobs,
    recentJobs: allJobs.slice(0, 20),
  }
}
