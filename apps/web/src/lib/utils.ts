import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes: number | bigint | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  const n = typeof bytes === 'bigint' ? Number(bytes) : bytes
  if (n === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(k))
  return `${parseFloat((n / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function formatRelativeDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60_000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return formatDate(date)
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'active':
    case 'complete':
      return 'text-green-500'
    case 'running':
    case 'pending':
      return 'text-blue-500'
    case 'unreachable':
    case 'failed':
      return 'text-red-500'
    case 'unknown':
    default:
      return 'text-gray-400'
  }
}

export function getStatusBgColor(status: string): string {
  switch (status) {
    case 'active':
    case 'complete':
      return 'bg-green-500/10 text-green-600 dark:text-green-400'
    case 'running':
    case 'pending':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
    case 'unreachable':
    case 'failed':
      return 'bg-red-500/10 text-red-600 dark:text-red-400'
    case 'unknown':
    default:
      return 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
  }
}
