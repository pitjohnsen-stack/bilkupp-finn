'use strict';

const DEPRECIATION_PER_YEAR  = 0.08;
const KM_PENALTY_PER_10K     = 0.015;

function groupByModel(ads) {
  const groups = {};
  for (const ad of ads) {
    if (!ad.price || ad.price <= 0) continue;
    const key = normalizeKey(ad.make, ad.model);
    if (!groups[key]) groups[key] = [];
    groups[key].push(ad);
  }
  return groups;
}

function normalizeKey(make, model) {
  return `${(make || '').toLowerCase().trim()}|${(model || '').toLowerCase().trim()}`;
}

function estimateFairPrice(ad, groups) {
  const key   = normalizeKey(ad.make, ad.model);
  const peers = groups[key];

  if (!peers || peers.length < 3) return estimateByMakeOnly(ad, groups);

  const currentYear = new Date().getFullYear();
  const adYear = ad.year || currentYear - 5;
  const adKm   = ad.km   || 100000;

  const normalizedPrices = peers
    .filter(p => p.price > 0 && p.year && p.km !== null)
    .map(p => {
      const yearDiff = currentYear - p.year;
      const kmBase   = p.km / 10000;
      return p.price / Math.pow(1 - DEPRECIATION_PER_YEAR, yearDiff) / (1 - kmBase * KM_PENALTY_PER_10K);
    });

  if (normalizedPrices.length < 3) return null;

  normalizedPrices.sort((a, b) => a - b);
  const p10      = normalizedPrices[Math.floor(normalizedPrices.length * 0.1)];
  const p90      = normalizedPrices[Math.floor(normalizedPrices.length * 0.9)];
  const filtered = normalizedPrices.filter(p => p >= p10 && p <= p90);

  const baseMedian = median(filtered);
  const yearDiff   = currentYear - adYear;
  const kmBase     = adKm / 10000;
  const fairPrice  = baseMedian
    * Math.pow(1 - DEPRECIATION_PER_YEAR, yearDiff)
    * (1 - kmBase * KM_PENALTY_PER_10K);

  return {
    fairPrice:  Math.round(Math.max(fairPrice, 1000)),
    sampleSize: peers.length,
    confidence: peers.length >= 10 ? 'høy' : peers.length >= 5 ? 'medium' : 'lav',
  };
}

function estimateByMakeOnly(ad, groups) {
  const makeLower = (ad.make || '').toLowerCase().trim();
  const makeAds   = Object.entries(groups)
    .filter(([key]) => key.startsWith(makeLower + '|'))
    .flatMap(([, ads]) => ads)
    .filter(p => p.price > 0);

  if (makeAds.length < 3) return null;

  const prices = makeAds.map(p => p.price).sort((a, b) => a - b);
  return {
    fairPrice:  Math.round(median(prices)),
    sampleSize: makeAds.length,
    confidence: 'lav (kun merke)',
  };
}

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildPricingModel(allAds) {
  const groups     = groupByModel(allAds);
  const modelCount = Object.keys(groups).length;
  const totalAds   = allAds.filter(a => a.price > 0).length;
  console.log(`  [pricer] Prismodell: ${modelCount} unike modeller, ${totalAds} annonser`);
  return {
    groups,
    estimate: (ad) => estimateFairPrice(ad, groups),
  };
}

module.exports = { buildPricingModel };
