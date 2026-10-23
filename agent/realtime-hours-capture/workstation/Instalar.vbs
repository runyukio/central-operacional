Option Explicit
Dim fso, shellApplication, baseFolder, installer, arguments
Set fso = CreateObject("Scripting.FileSystemObject")
baseFolder = fso.GetParentFolderName(WScript.ScriptFullName)
installer = baseFolder & "\install-one-click.ps1"
If Not fso.FileExists(installer) Then
    MsgBox "install-one-click.ps1 nao encontrado.", 16, "Central Operacional"
    WScript.Quit 1
End If
arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & installer & """"
Set shellApplication = CreateObject("Shell.Application")
shellApplication.ShellExecute "powershell.exe", arguments, baseFolder, "runas", 0
