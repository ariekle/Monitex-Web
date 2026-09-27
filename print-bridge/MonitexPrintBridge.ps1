<#
.SYNOPSIS
  Local print bridge: lets the Monitex web app (running in a browser on this
  same branch PC) trigger the REAL Crystal Reports XI reports that were
  originally embedded in Monitex2000.exe, exported here as standalone .rpt
  files, and now driven headlessly via COM automation (CRAXDRT / "Crystal
  Reports ActiveX Designer Run Time Library 11.5" - the same DLL the old app
  uses, already registered on this machine).

  Why this exists at all: the report *designs* were compiled directly into
  the VB6 app as embedded Designer objects (Dim InvReport As New
  InvoiceReport2, etc.) rather than loose .rpt files loadable by path. Once
  exported via Crystal Reports Designer's "Save As" to a standalone .rpt
  (see README.md), ANY COM-capable process - this script included - can open
  and drive them with CRAXDRT.Application.OpenReport(path), with no VB6
  involved at all.

  WHAT IT DOES:
  - Hosts a tiny local-only HTTP server on http://localhost:9100/
  - On each request, opens the requested .rpt, logs on to the SAME "monitex"
    ODBC DSN the old app already uses (so it reads live data straight out of
    SQL Server, exactly like the original forms did), sets the report's
    parameters, exports it to a temp PDF, and streams that PDF back as the
    HTTP response.
  - The browser then just does `window.open()` on the request URL (or
    displays the returned PDF) - same UX as opening a print preview.

  ROUTES (see README.md for the full contract table):
    GET /print/invoice?invNr=<raw InvNr>&copy=1|0
    GET /print/reset/active?area=<n>
    GET /print/reset/past?area=<n>&resetNr=<n>
    GET /print/test?taxiNr=<n>&meterType=<s>&vehicleModel=<s>&carnr=<n>&testNr=<n>
    GET /health                                    (no Crystal/DB touched - quick liveness check)

.NOTES
  Run with:  powershell -ExecutionPolicy Bypass -File MonitexPrintBridge.ps1
  See README.md for how to register this to start automatically at logon.
#>

# ---------------------------------------------------------------------------
# Configuration - edit these to match this branch PC's setup.
# ---------------------------------------------------------------------------

# Folder holding the standalone .rpt files exported from Crystal Reports
# Designer (see README.md "Exporting the reports"). One file per report,
# named exactly as listed in $Reports below.
#
# Defaults to a "Reports" subfolder right next to this script (via
# $PSScriptRoot), so the whole print-bridge folder - script, launcher,
# README, and Reports\ - is one self-contained unit you can copy to each
# branch PC as-is, with no path to edit here. Override with a fixed path
# (e.g. 'C:\MonitexReports') instead if you'd rather keep reports somewhere
# shared/central on the machine.
$ReportsFolder = Join-Path $PSScriptRoot 'Reports'

# Same ODBC DSN / credentials every report form in the original app already
# uses (Report.Database.LogOnServer "pdsodbc.dll", "monitex", "monitex",
# "arie", "arie321") - confirmed still valid against this branch's DB. If
# that ever changes, update it here only; nothing else in this script
# hardcodes it a second time.
$DsnDriver = 'pdsodbc.dll'
$DsnName = 'monitex'
$DsnDatabase = 'monitex'
$DsnUser = 'arie'
$DsnPassword = 'arie321'

# A "print against taxidb instead" mode existed briefly (2026-08-17/18) but
# was removed - re-pointing a Pervasive-bound .rpt at SQL Server in Crystal
# Reports Designer kept dropping fields outright rather than cleanly
# remapping them, and the per-workstation toggle it needed was an easy way
# to silently print a real reset/invoice against the wrong DB. Verify
# dev/taxidb numbers on-screen in the app instead (ResetModal's preview
# table, invoice detail view) - see README.md.

$Port = 9100

# Report file names, relative to $ReportsFolder - must match exactly what
# you named the file when exporting from Crystal Reports Designer.
$Reports = @{
    invoice      = 'InvoiceReport2.rpt'   # ported from frmInvoiceRpt2.frm - handles both regular and Eilat invoices
    resetActive  = 'ActiveResetRpt.rpt'   # ported from frmResetTotalsRpt.frm - the "just completed" reset summary
    resetPast    = 'PastResetRpt.rpt'     # ported from frmPastResetRpt.frm - a historical reset by ResetNr
    testPrint    = 'testNew.rpt'          # ported from frmTestPrint.frm / printTest() in Account.frm - meter/vehicle test certificate
}

# ---------------------------------------------------------------------------
# Crystal automation helpers
# ---------------------------------------------------------------------------

# crOpenReportByTempCopy - opens a private working copy so concurrent
# requests (or a request arriving while a previous one is still exporting)
# never fight over the same file handle.
$OpenReportMethodTempCopy = 1

# ExportOptions constants (Crystal Reports enums - numeric because we're
# driving this via late-bound COM, not a compiled type-library reference).
$crEDTDiskFile = 1              # DestinationType: disk file
$crEFTPortableDocFormat = 31    # FormatType: PDF

function New-CrystalApplication {
    New-Object -ComObject CrystalRuntime.Application
}

# Clears any lingering default/current values on a parameter before setting
# a fresh one - mirrors the ClearCurrentValueAndRange + delete-until-empty
# pattern every original frmXxxRpt.frm form does before AddCurrentValue.
# Belt-and-suspenders here since we open a brand-new report object per
# request (no reuse across calls), but cheap enough to keep for safety.
function Set-ReportParameter {
    param($Report, [string]$Name, $Value)
    try {
        $field = $Report.ParameterFields.GetItemByName($Name)
    }
    catch {
        # Crystal's own COM error here is just "Invalid Name" with no
        # indication of WHICH name - wrap it so the actual bad parameter is
        # obvious without opening the report in Designer to bisect by hand.
        throw "Parameter '$Name' not found on this report - open it in Crystal Reports Designer > Field Explorer > Parameter Fields and check the exact spelling/casing there. (Original error: $($_.Exception.Message))"
    }
    $field.ClearCurrentValueAndRange()
    while ($field.NumberOfDefaultValues -gt 0) {
        $field.DeleteNthDefaultValue(1)
    }

    # DISP_E_TYPEMISMATCH here means the .rpt's declared type for this
    # parameter (set when it was created in Crystal Reports Designer - e.g.
    # String vs Number vs Currency) doesn't match the .NET/COM type we sent.
    # Rather than require every report's parameters to be re-verified
    # type-by-type by hand, try a few representations in turn:
    #   1. As-is (whatever type the caller already passed - fast path for
    #      params that are already correctly typed).
    #   2. As a plain string - Crystal's COM layer often coerces a string
    #      into a Number/Currency parameter fine.
    #   3. As a [double] - Crystal's "Number" parameter type maps to Double
    #      internally in the old CRAXDRT/COM object model, which doesn't
    #      always auto-widen from an Int32/Int64 the way newer .NET COM
    #      interop would; this recovers that specific case (seen live with
    #      testNew.rpt's MeterNr parameter).
    $candidates = [System.Collections.Generic.List[object]]::new()
    $candidates.Add($Value)
    $candidates.Add([string]$Value)
    $asDouble = 0.0
    if ([double]::TryParse([string]$Value, [ref]$asDouble)) {
        $candidates.Add([double]$asDouble)
    }

    $lastError = $null
    $succeeded = $false
    foreach ($candidate in $candidates) {
        try {
            $field.AddCurrentValue($candidate)
            $succeeded = $true
            break
        }
        catch {
            $lastError = $_
        }
    }
    if (-not $succeeded) {
        throw "Parameter '$Name': AddCurrentValue failed for every representation tried (as-is, string, double) of value '$Value' - doesn't fit this parameter's type as defined in Crystal Reports Designer. (Last error: $($lastError.Exception.Message))"
    }
}

# Report.Database.LogOnServer() only sets logon info at the report level -
# it does NOT reliably propagate to every individual Table object (and
# never to subreports' own tables), which can be left holding stale/cached
# credentials from whenever the report was originally designed in Crystal
# Reports Designer. That mismatch is exactly what produces a SQL Server
# "Logon failed" (error 18456) or an unexpected "Enter Parameter Values"/
# login prompt popping up even though the top-level LogOnServer call
# succeeded. Push the SAME logon onto every table on the main report and
# every subreport explicitly so nothing is left with old credentials.
function Set-AllTablesLogOnInfo {
    param($Report)

    function Set-TableLogOnInfo {
        param($Tables)
        foreach ($table in $Tables) {
            # Table.SetLogOnInfo(ServerName, DBName, UserID, Password) - the
            # classic CRAXDRT/COM RDC method (no DLLName argument, unlike
            # Database.LogOnServer which takes 5 params including DLLName).
            $table.SetLogOnInfo($DsnName, $DsnDatabase, $DsnUser, $DsnPassword)
        }
    }

    Set-TableLogOnInfo -Tables $Report.Database.Tables

    foreach ($subreportName in $Report.SubreportNames) {
        $subreport = $Report.OpenSubreport($subreportName)
        Set-TableLogOnInfo -Tables $subreport.Database.Tables
    }
}

function Export-ReportToPdf {
    param($Report, [string]$OutPath)
    $Report.ExportOptions.DestinationType = $crEDTDiskFile
    $Report.ExportOptions.FormatType = $crEFTPortableDocFormat
    $Report.ExportOptions.DiskFileName = $OutPath
    $Report.Export($false)
}

# Releases a COM object and drops the PowerShell reference. Crystal's COM
# objects do NOT get cleaned up promptly by .NET's GC on their own - without
# this, a busy print bridge can accumulate orphaned crystl32/craxdrt
# processes/handles over a workday.
function Release-Com {
    param($Object)
    if ($null -ne $Object) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($Object)
    }
}

# Opens $ReportKey, logs on, sets $Parameters, exports to a fresh temp PDF,
# and returns the PDF's bytes. Always tears down the COM objects, even on
# failure - callers just try/catch around this and don't need to think
# about COM lifetime at all.
function Invoke-ReportToPdfBytes {
    param(
        [string]$ReportKey,
        [hashtable]$Parameters
    )

    if (-not $Reports.ContainsKey($ReportKey)) {
        throw "Unknown report key '$ReportKey'"
    }
    $rptPath = Join-Path $ReportsFolder $Reports[$ReportKey]
    if (-not (Test-Path $rptPath)) {
        throw "Report file not found: $rptPath - has it been exported from Crystal Reports Designer yet? See README.md."
    }

    $app = $null
    $report = $null
    $tempPdf = Join-Path $env:TEMP ("monitex_print_{0}.pdf" -f ([guid]::NewGuid().ToString('N')))
    try {
        $app = New-CrystalApplication

        try {
            $report = $app.OpenReport($rptPath, $OpenReportMethodTempCopy)
        }
        catch {
            throw "OpenReport failed for '$rptPath' (Original error: $($_.Exception.Message))"
        }

        try {
            $report.Database.LogOnServer($DsnDriver, $DsnName, $DsnDatabase, $DsnUser, $DsnPassword)
        }
        catch {
            # Most likely cause: no ODBC System DSN named "$DsnName"
            # visible to this 32-bit process on this PC - e.g. it exists as a
            # 64-bit-only DSN (configure it via the 32-bit ODBC Data Source
            # Administrator instead: %WINDIR%\SysWOW64\odbcad32.exe), or it
            # simply hasn't been created on this machine at all yet.
            throw "Database.LogOnServer('$DsnDriver', '$DsnName', '$DsnDatabase', '$DsnUser', ...) failed - is there a 32-bit ODBC System DSN named '$DsnName' configured on THIS machine (check via %WINDIR%\SysWOW64\odbcad32.exe, not the default Administrative Tools shortcut which opens the 64-bit one)? (Original error: $($_.Exception.Message))"
        }

        try {
            Set-AllTablesLogOnInfo -Report $report
        }
        catch {
            throw "Applying logon info to individual tables/subreports failed - this report may have a table with a different (cached/stale) connection baked in from when it was designed. (Original error: $($_.Exception.Message))"
        }

        try {
            $report.DiscardSavedData()
        }
        catch {
            throw "DiscardSavedData failed (Original error: $($_.Exception.Message))"
        }

        # Collect every failing parameter in one pass rather than stopping
        # at the first one - hashtable enumeration order isn't guaranteed,
        # so a single error here doesn't tell us whether it's the only
        # broken parameter or just the first one encountered. Seeing them
        # all at once avoids a slow one-error-per-test-run cycle.
        $paramErrors = New-Object System.Collections.Generic.List[string]
        foreach ($key in $Parameters.Keys) {
            try {
                Set-ReportParameter -Report $report -Name $key -Value $Parameters[$key]
            }
            catch {
                $paramErrors.Add($_.Exception.Message)
            }
        }
        if ($paramErrors.Count -gt 0) {
            throw "$($paramErrors.Count) parameter(s) failed:`n - " + ($paramErrors -join "`n - ")
        }

        Export-ReportToPdf -Report $report -OutPath $tempPdf
        if (-not (Test-Path $tempPdf)) {
            throw 'Crystal export did not produce a PDF file (unknown export failure).'
        }
        return [System.IO.File]::ReadAllBytes($tempPdf)
    }
    finally {
        Release-Com $report
        Release-Com $app
        [System.GC]::Collect()
        [System.GC]::WaitForPendingFinalizers()
        if (Test-Path $tempPdf) { Remove-Item $tempPdf -Force -ErrorAction SilentlyContinue }
    }
}

# ---------------------------------------------------------------------------
# Route handlers - each builds the report's specific ParameterFields, ported
# from the matching frmXxxRpt.frm Form_Load(). See README.md for where each
# parameter comes from on the web app side.
# ---------------------------------------------------------------------------

function Handle-Invoice {
    param($Query)
    $invNr = $Query['invNr']
    $copy = $Query['copy']
    if ([string]::IsNullOrWhiteSpace($invNr)) { throw "Missing required query param 'invNr'" }

    # Ported from frmInvoiceRpt2.frm: Makor=1 -> "מקור" (original), else "העתק" (copy).
    $copyLabel = if ($copy -eq '1') { 'מקור' } else { 'העתק' }

    # Name1..Name6 (the price-list item names for the invoice's up to 6
    # lines) are resolved by the CALLER in the original code, not by the
    # report itself - ported to the backend instead, see README.md's
    # "invoice" contract row for the exact endpoint that supplies them.
    $names = @('', '', '', '', '', '')
    for ($i = 0; $i -lt 6; $i++) {
        $key = "name$($i + 1)"
        if ($Query.ContainsKey($key)) { $names[$i] = $Query[$key] }
    }

    $params = @{
        InvoiceNr = [long]$invNr
        Copy      = $copyLabel
        Name1     = $names[0]
        Name2     = $names[1]
        Name3     = $names[2]
        Name4     = $names[3]
        Name5     = $names[4]
        Name6     = $names[5]
    }
    Invoke-ReportToPdfBytes -ReportKey 'invoice' -Parameters $params
}

function Handle-ResetActive {
    param($Query)
    $area = $Query['area']
    if ([string]::IsNullOrWhiteSpace($area)) { throw "Missing required query param 'area'" }
    # ResetNr is accepted (and passed through, matching the parameter's
    # existence on the report) but the original code always shows this
    # specific report with ResetNr=0 right after a fresh commit - see
    # frmReset1.frm around the `ResetNr = 0` line right before
    # `frmResetTotalsRpt.Show`. Kept faithful to that rather than "fixed",
    # since it's the report that's meant to show the CURRENT active-reset
    # staging row for the branch (keyed by Area), not a specific historical
    # ResetNr - see PastResetRpt for that case.
    $params = @{ Area = [int]$area; ResetNr = 0 }
    Invoke-ReportToPdfBytes -ReportKey 'resetActive' -Parameters $params
}

function Handle-ResetPast {
    param($Query)
    $area = $Query['area']
    $resetNr = $Query['resetNr']
    if ([string]::IsNullOrWhiteSpace($area)) { throw "Missing required query param 'area'" }
    if ([string]::IsNullOrWhiteSpace($resetNr)) { throw "Missing required query param 'resetNr'" }
    $params = @{ Area = [int]$area; ResetNr = [long]$resetNr }
    Invoke-ReportToPdfBytes -ReportKey 'resetPast' -Parameters $params
}

# Ported from printTest()/frmTestPrint.frm Form_Load() in Account.frm - the
# meter/vehicle test certificate. This route only renders the PDF from
# ALREADY-RESOLVED values - the backend (routers/test_print.py) does the
# actual precondition checks, History write, and CFG.testNr allocation
# first (see POST /api/account/{taxiNr}/test-print), and the web app hands
# the results straight to this route. MeterNr is deliberately NOT a
# parameter here - the .rpt reads it live from its own Accounts join now.
function Handle-TestPrint {
    param($Query)
    $taxiNr = $Query['taxiNr']
    $meterType = $Query['meterType']
    $vehicleModel = $Query['vehicleModel']
    $carnr = $Query['carnr']
    $testNr = $Query['testNr']
    if ([string]::IsNullOrWhiteSpace($taxiNr)) { throw "Missing required query param 'taxiNr'" }
    if ([string]::IsNullOrWhiteSpace($carnr)) { throw "Missing required query param 'carnr'" }

    # Format(carnr \ 100000, "00") / Format(carnr \ 100 Mod 1000, "000") /
    # Format(carnr Mod 100, "00") - splits the plain numeric car license
    # number into the grouped XX-XXX-XX display format, exactly as the
    # original VB6 caller does right before setting these parameters.
    $carnrLong = [long]$carnr
    $carnr1 = [math]::Floor($carnrLong / 100000)
    $carnr2 = [math]::Floor($carnrLong / 100) % 1000
    $carnr3 = $carnrLong % 100

    $params = @{
        # "Model" is the report's parameter name for the free-text VEHICLE
        # model - a naming quirk in the original: printTest() reuses the
        # same EnterText variable for both the (optional) meter model
        # prompt and the (always-asked) vehicle model prompt, and it's the
        # vehicle model value that's still in EnterText by the time this
        # report is shown. MeterType is the separate, correctly-named
        # parameter for the meter's own model/type string.
        Model     = $vehicleModel
        TaxiNr    = [long]$taxiNr
        MeterType = $meterType
        Carnr1    = $carnr1.ToString('00')
        Carnr2    = $carnr2.ToString('000')
        Carnr3    = $carnr3.ToString('00')
        testNr    = if ([string]::IsNullOrWhiteSpace($testNr)) { 0 } else { [int]$testNr }
    }
    Invoke-ReportToPdfBytes -ReportKey 'testPrint' -Parameters $params
}

# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

function Parse-Query {
    param([System.Uri]$Url)
    $result = @{}
    $raw = [System.Web.HttpUtility]::ParseQueryString($Url.Query)
    foreach ($key in $raw.AllKeys) {
        if ($null -ne $key) { $result[$key] = $raw[$key] }
    }
    return $result
}

function Write-JsonError {
    param($Response, [int]$StatusCode, [string]$Message)
    try {
        $Response.StatusCode = $StatusCode
        $Response.ContentType = 'application/json; charset=utf-8'
        $bytes = [System.Text.Encoding]::UTF8.GetBytes((@{ detail = $Message } | ConvertTo-Json))
        $Response.ContentLength64 = $bytes.Length
        $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    catch {
        # The client's connection can already be gone by the time we get
        # here (e.g. the browser gave up waiting during a slow Crystal
        # export, or the tab was closed/navigated away from) - trying to
        # write an error response onto a dead connection just throws a
        # second, more confusing exception on top of the real one. The real
        # error is already logged to the console by the caller; swallow
        # this secondary failure rather than let it cascade.
        Write-Host "  (could not send error response to client - connection likely already closed: $($_.Exception.Message))"
    }
}

function Add-CorsHeaders {
    param($Response)
    # Local-only bridge, no auth/credentials involved - any origin on this
    # machine's browser may call it. Tighten to a specific origin here if
    # you'd rather be strict about which URL the web app is served from.
    $Response.Headers.Add('Access-Control-Allow-Origin', '*')
    $Response.Headers.Add('Access-Control-Allow-Methods', 'GET, OPTIONS')
    $Response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
}

Add-Type -AssemblyName System.Web

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Monitex print bridge listening on http://localhost:$Port/  (Ctrl+C to stop)"
Write-Host "Reports folder: $ReportsFolder"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        Add-CorsHeaders -Response $response

        try {
            if ($request.HttpMethod -eq 'OPTIONS') {
                $response.StatusCode = 204
                continue
            }

            $path = $request.Url.AbsolutePath
            $query = Parse-Query -Url $request.Url

            if ($path -eq '/health') {
                $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"status":"ok"}')
                $response.ContentType = 'application/json'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            elseif ($path -eq '/print/invoice') {
                $pdfBytes = Handle-Invoice -Query $query
                $response.ContentType = 'application/pdf'
                $response.ContentLength64 = $pdfBytes.Length
                $response.OutputStream.Write($pdfBytes, 0, $pdfBytes.Length)
            }
            elseif ($path -eq '/print/reset/active') {
                $pdfBytes = Handle-ResetActive -Query $query
                $response.ContentType = 'application/pdf'
                $response.ContentLength64 = $pdfBytes.Length
                $response.OutputStream.Write($pdfBytes, 0, $pdfBytes.Length)
            }
            elseif ($path -eq '/print/reset/past') {
                $pdfBytes = Handle-ResetPast -Query $query
                $response.ContentType = 'application/pdf'
                $response.ContentLength64 = $pdfBytes.Length
                $response.OutputStream.Write($pdfBytes, 0, $pdfBytes.Length)
            }
            elseif ($path -eq '/print/test') {
                $pdfBytes = Handle-TestPrint -Query $query
                $response.ContentType = 'application/pdf'
                $response.ContentLength64 = $pdfBytes.Length
                $response.OutputStream.Write($pdfBytes, 0, $pdfBytes.Length)
            }
            else {
                Write-JsonError -Response $response -StatusCode 404 -Message "Unknown route: $path"
            }
        }
        catch {
            Write-Host "Error handling $($request.Url): $($_.Exception.Message)"
            Write-JsonError -Response $response -StatusCode 500 -Message $_.Exception.Message
        }
        finally {
            $response.OutputStream.Close()
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
