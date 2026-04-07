'use strict';
const config = require('../config/config');
const { fetchCarsInRegion, fetchAllCarsInRegion, enrichAds, closeBrowser } = require('./scraper');
const { buildPricingModel }        = require('./pricer');
const { findUnderpricedCars, deduplicateDeals } = require('./analyzer');
const { findTransportDeals }       = require('./transport');
const { filterExcludedListings }   = require('./listing-filters');
const firebaseDb                   = require('./firebase-db');

async function runScanAndSave(onProgress = null) {
  console.log(`[${new Date().toLocaleString('nb-NO')}] Starter scan...`);

  const primaryRegions = config.regions.primary;
  const extraRegions   = config.regions.extra;
  const allRegions     = config.regions.all();

  // Steg 1a: Hent prisdata fra alle regioner (uten prisbegrensning)
  console.log('  Henter prisdata (alle regioner)...');
  const priceDataMap = new Map();
  for (const region of allRegions) {
    const locationId = config.regions.getLocationId(region);
    try {
      const ads = await fetchAllCarsInRegion(locationId, 25);
      for (const ad of ads) {
        if (ad.id && !priceDataMap.has(ad.id)) priceDataMap.set(ad.id, ad);
      }
      process.stdout.write(`\r  [prisdata] ${priceDataMap.size} annonser samlet...`);
    } catch (err) {
      console.error(`  Feil prisdata ${region}: ${err.message}`);
    }
  }
  console.log(`\n  Prisdata: ${priceDataMap.size} unike annonser`);

  // Oppdater price-db i Firestore
  console.log('  Oppdaterer prisdatabase...');
  await firebaseDb.updateFromScan([...priceDataMap.values()]);

  // Steg 1b: Hent deal-kandidater (billige biler) per region
  const localAds    = [];
  const adsByRegion = new Map();

  for (const region of allRegions) {
    const locationId = config.regions.getLocationId(region);
    console.log(`  Henter deal-kandidater ${region}...`);
    try {
      const ads = await fetchCarsInRegion(locationId, config.search.maxPrice);
      adsByRegion.set(region, ads);
      if (primaryRegions.includes(region) || extraRegions.includes(region)) {
        localAds.push(...ads);
      }
    } catch (err) {
      console.error(`  Feil ${region}: ${err.message}`);
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
