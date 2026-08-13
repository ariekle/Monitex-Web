/**
 * This workstation's branch Area — the web equivalent of the original VB6
 * app's c:\meesql.cfg. In the original, each installed copy WAS one
 * branch's own computer, so `Public Area As Integer` (Main.bas) could just
 * be read once from a local file at startup. This web app is one shared
 * backend potentially serving browsers from several branches, so that
 * global can't live on the server anymore — instead each workstation picks
 * its branch ONCE (via the setup prompt in BranchAreaGate.tsx) and this
 * module persists it in localStorage, exactly like a per-computer config
 * file would. Every backend call that needs it (invoices, pricelist,
 * meter/cap actions) sends it explicitly as `branch_area`.
 */

const STORAGE_KEY = 'monitex.branchArea'

export interface AreaOption {
  area: number
  name: string | null
}

export async function fetchAreas(): Promise<AreaOption[]> {
  const res = await fetch('/api/areas')
  if (!res.ok) throw new Error(`Failed to load areas: ${res.status}`)
  return res.json()
}

export function getStoredBranchArea(): number | null {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function setStoredBranchArea(area: number): void {
  window.localStorage.setItem(STORAGE_KEY, String(area))
}

export function clearStoredBranchArea(): void {
  window.localStorage.removeItem(STORAGE_KEY)
}
