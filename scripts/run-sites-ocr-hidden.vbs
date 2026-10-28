Option Explicit
Dim shell, files, scriptFolder, powershell, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
scriptFolder = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = files.GetParentFolderName(scriptFolder)
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
command = Chr(34) & powershell & Chr(34) & " -NoProfile -NonInteractive -WindowStyle Hidden -File " & Chr(34) & files.BuildPath(scriptFolder, "run-sites-ocr.ps1") & Chr(34)
' Set the hidden window state before PowerShell starts, and preserve its exit code.
result = shell.Run(command, 0, True)
WScript.Quit result
