' One-click launcher for a branch PC: starts the local Crystal Reports print
' bridge (silently, in the background - same as Start-MonitexPrintBridge.vbs)
' and opens the Monitex web app in a Chrome/Edge "app mode" window (no tabs,
' no address bar - see print-bridge/README.md, "Browser app mode" section).
'
' Meant to be launched from a desktop shortcut - see Create-Desktop-
' Shortcut.vbs in this same folder, which builds that shortcut for you
' automatically, with the Monitex icon already set.

' ===== EDIT THIS if the web app's address ever changes =====
MONITEX_URL = "http://100.79.130.48:5173/"
' ==============================================================

Set objFso = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")
scriptDir = objFso.GetParentFolderName(WScript.ScriptFullName)

' --- 1) Start the print bridge, silently, the same way
'     Start-MonitexPrintBridge.vbs does. If it's already running (e.g. from
'     a previous login, or Start-MonitexPrintBridge.vbs also runs at
'     startup), this second attempt just fails to bind port 9100 and exits
'     immediately in its own hidden window - harmless, the first instance
'     keeps serving requests.
objShell.Run "wscript.exe """ & scriptDir & "\Start-MonitexPrintBridge.vbs""", 0, False

' Give the bridge a moment to finish starting up before the browser opens
' (not required for the web app itself to load, just so the very first
' print click doesn't race a bridge that isn't listening yet).
WScript.Sleep 1500

' --- 2) Open the web app in an app-mode (chromeless) window.
' Tries Chrome first, then Edge, at their standard install locations -
' falls back to whatever the system's default browser is (with normal
' tabs/address bar) if neither is found there.
programFiles = objShell.ExpandEnvironmentStrings("%ProgramFiles%")
programFilesX86 = objShell.ExpandEnvironmentStrings("%ProgramFiles(x86)%")
localAppData = objShell.ExpandEnvironmentStrings("%LocalAppData%")

chromePaths = Array( _
    programFiles & "\Google\Chrome\Application\chrome.exe", _
    programFilesX86 & "\Google\Chrome\Application\chrome.exe", _
    localAppData & "\Google\Chrome\Application\chrome.exe")

edgePaths = Array( _
    programFilesX86 & "\Microsoft\Edge\Application\msedge.exe", _
    programFiles & "\Microsoft\Edge\Application\msedge.exe")

browserExe = ""

For Each p In chromePaths
    If objFso.FileExists(p) Then
        browserExe = p
        Exit For
    End If
Next

If browserExe = "" Then
    For Each p In edgePaths
        If objFso.FileExists(p) Then
            browserExe = p
            Exit For
        End If
    Next
End If

If browserExe <> "" Then
    objShell.Run """" & browserExe & """ --app=" & MONITEX_URL, 1, False
Else
    ' Neither Chrome nor Edge found at their usual paths - fall back to the
    ' default browser (will show normal tabs/address bar).
    objShell.Run MONITEX_URL, 1, False
End If
