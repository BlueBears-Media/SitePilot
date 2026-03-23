'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RefreshCw, HardDrive, ExternalLink, AlertTriangle, Download, RotateCcw, Settings, Trash2, Copy, Check } from 'lucide-react'
import {
  sitesApi,
  backupsApi,
  storageApi,
  updateChecksApi,
  type Backup,
  type CoreUpdateInfo,
  type PluginUpdateInfo,
  type SiteWithToken,
  type StorageProfile,
  type ThemeUpdateInfo,
} from '@/lib/api'
import { getJobErrorMessage, getJobResultSummary, waitForTerminalJob } from '@/lib/jobs'
import { cn, formatDate, formatBytes, formatRelativeDate, getStatusBgColor } from '@/lib/utils'

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
const solidPanelClass =
  'bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-2xl shadow-black/40'
const solidSheetClass =
  'bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-2xl shadow-black/50'

type Tab = 'overview' | 'updates' | 'backups' | 'jobs' | 'settings'

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', getStatusBgColor(status))}>
      {status}
    </span>
  )
}

function BackupModal({
  siteName,
  defaultStorageProfileId,
  storageProfiles,
  isPending,
  onClose,
  onConfirm,
}: {
  siteName: string
  defaultStorageProfileId: string | null
  storageProfiles: StorageProfile[]
  isPending: boolean
  onClose: () => void
  onConfirm: (storageProfileId: string) => void
}) {
  const [selectedStorageProfileId, setSelectedStorageProfileId] = useState(
    defaultStorageProfileId ?? storageProfiles[0]?.id ?? '',
  )

  useEffect(() => {
    setSelectedStorageProfileId(defaultStorageProfileId ?? storageProfiles[0]?.id ?? '')
  }, [defaultStorageProfileId, storageProfiles])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={cn('relative border border-border rounded-xl p-6 max-w-md w-full mx-4', solidPanelClass)}>
        <h2 className="text-base font-semibold mb-1">Create backup</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Choose which storage profile should receive the next backup for {siteName}.
        </p>

        {storageProfiles.length === 0 ? (
          <div className="space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Create a storage profile before starting a backup. Backups now require an explicit storage destination.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 bg-muted hover:bg-accent text-foreground text-sm rounded-lg transition-colors"
              >
                Close
              </button>
              <a
                href="/storage"
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors text-center"
              >
                Open storage
              </a>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">Storage profile</label>
              <select
                value={selectedStorageProfileId}
                onChange={(event) => setSelectedStorageProfileId(event.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="" disabled>
                  Select a storage profile
                </option>
                {storageProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.type})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                The archive will be uploaded directly to this storage destination.
              </p>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={onClose}
                disabled={isPending}
                className="flex-1 py-2 bg-muted hover:bg-accent text-foreground text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirm(selectedStorageProfileId)}
                disabled={isPending || !selectedStorageProfileId}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {isPending ? 'Starting…' : 'Start backup'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function UpdateSection({
  title,
  subtitle,
  emptyMessage,
  children,
}: {
  title: string
  subtitle: string
  emptyMessage: string
  children: React.ReactNode
}) {
  const hasContent = Array.isArray(children) ? children.length > 0 : Boolean(children)

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </div>
      <div className="divide-y divide-border">
        {hasContent ? children : <p className="px-5 py-4 text-sm text-muted-foreground">{emptyMessage}</p>}
      </div>
    </section>
  )
}

function UpdateRow({
  name,
  currentVersion,
  availableVersion,
  changelogUrl,
  badge,
  onApply,
  applyLabel = 'Apply update',
}: {
  name: string
  currentVersion: string
  availableVersion: string
  changelogUrl?: string
  badge?: string
  onApply: () => void
  applyLabel?: string
}) {
  return (
    <div className="px-5 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-foreground">{name}</p>
          {badge && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400">
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {currentVersion || 'unknown'} → {availableVersion || 'unknown'}
        </p>
        {changelogUrl && (
          <a
            href={changelogUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400 mt-2"
          >
            View changelog
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <button
        onClick={onApply}
        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
      >
        {applyLabel}
      </button>
    </div>
  )
}

function CompanionTokenModal({
  site,
  onClose,
}: {
  site: SiteWithToken
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(site.companionToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" />
      <div className={cn('relative border border-border rounded-xl p-6 max-w-md w-full mx-4', solidPanelClass)}>
        <h2 className="text-base font-semibold mb-1">New companion token generated</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Update the SitePilot Companion plugin on this WordPress site with the new token before running jobs again.
        </p>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            The previous token stopped working immediately. This new token will not be shown again.
          </p>
        </div>

        <div className="flex gap-2 mb-4">
          <code className="flex-1 text-xs bg-muted rounded-lg px-3 py-2 font-mono break-all">
            {site.companionToken}
          </code>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2 bg-muted hover:bg-accent text-foreground text-sm rounded-lg transition-colors"
        >
          I&apos;ve saved the token
        </button>
      </div>
    </div>
  )
}

// ─── Rollback Modal ──────────────────────────────────────────────────────────

function RollbackModal({
  backup,
  siteId,
  onClose,
}: {
  backup: Backup
  siteId: string
  onClose: () => void
}) {
  const [scope, setScope] = useState<'full' | 'db_only' | 'files_only'>('full')
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const eventSourceRef = useRef<EventSource | null>(null)

  const handleRollback = async () => {
    try {
      const result = await sitesApi.rollback(siteId, { backupId: backup.id, scope })
      setJobId(result.jobId)

      // Open SSE stream for live progress
      const es = new EventSource(`${API_BASE}/jobs/${result.jobId}/stream`, { withCredentials: true })
      eventSourceRef.current = es

      es.onmessage = (event: MessageEvent<string>) => {
        try {
          const data = JSON.parse(event.data) as { type: string; progress?: number; message?: string; status?: string }
          if (data.progress !== undefined) setProgress(data.progress)
          if (data.message) setProgressMessage(data.message)
          if (data.type === 'terminal') {
            es.close()
            if (data.status === 'complete') toast.success('Rollback complete')
            else toast.error('Rollback failed')
          }
        } catch {
          // ignore
        }
      }

      es.onerror = () => {
        es.close()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start rollback')
    }
  }

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={cn('relative border border-border rounded-xl p-6 max-w-sm w-full mx-4', solidPanelClass)}>
        <h2 className="text-base font-semibold mb-1">Roll back site</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Restore from backup created {formatRelativeDate(backup.createdAt)}
        </p>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              A safety backup will be taken before rollback. The site will be overwritten.
            </p>
          </div>
        </div>

        {!jobId ? (
          <>
            <div className="space-y-2 mb-4">
              <p className="text-sm font-medium">Restore scope</p>
              {(['full', 'db_only', 'files_only'] as const).map((s) => (
                <label key={s} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="scope" value={s} checked={scope === s} onChange={() => setScope(s)} />
                  <span className="text-sm">{s === 'full' ? 'Full restore' : s === 'db_only' ? 'Database only' : 'Files only'}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2 bg-muted hover:bg-accent text-foreground text-sm rounded-lg transition-colors">
                Cancel
              </button>
              <button
                onClick={handleRollback}
                className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Roll back
              </button>
            </div>
          </>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Progress</span>
              <span className="text-sm font-medium">{progress}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 mb-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.max(0, progress)}%` }}
              />
            </div>
            {progressMessage && <p className="text-xs text-muted-foreground">{progressMessage}</p>}
            {progress === 100 && (
              <button onClick={onClose} className="mt-4 w-full py-2 bg-muted hover:bg-accent text-foreground text-sm rounded-lg transition-colors">
                Close
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Prepare Restore Slide-Over ───────────────────────────────────────────────

function PrepareRestoreSlideOver({
  backup,
  siteUrl,
  onClose,
}: {
  backup: Backup
  siteUrl: string
  onClose: () => void
}) {
  const [targetDomain, setTargetDomain] = useState(siteUrl)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const result = await backupsApi.download(backup.id)
      setDownloadUrl(result.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate download URL')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={cn('relative w-full max-w-md border-l border-border flex flex-col h-full', solidSheetClass)}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Prepare restore package</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">×</button>
        </div>
        <div className="flex-1 overflow-auto p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Target domain</label>
            <input
              value={targetDomain}
              onChange={(e) => setTargetDomain(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Change this if restoring to a different domain. Leave as-is to restore to the same domain.
            </p>
          </div>

          <div className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
            <p><span className="font-medium">Backup type:</span> {backup.type}</p>
            <p><span className="font-medium">Created:</span> {formatDate(backup.createdAt)}</p>
            <p><span className="font-medium">Size:</span> {formatBytes(backup.sizeBytes ? Number(backup.sizeBytes) : null)}</p>
          </div>

          {!downloadUrl ? (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate download package'}
            </button>
          ) : (
            <div className="space-y-3">
              <a
                href={downloadUrl}
                download
                className="flex items-center justify-center gap-2 w-full py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                Download backup archive
              </a>
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-xs text-blue-600 dark:text-blue-400 space-y-1">
                <p className="font-medium">How to use restore-helper.php:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-blue-500">
                  <li>Download the archive above</li>
                  <li>Upload archive + restore-helper.php to your web host</li>
                  <li>Visit restore-helper.php in your browser</li>
                  <li>Follow the 4-step wizard</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SiteDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [rollbackBackup, setRollbackBackup] = useState<Backup | null>(null)
  const [prepareRestoreBackup, setPrepareRestoreBackup] = useState<Backup | null>(null)
  const [applyUpdateModal, setApplyUpdateModal] = useState<{ updateType: string; slug?: string; name: string } | null>(null)
  const [siteName, setSiteName] = useState('')
  const [selectedStorageProfileId, setSelectedStorageProfileId] = useState('')
  const [deleteConfirmValue, setDeleteConfirmValue] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showBackupModal, setShowBackupModal] = useState(false)
  const [showRotateTokenModal, setShowRotateTokenModal] = useState(false)
  const [rotatedTokenSite, setRotatedTokenSite] = useState<SiteWithToken | null>(null)

  const { data: site, isLoading: siteLoading } = useQuery({
    queryKey: ['site', id],
    queryFn: () => sitesApi.get(id),
    refetchInterval: 30_000,
  })

  const { data: storageProfiles = [] } = useQuery({
    queryKey: ['storage-profiles'],
    queryFn: () => storageApi.list(),
  })

  const { data: backupList = [] } = useQuery({
    queryKey: ['backups', id],
    queryFn: () => backupsApi.list(id),
    enabled: activeTab === 'backups',
    refetchInterval: 10_000,
  })

  const { data: jobData } = useQuery({
    queryKey: ['site-jobs', id],
    queryFn: () => sitesApi.jobs(id),
    enabled: activeTab === 'jobs',
    refetchInterval: 10_000,
  })

  const { data: updateSnapshot } = useQuery({
    queryKey: ['site-updates', id],
    queryFn: () => updateChecksApi.get(id),
    enabled: activeTab === 'updates',
    refetchInterval: activeTab === 'updates' ? 30_000 : false,
  })

  useEffect(() => {
    if (site?.name) {
      setSiteName(site.name)
    }
    setSelectedStorageProfileId(site?.storageProfileId ?? '')
  }, [site?.name, site?.storageProfileId])

  const watchJob = async (
    jobId: string,
    options: {
      successMessage: string
      failurePrefix: string
      timeoutMs?: number
    },
  ) => {
    try {
      const job = await waitForTerminalJob(jobId, { timeoutMs: options.timeoutMs })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['site', id] }),
        queryClient.invalidateQueries({ queryKey: ['sites'] }),
        queryClient.invalidateQueries({ queryKey: ['backups', id] }),
        queryClient.invalidateQueries({ queryKey: ['site-jobs', id] }),
        queryClient.invalidateQueries({ queryKey: ['site-updates', id] }),
      ])

      if (job.status === 'failed') {
        const errorMessage = getJobErrorMessage(job.result) ?? 'The backend did not return an error message.'
        toast.error(`${options.failurePrefix}: ${errorMessage}`)
        return
      }

      toast.success(options.successMessage)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load job result')
    }
  }

  const checkUpdatesMutation = useMutation({
    mutationFn: () => sitesApi.checkUpdates(id),
    onSuccess: ({ jobId }) => {
      toast.success('Update check started')
      void watchJob(jobId, {
        successMessage: 'Update check complete',
        failurePrefix: 'Update check failed',
        timeoutMs: 5 * 60 * 1000,
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to check updates')
    },
  })

  const triggerBackupMutation = useMutation({
    mutationFn: ({ storageProfileId }: { storageProfileId: string }) =>
      backupsApi.create(id, { type: 'full', storageProfileId }),
    onSuccess: ({ jobId }) => {
      toast.success('Backup started')
      setShowBackupModal(false)
      void queryClient.invalidateQueries({ queryKey: ['backups', id] })
      void watchJob(jobId, {
        successMessage: 'Backup complete',
        failurePrefix: 'Backup failed',
        timeoutMs: 20 * 60 * 1000,
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to start backup')
    },
  })

  const applyUpdateMutation = useMutation({
    mutationFn: (data: { updateType: string; slug?: string }) => sitesApi.applyUpdate(id, data),
    onSuccess: ({ jobId }) => {
      toast.success('Update started')
      setApplyUpdateModal(null)
      void watchJob(jobId, {
        successMessage: 'Update complete',
        failurePrefix: 'Update failed',
        timeoutMs: 20 * 60 * 1000,
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to apply update')
    },
  })

  const updateSiteMutation = useMutation({
    mutationFn: (data: { name: string; storageProfileId: string | null }) => sitesApi.update(id, data),
    onSuccess: (updatedSite) => {
      toast.success('Site settings saved')
      setSiteName(updatedSite.name)
      setSelectedStorageProfileId(updatedSite.storageProfileId ?? '')
      void queryClient.invalidateQueries({ queryKey: ['site', id] })
      void queryClient.invalidateQueries({ queryKey: ['sites'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save site settings')
    },
  })

  const rotateTokenMutation = useMutation({
    mutationFn: () => sitesApi.rotateToken(id),
    onSuccess: (updatedSite) => {
      toast.success('New companion token generated')
      setShowRotateTokenModal(false)
      setRotatedTokenSite(updatedSite)
      void queryClient.invalidateQueries({ queryKey: ['site', id] })
      void queryClient.invalidateQueries({ queryKey: ['sites'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to generate a new companion token')
    },
  })

  const deleteSiteMutation = useMutation({
    mutationFn: () => sitesApi.delete(id),
    onSuccess: () => {
      toast.success('Site deleted')
      void queryClient.invalidateQueries({ queryKey: ['sites'] })
      void queryClient.removeQueries({ queryKey: ['site', id] })
      router.push('/sites')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete site')
    },
  })

  if (siteLoading || !site) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'updates', label: 'Updates' },
    { id: 'backups', label: 'Backups' },
    { id: 'jobs', label: 'Jobs' },
    { id: 'settings', label: 'Settings' },
  ]

  const coreUpdate = updateSnapshot?.coreUpdate
  const pluginUpdates = updateSnapshot?.pluginUpdates ?? []
  const themeUpdates = updateSnapshot?.themeUpdates ?? []
  const hasAnyUpdates = Boolean(coreUpdate) || pluginUpdates.length > 0 || themeUpdates.length > 0
  const currentStorageProfile =
    storageProfiles.find((profile) => profile.id === site.storageProfileId) ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 border-b border-border">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-semibold">{site.name}</h1>
              <StatusBadge status={site.status} />
            </div>
            <a
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {site.url}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => checkUpdatesMutation.mutate()}
              disabled={checkUpdatesMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 bg-muted hover:bg-accent text-sm rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Check updates
            </button>
            <button
              onClick={() => setShowBackupModal(true)}
              disabled={triggerBackupMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
            >
              <HardDrive className="w-3.5 h-3.5" />
              Backup now
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2 text-sm border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-blue-500 text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-8">
        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-sm font-medium mb-3">Site health</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd><StatusBadge status={site.status} /></dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Last seen</dt>
                  <dd>{formatRelativeDate(site.lastSeenAt)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Default storage</dt>
                  <dd className="text-right">
                    {currentStorageProfile ? currentStorageProfile.name : 'Not set'}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-sm font-medium mb-3">Versions</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">WordPress</dt>
                  <dd>{site.wpVersion ?? '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">PHP</dt>
                  <dd>{site.phpVersion ?? '—'}</dd>
                </div>
              </dl>
            </div>
          </div>
        )}

        {/* Updates */}
        {activeTab === 'updates' && (
          <div className="max-w-3xl">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <p className="text-sm text-muted-foreground">
                  {updateSnapshot?.checkedAt
                    ? `Last checked ${formatRelativeDate(updateSnapshot.checkedAt)}`
                    : 'Run a check-updates job to fetch available updates for this site.'}
                </p>
                {updateSnapshot?.checkedAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Checked at {formatDate(updateSnapshot.checkedAt)}
                  </p>
                )}
              </div>
              <button
                onClick={() => checkUpdatesMutation.mutate()}
                disabled={checkUpdatesMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {checkUpdatesMutation.isPending ? 'Checking…' : 'Check for updates now'}
              </button>
            </div>

            {!updateSnapshot?.checkedAt ? (
              <div className="bg-card border border-border rounded-xl p-5">
                <p className="text-sm text-muted-foreground">
                  No update check results yet. Run a check to populate this screen.
                </p>
              </div>
            ) : !hasAnyUpdates ? (
              <div className="bg-card border border-border rounded-xl p-5">
                <p className="text-sm text-foreground font-medium">Everything looks up to date.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No WordPress core, plugin, or theme updates are currently available.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <UpdateSection
                  title="Core"
                  subtitle="WordPress core updates"
                  emptyMessage="No core update available."
                >
                  {coreUpdate ? (
                    <UpdateRow
                      name="WordPress Core"
                      currentVersion={(coreUpdate as CoreUpdateInfo).current_version}
                      availableVersion={(coreUpdate as CoreUpdateInfo).available_version}
                      changelogUrl={(coreUpdate as CoreUpdateInfo).changelog_url}
                      onApply={() =>
                        setApplyUpdateModal({
                          updateType: 'core',
                          name: 'WordPress Core',
                        })
                      }
                    />
                  ) : null}
                </UpdateSection>

                <UpdateSection
                  title="Plugins"
                  subtitle="Available plugin updates"
                  emptyMessage="No plugin updates available."
                >
                  {pluginUpdates.map((plugin: PluginUpdateInfo) => (
                    <UpdateRow
                      key={plugin.slug}
                      name={plugin.name}
                      currentVersion={plugin.current_version}
                      availableVersion={plugin.available_version}
                      changelogUrl={plugin.changelog_url}
                      badge={plugin.is_active ? 'Active' : 'Inactive'}
                      onApply={() =>
                        setApplyUpdateModal({
                          updateType: 'plugin',
                          slug: plugin.plugin_file ?? plugin.slug,
                          name: plugin.name,
                        })
                      }
                    />
                  ))}
                </UpdateSection>

                <UpdateSection
                  title="Themes"
                  subtitle="Available theme updates"
                  emptyMessage="No theme updates available."
                >
                  {themeUpdates.map((theme: ThemeUpdateInfo) => (
                    <UpdateRow
                      key={theme.slug}
                      name={theme.name}
                      currentVersion={theme.current_version}
                      availableVersion={theme.available_version}
                      onApply={() =>
                        setApplyUpdateModal({
                          updateType: 'theme',
                          slug: theme.slug,
                          name: theme.name,
                        })
                      }
                    />
                  ))}
                </UpdateSection>
              </div>
            )}

            {applyUpdateModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center">
                <div className="absolute inset-0 bg-black/60" onClick={() => setApplyUpdateModal(null)} />
                <div className={cn('relative border border-border rounded-xl p-6 max-w-sm w-full mx-4', solidPanelClass)}>
                  <h2 className="text-base font-semibold mb-2">Apply update: {applyUpdateModal.name}</h2>
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        This update will be applied directly to the site. Make sure you have a recent backup if you need one.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setApplyUpdateModal(null)} className="flex-1 py-2 bg-muted hover:bg-accent text-sm rounded-lg transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={() => applyUpdateMutation.mutate({ updateType: applyUpdateModal.updateType, slug: applyUpdateModal.slug })}
                      disabled={applyUpdateMutation.isPending}
                      className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {applyUpdateMutation.isPending ? 'Starting…' : 'Apply update'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Backups */}
        {activeTab === 'backups' && (
          <div className="max-w-4xl">
            {backupList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No backups yet.</p>
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Size</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Created</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backupList.map((backup) => (
                      <tr key={backup.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400">
                              {backup.type}
                            </span>
                            {backup.snapshotTag && (
                              <span className={cn(
                                'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                                backup.snapshotTag === 'pre-rollback' ? 'bg-purple-500/10 text-purple-500' : 'bg-amber-500/10 text-amber-500',
                              )}>
                                {backup.snapshotTag}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={backup.status} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatBytes(backup.sizeBytes ? Number(backup.sizeBytes) : null)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatRelativeDate(backup.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {site.status === 'active' && backup.status === 'complete' && (
                              <button
                                onClick={() => setRollbackBackup(backup)}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-muted hover:bg-accent rounded-md transition-colors"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Roll back
                              </button>
                            )}
                            <button
                              onClick={() => setPrepareRestoreBackup(backup)}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-muted hover:bg-accent rounded-md transition-colors"
                            >
                              <Download className="w-3 h-3" />
                              Prepare restore
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Jobs */}
        {activeTab === 'jobs' && (
          <div className="max-w-4xl">
            {!jobData?.jobs?.length ? (
              <p className="text-sm text-muted-foreground">No jobs for this site.</p>
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Progress</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Details</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobData.jobs.map((job) => (
                      <tr key={job.id} className="border-b border-border last:border-0 hover:bg-muted/30 align-top">
                        <td className="px-4 py-3">{job.type.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-muted rounded-full h-1.5">
                              <div
                                className={cn(
                                  'h-1.5 rounded-full',
                                  job.status === 'failed' ? 'bg-red-500' : 'bg-blue-500',
                                )}
                                style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{Math.max(0, job.progress)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {getJobResultSummary(job) ? (
                            <p
                              title={getJobResultSummary(job) ?? undefined}
                              className={cn(
                                'max-w-md text-xs leading-5',
                                job.status === 'failed' ? 'text-red-500' : 'text-muted-foreground',
                              )}
                            >
                              {getJobResultSummary(job)}
                            </p>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{formatRelativeDate(job.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-3xl space-y-6">
            <section className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-start gap-3 mb-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Site settings</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Update the display name and choose the default storage profile for this site.
                  </p>
                </div>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  const trimmedName = siteName.trim()
                  const normalizedStorageProfileId = selectedStorageProfileId || null
                  if (!trimmedName) {
                    toast.error('Site name is required')
                    return
                  }
                  if (
                    trimmedName === site.name &&
                    normalizedStorageProfileId === site.storageProfileId
                  ) {
                    toast.info('No changes to save')
                    return
                  }
                  updateSiteMutation.mutate({
                    name: trimmedName,
                    storageProfileId: normalizedStorageProfileId,
                  })
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium mb-1.5">Site name</label>
                  <input
                    value={siteName}
                    onChange={(event) => setSiteName(event.target.value)}
                    className="w-full max-w-lg px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="My WordPress Site"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">Default storage profile</label>
                  <select
                    value={selectedStorageProfileId}
                    onChange={(event) => setSelectedStorageProfileId(event.target.value)}
                    className="w-full max-w-lg px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">No default storage profile</option>
                    {storageProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} ({profile.type})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Used as the default destination for automated backup flows. Manual backups still ask you to confirm the destination each time.
                  </p>
                </div>

                {storageProfiles.length === 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      No storage profiles found yet. Create one in the storage area before running backups.
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={updateSiteMutation.isPending}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {updateSiteMutation.isPending ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSiteName(site.name)
                      setSelectedStorageProfileId(site.storageProfileId ?? '')
                    }}
                    disabled={
                      updateSiteMutation.isPending ||
                      (siteName === site.name &&
                        selectedStorageProfileId === (site.storageProfileId ?? ''))
                    }
                    className="px-4 py-2 bg-muted hover:bg-accent text-sm rounded-lg transition-colors disabled:opacity-50"
                  >
                    Reset
                  </button>
                </div>
              </form>
            </section>

            <section className="bg-card border border-amber-500/30 rounded-xl p-6">
              <div className="flex items-start gap-3 mb-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Companion token</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Generate a replacement token if the current one was exposed or needs to be rotated.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  The stored token is hidden for security. Generating a new token invalidates the previous one immediately, so you must update the SitePilot Companion plugin on this site before SitePilot can connect again.
                </p>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Rotate companion token</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Use this when a token has been shared accidentally or when you want to re-secure the connection.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRotateTokenModal(true)}
                    disabled={rotateTokenMutation.isPending}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {rotateTokenMutation.isPending ? 'Generating…' : 'Generate new token'}
                  </button>
                </div>
              </div>
            </section>

            <section className="bg-card border border-red-500/30 rounded-xl p-6">
              <div className="flex items-start gap-3 mb-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">Danger zone</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Deleting a site removes it from SitePilot. This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-red-600 dark:text-red-400">Delete this site</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Remove <span className="font-medium text-foreground">{site.name}</span> and return to the sites list.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteConfirmValue('')
                      setShowDeleteModal(true)
                    }}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete site
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* Modals */}
      {showBackupModal && (
        <BackupModal
          siteName={site.name}
          defaultStorageProfileId={site.storageProfileId}
          storageProfiles={storageProfiles}
          isPending={triggerBackupMutation.isPending}
          onClose={() => setShowBackupModal(false)}
          onConfirm={(storageProfileId) => triggerBackupMutation.mutate({ storageProfileId })}
        />
      )}

      {rollbackBackup && (
        <RollbackModal
          backup={rollbackBackup}
          siteId={id}
          onClose={() => setRollbackBackup(null)}
        />
      )}

      {prepareRestoreBackup && (
        <PrepareRestoreSlideOver
          backup={prepareRestoreBackup}
          siteUrl={site.url}
          onClose={() => setPrepareRestoreBackup(null)}
        />
      )}

      {showRotateTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowRotateTokenModal(false)} />
          <div className={cn('relative border border-border rounded-xl p-6 max-w-md w-full mx-4', solidPanelClass)}>
            <h2 className="text-base font-semibold mb-2">Generate a new token?</h2>
            <p className="text-sm text-muted-foreground mb-4">
              This will invalidate the current companion token for {site.name} immediately. Update the token in the WordPress plugin right after generating the replacement.
            </p>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 mb-4">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Any saved copy of the old token will stop working as soon as you continue.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowRotateTokenModal(false)}
                disabled={rotateTokenMutation.isPending}
                className="flex-1 py-2 bg-muted hover:bg-accent text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => rotateTokenMutation.mutate()}
                disabled={rotateTokenMutation.isPending}
                className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {rotateTokenMutation.isPending ? 'Generating…' : 'Generate token'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rotatedTokenSite && (
        <CompanionTokenModal
          site={rotatedTokenSite}
          onClose={() => setRotatedTokenSite(null)}
        />
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowDeleteModal(false)} />
          <div className={cn('relative border border-border rounded-xl p-6 max-w-md w-full mx-4', solidPanelClass)}>
            <h2 className="text-base font-semibold mb-2">Delete {site.name}?</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Type the site name to confirm deletion. This removes the site from SitePilot immediately.
            </p>

            <input
              value={deleteConfirmValue}
              onChange={(event) => setDeleteConfirmValue(event.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder={site.name}
            />

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleteSiteMutation.isPending}
                className="flex-1 py-2 bg-muted hover:bg-accent text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteSiteMutation.mutate()}
                disabled={deleteSiteMutation.isPending || deleteConfirmValue.trim() !== site.name}
                className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {deleteSiteMutation.isPending ? 'Deleting…' : 'Delete site'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
