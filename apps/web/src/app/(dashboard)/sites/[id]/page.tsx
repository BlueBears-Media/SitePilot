'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RefreshCw, HardDrive, ExternalLink, AlertTriangle, Download, RotateCcw } from 'lucide-react'
import { sitesApi, backupsApi, type Backup } from '@/lib/api'
import { cn, formatDate, formatBytes, formatRelativeDate, getStatusBgColor } from '@/lib/utils'
import Link from 'next/link'

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'

type Tab = 'overview' | 'updates' | 'backups' | 'jobs'

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', getStatusBgColor(status))}>
      {status}
    </span>
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
      <div className="relative bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4">
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
      <div className="relative w-full max-w-md bg-card border-l border-border flex flex-col h-full">
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
  const id = params.id
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [rollbackBackup, setRollbackBackup] = useState<Backup | null>(null)
  const [prepareRestoreBackup, setPrepareRestoreBackup] = useState<Backup | null>(null)
  const [applyUpdateModal, setApplyUpdateModal] = useState<{ updateType: string; slug?: string; name: string } | null>(null)

  const { data: site, isLoading: siteLoading } = useQuery({
    queryKey: ['site', id],
    queryFn: () => sitesApi.get(id),
    refetchInterval: 30_000,
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

  const checkUpdatesMutation = useMutation({
    mutationFn: () => sitesApi.checkUpdates(id),
    onSuccess: () => toast.success('Update check started'),
    onError: () => toast.error('Failed to check updates'),
  })

  const triggerBackupMutation = useMutation({
    mutationFn: () => backupsApi.create(id, { type: 'full' }),
    onSuccess: () => {
      toast.success('Backup started')
      void queryClient.invalidateQueries({ queryKey: ['backups', id] })
    },
    onError: () => toast.error('Failed to start backup'),
  })

  const applyUpdateMutation = useMutation({
    mutationFn: (data: { updateType: string; slug?: string }) => sitesApi.applyUpdate(id, data),
    onSuccess: () => {
      toast.success('Update started — a backup will be taken first')
      setApplyUpdateModal(null)
    },
    onError: () => toast.error('Failed to apply update'),
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
  ]

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
              onClick={() => triggerBackupMutation.mutate()}
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
            <p className="text-sm text-muted-foreground mb-4">
              Run a check-updates job to see available updates for this site.
            </p>
            <button
              onClick={() => checkUpdatesMutation.mutate()}
              disabled={checkUpdatesMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {checkUpdatesMutation.isPending ? 'Checking…' : 'Check for updates now'}
            </button>

            {applyUpdateModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center">
                <div className="absolute inset-0 bg-black/60" onClick={() => setApplyUpdateModal(null)} />
                <div className="relative bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4">
                  <h2 className="text-base font-semibold mb-2">Apply update: {applyUpdateModal.name}</h2>
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        A backup will be taken automatically before this update is applied.
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
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobData.jobs.map((job) => (
                      <tr key={job.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3">{job.type.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-muted rounded-full h-1.5">
                              <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${job.progress}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground">{job.progress}%</span>
                          </div>
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
      </div>

      {/* Modals */}
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
    </div>
  )
}
