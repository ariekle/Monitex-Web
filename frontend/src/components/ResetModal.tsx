import { useEffect, useState } from 'react'
import { fetchResetPreview, commitReset, type ResetPreview } from '../api/reset'
import { getStoredBranchArea } from '../api/branch'
import { isPrintBridgeAvailable, resetPastPrintUrl } from '../api/printBridge'
import { isIsraeliBankHoliday } from '../utils/israeliBankHolidays'
import ConfirmDialog from './ConfirmDialog'

/**
 * Web equivalent of cmdReset_Click / frmReset1.frm's Reset() sub in
 * Account.frm. Unlike every other button on that screen, cmdReset is NOT
 * scoped to the currently-selected taxi — it operates on the whole branch
 * (Area), summarizing every not-yet-reset (ResetNr=0) document into a
 * cash/checks/credit deposit breakdown, then stamps them all with a new
 * ResetNr. See backend routers/reset.py module docstring for exactly what's
 * ported vs. deliberately simplified (no multi-bank credit-card routing, no
 * magnetic bank export file, no per-slip check batching, no "Returned
 * Checks"/Demi-Reset admin tools, no password gate — this app has no login
 * system at all).
 */

const DEPO_BANKS = [
  { value: 0, label: 'פועלים' },
  { value: 1, label: 'איגוד' },
  { value: 2, label: 'מזרחי' },
  { value: 3, label: 'דיסקונט' },
]

/**
 * Deposit-date default — the next business day after today: skips Friday/
 * Saturday (Israeli weekend, banks closed) AND Israeli bank holidays (Rosh
 * Hashana, Yom Kippur, Sukkot I, Shmini Atzeret, Pesach I+VII, Shavuot, Yom
 * HaAtzma'ut — see utils/israeliBankHolidays.ts). Same weekend/holiday skip
 * the original's find_deposit_date()/init_credit_deposit_dates() attempted
 * (see routers/reset.py's module docstring for why that VB6 helper itself
 * wasn't ported — its holiday table only covered ~2005-2015 and was already
 * a silent no-op for any later date); this is a fresh implementation that's
 * actually correct for the current date, not a port of the dead one.
 */
function nextBusinessDay(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  while (d.getDay() === 5 || d.getDay() === 6 || isIsraeliBankHoliday(d)) {
    d.setDate(d.getDate() + 1)
  }
  return d.toISOString().slice(0, 10)
}

export default function ResetModal({ onClose }: { onClose: () => void }) {
  const [depositDate, setDepositDate] = useState(nextBusinessDay())
  const [depositBank, setDepositBank] = useState(0)
  const [preview, setPreview] = useState<ResetPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetNr, setResetNr] = useState<number | null>(null)
  const [confirmingCommit, setConfirmingCommit] = useState(false)
  // Whether the local Crystal Reports print bridge is running on this
  // branch PC — see WebCode/print-bridge/. Only offer the real
  // ActiveResetRpt printout when it's actually reachable.
  const [bridgeAvailable, setBridgeAvailable] = useState(false)

  const branchArea = getStoredBranchArea()

  useEffect(() => {
    isPrintBridgeAvailable().then(setBridgeAvailable)
  }, [])

  async function loadPreview() {
    if (branchArea === null) {
      setError('לא הוגדר סניף למחשב זה')
      return
    }
    setError(null)
    setLoading(true)
    setPreview(null)
    try {
      const p = await fetchResetPreview(branchArea, depositDate, depositBank)
      setPreview(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת סיכום איפוס')
    } finally {
      setLoading(false)
    }
  }

  async function doCommit() {
    if (branchArea === null || !preview) return
    setError(null)
    setCommitting(true)
    try {
      const result = await commitReset(branchArea, depositDate, depositBank)
      setResetNr(result.resetNr)
      setPreview(result.summary)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בביצוע איפוס')
    } finally {
      setCommitting(false)
    }
  }

  const totalDocs = preview
    ? preview.invRecsCount + preview.invoicesCount + preview.receiptsCount + preview.iskaCount + preview.creditsCount
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        dir="rtl"
        className="flex max-h-[85vh] w-[95vw] max-w-3xl flex-col border border-slate-500 bg-[#EFEDE6] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-yellow-400 px-4 py-2">
          <h2 className="text-[22px] font-bold text-slate-800">איפוס</h2>
          <button type="button" onClick={onClose} className="win-button px-2 py-0.5 text-lg">
            סגור
          </button>
        </div>

        <div className="overflow-auto p-4">
          {resetNr !== null && (
            <div className="mb-3 flex items-center justify-between border border-emerald-300 bg-emerald-50 px-3 py-2 text-xl text-emerald-800">
              <span>האיפוס בוצע בהצלחה. מספר איפוס: {resetNr}</span>
              {bridgeAvailable && branchArea !== null && (
                <button
                  type="button"
                  title="הדפסת דו״ח האיפוס דרך Crystal Reports"
                  // Uses the past-reset route (real ResetNr, Resets table)
                  // rather than the active-reset route (fixed ResetNr=0,
                  // ActiveReset table) even right after a fresh commit —
                  // both rows get identical totals written at commit time,
                  // but only the past-reset route/report has been confirmed
                  // to actually render correct values end to end (2026-08-18).
                  // See routers/reset.py's commit_reset() comment on
                  // active.ResetNr for the ActiveReset-side half of this.
                  onClick={() => window.open(resetPastPrintUrl(branchArea, resetNr), '_blank')}
                  className="win-button px-2 py-0.5 text-lg"
                >
                  הדפס דו"ח איפוס
                </button>
              )}
            </div>
          )}

          {error && <div className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-xl text-red-700">{error}</div>}

          <div className="mb-4 flex flex-wrap items-end gap-3 border-b border-slate-300 pb-3">
            <div>
              <label className="block text-[17px] text-slate-600">תאריך הפקדה</label>
              <input
                type="date"
                value={depositDate}
                onChange={(e) => {
                  setDepositDate(e.target.value)
                  setPreview(null)
                  setResetNr(null)
                }}
                disabled={resetNr !== null}
                className="h-7 border border-slate-400 bg-white px-1 text-lg shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-[17px] text-slate-600">בנק הפקדה</label>
              <select
                value={depositBank}
                onChange={(e) => {
                  setDepositBank(Number(e.target.value))
                  setPreview(null)
                  setResetNr(null)
                }}
                disabled={resetNr !== null}
                className="h-7 border border-slate-400 bg-white px-1 text-lg focus:outline-none disabled:opacity-50"
              >
                {DEPO_BANKS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void loadPreview()}
              disabled={loading || resetNr !== null}
              className="win-button disabled:opacity-50"
            >
              {loading ? 'טוען...' : 'הצג סיכום'}
            </button>
          </div>

          {preview && (
            <div>
              {preview.blocking.length > 0 && (
                <div className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-lg text-red-700">
                  <div className="mb-1 font-bold">לא ניתן לבצע איפוס — יש לתקן קודם:</div>
                  <ul className="list-inside list-disc">
                    {preview.blocking.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.blocking.length === 0 && totalDocs === 0 && (
                <div className="mb-3 border border-amber-300 bg-amber-50 px-3 py-2 text-lg text-amber-800">
                  אין מסמכים לאיפוס — כל המסמכים כבר מאופסים.
                </div>
              )}

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
                    <td className="py-1">{preview.invRecsCount}</td>
                    <td className="py-1">{preview.invRecsTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1">חשבונית</td>
                    <td className="py-1">{preview.invoicesCount}</td>
                    <td className="py-1">{preview.invoicesTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1">קבלה</td>
                    <td className="py-1">{preview.receiptsCount}</td>
                    <td className="py-1">{preview.receiptsTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1">חשבונית עסקה</td>
                    <td className="py-1">{preview.iskaCount}</td>
                    <td className="py-1">{preview.iskaTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1">חשבונית זיכוי</td>
                    <td className="py-1">{preview.creditsCount}</td>
                    <td className="py-1">{preview.creditsTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td className="py-1">סה"כ קופה (נטו)</td>
                    <td className="py-1"></td>
                    <td className="py-1">{preview.totalKupa.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="py-1">מע"מ</td>
                    <td className="py-1"></td>
                    <td className="py-1">{preview.totalVat.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-lg sm:grid-cols-3">
                <div>מזומן: <span className="font-bold">{preview.cashTotal.toFixed(2)}</span></div>
                <div>
                  שיקים לפירעון מיידי ({preview.checksCashNowCount}):{' '}
                  <span className="font-bold">{preview.checksCashNowTotal.toFixed(2)}</span>
                </div>
                <div>
                  שיקים דחויים ({preview.checksDelayedCount}):{' '}
                  <span className="font-bold">{preview.checksDelayedTotal.toFixed(2)}</span>
                </div>
                <div>אשראי מיידי: <span className="font-bold">{preview.creditImmediateTotal.toFixed(2)}</span></div>
                <div>אשראי בתשלומים: <span className="font-bold">{preview.creditInstallmentsTotal.toFixed(2)}</span></div>
                <div className="font-bold">סה"כ הפקדה: {preview.totalDepo.toFixed(2)}</div>
              </div>

              {preview.checks.length > 0 && (
                <div className="mb-4">
                  <div className="mb-1 text-lg font-bold text-slate-700">פירוט שיקים</div>
                  <table className="w-full border-collapse text-base">
                    <thead>
                      <tr className="border-b border-slate-400 text-right">
                        <th className="py-1">מס' שיק</th>
                        <th className="py-1">בנק</th>
                        <th className="py-1">סניף</th>
                        <th className="py-1">חשבון</th>
                        <th className="py-1">מונית</th>
                        <th className="py-1">תאריך פירעון</th>
                        <th className="py-1">סכום</th>
                        <th className="py-1">מיידי/דחוי</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.checks.map((c) => (
                        <tr key={c.checkNr} className="border-b border-slate-200">
                          <td className="py-1">{c.checkNr}</td>
                          <td className="py-1">{c.bankNr ?? ''}</td>
                          <td className="py-1">{c.snifNr ?? ''}</td>
                          <td className="py-1">{c.accountNr ?? ''}</td>
                          <td className="py-1">{c.taxiNr ?? ''}</td>
                          <td className="py-1">{c.dueDate ?? ''}</td>
                          <td className="py-1">{c.money.toFixed(2)}</td>
                          <td className="py-1">{c.cashNow ? 'מיידי' : 'דחוי'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.kupaBreakdown.length > 0 && (
                <div className="mb-4">
                  <div className="mb-1 text-lg font-bold text-slate-700">פירוט לפי קופה</div>
                  <table className="w-full border-collapse text-base">
                    <thead>
                      <tr className="border-b border-slate-400 text-right">
                        <th className="py-1">קוד</th>
                        <th className="py-1">שם</th>
                        <th className="py-1">כמות</th>
                        <th className="py-1">סה"כ (נטו)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.kupaBreakdown.map((k) => (
                        <tr key={k.code} className="border-b border-slate-200">
                          <td className="py-1">{k.code}</td>
                          <td className="py-1">{k.name ?? ''}</td>
                          <td className="py-1">{k.count}</td>
                          <td className="py-1">{k.total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {resetNr === null && (
                <button
                  type="button"
                  onClick={() => setConfirmingCommit(true)}
                  disabled={committing || preview.blocking.length > 0 || totalDocs === 0}
                  className="win-button border-emerald-600 bg-emerald-50 text-emerald-800 disabled:opacity-50"
                >
                  {committing ? 'מבצע איפוס...' : 'בצע איפוס'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {confirmingCommit && preview && (
        <ConfirmDialog
          message={`לבצע איפוס עבור סניף זה? סה"כ הפקדה: ${preview.totalDepo.toFixed(2)} ש"ח.`}
          onConfirm={() => {
            setConfirmingCommit(false)
            void doCommit()
          }}
          onCancel={() => setConfirmingCommit(false)}
        />
      )}
    </div>
  )
}
