'use strict';
const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore }                                       = require('firebase-admin/firestore');

const FIRESTORE_DB_ID = process.env.FIRESTORE_DATABASE_ID || '(default)';
const PROJECT_ID      = process.env.GOOGLE_CLOUD_PROJECT  || process.env.GCLOUD_PROJECT;

// Initialiser Firebase Admin én gang
function getApp() {
  if (getApps().length) return getApps()[0];
  const options = PROJECT_ID ? { projectId: PROJECT_ID } : {};
  // I Cloud Run brukes Application Default Credentials automatisk
  // Lokalt: sett GOOGLE_APPLICATION_CREDENTIALS til path til service account JSON
  return initializeApp(options);
}

function getDb() {
  return getFirestore(getApp(), FIRESTORE_DB_ID);
}

// ── Price DB (erstatter price-db.json) ───────────────────────────────────────
// Holder pris-historikk i minne per scanner-kjøring + lagrer til Firestore

let memoryDb = null; // { ads: { [id]: {...} }, lastUpdated: string }

const SOLD_AFTER_DAYS    = parseInt(process.env.PRICE_DB_SOLD_DAYS  || '7',   10);
const KEEP_SOLD_DAYS     = parseInt(process.env.PRICE_DB_KEEP_DAYS  || '180', 10);
const PRICE_HISTORY_MAX  = parseInt(process.env.PRICE_HISTORY_MAX   || '50',  10);

/**
 * Laster price-db fra Firestore (kjøres én gang ved oppstart av scan)
 */
async function loadPriceDb() {
  if (memoryDb) return memoryDb;
  console.log('  [firebase-db] Laster price-db fra Firestore...');
  const db      = getDb();
  const snap    = await db.collection('price_db').get();
  const ads     = {};
  snap.forEach(doc => { ads[doc.id] = doc.data(); });
  memoryDb = { ads, lastUpdated: new Date().toISOString() };
  console.log(`  [firebase-db] ${Object.keys(ads).length} annonser lastet fra price_db`);
  return memoryDb;
}

/**
 * Lagrer oppdatert price-db til Firestore (batch-skriving)
 */
async function savePriceDb(changedIds) {
  if (!memoryDb || changedIds.size === 0) return;
  const db    = getDb();
  const ids   = [...changedIds];
  const BATCH_SIZE = 499;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      const entry = memoryDb.ads[id];
      if (entry) {
        batch.set(db.collection('price_db').doc(String(id)), entry, { merge: true });
      } else {
        batch.delete(db.collection('price_db').doc(String(id)));
      }
    }
    await batch.commit();
  }
}

/**
 * Oppdaterer price-db med nye scan-resultater (samme logikk som original price-db.js)
 */
async function updateFromScan(scannedAds) {
  const db_mem   = await loadPriceDb();
  const now      = new Date();
  const nowIso   = now.toISOString();
  const changedIds = new Set();
  const scannedIds = new Set(scannedAds.map(a => a.id).filter(Boolean));

  let added = 0, updated = 0, markedSold = 0, pruned = 0;

  // 1. Legg til / oppdater scannede annonser
  for (const ad of scannedAds) {
    if (!ad.id || !ad.price || ad.price <= 0) continue;
    const existing = db_mem.ads[ad.id];
    if (!existing) {
      db_mem.ads[ad.id] = {
        id: ad.id, make: ad.make || null, model: ad.model || null,
        year: ad.year || null, km: ad.km || null, price: ad.price,
        fuel: ad.fuel || null, firstSeen: nowIso, lastSeen: nowIso,
        sold: false, soldDate: null, priceHistory: [],
      };
      changedIds.add(ad.id);
      added++;
    } else if (!existing.sold) {
      if (existing.price != null && ad.price !== existing.price) {
        if (!Array.isArray(existing.priceHistory)) existing.priceHistory = [];
        existing.priceHistory.push({ at: nowIso, price: existing.price });
        while (existing.priceHistory.length > PRICE_HISTORY_MAX) existing.priceHistory.shift();
      }
      existing.lastSeen = nowIso;
      existing.price    = ad.price;
      existing.km       = ad.km    || existing.km;
      existing.year     = ad.year  || existing.year;
      existing.make     = ad.make  || existing.make;
      existing.model    = ad.model || existing.model;
      existing.fuel     = ad.fuel  || existing.fuel;
      changedIds.add(ad.id);
      updated++;
    }
  }

  // 2. Marker ikke-sette annonser som solgt
  const soldCutoff = new Date(now - SOLD_AFTER_DAYS * 86400000);
  for (const entry of Object.values(db_mem.ads)) {
    if (entry.sold || scannedIds.has(entry.id)) continue;
    if (new Date(entry.lastSeen) < soldCutoff) {
      entry.sold = true; entry.soldDate = nowIso;
      changedIds.add(entry.id);
      markedSold++;
    }
  }

  // 3. Slett solgte annonser eldre enn KEEP_SOLD_DAYS
  const pruneCutoff = new Date(now - KEEP_SOLD_DAYS * 86400000);
  for (const [id, entry] of Object.entries(db_mem.ads)) {
    if (!entry.sold) continue;
    if (new Date(entry.soldDate || entry.lastSeen) < pruneCutoff) {
      delete db_mem.ads[id];
      changedIds.add(id); // markert for sletting i Firestore
      pruned++;
    }
  }

  await savePriceDb(changedIds);

  const active = Object.values(db_mem.ads).filter(e => !e.sold).length;
  const total  = Object.keys(db_mem.ads).length;
  console.log(
    `  [price-db] +${added} nye, ${updated} oppdatert, ${markedSold} solgt, ${pruned} slettet` +
    ` | ${active} aktive / ${total} totalt`
  );
  return { added, updated, markedSold, pruned };
}

function getPricingAds() {
  if (!memoryDb) return [];
  return Object.values(memoryDb.ads).filter(e => e.price > 0 && e.make && e.year);
}

function getPriceDbStats() {
  if (!memoryDb) return { total: 0, active: 0, sold: 0 };
  const all    = Object.values(memoryDb.ads);
  const active = all.filter(e => !e.sold).length;
  return { total: all.length, active, sold: all.length - active, lastUpdated: memoryDb.lastUpdated };
}

// ── Scan store (erstatter scan-store.js og skriver til frontend-collections) ──

/**
 * Lagrer scan-resultat til Firestore:
 *  - scans/latest           → full resultat (for intern bruk)
 *  - cars/{id}              → alle biler (leses av bilsnapper-frontend)
 *  - deals/latest           → lokale deals + transport-deals
 *  - market_statistics/{key}→ prisstatistikk per modell
 */
async function writeLatestScan(scanResult) {
  const db  = getDb();

  // 1. Lagre full scan-snapshot
  await db.collection('scans').doc('latest').set({
    scanTime:       scanResult.scanTime,
    stats:          scanResult.stats,
    localDeals:     scanResult.localDeals,
    transportDeals: scanResult.transportDeals,
    updatedAt:      new Date().toISOString(),
  });

  // 2. Skriv alle biler til `cars` collection (bilsnapper frontend-format)
  const allAds   = scanResult.allAds || [];
  const BATCH_SZ = 499;
  for (let i = 0; i < allAds.length; i += BATCH_SZ) {
    const batch = db.batch();
    for (const ad of allAds.slice(i, i + BATCH_SZ)) {
      if (!ad.id) continue;
      batch.set(db.collection('cars').doc(String(ad.id)), {
        finnId:       ad.id,
        brand:        ad.make        || 'Ukjent',
        model:        ad.model       || 'Ukjent',
        year:         ad.year        || null,
        price:        ad.price       || null,
        mileage:      ad.km          || null,
        fuel:         ad.fuel        || null,
        gearbox:      ad.transmission || null,
        location:     ad.location    || null,
        sellerName:   ad.sellerName  || null,
        isAuction:    ad.isAuction   || false,
        fairPrice:    ad.fairPrice   || null,
        confidence:   ad.confidence  || null,
        status:       'active',
        lastSeen:     new Date().toISOString(),
        url:          ad.url         || null,
      }, { merge: true });
    }
    await batch.commit();
  }
  console.log(`  [firebase-db] ${allAds.length} biler skrevet til 'cars'`);

  // 3. Lagre deals
  await db.collection('deals').doc('latest').set({
    localDeals:     scanResult.localDeals     || [],
    transportDeals: scanResult.transportDeals || [],
    scanTime:       scanResult.scanTime,
  });

  // 4. Beregn og lagre markedsstatistikk per merke/modell/år
  await writeMarketStats(db, allAds);

  console.log(`  [firebase-db] Scan lagret til Firestore`);
}

async function writeMarketStats(db, allAds) {
  const groups = {};
  for (const ad of allAds) {
    if (!ad.price || !ad.make || !ad.model || !ad.year) continue;
    const key = `${ad.make}_${ad.model}_${ad.year}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!groups[key]) groups[key] = { make: ad.make, model: ad.model, year: ad.year, prices: [] };
    groups[key].prices.push(ad.price);
  }

  const entries = Object.entries(groups);
  const BATCH_SZ = 499;
  for (let i = 0; i < entries.length; i += BATCH_SZ) {
    const batch = db.batch();
    for (const [key, g] of entries.slice(i, i + BATCH_SZ)) {
      const sorted = g.prices.sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const avg    = sorted.reduce((s, p) => s + p, 0) / sorted.length;
      batch.set(db.collection('market_statistics').doc(key), {
        brand:        g.make,
        model:        g.model,
        year:         g.year,
        medianPrice:  Math.round(median),
        avgPrice:     Math.round(avg),
        sampleSize:   sorted.length,
        calculatedAt: new Date().toISOString(),
      }, { merge: true });
    }
    await batch.commit();
  }
  console.log(`  [firebase-db] ${entries.length} modeller skrevet til 'market_statistics'`);
}

async function readLatestScan() {
  try {
    const snap = await getDb().collection('scans').doc('latest').get();
    return snap.exists ? snap.data() : null;
  } catch (err) {
    console.error('readLatestScan:', err.message);
    return null;
  }
}

// Tilbakestill memory-cache mellom scan-kjøringer (ikke nødvendig for Cloud Run, men nyttig lokalt)
function resetMemoryCache() {
  memoryDb = null;
}

module.exports = {
  updateFromScan,
  getPricingAds,
  getPriceDbStats,
  writeLatestScan,
  readLatestScan,
  resetMemoryCache,
};
