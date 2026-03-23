'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, TestTube, Trash2 } from 'lucide-react'
import { storageApi, type StorageProfile } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    s3: 'bg-orange-500/10 text-orange-500',
    nfs: 'bg-purple-500/10 text-purple-500',
    local: 'bg-green-500/10 text-green-500',
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', colors[type] ?? 'bg-muted text-muted-foreground')}>
      {type.toUpperCase()}
    </span>
  )
}

function AddProfileSlideOver({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState<'s3' | 'nfs' | 'local'>('local')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // S3 fields
  const [bucket, setBucket] = useState('')
  const [region, setRegion] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')

  // NFS fields
  const [mountPath, setMountPath] = useState('')

  // Local fields
  const [directory, setDirectory] = useState('./data/backups')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    let config: unknown
    if (type === 's3') config = { type: 's3', bucket, region, endpoint, accessKeyId, secretAccessKey }
    else if (type === 'nfs') config = { type: 'nfs', mountPath }
    else config = { type: 'local', directory }

    try {
      await storageApi.create({ name, type, config })
      toast.success('Storage profile created')
      void queryClient.invalidateQueries({ queryKey: ['storage-profiles'] })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card border-l border-border flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Add storage profile</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">×</button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Profile name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="My S3 Bucket"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Storage type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 's3' | 'nfs' | 'local')}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="s3">S3-compatible (AWS / MinIO)</option>
              <option value="nfs">NFS mount</option>
              <option value="local">Local filesystem</option>
            </select>
          </div>

          {type === 's3' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1.5">Endpoint URL</label>
                <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="https://s3.amazonaws.com" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Bucket</label>
                <input value={bucket} onChange={(e) => setBucket(e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Region</label>
                <input value={region} onChange={(e) => setRegion(e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="us-east-1" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Access key ID</label>
                <input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Secret access key</label>
                <input type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </>
          )}

          {type === 'nfs' && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Mount path</label>
              <input value={mountPath} onChange={(e) => setMountPath(e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="/mnt/backups" />
            </div>
          )}

          {type === 'local' && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Directory path</label>
              <input value={directory} onChange={(e) => setDirectory(e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="./data/backups" />
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={loading} className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            {loading ? 'Creating…' : 'Create profile'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function StoragePage() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['storage-profiles'],
    queryFn: storageApi.list,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => storageApi.delete(id),
    onSuccess: () => {
      toast.success('Profile deleted')
      void queryClient.invalidateQueries({ queryKey: ['storage-profiles'] })
    },
    onError: () => toast.error('Failed to delete profile'),
  })

  const testConnection = async (id: string) => {
    setTestingId(id)
    try {
      const result = await storageApi.test(id)
      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection test failed')
    } finally {
      setTestingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">Storage</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage backup storage destinations</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add profile
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-muted-foreground">No storage profiles yet. Add one to start storing backups.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Type</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Created</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile: StorageProfile) => (
                <tr key={profile.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{profile.name}</td>
                  <td className="px-4 py-3"><TypeBadge type={profile.type} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(profile.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => testConnection(profile.id)}
                        disabled={testingId === profile.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-muted hover:bg-accent rounded-md transition-colors disabled:opacity-50"
                      >
                        <TestTube className="w-3 h-3" />
                        {testingId === profile.id ? 'Testing…' : 'Test'}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Delete this storage profile?')) {
                            deleteMutation.mutate(profile.id)
                          }
                        }}
                        className="p-1.5 text-muted-foreground hover:text-red-500 rounded-md hover:bg-muted transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddProfileSlideOver onClose={() => setShowAdd(false)} />}
    </div>
  )
}
