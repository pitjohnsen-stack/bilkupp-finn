'use strict';
require('dotenv').config();
const path = require('path');
const os   = require('os');
const { REGIONS, TRANSPORT_COSTS_TO_NORDLAND } = require('./regions');

function parseRegions(envStr) {
  if (!envStr) return [];
  return envStr.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);
}

function parseExcludeTitleSubstrings(envStr) {
  const raw = (envStr !== undefined && String(envStr).trim() !== '')
    ? envStr
    : 'auksjonen.no,auksjon';
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

const config = {
  search: {
    maxPrice:             parseInt(process.env.MAX_PRICE               || '50000', 10),
    underpricedThreshold: parseFloat(process.env.UNDERPRICED_THRESHOLD || '0.20'),
    minSaving:            parseInt(process.env.MIN_UNDERPRICED_SAVING  || '5000',  10),
  },

  regions: {
    primary: parseRegions(process.env.PRIMARY_REGIONS || 'nordland'),
    extra:   parseRegions(process.env.EXTRA_REGIONS   || ''),
    all() {
      return [...new Set([...this.primary, ...this.extra])];
    },
    getLocationId(name) {
      return REGIONS[name] ?? null;
    },
  },

  transport: {
    enabled:       process.env.TRANSPORT_CHECK !== 'false',
    costs:         TRANSPORT_COSTS_TO_NORDLAND,
    minSaving:     parseInt(process.env.TRANSPORT_MIN_SAVING || '3000', 10),
    sourceRegions: ['oslo', 'viken', 'vestfold', 'innlandet', 'trondelag', 'vestland', 'rogaland', 'moreroms'],
  },

  schedule: process.env.CRON_SCHEDULE || '0 */6 * * *',

  /** Hastighet: flere regioner samtidig (å øke for mye kan gi rate-limit fra Finn) */
  scan: {
    regionConcurrency: Math.min(
      12,
      Math.max(1, parseInt(process.env.SCAN_REGION_CONCURRENCY || '4', 10)),
    ),
    priceFetchMaxPages: Math.max(1, parseInt(process.env.PRICE_FETCH_MAX_PAGES || '25', 10)),
  },

  listingExclude: {
    titleSubstrings: parseExcludeTitleSubstrings(process.env.EXCLUDE_TITLE_SUBSTRINGS),
  },

  paths: {
    dataDir: process.env.DATA_DIR || path.join(os.tmpdir(), 'bilsnapper-data'),
  },
};

module.exports = config;
