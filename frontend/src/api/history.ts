export interface HistoryEntry {
  TransNr: number
  Date: string | null
  Time: string | null
  Status: number | null
  /** Resolved Hebrew label from the Actions lookup table, e.g. "הרכבת מונה". */
  ActionLabel: string | null

  Name: string | null
  TaxiNr: number | null
  OldTaxiNr: number | null
  MeterNr: number | null
  CarNr: number | null
  Area: number | null
  /** Resolved from the Areas lookup table, e.g. "תל אביב". */
  AreaLabel: string | null

  /** Encoded month*10000+year, same as Account.MeterExpDate — NOT a real date. */
  ExpDate: number | null
  Insurance: boolean | null

  InvoiceNr: number | null
  InvType: number | null
  AccPaid: number | null
  AmountPaid: number | null
  AmountGet: number | null
}

export async function fetchHistory(taxiNr: number): Promise<HistoryEntry[]> {
  const res = await fetch(`/api/account/${taxiNr}/history`)
  if (!res.ok) {
    throw new Error(`Failed to load history for ${taxiNr}: ${res.status}`)
  }
  return res.json()
}

/**
 * Not present in the original (frmHistory.frm only ever searches by
 * TaxiNr) — pulls a meter's full history across every taxi it's ever been
 * assigned to. See routers/account.py's get_history_by_meter.
 */
export async function fetchHistoryByMeter(meterNr: number): Promise<HistoryEntry[]> {
  const res = await fetch(`/api/account/history/by-meter/${meterNr}`)
  if (!res.ok) {
    throw new Error(`Failed to load history for meter ${meterNr}: ${res.status}`)
  }
  return res.json()
}
