"""
SQLAlchemy models for the Monitex tables used by the Account screen
(Code/Account.frm — see WebCode/README.md correction note).

`Account` columns below are confirmed against the real DB via:
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Accounts'
    ORDER BY ORDINAL_POSITION;
(as of 2026-08-10).

`Meter` is NOT yet confirmed — ExpDate/MeterType/Insurance aren't columns on
Accounts, they're read from the Meters table in the VB6 code
(`MeterRecM.Recordset![expDate]` etc. in cmdSave_Click), joined via MeterNr.
Run the same INFORMATION_SCHEMA query against `Meters` and reconcile this.

Notes on odd-looking real columns:
- `FamilyName` (varchar 12) / `PrivatName` (varchar 10) — genuinely this short
  in the live DB. Names get truncated; not a modeling mistake.
- `CovaInsDate` is `smallint`, not a date, despite the name — probably a
  legacy encoded value (e.g. days-since-epoch) rather than a real DATE/DATETIME.
  Left as a plain integer here; do NOT try to decode it as a date without
  confirming the encoding against known-good sample rows first.
- `CovaType` / `CovaStatus` are `tinyint` codes, not free text — the screen's
  "מצב כובע" is a coded status, likely resolved via a lookup table (maybe
  `CFG`). The frontend currently just displays the raw number.
"""
from sqlalchemy import Column, BigInteger, Integer, SmallInteger, String, DateTime, Date, Time, Boolean, Float, Numeric
from .database import Base

# Document type constants — from Public Const declarations in Code/Main.bas,
# confirmed against Code/frmInvoice.frm's SaveRec()/Form_Load() usage.
HESHBONIT_KABALA = 0  # חש/קבלה — shares one number series with HESHBONIT (see compute_next_invoice_number)
HESHBONIT = 1  # חשבונית
KABALA = 2  # קבלה
HESHBONIT_ISKA = 3  # חש. עסקה — billed to a DIFFERENT account (Invoices.AccPaid) than the one issuing it
CREDIT_NOTE = 4  # ת. זיכוי — references an original document via Invoices.RecNr
TEUDAT_MISHLOAH = 5  # ת. משלוח


class Account(Base):
    """Accounts table — one row per taxi/license (TaxiNr). Schema confirmed."""

    __tablename__ = "Accounts"

    TaxiNr = Column(BigInteger, primary_key=True)
    CarNr = Column(BigInteger)
    MeterNr = Column(BigInteger)

    FamilyName = Column(String(12))
    PrivatName = Column(String(10))

    Street = Column(String(11))
    HomeNr = Column(String(5))
    Town = Column(String(12))
    ZipCode = Column(Integer)

    TelHome = Column(String(11))
    TelWork = Column(String(11))
    TelCell = Column(String(11))

    Station = Column(String(10))
    Area = Column(SmallInteger)

    # "Cap" (כובע) fields — coded, not free text. See module docstring.
    CovaInsDate = Column(SmallInteger)  # NOT a real date column despite the name
    CovaType = Column(SmallInteger)  # actually tinyint in DB; SmallInteger is a safe superset
    CovaStatus = Column(SmallInteger)

    PaidMeters = Column(SmallInteger)
    InsMeters = Column(SmallInteger)
    PaidCovas = Column(SmallInteger)
    InsCovas = Column(SmallInteger)
    Checks = Column(SmallInteger)
    Basis = Column(SmallInteger)
    Bakar = Column(SmallInteger)

    Msg = Column(String(64))  # הערה
    RemarkDate = Column(DateTime)  # smalldatetime in DB

    Modem = Column(SmallInteger)
    ModemPaid = Column(Boolean)


class Meter(Base):
    """
    Meters table — still not fully confirmed via INFORMATION_SCHEMA.COLUMNS,
    reconstructed from how Account.frm's MeterRec/MeterRecM ADO controls use it
    ("select* from Meters where meternr=-1"), corrected against a real
    validation error seen at runtime:
    - MeterType is an int code (e.g. `2`), not a string — fixed below.
    - Insurance is a bool (e.g. `True`), not a string — fixed below.
    ExpDate is still an unverified guess (DateTime) — hasn't errored yet, but
    that may just mean no row exercised has a non-null value. Confirm the rest
    with INFORMATION_SCHEMA.COLUMNS before trusting this further.
    """

    __tablename__ = "Meters"

    MeterNr = Column(BigInteger, primary_key=True)
    CarNr = Column(BigInteger)
    Name = Column(String(50))  # written as Trim(FamilyName) & " " & Trim(PrivatName) on save
    # תוקף שרות — NOT a real date column despite the name. Confirmed via a real
    # row: value 112016 = month 11, year 2016 (November 2016). Encoding is
    # month * 10000 + year (no zero-padding, so digit count varies: 112016 for
    # Nov 2016, but e.g. 12016 for Jan 2016 — decode with floor(n/10000) /
    # n % 10000, not by string-slicing a fixed width.
    ExpDate = Column(Integer)
    MeterType = Column(Integer)  # סוג מונה — confirmed int via runtime error
    Insurance = Column(Boolean)  # ביטוח — confirmed bool via runtime error
    Station = Column(String(50))
    # מצב מונה — a tinyint code, NOT free text (same pattern as CovaStatus).
    # Confirmed via Code/Main.bas constants (ACTIVE=1, STOLEN=2, DEPOSIT=3,
    # REMOVED=4) and cross-checked against TWO independent forms' hardcoded
    # Select Case label mappings — Account.frm's lblMeterStatus_Change() and
    # frmDeposit.frm's own copy — which agree exactly:
    #   0 -> "" (unset)   1 -> "פעיל"   2 -> "גנוב"   3 -> "מופקד"   4 -> "מוסר"
    # frmDeposit.frm also confirms this by *writing* status=3 when a meter is
    # deposited (cmdDeposit: `MeterRec.Recordset![Status] = 3`).
    Status = Column(SmallInteger)

    # --- Below confirmed via frmInstall.frm's cmdSave_Click()/txtMeterNr_Validate()/
    # Form_Load() (the "פעולות במונה וכובע" install/deposit/remove/stolen flow) ---
    TaxiNr = Column(Integer)  # the taxi this meter is currently assigned to
    # "dd/mm/yyyy" TEXT, not a real date column — confirmed via a live runtime
    # error (SQL Server dialect choked trying to parse a real stored value,
    # '10/07/2026', as a date). Matches the VB6 write pattern exactly:
    # `Format(date, "dd/mm/yyyy")`, never a direct date assignment. Only set
    # on DEPOSIT (used later as credit_service()'s DepositDate when the meter
    # is removed) — currently a no-op, see MeterStatusFlag docstring below on
    # the disabled crediting logic.
    ActionDate = Column(String(10))
    # last-action date, "dd/mm/yyyy" TEXT for the same confirmed reason as
    # ActionDate above — set on EVERY install/deposit/remove/stolen save from
    # the form's (editable, defaults to today) txtActualDate field, distinct
    # from ActionDate above.
    Date = Column("date", String(10))
    DepositArea = Column(Integer)  # Area+1 at deposit time — see AreaRec lookup in Form_Load (`where area = depositarea - 1`)
    Remark = Column(String(50))  # defaults to "    " (spaces) if null on save, never actually collected from the UI
    MeterInsDate = Column(Integer)  # Year(date) — set only when a brand-new meter is registered
    NewInstead = Column(Boolean)  # "another meter was given in exchange" flag, shown as a warning when reactivating a STOLEN meter
    Memir = Column(Boolean)  # copied onto History.Memir; meaning not otherwise confirmed
    AccPaid = Column(Integer)  # the 80000+ "pool" account (if any) this meter/cap was supplied from — see txtAccPaid
    # A SEPARATE column from `Status` above (confirmed distinct: Account.frm's
    # action=12 branch sets `MeterRec![meterstatus] = MeterRecM![meterstatus]`
    # while ALSO separately touching `status`). Always written as 0 by
    # frmInstall.frm's save flow; no other write path or read-usage found, so
    # its purpose beyond that is unconfirmed.
    MeterStatusFlag = Column("meterstatus", SmallInteger)


class History(Base):
    """
    History table — the audit log written on every account change
    (cmdSave_Click etc. in Account.frm). Schema confirmed via
    INFORMATION_SCHEMA.COLUMNS (2026-08-10).

    ExpDate here uses the SAME month*10000+year integer encoding as
    Meters.ExpDate (see that class) — confirmed by the VB6 code copying it
    directly: `HistoryRec.Recordset![expDate] = MeterRecM.Recordset![expDate]`.

    `Name` is `char(32)` (fixed-width, space-padded), not `varchar` — strip
    trailing spaces when displaying.

    Many columns here are only meaningful for certain action types (invoice
    fields for billing actions, OldTaxiNr for transfers, etc.) — see the
    `Action` model / Actions table for the human-readable description of
    what `Status` means for a given row.
    """

    __tablename__ = "History"

    TransNr = Column(BigInteger, primary_key=True)
    TaxiNr = Column(Integer)
    MeterNr = Column(Integer)
    CarNr = Column(Integer)
    ExpDate = Column(Integer)  # encoded month*10000+year, same as Meters.ExpDate
    Insurance = Column(Boolean)
    Status = Column(SmallInteger)  # joins to Action.status for the description text
    Name = Column(String(32))  # char(32) in DB — space-padded, strip on display
    InvoiceNr = Column(Integer)
    OldTaxiNr = Column(Integer)
    AccPaid = Column(Integer)
    AmountPaid = Column(Integer)
    AmountGet = Column(Integer)
    InvType = Column(SmallInteger)
    Time = Column("time", Time)
    Date = Column("date", Date)
    CovaType = Column("covaType", SmallInteger)
    CovaStatus = Column("covaStatus", SmallInteger)
    MetersSupplied = Column(Integer)
    CovasSupplied = Column(Integer)
    Bakar = Column("bakar", Boolean)
    Basis = Column("basis", Boolean)
    Memir = Column("memir", Boolean)
    Area = Column("area", SmallInteger)


class Action(Base):
    """
    Actions lookup table — maps History.Status codes to Hebrew descriptions
    (e.g. status 11 = "הרכבת מונה"). Schema confirmed: `status` (smallint),
    `action` (nchar(20), space-padded — strip on display).
    """

    __tablename__ = "Actions"

    status = Column(SmallInteger, primary_key=True)
    action = Column(String(20))


class Area(Base):
    """
    Areas lookup table — maps Account.Area/History.Area codes to branch/city
    names (e.g. area 0 = "תל אביב"). Schema confirmed; only `area` (join key)
    and `name` (nchar(10), space-padded) are relevant here — the rest of the
    row is legacy per-branch config (paths, printer/bank settings, a login)
    not needed for display.
    """

    __tablename__ = "Areas"

    area = Column(SmallInteger, primary_key=True)
    name = Column(String(10))


class Invoice(Base):
    """
    Invoices table — one row per issued document (any of the 6 types).
    Schema confirmed via INFORMATION_SCHEMA.COLUMNS (2026-08-10).

    InvNr encodes the document type in its millions digit: type*1,000,000 to
    type*1,000,000+999,999, EXCEPT types HESHBONIT_KABALA(0) and HESHBONIT(1)
    which share one combined series (their PRINTED/visible number is
    `InvNr % 1000000` and must not collide between the two types) — see
    compute_next_invoice_number() in routers/invoices.py, ported from
    SaveRec() in Code/frmInvoice.frm.

    RecNr is a cross-reference, NOT the same as InvNr: for CREDIT_NOTE(4) it
    holds the original document's number being credited; for HESHBONIT(1) it
    optionally holds a linked KABALA(2) receipt number. Confirmed via
    `InvRec.Recordset![recnr] = txtRecNrCred` / `txtRecNr` in frmInvoice.frm.

    Name/FamilyName/PrivateName/Town/Street/HomeNr are a POINT-IN-TIME COPY of
    the account's details at issue time, not a live reference — matches
    `InvRec.Recordset![name] = Trim(txtFamilyName) & " " & Trim(txtPrivateName)`
    in SaveRec().

    Up to 6 line items (CodeN/AmountN/UnitPriceN/SubTotalN, N=1..6), each
    optionally CodeN referencing PriceList.Code. Up to 6 payment method slots
    (cash/check/credit-card — AccountNr/BankNr/.../PaymentTypeN, N=1..6) —
    modeled but not yet exposed in the create-invoice UI (Phase 1 doesn't
    collect payment details, see WebCode/README.md).
    """

    __tablename__ = "Invoices"

    # autoincrement=False: InvNr is NOT an identity column in the DB — it's
    # explicitly computed by compute_next_invoice_number() in
    # routers/invoices.py. Without this, SQLAlchemy assumes an Integer PK is
    # an identity column and wraps the insert in SET IDENTITY_INSERT ON/OFF,
    # which SQL Server rejects for a non-identity column (error 8106).
    InvNr = Column(Integer, primary_key=True, autoincrement=False)
    RecNr = Column(Integer)  # cross-reference, see docstring — NOT the invoice number
    TaxiNr = Column(Integer)
    Type = Column(SmallInteger)  # one of the *_KABALA/HESHBONIT/... constants above
    ResetNr = Column(Integer)
    ZipCode = Column(Integer)
    AccPaid = Column(Integer)  # for HESHBONIT_ISKA: the taxi actually being billed
    Tz = Column(Integer)  # ת.ז — Israeli ID number
    TotalInvs = Column(Float)
    Date = Column("Date", Date)
    Time = Column("time", Time)
    Printed = Column(Boolean)
    IgnoreInReset = Column(SmallInteger)
    Eilat = Column(Boolean)
    Area = Column(SmallInteger)
    Deleted = Column(Boolean)
    Name = Column(String(32))  # char(32) — space-padded, strip on display
    FamilyName = Column(String(16))
    PrivateName = Column(String(16))
    Town = Column(String(16))
    Street = Column(String(16))
    HomeNr = Column(String(10))

    Code1 = Column(SmallInteger)
    Amount1 = Column(SmallInteger)
    UnitPrice1 = Column(Float)
    SubTotal1 = Column(Float)
    Code2 = Column(SmallInteger)
    Amount2 = Column(SmallInteger)
    UnitPrice2 = Column(Float)
    SubTotal2 = Column(Float)
    Code3 = Column(SmallInteger)
    Amount3 = Column(SmallInteger)
    UnitPrice3 = Column(Float)
    SubTotal3 = Column(Float)
    Code4 = Column(SmallInteger)
    Amount4 = Column(SmallInteger)
    UnitPrice4 = Column(Float)
    SubTotal4 = Column(Float)
    Code5 = Column(SmallInteger)
    Amount5 = Column(SmallInteger)
    UnitPrice5 = Column(Float)
    SubTotal5 = Column(Float)
    Code6 = Column(SmallInteger)
    Amount6 = Column(SmallInteger)
    UnitPrice6 = Column(Float)
    SubTotal6 = Column(Float)

    # Payment method slots — modeled for completeness, not yet used by Phase 1.
    AccountNr1 = Column(Integer)
    BankNr1 = Column(SmallInteger)
    SnifNr1 = Column(Integer)
    CheckNr1 = Column(Integer)
    CheckDate1 = Column(String(10))
    CCNr1 = Column(String(16))
    ExpDate1 = Column(String(5))
    CredType1 = Column(SmallInteger)
    CredPayments1 = Column(SmallInteger)
    Money1 = Column(Float)
    PaymentType1 = Column(SmallInteger)

    AccountNr2 = Column(Integer)
    BankNr2 = Column(SmallInteger)
    SnifNr2 = Column(Integer)
    CheckNr2 = Column(Integer)
    CheckDate2 = Column(String(10))
    CCNr2 = Column(String(16))
    ExpDate2 = Column(String(5))
    CredType2 = Column(SmallInteger)
    CredPayments2 = Column(SmallInteger)
    Money2 = Column(Float)
    PaymentType2 = Column(SmallInteger)

    AccountNr3 = Column(Integer)
    BankNr3 = Column(SmallInteger)
    SnifNr3 = Column(Integer)
    CheckNr3 = Column(Integer)
    CheckDate3 = Column(String(10))
    CCNr3 = Column(String(16))
    ExpDate3 = Column(String(5))
    CredType3 = Column(SmallInteger)
    CredPayments3 = Column(SmallInteger)
    Money3 = Column(Float)
    PaymentType3 = Column(SmallInteger)

    AccountNr4 = Column(Integer)
    BankNr4 = Column(SmallInteger)
    SnifNr4 = Column(Integer)
    CheckNr4 = Column(Integer)
    CheckDate4 = Column(String(10))
    CCNr4 = Column(String(16))
    ExpDate4 = Column(String(5))
    CredType4 = Column(SmallInteger)
    CredPayments4 = Column(SmallInteger)
    Money4 = Column(Float)
    PaymentType4 = Column(SmallInteger)

    AccountNr5 = Column(Integer)
    BankNr5 = Column(SmallInteger)
    SnifNr5 = Column(Integer)
    CheckNr5 = Column(Integer)
    CheckDate5 = Column(String(10))
    CCNr5 = Column(String(16))
    ExpDate5 = Column(String(5))
    CredType5 = Column(SmallInteger)
    CredPayments5 = Column(SmallInteger)
    Money5 = Column(Float)
    PaymentType5 = Column(SmallInteger)

    AccountNr6 = Column(Integer)
    BankNr6 = Column(SmallInteger)
    SnifNr6 = Column(Integer)
    CheckNr6 = Column(Integer)
    CheckDate6 = Column(String(10))
    CCNr6 = Column(String(16))
    ExpDate6 = Column(String(5))
    CredType6 = Column(SmallInteger)
    CredPayments6 = Column(SmallInteger)
    Money6 = Column(Float)
    PaymentType6 = Column(SmallInteger)

    tel = Column("tel", String(16))
    namePaid = Column("namePaid", String(32))  # HESHBONIT_ISKA: name of the account actually paying
    totalVat = Column("totalVat", Float)  # VAT amount (not rate) — see CFG.VAT for the rate
    Vat = Column("Vat", Float)  # rate snapshot at issue time (real in DB)


class PriceListItem(Base):
    """
    PriceList table — line-item catalog for invoices. Schema confirmed.

    Price1..Price6 — NOT yet confirmed which column corresponds to which
    Area/branch. Phase 1 defaults to Price1 and leaves UnitPrice editable in
    the create-invoice UI so it can be corrected manually; do not assume
    Price1 is always right without checking against a known-good invoice.

    Prices are VAT-INCLUSIVE (gross/payable amounts) — confirmed via
    totalInvoice() in frmInvRec.frm, which treats the summed line total as
    the amount to charge and extracts VAT out of it rather than adding VAT
    on top. See routers/invoices.py's create_invoice().
    """

    __tablename__ = "PriceList"

    Code = Column(Integer, primary_key=True)
    AccNr = Column(Integer)
    Name = Column(String(32))  # char(32) — space-padded, strip on display
    Price1 = Column(Float)
    Price2 = Column(Float)
    Price3 = Column(Float)
    Price4 = Column(Float)
    Price5 = Column(Float)
    Price6 = Column(Float)
    add_insurance = Column(Boolean)
    add_service = Column(Boolean)
    add_modem_service = Column(Boolean)
    total_price = Column(Float)
    AccNrD = Column(Integer)


class PriceListEilat(Base):
    """
    PriceListEilat table — the Eilat-branch equivalent of PriceList, used
    instead of it whenever Area=7 (see EILAT_AREA in routers/invoices.py).
    Confirmed real via `SELECT * FROM PriceListEilat where code = ...`,
    consistently swapped in for PriceList by an `If Area = 7 Then` check at
    every price-list lookup site across frmInvoice.frm/frmInvRec.frm (entry
    validation, the F1 combo list, and the save-time service/insurance
    processing loop) — see routers/invoices.py's create_invoice()/
    list_pricelist(). Schema NOT independently confirmed against a live DB
    dump (no direct access) — assumed identical to PriceList's columns since
    every reader treats the two RecordSources completely interchangeably
    (same field names accessed either way, e.g. `PriceListRec.Recordset![
    add_service]` right after either RecordSource assignment). There is also
    a `PriceListEilat_old` table referenced in two places (frmParit.frm,
    frmPriceList.frm) that looks superseded/dead — not ported.
    """

    __tablename__ = "PriceListEilat"

    Code = Column(Integer, primary_key=True)
    AccNr = Column(Integer)
    Name = Column(String(32))
    Price1 = Column(Float)
    Price2 = Column(Float)
    Price3 = Column(Float)
    Price4 = Column(Float)
    Price5 = Column(Float)
    Price6 = Column(Float)
    add_insurance = Column(Boolean)
    add_service = Column(Boolean)
    add_modem_service = Column(Boolean)
    total_price = Column(Float)
    AccNrD = Column(Integer)


class Cfg(Base):
    """
    CFG table — single-row (assumed) system configuration. Columns below
    (VAT, IbudNr, interest, minimumCharge, msg_year, testNr) are confirmed
    real via both a schema dump and independent `cfgRec.Recordset![...]`
    usage across several .frm files. Only VAT is actually used so far (global
    rate, read once — see `VAT = cfgRec.Recordset![VAT]` in Account.frm's
    startup code).

    IbudNr is used as the SQLAlchemy primary key purely because the ORM
    requires *some* column to be marked as one — it is NOT confirmed to
    actually be a unique/primary column in the real table. Always query this
    with `.first()` (there's normally exactly one row), never `.get(Cfg, id)`.
    `baseDir`/`hdir`/`happ` (legacy file paths) are known to exist too but
    omitted here since nothing here needs them.
    """

    __tablename__ = "CFG"

    IbudNr = Column(Integer, primary_key=True)
    VAT = Column(Float)
    interest = Column(Float)
    minimumCharge = Column(Numeric)
    msg_year = Column(Integer)
    testNr = Column(Integer)
