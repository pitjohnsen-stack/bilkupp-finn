'use strict';
require('dotenv').config();

const express    = require('express');
const cron       = require('node-cron');
const config     = require('./config/config');
const { runScanAndSave } = require('./src/scanner');

const app  = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

app.use(express.json());

let scanRunning  = false;
let lastScanTime = null;
let lastScanStats = null;

// ── Health check (Cloud Run krever at / eller /health svarer 200) ─────────────
app.get('/health', (req, res) => {
  res.json({
    status:       'ok',
    scanRunning,
    lastScanTime,
    lastScanStats,
  });
});

app.get('/', (req, res) => res.json({ service: 'bilsnapper-scanner', status: 'ok' }));

// ── Scan-endepunkt (kalles av Cloud Scheduler) ────────────────────────────────
app.post('/scan', async (req, res) => {
  // Valider at kallet kommer fra Cloud Scheduler (valgfri ekstra sikkerhet)
  const secret = process.env.SCAN_SECRET;
  if (secret && req.headers['x-scan-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (scanRunning) {
    return res.status(409).json({ error: 'Scan kjører allerede' });
  }

  // Svar umiddelbart (Cloud Scheduler forventer rask respons)
  res.json({ status: 'scan startet', time: new Date().toISOString() });

  // Kjør scan i bakgrunnen
  scanRunning = true;
  try {
    const result  = await runScanAndSave();
    lastScanTime  = result.scanTime;
    lastScanStats = result.stats;
    console.log(`✓ Bakgrunns-scan fullført: ${JSON.stringify(result.stats)}`);
  } catch (err) {
    console.error('Scan feilet:', err);
  } finally {
    scanRunning = false;
  }
});

// ── Lokal cron-jobb (backup hvis Cloud Scheduler ikke er satt opp ennå) ───────
if (process.env.LOCAL_CRON !== 'false') {
  cron.schedule(config.schedule, async () => {
    if (scanRunning) {
      console.log('Cron: Scan hoppes over — forrige kjøring pågår fortsatt');
      return;
    }
    scanRunning = true;
    try {
      const result  = await runScanAndSave();
      lastScanTime  = result.scanTime;
      lastScanStats = result.stats;
    } catch (err) {
      console.error('Cron scan feilet:', err);
    } finally {
      scanRunning = false;
    }
  });
  console.log(`Lokal cron aktiv: ${config.schedule}`);
}

app.listen(PORT, () => {
  console.log(`bilsnapper-scanner kjører på port ${PORT}`);
  console.log(`Firestore DB: ${process.env.FIRESTORE_DATABASE_ID || '(default)'}`);
  console.log(`Google Cloud Project: ${process.env.GOOGLE_CLOUD_PROJECT || 'ikke satt'}`);
});
