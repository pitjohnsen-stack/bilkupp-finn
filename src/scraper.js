'use strict';
const puppeteer = require('puppeteer-core');

// I Docker-containeren settes denne av Dockerfile: /usr/bin/chromium
// Lokalt på Windows peker den på Chrome-installasjonen din
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const SEARCH_BASE      = 'https://www.finn.no/mobility/search/car';
const ITEM_BASE        = 'https://www.finn.no/mobility/item';
const DELAY_MS         = 1500;
const DETAIL_DELAY     = 800;
const CONCURRENT_DETAILS = 3;
const DEFAULT_MAX_PAGES  = parseInt(process.env.MAX_PAGES || '3', 10);

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
    });
  }
  return browserInstance;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

async function fetchAllAds(searchParams, maxPages = DEFAULT_MAX_PAGES) {
  const browser = await getBrowser();
  const allAds  = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({ ...searchParams, page: String(page), registration_class: '1' });
    const url    = `${SEARCH_BASE}?${params.toString()}`;
    const tabPage = await browser.newPage();
    let pageAds   = [];

    try {
      await tabPage.setRequestInterception(true);
      tabPage.on('request', req => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
        else req.continue();
      });
      await tabPage.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      const seoData = await tabPage.evaluate(() => {
        const el = document.getElementById('seoStructuredData');
        return el ? el.textContent : null;
      });
      if (seoData) {
        const parsed = JSON.parse(seoData);
        const items  = parsed.mainEntity?.itemListElement || [];
        pageAds      = items.map(parseSeoAd).filter(Boolean);
      }
    } finally {
      await tabPage.close();
    }

    if (pageAds.length === 0) {
      console.log(`  [scraper] Ingen data på side ${page}, stopper.`);
      break;
    }
    allAds.push(...pageAds);
    process.stdout.write(`\r  [scraper] Side ${page} → ${allAds.length} annonser`);
    if (pageAds.length < 20) break;
    if (page < maxPages) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log('');
  return allAds;
}

async function fetchAdDetails(browser, ad) {
  const url     = ad.url || `${ITEM_BASE}/${ad.id}`;
  const tabPage = await browser.newPage();

  try {
    await tabPage.setRequestInterception(true);
    tabPage.on('request', req => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
      else req.continue();
    });
    await tabPage.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });

    const details = await tabPage.evaluate(() => {
      const result = {};
      const ldScript = document.querySelector('script[type="application/ld+json"]');
      if (ldScript) {
        try {
          const raw   = JSON.parse(ldScript.textContent);
          const top   = raw['@graph'] != null ? raw['@graph'] : raw;
          const nodes = Array.isArray(top) ? top : [top];
          for (const node of nodes) {
            if (!node || typeof node !== 'object') continue;
            const types     = [].concat(node['@type'] || []);
            const isVehicle = types.some(t => /Vehicle|Car|Product|MotorizedRoadVehicle/i.test(String(t)));
            if (!isVehicle && !node.brand && !node.model && !node.vehicleModelDate) continue;
            let b = node.brand;
            if (b && typeof b === 'object') b = b.name || b['@value'];
            if (b && !result.ldMake) result.ldMake = String(b).trim();
            let m = node.model;
            if (m && typeof m === 'object') m = m.name || m['@value'] || m.value;
            if (m && !result.ldModel) result.ldModel = String(m).trim();
          }
        } catch (_) {}
      }

      const allText = document.body?.innerText || '';
      const match   = (re) => allText.match(re);

      const yearMatch   = match(/(?:Modellår|Årsmodell|1\. gang registrert)[:\s]*(\d{4})/i);
      if (yearMatch) result.year = parseInt(yearMatch[1], 10);

      const kmMatch = match(/(?:Kilometerstand|Km\.stand)[:\s]*([\d\s]+)\s*km/i);
      if (kmMatch) result.km = parseInt(kmMatch[1].replace(/\s/g, ''), 10);

      const fuelMatch = match(/(?:Drivstoff|Motortype)[:\s]*(Bensin|Diesel|Elektrisk|Hybrid|Ladbar hybrid|Hydrogen)/i);
      if (fuelMatch) result.fuel = fuelMatch[1];

      const transMatch = match(/(?:Girkasse|Girsystem)[:\s]*(Manuell|Automat|Automatisk|Aut\.|Manuelt|Trinnløs)/i);
      if (transMatch) result.transmission = transMatch[1];

      const hpMatch = match(/(?:Effekt|Motoreffekt)[:\s]*(\d+)\s*(?:hk|hp|kW)/i);
      if (hpMatch) result.hp = parseInt(hpMatch[1], 10);

      const locMatch = match(/(?:Sted|Plassering|Beliggenhet)[:\s]*([A-Za-zÆØÅæøå\- ]+?)(?:\n|,|$)/i);
      if (locMatch) result.location = locMatch[1].trim();

      const ownerMatch = match(/(?:Antall eiere|Eiere)[:\s]*(\d+)/i);
      if (ownerMatch) result.owners = parseInt(ownerMatch[1], 10);

      const euMatch = match(/(?:Neste EU-kontroll|EU-kontroll)[:\s]*([\d.\/\-]+)/i);
      if (euMatch) result.euControl = euMatch[1];

      const descEl = document.querySelector('[data-testid="ad-description"], .u-word-break');
      if (descEl) result.description = descEl.innerText?.substring(0, 500);

      const sellerEl = document.querySelector('[data-testid="seller-name"], [data-testid="dealer-name"]');
      if (sellerEl) result.sellerName = sellerEl.innerText?.trim();

      const auctionKeywords = ['gi bud', 'høyeste bud', 'budfrist', 'budgivning', 'auksjon', 'auksjonen.no'];
      const lowerText       = allText.toLowerCase();
      result.isAuction = auctionKeywords.some(kw => lowerText.includes(kw));

      return result;
    });

    return {
      ...ad,
      make:         (details.ldMake  && String(details.ldMake).trim())  || ad.make,
      model:        (details.ldModel && String(details.ldModel).trim()) || ad.model,
      year:         details.year         || ad.year,
      km:           details.km           || ad.km,
      fuel:         details.fuel         || ad.fuel,
      transmission: details.transmission || ad.transmission,
      hp:           details.hp           || null,
      location:     details.location     || ad.location || '',
      owners:       details.owners       || null,
      euControl:    details.euControl    || null,
      description:  details.description  || null,
      sellerName:   details.sellerName   || null,
      isAuction:    details.isAuction    || false,
      _enriched:    true,
    };
  } catch (err) {
    return { ...ad, _enriched: false, _enrichError: err.message };
  } finally {
    await tabPage.close();
  }
}

async function enrichAds(ads, concurrency = CONCURRENT_DETAILS, onProgress = null) {
  const browser  = await getBrowser();
  const enriched = [];
  let done = 0;

  for (let i = 0; i < ads.length; i += concurrency) {
    const batch   = ads.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(ad => fetchAdDetails(browser, ad)));
    enriched.push(...results);
    done += results.length;
    const pct = Math.round(done / ads.length * 100);
    process.stdout.write(`\r  [scraper] Detaljer: ${done}/${ads.length} (${pct}%)`);
    if (onProgress) onProgress(done, ads.length, pct);
    if (i + concurrency < ads.length) await new Promise(r => setTimeout(r, DETAIL_DELAY));
  }

  console.log('');
  console.log(`  [scraper] ${enriched.filter(a => a._enriched).length}/${ads.length} beriket`);
  return enriched;
}

function parseSeoAd(listItem) {
  const item   = listItem.item || listItem;
  const finnId = item.url?.split('/').pop();
  if (!finnId) return null;
  return {
    id:           finnId,
    url:          item.url,
    title:        item.name || '',
    make:         item.brand?.name || (item.name || '').split(' ')[0],
    model:        item.model || (item.name || '').split(' ').slice(1, 3).join(' '),
    year:         null,
    km:           null,
    price:        item.offers?.price ? parseInt(item.offers.price, 10) : null,
    location:     '',
    fuel:         null,
    transmission: null,
  };
}

async function fetchCarsInRegion(locationId, maxPrice) {
  const params = { price_to: String(maxPrice) };
  if (locationId != null) params.location = String(locationId);
  return fetchAllAds(params);
}

async function fetchAllCarsInRegion(locationId, maxPages = 25) {
  const params = {};
  if (locationId != null) params.location = String(locationId);
  return fetchAllAds(params, maxPages);
}

module.exports = { fetchCarsInRegion, fetchAllCarsInRegion, enrichAds, closeBrowser };
