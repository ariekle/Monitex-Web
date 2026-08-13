import { useState } from 'react'
import {
  checkMeterAction,
  checkMeterNr,
  checkAccPaid,
  saveMeterAction,
  replaceMeter,
  resetPoolBalances,
} from '../api/meterActions'
import { getStoredBranchArea } from '../api/branch'

/**
 * Web equivalent of cmdMeters_Click ("פעולות במונה וכובע") in Account.frm.
 * Two different screens share that button in the original:
 * - TaxiNr >= 80000 (pool/admin account): just a "reset balances?" confirm.
 * - TaxiNr < 80000 (real taxi): the 13-item lstMeterActions menu, which
 *   opens frmInstall.frm for items 0-11 (4 action groups x meter/cap/both)
 *   or a separate flow for item 12 ("הכנס מספר מונה חדש").
 * See backend routers/meter_actions.py module docstring for the full port.
 */

const GROUP_VERB: Record<string, string> = { install: 'הרכבת', deposit: 'הפקדת', remove: 'הסרת', stolen: 'גניבת' }
const COVA_NOUN: Record<number, string> = { 1: 'מונה', 2: 'כובע', 3: 'מונה וכובע' }
const GROUP_ROWS: { group: string; label: string }[] = [
  { group: 'install', label: 'הרכבה' },
  { group: 'deposit', label: 'הפקדה' },
  { group: 'remove', label: 'הסרה' },
  { group: 'stolen', label: 'גניבה' },
]

// index -> (group, meterCova) — matches ACTION_DEFS in routers/meter_actions.py
const ACTION_DEFS: Record<number, { group: string; meterCova: number }> = {
  0: { group: 'deposit', meterCova: 3 },
  1: { group: 'deposit', meterCova: 1 },
  2: { group: 'deposit', meterCova: 2 },
  3: { group: 'remove', meterCova: 3 },
  4: { group: 'remove', meterCova: 1 },
  5: { group: 'remove', meterCova: 2 },
  6: { group: 'stolen', meterCova: 3 },
  7: { group: 'stolen', meterCova: 1 },
  8: { group: 'stolen', meterCova: 2 },
  9: { group: 'install', meterCova: 3 },
  10: { group: 'install', meterCova: 1 },
  11: { group: 'install', meterCova: 2 },
}

function actionIndex(group: string, meterCova: number): number {
  const entry = Object.entries(ACTION_DEFS).find(([, v]) => v.group === group && v.meterCova === meterCova)
  return entry ? Number(entry[0]) : -1
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

type View =
  | { kind: 'menu' }
  | { kind: 'confirmWarning'; action: number; label: string; warning: string; defaultName: string }
  | { kind: 'form'; action: number; label: string; defaultName: string }
  | { kind: 'replace' }
  | { kind: 'resetPool' }
  | { kind: 'done'; message: string }

export default function MeterActionsModal({
  taxiNr,
  isPoolAccount,
  onClose,
}: {
  taxiNr: number
  isPoolAccount: boolean
  onClose: () => void
}) {
  const [view, setView] = useState<View>(isPoolAccount ? { kind: 'resetPool' } : { kind: 'menu' })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        dir="rtl"
        className="flex max-h-[85vh] w-[90vw] max-w-2xl flex-col border border-slate-500 bg-[#EFEDE6] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-yellow-400 px-4 py-2">
          <h2 className="text-[22px] font-bold text-slate-800">פעולות במונה וכובע — מונית {taxiNr}</h2>
          <button type="button" onClick={onClose} className="win-button px-2 py-0.5 text-lg">
            סגור
          </button>
        </div>

        <div className="overflow-auto p-4">
          {view.kind === 'menu' && (
            <MenuView
              taxiNr={taxiNr}
              onSelect={(action, label, warning, defaultName) => {
                if (warning) {
                  setView({ kind: 'confirmWarning', action, label, warning, defaultName })
                } else {
                  setView({ kind: 'form', action, label, defaultName })
                }
              }}
              onReplace={() => setView({ kind: 'replace' })}
            />
          )}

          {view.kind === 'confirmWarning' && (
            <div>
              <div className="mb-3 border border-amber-300 bg-amber-50 px-3 py-2 text-lg text-amber-800">
                {view.warning}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setView({ kind: 'form', action: view.action, label: view.label, defaultName: view.defaultName })}
                  className="win-button"
                >
                  להמשיך
                </button>
                <button type="button" onClick={() => setView({ kind: 'menu' })} className="win-button">
                  ביטול
                </button>
              </div>
            </div>
          )}

          {view.kind === 'form' && (
            <ActionForm
              taxiNr={taxiNr}
              action={view.action}
              label={view.label}
              defaultName={view.defaultName}
              onBack={() => setView({ kind: 'menu' })}
              onDone={(msg) => setView({ kind: 'done', message: msg })}
            />
          )}

          {view.kind === 'replace' && (
            <ReplaceMeterForm
              taxiNr={taxiNr}
              onBack={() => setView({ kind: 'menu' })}
              onDone={(msg) => setView({ kind: 'done', message: msg })}
            />
          )}

          {view.kind === 'resetPool' && (
            <ResetPoolView taxiNr={taxiNr} onDone={(msg) => setView({ kind: 'done', message: msg })} />
          )}

          {view.kind === 'done' && (
            <div>
              <div className="mb-3 border border-emerald-300 bg-emerald-50 px-3 py-2 text-lg text-emerald-800">
                {view.message}
              </div>
              <button type="button" onClick={onClose} className="win-button">
                סגור
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MenuView({
  taxiNr,
  onSelect,
  onReplace,
}: {
  taxiNr: number
  onSelect: (action: number, label: string, warning: string | null, defaultName: string) => void
  onReplace: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState<number | null>(null)

  async function handleSelect(action: number, label: string) {
    setError(null)
    setChecking(action)
    try {
      const result = await checkMeterAction(taxiNr, action)
      if (!result.ok) {
        setError(result.error || 'פעולה זו אינה אפשרית')
        return
      }
      onSelect(action, result.actionLabel || label, result.warning, result.defaultName || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה')
    } finally {
      setChecking(null)
    }
  }

  return (
    <div>
      {error && <div className="mb-3 border border-red-300 bg-red-50 px-3 py-1.5 text-lg text-red-700">{error}</div>}
      <table className="mb-3 w-full border-collapse text-xl">
        <thead>
          <tr className="border-b border-slate-400 bg-[#DCDAD3] text-right">
            <th className="px-2 py-1.5">מונה וכובע</th>
            <th className="px-2 py-1.5">מונה בלבד</th>
            <th className="px-2 py-1.5">כובע בלבד</th>
          </tr>
        </thead>
        <tbody>
          {GROUP_ROWS.map(({ group, label }) => (
            <tr key={group} className="border-b border-slate-300">
              {[3, 1, 2].map((cova) => {
                const action = actionIndex(group, cova)
                const actionLabel = `דווח על ${GROUP_VERB[group]} ${COVA_NOUN[cova]}`
                return (
                  <td key={cova} className="px-2 py-1">
                    <button
                      type="button"
                      disabled={checking !== null}
                      onClick={() => void handleSelect(action, actionLabel)}
                      className="win-button w-full disabled:opacity-50"
                    >
                      {checking === action ? 'בודק...' : label}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={onReplace} className="win-button">
        הכנס מספר מונה חדש (החלפה)
      </button>
    </div>
  )
}

function ActionForm({
  taxiNr,
  action,
  label,
  defaultName,
  onBack,
  onDone,
}: {
  taxiNr: number
  action: number
  label: string
  defaultName: string
  onBack: () => void
  onDone: (message: string) => void
}) {
  const def = ACTION_DEFS[action]
  const involvesMeter = def.meterCova === 1 || def.meterCova === 3
  const isInstall = def.group === 'install'

  const [name, setName] = useState(defaultName)
  const [actualDate, setActualDate] = useState(today())
  const [meterNr, setMeterNr] = useState('')
  const [carNr, setCarNr] = useState('')
  const [accPaid, setAccPaid] = useState('')
  const [accPaidInfo, setAccPaidInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState(false)
  const [saving, setSaving] = useState(false)

  async function checkAccPaidField() {
    const n = Number(accPaid)
    if (!accPaid.trim() || !n) {
      setAccPaidInfo(null)
      return
    }
    try {
      const result = await checkAccPaid(taxiNr, n, def.meterCova)
      if (!result.ok) {
        setError(result.error)
        setAccPaid('')
        setAccPaidInfo(null)
      } else {
        setAccPaidInfo(result.name)
        if (result.name) setName(result.name)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה')
    }
  }

  async function handleSave(confirmDisconnect = false) {
    setError(null)
    if (!name.trim()) {
      setError('אנא הכנס שם')
      return
    }
    if (isInstall && involvesMeter) {
      const n = Number(meterNr)
      if (!meterNr.trim() || !n) {
        setError('אנא הכנס מספר מונה')
        return
      }
      if (!carNr.trim() || !Number(carNr)) {
        setError("אנא הכנס מס' רישוי")
        return
      }
      // Re-check right before saving — same "recompute right before commit" pattern used elsewhere.
      if (!confirmDisconnect) {
        try {
          const check = await checkMeterNr(taxiNr, n, false)
          if (!check.ok) {
            if (check.needsConfirm) {
              setConfirmMessage(check.confirmMessage)
              setPendingConfirm(true)
              return
            }
            setError(check.error || 'שגיאה במספר מונה')
            return
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'שגיאה')
          return
        }
      }
    }

    const branchArea = getStoredBranchArea()
    if (branchArea === null) {
      setError('לא הוגדר סניף למחשב זה')
      return
    }

    setSaving(true)
    try {
      const result = await saveMeterAction(
        taxiNr,
        {
          action,
          name: name.trim(),
          actualDate,
          ...(isInstall && involvesMeter ? { meterNr: Number(meterNr), carNr: Number(carNr) } : {}),
          ...(isInstall && accPaid.trim() ? { accPaid: Number(accPaid) } : {}),
          confirmDisconnect,
        },
        branchArea,
      )
      onDone(`נשמר בהצלחה. מס' מונה: ${result.meterNr ?? '—'}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירה')
    } finally {
      setSaving(false)
      setPendingConfirm(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xl font-bold">{label}</h3>
        <button type="button" onClick={onBack} className="win-button px-2 py-0.5 text-lg">
          חזרה
        </button>
      </div>

      {error && <div className="mb-2 border border-red-300 bg-red-50 px-3 py-1.5 text-lg text-red-700">{error}</div>}

      {pendingConfirm && confirmMessage && (
        <div className="mb-3 border border-amber-300 bg-amber-50 px-3 py-2 text-lg text-amber-800">
          <div className="mb-2">{confirmMessage}</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void handleSave(true)} className="win-button">
              לשנות לפעיל
            </button>
            <button type="button" onClick={() => setPendingConfirm(false)} className="win-button">
              לא לשנות
            </button>
          </div>
        </div>
      )}

      {!pendingConfirm && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="block">
              <span className="block text-lg text-slate-600">שם</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-7 w-48 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-lg text-slate-600">תאריך</span>
              <input
                type="date"
                value={actualDate}
                onChange={(e) => setActualDate(e.target.value)}
                className="h-7 w-36 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </label>
          </div>

          {isInstall && involvesMeter && (
            <div className="flex flex-wrap items-end gap-3 border-t border-slate-300 pt-3">
              <label className="block">
                <span className="block text-lg text-slate-600">מס' מונה</span>
                <input
                  type="text"
                  value={meterNr}
                  onChange={(e) => setMeterNr(e.target.value)}
                  className="h-7 w-28 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="block text-lg text-slate-600">מס' רישוי</span>
                <input
                  type="text"
                  value={carNr}
                  onChange={(e) => setCarNr(e.target.value)}
                  className="h-7 w-28 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                />
              </label>
            </div>
          )}

          {isInstall && (
            <div className="flex flex-wrap items-end gap-3 border-t border-slate-300 pt-3">
              <label className="block">
                <span className="block text-lg text-slate-600">לקוח 80000+ (אופציונלי)</span>
                <input
                  type="text"
                  value={accPaid}
                  onChange={(e) => setAccPaid(e.target.value)}
                  onBlur={() => void checkAccPaidField()}
                  className="h-7 w-32 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                />
              </label>
              {accPaidInfo && <span className="text-lg text-slate-600">{accPaidInfo}</span>}
            </div>
          )}

          <button type="button" onClick={() => void handleSave(false)} disabled={saving} className="win-button">
            {saving ? 'שומר...' : 'שמירה'}
          </button>
        </div>
      )}
    </div>
  )
}

function ReplaceMeterForm({
  taxiNr,
  onBack,
  onDone,
}: {
  taxiNr: number
  onBack: () => void
  onDone: (message: string) => void
}) {
  const [newMeterNr, setNewMeterNr] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setError(null)
    const n = Number(newMeterNr)
    if (!newMeterNr.trim() || !n) {
      setError('אנא הכנס מספר מונה חדש')
      return
    }
    const branchArea = getStoredBranchArea()
    if (branchArea === null) {
      setError('לא הוגדר סניף למחשב זה')
      return
    }
    setSaving(true)
    try {
      const result = await replaceMeter(taxiNr, n, branchArea)
      onDone(`הוחלף בהצלחה למונה מס' ${result.meterNr}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xl font-bold">הכנס מספר מונה חדש</h3>
        <button type="button" onClick={onBack} className="win-button px-2 py-0.5 text-lg">
          חזרה
        </button>
      </div>
      {error && <div className="mb-2 border border-red-300 bg-red-50 px-3 py-1.5 text-lg text-red-700">{error}</div>}
      <label className="mb-3 block">
        <span className="block text-lg text-slate-600">מס' מונה חדש</span>
        <input
          type="text"
          value={newMeterNr}
          onChange={(e) => setNewMeterNr(e.target.value)}
          className="h-7 w-32 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
        />
      </label>
      <button type="button" onClick={() => void handleSave()} disabled={saving} className="win-button">
        {saving ? 'שומר...' : 'שמירה'}
      </button>
    </div>
  )
}

function ResetPoolView({ taxiNr, onDone }: { taxiNr: number; onDone: (message: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleReset() {
    setError(null)
    setSaving(true)
    try {
      await resetPoolBalances(taxiNr)
      onDone('יתרות המונים והכובעים אופסו')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-3">האם לאפס יתרת מונים וכובעים ללקוח זה?</div>
      {error && <div className="mb-2 border border-red-300 bg-red-50 px-3 py-1.5 text-lg text-red-700">{error}</div>}
      <button type="button" onClick={() => void handleReset()} disabled={saving} className="win-button">
        {saving ? 'מאפס...' : 'לאפס'}
      </button>
    </div>
  )
}
