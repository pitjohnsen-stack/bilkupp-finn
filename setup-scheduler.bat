@echo off
setlocal EnableDelayedExpansion

set GCLOUD=C:\Users\Pitjo\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd
set PROJECT=ferrous-layout-382117
set REGION=europe-north1
set SCHEDULER_REGION=europe-west1

echo.
echo === Henter Cloud Run URL ===
"%GCLOUD%" run services describe bilsnapper-scanner --region=%REGION% --project=%PROJECT% --format=value(status.url) > %TEMP%\cr_url.txt
set /p SERVICE_URL=<%TEMP%\cr_url.txt
echo URL: %SERVICE_URL%

echo.
echo === Henter prosjektnummer ===
"%GCLOUD%" projects describe %PROJECT% --format=value(projectNumber) > %TEMP%\cr_proj.txt
set /p PROJECT_NUMBER=<%TEMP%\cr_proj.txt
set SA=%PROJECT_NUMBER%-compute@developer.gserviceaccount.com
echo Service Account: %SA%

echo.
echo === Gir service account tilgang til Firestore ===
"%GCLOUD%" projects add-iam-policy-binding %PROJECT% --member=serviceAccount:%SA% --role=roles/datastore.user

echo.
echo === Oppretter Cloud Scheduler jobb ===
"%GCLOUD%" scheduler jobs create http bilsnapper-scan-job --location=%SCHEDULER_REGION% --schedule="0 */6 * * *" --uri=%SERVICE_URL%/scan --http-method=POST --oidc-service-account-email=%SA% --oidc-token-audience=%SERVICE_URL% --time-zone="Europe/Oslo" --project=%PROJECT%

echo.
echo === Kjorer test-scan ===
"%GCLOUD%" scheduler jobs run bilsnapper-scan-job --location=%SCHEDULER_REGION% --project=%PROJECT%

echo.
echo FERDIG! Scanneren kjorer na automatisk hvert 6. time.
echo.
pause
