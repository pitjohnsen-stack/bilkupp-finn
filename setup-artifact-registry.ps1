# One-time: enable Artifact Registry + docker repo + Cloud Build push permission.
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File .\setup-artifact-registry.ps1

$ErrorActionPreference = 'Continue'
$ProjectId = 'ferrous-layout-382117'
$Region    = 'us-west1'
$Repo      = 'bilsnapper'

$gcloud = $null
foreach ($p in @(
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
)) { if (Test-Path $p) { $gcloud = $p; break } }
if (-not $gcloud) { $gcloud = 'gcloud' }

function G([string]$ArgsLine) {
  & cmd.exe /c "`"$gcloud`" $ArgsLine"
  return [int]$LASTEXITCODE
}

Write-Host "Project: $ProjectId"
G "config set project $ProjectId" | Out-Null
G "services enable artifactregistry.googleapis.com" | Out-Null

if ((G "artifacts repositories describe $Repo --location=$Region") -ne 0) {
  Write-Host "Creating repository $Repo in $Region ..."
  G "artifacts repositories create $Repo --repository-format=docker --location=$Region --description=bilsnapper-scanner"
} else {
  Write-Host "Repository $Repo already exists."
}

$num = (& cmd.exe /c "`"$gcloud`" projects describe $ProjectId --format=value(projectNumber)").Trim()
$cb = "$num@cloudbuild.gserviceaccount.com"
Write-Host "Granting roles/artifactregistry.writer to $cb (safe to run more than once)"
G "projects add-iam-policy-binding $ProjectId --member=serviceAccount:$cb --role=roles/artifactregistry.writer"
Write-Host "Done. Run deploy.cmd or: gcloud builds submit --config cloudbuild.yaml"
