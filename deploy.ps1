# Deploy bilsnapper-scanner to Cloud Run (cloudbuild.yaml)
# Run: deploy.cmd or powershell -File deploy.ps1
#
# Avoids: NativeCommandError from gcloud stderr (2>&1), and Start/Stop-Transcript host bugs.

$ErrorActionPreference = 'Continue'
$ScannerRoot = $PSScriptRoot
$ProjectId   = 'ferrous-layout-382117'
$LogFile     = Join-Path $ScannerRoot ('deploy-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')

function Find-Gcloud {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
    (Join-Path $env:ProgramFiles        'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  $cmd = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $w = (& where.exe gcloud 2>$null | Select-Object -First 1)
  if ($w) { return $w.Trim() }
  return $null
}

function Write-Log {
  param([string]$Message)
  $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Invoke-GCloudCmd {
  param(
    [string]$GcloudPath,
    [string]$ArgLine,
    [string]$WorkingDir
  )
  # Live output + correct exit code. cmd runs gcloud.cmd so PowerShell does not wrap stderr as ErrorRecord.
  Push-Location $WorkingDir
  try {
    & cmd.exe /c "`"$GcloudPath`" $ArgLine"
    return [int]$LASTEXITCODE
  } finally {
    Pop-Location
  }
}

$gcloud = Find-Gcloud
if (-not $gcloud) {
  Write-Host 'ERROR: gcloud not found. Install Google Cloud SDK from https://cloud.google.com/sdk/docs/install'
  exit 1
}

Write-Log ('Using gcloud: ' + $gcloud)
Write-Log ('Logging to: ' + $LogFile)
Set-Location $ScannerRoot

try {
  Write-Log ('Setting project ' + $ProjectId + ' ...')
  $code = Invoke-GCloudCmd -GcloudPath $gcloud -ArgLine ('config set project ' + $ProjectId) -WorkingDir $ScannerRoot
  Write-Log ('gcloud config set exited: ' + $code)
  if ($code -ne 0) {
    Write-Log 'gcloud config set failed.'
    exit $code
  }

  Write-Log 'Starting Cloud Build (5-20 min, output below) ...'
  Write-Log '(Full build log also in Cloud Console.)'
  $exitCode = Invoke-GCloudCmd -GcloudPath $gcloud -ArgLine 'builds submit --config cloudbuild.yaml' -WorkingDir $ScannerRoot
  Write-Log ('gcloud builds submit exited: ' + $exitCode)

  if ($exitCode -ne 0) {
    Write-Log ('BUILD FAILED (exit ' + $exitCode + '). Open Cloud Build logs in console.')
    Write-Host ('https://console.cloud.google.com/cloud-build/builds?project=' + $ProjectId)
    exit $exitCode
  }

  Write-Log 'BUILD OK.'
  $url = (& $gcloud run services describe bilsnapper-scanner --region=us-west1 --platform=managed --format=value(status.url) 2>$null)
  if (-not $url) { $url = '(could not read URL; check Cloud Run console)' }
  Write-Log ('Cloud Run URL: ' + $url)
  Write-Host ''
  Write-Host ('Done. Cloud Build console: https://console.cloud.google.com/cloud-build/builds?project=' + $ProjectId)
  Write-Host 'Next (once): run setup-scheduler.bat for Cloud Scheduler.'
}
catch {
  $err = $_.Exception.Message
  Write-Log ('Exception: ' + $err)
  throw
}
