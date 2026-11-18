'use strict';

/**
 * Vendor discovery from IndiaMART's public category pages (decisions.md D2):
 * https://dir.indiamart.com/<city-slug>/<mcat-slug>.html, nationwide at /impcat/<mcat-slug>.html.
 *
 * Every vendor returned is read out of the page's own embedded JSON. Nothing is filled in: a
 * field the listing does not carry is null, and a page that cannot be read is an error.
 *
 * Page facts, verified against live pages on 2026-11-19:
 * - Listings are JSON objects inside `window.__INITIAL_STATE__`, in two shapes (LISTING_SHAPES).
 *   The same seller carries the same id, phone and rating in both.
 * - A city page also lists sellers based elsewhere who serve the city; their address line reads
 *   "Deals in <city>". Those come back with `city` null and `serves_city` set.
 * - A city with no page for the category redirects to /impcat/; an unknown category is a 404.
 * - Sustained fetching (about 60 pages in a few minutes) is answered with HTTP 429.
 * - The phone is IndiaMART's published enquiry line for the seller (decisions.md D2): show it,
 *   never dial it automatically.
 */

const { setTimeout: sleep } = require('node:timers/promises');
const { normaliseUnit } = require('../procurement/landed-cost');

const BASE_URL = 'https://dir.indiamart.com';
const NATIONAL_PATH = 'impcat';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15000;
const RETRY_DELAY_MS = 1500;
const MAX_ATTEMPTS = 2;
const DEFAULT_LIMIT = 10;
const MAX_LISTING_CHARS = 60000;

/**
 * code: blocked (403, 429 or a bot wall) | not_found (no category page for the item) |
 * parse (page fetched but its listings could not be read) | network (unreachable, timed out or 5xx)
 */
class DiscoveryError extends Error {
  constructor(code, message, { url, status, tried, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DiscoveryError';
    this.code = code;
    if (url !== undefined) this.url = url;
    if (status !== undefined) this.status = status;
    if (tried !== undefined) this.tried = tried;
  }
}

/* ------------------------------------------------------------------ field parsing --- */

const cleanText = (value) => (typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ') : null);

const PRICE_PATTERN = /^(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(lakh|lac|crore|cr)?\s*(?:\/\s*(.+?))?\s*$/i;
const PRICE_MULTIPLIER = { lakh: 1e5, lac: 1e5, crore: 1e7, cr: 1e7 };

/**
 * "₹ 175 / Bag" -> { value: 175, unit: 'bag', text: '₹ 175 / Bag' }. The unit is kept as the
 * listing states it; a bag is not turned into kilograms. No price text -> null; text that is
 * not a price ("Ask Price") keeps the text with a null value.
 */
function parsePrice(priceText) {
  const text = cleanText(priceText);
  if (!text) return null;
  const match = PRICE_PATTERN.exec(text);
  if (!match) return { value: null, unit: null, text };
  const value = Number(match[1].replaceAll(',', '')) * (PRICE_MULTIPLIER[match[2]?.toLowerCase()] ?? 1);
  return { value, unit: normaliseUnit(match[3]), text };
}

/** "7942701488", "+91-7942701488" and "8048201100,6981" (number, extension) in one format. */
function parsePhone(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return { phone: null, phone_ext: null };
  const [main, extension = ''] = String(value).split(',');
  let digits = main.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10) return { phone: digits.length >= 8 ? main.trim() : null, phone_ext: null };
  return { phone: `+91-${digits}`, phone_ext: extension.replace(/\D/g, '') || null };
}

/**
 * The single pack size a listing states ("Packaging Size: 25 kg"), which is what lets a per-bag
 * price be compared per kilogram. "Loose" or a list of sizes is not a stated size -> null.
 */
function parsePackSize(attributes) {
  if (!Array.isArray(attributes)) return null;
  const sizes = new Map();
  for (const attribute of attributes) {
    if (!/^pack(aging)? size$/i.test(cleanText(attribute?.MASTER_DESC) ?? '')) continue;
    const text = cleanText(attribute.OPTIONS_DESC);
    const match = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/i.exec(text ?? '');
    if (!match || Number(match[1]) <= 0) return null;
    const size = { value: Number(match[1]), unit: normaliseUnit(match[2]), text };
    sizes.set(`${size.value} ${size.unit}`, size);
  }
  return sizes.size === 1 ? sizes.values().next().value : null;
}

function listingUrl(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === 'https:' && /(^|\.)indiamart\.com$/.test(url.hostname) ? url.href : null;
}

/**
 * The two shapes a listing is embedded in, each mapped to the same raw fields.
 * `CMP` objects are the page's main result list; `COMPANYNAME` objects are its product widget.
 */
const LISTING_SHAPES = [
  {
    key: 'CMP',
    read: (o) => ({
      name: o.CMP, itemTitle: o.p_nm, priceText: o.pr, city: o.city, addressLine: o.ad, phone: o.c_ct,
      rating: o.wt_avg, ratingCount: o.tr_c, url: o.p_url, sellerId: o.gl_id, displayId: o.disp_id, attributes: o.isq,
    }),
  },
  {
    key: 'COMPANYNAME',
    read: (o) => ({
      name: o.COMPANYNAME, itemTitle: o.ITEM_NAME, priceText: o.PRICE_F ?? o.PRICE_SEO, city: o.CITY_NAME, state: o.STATE_NAME,
      phone: o.CONTACT_NUMBER, rating: o.SELLER_RATING_COUNTS?.avg_rating, ratingCount: o.SELLER_RATING_COUNTS?.total_count,
      url: o.PDP_URL, sellerId: o.GLUSR_ID, displayId: o.DISPLAY_ID,
    }),
  },
];

/**
 * @typedef {object} Vendor
 * @property {'indiamart'} source
 * @property {'listed'} kind
 * @property {false} simulated
 * @property {string} name
 * @property {string|null} item_title          the product the seller listed
 * @property {string|null} city                where the seller is based, when the page says
 * @property {string|null} serves_city         set instead of `city` for a "Deals in <city>" seller
 * @property {string|null} state
 * @property {string|null} phone               IndiaMART enquiry line, "+91-XXXXXXXXXX"
 * @property {string|null} phone_ext           extension published with the enquiry line ("number,extension")
 * @property {number|null} listed_price        per `listed_unit`
 * @property {string|null} listed_unit         as stated ("kg", "bag", "tonne"); never converted
 * @property {string|null} listed_price_text   the price exactly as published
 * @property {{value: number, unit: string, text: string}|null} pack_size  the one pack size the listing states
 * @property {number|null} rating              average out of 5; null when there are no reviews
 * @property {number} rating_count
 * @property {string} source_url               the product page, else the category page it was read from
 * @property {number|null} glusr_id            IndiaMART seller id
 * @property {number|null} display_id          IndiaMART product id
 */

/** @returns {Vendor|null} null when the listing names no company. */
function toVendor(raw, pageUrl) {
  const name = cleanText(raw.name);
  if (!name) return null;
  const price = parsePrice(raw.priceText);
  const listedCity = cleanText(raw.city);
  // "Deals in Bengaluru": the seller serves that city from somewhere the page does not name.
  const servesOnly = /^deals in /i.test(cleanText(raw.addressLine) ?? '');
  const ratingCount = Number.isInteger(raw.ratingCount) && raw.ratingCount > 0 ? raw.ratingCount : 0;
  return {
    source: 'indiamart',
    kind: 'listed',
    simulated: false,
    name,
    item_title: cleanText(raw.itemTitle),
    city: servesOnly ? null : listedCity,
    serves_city: servesOnly ? listedCity : null,
    state: cleanText(raw.state),
    ...parsePhone(raw.phone),
    listed_price: price?.value ?? null,
    listed_unit: price?.unit ?? null,
    listed_price_text: price?.text ?? null,
    pack_size: parsePackSize(raw.attributes),
    rating: ratingCount && typeof raw.rating === 'number' && raw.rating > 0 ? raw.rating : null,
    rating_count: ratingCount,
    source_url: listingUrl(raw.url) ?? pageUrl,
    glusr_id: raw.sellerId ?? null,
    display_id: raw.displayId ?? null,
  };
}

/* ------------------------------------------------------------------ page parsing --- */

/** Index of the `}` closing the `{` at `start`, skipping braces inside JSON strings; -1 if none within `limit`. */
function closingBrace(text, start, limit) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < limit; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * The JSON object that directly holds the key at `keyAt`: walk outwards over each earlier `{`
 * until one closes after the key and parses. A `{` that sits inside a string fails to parse and
 * is skipped.
 */
function enclosingObject(text, keyAt) {
  const earliest = Math.max(0, keyAt - MAX_LISTING_CHARS);
  for (let start = text.lastIndexOf('{', keyAt); start >= earliest; start = text.lastIndexOf('{', start - 1)) {
    const end = closingBrace(text, start, Math.min(text.length, start + MAX_LISTING_CHARS));
    if (end > keyAt) {
      try {
        return { value: JSON.parse(text.slice(start, end + 1)), end };
      } catch { /* not an object boundary: keep walking outwards */ }
    }
    if (start === 0) break;
  }
  return null;
}

/** Every object in `text` with `key` as its own property, in page order, plus how many could not be read. */
function objectsWithKey(text, key) {
  const needle = `"${key}"`;
  const objects = [];
  let unreadable = 0;
  let resumeAt = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, Math.max(at + needle.length, resumeAt))) {
    const found = enclosingObject(text, at);
    if (!found) unreadable++;
    else if (Object.hasOwn(found.value, key)) {
      objects.push(found.value);
      resumeAt = found.end; // a seller's other products are nested inside its listing: skip them
    }
  }
  return { objects, unreadable };
}

/** The category's display name ("Basmati Rice"), for telling the owner what was actually searched. */
function pageCategory(html) {
  const name = /"mcatname":("(?:[^"\\]|\\.)*")/.exec(html);
  if (name) {
    try {
      return cleanText(JSON.parse(name[1]));
    } catch { /* malformed escape: use the title instead */ }
  }
  return cleanText(/<title>([^<]*)<\/title>/i.exec(html)?.[1]);
}

/**
 * Read the vendors out of one category page. One vendor per seller, in page order: sellers are
 * told apart by IndiaMART seller id, and a listing with no id by company name. A seller listed
 * twice keeps its first listing, with fields that listing lacked filled from the later one.
 *
 * @returns {{vendors: object[], category: string|null}}
 * @throws {DiscoveryError} parse - the page has listing data that could not be read
 */
function parseListingPage(html, pageUrl) {
  const vendors = [];
  const bySeller = new Map();
  let unreadable = 0;
  for (const shape of LISTING_SHAPES) {
    const found = objectsWithKey(html, shape.key);
    unreadable += found.unreadable;
    for (const object of found.objects) {
      const vendor = toVendor(shape.read(object), pageUrl);
      if (!vendor) continue;
      const idKey = vendor.glusr_id == null ? null : `id:${vendor.glusr_id}`;
      const nameKey = `name:${vendor.name.toLowerCase()}`;
      const existing = bySeller.get(idKey ?? nameKey);
      if (existing) {
        for (const [field, value] of Object.entries(vendor)) existing[field] ??= value;
        continue;
      }
      vendors.push(vendor);
      if (idKey) bySeller.set(idKey, vendor);
      if (!bySeller.has(nameKey)) bySeller.set(nameKey, vendor);
    }
  }
  if (!vendors.length && unreadable) {
    throw new DiscoveryError('parse', `IndiaMART page has ${unreadable} listing entries but none could be read; the page format has probably changed`, { url: pageUrl });
  }
  return { vendors, category: pageCategory(html) };
}

/* ------------------------------------------------------------------ fetching --- */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function categoryUrl(citySlug, slug) {
  for (const part of [citySlug ?? NATIONAL_PATH, slug]) {
    if (typeof part !== 'string' || !SLUG_PATTERN.test(part)) throw new TypeError(`Not a URL slug: ${JSON.stringify(part)}`);
  }
  return `${BASE_URL}/${citySlug ?? NATIONAL_PATH}/${slug}.html`;
}

/**
 * GET with a browser User-Agent, a per-attempt timeout and one retry (not after a 403: asking
 * again does not lift a refusal). Resolves for 200 and 404 only.
 */
async function getPage(url, { signal, timeoutMs, retryDelayMs }) {
  for (let attempt = 1; ; attempt++) {
    let failure;
    let retryable = true;
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-IN,en;q=0.9' },
        redirect: 'follow',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const finalUrl = response.url || url;
      const { status } = response;
      if (status === 200) return { status, url: finalUrl, html: await response.text() };
      await response.body?.cancel();
      if (status === 404) return { status, url: finalUrl, html: '' };
      if (status === 403) {
        failure = new DiscoveryError('blocked', 'IndiaMART refused the request (HTTP 403)', { url, status });
        retryable = false;
      } else if (status === 429) {
        failure = new DiscoveryError('blocked', 'IndiaMART is rate limiting requests (HTTP 429)', { url, status });
      } else {
        failure = new DiscoveryError('network', `IndiaMART answered HTTP ${status}`, { url, status });
      }
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      failure = new DiscoveryError(
        'network',
        err.name === 'TimeoutError' ? `IndiaMART did not answer within ${timeoutMs} ms` : `Could not reach IndiaMART: ${err.cause?.code || err.message}`,
        { url, cause: err },
      );
    }
    if (!retryable || attempt === MAX_ATTEMPTS) throw failure;
    await sleep(retryDelayMs, undefined, { signal });
  }
}

/**
 * Fetch and read one category page. `citySlug` null fetches the nationwide page.
 *
 * @returns {Promise<{found: boolean, url: string, scope: 'city'|'national', category: string|null,
 *   vendors: object[], reason: 'no_such_category'|'category_has_no_listings'|null}>}
 *   `url` and `scope` describe the page actually served, after any redirect.
 * @throws {DiscoveryError} blocked | parse | network
 */
async function fetchCategoryPage({ citySlug = null, slug, signal, timeoutMs = FETCH_TIMEOUT_MS, retryDelayMs = RETRY_DELAY_MS }) {
  const response = await getPage(categoryUrl(citySlug, slug), { signal, timeoutMs, retryDelayMs });
  const page = {
    found: false,
    url: response.url,
    scope: new URL(response.url).pathname.startsWith(`/${NATIONAL_PATH}/`) ? 'national' : 'city',
    category: null,
    vendors: [],
    reason: null,
  };
  if (response.status === 404) return { ...page, reason: 'no_such_category' };

  const { vendors, category } = parseListingPage(response.html, response.url);
  if (vendors.length) return { ...page, found: true, category, vendors };
  if (response.html.includes('__INITIAL_STATE__')) return { ...page, category, reason: 'category_has_no_listings' };
  if (/captcha|access denied|unusual traffic/i.test(response.html)) {
    throw new DiscoveryError('blocked', 'IndiaMART served a bot check instead of the category page', { url: response.url, status: 200 });
  }
  throw new DiscoveryError('parse', 'IndiaMART page has no listing data in the expected place; the page format has probably changed', { url: response.url });
}

/* ------------------------------------------------------------------ public API --- */

/**
 * Real IndiaMART listings for an item, city page first and the nationwide page as fallback.
 *
 * @param {object} args
 * @param {string} args.item      what the owner asked for, in any of their languages
 * @param {string} [args.city]    delivery city; omit to search nationwide
 * @param {number} [args.limit]   most vendors to return (default 10)
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<Vendor[]>} vendors with the `vendors` table's column names (source 'indiamart',
 *   kind 'listed', simulated false). The array also carries two non-enumerable properties:
 *   `reason` - null, or why the array is empty ('no_category_found');
 *   `source` - { slug, citySlug, scope, url, category, match, total, tried, fetchedAt }.
 *   `scope` 'national' means the city had no page and the vendors are from anywhere in India.
 * @throws {DiscoveryError} blocked | parse | network - the connector failed; that is never an empty list
 */
async function findVendors({ item, city = null, limit = DEFAULT_LIMIT, signal } = {}) {
  if (typeof item !== 'string' || !item.trim()) throw new TypeError('findVendors: item must be a non-empty string');
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`findVendors: limit must be a positive integer, got ${JSON.stringify(limit)}`);

  // Required here, not at the top: slug.js validates its candidates with fetchCategoryPage from this module.
  const { resolveSlug } = require('./slug');
  let resolved;
  try {
    resolved = await resolveSlug(item, city, { signal });
  } catch (err) {
    if (!(err instanceof DiscoveryError) || err.code !== 'not_found') throw err;
    return describe([], 'no_category_found', { tried: err.tried, detail: err.message });
  }
  const { vendors, ...source } = resolved;
  return describe(vendors.slice(0, limit), null, { ...source, total: vendors.length });
}

function describe(vendors, reason, source) {
  Object.defineProperty(vendors, 'reason', { value: reason });
  Object.defineProperty(vendors, 'source', { value: source });
  return vendors;
}

module.exports = { findVendors, fetchCategoryPage, parseListingPage, parsePrice, DiscoveryError };
