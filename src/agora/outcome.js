"use strict";

/**
 * The server says the result of a confirmed action itself (E2E full run, bug 1: after a spoken yes
 * the model said "बिल बन गया" / "लिख लिया" while nothing had been issued or recorded).
 *
 * After a confirm tool (confirm_invoice, record_payment with a decision, confirm_approval,
 * confirm_rule, confirm_reorder) has changed the record, the tool calls settle(): the outcome line,
 * built from the stored record and followed by a short hand-back question, goes into the call as one
 * /speak piece (APPEND, not interruptable), and the model gets an empty `say`, so it never speaks on
 * top of the server's line (Murf allows 2 streams). So what the owner hears about the result
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

/** The model's late confirm call after the server already acted and spoke (registry.callTool): it only hands back. */
const DONE_HINT =
  "The server has already said this result aloud to the owner, from the stored record. Say only `say`; never repeat, change or add to the result.";

const SPOKEN_HINT =
  "The server has already said this result aloud to the owner, from the stored record, and asked what else they need. `say` is empty: say nothing now, no words at all; never repeat, change or add to the result. Wait for the owner.";

/**
 * After the server read something out and asked its yes/no question itself (a deal, a bill, a
 * payment, an item's tax, a rule, the usual quantity): the model says nothing. Its own line on top
 * of the server's read-back would be one Murf stream too many (live check 129a071 stall), and the
 * question is already in the read-back.
 */
const SILENT_HINT =
  "The server has read this out to the owner and asked the yes/no question itself. `say` is empty: say nothing now, no words at all, not even the question, and never repeat a figure. Wait for the owner's answer.";

/** A read-back tool's result once the server has spoken the read-back with its question: empty `say`, the silent hint and where the answer goes. */
function waitForOwner(result, next) {
  return { ...result, ...(next ? { next } : {}), hint: `${SILENT_HINT}${next ? ` Their yes or no goes to ${next}.` : ""}`, say: "" };
}

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
 * A confirm tool's result after the record changed: the server speaks `text` followed by the
 * hand-back line, and the model gets an empty `say`; off a call (or when speaking fails) the
 * model gets `text` to say.
 */
async function settle(ctx, text, language, result = {}) {
  // The hand-back goes in the same /speak piece as the result: the model says nothing on top of it.
  const spoken = await announce(ctx, `${text} ${HAND_BACK[langKey(language)]}`);
  if (!spoken) return { ...result, outcome: text, outcomeSpoken: false, say: text };
  return { ...result, outcome: text, outcomeSpoken: true, hint: SPOKEN_HINT, say: "" };
}

/** "Not done yet" followed by the gate's own reason, in one line. */
const notDone = (language, reason) => `${NOT_DONE[langKey(language)]} ${String(reason ?? "").trim()}`.trim();

/** Tests: replace /speak. Pass null to restore it. */
function configure({ speak } = {}) {
  if (speak !== undefined) speakImpl = speak ?? ((agentId, text) => require("./agent").speak(agentId, text, { priority: "APPEND", interruptable: false }));
}

module.exports = { announce, settle, waitForOwner, notDone, configure, HAND_BACK, NOT_DONE, SPOKEN_HINT, SILENT_HINT, DONE_HINT };
