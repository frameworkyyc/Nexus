import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { onNotify } from '@/lib/notify'

const ToastContext = createContext<(message: string) => void>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const push = useCallback((m: string) => {
    setMessage(m)
    window.setTimeout(() => setMessage((cur) => (cur === m ? null : cur)), 5000)
  }, [])
  useEffect(() => onNotify(push), [push])
  return (
    <ToastContext.Provider value={push}>
      {children}
      {message && (
        <div role="status" className="fixed bottom-6 phone:bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-nx bg-ink px-4 py-3 text-[13px] text-white">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  )
}
