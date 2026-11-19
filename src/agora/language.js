"use strict";

/**
 * Which language the owner just spoke, decided on the server from the owner's own words, so a
 * tool's `say` and the narrator follow the owner mid-call without any switch (owner requirement,
 * 2026-11-20; E2E full run step 10).
 *
 * Sarvam ASR runs with params.language "unknown" and writes each utterance in its own script
 * (agora-findings.md "Multilingual owner calls"): Hindi in Devanagari, Kannada in Kannada script,
 * English in Latin; Hinglish usually all in Devanagari. Typed turns can be romanised. So:
 * - a word in an Indic script counts for that script's language (Devanagari is Hindi unless the
 *   sentence uses Marathi's own words);
 * - a Latin word counts for Hindi or Kannada when it is a common romanised Hindi or Kannada word,
 *   for English when it is an English function word or verb, and only a little for English when
 *   it is any other word (cotton, delivery, stock: the nouns code-mixed speech borrows);
 * - acknowledgements, units and numbers count for nothing: "ok" or "200" keeps the language
 *   the owner used before.
 * The language with the most weight wins; on a tie an Indian language wins over English.
 */

const { scriptOf } = require("./script");

/** Languages a tool's `say` can be written in (src/tools/errors.js LANGS). */
const TEMPLATE_LANGUAGES = ["hi-IN", "kn-IN", "en-IN"];
/** Budget for the /history read before a tool runs: the whole tool must answer within the 10 s MCP timeout_ms. */
const HISTORY_TIMEOUT_MS = 1200;
/** How many owner turns to look back through for one that decides the language. */
const LOOK_BACK = 6;

const SCRIPT_LANGUAGE = {
  Devanagari: "hi-IN",
  Kannada: "kn-IN",
  Tamil: "ta-IN",
  Telugu: "te-IN",
  Malayalam: "ml-IN",
  Bengali: "bn-IN",
  Gujarati: "gu-IN",
  Gurmukhi: "pa-IN",
  Oriya: "or-IN",
};

const INDIC_WEIGHT = 1.5;
const LIST_WEIGHT = 1;
/** A romanised Hindi or Kannada word carries the sentence's grammar ("check karo", "check maadi"): it weighs like a native-script word. */
const ROMAN_WEIGHT = INDIC_WEIGHT;
const OTHER_LATIN_WEIGHT = 0.3;

const set = (words) => new Set(words.split(/\s+/).filter(Boolean));

/** Count for nothing in any language: acknowledgements, greetings, units, currency, and words Hindi and English share. */
const NEUTRAL = set(`
  ok okay okk yes yeah yep no nope hmm hm hmmm uh um ah oh hello hi hey thanks thank sorry please
  kilo kilos kg kgs gram grams gm litre litres liter liters ltr piece pieces pcs pc dozen box boxes bag bags
  packet packets quintal quintals ton tons tonne rupee rupees rs inr per
  to do me so main
`);

/** English function words and common verbs: these make a Latin sentence English. */
const ENGLISH = set(`
  i my mine we our us you your he she they them it its this that these those
  is are am was were be been being have has had need needs want wants
  the a an of for in on at with from by about under over into than then
  what how who whom which when where why can could will would should shall may must does did done doing
  and or but if not there here much many more less some any all every just also too very still again
  give tell send show check find get got make buy sell pay paid owe owes go going ahead now right today tomorrow
  let lets know see look read say said call stop start keep put take
`);

/** Common romanised Hindi (typed Hinglish), including trade words; none is also a common English word. */
const HINDI_ROMAN = set(`
  mujhe mujhko mera meri mere hamara hamari hamare aap aapka aapki aapke tum tumhara hum ham
  hai hain tha thi hoga hogi hoge chahiye chaiye chahie kya kyaa kitna kitne kitni kaun kab kahan kaise kyun kyon
  nahi nahin nhi haan haa han ji aur ka ki ke ko se mein mai par bhi toh abhi jaldi wala wali wale
  yeh ye woh wo karo kar kariye kijiye dijiye dena dedo de bolo batao bataiye bhai bhaiya theek thik
  accha achha acha achcha chalo paisa paise baaki baki bacha bache rupaye rupaiye haal mangao mangwa
  chawal chaawal cheeni chini aata atta tel daal
`);

/** Common romanised Kannada (typed Kanglish), including trade words and number words. */
const KANNADA_ROMAN = set(`
  nanage nange nanna nannu namma nimma nimge neevu naanu avru avaru
  beku beda bedi ide idhe ideya illa illva ilva alli illi elli enu yenu enri yaake yake yaaru yaru eshtu estu
  hege hegide maadi madi maadu maadtini kodi kodu kottu kotru kodtini helu heli haudu houdu howdu hoon
  sari aaytu aytu swalpa tumba nodi nodtini gottu gothilla banni barutte bandide ge alli inda
  akki sakkare bele enne hittu
  ondu eradu mooru muru naalku nalku aidu hattu nooru nuru innooru innuru saavira savira
`);

/** Marathi's own everyday words; Devanagari with more of these than of HINDI_MARKERS is Marathi. */
const MARATHI_MARKERS = set("मला आहे आहेत नाही पाहिजे हवे हवं काय आणि तुम्ही आम्ही माझा माझी माझे झाले झाला करा द्या किती कधी कुठे दोनशे तांदूळ");
const HINDI_MARKERS = set("मुझे मेरा मेरी मेरे है हैं था थी चाहिए क्या नहीं और का की के को में से कितना कितने कितनी कब कहाँ दीजिए करो दो");

const tokensOf = (text) =>
  String(text ?? "")
    .normalize("NFC")
    .split(/[^\p{L}\p{M}\p{N}'-]+/u)
    .map((t) => t.replace(/^[-']+|[-']+$/g, ""))
    .filter(Boolean);

/**
 * The dominant language of one utterance: `{language, scores}`. `language` is a BCP-47 code
 * (hi-IN, kn-IN, en-IN, mr-IN, ta-IN, te-IN, ml-IN, bn-IN, gu-IN, pa-IN, or-IN), or null when
 * nothing in the text decides it (empty, numbers, "ok", a bare name).
 */
function detectLanguage(text) {
  const scores = {};
  const add = (language, weight) => (scores[language] = (scores[language] ?? 0) + weight);
  let englishWords = 0;
  let marathi = 0;
  let hindi = 0;
  for (const token of tokensOf(text)) {
    const script = scriptOf(token);
    if (!script) continue;
    if (script !== "Latin") {
      add(SCRIPT_LANGUAGE[script], INDIC_WEIGHT);
      if (script === "Devanagari") {
        if (MARATHI_MARKERS.has(token)) marathi++;
        if (HINDI_MARKERS.has(token)) hindi++;
      }
      continue;
    }
    const word = token.toLowerCase();
    if (NEUTRAL.has(word)) continue;
    if (HINDI_ROMAN.has(word)) add("hi-IN", ROMAN_WEIGHT);
    else if (KANNADA_ROMAN.has(word)) add("kn-IN", ROMAN_WEIGHT);
    else if (ENGLISH.has(word)) {
      add("en-IN", LIST_WEIGHT);
      englishWords++;
    } else add("en-IN", OTHER_LATIN_WEIGHT);
  }
  // Borrowed nouns alone (a name, "basmati rice") do not make a sentence English.
  if (!englishWords) delete scores["en-IN"];
  if (scores["hi-IN"] && marathi > hindi) {
    scores["mr-IN"] = (scores["mr-IN"] ?? 0) + scores["hi-IN"];
    delete scores["hi-IN"];
  }
  let language = null;
  for (const [code, score] of Object.entries(scores)) {
    const best = language ? scores[language] : 0;
    if (score > best || (score === best && language === "en-IN")) language = code;
  }
  return { language, scores };
}

/** The language a tool's `say` can be written in for `language`, or null (no templates for it). */
function templateLanguage(language) {
  return TEMPLATE_LANGUAGES.includes(language) ? language : null;
}

const OWNER_SOURCES = new Set(["asr", "message"]);
const isOwnerTurn = (item) => item?.role === "user" && OWNER_SOURCES.has(item?.metadata?.source) && typeof item.content === "string" && item.content.trim() !== "";
/** The agent's own LLM words (not a tool call, not a /speak line, not the greeting). */
const isAgentReply = (item) =>
  item?.role === "assistant" && !["command", "greeting"].includes(item?.metadata?.source) && typeof item.content === "string" && item.content.trim() !== "";

/**
 * The language of the owner's latest turn that decides one, from an Agora /history `contents`
 * array (verified shape: owner speech is role "user" with metadata.source "asr", a typed turn
 * "message"). Returns `{language, text, latest, answered}` or null:
 * - latest: the deciding turn is the owner's newest turn (false when a newer turn was neutral, "ok");
 * - answered: the agent already replied in words after the owner's newest turn, so /history may
 *   not hold the turn being answered now (it lags the transcript by about 0.5 s).
 */
function ownerLanguage(contents) {
  if (!Array.isArray(contents)) return null;
  const owner = [];
  contents.forEach((item, index) => isOwnerTurn(item) && owner.push(index));
  if (!owner.length) return null;
  const newest = owner.at(-1);
  const answered = contents.slice(newest + 1).some(isAgentReply);
  for (const index of owner.slice(-LOOK_BACK).reverse()) {
    const text = contents[index].content.trim();
    const { language } = detectLanguage(text);
    if (language) return { language, text, latest: index === newest, answered };
  }
  return null;
}

/* ------------------------------------------------------- per-call state --- */

const defaults = () => ({
  history: (agentId) => require("./agent").history(agentId, { timeoutMs: HISTORY_TIMEOUT_MS }),
});
let settings = defaults();
/**
 * agentId -> the /history read in flight: tool calls that start together (one turn) share it.
 * Nothing is kept once it settles, so every later tool call reads the owner's newest words.
 */
const inFlight = new Map();
/** businessId -> {language, template}: the language the owner last spoke in, for the narrator. */
const heard = new Map();

/** Tests replace the /history reader; configure(null) restores it. Either way everything is forgotten. */
function configure(options) {
  settings = options ? { ...defaults(), ...options } : defaults();
  inFlight.clear();
  heard.clear();
}

function readHistory(agentId) {
  const pending = inFlight.get(agentId);
  if (pending) return pending;
  const promise = Promise.resolve()
    .then(() => settings.history(agentId))
    .finally(() => inFlight.get(agentId) === promise && inFlight.delete(agentId));
  inFlight.set(agentId, promise);
  return promise;
}

function remember(businessId, language) {
  if (businessId && language) heard.set(businessId, { language, template: templateLanguage(language) });
}

/** The language the owner of `businessId` last spoke in, `{language, template}`, or null. For the narrator. */
function lastOwnerLanguage(businessId) {
  return heard.get(businessId) ?? null;
}

/**
 * The language a tool's `say` should be in: `{language, source, contents}` with source
 * - "owner": the owner's own latest words in this call (/history), whatever the model passed;
 * - "model": the model's reply_language, when the owner's words cannot decide (no call, a neutral
 *   "ok", /history unreachable, the turn may be stale, or a language without say templates);
 * - "remembered": the language this business's owner last spoke in;
 * - null: nothing known (the caller uses the business language).
 * `contents` is the /history read (or null), for agent.withHistorySnapshot: the tool's own first
 * read reuses it instead of a second round trip.
 * Never throws: a failed /history read only drops to the next source.
 * @param {{businessId: string, agentId?: string|null}} ctx
 * @param {string|null|undefined} modelLanguage  the tool call's reply_language
 */
async function resolveReplyLanguage(ctx, modelLanguage) {
  const model = templateLanguage(modelLanguage);
  let contents = null;
  if (ctx?.agentId) {
    try {
      contents = await readHistory(ctx.agentId);
    } catch {
      contents = null;
    }
    const turn = ownerLanguage(contents);
    if (turn) {
      const template = templateLanguage(turn.language);
      if (!turn.answered) {
        remember(ctx.businessId, turn.language);
        if (template) return { language: template, source: "owner", contents };
      } else if (!model && template) {
        remember(ctx.businessId, turn.language);
        return { language: template, source: "owner", contents };
      }
    }
  }
  if (model) return { language: model, source: "model", contents };
  const last = heard.get(ctx?.businessId)?.template;
  return last ? { language: last, source: "remembered", contents } : { language: null, source: null, contents };
}

module.exports = {
  detectLanguage,
  templateLanguage,
  ownerLanguage,
  resolveReplyLanguage,
  lastOwnerLanguage,
  configure,
  TEMPLATE_LANGUAGES,
  HISTORY_TIMEOUT_MS,
};
