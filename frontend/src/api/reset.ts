/** Mirrors ResetCheckOut in backend/app/schemas.py. */
export interface ResetCheck {
  checkNr: number
  taxiNr: number | null
  bankNr: number | null
  accountNr: number | null
  snifNr: number | null
  dueDate: string | null
  money: number
  /** True if dueDate <= the chosen deposit date, matching cash_check() in frmReset1.frm. */
  cashNow: boolean
}

/** Mirrors ResetKupaLineOut in backend/app/schemas.py. */
export interface ResetKupaLine {
  code: number
  name: string | null
  count: number
  /** Net of VAT; CREDIT_NOTE lines subtract. */
  total: number
}

/**
 * Mirrors ResetPreviewOut in backend/app/schemas.py — everything currently
 * un-reset (Invoices.ResetNr=0) for a branch. If `blocking` is non-empty the
 * reset cannot be committed until those documents are fixed (a HESHBONIT
 * whose linked receipt is missing, or a KABALA that isn't fully closed) —
 * see routers/reset.py.
 */
export interface ResetPreview {
  branchArea: number
  depositDate: string
  depositBank: number
  blocking: string[]

  invRecsCount: number
  invRecsTotal: number
  invoicesCount: number
  invoicesTotal: number
  receiptsCount: number
  receiptsTotal: number
  iskaCount: number
  iskaTotal: number
  creditsCount: number
  creditsTotal: number

  totalKupa: number
  totalVat: number

  cashTotal: number
  checksCashNowTotal: number
  checksCashNowCount: number
  checksDelayedTotal: number
  checksDelayedCount: number
  checks: ResetCheck[]

  creditImmediateTotal: number
  creditInstallmentsTotal: number

  totalDepo: number

  kupaBreakdown: ResetKupaLine[]
}

export interface ResetCommitResult {
  resetNr: number
  summary: ResetPreview
}

/**
 * Ported from cmdReset_Click / Reset() in frmReset1.frm — computes (but does
 * not commit) the full breakdown for everything currently un-reset in this
 * branch. Safe to call repeatedly; has no side effects.
 */
export async function fetchResetPreview(
  branchArea: number,
  depositDate: string, // "YYYY-MM-DD"
  depositBank: number,
): Promise<ResetPreview> {
  const params = new URLSearchParams({
    branch_area: String(branchArea),
    deposit_date: depositDate,
    deposit_bank: String(depositBank),
  })
  const res = await fetch(`/api/reset/preview?${params.toString()}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Failed to load reset preview: ${res.status}`)
  }
  return res.json()
}

/**
 * Commits the reset: allocates a new ResetNr from CFG.IbudNr, writes the
 * ActiveReset/Resets rows, and bulk-stamps ResetNr onto every Invoices/Checks
 * row currently at ResetNr=0 for this branch. 409s (with the same blocking
 * messages the preview shows, or "!!!כל המסמכים מאופסים" if there's nothing
 * to reset) if it can't proceed — always re-preview and show that first.
 */
/** Mirrors ResetLookupOut in backend/app/schemas.py. */
export interface ResetLookup {
  resetNr: number
  area: number
  resetDate: string | null
  depositDate: string | null
  depositBank: number | null

  invRecsCount: number
  invRecsTotal: number
  invoicesCount: number
  invoicesTotal: number
  receiptsCount: number
  receiptsTotal: number
  iskaCount: number
  iskaTotal: number
  creditsCount: number
  creditsTotal: number

  totalKupa: number
  totalVat: number

  cashTotal: number
  checksCashNowTotal: number
  checksCashNowCount: number
  checksDelayedTotal: number
  checksDelayedCount: number

  creditImmediateTotal: number
  creditInstallmentsTotal: number

  totalDepo: number
}

/**
 * Ported from Account.frm's Alt+F5 shortcut — looks up a past (already
 * committed) reset either by its ResetNr directly, or by date+branch area.
 * Pass exactly one of `resetNr` or (`resetDate` and `branchArea`). Throws
 * (with the Hebrew "not found" message) if GET /api/reset/lookup 404s.
 */
export async function lookupReset(
  args: { resetNr: number } | { resetDate: string; branchArea: number },
): Promise<ResetLookup> {
  const params = new URLSearchParams()
  if ('resetNr' in args) {
    params.set('reset_nr', String(args.resetNr))
  } else {
    params.set('reset_date', args.resetDate)
    params.set('branch_area', String(args.branchArea))
  }
  const res = await fetch(`/api/reset/lookup?${params.toString()}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Failed to look up reset: ${res.status}`)
  }
  return res.json()
}

/** Mirrors PendingHashResetOut in backend/app/schemas.py. */
export interface PendingHashReset {
  resetNr: number
  area: number
  areaName: string
  resetDate: string | null
}

/**
 * Ported from frmSendtoHash.frm's Form_Load() grid query — every reset not
 * yet marked as successfully sent to Hashavshevת, across all branches,
 * ordered by area then resetdate descending (matches the original's ORDER
 * BY exactly).
 */
export async function fetchPendingHashResets(): Promise<PendingHashReset[]> {
  const res = await fetch('/api/reset/pending-hash')
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Failed to load pending resets: ${res.status}`)
  }
  return res.json()
}

/**
 * Ported from frmSendtoHash.frm's ResetsGrid_DblClick() post-confirmation
 * step — only call this AFTER the operator has confirmed (in whatever UI
 * shows the "?האם האיפוס עבר בהצלחה לחשבשבת" prompt) that the transfer
 * actually succeeded.
 */
export async function markResetProcessed(resetNr: number): Promise<void> {
  const res = await fetch(`/api/reset/${resetNr}/mark-processed`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Failed to mark reset as processed: ${res.status}`)
  }
}

export async function commitReset(
  branchArea: number,
  depositDate: string, // "YYYY-MM-DD"
  depositBank: number,
): Promise<ResetCommitResult> {
  const res = await fetch('/api/reset/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branch_area: branchArea,
      deposit_date: depositDate,
      deposit_bank: depositBank,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = body?.detail
    const message = Array.isArray(detail) ? detail.join(' / ') : detail || `Failed to commit reset: ${res.status}`
    throw new Error(message)
  }
  return res.json()
}
