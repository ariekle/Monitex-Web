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
    names (e.g. area 0 = "תל אביב"). Schema confirmed; `area` (join key),
    `name` (nchar(10), space-padded), and `PrintTestNr` are the only columns
    used here — the rest of the row is legacy per-branch config (paths,
    printer/bank settings, a login) not needed.

    PrintTestNr: per-branch flag read in Account.frm's Form_Load
    (`PrintTestNr = AreaRec.Recordset![PrintTestNr]`) and used only in
    frmTestPrint.frm — when True, the test certificate's `testNr` parameter
    gets the real (and always-incrementing) CFG.testNr value; when False, it
    gets a static 0 instead. CFG.testNr itself increments every time
    regardless of this flag — see routers/test_print.py.

    BaseDir: per-branch local filesystem path (frmReset1.frm ~line 1416-1421:
    `Trim(AreaRec.Recordset![BaseDir]) & Format(Area, "00#") & "\movein.dat"`)
    -- where a brand-NEW reset's movein.dat gets written (ResetNr=0 path).
    Used by routers/reset.py's commit_reset() -- see movein_export.py's
    module docstring for the resend-path equivalent (CFG.hdir).
    """

    __tablename__ = "Areas"

    area = Column(SmallInteger, primary_key=True)
    name = Column(String(10))
    PrintTestNr = Column("PrintTestNr", Boolean)
    BaseDir = Column("BaseDir", String(255))


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

    Price1..Price6 — confirmed 2026-08-19: NOT per-Area/branch variants (an
    earlier assumption here, now known wrong). An item priced across more
    than one of these columns is one that gets paid off in that many
    separate payments — Price1 is the first payment's own amount, Price2 the
    second's, etc. (not an equal split of the total). The invoice LINE
    itself is still billed for the item's full combined price (sum of all
    non-zero columns) — see ActivateLine() in frmInvRec.frm and
    create_invoice()'s unit_price default. The per-column split only drives
    how many payments get auto-generated and each one's amount — see
    InvoiceModal.tsx's priceListInstallments()/derivedInstallments.

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
    `happ` (legacy file path) is known to exist too but omitted here since
    nothing here needs it.

    hdir: the resend-to-Hashavshevet movein.dat destination directory
    (frmReset1.frm ~line 1427-1428: `Trim(cfgRec.Recordset![hdir]) &
    "\movein.dat"`) — used only for ResetNr<>0 (resend/reprint an archived
    reset), NOT for a brand-new reset (that's Area.BaseDir instead, per
    branch). See movein_export.py's module docstring and
    routers/reset.py's download_movein_dat().
    """

    __tablename__ = "CFG"

    IbudNr = Column(Integer, primary_key=True)
    VAT = Column(Float)
    interest = Column(Float)
    minimumCharge = Column(Numeric)
    msg_year = Column(Integer)
    testNr = Column(Integer)
    hdir = Column("hdir", String(255))


class Check(Base):
    """
    Checks table — one row per PHYSICAL check received as payment on a
    HESHBONIT_KABALA(0) or KABALA(2) invoice, written alongside (duplicating)
    the same data already stored inline on the Invoice row's PaymentTypeN/
    CheckNrN/... slots. Confirmed via SaveChecks() in frmInvRec.frm:

        frmMain.CheckRec.Recordset.AddNew
        frmMain.CheckRec.Recordset![CheckNr] = CLng(txtCheckNr(i))
        frmMain.CheckRec.Recordset![accountnr] = CLng(txtAccountNr(i))
        frmMain.CheckRec.Recordset![snifnr] = CLng(txtSnif(i))
        frmMain.CheckRec.Recordset![bankNr] = CInt(txtBankNr(i))
        frmMain.CheckRec.Recordset![invnr] = InvRec.Recordset![invnr]
        frmMain.CheckRec.Recordset![money] = val(txtSubTotalRec(i))
        frmMain.CheckRec.Recordset![duedate] = txtDate(i)
        frmMain.CheckRec.Recordset![ResetNr] = 0
        frmMain.CheckRec.Recordset![Area] = Area   ' the BRANCH's Area, see routers/invoices.py
        frmMain.CheckRec.Recordset![badCheck] = False

    Before saving, SaveChecks() rejects a check that already exists
    ("!!!השק כבר נמצא במאגר" — this check is already on file) via a
    CheckCheck() lookup — reproduced as a uniqueness check in
    routers/invoices.py._save_checks(). CONFIRMED 2026-08-19 (checked
    directly against frmInvRec.frm's CheckCheck(), not assumed): the
    duplicate check is NOT on CheckNr alone —

        CheckRec.RecordSource = "select * from Checks where CheckNr=" & ... & _
                                " and AccountNr=" & ... & _
                                " and snifnr=" & ... & _
                                " and bankNr=" & ...

    — all four of CheckNr+AccountNr+SnifNr+BankNr together. A check number
    is only unique within one bank account, not globally — two different
    customers' checks can legitimately share a CheckNr as long as the
    bank/branch/account differ. _save_checks() previously only compared
    CheckNr (a leftover Phase-1 shortcut, before this was checked against
    the source) — fixed to match all four fields.

    UNCONFIRMED: exact column types/widths (no INFORMATION_SCHEMA dump
    available for this table) — reconstructed purely from the VB6 usage
    above. Modeled with a composite primary key across all four fields
    CheckCheck() treats as the real uniqueness key (CheckNr+AccountNr+
    SnifNr+BankNr — see above), now that _apply_payments() requires all four
    together for any check payment (so none of them can legitimately be
    null here). Purely an ORM-metadata decision — this app never runs
    `create_all()` against the real production connection, so this does NOT
    issue any DDL/constraint change against the actual SQL Server table;
    it only fixes how SQLAlchemy's own identity map treats two Check rows
    that happen to share a CheckNr but differ on the other three fields
    (previously, with CheckNr alone as the PK, SQLAlchemy's own object
    identity — separately from whatever the real table enforces — could
    conflate two genuinely different checks). If the real table's actual
    key is something else entirely (e.g. a separate identity column), this
    will need adjusting.

    badCheck flips True via the separate "Returned Checks" flow
    (frmBackCheck.frm / cmdCheck_Click) — not yet ported to this app.
    """

    __tablename__ = "Checks"

    CheckNr = Column(BigInteger, primary_key=True, autoincrement=False)
    AccountNr = Column("accountnr", BigInteger, primary_key=True)
    SnifNr = Column("snifnr", Integer, primary_key=True)
    BankNr = Column("bankNr", SmallInteger, primary_key=True)
    InvNr = Column("invnr", Integer)
    Money = Column("money", Float)
    DueDate = Column("duedate", String(10))  # "dd/mm/yyyy", matching CheckDateN on Invoices
    ResetNr = Column("ResetNr", Integer)
    Area = Column("Area", SmallInteger)
    BadCheck = Column("badCheck", Boolean)


# Column list shared by ActiveReset (one live row per Area, overwritten on
# every reset) and Resets (append-only historical archive, one row per
# completed reset) — both confirmed via the field-by-field writes at the end
# of Reset() in Code VB6/frmReset1.frm (the form actually in Monitex2000.vbp;
# frmReset.frm is an earlier unused prototype, same pattern as frmMain.frm).
#
# NOT ported (dead/vestigial in the live app, confirmed by reading the
# Reset() source — the multi-company credit-card routing and the deposit-date
# bank/company bucketing below it are entirely commented out, so every
# credit-card payment collapses into ONE bucket regardless of card company):
#   - CreditIsraN/P, CreditDinersN/P, CreditAmexN/P — always 0 in the live
#     app; only CreditVisaN/P (the "N"=regular+credit-now, "P"=installments
#     bucket) is ever actually populated. Modeled anyway for schema fidelity
#     but routers/reset.py never writes to the Isra/Diners/Amex columns.
#   - Per-deposit-slip check batching (CashChecks1-10/DelayedChecksList1-10,
#     grouped in batches of 7/15 purely for a paper deposit-slip print run —
#     see ActiveReset's own docstring) — the TRUE batch split isn't modeled;
#     routers/reset.py reports one combined cash-checks total and one
#     combined delayed-checks total on screen (more useful there than
#     paginated print batches), and writes that combined total into slot 1
#     of these columns (zeroing slots 2-10) purely so the Crystal print
#     report — which reads these columns directly — doesn't show blank
#     check totals.
class ActiveReset(Base):
    """
    ActiveReset table — ONE staging row per Area/branch, overwritten every
    time that branch runs a reset preview/commit (`select * from ActiveReset
    where Area=...` then AddNew-if-missing else update in place). Holds the
    same totals as Resets (see that model) for whichever reset is currently
    in progress there. CONFIRMED against a real INFORMATION_SCHEMA.COLUMNS
    dump of taxidb (2026-08-17) — column set below is the real one (ResetNr
    NOT NULL, everything else nullable; no column is actually flagged
    PRIMARY KEY in the dump, `Area` is used as one here purely so the ORM has
    something to `.get()` by, matching the original's own `where Area=...`
    lookup pattern).

    `CashChecks1`..`CashChecks10` / `DelayedChecksList1`..`DelayedChecksList10`
    (`DelayedChecksList` with no number also exists but nothing in
    frmReset1.frm ever writes to it — legacy/unused, not mapped here) are the
    original's per-deposit-slip check batching: `Reset()` in frmReset1.frm
    splits the checks-to-deposit list into slip-sized batches (7 cash checks
    or 15 delayed checks per physical bank form,
    `deposit_blank_nr = ... + cash_check_nr \\ 7 + delayed_check_nr \\ 15`)
    and writes each batch's own sub-total into its own numbered slot. This
    app deliberately does NOT reproduce that batching (see module docstring
    in routers/reset.py) — but leaving all 10 slots NULL meant the printed
    report showed blank check totals entirely, since Crystal reads these
    columns directly. commit_reset() now writes the FULL combined total into
    slot 1 and explicitly zeroes slots 2-10 (matching what the original's own
    Double array would naturally hold when there just aren't enough checks to
    fill more than one batch) — not a faithful reproduction of the real
    per-slip split, but the totals are correct and nothing prints empty.
    `deposit_blank_nr` (a running count of blank deposit slips used) is left
    unmapped/unwritten — purely a paper-forms counter tied to the same
    batching this app doesn't do.
    """

    __tablename__ = "ActiveReset"

    Area = Column(SmallInteger, primary_key=True, autoincrement=False)
    ResetNr = Column(Integer)
    DepoBank = Column(SmallInteger)
    ResetDate = Column("resetDate", Date)
    DepositDate = Column(Date)
    InvRecs = Column("InvRecs", Integer)
    TotalInvRecs = Column(Float)
    Invoices = Column("invoices", Integer)
    TotalInvoices = Column(Float)
    Recs = Column("Recs", Integer)
    TotalRecs = Column(Float)
    Iskas = Column("Iskas", Integer)
    TotalIskas = Column(Float)
    Credits = Column("credits", Integer)
    TotalCredits = Column("totalcredits", Float)
    TotalKupa = Column("totalkupa", Float)
    TotalVat = Column(Float)
    CashDepo = Column("cashdepo", Float)
    CashChecksNr = Column("cash_checks", Integer)
    DelayedChecksNr = Column("delayed_checks", Integer)
    CashChecks1 = Column(Float)
    CashChecks2 = Column(Float)
    CashChecks3 = Column(Float)
    CashChecks4 = Column(Float)
    CashChecks5 = Column(Float)
    CashChecks6 = Column(Float)
    CashChecks7 = Column(Float)
    CashChecks8 = Column(Float)
    CashChecks9 = Column(Float)
    CashChecks10 = Column(Float)
    DelayedChecksList1 = Column(Float)
    DelayedChecksList2 = Column(Float)
    DelayedChecksList3 = Column(Float)
    DelayedChecksList4 = Column(Float)
    DelayedChecksList5 = Column(Float)
    DelayedChecksList6 = Column(Float)
    DelayedChecksList7 = Column(Float)
    DelayedChecksList8 = Column(Float)
    DelayedChecksList9 = Column(Float)
    DelayedChecksList10 = Column(Float)
    CreditVisaN = Column(Float)
    CreditVisaP = Column(Float)
    CreditIsraN = Column(Float)
    CreditIsraP = Column(Float)
    CreditDinersN = Column(Float)
    CreditDinersP = Column(Float)
    CreditAmexN = Column(Float)
    CreditAmexP = Column(Float)
    TotalDepo = Column(Float)
    BackChecksNr = Column("back_checks", Integer)
    TotBackChecks = Column("tot_back_checks", Float)
    ChecksPaidNr = Column("checks_paid", Integer)
    TotChecksPaid = Column("tot_checks_paid", Float)


class BadChecks(Base):
    """
    BadChecks table — one row per physical check reported as bounced/
    returned by the bank, from the "שיקים חוזרים" (returned checks) flow —
    Code/frmBackCheck.frm. CONFIRMED against a real INFORMATION_SCHEMA.COLUMNS
    dump of taxidb (2026-08-17) — the table already existed in the restored
    production DB (this app didn't create it). Column set below is the real
    one; a few surprises versus the original guess (kept for anyone
    reconciling this against the .frm source):

      - There is NO separate `FamilyName` column. `txtFamilyName` in the
        .frm is bound to `DataField = "Name"` — the SAME physical column
        used at report-time for the invoice buyer's name
        (`![name] = Trim(InvRec.Recordset![name])`). It's one column serving
        both roles (initial snapshot, later manually corrected) — modeled
        here as a single `Name` attribute; routers/bad_checks.py treats the
        API's "family_name" as writing to this same column.
      - `Tel` (not `CellPhone`) is the real phone column — kept mapped to a
        `CellPhone` Python attribute for API-surface continuity, but the SQL
        column name really is `Tel`. Notably the original never auto-fills
        it at report time (`'BadChecksRec.Recordset![tel] = ...` is
        commented out in the .frm) — matches this app's report() too.
      - `Remark1`..`Remark5` (not `Msg1`..`Msg5`) hold the follow-up note
        text; `Date1`..`Date5` are the paired dates. A `Date6`/`Remark6`
        pair also exists in the real table but has no bound control
        anywhere in frmBackCheck.frm — legacy/unused 6th slot, not mapped
        here.
      - The reason/status/return-bank *text* the secretary actually sees
        and edits live in `ReasonTxt`/`StatusTxt`/`ReturnBankTxt` (the ADO
        DataField targets of txtReason/txtStatus/txtReturnBank) — mapped
        here as `Reason`/`Statustxt`/`ReturnBankName`. The real table ALSO
        has separate `Reason`/`Status` tinyint code columns, but nothing in
        frmBackCheck.frm ever writes to them (only the *Txt siblings are
        bound to controls) — left unmapped/always-NULL here, matching the
        original's actual behavior.
      - `MoneyT` (float) is a second, apparently unused money-ish column —
        never referenced anywhere in frmBackCheck.frm (the real amount
        column, actually read/written, is `Money`, SQL type `money`) — left
        unmapped here too.
      - `InvDate` is `char`, not a native date type (unlike `InvoiceDate`,
        which genuinely is `date`) — stored as "dd/mm/yyyy" text like
        `DueDate`, mapped as a string here, not `Date`.

    Reporting a NEW bad check (find_Check(checkBy:=0) with a typed
    CheckNr+AccountNr+SnifNr that must match an existing `Checks` row, which
    must itself link to a real `Invoices` row and a real `Accounts` row):
        BadChecksRec.Recordset.AddNew
        ![CheckNr] = ChecksRec![CheckNr]           ' + AccountNr/SnifNr/BankNr/InvNr/Money copied from Checks
        ![duedate] = Replace(ChecksRec![duedate], ".", "/")
        ![checkduedate] = CDate(ChecksRec![duedate])
        ![name]/![invdate]/![invoicedate]/![TaxiNr]/![town]/![street]/
            ![homenr]/![tz]/![zipcode] = ...        ' snapshotted from Invoices
        ![ReturnBank] = ChecksRec![bankNr]          ' initial guess, re-editable via lstSelBank
        ![lost] = False : ![ResetNr] = 0 : ![paidCheck] = 0 : ![PaidOver] = 0
    then the secretary fills in/corrects FamilyName/CellPhone/Street/HomeNr/
    Town/ZipCode, Reason (lstSelReason), ReturnBank (lstSelBank, re-typed as
    free text then collapsed to `bank` 0/1 on save — see below), Status
    (lstStatus), and up to 5 dated follow-up notes (Date1..5/Msg1..5). On
    save, `Accounts.checks` (already modeled as `Account.Checks`) is
    incremented by 1 — a running count of this taxi's currently-outstanding
    bad checks, decremented again on repay-in-full or write-off.

    Handling an EXISTING bad check (found by CheckNr+AccountNr+SnifNr, by
    Tz, or by TaxiNr — only surfaced while `paidCheck < money AND NOT lost`):
    a running late fee is computed and shown (not stored) via
    `debit() = DateDiff("m", duedate, Date()) * CFG.interest + CFG.minimumCharge`
    (months since the check's own due date, not since it was reported) —
    ported as `_bad_check_debit()` in routers/bad_checks.py. Saving can:
      - do nothing but update notes/status (both amounts left at 0), or
      - collect `txtPayCheck` (repaying the original check amount) as a
        standalone קבלה (KABALA, IgnoreInReset=1 — exempt from reset's
        strict "payments must reconcile" check and NOT counted in the
        normal cash/check/credit breakdown, since this money is recovering
        a PAST period's shortfall, not new period revenue), and/or
      - collect `txtPayInt` (the late fee itself) as a חש/קבלה
        (HESHBONIT_KABALA, IgnoreInReset=2 — counted as cash regardless of
        actual payment type in reset's math, see routers/reset.py's
        module docstring for the exact rule). The original bypasses the
        normal PriceList entirely for this one line (SubTotal1/Money1 set
        directly from txtPayInt, no Code1) — NOT reproduced that way here;
        routers/bad_checks.py instead requires picking a real PriceList
        line like any other invoice (recommend the office keep a dedicated
        "ריבית שק חוזר" price-list code for this).
      IgnoreInReset=1/2 only ever come from THIS flow (Main.bas's global
      `IgnoreInReset`, transiently set around these two calls then reset to
      0) — every other invoice in this app always gets IgnoreInReset=0.
    `cmdLost_Click` (only when `paidCheck = 0 AND NOT lost`) sets
    `lost=True`, `Statustxt="דווח כחוב אבוד"`, and decrements
    `Accounts.checks` by 1 (floor 0) — a write-off, no further collection
    attempts.

    Reason/Bank/Status option lists (extracted from frmBackCheck.frx's
    ListBox.List binary resource — hand-parsed length-prefixed cp1255
    strings, cross-checked against cmdSave_Click's exact string comparisons
    where visible in code):
      - Reason (lstSelReason, 6): א.כ.מ / מוגבל / מעוקל / נ.ה.ב / התאמה / חתימה
      - Bank (lstSelBank, 2 — matches `If txtReturnBank = "בנק הפועלים" Then
        bank=0 Else bank=1` in cmdSave_Click exactly): בנק הפועלים / בנק דיסקונט
      - Status (lstStatus, 7 confirmed + 1 unrecovered — likely an 8th
        destination, byte-offset drift in the .frx parse): הועבר לחיפה /
        הועבר לירושלים / הועבר לב"ש / הועבר לאילת / הועבר לנתניה /
        הועבר לעו"ד 1 / הועבר לעו"ד 2 (+ ? — not exposed as a hard enum here,
        Reason/ReturnBank/Statustxt are all just plain strings so an
        unrecovered 8th option costs nothing).

    Two separate bank-ish columns, kept distinct on purpose despite the
    similar names — genuinely different fields in the original:
      - `BankNr` — the ORIGINAL check's own issuing bank (from
        `Checks.BankNr`), never edited after creation; `txtBankName`
        displays `BankName(BadChecksRec![bankNr])`, read-only.
      - `ReturnBank` — an int code, defaulted from BankNr at report-time,
        re-derived back to display text via the same `BankName()` lookup
        when reopening an existing row (`txtReturnBank = BankName(![ReturnBank])`).
      - `Bank` — the simplified 0/1 flag actually written by cmdSave_Click
        from whatever free text ended up in txtReturnBank at save time
        (0="בנק הפועלים", 1=anything else) — a separate, later-derived flag,
        not simply `ReturnBank` renamed.

    `ResetNr` is stored (always 0, per `![ResetNr] = 0` at creation) but not
    read anywhere in frmReset1.frm/routers/reset.py — this table isn't
    swept into the reset flow itself, only the KABALA/HESHBONIT_KABALA rows
    it can spin off are (via their own IgnoreInReset). Kept here for schema
    completeness/future use, not wired into anything.
    """

    __tablename__ = "BadChecks"

    BadCheckNr = Column(Integer, primary_key=True)  # confirmed NOT NULL PK; identity-ness unconfirmed but the .frm never sets it explicitly on AddNew, consistent with IDENTITY
    CheckNr = Column(Integer)
    AccountNr = Column(Integer)
    SnifNr = Column(Integer)
    BankNr = Column(SmallInteger)
    ReturnBank = Column(SmallInteger)  # numeric bank code (BankName() lookup), defaulted from BankNr at report time
    ReturnBankName = Column("ReturnBankTxt", String(16))  # free text actually shown/edited in txtReturnBank
    Bank = Column(SmallInteger)  # simplified 0/1 flag written by cmdSave_Click's exact string compare
    InvNr = Column(Integer)
    Money = Column(Float)  # real SQL type is `money`; mapped as Float like every other amount column in this app
    DueDate = Column(String(10))  # "dd/mm/yyyy" text, matches Checks.DueDate
    CheckDueDate = Column(Date)
    Name = Column(String(32))  # dual-purpose: invoice buyer name at report time, later the editable "family name" field (txtFamilyName's real DataField) — there is no separate FamilyName column
    InvDate = Column(String(10))  # char in the real table, NOT a native date — "dd/mm/yyyy" text like DueDate
    InvoiceDate = Column(Date)  # this one genuinely is a native `date` column
    TaxiNr = Column(Integer)
    Town = Column(String(16))
    Street = Column(String(16))
    HomeNr = Column(String(10))
    Tz = Column(Integer)
    ZipCode = Column(Integer)
    CellPhone = Column("Tel", String(11))  # real column is `Tel`; never auto-filled at report time in the original either
    Lost = Column(Boolean)
    Statustxt = Column("StatusTxt", String(32))
    Reason = Column("ReasonTxt", String(16))
    ResetNr = Column(Integer)
    PaidCheck = Column(Float)
    PaidOver = Column(Float)
    Date1 = Column(String(10))
    Msg1 = Column("Remark1", String(64))
    Date2 = Column(String(10))
    Msg2 = Column("Remark2", String(64))
    Date3 = Column(String(10))
    Msg3 = Column("Remark3", String(64))
    Date4 = Column(String(10))
    Msg4 = Column("Remark4", String(64))
    Date5 = Column(String(10))
    Msg5 = Column("Remark5", String(64))


class Reset(Base):
    """
    Resets table — append-only historical archive, one row per completed
    reset (ResetNr comes from CFG.IbudNr, incremented after each use — see
    routers/reset.py). `Processed` starts False, matching
    `ResetRec.Recordset![Processed] = False` in Reset() — nothing in this
    app flips it True yet (that happens in a downstream accounting-export
    step in the original, not ported).
    """

    __tablename__ = "Resets"

    ResetNr = Column(Integer, primary_key=True, autoincrement=False)
    Processed = Column(Boolean)
    Area = Column(SmallInteger)
    DepoBank = Column(SmallInteger)
    ResetDate = Column("resetDate", Date)
    DepositDate = Column(Date)
    InvRecs = Column("InvRecs", Integer)
    TotalInvRecs = Column(Float)
    Invoices = Column("invoices", Integer)
    TotalInvoices = Column(Float)
    Recs = Column("Recs", Integer)
    TotalRecs = Column(Float)
    Iskas = Column("Iskas", Integer)
    TotalIskas = Column(Float)
    Credits = Column("credits", Integer)
    TotalCredits = Column("totalcredits", Float)
    TotalKupa = Column("totalkupa", Float)
    TotalVat = Column(Float)
    CashDepo = Column("cashdepo", Float)
    CashChecksNr = Column("cash_checks", Integer)
    DelayedChecksNr = Column("delayed_checks", Integer)
    CashChecks1 = Column(Float)
    CashChecks2 = Column(Float)
    CashChecks3 = Column(Float)
    CashChecks4 = Column(Float)
    CashChecks5 = Column(Float)
    CashChecks6 = Column(Float)
    CashChecks7 = Column(Float)
    CashChecks8 = Column(Float)
    CashChecks9 = Column(Float)
    CashChecks10 = Column(Float)
    DelayedChecksList1 = Column(Float)
    DelayedChecksList2 = Column(Float)
    DelayedChecksList3 = Column(Float)
    DelayedChecksList4 = Column(Float)
    DelayedChecksList5 = Column(Float)
    DelayedChecksList6 = Column(Float)
    DelayedChecksList7 = Column(Float)
    DelayedChecksList8 = Column(Float)
    DelayedChecksList9 = Column(Float)
    DelayedChecksList10 = Column(Float)
    CreditVisaN = Column(Float)
    CreditVisaP = Column(Float)
    CreditIsraN = Column(Float)
    CreditIsraP = Column(Float)
    CreditDinersN = Column(Float)
    CreditDinersP = Column(Float)
    CreditAmexN = Column(Float)
    CreditAmexP = Column(Float)
    TotalDepo = Column(Float)
    BackChecksNr = Column("back_checks", Integer)
    TotBackChecks = Column("tot_back_checks", Float)
    ChecksPaidNr = Column("checks_paid", Integer)
    TotChecksPaid = Column("tot_checks_paid", Float)
