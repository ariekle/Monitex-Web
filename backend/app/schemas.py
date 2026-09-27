"""Pydantic request/response models for the API."""
from datetime import date, datetime, time
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class AccountOut(BaseModel):
    """
    Full record as returned by GET /api/account/{taxi_nr} — Account table
    fields plus a few fields joined in from the linked Meters row (ExpDate,
    MeterType, Insurance aren't columns on Accounts, see models.py docstring).
    """

    model_config = ConfigDict(from_attributes=True)

    TaxiNr: int
    CarNr: Optional[int] = None
    MeterNr: Optional[int] = None

    FamilyName: Optional[str] = None
    PrivatName: Optional[str] = None

    Street: Optional[str] = None
    HomeNr: Optional[str] = None
    Town: Optional[str] = None
    ZipCode: Optional[int] = None

    TelHome: Optional[str] = None
    TelWork: Optional[str] = None
    TelCell: Optional[str] = None

    Station: Optional[str] = None
    Area: Optional[int] = None
    # Joined from the real Areas DB lookup table (same one History.AreaLabel
    # uses) — NOT a hardcoded/text-file mapping, so renaming or adding an
    # area only ever needs a DB row changed. See routers/account.py.
    AreaLabel: Optional[str] = None

    CovaInsDate: Optional[int] = None  # coded value, not a real date — see models.py
    CovaType: Optional[int] = None
    CovaStatus: Optional[int] = None

    PaidMeters: Optional[int] = None
    InsMeters: Optional[int] = None
    PaidCovas: Optional[int] = None
    InsCovas: Optional[int] = None
    Checks: Optional[int] = None
    Basis: Optional[int] = None
    Bakar: Optional[int] = None

    Msg: Optional[str] = None
    RemarkDate: Optional[datetime] = None

    Modem: Optional[int] = None
    ModemPaid: Optional[bool] = None

    # Joined from Meters via MeterNr (None if no meter assigned) — see models.py
    MeterExpDate: Optional[int] = None  # encoded month*10000+year, e.g. 112016 = Nov 2016
    MeterType: Optional[int] = None  # confirmed int code via runtime validation error
    Insurance: Optional[bool] = None  # confirmed bool via runtime validation error
    # 1=פעיל, 2=גנוב, 3=מופקד, 4=מוסר (0/None=unset) — see Meter.Status in models.py
    MeterStatus: Optional[int] = None


class AccountUpdate(BaseModel):
    """
    Editable fields only — mirrors what cmdUpdate_Click unlocks in the VB6 form
    (family/private name, station, street, home nr, town, zip, phones, car nr,
    message). TaxiNr, meter/cap fields, etc. are not editable from this screen
    in the original app.

    max_length on the string fields matches the real Accounts column widths
    (see models.py Account) — the original VB6 TextBoxes enforced these via
    MaxLength, but nothing here did, so a longer value would previously reach
    SQL Server and fail as an unhandled "String or binary data would be
    truncated" error (opaque 500, no detail) instead of a clean validation
    message. Enforcing it here turns that into a proper 422.
    """

    FamilyName: Optional[str] = Field(default=None, max_length=12)
    PrivatName: Optional[str] = Field(default=None, max_length=10)
    Station: Optional[str] = Field(default=None, max_length=10)
    Street: Optional[str] = Field(default=None, max_length=11)
    HomeNr: Optional[str] = Field(default=None, max_length=5)
    Town: Optional[str] = Field(default=None, max_length=12)
    ZipCode: Optional[int] = None
    TelHome: Optional[str] = Field(default=None, max_length=11)
    TelWork: Optional[str] = Field(default=None, max_length=11)
    TelCell: Optional[str] = Field(default=None, max_length=11)
    CarNr: Optional[int] = None
    Msg: Optional[str] = Field(default=None, max_length=64)


class AccountSearchResult(BaseModel):
    """
    One row of the taxi picklist shown while searching by family name — web
    equivalent of the "Names" DBList in Account.frm, bound to "SELECT
    FamilyName+PrivatName as name,TaxiNr FROM Accounts where FamilyName LIKE
    '...%' order by name". See routers/account.py's search_accounts_by_name.
    """

    model_config = ConfigDict(from_attributes=True)

    TaxiNr: int
    FamilyName: str
    PrivatName: str


class HistoryEntryOut(BaseModel):
    """One row of the History audit log, with the Status code resolved to its Hebrew label."""

    model_config = ConfigDict(from_attributes=True)

    TransNr: int
    Date: Optional[date] = None
    Time: Optional[time] = None
    Status: Optional[int] = None
    ActionLabel: Optional[str] = None  # joined from Actions.action, stripped of padding

    Name: Optional[str] = None
    TaxiNr: Optional[int] = None
    OldTaxiNr: Optional[int] = None
    MeterNr: Optional[int] = None
    CarNr: Optional[int] = None
    Area: Optional[int] = None
    AreaLabel: Optional[str] = None  # joined from Areas.name, stripped of padding

    ExpDate: Optional[int] = None  # encoded month*10000+year, same as Account.MeterExpDate
    Insurance: Optional[bool] = None

    InvoiceNr: Optional[int] = None
    InvType: Optional[int] = None
    AccPaid: Optional[int] = None
    AmountPaid: Optional[int] = None
    AmountGet: Optional[int] = None


class AreaOut(BaseModel):
    """One row of the real Areas DB lookup table — see routers/account.py / models.py Area."""

    model_config = ConfigDict(from_attributes=True)

    area: int
    name: Optional[str] = None


class PriceListItemOut(BaseModel):
    """
    A line-item catalog entry. UnitPrice defaults from Price1 but stays
    editable in the UI. Price1..Price6, when an item has more than one of
    them populated, represent an installment split (e.g. Price1 = first
    payment, Price2 = second, ...) rather than per-area pricing — see
    create_invoice()'s service/insurance handling, ported from the line-item
    processing loop in SaveRec() (frmInvRec.frm): paying the item's FULL
    combined total (Price1+...+Price6) in one line is treated as paying for
    the whole year in one go, while paying less (e.g. just Price1) means
    they're mid-installment and the office manually enters how many months
    that installment covers.
    add_service/add_insurance/add_modem_service mirror the identically-named
    PriceList columns used by that same loop.
    """

    model_config = ConfigDict(from_attributes=True)

    Code: int
    Name: Optional[str] = None
    Price1: Optional[float] = None
    Price2: Optional[float] = None
    Price3: Optional[float] = None
    Price4: Optional[float] = None
    Price5: Optional[float] = None
    Price6: Optional[float] = None
    add_insurance: Optional[bool] = None
    add_service: Optional[bool] = None
    add_modem_service: Optional[bool] = None


class InvoiceLineIn(BaseModel):
    Code: int
    Amount: int
    UnitPrice: Optional[float] = None  # if omitted, server looks up PriceList.Price1
    # Only required when this line's item has add_service=True AND its
    # subtotal doesn't match the item's full combined price (Price1+...+
    # Price6) — i.e. an installment payment, not a one-shot full payment.
    # Ported from the frmNrEnter prompt ("...הכנס מס. חודשים לקידום") in
    # SaveRec() (frmInvRec.frm); range 1-18 matches that dialog's own check.
    AddMonths: Optional[int] = None


class VatRateOut(BaseModel):
    """Current global VAT rate (percent), from the single CFG row."""

    rate: float


class NextInvoiceNumberOut(BaseModel):
    """
    Preview of the number the *next* saved document of this type would get,
    computed the same way as SaveRec() previews it when frmInvoice.frm opens
    a new document (before any line items are entered). This is informational
    only — create_invoice() recomputes it independently right before commit
    (matching SaveRec() recomputing again right before InvRec.Recordset.Update),
    so a stale preview here never causes a numbering collision.
    """

    InvNr: int
    DisplayNr: int  # InvNr % 1_000_000 — the number actually shown/printed


class PaymentMethodIn(BaseModel):
    """
    One payment slot (Invoices has 6). `method` maps to PaymentType per
    frmInvRec.frm: cash=1, check=2, credit=3/4/5 depending on `creditType`
    (see creditType() in frmInvRec.frm: 3="regular"/רגיל one-off charge,
    4="credit"/קרדיט deferred billing, 5="installments"/תשלומים — which is
    the only variant that uses `installments`). The card-issuer picker
    (lstCredCard, bank+20 offset) isn't ported — cardNr/cardExpDate are
    captured but not validated against a card-company table.
    """

    method: str  # "cash" | "check" | "credit"
    amount: float
    # check-only:
    checkNr: Optional[int] = None
    bankNr: Optional[int] = None
    snifNr: Optional[int] = None
    accountNr: Optional[int] = None
    checkDate: Optional[str] = None  # "DD/MM/YYYY" — char(10) in the DB, matches VB6's stored format
    # credit-only:
    cardNr: Optional[str] = None  # CCNr — char(16) in the DB
    cardExpDate: Optional[str] = None  # "MM/YY" — char(5) in the DB
    creditType: Optional[str] = None  # "regular" | "credit" | "installments"
    installments: Optional[int] = None  # only meaningful when creditType == "installments"


class InvoiceCreate(BaseModel):
    """
    doc_type: enforced server-side to one of the currently-issuable types
    (see ISSUABLE_TYPES in routers/invoices.py) regardless of what's sent.
    payments: required (>=1) for doc_type=HESHBONIT_KABALA(0) — a document
    that's also a receipt should record how it was paid. Optional/ignored for
    HESHBONIT(1), a pure invoice with no payment yet.
    buyer_name/buyer_tz: mirror txtName/txtTZ in frmInvRec.frm — required
    (non-blank / non-zero) server-side for HESHBONIT_KABALA, same as the
    original's cmdSave_Click validation. Ignored for HESHBONIT, which never
    captured these in the original form.
    rec_nr: the DISPLAY number (not raw InvNr) of an existing open KABALA
    receipt to link this document to — mirrors txtRecNr in frmInvoice.frm.
    Required server-side for HESHBONIT(1) (`If InvAction = HESHBONIT And
    val(txtRecNr) = 0 Then` blocks save in the original); ignored otherwise.
    confirm_extend_service / decline_extend_service: mirror the dlgContinue
    "ללקוח יש ביטוח בתוקף" / "לקדם תקופת ביטוח"/"לא לקדם/לקצר" confirmation in
    SaveRec() — only relevant when a line item would extend the linked
    meter's service expiry (see PriceListItemOut docstring) while that
    expiry hasn't lapsed yet. The first attempt with neither flag set gets a
    409 asking the caller to decide; resubmitting with
    confirm_extend_service=True extends anyway, resubmitting with
    decline_extend_service=True proceeds with saving the document but skips
    the extension for that line (matching the original: declining doesn't
    abort the save, it just skips advancing ExpDate).
    branch_area: which branch/office is issuing this document (0-9, matches
    the real Areas table) — sent by the frontend, which reads it from a
    one-time-per-workstation local setting (see frontend src/api/branch.ts).
    Web equivalent of the VB6 app reading its own meesql.cfg — since one
    shared backend can serve many branches' browsers here, this can't be a
    server-side constant like the original's `Public Area` global; it has to
    travel with the request instead. Must NOT be confused with the taxi's
    own Account.Area — see routers/invoices.py module docstring's Eilat note.
    paid_by_taxi_nr: required for HESHBONIT_ISKA(3) only — the TaxiNr of the
    DIFFERENT account actually being billed (mirrors txtPaidbyNr in
    frmInvoice.frm) — becomes Invoices.AccPaid, its looked-up name becomes
    Invoices.namePaid.
    credited_inv_nr: required for CREDIT_NOTE(4) only — the RAW InvNr (NOT
    the display number — see routers/invoices.py module docstring on why
    display numbers alone are ambiguous across document types) of the
    original document being credited, issued to this same taxi — becomes
    Invoices.RecNr once validated server-side.
    """

    doc_type: int
    lines: list[InvoiceLineIn]
    payments: list[PaymentMethodIn] = []
    buyer_name: Optional[str] = None
    buyer_tz: Optional[int] = None
    rec_nr: Optional[int] = None
    confirm_extend_service: bool = False
    decline_extend_service: bool = False
    branch_area: int
    paid_by_taxi_nr: Optional[int] = None
    credited_inv_nr: Optional[int] = None


class InvoiceLineOut(BaseModel):
    Code: Optional[int] = None
    Description: Optional[str] = None  # joined from PriceList.Name
    Amount: Optional[int] = None
    UnitPrice: Optional[float] = None
    SubTotal: Optional[float] = None


class OpenReceiptOut(BaseModel):
    """
    An existing KABALA receipt that still has an unconsumed balance —
    eligible to be linked to a HESHBONIT via rec_nr. Mirrors the F1 lookup
    in txtRecNr_KeyUp (frmInvoice.frm): Type=2, not reset, not
    ignore-in-reset, not deleted, and sum(Money1..6) > TotalInvs. `Remaining`
    matches lblRecLeft in checkRecNr().
    """

    DisplayNr: int  # what the user types/sees — InvNr % 1_000_000
    TaxiNr: Optional[int] = None
    Name: Optional[str] = None
    Date: Optional[date] = None
    Remaining: float


class InvoiceListItemOut(BaseModel):
    """Summary row for the 'העתק חשבונית' list."""

    InvNr: int
    DisplayNr: int  # InvNr % 1_000_000 — matches `txtInvNr = ... Mod 1000000` shown to users in VB6
    Type: Optional[int] = None
    TypeLabel: Optional[str] = None
    Date: Optional[date] = None
    Time: Optional[time] = None
    Name: Optional[str] = None
    GrandTotal: Optional[float] = None
    Deleted: Optional[bool] = None
    Printed: Optional[bool] = None


class InvoiceMarkPrintedOut(BaseModel):
    """Response for POST .../mark-printed — see routers/invoices.py."""

    wasAlreadyPrinted: bool


class PaymentMethodOut(BaseModel):
    method: str  # "cash" | "check" | "credit" | "unknown" (unrecognized PaymentType code)
    amount: Optional[float] = None
    checkNr: Optional[int] = None
    bankNr: Optional[int] = None
    snifNr: Optional[int] = None
    accountNr: Optional[int] = None
    checkDate: Optional[str] = None
    cardNr: Optional[str] = None
    cardExpDate: Optional[str] = None
    creditType: Optional[str] = None  # "regular" | "credit" | "installments" | None
    installments: Optional[int] = None


class InvoiceOut(InvoiceListItemOut):
    """Full detail for viewing one invoice."""

    RecNr: Optional[int] = None
    TaxiNr: Optional[int] = None
    Tz: Optional[int] = None  # ת.ז — payer's Israeli ID, captured for חש/קבלה
    Town: Optional[str] = None
    Street: Optional[str] = None
    HomeNr: Optional[str] = None
    ZipCode: Optional[int] = None
    Lines: list[InvoiceLineOut] = []
    Total: Optional[float] = None  # sum of line subtotals
    Vat: Optional[float] = None  # rate snapshot at issue time
    TotalVat: Optional[float] = None  # VAT amount
    Payments: list[PaymentMethodOut] = []


# --- "פעולות במונה וכובע" (meter/cap actions) — ported from frmInstall.frm
# and the lstMeterActions_DblClick guard-rails in Account.frm. See
# routers/meter_actions.py module docstring for the full mapping. ---


class MeterActionCheckIn(BaseModel):
    action: int  # 0-11, index into ACTION_DEFS in routers/meter_actions.py


class MeterActionCheckOut(BaseModel):
    ok: bool
    error: Optional[str] = None  # blocking — matches frmMsg popups, e.g. "!!!המונה מדווח כמופקד"
    warning: Optional[str] = None  # informational only, e.g. leftover stolen-meter service credit
    actionLabel: Optional[str] = None  # e.g. "דווח על הרכבת מונה וכובע"
    defaultName: Optional[str] = None  # account holder's name — txtName's default


class MeterNrCheckIn(BaseModel):
    meterNr: int
    confirm: bool = False  # resubmit with True after the user accepts a needsConfirm prompt


class MeterNrCheckOut(BaseModel):
    ok: bool
    error: Optional[str] = None
    needsConfirm: bool = False
    confirmMessage: Optional[str] = None
    newMeter: bool = False  # this meter nr doesn't exist yet — will be registered fresh on save
    disconnectTaxi: Optional[int] = None  # another taxi currently holds this meter — will be cleared on save


class AccPaidCheckIn(BaseModel):
    accPaid: int
    meterCova: int  # 1=meter, 2=cap, 3=both — which pool balance(s) to check


class AccPaidCheckOut(BaseModel):
    ok: bool
    error: Optional[str] = None
    name: Optional[str] = None  # the pool account's holder name — suggested default for txtName


class MeterActionSaveIn(BaseModel):
    action: int  # 0-11
    name: str
    actualDate: date
    meterNr: Optional[int] = None  # required when the action involves the meter (meterCova 1 or 3)
    carNr: Optional[int] = None  # required for install (הרכבה) actions involving the meter
    accPaid: Optional[int] = None
    confirmDisconnect: bool = False  # must be True if a prior check-meter-nr call returned needsConfirm
    branch_area: int  # which branch is performing this action — see InvoiceCreate.branch_area docstring


class MeterActionSaveOut(BaseModel):
    ok: bool = True
    meterNr: Optional[int] = None
    meterStatus: Optional[int] = None
    covaStatus: Optional[int] = None


class ReplaceMeterIn(BaseModel):
    newMeterNr: int
    branch_area: int  # which branch is performing this action — see InvoiceCreate.branch_area docstring


class ReplaceMeterOut(BaseModel):
    ok: bool = True
    meterNr: int


class ResetPoolOut(BaseModel):
    ok: bool = True


class ModemActionIn(BaseModel):
    action: int  # 0=install/activate, 1=remove — see modem_action() docstring
    branch_area: int


class ModemActionOut(BaseModel):
    ok: bool = True
    modem: Optional[int] = None


class ExpiryReduceIn(BaseModel):
    months: int
    branch_area: int


class ExpiryTransferIn(BaseModel):
    months: int
    target_taxi_nr: int
    branch_area: int


class ExpiryActionOut(BaseModel):
    ok: bool = True
    expDate: int


class ExpiryTransferOut(BaseModel):
    ok: bool = True
    sourceExpDate: int
    targetTaxiNr: int
    targetExpDate: int


class ResetCheckOut(BaseModel):
    """One check due for deposit, part of a reset preview/commit — see routers/reset.py."""

    checkNr: int
    taxiNr: Optional[int] = None
    bankNr: Optional[int] = None
    accountNr: Optional[int] = None
    snifNr: Optional[int] = None
    dueDate: Optional[str] = None
    money: float
    cashNow: bool  # True if dueDate <= the chosen deposit date, matching cash_check() in frmReset1.frm


class ResetKupaLineOut(BaseModel):
    """Per-price-code (accounting "kupa") breakdown line, net of VAT."""

    code: int
    name: Optional[str] = None
    count: int
    total: float  # net of VAT; CREDIT_NOTE lines subtract


class ResetPreviewOut(BaseModel):
    """
    Reset (איפוס) summary for a branch — everything currently un-reset
    (Invoices.ResetNr=0) for the given branch_area. See routers/reset.py
    module docstring for exactly which fields of the original's ActiveReset/
    Resets tables this covers vs. deliberately simplifies. `blocking` lists
    problems that would abort the reset in the original (a HESHBONIT whose
    linked receipt is missing, or a KABALA that isn't fully reconciled) — if
    non-empty, this preview cannot be committed until they're resolved.
    """

    branchArea: int
    depositDate: str
    depositBank: int
    blocking: list[str] = []

    invRecsCount: int
    invRecsTotal: float
    invoicesCount: int
    invoicesTotal: float
    receiptsCount: int
    receiptsTotal: float
    iskaCount: int
    iskaTotal: float
    creditsCount: int
    creditsTotal: float

    totalKupa: float  # net-of-VAT total across invRecs+invoices, minus credits
    totalVat: float

    cashTotal: float
    checksCashNowTotal: float
    checksCashNowCount: int
    checksDelayedTotal: float
    checksDelayedCount: int
    checks: list[ResetCheckOut] = []

    creditImmediateTotal: float  # PaymentType 3/4 — regular + "credit now"
    creditInstallmentsTotal: float  # PaymentType 5

    totalDepo: float  # grand total actually being deposited (cash+checks+credit)

    kupaBreakdown: list[ResetKupaLineOut] = []


class ResetCommitIn(BaseModel):
    branch_area: int
    deposit_date: str  # "YYYY-MM-DD"
    deposit_bank: int  # 0-3, matches print_summary()'s depo_bank in frmReset1.frm


class ResetCommitOut(BaseModel):
    resetNr: int
    summary: ResetPreviewOut


class ResetLookupOut(BaseModel):
    """
    A single archived Resets row, for GET /api/reset/lookup. Ported from
    Account.frm's Alt+F5 shortcut (txtTaxiNr_KeyDown) — the only place in the
    original app that lets someone find and reprint a past reset by either
    its ResetNr directly, or by resetdate+area. See routers/reset.py for the
    query logic. Unlike ResetPreviewOut this reads the already-committed
    totals straight off the Resets row (no re-computation from Invoices/
    Checks — those have long since been stamped with this ResetNr and moved
    on), so there's no `blocking`/`checks`/`kupaBreakdown` here.
    """

    resetNr: int
    area: int
    resetDate: Optional[str] = None  # the day the reset was performed (Resets.resetDate)
    depositDate: Optional[str] = None
    depositBank: Optional[int] = None

    invRecsCount: int
    invRecsTotal: float
    invoicesCount: int
    invoicesTotal: float
    receiptsCount: int
    receiptsTotal: float
    iskaCount: int
    iskaTotal: float
    creditsCount: int
    creditsTotal: float

    totalKupa: float
    totalVat: float

    cashTotal: float
    checksCashNowTotal: float
    checksCashNowCount: int
    checksDelayedTotal: float
    checksDelayedCount: int

    creditImmediateTotal: float
    creditInstallmentsTotal: float

    totalDepo: float


class PendingHashResetOut(BaseModel):
    """
    One row of GET /api/reset/pending-hash — a faithful port of
    frmSendtoHash.frm's grid ("העברה לחשבשבת" / "Transfer to Hashavshevת"),
    the original screen for resending not-yet-processed resets. See
    routers/reset.py's list_pending_hash_resets() for the exact ported
    query.
    """

    resetNr: int
    area: int
    areaName: str
    resetDate: Optional[str] = None


class TestPrintIn(BaseModel):
    """
    Ported from printTest(model As Integer) in Account.frm — model=0 is the
    Alt+F1 "auto-detect meter type" path, model=1 is Shift+F1's "type it in
    manually" path (frmTextEnter prompt in the original).
    """

    branch_area: int
    model: int = Field(ge=0, le=1)
    # Required when model=1 ("!!!הכנס דגם מונה" if missing in the original);
    # ignored when model=0 (auto-computed server-side instead).
    meter_type_override: Optional[str] = None
    # Always required — the original's second frmTextEnter prompt
    # ("הכנס מודל רכב") has no auto path at all.
    vehicle_model: str


class TestPrintOut(BaseModel):
    """Resolved values for the web app to hand to the print bridge's /print/test route — see WebCode/print-bridge/README.md."""

    taxiNr: int
    carnr: int
    meterType: str
    vehicleModel: str
    testNr: int  # 0 if this branch's Areas.PrintTestNr is not set


# --- "שיקים חוזרים" (returned/bounced checks) — ported from
# Code/frmBackCheck.frm. See routers/bad_checks.py and models.py's
# BadChecks docstring for the full workflow and its unconfirmed-schema
# caveats. ---


class BadCheckOptionsOut(BaseModel):
    """
    The three fixed pick-lists from frmBackCheck.frx's ListBoxes — hand-
    extracted from the binary .frx resource, see BadChecks model docstring.
    `statuses` has one entry fewer than the original (7 of 8 — the 8th was
    lost to a byte-offset issue while parsing); Statustxt is a plain string
    column either way, so a caller can still type any value, including the
    unrecovered one.
    """

    reasons: list[str]
    banks: list[str]
    statuses: list[str]


class BadCheckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    BadCheckNr: int
    CheckNr: int
    AccountNr: Optional[int] = None
    SnifNr: Optional[int] = None
    BankNr: Optional[int] = None
    BankName: Optional[str] = None  # resolved via BankName() (Main.bas) — the check's OWN issuing bank
    ReturnBank: Optional[int] = None
    ReturnBankName: Optional[str] = None  # resolved via BankName() — the last-set "returned via" bank code
    InvNr: int
    Money: float
    DueDate: Optional[str] = None
    TaxiNr: int
    Name: Optional[str] = None
    Town: Optional[str] = None
    Street: Optional[str] = None
    HomeNr: Optional[str] = None
    Tz: Optional[int] = None
    ZipCode: Optional[int] = None
    FamilyName: Optional[str] = None
    CellPhone: Optional[str] = None
    Lost: bool = False
    Statustxt: Optional[str] = None
    Reason: Optional[str] = None
    PaidCheck: float = 0
    PaidOver: float = 0
    Date1: Optional[str] = None
    Msg1: Optional[str] = None
    Date2: Optional[str] = None
    Msg2: Optional[str] = None
    Date3: Optional[str] = None
    Msg3: Optional[str] = None
    Date4: Optional[str] = None
    Msg4: Optional[str] = None
    Date5: Optional[str] = None
    Msg5: Optional[str] = None
    # Computed, not stored — see _bad_check_debit() in routers/bad_checks.py
    # (ported from debit() in frmBackCheck.frm).
    Debit: float  # today's late fee/interest, based on months since DueDate
    ToPay: float  # Debit + Money — matches txttoPay exactly (NOT reduced by PaidCheck, see model docstring)
    StillCollectible: bool  # PaidCheck < Money and not Lost — mirrors when the original unlocks the payment fields


class BadCheckReportIn(BaseModel):
    """Identifies the existing `Checks` row being reported as bounced — mirrors txtCheckNr/txtAccount/txtSnif in find_Check(checkBy:=0)."""

    check_nr: int
    account_nr: int
    snif_nr: int


class BadCheckPayCheckIn(BaseModel):
    """Repaying (all or part of) the original check amount — issued as a standalone קבלה (KABALA), IgnoreInReset=1."""

    payments: list[PaymentMethodIn]


class BadCheckPayInterestIn(BaseModel):
    """
    Charging the late fee/interest — issued as a חש/קבלה (HESHBONIT_KABALA),
    IgnoreInReset=2. Unlike the original (which sets Money1/SubTotal1
    directly from the typed interest amount, bypassing PriceList entirely —
    see BadChecks model docstring), this requires real PriceList line(s)
    like any other invoice; keep a dedicated price-list code for this.
    """

    lines: list[InvoiceLineIn]
    payments: list[PaymentMethodIn]


class BadCheckRepayIn(BaseModel):
    """
    Mirrors frmBackCheck's single cmdSave_Click for an EXISTING bad check:
    one save can update the editable fields, and/or collect money via
    pay_check/pay_interest (either, both, or neither — matching the
    original's three save branches). branch_area is only required if
    pay_check or pay_interest is present (needed by the invoice they spin
    off) — see routers/invoices.py's InvoiceCreate docstring for why this
    can't be a server-side constant.
    """

    branch_area: Optional[int] = None
    pay_check: Optional[BadCheckPayCheckIn] = None
    pay_interest: Optional[BadCheckPayInterestIn] = None
    family_name: Optional[str] = None
    cell_phone: Optional[str] = None
    street: Optional[str] = None
    home_nr: Optional[str] = None
    town: Optional[str] = None
    zip_code: Optional[int] = None
    reason: Optional[str] = None
    return_bank_name: Optional[str] = None  # free text (matches txtReturnBank) — collapsed to Bank 0/1 on save, see model docstring
    statustxt: Optional[str] = None
    date1: Optional[str] = None
    msg1: Optional[str] = None
    date2: Optional[str] = None
    msg2: Optional[str] = None
    date3: Optional[str] = None
    msg3: Optional[str] = None
    date4: Optional[str] = None
    msg4: Optional[str] = None
    date5: Optional[str] = None
    msg5: Optional[str] = None


class BadCheckRepayOut(BaseModel):
    badCheck: BadCheckOut
    checkReceiptInvNr: Optional[int] = None  # raw InvNr of the KABALA issued, if pay_check was sent
    interestInvoiceInvNr: Optional[int] = None  # raw InvNr of the HESHBONIT_KABALA issued, if pay_interest was sent
