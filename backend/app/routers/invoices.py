"""
Web equivalent of the invoice-issuing/viewing parts of Code/frmInvoice.frm
(4,325 lines) and Code/frmInvRec.frm (viewing/copying), reached from
Account.frm's cmdInvoices_Click ("חשבוניות") and cmdInvoiceCopy_Click
("העתק חשבונית").

ISSUABLE SCOPE (see WebCode/README.md): issuing is implemented for
HESHBONIT(1) "חשבונית", HESHBONIT_KABALA(0) "חש/קבלה", and KABALA(2) "קבלה".
Viewing/listing works for ALL types (it's just a read). The remaining 3
types are not yet issuable here — enforced below (ISSUABLE_TYPES), not just
in the frontend.

Ported:
- Sequential numbering, exactly matching SaveRec() in frmInvoice.frm: types
  HESHBONIT_KABALA(0) and HESHBONIT(1) share one combined number series (their
  *visible* number is InvNr % 1,000,000 and must not collide between the two);
  types 2-5 each get their own independent Type*1,000,000 range.
- VAT from the single CFG row (global rate, matches
  `VAT = cfgRec.Recordset![VAT]` in Account.frm).
- Line items priced from PriceList — defaults to the item's full combined
  price (sum of Price1..Price6) if no override given, matching ActivateLine()
  in frmInvRec.frm (confirmed 2026-08-19; Price1..6 are NOT per-Area/branch
  variants — an item priced across more than one column is paid off in that
  many separate payments, one per column, see InvoiceLineIn/create_invoice()'s
  handling of payments and InvoiceModal.tsx's priceListInstallments()).
  PriceList prices are VAT-INCLUSIVE, matching totalInvoice() in
  frmInvRec.frm: the line-item total is the gross/payable amount, and VAT is
  extracted out of it (net = gross*100/(100+VAT)), never added on top.
- Payment capture, ported from frmInvRec.frm's PaymentType encoding:
  1=cash("מ"), 2=check("ש"), 3/4/5=credit("א") per creditType() —
  3="regular"(רגיל), 4="credit"(קרדיט), 5="installments"(תשלומים, the only
  variant using CredPayments). The card-issuer picker (lstCredCard, a
  bank+20 offset into a BankName table) is NOT ported — cardNr/cardExpDate
  are stored as given, not validated against a card-company list.
- Buyer name/ID (Tz) capture for HESHBONIT_KABALA and KABALA, matching
  txtName/txtTZ's required-field validation in frmInvRec.frm's/frmRec.frm's
  cmdSave_Click (both must be non-blank/non-zero). Not collected for
  HESHBONIT, which never had these fields in the original form.
- KABALA (standalone קבלה): ported from frmRec.frm (a dedicated 5081-line
  form — NOT the same code as frmInvRec.frm). Confirmed that form has no
  line-item fields at all, only 6 payment slots — a receipt just records
  money received, it doesn't sell priced items. `TotalInvs` is explicitly
  zeroed and no VAT breakdown is computed (`SaveRec()` never touches
  txtMaam/VAT for this type) — the receipt's displayed Total/GrandTotal is
  the sum of its payment amounts instead (see _payments_total()). The
  "link to an invoice" button (cmdInv) is commented out/dead in the real
  form, so RecNr is left at 0 here too — no invoice-linking yet.

- Printing: replaced with a from-scratch HTML print view (invoice_print.py)
  since Crystal Reports has no web equivalent and the original .rpt files
  are opaque binary — see that module's docstring. Not a pixel-for-pixel
  port of the old layout, and the business's own letterhead details aren't
  in any confirmed table so they're a placeholder.
- Linking a HESHBONIT to the open קבלה that covers it (RecNr) — ported from
  checkRecNr()/txtRecNr_KeyUp in frmInvoice.frm: list_open_receipts()
  reproduces the F1 lookup (Type=2, not reset, not ignore-in-reset, not
  deleted, unconsumed balance — sum(Money1..6) > TotalInvs),
  validate_open_receipt() reproduces checkRecNr()'s three error messages
  ("קבלה לא נמצאה"/"קבלה שייכת לאיפוס"/"קבלה זו סגורה") for a manually-typed
  number, and create_invoice() re-validates and stores the receipt's RAW
  InvNr (not the display number) right before commit. Matches the original
  exactly in NOT scoping eligible receipts to the current TaxiNr — any
  taxi's open receipt can be linked. Also ported from cmdSave_Click: saving
  the invoice adds its own gross total onto the receipt's TotalInvs (`+=
  val(txtTotal)`), which is what actually reduces the receipt's open/
  remaining balance for next time — without this the same receipt could be
  linked past its real remaining balance.

- Service/insurance side-effects of line items, ported from the per-line
  loop right after `Call SaveHistory` in SaveRec() (frmInvRec.frm). Only
  applies to HESHBONIT_KABALA(0)/HESHBONIT(1) for a taxi (<80000) with a real
  meter attached (MeterNr not 0/99999). For each line, in order:
    - price_item.add_modem_service=True -> Account.ModemPaid = True.
    - price_item.add_insurance=True -> Meter.Insurance = False. IMPORTANT:
      confirmed via Account.frm's lblInsurance_Change-equivalent labels
      (`If ...insurance = False Then lblInsurance = "יש" Else lblInsurance =
      "אין"`) that Meter.Insurance is INVERTED — False means the meter HAS
      insurance, True means it doesn't. So add_insurance=True on the price
      item really does turn insurance "on" in the human sense, despite
      writing Insurance=False.
    - price_item.add_service=True -> also sets Meter.Insurance (False if
      this same line's add_insurance is also True, else True — i.e. a
      service-only line with no insurance add-on explicitly clears
      insurance), AND computes months to extend Meter.ExpDate by: if this
      line's subtotal equals the item's full combined price (Price1+...+
      Price6), that's 12 months (a one-shot full-year payment); otherwise
      it's an installment payment and the caller must supply
      InvoiceLineIn.AddMonths (1-18) — ported from the frmNrEnter prompt in
      the original, moved to a request field since there's no server-side
      interactive dialog here.
    - If the resulting extension would push ExpDate forward while the
      meter's current service hasn't actually expired yet, the original
      pops a confirm dialog ("ללקוח יש ביטוח בתוקף... לקדם תקופת ביטוח
      בכל זאת?"), resolved by resubmitting with confirm_extend_service=True
      (see InvoiceCreate docstring).
  When the ISSUING BRANCH's Area is Eilat(7), pricing/flagging uses
  PriceListEilat instead of PriceList — see PriceListEilat model docstring
  and _pricelist_model(). IMPORTANT: this is the BRANCH's Area (which
  office/computer issued the invoice), NOT the customer taxi's own
  Account.Area — confirmed via frmInvRec.frm's SaveRec(), where every `If
  Area = 7`/`InvRec.Recordset![Area] = Area`/`InvRec.Recordset![EILAT] =
  (Area = EILAT)` site reads the VB6 app's global `Public Area As Integer`
  (Main.bas, set once at startup from its own local meesql.cfg file), never
  AccountRec's own Area field. So a Tel-Aviv-based taxi invoiced from the
  Eilat branch gets Eilat pricing, and vice versa.
  Since this web app is ONE shared backend potentially serving browsers from
  several branches (unlike the original, where every installed copy WAS a
  single branch's own computer), the branch Area can't be a server-side
  constant — it's sent by the caller as InvoiceCreate.branch_area /
  list_pricelist()'s branch_area query param instead, which the frontend
  reads from a one-time-per-workstation local setting (see frontend
  src/api/branch.ts) — the web equivalent of that workstation's meesql.cfg.
  Viewing/reprinting a saved invoice instead keys off the invoice's own
  Eilat snapshot flag (set from whichever branch_area was sent at save
  time), so it stays correct regardless of what the current caller sends.

- HESHBONIT_ISKA(3) "חש. עסקה" — billed to a DIFFERENT account than the one
  issuing it. Ported from the `InvAction = 3` branches in SaveRec():
  payload.paid_by_taxi_nr is looked up in Accounts (must exist), its name
  becomes Invoices.namePaid, its TaxiNr becomes Invoices.AccPaid. The
  invoice's own combined `Name` field is left blank for this type — matches
  `If InvRec.Recordset![Type] <> HESHBONIT_ISKA Then name = ...` (i.e. name
  is explicitly NOT set when it IS iska) — FamilyName/PrivateName/etc. are
  still snapshotted from the issuing taxi's own account as usual.
- CREDIT_NOTE(4) "חשבונית זיכוי" — references the original document being
  credited via payload.credited_inv_nr, the RAW InvNr (not the display
  number — display numbers aren't globally unique, only unique WITHIN one
  type's series, so e.g. display number 1 can exist in both the
  HESHBONIT_KABALA/HESHBONIT series and HESHBONIT_ISKA's own series at the
  same time; only the full InvNr disambiguates) of one of THIS taxi's own
  HESHBONIT_KABALA/HESHBONIT/HESHBONIT_ISKA documents, stored as-is on
  Invoices.RecNr. The frontend already has this value whenever it's showing
  a specific invoice, so the caller never needs to "type" it. Deviates from
  the original in one way: frmInvoice.frm's txtRecNrCred took the raw typed
  value directly as RecNr with NO existence check and no taxi-scoping at
  all — here it's validated to actually exist, belong to this taxi, and be
  a creditable type, 404ing otherwise (safer, and matches how every other
  cross-reference in this app already works — see RecNr docstring on the
  Invoice model).
  A service-line (add_service) on a credit note REDUCES the meter's
  ExpDate by the given month count instead of extending it — ported
  verbatim from the `reduce_months`/`expDate - 10000` loop in SaveRec(),
  see _reduce_exp_date(). The confirm-dialog gate (`Not Expired(...)`) is
  the same as for a normal extension, but the ORIGINAL's actual behavior is
  asymmetric: extension applies whenever the meter is expired OR the user
  confirms, while reduction applies ONLY when the user explicitly confirms
  (an already-expired meter's service is never shortened, silently no-op)
  — reproduced exactly, not "fixed", since it may be intentional (no point
  shortening something already lapsed).
  Confirmed via SaveRec() that BOTH new types still trigger the meter/
  insurance/service side-effects block (`Type = HESHBONIT_KABALA Or Type =
  HESHBONIT Or Type = CREDIT_NOTE Or Type = HESHBONIT_ISKA`) — not just
  HESHBONIT_KABALA/HESHBONIT as Phase 1 had it.

NOT yet ported:
- TEUDAT_MISHLOAH(5) "תעודת משלוח" issuing — out of scope per user request,
  not needed.
- Card-issuer/bank lookup for credit payments (see above)
- Deletion (types 90-95 in the Actions table)
"""
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from ..database import get_db
from ..invoice_print import render_invoice_html
from ..models import (
    Account,
    Action,
    Area,
    Cfg,
    Check,
    Invoice,
    Meter,
    PriceListItem,
    PriceListEilat,
    History,
    HESHBONIT_KABALA,
    HESHBONIT,
    KABALA,
    HESHBONIT_ISKA,
    CREDIT_NOTE,
)
from ..schemas import (
    AreaOut,
    InvoiceCreate,
    InvoiceListItemOut,
    InvoiceLineOut,
    InvoiceMarkPrintedOut,
    InvoiceOut,
    NextInvoiceNumberOut,
    OpenReceiptOut,
    PaymentMethodIn,
    PaymentMethodOut,
    PriceListItemOut,
    VatRateOut,
)

RECEIPT_OFFSET = 2_000_000  # KABALA(2) * 1_000_000 — see compute_next_invoice_number

EILAT_AREA = 7  # matches `If Area = EILAT Then` in frmInvoice.frm

# compute_next_invoice_number() below is a plain MAX()+1 read with no
# locking (see its docstring) — under real concurrent branch traffic two
# requests can compute the same InvNr at once. create_invoice_core() retries
# the whole build-and-insert attempt this many times on a primary-key
# collision (SQLAlchemy IntegrityError) before giving up with a clean 409,
# rather than letting the loser hit the DB's raw constraint-violation error
# as an opaque 500 (code review 2026-09-22).
MAX_INVOICE_NUMBER_RETRIES = 5

router = APIRouter(tags=["invoices"])

LINE_COUNT = 6
ISSUABLE_TYPES = {HESHBONIT_KABALA, HESHBONIT, KABALA, HESHBONIT_ISKA, CREDIT_NOTE}
# KABALA (standalone קבלה) has NO line items at all — see frmRec.frm (the
# dedicated receipt form, 5081 lines): only 6 payment slots and buyer
# name/TZ, no txtParit/Amount/UnitPrice fields exist on that form.
NO_LINE_ITEM_TYPES = {KABALA}

# Taxis whose invoices can trigger the service/insurance side-effects below —
# matches `InvRec.Recordset![TaxiNr] < 80000` in SaveRec() (80000+ are
# pool/admin accounts without a real meter).
NO_METER_SENTINELS = (0, 99999)
_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def _is_expired(exp_date: Optional[int]) -> bool:
    """
    Ported from Public Function Expired() in Main.bas. exp_date is the same
    month*10000+year encoding as Meter.ExpDate/Account.MeterExpDate — 0/None
    counts as expired (matches `If ExpiredDate = 0 Then Expired = True`).
    """
    if not exp_date:
        return True
    month, year = exp_date // 10000, exp_date % 10000
    if month < 1 or month > 12 or year <= 0:
        return True
    days = _MONTH_DAYS[month - 1]
    if year in (2016, 2020, 2024) and days == 28:  # matches the original's leap-year special-case
        days = 29
    try:
        exp = date(year, month, days)
    except ValueError:
        return True
    return date.today() > exp


def _advance_exp_date(exp_date: Optional[int], months: int) -> int:
    """Ported verbatim from SaveRec()'s expDate rollover loop (month*10000+year encoding)."""
    result = (exp_date or 0) + months * 10000
    while result > 129999:
        result = result - 120000 + 1
    return result


def _reduce_exp_date(exp_date: Optional[int], months: int) -> int:
    """
    Ported verbatim from CREDIT_NOTE's reduce_months loop in SaveRec():
        While reduce_months > 0
            If Int(expDate / 10000) = 1 Then
                expDate = 120000 + expDate Mod 10000 - 1
            Else
                expDate = expDate - 10000
            End If
            reduce_months = reduce_months - 1
        Wend
    (month*10000+year encoding — January wraps back to December of the
    previous year, everything else just decrements the month digit.)
    """
    result = exp_date or 0
    for _ in range(months):
        if result // 10000 == 1:
            result = 120000 + result % 10000 - 1
        else:
            result -= 10000
    return result


def _pricelist_model(is_eilat: bool):
    """`If Area = 7 Then ... PriceListEilat ... Else ... PriceList` — see PriceListEilat model docstring."""
    return PriceListEilat if is_eilat else PriceListItem


def compute_next_invoice_number(db: Session, doc_type: int) -> int:
    """
    Ported from SaveRec() in Code/frmInvoice.frm. See that function and the
    Invoice model docstring for why types 0/1 are special-cased.

    NOTE: plain MAX()+1, no row/range locking — see MAX_INVOICE_NUMBER_RETRIES
    and create_invoice_core()'s retry loop for how a concurrent collision on
    the resulting InvNr is handled.
    """
    if doc_type in (0, 1):
        max_low = db.query(func.max(Invoice.InvNr)).filter(Invoice.InvNr < 1_000_000).scalar() or 0
        max_high_raw = db.query(func.max(Invoice.InvNr)).filter(Invoice.InvNr < 2_000_000).scalar() or 0
        max_high = max_high_raw % 1_000_000
        base = max(max_low, max_high)
        return base + 1 if doc_type == 0 else 1_000_000 + base + 1

    lo = doc_type * 1_000_000
    hi = (doc_type + 1) * 1_000_000
    max_n = db.query(func.max(Invoice.InvNr)).filter(Invoice.InvNr >= lo, Invoice.InvNr < hi).scalar()
    return (max_n + 1) if max_n is not None else (lo + 1)


def _action_label(db: Session, doc_type: Optional[int]) -> Optional[str]:
    if doc_type is None:
        return None
    action = db.get(Action, 60 + doc_type)
    return (action.action or "").strip() if action else None


def _invoice_lines(invoice: Invoice, price_names: dict[int, str]) -> list[InvoiceLineOut]:
    lines = []
    for i in range(1, LINE_COUNT + 1):
        code = getattr(invoice, f"Code{i}")
        if code is None:
            continue
        lines.append(
            InvoiceLineOut(
                Code=code,
                Description=price_names.get(code),
                Amount=getattr(invoice, f"Amount{i}"),
                UnitPrice=getattr(invoice, f"UnitPrice{i}"),
                SubTotal=getattr(invoice, f"SubTotal{i}"),
            )
        )
    return lines


def _payments_total(invoice: Invoice) -> float:
    return sum(getattr(invoice, f"Money{i}") or 0 for i in range(1, LINE_COUNT + 1))


def _validate_open_receipt(db: Session, display_nr: int) -> tuple[Invoice, float]:
    """
    Ported from checkRecNr() in frmInvoice.frm — same lookup (InvNr =
    display_nr + 2,000,000), same three failure messages in the same order,
    same "remaining = sum(Money1..6) - TotalInvs" open-balance check. NOTE:
    the original does NOT scope this to the current TaxiNr — a receipt from
    any taxi can be linked, exactly as reproduced here.
    """
    receipt = db.get(Invoice, display_nr + RECEIPT_OFFSET)
    if receipt is None or receipt.Deleted:
        raise HTTPException(status_code=404, detail="קבלה לא נמצאה")
    if (receipt.ResetNr or 0) != 0:
        raise HTTPException(status_code=409, detail="קבלה שייכת לאיפוס")
    remaining = _payments_total(receipt) - (receipt.TotalInvs or 0)
    if remaining <= 0:
        raise HTTPException(status_code=409, detail="קבלה זו סגורה")
    return receipt, remaining


def _to_list_item(db: Session, invoice: Invoice) -> InvoiceListItemOut:
    if invoice.Type == KABALA:
        # SaveRec() in frmRec.frm explicitly zeroes TotalInvs for a receipt
        # (it has no line items to sum) — the receipt's real amount is what
        # was actually collected, i.e. the sum of its payment slots.
        grand_total = _payments_total(invoice)
    else:
        grand_total = (invoice.TotalInvs or 0) + (invoice.totalVat or 0) if invoice.TotalInvs is not None else None
    return InvoiceListItemOut(
        InvNr=invoice.InvNr,
        DisplayNr=invoice.InvNr % 1_000_000,
        Type=invoice.Type,
        TypeLabel=_action_label(db, invoice.Type),
        Date=invoice.Date,
        Time=invoice.Time,
        Name=(invoice.Name or "").strip() or None,
        GrandTotal=grand_total,
        Deleted=invoice.Deleted,
        Printed=invoice.Printed,
    )


# PaymentType <-> creditType() in frmInvRec.frm: 3=regular(רגיל), 4=credit(קרדיט), 5=installments(תשלומים)
_CREDIT_TYPE_TO_PAYMENT_TYPE = {"regular": 3, "credit": 4, "installments": 5}
_PAYMENT_TYPE_TO_CREDIT_TYPE = {v: k for k, v in _CREDIT_TYPE_TO_PAYMENT_TYPE.items()}


def _invoice_payments(invoice: Invoice) -> list[PaymentMethodOut]:
    payments = []
    for i in range(1, LINE_COUNT + 1):
        payment_type = getattr(invoice, f"PaymentType{i}")
        if not payment_type:
            continue
        if payment_type == 1:
            method = "cash"
        elif payment_type == 2:
            method = "check"
        elif payment_type in _PAYMENT_TYPE_TO_CREDIT_TYPE:
            method = "credit"
        else:
            method = "unknown"
        payments.append(
            PaymentMethodOut(
                method=method,
                amount=getattr(invoice, f"Money{i}"),
                checkNr=getattr(invoice, f"CheckNr{i}"),
                bankNr=getattr(invoice, f"BankNr{i}"),
                snifNr=getattr(invoice, f"SnifNr{i}"),
                accountNr=getattr(invoice, f"AccountNr{i}"),
                checkDate=getattr(invoice, f"CheckDate{i}"),
                cardNr=(getattr(invoice, f"CCNr{i}") or "").strip() or None,
                cardExpDate=getattr(invoice, f"ExpDate{i}"),
                creditType=_PAYMENT_TYPE_TO_CREDIT_TYPE.get(payment_type),
                installments=getattr(invoice, f"CredPayments{i}"),
            )
        )
    return payments


def _apply_payments(invoice: Invoice, payments: list[PaymentMethodIn]) -> None:
    if len(payments) > LINE_COUNT:
        raise HTTPException(status_code=422, detail=f"At most {LINE_COUNT} payment methods are supported")
    for i, p in enumerate(payments, start=1):
        if p.method == "cash":
            payment_type = 1
        elif p.method == "check":
            payment_type = 2
            # All four required together, not just checkNr — CheckCheck() in
            # frmInvRec.frm always has AccountNr/SnifNr/BankNr in hand when it
            # runs (CLng()/CInt() on each, no null-guard), and _save_checks()'s
            # duplicate-check query below needs all four to mean anything: a
            # check number is only unique within one bank account, so a
            # checkNr-only requirement could silently save an incomplete,
            # unidentifiable check row (confirmed 2026-08-19).
            if p.checkNr is None or p.bankNr is None or p.snifNr is None or p.accountNr is None:
                raise HTTPException(
                    status_code=422,
                    detail="checkNr, bankNr, snifNr and accountNr are all required for check payments",
                )
        elif p.method == "credit":
            if p.creditType not in _CREDIT_TYPE_TO_PAYMENT_TYPE:
                raise HTTPException(
                    status_code=422,
                    detail="creditType must be one of 'regular', 'credit', 'installments' for credit payments",
                )
            payment_type = _CREDIT_TYPE_TO_PAYMENT_TYPE[p.creditType]
            if not p.cardNr or not p.cardExpDate:
                raise HTTPException(status_code=422, detail="cardNr and cardExpDate are required for credit payments")
            if p.creditType == "installments" and not p.installments:
                raise HTTPException(status_code=422, detail="installments is required when creditType is 'installments'")
        else:
            raise HTTPException(
                status_code=422,
                detail=f"Unsupported payment method '{p.method}' — only cash/check/credit are implemented",
            )
        setattr(invoice, f"PaymentType{i}", payment_type)
        setattr(invoice, f"Money{i}", p.amount)
        if p.method == "check":
            setattr(invoice, f"CheckNr{i}", p.checkNr)
            setattr(invoice, f"BankNr{i}", p.bankNr)
            setattr(invoice, f"SnifNr{i}", p.snifNr)
            setattr(invoice, f"AccountNr{i}", p.accountNr)
            setattr(invoice, f"CheckDate{i}", p.checkDate)
        elif p.method == "credit":
            setattr(invoice, f"CCNr{i}", p.cardNr)
            setattr(invoice, f"ExpDate{i}", p.cardExpDate)
            if p.creditType == "installments":
                setattr(invoice, f"CredPayments{i}", p.installments)


def _save_checks(db: Session, invoice: Invoice, payments: list[PaymentMethodIn], branch_area: int) -> None:
    """
    Ported from SaveChecks() in frmInvRec.frm — one Checks row per check
    payment slot, ADDITIONAL to (duplicating) the same data already stored
    inline on the Invoice row's PaymentTypeN/CheckNrN/... columns (see
    _apply_payments()). Only called for HESHBONIT_KABALA/KABALA — matches
    the original only invoking SaveChecks() for those two types. Feeds the
    checks-deposit report in routers/reset.py.

    A duplicate check is rejected up front, across ALL slots before
    inserting any of them — matches CheckCheck()'s pre-flight loop and its
    "!!!השק כבר נמצא במאגר" ("this check is already on file") message.
    "Duplicate" is CheckNr+AccountNr+SnifNr+BankNr together, exactly
    CheckCheck()'s own query (confirmed 2026-08-19 against frmInvRec.frm —
    see the Check model docstring) — NOT CheckNr alone, which previously let
    a real new check through the "already used" door incorrectly whenever
    its number happened to collide with some other bank's/account's check
    (false positive), while also failing to catch same-CheckNr reuse within
    the SAME bank/account/branch once AccountNr/SnifNr/BankNr genuinely
    matched too (false negative) — db.get() only ever looked at CheckNr.
    """
    checks = [p for p in payments if p.method == "check"]
    if not checks:
        return
    for p in checks:
        existing = (
            db.query(Check)
            .filter(
                Check.CheckNr == p.checkNr,
                Check.AccountNr == p.accountNr,
                Check.SnifNr == p.snifNr,
                Check.BankNr == p.bankNr,
            )
            .first()
        )
        if existing is not None:
            raise HTTPException(status_code=409, detail=f"!!!השק כבר נמצא במאגר ({p.checkNr})")
    for p in checks:
        db.add(
            Check(
                CheckNr=p.checkNr,
                AccountNr=p.accountNr,
                SnifNr=p.snifNr,
                BankNr=p.bankNr,
                InvNr=invoice.InvNr,
                Money=p.amount,
                DueDate=p.checkDate,
                ResetNr=0,
                Area=branch_area,
                BadCheck=False,
            )
        )


def _to_detail(db: Session, invoice: Invoice) -> InvoiceOut:
    # Matches `If InvRec.Recordset![EILAT] = True Then ... PriceListEilat`
    # used when viewing/reprinting an already-saved invoice — keyed off the
    # invoice's own snapshot flag (set at save time from the account's Area
    # then), not the account's current Area, so this stays correct even if
    # the taxi's Area is changed later.
    pricelist_model = _pricelist_model(bool(invoice.Eilat))
    price_names = {
        p.Code: (p.Name or "").strip()
        for p in db.query(pricelist_model).all()
    }
    lines = _invoice_lines(invoice, price_names)
    total = _payments_total(invoice) or None if invoice.Type == KABALA else (sum((l.SubTotal or 0) for l in lines) or None)
    list_item = _to_list_item(db, invoice)
    return InvoiceOut(
        **list_item.model_dump(),
        RecNr=invoice.RecNr,
        TaxiNr=invoice.TaxiNr,
        Tz=invoice.Tz,
        Town=(invoice.Town or "").strip() or None,
        Street=(invoice.Street or "").strip() or None,
        HomeNr=(invoice.HomeNr or "").strip() or None,
        ZipCode=invoice.ZipCode,
        Lines=lines,
        Total=total,
        Vat=invoice.Vat,
        TotalVat=invoice.totalVat,
        Payments=_invoice_payments(invoice),
    )


@router.get("/vat-rate", response_model=VatRateOut)
def get_vat_rate(db: Session = Depends(get_db)):
    cfg = db.query(Cfg).first()
    return VatRateOut(rate=(cfg.VAT if cfg and cfg.VAT is not None else 0) or 0)


@router.get("/invoices/next-number", response_model=NextInvoiceNumberOut)
def next_invoice_number(doc_type: int, db: Session = Depends(get_db)):
    """
    Preview only — see NextInvoiceNumberOut docstring. Numbering is global
    (not per-taxi), matching InvNr being the PK of the whole Invoices table.
    """
    if doc_type not in ISSUABLE_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Document type {doc_type} isn't issuable yet — only {sorted(ISSUABLE_TYPES)} are supported",
        )
    n = compute_next_invoice_number(db, doc_type)
    return NextInvoiceNumberOut(InvNr=n, DisplayNr=n % 1_000_000)


@router.get("/invoices/open-receipts", response_model=list[OpenReceiptOut])
def list_open_receipts(db: Session = Depends(get_db)):
    """
    Ported from the F1 lookup in txtRecNr_KeyUp (frmInvoice.frm):
    `SELECT InvNr, (InvNr % 1000000) as Exp1 from invoices where (ResetNr=0)
    and (Type=2) and (IgnoreInReset=0) and (deleted=0) and (TotalInvs <
    Money1+...+Money6)`. Same as the original, this is NOT scoped to any one
    TaxiNr — every taxi's open receipts are eligible to link a חשבונית to.
    """
    receipts = (
        db.query(Invoice)
        .filter(
            Invoice.Type == KABALA,
            (Invoice.ResetNr == 0) | (Invoice.ResetNr.is_(None)),
            (Invoice.IgnoreInReset == 0) | (Invoice.IgnoreInReset.is_(None)),
            Invoice.Deleted == False,  # noqa: E712
        )
        .order_by(Invoice.Date.desc(), Invoice.Time.desc())
        .all()
    )
    result = []
    for r in receipts:
        remaining = _payments_total(r) - (r.TotalInvs or 0)
        if remaining > 0:
            result.append(
                OpenReceiptOut(
                    DisplayNr=r.InvNr % 1_000_000,
                    TaxiNr=r.TaxiNr,
                    Name=(r.Name or "").strip() or None,
                    Date=r.Date,
                    Remaining=remaining,
                )
            )
    return result


@router.get("/invoices/open-receipts/{display_nr}/validate", response_model=OpenReceiptOut)
def validate_open_receipt(display_nr: int, db: Session = Depends(get_db)):
    """
    Ported from checkRecNr() in frmInvoice.frm — called when the user types a
    receipt number directly (Enter) rather than picking from the F1 list.
    """
    receipt, remaining = _validate_open_receipt(db, display_nr)
    return OpenReceiptOut(
        DisplayNr=receipt.InvNr % 1_000_000,
        TaxiNr=receipt.TaxiNr,
        Name=(receipt.Name or "").strip() or None,
        Date=receipt.Date,
        Remaining=remaining,
    )


@router.get("/areas", response_model=list[AreaOut])
def list_areas(db: Session = Depends(get_db)):
    """
    Lists the `Areas` lookup table (area nr + Hebrew name), used by the
    frontend's one-time branch-area setup UI (see src/api/branch.ts) so the
    person setting up a workstation can pick their branch by name rather
    than memorizing the digit that used to live in meesql.cfg.
    """
    rows = db.query(Area).order_by(Area.area).all()
    return [AreaOut(area=row.area, name=row.name) for row in rows]


@router.get("/pricelist", response_model=list[PriceListItemOut])
def list_pricelist(branch_area: int, db: Session = Depends(get_db)):
    """
    Lists PriceListEilat instead of PriceList when branch_area — the
    CALLER's branch (NOT any particular taxi's Account.Area), sent by the
    frontend from its per-workstation setting — is Eilat (7). Matches the
    RecordSource swap done at every price-list lookup site in the original
    (see PriceListEilat model docstring / create_invoice()'s module-docstring
    note on this).
    """
    model = _pricelist_model(branch_area == EILAT_AREA)

    items = db.query(model).order_by(model.Code).all()
    result = []
    for item in items:
        result.append(
            PriceListItemOut(
                Code=item.Code,
                Name=(item.Name or "").strip() or None,
                Price1=item.Price1,
                Price2=item.Price2,
                Price3=item.Price3,
                Price4=item.Price4,
                Price5=item.Price5,
                Price6=item.Price6,
                add_insurance=item.add_insurance,
                add_service=item.add_service,
                add_modem_service=item.add_modem_service,
            )
        )
    return result


@router.get("/account/{taxi_nr}/invoices", response_model=list[InvoiceListItemOut])
def list_invoices(taxi_nr: int, db: Session = Depends(get_db)):
    invoices = (
        db.query(Invoice)
        .filter(Invoice.TaxiNr == taxi_nr)
        .order_by(Invoice.Date.desc(), Invoice.Time.desc(), Invoice.InvNr.desc())
        .all()
    )
    return [_to_list_item(db, inv) for inv in invoices]


@router.get("/account/{taxi_nr}/invoices/{inv_nr}", response_model=InvoiceOut)
def get_invoice(taxi_nr: int, inv_nr: int, db: Session = Depends(get_db)):
    invoice = db.get(Invoice, inv_nr)
    if invoice is None or invoice.TaxiNr != taxi_nr:
        raise HTTPException(status_code=404, detail=f"No invoice {inv_nr} for taxi {taxi_nr}")
    return _to_detail(db, invoice)


@router.get("/account/{taxi_nr}/invoices/{inv_nr}/print", response_class=HTMLResponse)
def print_invoice(
    taxi_nr: int,
    inv_nr: int,
    copy: Optional[int] = Query(default=None, description="1='מקור' (original), 0='העתק' (copy) — matches the print-bridge's own convention. Omit to auto-derive from whether this invoice was ever printed before."),
    db: Session = Depends(get_db),
):
    """
    Web equivalent of cmdPrint_Click -> frmInvoiceRpt2.Show (Crystal Reports
    isn't available in this stack — see invoice_print.py docstring for why
    this is a from-scratch reconstruction, not a ported .rpt layout).
    Opening this view marks the invoice Printed=True, same as the original
    treating "printed" as "issued" — there's no separate confirmation step
    in the VB6 flow either.

    The single "הדפס" button on the frontend now decides the מקור/העתק label
    itself (via POST .../mark-printed, called first so it sees the PRE-print
    value) and passes `copy` explicitly — the auto-derive fallback here only
    matters for anyone hitting this URL directly without going through that
    call first (e.g. a bookmark).
    """
    invoice = db.get(Invoice, inv_nr)
    if invoice is None or invoice.TaxiNr != taxi_nr:
        raise HTTPException(status_code=404, detail=f"No invoice {inv_nr} for taxi {taxi_nr}")

    is_original = (not invoice.Printed) if copy is None else bool(copy)

    detail = _to_detail(db, invoice)
    html_doc = render_invoice_html(detail, copy=is_original)

    if not invoice.Printed:
        invoice.Printed = True
        db.commit()

    return HTMLResponse(content=html_doc)


@router.post("/account/{taxi_nr}/invoices/{inv_nr}/mark-printed", response_model=InvoiceMarkPrintedOut)
def mark_invoice_printed(taxi_nr: int, inv_nr: int, db: Session = Depends(get_db)):
    """
    Lets the frontend's single "הדפס" button decide מקור-vs-העתק for the
    Crystal print-bridge path, which calls localhost:9100 directly and never
    touches this backend — so it can't rely on print_invoice()'s own
    Printed-marking above. Returns whether this invoice had ALREADY been
    printed before this call (so the caller knows: never printed -> print as
    מקור), then marks it printed for next time. Idempotent — calling this
    again on an already-printed invoice just reports wasAlreadyPrinted=True
    and leaves Printed as-is.
    """
    invoice = db.get(Invoice, inv_nr)
    if invoice is None or invoice.TaxiNr != taxi_nr:
        raise HTTPException(status_code=404, detail=f"No invoice {inv_nr} for taxi {taxi_nr}")

    was_already_printed = bool(invoice.Printed)
    if not was_already_printed:
        invoice.Printed = True
        db.commit()

    return InvoiceMarkPrintedOut(wasAlreadyPrinted=was_already_printed)


@router.post("/account/{taxi_nr}/invoices", response_model=InvoiceOut)
def create_invoice(taxi_nr: int, payload: InvoiceCreate, db: Session = Depends(get_db)):
    """Public endpoint — always IgnoreInReset=0, matching every ordinary invoice in the original. See create_invoice_core() docstring for the one exception."""
    return create_invoice_core(taxi_nr, payload, db, ignore_in_reset=0)


def create_invoice_core(taxi_nr: int, payload: InvoiceCreate, db: Session, ignore_in_reset: int = 0) -> InvoiceOut:
    """
    The actual invoice-creation logic, factored out of the public
    create_invoice() endpoint so routers/bad_checks.py can reuse it with
    IgnoreInReset=1/2 — the ONE place in the original app that ever sets
    that flag to anything but 0 (Main.bas's global `IgnoreInReset`,
    transiently set around frmRec/frmInvRec calls from frmBackCheck's
    cmdSave_Click — see BadChecks model docstring). Deliberately NOT exposed
    as a field on InvoiceCreate/the public endpoint — secretaries issuing a
    normal invoice have no reason to set it, and doing so would silently
    change how that document reconciles in a future reset.
    """
    if payload.doc_type not in ISSUABLE_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Document type {payload.doc_type} isn't issuable yet — only {sorted(ISSUABLE_TYPES)} are supported",
        )
    if payload.doc_type in NO_LINE_ITEM_TYPES:
        if payload.lines:
            raise HTTPException(status_code=422, detail=f"Document type {payload.doc_type} doesn't take line items")
    else:
        if not payload.lines:
            raise HTTPException(status_code=422, detail="At least one line item is required")
        if len(payload.lines) > LINE_COUNT:
            raise HTTPException(status_code=422, detail=f"At most {LINE_COUNT} line items are supported")
    if payload.doc_type in (HESHBONIT_KABALA, KABALA) and not payload.payments:
        raise HTTPException(status_code=422, detail="מסמך זה דורש לפחות אמצעי תשלום אחד")
    if payload.doc_type in (HESHBONIT_KABALA, KABALA) and not (payload.buyer_name or "").strip():
        raise HTTPException(status_code=422, detail="אנא הכנס שם")  # matches txtName check in frmInvRec.frm/frmRec.frm
    if payload.doc_type in (HESHBONIT_KABALA, KABALA) and not payload.buyer_tz:
        raise HTTPException(status_code=422, detail="אנא הכנס ת.ז.")  # matches txtTZ check in frmInvRec.frm/frmRec.frm
    # `If InvAction = HESHBONIT And val(txtRecNr) = 0 Then` blocks save in
    # frmInvoice.frm — a plain חשבונית must reference the open קבלה that
    # covers it.
    if payload.doc_type == HESHBONIT and not payload.rec_nr:
        raise HTTPException(status_code=422, detail="אנא הכנס מס' קבלה")
    # `If InvAction = 3 And val(txtPaidbyNr) = 0 Then` in frmInvoice.frm.
    if payload.doc_type == HESHBONIT_ISKA and not payload.paid_by_taxi_nr:
        raise HTTPException(status_code=422, detail="אנא הכנס מספר הלקוח המשלם")
    if payload.doc_type == CREDIT_NOTE and not payload.credited_inv_nr:
        raise HTTPException(status_code=422, detail="אנא הכנס מספר חשבונית לזיכוי")

    account = db.get(Account, taxi_nr)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No account for TaxiNr {taxi_nr}")

    paid_by_account: Optional[Account] = None
    if payload.doc_type == HESHBONIT_ISKA:
        paid_by_account = db.get(Account, payload.paid_by_taxi_nr)
        if paid_by_account is None:
            raise HTTPException(status_code=404, detail=f"!!!לקוח לא נמצא {payload.paid_by_taxi_nr}")

    credited_invoice: Optional[Invoice] = None
    if payload.doc_type == CREDIT_NOTE:
        # credited_inv_nr is the RAW InvNr (not the display number) — the
        # frontend already has this whenever it's showing a specific
        # invoice (it's what GET .../invoices/{inv_nr} is keyed on), so
        # there's no need to make the caller retype a display number and
        # re-resolve it here. This matters because display numbers are only
        # unique WITHIN one type's series — HESHBONIT_KABALA/HESHBONIT share
        # one combined series but HESHBONIT_ISKA has its own, so e.g.
        # display number 1 can legitimately exist in both at once; only the
        # full InvNr (which encodes the type in its millions digit)
        # disambiguates. Still scoped/validated against this taxi's own
        # documents, unlike the original's txtRecNrCred which took a typed
        # number with NO existence check and no taxi-scoping at all.
        candidate = db.get(Invoice, payload.credited_inv_nr)
        if (
            candidate is None
            or candidate.TaxiNr != taxi_nr
            or candidate.Type not in (HESHBONIT_KABALA, HESHBONIT, HESHBONIT_ISKA)
            or candidate.Deleted
        ):
            raise HTTPException(
                status_code=404, detail=f"!!!חשבונית מס' {(payload.credited_inv_nr or 0) % 1_000_000} לא נמצאה עבור מונית זו"
            )
        credited_invoice = candidate

    cfg = db.query(Cfg).first()
    vat_rate = cfg.VAT if cfg and cfg.VAT is not None else 0

    # --- everything below builds a fresh Invoice (and touches meter/account/
    # receipt) and tries to insert it. Wrapped in a retry loop: a primary-key
    # collision on InvNr (compute_next_invoice_number() has no locking — see
    # its docstring and MAX_INVOICE_NUMBER_RETRIES above) rolls the session
    # back and rebuilds everything from scratch with a freshly-recomputed
    # number, rather than surfacing the DB's raw constraint error as an
    # opaque 500. account/paid_by_account/credited_invoice/cfg above are
    # read-only lookups that don't need to be redone on retry; SQLAlchemy
    # keeps them attached (and auto-refreshes them) across a rollback.
    for attempt in range(1, MAX_INVOICE_NUMBER_RETRIES + 1):
        doc_type = payload.doc_type
        now = datetime.now()  # computed in Python, not DB-side — func.current_date/time() isn't valid T-SQL

        buyer_name = (payload.buyer_name or "").strip()
        default_name = f"{(account.FamilyName or '').strip()} {(account.PrivatName or '').strip()}".strip()
        # THIS CALLER's branch (sent from the frontend's per-workstation
        # setting), not the taxi's Account.Area — see module docstring's Eilat note.
        branch_area = payload.branch_area

        invoice = Invoice(
            InvNr=compute_next_invoice_number(db, doc_type),
            TaxiNr=taxi_nr,
            Type=doc_type,
            Date=now.date(),
            Time=now.time(),
            Area=branch_area,
            # Explicitly zeroed to match InvRec.Recordset.AddNew in frmInvoice.frm,
            # which always sets these rather than leaving them at their column
            # default — cheap insurance against NOT NULL columns with no DB default.
            # ResetNr=0 in particular matches `InvRec.Recordset![ResetNr] = 0` in
            # the original and is what routers/reset.py's "not yet reset" scope
            # query relies on (previously missing here — invoices ended up with
            # a NULL ResetNr instead, silently working around it elsewhere via
            # an `= 0 OR IS NULL` pattern, but reset.py's queries expect a real 0).
            Deleted=False,
            Printed=False,
            IgnoreInReset=ignore_in_reset,
            ResetNr=0,
            Eilat=(branch_area == EILAT_AREA),
            # `If Type <> HESHBONIT_ISKA Then name = ...` — the combined Name
            # field is deliberately left blank for iska documents in the original.
            Name=None if doc_type == HESHBONIT_ISKA else (buyer_name or default_name),
            Tz=payload.buyer_tz,
            FamilyName=account.FamilyName,
            PrivateName=account.PrivatName,
            Town=account.Town,
            Street=account.Street,
            HomeNr=account.HomeNr,
            ZipCode=account.ZipCode,
            AccPaid=paid_by_account.TaxiNr if paid_by_account is not None else None,
            # PrivatName-then-FamilyName here (reversed from the FamilyName-then-
            # PrivatName order used for `Name`/default_name above) — matches
            # txtPaidbyNr_KeyPress's lookup assignment in frmInvoice.frm, which is
            # what's actually still in txtPaidbyName at save time (a different,
            # FamilyName-first order is used only when re-DISPLAYING an already-
            # saved iska document, not when saving one — reproduced as-is).
            namePaid=(
                f"{(paid_by_account.PrivatName or '').strip()} {(paid_by_account.FamilyName or '').strip()}".strip()
                if paid_by_account is not None
                else None
            ),
            RecNr=credited_invoice.InvNr if credited_invoice is not None else None,
        )

        if doc_type in NO_LINE_ITEM_TYPES:
            # Matches SaveRec() in frmRec.frm: `InvRec.Recordset![TotalInvs] = 0`
            # for a receipt — it has no line items and no VAT breakdown of its
            # own (whatever it's collecting against was already VAT-accounted
            # for on the original invoice, if any).
            invoice.TotalInvs = 0
            invoice.Vat = None
            invoice.totalVat = None
        else:
            # Service/insurance side-effects (see module docstring) apply to
            # HESHBONIT_KABALA/HESHBONIT/CREDIT_NOTE/HESHBONIT_ISKA for a real
            # taxi with a real meter attached — matches `Type = HESHBONIT_KABALA
            # Or Type = HESHBONIT Or Type = CREDIT_NOTE Or Type = HESHBONIT_ISKA`
            # in SaveRec() (NOT just the first two, as Phase 1 had it).
            meter: Optional[Meter] = None
            if (
                doc_type in (HESHBONIT_KABALA, HESHBONIT, CREDIT_NOTE, HESHBONIT_ISKA)
                and taxi_nr < 80000
                and account.MeterNr not in NO_METER_SENTINELS
            ):
                meter = db.get(Meter, account.MeterNr)
            exp_date_running = meter.ExpDate if meter is not None else None
            insurance_running = meter.Insurance if meter is not None else None
            meter_touched = False
            modem_paid = False
            # `If Area = 7 Then ... PriceListEilat ... Else ... PriceList` — the
            # BRANCH's Area (branch_area, from meesql.cfg), not the taxi's own
            # Account.Area — see PriceListEilat model docstring / _pricelist_model().
            pricelist_model = _pricelist_model(branch_area == EILAT_AREA)

            total = 0.0
            for i, line in enumerate(payload.lines, start=1):
                price_item = db.get(pricelist_model, line.Code)
                if price_item is None:
                    raise HTTPException(status_code=422, detail=f"Unknown price list code {line.Code}")
                # Default (no UnitPrice override from the client) is the item's FULL
                # combined price — sum of Price1..Price6, not just Price1 — matching
                # ActivateLine() in frmInvRec.frm, which sets both txtUnitPrice and
                # txtSubTotal to (Price1+...+Price6)*amount. The individual PriceN
                # values only matter for splitting the *payment schedule* when an
                # item has more than one of them (see InvoiceModal.tsx's
                # priceListInstallments()) — the invoice line itself is always
                # billed for the item's full price (confirmed 2026-08-19).
                unit_price = (
                    line.UnitPrice
                    if line.UnitPrice is not None
                    else sum(getattr(price_item, f"Price{n}") or 0 for n in range(1, 7))
                )
                subtotal = unit_price * line.Amount
                total += subtotal
                setattr(invoice, f"Code{i}", line.Code)
                setattr(invoice, f"Amount{i}", line.Amount)
                setattr(invoice, f"UnitPrice{i}", unit_price)
                setattr(invoice, f"SubTotal{i}", subtotal)

                if meter is not None:
                    if price_item.add_modem_service:
                        modem_paid = True

                    add_insurance_flag = bool(price_item.add_insurance)
                    line_add_months = 0
                    if price_item.add_service:
                        meter_touched = True
                        insurance_running = False if add_insurance_flag else True
                        full_total = sum(getattr(price_item, f"Price{n}") or 0 for n in range(1, 7))
                        if abs(subtotal - full_total) < 0.005:
                            line_add_months = 12
                        else:
                            # Installment payment (subtotal doesn't match the item's
                            # full combined price) — the office must say how many
                            # months this particular installment covers, same as
                            # the original's frmNrEnter prompt (1-18 months).
                            if line.AddMonths is None:
                                raise HTTPException(
                                    status_code=422,
                                    detail=f"פריט {line.Code}: אנא הכנס מס' חודשים לקידום (1-18)",
                                )
                            if not (1 <= line.AddMonths <= 18):
                                raise HTTPException(status_code=422, detail="מספר חודשים מירבי הוא 18")
                            line_add_months = line.AddMonths
                    if add_insurance_flag:
                        meter_touched = True
                        insurance_running = False

                    if line_add_months:
                        already_decided = payload.confirm_extend_service or payload.decline_extend_service
                        if not _is_expired(exp_date_running) and not already_decided:
                            if doc_type == CREDIT_NOTE:
                                raise HTTPException(
                                    status_code=409,
                                    detail="CONFIRM_EXTEND_SERVICE: ללקוח יש ביטוח בתוקף — לקצר תקופת ביטוח בכל זאת?",
                                )
                            raise HTTPException(
                                status_code=409,
                                detail="CONFIRM_EXTEND_SERVICE: ללקוח יש ביטוח בתוקף — לקדם תקופת ביטוח בכל זאת?",
                            )
                        if doc_type == CREDIT_NOTE:
                            # Asymmetric on purpose (matches the original): a
                            # credit note only ever SHORTENS the expiry when the
                            # user explicitly confirms — an already-expired
                            # meter's service is never shortened further, unlike
                            # the extend case below where "already expired"
                            # itself is sufficient to proceed without asking.
                            if payload.confirm_extend_service:
                                exp_date_running = _reduce_exp_date(exp_date_running, line_add_months)
                                meter_touched = True
                        elif _is_expired(exp_date_running) or payload.confirm_extend_service:
                            exp_date_running = _advance_exp_date(exp_date_running, line_add_months)
                            meter_touched = True
                        # else (decline_extend_service): matches the original's "no" branch — expDate left unchanged, save proceeds.

            if meter is not None and meter_touched:
                meter.Insurance = insurance_running
                meter.ExpDate = exp_date_running
            if modem_paid:
                account.ModemPaid = True

            # PriceList prices (and thus these line subtotals) are VAT-INCLUSIVE — `total`
            # here is the gross amount actually charged, matching txtTotal in
            # totalInvoice() (frmInvRec.frm). VAT is extracted out of it, not added on
            # top: txtTotalNet = total*100/(100+VAT), txtMaam (VAT amount) = total-net.
            net_total = (total * 100 / (100 + vat_rate)) if vat_rate else total
            total_vat = total - net_total
            invoice.TotalInvs = net_total  # net (pre-VAT) — GrandTotal = TotalInvs + totalVat recovers the gross total
            invoice.Vat = vat_rate
            invoice.totalVat = total_vat

            # Ported from checkInv() in frmInvRec.frm: `paid <> totalm` blocks
            # the save (paid = sum of the payment rows' amounts, totalm = sum of
            # the line subtotals = `total` here, the gross/pre-VAT-extraction
            # figure). The original silently no-ops the save button instead of
            # showing a message — treated as a bug to fix, not replicate, here.
            # Re-checked server-side (not just trusting the client) since this
            # is the actual money-integrity guarantee, matching the "recompute
            # right before commit" pattern used elsewhere in this function.
            # Skipped when payload.payments is empty: a plain חשבונית that
            # doesn't collect payment at creation has nothing to reconcile
            # against (see the doc_type checks above requiring payments only
            # for HESHBONIT_KABALA/KABALA).
            if payload.payments:
                paid = sum(p.amount for p in payload.payments)
                if abs(paid - total) >= 0.005:
                    raise HTTPException(
                        status_code=422,
                        detail=f"סכום התשלומים ({paid:.2f}) אינו תואם את סך החשבונית ({total:.2f})",
                    )

        _apply_payments(invoice, payload.payments)
        if doc_type in (HESHBONIT_KABALA, KABALA):
            _save_checks(db, invoice, payload.payments, branch_area)

        if doc_type == HESHBONIT:
            # Re-validated right before save (not just trusting an earlier
            # on-screen check) — same "recompute right before commit" pattern as
            # the invoice number itself. Stores the receipt's RAW InvNr, matching
            # `InvRec.Recordset![recnr] = frmMain.tmpInvRec.Recordset![invnr]`
            # in checkRecNr() — NOT the display number that was typed/shown.
            receipt, _remaining = _validate_open_receipt(db, payload.rec_nr)
            invoice.RecNr = receipt.InvNr
            # Ported from cmdSave_Click: `frmMain.tmpInvRec.Recordset![TotalInvs]
            # = frmMain.tmpInvRec.Recordset![TotalInvs] + val(txtTotal)` — adds
            # THIS invoice's gross total onto the receipt's own TotalInvs, which
            # is the same field _validate_open_receipt()'s `remaining` reads
            # (remaining = payments_total - TotalInvs). `total` here is the
            # gross/payable sum of this invoice's lines, matching txtTotal
            # exactly (confirmed via totalInvoice(): txtTotal = Format(sum,
            # ...), the pre-VAT-extraction gross figure — NOT invoice.TotalInvs,
            # which stores the NET amount on the invoice's own row). This is what
            # actually reduces the receipt's open/remaining balance going
            # forward — without it, the same receipt could be linked past its
            # real remaining balance.
            receipt.TotalInvs = (receipt.TotalInvs or 0) + total

        db.add(invoice)

        try:
            db.flush()  # get invoice.InvNr populated / row visible before the History write
        except IntegrityError:
            # Most likely cause: another concurrent request computed and
            # inserted the same InvNr first (compute_next_invoice_number()
            # has no locking — see its docstring). Roll back this attempt
            # entirely (discards this iteration's invoice/check/meter/
            # receipt/account changes — all cheap, deterministic recomputes)
            # and try again with a freshly-computed number. account/
            # paid_by_account/credited_invoice/cfg loaded above stay valid
            # and get auto-refreshed by SQLAlchemy on next access.
            db.rollback()
            if attempt == MAX_INVOICE_NUMBER_RETRIES:
                raise HTTPException(
                    status_code=409,
                    detail="לא ניתן להקצות מספר מסמך עקב עומס במקביל — נסה שוב",
                )
            continue
        except SQLAlchemyError as e:
            db.rollback()
            # Surfaced verbatim (not just a bare 500) so a schema mismatch is
            # diagnosable from the browser/network tab without digging through
            # `docker logs` — this table's nullability wasn't fully confirmed
            # against the live DB, see Invoice model docstring.
            raise HTTPException(status_code=500, detail=f"Database error while saving invoice: {e}") from e

        try:
            # Ported verbatim from SaveHistory() in frmInvoice.frm/frmInvRec.frm:
            #   HistoryRec![invoiceNr] = InvRec![invnr] Mod 1000000   <- DISPLAY number, not the raw InvNr
            #   HistoryRec![status]     = 60 + InvRec![Type]
            #   HistoryRec![Area]       = Area   <- the BRANCH's Area (meesql.cfg),
            #                                       not AccountRec's — same
            #                                       correction as invoice.Area/Eilat above.
            #   MeterNr/CarNr/ExpDate are only carried over "if TaxiNr < 80000" —
            #   80000+ are special/admin accounts without a real meter/car.
            #   No AmountPaid/AmountGet is set by this save path in the original.
            history_kwargs = dict(
                TaxiNr=taxi_nr,
                Status=60 + doc_type,
                Name=invoice.Name,
                InvoiceNr=invoice.InvNr % 1_000_000,
                InvType=doc_type,
                Date=invoice.Date,
                Time=invoice.Time,
                Area=branch_area,
            )
            if taxi_nr < 80000:
                history_kwargs["CarNr"] = account.CarNr
                if account.MeterNr is not None and account.MeterNr not in (0, 99999):
                    meter = db.get(Meter, account.MeterNr)
                    history_kwargs["MeterNr"] = account.MeterNr
                    if meter is not None:
                        history_kwargs["ExpDate"] = meter.ExpDate

            db.add(History(**history_kwargs))
            db.commit()
        except SQLAlchemyError as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Database error while saving invoice: {e}") from e

        db.refresh(invoice)
        return _to_detail(db, invoice)

    # Unreachable — the loop above always either returns or raises.
    raise HTTPException(status_code=500, detail="create_invoice_core: retry loop exited without returning")
