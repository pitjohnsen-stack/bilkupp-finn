@echo off
set G="C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
set PROJECT=ferrous-layout-382117

cd /d "C:\Users\Pitjo\OneDrive\Documents\Apps\bilsnapper-scanner"

echo === Starter Cloud Build ===
%G% builds submit --config=cloudbuild.yaml --project=%PROJECT% . > "%USERPROFILE%\build_out.txt" 2>&1

echo Ferdig. Se resultatet i %USERPROFILE%\build_out.txt
pause
