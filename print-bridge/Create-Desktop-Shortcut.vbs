' Run this ONCE (double-click) on a branch PC to create a "Monitex" icon on
' the Desktop that runs Launch-Monitex.vbs - i.e. one click starts the print
' bridge and opens the web app in an app-mode browser window, using the
' Monitex logo (monitex-icon.ico, already in this folder) as the shortcut's
' icon.
'
' Safe to run again later (e.g. after moving this folder) - it just
' overwrites the same Desktop shortcut with fresh paths.

Set objFso = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")
scriptDir = objFso.GetParentFolderName(WScript.ScriptFullName)
desktopPath = objShell.SpecialFolders("Desktop")

Set shortcut = objShell.CreateShortcut(desktopPath & "\Monitex.lnk")
shortcut.TargetPath = "wscript.exe"
shortcut.Arguments = """" & scriptDir & "\Launch-Monitex.vbs"""
shortcut.WorkingDirectory = scriptDir
shortcut.IconLocation = scriptDir & "\monitex-icon.ico"
shortcut.Description = "Monitex - starts the print bridge and opens the web app"
shortcut.Save

MsgBox "Done - a 'Monitex' shortcut was created on the Desktop." & vbCrLf & vbCrLf & _
       "It points at the address currently set in Launch-Monitex.vbs " & _
       "(MONITEX_URL near the top) - if that address ever changes, open " & _
       "that file in Notepad and update it there; no need to rebuild " & _
       "this shortcut.", vbInformation, "Monitex"
