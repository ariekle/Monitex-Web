"""
Web equivalent of "פעולות במונה וכובע" (cmdMeters_Click in Account.frm →
frmInstall.frm), the meter/cap install-deposit-remove-stolen workflow, plus
the standalone "replace meter number" action and the 80000+ pool-account
balance reset.

TWO DIFFERENT SCREENS share the cmdMeters button in the original:
- TaxiNr >= 80000 (a "pool"/admin account, not a real taxi): cmdMeters_Click
  skips the whole menu below and just asks "reset meter/cap balances?" —
  see reset_pool_balances().
- TaxiNr < 80000 (a real taxi): opens the 13-item lstMeterActions menu.
  Items 0-11 are 4 action groups (install/deposit/remove/stolen — הרכבה/
  הפקדה/הסרה/גניבה) x 3 targets (both/meter/cap — MeterCova 3/1/2). Item 12
  ("הכנס מספר מונה חדש") is a distinct, separately-coded flow (replace the
  taxi's current meter with a brand-new number) — see replace_meter().

ACTION_DEFS below maps the 0-11 index (matching lstMeterActions.ListIndex in
Account.frm) to (group, meter_cova).

Guard-rail checks (check_action) are ported from lstMeterActions_DblClick's
pre-flight validation in Account.frm — that code compares the on-screen
Hebrew status LABEL text (lblMeterStatus/lblCovaStatus); this port compares
the underlying numeric status codes directly (see METER_ACTIVE etc. in
models.py), which is behaviorally identical but doesn't depend on string
matching. One correction: the original's stolen+both lblAction caption says
"דווח על הסרת מונה וכובע" (copy-paste bug, "removed" instead of "stolen") —
this port uses the correct "דווח על גניבת מונה וכובע".

The meter-number resolution state machine (check_meter_nr) is ported from
txtMeterNr_Validate in frmInstall.frm — only relevant for install actions
that involve the meter (MeterCova 1 or 3). Confirmed dead/unreachable code
in the original (an ACTIVE-elsewhere meter hits `Exit Sub` right after the
error message, before a disconnect-confirm block that can never run) is
NOT ported — an ACTIVE-elsewhere meter is a hard block here too, matching
actual behavior.

credit_service() in frmInstall.frm (extends a meter's service-expiry date
when re-activating a previously-deposited meter) is confirmed DISABLED in
the live app: `'!!!!!!! 5-2-2026 cancel crediting for paid service
months!!!!!!!` followed by `credit_months = 0`, which forces its "no-op"
branch (NewExpDate = expDate, unchanged) every time. This port matches that
— reactivating a deposited meter does NOT change its ExpDate.
credit_service_stolen() (Account.frm) is a DIFFERENT, purely informational
calculation (a warning shown when reinstalling a stolen meter that still had
service credit left) — it's not disabled and has no persisted side effect
either way, so it's ported as-is into check_action()'s `warning` field.

save_action() re-resolves the meter-number state machine itself right before
writing (same "recompute right before commit" pattern used throughout this
app for invoice numbers) rather than trusting whatever the client's earlier
check_meter_nr call returned — confirmDisconnect must still be re-sent by
the client to authorize a cross-taxi reassignment.

One deliberate correction vs the original: cmdSave_Click's disconnect-repair
check (`If Acc80000Rec.Recordset![meterNr] = AccountRec.Recordset![meterNr]
Then`) compares the OTHER taxi's meter nr against THIS account's OLD meter nr
(read before this save updates it) — which is almost never the meter number
being installed, so in practice this repair rarely fires as apparently
intended, leaving the other taxi's Account.MeterNr stale. This looks like a
timing bug rather than deliberate design (disconnect_taxi was determined by
looking up exactly this meter_nr's current owner in the first place, so the
"intended" comparison is always true by construction). This port compares
against the meter number actually being installed instead, so the repair
reliably fires. Flagged here rather than silently replicated.

History.Area / Meter.DepositArea are written from payload.branch_area — the
branch Area of the WORKSTATION that made this request, sent by the frontend
(a per-computer value the client hardcodes once, analogous to the original's
c:\meesql.cfg), NOT from the account's own Area field. Confirmed via
frmInstall.frm: both `HistoryRec.Recordset![Area] = Area` and
`MeterRec.Recordset![depositarea] = Area + 1` read the GLOBAL
`Public Area As Integer` (Main.bas, set once at startup from meesql.cfg),
never AccountRec's own Area column. Since this web app is one shared backend
potentially serving browsers from several branches, that global can't be a
server-side constant anymore — it has to come from the caller. Same
correction applied in routers/invoices.py, see that module's docstring for
the fuller explanation.

NOT yet ported:
- Cap-only equivalent of the meter-number resolution/disconnect flow — the
  original has none either (caps aren't a separate registry table, just a
  status/type on the Accounts row, so there's nothing analogous to disconnect)
- Deletion/undo of a meter action
"""
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Account, History, Meter
from ..schemas import (
    AccPaidCheckIn,
    AccPaidCheckOut,
    MeterActionCheckIn,
    MeterActionCheckOut,
    MeterActionSaveIn,
    MeterActionSaveOut,
    MeterNrCheckIn,
    MeterNrCheckOut,
    ReplaceMeterIn,
    ReplaceMeterOut,
    ResetPoolOut,
)

router = APIRouter(tags=["meter-actions"])

NO_METER_SENTINELS = (0, 99999)

# Meter/cap status codes — Public Const in Code/Main.bas, see Meter.Status in models.py.
METER_ACTIVE = 1
METER_STOLEN = 2
METER_DEPOSIT = 3
METER_REMOVED = 4

METER_COVA = 1  # מונה בלבד
COVA_COVA = 2  # כובע בלבד
BOTH_COVA = 3  # מונה וכובע

GROUP_BASE = {"install": 10, "stolen": 20, "deposit": 30, "remove": 40}
GROUP_VERB = {"install": "הרכבת", "deposit": "הפקדת", "remove": "הסרת", "stolen": "גניבת"}
COVA_NOUN = {METER_COVA: "מונה", COVA_COVA: "כובע", BOTH_COVA: "מונה וכובע"}

# index -> (group, meter_cova) — matches lstMeterActions.ListIndex in Account.frm
ACTION_DEFS: dict[int, tuple[str, int]] = {
    0: ("deposit", BOTH_COVA),
    1: ("deposit", METER_COVA),
    2: ("deposit", COVA_COVA),
    3: ("remove", BOTH_COVA),
    4: ("remove", METER_COVA),
    5: ("remove", COVA_COVA),
    6: ("stolen", BOTH_COVA),
    7: ("stolen", METER_COVA),
    8: ("stolen", COVA_COVA),
    9: ("install", BOTH_COVA),
    10: ("install", METER_COVA),
    11: ("install", COVA_COVA),
}

# Actions that require an existing meter already installed to even open —
# `(action = 0 Or action = 1 Or action = 3 Or action = 4 Or action = 6 Or
# action = 7 Or action = 12)` in lstMeterActions_DblClick (12 = replace,
# handled separately in replace_meter()).
_REQUIRES_EXISTING_METER = {0, 1, 3, 4, 6, 7}

_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# Fallback label for History.Status=44 — a hardcoded literal (NOT base+cova)
# written only by the "replace meter number" flow (action=12 in Account.frm).
# Not confirmed against a real Actions row — best-guess label, flagged as such.
_REPLACE_METER_STATUS = 44
_REPLACE_METER_FALLBACK_LABEL = "החלפת מספר מונה (לא מאושר מול טבלת Actions)"


def _action_label(group: str, meter_cova: int) -> str:
    return f"דווח על {GROUP_VERB[group]} {COVA_NOUN[meter_cova]}"


def _get_account_or_404(db: Session, taxi_nr: int) -> Account:
    account = db.get(Account, taxi_nr)
    if account is None:
        raise HTTPException(status_code=404, detail=f"No account for TaxiNr {taxi_nr}")
    return account


def _get_current_meter(db: Session, account: Account) -> Optional[Meter]:
    if account.MeterNr is None or account.MeterNr in NO_METER_SENTINELS:
        return None
    return db.get(Meter, account.MeterNr)


def _fmt_ddmmyyyy(d: date) -> str:
    """Meters.ActionDate/Meters.date are TEXT columns — see Meter model docstring."""
    return d.strftime("%d/%m/%Y")


def _parse_ddmmyyyy(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.strptime(s.strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


def _credit_service_stolen(meter: Meter) -> int:
    """
    Ported from credit_service_stolen() in Account.frm — purely informational
    (shown as a warning when reinstalling a stolen meter), no persisted
    side effect. Returns leftover whole months of service credit, 0 if none
    or if inputs are missing/malformed.
    """
    action_date = _parse_ddmmyyyy(meter.ActionDate)
    if not meter.ExpDate or action_date is None:
        return 0
    month = meter.ExpDate // 10000
    year = meter.ExpDate % 10000
    if month < 1 or month > 12 or year <= 0:
        return 0
    try:
        exp_date = date(year, month, _MONTH_DAYS[month - 1])
    except ValueError:
        return 0
    diff_days = (exp_date - action_date).days
    return diff_days // 30


@router.post("/{taxi_nr}/meter-actions/check", response_model=MeterActionCheckOut)
def check_action(taxi_nr: int, payload: MeterActionCheckIn, db: Session = Depends(get_db)):
    """Pre-flight guard-rail check — ported from lstMeterActions_DblClick in Account.frm."""
    if payload.action not in ACTION_DEFS:
        raise HTTPException(status_code=422, detail=f"Unknown action {payload.action}")

    account = _get_account_or_404(db, taxi_nr)
    group, meter_cova = ACTION_DEFS[payload.action]
    action = payload.action

    meter = _get_current_meter(db, account)
    if action in _REQUIRES_EXISTING_METER and meter is None:
        return MeterActionCheckOut(ok=False, error="אין מונה המדווח כמורכב במונית")

    meter_status = meter.Status if meter is not None else None
    cova_status = account.CovaStatus
    warning: Optional[str] = None

    if group == "deposit":
        if action in (0, 1) and meter_status == METER_DEPOSIT:
            return MeterActionCheckOut(ok=False, error=f"המונה מדווח כמופקד ממונית {meter.TaxiNr}")
        if action in (0, 2) and cova_status == METER_DEPOSIT:
            return MeterActionCheckOut(ok=False, error="הכובע מדווח כמופקד")
    elif group == "remove":
        if action in (3, 4) and meter_status == METER_DEPOSIT:
            return MeterActionCheckOut(ok=False, error="המונה מדווח כמופקד")
        if action in (3, 5) and cova_status == METER_DEPOSIT:
            return MeterActionCheckOut(ok=False, error="הכובע מדווח כמופקד")
        if action in (3, 4) and meter_status == METER_REMOVED:
            return MeterActionCheckOut(ok=False, error="המונה מדווח כמוסר")
        if action in (3, 5) and cova_status == METER_REMOVED:
            return MeterActionCheckOut(ok=False, error="הכובע מדווח כמוסר")
    elif group == "stolen":
        if action in (6, 7) and meter_status == METER_DEPOSIT:
            return MeterActionCheckOut(ok=False, error="המונה מדווח כמופקד")
        if action in (6, 8) and cova_status == METER_DEPOSIT:
            return MeterActionCheckOut(ok=False, error="הכובע מדווח כמופקד")
        if action in (6, 7) and meter_status == METER_STOLEN:
            return MeterActionCheckOut(ok=False, error="המונה מדווח כגנוב")
        if action in (6, 8) and cova_status == METER_STOLEN:
            return MeterActionCheckOut(ok=False, error="הכובע מדווח כגנוב")
    elif group == "install":
        if action in (9, 10) and meter_status == METER_ACTIVE:
            return MeterActionCheckOut(ok=False, error="המונה מדווח כפעיל")
        if action in (9, 11) and cova_status == METER_ACTIVE:
            return MeterActionCheckOut(ok=False, error="הכובע מדווח כפעיל")
        if action in (9, 10) and meter_status == METER_STOLEN:
            credit_months = _credit_service_stolen(meter)
            warning = "המונה מדווח כגנוב"
            if credit_months > 0:
                warning += f" — שים לב: למונה יתרת שרות של {credit_months} חדשי שרות"
        # DEPOSIT/REMOVED-while-installing are commented-out no-ops in the
        # original (no prompt, just proceeds) — nothing to check here.

    default_name = f"{(account.FamilyName or '').strip()} {(account.PrivatName or '').strip()}".strip()
    return MeterActionCheckOut(
        ok=True,
        warning=warning,
        actionLabel=_action_label(group, meter_cova),
        defaultName=default_name,
    )


def _resolve_meter_nr(
    db: Session, account: Account, meter_nr: int, confirm: bool
) -> MeterNrCheckOut:
    """Shared by check_meter_nr() and save_action() — see module docstring."""
    if meter_nr in NO_METER_SENTINELS or meter_nr <= 0:
        return MeterNrCheckOut(ok=False, error="אנא הכנס מספר מונה")

    existing = db.get(Meter, meter_nr)
    if existing is None:
        return MeterNrCheckOut(ok=True, newMeter=True)

    if existing.Status == METER_ACTIVE:
        # Hard block — matches real behavior: the original's disconnect-confirm
        # code after this point is unreachable dead code (an Exit Sub fires first).
        return MeterNrCheckOut(ok=False, error=f"המונה מדווח כפעיל במונית {existing.TaxiNr}")

    if existing.Status == METER_DEPOSIT:
        if existing.TaxiNr is not None and existing.TaxiNr != account.TaxiNr:
            if not confirm:
                return MeterNrCheckOut(
                    ok=False,
                    needsConfirm=True,
                    confirmMessage=f"המונה הזה מדווח כמופקד ממונית {existing.TaxiNr}",
                )
            return MeterNrCheckOut(ok=True, disconnectTaxi=existing.TaxiNr)
        return MeterNrCheckOut(ok=True)

    if existing.Status == METER_STOLEN:
        if not confirm:
            msg = f"המונה הזה מדווח כגנוב ממונית {existing.TaxiNr}"
            if existing.NewInstead:
                msg += " — שים לב: תמורת המונה ניתן מונה אחר"
            return MeterNrCheckOut(ok=False, needsConfirm=True, confirmMessage=msg)
        disconnect = existing.TaxiNr if existing.TaxiNr != account.TaxiNr else None
        return MeterNrCheckOut(ok=True, disconnectTaxi=disconnect)

    if existing.Status == METER_REMOVED:
        if not confirm:
            return MeterNrCheckOut(
                ok=False,
                needsConfirm=True,
                confirmMessage=f"המונה הזה מדווח כמוסר ממונית {existing.TaxiNr}",
            )
        disconnect = existing.TaxiNr if existing.TaxiNr != account.TaxiNr else None
        return MeterNrCheckOut(ok=True, disconnectTaxi=disconnect)

    return MeterNrCheckOut(ok=False, error="מצב מונה לא ידוע")


@router.post("/{taxi_nr}/meter-actions/check-meter-nr", response_model=MeterNrCheckOut)
def check_meter_nr(taxi_nr: int, payload: MeterNrCheckIn, db: Session = Depends(get_db)):
    """Dry-run of the meter-number resolution — see _resolve_meter_nr()."""
    account = _get_account_or_404(db, taxi_nr)
    return _resolve_meter_nr(db, account, payload.meterNr, payload.confirm)


@router.post("/{taxi_nr}/meter-actions/check-acc-paid", response_model=AccPaidCheckOut)
def check_acc_paid(taxi_nr: int, payload: AccPaidCheckIn, db: Session = Depends(get_db)):
    """Ported from txtAccPaid_Validate — only meaningful for install actions."""
    _get_account_or_404(db, taxi_nr)
    if payload.accPaid < 80000:
        return AccPaidCheckOut(ok=False, error="מספר לקוח לא חוקי")
    pool = db.get(Account, payload.accPaid)
    if pool is None:
        return AccPaidCheckOut(ok=False, error="מספר לקוח לא קיים")
    if payload.meterCova in (BOTH_COVA, METER_COVA) and (pool.PaidMeters or 0) <= 0:
        return AccPaidCheckOut(ok=False, error="ללקוח לא נשארו מונים")
    if payload.meterCova in (BOTH_COVA, COVA_COVA) and (pool.PaidCovas or 0) <= 0:
        return AccPaidCheckOut(ok=False, error="ללקוח לא נשארו כובעים")
    name = f"{(pool.FamilyName or '').strip()} {(pool.PrivatName or '').strip()}".strip()
    return AccPaidCheckOut(ok=True, name=name or None)


@router.post("/{taxi_nr}/meter-actions", response_model=MeterActionSaveOut)
def save_action(taxi_nr: int, payload: MeterActionSaveIn, db: Session = Depends(get_db)):
    """Ported from cmdSave_Click() + SaveHistory() in frmInstall.frm — see module docstring."""
    if payload.action not in ACTION_DEFS:
        raise HTTPException(status_code=422, detail=f"Unknown action {payload.action}")
    group, meter_cova = ACTION_DEFS[payload.action]

    account = _get_account_or_404(db, taxi_nr)
    # THIS WORKSTATION's branch Area, sent by the frontend — not account.Area — see module docstring.
    branch_area = payload.branch_area

    # Re-run the same guard-rails as check_action() right before writing.
    guard = check_action(taxi_nr, MeterActionCheckIn(action=payload.action), db)
    if not guard.ok:
        raise HTTPException(status_code=409, detail=guard.error)

    involves_meter = meter_cova in (BOTH_COVA, METER_COVA)
    involves_cova = meter_cova in (BOTH_COVA, COVA_COVA)

    new_meter = False
    disconnect_taxi: Optional[int] = None
    meter: Optional[Meter] = _get_current_meter(db, account)

    if group == "install" and involves_meter:
        if not payload.meterNr:
            raise HTTPException(status_code=422, detail="נא לאשר מספר מונה")
        resolution = _resolve_meter_nr(db, account, payload.meterNr, payload.confirmDisconnect)
        if not resolution.ok:
            # needsConfirm bubbles up as 409 so the client can show the
            # confirmation dialog and resubmit with confirmDisconnect=True.
            raise HTTPException(
                status_code=409,
                detail=resolution.confirmMessage if resolution.needsConfirm else resolution.error,
            )
        new_meter = resolution.newMeter
        disconnect_taxi = resolution.disconnectTaxi
        meter = None if new_meter else db.get(Meter, payload.meterNr)

    if group == "install" and involves_meter and not payload.carNr:
        raise HTTPException(status_code=422, detail="אנא הכנס מס' רישוי")

    now = datetime.now()

    # --- Acc80000 "pool" balance decrement — install only, matches
    # `If action = "הרכבה" Then ... If val(txtAccPaid) > 80000` in cmdSave_Click.
    if group == "install" and payload.accPaid and payload.accPaid > 80000:
        pool = db.get(Account, payload.accPaid)
        if pool is not None:
            if involves_meter:
                pool.PaidMeters = (pool.PaidMeters or 0) - 1
            if involves_cova:
                pool.PaidCovas = (pool.PaidCovas or 0) - 1

    # --- Disconnect repair — see module docstring on the corrected comparison. ---
    if group == "install" and disconnect_taxi and disconnect_taxi != taxi_nr:
        other = db.get(Account, disconnect_taxi)
        if other is not None and other.MeterNr == payload.meterNr:
            other.MeterNr = 0

    if involves_meter:
        if new_meter:
            meter = Meter(
                MeterNr=payload.meterNr,
                ExpDate=now.month * 10000 + now.year,
                Insurance=False,
                MeterType=(1 if payload.meterNr < 19000 else (5 if payload.meterNr > 53000 else 2)),
                MeterInsDate=now.year,
                TaxiNr=taxi_nr,
                Status=METER_ACTIVE,
                Station=account.Station,
            )
            db.add(meter)
            account.MeterNr = payload.meterNr

        assert meter is not None  # guaranteed by _REQUIRES_EXISTING_METER / new_meter above

        if group == "install":
            meter.Status = METER_ACTIVE
            # Ported from txtMeterNr_Validate's own writes when adopting an
            # existing (deposited/stolen/removed) meter — cmdSave_Click's own
            # general block never touches TaxiNr again, so this is the only
            # place it gets reassigned to the new taxi for that case (the
            # brand-new-meter case already sets it above, in the AddNew block).
            meter.TaxiNr = taxi_nr
            account.MeterNr = meter.MeterNr
            meter.CarNr = payload.carNr
            account.CarNr = payload.carNr
            meter.Memir = False
        elif group == "deposit":
            meter.Status = METER_DEPOSIT
            meter.ActionDate = _fmt_ddmmyyyy(now.date())
            meter.DepositArea = branch_area + 1
        elif group == "remove":
            meter.Status = METER_REMOVED
        elif group == "stolen":
            meter.Status = METER_STOLEN

        meter.Date = _fmt_ddmmyyyy(payload.actualDate)
        meter.Name = payload.name.strip()
        meter.MeterStatusFlag = 0
        meter.NewInstead = False
        if meter.AccPaid is None:
            meter.AccPaid = 0
        if meter.Remark is None:
            meter.Remark = "    "

    if involves_cova:
        if group == "install":
            account.CovaStatus = METER_ACTIVE
            account.CovaType = 1
            account.CovaInsDate = now.month * 100 + (now.year % 100)
            account.Basis = False
            account.Bakar = False
        elif group == "deposit":
            account.CovaStatus = METER_DEPOSIT
        elif group == "remove":
            account.CovaStatus = METER_REMOVED
        elif group == "stolen":
            account.CovaStatus = METER_STOLEN

    db.flush()

    history = History(
        TaxiNr=taxi_nr,
        MeterNr=account.MeterNr,
        CarNr=account.CarNr,
        Status=GROUP_BASE[group] + meter_cova,
        Date=now.date(),
        Time=now.time(),
        Name=payload.name.strip(),
        CovaType=account.CovaType,
        CovaStatus=account.CovaStatus,
        Bakar=account.Bakar,
        Basis=account.Basis,
        Area=branch_area,
    )
    if meter is not None:
        history.ExpDate = meter.ExpDate
        history.Insurance = meter.Insurance
        history.Memir = meter.Memir
    db.add(history)

    db.commit()
    db.refresh(account)

    return MeterActionSaveOut(ok=True, meterNr=account.MeterNr, meterStatus=(meter.Status if meter else None), covaStatus=account.CovaStatus)


@router.post("/{taxi_nr}/meter-actions/replace-meter", response_model=ReplaceMeterOut)
def replace_meter(taxi_nr: int, payload: ReplaceMeterIn, db: Session = Depends(get_db)):
    """
    Ported from action=12 ("הכנס מספר מונה חדש") in Account.frm's
    lstMeterActions_DblClick — a distinct, separately-coded flow from
    frmInstall.frm: retires the taxi's CURRENT meter (status -> REMOVED,
    expiry reset to this month) and registers a brand-new meter number that
    inherits the old meter's status/expiry/insurance/type/station/etc.
    Writes TWO History rows, matching the original exactly (status=44 for
    the replacement marker — best-guess label, not confirmed against a real
    Actions row — then status=REMOVED for the retired meter).
    """
    account = _get_account_or_404(db, taxi_nr)
    branch_area = payload.branch_area  # THIS WORKSTATION's branch Area, sent by the frontend — see module docstring.
    if account.MeterNr is None or account.MeterNr in NO_METER_SENTINELS:
        raise HTTPException(status_code=409, detail="אין מונה המדווח כמורכב במונית")

    if db.get(Meter, payload.newMeterNr) is not None:
        raise HTTPException(status_code=409, detail="המונה כבר קיים")

    old_meter = db.get(Meter, account.MeterNr)
    if old_meter is None:
        raise HTTPException(status_code=409, detail="המונה הישן לא נמצא")

    now = datetime.now()
    name = f"{(account.FamilyName or '').strip()} {(account.PrivatName or '').strip()}".strip()

    old_status = old_meter.Status
    old_exp_date = old_meter.ExpDate  # snapshot — MeterRecM isn't refreshed after this write in the original
    old_insurance = old_meter.Insurance

    old_meter.Status = METER_REMOVED
    old_meter.ActionDate = _fmt_ddmmyyyy(now.date())
    old_meter.ExpDate = now.month * 10000 + now.year

    new_meter = Meter(
        MeterNr=payload.newMeterNr,
        TaxiNr=account.TaxiNr,
        CarNr=old_meter.CarNr,
        MeterInsDate=now.year,
        ExpDate=old_exp_date,
        Insurance=old_insurance,
        AccPaid=old_meter.AccPaid,
        Status=old_status,
        NewInstead=False,
        MeterType=old_meter.MeterType,
        Date=_fmt_ddmmyyyy(now.date()),
        ActionDate=_fmt_ddmmyyyy(now.date()),
        Memir=False,
        MeterStatusFlag=old_meter.MeterStatusFlag,
        Name=name,
        Station=old_meter.Station,
        DepositArea=old_meter.DepositArea,
    )
    db.add(new_meter)

    account.MeterNr = payload.newMeterNr
    db.flush()

    db.add(
        History(
            TaxiNr=account.TaxiNr,
            MeterNr=account.MeterNr,
            CarNr=account.CarNr,
            Date=now.date(),
            Time=now.time(),
            Name=name,
            Area=branch_area,
            ExpDate=old_exp_date,
            Status=_REPLACE_METER_STATUS,
        )
    )
    db.add(
        History(
            TaxiNr=account.TaxiNr,
            MeterNr=old_meter.MeterNr,
            CarNr=account.CarNr,
            ExpDate=old_exp_date,
            Insurance=old_insurance,
            Status=METER_REMOVED,
            Date=now.date(),
            Time=now.time(),
            Name=name,
            Area=branch_area,
        )
    )

    db.commit()
    return ReplaceMeterOut(ok=True, meterNr=payload.newMeterNr)


@router.post("/{taxi_nr}/meter-actions/reset-pool", response_model=ResetPoolOut)
def reset_pool_balances(taxi_nr: int, db: Session = Depends(get_db)):
    """
    Ported from the TaxiNr>=80000 early-return branch of cmdMeters_Click in
    Account.frm — a completely different, much simpler feature from the
    13-action menu below: zeroes out a pool/admin account's remaining
    meter/cap balances.
    """
    account = _get_account_or_404(db, taxi_nr)
    if taxi_nr < 80000:
        raise HTTPException(status_code=422, detail="Only valid for pool accounts (TaxiNr >= 80000)")
    account.PaidMeters = 0
    account.PaidCovas = 0
    db.commit()
    return ResetPoolOut(ok=True)
