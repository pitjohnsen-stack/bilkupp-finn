'use strict';
const config = require('../config/config');

function calcTransportDeal(ad, sourceRegion, fairPriceNordland) {
  if (!ad.price || !fairPriceNordland) return { isDeal: false };
  const transportCost = config.transport.costs[sourceRegion] ?? 13000;
  const netCost       = ad.price + transportCost;
  const saving        = fairPriceNordland - netCost;
  return {
    isDeal:        saving >= config.transport.minSaving,
    netCost:       Math.round(netCost),
    saving:        Math.round(saving),
    transportCost,
    sourceRegion,
  };
}

function getNordlandReferencePrice(ad, nordlandAds, pricingModel) {
  const similar = nordlandAds.filter(n =>
    n.make?.toLowerCase()  === ad.make?.toLowerCase() &&
    n.model?.toLowerCase() === ad.model?.toLowerCase() &&
    Math.abs((n.year || 0) - (ad.year || 0)) <= 3 &&
    n.price > 0
  );
  if (similar.length > 0) {
    const prices = similar.map(s => s.price).sort((a, b) => a - b);
    return prices[Math.floor(prices.length / 2)];
  }
  return pricingModel.estimate(ad)?.fairPrice ?? null;
}

function findTransportDeals(adsByRegion, nordlandAds, pricingModel) {
  if (!config.transport.enabled) return [];
  const deals = [];
  for (const region of config.transport.sourceRegions) {
    for (const ad of (adsByRegion.get(region) || [])) {
      if (!ad.price || ad.price < 5000) continue;
      const nordlandRef = getNordlandReferencePrice(ad, nordlandAds, pricingModel);
      if (!nordlandRef) continue;
      const result = calcTransportDeal(ad, region, nordlandRef);
      if (result.isDeal) {
        deals.push({ ...ad, transport: result, nordlandRefPrice: nordlandRef, dealType: 'transport' });
      }
    }
  }
  deals.sort((a, b) => b.transport.saving - a.transport.saving);
  return deals;
}

module.exports = { findTransportDeals };
