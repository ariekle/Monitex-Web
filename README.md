# Project1 — web migration

Migrating the VB6 desktop app to a web app: FastAPI backend, React (Vite + TS + Tailwind) frontend.

## Run it

**Frontend**
```
cd frontend
npm install
npm run dev
```
Opens at http://localhost:5173

**Backend — via Docker (recommended on Mac)**

Avoids needing the `msodbcsql18` Homebrew formula, which requires a recent Xcode to compile from source if no prebuilt bottle matches your Mac. Requires your SQL Server container (see local DB notes) already running on port 1433.

```
cd backend
cp .env.example .env   # defaults already point at host.docker.internal — edit DB_PASSWORD to match your container
docker build -t monitex-backend .
docker run --rm -p 8000:8000 --env-file .env monitex-backend
```

**Backend — natively (needs `brew install msodbcsql18` to succeed first)**
```
cd backend
cp .env.example .env   # change DB_SERVER to localhost,1433 for native mode
pip install -r requirements.txt --break-system-packages
uvicorn app.main:app --reload
```

Either way, runs at http://localhost:8000 — the Vite dev server proxies `/api/*` to it.

## ⚠️ Correction (2026-08-10)

The physical file `Code/frmMain.frm` (Caption `"Project1"`, a generic StatusBar/menu skeleton) is **not referenced anywhere in `Monitex2000.vbp`** — it's dead/unused template code left over in the source tree, never compiled into the app. The `AppShell`/`TopMenu`/`StatusBar` components below were built against it and do **not** correspond to real Monitex behavior. They're left in place as harmless generic chrome, but should not be assumed to reflect actual VB6 functionality.

The **real** startup form (`Startup="frmMain"` in the .vbp refers to an internal VB object name, not a filename) is `Code/Account.frm` — its `Begin VB.Form` internal name happens to also be `frmMain`, but its Caption is `" מוניטקס"` (Monitex) and it's the single large window shown in the original screenshot: taxi number lookup, owner/address/phone fields, and the 9-button action row (History, Invoices, Copy Invoice, Returned Checks, Meter/Cap Actions, Modem, Update Details, Expiry, Exit). It has **no VB menu bar at all** (0 `Begin VB.Menu` blocks) — it's a single button-driven screen, not an MDI app with menus. `frmLogin.frm` likely precedes it (not yet examined).

Key facts pulled directly from `Account.frm`:
- Backing table: **`Accounts`**, keyed on **`TaxiNr`** — `AccountRec` (ADO Data Control) `RecordSource = "select * from Accounts where TaxiNr=-1"`.
- Related tables referenced by buttons on this form: `History` / `History_1` (audit log, written on every save — see below), `Invoices`, `badchecks`, `checks`, `Meters`, `stations`, `Areas`, `CFG`, `tarifs`, `Resets`, `Duplicates1`, `IskaTax`, `PriceList`.
- Field mapping (control `DataField` → screen label), confidence noted where guessed:
  | DB column | Screen label | Notes |
  |---|---|---|
  | `TaxiNr` | מס' מונית | |
  | `MeterNr` | מס' מונה | |
  | `ExpDate` | תוקף שרות | |
  | `Insurance` | ביטוח | |
  | `CovaStatus` | מצב כובע | "Cova" = כובע (cap/hat), guessed |
  | `CovaType` | סוג כובע | guessed |
  | `CovaInsDate` | תוקף ביטוח כובע | guessed |
  | `FamilyName` | שם משפחה | |
  | `PrivatName` | שם פרטי | |
  | `Street` | רחוב | |
  | `HomeNr` | מס' (בית) | |
  | `Town` | עיר | |
  | `ZipCode` | מיקוד | |
  | `MeterType` | סוג מונה / דגם מונה | field appears twice bound, unclear if 2 separate controls or dup |
  | `MeterInsDate` | תוקף ביטוח מונה | guessed |
  | `TelHome` / `TelWork` / `TelCell` | טל. נייד (+ home/work, not all shown on main screen) | |
  | `CarNr` | מס' רישוי | |
  | `Area` | אזור | |
  | `Station` | תחנה | |
  | `Msg` / `RemarkDate` | הערה (+ date) | |
  | `Status` | — | internal, not directly labeled on screen |
  | `PaidMeters` / `PaidCovas` | — | used by meter/cap "reset balance" flow, not directly on screen |

  **Needs verification against the real DB** — see the open task to export `INFORMATION_SCHEMA.COLUMNS` for `Accounts`.

- Save flow (`cmdSave_Click`): writes a new `History` row (status `5` = new account, `4` = update) with taxi/meter/car nr, name, area, timestamp — then updates the `Accounts` row, then conditionally syncs `carnr`/`name` onto the linked `Meters` row. Editable fields in edit mode: family/private name, station, street, home nr, town, zip, home/work/cell phone, car nr, message.
- Button → handler map: `cmdHistory_Click` (History), `cmdInvoices_Click` (Invoices), `cmdInvoiceCopy_Click` (Copy Invoice), `cmdCheck_Click` (likely Returned Checks — not yet read in full), `cmdMeters_Click` (Meter/Cap Actions — shows an in-form popup list, `lstMeterActions`, rather than opening a separate window), `cmdModem_Click` (Modem), `cmdExpDate_Click` (Expiry), `cmdUpdate_Click` / `cmdSave_Click` / `cmdCancelEdit_Click` (Update Details edit/save/cancel), `cmdExit_Click` (Exit). `cmdConvert` ("המרה") exists but is `Visible=False` — dead button, ignore.

## Migration log

| VB6 form              | Status         | Becomes                                                                 |
|------------------------|----------------|--------------------------------------------------------------------------|
| `frmMain.frm`          | ❌ Not real     | Dead/unused file, not in the compiled project — disregard               |
| `Account.frm` (internal name `frmMain`) | 🔨 In progress | `pages/Account.tsx` — the real taxi master record screen from the screenshot |
| `frmLogin.frm`         | ⏳ Not started  | Login screen, likely precedes Account — not yet examined                 |

### Notes on the (incorrectly-attributed) `AppShell`/`TopMenu`/`StatusBar`

These were built against the dead `frmMain.frm` stub, not real app behavior. They're kept as generic app chrome for now since the real Monitex UI is a single unmenu'd window, but the menu/status-bar concept may not be the right shape once more forms (esp. `frmLogin.frm`) are examined. Revisit once the login flow and any true multi-window navigation pattern are understood.

## Stack decisions so far

- Backend: FastAPI + SQLAlchemy + pyodbc against the existing SQL Server DB (no DB migration for now)
- Frontend: React + Vite + TypeScript + Tailwind, `react-router-dom` for routing
- Hashavshevet integration: file-based export/import — format/encoding to be confirmed once a sample file is available
- Local dev DB: restored from `.bak` into a Docker SQL Server / Azure SQL Edge container (`sa` / see local notes for password), not committed anywhere
