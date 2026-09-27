import { useState } from 'react'
import { saveModemAction } from '../api/meterActions'
import { getStoredBranchArea } from '../api/branch'

const METER_ACTIVE = 1

/** Same 1=פעיל/2=גנוב/3=מופקד/4=מוסר codes as Account.tsx's meterStatusLabel (Account.Modem reuses Meter.Status's scheme). */
function modemStatusLabel(status: number | null | undefined): string {
  switch (status) {
    case 1:
      return 'פעיל'
    case 2:
      return 'גנוב'
    case 3:
      return 'מופקד'
    case 4:
      return 'מוסר'
    default:
      return 'לא מותקן'
  }
}

/**
 * Web equivalent of cmdModem_Click -> lstModemActions in Account.frm. Only 2
 * of the menu's original 3 slots are live in the source (DEPOSIT/STOLEN are
 * dead/commented-out branches) — see backend routers/meter_actions.py's
 * modem_action() docstring. lstModemActions' exact button captions live in
 * a legacy binary .frx resource this port can't read, so the labels below
 * are freshly authored, not transcribed.
 *
 * The server enforces the real guard (can't install if already ACTIVE,
 * can't remove if not ACTIVE — modem_action() returns 409 with a Hebrew
 * message either way). Originally this modal just surfaced that 409 as a
 * red banner after the click, which reads as "the button doesn't work" if
 * the account's current state doesn't allow the option the user picked —
 * so the current status is now shown up front and the inapplicable button
 * is disabled, with the server check kept as the actual source of truth.
 */
export default function ModemActionModal({
  taxiNr,
  currentModem,
  onClose,
}: {
  taxiNr: number
  currentModem: number | null | undefined
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<0 | 1 | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [modemNow, setModemNow] = useState<number | null | undefined>(currentModem)

  const isActive = modemNow === METER_ACTIVE

  async function handleSelect(action: 0 | 1) {
    setError(null)
    const branchArea = getStoredBranchArea()
    if (branchArea === null) {
      setError('לא הוגדר סניף למחשב זה')
      return
    }
    setSaving(action)
    try {
      const result = await saveModemAction(taxiNr, action, branchArea)
      setModemNow(result.modem)
      setDone(action === 0 ? 'המסופון הותקן בהצלחה' : 'המסופון הוסר בהצלחה')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        dir="rtl"
        className="flex w-[90vw] max-w-sm flex-col gap-3 border border-slate-500 bg-[#EFEDE6] px-5 py-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-yellow-400 pb-2">
          <h2 className="text-[19px] font-bold text-slate-800">מסופון — מונית {taxiNr}</h2>
          <button type="button" onClick={onClose} className="win-button px-2 py-0.5 text-base">
            סגור
          </button>
        </div>

        <div className="text-lg text-slate-700">
          מצב נוכחי: <span className="font-semibold">{modemStatusLabel(modemNow)}</span>
        </div>

        {error && <div className="border border-red-300 bg-red-50 px-3 py-1.5 text-lg text-red-700">{error}</div>}

        {done ? (
          <div className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-lg text-emerald-800">{done}</div>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={saving !== null || isActive}
              title={isActive ? 'המסופון כבר מותקן במונית זו' : undefined}
              onClick={() => void handleSelect(0)}
              className="win-button disabled:opacity-50"
            >
              {saving === 0 ? 'שומר...' : 'דיווח על התקנת מסופון'}
            </button>
            <button
              type="button"
              disabled={saving !== null || !isActive}
              title={!isActive ? 'אין מסופון מותקן במונית זו' : undefined}
              onClick={() => void handleSelect(1)}
              className="win-button disabled:opacity-50"
            >
              {saving === 1 ? 'שומר...' : 'דיווח על הסרת מסופון'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
