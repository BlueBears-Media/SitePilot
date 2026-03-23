'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Globe, LayoutDashboard, LogOut, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { auth } from '@/lib/api'
import { cn } from '@/lib/utils'

const primaryNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/sites', label: 'Sites', icon: Globe },
]

const utilityNavItems = [{ href: '/settings', label: 'Settings', icon: Settings }]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    try {
      await auth.logout()
      router.push('/login')
    } catch {
      toast.error('Failed to log out')
    }
  }

  return (
    <div className="flex h-screen bg-background">
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-border">
          <div className="w-7 h-7 bg-blue-500 rounded-md flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-xs">SP</span>
          </div>
          <span className="font-semibold text-sm text-foreground">SitePilot</span>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          <div>
            {primaryNavItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
              const Icon = item.icon

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </nav>

        <div className="px-2 py-3 border-t border-border">
          <div className="space-y-0.5">
            {utilityNavItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
              const Icon = item.icon

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {item.label}
                </Link>
              )
            })}

            <button
              onClick={handleLogout}
              className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-md w-full text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <LogOut className="w-4 h-4 flex-shrink-0" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
