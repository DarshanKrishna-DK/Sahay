"use strict";

/**
 * The server says the result of a confirmed action itself (E2E full run, bug 1: after a spoken yes
 * the model said "बिल बन गया" / "लिख लिया" while nothing had been issued or recorded).
 *
 * After a confirm tool (confirm_invoice, record_payment with a decision, confirm_approval,
 * confirm_rule, confirm_reorder) has changed the record, the tool calls settle(): the outcome line,
 * built from the stored record, goes into the call through /speak (APPEND, not interruptable), and
 * the model only gets a short hand-back line as `say`. So what the owner hears about the result
 * comes from the server, never from the model's memory. When the line cannot be spoken, the model
 * gets the outcome as `say` (the old behaviour), so the owner still hears it once.
 */

const { langKey } = require("../tools/errors");

const HAND_BACK = {
  "hi-IN": "और कुछ बताइए?",
  "kn-IN": "ಇನ್ನೇನಾದರೂ ಬೇಕೇ?",
  "en-IN": "Anything else?",
};

/** Said before a gate's refusal when the owner's yes did not complete the action. */
const NOT_DONE = {
  "hi-IN": "अभी हुआ नहीं।",
  "kn-IN": "ಇನ್ನೂ ಆಗಿಲ್ಲ.",
  "en-IN": "That is not done yet.",
};

const SPOKEN_HINT =
  "The server has already said this result aloud to the owner, from the stored record. Say only `say`; never repeat, change or add to the result.";

let speakImpl = (agentId, text) => require("./agent").speak(agentId, text, { priority: "APPEND", interruptable: false });

/** Speak `text` into the call of ctx.agentId. Returns true when /speak took it, false otherwise (never throws). */
async function announce(ctx, text) {
  const line = String(text ?? "").trim();
  if (!ctx?.agentId || !line) return false;
  try {
    await speakImpl(ctx.agentId, line);
    // Follow-ups keep a gap after this line, so a reminder never lands on top of a result (E2E regress bug 2).
    if (ctx.businessId) require("./narrator").noteSpoken(ctx.businessId);
    return true;
  } catch (err) {
    console.warn(`[outcome] could not speak a result: ${err.message}`);
    return false;
  }
}

/**
 * A confirm tool's result after the record changed: the server speaks `text` and the model gets
 * the hand-back line; off a call (or when speaking fails) the model gets `text` to say.
 */
async function settle(ctx, text, language, result = {}) {
  const spoken = await announce(ctx, text);
  if (!spoken) return { ...result, outcome: text, outcomeSpoken: false, say: text };
  return { ...result, outcome: text, outcomeSpoken: true, hint: SPOKEN_HINT, say: HAND_BACK[langKey(language)] };
}

/** "Not done yet" followed by the gate's own reason, in one line. */
const notDone = (language, reason) => `${NOT_DONE[langKey(language)]} ${String(reason ?? "").trim()}`.trim();

/** Tests: replace /speak. Pass null to restore it. */
function configure({ speak } = {}) {
  if (speak !== undefined) speakImpl = speak ?? ((agentId, text) => require("./agent").speak(agentId, text, { priority: "APPEND", interruptable: false }));
}

module.exports = { announce, settle, notDone, configure, HAND_BACK, NOT_DONE, SPOKEN_HINT };
