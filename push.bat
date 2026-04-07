@echo off
cd /d "C:\Users\Pitjo\OneDrive\Documents\Apps\bilsnapper-scanner"

git config --global user.email "pit.johnsen@gmail.com"
git config --global user.name "Pitjo"

git add .
git commit -m "feat: Cloud Run scanner med Puppeteer + Firebase"
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/pitjohnsen-stack/bilkupp-finn.git
git push -u origin main --force

echo.
echo Ferdig!
