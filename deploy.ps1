# Deploy bilsnapper-scanner til Cloud Run (bygg + deploy via cloudbuild.yaml)
# Kjør: høyreklikk -> "Run with PowerShell", eller: deploy.cmd

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

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

$gcloud = Find-Gcloud
if (-not $gcloud) {
  Write-Host "FEIL: Fant ikke gcloud. Installer Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
  exit 1
}

Write-Log "Bruker gcloud: $gcloud"
Write-Log "Logger til: $LogFile"
Set-Location $ScannerRoot

try {
  Write-Log "Setter prosjekt $ProjectId ..."
  & $gcloud config set project $ProjectId 2>&1 | Tee-Object -FilePath $LogFile -Append

  Write-Log "Starter Cloud Build (5-20 min) ..."
  & $gcloud builds submit --config cloudbuild.yaml 2>&1 | Tee-Object -FilePath $LogFile -Append

  if ($LASTEXITCODE -ne 0) {
    Write-Log "BYGG FEILET (exit $LASTEXITCODE). Siste linjer:"
    Get-Content $LogFile -Tail 40 | ForEach-Object { Write-Host $_ }
    exit $LASTEXITCODE
  }

  Write-Log "BYGG OK."
  $url = & $gcloud run services describe bilsnapper-scanner --region=us-west1 --platform=managed --format=value(status.url) 2>&1
  Write-Log "Cloud Run URL: $url"
  Write-Host ""
  Write-Host "Ferdig. Åpne Cloud Build ved feil: https://console.cloud.google.com/cloud-build/builds?project=$ProjectId"
  Write-Host "Neste steg (kun første gang): dobbeltklikk setup-scheduler.bat for Cloud Scheduler."
} catch {
  Write-Log "Exception: $_"
  throw
}
