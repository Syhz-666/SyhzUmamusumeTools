param([Parameter(Mandatory)][string]$Setup)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$setupPath = (Resolve-Path -LiteralPath $Setup).ProviderPath
$product = 'SyhzUmamusumeTools'
$startLink = Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk"
$registryPaths = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

function Get-AppInstallation {
  Get-ItemProperty -Path $registryPaths -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "$product*" }
}

if ((Get-AppInstallation) -or (Test-Path -LiteralPath $startLink) -or
    (Get-Process -Name $product -ErrorAction SilentlyContinue)) {
  throw 'Run the installer test in a Windows account with no existing installation, shortcut, or running instance.'
}

$caseDir = Join-Path $root "outputs/app-qa/installer-$([guid]::NewGuid().ToString('N'))"
$installDir = Join-Path $caseDir 'app files'
$appExe = Join-Path $installDir "$product.exe"
$uninstaller = Join-Path $installDir "Uninstall $product.exe"
$savePath = Join-Path ([Environment]::GetFolderPath('ApplicationData')) "$product/collection-v1.json"
$saveHash = if (Test-Path -LiteralPath $savePath -PathType Leaf) {
  (Get-FileHash -LiteralPath $savePath -Algorithm SHA256).Hash
}
New-Item -ItemType Directory -Path $caseDir | Out-Null

function Invoke-Setup([string]$File, [string]$Arguments) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  try {
    if (-not $process.WaitForExit(120000)) {
      $process.Kill()
      throw "Timed out running $File"
    }
    if ($process.ExitCode -ne 0) { throw "$File exited with code $($process.ExitCode)" }
  } finally {
    $process.Dispose()
  }
}

function Uninstall-TestApp {
  Invoke-Setup $uninstaller '/S /currentuser'
  # NSIS launches a temporary copy of the uninstaller and returns before it finishes.
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ((Test-Path -LiteralPath $installDir) -or (Test-Path -LiteralPath $startLink) -or (Get-AppInstallation)) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Uninstall did not remove the test installation' }
    Start-Sleep -Milliseconds 250
  }
}

try {
  # NSIS requires /D to be last and unquoted, including when its value has spaces.
  Invoke-Setup $setupPath "/S /currentuser /D=$installDir"
  if (-not (Test-Path -LiteralPath $appExe -PathType Leaf) -or
      -not (Test-Path -LiteralPath $uninstaller -PathType Leaf) -or
      -not (Test-Path -LiteralPath $startLink -PathType Leaf) -or -not (Get-AppInstallation)) {
    throw 'Setup did not create the application, uninstaller, Start menu shortcut, and uninstall entry'
  }

  node (Join-Path $PSScriptRoot 'test-persistence.cjs') $appExe
  if ($LASTEXITCODE -ne 0) { throw 'The installed app failed the save and restart test' }

  Uninstall-TestApp
  if ($saveHash -and (Get-FileHash -LiteralPath $savePath -Algorithm SHA256).Hash -cne $saveHash) {
    throw 'Setup or uninstall modified the existing collection'
  }
  Write-Output 'Installer verified: installation, restart persistence, and uninstallation passed.'
} finally {
  if (Test-Path -LiteralPath $uninstaller -PathType Leaf) { Uninstall-TestApp }
}
