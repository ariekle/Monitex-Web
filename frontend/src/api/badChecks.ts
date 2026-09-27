import type { InvoiceLineInput, PaymentMethodInput } from './invoices'

/** Ported from Code/frmBackCheck.frm — see backend routers/bad_checks.py / models.py's BadChecks docstring. */

export interface BadCheckOptions {
  reasons: string[]
  banks: string[]
  statuses: string[]
}

export interface BadCheck {
  BadCheckNr: number
  CheckNr: number
  AccountNr: number | null
  SnifNr: number | null
  BankNr: number | null
  BankName: string | null
  ReturnBank: number | null
  ReturnBankName: string | null
  InvNr: number
  Money: number
  DueDate: string | null
  TaxiNr: number
  Name: string | null
  Town: string | null
  Street: string | null
  HomeNr: string | null
  Tz: number | null
  ZipCode: number | null
  FamilyName: string | null
  CellPhone: string | null
  Lost: boolean
  Statustxt: string | null
  Reason: string | null
  PaidCheck: number
  PaidOver: number
  Date1: string | null
  Msg1: string | null
  Date2: string | null
  Msg2: string | null
  Date3: string | null
  Msg3: string | null
  Date4: string | null
  Msg4: string | null
  Date5: string | null
  Msg5: string | null
  /** Today's late fee, computed live — not stored. See _bad_check_debit() in routers/bad_checks.py. */
  Debit: number
  /** Debit + Money — NOT reduced by PaidCheck already collected, matches the original exactly (see BadChecks model docstring). */
  ToPay: number
  /** PaidCheck < Money and not Lost — mirrors when the original unlocks the payment/edit fields. */
  StillCollectible: boolean
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Request failed: ${res.status}`)
  }
  return res.json()
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => null)
    throw new Error(errBody?.detail || `Request failed: ${res.status}`)
  }
  return res.json()
}

export function fetchBadCheckOptions(): Promise<BadCheckOptions> {
  return getJson('/api/bad-checks/options')
}

export function findBadChecksByCheck(checkNr: number, accountNr: number, snifNr: number): Promise<BadCheck[]> {
  const params = new URLSearchParams({ check_nr: String(checkNr), account_nr: String(accountNr), snif_nr: String(snifNr) })
  return getJson(`/api/bad-checks/by-check?${params.toString()}`)
}

export function findBadChecksByTz(tz: number): Promise<BadCheck[]> {
  return getJson(`/api/bad-checks/by-tz?${new URLSearchParams({ tz: String(tz) }).toString()}`)
}

export function findBadChecksByTaxi(taxiNr: number): Promise<BadCheck[]> {
  return getJson(`/api/bad-checks/by-taxi?${new URLSearchParams({ taxi_nr: String(taxiNr) }).toString()}`)
}

export function reportBadCheck(checkNr: number, accountNr: number, snifNr: number): Promise<BadCheck> {
  return postJson('/api/bad-checks/report', { check_nr: checkNr, account_nr: accountNr, snif_nr: snifNr })
}

export interface BadCheckRepayInput {
  branch_area?: number
  pay_check?: { payments: PaymentMethodInput[] }
  pay_interest?: { lines: InvoiceLineInput[]; payments: PaymentMethodInput[] }
  family_name?: string
  cell_phone?: string
  street?: string
  home_nr?: string
  town?: string
  zip_code?: number
  reason?: string
  return_bank_name?: string
  statustxt?: string
  date1?: string
  msg1?: string
  date2?: string
  msg2?: string
  date3?: string
  msg3?: string
  date4?: string
  msg4?: string
  date5?: string
  msg5?: string
}

export interface BadCheckRepayResult {
  badCheck: BadCheck
  checkReceiptInvNr: number | null
  interestInvoiceInvNr: number | null
}

export function repayBadCheck(badCheckNr: number, input: BadCheckRepayInput): Promise<BadCheckRepayResult> {
  return postJson(`/api/bad-checks/${badCheckNr}/repay`, input)
}

export function markBadCheckLost(badCheckNr: number): Promise<BadCheck> {
  return postJson(`/api/bad-checks/${badCheckNr}/lost`)
}
