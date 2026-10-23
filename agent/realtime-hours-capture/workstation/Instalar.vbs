Option Explicit

Dim fso, shellApplication, shell, baseFolder, installer, setupFile, arguments
Dim installRoot, successMarker, failureMarker, elapsed, timeoutSeconds
Dim fileHandle, message

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
Set shellApplication = CreateObject("Shell.Application")

baseFolder = fso.GetParentFolderName(WScript.ScriptFullName)
installer = baseFolder & "\install-one-click.ps1"
setupFile = baseFolder & "\setup.json"

If Not fso.FileExists(installer) Then
    MsgBox "O arquivo install-one-click.ps1 nao foi encontrado. Extraia o ZIP inteiro antes de instalar.", 16, "Central Operacional"
    WScript.Quit 1
End If

If Not fso.FileExists(setupFile) Then
    MsgBox "O arquivo setup.json nao foi encontrado. Extraia o ZIP inteiro e configure o token antes de instalar.", 16, "Central Operacional"
    WScript.Quit 1
End If

installRoot = shell.ExpandEnvironmentStrings("%ProgramData%") & "\CentralOperacional\RealtimeHoursAgent"
successMarker = installRoot & "\installation-success.txt"
failureMarker = installRoot & "\installation-failed.txt"

On Error Resume Next
If fso.FileExists(successMarker) Then fso.DeleteFile successMarker, True
If fso.FileExists(failureMarker) Then fso.DeleteFile failureMarker, True
On Error GoTo 0

MsgBox "A instalacao sera executada em segundo plano. Confirme a permissao administrativa do Windows. Ao final, esta tela informara sucesso ou o motivo da falha.", 64, "Central Operacional"

arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & installer & """"

On Error Resume Next
shellApplication.ShellExecute "powershell.exe", arguments, baseFolder, "runas", 0
If Err.Number <> 0 Then
    message = "Nao foi possivel iniciar o instalador. Erro: " & Err.Description
    MsgBox message, 16, "Central Operacional"
    WScript.Quit 1
End If
On Error GoTo 0

timeoutSeconds = 90
elapsed = 0

Do While elapsed < timeoutSeconds
    WScript.Sleep 1000
    elapsed = elapsed + 1

    If fso.FileExists(successMarker) Then
        Set fileHandle = fso.OpenTextFile(successMarker, 1, False)
        message = fileHandle.ReadAll
        fileHandle.Close
        MsgBox "Instalacao concluida com sucesso." & vbCrLf & vbCrLf & message, 64, "Central Operacional"
        WScript.Quit 0
    End If

    If fso.FileExists(failureMarker) Then
        Set fileHandle = fso.OpenTextFile(failureMarker, 1, False)
        message = fileHandle.ReadAll
        fileHandle.Close
        MsgBox message & vbCrLf & vbCrLf & "Consulte tambem: " & installRoot & "\logs\installation.log", 16, "Falha na instalacao"
        WScript.Quit 1
    End If
Loop

MsgBox "O instalador foi iniciado, mas nao confirmou o resultado em 90 segundos. Execute Diagnosticar-Instalacao.bat para verificar a tarefa e os logs.", 48, "Central Operacional"
WScript.Quit 2
