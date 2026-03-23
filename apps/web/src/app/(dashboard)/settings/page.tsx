'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'

export default function SettingsPage() {
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
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Platform configuration</p>
      </div>

      {/* Users section */}
      <section className="bg-card border border-border rounded-xl mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Users</h2>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted-foreground">
            User management coming soon. Currently using the default admin account.
          </p>
        </div>
      </section>

      {/* SMTP section */}
      <section className="bg-card border border-border rounded-xl mb-6">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">SMTP</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Configure outgoing email for notifications</p>
        </div>
        <form onSubmit={handleSmtpSave} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
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
      </section>

      {/* Danger zone */}
      <section className="bg-card border border-red-500/30 rounded-xl">
        <div className="px-5 py-4 border-b border-red-500/30">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h2 className="text-sm font-semibold text-red-500">Danger zone</h2>
          </div>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted-foreground mb-4">
            These actions are irreversible. Please proceed with caution.
          </p>
          <button
            onClick={() => {
              if (confirm('This will reset all SitePilot data. Are you absolutely sure?')) {
                toast.error('Reset not yet implemented')
              }
            }}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Reset platform
          </button>
        </div>
      </section>
    </div>
  )
}
