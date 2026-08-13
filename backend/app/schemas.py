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
