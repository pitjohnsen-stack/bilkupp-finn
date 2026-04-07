# Deploy til Google Cloud Run

## Forutsetninger
- Google Cloud CLI installert (`gcloud`)
- Innlogget: `gcloud auth login`
- Prosjekt: `ferrous-layout-382117`

---

## 1. Første gangs oppsett

```bash
# Sett prosjekt
gcloud config set project ferrous-layout-382117

# Aktiver nødvendige tjenester
gcloud services enable run.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com

# Gi Cloud Run service account tilgang til Firestore
gcloud projects add-iam-policy-binding ferrous-layout-382117 \
  --member="serviceAccount:$(gcloud projects describe ferrous-layout-382117 --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user"
```

---

## 2. Deploy (manuelt fra denne mappen)

```bash
cd "C:\Users\Pitjo\OneDrive\Documents\Apps\bilsnapper-scanner"
gcloud builds submit --config cloudbuild.yaml
```

Det tar ~5 minutter første gang (bygger Chromium-image).

---

## 3. Sett opp Cloud Scheduler (kjøres én gang)

```bash
# Hent URL til Cloud Run-tjenesten
SERVICE_URL=$(gcloud run services describe bilsnapper-scanner \
  --region=europe-north1 --format='value(status.url)')

# Opprett Scheduler-jobb: kjør scan hvert 6. time
gcloud scheduler jobs create http bilsnapper-scan-job \
  --location=europe-west1 \
  --schedule="0 */6 * * *" \
  --uri="${SERVICE_URL}/scan" \
  --http-method=POST \
  --oidc-service-account-email="$(gcloud projects describe ferrous-layout-382117 --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --oidc-token-audience="${SERVICE_URL}" \
  --time-zone="Europe/Oslo"
```

---

## 4. Test manuelt

```bash
# Trigger scan med én gang
gcloud scheduler jobs run bilsnapper-scan-job --location=europe-west1

# Sjekk logger
gcloud run services logs read bilsnapper-scanner --region=europe-north1 --limit=50
```

---

## 5. Lokalt (Windows)

```bash
cp .env.example .env
# Rediger .env: fyll inn GOOGLE_APPLICATION_CREDENTIALS

npm install
node server.js
# Deretter: POST http://localhost:8080/scan
```

---

## Kostnad (estimat)

| Tjeneste | Bruk | Kostnad |
|---|---|---|
| Cloud Run | 4 scan/dag × 20 min | ~$0.50/mnd |
| Cloud Scheduler | 1 jobb | Gratis |
| Firestore | ~50k reads/writes per dag | ~$2/mnd |
| **Total** | | **~$2-3/mnd** |
