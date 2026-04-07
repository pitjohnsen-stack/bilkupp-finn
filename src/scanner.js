'use strict';
const config = require('../config/config');
const { fetchCarsInRegion, fetchAllCarsInRegion, enrichAds, closeBrowser } = require('./scraper');
const { buildPricingModel }        = require('./pricer');
const { findUnderpricedCars, deduplicateDeals } = require('./analyzer');
const { findTransportDeals }       = require('./transport');
const { filterExcludedListings }   = require('./listing-filters');
const firebaseDb                   = require('./firebase-db');

/** Kjør async oppgaver med begrenset parallellisme (unngår å åpne 18 faner samtidig). */
async function runPool(items, concurrency, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(chunk.map(worker))));
  }
  return results;
}

async function runScanAndSave(onProgress = null) {
  console.log(`[${new Date().toLocaleString('nb-NO')}] Starter scan...`);

  const primaryRegions = config.regions.primary;
  const extraRegions   = config.regions.extra;
  const allRegions     = config.regions.all();
  const regionConc     = config.scan.regionConcurrency;
  const pricePages     = config.scan.priceFetchMaxPages;

  // Steg 1a: Hent prisdata fra alle regioner (uten prisbegrensning) — flere regioner i parallell
  console.log(`  Henter prisdata (${allRegions.length} regioner, opptil ${regionConc} samtidig, ${pricePages} sider/region)...`);
  const priceDataMap = new Map();
  let doneRegions = 0;
  await runPool(allRegions, regionConc, async (region) => {
    const locationId = config.regions.getLocationId(region);
    try {
      const ads = await fetchAllCarsInRegion(locationId, pricePages);
      for (const ad of ads) {
        if (ad.id && !priceDataMap.has(ad.id)) priceDataMap.set(ad.id, ad);
      }
    } catch (err) {
      console.error(`  Feil prisdata ${region}: ${err.message}`);
    } finally {
      doneRegions += 1;
      process.stdout.write(`\r  [prisdata] region ${doneRegions}/${allRegions.length} | ${priceDataMap.size} unike annonser`);
    }
  });
  console.log(`\n  Prisdata: ${priceDataMap.size} unike annonser`);

  // Oppdater price-db i Firestore
  console.log('  Oppdaterer prisdatabase...');
  await firebaseDb.updateFromScan([...priceDataMap.values()]);

  // Steg 1b: Hent deal-kandidater (billige biler) per region — parallell som prisdata
  const localAds    = [];
  const adsByRegion = new Map();
  let dealDone = 0;

  const dealResults = await runPool(allRegions, regionConc, async (region) => {
    const locationId = config.regions.getLocationId(region);
    try {
      const ads = await fetchCarsInRegion(locationId, config.search.maxPrice);
      return { region, ads, err: null };
    } catch (err) {
      console.error(`  Feil deal ${region}: ${err.message}`);
      return { region, ads: [], err: err.message };
    } finally {
      dealDone += 1;
      process.stdout.write(`\r  [deals] region ${dealDone}/${allRegions.length} ferdig`);
    }
  });

  console.log('');
  for (const { region, ads } of dealResults) {
    adsByRegion.set(region, ads);
    if (primaryRegions.includes(region) || extraRegions.includes(region)) {
      localAds.push(...ads);
    }
  }

  // Steg 2: Berik deal-kandidater med detaljdata
  const allCollected = [...adsByRegion.values()].flat();
  const uniqueMap    = new Map();
  for (const ad of allCollected) {
    if (ad.id && !uniqueMap.has(ad.id)) uniqueMap.set(ad.id, ad);
  }
  const uniqueAds = [...uniqueMap.values()];
  console.log(`  ${uniqueAds.length} kandidater under ${config.search.maxPrice.toLocaleString('nb')} kr`);

  const enrichedAds        = await enrichAds(uniqueAds, undefined, onProgress);
  const enrichedFiltered   = filterExcludedListings(enrichedAds);
  const excludedCount      = enrichedAds.length - enrichedFiltered.length;
  if (excludedCount > 0) console.log(`  Filtrert bort ${excludedCount} annonser (auksjon/ekskludert)`);

  const enrichedMap = new Map();
  for (const ad of enrichedFiltered) enrichedMap.set(ad.id, ad);

  for (const [region, ads] of adsByRegion) {
    adsByRegion.set(region, ads.map(ad => enrichedMap.get(ad.id)).filter(Boolean));
  }
  const enrichedLocalAds = localAds.map(ad => enrichedMap.get(ad.id)).filter(Boolean);

  // Steg 3: Bygg prismodell
  const pricingAds   = firebaseDb.getPricingAds();
  console.log(`  [pricer] Bruker ${pricingAds.length} annonser fra price-db`);
  const pricingModel = buildPricingModel(pricingAds);

  // Beregn fairPrice for alle annonser
  const allEnriched      = [...adsByRegion.values()].flat();
  const allWithFairPrice = allEnriched.map(ad => {
    const est = pricingModel.estimate(ad);
    return { ...ad, fairPrice: est?.fairPrice || null, confidence: est?.confidence || null, sampleSize: est?.sampleSize || null };
  });

  // Steg 4: Finn deals
  const localDeals     = findUnderpricedCars(enrichedLocalAds, pricingModel);
  const nordlandAds    = adsByRegion.get('nordland') || [];
  const transportDeals = findTransportDeals(adsByRegion, nordlandAds, pricingModel);
  const { localDeals: finalLocal, transportDeals: finalTransport } = deduplicateDeals(localDeals, transportDeals);

  // Legg til fairPrice på deals
  for (const d of [...finalLocal, ...finalTransport]) {
    if (!d.fairPrice) {
      const est = pricingModel.estimate(d);
      d.fairPrice = est?.fairPrice || null;
    }
  }

  await closeBrowser();

  // Steg 5: Lagre til Firestore
  const scanTime = new Date().toISOString();
  const result   = {
    scanTime,
    stats: {
      totalAds:           uniqueAds.length,
      enrichedAds:        enrichedFiltered.filter(a => a._enriched).length,
      excludedListings:   excludedCount,
      localDealsCount:    finalLocal.length,
      transportDealsCount: finalTransport.length,
      priceDb:            firebaseDb.getPriceDbStats(),
    },
    localDeals:     finalLocal,
    transportDeals: finalTransport,
    allAds:         allWithFairPrice,
  };

  await firebaseDb.writeLatestScan(result);
  console.log(`✓ Scan ferdig: ${finalLocal.length + finalTransport.length} deals. Lagret til Firestore.`);
  return result;
}

module.exports = { runScanAndSave };
