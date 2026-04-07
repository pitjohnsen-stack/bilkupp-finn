'use strict';
const config = require('../config/config');

function analyzeAd(ad, pricingModel) {
  if (!ad.price || ad.price <= 0)  return null;
  if (!ad.year && !ad.km)          return null;
  if (ad.price < 5000)             return null;

  const estimate = pricingModel.estimate(ad);
  if (!estimate || !estimate.fairPrice) return null;

  const { fairPrice, sampleSize, confidence } = estimate;
  const discount  = (fairPrice - ad.price) / fairPrice;
  const savingNOK = fairPrice - ad.price;

  if (discount >= config.search.underpricedThreshold && savingNOK >= config.search.minSaving) {
    return {
      ...ad,
      dealType:  'underpriced',
      fairPrice,
      discount:  Math.round(discount * 100),
      savingNOK: Math.round(savingNOK),
      sampleSize,
      confidence,
    };
  }
  return null;
}

function findUnderpricedCars(ads, pricingModel) {
  const deals = ads.map(ad => analyzeAd(ad, pricingModel)).filter(Boolean);
  deals.sort((a, b) => b.discount - a.discount);
  return deals;
}

function deduplicateDeals(localDeals, transportDeals) {
  const localIds       = new Set(localDeals.map(d => d.id));
  const uniqueTransport = transportDeals.filter(d => !localIds.has(d.id));
  return { localDeals, transportDeals: uniqueTransport };
}

module.exports = { findUnderpricedCars, deduplicateDeals };
