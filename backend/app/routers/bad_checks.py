"""
Web equivalent of "שיקים חוזרים" (returned/bounced checks) — Code/frmBackCheck.frm,
reached from Account.frm's cmdCheck button. See models.py's BadChecks
docstring for the full reconstructed workflow and its schema caveats (this
table has no INFORMATION_SCHEMA dump — verify before trusting in production).

Endpoints:
- GET  /api/bad-checks/options            — the 3 fixed pick-lists (reasons/banks/statuses)
- GET  /api/bad-checks/by-check           — find_Check(checkBy=0): by CheckNr+AccountNr+SnifNr
- GET  /api/bad-checks/by-tz              — find_Check(checkBy=1): by Tz
- GET  /api/bad-checks/by-taxi            — find_Check(checkBy=2): by TaxiNr
- POST /api/bad-checks/report             — report a NEW bad check (newBackCheck branch)
- POST /api/bad-checks/{bad_check_nr}/repay — cmdSave_Click on an EXISTING bad check
- POST /api/bad-checks/{bad_check_nr}/lost  — cmdLost_Click

NOT ported (out of scope, matching what routers/reset.py's docstring already
excludes): printing (frmBadCheckRpt — Crystal, no web equivalent; use the
returned BadCheckOut to build a simple print view if needed later), and the
commented-out "returned interest paid" (BadChecksRec![PaidOver]) partial-
save arithmetic quirks beyond what's reproduced in _apply_repay() below.
"""
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Account, BadChecks, Cfg, Check, Invoice, HESHBONIT_KABALA, KABALA
from ..routers.invoices import create_invoice_core
from ..schemas import (
    BadCheckOptionsOut,
    BadCheckOut,
    BadCheckReportIn,
    BadCheckRepayIn,
    BadCheckRepayOut,
    InvoiceCreate,
)

router = APIRouter(prefix="/api/bad-checks", tags=["bad-checks"])

# Ported verbatim from Public Function BankName(bankNr As Integer) in
# Main.bas — a fixed lookup table, index 0-33 (anything outside that range
# returns "" in the original). Separate from the 2-item Reason/Bank pick-
# lists below (those are hand-extracted from frmBackCheck.frx, see
# BadChecks model docstring).
_BANK_NAMES = [
    "       ", "לאומי", "הפועלים", "איגוד", "הבינלאומי", "דיסקונט",
    "מזרחי", "אמריקאי יש", "הספנות", "יהב", "כללי לישר.",
    "למסחר", "קונטיננטל", "אוצר החייל", "קופת העובד", "מרכנתיל",
    "דואר", "ערבי-ישראלי", "הישיר", "פועלי אג.",
    "ויזה", "ישראכרד", "דיינרס", "אמקס",
    "", "", "", "", "", "",
    "בנק מסד", "בנק עולמי להשקעות", "בנק אדנים", "בנק פלסטין", "בנק ירושלים",
]

# Hand-extracted from frmBackCheck.frx's ListBox.List binary resource — see
# BadChecks model docstring for the extraction method and confidence level.
BAD_CHECK_REASONS = ["א.כ.מ", "מוגבל", "מעוקל", "נ.ה.ב", "התאמה", "חתימה"]
BAD_CHECK_BANKS = ["בנק הפועלים", "בנק דיסקונט"]  # matches cmdSave_Click's exact string compare (see below)
BAD_CHECK_STATUSES = [
    "הועבר לחיפה", "הועבר לירושלים", 'הועבר לב"ש', "הועבר לאילת",
    "הועבר לנתניה", 'הועבר לעו"ד 1', 'הועבר לעו"ד 2',
]  # 7 of 8 confirmed — see BadCheckOptionsOut docstring


def _bank_name(code: Optional[int]) -> Optional[str]:
    if code is None or code < 0 or code >= len(_BANK_NAMES):
        return None
    name = _BANK_NAMES[code]
    return name if name else None


def _parse_ddmmyyyy(raw: Optional[str]) -> Optional[date]:
    if not raw:
        return None
    try:
        return datetime.strptime(raw.strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


def _bad_check_debit(bad_check: BadChecks, cfg: Optional[Cfg]) -> float:
    """
    Ported from Private Function debit() in frmBackCheck.frm:
        orgdate = duedate (or invdate if duedate is null)
        months = DateDiff("m", duedate, Date())
        debit = months * CFG.interest + CFG.minimumCharge
    DateDiff("m", ...) is pure calendar-month arithmetic in VB6 — it does
    NOT count elapsed 30-day periods, just (year2-year1)*12 + (month2-month1),
    ignoring day-of-month entirely (so due 31/01 vs today 01/02 already
    counts as "1 month", not "1 day").
    """
    due = _parse_ddmmyyyy(bad_check.DueDate) or bad_check.InvDate
    if due is None or cfg is None:
        return 0.0
    today = date.today()
    months = (today.year - due.year) * 12 + (today.month - due.month)
    interest = cfg.interest or 0
    minimum_charge = float(cfg.minimumCharge or 0)
    return months * interest + minimum_charge


def _to_out(bad_check: BadChecks, cfg: Optional[Cfg]) -> BadCheckOut:
    debit = _bad_check_debit(bad_check, cfg)
    return BadCheckOut(
        BadCheckNr=bad_check.BadCheckNr,
        CheckNr=bad_check.CheckNr,
        AccountNr=bad_check.AccountNr,
        SnifNr=bad_check.SnifNr,
        BankNr=bad_check.BankNr,
        BankName=_bank_name(bad_check.BankNr),
        ReturnBank=bad_check.ReturnBank,
        # Prefer the actually-stored free text (ReturnBankTxt, what the
        # secretary really sees/edits in txtReturnBank) over the derived
        # BankName(ReturnBank) lookup — they can diverge once someone
        # retypes it, matching the original exactly (see model docstring).
        ReturnBankName=bad_check.ReturnBankName or _bank_name(bad_check.ReturnBank),
        InvNr=bad_check.InvNr,
        Money=bad_check.Money or 0,
        DueDate=bad_check.DueDate,
        TaxiNr=bad_check.TaxiNr,
        Name=bad_check.Name,
        Town=bad_check.Town,
        Street=bad_check.Street,
        HomeNr=bad_check.HomeNr,
        Tz=bad_check.Tz,
        ZipCode=bad_check.ZipCode,
        # No separate FamilyName column — same physical `Name` as above
        # (see model docstring), just exposed under this API field too.
        FamilyName=bad_check.Name,
        CellPhone=bad_check.CellPhone,
        Lost=bool(bad_check.Lost),
        Statustxt=bad_check.Statustxt,
        Reason=bad_check.Reason,
        PaidCheck=bad_check.PaidCheck or 0,
        PaidOver=bad_check.PaidOver or 0,
        Date1=bad_check.Date1, Msg1=bad_check.Msg1,
        Date2=bad_check.Date2, Msg2=bad_check.Msg2,
        Date3=bad_check.Date3, Msg3=bad_check.Msg3,
        Date4=bad_check.Date4, Msg4=bad_check.Msg4,
        Date5=bad_check.Date5, Msg5=bad_check.Msg5,
        Debit=round(debit, 2),
        # `txttoPay = Format(debit() + BadChecksRec.Recordset![money], "####.00")`
        # — deliberately NOT reduced by PaidCheck, matching the original exactly
        # (see BadChecks model docstring) even though that looks like it could
        # be a pre-existing quirk in the source.
        ToPay=round(debit + (bad_check.Money or 0), 2),
        StillCollectible=(bad_check.PaidCheck or 0) < (bad_check.Money or 0) and not bad_check.Lost,
    )


def _get_cfg(db: Session) -> Optional[Cfg]:
    return db.query(Cfg).first()


@router.get("/options", response_model=BadCheckOptionsOut)
def get_options():
    return BadCheckOptionsOut(reasons=BAD_CHECK_REASONS, banks=BAD_CHECK_BANKS, statuses=BAD_CHECK_STATUSES)


@router.get("/by-check", response_model=list[BadCheckOut])
def find_by_check(check_nr: int, account_nr: int, snif_nr: int, db: Session = Depends(get_db)):
    """Ported from find_Check(checkBy:=0)'s existing-record lookup."""
    cfg = _get_cfg(db)
    rows = (
        db.query(BadChecks)
        .filter(BadChecks.CheckNr == check_nr, BadChecks.AccountNr == account_nr, BadChecks.SnifNr == snif_nr)
        .all()
    )
    return [_to_out(r, cfg) for r in rows]


@router.get("/by-tz", response_model=list[BadCheckOut])
def find_by_tz(tz: int, db: Session = Depends(get_db)):
    """Ported from find_Check(checkBy:=1)."""
    cfg = _get_cfg(db)
    rows = db.query(BadChecks).filter(BadChecks.Tz == tz).all()
    return [_to_out(r, cfg) for r in rows]


@router.get("/by-taxi", response_model=list[BadCheckOut])
def find_by_taxi(taxi_nr: int, db: Session = Depends(get_db)):
    """Ported from find_Check(checkBy:=2)."""
    cfg = _get_cfg(db)
    rows = db.query(BadChecks).filter(BadChecks.TaxiNr == taxi_nr).all()
    return [_to_out(r, cfg) for r in rows]


@router.post("/report", response_model=BadCheckOut)
def report_bad_check(payload: BadCheckReportIn, db: Session = Depends(get_db)):
    """
    Ported from find_Check(checkBy:=0)'s "not found in BadChecks yet, but a
    matching Checks row exists" branch — reports an already-received check
    (CheckNr+AccountNr+SnifNr) as bounced.

    Deviation from the original: blocks re-reporting the SAME check twice
    (404-equivalent 409 here) rather than silently creating a second
    BadChecks row — the original's cmdNew_Click path never checks for an
    existing report first, which looks like an oversight rather than
    intentional (duplicate bounced-check records would double-count in
    Accounts.checks and any future collections report) — not "faithfully"
    reproduced here on purpose.
    """
    existing = (
        db.query(BadChecks)
        .filter(
            BadChecks.CheckNr == payload.check_nr,
            BadChecks.AccountNr == payload.account_nr,
            BadChecks.SnifNr == payload.snif_nr,
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"שק זה כבר דווח כחוזר (מס' {existing.BadCheckNr})")

    check = (
        db.query(Check)
        .filter(Check.CheckNr == payload.check_nr, Check.AccountNr == payload.account_nr, Check.SnifNr == payload.snif_nr)
        .first()
    )
    if check is None:
        raise HTTPException(status_code=404, detail="!!!שק לא נמצא במאגר")

    invoice = db.get(Invoice, check.InvNr)
    if invoice is None:
        raise HTTPException(status_code=404, detail="!!!קבלה של השק לא נמצאה במאגר")

    account = db.get(Account, invoice.TaxiNr)
    if account is None:
        raise HTTPException(status_code=404, detail="!!!מונית של השק לא נמצאה במאגר")

    due_date_str = check.DueDate.replace(".", "/") if check.DueDate else None
    return_bank_code = check.BankNr
    bad_check = BadChecks(
        CheckNr=check.CheckNr,
        AccountNr=check.AccountNr,
        SnifNr=check.SnifNr,
        BankNr=check.BankNr,
        ReturnBank=return_bank_code,  # initial guess, matches `![ReturnBank] = ChecksRec![bankNr]` — re-editable via /repay
        # `txtReturnBank = BankName(![ReturnBank])` right after AddNew in the
        # original — since txtReturnBank is bound to ReturnBankTxt, that
        # assignment is what actually seeds this column too.
        ReturnBankName=_bank_name(return_bank_code),
        InvNr=check.InvNr,
        Money=check.Money,
        DueDate=due_date_str,
        CheckDueDate=_parse_ddmmyyyy(due_date_str),
        # `Name` does double duty — invoice buyer name now, editable
        # "family name" later (see model docstring); no separate FamilyName column.
        Name=(invoice.Name or "").strip() or None,
        # InvDate is char in the real table, not a native date — stored as
        # text like DueDate (the original just assigns the Date value and
        # lets VB6's implicit locale conversion stringify it).
        InvDate=invoice.Date.strftime("%d/%m/%Y") if invoice.Date else None,
        InvoiceDate=invoice.Date,
        TaxiNr=invoice.TaxiNr,
        Town=(invoice.Town or "").strip() or None,
        Street=(invoice.Street or "").strip() or None,
        # Was `[:6]` — the only truncated sibling field here despite
        # BadChecks.HomeNr being String(10), same width as Invoice.HomeNr
        # (see model docstrings); every other copied field (Town, Street,
        # etc.) takes the full value. No comment ever justified the [:6],
        # and this codebase's convention is to flag every intentional
        # deviation explicitly — treated as a stray typo and fixed to match
        # its siblings (code review, 2026-09-22).
        HomeNr=(invoice.HomeNr or "").strip() or None,
        Tz=invoice.Tz,
        ZipCode=invoice.ZipCode,
        Lost=False,
        ResetNr=0,
        PaidCheck=0,
        PaidOver=0,
    )
    db.add(bad_check)

    account.Checks = (account.Checks or 0) + 1

    db.commit()
    db.refresh(bad_check)
    return _to_out(bad_check, _get_cfg(db))


def _apply_editable_fields(bad_check: BadChecks, payload: BadCheckRepayIn) -> None:
    """Fields editable regardless of whether money is also being collected this save — matches cmdSave_Click committing everything in one .Recordset.Update."""
    if payload.family_name is not None:
        # Writes the SAME column as the invoice-buyer-name snapshot taken at
        # report time — txtFamilyName's real DataField is "Name", there's no
        # separate FamilyName column (see model docstring).
        bad_check.Name = payload.family_name
    if payload.cell_phone is not None:
        bad_check.CellPhone = payload.cell_phone
    if payload.street is not None:
        bad_check.Street = payload.street
    if payload.home_nr is not None:
        bad_check.HomeNr = payload.home_nr
    if payload.town is not None:
        bad_check.Town = payload.town
    if payload.zip_code is not None:
        bad_check.ZipCode = payload.zip_code
    if payload.reason is not None:
        bad_check.Reason = payload.reason
    if payload.statustxt is not None:
        bad_check.Statustxt = payload.statustxt
    if payload.return_bank_name is not None:
        # Whatever's typed in txtReturnBank persists into ReturnBankTxt via
        # ADO binding on every save (that's the free text shown/edited) ...
        bad_check.ReturnBankName = payload.return_bank_name
        # ... and cmdSave_Click ALSO separately derives this simplified 0/1
        # flag from the same text via an exact string compare.
        bad_check.Bank = 0 if payload.return_bank_name == "בנק הפועלים" else 1
    for i in (1, 2, 3, 4, 5):
        d = getattr(payload, f"date{i}")
        m = getattr(payload, f"msg{i}")
        if d is not None:
            setattr(bad_check, f"Date{i}", d)
        if m is not None:
            setattr(bad_check, f"Msg{i}", m)


@router.post("/{bad_check_nr}/repay", response_model=BadCheckRepayOut)
def repay_bad_check(bad_check_nr: int, payload: BadCheckRepayIn, db: Session = Depends(get_db)):
    """
    Ported from cmdSave_Click's EXISTING-record branch. Only reachable
    while StillCollectible (PaidCheck < Money and not Lost) — matches the
    original only ever unlocking these fields under that condition.
    """
    bad_check = db.get(BadChecks, bad_check_nr)
    if bad_check is None:
        raise HTTPException(status_code=404, detail="Bad check not found")
    if bad_check.Lost:
        raise HTTPException(status_code=409, detail="שק זה דווח כחוב אבוד")
    if (bad_check.PaidCheck or 0) >= (bad_check.Money or 0):
        raise HTTPException(status_code=409, detail="שק זה כבר שולם במלואו")

    _apply_editable_fields(bad_check, payload)

    check_receipt_inv_nr: Optional[int] = None
    interest_invoice_inv_nr: Optional[int] = None

    if payload.pay_check is not None or payload.pay_interest is not None:
        if payload.branch_area is None:
            raise HTTPException(status_code=422, detail="branch_area is required when collecting a payment")

    buyer_name = (bad_check.Name or "").strip() or "לקוח"
    buyer_tz = bad_check.Tz or 0

    if payload.pay_check is not None:
        pay_check_total = sum(p.amount for p in payload.pay_check.payments)
        receipt = create_invoice_core(
            bad_check.TaxiNr,
            InvoiceCreate(
                doc_type=KABALA,
                lines=[],
                payments=payload.pay_check.payments,
                buyer_name=buyer_name,
                buyer_tz=buyer_tz,
                branch_area=payload.branch_area,
            ),
            db,
            ignore_in_reset=1,
        )
        check_receipt_inv_nr = receipt.InvNr
        # Accumulate — the original's own two save paths disagree (one does
        # `paidCheck = paidCheck + txtPayCheck`, the other overwrites with a
        # bare `= val(txtPayCheck)`); accumulating is the only version that
        # makes sense across multiple partial repayments, see model docstring.
        bad_check.PaidCheck = (bad_check.PaidCheck or 0) + pay_check_total

        # DEVIATION from the original: cmdSave_Click in frmBackCheck.frm never
        # decrements Accounts.checks on repayment — only cmdLost_Click (the
        # write-off path) does (see mark_bad_check_lost below). That leaves a
        # fully-repaid check still counted as "outstanding" forever, which
        # permanently blocks printTest()'s `AccountRec.Recordset![checks] > 0`
        # guard (see routers/test_print.py) even after the customer has paid
        # in full. Decrementing here once the check reaches full repayment
        # fixes that — flagged as an intentional bug fix, not a silent
        # behavior change.
        if (bad_check.PaidCheck or 0) >= (bad_check.Money or 0):
            account = db.get(Account, bad_check.TaxiNr)
            if account is not None and (account.Checks or 0) > 0:
                account.Checks = account.Checks - 1

    if payload.pay_interest is not None:
        pay_interest_total = sum(p.amount for p in payload.pay_interest.payments)
        interest_invoice = create_invoice_core(
            bad_check.TaxiNr,
            InvoiceCreate(
                doc_type=HESHBONIT_KABALA,
                lines=payload.pay_interest.lines,
                payments=payload.pay_interest.payments,
                buyer_name=buyer_name,
                buyer_tz=buyer_tz,
                branch_area=payload.branch_area,
            ),
            db,
            ignore_in_reset=2,
        )
        interest_invoice_inv_nr = interest_invoice.InvNr
        bad_check.PaidOver = (bad_check.PaidOver or 0) + pay_interest_total

    db.commit()
    db.refresh(bad_check)
    return BadCheckRepayOut(
        badCheck=_to_out(bad_check, _get_cfg(db)),
        checkReceiptInvNr=check_receipt_inv_nr,
        interestInvoiceInvNr=interest_invoice_inv_nr,
    )


@router.post("/{bad_check_nr}/lost", response_model=BadCheckOut)
def mark_bad_check_lost(bad_check_nr: int, db: Session = Depends(get_db)):
    """
    Ported from cmdLost_Click — only allowed while `paidCheck = 0 And Not
    lost`, matching the original's button-visibility guard.
    """
    bad_check = db.get(BadChecks, bad_check_nr)
    if bad_check is None:
        raise HTTPException(status_code=404, detail="Bad check not found")
    if bad_check.Lost or (bad_check.PaidCheck or 0) != 0:
        raise HTTPException(status_code=409, detail="לא ניתן לדווח כחוב אבוד — כבר שולם או כבר דווח")

    bad_check.Lost = True
    bad_check.Statustxt = "דווח כחוב אבוד"

    account = db.get(Account, bad_check.TaxiNr)
    if account is not None and (account.Checks or 0) > 0:
        account.Checks = account.Checks - 1

    db.commit()
    db.refresh(bad_check)
    return _to_out(bad_check, _get_cfg(db))
