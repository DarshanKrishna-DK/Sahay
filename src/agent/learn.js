"use strict";

/**
 * Sahay learns from what the owner does, in code, from the business's own rows (never from a
 * model or a vendor's words):
 * - requirement.saved: the same maximum price for the same item on SUGGEST_AFTER needs becomes a
 *   suggested max_price rule (source "learned", with the reason in three languages). It is only a
 *   suggestion: the owner keeps it by the ✓ button or a spoken yes, like any rule.
 * - order.created: the memories (last price, usual items, liked vendors) are derived again.
 */

const repo = require("../db/repo");
const { unitWord } = require("../procurement/units");
const rules = require("./rules");
const memories = require("./memories");
const policy = require("./policy");

const SUGGEST_AFTER = 3;
/** A rule the owner turned off is not suggested again about the same item for this long. */
const QUIET_MS = 7 * 24 * 60 * 60 * 1000;

const money = (n) => String(Math.round(n * 100) / 100);
const sameItem = (a, b) => policy.itemWords(a).join(" ") === policy.itemWords(b).join(" ");

const WHY = {
  "hi-IN": (v) => `आपने ${v.count} बार ${v.item} के लिए प्रति ${v.unit} ${v.price} रुपये की सीमा रखी।`,
  "kn-IN": (v) => `${v.item}: ನೀವು ${v.count} ಬಾರಿ ಪ್ರತಿ ${v.unit} ${v.price} ರೂಪಾಯಿ ಮಿತಿ ಇಟ್ಟಿದ್ದೀರಿ.`,
  "en-IN": (v) => `You capped ${v.item} at ${v.price} rupees per ${v.unit} ${v.count} times.`,
};

/** Suggest a max_price rule when this need repeats a maximum price the owner set before. */
function maybeSuggestMaxPrice(businessId, need, now) {
  if (need?.max_price == null || !need.item || !need.unit) return null;
  const alike = repo
    .listRequirements(businessId)
    .filter((r) => r.max_price === need.max_price && r.unit === need.unit && r.item && sameItem(r.item, need.item));
  if (alike.length < SUGGEST_AFTER) return null;

  const about = rules.list(businessId).filter((r) => r.kind === "max_price" && sameItem(r.params.item, need.item));
  const quietSince = now.getTime() - QUIET_MS;
  const settled = about.some(
    (r) => r.status === "active" || r.status === "suggested" || (r.status === "off" && r.decided_at && Date.parse(r.decided_at) > quietSince),
  );
  if (settled) return null;

  const registry = require("../tools/registry");
  const why = Object.fromEntries(
    Object.entries(WHY).map(([language, line]) => [
      language,
      line({ count: alike.length, item: registry.spokenItem(businessId, need, language), unit: unitWord(need.unit, language), price: money(need.max_price) }),
    ]),
  );
  return rules.propose(businessId, { kind: "max_price", params: { item: need.item, unit: need.unit, price: need.max_price }, source: "learned", why });
}

/** Events subscriber (src/agent/index.js). `now` is for tests. */
function onEvent(event, { now = new Date() } = {}) {
  if (event.type === "requirement.saved") return maybeSuggestMaxPrice(event.businessId, event.data, now);
  if (event.type === "order.created") return memories.refresh(event.businessId, { sessionId: event.sessionId ?? null });
  return null;
}

module.exports = { onEvent, maybeSuggestMaxPrice, SUGGEST_AFTER, QUIET_MS };
