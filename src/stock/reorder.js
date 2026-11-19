"use strict";

/**
 * Low-stock watcher and reorder proposals (contract STK). Sahay never buys on its own:
 *
 * 1. stock.moved (or a reorder level kept, or an item's level changed): when the item's stock is
 *    at or below its level, emit stock.low and stock.reorder_proposed and keep one open proposal.
 *    An item is proposed again only after its stock has been back above the level.
 * 2. In a live owner call the server itself asks, in the owner's language ("चावल कम है, 50 किलो
 *    बचा है। और मँगाऊँ?"), and records what it spoke (reorder_readbacks). It never asks while a
 *    deal waits for the owner's approval or a read-back is being held, so a yes can only answer
 *    the latest question (approvals.answerAfterSpoken does not know reorder questions).
 * 3. decide(): a spoken yes that answers that question (same ordering check as a deal's
 *    read-back), or the button, saves a requirement for the item with the proposed quantity
 *    (the owner's usual_quantity rule, else the last quantity bought). The caller then starts the
 *    vendor search through the existing start_sourcing tool. Orders still need the approval gate.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const approvals = require("../approvals");
const items = require("./items");
const stock = require("./index");
const say = require("./say");
const { StockError } = require("./errors");

const round3 = (n) => Math.round(n * 1000) / 1000;
const now = () => new Date().toISOString();

const settings = { askDelayMs: 8000 };
let speakImpl = (agentId, text) => require("../agora/agent").speak(agentId, text, { priority: "APPEND", interruptable: false });
let liveImpl = (businessId) => require("../agora/narrator").liveCall(businessId);
let heldImpl = (businessId) => require("../agora/narrator").isHeld(businessId);
let holdImpl = (businessId, id) => require("../agora/narrator").holdForApproval(businessId, id);

/* ----------------------------------------------------------------- rows --- */

const getProposal = (businessId, id) =>
  typeof id === "string" && id ? db.prepare("SELECT * FROM reorder_proposals WHERE business_id = ? AND id = ?").get(businessId, id) ?? null : null;

const openProposals = (businessId) => db.prepare("SELECT * FROM reorder_proposals WHERE business_id = ? AND status = 'open' ORDER BY created_at, rowid").all(businessId);

const openFor = (businessId, itemId) => db.prepare("SELECT * FROM reorder_proposals WHERE business_id = ? AND item_id = ? AND status = 'open'").get(businessId, itemId) ?? null;

const latestFor = (businessId, itemId) =>
  db.prepare("SELECT * FROM reorder_proposals WHERE business_id = ? AND item_id = ? ORDER BY rowid DESC LIMIT 1").get(businessId, itemId) ?? null;

const readbacks = (businessId, proposalId, agentId) =>
  db.prepare("SELECT * FROM reorder_readbacks WHERE business_id = ? AND proposal_id = ? AND agent_id = ? ORDER BY spoken_at, rowid").all(businessId, proposalId, agentId);

function toProposal(row) {
  if (!row) return null;
  const item = items.get(row.business_id, row.item_id);
  const { business_id: _b, last_move_rowid: _m, ...rest } = row;
  return { ...rest, item };
}

/** Open proposals of the business, oldest first (for GET /api/stock and get_stock). */
const listOpen = (businessId) => openProposals(businessId).map(toProposal);

/* -------------------------------------------------------------- proposal --- */

/** Moves of an item oldest first, with the rowid of the last one that left stock above `level`. */
function lastAboveRowid(businessId, itemId, level) {
  let balance = 0;
  let last = 0;
  for (const m of db.prepare("SELECT rowid AS seq, qty FROM stock_moves WHERE business_id = ? AND item_id = ? ORDER BY rowid").all(businessId, itemId)) {
    balance = round3(balance + m.qty);
    if (balance > level) last = m.seq;
  }
  return last;
}

/** How much to propose: the owner's usual quantity for the item, else the last quantity needed. */
function proposedQuantity(businessId, item) {
  const policy = require("../agent/policy");
  const usual = policy.usualQuantity(businessId, item.name) ?? (item.name_native ? policy.usualQuantity(businessId, item.name_native) : null);
  if (usual) return { quantity: usual.params.quantity, unit: usual.params.unit, from: "usual_quantity" };
  const needs = repo.listRequirements(businessId).filter((r) => r.quantity != null && r.unit);
  for (let i = needs.length - 1; i >= 0; i--) {
    const matches = items.matchByName(businessId, needs[i].item);
    if (matches.length === 1 && matches[0].id === item.id) return { quantity: needs[i].quantity, unit: needs[i].unit, from: "last_need" };
  }
  return { quantity: null, unit: item.unit, from: null };
}

/**
 * Look at one item after its stock or level changed. Opens a proposal (and emits stock.low and
 * stock.reorder_proposed) when it is at or below its level and was not proposed since it was
 * last above it; closes an open proposal once the stock is back above the level.
 * Returns the new proposal, or null.
 */
function check(businessId, itemId, { sessionId = null } = {}) {
  return db.transaction(() => {
    const item = items.get(businessId, itemId);
    if (!item) return null;
    const counted = Boolean(db.prepare("SELECT 1 FROM stock_moves WHERE business_id = ? AND item_id = ? LIMIT 1").get(businessId, item.id));
    const { level } = stock.levelFor(businessId, item);
    const open = openFor(businessId, item.id);
    const onHand = stock.onHand(businessId, item.id);
    if (level == null || !counted || onHand > level) {
      if (open) closeProposal(businessId, open, "closed", { sessionId });
      return null;
    }
    if (open) return null;
    const latest = latestFor(businessId, item.id);
    if (latest && !(lastAboveRowid(businessId, item.id, level) > latest.last_move_rowid)) return null;

    const { quantity, unit, from } = proposedQuantity(businessId, item);
    const id = repo.newId("rop");
    const lastMove = db.prepare("SELECT MAX(rowid) AS seq FROM stock_moves WHERE business_id = ? AND item_id = ?").get(businessId, item.id).seq ?? 0;
    db.prepare(
      "INSERT INTO reorder_proposals (id, business_id, item_id, on_hand, level, quantity, unit, status, last_move_rowid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)",
    ).run(id, businessId, item.id, onHand, level, quantity, unit, lastMove, now());
    events.emit(businessId, "stock.low", { item, on_hand: onHand, level, unit: item.unit }, { sessionId, actor: "system" });
    const proposal = toProposal(getProposal(businessId, id));
    events.emit(
      businessId,
      "stock.reorder_proposed",
      { proposalId: id, item, quantity, unit, quantityFrom: from, on_hand: onHand, level, question: questions(item, onHand, quantity, unit) },
      { sessionId, actor: "system" },
    );
    return proposal;
  });
}

function closeProposal(businessId, row, status, { sessionId = null, via = null, evidence = null, requirementId = null, actor = "system" } = {}) {
  const changed = db
    .prepare(
      "UPDATE reorder_proposals SET status = ?, decided_via = ?, evidence_utterance = ?, requirement_id = ?, decided_at = ? WHERE business_id = ? AND id = ? AND status = 'open'",
    )
    .run(status, via, evidence, requirementId, now(), businessId, row.id).changes;
  if (changed !== 1) throw new StockError("PROPOSAL_DECIDED", "This proposal was already answered.", { status: 409 });
  events.emit(
    businessId,
    "stock.reorder_decided",
    { proposalId: row.id, itemId: row.item_id, status, ...(via ? { via } : {}), ...(evidence ? { evidenceUtterance: evidence } : {}), ...(requirementId ? { requirementId } : {}) },
    { sessionId, actor },
  );
}

/* ---------------------------------------------------------------- asking --- */

/** The question in each language, from the current stock. */
function questions(item, onHand, quantity, unit) {
  return Object.fromEntries(["hi-IN", "kn-IN", "en-IN"].map((lang) => [lang, question(item, onHand, quantity, unit, lang)]));
}

function question(item, onHand, quantity, unit, language) {
  return say.line(
    "reorder_question",
    language,
    {
      item: say.itemWord(item, language),
      out: onHand <= 0,
      left: say.qty(onHand, item.unit, language),
      more: quantity ? say.qty(quantity, unit, language) : null,
    },
    { allow: [item.name, item.name_native] },
  );
}

const asking = new Set();

/**
 * Ask the owner about the oldest open proposal not yet asked in the live call, if any. Skipped
 * while a deal waits for approval or narration is held for a read-back (asked later: on the
 * next approval.decided, rule.decided or call start). Returns the spoken text or null.
 */
async function askPending(businessId) {
  const call = liveImpl(businessId);
  if (!call?.agentId || asking.has(businessId)) return null;
  if (heldImpl(businessId) || repo.listApprovals(businessId, { status: "pending" }).length) return null;
  const row = openProposals(businessId).find((p) => !readbacks(businessId, p.id, call.agentId).length);
  if (!row) return null;
  asking.add(businessId);
  try {
    return await speakQuestion(businessId, row, call);
  } finally {
    asking.delete(businessId);
  }
}

/** Speak a proposal's question into the call and record it. Throws when /speak fails. */
async function speakQuestion(businessId, row, call) {
  const item = items.get(businessId, row.item_id);
  const text = question(item, stock.onHand(businessId, item.id), row.quantity, row.unit, call.language);
  holdImpl(businessId, `reorder:${row.id}`);
  await speakImpl(call.agentId, text);
  db.transaction(() => {
    if (getProposal(businessId, row.id)?.status !== "open") return;
    db.prepare("INSERT INTO reorder_readbacks (id, business_id, proposal_id, agent_id, spoken_text, spoken_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      repo.newId("rrq"),
      businessId,
      row.id,
      call.agentId,
      text,
      now(),
    );
    events.emit(businessId, "stock.reorder_spoken", { proposalId: row.id, itemId: row.item_id, text }, { sessionId: call.sessionId ?? null, actor: "agent" });
  });
  return text;
}

/**
 * The open proposal an answer is about: the one named by item, else the one asked last in this
 * call, else the only open one. Throws NO_PROPOSAL or AMBIGUOUS_ITEM.
 */
function proposalFor(businessId, { item: itemText, agentId } = {}) {
  const open = openProposals(businessId);
  if (itemText) {
    const item = items.findByName(businessId, itemText);
    const row = item && open.find((p) => p.item_id === item.id);
    if (!row) throw new StockError("NO_PROPOSAL", "No open reorder proposal for that item.", { status: 409 });
    return row;
  }
  if (agentId) {
    const asked = db
      .prepare(
        "SELECT p.* FROM reorder_readbacks r JOIN reorder_proposals p ON p.id = r.proposal_id WHERE r.business_id = ? AND r.agent_id = ? ORDER BY r.rowid DESC LIMIT 1",
      )
      .get(businessId, agentId);
    if (asked?.status === "open") return asked;
  }
  if (open.length === 1) return open[0];
  if (!open.length) throw new StockError("NO_PROPOSAL", "No item is waiting to be bought again.", { status: 409 });
  throw new StockError("AMBIGUOUS_ITEM", "Several items are low.", { status: 409, details: { choices: open.map((p) => items.get(businessId, p.item_id)) } });
}

/** True when the server asked this proposal in the call of `agentId`. */
const askedIn = (businessId, proposalId, agentId) => Boolean(agentId) && readbacks(businessId, proposalId, agentId).length > 0;

/* -------------------------------------------------------------- deciding --- */

/**
 * The owner's answer to a proposal. `via` "voice" needs `history` (the call's Agora /history,
 * fetched by the caller from agentId, never the model's words): a yes must answer the question
 * the server spoke in this call (approvals.answerAfterSpoken), a no must not be a yes. `via`
 * "button" is the owner's own tap. On yes a requirement is saved for the item (requirement.saved).
 * Returns {status, proposalId, item, requirement|null}.
 */
function decide(businessId, proposalId, decision, { via, agentId = null, history, sessionId = null } = {}) {
  if (decision !== "yes" && decision !== "no") throw new StockError("INVALID_DECISION", 'decision is "yes" or "no".');
  if (via !== "voice" && via !== "button") throw new StockError("INVALID_VIA", 'via is "voice" or "button".');
  if (via === "voice" && !Array.isArray(history)) throw new StockError("EVIDENCE_REQUIRED", "A spoken answer needs the call history as evidence.", { status: 409 });

  let evidence = null;
  if (via === "voice") {
    const row = getProposal(businessId, proposalId);
    if (!row) throw new StockError("NO_PROPOSAL", "There is no such reorder proposal.", { status: 404 });
    if (decision === "yes") {
      const spoken = agentId ? readbacks(businessId, row.id, agentId).map((r) => r.spoken_text) : [];
      evidence = approvals.answerAfterSpoken(businessId, history, { agentId, spoken, subject: {} }).text;
      if (approvals.classifyUtterance(evidence) !== "affirmative") throw new StockError("NOT_AFFIRMATIVE", "The owner's reply was not a clear yes.", { status: 409 });
    } else {
      evidence = approvals.lastOwnerWords(history);
      if (!evidence) throw new StockError("EVIDENCE_REQUIRED", "A spoken answer needs the owner's words.", { status: 409 });
      if (approvals.classifyUtterance(evidence) === "affirmative") throw new StockError("NOT_NEGATIVE", "The owner's reply was a yes.", { status: 409 });
    }
  }

  return db.transaction(() => {
    const row = getProposal(businessId, proposalId);
    if (!row) throw new StockError("NO_PROPOSAL", "There is no such reorder proposal.", { status: 404 });
    if (row.status !== "open") throw new StockError("PROPOSAL_DECIDED", `This proposal is already ${row.status}.`, { status: 409 });
    const item = items.get(businessId, row.item_id);
    const actor = "owner";
    if (decision === "no") {
      closeProposal(businessId, row, "declined", { sessionId, via, evidence, actor });
      return { status: "declined", proposalId: row.id, item, requirement: null };
    }
    const business = repo.getBusiness(businessId);
    const requirement = repo.createRequirement(businessId, {
      item: item.name,
      ...(row.quantity != null ? { quantity: row.quantity } : {}),
      unit: row.unit,
      ...(business?.city ? { city: business.city } : {}),
      ...(sessionId && repo.getSession(businessId, sessionId) ? { session_id: sessionId } : {}),
      notes: "Reorder: stock fell to its reorder level.",
    });
    events.emit(businessId, "requirement.saved", requirement, { sessionId, actor: "agent" });
    closeProposal(businessId, row, "accepted", { sessionId, via, evidence, requirementId: requirement.id, actor });
    return { status: "accepted", proposalId: row.id, item, requirement };
  });
}

/* --------------------------------------------------------------- watcher --- */

function later(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
}

const report = (what) => (err) => console.warn(`[stock] ${what} failed: ${err?.message ?? err}`);

function onEvent(event) {
  const { businessId, type } = event;
  const d = event.data ?? {};
  try {
    if (type === "stock.moved" && d.item?.id) check(businessId, d.item.id, { sessionId: event.sessionId });
    else if (type === "item.saved" && d.item?.id) check(businessId, d.item.id, { sessionId: event.sessionId });
    else if (type === "rule.decided" && d.rule?.kind === "reorder_level") {
      for (const item of items.matchByName(businessId, d.rule.params?.item)) check(businessId, item.id, { sessionId: event.sessionId });
    }
  } catch (err) {
    report(`checking ${type}`)(err);
  }
  if (type === "stock.reorder_proposed" || type === "approval.decided" || type === "rule.decided") {
    askPending(businessId).catch(report("asking"));
  } else if (type === "session.started" && d.kind === "owner") {
    // After the disclosure and the owner's first words have had a moment.
    later(() => askPending(businessId).catch(report("asking")), settings.askDelayMs);
  }
}

let unsubscribe = null;

/** Start watching every business. Returns stop(). */
function start() {
  if (!unsubscribe) unsubscribe = events.subscribeAll(onEvent);
  return stop;
}

function stop() {
  unsubscribe?.();
  unsubscribe = null;
}

/** Tests: replace speaking, the live-call lookup, the narration hold and timing. */
function configure({ speak, live, held, hold, askDelayMs } = {}) {
  if (speak) speakImpl = speak;
  if (live) liveImpl = live;
  if (held) heldImpl = held;
  if (hold) holdImpl = hold;
  if (askDelayMs !== undefined) settings.askDelayMs = askDelayMs;
}

module.exports = {
  start,
  stop,
  configure,
  check,
  askPending,
  speakQuestion,
  decide,
  proposalFor,
  askedIn,
  listOpen,
  getProposal: (businessId, id) => toProposal(getProposal(businessId, id)),
  question,
};
