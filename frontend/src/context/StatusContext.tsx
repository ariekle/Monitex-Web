import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface StatusContextValue {
  status: string
  setStatus: (text: string) => void
}

const StatusContext = createContext<StatusContextValue | null>(null)

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState('Ready')
  const value = useMemo(() => ({ status, setStatus }), [status])
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
}

/** Equivalent to setting sbStatusBar.Panel(1).Text = "..." anywhere in the VB6 code. */
export function useStatus() {
  const ctx = useContext(StatusContext)
  if (!ctx) throw new Error('useStatus must be used within a StatusProvider')
  return ctx
}
