import { useEffect, useState } from 'react'
import {
  fetchBadCheckOptions,
  findBadChecksByCheck,
  findBadChecksByTaxi,
  findBadChecksByTz,
  markBadCheckLost,
  reportBadCheck,
  repayBadCheck,
  type BadCheck,
  type BadCheckOptions,
} from '../api/badChecks'
import {
  fetchPriceList,
  priceListFullTotal,
  type InvoiceLineInput,
  type PaymentMethodInput,
  type PriceListItem,
} from '../api/invoices'
import { getStoredBranchArea } from '../api/branch'
import { bankName } from '../utils/bankNames'

/**
 * PriceList item name for the returned-check fee/interest charge — requested
 * 2026-08-19 so the interest code auto-fills instead of requiring the user
 * to remember/type the right PriceList code every time. Matched by exact
 * trimmed name (PriceList.Name is a space-padded char(32), see PriceListItem
 * docstring); if the price list doesn't have an item with this exact name,
 * the code field just stays blank for manual entry, same as before this
 * change — no hard failure either way.
 */
const RETURNED_CHECK_FEE_ITEM_NAME = 'הוצאות שק חוזר'

/** Digits only, capped at maxLen — matches frmInvRec.frm's MaxLength on these fields (8/2/3/6, see call sites). */
function onlyDigits(raw: string, maxLen: number): string {
  return raw.replace(/\D/g, '').slice(0, maxLen)
}

/**
 * Web equivalent of Code/frmBackCheck.frm ("שיקים חוזרים" — returned/
 * bounced checks), reached from Account.frm's cmdCheck button. See backend
 * routers/bad_checks.py and models.py's BadChecks docstring for the full
 * ported workflow and its schema caveats.
 *
 * Unlike most of this app's modals, this screen is deliberately NOT scoped
 * to the account currently loaded on the main screen — the original form
 * has its own independent search (by check nr, by TZ, or by taxi nr), same
 * as here. `defaultTaxiNr` just pre-fills the "by taxi" search as a
 * convenience when opened while an account happens to be on screen.
 */

type View =
  | { kind: 'search' }
  | { kind: 'report' }
  | { kind: 'detail'; badCheck: BadCheck }

function today(): string {
  return new Date().toLocaleDateString('en-GB').split('/').join('/') // DD/MM/YYYY
}

interface DraftPayment {
  method: 'cash' | 'check' | 'credit'
  amount: string
  checkNr: string
  bankNr: string
  snifNr: string
  accountNr: string
  checkDate: string
  cardNr: string
  cardExpDate: string
  creditType: 'regular' | 'credit' | 'installments'
  installments: string
}

function emptyPayment(amount = ''): DraftPayment {
  return {
    method: 'cash',
    amount,
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

function toPaymentInput(p: DraftPayment): PaymentMethodInput {
  return {
    method: p.method,
    amount: Number(p.amount) || 0,
    ...(p.method === 'check'
      ? {
          checkNr: Number(p.checkNr) || undefined,
          bankNr: Number(p.bankNr) || undefined,
          snifNr: Number(p.snifNr) || undefined,
          accountNr: Number(p.accountNr) || undefined,
          checkDate: p.checkDate || undefined,
        }
      : {}),
    ...(p.method === 'credit'
      ? {
          cardNr: p.cardNr || undefined,
          cardExpDate: p.cardExpDate || undefined,
          creditType: p.creditType,
          installments: p.creditType === 'installments' ? Number(p.installments) || undefined : undefined,
        }
      : {}),
  }
}

function PaymentFields({ payment, onChange }: { payment: DraftPayment; onChange: (patch: Partial<DraftPayment>) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-[15px] text-slate-600">אמצעי</label>
        <select
          value={payment.method}
          onChange={(e) => onChange({ method: e.target.value as DraftPayment['method'] })}
          className="h-6 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
        >
          <option value="cash">מזומן</option>
          <option value="check">שיק</option>
          <option value="credit">אשראי</option>
        </select>
      </div>
      <div>
        <label className="block text-[15px] text-slate-600">סכום</label>
        <input
          type="text"
          value={payment.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          className="h-6 w-20 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
        />
      </div>
      {payment.method === 'check' && (
        <>
          <div>
            {/* MaxLength=8 on txtCheckNr in frmInvRec.frm */}
            <label className="block text-[15px] text-slate-600">מס' שיק</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={8}
              value={payment.checkNr}
              onChange={(e) => onChange({ checkNr: onlyDigits(e.target.value, 8) })}
              className="h-6 w-20 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            />
          </div>
          <div>
            {/* MaxLength=2 on txtBankNr in frmInvRec.frm */}
            <label className="block text-[15px] text-slate-600">
              בנק{payment.bankNr ? ` — ${bankName(payment.bankNr) || '?'}` : ''}
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={payment.bankNr}
              onChange={(e) => onChange({ bankNr: onlyDigits(e.target.value, 2) })}
              className="h-6 w-14 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            />
          </div>
          <div>
            {/* MaxLength=3 on txtSnif in frmInvRec.frm */}
            <label className="block text-[15px] text-slate-600">סניף</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={3}
              value={payment.snifNr}
              onChange={(e) => onChange({ snifNr: onlyDigits(e.target.value, 3) })}
              className="h-6 w-14 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            />
          </div>
          <div>
            {/* MaxLength=6 on txtAccountNr in frmInvRec.frm */}
            <label className="block text-[15px] text-slate-600">מס' חשבון</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={payment.accountNr}
              onChange={(e) => onChange({ accountNr: onlyDigits(e.target.value, 6) })}
              className="h-6 w-20 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[15px] text-slate-600">תאריך שיק</label>
            <input
              type="text"
              placeholder="DD/MM/YYYY"
              value={payment.checkDate}
              onChange={(e) => onChange({ checkDate: e.target.value })}
              className="h-6 w-24 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            />
          </div>
        </>
      )}
      {payment.method === 'credit' && (
        <>
          <div>
            <label className="block text-[15px] text-slate-600">מס' כרטיס</label>
            <input
              type="text"
              value={payment.cardNr}
              onChange={(e) => onChange({ cardNr: e.target.value })}
              className="h-6 w-28 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[15px] text-slate-600">תוקף</label>
            <input
              type="text"
              placeholder="MM/YY"
              value={payment.cardExpDate}
              onChange={(e) => onChange({ cardExpDate: e.target.value })}
              className="h-6 w-16 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[15px] text-slate-600">סוג חיוב</label>
            <select
              value={payment.creditType}
              onChange={(e) => onChange({ creditType: e.target.value as DraftPayment['creditType'] })}
              className="h-6 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            >
              <option value="regular">רגיל</option>
              <option value="credit">קרדיט</option>
              <option value="installments">תשלומים</option>
            </select>
          </div>
          {payment.creditType === 'installments' && (
            <div>
              <label className="block text-[15px] text-slate-600">מס' תשלומים</label>
              <input
                type="text"
                value={payment.installments}
                onChange={(e) => onChange({ installments: e.target.value })}
                className="h-6 w-16 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function BadChecksModal({ defaultTaxiNr, onClose }: { defaultTaxiNr?: number; onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: 'search' })
  const [options, setOptions] = useState<BadCheckOptions | null>(null)

  useEffect(() => {
    fetchBadCheckOptions()
      .then(setOptions)
      .catch(() => setOptions(null))
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        dir="rtl"
        className="flex max-h-[85vh] w-[92vw] max-w-3xl flex-col border border-slate-500 bg-[#EFEDE6] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-yellow-400 px-4 py-2">
          <h2 className="text-[22px] font-bold text-slate-800">שיקים חוזרים</h2>
          <button type="button" onClick={onClose} className="win-button px-2 py-0.5 text-lg">
            סגור
          </button>
        </div>

        <div className="overflow-auto p-4">
          {view.kind === 'search' && (
            <SearchView
              defaultTaxiNr={defaultTaxiNr}
              onSelect={(badCheck) => setView({ kind: 'detail', badCheck })}
              onReportNew={() => setView({ kind: 'report' })}
            />
          )}

          {view.kind === 'report' && (
            <ReportForm
              onBack={() => setView({ kind: 'search' })}
              onReported={(badCheck) => setView({ kind: 'detail', badCheck })}
            />
          )}

          {view.kind === 'detail' && options && (
            <DetailView
              badCheck={view.badCheck}
              options={options}
              onBack={() => setView({ kind: 'search' })}
              onUpdated={(badCheck) => setView({ kind: 'detail', badCheck })}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function SearchView({
  defaultTaxiNr,
  onSelect,
  onReportNew,
}: {
  defaultTaxiNr?: number
  onSelect: (badCheck: BadCheck) => void
  onReportNew: () => void
}) {
  const [mode, setMode] = useState<'check' | 'tz' | 'taxi'>('taxi')
  const [checkNr, setCheckNr] = useState('')
  const [accountNr, setAccountNr] = useState('')
  const [snifNr, setSnifNr] = useState('')
  const [tz, setTz] = useState('')
  const [taxiNr, setTaxiNr] = useState(defaultTaxiNr ? String(defaultTaxiNr) : '')
  const [results, setResults] = useState<BadCheck[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function search() {
    setError(null)
    setLoading(true)
    try {
      if (mode === 'check') {
        if (!checkNr.trim() || !accountNr.trim() || !snifNr.trim()) {
          setError('אנא הכנס מס. שק, מס. חשבון וסניף')
          return
        }
        setResults(await findBadChecksByCheck(Number(checkNr), Number(accountNr), Number(snifNr)))
      } else if (mode === 'tz') {
        if (!tz.trim()) {
          setError('אנא הכנס ת.ז.')
          return
        }
        setResults(await findBadChecksByTz(Number(tz)))
      } else {
        if (!taxiNr.trim()) {
          setError("אנא הכנס מס' מונית")
          return
        }
        setResults(await findBadChecksByTaxi(Number(taxiNr)))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בחיפוש')
      setResults(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setMode('taxi')}
          className={`win-button px-2 py-1 text-lg ${mode === 'taxi' ? 'bg-sky-100' : ''}`}
        >
          לפי מס' מונית
        </button>
        <button
          type="button"
          onClick={() => setMode('check')}
          className={`win-button px-2 py-1 text-lg ${mode === 'check' ? 'bg-sky-100' : ''}`}
        >
          לפי מס' שק
        </button>
        <button
          type="button"
          onClick={() => setMode('tz')}
          className={`win-button px-2 py-1 text-lg ${mode === 'tz' ? 'bg-sky-100' : ''}`}
        >
          לפי ת.ז.
        </button>
        <div className="flex-1" />
        <button type="button" onClick={onReportNew} className="win-button px-2 py-1 text-lg">
          דיווח על צ'ק חדש
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        {mode === 'taxi' && (
          <div>
            <label className="block text-[15px] text-slate-600">מס' מונית</label>
            <input
              type="text"
              value={taxiNr}
              onChange={(e) => setTaxiNr(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
              className="h-7 w-28 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              autoFocus
            />
          </div>
        )}
        {mode === 'check' && (
          <>
            <div>
              <label className="block text-[15px] text-slate-600">מס' שק</label>
              <input
                type="text"
                value={checkNr}
                onChange={(e) => setCheckNr(e.target.value)}
                className="h-7 w-24 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[15px] text-slate-600">מס' חשבון</label>
              <input
                type="text"
                value={accountNr}
                onChange={(e) => setAccountNr(e.target.value)}
                className="h-7 w-24 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[15px] text-slate-600">סניף</label>
              <input
                type="text"
                value={snifNr}
                onChange={(e) => setSnifNr(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void search()}
                className="h-7 w-20 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </div>
          </>
        )}
        {mode === 'tz' && (
          <div>
            <label className="block text-[15px] text-slate-600">ת.ז.</label>
            <input
              type="text"
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
              className="h-7 w-32 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              autoFocus
            />
          </div>
        )}
        <button type="button" onClick={() => void search()} disabled={loading} className="win-button px-3 py-1 text-lg">
          {loading ? 'מחפש...' : 'חיפוש'}
        </button>
      </div>

      {error && <div className="mb-2 border border-red-300 bg-red-50 px-3 py-1.5 text-lg text-red-700">{error}</div>}

      {results && (
        <table className="w-full border-collapse text-lg">
          <thead>
            <tr className="border-b border-slate-400 text-right">
              <th className="px-2 py-1">מס'</th>
              <th className="px-2 py-1">סכום</th>
              <th className="px-2 py-1">תאריך פרעון</th>
              <th className="px-2 py-1">שולם</th>
              <th className="px-2 py-1">סטטוס</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {results.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-3 text-center text-slate-500">
                  לא נמצאו שקים חוזרים
                </td>
              </tr>
            )}
            {results.map((bc) => (
              <tr key={bc.BadCheckNr} className="border-b border-slate-200">
                <td className="px-2 py-1">{bc.BadCheckNr}</td>
                <td className="px-2 py-1">{bc.Money.toFixed(2)}</td>
                <td className="px-2 py-1">{bc.DueDate ?? ''}</td>
                <td className="px-2 py-1">{bc.PaidCheck.toFixed(2)}</td>
                <td className="px-2 py-1">{bc.Lost ? 'חוב אבוד' : bc.Statustxt ?? (bc.StillCollectible ? 'פתוח' : 'סגור')}</td>
                <td className="px-2 py-1">
                  <button type="button" onClick={() => onSelect(bc)} className="win-button px-2 py-0.5 text-base">
                    פתח
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ReportForm({ onBack, onReported }: { onBack: () => void; onReported: (badCheck: BadCheck) => void }) {
  const [checkNr, setCheckNr] = useState('')
  const [accountNr, setAccountNr] = useState('')
  const [snifNr, setSnifNr] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!checkNr.trim() || !accountNr.trim() || !snifNr.trim()) {
      setError('אנא הכנס מס. שק, מס. חשבון וסניף')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const badCheck = await reportBadCheck(Number(checkNr), Number(accountNr), Number(snifNr))
      onReported(badCheck)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בדיווח')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="mb-3 text-lg text-slate-600">
        הכנס את פרטי השק המקורי (כפי שנקלט בעת קבלתו) כדי לדווח עליו כחוזר.
      </p>
      {error && <div className="mb-2 border border-red-300 bg-red-50 px-3 py-1.5 text-lg text-red-700">{error}</div>}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[15px] text-slate-600">מס' שק</label>
          <input
            type="text"
            value={checkNr}
            onChange={(e) => setCheckNr(e.target.value)}
            className="h-7 w-28 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[15px] text-slate-600">מס' חשבון</label>
          <input
            type="text"
            value={accountNr}
            onChange={(e) => setAccountNr(e.target.value)}
            className="h-7 w-28 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[15px] text-slate-600">סניף</label>
          <input
            type="text"
            value={snifNr}
            onChange={(e) => setSnifNr(e.target.value)}
            className="h-7 w-24 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void submit()} disabled={saving} className="win-button px-3 py-1 text-lg">
          {saving ? 'מדווח...' : 'דיווח'}
        </button>
        <button type="button" onClick={onBack} className="win-button px-2 py-0.5 text-lg">
          חזרה לחיפוש
        </button>
      </div>
    </div>
  )
}

function DetailView({
  badCheck,
  options,
  onBack,
  onUpdated,
}: {
  badCheck: BadCheck
  options: BadCheckOptions
  onBack: () => void
  onUpdated: (badCheck: BadCheck) => void
}) {
  const [familyName, setFamilyName] = useState(badCheck.FamilyName ?? '')
  const [cellPhone, setCellPhone] = useState(badCheck.CellPhone ?? '')
  const [street, setStreet] = useState(badCheck.Street ?? '')
  const [homeNr, setHomeNr] = useState(badCheck.HomeNr ?? '')
  const [town, setTown] = useState(badCheck.Town ?? '')
  const [zipCode, setZipCode] = useState(badCheck.ZipCode != null ? String(badCheck.ZipCode) : '')
  const [reason, setReason] = useState(badCheck.Reason ?? '')
  const [returnBankName, setReturnBankName] = useState(badCheck.ReturnBankName ?? '')
  const [statustxt, setStatustxt] = useState(badCheck.Statustxt ?? '')
  const [notes, setNotes] = useState(
    [1, 2, 3, 4, 5].map((i) => ({
      date: (badCheck[`Date${i}` as keyof BadCheck] as string | null) ?? '',
      msg: (badCheck[`Msg${i}` as keyof BadCheck] as string | null) ?? '',
    })),
  )

  // Defaults to the check's own face value — "the payment of the bad check"
  // is recovering that exact amount, so requiring the user to retype it
  // every time was pure busywork (requested 2026-08-19). Still freely
  // editable for a partial payment.
  const [collectCheck, setCollectCheck] = useState(false)
  const [checkPayment, setCheckPayment] = useState<DraftPayment>(emptyPayment(badCheck.Money ? badCheck.Money.toFixed(2) : ''))
  const [collectInterest, setCollectInterest] = useState(false)
  const [interestCode, setInterestCode] = useState('')
  const [interestCodeName, setInterestCodeName] = useState<string | null>(null)
  const [interestAmount, setInterestAmount] = useState('1')
  // Left blank until the price-list fetch below resolves — its default
  // comes from the PriceList item's own price, NOT badCheck.Debit's
  // calculated late-fee estimate (requested 2026-08-19; Debit is still
  // shown above as an informational reference figure, just no longer used
  // to prefill this field).
  const [interestUnitPrice, setInterestUnitPrice] = useState('')
  const [interestPayment, setInterestPayment] = useState<DraftPayment>(emptyPayment())
  // False until the user manually edits interestPayment's amount — lets the
  // sync effect below keep it equal to unitPrice*amount by default without
  // fighting a manual edit. Needed because the backend now requires the
  // payment total to match the invoice line's total EXACTLY (see
  // create_invoice_core's checkInv()-derived validation) — this invoice
  // only ever has the one line, so keeping the two in sync automatically
  // avoids a save-time mismatch error for what's normally a single number.
  const [interestPaymentAmountTouched, setInterestPaymentAmountTouched] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // Auto-fills the interest/fee item code AND its default unit price from
  // the price list's "הוצאות שק חוזר" entry so the user doesn't have to look
  // either up/type them every time — only fills them in once, and only
  // while still blank, so it never fights a manual edit (same pattern as
  // the invoice line price auto-fill).
  useEffect(() => {
    const branchArea = getStoredBranchArea()
    if (branchArea === null) return
    fetchPriceList(branchArea)
      .then((priceList: PriceListItem[]) => {
        const item = priceList.find((p) => (p.Name ?? '').trim() === RETURNED_CHECK_FEE_ITEM_NAME)
        if (item) {
          setInterestCodeName(item.Name?.trim() ?? null)
          setInterestCode((prev) => (prev.trim() === '' ? String(item.Code) : prev))
          const fullPrice = priceListFullTotal(item)
          setInterestUnitPrice((prev) => (prev.trim() === '' && fullPrice > 0 ? String(fullPrice) : prev))
        }
      })
      .catch(() => {
        // Best-effort convenience only — the code field just stays blank/manual on failure.
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keeps interestPayment's amount equal to the line's own total
  // (unitPrice*amount) by default — see interestPaymentAmountTouched above.
  useEffect(() => {
    if (interestPaymentAmountTouched) return
    const total = (Number(interestUnitPrice) || 0) * (Number(interestAmount) || 0)
    const next = total > 0 ? total.toFixed(2) : ''
    setInterestPayment((prev) => (prev.amount === next ? prev : { ...prev, amount: next }))
  }, [interestUnitPrice, interestAmount, interestPaymentAmountTouched])

  function updateNote(i: number, patch: Partial<{ date: string; msg: string }>) {
    setNotes((prev) => prev.map((n, idx) => (idx === i ? { ...n, ...patch } : n)))
  }

  async function save() {
    setError(null)
    if (collectCheck && (Number(checkPayment.amount) || 0) <= 0) {
      setError('אנא הכנס סכום לתשלום השק')
      return
    }
    // All four required together for a check-method payment — a check
    // number is only unique within one bank account, so the backend's
    // "already used" duplicate check needs bank+branch+account too, not
    // just the check number (matches InvoiceModal.tsx's same validation,
    // confirmed 2026-08-19).
    if (
      collectCheck &&
      checkPayment.method === 'check' &&
      (checkPayment.checkNr.trim() === '' ||
        checkPayment.bankNr.trim() === '' ||
        checkPayment.snifNr.trim() === '' ||
        checkPayment.accountNr.trim() === '')
    ) {
      setError('יש להזין מספר שיק, בנק, סניף ומספר חשבון עבור תשלום השק')
      return
    }
    if (collectInterest && ((Number(interestAmount) || 0) <= 0 || !interestCode.trim())) {
      setError('אנא הכנס קוד פריט וסכום לחיוב הריבית')
      return
    }
    if (
      collectInterest &&
      interestPayment.method === 'check' &&
      (interestPayment.checkNr.trim() === '' ||
        interestPayment.bankNr.trim() === '' ||
        interestPayment.snifNr.trim() === '' ||
        interestPayment.accountNr.trim() === '')
    ) {
      setError('יש להזין מספר שיק, בנק, סניף ומספר חשבון עבור חיוב הריבית')
      return
    }
    const branchArea = getStoredBranchArea()
    if ((collectCheck || collectInterest) && branchArea === null) {
      setError('לא הוגדר סניף למחשב זה')
      return
    }

    setSaving(true)
    try {
      const lines: InvoiceLineInput[] = interestCode.trim()
        ? [
            {
              Code: Number(interestCode),
              Amount: Number(interestAmount) || 1,
              UnitPrice: interestUnitPrice.trim() !== '' ? Number(interestUnitPrice) : undefined,
            },
          ]
        : []

      const result = await repayBadCheck(badCheck.BadCheckNr, {
        branch_area: branchArea ?? undefined,
        pay_check: collectCheck ? { payments: [toPaymentInput(checkPayment)] } : undefined,
        pay_interest: collectInterest ? { lines, payments: [toPaymentInput(interestPayment)] } : undefined,
        family_name: familyName,
        cell_phone: cellPhone,
        street,
        home_nr: homeNr,
        town,
        zip_code: zipCode.trim() !== '' ? Number(zipCode) : undefined,
        reason,
        return_bank_name: returnBankName || undefined,
        statustxt,
        date1: notes[0].date, msg1: notes[0].msg,
        date2: notes[1].date, msg2: notes[1].msg,
        date3: notes[2].date, msg3: notes[2].msg,
        date4: notes[3].date, msg4: notes[3].msg,
        date5: notes[4].date, msg5: notes[4].msg,
      })
      setNote(
        [
          result.checkReceiptInvNr ? `הופקה קבלה מס' ${result.checkReceiptInvNr % 1_000_000} עבור השק` : null,
          result.interestInvoiceInvNr ? `הופקה חשבונית מס' ${result.interestInvoiceInvNr % 1_000_000} עבור הריבית` : null,
        ]
          .filter(Boolean)
          .join(' | ') || 'נשמר',
      )
      setCollectCheck(false)
      setCollectInterest(false)
      setCheckPayment(emptyPayment())
      setInterestPayment(emptyPayment())
      setInterestPaymentAmountTouched(false)
      onUpdated(result.badCheck)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירה')
    } finally {
      setSaving(false)
    }
  }

  async function reportLost() {
    setError(null)
    setSaving(true)
    try {
      const updated = await markBadCheckLost(badCheck.BadCheckNr)
      onUpdated(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xl font-bold">
          שק מס' {badCheck.CheckNr} — מונית {badCheck.TaxiNr}
        </h3>
        <button type="button" onClick={onBack} className="win-button px-2 py-0.5 text-lg">
          חזרה לחיפוש
        </button>
      </div>

      {error && <div className="mb-2 border border-red-300 bg-red-50 px-3 py-1.5 text-lg text-red-700">{error}</div>}
      {note && <div className="mb-2 border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-lg text-emerald-800">{note}</div>}

      <div className="mb-3 grid grid-cols-3 gap-2 border-b border-slate-300 pb-3 text-lg">
        <div>
          סכום השק: <span className="font-bold">{badCheck.Money.toFixed(2)}</span>
        </div>
        <div>
          בנק מקורי: <span className="font-bold">{badCheck.BankName ?? badCheck.BankNr ?? ''}</span>
        </div>
        <div>
          תאריך פרעון: <span className="font-bold">{badCheck.DueDate ?? ''}</span>
        </div>
        <div>
          ריבית/הוצאות (להיום): <span className="font-bold">{badCheck.Debit.toFixed(2)}</span>
        </div>
        <div>
          לתשלום: <span className="font-bold">{badCheck.ToPay.toFixed(2)}</span>
        </div>
        <div>
          שולם עד כה: <span className="font-bold">{badCheck.PaidCheck.toFixed(2)} + {badCheck.PaidOver.toFixed(2)} ריבית</span>
        </div>
      </div>

      {badCheck.Lost && (
        <div className="mb-3 border border-slate-400 bg-slate-100 px-3 py-2 text-lg text-slate-700">
          דווח כחוב אבוד — לא ניתן להמשיך לגבות שק זה.
        </div>
      )}

      {!badCheck.Lost && !badCheck.StillCollectible && (
        <div className="mb-3 border border-emerald-300 bg-emerald-50 px-3 py-2 text-lg text-emerald-800">שק זה שולם במלואו.</div>
      )}

      {badCheck.StillCollectible && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[15px] text-slate-600">שם משפחה</label>
              <input
                type="text"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                className="h-7 w-full border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[15px] text-slate-600">טל. נייד</label>
              <input
                type="text"
                value={cellPhone}
                onChange={(e) => setCellPhone(e.target.value)}
                className="h-7 w-full border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[15px] text-slate-600">רחוב</label>
              <input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                className="h-7 w-full border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[15px] text-slate-600">מס' בית</label>
              <input
                type="text"
                value={homeNr}
                onChange={(e) => setHomeNr(e.target.value)}
                className="h-7 w-full border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[15px] text-slate-600">עיר</label>
              <input
                type="text"
                value={town}
                onChange={(e) => setTown(e.target.value)}
                className="h-7 w-full border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[15px] text-slate-600">מיקוד</label>
              <input
                type="text"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                className="h-7 w-full border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
            </div>
          </div>

          <div className="mb-3 grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[15px] text-slate-600">סיבת החזרה</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-7 w-full border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              >
                <option value="">—</option>
                {options.reasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[15px] text-slate-600">הוחזר מבנק</label>
              <select
                value={returnBankName}
                onChange={(e) => setReturnBankName(e.target.value)}
                className="h-7 w-full border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              >
                <option value="">—</option>
                {options.banks.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[15px] text-slate-600">סטטוס</label>
              <input
                type="text"
                list="bad-check-statuses"
                value={statustxt}
                onChange={(e) => setStatustxt(e.target.value)}
                className="h-7 w-full border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
              />
              <datalist id="bad-check-statuses">
                {options.statuses.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="mb-3">
            <div className="mb-1 text-[15px] text-slate-600">מעקב טיפול (עד 5 רשומות)</div>
            <div className="space-y-1">
              {notes.map((n, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="DD/MM/YYYY"
                    value={n.date}
                    onChange={(e) => updateNote(i, { date: e.target.value })}
                    className="h-6 w-24 border border-slate-400 bg-white px-1 text-base shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={n.msg}
                    onChange={(e) => updateNote(i, { msg: e.target.value })}
                    className="h-6 flex-1 border border-slate-400 bg-white px-1 text-base shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                  />
                  {n.msg && !n.date && (
                    <button
                      type="button"
                      onClick={() => updateNote(i, { date: today() })}
                      className="win-button h-6 px-1 py-0 text-sm leading-none"
                    >
                      היום
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mb-3 border-t border-slate-300 pt-2">
            <label className="mb-1 flex items-center gap-2 text-lg font-bold">
              <input type="checkbox" checked={collectCheck} onChange={(e) => setCollectCheck(e.target.checked)} />
              גביית סכום השק
            </label>
            {collectCheck && <PaymentFields payment={checkPayment} onChange={(p) => setCheckPayment((prev) => ({ ...prev, ...p }))} />}
          </div>

          <div className="mb-3 border-t border-slate-300 pt-2">
            <label className="mb-1 flex items-center gap-2 text-lg font-bold">
              <input type="checkbox" checked={collectInterest} onChange={(e) => setCollectInterest(e.target.checked)} />
              חיוב ריבית/הוצאות (מוצע: {badCheck.Debit.toFixed(2)})
            </label>
            {collectInterest && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-[15px] text-slate-600">
                      קוד פריט{interestCodeName ? ` — ${interestCodeName}` : ''}
                    </label>
                    <input
                      type="text"
                      value={interestCode}
                      onChange={(e) => setInterestCode(e.target.value)}
                      className="h-6 w-20 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[15px] text-slate-600">כמות</label>
                    <input
                      type="text"
                      value={interestAmount}
                      onChange={(e) => setInterestAmount(e.target.value)}
                      className="h-6 w-14 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[15px] text-slate-600">מחיר</label>
                    <input
                      type="text"
                      value={interestUnitPrice}
                      onChange={(e) => setInterestUnitPrice(e.target.value)}
                      className="h-6 w-24 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                    />
                  </div>
                </div>
                <PaymentFields
                  payment={interestPayment}
                  onChange={(p) => {
                    if (p.amount !== undefined) setInterestPaymentAmountTouched(true)
                    setInterestPayment((prev) => ({ ...prev, ...p }))
                  }}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void save()} disabled={saving} className="win-button px-3 py-1 text-lg">
              {saving ? 'שומר...' : 'שמירה'}
            </button>
            {badCheck.PaidCheck === 0 && (
              <button type="button" onClick={() => void reportLost()} disabled={saving} className="win-button px-3 py-1 text-lg">
                דיווח כחוב אבוד
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
