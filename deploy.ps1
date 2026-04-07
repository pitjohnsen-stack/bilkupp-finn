# Deploy bilsnapper-scanner to Cloud Run (cloudbuild.yaml)
# Run: deploy.cmd or powershell -File deploy.ps1

$ErrorActionPreference = 'Stop'
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
  & $gcloud config set project $ProjectId 2>&1 | Tee-Object -FilePath $LogFile -Append

  Write-Log 'Starting Cloud Build (5-20 min, output below) ...'
  $transcript = Join-Path $ScannerRoot ('transcript-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
  Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
  Start-Transcript -Path $transcript -Force | Out-Null
  try {
    & $gcloud builds submit --config cloudbuild.yaml
    $exitCode = $LASTEXITCODE
  } finally {
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
  }
  $raw = Get-Content -Path $transcript -Raw -ErrorAction SilentlyContinue
  if ($raw) {
    Add-Content -Path $LogFile -Value $raw -Encoding UTF8
  }
  if ($exitCode -ne 0) {
    Write-Log ('BUILD FAILED (exit ' + $exitCode + '). Last lines:')
    Get-Content $LogFile -Tail 40 | ForEach-Object { Write-Host $_ }
    exit $exitCode
  }

  Write-Log 'BUILD OK.'
  $url = & $gcloud run services describe bilsnapper-scanner --region=us-west1 --platform=managed --format=value(status.url) 2>&1
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
