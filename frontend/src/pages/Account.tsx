import { useEffect, useState, type KeyboardEvent } from 'react'
import { useStatus } from '../context/StatusContext'
import {
  fetchAccount,
  saveAccount,
  AccountNotFoundError,
  type Account,
  type AccountEditableFields,
} from '../api/account'
import { formatDate, formatMonthYear } from '../utils/format'
import HistoryModal from '../components/HistoryModal'
import InvoiceModal from '../components/InvoiceModal'
import MeterActionsModal from '../components/MeterActionsModal'

/**
 * Web equivalent of Code/Account.frm — the real Monitex main screen (see the
 * correction note at the top of WebCode/README.md; despite the old filename
 * this is NOT frmAccount, and frmMain.frm is dead code).
 *
 * Styled to resemble the original VB6 screen: light gray Win32-dialog
 * background, yellow divider rule, sunken-look text boxes, raised-look
 * buttons, taxi number as part of the field grid (not a separate search bar).
 *
 * Ported: TaxiNr lookup (AccountRec.RecordSource = "select * from Accounts
 * where TaxiNr = ...", joined with the linked Meters row for ExpDate/
 * MeterType/Insurance) and the editable-field save flow from cmdUpdate_Click /
 * cmdSave_Click / cmdCancelEdit_Click.
 *
 * Stubbed (each opened its own sub-screen in VB6, out of scope here so far):
 * History, Invoices, Copy Invoice, Returned Checks, Meter/Cap Actions, Modem,
 * Expiry. Clicking them shows a "not yet built" note instead of doing nothing
 * silently.
 *
 * Note: FamilyName/PrivatName are capped at 12/10 chars in the DB — a real
 * legacy limit, not a display bug.
 */

/**
 * Web equivalent of lblMeterStatus_Change() in Account.frm — confirmed via
 * Main.bas constants (ACTIVE=1, STOLEN=2, DEPOSIT=3, REMOVED=4) and
 * cross-checked against the identical hardcoded Select Case in
 * frmDeposit.frm. 0/null means no status set.
 */
function meterStatusLabel(status: number | null | undefined): string {
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
      return ''
  }
}

/**
 * Web equivalent of lblCovaModel_Change() in Account.frm — the cap's MODEL
 * (CovaType), distinct from its STATUS (CovaStatus, which reuses the exact
 * same 1=פעיל/2=גנוב/3=מופקד/4=מוסר codes as meterStatusLabel above — see
 * lblCovaStatus_Change()'s Select Case, byte-for-byte identical to
 * lblMeterStatus_Change()'s).
 */
function covaModelLabel(covaType: number | null | undefined): string {
  switch (covaType) {
    case 1:
      return 'מוניטקס'
    case 2:
      return 'אחר'
    default:
      return ''
  }
}

/**
 * Web equivalent of lblMeterModel_Change() in Account.frm. Confirmed this is
 * NOT derived from the stored Meters.MeterType column at all — the original
 * recomputes a local "MeterType" (0-9) purely from meterNr ranges every time
 * the label refreshes, then maps that to two display strings (model + רגיל/
 * חכם). Ported faithfully INCLUDING a confirmed source bug: the first two
 * ElseIf branches both test `meterNr <= 30000`, so the second (which would
 * set local type=1 → model "20-50"/"רגיל") is unreachable dead code — every
 * meterNr <= 30000 hits the first branch (type=0 → blank) instead. Kept as-is
 * rather than "fixed" to match what the live VB6 app actually shows.
 */
function meterModelAndType(meterNr: number | null | undefined): { model: string; type: string } {
  let t: number
  if (meterNr == null || meterNr <= 0) {
    t = 0
  } else if (meterNr <= 30000) {
    t = 0
  } else if (meterNr <= 30000) {
    // unreachable — see docstring above
    t = 1
  } else if (meterNr <= 50000) {
    t = 2
  } else if (meterNr <= 53000) {
    t = 3
  } else if (meterNr >= 60001 && meterNr <= 75000) {
    t = 9
  } else if (meterNr <= 95000) {
    t = 6
  } else if (meterNr <= 99000) {
    t = 7
  } else {
    // > 99000: no branch matches in the original either — VB6 leaves the
    // local Integer at its default 0, so this falls through to blank too.
    t = 0
  }

  switch (t) {
    case 1:
      return { model: '20-50', type: 'רגיל' }
    case 2:
      return { model: '20-60', type: 'רגיל' }
    case 3:
      return { model: '20-60', type: 'חכם' }
    case 4:
      return { model: '20-70', type: 'רגיל' }
    case 5:
      return { model: '20-70', type: 'חכם' }
    case 6:
      return { model: '20-80', type: 'רגיל' }
    case 7:
      return { model: '20-80', type: 'חכם' }
    case 8:
      return { model: '20-90', type: 'חכם' }
    case 9:
      return { model: 'MX-10', type: 'חכם' }
    default:
      return { model: '', type: '' }
  }
}

function toEditableFields(account: Account): AccountEditableFields {
  return {
    FamilyName: account.FamilyName ?? '',
    PrivatName: account.PrivatName ?? '',
    Station: account.Station ?? '',
    Street: account.Street ?? '',
    HomeNr: account.HomeNr ?? '',
    Town: account.Town ?? '',
    ZipCode: account.ZipCode,
    TelHome: account.TelHome ?? '',
    TelWork: account.TelWork ?? '',
    TelCell: account.TelCell ?? '',
    CarNr: account.CarNr,
    Msg: account.Msg ?? '',
  }
}

/** Sunken-look read-only box — approximates the greyed-out Locked=True TextBox in the original. */
function DisplayField({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <label className={`flex items-center gap-1.5 text-[19px] text-slate-800 ${className}`}>
      <span className="whitespace-nowrap">{label}:</span>
      <input
        type="text"
        value={value}
        readOnly
        className="h-6 w-full border border-slate-400 bg-[#ECE9E4] px-1.5 text-slate-700 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
      />
    </label>
  )
}

function EditField({
  label,
  value,
  editable,
  onChange,
  className = '',
  maxLength,
}: {
  label: string
  value: string
  editable: boolean
  onChange: (v: string) => void
  className?: string
  /** Matches the real Accounts column width — see AccountUpdate in backend schemas.py. Blocks typing past it so a save can't fail with a truncation error. */
  maxLength?: number
}) {
  return (
    <label className={`flex items-center gap-1.5 text-[19px] text-slate-800 ${className}`}>
      <span className="whitespace-nowrap">{label}:</span>
      <input
        type="text"
        value={value}
        readOnly={!editable}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className={`h-6 w-full border px-1.5 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none ${
          editable ? 'border-sky-500 bg-white text-slate-900' : 'border-slate-400 bg-[#ECE9E4] text-slate-700'
        }`}
      />
    </label>
  )
}

/** Raised-look Win32 button. Sub-screens not built yet surface a note instead of doing nothing. */
function StubButton({ label, onStub }: { label: string; onStub: (label: string) => void }) {
  return (
    <button type="button" onClick={() => onStub(label)} className="win-button">
      {label}
    </button>
  )
}

export default function AccountPage() {
  const { setStatus } = useStatus()

  const [taxiNrQuery, setTaxiNrQuery] = useState('')
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState<AccountEditableFields | null>(null)
  const [saving, setSaving] = useState(false)

  const [stubNote, setStubNote] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [invoiceModalMode, setInvoiceModalMode] = useState<'issue' | 'copy' | null>(null)
  const [showMeterActions, setShowMeterActions] = useState(false)

  useEffect(() => {
    setStatus(account ? `Account ${account.TaxiNr}` : 'Account')
    return () => setStatus('Ready')
  }, [account, setStatus])

  async function handleLookup(taxiNrText: string) {
    const taxiNr = Number(taxiNrText)
    if (!Number.isInteger(taxiNr) || taxiNr <= 0) {
      setError('Enter a valid taxi number')
      return
    }
    setLoading(true)
    setError(null)
    setEditMode(false)
    setStubNote(null)
    try {
      const result = await fetchAccount(taxiNr)
      setAccount(result)
    } catch (e) {
      setAccount(null)
      setError(e instanceof AccountNotFoundError ? `No account for taxi ${taxiNr}` : 'Failed to load account')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Re-fetches the currently loaded account without disturbing the
   * loading/error UI — used after closing a sub-screen (meter/cap actions)
   * that may have changed fields shown on this screen (MeterStatus,
   * CovaStatus, MeterNr, MeterExpDate, Insurance, ...), so the user doesn't
   * have to manually re-look-up the taxi to see the update.
   */
  async function refreshAccount() {
    if (!account) return
    try {
      const result = await fetchAccount(account.TaxiNr)
      setAccount(result)
    } catch {
      // Keep showing the last good state — an explicit re-lookup will surface any real error.
    }
  }

  function handleTaxiNrKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleLookup(taxiNrQuery)
    }
  }

  function startEdit() {
    if (!account) return
    setDraft(toEditableFields(account))
    setEditMode(true)
    setStubNote(null)
  }

  function cancelEdit() {
    setDraft(null)
    setEditMode(false)
  }

  async function saveEdit() {
    if (!account || !draft) return
    setSaving(true)
    setError(null)
    try {
      const updated = await saveAccount(account.TaxiNr, draft)
      setAccount(updated)
      setEditMode(false)
      setDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  function updateDraftText<K extends keyof AccountEditableFields>(key: K, value: string) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }

  /** For ZipCode/CarNr — numeric columns edited via a text box, parsed back to number|null. */
  function updateDraftNumber<K extends 'ZipCode' | 'CarNr'>(key: K, value: string) {
    const parsed = value.trim() === '' ? null : Number(value)
    setDraft((d) => (d ? { ...d, [key]: Number.isNaN(parsed) ? d[key] : parsed } : d))
  }

  const editable = editMode && draft !== null

  return (
    <div dir="rtl" className="flex h-full flex-col bg-[#EFEDE6] p-4 text-right font-sans">
      {/* Title bar area, echoing the " מוניטקס" / version header of the original window */}
      <div className="mb-2 flex items-baseline justify-between border-b-2 border-yellow-400 pb-1.5">
        <h1 className="text-[22px] font-bold text-slate-800">מוניטקס</h1>
        <span className="text-lg text-slate-500">Ver 10.00</span>
      </div>

      {error && <div className="mb-2 border border-red-300 bg-red-50 px-3 py-1.5 text-xl text-red-700">{error}</div>}
      {stubNote && (
        <div className="mb-2 border border-amber-300 bg-amber-50 px-3 py-1.5 text-xl text-amber-800">
          "{stubNote}" — this sub-screen isn't built yet.
        </div>
      )}

      <div className="space-y-2.5">
        {/* Row 1: taxi nr / meter nr / expiry / insurance / meter status */}
        <div className="grid grid-cols-5 gap-3">
          <label className="flex items-center gap-2 text-[28px] font-bold text-slate-800">
            <span className="whitespace-nowrap">מס' מונית:</span>
            <input
              type="text"
              value={taxiNrQuery}
              onChange={(e) => setTaxiNrQuery(e.target.value)}
              onKeyDown={handleTaxiNrKeyDown}
              disabled={loading}
              className="h-10 w-full border border-sky-500 bg-white px-2 text-[28px] font-bold text-slate-900 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none disabled:opacity-60"
              autoFocus
            />
            {loading && <span className="text-lg font-normal text-slate-500">טוען...</span>}
          </label>
          <DisplayField label="מס' מונה" value={String(account?.MeterNr ?? '')} />
          <label className="flex items-center gap-2 text-[28px] font-bold text-slate-800">
            <span className="whitespace-nowrap">תוקף שרות:</span>
            <input
              type="text"
              value={formatMonthYear(account?.MeterExpDate ?? null)}
              readOnly
              className="h-10 w-full border border-slate-400 bg-[#ECE9E4] px-2 text-[28px] font-bold text-slate-700 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            />
          </label>
          {/* Meters.Insurance is INVERTED — confirmed via Account.frm's lblInsurance
              label logic (`If ...insurance = False Then lblInsurance = "יש" Else
              lblInsurance = "אין"`): False means the meter HAS insurance, True
              means it doesn't. Was previously shown the wrong way round here
              (Insurance=true -> "כן"); fixed to match the source exactly. */}
          <DisplayField
            label="ביטוח"
            value={account ? (account.Insurance === null ? '' : account.Insurance ? 'אין' : 'יש') : ''}
          />
          <DisplayField label="מצב מונה" value={meterStatusLabel(account?.MeterStatus)} />
        </div>

        {/* Row 2: names + cap status/model */}
        <div className="grid grid-cols-4 gap-3">
          <EditField
            label="שם משפחה"
            value={editable ? draft!.FamilyName : account?.FamilyName ?? ''}
            editable={editable}
            onChange={(v) => updateDraftText('FamilyName', v)}
            maxLength={12}
          />
          <EditField
            label="שם פרטי"
            value={editable ? draft!.PrivatName : account?.PrivatName ?? ''}
            editable={editable}
            onChange={(v) => updateDraftText('PrivatName', v)}
            maxLength={10}
          />
          <DisplayField label="מצב כובע" value={meterStatusLabel(account?.CovaStatus)} />
          <DisplayField label="דגם כובע" value={covaModelLabel(account?.CovaType)} />
        </div>

        {/* Row 3: address + meter model */}
        <div className="grid grid-cols-5 gap-3">
          <EditField
            label="רחוב"
            value={editable ? draft!.Street : account?.Street ?? ''}
            editable={editable}
            onChange={(v) => updateDraftText('Street', v)}
            maxLength={11}
          />
          <EditField
            label="מס'"
            value={editable ? draft!.HomeNr : account?.HomeNr ?? ''}
            editable={editable}
            onChange={(v) => updateDraftText('HomeNr', v)}
            maxLength={5}
          />
          <EditField
            label="עיר"
            value={editable ? draft!.Town : account?.Town ?? ''}
            editable={editable}
            onChange={(v) => updateDraftText('Town', v)}
            maxLength={12}
          />
          <EditField
            label="מיקוד"
            value={editable ? String(draft!.ZipCode ?? '') : String(account?.ZipCode ?? '')}
            editable={editable}
            onChange={(v) => updateDraftNumber('ZipCode', v)}
          />
          <DisplayField label="דגם מונה" value={meterModelAndType(account?.MeterNr).model} />
        </div>

        {/* Row 4: vehicle / phone / meter type */}
        <div className="grid grid-cols-3 gap-3">
          <EditField
            label="מס' רישוי"
            value={editable ? String(draft!.CarNr ?? '') : String(account?.CarNr ?? '')}
            editable={editable}
            onChange={(v) => updateDraftNumber('CarNr', v)}
          />
          <EditField
            label="טל. נייד"
            value={editable ? draft!.TelCell : account?.TelCell ?? ''}
            editable={editable}
            onChange={(v) => updateDraftText('TelCell', v)}
            maxLength={11}
          />
          <DisplayField label="סוג מונה" value={meterModelAndType(account?.MeterNr).type} />
        </div>

        {/* Row 5: station / area */}
        <div className="grid grid-cols-2 gap-3">
          <EditField
            label="תחנה"
            value={editable ? draft!.Station : account?.Station ?? ''}
            editable={editable}
            onChange={(v) => updateDraftText('Station', v)}
            maxLength={10}
          />
          {/* Joined from the real Areas DB lookup table (routers/account.py) —
              not hardcoded here, so the business can rename/add areas via the
              DB without a code change. */}
          <DisplayField label="אזור" value={account?.AreaLabel ?? ''} />
        </div>

        {/* Row 6: remark */}
        <div className="grid grid-cols-2 gap-3">
          <EditField
            label="הערה"
            value={editable ? draft!.Msg : account?.Msg ?? ''}
            editable={editable}
            onChange={(v) => updateDraftText('Msg', v)}
            maxLength={64}
          />
          <DisplayField label="תאריך הערה" value={formatDate(account?.RemarkDate ?? null)} />
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2.5 border-t-2 border-yellow-400 pt-2.5">
        <div className="text-lg text-slate-500">
          סניף: תל אביב &nbsp;&nbsp; {new Date().toLocaleString('he-IL')}
        </div>

        {!editMode ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!account}
              onClick={() => setShowHistory(true)}
              className="win-button disabled:opacity-50"
            >
              הסטוריה
            </button>
            <button
              type="button"
              disabled={!account}
              onClick={() => setInvoiceModalMode('issue')}
              className="win-button disabled:opacity-50"
            >
              חשבוניות
            </button>
            <button
              type="button"
              disabled={!account}
              onClick={() => setInvoiceModalMode('copy')}
              className="win-button disabled:opacity-50"
            >
              העתק חשבונית
            </button>
            <StubButton label="שקים חוזרים" onStub={setStubNote} />
            <button
              type="button"
              disabled={!account}
              onClick={() => setShowMeterActions(true)}
              className="win-button disabled:opacity-50"
            >
              פעולות במונה וכובע
            </button>
            <StubButton label="מסופון" onStub={setStubNote} />
            <button type="button" disabled={!account} onClick={startEdit} className="win-button disabled:opacity-50">
              עדכון פרטים
            </button>
            <StubButton label="תוקף" onStub={setStubNote} />
            <StubButton label="יציאה" onStub={setStubNote} />
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={saving}
              className="win-button border-emerald-600 bg-emerald-50 text-emerald-800 disabled:opacity-50"
            >
              {saving ? 'שומר...' : 'שמור'}
            </button>
            <button type="button" onClick={cancelEdit} disabled={saving} className="win-button">
              ביטול
            </button>
          </div>
        )}
      </div>

      {showHistory && account && (
        <HistoryModal taxiNr={account.TaxiNr} onClose={() => setShowHistory(false)} />
      )}

      {invoiceModalMode && account && (
        <InvoiceModal
          taxiNr={account.TaxiNr}
          mode={invoiceModalMode}
          defaultBuyerName={`${account.FamilyName ?? ''} ${account.PrivatName ?? ''}`.trim()}
          onClose={() => setInvoiceModalMode(null)}
        />
      )}

      {showMeterActions && account && (
        <MeterActionsModal
          taxiNr={account.TaxiNr}
          isPoolAccount={account.TaxiNr >= 80000}
          onClose={() => {
            setShowMeterActions(false)
            void refreshAccount()
          }}
        />
      )}
    </div>
  )
}
