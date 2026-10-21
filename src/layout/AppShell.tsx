import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'
import { DataGate } from './DataGate'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  return (
    <ToastProvider>
      <div className="flex h-full">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenu={() => setNavOpen(true)} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
              <DataGate><Outlet /></DataGate>
            </div>
          </main>
        </div>
      </div>
    </ToastProvider>
  )
}
