'use strict';

/**
 * The fixture test/fixtures/indiamart-bengaluru-basmati-rice.html is a RECORDED REAL PAGE:
 * the unmodified response body of https://dir.indiamart.com/bengaluru/basmati-rice.html fetched
 * on 2026-11-19 (IST). It is not invented data; the sellers, prices and phone numbers in it are
 * what IndiaMART published then. Parser expectations below are facts about that recording.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns/promises');

const { findVendors, fetchCategoryPage, parseListingPage, parsePrice, DiscoveryError } = require('../src/discovery/indiamart');
const { clearSlugCache } = require('../src/discovery/slug');

const PAGE_URL = 'https://dir.indiamart.com/bengaluru/basmati-rice.html';
const NATIONAL_URL = 'https://dir.indiamart.com/impcat/basmati-rice.html';
const recordedPage = fs.readFileSync(path.join(__dirname, 'fixtures', 'indiamart-bengaluru-basmati-rice.html'), 'utf8');

const isDiscoveryError = (code) => (err) => {
  assert.ok(err instanceof DiscoveryError, `expected a DiscoveryError, got ${err}`);
  assert.equal(err.code, code);
  return true;
};

/** A Response as fetch would return it, including the final URL after redirects. */
function page(status, body = '', finalUrl = null) {
  const response = new Response(status === 200 ? body : null, { status });
  if (finalUrl) Object.defineProperty(response, 'url', { value: finalUrl });
  return response;
}

const realFetch = globalThis.fetch;

/**
 * Replaces global fetch with `handler(url, init)` until the test ends; returns the list of
 * requested URLs. Assigned directly, not with t.mock.method: mocking a method twice in one test
 * restores it to the first mock, which would then answer the live test below.
 */
function stubFetch(t, handler) {
  const requested = [];
  globalThis.fetch = async (url, init) => {
    requested.push(url);
    return handler(url, init);
  };
  t.after(() => { globalThis.fetch = realFetch; });
  return requested;
}

const fast = { retryDelayMs: 1 };

/* ------------------------------------------------------------------ parsePrice --- */

test('parsePrice reads the price formats IndiaMART publishes and keeps the unit as stated', () => {
  assert.deepEqual(parsePrice('₹ 175 / Bag'), { value: 175, unit: 'bag', text: '₹ 175 / Bag' });
  assert.deepEqual(parsePrice('₹ 116/Kg'), { value: 116, unit: 'kg', text: '₹ 116/Kg' });
  assert.deepEqual(parsePrice('₹ 84/Kilogram'), { value: 84, unit: 'kg', text: '₹ 84/Kilogram' });
  assert.deepEqual(parsePrice('₹ 1,02,000/Tonne'), { value: 102000, unit: 'tonne', text: '₹ 1,02,000/Tonne' });
  assert.deepEqual(parsePrice('₹ 50,000/Ton'), { value: 50000, unit: 'tonne', text: '₹ 50,000/Ton' });
  assert.deepEqual(parsePrice('₹ 175 / pcs'), { value: 175, unit: 'piece', text: '₹ 175 / pcs' });
  assert.deepEqual(parsePrice('₹ 190 / Set'), { value: 190, unit: 'set', text: '₹ 190 / Set' });
  assert.deepEqual(parsePrice('₹ 150'), { value: 150, unit: null, text: '₹ 150' });
  assert.deepEqual(parsePrice('₹ 1.5 Lakh / Piece'), { value: 150000, unit: 'piece', text: '₹ 1.5 Lakh / Piece' });
});

test('parsePrice returns null for no price and keeps unreadable text without inventing a number', () => {
  assert.equal(parsePrice(null), null);
  assert.equal(parsePrice(undefined), null);
  assert.equal(parsePrice('   '), null);
  assert.deepEqual(parsePrice('Ask Price'), { value: null, unit: null, text: 'Ask Price' });
  assert.deepEqual(parsePrice('₹ 100 - 150 / Kg'), { value: null, unit: null, text: '₹ 100 - 150 / Kg' });
});

/* ------------------------------------------------------------------ parseListingPage --- */

test('recorded page: every seller is read once, from both embedded listing shapes', () => {
  const { vendors, category } = parseListingPage(recordedPage, PAGE_URL);
  assert.equal(category, 'Basmati Rice');
  assert.equal(vendors.length, 32); // 28 in the main list + 4 that appear only in the product widget
  assert.equal(new Set(vendors.map((v) => v.glusr_id)).size, 32);
  assert.equal(new Set(vendors.map((v) => v.name)).size, 32);
  assert.equal(vendors.filter((v) => v.source_url === PAGE_URL).length, 6, 'six listings link no product page');

  for (const vendor of vendors) {
    assert.equal(vendor.source, 'indiamart');
    assert.equal(vendor.kind, 'listed');
    assert.equal(vendor.simulated, false);
    assert.ok(vendor.name.length > 1);
    assert.deepEqual([vendor.city, vendor.serves_city].filter(Boolean), ['Bengaluru'], 'based in Bengaluru or serving it, never both');
    assert.match(vendor.phone, /^\+91-\d{10}$/);
    // the product page when the listing links one, otherwise the category page it was read from
    assert.ok(vendor.source_url === PAGE_URL || vendor.source_url.startsWith('https://www.indiamart.com/proddetail/'), vendor.source_url);
    assert.ok(Number.isInteger(vendor.glusr_id));
  }
});

test('recorded page: every phone number and price returned occurs in the page text', () => {
  const { vendors } = parseListingPage(recordedPage, PAGE_URL);
  for (const vendor of vendors) {
    assert.ok(recordedPage.includes(vendor.phone.slice(4)), `${vendor.name}: phone is not in the page`);
    if (vendor.phone_ext) assert.ok(recordedPage.includes(`${vendor.phone.slice(4)},${vendor.phone_ext}`));
    assert.ok(recordedPage.includes(JSON.stringify(vendor.name).slice(1, -1)), `${vendor.name}: name is not in the page`);
    if (vendor.listed_price_text) assert.ok(recordedPage.includes(vendor.listed_price_text), `${vendor.name}: price is not in the page`);
    else assert.equal(vendor.listed_price, null);
  }
});

test('recorded page: fields of individual listings', () => {
  const { vendors } = parseListingPage(recordedPage, PAGE_URL);
  const byName = (name) => vendors.find((v) => v.name === name) ?? assert.fail(`${name} is not in the parsed vendors`);

  // price per bag stays per bag, even though the listing states a pack size
  const perBag = byName('Sri Venkateshwara Commercials');
  assert.deepEqual(
    [perBag.listed_price, perBag.listed_unit, perBag.listed_price_text],
    [1550, 'bag', '₹ 1,550/Bag'],
  );
  assert.deepEqual(perBag.pack_size, { value: 25, unit: 'kg', text: '25 kg' });

  const cheapBag = byName('Mahammed Ismail Sait');
  assert.deepEqual([cheapBag.listed_price, cheapBag.listed_unit], [175, 'bag']);

  // "₹ 84/Kilogram" and "₹ 100/Kg" are the same unit
  assert.deepEqual([byName('Varshini Enterprises').listed_price, byName('Varshini Enterprises').listed_unit], [84, 'kg']);
  assert.deepEqual([byName('Babu Trading Co.').listed_price, byName('Babu Trading Co.').listed_unit], [100, 'kg']);

  // no published price -> nulls, not a guess
  const unpriced = byName('Matrix Exports');
  assert.deepEqual([unpriced.listed_price, unpriced.listed_unit, unpriced.listed_price_text], [null, null, null]);

  // rating and review count; a seller with no reviews has no rating
  assert.deepEqual([byName('3comma Labs Private Limited').rating, byName('3comma Labs Private Limited').rating_count], [3.8, 589]);
  assert.deepEqual([byName('Golden Foods Inc').rating, byName('Golden Foods Inc').rating_count], [null, 0]);

  // "Deals in Bengaluru" is a seller serving the city from elsewhere: its own city is not claimed
  const servesOnly = byName('Goel International Pvt. Ltd.');
  assert.deepEqual([servesOnly.city, servesOnly.serves_city], [null, 'Bengaluru']);
  assert.deepEqual([byName('Babu Trading Co.').city, byName('Babu Trading Co.').serves_city], ['Bengaluru', null]);
  assert.equal(vendors.filter((v) => v.serves_city).length, 6);

  // enquiry line with an extension
  const withExtension = byName('Noventiq Services India Private Limited');
  assert.deepEqual([withExtension.phone, withExtension.phone_ext], ['+91-8048201100', '6981']);

  // a pack size given as a list of sizes is not one stated size
  assert.equal(byName('Matrix Exports').pack_size, null);

  // present only in the product-widget shape (COMPANYNAME / PRICE_F / CONTACT_NUMBER)
  const widgetOnly = byName('FMJ Agencies');
  assert.deepEqual(
    [widgetOnly.listed_price, widgetOnly.listed_unit, widgetOnly.listed_price_text, widgetOnly.phone, widgetOnly.rating, widgetOnly.rating_count],
    [85, 'kg', '₹ 85 / Kg', '+91-8047834032', 4.2, 5],
  );
  assert.equal(widgetOnly.item_title, 'DARBAR SUPER 2XX BASMATI RICE');
});

test('a seller repeated on the page is returned once', () => {
  const { vendors } = parseListingPage(recordedPage + recordedPage, PAGE_URL);
  assert.equal(vendors.length, 32);
});

test('a page with no listing data parses to an empty list', () => {
  assert.deepEqual(parseListingPage('<html><title>IndiaMART: Page not found</title></html>', PAGE_URL), {
    vendors: [],
    category: 'IndiaMART: Page not found',
  });
});

test('listing data that cannot be read is a parse error, not an empty list', () => {
  // The recorded page cut off in the middle of its first listing: the JSON never closes.
  const cutOff = recordedPage.slice(0, recordedPage.indexOf('"CMP"') + 40);
  assert.throws(() => parseListingPage(cutOff, PAGE_URL), (err) => {
    isDiscoveryError('parse')(err);
    assert.equal(err.url, PAGE_URL);
    assert.match(err.message, /1 listing entries but none could be read/);
    return true;
  });
});

/* ------------------------------------------------------------------ fetchCategoryPage --- */

test('fetchCategoryPage requests the city page like a browser and reads its listings', async (t) => {
  let sent;
  const requested = stubFetch(t, (url, init) => {
    sent = init;
    return page(200, recordedPage);
  });
  const result = await fetchCategoryPage({ citySlug: 'bengaluru', slug: 'basmati-rice' });

  assert.deepEqual(requested, [PAGE_URL]);
  assert.match(sent.headers['User-Agent'], /^Mozilla\/5\.0 .*Chrome\//);
  assert.equal(sent.redirect, 'follow');
  assert.ok(sent.signal instanceof AbortSignal);
  assert.equal(result.found, true);
  assert.equal(result.scope, 'city');
  assert.equal(result.url, PAGE_URL);
  assert.equal(result.category, 'Basmati Rice');
  assert.equal(result.vendors.length, 32);
  assert.equal(result.reason, null);
});

test('fetchCategoryPage: no city means the nationwide page', async (t) => {
  const requested = stubFetch(t, () => page(200, recordedPage));
  const result = await fetchCategoryPage({ slug: 'basmati-rice' });
  assert.deepEqual(requested, [NATIONAL_URL]);
  assert.equal(result.scope, 'national');
});

test('fetchCategoryPage reports the page actually served after a redirect', async (t) => {
  stubFetch(t, () => page(200, recordedPage, NATIONAL_URL));
  const result = await fetchCategoryPage({ citySlug: 'hubballi', slug: 'basmati-rice' });
  assert.equal(result.scope, 'national');
  assert.equal(result.url, NATIONAL_URL);
});

test('fetchCategoryPage: 404 is "no such category", without a retry', async (t) => {
  const requested = stubFetch(t, () => page(404));
  const result = await fetchCategoryPage({ citySlug: 'bengaluru', slug: 'no-such-thing', ...fast });
  assert.deepEqual(result, { found: false, url: 'https://dir.indiamart.com/bengaluru/no-such-thing.html', scope: 'city', category: null, vendors: [], reason: 'no_such_category' });
  assert.equal(requested.length, 1);
});

test('fetchCategoryPage: a category page with no sellers is found:false with its reason', async (t) => {
  stubFetch(t, () => page(200, '<script>window.__INITIAL_STATE__ = {"mcatname":"Basmati Rice","data":[]};</script>'));
  const result = await fetchCategoryPage({ citySlug: 'bengaluru', slug: 'basmati-rice' });
  assert.equal(result.found, false);
  assert.equal(result.reason, 'category_has_no_listings');
  assert.equal(result.category, 'Basmati Rice');
});

test('fetchCategoryPage: 403 is blocked at once', async (t) => {
  const requested = stubFetch(t, () => page(403));
  await assert.rejects(fetchCategoryPage({ citySlug: 'bengaluru', slug: 'basmati-rice', ...fast }), (err) => isDiscoveryError('blocked')(err) && err.status === 403);
  assert.equal(requested.length, 1);
});

test('fetchCategoryPage: 429 is retried once, then blocked', async (t) => {
  const requested = stubFetch(t, () => page(429));
  await assert.rejects(fetchCategoryPage({ citySlug: 'bengaluru', slug: 'basmati-rice', ...fast }), (err) => isDiscoveryError('blocked')(err) && err.status === 429);
  assert.equal(requested.length, 2);
});

test('fetchCategoryPage: one retry recovers from a 5xx or a dropped connection', async (t) => {
  for (const firstFailure of [() => page(502), () => Promise.reject(new TypeError('fetch failed'))]) {
    let calls = 0;
    stubFetch(t, () => (++calls === 1 ? firstFailure() : page(200, recordedPage)));
    const result = await fetchCategoryPage({ citySlug: 'bengaluru', slug: 'basmati-rice', ...fast });
    assert.equal(result.vendors.length, 32);
    assert.equal(calls, 2);
  }
});

test('fetchCategoryPage: a server that stays down or unreachable is a network error after 2 attempts', async (t) => {
  const down = stubFetch(t, () => page(503));
  await assert.rejects(fetchCategoryPage({ citySlug: 'bengaluru', slug: 'basmati-rice', ...fast }), (err) => isDiscoveryError('network')(err) && err.status === 503);
  assert.equal(down.length, 2);

  const offline = stubFetch(t, () => Promise.reject(new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) })));
  await assert.rejects(fetchCategoryPage({ citySlug: 'bengaluru', slug: 'basmati-rice', ...fast }), (err) => {
    isDiscoveryError('network')(err);
    assert.equal(err.message, 'Could not reach IndiaMART: ENOTFOUND');
    return true;
  });
  assert.equal(offline.length, 2);
});

test('fetchCategoryPage: a request that hangs times out as a network error', async (t) => {
  stubFetch(t, (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }));
  await assert.rejects(
    fetchCategoryPage({ citySlug: 'bengaluru', slug: 'basmati-rice', timeoutMs: 30, ...fast }),
    (err) => isDiscoveryError('network')(err) && err.message === 'IndiaMART did not answer within 30 ms',
  );
});

test('fetchCategoryPage: a caller abort stops it with the caller\'s reason', async (t) => {
  const requested = stubFetch(t, (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const reason = new Error('job cancelled');
  setTimeout(() => controller.abort(reason), 10);
  await assert.rejects(fetchCategoryPage({ citySlug: 'bengaluru', slug: 'basmati-rice', signal: controller.signal, ...fast }), (err) => err === reason);
  assert.equal(requested.length, 1);
});

test('fetchCategoryPage: a bot check is blocked, an unrecognised page is a parse error', async (t) => {
  stubFetch(t, () => page(200, '<html><title>Just a moment</title><div id="captcha"></div></html>'));
  await assert.rejects(fetchCategoryPage({ slug: 'basmati-rice' }), isDiscoveryError('blocked'));

  stubFetch(t, () => page(200, '<html><title>Basmati Rice</title><div id="app"></div></html>'));
  await assert.rejects(fetchCategoryPage({ slug: 'basmati-rice' }), isDiscoveryError('parse'));
});

test('fetchCategoryPage refuses anything that is not a plain slug', async (t) => {
  const requested = stubFetch(t, () => page(200, recordedPage));
  for (const slug of ['../etc/passwd', 'Basmati Rice', 'rice?x=1', '', null]) {
    await assert.rejects(fetchCategoryPage({ citySlug: 'bengaluru', slug }), TypeError);
  }
  await assert.rejects(fetchCategoryPage({ citySlug: 'evil.example/x', slug: 'rice' }), TypeError);
  assert.equal(requested.length, 0);
});

/* ------------------------------------------------------------------ findVendors --- */

test('findVendors', async (t) => {
  const savedKey = process.env.GROQ_API_KEY;
  t.beforeEach(() => {
    clearSlugCache();
    delete process.env.GROQ_API_KEY; // these tests exercise the rule-based path only
  });
  t.after(() => {
    clearSlugCache();
    if (savedKey !== undefined) process.env.GROQ_API_KEY = savedKey;
  });

  await t.test('returns real listings for the item in the city, labelled with where they came from', async (t) => {
    const requested = stubFetch(t, () => page(200, recordedPage));
    const vendors = await findVendors({ item: 'basmati chawal', city: 'Bangalore', limit: 5 });

    assert.deepEqual(requested, [PAGE_URL]);
    assert.ok(Array.isArray(vendors));
    assert.equal(vendors.length, 5);
    assert.deepEqual(vendors.map((v) => v.name), parseListingPage(recordedPage, PAGE_URL).vendors.slice(0, 5).map((v) => v.name));
    assert.equal(vendors.reason, null);
    assert.equal(vendors.source.slug, 'basmati-rice');
    assert.equal(vendors.source.citySlug, 'bengaluru');
    assert.equal(vendors.source.scope, 'city');
    assert.equal(vendors.source.url, PAGE_URL);
    assert.equal(vendors.source.category, 'Basmati Rice');
    assert.equal(vendors.source.match, 'exact');
    assert.equal(vendors.source.total, 32);
    assert.deepEqual(Object.keys(vendors), ['0', '1', '2', '3', '4'], 'the labels do not show up as array entries');
    assert.equal(JSON.parse(JSON.stringify(vendors)).length, 5);
  });

  await t.test('defaults to 10 vendors and serves a repeat request from memory', async (t) => {
    const requested = stubFetch(t, () => page(200, recordedPage));
    const first = await findVendors({ item: 'basmati rice', city: 'Bengaluru' });
    assert.equal(first.length, 10);
    first[0].name = 'changed by the caller';
    const second = await findVendors({ item: 'basmati rice', city: 'Bengaluru', limit: 3 });
    assert.equal(requested.length, 1);
    assert.equal(second.length, 3);
    assert.notEqual(second[0].name, 'changed by the caller');
  });

  await t.test('falls back to the nationwide page and says so', async (t) => {
    const requested = stubFetch(t, (url) => (url === NATIONAL_URL ? page(200, recordedPage) : page(404)));
    const vendors = await findVendors({ item: 'basmati rice', city: 'Atlantis' });
    assert.deepEqual(requested, ['https://dir.indiamart.com/atlantis/basmati-rice.html', NATIONAL_URL]);
    assert.equal(vendors.source.scope, 'national');
    assert.equal(vendors.source.citySlug, null);
    assert.equal(vendors.length, 10);
  });

  await t.test('no category for the item is an honest empty array with the reason', async (t) => {
    const requested = stubFetch(t, () => page(404));
    const vendors = await findVendors({ item: 'zzqx widget', city: 'Bengaluru' });
    assert.deepEqual([...vendors], []);
    assert.equal(vendors.reason, 'no_category_found');
    assert.match(vendors.source.detail, /no category page with listings for "zzqx widget" \(tried zzqx-widget, zzqx-widgets; no suggestion from the language model \(no_key\)\)/);
    assert.deepEqual(vendors.source.tried.map((attempt) => attempt.outcome), ['no_such_category', 'no_such_category', 'no_such_category', 'no_such_category']);
    assert.equal(requested.length, 4); // two candidates, city page then nationwide page for each
  });

  await t.test('a blocked connector is an error, never an empty list', async (t) => {
    stubFetch(t, () => page(403));
    await assert.rejects(findVendors({ item: 'basmati rice', city: 'Bengaluru' }), isDiscoveryError('blocked'));
  });

  await t.test('a page that cannot be read is an error, never an empty list', async (t) => {
    stubFetch(t, () => page(200, recordedPage.slice(0, recordedPage.indexOf('"CMP"') + 40)));
    await assert.rejects(findVendors({ item: 'basmati rice', city: 'Bengaluru' }), isDiscoveryError('parse'));
  });

  await t.test('rejects a missing item or a bad limit before fetching', async (t) => {
    const requested = stubFetch(t, () => page(200, recordedPage));
    await assert.rejects(findVendors({ city: 'Bengaluru' }), TypeError);
    await assert.rejects(findVendors({ item: '  ' }), TypeError);
    await assert.rejects(findVendors({ item: 'rice', limit: 0 }), RangeError);
    await assert.rejects(findVendors({ item: 'rice', limit: 2.5 }), RangeError);
    assert.equal(requested.length, 0);
  });
});

/* ------------------------------------------------------------------ live --- */

test('LIVE IndiaMART: basmati rice in Bengaluru returns at least 3 real vendors with names and phones', async (t) => {
  try {
    await dns.lookup('dir.indiamart.com');
  } catch (err) {
    t.skip(`offline: cannot resolve dir.indiamart.com (${err.code})`);
    return;
  }
  assert.equal(globalThis.fetch, realFetch, 'a stub from an earlier test is still installed: this would not be a live result');
  clearSlugCache();
  const vendors = await findVendors({ item: 'basmati rice', city: 'Bengaluru', limit: 50 });

  t.diagnostic(`fetched ${new Date().toISOString()} from ${vendors.source.url} (scope ${vendors.source.scope}, category "${vendors.source.category}")`);
  t.diagnostic(`${vendors.length} vendors; with phone: ${vendors.filter((v) => v.phone).length}; with price: ${vendors.filter((v) => v.listed_price != null).length}`);
  for (const vendor of vendors.slice(0, 3)) {
    t.diagnostic(`${vendor.name} | ${vendor.listed_price_text ?? 'no price published'} | ${vendor.phone ?? 'no phone'} | ${vendor.city ?? `serves ${vendor.serves_city}`}`);
  }

  assert.equal(vendors.reason, null);
  assert.equal(vendors.source.slug, 'basmati-rice');
  assert.equal(vendors.source.scope, 'city');
  const contactable = vendors.filter((v) => v.name && /^\+91-\d{10}$/.test(v.phone ?? ''));
  assert.ok(contactable.length >= 3, `only ${contactable.length} vendors with a name and a phone`);
  for (const vendor of vendors) {
    assert.equal(vendor.source, 'indiamart');
    assert.equal(vendor.simulated, false);
    assert.ok(vendor.name);
  }
  assert.ok(vendors.some((v) => v.listed_price > 0 && v.listed_unit), 'no vendor has a parsed price');
});
