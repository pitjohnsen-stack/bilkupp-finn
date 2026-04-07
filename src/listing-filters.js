'use strict';
const config = require('../config/config');

const MIN_REAL_PRICE = parseInt(process.env.MIN_REAL_PRICE || '15000', 10);

function listingHaystack(ad) {
  if (!ad || typeof ad !== 'object') return '';
  return [ad.title, ad.description, ad.make, ad.model, ad.location, ad.url, ad.sellerName]
    .filter(Boolean).join(' ').toLowerCase();
}

function isExcludedListing(ad) {
  if (ad.isAuction) return true;
  if (ad.price && ad.price < MIN_REAL_PRICE) return true;
  const hay  = listingHaystack(ad);
  const subs = config.listingExclude?.titleSubstrings || [];
  return subs.some(s => s.length > 0 && hay.includes(s));
}

function filterExcludedListings(ads) {
  if (!Array.isArray(ads)) return [];
  return ads.filter(ad => !isExcludedListing(ad));
}

module.exports = { filterExcludedListings };
