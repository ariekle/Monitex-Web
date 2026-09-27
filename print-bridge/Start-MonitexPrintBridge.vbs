' Silently launches the Monitex print bridge PowerShell script with no
' visible console window - meant to be run at Windows logon (see README.md
' "Run automatically at logon"). Double-clicking this file also works for a
' one-off manual start/test.
'
' MUST use the 32-bit PowerShell (SysWOW64), not the default 64-bit one:
' Crystal Reports XI's CRAXDRT/craxdrt.dll COM library is 32-bit only (same
' as the VB6 app itself), so it's only registered in the 32-bit COM
' registry hive. The 64-bit powershell.exe can't see that CLSID at all and
' fails with "Class not registered (REGDB_E_CLASSNOTREG)". On 64-bit
' Windows that 32-bit host lives at
' %WINDIR%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe; on a (rare,
' legacy) 32-bit Windows install there's no SysWOW64 folder at all and the
' regular powershell.exe already IS the 32-bit one.
Set objFso = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")
scriptDir = objFso.GetParentFolderName(WScript.ScriptFullName)

powershell32 = objShell.ExpandEnvironmentStrings("%WINDIR%") & "\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
If objFso.FileExists(powershell32) Then
    powershellExe = powershell32
Else
    powershellExe = "powershell.exe"
End If

objShell.Run """" & powershellExe & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\MonitexPrintBridge.ps1""", 0, False
