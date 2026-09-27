<#
.SYNOPSIS
  Local file-drop bridge: lets the Monitex web BACKEND (running on a
  different machine than this one — confirmed 2026-09-26) deliver a
  movein.dat file to this machine's local disk, over the network.

  WHY THIS EXISTS: movein.dat (the Hashavshevת/accounting export — see
  backend/app/movein_export.py) has always been written straight to a
  local path on whichever machine runs the accounting software itself
  (Area.BaseDir + "<area, 3 digits>\movein.dat" for a brand-new reset,
  CFG.hdir\movein.dat for a resend/reprint — both read live from the DB,
  see movein_export.py's module docstring). The web app's backend does
  NOT run on that machine, so it can't just open()/write a local file the
  way the original VB6 app did — same class of problem MonitexPrintBridge
  solved for Crystal Reports printing, just pushed FROM the backend
  instead of triggered BY a browser (there's exactly one accounting PC
  here, not "whichever branch PC the user happens to be sitting at").

  WHAT IT DOES:
  - Hosts a tiny HTTP server on http://<this-pc>:9200/ (reachable from
    wherever the backend runs — same network/VPN/Tailscale setup already
    used for the web app itself, see print-bridge/README.md).
  - POST /write/movein?relpath=<path relative to $Root> with the file's
    raw bytes as the request body -> writes them to $Root\<relpath>,
    creating the immediate parent folder if it's missing.
  - Rejects any relpath that would resolve outside $Root (defense against
    a malformed/malicious relpath trying to escape via "..").

  This is intentionally NOT specific to movein.dat's filename or content —
  it just writes bytes to a validated path under $Root. The backend
  decides the exact relative path (BaseDir/hdir logic already lives
  there, not duplicated here).

.NOTES
  Run with:  powershell -ExecutionPolicy Bypass -File MonitexFileBridge.ps1
  Runs on the ACCOUNTING PC (wherever CFG.hdir/Area.BaseDir actually point
  today, e.g. "C:\") — NOT a branch PC, and NOT the same script/process as
  MonitexPrintBridge.ps1 (that one stays per-branch, for printing).
#>

# ---------------------------------------------------------------------------
# Configuration - edit these to match this machine's setup.
# ---------------------------------------------------------------------------

# Fixed root every write is confined to. Area.BaseDir is currently "C:\"
# for every branch (2026-09-26), and CFG.hdir points at a folder under the
# same drive (e.g. "C:\hmon12") - so the backend sends paths already
# relative to this root (it strips the drive letter itself before
# calling). Change this if BaseDir/hdir ever move to a different drive.
$Root = 'C:\'

$Port = 9200

# ---------------------------------------------------------------------------
# Path safety
# ---------------------------------------------------------------------------

# Resolves "$Root\$RelPath" and confirms the result is still actually
# inside $Root (blocks "..\..\Windows\System32\..." style escapes) before
# ever touching the filesystem. Returns the resolved full path, or throws.
function Resolve-SafeTargetPath {
    param([string]$RelPath)

    if ([string]::IsNullOrWhiteSpace($RelPath)) {
        throw "Missing required query param 'relpath'"
    }

    # Backslash and forward-slash both accepted (URL query strings tend to
    # arrive with forward slashes even for a Windows-style path).
    $normalizedRel = $RelPath.Replace('/', '\').TrimStart('\')
    $combined = Join-Path $Root $normalizedRel

    # GetFullPath collapses any ".." segments - compare against $Root's own
    # full path (also normalized) rather than trusting the input string.
    $fullPath = [System.IO.Path]::GetFullPath($combined)
    $fullRoot = [System.IO.Path]::GetFullPath($Root)

    if (-not $fullPath.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "relpath '$RelPath' resolves outside of the allowed root ($Root) - rejected."
    }

    return $fullPath
}

function Handle-WriteMovein {
    param($Query, [byte[]]$Body)

    if ($null -eq $Body -or $Body.Length -eq 0) {
        throw "Empty request body - nothing to write."
    }

    $targetPath = Resolve-SafeTargetPath -RelPath $Query['relpath']

    $targetDir = Split-Path $targetPath -Parent
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    [System.IO.File]::WriteAllBytes($targetPath, $Body)
    return $targetPath
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

function Write-JsonResponse {
    param($Response, [int]$StatusCode, [hashtable]$Body)
    try {
        $Response.StatusCode = $StatusCode
        $Response.ContentType = 'application/json; charset=utf-8'
        $bytes = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json))
        $Response.ContentLength64 = $bytes.Length
        $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    catch {
        Write-Host "  (could not send response to client - connection likely already closed: $($_.Exception.Message))"
    }
}

function Add-CorsHeaders {
    param($Response)
    # This bridge is called directly by the backend server, not a browser -
    # CORS is irrelevant to that call, but kept permissive/consistent with
    # MonitexPrintBridge.ps1 in case that ever changes.
    $Response.Headers.Add('Access-Control-Allow-Origin', '*')
    $Response.Headers.Add('Access-Control-Allow-Methods', 'POST, OPTIONS')
    $Response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
}

function Read-RequestBody {
    param($Request)
    $length = $Request.ContentLength64
    if ($length -le 0) { return @() }
    $buffer = New-Object byte[] $length
    $totalRead = 0
    while ($totalRead -lt $length) {
        $read = $Request.InputStream.Read($buffer, $totalRead, $length - $totalRead)
        if ($read -le 0) { break }
        $totalRead += $read
    }
    return $buffer
}

Add-Type -AssemblyName System.Web

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")
$listener.Start()
Write-Host "Monitex file bridge listening on http://+:$Port/  (Ctrl+C to stop)"
Write-Host "Root: $Root"

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
                Write-JsonResponse -Response $response -StatusCode 200 -Body @{ status = 'ok'; root = $Root }
            }
            elseif ($path -eq '/write/movein' -and $request.HttpMethod -eq 'POST') {
                $body = Read-RequestBody -Request $request
                $writtenPath = Handle-WriteMovein -Query $query -Body $body
                Write-Host "Wrote $($body.Length) bytes to $writtenPath"
                Write-JsonResponse -Response $response -StatusCode 200 -Body @{ status = 'ok'; path = $writtenPath }
            }
            else {
                Write-JsonResponse -Response $response -StatusCode 404 -Body @{ detail = "Unknown route: $path" }
            }
        }
        catch {
            Write-Host "Error handling $($request.Url): $($_.Exception.Message)"
            Write-JsonResponse -Response $response -StatusCode 500 -Body @{ detail = $_.Exception.Message }
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
