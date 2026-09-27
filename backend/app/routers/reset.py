"""
Web equivalent of the "reset" (איפוס) flow — Code VB6/frmReset1.frm's
Public Sub Reset(), reached from Account.frm's cmdReset button / F5.
frmReset.frm (an earlier form with the same internal name) is an unused
prototype not in Monitex2000.vbp — same dead-file pattern as frmMain.frm,
confirmed by grepping the .vbp.

WHAT THIS IS: once a branch has issued a batch of invoices/receipts, "reset"
closes that batch out — it tallies everything not yet reset (cash
collected, checks to deposit with their due dates, credit-card totals,
per-document-type counts/totals, a per-price-code revenue breakdown) into a
report, and on confirmation stamps every included Invoices/Checks row with a
new ResetNr so the next reset only picks up what's been issued since.

Ported faithfully:
- Which rows are in scope: Invoices where Area=branch_area, ResetNr=0, not
  Deleted (`InvRec.RecordSource = "... where ResetNr = 0 and Area=" & Area`).
- Per-type counting: HESHBONIT_KABALA/HESHBONIT_ISKA/CREDIT_NOTE are always
  counted; HESHBONIT additionally requires its linked receipt (RecNr) to
  exist when IgnoreInReset=0, else the reset is BLOCKED — matches the
  original's `Unload Me` abort (never silently proceeds with a report that
  doesn't reconcile). KABALA similarly blocks if IgnoreInReset=0 and its
  payment slots don't sum to TotalInvs ("קבלה לא סגורה").
- Payment breakdown (cash/checks/credit) only for HESHBONIT_KABALA/KABALA
  with IgnoreInReset != 1 — matches `(Type = HESHBONIT_KABALA Or Type =
  KABALA) And IgnoreInReset <> 1`. The cash condition itself is reproduced
  with the original's exact (slightly odd) operator precedence: `payment_type
  = 1 And IgnoreInReset = 0 Or (IgnoreInReset = 2 And Type = 0)` parses as
  `(payment_type=1 AND IgnoreInReset=0) OR (IgnoreInReset=2 AND Type=
  HESHBONIT_KABALA)` — the second branch counts ANY payment type as cash
  when IgnoreInReset=2 on a חש/קבלה, not just literal cash payments.
- Per-price-code ("kupa") breakdown, net of VAT, for HESHBONIT_KABALA/
  HESHBONIT/CREDIT_NOTE line items (CREDIT_NOTE subtracts) — unconditional
  on IgnoreInReset, matching the original's kupa loop having no such guard.
- Checks-deposit classification: a check is "cash now" if the chosen
  deposit date >= its due date (`cash_check()`), else "delayed" — same
  comparison, but WITHOUT this app's Saturday/holiday-skip adjustment on the
  deposit date itself (see below).
- Commit: ResetNr comes from CFG.IbudNr (read, used, then incremented —
  `frmMain.cfgRec.Recordset![ibudnr] = ... + 1`), an ActiveReset row is
  upserted per Area, a Resets row is appended (Processed=False), then EVERY
  Invoices/Checks row with ResetNr=0 for this Area is bulk-stamped with the
  new ResetNr — matches the tail of Reset() exactly (see model docstrings).

Deliberately NOT ported (see model docstrings for the fuller reasoning):
- Multi-company credit-card routing (Visa/Isracard/Diners/Amex) — confirmed
  dead code in the live form (entirely commented out); only one combined
  credit bucket is ever populated, reproduced here as creditImmediateTotal/
  creditInstallmentsTotal.
- Per-deposit-slip check batching (groups of 7/20 for a paper bank form).
- The magnetic "מס״ב" bank-deposit export file and the Saturday/holiday-skip
  date-rolling helpers (find_deposit_date/init_credit_deposit_dates) — the
  holiday table is hardcoded to ~2005-2015 and is already a silent no-op in
  the live app for any date since (`If year(checkDate) - 2005 > 10 Then
  holiday = False`), so this app just uses the deposit date as entered.
- "Returned checks" (BadChecks) rollback into the report — that whole
  subsystem (frmBackCheck.frm) isn't ported elsewhere in this app either.
- The two admin correction tools reachable via Shift+F5 ("Demi Reset") and
  Alt+F5/Alt+F10 (delete an invoice from a past reset) — not exposed here.
- The password gate before a non-HQ (Area<>0) reset (frmPasswordEnter) —
  this app has no auth/login system at all yet (see WebCode/README.md), so
  nothing here is more or less gated than any other screen.
"""
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..movein_export import build_movein_dat
from ..models import (
    Area,
    Cfg,
    Check,
    Invoice,
    ActiveReset,
    Reset as ResetRow,
    PriceListItem,
    PriceListEilat,
    HESHBONIT_KABALA,
    HESHBONIT,
    KABALA,
    HESHBONIT_ISKA,
    CREDIT_NOTE,
)
from ..schemas import (
    PendingHashResetOut,
    ResetCheckOut,
    ResetCommitIn,
    ResetCommitOut,
    ResetKupaLineOut,
    ResetLookupOut,
    ResetPreviewOut,
)

router = APIRouter(prefix="/api/reset", tags=["reset"])

LINE_COUNT = 6
_INVOICE_LIKE_TYPES = {HESHBONIT_KABALA, HESHBONIT, HESHBONIT_ISKA}


def _gross_total(invoice: Invoice) -> float:
    return sum(getattr(invoice, f"SubTotal{i}") or 0 for i in range(1, LINE_COUNT + 1))


def _payments_total(invoice: Invoice) -> float:
    return sum(getattr(invoice, f"Money{i}") or 0 for i in range(1, LINE_COUNT + 1))


def _parse_due_date(raw: Optional[str]) -> Optional[date]:
    """Checks.DueDate / CheckDateN are stored "DD/MM/YYYY" strings, not real date columns."""
    if not raw:
        return None
    try:
        return datetime.strptime(raw.strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


def _compute_reset_totals(db: Session, branch_area: int, deposit_date: date, deposit_bank: int) -> ResetPreviewOut:
    invoices = (
        db.query(Invoice)
        .filter(
            Invoice.Area == branch_area,
            # NULL-safe: create_invoice() now always sets ResetNr=0, but any
            # invoice saved before that fix has a NULL ResetNr instead of 0.
            (Invoice.ResetNr == 0) | (Invoice.ResetNr.is_(None)),
            # NOT `.isnot(True)` — SQLAlchemy compiles that to `IS NOT 1` for
            # the mssql dialect, which SQL Server rejects outright (T-SQL's
            # IS/IS NOT only ever accepts NULL, never a literal value —
            # "Incorrect syntax near '1'."). Same NULL-safe OR pattern as
            # ResetNr above: real DB has plenty of legacy rows with a NULL
            # Deleted instead of explicit 0, and those should count as "not
            # deleted" same as the original VB6 form treated them.
            (Invoice.Deleted == False) | (Invoice.Deleted.is_(None)),  # noqa: E712
        )
        .all()
    )

    blocking: list[str] = []

    inv_recs_count = invoices_count = receipts_count = iska_count = credits_count = 0
    inv_recs_total = invoices_total = receipts_total = iska_total = credits_total = 0.0

    cash_total = 0.0
    credit_immediate_total = 0.0
    credit_installments_total = 0.0

    kupa: dict[int, dict] = {}  # Code -> {"count": int, "total": float}

    for inv in invoices:
        gross = _gross_total(inv)
        ignore = inv.IgnoreInReset or 0

        if inv.Type == HESHBONIT_KABALA:
            inv_recs_count += 1
            inv_recs_total += gross
        elif inv.Type == HESHBONIT:
            if ignore == 0:
                receipt = db.get(Invoice, inv.RecNr) if inv.RecNr else None
                if receipt is None:
                    display_nr = (inv.RecNr or 0) % 1_000_000
                    blocking.append(f"קבלה מס. {display_nr} !!!לא נמצאה (חשבונית {inv.InvNr % 1_000_000})")
            invoices_count += 1
            invoices_total += gross
        elif inv.Type == KABALA:
            if ignore == 0 and abs(_payments_total(inv) - (inv.TotalInvs or 0)) > 0.005:
                blocking.append(f"!!!קבלה מס. {inv.InvNr % 1_000_000} לא סגורה")
            receipts_count += 1
            receipts_total += _payments_total(inv)
        elif inv.Type == HESHBONIT_ISKA:
            iska_count += 1
            iska_total += gross
        elif inv.Type == CREDIT_NOTE:
            credits_count += 1
            credits_total += gross

        # Kupa (per-price-code, net-of-VAT) breakdown — HESHBONIT_KABALA/
        # HESHBONIT/CREDIT_NOTE lines only, unconditional on IgnoreInReset.
        if inv.Type in (HESHBONIT_KABALA, HESHBONIT, CREDIT_NOTE):
            act_vat = 0 if inv.Eilat else (inv.Vat or 0)
            for i in range(1, LINE_COUNT + 1):
                code = getattr(inv, f"Code{i}")
                if not code:
                    continue
                sub_total = getattr(inv, f"SubTotal{i}") or 0
                net = sub_total - (sub_total * act_vat / (100 + act_vat) if act_vat else 0)
                signed_net = -net if inv.Type == CREDIT_NOTE else net
                bucket = kupa.setdefault(code, {"count": 0, "total": 0.0})
                bucket["count"] += 1
                bucket["total"] += signed_net

        # Payment breakdown — only HESHBONIT_KABALA/KABALA, not fully ignored.
        if inv.Type in (HESHBONIT_KABALA, KABALA) and ignore != 1:
            for i in range(1, LINE_COUNT + 1):
                payment_type = getattr(inv, f"PaymentType{i}")
                money = getattr(inv, f"Money{i}") or 0
                if not payment_type:
                    continue
                # `payment_type = 1 And ignore = 0 Or (ignore = 2 And Type = HESHBONIT_KABALA)`
                # — VB6 operator precedence reproduced exactly, see module docstring.
                if (payment_type == 1 and ignore == 0) or (ignore == 2 and inv.Type == HESHBONIT_KABALA):
                    cash_total += money
                elif payment_type in (3, 4):
                    credit_immediate_total += money
                elif payment_type == 5:
                    credit_installments_total += money

    if blocking:
        # Match the original's hard abort — a reset can't be run (even just
        # previewed) while these exist, since the totals wouldn't reconcile.
        return ResetPreviewOut(
            branchArea=branch_area,
            depositDate=deposit_date.isoformat(),
            depositBank=deposit_bank,
            blocking=blocking,
            invRecsCount=inv_recs_count,
            invRecsTotal=round(inv_recs_total, 2),
            invoicesCount=invoices_count,
            invoicesTotal=round(invoices_total, 2),
            receiptsCount=receipts_count,
            receiptsTotal=round(receipts_total, 2),
            iskaCount=iska_count,
            iskaTotal=round(iska_total, 2),
            creditsCount=credits_count,
            creditsTotal=round(credits_total, 2),
            totalKupa=0,
            totalVat=0,
            cashTotal=0,
            checksCashNowTotal=0,
            checksCashNowCount=0,
            checksDelayedTotal=0,
            checksDelayedCount=0,
            checks=[],
            creditImmediateTotal=0,
            creditInstallmentsTotal=0,
            totalDepo=0,
            kupaBreakdown=[],
        )

    # Checks table — populated at invoice-save time alongside the inline
    # PaymentTypeN slots (see routers/invoices.py's _save_checks()). Used
    # here for the itemized list; joined against Invoices to respect the
    # same IgnoreInReset<>1 gate as the cash/credit breakdown above.
    check_rows = (
        db.query(Check, Invoice.TaxiNr, Invoice.IgnoreInReset)
        .join(Invoice, Invoice.InvNr == Check.InvNr)
        .filter(Check.Area == branch_area, Check.ResetNr == 0, Invoice.Type.in_([HESHBONIT_KABALA, KABALA]))
        .all()
    )
    checks_out: list[ResetCheckOut] = []
    checks_cash_now_total = checks_delayed_total = 0.0
    checks_cash_now_count = checks_delayed_count = 0
    for check, taxi_nr, ignore_in_reset in check_rows:
        if (ignore_in_reset or 0) == 1:
            continue
        due = _parse_due_date(check.DueDate)
        cash_now = due is not None and deposit_date >= due
        money = check.Money or 0
        if cash_now:
            checks_cash_now_total += money
            checks_cash_now_count += 1
        else:
            checks_delayed_total += money
            checks_delayed_count += 1
        checks_out.append(
            ResetCheckOut(
                checkNr=check.CheckNr,
                taxiNr=taxi_nr,
                bankNr=check.BankNr,
                accountNr=check.AccountNr,
                snifNr=check.SnifNr,
                dueDate=check.DueDate,
                money=money,
                cashNow=cash_now,
            )
        )
    checks_out.sort(key=lambda c: (not c.cashNow, c.dueDate or ""))

    # Kupa line names — joined against whichever PriceList table each code
    # actually belongs to (regular vs Eilat can't be told apart by code
    # alone, so this checks both, preferring a regular-table match).
    kupa_names: dict[int, str] = {}
    for model in (PriceListItem, PriceListEilat):
        for row in db.query(model).filter(model.Code.in_(kupa.keys())).all():
            kupa_names.setdefault(row.Code, (row.Name or "").strip())
    kupa_breakdown = [
        ResetKupaLineOut(code=code, name=kupa_names.get(code), count=data["count"], total=round(data["total"], 2))
        for code, data in sorted(kupa.items())
    ]

    total_kupa = inv_recs_total + invoices_total - credits_total
    # Proper sum of each invoice's own VAT amount — the original's
    # ActiveResetRec![TotalVat] = temp_vat only ever captured the LAST
    # line's VAT (a loop variable read after the loop, not a running total),
    # which looks like a bug rather than intentional; summing instead.
    total_vat = sum(
        (inv.totalVat or 0)
        for inv in invoices
        if inv.Type in (HESHBONIT_KABALA, HESHBONIT, HESHBONIT_ISKA, CREDIT_NOTE)
    )
    total_depo = cash_total + checks_cash_now_total + checks_delayed_total + credit_immediate_total + credit_installments_total

    return ResetPreviewOut(
        branchArea=branch_area,
        depositDate=deposit_date.isoformat(),
        depositBank=deposit_bank,
        blocking=[],
        invRecsCount=inv_recs_count,
        invRecsTotal=round(inv_recs_total, 2),
        invoicesCount=invoices_count,
        invoicesTotal=round(invoices_total, 2),
        receiptsCount=receipts_count,
        receiptsTotal=round(receipts_total, 2),
        iskaCount=iska_count,
        iskaTotal=round(iska_total, 2),
        creditsCount=credits_count,
        creditsTotal=round(credits_total, 2),
        totalKupa=round(total_kupa, 2),
        totalVat=round(total_vat, 2),
        cashTotal=round(cash_total, 2),
        checksCashNowTotal=round(checks_cash_now_total, 2),
        checksCashNowCount=checks_cash_now_count,
        checksDelayedTotal=round(checks_delayed_total, 2),
        checksDelayedCount=checks_delayed_count,
        checks=checks_out,
        creditImmediateTotal=round(credit_immediate_total, 2),
        creditInstallmentsTotal=round(credit_installments_total, 2),
        totalDepo=round(total_depo, 2),
        kupaBreakdown=kupa_breakdown,
    )


@router.get("/preview", response_model=ResetPreviewOut)
def preview_reset(branch_area: int, deposit_date: date, deposit_bank: int, db: Session = Depends(get_db)):
    return _compute_reset_totals(db, branch_area, deposit_date, deposit_bank)


@router.post("/commit", response_model=ResetCommitOut)
def commit_reset(payload: ResetCommitIn, db: Session = Depends(get_db)):
    try:
        deposit_date = date.fromisoformat(payload.deposit_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="deposit_date must be YYYY-MM-DD")

    summary = _compute_reset_totals(db, payload.branch_area, deposit_date, payload.deposit_bank)
    if summary.blocking:
        raise HTTPException(status_code=409, detail=summary.blocking)
    if summary.invRecsCount + summary.invoicesCount + summary.receiptsCount + summary.iskaCount + summary.creditsCount == 0:
        # Matches `documents = 0 -> "!!!כל המסמכים מאופסים"` — nothing to reset.
        raise HTTPException(status_code=409, detail="!!!כל המסמכים מאופסים")

    cfg = db.query(Cfg).first()
    if cfg is None or cfg.IbudNr is None:
        raise HTTPException(status_code=500, detail="CFG.IbudNr not configured — cannot allocate a reset number")
    reset_nr = cfg.IbudNr
    cfg.IbudNr = reset_nr + 1

    now = datetime.now()
    totals_kwargs = dict(
        DepoBank=payload.deposit_bank,
        ResetDate=now.date(),
        DepositDate=deposit_date,
        InvRecs=summary.invRecsCount,
        TotalInvRecs=summary.invRecsTotal,
        Invoices=summary.invoicesCount,
        TotalInvoices=summary.invoicesTotal,
        Recs=summary.receiptsCount,
        TotalRecs=summary.receiptsTotal,
        Iskas=summary.iskaCount,
        TotalIskas=summary.iskaTotal,
        Credits=summary.creditsCount,
        TotalCredits=summary.creditsTotal,
        TotalKupa=summary.totalKupa,
        TotalVat=summary.totalVat,
        CashDepo=summary.cashTotal,
        CashChecksNr=summary.checksCashNowCount,
        DelayedChecksNr=summary.checksDelayedCount,
        # Combined total in slot 1, slots 2-10 explicitly zeroed — NOT the
        # original's true batch-of-7/15 split (see ActiveReset's model
        # docstring for why), but Crystal's print report reads these columns
        # directly, so leaving them all NULL made the printed check totals
        # show blank rather than just "not batched".
        CashChecks1=summary.checksCashNowTotal,
        CashChecks2=0.0, CashChecks3=0.0, CashChecks4=0.0, CashChecks5=0.0,
        CashChecks6=0.0, CashChecks7=0.0, CashChecks8=0.0, CashChecks9=0.0, CashChecks10=0.0,
        DelayedChecksList1=summary.checksDelayedTotal,
        DelayedChecksList2=0.0, DelayedChecksList3=0.0, DelayedChecksList4=0.0, DelayedChecksList5=0.0,
        DelayedChecksList6=0.0, DelayedChecksList7=0.0, DelayedChecksList8=0.0, DelayedChecksList9=0.0, DelayedChecksList10=0.0,
        # Only the single active credit bucket is populated — see module
        # docstring. The other three are explicitly zeroed rather than left
        # untouched: ActiveReset is a per-branch row that gets REUSED across
        # resets, so skipping them here would let a stale value from some
        # earlier reset linger and print as if it were this reset's number.
        CreditVisaN=summary.creditImmediateTotal,
        CreditVisaP=summary.creditInstallmentsTotal,
        CreditIsraN=0.0, CreditIsraP=0.0,
        CreditDinersN=0.0, CreditDinersP=0.0,
        CreditAmexN=0.0, CreditAmexP=0.0,
        TotalDepo=summary.totalDepo,
        BackChecksNr=0,
        TotBackChecks=0,
        ChecksPaidNr=0,
        TotChecksPaid=0,
    )

    active = db.get(ActiveReset, payload.branch_area)
    if active is None:
        active = ActiveReset(Area=payload.branch_area)
        db.add(active)
    for k, v in totals_kwargs.items():
        setattr(active, k, v)
    # NOT active.ResetNr = reset_nr. ActiveReset is the branch's current
    # staging row, and the print bridge's /print/reset/active route always
    # requests ResetNr=0 for it (see print-bridge/README.md's HTTP contract
    # and MonitexPrintBridge.ps1's Handle-ResetActive) — the real allocated
    # number belongs only on the Resets history row below. Setting it here
    # made the just-committed reset's own "print active reset" button come
    # back with correct totals but every value blank: the report's own
    # query never matched a ResetNr=0 row for this Area once this line
    # overwrote it with the real number. Confirmed 2026-08-18 by comparing
    # a working /print/reset/past?resetNr=<real> call (finds the Resets
    # row, prints fine) against the broken /print/reset/active call (always
    # ResetNr=0, found nothing once this field held the real number).
    active.ResetNr = 0

    db.add(ResetRow(ResetNr=reset_nr, Processed=False, Area=payload.branch_area, **totals_kwargs))

    db.query(Invoice).filter(
        Invoice.Area == payload.branch_area,
        (Invoice.ResetNr == 0) | (Invoice.ResetNr.is_(None)),  # see the NULL-safety note in _compute_reset_totals()
    ).update({Invoice.ResetNr: reset_nr}, synchronize_session=False)
    db.query(Check).filter(Check.Area == payload.branch_area, Check.ResetNr == 0).update(
        {Check.ResetNr: reset_nr}, synchronize_session=False
    )

    db.commit()

    # movein.dat is deliberately NOT generated/delivered here anymore
    # (removed 2026-09-27). Confirmed via frmSendtoHash.frm: the real
    # workflow never writes it automatically at commit time in practice --
    # a reset commit just closes out the batch, and movein.dat only gets
    # generated later, on-demand, whenever the operator actually processes
    # it through the "העברה לחשבשבת" (Transfer to Hashavshevת) screen --
    # see list_pending_hash_resets()/mark_reset_processed() below, and
    # SendToHashModal.tsx. That screen re-runs the exact same Reset(
    # ResetNr) logic (this app: build_movein_dat()) fresh at that moment,
    # so generating it a second time here at commit was pure redundancy --
    # extra work and an extra bridge-delivery failure surface on every
    # single reset, for a file nobody reads until it's regenerated anyway.

    return ResetCommitOut(resetNr=reset_nr, summary=summary)


def _to_lookup_out(row: ResetRow) -> ResetLookupOut:
    return ResetLookupOut(
        resetNr=row.ResetNr,
        area=row.Area,
        resetDate=row.ResetDate.isoformat() if row.ResetDate else None,
        depositDate=row.DepositDate.isoformat() if row.DepositDate else None,
        depositBank=row.DepoBank,
        invRecsCount=row.InvRecs or 0,
        invRecsTotal=round(row.TotalInvRecs or 0, 2),
        invoicesCount=row.Invoices or 0,
        invoicesTotal=round(row.TotalInvoices or 0, 2),
        receiptsCount=row.Recs or 0,
        receiptsTotal=round(row.TotalRecs or 0, 2),
        iskaCount=row.Iskas or 0,
        iskaTotal=round(row.TotalIskas or 0, 2),
        creditsCount=row.Credits or 0,
        creditsTotal=round(row.TotalCredits or 0, 2),
        totalKupa=round(row.TotalKupa or 0, 2),
        totalVat=round(row.TotalVat or 0, 2),
        cashTotal=round(row.CashDepo or 0, 2),
        checksCashNowTotal=round(row.CashChecks1 or 0, 2),
        checksCashNowCount=row.CashChecksNr or 0,
        checksDelayedTotal=round(row.DelayedChecksList1 or 0, 2),
        checksDelayedCount=row.DelayedChecksNr or 0,
        creditImmediateTotal=round(row.CreditVisaN or 0, 2),
        creditInstallmentsTotal=round(row.CreditVisaP or 0, 2),
        totalDepo=round(row.TotalDepo or 0, 2),
    )


@router.get("/lookup", response_model=ResetLookupOut)
def lookup_reset(
    reset_nr: Optional[int] = None,
    reset_date: Optional[date] = None,
    branch_area: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """
    Ported from Account.frm's Alt+F5 shortcut (txtTaxiNr_KeyDown, ~line 3426)
    — the original's only way to find a past reset for reprinting, other
    than already knowing it. Two mutually exclusive search modes, matching
    the VB6 form's sequential prompts exactly:

    - reset_nr given (VB6: date prompt left blank) ->
      `select * from resets where resetNr = <n>`
    - reset_date + branch_area given (VB6: date entered, then area prompted)
      -> `select * from resets where resetdate = 'YYYY-MM-DD' and area = <n>`

    The original expects exactly one match and has no result grid — if a
    date+area matches more than one reset it silently takes whichever row
    the recordset lands on first, with no defined order. Reproduced here by
    taking the lowest ResetNr among matches, which is at least deterministic
    (an improvement the VB6 form doesn't make, flagged since this app's
    convention is to call out every such deviation explicitly).
    """
    if reset_nr is not None:
        row = db.get(ResetRow, reset_nr)
    elif reset_date is not None and branch_area is not None:
        row = (
            db.query(ResetRow)
            .filter(ResetRow.ResetDate == reset_date, ResetRow.Area == branch_area)
            .order_by(ResetRow.ResetNr.asc())
            .first()
        )
    else:
        raise HTTPException(
            status_code=422,
            detail="Provide either reset_nr, or both reset_date and branch_area",
        )

    if row is None:
        # Matches the original's "!!!האיפוס לא נמצא" message.
        raise HTTPException(status_code=404, detail="!!!האיפוס לא נמצא")

    return _to_lookup_out(row)


@router.get("/pending-hash", response_model=list[PendingHashResetOut])
def list_pending_hash_resets(db: Session = Depends(get_db)):
    """
    Faithful port of frmSendtoHash.frm's Form_Load() grid query — "העברה
    לחשבשבת" ("Transfer to Hashavshevת"), the original screen listing every
    reset not yet marked as successfully sent:

        SELECT Resets.resetdate, resets.resetnr, Areas.name AS Expr1
        FROM Resets INNER JOIN Areas ON Resets.area = Areas.area
        WHERE Resets.Processed = 'False'
        ORDER BY Resets.area, resets.resetdate DESC

    `Processed = 'False'` in the original matches an explicit False only,
    not NULL — reproduced here as `== False` rather than treating NULL as
    equivalent, even though every row this app itself creates always sets
    Processed=False explicitly (see the Reset model's docstring), so this
    only matters for rows this app didn't create.
    """
    rows = (
        db.query(ResetRow, Area.name)
        .join(Area, ResetRow.Area == Area.area)
        .filter(ResetRow.Processed == False)  # noqa: E712
        .order_by(ResetRow.Area.asc(), ResetRow.ResetDate.desc())
        .all()
    )
    return [
        PendingHashResetOut(
            resetNr=reset_row.ResetNr,
            area=reset_row.Area,
            areaName=(area_name or "").strip(),
            resetDate=reset_row.ResetDate.isoformat() if reset_row.ResetDate else None,
        )
        for reset_row, area_name in rows
    ]


@router.post("/{reset_nr}/mark-processed")
def mark_reset_processed(reset_nr: int, db: Session = Depends(get_db)):
    """
    Port of frmSendtoHash.frm's ResetsGrid_DblClick() post-confirmation
    step (`ResetRec.Recordset![Processed] = True` then `.Update`) — only
    meant to be called AFTER the user has confirmed the transfer to
    Hashavshevת actually succeeded (the original's "?האם האיפוס עבר
    בהצלחה לחשבשבת" / "Did the reset transfer successfully to
    Hashavshevת?" dialog — this app's frontend shows the same confirmation
    before calling this, see SendToHashModal.tsx). Deliberately separate
    from generating movein.dat (GET .../movein.dat below) since the
    original only marks Processed after an explicit yes, never
    automatically just because the file was produced.
    """
    row = db.get(ResetRow, reset_nr)
    if row is None:
        raise HTTPException(status_code=404, detail="!!!האיפוס לא נמצא")
    row.Processed = True
    db.commit()
    return {"status": "ok"}


@router.get("/{reset_nr}/movein.dat")
def download_movein_dat(reset_nr: int, debug: int = 0, db: Session = Depends(get_db)):
    """
    On-demand regeneration of the Hashavshevet movein.dat export for an
    already-archived reset — see app/movein_export.py's module docstring for
    exactly what's ported vs. inferred/flagged. Matches the original's
    "resend to Hashavshevet" path (frmSendtoHash.frm re-running Reset() with
    ResetNr<>0), not the "new reset" path — this only reads already-stamped
    Invoices/Checks/BadChecks rows, it never re-stamps or re-commits
    anything.

    Delivery to the accounting PC is just the browser's own download —
    confirmed 2026-09-27 that whoever generates this is always doing so
    from a browser running ON the accounting PC itself (same machine
    that then runs ipus/ipusim to actually import it into Hashavshevת),
    so the plain HTTP response IS the delivery: no backend-side network
    push to a remote machine needed (a MonitexFileBridge.ps1 companion
    script existed for that briefly but was removed as unnecessary —
    point the browser's own default download folder at CFG.hdir's real
    value, e.g. "C:\hmon12", instead).

    `?debug=1` returns a JSON per-line trace of the cards() aggregation
    (invoice, code, subtotal, VAT, running total) instead of the .dat bytes
    — temporary diagnostic for pinning down exact contributing invoices
    without hand-transcription errors. Not used by the frontend button.
    """
    row = db.get(ResetRow, reset_nr)
    if row is None:
        raise HTTPException(status_code=404, detail="!!!האיפוס לא נמצא")
    if debug:
        trace: list = []
        build_movein_dat(db, row, debug_trace=trace)
        return trace
    content = build_movein_dat(db, row)

    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="movein_{reset_nr}.dat"'},
    )
