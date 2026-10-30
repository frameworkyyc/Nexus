import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'
import { useCardTableLabels } from '@/components/mobile/cardTables'
import { useIsPhone } from '@/lib/useMedia'
import { BottomNav } from './BottomNav'
import { DataGate } from './DataGate'
import { MobileHeader } from './MobileHeader'
import { OnboardingGate } from './OnboardingGate'
import { MoreSheet } from './MoreSheet'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/**
 * Desktop and tablet: sidebar + top bar, exactly as before. Phone: compact header, the page scrolls as a normal document (so Safari's
 * toolbar collapses naturally) and a fixed bottom navigation. Both render the same routes and share all application state.
 */
export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const phone = useIsPhone()
  useCardTableLabels(phone)
  if (phone) {
    return (
      <ToastProvider>
        <div className="min-h-dvh bg-canvas">
          <MobileHeader onMenu={() => setNavOpen(true)} />
          <div className="pl-safe pr-safe">
            <main className="px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5">
              <DataGate><OnboardingGate><Outlet /></OnboardingGate></DataGate>
            </main>
          </div>
          <BottomNav />
          {navOpen && <MoreSheet onClose={() => setNavOpen(false)} />}
        </div>
      </ToastProvider>
    )
  }
  return (
    <ToastProvider>
      <div className="flex h-full">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenu={() => setNavOpen(true)} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
              <DataGate><OnboardingGate><Outlet /></OnboardingGate></DataGate>
            </div>
          </main>
        </div>
      </div>
    </ToastProvider>
  )
}
