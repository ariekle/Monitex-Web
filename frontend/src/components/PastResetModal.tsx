import { useEffect, useState } from 'react'
import { lookupReset, type ResetLookup } from '../api/reset'
import { fetchAreas, getStoredBranchArea, type AreaOption } from '../api/branch'
import { isPrintBridgeAvailable, resetPastPrintUrl } from '../api/printBridge'

/**
 * Web equivalent of Account.frm's Alt+F5 shortcut (txtTaxiNr_KeyDown,
 * ~line 3426 in frmReset1.frm's era of Account.frm) — the original's only
 * way to find and reprint a PAST (already-committed) reset, as opposed to
 * ResetModal.tsx which only ever closes out the CURRENT un-reset batch.
 *
 * The VB6 original does this as two sequential modal popups (a date prompt,
 * then either a reset-nr or area prompt depending on whether the date was
 * left blank) with no result grid — it expects exactly one match and just
 * opens straight into the print report. This is built as a single form
 * instead (see routers/reset.py's lookup_reset() docstring for why), but
 * the underlying search modes and query logic are unchanged:
 * - Reset number alone -> `resets where resetNr = <n>`
 * - Date + area -> `resets where resetdate = <date> and area = <n>`
 *
 * No password gate (frmPasswordEnter) for non-HQ areas — this app has no
 * auth/login system at all yet, same as every other screen (see
 * routers/reset.py's module docstring).
 */

type SearchMode = 'resetNr' | 'dateArea'

export default function PastResetModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<SearchMode>('resetNr')
  const [resetNrInput, setResetNrInput] = useState('')
  const [dateInput, setDateInput] = useState('')
  const [areaInput, setAreaInput] = useState(() => {
    const stored = getStoredBranchArea()
    return stored !== null ? String(stored) : ''
  })

  const [areas, setAreas] = useState<AreaOption[] | null>(null)
  const [result, setResult] = useState<ResetLookup | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bridgeAvailable, setBridgeAvailable] = useState(false)

  useEffect(() => {
    isPrintBridgeAvailable().then(setBridgeAvailable)
    fetchAreas()
      .then(setAreas)
      .catch(() => setAreas([])) // fall back to the plain numeric input below if this fails
  }, [])

  async function doSearch() {
    setError(null)
    setResult(null)

    if (mode === 'resetNr') {
      const n = Number(resetNrInput)
      if (!resetNrInput || !Number.isFinite(n) || n <= 0) {
        setError('הכנס מספר איפוס')
        return
      }
      setLoading(true)
      try {
        setResult(await lookupReset({ resetNr: n }))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שגיאה בחיפוש')
      } finally {
        setLoading(false)
      }
      return
    }

    if (!dateInput) {
      setError('הכנס תאריך')
      return
    }
    const area = Number(areaInput)
    if (!areaInput || !Number.isFinite(area)) {
      setError('הכנס מספר איזור')
      return
    }
    setLoading(true)
    try {
      setResult(await lookupReset({ resetDate: dateInput, branchArea: area }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בחיפוש')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        dir="rtl"
        className="flex max-h-[85vh] w-[95vw] max-w-2xl flex-col border border-slate-500 bg-[#EFEDE6] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-yellow-400 px-4 py-2">
          <h2 className="text-[22px] font-bold text-slate-800">חיפוש איפוס קודם</h2>
          <button type="button" onClick={onClose} className="win-button px-2 py-0.5 text-lg">
            סגור
          </button>
        </div>

        <div className="overflow-auto p-4">
          <div className="mb-3 flex gap-4 text-lg">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={mode === 'resetNr'}
                onChange={() => {
                  setMode('resetNr')
                  setResult(null)
                  setError(null)
                }}
              />
              לפי מספר איפוס
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={mode === 'dateArea'}
                onChange={() => {
                  setMode('dateArea')
                  setResult(null)
                  setError(null)
                }}
              />
              לפי תאריך ואיזור
            </label>
          </div>

          <div className="mb-4 flex flex-wrap items-end gap-3 border-b border-slate-300 pb-3">
            {mode === 'resetNr' ? (
              <div>
                <label className="block text-[17px] text-slate-600">מספר איפוס</label>
                <input
                  type="number"
                  value={resetNrInput}
                  onChange={(e) => setResetNrInput(e.target.value)}
                  className="h-7 w-32 border border-slate-400 bg-white px-1 text-lg shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                  autoFocus
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-[17px] text-slate-600">תאריך איפוס</label>
                  <input
                    type="date"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    className="h-7 border border-slate-400 bg-white px-1 text-lg shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-[17px] text-slate-600">איזור</label>
                  {areas && areas.length > 0 ? (
                    <select
                      value={areaInput}
                      onChange={(e) => setAreaInput(e.target.value)}
                      className="h-7 border border-slate-400 bg-white px-1 text-lg focus:outline-none"
                    >
                      <option value="" disabled>
                        בחר איזור...
                      </option>
                      {areas.map((a) => (
                        <option key={a.area} value={a.area}>
                          {(a.name ?? '').trim() || `אזור ${a.area}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    // Areas list unavailable (e.g. /api/areas failed) — fall
                    // back to the raw area number so the search still works.
                    <input
                      type="number"
                      value={areaInput}
                      onChange={(e) => setAreaInput(e.target.value)}
                      className="h-7 w-24 border border-slate-400 bg-white px-1 text-lg shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  )}
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => void doSearch()}
              disabled={loading}
              className="win-button disabled:opacity-50"
            >
              {loading ? 'מחפש...' : 'חפש'}
            </button>
          </div>

          {error && <div className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-xl text-red-700">{error}</div>}

          {result && (
            <div>
              <div className="mb-3 flex items-center justify-between border border-emerald-300 bg-emerald-50 px-3 py-2 text-xl text-emerald-800">
                <span>
                  איפוס מס' {result.resetNr} — איזור {result.area}
                  {result.resetDate ? ` — ${result.resetDate}` : ''}
                </span>
                <div className="flex gap-2">
                  {bridgeAvailable && (
                    <button
                      type="button"
                      title="הדפסת דו״ח האיפוס דרך Crystal Reports"
                      onClick={() => window.open(resetPastPrintUrl(result.area, result.resetNr), '_blank')}
                      className="win-button px-2 py-0.5 text-lg"
                    >
                      הדפס דו"ח איפוס
                    </button>
                  )}
                  {/* Regenerates movein.dat (Hashavshevת export) on demand for
                      this archived reset — see backend/app/movein_export.py's
                      module docstring for what's exact vs. flagged/inferred.
                      For comparing this app's output against the old
                      software's, on the same ResetNr. */}
                  <button
                    type="button"
                    title="הורדת movein.dat להשוואה מול התוכנה הישנה"
                    onClick={() => window.open(`/api/reset/${result.resetNr}/movein.dat`, '_blank')}
                    className="win-button px-2 py-0.5 text-lg"
                  >
                    movein.dat הורד
                  </button>
                </div>
              </div>

              <table className="mb-4 w-full border-collapse text-lg">
                <thead>
                  <tr className="border-b border-slate-400 text-right">
                    <th className="py-1">סוג מסמך</th>
                    <th className="py-1">כמות</th>
                    <th className="py-1">סה"כ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-200">
                    <td className="py-1">חש/קבלה</td>
                    <td className="py-1">{result.invRecsCount}</td>
                    <td className="py-1">{result.invRecsTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1">חשבונית</td>
                    <td className="py-1">{result.invoicesCount}</td>
                    <td className="py-1">{result.invoicesTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1">קבלה</td>
                    <td className="py-1">{result.receiptsCount}</td>
                    <td className="py-1">{result.receiptsTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1">חשבונית עסקה</td>
                    <td className="py-1">{result.iskaCount}</td>
                    <td className="py-1">{result.iskaTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1">חשבונית זיכוי</td>
                    <td className="py-1">{result.creditsCount}</td>
                    <td className="py-1">{result.creditsTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td className="py-1">סה"כ קופה (נטו)</td>
                    <td className="py-1"></td>
                    <td className="py-1">{result.totalKupa.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="py-1">מע"מ</td>
                    <td className="py-1"></td>
                    <td className="py-1">{result.totalVat.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-lg sm:grid-cols-3">
                <div>מזומן: <span className="font-bold">{result.cashTotal.toFixed(2)}</span></div>
                <div>
                  שיקים לפירעון מיידי ({result.checksCashNowCount}):{' '}
                  <span className="font-bold">{result.checksCashNowTotal.toFixed(2)}</span>
                </div>
                <div>
                  שיקים דחויים ({result.checksDelayedCount}):{' '}
                  <span className="font-bold">{result.checksDelayedTotal.toFixed(2)}</span>
                </div>
                <div>אשראי מיידי: <span className="font-bold">{result.creditImmediateTotal.toFixed(2)}</span></div>
                <div>אשראי בתשלומים: <span className="font-bold">{result.creditInstallmentsTotal.toFixed(2)}</span></div>
                <div className="font-bold">סה"כ הפקדה: {result.totalDepo.toFixed(2)}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
