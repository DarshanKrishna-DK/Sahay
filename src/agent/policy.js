"use strict";

/**
 * What the owner's active rules and profile mean for a decision Sahay makes in code. Every
 * function here can only narrow: a lower price ceiling, fewer vendors, a tie broken, a pace of
 * conceding within the same ceiling. None of them can order, accept a rate or approve anything.
 */

const repo = require("../db/repo");
const { rankVendors } = require("../procurement/scoring");
const { unitRatio } = require("../procurement/units");
const { itemIn } = require("../discovery/slug");
const rules = require("./rules");
const profile = require("./profile");

/** Concession curve exponent per bargaining style (strategy.nextBuyerOffer): higher holds firm longer. */
const BETA = Object.freeze({ gentle: 1, balanced: 2, tough: 3 });

const round2 = (n) => Math.round(n * 100) / 100;

/** The words of an item, the same across scripts when the trade-word table knows them ("rice" = "चावल"). */
function itemWords(item) {
  const text = String(item ?? "");
  return (itemIn(text, "hi-IN") ?? rules.fold(text)).split(" ").filter(Boolean);
}

/** A rule about `ruleItem` covers a need for `needItem` when every word of the rule's item is in it ("rice" covers "basmati rice"). */
function covers(ruleItem, needItem) {
  const want = itemWords(ruleItem);
  const have = new Set(itemWords(needItem));
  return want.length > 0 && want.every((word) => have.has(word));
}

const activeOf = (businessId, kind) => rules.active(businessId).filter((rule) => rule.kind === kind);

/**
 * The most Sahay may pay per unit of this requirement: the owner's stated max, or a stricter
 * max_price rule that covers the item (converted to the requirement's unit when the two have an
 * exact relation; a rule in kg says nothing about a price per bag). The rule also stands in when
 * the owner gave no max. `price` is null when neither exists.
 * @returns {{price: number|null, unit: string|null, byRule: boolean, ownerMax: number|null, ruleId: string|null}}
 */
function priceLimit(businessId, requirement) {
  const ownerMax = requirement?.max_price ?? null;
  let best = null;
  for (const rule of activeOf(businessId, "max_price")) {
    if (!covers(rule.params.item, requirement?.item)) continue;
    const ratio = unitRatio(requirement?.unit, rule.params.unit);
    if (ratio == null) continue;
    const price = round2(rule.params.price * ratio);
    if (!best || price < best.price) best = { price, ruleId: rule.id };
  }
  const byRule = Boolean(best) && (ownerMax == null || best.price < ownerMax);
  return { price: byRule ? best.price : ownerMax, unit: requirement?.unit ?? null, byRule, ownerMax, ruleId: byRule ? best.ruleId : null };
}

/** The bargaining style in force: an active bargain_style rule, else the profile. */
function bargainStyle(businessId) {
  return activeOf(businessId, "bargain_style").at(-1)?.params.style ?? profile.get(businessId).bargain_style;
}

const beta = (businessId) => BETA[bargainStyle(businessId)];

const vendorNames = (businessId, kind) => new Set(activeOf(businessId, kind).map((rule) => rules.fold(rule.params.name)));

function isAvoided(businessId, vendor) {
  return vendorNames(businessId, "avoid_vendor").has(rules.fold(vendor?.name ?? ""));
}

/**
 * The vendors of a requirement Sahay may deal with, best first: avoided vendors left out, a
 * preferred vendor first among an equal score. The order vendorRank counts in.
 */
function rankedVendors(businessId, requirement) {
  const avoid = vendorNames(businessId, "avoid_vendor");
  const prefer = vendorNames(businessId, "prefer_vendor");
  const vendors = repo.listVendors(businessId, { requirement_id: requirement.id }).filter((v) => !avoid.has(rules.fold(v.name)));
  return rankVendors(vendors, requirement, { preferred: (v) => prefer.has(rules.fold(v.name)) });
}

/** The active usual_quantity rule that covers this item, or null. */
function usualQuantity(businessId, item) {
  if (!item) return null;
  return activeOf(businessId, "usual_quantity").filter((rule) => covers(rule.params.item, item)).at(-1) ?? null;
}

/** The language an active reply_language rule fixes, or null. */
function replyLanguage(businessId) {
  return activeOf(businessId, "reply_language").at(-1)?.params.language ?? null;
}

module.exports = { priceLimit, beta, bargainStyle, isAvoided, rankedVendors, usualQuantity, replyLanguage, covers, itemWords, BETA };
