"use strict";

/**
 * Rules the owner teaches Sahay ("never pay more than 80 for rice") or Sahay suggests from what
 * the owner does. A rule is structured (one of KINDS, params checked here) and can only narrow
 * what Sahay does: a lower price ceiling, a vendor avoided or preferred on a tie, a quantity to
 * offer, a reply language, a bargaining pace. No rule can place an order, accept a rate or stand
 * in for the owner's yes; those go through src/approvals.js and nothing here calls it.
 *
 * A rule starts "suggested" and becomes "active" only by the owner: the ✓ button, or a spoken yes
 * that answers the sentence the server itself read out. Typed text never activates one.
 * The sentence the owner sees and hears is built here from the params, in all three languages.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const approvals = require("../approvals");
const { vendorText, VENDOR_TEXT_MAX } = require("../db/vendor-text");
const { canonicalUnit, unitWord } = require("../procurement/units");
const { AgentError } = require("./errors");
const { itemIn } = require("../discovery/slug");

const LANGS = ["hi-IN", "kn-IN", "en-IN"];
const SOURCES = ["owner_said", "learned"];
const BARGAIN_STYLES = ["gentle", "balanced", "tough"];
const STATUSES = ["suggested", "active", "off"];
const PRICE_MAX = 10_000_000;
const QUANTITY_MAX = 10_000_000;
const WHY_MAX = 300;

const invalid = (message) => new AgentError("INVALID_RULE", message);
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => String(round2(n));
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * An item as said in a sentence of `language`: in the sentence's own script when the trade-word
 * table knows it ("बासमती चावल" in a Kannada sentence is "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ"), else as the owner said it
 * (E2E full run: a Kannada rule sentence carried the Devanagari item name). Never transliterated.
 */
const itemFor = (item, language) => (language === "en-IN" ? item : itemIn(item, language) ?? item);

/* --------------------------------------------------------------- params --- */

/** Owner- or vendor-said text (an item, a vendor name): sanitised, then at most 80 characters. */
function cleanName(value, field) {
  if (typeof value !== "string") throw invalid(`${field} is required.`);
  const clean = vendorText(value, Number.MAX_SAFE_INTEGER);
  if (!clean || !HAS_LETTER_OR_DIGIT.test(clean)) throw invalid(`${field} is required.`);
  if ([...clean].length > VENDOR_TEXT_MAX) throw invalid(`${field} is at most ${VENDOR_TEXT_MAX} characters.`);
  return clean;
}

function cleanAmount(value, field, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
    throw invalid(`${field} must be a number above zero.`);
  }
  return round2(value);
}

function cleanUnit(value) {
  const unit = typeof value === "string" ? canonicalUnit(value) : null;
  if (!unit) throw invalid("unit must be a unit Sahay knows, such as kg, litre, piece or bag.");
  return unit;
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw invalid(`${field} must be one of: ${allowed.join(", ")}.`);
  return value;
}

/** Folded form of a name, for "is this the same item / vendor". */
const fold = (text) => String(text).normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

const LANGUAGE_NAME = {
  "hi-IN": { "hi-IN": "हिंदी", "kn-IN": "कन्नड़", "en-IN": "अंग्रेज़ी" },
  "kn-IN": { "hi-IN": "ಹಿಂದಿಯಲ್ಲಿ", "kn-IN": "ಕನ್ನಡದಲ್ಲಿ", "en-IN": "ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ" },
  "en-IN": { "hi-IN": "Hindi", "kn-IN": "Kannada", "en-IN": "English" },
};

const STYLE_WORDS = {
  gentle: { "hi-IN": "मैं नरमी से मोल-भाव करूँगी।", "kn-IN": "ನಾನು ಮೃದುವಾಗಿ ಚೌಕಾಸಿ ಮಾಡುತ್ತೇನೆ.", "en-IN": "I will bargain gently." },
  balanced: { "hi-IN": "मैं संतुलित तरीके से मोल-भाव करूँगी।", "kn-IN": "ನಾನು ಸಮತೋಲನದಿಂದ ಚೌಕಾಸಿ ಮಾಡುತ್ತೇನೆ.", "en-IN": "I will bargain at a steady pace." },
  tough: { "hi-IN": "मैं सख़्ती से मोल-भाव करूँगी।", "kn-IN": "ನಾನು ಗಟ್ಟಿಯಾಗಿ ಚೌಕಾಸಿ ಮಾಡುತ್ತೇನೆ.", "en-IN": "I will bargain hard." },
};

/**
 * Each kind: `fields` (exactly these params), `clean(params)` -> stored params, `scope(params)` ->
 * what the rule is about (one active rule per scope), `sentence(params)` -> {hi-IN, kn-IN, en-IN}.
 * Preferring and avoiding the same vendor share a scope, so the newer kept one wins.
 */
const KINDS = {
  max_price: {
    fields: ["item", "unit", "price"],
    clean: (p) => ({ item: cleanName(p.item, "item"), unit: cleanUnit(p.unit), price: cleanAmount(p.price, "price", PRICE_MAX) }),
    scope: (p) => `max_price:${fold(p.item)}`,
    sentence: (p) => ({
      "hi-IN": `मैं ${itemFor(p.item, "hi-IN")} के लिए प्रति ${unitWord(p.unit, "hi-IN")} ${money(p.price)} रुपये से ज़्यादा कभी नहीं दूँगी।`,
      "kn-IN": `${itemFor(p.item, "kn-IN")}: ಪ್ರತಿ ${unitWord(p.unit, "kn-IN")} ${money(p.price)} ರೂಪಾಯಿಗಿಂತ ಹೆಚ್ಚು ನಾನು ಎಂದಿಗೂ ಕೊಡುವುದಿಲ್ಲ.`,
      "en-IN": `I will never pay more than ${money(p.price)} rupees per ${unitWord(p.unit, "en-IN")} for ${p.item}.`,
    }),
  },
  prefer_vendor: {
    fields: ["name"],
    clean: (p) => ({ name: cleanName(p.name, "name") }),
    scope: (p) => `vendor:${fold(p.name)}`,
    sentence: (p) => ({
      "hi-IN": `भाव बराबर हों तो मैं पहले ${p.name} को चुनूँगी।`,
      "kn-IN": `ಬೆಲೆ ಸಮವಾಗಿದ್ದರೆ ನಾನು ಮೊದಲು ${p.name} ಅವರನ್ನು ಆಯ್ಕೆ ಮಾಡುತ್ತೇನೆ.`,
      "en-IN": `When prices are equal, I will choose ${p.name} first.`,
    }),
  },
  avoid_vendor: {
    fields: ["name"],
    clean: (p) => ({ name: cleanName(p.name, "name") }),
    scope: (p) => `vendor:${fold(p.name)}`,
    sentence: (p) => ({
      "hi-IN": `मैं ${p.name} से कभी नहीं खरीदूँगी।`,
      "kn-IN": `ನಾನು ${p.name} ಅವರಿಂದ ಎಂದಿಗೂ ಖರೀದಿಸುವುದಿಲ್ಲ.`,
      "en-IN": `I will never buy from ${p.name}.`,
    }),
  },
  usual_quantity: {
    fields: ["item", "quantity", "unit"],
    clean: (p) => ({ item: cleanName(p.item, "item"), quantity: cleanAmount(p.quantity, "quantity", QUANTITY_MAX), unit: cleanUnit(p.unit) }),
    scope: (p) => `usual_quantity:${fold(p.item)}`,
    sentence: (p) => {
      const many = p.quantity !== 1;
      return {
        "hi-IN": `आप ${itemFor(p.item, "hi-IN")} की मात्रा न बताएँ, तो मैं आपसे पूछूँगी कि क्या ${money(p.quantity)} ${unitWord(p.unit, "hi-IN", many)} चाहिए।`,
        "kn-IN": `${itemFor(p.item, "kn-IN")} ಎಷ್ಟು ಎಂದು ನೀವು ಹೇಳದಿದ್ದರೆ, ${money(p.quantity)} ${unitWord(p.unit, "kn-IN", many)} ಬೇಕೇ ಎಂದು ನಾನು ಕೇಳುತ್ತೇನೆ.`,
        "en-IN": `When you do not say how much ${p.item}, I will ask if you want ${money(p.quantity)} ${unitWord(p.unit, "en-IN", many)}.`,
      };
    },
  },
  reply_language: {
    fields: ["language"],
    clean: (p) => ({ language: oneOf(p.language, LANGS, "language") }),
    scope: () => "reply_language",
    sentence: (p) => ({
      "hi-IN": `मैं आपको हमेशा ${LANGUAGE_NAME["hi-IN"][p.language]} में जवाब दूँगी।`,
      "kn-IN": `ನಾನು ನಿಮಗೆ ಯಾವಾಗಲೂ ${LANGUAGE_NAME["kn-IN"][p.language]} ಉತ್ತರಿಸುತ್ತೇನೆ.`,
      "en-IN": `I will always reply to you in ${LANGUAGE_NAME["en-IN"][p.language]}.`,
    }),
  },
  bargain_style: {
    fields: ["style"],
    clean: (p) => ({ style: oneOf(p.style, BARGAIN_STYLES, "style") }),
    scope: () => "bargain_style",
    sentence: (p) => ({ ...STYLE_WORDS[p.style] }),
  },
  // STK: when stock of the item falls to `level` (in `unit`) or below, Sahay asks whether to buy more.
  // It only asks: buying still goes through the owner's yes, sourcing and the approval gate.
  reorder_level: {
    fields: ["item", "level", "unit"],
    clean: (p) => ({ item: cleanName(p.item, "item"), level: cleanAmount(p.level, "level", QUANTITY_MAX), unit: cleanUnit(p.unit) }),
    scope: (p) => `reorder_level:${require("../stock/items").nameKey(p.item) || fold(p.item)}`,
    sentence: (p) => {
      const many = p.level !== 1;
      return {
        "hi-IN": `जब ${itemFor(p.item, "hi-IN")} ${money(p.level)} ${unitWord(p.unit, "hi-IN", many)} या उससे कम बचेगा, मैं आपसे पूछूँगी कि और मँगाऊँ या नहीं।`,
        "kn-IN": `${itemFor(p.item, "kn-IN")} ${money(p.level)} ${unitWord(p.unit, "kn-IN", many)} ಅಥವಾ ಅದಕ್ಕಿಂತ ಕಡಿಮೆ ಉಳಿದಾಗ, ಇನ್ನಷ್ಟು ತರಿಸಲೇ ಎಂದು ನಾನು ನಿಮ್ಮನ್ನು ಕೇಳುತ್ತೇನೆ.`,
        "en-IN": `When ${p.item} is down to ${money(p.level)} ${unitWord(p.unit, "en-IN", many)} or less, I will ask you whether to buy more.`,
      };
    },
  },
};

/** Checked, cleaned params and everything built from them. Throws INVALID_RULE. */
function buildRule(kind, params) {
  const spec = Object.hasOwn(KINDS, kind) ? KINDS[kind] : null;
  if (!spec) throw invalid(`kind must be one of: ${Object.keys(KINDS).join(", ")}.`);
  if (params === null || typeof params !== "object" || Array.isArray(params)) throw invalid("params must be an object.");
  const extra = Object.keys(params).filter((key) => !spec.fields.includes(key));
  if (extra.length) throw invalid(`A ${kind} rule takes only ${spec.fields.join(", ")}.`);
  const clean = spec.clean(params);
  return { kind, params: clean, scope_key: spec.scope(clean), sentence: spec.sentence(clean) };
}

function cleanWhy(why) {
  if (why == null) return null;
  if (typeof why !== "object" || Array.isArray(why) || Object.keys(why).length !== LANGS.length) throw invalid("why has one sentence per language.");
  const out = {};
  for (const language of LANGS) {
    const text = why[language];
    if (typeof text !== "string" || !text.trim() || text.length > WHY_MAX) throw invalid(`why needs a ${language} sentence of at most ${WHY_MAX} characters.`);
    out[language] = text.trim();
  }
  return out;
}

/* ---------------------------------------------------------------- shape --- */

/** The contract shape (plan "Contract": Rule). */
function toRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    params: row.params,
    sentence: { "hi-IN": row.sentence_hi, "kn-IN": row.sentence_kn, "en-IN": row.sentence_en },
    why: row.why_en == null ? null : { "hi-IN": row.why_hi, "kn-IN": row.why_kn, "en-IN": row.why_en },
    status: row.status,
    source: row.source,
    created_at: row.created_at,
    decided_at: row.decided_at ?? null,
  };
}

const get = (businessId, ruleId) => toRule(repo.getRule(businessId, ruleId));

function list(businessId, { status } = {}) {
  if (status !== undefined && !STATUSES.includes(status)) throw invalid(`status must be one of: ${STATUSES.join(", ")}.`);
  return repo.listRules(businessId, { status }).map(toRule);
}

const active = (businessId) => list(businessId, { status: "active" });

/* ------------------------------------------------------------ lifecycle --- */

/**
 * A new suggested rule. A suggestion still waiting about the same thing (same scope) is replaced:
 * it goes off, so the owner is only ever asked about the latest one.
 */
function propose(businessId, { kind, params, source, why } = {}, { sessionId = null } = {}) {
  const built = buildRule(kind, params);
  const reason = cleanWhy(why);
  if (!SOURCES.includes(source)) throw invalid(`source must be one of: ${SOURCES.join(", ")}.`);
  return db.transaction(() => {
    for (const old of repo.listRules(businessId, { status: "suggested", scope_key: built.scope_key })) {
      repo.transitionRule(businessId, old.id, "suggested", "off");
      events.emit(businessId, "rule.decided", { rule: get(businessId, old.id), reason: "replaced" }, { sessionId, actor: "system" });
    }
    const rule = toRule(repo.createRule(businessId, { ...built, why: reason, source }));
    events.emit(businessId, "rule.suggested", { rule }, { sessionId, actor: source === "learned" ? "system" : "agent" });
    return rule;
  });
}

/**
 * The server spoke `text` (this rule's sentence, or an active usual_quantity rule's offer) into
 * the owner's call through `agentId`. Only a rule spoken here can be kept by voice.
 */
function recordSpoken(businessId, ruleId, { agentId, text, sessionId = null }) {
  return db.transaction(() => {
    const rule = repo.getRule(businessId, ruleId);
    if (!rule) throw new AgentError("RULE_NOT_FOUND", "There is no such rule for this business.");
    const row = repo.recordRuleReadback(businessId, ruleId, { agent_id: agentId, spoken_text: text });
    events.emit(businessId, "rule.spoken", { ruleId }, { sessionId, actor: "agent" });
    return row;
  });
}

/** The suggested rule whose sentence this call's agent spoke last, or null. */
function lastSpokenSuggestion(businessId, agentId) {
  if (!agentId) return null;
  const spoken = repo.listRuleReadbacks(businessId, { agent_id: agentId });
  for (let i = spoken.length - 1; i >= 0; i--) {
    const rule = repo.getRule(businessId, spoken[i].rule_id);
    if (rule?.status === "suggested") return toRule(rule);
  }
  return null;
}

/**
 * The suggestion this call's agent already read out that says exactly the same thing as
 * {kind, params}, or null. Proposing it again would replace it with a new rule and throw away the
 * owner's yes to it (E2E full run: the first हाँ "replaced" the rule, a second हाँ was needed).
 */
function spokenTwin(businessId, agentId, { kind, params } = {}) {
  if (!agentId) return null;
  let built;
  try {
    built = buildRule(kind, params);
  } catch {
    return null;
  }
  const same = JSON.stringify(built.params);
  const spokenIds = new Set(repo.listRuleReadbacks(businessId, { agent_id: agentId }).map((row) => row.rule_id));
  const twin = repo
    .listRules(businessId, { status: "suggested", scope_key: built.scope_key })
    .filter((row) => spokenIds.has(row.id) && JSON.stringify(row.params) === same)
    .at(-1);
  return twin ? toRule(twin) : null;
}

/**
 * The owner's spoken words since the server read this rule out in this call (the same ordering
 * check as a deal's read-back), whatever they are; throws when there is no answer yet.
 */
function spokenAnswer(businessId, ruleId, { agentId, history }) {
  const spoken = agentId ? repo.listRuleReadbacks(businessId, { rule_id: ruleId, agent_id: agentId }).map((row) => row.spoken_text) : [];
  return approvals.answerAfterSpoken(businessId, history, { agentId, spoken, subject: { ruleId } }).text;
}

/**
 * The owner's spoken answer to what the server read out for this rule in this call: a clear yes
 * that comes after it (approvals.answerAfterSpoken, the same ordering check as a deal's read-back).
 * `history` is the call's Agora /history contents, fetched by the caller (never the model's words).
 * Returns the owner's words; throws otherwise.
 */
function spokenYes(businessId, ruleId, { agentId, history }) {
  const spoken = agentId ? repo.listRuleReadbacks(businessId, { rule_id: ruleId, agent_id: agentId }).map((row) => row.spoken_text) : [];
  const { text } = approvals.answerAfterSpoken(businessId, history, { agentId, spoken, subject: { ruleId } });
  if (approvals.classifyUtterance(text) !== "affirmative") {
    throw new AgentError("NOT_AFFIRMATIVE", "The owner's reply was not a clear yes; the rule is still waiting.");
  }
  return text;
}

/**
 * The owner keeps or forgets a rule. `via` is "button" (the ✓ / ✕ on the rule card) or "voice".
 * By voice, keeping needs a clear yes that answers the rule sentence the server spoke in this
 * call (spokenYes; the database also refuses a voice keep with no read-back on record), and
 * forgetting needs the owner's own last words not to be a yes. Keeping a rule turns off the
 * active rule about the same thing. Deciding again the way it is already decided returns the
 * rule unchanged (a second tab); keeping a forgotten rule is refused.
 */
function decide(businessId, ruleId, decision, { via, agentId = null, history, sessionId = null } = {}) {
  if (decision !== "keep" && decision !== "forget") throw new AgentError("INVALID_DECISION", 'decision is "keep" or "forget".');
  if (via !== "button" && via !== "voice") throw new AgentError("INVALID_VIA", 'via is "button" or "voice".');
  if (via === "voice" && !Array.isArray(history)) throw new AgentError("EVIDENCE_REQUIRED", "A spoken decision on a rule needs the call history as evidence.");

  return db.transaction(() => {
    const rule = repo.getRule(businessId, ruleId);
    if (!rule) throw new AgentError("RULE_NOT_FOUND", "There is no such rule for this business.");
    let evidence = null;
    const emitDecided = (id, actor = "owner", extra = {}) =>
      events.emit(businessId, "rule.decided", { rule: get(businessId, id), via, ...(evidence ? { evidenceUtterance: evidence } : {}), ...extra }, { sessionId, actor });

    if (decision === "forget") {
      if (rule.status === "off") return toRule(rule);
      if (via === "voice") {
        evidence = approvals.lastOwnerWords(history);
        if (!evidence) throw new AgentError("EVIDENCE_REQUIRED", "A spoken decision needs the owner's words as evidence.");
        if (approvals.classifyUtterance(evidence) === "affirmative") throw new AgentError("NOT_NEGATIVE", "The owner's reply was a yes; the rule is not forgotten.");
      }
      repo.transitionRule(businessId, rule.id, rule.status, "off", { decided_via: via });
      emitDecided(rule.id);
      return get(businessId, rule.id);
    }

    if (rule.status === "active") return toRule(rule);
    if (rule.status === "off") throw new AgentError("RULE_ALREADY_DECIDED", "This rule was forgotten; teach it again to use it.");
    if (via === "voice") evidence = spokenYes(businessId, rule.id, { agentId, history });
    for (const older of repo.listRules(businessId, { status: "active", scope_key: rule.scope_key })) {
      repo.transitionRule(businessId, older.id, "active", "off");
      emitDecided(older.id, "system", { reason: "replaced" });
    }
    repo.transitionRule(businessId, rule.id, "suggested", "active", { decided_via: via });
    emitDecided(rule.id);
    return get(businessId, rule.id);
  });
}

module.exports = { propose, decide, recordSpoken, lastSpokenSuggestion, spokenTwin, spokenAnswer, spokenYes, get, list, active, buildRule, toRule, fold, KINDS, LANGS, BARGAIN_STYLES };
