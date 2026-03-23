'use client'

import { useQuery } from '@tanstack/react-query'
import { Globe, AlertTriangle, Clock, XCircle } from 'lucide-react'
import { sitesApi, type Job } from '@/lib/api'
import { getJobResultSummary } from '@/lib/jobs'
import { formatRelativeDate, getStatusBgColor, cn } from '@/lib/utils'

function MetricCard({
  title,
  value,
  icon: Icon,
  description,
  variant = 'default',
}: {
  title: string
  value: number | string
  icon: React.ElementType
  description: string
  variant?: 'default' | 'warning' | 'danger'
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p
            className={cn(
              'text-3xl font-semibold mt-1',
              variant === 'warning' && 'text-amber-500',
              variant === 'danger' && 'text-red-500',
              variant === 'default' && 'text-foreground',
            )}
          >
            {value}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
        <div
          className={cn(
            'p-2 rounded-lg',
            variant === 'warning' && 'bg-amber-500/10',
            variant === 'danger' && 'bg-red-500/10',
            variant === 'default' && 'bg-muted',
          )}
        >
          <Icon
            className={cn(
              'w-5 h-5',
              variant === 'warning' && 'text-amber-500',
              variant === 'danger' && 'text-red-500',
              variant === 'default' && 'text-muted-foreground',
            )}
          />
        </div>
      </div>
    </div>
  )
}

function JobRow({ job }: { job: Job }) {
  const summary = getJobResultSummary(job)

  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
              getStatusBgColor(job.status),
            )}
          >
            {job.status}
          </span>
          <span className="text-sm text-foreground">{job.type.replace(/_/g, ' ')}</span>
        </div>
        {summary && (
          <p
            title={summary}
            className={cn(
              'mt-1 text-xs truncate',
              job.status === 'failed' ? 'text-red-500' : 'text-muted-foreground',
            )}
          >
            {summary}
          </p>
        )}
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelativeDate(job.createdAt)}</span>
    </div>
  )
}

export default function DashboardPage() {
  const { data: sites = [], isLoading: sitesLoading } = useQuery({
    queryKey: ['sites'],
    queryFn: sitesApi.list,
    refetchInterval: 30_000,
  })

  const sitesWithIssues = sites.filter((s) => s.status !== 'active').length
  const unreachableSites = sites.filter((s) => s.status === 'unreachable').length

  // Get 20 most recent jobs across all sites
  const { data: recentJobsData } = useQuery({
    queryKey: ['recent-jobs'],
    queryFn: async () => {
      if (sites.length === 0) return []
      const jobPromises = sites.slice(0, 5).map((s) => sitesApi.jobs(s.id, 1))
      const results = await Promise.all(jobPromises)
      return results
        .flatMap((r) => r.jobs)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 20)
    },
    enabled: sites.length > 0,
  })

  const recentJobs = recentJobsData ?? []
  const failedJobsLast24h = recentJobs.filter(
    (j) =>
      j.status === 'failed' &&
      new Date(j.createdAt).getTime() > Date.now() - 24 * 60 * 60 * 1000,
  ).length

  if (sitesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of all managed sites</p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Total sites"
          value={sites.length}
          icon={Globe}
          description="Registered in SitePilot"
        />
        <MetricCard
          title="Sites with issues"
          value={sitesWithIssues}
          icon={AlertTriangle}
          description="Not active or unreachable"
          variant={sitesWithIssues > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          title="Unreachable"
          value={unreachableSites}
          icon={Clock}
          description="Companion not responding"
          variant={unreachableSites > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          title="Failed jobs (24h)"
          value={failedJobsLast24h}
          icon={XCircle}
          description="Jobs that failed in the last 24h"
          variant={failedJobsLast24h > 0 ? 'danger' : 'default'}
        />
      </div>

      {/* Recent activity */}
      <div className="bg-card border border-border rounded-xl">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">Recent activity</h2>
        </div>
        <div className="px-5">
          {recentJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No recent jobs. Add a site and trigger a backup to get started.
            </p>
          ) : (
            recentJobs.map((job) => <JobRow key={job.id} job={job} />)
          )}
        </div>
      </div>
    </div>
  )
}
