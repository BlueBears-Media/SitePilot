'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Copy, Check, ExternalLink, RefreshCw, HardDrive } from 'lucide-react'
import { sitesApi, type Site, type SiteWithToken } from '@/lib/api'
import { cn, formatRelativeDate, getStatusBgColor } from '@/lib/utils'
import Link from 'next/link'

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', getStatusBgColor(status))}>
      {status}
    </span>
  )
}

function AddSiteSlideOver({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: (site: SiteWithToken) => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const site = await sitesApi.create({ name, url })
      onSuccess(site)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create site')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card border-l border-border flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Add site</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">×</button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Site name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="My WordPress Site"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Site URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              type="url"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://example.com"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create site'}
          </button>
        </form>
      </div>
    </div>
  )
}

function TokenDisplayModal({
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
      <div className="relative bg-card border border-border rounded-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-base font-semibold mb-1">Site created</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Copy this companion token and paste it into the SitePilot Companion plugin settings on your WordPress site.
        </p>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            This token will not be shown again. Save it now.
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

export default function SitesPage() {
  const queryClient = useQueryClient()
  const [showAddSite, setShowAddSite] = useState(false)
  const [newSite, setNewSite] = useState<SiteWithToken | null>(null)

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['sites'],
    queryFn: sitesApi.list,
    refetchInterval: 30_000,
  })

  const checkUpdatesMutation = useMutation({
    mutationFn: (siteId: string) => sitesApi.checkUpdates(siteId),
    onSuccess: () => toast.success('Update check started'),
    onError: () => toast.error('Failed to start update check'),
  })

  const handleSiteCreated = (site: SiteWithToken) => {
    setShowAddSite(false)
    setNewSite(site)
    void queryClient.invalidateQueries({ queryKey: ['sites'] })
    toast.success('Site created')
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">Sites</h1>
          <p className="text-sm text-muted-foreground mt-1">{sites.length} site{sites.length !== 1 ? 's' : ''} registered</p>
        </div>
        <button
          onClick={() => setShowAddSite(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add site
        </button>
      </div>

      {sites.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-muted-foreground">No sites yet. Add your first WordPress site to get started.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">WP Version</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Last seen</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site: Site) => (
                <tr key={site.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <Link href={`/sites/${site.id}`} className="font-medium text-foreground hover:text-blue-500 transition-colors">
                        {site.name}
                      </Link>
                      <div className="flex items-center gap-1 mt-0.5">
                        <a
                          href={site.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          {site.url}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={site.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {site.wpVersion ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatRelativeDate(site.lastSeenAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => checkUpdatesMutation.mutate(site.id)}
                        disabled={checkUpdatesMutation.isPending}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
                        title="Check updates"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <Link
                        href={`/sites/${site.id}`}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
                      >
                        <HardDrive className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddSite && (
        <AddSiteSlideOver
          onClose={() => setShowAddSite(false)}
          onSuccess={handleSiteCreated}
        />
      )}

      {newSite && (
        <TokenDisplayModal
          site={newSite}
          onClose={() => setNewSite(null)}
        />
      )}
    </div>
  )
}
