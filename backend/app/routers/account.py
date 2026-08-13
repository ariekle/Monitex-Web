"""
Web equivalent of Code/Account.frm (the real main screen — see WebCode/README.md
correction note; despite the filename this is what Startup="frmMain" points at).

Ported so far:
- Load-by-TaxiNr lookup (AccountRec.RecordSource = "select * from Accounts
  where TaxiNr = ...") joined with the linked Meters row for ExpDate/MeterType/
  Insurance, same as MeterRec/MeterRecM in the VB6 code. 0 and 99999 are used
  as "no meter assigned" sentinels there (see cmdMeters_Click / cmdSave_Click),
  reproduced below.
- Save of the editable fields (subset of cmdSave_Click)

- History grid (cmdHistory_Click) — read-only list of every History row for a
  TaxiNr, newest first, with Status resolved to its Hebrew label via a join
  against the Actions lookup table.

Not yet ported (still VB6-only):
- History table audit-log WRITE on save (cmdSave_Click writes a History row on
  every save with status 4=update / 5=new — TODO before this is production-safe,
  the original app relies on that audit trail). Reading History (above) is
  done; writing new rows to it on save is not yet.
- Syncing carnr/name onto the linked Meters row when meter nr is set
- cmdInvoices / cmdInvoiceCopy / cmdCheck / cmdMeters / cmdModem / cmdExpDate
  — each opens its own sub-screen, out of scope for this endpoint
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Account, Action, Area, History, Meter
from ..schemas import AccountOut, AccountUpdate, HistoryEntryOut

router = APIRouter(tags=["account"])

NO_METER_SENTINELS = (0, 99999)

# Fallback labels for History.Status 60-65 (60 + doc_type, see
# routers/invoices.py) — used only when the real Actions table has no row
# for that status. Confirmed via a live query: a חש/קבלה saved by this app
# produced a History row with Status=60 that had no Actions match, showing
# as a bare "#60" in the UI — easy to miss/not recognize as the invoice
# event. This makes it readable regardless of whether Actions ever gets
# real 60-65 rows.
_INVOICE_STATUS_FALLBACK_LABELS = {
    60: "הנפקת חש/קבלה",
    61: "הנפקת חשבונית",
    62: "הנפקת קבלה",
    63: "הנפקת חש. עסקה",
    64: "הנפקת ת. זיכוי",
    65: "הנפקת ת. משלוח",
}


def _to_account_out(db: Session, account: Account, meter: Optional[Meter]) -> AccountOut:
    data = AccountOut.model_validate(account).model_dump()
    if meter is not None:
        data["MeterExpDate"] = meter.ExpDate
        data["MeterType"] = meter.MeterType
        data["Insurance"] = meter.Insurance
        data["MeterStatus"] = meter.Status
    # Areas is a real DB lookup table (also used for History.AreaLabel — see
    # get_account_history below), not a hardcoded list — resolving the name
    # through it means area names/additions only ever need a DB row changed,
    # never a code or file change on this end.
    if account.Area is not None:
        area = db.get(Area, account.Area)
        data["AreaLabel"] = (area.name or "").strip() if area is not None else None
    return AccountOut(**data)


@router.get("/{taxi_nr}", response_model=AccountOut)
def get_account(taxi_nr: int, db: Session = Depends(get_db)):
    account = db.get(Account, taxi_nr)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No account for TaxiNr {taxi_nr}")

    meter = None
    if account.MeterNr is not None and account.MeterNr not in NO_METER_SENTINELS:
        meter = db.get(Meter, account.MeterNr)

    return _to_account_out(db, account, meter)


@router.get("/{taxi_nr}/history", response_model=list[HistoryEntryOut])
def get_account_history(taxi_nr: int, db: Session = Depends(get_db)):
    """
    Web equivalent of cmdHistory_Click / HistoryRec ("select * from History
    where TaxiNr=..."), newest first, with Status resolved to its Hebrew
    label via the Actions lookup table.

    Does not 404 on an account with no history — an empty list is a valid,
    normal result (e.g. a brand-new account with no changes logged yet).
    """
    rows = (
        db.query(History)
        .filter(History.TaxiNr == taxi_nr)
        .order_by(History.Date.desc(), History.Time.desc(), History.TransNr.desc())
        .all()
    )

    action_labels = {a.status: (a.action or "").strip() for a in db.query(Action).all()}
    area_labels = {a.area: (a.name or "").strip() for a in db.query(Area).all()}

    result = []
    for row in rows:
        entry = HistoryEntryOut.model_validate(row).model_dump()
        entry["Name"] = (row.Name or "").strip() or None
        entry["ActionLabel"] = action_labels.get(row.Status) or _INVOICE_STATUS_FALLBACK_LABELS.get(row.Status)
        entry["AreaLabel"] = area_labels.get(row.Area)
        result.append(HistoryEntryOut(**entry))
    return result


@router.put("/{taxi_nr}", response_model=AccountOut)
def update_account(taxi_nr: int, payload: AccountUpdate, db: Session = Depends(get_db)):
    account = db.get(Account, taxi_nr)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No account for TaxiNr {taxi_nr}")

    # TODO: write the History audit row here too, matching cmdSave_Click in
    # Account.frm, before this replaces the VB6 save path for real.
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, field, value)

    db.commit()
    db.refresh(account)

    meter = None
    if account.MeterNr is not None and account.MeterNr not in NO_METER_SENTINELS:
        meter = db.get(Meter, account.MeterNr)

    return _to_account_out(db, account, meter)
