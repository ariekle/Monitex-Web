export interface PriceListItem {
  Code: number
  Name: string | null
  Price1: number | null
  Price2: number | null
  Price3: number | null
  Price4: number | null
  Price5: number | null
  Price6: number | null
  /** True -> Meter.Insurance ends up False, which the VB6 form displays as "יש" (has insurance) — see Account.tsx's ביטוח field. */
  add_insurance: boolean | null
  /** True -> this item extends the meter's service expiry (12 months if paid in full, else a manually-entered month count). */
  add_service: boolean | null
  add_modem_service: boolean | null
}

/** Sum of an item's installment slots — paying this much in one line is treated as a one-shot full-year payment (+12 months) instead of a partial installment. */
export function priceListFullTotal(item: Pick<PriceListItem, 'Price1' | 'Price2' | 'Price3' | 'Price4' | 'Price5' | 'Price6'>): number {
  return (item.Price1 ?? 0) + (item.Price2 ?? 0) + (item.Price3 ?? 0) + (item.Price4 ?? 0) + (item.Price5 ?? 0) + (item.Price6 ?? 0)
}

/**
 * An item priced across more than one PriceN column means the customer pays
 * it off in that many separate payments, one per column — Price1 is the
 * first payment's own amount, Price2 the second's, etc. (confirmed
 * 2026-08-19 — NOT an equal split of the total; each slot is its own fixed
 * amount from the price list). Matches CalMoney()/ActivateLine() in
 * frmInvRec.frm, which count payments by walking Price6 down to Price2
 * looking for the first non-zero one (falling back to 1 payment/Price1
 * alone). Returns [] for a plain single-price item.
 */
export function priceListInstallments(
  item: Pick<PriceListItem, 'Price1' | 'Price2' | 'Price3' | 'Price4' | 'Price5' | 'Price6'>,
): number[] {
  const prices = [item.Price1, item.Price2, item.Price3, item.Price4, item.Price5, item.Price6]
  let count = 1
  for (let i = 6; i >= 2; i--) {
    if (prices[i - 1]) {
      count = i
      break
    }
  }
  if (count <= 1) return []
  return prices.slice(0, count).map((p) => p ?? 0)
}

export interface InvoiceLine {
  Code: number | null
  Description: string | null
  Amount: number | null
  UnitPrice: number | null
  SubTotal: number | null
}

export interface InvoiceListItem {
  InvNr: number
  /** InvNr % 1_000_000 — the number actually shown to users/printed, per the original VB6 form. */
  DisplayNr: number
  Type: number | null
  TypeLabel: string | null
  Date: string | null
  Time: string | null
  Name: string | null
  GrandTotal: number | null
  Deleted: boolean | null
  Printed: boolean | null
}

export interface PaymentMethod {
  /** "cash" | "check" | "credit" | "unknown" (unrecognized PaymentType code) */
  method: string
  amount: number | null
  checkNr: number | null
  bankNr: number | null
  snifNr: number | null
  accountNr: number | null
  checkDate: string | null
  cardNr: string | null
  cardExpDate: string | null
  /** "regular" | "credit" | "installments" | null — see creditType() in frmInvRec.frm */
  creditType: string | null
  installments: number | null
}

export interface InvoiceDetail extends InvoiceListItem {
  RecNr: number | null
  TaxiNr: number | null
  Tz: number | null // ת.ז — payer's Israeli ID, captured for חש/קבלה
  Town: string | null
  Street: string | null
  HomeNr: string | null
  ZipCode: number | null
  Lines: InvoiceLine[]
  Total: number | null
  Vat: number | null
  TotalVat: number | null
  Payments: PaymentMethod[]
}

export interface InvoiceLineInput {
  Code: number
  Amount: number
  UnitPrice?: number
  /** Required only when this line's item has add_service=true and its subtotal doesn't match the item's full combined price (an installment, not a one-shot payment) — see PriceListItem docstring. Range 1-18. */
  AddMonths?: number
}

/** 'cash' | 'check' | 'credit' are accepted by the server — see backend routers/invoices.py. */
export interface PaymentMethodInput {
  method: 'cash' | 'check' | 'credit'
  amount: number
  checkNr?: number
  bankNr?: number
  snifNr?: number
  accountNr?: number
  checkDate?: string // "DD/MM/YYYY"
  cardNr?: string
  cardExpDate?: string // "MM/YY"
  creditType?: 'regular' | 'credit' | 'installments'
  installments?: number
}

export interface NextInvoiceNumber {
  InvNr: number
  DisplayNr: number
}

/** An open (unconsumed-balance) קבלה eligible to be linked via rec_nr. */
export interface OpenReceipt {
  DisplayNr: number
  TaxiNr: number | null
  Name: string | null
  Date: string | null
  Remaining: number
}

/** Current global VAT rate (percent), from the single CFG row. */
export async function fetchVatRate(): Promise<number> {
  const res = await fetch('/api/vat-rate')
  if (!res.ok) throw new Error(`Failed to load VAT rate: ${res.status}`)
  const body: { rate: number } = await res.json()
  return body.rate
}

/**
 * Preview of the next document number for this type — informational only.
 * The actual save recomputes this independently server-side right before
 * commit, so this preview can go stale (another user saves in the meantime)
 * without causing a collision — see backend routers/invoices.py.
 */
export async function fetchNextInvoiceNumber(docType: number): Promise<NextInvoiceNumber> {
  const res = await fetch(`/api/invoices/next-number?doc_type=${docType}`)
  if (!res.ok) throw new Error(`Failed to load next invoice number: ${res.status}`)
  return res.json()
}

/** Ported from the F1 lookup in txtRecNr_KeyUp (frmInvoice.frm) — see backend routers/invoices.py. */
export async function fetchOpenReceipts(): Promise<OpenReceipt[]> {
  const res = await fetch('/api/invoices/open-receipts')
  if (!res.ok) throw new Error(`Failed to load open receipts: ${res.status}`)
  return res.json()
}

/**
 * Ported from checkRecNr() in frmInvoice.frm — validates a manually-typed
 * receipt number, throwing the same Hebrew error messages the original
 * shows (קבלה לא נמצאה / קבלה שייכת לאיפוס / קבלה זו סגורה) on failure.
 */
export async function validateOpenReceipt(displayNr: number): Promise<OpenReceipt> {
  const res = await fetch(`/api/invoices/open-receipts/${displayNr}/validate`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail || `Failed to validate receipt ${displayNr}: ${res.status}`)
  }
  return res.json()
}

/** Returns PriceListEilat instead of PriceList when THIS WORKSTATION's own branch Area (see api/branch.ts) is Eilat, not any particular taxi's Area — see routers/invoices.py's list_pricelist(). */
export async function fetchPriceList(branchArea: number): Promise<PriceListItem[]> {
  const res = await fetch(`/api/pricelist?branch_area=${branchArea}`)
  if (!res.ok) throw new Error(`Failed to load price list: ${res.status}`)
  return res.json()
}

export async function fetchInvoices(taxiNr: number): Promise<InvoiceListItem[]> {
  const res = await fetch(`/api/account/${taxiNr}/invoices`)
  if (!res.ok) throw new Error(`Failed to load invoices for ${taxiNr}: ${res.status}`)
  return res.json()
}

export async function fetchInvoice(taxiNr: number, invNr: number): Promise<InvoiceDetail> {
  const res = await fetch(`/api/account/${taxiNr}/invoices/${invNr}`)
  if (!res.ok) throw new Error(`Failed to load invoice ${invNr}: ${res.status}`)
  return res.json()
}

/** Thrown when the server needs the "extend service anyway?" confirmation — see CONFIRM_EXTEND_SERVICE in routers/invoices.py. */
export class ConfirmExtendServiceError extends Error {}

/**
 * Call before printing — see routers/invoices.py's mark_invoice_printed().
 * Returns whether this invoice had ALREADY been printed before this call, so
 * the single "הדפס" button can decide מקור (never printed) vs. העתק
 * (everything else), then marks it printed for next time.
 */
export async function markInvoicePrinted(taxiNr: number, invNr: number): Promise<{ wasAlreadyPrinted: boolean }> {
  const res = await fetch(`/api/account/${taxiNr}/invoices/${invNr}/mark-printed`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to mark invoice ${invNr} printed: ${res.status}`)
  return res.json()
}

export async function createInvoice(
  taxiNr: number,
  docType: number,
  lines: InvoiceLineInput[],
  branchArea: number,
  payments: PaymentMethodInput[] = [],
  buyer?: { name?: string; tz?: number },
  recNr?: number,
  extendServiceDecision?: 'confirm' | 'decline',
  /** HESHBONIT_ISKA(3) only — TaxiNr of the account actually being billed. */
  paidByTaxiNr?: number,
  /** CREDIT_NOTE(4) only — the RAW InvNr (not display number) of the document being credited. */
  creditedInvNr?: number,
): Promise<InvoiceDetail> {
  const res = await fetch(`/api/account/${taxiNr}/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      doc_type: docType,
      lines,
      payments,
      buyer_name: buyer?.name,
      buyer_tz: buyer?.tz,
      rec_nr: recNr,
      confirm_extend_service: extendServiceDecision === 'confirm',
      decline_extend_service: extendServiceDecision === 'decline',
      branch_area: branchArea,
      paid_by_taxi_nr: paidByTaxiNr,
      credited_inv_nr: creditedInvNr,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail: string = body?.detail || `Failed to create invoice: ${res.status}`
    const prefix = 'CONFIRM_EXTEND_SERVICE: '
    if (detail.startsWith(prefix)) {
      throw new ConfirmExtendServiceError(detail.slice(prefix.length))
    }
    throw new Error(detail)
  }
  return res.json()
}
