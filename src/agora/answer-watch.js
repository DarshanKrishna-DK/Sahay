"use strict";

/**
 * The unanswered-turn watchdog (owner requirement 2026-11-20: "once the user starts to talk, the
 * agent has to answer ... without getting stuck without informing anything").
 *
 * While an owner call is live this reads the call's Agora /history every `pollMs`. When the owner's
 * latest turn (spoken, source "asr", or typed, source "message") has no spoken agent line after it
 * for `answerMs`, nothing has changed in /history for `settleMs`, no tool is running and no read-back
 * is waiting for a yes, the server speaks one line itself, once per turn:
 * - a tool already answered that turn but its `say` was never spoken (the model went quiet after a
 *   tool result or error): that `say`, as the tool built it;
 * - otherwise a short apology asking the owner to say it again, in the language of the owner's turn.
 *
 * It never decides anything and never answers a read-back: while a deal, bill, payment, rule or
 * reorder waits for the owner's yes (confirm-watch.readbackWaiting) it stays out, because any line
 * between the read-back and the answer makes the approval gate refuse the yes. A turn that may be
 * the agent's own voice heard back (confirm-watch.possibleEcho) is left alone.
 *
 * Shapes used (agora-findings.md, all verified live in S0): /history items `role:"user"` with
 * `metadata.source` "asr" | "message"; agent lines `role:"assistant"` with string `content`
 * (source llm, command); tool items `role:"tool"` with `content` (the MCP text result). /speak with
 * `priority:"APPEND"`, interruptable: if the model's reply is still playing (when Agora writes the
 * assistant item into /history relative to its audio is not documented), the line waits for it
 * instead of cutting it off. UNVERIFIED live: a turn the agent is stuck inside (live check 129a071)
 * would hold an APPEND line back; INTERRUPT would free it but could cut a real answer.
 *
 * Started once from server.js; it only ever looks at calls the narrator has attached.
 */

const events = require("../events");
const toolCalls = require("../tools/calls");
const { langKey } = require("../tools/errors");

const settings = { pollMs: 2000, answerMs: 10000, settleMs: 4000, historyTimeoutMs: 2500 };

const SORRY = {
  "hi-IN": "माफ़ कीजिए, इसका जवाब अभी नहीं दे पाई। कृपया एक बार फिर बोलिए।",
  "kn-IN": "ಕ್ಷಮಿಸಿ, ಇದಕ್ಕೆ ಈಗ ಉತ್ತರ ಕೊಡಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಇನ್ನೊಮ್ಮೆ ಹೇಳಿ.",
  "en-IN": "Sorry, I couldn't answer that just now. Please say it once more.",
};

const OWNER_SOURCES = new Set(["asr", "message"]);
const isOwnerTurn = (item) => item?.role === "user" && OWNER_SOURCES.has(item?.metadata?.source) && typeof item.content === "string" && item.content.trim() !== "";

const fold = (text) => String(text ?? "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
let fillerSet = null;
/** Agora's own static filler phrases (src/agora/agent.js): a filler is not an answer. */
function isFiller(text) {
  if (!fillerSet) fillerSet = new Set(Object.values(require("./agent").FILLER_PHRASES).flat().map(fold));
  return fillerSet.has(fold(text));
}

/** A line the owner heard from the agent: the model's words or a server /speak line, not a filler. */
const isSpokenLine = (item) =>
  item?.role === "assistant" && typeof item.content === "string" && item.content.trim() !== "" && item?.metadata?.source !== "greeting" && !isFiller(item.content);

/** The `say` of a tool result item (MCP text result, or the JSON inside it), or null. */
function toolSay(item) {
  if (item?.role !== "tool") return null;
  let value = item.content;
  for (let depth = 0; depth < 3 && typeof value === "string"; depth++) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value?.content) && typeof value.content[0]?.text === "string") return toolSay({ role: "tool", content: value.content[0].text });
  return typeof value?.say === "string" && value.say.trim() ? value.say.trim() : null;
}

/**
 * Look at one /history: the owner's newest turn and what came after it.
 * Returns null when there is no owner turn, else {index, key, answered, toolSay}.
 */
function latestTurn(history) {
  let index = history.length - 1;
  while (index >= 0 && !isOwnerTurn(history[index])) index--;
  if (index < 0) return null;
  const turn = history[index];
  const after = history.slice(index + 1);
  const says = after.map(toolSay).filter(Boolean);
  return {
    index,
    key: Number.isFinite(turn.turn_id) ? `turn:${turn.turn_id}` : `at:${index}:${fold(turn.content)}`,
    answered: after.some(isSpokenLine),
    toolSay: says.length ? says[says.length - 1] : null,
  };
}

let historyImpl = (agentId) => require("./agent").history(agentId, { timeoutMs: settings.historyTimeoutMs });
let speakImpl = (agentId, text) => require("./agent").speak(agentId, text, { priority: "APPEND", interruptable: true });
let liveImpl = () => require("./narrator").liveCalls();
let readbackImpl = (businessId, agentId) => require("./confirm-watch").readbackWaiting(businessId, agentId);
let clock = () => Date.now();

/** businessId -> { agentId, busy, turn: {key, since, length, changedAt} | null, acted: Set(key) } */
const watching = new Map();

/**
 * One look at one live call. Returns what it did, for tests: "none" (no owner turn yet), "answered",
 * "done" (already handled), "echo", "tool" (a tool is running), "readback", "waiting", "spoke", "failed".
 */
async function tick(businessId, call) {
  let state = watching.get(businessId);
  if (!state || state.agentId !== call.agentId) {
    state = { agentId: call.agentId, busy: false, turn: null, acted: new Set() };
    watching.set(businessId, state);
  }
  if (state.busy) return "waiting";
  state.busy = true;
  try {
    return await look(businessId, call, state);
  } finally {
    state.busy = false;
  }
}

async function look(businessId, call, state) {
  let history;
  try {
    history = await historyImpl(call.agentId);
  } catch {
    return "waiting"; // /history unavailable now; look again on the next poll
  }
  if (!Array.isArray(history)) return "waiting";
  const turn = latestTurn(history);
  if (!turn) return "none";
  if (turn.answered) {
    state.turn = null;
    return "answered";
  }
  if (state.acted.has(turn.key)) return "done";
  const now = clock();
  if (state.turn?.key !== turn.key) state.turn = { key: turn.key, since: now, length: history.length, changedAt: now };
  if (history.length !== state.turn.length) Object.assign(state.turn, { length: history.length, changedAt: now });
  if (require("./confirm-watch").possibleEcho(history, turn.index)) {
    state.acted.add(turn.key);
    return "echo";
  }
  if (toolCalls.inFlight(businessId)) return "tool";
  if (readbackImpl(businessId, call.agentId)) return "readback";
  if (now - state.turn.since < settings.answerMs || now - state.turn.changedAt < settings.settleMs) return "waiting";

  state.acted.add(turn.key);
  const language = ownerTurnLanguage(history, turn.index, call.language);
  const text = turn.toolSay ?? SORRY[langKey(language)];
  const said = turn.toolSay ? "tool_say" : "sorry";
  let ok = true;
  try {
    await speakImpl(call.agentId, text);
    require("./narrator").noteSpoken?.(businessId);
  } catch (err) {
    ok = false;
    console.warn(`[answer-watch] could not speak for an unanswered owner turn: ${err.message}`);
  }
  console.warn(`[answer-watch] owner ${turn.key} unanswered ${Math.round((now - state.turn.since) / 1000)} s; server spoke ${said}${ok ? "" : " (failed)"}`);
  events.emit(businessId, "turn.unanswered", { turn: turn.key, said, ok }, { sessionId: call.sessionId ?? null, actor: "system" });
  return ok ? "spoke" : "failed";
}

/** The owner's turn language when it has say templates (hi, kn, en), else the call's language. */
function ownerTurnLanguage(history, index, fallback) {
  const language = require("./language");
  const detected = language.detectLanguage(history[index].content)?.language;
  return language.templateLanguage(detected) ?? fallback;
}

let timer = null;

async function pollAll() {
  const calls = liveImpl();
  for (const businessId of [...watching.keys()]) if (!calls.has(businessId)) watching.delete(businessId);
  await Promise.all(
    [...calls.entries()].map(([businessId, call]) =>
      tick(businessId, call).catch((err) => console.warn(`[answer-watch] ${err.message}`)),
    ),
  );
}

/** Poll every live owner call. Returns stop(). */
function start() {
  if (!timer) {
    timer = setInterval(() => pollAll().catch(() => {}), settings.pollMs);
    timer.unref?.();
  }
  return stop;
}

function stop() {
  clearInterval(timer);
  timer = null;
  watching.clear();
}

/** Tests: replace /history, /speak, the live-call list, the read-back check, the clock and the timing. */
function configure({ history, speak, live, readback, now, pollMs, answerMs, settleMs } = {}) {
  if (history) historyImpl = history;
  if (speak) speakImpl = speak;
  if (live) liveImpl = live;
  if (readback) readbackImpl = readback;
  if (now) clock = now;
  Object.assign(settings, Object.fromEntries(Object.entries({ pollMs, answerMs, settleMs }).filter(([, v]) => v !== undefined)));
  watching.clear();
}

module.exports = { start, stop, tick, pollAll, latestTurn, toolSay, configure, settings, SORRY };
