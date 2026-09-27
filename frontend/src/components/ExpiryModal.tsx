import { useState } from 'react'
import { reduceExpiry, transferExpiry } from '../api/meterActions'
import { getStoredBranchArea } from '../api/branch'
import { formatMonthYear } from '../utils/format'

/**
 * Web equivalent of "תוקף" (cmdExpDate_Click -> frmChangeExp.frm) in
 * Account.frm — two mutually-exclusive ways to manually adjust a meter's
 * remaining service-credit months: reduce this taxi's own expiry (self-
 * correction), or transfer months from this taxi to another taxi's meter.
 * See backend routers/meter_actions.py's reduce_expiry()/transfer_expiry()
 * for the full port notes, including the deliberately-skipped password gate
 * (this app has no auth system yet, same as every other password gate here).
 */
export default function ExpiryModal({ taxiNr, onClose }: { taxiNr: number; onClose: () => void }) {
  const [mode, setMode] = useState<'reduce' | 'transfer'>('reduce')
  const [months, setMonths] = useState('')
  const [targetTaxiNr, setTargetTaxiNr] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    const n = Number(months)
    if (!months.trim() || !Number.isInteger(n) || n <= 0) {
      setError('יש להזין מספר חודשים חיובי')
      return
    }
    const branchArea = getStoredBranchArea()
    if (branchArea === null) {
      setError('לא הוגדר סניף למחשב זה')
      return
    }

    setSaving(true)
    try {
      if (mode === 'reduce') {
        const result = await reduceExpiry(taxiNr, n, branchArea)
        setDone(`התוקף עודכן. תוקף חדש: ${formatMonthYear(result.expDate)}`)
      } else {
        const target = Number(targetTaxiNr)
        if (!targetTaxiNr.trim() || !Number.isInteger(target) || target <= 0) {
          setError('יש להזין מספר מונית יעד')
          setSaving(false)
          return
        }
        const result = await transferExpiry(taxiNr, n, target, branchArea)
        setDone(
          `הועברו ${n} חודשים למונית ${result.targetTaxiNr}. ` +
            `תוקף מונית זו: ${formatMonthYear(result.sourceExpDate)}.`,
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        dir="rtl"
        className="flex w-[90vw] max-w-md flex-col gap-3 border border-slate-500 bg-[#EFEDE6] px-5 py-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-yellow-400 pb-2">
          <h2 className="text-[19px] font-bold text-slate-800">תוקף — מונית {taxiNr}</h2>
          <button type="button" onClick={onClose} className="win-button px-2 py-0.5 text-base">
            סגור
          </button>
        </div>

        {error && <div className="border border-red-300 bg-red-50 px-3 py-1.5 text-lg text-red-700">{error}</div>}

        {done ? (
          <>
            <div className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-lg text-emerald-800">{done}</div>
            <button type="button" onClick={onClose} className="win-button self-start">
              סגור
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-4 text-lg">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={mode === 'reduce'}
                  onChange={() => setMode('reduce')}
                  disabled={saving}
                />
                הפחתת חודשי תוקף (תיקון עצמי)
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={mode === 'transfer'}
                  onChange={() => setMode('transfer')}
                  disabled={saving}
                />
                העברת חודשים למונית אחרת
              </label>
            </div>

            <label className="block">
              <span className="block text-lg text-slate-600">מספר חודשים</span>
              <input
                type="text"
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                disabled={saving}
                className="h-7 w-28 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </label>

            {mode === 'transfer' && (
              <label className="block">
                <span className="block text-lg text-slate-600">מונית יעד</span>
                <input
                  type="text"
                  value={targetTaxiNr}
                  onChange={(e) => setTargetTaxiNr(e.target.value)}
                  disabled={saving}
                  className="h-7 w-28 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                />
              </label>
            )}

            <button type="button" onClick={() => void handleSave()} disabled={saving} className="win-button">
              {saving ? 'שומר...' : 'שמירה'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
