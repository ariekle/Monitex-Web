import { useEffect, useState, type KeyboardEvent } from 'react'
import { fetchHistory, fetchHistoryByMeter, type HistoryEntry } from '../api/history'
import { formatDate, formatTime, formatMonthYear } from '../utils/format'
import InvoiceModal from './InvoiceModal'

/**
 * Web equivalent of cmdHistory_Click in Account.frm (frmHistory.frm) — a grid
 * of every History row for the loaded taxi, newest first, with Status
 * resolved to its Hebrew label via the Actions lookup table.
 *
 * Document rows (InvoiceNr populated) are clickable and open that invoice's
 * detail view. History.InvoiceNr only stores the DISPLAY number (mod
 * 1,000,000 — see routers/invoices.py's `InvoiceNr=invoice.InvNr %
 * 1_000_000`), so the raw InvNr used to look the invoice up is reconstructed
 * as `InvType * 1_000_000 + InvoiceNr`, matching compute_next_invoice_number's
 * offset scheme (type 0 has no offset, type 1 is +1,000,000, type N is
 * +N*1,000,000).
 *
 * Opens straight into the currently-loaded taxi's own history (default,
 * one-click, no picker). A small "חיפוש לפי מספר מונה" link in the header
 * reveals a compact inline search for the by-meter capability — a feature
 * the original doesn't have at all (frmHistory.frm only ever queries by
 * TaxiNr; see get_history_by_meter's docstring in routers/account.py) —
 * without cluttering the default view with a picker nobody asked for.
 */
export default function HistoryModal({ taxiNr, onClose }: { taxiNr: number; onClose: () => void }) {
  const [mode, setMode] = useState<'taxi' | 'meter'>('taxi')
  const [showMeterSearch, setShowMeterSearch] = useState(false)
  const [meterQuery, setMeterQuery] = useState('')
  const [viewedMeterNr, setViewedMeterNr] = useState<number | null>(null)
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openDoc, setOpenDoc] = useState<{ taxiNr: number; invNr: number } | null>(null)

  useEffect(() => {
    if (mode !== 'taxi') return
    let cancelled = false
    setEntries(null)
    setError(null)
    fetchHistory(taxiNr)
      .then((result) => {
        if (!cancelled) setEntries(result)
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load history')
      })
    return () => {
      cancelled = true
    }
  }, [taxiNr, mode])

  function backToTaxi() {
    setMode('taxi')
    setShowMeterSearch(false)
    setMeterQuery('')
    setViewedMeterNr(null)
  }

  function searchByMeter() {
    const trimmed = meterQuery.trim()
    const meterNr = Number(trimmed)
    if (!trimmed || !Number.isInteger(meterNr) || meterNr <= 0) {
      setError('יש להזין מספר מונה תקין')
      return
    }
    setError(null)
    setEntries(null)
    setMode('meter')
    setViewedMeterNr(meterNr)
    fetchHistoryByMeter(meterNr)
      .then((result) => setEntries(result))
      .catch(() => setError('Failed to load history'))
  }

  function handleMeterQueryKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      searchByMeter()
    } else if (e.key === 'Escape') {
      setShowMeterSearch(false)
      setMeterQuery('')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="flex max-h-[90vh] w-[97vw] max-w-[1700px] flex-col border border-slate-500 bg-[#EFEDE6] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-yellow-400 px-4 py-2">
          <div className="flex items-center gap-3">
            <h2 className="text-[19px] font-bold text-slate-800">
              {mode === 'taxi' ? `הסטוריה — מונית ${taxiNr}` : `הסטוריה — מונה ${viewedMeterNr}`}
            </h2>

            {mode === 'taxi' && !showMeterSearch && (
              <button
                type="button"
                onClick={() => setShowMeterSearch(true)}
                className="text-base text-sky-700 underline hover:text-sky-900"
              >
                חיפוש לפי מספר מונה
              </button>
            )}

            {mode === 'taxi' && showMeterSearch && (
              <label className="flex items-center gap-1.5 text-base text-slate-800">
                <span className="whitespace-nowrap">מס' מונה:</span>
                <input
                  type="text"
                  value={meterQuery}
                  onChange={(e) => setMeterQuery(e.target.value)}
                  onKeyDown={handleMeterQueryKeyDown}
                  autoFocus
                  className="h-7 w-24 border border-sky-500 bg-white px-1.5 text-base text-slate-900 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                />
                <button type="button" onClick={searchByMeter} className="win-button px-2 py-0.5 text-base">
                  חפש
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMeterSearch(false)
                    setMeterQuery('')
                  }}
                  className="text-base text-slate-500 underline hover:text-slate-700"
                >
                  ביטול
                </button>
              </label>
            )}

            {mode === 'meter' && (
              <button
                type="button"
                onClick={backToTaxi}
                className="text-base text-sky-700 underline hover:text-sky-900"
              >
                חזרה להסטוריית מונית {taxiNr}
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} className="win-button px-2 py-0.5 text-base">
            סגור
          </button>
        </div>

        <div className="overflow-auto p-3">
          {error && <div className="border border-red-300 bg-red-50 px-3 py-1.5 text-lg text-red-700">{error}</div>}
          {!error && entries === null && <div className="p-4 text-center text-lg text-slate-500">טוען...</div>}
          {!error && entries !== null && entries.length === 0 && (
            <div className="p-4 text-center text-lg text-slate-500">
              {mode === 'taxi' ? 'אין רשומות הסטוריה למונית זו' : 'אין רשומות הסטוריה למונה זה'}
            </div>
          )}
          {!error && entries !== null && entries.length > 0 && (
            <table className="w-full border-collapse text-base">
              <thead>
                <tr className="border-b border-slate-400 bg-[#DCDAD3] text-right">
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">תאריך</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">שעה</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">פעולה</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">שם</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">מס' מסמך</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">מס' מונה</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">מס' רישוי</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">תוקף</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">אזור</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">מונית קודמת</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">ביטוח</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">חשבון ששילם</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">סכום ששולם</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold">סכום שהתקבל</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const hasDoc =
                    entry.InvoiceNr != null && entry.InvoiceNr !== 0 && entry.InvType != null && entry.TaxiNr != null
                  const rawInvNr = hasDoc ? entry.InvType! * 1_000_000 + entry.InvoiceNr! : null
                  return (
                    <tr
                      key={entry.TransNr}
                      className={`border-b border-slate-300 odd:bg-white even:bg-[#F5F4EF] ${
                        hasDoc ? 'cursor-pointer hover:bg-sky-50' : ''
                      }`}
                      onClick={hasDoc ? () => setOpenDoc({ taxiNr: entry.TaxiNr!, invNr: rawInvNr! }) : undefined}
                      title={hasDoc ? 'לחץ להצגת המסמך' : undefined}
                    >
                      <td className="px-2 py-1 whitespace-nowrap">{formatDate(entry.Date)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{formatTime(entry.Time)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {entry.ActionLabel || (entry.Status !== null ? `#${entry.Status}` : '')}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{entry.Name ?? ''}</td>
                      <td className={`px-2 py-1 whitespace-nowrap ${hasDoc ? 'text-sky-700 underline' : ''}`}>
                        {entry.InvoiceNr ?? ''}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{entry.MeterNr ?? ''}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{entry.CarNr ?? ''}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{formatMonthYear(entry.ExpDate)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {entry.AreaLabel || (entry.Area !== null ? `#${entry.Area}` : '')}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {entry.OldTaxiNr != null && entry.OldTaxiNr !== 0 ? entry.OldTaxiNr : ''}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {entry.Insurance === null ? '' : entry.Insurance ? 'כן' : 'לא'}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {entry.AccPaid != null && entry.AccPaid !== 0 ? entry.AccPaid : ''}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{entry.AmountPaid ?? ''}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{entry.AmountGet ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {openDoc !== null && (
        <InvoiceDetailPopup taxiNr={openDoc.taxiNr} invNr={openDoc.invNr} onClose={() => setOpenDoc(null)} />
      )}
    </div>
  )
}

/**
 * Thin wrapper around InvoiceModal that jumps straight to a specific
 * invoice's detail view instead of the issue/copy menu — used when opening a
 * document from a History row.
 */
function InvoiceDetailPopup({ taxiNr, invNr, onClose }: { taxiNr: number; invNr: number; onClose: () => void }) {
  return <InvoiceModal taxiNr={taxiNr} mode="copy" initialInvNr={invNr} onClose={onClose} />
}
