import { useEffect, useState } from 'react'
import {
  fetchPriceList,
  fetchInvoices,
  fetchInvoice,
  fetchNextInvoiceNumber,
  fetchVatRate,
  markInvoicePrinted,
  fetchOpenReceipts,
  validateOpenReceipt,
  createInvoice,
  priceListFullTotal,
  priceListInstallments,
  ConfirmExtendServiceError,
  type PriceListItem,
  type InvoiceListItem,
  type InvoiceDetail,
  type PaymentMethodInput,
  type InvoiceLineInput,
  type OpenReceipt,
} from '../api/invoices'
import { getStoredBranchArea } from '../api/branch'
import { bankName } from '../utils/bankNames'
import { fetchAccount, AccountNotFoundError } from '../api/account'
import { isPrintBridgeAvailable, invoicePrintUrl } from '../api/printBridge'
import { formatDate, formatTime } from '../utils/format'

/**
 * Web equivalent of cmdInvoices_Click ("חשבוניות") / cmdInvoiceCopy_Click
 * ("העתק חשבונית") in Account.frm — both open the same 6-document-type menu
 * in the original VB6 form (lstInv / lstInvCopy), just with different intent
 * (issue new vs. view existing). See WebCode/README.md for phased scope:
 * only issuing Type 1 (חשבונית) is real; the rest of the menu is either
 * view-only (works for any type, since viewing is just a read) or stubbed.
 */

// Labels match lblLabels(1) in frmInvoice.frm exactly (`:חשבונית עיסקה` /
// `:חשבונית זיכוי`) — no תעודת משלוח item, per explicit request (not needed).
const DOC_TYPES = [
  { type: 0, label: 'חש/קבלה' },
  { type: 1, label: 'חשבונית' },
  { type: 2, label: 'קבלה' },
  { type: 3, label: 'חשבונית עסקה' },
  { type: 4, label: 'חשבונית זיכוי' },
]

// HESHBONIT_KABALA(0), HESHBONIT(1), KABALA(2), HESHBONIT_ISKA(3),
// CREDIT_NOTE(4) — see backend routers/invoices.py ISSUABLE_TYPES
const ISSUABLE_TYPES = new Set([0, 1, 2, 3, 4])
const HESHBONIT_KABALA = 0
const HESHBONIT = 1
const KABALA = 2
const HESHBONIT_ISKA = 3
const CREDIT_NOTE = 4

type View =
  | { kind: 'menu' }
  | { kind: 'create'; docType: number }
  | { kind: 'list'; type: number }
  | { kind: 'detail'; invNr: number }

interface DraftLine {
  code: string
  amount: string
  unitPrice: string // blank = let the server default from PriceList's full combined price (Price1+...+Price6), see selectCode()
  // Only used/shown when the selected item has add_service=true and the line's
  // subtotal doesn't match the item's full combined price (Price1+...+Price6) —
  // i.e. an installment payment rather than a one-shot full payment. See
  // PriceListItem docstring in api/invoices.ts.
  addMonths: string
}

function emptyLine(): DraftLine {
  return { code: '', amount: '1', unitPrice: '', addMonths: '' }
}

interface DraftPayment {
  method: 'cash' | 'check' | 'credit'
  amount: string
  /** false until the user manually edits amount — lets us keep it synced to the total by default. */
  amountTouched: boolean
  checkNr: string
  bankNr: string
  snifNr: string
  accountNr: string
  checkDate: string // DD/MM/YYYY
  cardNr: string
  cardExpDate: string // MM/YY
  creditType: 'regular' | 'credit' | 'installments'
  installments: string
}

function emptyPayment(): DraftPayment {
  return {
    method: 'cash',
    amount: '',
    amountTouched: false,
    checkNr: '',
    bankNr: '',
    snifNr: '',
    accountNr: '',
    checkDate: '',
    cardNr: '',
    cardExpDate: '',
    creditType: 'regular',
    installments: '',
  }
}

/** Digits only, capped at maxLen — matches the original's KeyPress digit-filter + MaxLength combo on these fields (see call sites for the source MaxLength value). */
function onlyDigits(raw: string, maxLen: number): string {
  return raw.replace(/\D/g, '').slice(0, maxLen)
}

/** today + N months, as DD/MM/YYYY — matches CalMoney()'s `DateAdd("m", i, date)` scheduling for auto-generated installment payments (see derivedInstallments below). */
function addMonthsDDMMYYYY(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/**
 * Web equivalent of VB6's implicit "Enter advances to the next field"
 * behavior — every txtXxx_KeyPress handler in the .frm files treats
 * vbKeyReturn as "move on", not "submit". There's no <form> wrapping this
 * modal, so a plain <input> does nothing on Enter by default; call this from
 * onKeyDown to make Enter act like Tab instead (requested 2026-08-19 for the
 * invoice line fields). Moves to the next element in normal DOM tab order,
 * not a hardcoded per-field list, so it stays correct if fields are
 * reordered/added.
 */
function focusNextField(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const focusable = Array.from(
    document.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null) // visible only
  const idx = focusable.indexOf(e.currentTarget as HTMLElement)
  if (idx >= 0 && idx + 1 < focusable.length) {
    focusable[idx + 1].focus()
  }
}

/**
 * Web equivalent of txtParit_KeyUp's F1 handler in frmInvRec.frm/frmInvoice.frm:
 * pressing F1 while focused on the item-code field opens a combo box bound to
 * the price list (code + name + price) so the user can pick instead of typing
 * a raw code. Here it's a filterable popup instead of a VB6 ComboBox.
 */
function CodePickerPopup({
  priceList,
  onSelect,
  onClose,
}: {
  priceList: PriceListItem[]
  onSelect: (code: number) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const q = filter.trim()
  const filtered = priceList.filter(
    (p) => q === '' || String(p.Code).includes(q) || (p.Name ?? '').includes(q),
  )

  return (
    <div
      className="absolute right-0 top-full z-20 mt-1 w-72 border border-slate-500 bg-white text-right shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        placeholder="חיפוש לפי קוד או שם..."
        className="w-full border-b border-slate-300 px-2 py-1 text-xl focus:outline-none"
      />
      <ul className="max-h-56 overflow-auto">
        {filtered.map((p) => (
          <li
            key={p.Code}
            className="cursor-pointer px-2 py-1 text-xl hover:bg-sky-100"
            onClick={() => onSelect(p.Code)}
          >
            {p.Code} — {p.Name ?? ''}
            {/* Full combined price (Price1+...+Price6) — what the line will actually be billed, not just its first installment. */}
            {priceListFullTotal(p) > 0 ? ` (${priceListFullTotal(p)})` : ''}
          </li>
        ))}
        {filtered.length === 0 && <li className="px-2 py-1 text-xl text-slate-500">אין תוצאות</li>}
      </ul>
    </div>
  )
}

/**
 * Web equivalent of the F1 lookup in txtRecNr_KeyUp (frmInvoice.frm): a list
 * of open (unconsumed-balance) קבלות the user can pick to link this
 * חשבונית to, instead of typing the number from memory. Not scoped to the
 * current taxi — matches the original's unscoped query.
 */
function ReceiptPickerPopup({
  receipts,
  onSelect,
  onClose,
}: {
  receipts: OpenReceipt[]
  onSelect: (receipt: OpenReceipt) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const q = filter.trim()
  const filtered = receipts.filter(
    (r) => q === '' || String(r.DisplayNr).includes(q) || (r.Name ?? '').includes(q),
  )

  return (
    <div
      className="absolute right-0 top-full z-20 mt-1 w-80 border border-slate-500 bg-white text-right shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        placeholder="חיפוש לפי מס' קבלה או שם..."
        className="w-full border-b border-slate-300 px-2 py-1 text-xl focus:outline-none"
      />
      <ul className="max-h-56 overflow-auto">
        {filtered.map((r) => (
          <li
            key={r.DisplayNr}
            className="cursor-pointer px-2 py-1 text-xl hover:bg-sky-100"
            onClick={() => onSelect(r)}
          >
            {r.DisplayNr} — {r.Name ?? ''} · יתרה {r.Remaining.toFixed(2)}
            {r.TaxiNr != null ? ` (מונית ${r.TaxiNr})` : ''}
          </li>
        ))}
        {filtered.length === 0 && <li className="px-2 py-1 text-xl text-slate-500">אין קבלות פתוחות</li>}
      </ul>
    </div>
  )
}

/**
 * Picker for the document a CREDIT_NOTE(4) is crediting — scoped to THIS
 * taxi's own creditable documents (HESHBONIT_KABALA/HESHBONIT/
 * HESHBONIT_ISKA), passing back the RAW InvNr rather than a display number
 * the caller would have to retype — see createInvoice()/routers/invoices.py
 * on why display numbers alone are ambiguous across document types.
 */
function CreditedInvoicePickerPopup({
  invoices,
  onSelect,
  onClose,
}: {
  invoices: InvoiceListItem[]
  onSelect: (invoice: InvoiceListItem) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const q = filter.trim()
  const filtered = invoices.filter(
    (i) => q === '' || String(i.DisplayNr).includes(q) || (i.Name ?? '').includes(q),
  )

  return (
    <div
      className="absolute right-0 top-full z-20 mt-1 w-80 border border-slate-500 bg-white text-right shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        placeholder="חיפוש לפי מס' חשבונית או שם..."
        className="w-full border-b border-slate-300 px-2 py-1 text-xl focus:outline-none"
      />
      <ul className="max-h-56 overflow-auto">
        {filtered.map((i) => (
          <li
            key={i.InvNr}
            className="cursor-pointer px-2 py-1 text-xl hover:bg-sky-100"
            onClick={() => onSelect(i)}
          >
            {i.DisplayNr} — {i.TypeLabel ?? ''} · {i.Name ?? ''}
            {i.GrandTotal != null ? ` (${i.GrandTotal.toFixed(2)})` : ''}
          </li>
        ))}
        {filtered.length === 0 && <li className="px-2 py-1 text-xl text-slate-500">אין חשבוניות מתאימות</li>}
      </ul>
    </div>
  )
}

export default function InvoiceModal({
  taxiNr,
  mode,
  defaultBuyerName,
  /** When set, opens straight to this invoice's detail view instead of the menu — used by HistoryModal. */
  initialInvNr,
  onClose,
}: {
  taxiNr: number
  mode: 'issue' | 'copy'
  defaultBuyerName?: string
  initialInvNr?: number
  onClose: () => void
}) {
  const [view, setView] = useState<View>(
    initialInvNr != null ? { kind: 'detail', invNr: initialInvNr } : { kind: 'menu' },
  )

  // Only anchor near the top for the actual invoice content (issuing or
  // viewing one) — the doc-type menu and the past-invoices list stay
  // vertically centered like every other modal in this app.
  const anchorTop = view.kind === 'create' || view.kind === 'detail'

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/40 ${anchorTop ? 'items-start pt-[2vh]' : 'items-center'}`}
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="flex max-h-[96vh] w-[95vw] max-w-5xl flex-col border border-slate-500 bg-[#EFEDE6] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-yellow-400 px-4 py-2">
          <h2 className="text-[22px] font-bold text-slate-800">
            {mode === 'issue' ? 'חשבוניות' : 'העתק חשבונית'} — מונית {taxiNr}
          </h2>
          <button type="button" onClick={onClose} className="win-button px-2 py-0.5 text-lg">
            סגור
          </button>
        </div>

        <div className="overflow-auto p-4">
          {view.kind === 'menu' && (
            <MenuView
              mode={mode}
              onSelect={(type) => {
                if (mode === 'issue') {
                  if (ISSUABLE_TYPES.has(type)) {
                    setView({ kind: 'create', docType: type })
                  }
                  // non-issuable types: MenuView itself shows the stub note, no transition
                } else {
                  setView({ kind: 'list', type })
                }
              }}
            />
          )}

          {view.kind === 'create' && (
            <CreateInvoiceView
              taxiNr={taxiNr}
              docType={view.docType}
              defaultBuyerName={defaultBuyerName}
              onBack={() => setView({ kind: 'menu' })}
              onCreated={(invNr) => setView({ kind: 'detail', invNr })}
            />
          )}

          {view.kind === 'list' && (
            <ListView
              taxiNr={taxiNr}
              type={view.type}
              onBack={() => setView({ kind: 'menu' })}
              onSelect={(invNr) => setView({ kind: 'detail', invNr })}
            />
          )}

          {view.kind === 'detail' && (
            <DetailView
              taxiNr={taxiNr}
              invNr={view.invNr}
              onBack={() => setView({ kind: mode === 'issue' ? 'menu' : 'menu' })}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function MenuView({ mode, onSelect }: { mode: 'issue' | 'copy'; onSelect: (type: number) => void }) {
  const [stubType, setStubType] = useState<number | null>(null)

  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {DOC_TYPES.map(({ type, label }) => (
          <button
            key={type}
            type="button"
            className="win-button"
            onClick={() => {
              if (mode === 'issue' && !ISSUABLE_TYPES.has(type)) {
                setStubType(type)
              } else {
                setStubType(null)
                onSelect(type)
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {stubType !== null && (
        <div className="border border-amber-300 bg-amber-50 px-3 py-1.5 text-xl text-amber-800">
          הנפקת "{DOC_TYPES.find((d) => d.type === stubType)?.label}" עדיין לא נבנתה.
        </div>
      )}
    </div>
  )
}

function CreateInvoiceView({
  taxiNr,
  docType,
  defaultBuyerName,
  onBack,
  onCreated,
}: {
  taxiNr: number
  docType: number
  defaultBuyerName?: string
  onBack: () => void
  onCreated: (invNr: number) => void
}) {
  const [priceList, setPriceList] = useState<PriceListItem[]>([])
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])
  const [codePickerIndex, setCodePickerIndex] = useState<number | null>(null)
  const [payments, setPayments] = useState<DraftPayment[]>(
    docType === HESHBONIT_KABALA || docType === KABALA ? [emptyPayment()] : [],
  )
  // True while the payments array is still fully auto-derived (either the
  // single-payment-synced-to-total case below, or the multi-installment
  // case) — set to false the moment the user manually touches any payment
  // field, add/remove button, etc., so we never fight their edits. See the
  // useEffect below and the derivedInstallments computation.
  const [installmentsAutoManaged, setInstallmentsAutoManaged] = useState(true)
  const [buyerName, setBuyerName] = useState(defaultBuyerName ?? '')
  const [buyerTz, setBuyerTz] = useState('')
  const [nextNumber, setNextNumber] = useState<number | null>(null)
  const [vatRate, setVatRate] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Receipt-nr linking (txtRecNr in frmInvoice.frm) — required for HESHBONIT.
  const [recNrInput, setRecNrInput] = useState('')
  const [recNrValidated, setRecNrValidated] = useState<OpenReceipt | null>(null)
  const [recNrError, setRecNrError] = useState<string | null>(null)
  const [recNrChecking, setRecNrChecking] = useState(false)
  const [receiptPickerOpen, setReceiptPickerOpen] = useState(false)
  const [openReceipts, setOpenReceipts] = useState<OpenReceipt[]>([])
  // Set when the server needs the "customer's service is still valid — extend
  // anyway?" decision (CONFIRM_EXTEND_SERVICE) — see handleSubmit/submitInvoice.
  const [extendServiceConfirm, setExtendServiceConfirm] = useState<string | null>(null)
  const [pendingSubmit, setPendingSubmit] = useState<{
    invoiceLines: InvoiceLineInput[]
    invoicePayments: PaymentMethodInput[]
    buyer: { name?: string; tz?: number } | undefined
    recNr: number | undefined
    paidByTaxiNr?: number
    creditedInvNr?: number
  } | null>(null)
  // Paid-by-account linking (txtPaidbyNr in frmInvoice.frm) — required for HESHBONIT_ISKA.
  const [paidByTaxiNrInput, setPaidByTaxiNrInput] = useState('')
  const [paidByName, setPaidByName] = useState<string | null>(null)
  const [paidByError, setPaidByError] = useState<string | null>(null)
  const [paidByChecking, setPaidByChecking] = useState(false)
  // Credited-document linking (txtRecNrCred in frmInvoice.frm) — required for CREDIT_NOTE.
  const [creditedInvoice, setCreditedInvoice] = useState<InvoiceListItem | null>(null)
  const [creditedPickerOpen, setCreditedPickerOpen] = useState(false)
  const [creditableInvoices, setCreditableInvoices] = useState<InvoiceListItem[]>([])
  const needsPayment = docType === HESHBONIT_KABALA || docType === KABALA
  const needsBuyerDetails = docType === HESHBONIT_KABALA || docType === KABALA
  const needsRecNr = docType === HESHBONIT
  const needsPaidBy = docType === HESHBONIT_ISKA
  const needsCreditedInvoice = docType === CREDIT_NOTE
  // Standalone קבלה (frmRec.frm) has no line items at all — only 6 payment
  // slots. See routers/invoices.py NO_LINE_ITEM_TYPES / module docstring.
  const hasLineItems = docType !== KABALA
  // Matches txtParit(0).SetFocus being unreachable in frmInvRec.frm until
  // txtName/txtTZ are filled — here the user can't even add a code before ת.ז.
  const productsLocked = needsBuyerDetails && buyerTz.trim() === ''
  const docLabel = DOC_TYPES.find((d) => d.type === docType)?.label ?? ''

  useEffect(() => {
    // Branch (not taxi) Area drives Eilat pricing — see fetchPriceList()/routers/invoices.py.
    const branchArea = getStoredBranchArea()
    if (branchArea === null) {
      setError('לא הוגדר סניף למחשב זה')
      return
    }
    fetchPriceList(branchArea)
      .then(setPriceList)
      .catch(() => setError('Failed to load price list'))
    fetchVatRate()
      .then(setVatRate)
      .catch(() => setVatRate(0))
  }, [])

  useEffect(() => {
    refreshNextNumber()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType])

  function refreshNextNumber() {
    fetchNextInvoiceNumber(docType)
      .then((n) => setNextNumber(n.DisplayNr))
      .catch(() => setNextNumber(null))
  }

  // Ported from checkRecNr() in frmInvoice.frm — called on Enter/blur after
  // typing a receipt number by hand, same as the original.
  async function checkRecNrInput() {
    const n = Number(recNrInput)
    if (!recNrInput.trim() || !n) {
      setRecNrValidated(null)
      setRecNrError(null)
      return
    }
    setRecNrChecking(true)
    setRecNrError(null)
    try {
      const receipt = await validateOpenReceipt(n)
      setRecNrValidated(receipt)
    } catch (e) {
      setRecNrValidated(null)
      setRecNrError(e instanceof Error ? e.message : 'שגיאה באימות מס\' קבלה')
    } finally {
      setRecNrChecking(false)
    }
  }

  function openReceiptPicker() {
    setReceiptPickerOpen(true)
    fetchOpenReceipts()
      .then(setOpenReceipts)
      .catch(() => setOpenReceipts([]))
  }

  function selectReceipt(receipt: OpenReceipt) {
    setRecNrInput(String(receipt.DisplayNr))
    setRecNrValidated(receipt)
    setRecNrError(null)
    setReceiptPickerOpen(false)
  }

  // Ported from txtPaidbyNr_KeyPress in frmInvoice.frm — looks up the
  // paying account and shows its resolved name, PrivatName-then-FamilyName
  // (matches namePaid's order — NOT the FamilyName-then-PrivatName order
  // used for the invoice's own display Name elsewhere; a genuine
  // inconsistency in the original, reproduced faithfully here).
  async function checkPaidByInput() {
    const n = Number(paidByTaxiNrInput)
    if (!paidByTaxiNrInput.trim() || !n) {
      setPaidByName(null)
      setPaidByError(null)
      return
    }
    setPaidByChecking(true)
    setPaidByError(null)
    try {
      const account = await fetchAccount(n)
      setPaidByName(`${account.PrivatName ?? ''} ${account.FamilyName ?? ''}`.trim())
    } catch (e) {
      setPaidByName(null)
      setPaidByError(e instanceof AccountNotFoundError ? `!!!לקוח לא נמצא ${n}` : 'שגיאה באיתור לקוח')
    } finally {
      setPaidByChecking(false)
    }
  }

  // Ported from txtRecNrCred in frmInvoice.frm — the picker fetches this
  // taxi's own invoices and filters client-side to the types the server
  // will actually accept as creditable (see credited_invoice validation in
  // routers/invoices.py's create_invoice()).
  function openCreditedPicker() {
    setCreditedPickerOpen(true)
    fetchInvoices(taxiNr)
      .then((all) =>
        setCreditableInvoices(
          all.filter(
            (i) =>
              !i.Deleted &&
              (i.Type === HESHBONIT_KABALA || i.Type === HESHBONIT || i.Type === HESHBONIT_ISKA),
          ),
        ),
      )
      .catch(() => setCreditableInvoices([]))
  }

  function selectCreditedInvoice(invoice: InvoiceListItem) {
    setCreditedInvoice(invoice)
    setCreditedPickerOpen(false)
  }

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function addLine() {
    if (lines.length >= 6) return
    setLines((prev) => [...prev, emptyLine()])
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index))
  }

  function priceFor(codeStr: string): PriceListItem | undefined {
    const code = Number(codeStr)
    return priceList.find((p) => p.Code === code)
  }

  /**
   * Sets the code and fills the line's price in from the new item's price
   * list entry, as an editable value the user can then override. Always
   * overwrites — not just when blank — because a price left over from
   * whatever item was previously picked on this line is never the price the
   * user wants for a different item; keeping it silently produced invoices
   * billed at the wrong product's price whenever a line's item was changed
   * after its price had already been auto-filled once (reported 2026-08-19).
   *
   * Fills in the FULL combined price (sum of Price1..Price6), not just
   * Price1 — confirmed against ActivateLine() in frmInvRec.frm, which sets
   * both txtUnitPrice and txtSubTotal to `(Price1+...+Price6) * amount`.
   * The individual PriceN values only matter for splitting the *payment
   * schedule* (see priceListInstallments()/derivedInstallments in this
   * file) — the invoice line itself is always billed for the item's full
   * price (reported 2026-08-19).
   */
  function selectCode(index: number, code: number) {
    const item = priceList.find((p) => p.Code === code)
    const fullPrice = item ? priceListFullTotal(item) : null
    setLines((prev) =>
      prev.map((l, i) =>
        i === index
          ? {
              ...l,
              code: String(code),
              unitPrice: fullPrice != null ? String(fullPrice) : '',
            }
          : l,
      ),
    )
  }

  function lineTotal(line: DraftLine): number {
    const amount = Number(line.amount) || 0
    const item = priceFor(line.code)
    const unitPrice = line.unitPrice.trim() !== '' ? Number(line.unitPrice) : item ? priceListFullTotal(item) : 0
    return amount * unitPrice
  }

  /**
   * True when this line needs a manually-entered month count — its item has
   * add_service=true (extends the meter's service expiry) but the line's
   * subtotal doesn't match the item's full combined price, meaning it's an
   * installment payment rather than a one-shot full payment (which would
   * auto-add 12 months). See createInvoice()/InvoiceLineIn.AddMonths.
   */
  function needsAddMonths(line: DraftLine): boolean {
    const item = priceFor(line.code)
    if (!item?.add_service) return false
    const full = priceListFullTotal(item)
    return Math.abs(lineTotal(line) - full) >= 0.005
  }

  function updatePayment(index: number, patch: Partial<DraftPayment>) {
    setInstallmentsAutoManaged(false)
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  /**
   * Once the first check-method payment's account/bank/branch/check-number
   * is filled in, copies account/bank/branch verbatim and the check number
   * incremented by 1 per row into the other check-method payments — a
   * scheduled series of post-dated checks (the auto-generated installment
   * payments, see derivedInstallments above) is drawn from the same
   * checkbook, so re-typing the same account/bank/branch and manually
   * incrementing the check number for every row would be pure busywork
   * (requested 2026-08-19). Wired to onBlur (not onChange) on those four
   * fields so it copies the finished value rather than one half-typed
   * character at a time; a no-op unless `index` is the first check row.
   * Always overwrites the other rows (not just blank ones), so correcting
   * the first check's details afterward re-syncs everywhere.
   */
  function cascadeCheckDetailsFromFirst(index: number) {
    setPayments((prev) => {
      const checkIndexes = prev.reduce<number[]>((acc, p, i) => (p.method === 'check' ? [...acc, i] : acc), [])
      if (checkIndexes[0] !== index) return prev
      const source = prev[index]
      const baseCheckNr = source.checkNr.trim() !== '' ? Number(source.checkNr) : null
      return prev.map((p, i) => {
        if (i === index || p.method !== 'check') return p
        const ordinal = checkIndexes.indexOf(i) // position among check rows; first check row is ordinal 0
        return {
          ...p,
          bankNr: source.bankNr,
          snifNr: source.snifNr,
          accountNr: source.accountNr,
          checkNr: baseCheckNr != null && Number.isFinite(baseCheckNr) ? String(baseCheckNr + ordinal) : p.checkNr,
        }
      })
    })
  }

  function addPayment() {
    if (payments.length >= 6) return
    setInstallmentsAutoManaged(false)
    setPayments((prev) => [...prev, emptyPayment()])
  }

  function removePayment(index: number) {
    setInstallmentsAutoManaged(false)
    setPayments((prev) => prev.filter((_, i) => i !== index))
  }

  // PriceList prices are VAT-INCLUSIVE (see PriceListItem docstring in
  // models.py) — previewTotal is already the gross/payable amount. VAT is
  // extracted out of it, not added on top, matching totalInvoice() in
  // frmInvRec.frm: net = gross*100/(100+VAT), VAT amount = gross - net.
  // Standalone קבלה has no line items and no VAT of its own (frmRec.frm) —
  // its total is simply whatever the payments add up to.
  const paidSoFar = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const previewTotal = hasLineItems ? lines.reduce((sum, l) => sum + lineTotal(l), 0) : paidSoFar
  const previewNetTotal = vatRate ? (previewTotal * 100) / (100 + vatRate) : previewTotal
  const previewVatAmount = previewTotal - previewNetTotal
  const remainingBalance = previewTotal - paidSoFar

  // Per-payment-slot sums (index 0 = due now, 1 = due in a month, ...) across
  // every line whose item has more than one non-zero PriceN column — each
  // slot's amount is that PriceN itself (times the line's quantity), NOT an
  // equal split of the line's total (confirmed 2026-08-19; see
  // priceListInstallments()'s docstring). Lines are summed slot-by-slot so
  // two installment items on the same invoice combine into one payment per
  // due date, matching CalMoney() in frmInvRec.frm. null when no line needs
  // more than one payment, in which case the single-payment sync below
  // applies instead.
  const derivedInstallments = (() => {
    const sums = [0, 0, 0, 0, 0, 0]
    let maxCount = 0
    for (const l of lines) {
      if (l.code.trim() === '') continue
      const item = priceFor(l.code)
      if (!item) continue
      const perPayment = priceListInstallments(item)
      if (perPayment.length <= 1) continue
      const qty = Number(l.amount) || 0
      perPayment.forEach((price, i) => {
        sums[i] += price * qty
      })
      maxCount = Math.max(maxCount, perPayment.length)
    }
    return maxCount > 1 ? sums.slice(0, maxCount) : null
  })()

  // Keeps the payments array auto-derived from the lines — either as a
  // single payment synced to the invoice total (the common case), or, once
  // an installment-priced item is on the invoice, as one payment per
  // derivedInstallments slot (the web equivalent of CalMoney()/
  // ActivateLine() auto-splitting a multi-price item's charge into several
  // scheduled payments rather than one lump sum). Stops the moment the user
  // touches any payment field/button (installmentsAutoManaged becomes
  // false) so it never fights a manual edit. Only meaningful when there are
  // line items to derive from; for a standalone קבלה the payment amount
  // itself IS the total, so nothing to sync. Also does nothing when the
  // doc type started with zero payment rows (plain חשבונית, not
  // חשבונית-קבלה/קבלה) — those types don't collect payment at all when the
  // invoice is created, so this must never invent a payment row out of
  // thin air just because an installment item was added to the lines.
  useEffect(() => {
    if (!hasLineItems || !installmentsAutoManaged || payments.length === 0) return
    const desired: DraftPayment[] = derivedInstallments
      ? derivedInstallments.map((amt, i) => ({
          ...emptyPayment(),
          // Defaults each row to a post-dated check due that month — the
          // realistic real-world mechanism for a scheduled future payment.
          // The source's own default payment-type marker is unreadable in
          // the mangled-encoding .frm file, so this is a judgment call;
          // every field here (method, date, amount) is freely editable.
          method: 'check',
          amount: amt > 0 ? amt.toFixed(2) : '',
          checkDate: addMonthsDDMMYYYY(i),
        }))
      : [{ ...emptyPayment(), amount: previewTotal > 0 ? previewTotal.toFixed(2) : '' }]

    const changed =
      desired.length !== payments.length ||
      desired.some(
        (p, i) => p.amount !== payments[i]?.amount || p.checkDate !== payments[i]?.checkDate || p.method !== payments[i]?.method,
      )
    if (changed) setPayments(desired)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedInstallments, previewTotal, hasLineItems, installmentsAutoManaged])

  async function handleSubmit() {
    setError(null)
    setExtendServiceConfirm(null)
    // Standalone קבלה has no line items at all (frmRec.frm) — nothing to validate here.
    const validLines = hasLineItems ? lines.filter((l) => l.code.trim() !== '') : []
    if (hasLineItems && validLines.length === 0) {
      setError('הוסף לפחות שורה אחת עם קוד פריט')
      return
    }
    // Ported from the frmNrEnter "...הכנס מס. חודשים לקידום" prompt in
    // SaveRec() — required client-side here since there's no server-side
    // interactive dialog (see needsAddMonths()/InvoiceLineIn.AddMonths).
    for (const l of validLines) {
      if (needsAddMonths(l)) {
        const n = Number(l.addMonths)
        if (!l.addMonths.trim() || !Number.isInteger(n) || n < 1 || n > 18) {
          setError(`פריט ${l.code}: אנא הכנס מס' חודשים לקידום בין 1 ל-18`)
          return
        }
      }
    }
    if (needsBuyerDetails && buyerName.trim() === '') {
      setError('אנא הכנס שם')
      return
    }
    if (needsBuyerDetails && (buyerTz.trim() === '' || Number(buyerTz) === 0)) {
      setError('אנא הכנס ת.ז.')
      return
    }
    const validPayments = payments.filter((p) => p.amount.trim() !== '')
    if (needsPayment && validPayments.length === 0) {
      setError('הוסף לפחות אמצעי תשלום אחד')
      return
    }
    for (const p of validPayments) {
      if (
        p.method === 'check' &&
        (p.checkNr.trim() === '' || p.bankNr.trim() === '' || p.snifNr.trim() === '' || p.accountNr.trim() === '')
      ) {
        // All four required together — a check number is only unique
        // within one bank account, so the "already used" duplicate check
        // (CheckCheck() in frmInvRec.frm, see _save_checks() backend-side)
        // needs bank+branch+account too, not just the check number
        // (confirmed 2026-08-19).
        setError('יש להזין מספר שיק, בנק, סניף ומספר חשבון עבור תשלום בשיק')
        return
      }
      if (p.method === 'credit') {
        if (p.cardNr.trim() === '' || p.cardExpDate.trim() === '') {
          setError('יש להזין מספר כרטיס ותוקף עבור תשלום באשראי')
          return
        }
        if (p.creditType === 'installments' && p.installments.trim() === '') {
          setError('יש להזין מספר תשלומים')
          return
        }
      }
    }
    // Ported from checkInv() in frmInvRec.frm: `paid <> totalm` blocks the
    // save (paid = sum of the payment rows' amounts, totalm = sum of the
    // line subtotals) — the original silently exits the save without a
    // message, which we treat as a bug to fix rather than replicate (a
    // real error the cashier can act on, not a save button that quietly
    // does nothing). Only checked when this invoice actually collects
    // payment (payments.length > 0); a plain חשבונית with no payment rows
    // has nothing to reconcile against. 0.005 tolerance for float rounding.
    if (payments.length > 0 && Math.abs(paidSoFar - previewTotal) >= 0.005) {
      setError(
        `סכום התשלומים (${paidSoFar.toFixed(2)}) אינו תואם את סך החשבונית (${previewTotal.toFixed(2)}) — יש לתקן לפני השמירה`,
      )
      return
    }
    // Ported from `If val(txtPaidbyNr) = 0 Then ... "אנא הכנס מספר לקוח"` in
    // frmInvoice.frm's SaveRec() for HESHBONIT_ISKA.
    let paidByTaxiNr: number | undefined
    if (needsPaidBy) {
      const n = Number(paidByTaxiNrInput)
      if (!paidByTaxiNrInput.trim() || !n) {
        setError('אנא הכנס מספר לקוח')
        return
      }
      setPaidByChecking(true)
      try {
        const account = await fetchAccount(n)
        setPaidByName(`${account.PrivatName ?? ''} ${account.FamilyName ?? ''}`.trim())
        setPaidByError(null)
        paidByTaxiNr = n
      } catch (e) {
        const msg = e instanceof AccountNotFoundError ? `!!!לקוח לא נמצא ${n}` : 'שגיאה באיתור לקוח'
        setPaidByError(msg)
        setError(msg)
        return
      } finally {
        setPaidByChecking(false)
      }
    }
    // Ported from `If val(txtRecNrCred) = 0 Then ... "אנא הכנס מספר חשבונית לזיכוי"`
    // in frmInvoice.frm's SaveRec() for CREDIT_NOTE.
    let creditedInvNr: number | undefined
    if (needsCreditedInvoice) {
      if (!creditedInvoice) {
        setError('אנא הכנס מספר חשבונית לזיכוי')
        return
      }
      creditedInvNr = creditedInvoice.InvNr
    }
    // `If InvAction = HESHBONIT And val(txtRecNr) = 0 Then` blocks save in
    // frmInvoice.frm — re-validated right here (not just trusting an earlier
    // on-screen check), same "recompute right before save" pattern as the
    // invoice number itself. The server re-validates again independently
    // regardless, so this is a UX nicety, not the only guard.
    let recNr: number | undefined
    if (needsRecNr) {
      const n = Number(recNrInput)
      if (!recNrInput.trim() || !n) {
        setError('אנא הכנס מס\' קבלה')
        return
      }
      setRecNrChecking(true)
      try {
        const receipt = await validateOpenReceipt(n)
        setRecNrValidated(receipt)
        setRecNrError(null)
        recNr = n
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'שגיאה באימות מס\' קבלה'
        setRecNrError(msg)
        setError(msg)
        return
      } finally {
        setRecNrChecking(false)
      }
    }
    // Refresh the displayed number right before saving — the server
    // recomputes it again independently at commit time regardless (matching
    // SaveRec() recomputing right before InvRec.Recordset.Update), this just
    // keeps the on-screen preview honest if it's been open a while.
    refreshNextNumber()

    const invoiceLines: InvoiceLineInput[] = validLines.map((l) => ({
      Code: Number(l.code),
      Amount: Number(l.amount) || 1,
      ...(l.unitPrice.trim() !== '' ? { UnitPrice: Number(l.unitPrice) } : {}),
      ...(needsAddMonths(l) ? { AddMonths: Number(l.addMonths) } : {}),
    }))
    const invoicePayments = validPayments.map<PaymentMethodInput>((p) => ({
      method: p.method,
      amount: Number(p.amount) || 0,
      ...(p.method === 'check'
        ? {
            checkNr: p.checkNr.trim() !== '' ? Number(p.checkNr) : undefined,
            bankNr: p.bankNr.trim() !== '' ? Number(p.bankNr) : undefined,
            snifNr: p.snifNr.trim() !== '' ? Number(p.snifNr) : undefined,
            accountNr: p.accountNr.trim() !== '' ? Number(p.accountNr) : undefined,
            checkDate: p.checkDate.trim() !== '' ? p.checkDate.trim() : undefined,
          }
        : {}),
      ...(p.method === 'credit'
        ? {
            cardNr: p.cardNr.trim(),
            cardExpDate: p.cardExpDate.trim(),
            creditType: p.creditType,
            installments: p.creditType === 'installments' ? Number(p.installments) : undefined,
          }
        : {}),
    }))
    const buyer = needsBuyerDetails ? { name: buyerName.trim(), tz: Number(buyerTz) } : undefined

    await submitInvoice(invoiceLines, invoicePayments, buyer, recNr, undefined, paidByTaxiNr, creditedInvNr)
  }

  /**
   * Actually calls createInvoice(), separated out from handleSubmit so the
   * "extend service anyway?" confirm/decline buttons can resubmit the exact
   * same payload with a decision attached, without re-running validation.
   */
  async function submitInvoice(
    invoiceLines: InvoiceLineInput[],
    invoicePayments: PaymentMethodInput[],
    buyer: { name?: string; tz?: number } | undefined,
    recNr: number | undefined,
    extendServiceDecision?: 'confirm' | 'decline',
    paidByTaxiNr?: number,
    creditedInvNr?: number,
  ) {
    const branchArea = getStoredBranchArea()
    if (branchArea === null) {
      setError('לא הוגדר סניף למחשב זה')
      return
    }
    setSaving(true)
    try {
      const result = await createInvoice(
        taxiNr,
        docType,
        invoiceLines,
        branchArea,
        invoicePayments,
        buyer,
        recNr,
        extendServiceDecision,
        paidByTaxiNr,
        creditedInvNr,
      )
      onCreated(result.InvNr)
    } catch (e) {
      if (e instanceof ConfirmExtendServiceError) {
        setExtendServiceConfirm(e.message)
        setPendingSubmit({ invoiceLines, invoicePayments, buyer, recNr, paidByTaxiNr, creditedInvNr })
      } else {
        setError(e instanceof Error ? e.message : 'Failed to create invoice')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={() => {
        if (codePickerIndex !== null) setCodePickerIndex(null)
        if (receiptPickerOpen) setReceiptPickerOpen(false)
        if (creditedPickerOpen) setCreditedPickerOpen(false)
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h3 className="text-xl font-bold">{docLabel} חדשה</h3>
          <span className="text-lg text-slate-600">
            מס' מסמך (משוער): <span className="font-bold text-slate-800">{nextNumber ?? '...'}</span>
          </span>
        </div>
        <button type="button" onClick={onBack} className="win-button px-2 py-0.5 text-lg">
          חזרה לתפריט
        </button>
      </div>

      {error && <div className="mb-2 border border-red-300 bg-red-50 px-3 py-1.5 text-xl text-red-700">{error}</div>}

      {needsRecNr && (
        <div className="relative mb-3 flex flex-wrap items-end gap-3 border-b border-slate-300 pb-3">
          <div className="relative">
            <label className="block text-[17px] text-slate-600">מס' קבלה מקושרת</label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={recNrInput}
                onChange={(e) => {
                  setRecNrInput(e.target.value)
                  setRecNrValidated(null)
                  setRecNrError(null)
                }}
                onBlur={() => void checkRecNrInput()}
                onKeyDown={(e) => {
                  if (e.key === 'F1') {
                    e.preventDefault()
                    openReceiptPicker()
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    void checkRecNrInput()
                  }
                }}
                className="h-7 w-28 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
              <button
                type="button"
                title="F1 — בחר מרשימת קבלות פתוחות"
                onClick={openReceiptPicker}
                className="win-button h-7 px-1 py-0 text-base leading-none"
              >
                F1
              </button>
            </div>
            {receiptPickerOpen && (
              <ReceiptPickerPopup
                receipts={openReceipts}
                onSelect={selectReceipt}
                onClose={() => setReceiptPickerOpen(false)}
              />
            )}
          </div>
          <div className="text-lg">
            {recNrChecking && <span className="text-slate-500">בודק...</span>}
            {!recNrChecking && recNrValidated && (
              <span className="text-emerald-700">
                {recNrValidated.Name ?? ''} · יתרה פתוחה: {recNrValidated.Remaining.toFixed(2)}
              </span>
            )}
            {!recNrChecking && recNrError && <span className="text-red-700">{recNrError}</span>}
          </div>
        </div>
      )}

      {needsPaidBy && (
        <div className="mb-3 flex flex-wrap items-end gap-3 border-b border-slate-300 pb-3">
          <div>
            <label className="block text-[17px] text-slate-600">מספר לקוח משלם</label>
            <input
              type="text"
              value={paidByTaxiNrInput}
              onChange={(e) => {
                setPaidByTaxiNrInput(e.target.value)
                setPaidByName(null)
                setPaidByError(null)
              }}
              onBlur={() => void checkPaidByInput()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void checkPaidByInput()
                }
              }}
              className="h-7 w-28 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            />
          </div>
          <div className="text-lg">
            {paidByChecking && <span className="text-slate-500">בודק...</span>}
            {!paidByChecking && paidByName && <span className="text-emerald-700">{paidByName}</span>}
            {!paidByChecking && paidByError && <span className="text-red-700">{paidByError}</span>}
          </div>
        </div>
      )}

      {needsCreditedInvoice && (
        <div className="relative mb-3 flex flex-wrap items-end gap-3 border-b border-slate-300 pb-3">
          <div className="relative">
            <label className="block text-[17px] text-slate-600">מספר חשבונית לזיכוי</label>
            <button
              type="button"
              onClick={openCreditedPicker}
              // py-0/leading-none: without these, .win-button's own py-2.5
              // padding fights the fixed h-7 height (padding+line-height
              // wants ~48px inside a 28px box), so the text overflowed the
              // button and the button's own border rendered as a line
              // straight through the middle of it — the "strikethrough"
              // look reported 2026-08-19, both before and after picking an
              // invoice. Every other h-7/h-6 win-button in this file
              // already overrides py-0 (e.g. line ~918) for this reason;
              // this one had been missed.
              className="win-button flex h-7 min-w-[10rem] items-center justify-center whitespace-nowrap px-2 py-0 text-lg leading-none"
            >
              {creditedInvoice
                ? `${creditedInvoice.DisplayNr}${creditedInvoice.TypeLabel ? ` — ${creditedInvoice.TypeLabel}` : ''}`
                : 'בחר חשבונית...'}
            </button>
            {creditedPickerOpen && (
              <CreditedInvoicePickerPopup
                invoices={creditableInvoices}
                onSelect={selectCreditedInvoice}
                onClose={() => setCreditedPickerOpen(false)}
              />
            )}
          </div>
          {creditedInvoice && (
            <div className="text-lg text-emerald-700">
              {creditedInvoice.Name ?? ''}
              {creditedInvoice.GrandTotal != null ? ` · ${creditedInvoice.GrandTotal.toFixed(2)}` : ''}
            </div>
          )}
        </div>
      )}

      {needsBuyerDetails && (
        <div className="mb-3 flex flex-wrap items-end gap-3 border-b border-slate-300 pb-3">
          <div>
            <label className="block text-[17px] text-slate-600">שם המשלם</label>
            <input
              type="text"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              className="h-7 w-48 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[17px] text-slate-600">ת.ז.</label>
            <input
              type="text"
              value={buyerTz}
              onChange={(e) => setBuyerTz(e.target.value)}
              className="h-7 w-32 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            />
          </div>
          {productsLocked && (
            <div className="text-lg text-amber-700">יש להזין ת.ז. לפני הוספת פריטים</div>
          )}
        </div>
      )}

      {hasLineItems && (
      <table className="mb-2 w-full border-collapse text-[19px]">
        <thead>
          <tr className="border-b border-slate-400 bg-[#DCDAD3] text-right">
            <th className="px-2 py-1">קוד</th>
            <th className="px-2 py-1">תיאור</th>
            <th className="px-2 py-1">כמות</th>
            <th className="px-2 py-1">מחיר יחידה</th>
            <th className="px-2 py-1">סה"כ שורה</th>
            <th className="px-2 py-1">מס' חודשים לקידום</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const item = priceFor(line.code)
            return (
              <tr key={i} className="border-b border-slate-300">
                <td className="relative px-2 py-1">
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      list="pricelist-codes"
                      value={line.code}
                      disabled={productsLocked}
                      onChange={(e) => {
                        const raw = e.target.value
                        const matched = priceList.find((p) => String(p.Code) === raw.trim())
                        if (matched) {
                          selectCode(i, matched.Code)
                        } else {
                          updateLine(i, { code: raw })
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'F1') {
                          e.preventDefault()
                          if (!productsLocked) setCodePickerIndex(i)
                        } else {
                          focusNextField(e)
                        }
                      }}
                      className="h-6 w-20 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                    />
                    <button
                      type="button"
                      title="F1 — הצג רשימת פריטים"
                      disabled={productsLocked}
                      onClick={() => setCodePickerIndex(i)}
                      className="win-button h-6 px-1 py-0 text-base leading-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      F1
                    </button>
                  </div>
                  {codePickerIndex === i && (
                    <CodePickerPopup
                      priceList={priceList}
                      onSelect={(code) => {
                        selectCode(i, code)
                        setCodePickerIndex(null)
                      }}
                      onClose={() => setCodePickerIndex(null)}
                    />
                  )}
                </td>
                <td className="px-2 py-1 text-slate-600">{item?.Name ?? ''}</td>
                <td className="px-2 py-1">
                  <input
                    type="text"
                    value={line.amount}
                    disabled={productsLocked}
                    onChange={(e) => updateLine(i, { amount: e.target.value })}
                    onKeyDown={focusNextField}
                    className="h-6 w-16 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="text"
                    placeholder={item ? String(priceListFullTotal(item)) : ''}
                    value={line.unitPrice}
                    disabled={productsLocked}
                    onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                    onKeyDown={focusNextField}
                    className="h-6 w-24 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </td>
                <td className="px-2 py-1 font-medium text-slate-700">{lineTotal(line).toFixed(2)}</td>
                <td className="px-2 py-1">
                  {needsAddMonths(line) ? (
                    <input
                      type="text"
                      title="פריט זה מוסיף שרות בתשלומים — הכנס כמה חודשים לקדם עבור תשלום זה (1-18)"
                      placeholder="1-18"
                      value={line.addMonths}
                      onChange={(e) => updateLine(i, { addMonths: e.target.value })}
                      onKeyDown={focusNextField}
                      className="h-6 w-16 border border-amber-500 bg-amber-50 px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  ) : item?.add_service ? (
                    <span className="text-lg text-slate-500">12 (מלא)</span>
                  ) : (
                    <span className="text-lg text-slate-400">—</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {/*
                    Always shown — previously hidden whenever lines.length===1,
                    which meant a product picked into the invoice's one and
                    only (default) line could never be undone (reported
                    2026-08-19: "impossible to delete the line"). A line-item
                    invoice still needs at least one row, so removing the
                    LAST one just clears it back to blank instead of
                    dropping the row entirely.
                  */}
                  <button
                    type="button"
                    onClick={() => (lines.length > 1 ? removeLine(i) : setLines([emptyLine()]))}
                    className="text-lg text-red-700 underline"
                  >
                    הסר
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      )}
      {hasLineItems && (
      <datalist id="pricelist-codes">
        {priceList.map((p) => (
          <option key={p.Code} value={p.Code}>
            {p.Name}
          </option>
        ))}
      </datalist>
      )}

      {hasLineItems && lines.length < 6 && (
        <button
          type="button"
          onClick={addLine}
          disabled={productsLocked}
          className="win-button mb-3 px-2 py-1 text-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          + הוסף שורה
        </button>
      )}

      {hasLineItems ? (
        <>
          <div className="mb-3 border border-slate-400 bg-[#DCDAD3] px-3 py-1.5 text-xl text-slate-800">
            <div className="flex items-center justify-between border-b border-slate-400 pb-1">
              <span className="font-bold">לתשלום</span>
              <span className="text-[22px] font-bold">{previewTotal.toFixed(2)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-lg text-slate-600">
              <span>סה"כ ללא מע"מ</span>
              <span>{previewNetTotal.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-lg text-slate-600">
              <span>מע"מ ({vatRate}%)</span>
              <span>{previewVatAmount.toFixed(2)}</span>
            </div>
          </div>
          <div className="-mt-2 mb-3 text-[17px] text-slate-500">
            המחירים כוללים מע"מ — הסכום הסופי מחושב ומאומת בשרת
          </div>
        </>
      ) : (
        <div className="mb-3 border border-slate-400 bg-[#DCDAD3] px-3 py-1.5 text-xl text-slate-800">
          <div className="flex items-center justify-between">
            <span className="font-bold">סה"כ התקבל</span>
            <span className="text-[22px] font-bold">{previewTotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      {needsPayment && (
        <div className="mb-3 border-t border-slate-300 pt-2">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xl font-bold">אמצעי תשלום</h4>
            {hasLineItems && (
              <span className="text-lg text-slate-600">
                יתרה לתשלום: <span className="font-bold text-slate-800">{remainingBalance.toFixed(2)}</span>
              </span>
            )}
          </div>
          {payments.map((p, i) => (
            <div key={i} className="mb-2 flex flex-wrap items-end gap-2 border-b border-slate-200 pb-2">
              <div>
                <label className="block text-[17px] text-slate-600">אמצעי</label>
                <select
                  value={p.method}
                  onChange={(e) => updatePayment(i, { method: e.target.value as 'cash' | 'check' | 'credit' })}
                  className="h-6 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                >
                  <option value="cash">מזומן</option>
                  <option value="check">שיק</option>
                  <option value="credit">אשראי</option>
                </select>
              </div>
              <div>
                <label className="block text-[17px] text-slate-600">סכום</label>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={p.amount}
                    onChange={(e) => updatePayment(i, { amount: e.target.value, amountTouched: true })}
                    className="h-6 w-20 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                  />
                  {hasLineItems && (
                    <button
                      type="button"
                      title="מלא יתרה"
                      onClick={() =>
                        updatePayment(i, {
                          amount: (remainingBalance + (Number(p.amount) || 0)).toFixed(2),
                          amountTouched: true,
                        })
                      }
                      className="win-button h-6 px-1 py-0 text-base leading-none"
                    >
                      יתרה
                    </button>
                  )}
                </div>
              </div>
              {p.method === 'check' && (
                <>
                  <div>
                    {/* MaxLength=8 on txtCheckNr in frmInvRec.frm */}
                    <label className="block text-[17px] text-slate-600">מס' שיק</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={8}
                      value={p.checkNr}
                      onChange={(e) => updatePayment(i, { checkNr: onlyDigits(e.target.value, 8) })}
                      onBlur={() => cascadeCheckDetailsFromFirst(i)}
                      className="h-6 w-20 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  </div>
                  <div>
                    {/* MaxLength=2 on txtBankNr in frmInvRec.frm */}
                    <label className="block text-[17px] text-slate-600">
                      בנק{p.bankNr ? ` — ${bankName(p.bankNr) || '?'}` : ''}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      value={p.bankNr}
                      onChange={(e) => updatePayment(i, { bankNr: onlyDigits(e.target.value, 2) })}
                      onBlur={() => cascadeCheckDetailsFromFirst(i)}
                      className="h-6 w-16 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  </div>
                  <div>
                    {/* MaxLength=3 on txtSnif in frmInvRec.frm */}
                    <label className="block text-[17px] text-slate-600">סניף</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      value={p.snifNr}
                      onChange={(e) => updatePayment(i, { snifNr: onlyDigits(e.target.value, 3) })}
                      onBlur={() => cascadeCheckDetailsFromFirst(i)}
                      className="h-6 w-16 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  </div>
                  <div>
                    {/* MaxLength=6 on txtAccountNr in frmInvRec.frm */}
                    <label className="block text-[17px] text-slate-600">מס' חשבון</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={p.accountNr}
                      onChange={(e) => updatePayment(i, { accountNr: onlyDigits(e.target.value, 6) })}
                      onBlur={() => cascadeCheckDetailsFromFirst(i)}
                      className="h-6 w-20 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[17px] text-slate-600">תאריך שיק</label>
                    <input
                      type="text"
                      placeholder="DD/MM/YYYY"
                      value={p.checkDate}
                      onChange={(e) => updatePayment(i, { checkDate: e.target.value })}
                      className="h-6 w-24 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  </div>
                </>
              )}
              {p.method === 'credit' && (
                <>
                  <div>
                    <label className="block text-[17px] text-slate-600">מס' כרטיס</label>
                    <input
                      type="text"
                      value={p.cardNr}
                      onChange={(e) => updatePayment(i, { cardNr: e.target.value })}
                      className="h-6 w-32 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[17px] text-slate-600">תוקף</label>
                    <input
                      type="text"
                      placeholder="MM/YY"
                      value={p.cardExpDate}
                      onChange={(e) => updatePayment(i, { cardExpDate: e.target.value })}
                      className="h-6 w-16 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[17px] text-slate-600">סוג חיוב</label>
                    <select
                      value={p.creditType}
                      onChange={(e) =>
                        updatePayment(i, { creditType: e.target.value as DraftPayment['creditType'] })
                      }
                      className="h-6 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    >
                      <option value="regular">רגיל</option>
                      <option value="credit">קרדיט</option>
                      <option value="installments">תשלומים</option>
                    </select>
                  </div>
                  {p.creditType === 'installments' && (
                    <div>
                      <label className="block text-[17px] text-slate-600">מס' תשלומים</label>
                      <input
                        type="text"
                        value={p.installments}
                        onChange={(e) => updatePayment(i, { installments: e.target.value })}
                        className="h-6 w-16 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                      />
                    </div>
                  )}
                </>
              )}
              {payments.length > 1 && (
                <button type="button" onClick={() => removePayment(i)} className="text-lg text-red-700 underline">
                  הסר
                </button>
              )}
            </div>
          ))}
          {payments.length < 6 && (
            <button type="button" onClick={addPayment} className="win-button px-2 py-1 text-lg">
              + הוסף אמצעי תשלום
            </button>
          )}
        </div>
      )}

      {extendServiceConfirm && pendingSubmit && (
        <div className="mb-3 border border-amber-400 bg-amber-50 px-3 py-2 text-xl text-amber-900">
          <div className="mb-2">{extendServiceConfirm}</div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const p = pendingSubmit
                setExtendServiceConfirm(null)
                setPendingSubmit(null)
                void submitInvoice(p.invoiceLines, p.invoicePayments, p.buyer, p.recNr, 'confirm', p.paidByTaxiNr, p.creditedInvNr)
              }}
              className="win-button"
            >
              לקדם תקופת ביטוח
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const p = pendingSubmit
                setExtendServiceConfirm(null)
                setPendingSubmit(null)
                void submitInvoice(p.invoiceLines, p.invoicePayments, p.buyer, p.recNr, 'decline', p.paidByTaxiNr, p.creditedInvNr)
              }}
              className="win-button"
            >
              לא לקדם/לקצר
            </button>
          </div>
        </div>
      )}

      <button type="button" onClick={() => void handleSubmit()} disabled={saving} className="win-button">
        {saving ? 'שומר...' : `הנפק ${docLabel}`}
      </button>
    </div>
  )
}

function ListView({
  taxiNr,
  type,
  onBack,
  onSelect,
}: {
  taxiNr: number
  type: number
  onBack: () => void
  onSelect: (invNr: number) => void
}) {
  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const label = DOC_TYPES.find((d) => d.type === type)?.label ?? ''

  useEffect(() => {
    fetchInvoices(taxiNr)
      .then((all) => setInvoices(all.filter((inv) => inv.Type === type)))
      .catch(() => setError('Failed to load invoices'))
  }, [taxiNr, type])

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xl font-bold">{label} — מסמכים קיימים</h3>
        <button type="button" onClick={onBack} className="win-button px-2 py-0.5 text-lg">
          חזרה לתפריט
        </button>
      </div>

      {error && <div className="border border-red-300 bg-red-50 px-3 py-1.5 text-xl text-red-700">{error}</div>}
      {!error && invoices === null && <div className="p-4 text-center text-xl text-slate-500">טוען...</div>}
      {!error && invoices !== null && invoices.length === 0 && (
        <div className="p-4 text-center text-xl text-slate-500">אין מסמכים מסוג זה למונית זו</div>
      )}
      {!error && invoices !== null && invoices.length > 0 && (
        <table className="w-full border-collapse text-[19px]">
          <thead>
            <tr className="border-b border-slate-400 bg-[#DCDAD3] text-right">
              <th className="px-2 py-1.5">מס' מסמך</th>
              <th className="px-2 py-1.5">תאריך</th>
              <th className="px-2 py-1.5">שעה</th>
              <th className="px-2 py-1.5">שם</th>
              <th className="px-2 py-1.5">סה"כ</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr
                key={inv.InvNr}
                className="cursor-pointer border-b border-slate-300 odd:bg-white even:bg-[#F5F4EF] hover:bg-sky-50"
                onClick={() => onSelect(inv.InvNr)}
              >
                <td className="px-2 py-1">
                  {inv.DisplayNr}
                  {inv.Deleted ? ' (נמחק)' : ''}
                </td>
                <td className="px-2 py-1">{formatDate(inv.Date)}</td>
                <td className="px-2 py-1">{formatTime(inv.Time)}</td>
                <td className="px-2 py-1">{inv.Name ?? ''}</td>
                <td className="px-2 py-1">{inv.GrandTotal?.toFixed(2) ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function DetailView({ taxiNr, invNr, onBack }: { taxiNr: number; invNr: number; onBack: () => void }) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Whether the local Crystal Reports print bridge (WebCode/print-bridge/)
  // is running on THIS branch PC — only offer the "real" Crystal print
  // buttons when it actually answers, otherwise fall back silently to the
  // built-in PDF button below (no dead/broken buttons on branches that
  // haven't set the bridge up yet).
  const [bridgeAvailable, setBridgeAvailable] = useState(false)

  useEffect(() => {
    fetchInvoice(taxiNr, invNr)
      .then(setInvoice)
      .catch(() => setError('Failed to load invoice'))
  }, [taxiNr, invNr])

  useEffect(() => {
    isPrintBridgeAvailable().then(setBridgeAvailable)
  }, [])

  const [printing, setPrinting] = useState(false)

  // Single print button: never-printed-before -> מקור, everything else
  // (reprints, viewing an old invoice from history, etc.) -> העתק. Source of
  // truth is Invoice.Printed, marked via mark-printed BEFORE opening the
  // print view/bridge (so it reads the pre-print value) — see api/invoices.ts.
  async function handlePrint() {
    if (!invoice) return
    setPrinting(true)
    try {
      const { wasAlreadyPrinted } = await markInvoicePrinted(taxiNr, invNr)
      const isOriginal = !wasAlreadyPrinted
      setInvoice((prev) => (prev ? { ...prev, Printed: true } : prev))
      if (bridgeAvailable) {
        window.open(invoicePrintUrl(invoice, isOriginal), '_blank')
      } else {
        window.open(`/api/account/${taxiNr}/invoices/${invNr}/print?copy=${isOriginal ? 1 : 0}`, '_blank')
      }
    } catch {
      setError('שגיאה בהדפסה')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xl font-bold">
          {invoice?.TypeLabel ?? ''} מס' {invoice?.DisplayNr ?? invNr}
          {invoice?.Printed ? <span className="mr-2 text-lg font-normal text-slate-500">(הודפס)</span> : null}
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            title={bridgeAvailable ? 'הדפסה דרך Crystal Reports' : 'PDF פשוט (לא Crystal Reports)'}
            disabled={!invoice || printing}
            onClick={() => void handlePrint()}
            className="win-button px-2 py-0.5 text-lg"
          >
            הדפס
          </button>
          <button type="button" onClick={onBack} className="win-button px-2 py-0.5 text-lg">
            חזרה לתפריט
          </button>
        </div>
      </div>

      {error && <div className="border border-red-300 bg-red-50 px-3 py-1.5 text-xl text-red-700">{error}</div>}
      {!error && invoice === null && <div className="p-4 text-center text-xl text-slate-500">טוען...</div>}

      {invoice && (
        <div className="space-y-3 text-[19px]">
          <div className="grid grid-cols-3 gap-2">
            <div>תאריך: {formatDate(invoice.Date)}</div>
            <div>שעה: {formatTime(invoice.Time)}</div>
            <div>{invoice.Deleted ? 'מסמך מחוק' : ''}</div>
            <div>שם: {invoice.Name}</div>
            {invoice.Tz != null && <div>ת.ז.: {invoice.Tz}</div>}
            <div>עיר: {invoice.Town ?? ''}</div>
            <div>
              רחוב: {invoice.Street ?? ''} {invoice.HomeNr ?? ''}
            </div>
            {invoice.RecNr != null && invoice.RecNr !== 0 && (
              <div>מקושר לקבלה מס': {invoice.RecNr % 1_000_000}</div>
            )}
          </div>

          {invoice.Lines.length > 0 && (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-400 bg-[#DCDAD3] text-right">
                  <th className="px-2 py-1">קוד</th>
                  <th className="px-2 py-1">תיאור</th>
                  <th className="px-2 py-1">כמות</th>
                  <th className="px-2 py-1">מחיר יחידה</th>
                  <th className="px-2 py-1">סה"כ שורה</th>
                </tr>
              </thead>
              <tbody>
                {invoice.Lines.map((line, i) => (
                  <tr key={i} className="border-b border-slate-300">
                    <td className="px-2 py-1">{line.Code}</td>
                    <td className="px-2 py-1">{line.Description ?? ''}</td>
                    <td className="px-2 py-1">{line.Amount}</td>
                    <td className="px-2 py-1">{line.UnitPrice?.toFixed(2)}</td>
                    <td className="px-2 py-1">{line.SubTotal?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Prices are VAT-inclusive: Total (sum of line subtotals) is the amount
              actually payable; the net/VAT breakdown is informational only.
              Standalone קבלה (invoice.Vat === null) has no VAT breakdown of its own. */}
          {invoice.Vat != null ? (
            <div className="flex justify-end gap-6 border-t border-slate-300 pt-2 text-slate-600">
              <div>
                סה"כ ללא מע"מ: {((invoice.Total ?? 0) - (invoice.TotalVat ?? 0)).toFixed(2)}
              </div>
              <div>
                מע"מ ({invoice.Vat}%): {invoice.TotalVat?.toFixed(2)}
              </div>
              <div className="font-bold text-slate-800">לתשלום: {invoice.Total?.toFixed(2)}</div>
            </div>
          ) : (
            <div className="flex justify-end border-t border-slate-300 pt-2 text-slate-600">
              <div className="font-bold text-slate-800">סה"כ התקבל: {invoice.Total?.toFixed(2)}</div>
            </div>
          )}

          {invoice.Payments.length > 0 && (
            <div className="border-t border-slate-300 pt-2">
              <h4 className="mb-1 font-bold">אמצעי תשלום</h4>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-400 bg-[#DCDAD3] text-right">
                    <th className="px-2 py-1">אמצעי</th>
                    <th className="px-2 py-1">סכום</th>
                    <th className="px-2 py-1">פרטים</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.Payments.map((p, i) => {
                    const methodLabel =
                      p.method === 'cash' ? 'מזומן' : p.method === 'check' ? 'שיק' : p.method === 'credit' ? 'אשראי' : p.method
                    const creditTypeLabel =
                      p.creditType === 'regular'
                        ? 'רגיל'
                        : p.creditType === 'credit'
                          ? 'קרדיט'
                          : p.creditType === 'installments'
                            ? 'תשלומים'
                            : null
                    return (
                      <tr key={i} className="border-b border-slate-300">
                        <td className="px-2 py-1">{methodLabel}</td>
                        <td className="px-2 py-1">{p.amount?.toFixed(2) ?? ''}</td>
                        <td className="px-2 py-1 text-slate-600">
                          {p.method === 'check' &&
                            [
                              p.checkNr != null ? `מס' ${p.checkNr}` : null,
                              p.bankNr != null ? `בנק ${p.bankNr}` : null,
                              p.snifNr != null ? `סניף ${p.snifNr}` : null,
                              p.accountNr != null ? `חשבון ${p.accountNr}` : null,
                              p.checkDate ?? null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          {p.method === 'credit' &&
                            [
                              p.cardNr ? `כרטיס ${p.cardNr}` : null,
                              p.cardExpDate ? `תוקף ${p.cardExpDate}` : null,
                              creditTypeLabel,
                              p.creditType === 'installments' && p.installments ? `${p.installments} תשלומים` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
