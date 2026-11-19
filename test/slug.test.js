'use strict';

/**
 * Page bodies in these tests come from test/fixtures/indiamart-bengaluru-basmati-rice.html, a
 * recorded real IndiaMART page (see test/indiamart.test.js), not invented data.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns/promises');

const { candidateSlugs, suggestSlugs, resolveSlug, citySlug, cityName, cityIn, sameCity, clearSlugCache } = require('../src/discovery/slug');
const { DiscoveryError } = require('../src/discovery/indiamart');
const { LLMError } = require('../src/llm');

const recordedPage = fs.readFileSync(path.join(__dirname, 'fixtures', 'indiamart-bengaluru-basmati-rice.html'), 'utf8');
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const FAKE_KEY = 'gsk_fake-unit-test-key'; // only ever sent to the stubbed fetch
const cityUrl = (city, slug) => `https://dir.indiamart.com/${city}/${slug}.html`;
const nationalUrl = (slug) => cityUrl('impcat', slug);

function page(status, body = '', finalUrl = null) {
  const response = new Response(status === 200 ? body : null, { status });
  if (finalUrl) Object.defineProperty(response, 'url', { value: finalUrl });
  return response;
}

const groqReply = (object) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(object) } }] }), { status: 200 });

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

/** IndiaMART as a table: listed URLs serve the recorded page, everything else is a 404. */
const serving = (...urls) => (url) => (urls.includes(url) ? page(200, recordedPage) : page(404));

const savedKey = process.env.GROQ_API_KEY;
test.beforeEach(() => {
  clearSlugCache();
  delete process.env.GROQ_API_KEY;
});
test.after(() => {
  if (savedKey !== undefined) process.env.GROQ_API_KEY = savedKey;
});

/* ------------------------------------------------------------------ candidateSlugs --- */

test('candidateSlugs: Hindi and Kannada trade words become the English category', () => {
  assert.deepEqual(candidateSlugs('basmati chawal'), ['basmati-rice', 'rice']);
  assert.deepEqual(candidateSlugs('बासमती चावल'), ['basmati-rice', 'rice']);
  assert.deepEqual(candidateSlugs('ಬಾಸ್ಮತಿ ಅಕ್ಕಿ'), ['basmati-rice', 'rice']);
  assert.deepEqual(candidateSlugs('akki'), ['rice']);
  assert.deepEqual(candidateSlugs('Atta'), ['wheat-flour', 'flour']);
  assert.deepEqual(candidateSlugs('cheeni'), ['sugar']);
  assert.deepEqual(candidateSlugs('sarson tel'), ['mustard-oil', 'oil']);
  assert.deepEqual(candidateSlugs('sariya'), ['tmt-bars', 'tmt-bar']);
});

test('candidateSlugs: a variety gets its commodity appended, most specific first', () => {
  assert.deepEqual(candidateSlugs('sona masoori'), ['sona-masoori-rice', 'sona-masoori', 'masoori-rice', 'rice']);
  assert.deepEqual(candidateSlugs('Sona Masuri'), ['sona-masoori-rice', 'sona-masoori', 'masoori-rice', 'rice']);
  assert.deepEqual(candidateSlugs('arhar'), ['toor-dal', 'toor', 'dal']);
  assert.deepEqual(candidateSlugs('toor dal'), ['toor-dal', 'dal']);
});

test('candidateSlugs: countable goods are tried in both numbers, commodities are not pluralised', () => {
  assert.deepEqual(candidateSlugs('cotton t-shirt'), ['cotton-t-shirt', 'cotton-t-shirts']);
  assert.deepEqual(candidateSlugs('Cotton T Shirts'), ['cotton-t-shirts', 'cotton-t-shirt', 't-shirts']);
  assert.deepEqual(candidateSlugs('tshirt'), ['t-shirt', 't-shirts']);
  assert.deepEqual(candidateSlugs('batteries'), ['batteries', 'battery']);
  assert.deepEqual(candidateSlugs('corrugated box'), ['corrugated-box', 'corrugated-boxes']);
  assert.deepEqual(candidateSlugs('basmati rice'), ['basmati-rice', 'rice']);
});

test('candidateSlugs: qualifiers, filler and quantities are dropped; a variety number is kept', () => {
  assert.deepEqual(candidateSlugs('premium basmati rice'), ['premium-basmati-rice', 'basmati-rice', 'rice']);
  assert.deepEqual(candidateSlugs('200 kg sugar wholesale'), ['sugar']);
  assert.deepEqual(candidateSlugs('best quality basmati rice chahiye'), ['basmati-rice', 'rice']);
  assert.deepEqual(candidateSlugs('1121 basmati rice'), ['1121-basmati-rice', 'basmati-rice', 'rice']);
  assert.deepEqual(candidateSlugs('  Basmati   RICE!! '), ['basmati-rice', 'rice']);
});

test('candidateSlugs: gives nothing rather than a guess when no English word can be derived', () => {
  assert.deepEqual(candidateSlugs('रेशम'), []);
  assert.deepEqual(candidateSlugs(''), []);
  assert.deepEqual(candidateSlugs('!!!'), []);
  assert.throws(() => candidateSlugs(null), TypeError);
  for (const item of ['basmati chawal', 'sona masoori', 'cotton t-shirt', '../../etc/passwd', 'rice?x=1&y=2']) {
    for (const slug of candidateSlugs(item)) assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});

/* ------------------------------------------------------------------ cities --- */

test('citySlug maps old, new and native-script names to IndiaMART\'s city slug', () => {
  for (const name of ['Bengaluru', 'Bangalore', 'bangalore ', 'Bengaluru, Karnataka', 'ಬೆಂಗಳೂರು', 'बेंगलुरु']) assert.equal(citySlug(name), 'bengaluru', name);
  for (const name of ['Delhi', 'New Delhi', 'NEW  DELHI', 'दिल्ली']) assert.equal(citySlug(name), 'delhi', name);
  for (const name of ['Mumbai', 'Bombay', 'मुंबई']) assert.equal(citySlug(name), 'mumbai', name);
  assert.equal(citySlug('Hubballi'), 'hubli');
  assert.equal(citySlug('Mysore'), 'mysuru');
  assert.equal(citySlug('Gurugram'), 'gurgaon');
  assert.equal(citySlug('Navi Mumbai'), 'navi-mumbai');
  assert.equal(citySlug('Tumakuru'), 'tumkur');
  assert.equal(citySlug('Hosur'), 'hosur'); // not in the table: slugified as given
});

test('citySlug returns null when there is nothing to build a slug from', () => {
  assert.equal(citySlug('कोई शहर'), null);
  assert.equal(citySlug(''), null);
  assert.equal(citySlug(null), null);
  assert.equal(citySlug(undefined), null);
});

test('cityName stores one English name for every spelling of a known city', () => {
  for (const said of ['बेंगलुरु', 'बैंगलोर', 'ಬೆಂಗಳೂರು', 'Bangalore', 'bengaluru', 'Bengaluru, Karnataka']) assert.equal(cityName(said), 'Bengaluru', said);
  assert.equal(cityName('ಮೈಸೂರು'), 'Mysuru');
  assert.equal(cityName('hubli'), 'Hubballi');
  assert.equal(cityName('नई दिल्ली'), 'Delhi');
  assert.equal(cityName('हैदराबाद'), 'Hyderabad');
  assert.equal(citySlug(cityName('ಬೆಂಗಳೂರು')), 'bengaluru', 'the stored name still finds the IndiaMART page');
});

test('cityName keeps an unknown city as said and never transliterates by guess', () => {
  assert.equal(cityName('indore'), 'Indore');
  assert.equal(cityName('इंदौर'), 'इंदौर');
  assert.equal(cityName('  '), null);
  assert.equal(cityName(null), null);
});

test('sameCity treats two names of one city as equal and never matches an unknown', () => {
  assert.equal(sameCity('Bangalore', 'Bengaluru'), true);
  assert.equal(sameCity('New Delhi', 'Delhi'), true);
  assert.equal(sameCity('Hubballi', 'Hubli'), true);
  assert.equal(sameCity('Mumbai', 'Navi Mumbai'), false);
  assert.equal(sameCity('Delhi', 'Mumbai'), false);
  assert.equal(sameCity(null, null), false);
  assert.equal(sameCity('', ''), false);
});

/* ------------------------------------------------------------------ resolveSlug --- */

test('resolveSlug validates the first candidate against the city page', async (t) => {
  const requested = stubFetch(t, serving(cityUrl('bengaluru', 'basmati-rice')));
  const resolved = await resolveSlug('basmati chawal', 'Bangalore');

  assert.deepEqual(requested, [cityUrl('bengaluru', 'basmati-rice')]);
  assert.equal(resolved.slug, 'basmati-rice');
  assert.equal(resolved.citySlug, 'bengaluru');
  assert.equal(resolved.scope, 'city');
  assert.equal(resolved.url, cityUrl('bengaluru', 'basmati-rice'));
  assert.equal(resolved.category, 'Basmati Rice');
  assert.equal(resolved.match, 'exact');
  assert.equal(resolved.vendors.length, 32);
  assert.deepEqual(resolved.tried, [{ slug: 'basmati-rice', url: cityUrl('bengaluru', 'basmati-rice'), outcome: '32 listings' }]);
  assert.ok(!Number.isNaN(Date.parse(resolved.fetchedAt)));
});

test('resolveSlug moves to the next candidate when a slug has no page, and marks a broader match', async (t) => {
  const requested = stubFetch(t, serving(cityUrl('bengaluru', 'basmati-rice')));
  const resolved = await resolveSlug('premium basmati rice', 'Bengaluru');

  assert.deepEqual(requested, [
    cityUrl('bengaluru', 'premium-basmati-rice'),
    nationalUrl('premium-basmati-rice'),
    cityUrl('bengaluru', 'basmati-rice'),
  ]);
  assert.equal(resolved.slug, 'basmati-rice');
  assert.equal(resolved.match, 'generalised');
  assert.deepEqual(resolved.tried.map((a) => a.outcome), ['no_such_category', 'no_such_category', '32 listings']);
});

test('resolveSlug does not refetch the nationwide page IndiaMART already redirected to', async (t) => {
  // What IndiaMART does for an unknown category under a real city: redirect to /impcat/, then 404.
  const requested = stubFetch(t, (url) => {
    if (url === cityUrl('bengaluru', 'cotton-t-shirts')) return page(200, recordedPage);
    return page(404, '', url.replace('/bengaluru/', '/impcat/'));
  });
  const resolved = await resolveSlug('cotton t-shirt', 'Bengaluru');
  assert.deepEqual(requested, [cityUrl('bengaluru', 'cotton-t-shirt'), cityUrl('bengaluru', 'cotton-t-shirts')]);
  assert.equal(resolved.slug, 'cotton-t-shirts');
  assert.equal(resolved.match, 'exact');
});

test('resolveSlug falls back to the nationwide page when the city has none, and labels the scope', async (t) => {
  const requested = stubFetch(t, serving(nationalUrl('basmati-rice')));
  const resolved = await resolveSlug('basmati rice', 'Hosur');
  assert.deepEqual(requested, [cityUrl('hosur', 'basmati-rice'), nationalUrl('basmati-rice')]);
  assert.equal(resolved.scope, 'national');
  assert.equal(resolved.citySlug, null);

  // a city URL that IndiaMART itself redirects to the nationwide page
  clearSlugCache();
  stubFetch(t, () => page(200, recordedPage, nationalUrl('basmati-rice')));
  const redirected = await resolveSlug('basmati rice', 'Hosur');
  assert.equal(redirected.scope, 'national');
  assert.equal(redirected.citySlug, null);
});

test('resolveSlug with no city searches nationwide only', async (t) => {
  const requested = stubFetch(t, serving(nationalUrl('basmati-rice')));
  const resolved = await resolveSlug('basmati rice');
  assert.deepEqual(requested, [nationalUrl('basmati-rice')]);
  assert.equal(resolved.scope, 'national');
});

test('resolveSlug caches a hit per item and city, and hands out copies', async (t) => {
  const requested = stubFetch(t, serving(cityUrl('bengaluru', 'basmati-rice'), cityUrl('delhi', 'basmati-rice')));
  const first = await resolveSlug('Basmati Rice', 'Bengaluru');
  first.vendors.length = 0;
  first.slug = 'changed by the caller';

  const again = await resolveSlug('basmati rice ', 'Bangalore');
  assert.equal(requested.length, 1, 'same item and city: no second fetch');
  assert.equal(again.slug, 'basmati-rice');
  assert.equal(again.vendors.length, 32);

  await resolveSlug('basmati rice', 'Delhi');
  assert.equal(requested.length, 2, 'another city is another page');

  clearSlugCache();
  await resolveSlug('basmati rice', 'Bengaluru');
  assert.equal(requested.length, 3);
});

test('resolveSlug: not_found lists every page tried and why the model did not help', async (t) => {
  const requested = stubFetch(t, serving());
  await assert.rejects(resolveSlug('zzqx widget', 'Bengaluru'), (err) => {
    assert.ok(err instanceof DiscoveryError);
    assert.equal(err.code, 'not_found');
    assert.equal(err.message, 'IndiaMART has no category page with listings for "zzqx widget" (tried zzqx-widget, zzqx-widgets; no suggestion from the language model (no_key))');
    assert.deepEqual(err.tried.map((a) => a.slug), ['zzqx-widget', 'zzqx-widget', 'zzqx-widgets', 'zzqx-widgets']);
    return true;
  });
  assert.ok(requested.every((url) => url.startsWith('https://dir.indiamart.com/')), 'no model call without a key');

  // a failure is not cached: the next call looks again
  const before = requested.length;
  await assert.rejects(resolveSlug('zzqx widget', 'Bengaluru'), DiscoveryError);
  assert.ok(requested.length > before);
});

test('resolveSlug asks the model only after the rules fail, and validates what it suggests', async (t) => {
  process.env.GROQ_API_KEY = FAKE_KEY;
  const requested = stubFetch(t, (url) => {
    if (url === GROQ_URL) return groqReply({ slugs: ['Basmati Rice!', '../../etc/passwd', 'rice', 'basmati-rice', 'fifth'] });
    return serving(cityUrl('bengaluru', 'basmati-rice'))(url);
  });
  // "chaawal" is not a spelling the rules know
  const resolved = await resolveSlug('basmati chaawal', 'Bengaluru');

  assert.equal(resolved.slug, 'basmati-rice');
  assert.equal(resolved.match, 'llm');
  const groqAt = requested.indexOf(GROQ_URL);
  assert.equal(requested.filter((url) => url === GROQ_URL).length, 1);
  assert.deepEqual(
    requested.slice(0, groqAt).filter((url) => url.includes('/bengaluru/')).map((url) => url.split('/').pop()),
    ['basmati-chaawal-rice.html', 'basmati-chaawal.html', 'chaawal-rice.html', 'rice.html'],
    'every rule-based candidate was tried first',
  );
  assert.deepEqual(requested.slice(groqAt + 1), [cityUrl('bengaluru', 'basmati-rice')], 'the suggestion is fetched before it is believed');
});

test('resolveSlug: a model suggestion that IndiaMART does not serve is still not_found', async (t) => {
  process.env.GROQ_API_KEY = FAKE_KEY;
  const requested = stubFetch(t, (url) => (url === GROQ_URL ? groqReply({ slugs: ['silk-fabric'] }) : page(404)));
  await assert.rejects(resolveSlug('रेशम', 'Bengaluru'), (err) => {
    assert.equal(err.code, 'not_found');
    assert.match(err.message, /\(tried silk-fabric\)$/);
    return true;
  });
  assert.deepEqual(requested, [GROQ_URL, cityUrl('bengaluru', 'silk-fabric'), nationalUrl('silk-fabric')]);
});

test('resolveSlug: a model failure is reported in not_found, not thrown as a model error', async (t) => {
  process.env.GROQ_API_KEY = FAKE_KEY;
  stubFetch(t, (url) => (url === GROQ_URL ? new Response('{"error":{"message":"bad request"}}', { status: 400 }) : page(404)));
  await assert.rejects(resolveSlug('रेशम', 'Bengaluru'), (err) => {
    assert.ok(err instanceof DiscoveryError);
    assert.equal(err.code, 'not_found');
    assert.match(err.message, /no slug could be derived; no suggestion from the language model \(http\)/);
    return true;
  });
});

test('resolveSlug stops at once when IndiaMART blocks, without trying more candidates', async (t) => {
  const requested = stubFetch(t, () => page(403));
  await assert.rejects(resolveSlug('premium basmati rice', 'Bengaluru'), (err) => err instanceof DiscoveryError && err.code === 'blocked');
  assert.equal(requested.length, 1);
});

test('resolveSlug rejects an empty item', async () => {
  await assert.rejects(resolveSlug('  ', 'Bengaluru'), TypeError);
  await assert.rejects(resolveSlug(undefined), TypeError);
});

/* ------------------------------------------------------------------ suggestSlugs --- */

test('suggestSlugs reduces the model reply to at most 3 distinct slugs', async (t) => {
  process.env.GROQ_API_KEY = FAKE_KEY;
  let body;
  stubFetch(t, (url, init) => {
    body = JSON.parse(init.body);
    return groqReply({ slugs: ['Basmati Rice', 'basmati-rice', 42, null, 'Long Grain Rice ', 'rice', 'paddy'] });
  });
  assert.deepEqual(await suggestSlugs('basmati chawal'), ['basmati-rice', 'long-grain-rice', 'rice']);
  assert.equal(body.messages[1].content, 'basmati chawal');

  stubFetch(t, () => groqReply({ slugs: 'basmati-rice' }));
  assert.deepEqual(await suggestSlugs('basmati chawal'), []);
  stubFetch(t, () => groqReply({}));
  assert.deepEqual(await suggestSlugs('basmati chawal'), []);
});

test('suggestSlugs surfaces a missing key as an LLMError', async () => {
  await assert.rejects(suggestSlugs('basmati chawal'), (err) => err instanceof LLMError && err.code === 'no_key');
});

/* ------------------------------------------------------------------ live --- */

test('LIVE IndiaMART: "basmati chawal" in Bangalore resolves to the Bengaluru basmati-rice page', async (t) => {
  try {
    await dns.lookup('dir.indiamart.com');
  } catch (err) {
    t.skip(`offline: cannot resolve dir.indiamart.com (${err.code})`);
    return;
  }
  assert.equal(globalThis.fetch, realFetch, 'a stub from an earlier test is still installed: this would not be a live result');
  const resolved = await resolveSlug('basmati chawal', 'Bangalore');
  t.diagnostic(`fetched ${resolved.fetchedAt}: ${resolved.url} -> "${resolved.category}", ${resolved.vendors.length} listings, scope ${resolved.scope}`);
  assert.equal(resolved.slug, 'basmati-rice');
  assert.equal(resolved.scope, 'city');
  assert.equal(resolved.url, cityUrl('bengaluru', 'basmati-rice'));
  assert.equal(resolved.category, 'Basmati Rice');
  assert.ok(resolved.vendors.length >= 3);
});

test('cityIn: a city in the sentence language\'s own script, English for en-IN, null rather than a romanised name', () => {
  assert.equal(cityIn('Bengaluru', 'kn-IN'), 'ಬೆಂಗಳೂರು');
  assert.equal(cityIn('Bangalore', 'hi-IN'), 'बेंगलुरु');
  assert.equal(cityIn('ಬೆಂಗಳೂರು', 'en-IN'), 'Bengaluru');
  assert.equal(cityIn('Mysuru', 'kn-IN'), 'ಮೈಸೂರು');
  assert.equal(cityIn('जयपुर', 'hi-IN'), 'जयपुर', 'already in the script');
  assert.equal(cityIn('Shivamogga', 'kn-IN'), null, 'no Kannada name known: never "Shivamoggaಗೆ"');
  assert.equal(cityIn('Mysuru', 'hi-IN'), null);
  assert.equal(cityIn('ಮೈಸೂರು', 'hi-IN'), null, 'Kannada script is not put into a Hindi sentence');
  assert.equal(cityIn(null, 'hi-IN'), null);
  assert.equal(cityIn('', 'kn-IN'), null);
});
