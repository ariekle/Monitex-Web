"""
Web equivalent of printTest()/frmTestPrint.frm in Account.frm — the meter/
vehicle test certificate a driver presents to the licensing authority as
proof the taxi's meter is currently valid/certified. Reached via Alt+F1
(auto-detect meter type) / Shift+F1 (manually enter meter type) in the
original — there was no visible button for this at all; this app exposes
it as a normal button instead (see print-bridge's general pattern of
exposing hidden VB6 shortcuts openly).

Ported faithfully from printTest(model As Integer):
- Five preconditions, in the SAME order, aborting with the SAME Hebrew
  message on the first failure (matches the original's sequential If/Exit
  Sub chain, NOT an "all errors at once" validation):
    1. meter assigned (not 0/99999 — NO_METER_SENTINELS, see routers/account.py)
    2. Accounts.Checks = 0 (no returned/bounced checks on file — inferred
       from the message text "!!!ללקוח יש צ'קים החוזרים"; the field's exact
       semantics aren't independently confirmed via schema docs, just this
       one usage)
    3. meter service not expired (_is_expired(), ported in routers/invoices.py)
    4. Accounts.CarNr >= 1,000,000 (valid car license number)
    5. Meters.Status == 1 (ACTIVE — see Meter model docstring)
- MeterType resolution: model=0 auto-computes "MX-10" for MeterNr in
  [60000, 75000], else "20-90"; model=1 requires the caller to supply
  meter_type_override (matches the original's frmTextEnter prompt +
  "!!!הכנס דגם מונה" abort if left blank).
- vehicle_model is always required (matches the ALWAYS-shown second
  frmTextEnter prompt + "!!!הכנס מודל רכב" abort if blank) — unlike
  MeterType, there's no auto path for this at all, even for model=0.
- Writes a History row with Status=50 on success, snapshotting
  TaxiNr/MeterNr/ExpDate/Insurance/CarNr/Area/Date/Time/Name exactly as the
  original does. Name is the ACCOUNT's own PrivatName+FamilyName (not the
  operator's) — matches `frmMain.AccountRec.Recordset![PrivatName] & " " &
  ...[familyname]` verbatim, a slightly odd but faithful choice.
- CFG.testNr ALWAYS increments by 1 on success, regardless of whether this
  branch's Areas.PrintTestNr flag is set — matches the original's
  unconditional `cfgRec.Recordset![testNr] = ... + 1` sitting right after
  the If/Else that decides what value to actually show ON the certificate.
  Only the PRINTED value is gated by PrintTestNr, not the counter itself.

NOT done here: the car-plate grouping (Carnr1/Carnr2/Carnr3 split) and the
actual PDF rendering — both happen in the print bridge itself (see
WebCode/print-bridge/MonitexPrintBridge.ps1's Handle-TestPrint), which
takes this endpoint's plain CarNr and splits it there, matching how the
original VB6 CALLER (not the report itself) does that formatting.

NOTE: an earlier version of testNew.rpt needed an 8th report parameter,
"MeterNr" (Number), beyond the 7 read out of printTest()'s Form_Load()
(Model/TaxiNr/MeterType/Carnr1-3/testNr) — this was never in the real VB6
source, so it was removed from the .rpt in Crystal Reports Designer and
replaced with a live Accounts.MeterNr database field instead (the report
already joins to Accounts via TaxiNr, so this needs no caller-supplied
value at all). This endpoint therefore no longer sends MeterNr to the
bridge — see print-bridge/README.md for the corrected parameter set.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Account, Area, Cfg, History, Meter
from ..schemas import TestPrintIn, TestPrintOut
from .account import NO_METER_SENTINELS
from .invoices import _is_expired

router = APIRouter(prefix="/api/account", tags=["test-print"])

# MeterNr range that auto-selects "MX-10" for model=0 (Alt+F1) — matches
# `If MeterRecM.Recordset![meterNr] >= 60000 And ... <= 75000` in printTest().
_MX10_METER_NR_RANGE = (60000, 75000)

# History.Status for this event — matches `HistoryRec.Recordset![status] = 50`.
_TEST_PRINT_HISTORY_STATUS = 50


@router.post("/{taxi_nr}/test-print", response_model=TestPrintOut)
def create_test_print(taxi_nr: int, payload: TestPrintIn, db: Session = Depends(get_db)):
    account = db.get(Account, taxi_nr)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No account for TaxiNr {taxi_nr}")

    # 1. meter assigned
    if account.MeterNr is None or account.MeterNr in NO_METER_SENTINELS:
        raise HTTPException(status_code=422, detail="!!!ללקוח לא מעודכן מונה")
    meter = db.get(Meter, account.MeterNr)
    if meter is None:
        raise HTTPException(status_code=422, detail="!!!ללקוח לא מעודכן מונה")

    # 2. no returned checks on file
    if (account.Checks or 0) > 0:
        raise HTTPException(status_code=422, detail="!!!ללקוח יש צ'קים החוזרים")

    # 3. meter service not expired
    if _is_expired(meter.ExpDate):
        raise HTTPException(status_code=422, detail="!!!תוקף השרות למונה פג")

    # 4. valid car license number
    if (account.CarNr or 0) < 1_000_000:
        raise HTTPException(status_code=422, detail="!!!מספר רישוי לא תקין")

    # 5. meter active
    if meter.Status != 1:
        raise HTTPException(status_code=422, detail="!!!המונה אינו פעיל")

    if payload.model == 0:
        lo, hi = _MX10_METER_NR_RANGE
        meter_type = "MX-10" if lo <= account.MeterNr <= hi else "20-90"
    else:
        if not (payload.meter_type_override or "").strip():
            raise HTTPException(status_code=422, detail="!!!הכנס דגם מונה")
        meter_type = payload.meter_type_override.strip()

    vehicle_model = payload.vehicle_model.strip()
    if not vehicle_model:
        raise HTTPException(status_code=422, detail="!!!הכנס מודל רכב")

    now = datetime.now()
    db.add(
        History(
            TaxiNr=account.TaxiNr,
            MeterNr=account.MeterNr,
            ExpDate=meter.ExpDate,
            Insurance=meter.Insurance,
            CarNr=account.CarNr,
            Status=_TEST_PRINT_HISTORY_STATUS,
            Date=now.date(),
            Time=now.time(),
            Name=f"{(account.PrivatName or '').strip()} {(account.FamilyName or '').strip()}".strip(),
            Area=payload.branch_area,
        )
    )

    cfg = db.query(Cfg).first()
    if cfg is None or cfg.testNr is None:
        raise HTTPException(status_code=500, detail="CFG.testNr not configured — cannot allocate a test number")
    area = db.get(Area, payload.branch_area)
    print_test_nr = bool(area.PrintTestNr) if area is not None else False
    test_nr_to_print = cfg.testNr if print_test_nr else 0
    cfg.testNr = cfg.testNr + 1  # unconditional regardless of print_test_nr — see module docstring

    db.commit()

    return TestPrintOut(
        taxiNr=account.TaxiNr,
        carnr=account.CarNr,
        meterType=meter_type,
        vehicleModel=vehicle_model,
        testNr=test_nr_to_print,
    )
