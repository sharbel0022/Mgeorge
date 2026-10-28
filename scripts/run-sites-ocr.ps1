$ErrorActionPreference = 'Stop'
$taskConfigPath = Join-Path $PSScriptRoot '..\.codex-work\sites-ocr\ocr-config.dat'
$taskStage = 'configuration'
try {
  Add-Type -AssemblyName System.Security
  $taskStage = 'read_configuration'
  $taskCipher = [Convert]::FromBase64String([IO.File]::ReadAllText($taskConfigPath))
  $taskStage = 'decrypt_configuration'
  $taskClear = [Security.Cryptography.ProtectedData]::Unprotect($taskCipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $taskStage = 'parse_configuration'
  $taskConfig = [Text.Encoding]::UTF8.GetString($taskClear) | ConvertFrom-Json
  [Array]::Clear($taskClear, 0, $taskClear.Length)
  $taskJson = @{ origin = $taskConfig.origin; token = $taskConfig.token } | ConvertTo-Json -Compress
  $taskStage = 'worker'
  Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
  $taskOutput = $taskJson | & $taskConfig.node (Join-Path $PSScriptRoot '..\src\sites-ocr-pull.js') --config-stdin
  $taskCode = $LASTEXITCODE
  # Only counts / generic status, never file names, texts, leases or credentials.
  [IO.File]::WriteAllText((Join-Path (Split-Path $taskConfigPath) 'ocr-status.json'), ($taskOutput | Out-String))
  exit $taskCode
} catch {
  try { [IO.File]::WriteAllText((Join-Path (Split-Path $taskConfigPath) 'ocr-status.json'), ('{"status":"runner_error","stage":"' + $taskStage + '"}')) } catch {}
  exit 1
}
