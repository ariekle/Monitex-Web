# Monitex print bridge

Lets the web app trigger the **real** Crystal Reports reports (the same
designs the VB6 app has always printed from) from a browser button click,
without going through VB6 at all.

**This folder also has a second, unrelated script: `MonitexFileBridge.ps1`.**
Same idea (a tiny local HTTP receiver bridging the web backend to a local
Windows resource it can't reach directly), completely different job and a
different target machine — see its own header comment and the
"movein.dat file bridge" section near the bottom of this file. Don't
confuse the two: `MonitexPrintBridge.ps1` runs on every branch PC (for
printing); `MonitexFileBridge.ps1` runs once, on the ONE accounting PC
(for delivering movein.dat).

## Why this exists

`Monitex2000.exe` doesn't load its reports from loose `.rpt` files — every
report is a Crystal Report **Designer object compiled directly into the
EXE** (`Dim InvReport As New InvoiceReport2`, etc.). To reuse the exact same
already-built report designs from the new web app, we first export each one
to a standalone `.rpt` file using Crystal Reports Designer's own "Save As",
and then this folder's PowerShell script drives that `.rpt` file directly
via COM (`CRAXDRT.Application.OpenReport(...)`) — the same automation
interface (`craxdrt.dll`) the old app already uses, just called from
PowerShell instead of VB6.

Once a report exists as a real `.rpt` file, this bridge can drive it — no
VB6, no recompiling anything, on every branch PC that already has the
Crystal Reports runtime + the `monitex` ODBC DSN working (both confirmed
already in place).

## What it does

A tiny HTTP server (`MonitexPrintBridge.ps1`) listens on
`http://localhost:9100/` on the branch PC. The web app's browser calls it
directly (e.g. `window.open('http://localhost:9100/print/invoice?invNr=...')`)
to get back a rendered PDF of the actual Crystal report — same layout,
same Hebrew formatting, same everything, because it *is* the same report.

## One-time setup per branch PC

### 1. Get the four .rpt files in place

Most of the reports already exist as loose `.rpt` files in the `Code VB6`
folder (that's the normal Crystal+VB6 workflow — design in Crystal Reports
Designer first, then import into VB6 as an embedded Designer object). But
the embedded copy compiled into `Monitex2000.exe` can drift from that loose
file afterward if it was tweaked from inside VB6 later — so **check before
trusting a loose file**, don't just assume it matches.

**Reset reports — already fine, no VB6 needed:**

| File already in `Code VB6\` | Copy to reports folder as |
|---|---|
| `ActiveResetRpt.rpt` | `ActiveResetRpt.rpt` |
| `PastResetRpt.rpt` | `PastResetRpt.rpt` |

These match the embedded Designer names exactly and are internally
consistent with each other (same 2015 vintage), so just copy them in as-is.

**Invoice report — needs a quick check.** There's no exact filename match
for the `InvoiceReport2` Designer (the one `frmInvoiceRpt2.frm` — the *live*
invoice-printing form — actually uses). Several candidates exist in the
folder (`Invoice.rpt`, `Invoice_double.rpt`, `InvoiceEilatNew.rpt`,
`InvoiceRptEilat.rpt`, `InvoiceReportEilat_double.rpt`), but they're not
identical to each other, and the ones with "Eilat" in the name are most
likely leftovers tied to `frmInvoiceRptEilat.frm`, which I confirmed is a
**dead, unused call path** in the current app — not what actually prints
today.

To find the right one: open each `Invoice*.rpt` candidate in Crystal
Reports Designer → **Field Explorer → Parameter Fields**, and look for one
with exactly these parameters:

```
Copy, InvoiceNr, Name1, Name2, Name3, Name4, Name5, Name6
```

Whichever file has that exact set is the real one — save/copy it into the
reports folder as `InvoiceReport2.rpt`.

If **none** of them match (i.e. it really has drifted, confirming the
"changed a bit in VB6" instinct), fall back to exporting the live one
directly: open `Monitex2000.vbp` in the VB6 IDE, find the `InvoiceReport2`
Designer object in the Project Explorer, open it in Crystal Reports
Designer, then **File → Save As** → `InvoiceReport2.rpt`. (Note: this
specific "Save As from an embedded Designer" action is a known crash point
in old VB6+Crystal XI combinations — see Troubleshooting below if it
happens.)

**Test certificate — also needs a quick check.** This is the meter/vehicle
test printout from `printTest()`/`frmTestPrint.frm` in `Account.frm`
(triggered by Alt+F1/Shift+F1 in the original — not the `frmTestPrintsRpt`
monthly list report, a different form entirely, from Alt+F4). The likely
candidate already in the folder is `testNew.rpt` (matching the
`TestReportNew` Designer name). Verify the same way — Field Explorer →
Parameter Fields — and look for:

```
Model, TaxiNr, MeterType, Carnr1, Carnr2, Carnr3, testNr
```

An earlier version of the exported `testNew.rpt` also had a `MeterNr`
(Number) parameter that isn't mentioned anywhere in `printTest()`'s own
source — discovered by running the bridge against it and getting Crystal's
own "Enter Parameter Values" prompt for it. That parameter has since been
removed in Crystal Reports Designer and replaced with a live
`Accounts.MeterNr` database field instead (the report already joins to
`Accounts` via `TaxiNr`, so no caller-supplied value is needed at all) —
the bridge and backend no longer send it.

⚠️ Separately, this report was observed doing a full ~18,500-record scan
per print (visible as Crystal's own "Exporting Records" progress dialog)
rather than a single-row lookup — its Record Selection Formula doesn't
appear to filter by `TaxiNr`, and the original VB6 source doesn't set one
programmatically either, so this may be inherent to the original report's
design rather than something introduced here. Worth a look in Crystal
Reports Designer (Report → Selection Formulas → Record) if the multi-
minute print time becomes a problem in daily use.

If it matches, copy it in as `testNew.rpt`. If not, same VB6 Save As
fallback applies, this time on the `TestReportNew` Designer object.

✅ **Fully wired up.** The web app has an "אישור בדיקת מונה" button on the
main Account screen (`TestPrintModal.tsx`), which calls
`POST /api/account/{taxiNr}/test-print` (`routers/test_print.py`) — that
endpoint ports `printTest()` faithfully: the same 5 preconditions in the
same order (meter assigned, no returned checks, service not expired, valid
car number, meter active), the same MeterType auto-detect/manual-entry
split, writes the `History` row (`Status=50`), and always increments
`CFG.testNr` (only the *printed* value is gated by this branch's
`Areas.PrintTestNr`). Once that call succeeds, the modal offers a print
button that calls this bridge's `/print/test` route with the already-
resolved values to render the real `testNew.rpt` certificate.

Put all four files into a `Reports` subfolder right next to
`MonitexPrintBridge.ps1` itself — i.e. copy this whole `print-bridge`
folder to wherever you want it on the branch PC (Desktop, `C:\Monitex\`,
anywhere), then create a `Reports\` folder inside it and drop the `.rpt`
files there:

```
print-bridge\
  MonitexPrintBridge.ps1
  Start-MonitexPrintBridge.vbs
  README.md
  Reports\
    InvoiceReport2.rpt
    ActiveResetRpt.rpt
    PastResetRpt.rpt
    testNew.rpt
```

The script finds this automatically (`$ReportsFolder` defaults to a
`Reports` folder next to itself) — no path to edit, and the whole thing
stays one self-contained unit if you ever need to copy it to another branch
PC. The exact filenames matter — see `$Reports` at the top of
`MonitexPrintBridge.ps1` if you want to rename anything.

You can add more reports later the same way — find or verify the `.rpt`,
add an entry to `$Reports` in the script, add a route/handler for it. The
pattern in `Handle-Invoice`/`Handle-ResetActive`/`Handle-ResetPast` is the
template; the exact `ParameterFields` names to set for a new report can be
found by reading that report's `frmXxxRpt.frm` `Form_Load()` in the VB6
source (same place I read these three from).

### 2. Test it manually

```
powershell -ExecutionPolicy Bypass -File MonitexPrintBridge.ps1
```

Leave it running, then in a browser on the same PC visit:

```
http://localhost:9100/health
```

You should see `{"status":"ok"}`. Then try a real print, e.g.:

```
http://localhost:9100/print/invoice?invNr=1&copy=1
```

(use a real `InvNr` that exists in your DB) — a PDF should download/open.
Check the PowerShell window for error output if not.

### 3. Run automatically at logon

Easiest option — put a shortcut to `Start-MonitexPrintBridge.vbs` (in this
folder) in the user's Startup folder:

```
shell:startup
```

(paste that into File Explorer's address bar, then drop a shortcut to
`Start-MonitexPrintBridge.vbs` in the folder that opens). It runs silently
(no visible window) and starts the bridge every time the branch PC's user
logs in.

For a more robust always-on setup, register it in Task Scheduler instead
with trigger "At log on" and action pointing at
`wscript.exe "C:\...\Start-MonitexPrintBridge.vbs"`.

### 4. Desktop shortcut: bridge + app-mode browser in one click

For the branch PC's day-to-day use (not the "run bridge at every logon"
setup above, though the two work fine together), two more files are in
this folder:

- **`Launch-Monitex.vbs`** - starts the print bridge silently (same as
  `Start-MonitexPrintBridge.vbs`) and then opens the web app in a Chrome/
  Edge **app-mode** window - no tabs, no address bar, just the app, like a
  native program. Before first use, open it in Notepad and set
  `MONITEX_URL` at the top to the real web app address (right now, while
  testing over Tailscale, that's the Mac's Tailscale IP + port 5173, e.g.
  `http://100.x.x.x:5173/` - once this is deployed somewhere permanent,
  update it to that address instead).
- **`Create-Desktop-Shortcut.vbs`** - run this **once** per branch PC
  (double-click it). It creates a "Monitex" icon on the Desktop, using the
  Monitex logo (`monitex-icon.ico`, already in this folder), that runs
  `Launch-Monitex.vbs`. After that, the secretary just double-clicks the
  Desktop icon each morning.

Both scripts assume they're staying together in this same `print-bridge`
folder (they find `monitex-icon.ico` and each other next to themselves) -
if you copy the folder somewhere else, just re-run
`Create-Desktop-Shortcut.vbs` once to rebuild the shortcut with the new
path.

### 5. Printing against the dev DB — tried and removed

This bridge only ever renders from the real live "monitex" database (same
as the original VB6 app). A `&env=dev` mode that rendered from the local
Docker dev DB (`taxidb`) instead existed briefly (2026-08-17/18) but was
removed:

- Re-pointing a `.rpt` in Crystal Reports Designer from Pervasive PSQL
  (the real DB's engine) to SQL Server (`taxidb`'s engine) kept dropping
  fields outright rather than cleanly remapping them — a genuinely
  different database *engine*, not just a different server, and fiddly
  enough that it wasn't worth fighting through before going to production.
- The per-workstation toggle it needed on the web app side was also its own
  footgun — easy to leave switched to "dev" and get a real ResetNr/InvNr
  silently printed as empty (right number, wrong database, no error).

For verifying reset/invoice numbers against `taxidb` while still testing,
use the app's own on-screen views instead (`ResetModal`'s preview table,
the invoice detail view) — they show the exact same breakdown the Crystal
report would print, straight from the same backend calculation, no Crystal
involved at all.

## HTTP contract

| Route | Params | Report | Notes |
|---|---|---|---|
| `GET /print/invoice` | `invNr` (raw `Invoices.InvNr`, not the display number), `copy` (`1`=original/"מקור", `0`=copy/"העתק"), `name1`..`name6` (price-list item names for the invoice's lines — the report doesn't look these up itself, same as the original VB6 caller) | `InvoiceReport2.rpt` | |
| `GET /print/reset/active` | `area` | `ActiveResetRpt.rpt` | Always shows the branch's current `ActiveReset` staging row — ResetNr is fixed at 0, matching the original's own behavior right after a commit. |
| `GET /print/reset/past` | `area`, `resetNr` | `PastResetRpt.rpt` | Historical reset lookup by its real `ResetNr`. |
| `GET /print/test` | `taxiNr`, `carnr` (raw numeric car license number — the route splits it into the grouped display format itself), `meterType`, `vehicleModel`, `testNr` (optional, defaults to 0) | `testNew.rpt` | Renders from already-resolved values handed to it by `TestPrintModal.tsx` after a successful `POST /api/account/{taxiNr}/test-print` call — see "Test certificate" above. No `meterNr` param — the report reads that live from its own `Accounts` join. |
| `GET /health` | — | — | Liveness check only, doesn't touch Crystal/DB. |

All routes return `application/pdf` on success, or `{"detail": "..."}` JSON
with a non-200 status on failure.

## Troubleshooting

- **`Retrieving the COM class factory for component with CLSID {...} failed
  ... Class not registered (REGDB_E_CLASSNOTREG)`** — you ran the script
  with the 64-bit `powershell.exe`. Crystal Reports XI's `CRAXDRT`/
  `craxdrt.dll` is a 32-bit-only COM library (same as the VB6 app itself),
  so it's only registered in the 32-bit COM registry hive — a 64-bit
  PowerShell process can't see that CLSID at all. Run it with the 32-bit
  PowerShell instead:
  ```
  C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File MonitexPrintBridge.ps1
  ```
  `Start-MonitexPrintBridge.vbs` already does this automatically (it
  detects and prefers the SysWOW64 32-bit host), so this only bites you if
  you invoke the `.ps1` directly from a plain `powershell` command/shortcut
  instead of through the `.vbs` launcher.
- **VB6 IDE crashes ("Microsoft Visual C++ Runtime Library... vb6.exe")
  when doing File → Save As on an embedded Designer** — a known, long-
  standing VB6+Crystal XI compatibility issue, not something specific to
  this project. Try, roughly in order of effort: close the VB6 Toolbox
  window before opening the report Designer (reported to be the actual
  trigger in some cases); run the VB6 IDE as Administrator; add a DEP
  (Data Execution Prevention) exception for `vb6.exe` (System Properties →
  Advanced → Performance Settings → Data Execution Prevention → Add). Often
  easier to avoid entirely: open the already-existing loose `.rpt`
  candidate directly in the *standalone* Crystal Reports Designer (not
  through VB6 at all) and verify its parameters instead — see the
  candidate tables above for each report.
- **`New-Object -ComObject CrystalRuntime.Application` fails** — that
  ProgID is what Crystal Reports 8.5–11 (`craxdrt.dll`) has historically
  registered under. If it errors, check the registry
  (`HKEY_CLASSES_ROOT\CrystalRuntime.Application`) for the actual
  registered ProgID on this machine and update `New-CrystalApplication` in
  the script if it differs.
- **PDF export looks empty/wrong** — the `DestinationType`/`FormatType`
  numeric constants (`$crEDTDiskFile = 1`, `$crEFTPortableDocFormat = 31`)
  are the standard Crystal export enum values for this era, but if export
  misbehaves, this is the first place to double check against your
  installed version.
- **`HttpListener.Start()` throws "Access is denied"** — run once as
  administrator: `netsh http add urlacl url=http://localhost:9100/
  user=Everyone`, then it'll work for the regular user going forward.
- **Browser blocks the request (CORS)** — the script already sends
  `Access-Control-Allow-Origin: *`; if you've locked this down, make sure
  it still allows whatever origin the web app is actually served from.
- **DB credentials note**: the script contains the same `monitex`/`arie`
  ODBC login the VB6 source already has in plaintext — not a new exposure,
  but this file is now a plain-text script sitting on each branch PC rather
  than a compiled EXE, so it's a bit more casually readable if that matters
  to you.

## movein.dat file bridge (`MonitexFileBridge.ps1`)

A second, separate script in this same folder — not part of the printing
pipeline above. See its own header comment for the full picture; short
version here.

**Why:** the Hashavshevת accounting export (`movein.dat`, see
`backend/app/movein_export.py`) has always been written straight to a
local path — `Areas.BaseDir + "<area, 3 digits>" + "\movein.dat"` for a
brand-new reset, `CFG.hdir + "\movein.dat"` for a resend/reprint of an
already-archived one. Both are read live from the database by the web
backend, but the backend itself runs on a *different* machine than
whichever PC those paths actually point at (confirmed 2026-09-26 — same
situation printing was in, just solved the other direction: here the
**backend** pushes the file over the network, rather than the **browser**
triggering a local action, since there's exactly one accounting PC
involved, not "whichever branch PC the user is at").

**Setup (on the accounting PC only — NOT each branch PC):**

1. Copy `MonitexFileBridge.ps1` onto that machine, anywhere.
2. Open it and check `$Root` (defaults to `C:\`, matching `Areas.BaseDir`'s
   current value for every branch) and `$Port` (`9200`).
3. Run it: `powershell -ExecutionPolicy Bypass -File MonitexFileBridge.ps1`
   — leave it running (same "run at logon" options as
   `MonitexPrintBridge.ps1` above apply here too, via a scheduled task or a
   Startup-folder shortcut to a small `.vbs` wrapper, if you want it
   unattended).
4. Since the backend calls this from a *different* machine (not
   `localhost`), the listener binds `http://+:9200/` (all interfaces) —
   Windows Firewall may prompt to allow it the first time; allow it for
   whatever network the backend reaches this PC on. If `HttpListener.Start()`
   throws "Access is denied", run once as administrator: `netsh http add
   urlacl url=http://+:9200/ user=Everyone`.
5. On the backend, set the `MOVEIN_BRIDGE_URL` env var to this machine's
   reachable address, e.g. `MOVEIN_BRIDGE_URL=http://<accounting-pc-ip>:9200`
   (same network/Tailscale setup the web app itself already uses — see
   "Desktop shortcut" above). Left unset, the backend simply skips the
   delivery attempt (reset commits and the past-reset movein.dat download
   both keep working either way — this is a best-effort delivery, not a
   hard dependency).

**Contract:** `POST /write/movein?relpath=<path relative to $Root>` with
the file's raw bytes as the body → writes to `$Root\<relpath>`, creating
the immediate parent folder if missing, rejecting anything that would
resolve outside `$Root`. `GET /health` for a liveness check. The backend
(`routers/reset.py`) decides the exact `relpath` (mirroring the original's
own `BaseDir`/`hdir` logic) — this script doesn't know anything about
movein.dat specifically, it just writes bytes to a validated path.
