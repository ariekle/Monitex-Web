import type { InvoiceDetail } from './invoices'
import type { TestPrintResult } from './testPrint'

/**
 * Talks to the local "Monitex print bridge" (see WebCode/print-bridge/) — a
 * small PowerShell HTTP server that runs on THIS branch PC (not the central
 * backend) and drives the real, original Crystal Reports .rpt files via COM.
 * Always localhost: each branch's browser talks to its own machine's bridge,
 * never through the central server. Always renders against the real
 * production DB — the dev-DB (`taxidb`) print path was removed (2026-08-18)
 * since it added a hidden per-workstation footgun (easy to leave switched
 * to 'dev' and get a silently-empty real print) for a feature that was
 * already on hold. See print-bridge/README.md.
 */

const BRIDGE_ORIGIN = 'http://localhost:9100'

/** True if the local print bridge answers /health — used to decide whether to offer the "print via Crystal" option at all vs. falling back to the built-in PDF. */
export async function isPrintBridgeAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_ORIGIN}/health`, { signal: AbortSignal.timeout(800) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Builds the /print/invoice URL for a saved invoice — matches
 * InvoiceReport2's contract (see print-bridge/README.md). `copy` mirrors
 * the original's Makor flag: true -> "מקור" (original), false -> "העתק".
 * Name1..Name6 come straight from the invoice's own Lines[].Description,
 * which the backend already resolves via the same PriceList/PriceListEilat
 * branching the report itself used to do inline.
 */
export function invoicePrintUrl(invoice: InvoiceDetail, copy: boolean): string {
  const params = new URLSearchParams({ invNr: String(invoice.InvNr), copy: copy ? '1' : '0' })
  invoice.Lines.slice(0, 6).forEach((line, i) => {
    if (line.Description) params.set(`name${i + 1}`, line.Description)
  })
  return `${BRIDGE_ORIGIN}/print/invoice?${params.toString()}`
}

/** Matches ActiveResetRpt's contract — always the branch's current staging row (ResetNr fixed at 0 on the bridge side, same as the original). */
export function resetActivePrintUrl(branchArea: number): string {
  const params = new URLSearchParams({ area: String(branchArea) })
  return `${BRIDGE_ORIGIN}/print/reset/active?${params.toString()}`
}

/** Matches PastResetRpt's contract — a specific historical reset by its real ResetNr. */
export function resetPastPrintUrl(branchArea: number, resetNr: number): string {
  const params = new URLSearchParams({ area: String(branchArea), resetNr: String(resetNr) })
  return `${BRIDGE_ORIGIN}/print/reset/past?${params.toString()}`
}

/**
 * Matches TestReportNew's contract (testNew.rpt) — see print-bridge/README.md.
 * `result` is exactly what POST /api/account/{taxiNr}/test-print returns:
 * the backend has already run all 5 preconditions, resolved MeterType,
 * written the History row, and allocated (or zeroed out, per this branch's
 * Areas.PrintTestNr) the testNr — this call only renders the certificate
 * from those already-resolved values. The bridge itself splits `carnr` into
 * the report's Carnr1/Carnr2/Carnr3 fields (see Handle-TestPrint).
 *
 * No meterNr param: the report reads that live from its own Accounts join
 * now (see routers/test_print.py's module docstring for why).
 */
export function testPrintUrl(result: TestPrintResult): string {
  const params = new URLSearchParams({
    taxiNr: String(result.taxiNr),
    carnr: String(result.carnr),
    meterType: result.meterType,
    vehicleModel: result.vehicleModel,
    testNr: String(result.testNr),
  })
  return `${BRIDGE_ORIGIN}/print/test?${params.toString()}`
}
