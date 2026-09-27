import { Children, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useStatus } from '../context/StatusContext'
import {
  fetchAccount,
  fetchAccountByMeter,
  saveAccount,
  searchAccountsByName,
  AccountNotFoundError,
  type Account,
  type AccountEditableFields,
  type AccountSearchResult,
} from '../api/account'
import { formatDate, formatMonthYear } from '../utils/format'
import BadChecksModal from '../components/BadChecksModal'
import ExitConfirmModal from '../components/ExitConfirmModal'
import ExpiryModal from '../components/ExpiryModal'
import HistoryModal from '../components/HistoryModal'
import InvoiceModal from '../components/InvoiceModal'
import MeterActionsModal from '../components/MeterActionsModal'
import ModemActionModal from '../components/ModemActionModal'
import MsgModal from '../components/MsgModal'
import ResetModal from '../components/ResetModal'
import PastResetModal from '../components/PastResetModal'
import SendToHashModal from '../components/SendToHashModal'
import TestPrintModal from '../components/TestPrintModal'
import monitexLogo from '../assets/monitex-logo.png'
import { getStoredBranchArea, getStoredIsAccounting } from '../api/branch'

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
    <label className={`flex items-center gap-1.5 text-[16px] text-slate-800 ${className}`}>
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
    <label className={`flex items-center gap-1.5 text-[16px] text-slate-800 ${className}`}>
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

/**
 * Lays the command buttons out in one row when they fit, or splits them into
 * two evenly-sized rows (rather than however plain `flex-wrap` happens to
 * pack them, which can leave a single button stranded on its own line) when
 * they don't. Measures the buttons' natural unwrapped width against the
 * available container width to decide.
 */
function BalancedButtonRow({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [twoRows, setTwoRows] = useState(false)
  const items = Children.toArray(children)

  useEffect(() => {
    function check() {
      const container = containerRef.current
      const measure = measureRef.current
      if (!container || !measure) return
      setTwoRows(measure.scrollWidth > container.clientWidth)
    }
    check()
    window.addEventListener('resize', check)
    const ro = new ResizeObserver(check)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => {
      window.removeEventListener('resize', check)
      ro.disconnect()
    }
  }, [items.length])

  const half = Math.ceil(items.length / 2)
  const firstRow = items.slice(0, half)
  const secondRow = items.slice(half)

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Invisible, unconstrained (absolute, no-wrap) copy used only to measure the natural one-row width. */}
      <div ref={measureRef} className="invisible absolute right-0 top-0 flex flex-nowrap gap-2" aria-hidden="true">
        {items}
      </div>
      {twoRows ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap justify-center gap-2">{firstRow}</div>
          <div className="flex flex-wrap justify-center gap-2">{secondRow}</div>
        </div>
      ) : (
        <div className="flex flex-nowrap gap-2">{items}</div>
      )}
    </div>
  )
}

export default function AccountPage() {
  const { setStatus } = useStatus()

  const [taxiNrQuery, setTaxiNrQuery] = useState('')
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Web equivalent of frmMsg.Show vbModal for the "not found" case — see
  // handleLookup below and components/MsgModal.tsx.
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null)

  // Web equivalent of FindMode + the txtTaxiNr -> txtMeterNr -> txtFamilyName
  // Enter-key cascade in Account.frm's initTaxiWindow/txtMeterNr_KeyPress/
  // txtFamilyName_KeyPress: pressing Enter on a blank taxi number hands focus
  // to the meter-number box; Enter there with a value looks the account up
  // by meter, blank hands focus to a family-name search box; Enter there
  // runs a "LIKE 'name%'" search and shows a picklist (Names_DblClick).
  const [findStage, setFindStage] = useState<'taxi' | 'meter' | 'name'>('taxi')
  const [meterNrQuery, setMeterNrQuery] = useState('')
  const [nameQuery, setNameQuery] = useState('')
  const [nameResults, setNameResults] = useState<AccountSearchResult[] | null>(null)
  const [nameSearching, setNameSearching] = useState(false)
  const taxiNrInputRef = useRef<HTMLInputElement>(null)
  const meterNrInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState<AccountEditableFields | null>(null)
  const [saving, setSaving] = useState(false)

  const [stubNote, setStubNote] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [invoiceModalMode, setInvoiceModalMode] = useState<'issue' | 'copy' | null>(null)
  const [showMeterActions, setShowMeterActions] = useState(false)
  const [showBadChecks, setShowBadChecks] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [showPastReset, setShowPastReset] = useState(false)
  const [showSendToHash, setShowSendToHash] = useState(false)
  // "העברה לחשבשבת" is an accounting-PC-only feature in the original (see
  // Account.frm's F11: `If Area = 0 Then frmSendtoHash.Show vbModal`). Read
  // once on mount — this workstation's area/accounting flag don't change
  // without an explicit "שנה סניף" (which reloads the whole gate) anyway.
  const [canSendToHash] = useState(() => getStoredBranchArea() === 0 && getStoredIsAccounting())
  const [showTestPrint, setShowTestPrint] = useState(false)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [showModemActions, setShowModemActions] = useState(false)
  const [showExpiry, setShowExpiry] = useState(false)

  useEffect(() => {
    setStatus(account ? `Account ${account.TaxiNr}` : 'Account')
    return () => setStatus('Ready')
  }, [account, setStatus])

  useEffect(() => {
    if (findStage === 'taxi') taxiNrInputRef.current?.focus()
    else if (findStage === 'meter') meterNrInputRef.current?.focus()
    else if (findStage === 'name') nameInputRef.current?.focus()
  }, [findStage])

  async function handleLookup(taxiNrText: string) {
    const trimmed = taxiNrText.trim()
    // Ported from initTaxiWindow's `Itaxinr = val(txtTaxiNr.Text) ... If Itaxinr = 0
    // Then Call clearAccount ... FindMode = True ... txtMeterNr.SetFocus` —
    // pressing Enter on a blank (or non-numeric) taxi number clears the
    // screen AND hands focus to the meter-number box, starting the
    // meter-nr -> family-name find-mode cascade.
    if (trimmed === '' || Number(trimmed) === 0) {
      setAccount(null)
      setError(null)
      setNotFoundMsg(null)
      setEditMode(false)
      setStubNote(null)
      setFindStage('meter')
      setMeterNrQuery('')
      setNameResults(null)
      return
    }
    const taxiNr = Number(trimmed)
    if (!Number.isInteger(taxiNr) || taxiNr <= 0) {
      setError('Enter a valid taxi number')
      return
    }
    setLoading(true)
    setError(null)
    setNotFoundMsg(null)
    setEditMode(false)
    setStubNote(null)
    try {
      const result = await fetchAccount(taxiNr)
      setAccount(result)
    } catch (e) {
      setAccount(null)
      if (e instanceof AccountNotFoundError) {
        // The original's "not found" branch (initTaxiWindow's `Else ' not
        // found/new`) actually opens frmCreateNew to offer creating a brand
        // new account for that taxi number — that flow isn't built here yet,
        // so this just shows a plain not-found popup instead.
        setNotFoundMsg('!לקוח לא נמצא')
      } else {
        setError('Failed to load account')
      }
    } finally {
      setLoading(false)
    }
  }

  /** Web equivalent of the txtMeterNr FindMode Enter-key branch. */
  async function handleMeterLookup() {
    const trimmed = meterNrQuery.trim()
    // Ported from txtMeterNr_KeyPress's else-branch: Enter on a blank/zero
    // meter number unlocks and focuses txtFamilyName instead.
    if (trimmed === '' || Number(trimmed) === 0) {
      setFindStage('name')
      setNameQuery('')
      setNameResults(null)
      return
    }
    const meterNr = Number(trimmed)
    if (!Number.isInteger(meterNr) || meterNr <= 0) {
      setError('Enter a valid meter number')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await fetchAccountByMeter(meterNr)
      setAccount(result)
      setTaxiNrQuery('')
    } catch (e) {
      setAccount(null)
      setError(e instanceof AccountNotFoundError ? e.message : 'Failed to load account by meter')
    } finally {
      // Matches the original: FindMode is cleared and focus returns to
      // txtTaxiNr regardless of whether the meter was found.
      setFindStage('taxi')
      setMeterNrQuery('')
      setLoading(false)
    }
  }

  /** Web equivalent of the txtFamilyName FindMode Enter-key branch (LIKE 'name%' search). */
  async function handleNameSearch() {
    const trimmed = nameQuery.trim()
    if (trimmed === '') {
      // The original falls through further to a CarNr search box on a
      // second blank Enter — not ported here; simplified to just returning
      // to normal taxi-nr entry.
      setFindStage('taxi')
      setNameResults(null)
      return
    }
    setNameSearching(true)
    setError(null)
    try {
      const results = await searchAccountsByName(trimmed)
      setNameResults(results)
    } catch {
      setError('Failed to search by name')
    } finally {
      setNameSearching(false)
    }
  }

  /** Web equivalent of Names_DblClick / Names_KeyPress+Enter — pick a match from the search list. */
  async function selectNameResult(taxiNr: number) {
    setFindStage('taxi')
    setNameQuery('')
    setNameResults(null)
    setLoading(true)
    setError(null)
    setTaxiNrQuery('')
    try {
      const result = await fetchAccount(taxiNr)
      setAccount(result)
    } catch {
      setAccount(null)
      setError('Failed to load account')
    } finally {
      setLoading(false)
    }
  }

  function handleMeterNrKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleMeterLookup()
    } else if (e.key === 'Escape') {
      setFindStage('taxi')
      setMeterNrQuery('')
    }
  }

  function handleNameQueryKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleNameSearch()
    } else if (e.key === 'Escape') {
      setFindStage('taxi')
      setNameQuery('')
      setNameResults(null)
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
        <div className="flex items-center gap-2">
          <img src={monitexLogo} alt="" className="h-7 w-7 object-contain" />
          <h1 className="text-[19px] font-bold text-slate-800">מוניטקס</h1>
        </div>
        <span className="text-base text-slate-500">Ver 10.00</span>
      </div>

      {error && <div className="mb-2 border border-red-300 bg-red-50 px-3 py-1.5 text-lg text-red-700">{error}</div>}
      {stubNote && (
        <div className="mb-2 border border-amber-300 bg-amber-50 px-3 py-1.5 text-lg text-amber-800">
          "{stubNote}" — this sub-screen isn't built yet.
        </div>
      )}

      <div className="space-y-2.5">
        {/* Row 1: taxi nr / meter nr / expiry / insurance / meter status.
            Unequal column widths (not a plain grid-cols-5) because "תוקף שרות:"
            plus its value ("MM/YYYY") at this row's large 28px font needs more
            room than the others or the value gets clipped. */}
        <div className="grid grid-cols-[1fr_0.85fr_1.35fr_0.75fr_0.85fr] gap-3">
          <label className="flex items-center gap-2 text-[22px] font-bold text-slate-800">
            <span className="whitespace-nowrap">מס' מונית:</span>
            <input
              ref={taxiNrInputRef}
              type="text"
              value={taxiNrQuery}
              onChange={(e) => setTaxiNrQuery(e.target.value)}
              onKeyDown={handleTaxiNrKeyDown}
              disabled={loading || findStage !== 'taxi'}
              maxLength={5}
              className="h-9 w-full border border-sky-500 bg-white px-2 text-[22px] font-bold text-slate-900 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none disabled:opacity-60"
              autoFocus
            />
            {loading && <span className="text-base font-normal text-slate-500">טוען...</span>}
          </label>
          {/* Web equivalent of txtMeterNr toggling between a bound display
              field (locked) and a search box (unlocked, FindMode=True) — see
              handleLookup/handleMeterLookup above. */}
          {findStage === 'meter' ? (
            <label className="flex items-center gap-1.5 text-[16px] text-slate-800">
              <span className="whitespace-nowrap">מס' מונה:</span>
              <input
                ref={meterNrInputRef}
                type="text"
                value={meterNrQuery}
                onChange={(e) => setMeterNrQuery(e.target.value)}
                onKeyDown={handleMeterNrKeyDown}
                placeholder="חפש לפי מס' מונה, Enter ריק ⇠ חיפוש לפי שם"
                className="h-6 w-full border border-sky-500 bg-white px-1.5 text-slate-900 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </label>
          ) : (
            <DisplayField label="מס' מונה" value={String(account?.MeterNr ?? '')} />
          )}
          <label className="flex items-center gap-2 text-[22px] font-bold text-slate-800">
            <span className="whitespace-nowrap">תוקף שרות:</span>
            <input
              type="text"
              value={formatMonthYear(account?.MeterExpDate ?? null)}
              readOnly
              className="h-9 w-full border border-slate-400 bg-[#ECE9E4] px-2 text-[22px] font-bold text-slate-700 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
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
          {findStage === 'name' ? (
            <div className="relative">
              <label className="flex items-center gap-1.5 text-[16px] text-slate-800">
                <span className="whitespace-nowrap">שם משפחה:</span>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={nameQuery}
                  onChange={(e) => setNameQuery(e.target.value)}
                  onKeyDown={handleNameQueryKeyDown}
                  placeholder="חפש לפי שם משפחה, Enter לחיפוש"
                  className="h-6 w-full border border-sky-500 bg-white px-1.5 text-slate-900 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                />
              </label>
              {nameSearching && <div className="mt-0.5 text-base text-slate-500">מחפש...</div>}
              {nameResults !== null && (
                <div className="absolute z-10 mt-0.5 max-h-56 w-full overflow-auto border border-slate-400 bg-white text-base shadow-lg">
                  {nameResults.length === 0 ? (
                    <div className="px-2 py-1.5 text-slate-500">לא נמצאו התאמות</div>
                  ) : (
                    nameResults.map((r) => (
                      <button
                        key={r.TaxiNr}
                        type="button"
                        onClick={() => void selectNameResult(r.TaxiNr)}
                        className="block w-full px-2 py-1.5 text-right hover:bg-sky-50"
                      >
                        {r.FamilyName} {r.PrivatName} — מונית {r.TaxiNr}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <EditField
              label="שם משפחה"
              value={editable ? draft!.FamilyName : account?.FamilyName ?? ''}
              editable={editable}
              onChange={(v) => updateDraftText('FamilyName', v)}
              maxLength={12}
            />
          )}
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

        {/* Row 5: station / modem / area */}
        <div className="grid grid-cols-3 gap-3">
          <EditField
            label="תחנה"
            value={editable ? draft!.Station : account?.Station ?? ''}
            editable={editable}
            onChange={(v) => updateDraftText('Station', v)}
            maxLength={10}
          />
          {/* Account.Modem reuses the same 1/2/3/4 status codes as Meter.Status
              (see routers/meter_actions.py's modem_action docstring), so the
              existing meterStatusLabel() lookup applies directly. Set via the
              מסופון button below (ModemActionModal). */}
          <DisplayField label="מסופון" value={meterStatusLabel(account?.Modem)} />
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
        <div className="text-base text-slate-500">
          סניף: תל אביב &nbsp;&nbsp; {new Date().toLocaleString('he-IL')}
        </div>

        {!editMode ? (
          <BalancedButtonRow>
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
            {/* cmdCheck in Account.frm -> frmBackCheck.Show — its own
                independent search screen (by check nr, TZ, or taxi nr), not
                scoped to whatever's currently loaded here, so — like the
                original — this button is never disabled by `!account`. */}
            <button type="button" onClick={() => setShowBadChecks(true)} className="win-button">
              שקים חוזרים
            </button>
            <button
              type="button"
              disabled={!account}
              onClick={() => setShowMeterActions(true)}
              className="win-button disabled:opacity-50"
            >
              פעולות במונה וכובע
            </button>
            {/* printTest() in Account.frm — Alt+F1/Shift+F1 in the original,
                no visible button there at all. Exposed here as a normal
                button since it's an official document (meter test
                certificate) drivers present to the licensing authority. */}
            <button
              type="button"
              disabled={!account}
              onClick={() => setShowTestPrint(true)}
              className="win-button disabled:opacity-50"
            >
              אישור בדיקת מונה
            </button>
            {/* cmdReset in Account.frm — branch-wide, NOT scoped to the
                currently-looked-up taxi (frmReset.Show vbModal doesn't touch
                txtTaxiNr at all), so unlike the other buttons here this one
                is never disabled by `!account`. */}
            <button type="button" onClick={() => setShowReset(true)} className="win-button">
              איפוס
            </button>
            {/* Ported from Account.frm's Alt+F5 shortcut (txtTaxiNr_KeyDown)
                — lookup/reprint a PAST reset by reset-nr or date+area. Also
                branch-wide, not scoped to the current taxi, like cmdReset
                above. Exposed as a visible button rather than a hidden
                keyboard shortcut, since the original's Alt+F5 had no menu
                entry point and was effectively undiscoverable. */}
            <button type="button" onClick={() => setShowPastReset(true)} className="win-button">
              חיפוש איפוס קודם
            </button>
            {/* frmSendtoHash.frm — real, compiled part of Monitex2000.vbp
                (confirmed 2026-09-27, not a dead prototype). Unlike the two
                buttons above, the original gated this to the accounting PC
                only (Account.frm's hidden F11 shortcut, `If Area = 0`) — so
                here it's only rendered when this workstation is both Area=0
                AND explicitly flagged as the accounting seat (see
                BranchAreaGate.tsx / api/branch.ts, 2026-09-27). */}
            {canSendToHash && (
              <button type="button" onClick={() => setShowSendToHash(true)} className="win-button">
                העברה לחשבשבת
              </button>
            )}
            <button
              type="button"
              disabled={!account}
              onClick={() => setShowModemActions(true)}
              className="win-button disabled:opacity-50"
            >
              מסופון
            </button>
            <button type="button" disabled={!account} onClick={startEdit} className="win-button disabled:opacity-50">
              עדכון פרטים
            </button>
            <button
              type="button"
              disabled={!account}
              onClick={() => setShowExpiry(true)}
              className="win-button disabled:opacity-50"
            >
              תוקף
            </button>
            <button type="button" onClick={() => setShowExitConfirm(true)} className="win-button">
              יציאה
            </button>
          </BalancedButtonRow>
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

      {notFoundMsg && <MsgModal message={notFoundMsg} onClose={() => setNotFoundMsg(null)} />}
      {showExitConfirm && <ExitConfirmModal onClose={() => setShowExitConfirm(false)} />}

      {showModemActions && account && (
        <ModemActionModal
          taxiNr={account.TaxiNr}
          currentModem={account.Modem}
          onClose={() => {
            setShowModemActions(false)
            void refreshAccount()
          }}
        />
      )}

      {showExpiry && account && (
        <ExpiryModal
          taxiNr={account.TaxiNr}
          onClose={() => {
            setShowExpiry(false)
            void refreshAccount()
          }}
        />
      )}

      {showHistory && account && (
        <HistoryModal taxiNr={account.TaxiNr} onClose={() => setShowHistory(false)} />
      )}

      {invoiceModalMode && account && (
        <InvoiceModal
          taxiNr={account.TaxiNr}
          mode={invoiceModalMode}
          defaultBuyerName={`${account.FamilyName ?? ''} ${account.PrivatName ?? ''}`.trim()}
          onClose={() => {
            setInvoiceModalMode(null)
            // Issuing an invoice can extend/shorten the meter's service expiry
            // and flip insurance (see routers/invoices.py's service/insurance
            // side-effects) — refresh so this screen doesn't keep showing a
            // stale ExpDate/Insurance after the modal closes. Same pattern as
            // MeterActionsModal's onClose below.
            void refreshAccount()
          }}
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

      {showReset && <ResetModal onClose={() => setShowReset(false)} />}
      {showPastReset && <PastResetModal onClose={() => setShowPastReset(false)} />}
      {canSendToHash && showSendToHash && <SendToHashModal onClose={() => setShowSendToHash(false)} />}

      {showTestPrint && account && (
        <TestPrintModal taxiNr={account.TaxiNr} onClose={() => setShowTestPrint(false)} />
      )}

      {showBadChecks && (
        <BadChecksModal defaultTaxiNr={account?.TaxiNr} onClose={() => setShowBadChecks(false)} />
      )}
    </div>
  )
}
