'use strict';

/**
 * Maps what the owner said ("basmati chawal", "sona masoori", "ಅಕ್ಕಿ") to an IndiaMART category
 * slug ("basmati-rice"), and a city name to IndiaMART's city slug.
 *
 * Candidates come from rules first; the language model is asked only when every rule-based
 * candidate fails. No candidate is trusted until IndiaMART serves a page with listings for it.
 */

const { fetchCategoryPage, DiscoveryError } = require('./indiamart');
const { completeJSON, LLMError } = require('../llm');

const MAX_CANDIDATES = 5;
const MAX_LLM_SUGGESTIONS = 3;
const LLM_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

/** One spelling per word: composed form, lower case, no zero-width joiners (Indic text often carries them). */
const fold = (text) => String(text).normalize('NFC').replace(/[‌‍]/g, '').toLowerCase().trim();

/** English trade term for common Hindi and Kannada words, romanised and in native script. */
const TRADE_WORDS = new Map(Object.entries({
  // Hindi
  chawal: 'rice', chaval: 'rice', 'चावल': 'rice',
  'बासमती': 'basmati',
  atta: 'wheat flour', aata: 'wheat flour', 'आटा': 'wheat flour',
  gehu: 'wheat', gehun: 'wheat', 'गेहूं': 'wheat',
  cheeni: 'sugar', chini: 'sugar', shakkar: 'sugar', 'चीनी': 'sugar',
  namak: 'salt', 'नमक': 'salt',
  tel: 'oil', 'तेल': 'oil',
  sarson: 'mustard', 'सरसों': 'mustard',
  daal: 'dal', 'दाल': 'dal',
  arhar: 'toor', tur: 'toor',
  haldi: 'turmeric', 'हल्दी': 'turmeric',
  mirch: 'chilli', mirchi: 'chilli', 'मिर्च': 'chilli',
  jeera: 'cumin seeds', 'जीरा': 'cumin seeds',
  dhaniya: 'coriander', 'धनिया': 'coriander',
  pyaz: 'onion', pyaaz: 'onion', 'प्याज': 'onion',
  aloo: 'potato', 'आलू': 'potato',
  tamatar: 'tomato', 'टमाटर': 'tomato',
  doodh: 'milk', 'दूध': 'milk',
  gud: 'jaggery', gur: 'jaggery', 'गुड़': 'jaggery',
  kapda: 'fabric', 'कपड़ा': 'fabric',
  sariya: 'tmt bars', 'सरिया': 'tmt bars',
  eent: 'bricks', 'ईंट': 'bricks',
  ret: 'sand', 'रेत': 'sand',
  // Kannada
  akki: 'rice', 'ಅಕ್ಕಿ': 'rice',
  'ಬಾಸ್ಮತಿ': 'basmati',
  bele: 'dal', 'ಬೇಳೆ': 'dal',
  sakkare: 'sugar', 'ಸಕ್ಕರೆ': 'sugar',
  uppu: 'salt', 'ಉಪ್ಪು': 'salt',
  enne: 'oil', 'ಎಣ್ಣೆ': 'oil',
  godhi: 'wheat', 'ಗೋಧಿ': 'wheat',
  hittu: 'flour', 'ಹಿಟ್ಟು': 'flour',
  bella: 'jaggery', 'ಬೆಲ್ಲ': 'jaggery',
  arishina: 'turmeric', 'ಅರಿಶಿನ': 'turmeric',
  eerulli: 'onion', 'ಈರುಳ್ಳಿ': 'onion',
  haalu: 'milk', 'ಹಾಲು': 'milk',
  tuppa: 'ghee', 'ತುಪ್ಪ': 'ghee',
  batte: 'fabric', 'ಬಟ್ಟೆ': 'fabric',
  // spelling variants
  masuri: 'masoori', tshirt: 't-shirt', tshirts: 't-shirts',
}).map(([word, english]) => [fold(word), english]));

/** A variety named without its commodity ("sona masoori") gets the commodity appended. */
const HEAD_NOUN = { basmati: 'rice', masoori: 'rice', ponni: 'rice', kolam: 'rice', toor: 'dal', moong: 'dal', urad: 'dal', masoor: 'dal' };

/** Commodities: never pluralised, and specific enough to search on their own. */
const COMMODITIES = new Set([
  'rice', 'dal', 'sugar', 'salt', 'oil', 'wheat', 'flour', 'atta', 'maida', 'milk', 'ghee', 'jaggery',
  'turmeric', 'cement', 'sand', 'steel', 'fabric', 'cotton', 'tea', 'coffee',
]);

const FILLER_WORDS = new Set([
  'wholesale', 'bulk', 'best', 'good', 'quality', 'price', 'rate', 'supplier', 'suppliers', 'dealer', 'dealers',
  'need', 'want', 'buy', 'of', 'for', 'the', 'a', 'an', 'chahiye', 'beku', 'ka', 'ki', 'ke',
]);

/**
 * IndiaMART's slug for a city, keyed to its other names. Every slug here was served by
 * dir.indiamart.com on 2026-11-19; "hubballi" is the one modern name it did not accept.
 * A city not listed is slugified as given, which IndiaMART accepts for most cities.
 */
const CITY_NAMES = {
  bengaluru: ['bangalore', 'bengalooru', 'ಬೆಂಗಳೂರು', 'बेंगलुरु', 'बेंगलूरु', 'बेंगलुरू', 'बैंगलोर', 'बंगलौर', 'बेंगलोर'],
  delhi: ['new delhi', 'दिल्ली', 'नई दिल्ली', 'ದೆಹಲಿ'],
  mumbai: ['bombay', 'मुंबई', 'ಮುಂಬೈ'],
  kolkata: ['calcutta', 'कोलकाता'],
  chennai: ['madras', 'चेन्नई', 'ಚೆನ್ನೈ'],
  pune: ['poona', 'पुणे', 'ಪುಣೆ'],
  gurgaon: ['gurugram'],
  mysuru: ['mysore', 'ಮೈಸೂರು'],
  hubli: ['hubballi', 'ಹುಬ್ಬಳ್ಳಿ'],
  mangalore: ['mangaluru', 'ಮಂಗಳೂರು'],
  tumkur: ['tumakuru', 'ತುಮಕೂರು'],
  belgaum: ['belagavi', 'ಬೆಳಗಾವಿ'],
  shimoga: ['shivamogga'],
  gulbarga: ['kalaburagi'],
  bellary: ['ballari'],
  kochi: ['cochin'],
  vadodara: ['baroda'],
  trivandrum: ['thiruvananthapuram'],
  visakhapatnam: ['vizag'],
  allahabad: ['prayagraj'],
  pondicherry: ['puducherry'],
  varanasi: ['banaras', 'benares'],
};

/**
 * Native-script names of cities whose IndiaMART slug is simply the English name slugified
 * (what citySlug already builds for the English spelling; not separately fetched).
 */
const NATIVE_CITY_NAMES = {
  hyderabad: ['हैदराबाद', 'ಹೈದರಾಬಾದ್'],
  ahmedabad: ['अहमदाबाद'],
  jaipur: ['जयपुर'],
  lucknow: ['लखनऊ'],
  davangere: ['ದಾವಣಗೆರೆ'],
};

/** English name to tell the owner and to store, where it differs from the slug in more than case. */
const CITY_DISPLAY = {
  hubli: 'Hubballi', mangalore: 'Mangaluru', tumkur: 'Tumakuru', belgaum: 'Belagavi', shimoga: 'Shivamogga',
  gulbarga: 'Kalaburagi', bellary: 'Ballari', gurgaon: 'Gurugram', trivandrum: 'Thiruvananthapuram',
  allahabad: 'Prayagraj', pondicherry: 'Puducherry',
};

const CITY_SLUG = new Map(
  Object.entries({ ...CITY_NAMES, ...NATIVE_CITY_NAMES }).flatMap(([slug, names]) => [slug, ...names].map((name) => [fold(name), slug])),
);

/** Lower-case words joined by single hyphens, or null if nothing usable is left. */
function toSlug(text) {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug && slug.length <= 80 ? slug : null;
}

/** "Bangalore", "Bengaluru, Karnataka", "ಬೆಂಗಳೂರು" -> "bengaluru". Null when no slug can be formed. */
function citySlug(city) {
  if (typeof city !== 'string') return null;
  const name = fold(city.split(',')[0]).replace(/\./g, '').replace(/\s+/g, ' ');
  return CITY_SLUG.get(name) ?? toSlug(name);
}

const titleCase = (text) => text.replace(/(^|[\s-])(\p{Ll})/gu, (_, sep, ch) => sep + ch.toUpperCase());

/**
 * The English name to store for a city: "बेंगलुरु", "ಬೆಂಗಳೂರು", "Bangalore" -> "Bengaluru".
 * A city this module does not know is kept as said (Latin script title-cased); a name in
 * another script is never transliterated by guess. Null for an empty name.
 */
function cityName(city) {
  if (typeof city !== 'string' || !city.trim()) return null;
  const first = city.split(',')[0].trim().replace(/\s+/g, ' ');
  const known = CITY_SLUG.get(fold(first).replace(/\./g, ''));
  if (known) return CITY_DISPLAY[known] ?? titleCase(known.replace(/-/g, ' '));
  return /^[\p{Script=Latin}\s.'-]+$/u.test(first) ? titleCase(first.toLowerCase()) : first;
}

const SCRIPT_OF = { 'hi-IN': /\p{Script=Devanagari}/u, 'kn-IN': /\p{Script=Kannada}/u };

/**
 * A city as said in a sentence of `language`: English (cityName) for en-IN; for hi-IN / kn-IN
 * the city's name in that script ("ಬೆಂಗಳೂರು", "बेंगलुरु"), or the name as given when it is already
 * in that script. Null when no name in that script is known: a romanised city is never put into
 * a Hindi or Kannada sentence (CLAUDE.md rule 5).
 */
function cityIn(city, language) {
  if (typeof city !== 'string' || !city.trim()) return null;
  const script = SCRIPT_OF[language];
  if (!script) return cityName(city);
  const first = city.split(',')[0].trim().replace(/\s+/g, ' ');
  const slug = CITY_SLUG.get(fold(first).replace(/\./g, ''));
  const native = slug ? [...(CITY_NAMES[slug] ?? []), ...(NATIVE_CITY_NAMES[slug] ?? [])].find((name) => script.test(name)) : null;
  if (native) return native;
  return script.test(first) && /^[\p{L}\p{M}\p{Join_Control}\s.'-]+$/u.test(first) && !/\p{Script=Latin}/u.test(first) ? first : null;
}

/** Whether two city names mean the same city ("Bangalore" and "Bengaluru"). Unknown is never a match. */
function sameCity(a, b) {
  const slug = citySlug(a);
  return slug !== null && slug === citySlug(b);
}

/** A quantity said along with the item ("200 kg sugar"). A bare number is kept: "1121 basmati" is a variety. */
const QUANTITY = /\b\d+(?:\.\d+)?\s*(?:kgs?|kilos?|kilograms?|quintals?|tonnes?|tons?|lit(?:re|er)s?|pieces|pcs|bags|boxes|dozen)\b/g;

/** The item as English slug words: trade words translated, filler dropped, other scripts dropped. */
function englishWords(item) {
  return fold(item)
    .replace(QUANTITY, ' ')
    .split(/[^\p{L}\p{M}\p{N}-]+/u)
    .flatMap((word) => (TRADE_WORDS.get(word) ?? word).split(' '))
    .map((word) => word.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, ''))
    .filter((word, i, all) => word && !FILLER_WORDS.has(word) && word !== all[i - 1]);
}

/** IndiaMART names countable goods in the plural ("cotton-t-shirts", "tmt-bars"): the other number of the last word. */
function otherNumber(words) {
  const last = words.at(-1);
  if (COMMODITIES.has(last) || !/[a-z]$/.test(last)) return null;
  let other;
  if (/ies$/.test(last)) other = last.replace(/ies$/, 'y');
  else if (/(s|x|ch|sh)es$/.test(last)) other = last.slice(0, -2);
  else if (/[^s]s$/.test(last)) other = last.slice(0, -1);
  else if (/(s|x|ch|sh)$/.test(last)) other = `${last}es`;
  else if (/[^aeiou]y$/.test(last)) other = last.replace(/y$/, 'ies');
  else other = `${last}s`;
  return [...words.slice(0, -1), other];
}

/**
 * Ordered candidates with how each relates to the item: 'exact' names the item itself;
 * 'generalised' drops leading qualifiers ("premium basmati rice" -> "basmati-rice" -> "rice").
 */
function candidateList(item) {
  const words = englishWords(item);
  if (!words.length) return [];
  const noun = words.map((word) => HEAD_NOUN[word]).find(Boolean);
  const completed = noun && !words.includes(noun) ? [...words, noun] : words;

  const candidates = new Map();
  const add = (parts, match) => {
    const slug = parts && toSlug(parts.join('-'));
    if (slug && !candidates.has(slug)) candidates.set(slug, match);
  };
  add(completed, 'exact');
  add(otherNumber(completed), 'exact');
  add(words, 'exact');
  for (let i = 1; i < completed.length; i++) {
    const rest = completed.slice(i);
    if (rest.length > 1 || COMMODITIES.has(rest[0])) add(rest, 'generalised');
  }
  return [...candidates].slice(0, MAX_CANDIDATES).map(([slug, match]) => ({ slug, match }));
}

/**
 * Rule-based category slug candidates for an item, most specific first. Pure and synchronous;
 * none is known to exist until resolveSlug has fetched it.
 * "basmati chawal" -> ["basmati-rice", "rice"]; "sona masoori" -> ["sona-masoori-rice", ...];
 * "cotton t-shirt" -> ["cotton-t-shirt", "cotton-t-shirts"].
 */
function candidateSlugs(item) {
  if (typeof item !== 'string') throw new TypeError('candidateSlugs: item must be a string');
  return candidateList(item).map((candidate) => candidate.slug);
}

/**
 * Ask the language model for category slugs. Its answer is reduced to slug characters and is
 * only ever used as a path on dir.indiamart.com, where resolveSlug checks it like any other candidate.
 * @throws {LLMError}
 */
async function suggestSlugs(item, { signal } = {}) {
  const reply = await completeJSON({
    system: 'You map a product an Indian small business wants to buy to IndiaMART category page slugs. '
      + 'The product may be named in Hindi, Kannada or English, in any script. A slug is the English category name in lower case '
      + 'with hyphens, as used in dir.indiamart.com/impcat/<slug>.html, for example "basmati-rice", "cotton-t-shirts", "tmt-bars". '
      + `Give up to ${MAX_LLM_SUGGESTIONS} slugs, most specific first. If you cannot tell what the product is, give an empty list.`,
    user: item,
    schemaHint: '{"slugs":["basmati-rice"]}',
    timeoutMs: LLM_TIMEOUT_MS,
    signal,
  });
  const slugs = Array.isArray(reply.slugs) ? reply.slugs.filter((s) => typeof s === 'string').map(toSlug).filter(Boolean) : [];
  return [...new Set(slugs)].slice(0, MAX_LLM_SUGGESTIONS);
}

const cache = new Map();

function remember(key, value) {
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

function clearSlugCache() {
  cache.clear();
}

/**
 * Find the category page for an item: each candidate is fetched (city page, then the nationwide
 * page) until one is served with listings. Successful results are cached in memory for 15 minutes.
 *
 * @param {string} item
 * @param {string|null} [city]
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{slug: string, citySlug: string|null, scope: 'city'|'national', url: string,
 *   category: string|null, match: 'exact'|'generalised'|'llm', vendors: object[],
 *   tried: {slug: string, url: string, outcome: string}[], fetchedAt: string}>}
 *   `match` other than 'exact' means the page is broader than, or the model's reading of, what
 *   was asked: tell the owner the `category` that was searched.
 * @throws {DiscoveryError} not_found when no candidate has a page with listings (`tried` lists
 *   every page fetched); blocked | parse | network pass through from the fetch.
 */
async function resolveSlug(item, city = null, { signal } = {}) {
  if (typeof item !== 'string' || !item.trim()) throw new TypeError('resolveSlug: item must be a non-empty string');
  const requestedCity = city ? citySlug(city) : null;
  const key = `${requestedCity ?? ''}|${fold(item)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.value);

  const tried = [];
  const attempted = new Set();
  const attempt = async ({ slug, match }) => {
    attempted.add(slug);
    for (const pageCity of requestedCity ? [requestedCity, null] : [null]) {
      const page = await fetchCategoryPage({ citySlug: pageCity, slug, signal });
      tried.push({ slug, url: page.url, outcome: page.found ? `${page.vendors.length} listings` : page.reason });
      if (page.found) {
        const value = {
          slug,
          citySlug: page.scope === 'city' ? pageCity : null,
          scope: page.scope,
          url: page.url,
          category: page.category,
          match,
          vendors: page.vendors,
          tried,
          fetchedAt: new Date().toISOString(),
        };
        remember(key, value);
        return structuredClone(value);
      }
      if (page.scope === 'national') break; // IndiaMART already redirected the city URL to the nationwide page
    }
    return null;
  };

  for (const candidate of candidateList(item)) {
    const hit = await attempt(candidate);
    if (hit) return hit;
  }

  let llmNote = '';
  let suggestions = [];
  try {
    suggestions = await suggestSlugs(item, { signal });
  } catch (err) {
    if (!(err instanceof LLMError)) throw err;
    llmNote = `; no suggestion from the language model (${err.code})`;
  }
  for (const slug of suggestions) {
    const hit = attempted.has(slug) ? null : await attempt({ slug, match: 'llm' });
    if (hit) return hit;
  }

  const slugs = [...attempted];
  throw new DiscoveryError(
    'not_found',
    `IndiaMART has no category page with listings for "${item.trim()}" (${slugs.length ? `tried ${slugs.join(', ')}` : 'no slug could be derived'}${llmNote})`,
    { tried },
  );
}

module.exports = { candidateSlugs, suggestSlugs, resolveSlug, citySlug, cityName, cityIn, sameCity, clearSlugCache };
