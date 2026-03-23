'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import { AlertTriangle, MoonStar, Palette, PlugZap, SunMedium, Users } from 'lucide-react'
import { toast } from 'sonner'
import { StorageConnectionsPanel } from '@/components/settings/storage-connections-panel'
import { cn } from '@/lib/utils'

type SettingsSectionId = 'appearance' | 'connections' | 'workspace' | 'danger'

const sections: Array<{
  id: SettingsSectionId
  label: string
  description: string
  icon: React.ElementType
}> = [
  { id: 'appearance', label: 'Appearance', description: 'Theme settings', icon: Palette },
  { id: 'connections', label: 'Connections', description: 'Storage and future connectors', icon: PlugZap },
  { id: 'workspace', label: 'Workspace', description: 'Users and email', icon: Users },
  { id: 'danger', label: 'Danger zone', description: 'High impact actions', icon: AlertTriangle },
]

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-card border border-border rounded-xl">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground mt-0.5">{description}</p> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const activeTheme = mounted && (theme === 'light' || theme === 'dark') ? theme : 'dark'

  return (
    <SectionCard title="Appearance" description="Choose how the dashboard looks.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          {
            id: 'light' as const,
            label: 'Light',
            description: 'A bright, neutral interface for daytime work.',
            icon: SunMedium,
          },
          {
            id: 'dark' as const,
            label: 'Dark',
            description: 'A darker interface for focused work and lower-glare sessions.',
            icon: MoonStar,
          },
        ].map((option) => {
          const Icon = option.icon
          const isActive = activeTheme === option.id

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setTheme(option.id)}
              className={cn(
                'text-left border rounded-xl p-4 transition-colors',
                isActive
                  ? 'border-blue-500 bg-blue-500/5'
                  : 'border-border bg-background hover:bg-muted/30',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{option.label}</div>
                  <p className="text-sm text-muted-foreground mt-1">{option.description}</p>
                </div>
                <div
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center',
                    isActive ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Icon className="w-4 h-4" />
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </SectionCard>
  )
}

function ConnectionsSection() {
  return (
    <div className="space-y-6">
      <SectionCard
        title="Connections"
        description="External services used by SitePilot."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border border-border rounded-xl p-4">
            <div className="text-sm font-medium">Storage</div>
            <p className="text-sm text-muted-foreground mt-1">
              Manage S3, NFS, or local backup destinations.
            </p>
          </div>
          <div className="border border-border rounded-xl p-4">
            <div className="text-sm font-medium">Google Analytics</div>
            <p className="text-sm text-muted-foreground mt-1">
              Reserved for future analytics connectors.
            </p>
          </div>
          <div className="border border-border rounded-xl p-4">
            <div className="text-sm font-medium">Umami / Rybbit</div>
            <p className="text-sm text-muted-foreground mt-1">
              Additional analytics integrations can live here later.
            </p>
          </div>
        </div>
      </SectionCard>

      <StorageConnectionsPanel />
    </div>
  )
}

function WorkspaceSection() {
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpFrom, setSmtpFrom] = useState('')

  const handleSmtpSave = (e: React.FormEvent) => {
    e.preventDefault()
    toast.info('SMTP settings saved (requires API implementation)')
  }

  const handleTestEmail = () => {
    toast.info('Test email sent (requires API implementation)')
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Users" description="Team management for the workspace.">
        <p className="text-sm text-muted-foreground">
          User management coming soon. Currently using the default admin account.
        </p>
      </SectionCard>

      <SectionCard title="SMTP" description="Configure outgoing email for notifications.">
        <form onSubmit={handleSmtpSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Host</label>
              <input
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="smtp.example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Port</label>
              <input
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="587"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Username</label>
            <input
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Password</label>
            <input
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">From address</label>
            <input
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="noreply@sitepilot.io"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Save SMTP settings
            </button>
            <button
              type="button"
              onClick={handleTestEmail}
              className="px-4 py-2 bg-muted hover:bg-accent text-foreground text-sm rounded-lg transition-colors"
            >
              Send test email
            </button>
          </div>
        </form>
      </SectionCard>
    </div>
  )
}

function DangerSection() {
  return (
    <SectionCard title="Danger zone">
      <div className="border border-red-500/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <p className="text-sm font-medium text-red-500">These actions are irreversible.</p>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Please proceed with caution.
        </p>
        <button
          onClick={() => {
            if (window.confirm('This will reset all SitePilot data. Are you absolutely sure?')) {
              toast.error('Reset not yet implemented')
            }
          }}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Reset platform
        </button>
      </div>
    </SectionCard>
  )
}

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const requestedSection = searchParams.get('section')

  const activeSection: SettingsSectionId = sections.some((section) => section.id === requestedSection)
    ? (requestedSection as SettingsSectionId)
    : 'appearance'

  const updateSection = (sectionId: SettingsSectionId) => {
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.set('section', sectionId)
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false })
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Platform configuration</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        <aside>
          <div className="bg-card border border-border rounded-xl p-2">
            {sections.map((section) => {
              const Icon = section.icon
              const isActive = section.id === activeSection

              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => updateSection(section.id)}
                  className={cn(
                    'w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium">{section.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{section.description}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <div className="space-y-6">
          {activeSection === 'appearance' ? <AppearanceSection /> : null}
          {activeSection === 'connections' ? <ConnectionsSection /> : null}
          {activeSection === 'workspace' ? <WorkspaceSection /> : null}
          {activeSection === 'danger' ? <DangerSection /> : null}
        </div>
      </div>
    </div>
  )
}
