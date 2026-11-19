"use strict";

/**
 * The owner's choices about their agent: speaking speed, bargaining style and language.
 * The language is the business's own (businesses.language), so the read-back, the disclosure and
 * this profile can never disagree; the other two live in agent_profiles, defaults when absent.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const { AgentError } = require("./errors");

const VOICE_SPEEDS = ["slow", "normal"];
const BARGAIN_STYLES = ["gentle", "balanced", "tough"];
const LANGUAGES = ["hi-IN", "kn-IN", "en-IN"];
const DEFAULTS = Object.freeze({ voice_speed: "normal", bargain_style: "balanced" });
const ALLOWED = { voice_speed: VOICE_SPEEDS, bargain_style: BARGAIN_STYLES, language: LANGUAGES };

function get(businessId) {
  const business = repo.getBusiness(businessId);
  if (!business) throw new AgentError("NOT_FOUND", "No such business.");
  const row = repo.getAgentProfile(businessId) ?? DEFAULTS;
  return { business_id: businessId, voice_speed: row.voice_speed, bargain_style: row.bargain_style, language: business.language };
}

/** Change some of voice_speed, bargain_style, language. Anything else, or nothing, is INVALID. */
function update(businessId, patch, { sessionId = null } = {}) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).length === 0) {
    throw new AgentError("INVALID", "Send at least one of voice_speed, bargain_style, language.");
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED[key]) throw new AgentError("INVALID", `${key} is not part of the profile.`);
    if (!ALLOWED[key].includes(value)) throw new AgentError("INVALID", `${key} must be one of: ${ALLOWED[key].join(", ")}.`);
  }
  const current = get(businessId);
  const next = { ...current, ...patch };
  return db.transaction(() => {
    repo.saveAgentProfile(businessId, next);
    if (next.language !== current.language) repo.updateBusiness(businessId, { language: next.language });
    const profile = get(businessId);
    events.emit(businessId, "profile.updated", { profile }, { sessionId, actor: "owner" });
    return profile;
  });
}

module.exports = { get, update, VOICE_SPEEDS, BARGAIN_STYLES, LANGUAGES, DEFAULTS };
