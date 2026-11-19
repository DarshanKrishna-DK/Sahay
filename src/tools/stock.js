"use strict";

/**
 * Stock tools for the owner agent (contract STK), registered by one line in ./registry.js:
 *   TOOLS.push(...require("./stock")({ ownerObj, idArg, withHistory, unheardFields }))
 * The helpers are the registry's own, so these tools validate, check the owner's words and read
 * the call history exactly like the buying tools.
 *
 * set_opening_stock  the owner's count of an item (checked against the owner's own words)
 * get_stock          what is in stock, and what is low
 * mark_order_delivered  a purchase order's goods arrived -> order delivered, stock in
 * set_reorder_level  a reorder_level rule: the server reads it out, the owner keeps it with
 *                    confirm_rule (readback then yes, the rules machinery)
 * confirm_reorder    the owner's yes or no to Sahay's "running low, buy more?" question. A yes
 *                    saves a requirement and starts the vendor search (start_sourcing); it
 *                    never orders: the deal still needs the owner's approval.
 */

const stock = require("../stock");
const items = require("../stock/items");
const reorder = require("../stock/reorder");
const delivery = require("../stock/delivery");
const say = require("../stock/say");
const agentRules = require("../agent/rules");
const { canonicalUnit, unitRatio, unitWord, UNIT_CODES } = require("../procurement/units");
const { ToolError, toToolError, sayFor } = require("./errors");

const SCOPE_OWNER = ["owner"];
const LOW_NAMED = 3;

/* ---------------------------------------------------------------- errors --- */

const REFUSAL_KEYS = {
  NOT_AFFIRMATIVE: "reorder_unclear",
  NOT_NEGATIVE: "reorder_unclear",
  NO_ANSWER_YET: "reorder_unclear",
  ANSWER_DURING_READBACK: "reorder_unclear",
  READBACK_SUPERSEDED: "reorder_unclear",
  READBACK_NOT_SPOKEN: "reorder_tap",
  READBACK_NOT_HEARD: "reorder_tap",
  EVIDENCE_UNORDERED: "reorder_tap",
  EVIDENCE_REQUIRED: "reorder_tap",
  TYPED_ANSWER: "reorder_tap",
  NO_PROPOSAL: "reorder_none",
  PROPOSAL_DECIDED: "reorder_none",
  ORDER_NOT_DELIVERABLE: "order_not_deliverable",
};

/** A stock or gate error as a spoken ToolError in `language`. */
function stockToolError(err, language, { item } = {}) {
  if (err instanceof ToolError) return err;
  const code = err?.code;
  const opts = { status: err?.status ?? 409, message: err?.message, cause: err, details: err?.details };
  if (REFUSAL_KEYS[code]) return new ToolError(code, say.line(REFUSAL_KEYS[code], language), opts);
  if (code === "AMBIGUOUS_ITEM") {
    const choices = (err.details?.choices ?? []).map((c) => say.itemWord(c, language)).join(", ");
    return new ToolError(code, say.line("ambiguous_item", language, { choices }, { allow: (err.details?.choices ?? []).flatMap((c) => [c.name, c.name_native]) }), opts);
  }
  if (code === "UNKNOWN_UNIT") return new ToolError(code, say.line("unit_unknown", language, { unit: err.details?.unit ?? "" }, { allow: [err.details?.unit] }), { ...opts, status: 400 });
  if (code === "UNIT_MISMATCH" && (err.details?.item || item)) {
    const it = err.details?.item ?? item;
    return new ToolError(code, say.line("unit_mismatch", language, { item: say.itemWord(it, language), unit: unitWord(it.unit, language, true) }, { allow: [it.name, it.name_native] }), opts);
  }
  if (code === "ITEM_NOT_FOUND" || code === "ORDER_NOT_FOUND") return new ToolError(code, sayFor("not_found", language), { ...opts, status: 404 });
  if (code === "INVALID_ITEM" || code === "INVALID_MOVE" || code === "INVALID_DECISION") return new ToolError(code, sayFor("invalid", language), { ...opts, status: 400 });
  return toToolError(err, language);
}

/** Run `fn`, turning a stock error into a spoken ToolError. */
async function spoken(language, fn, context) {
  try {
    return await fn();
  } catch (err) {
    throw stockToolError(err, language, context);
  }
}

/* --------------------------------------------------------------- helpers --- */

const allowItem = (item) => [item?.name, item?.name_native];

function itemLine(businessId, item, language) {
  const s = stock.withStock(businessId, item);
  const counted = stock.listMoves(businessId, { itemId: item.id, limit: 1 }).length > 0;
  return {
    stock: { ...s, counted },
    say: say.line(
      "stock_one",
      language,
      {
        item: say.itemWord(item, language),
        counted,
        left: say.qty(s.on_hand, item.unit, language),
        low: counted && s.low,
        level: s.level != null ? say.qty(s.level, item.unit, language) : null,
      },
      { allow: allowItem(item) },
    ),
  };
}

/** The order mark_order_delivered acts on when none is named: the one still awaiting delivery. */
function defaultOrder(businessId, language) {
  const waiting = delivery.deliverableOrders(businessId);
  if (waiting.length === 1) return waiting[0].id;
  if (!waiting.length) throw new ToolError("NO_OPEN_ORDER", say.line("no_open_order", language), { status: 409 });
  const choices = waiting.map((o) => o.po_number);
  throw new ToolError("AMBIGUOUS", say.line("ambiguous_order", language, { choices: choices.join(", ") }, { allow: choices }), { status: 409, details: { choices } });
}

/* ----------------------------------------------------------------- tools --- */

module.exports = function stockTools({ ownerObj, idArg, withHistory, unheardFields }) {
  return [
    {
      name: "set_opening_stock",
      scopes: SCOPE_OWNER,
      description:
        "Records how much of an item the owner has now (their count: first time it is the opening stock, later a recount). Pass the item, quantity and unit exactly as the owner said them, and owner_words. The server checks them against the owner's own words; when saved is false nothing was saved: speak `say` and wait.",
      inputSchema: ownerObj(
        {
          owner_words: { type: "string", maxLength: 500, description: "The owner's last sentence, word for word, in the owner's script. Always pass it." },
          item: { type: "string", maxLength: 80, description: "The item as the owner named it, in the owner's own script, e.g. बासमती चावल / ಅಕ್ಕಿ / sugar." },
          quantity: { type: "number", minimum: 0, maximum: 10000000 },
          unit: { type: "string", maxLength: 40, description: `The unit as the owner said it (किलो, ಕಿಲೋ, pieces ...). Stored as one of: ${UNIT_CODES.join(", ")}.` },
        },
        ["item", "quantity"],
      ),
      async handler(ctx, args, language) {
        const itemText = args.item.trim();
        const unit = args.unit != null && args.unit !== "" ? canonicalUnit(args.unit) : null;
        if (args.unit && !unit) throw stockToolError({ code: "UNKNOWN_UNIT", details: { unit: args.unit } }, language);
        const notHeard = await unheardFields(ctx, args, { item: itemText, quantity: args.quantity, unit: unit ?? undefined });
        if (notHeard.length) return { saved: false, missing: notHeard, say: say.line("stock_not_heard", language) };

        return spoken(language, () => {
          let item = items.findByName(ctx.businessId, itemText);
          if (!item) {
            if (!unit) throw new ToolError("UNIT_NEEDED", say.line("unit_needed", language, { item: itemText }, { allow: [itemText] }), { status: 400 });
            item = items.upsert(ctx.businessId, { name: itemText, unit }, { sessionId: ctx.sessionId ?? null, actor: "agent" });
          }
          let qty = args.quantity;
          if (unit && unit !== item.unit) {
            const ratio = unitRatio(unit, item.unit);
            if (ratio == null) throw stockToolError({ code: "UNIT_MISMATCH", details: { item } }, language);
            qty = Math.round(qty * ratio * 1000) / 1000;
          }
          const result = stock.setCount(ctx.businessId, { itemId: item.id, qty }, { sessionId: ctx.sessionId ?? null, actor: "agent" });
          return {
            saved: true,
            itemId: item.id,
            item: result.item,
            on_hand: result.on_hand,
            move: result.move,
            say: say.line("stock_counted", language, { item: say.itemWord(item, language), left: say.qty(result.on_hand, item.unit, language) }, { allow: allowItem(item) }),
          };
        });
      },
    },
    {
      name: "get_stock",
      scopes: SCOPE_OWNER,
      description:
        "How much of an item is in stock (give item), or a summary of all items and which are low (no item). Also lists items Sahay is waiting to ask about buying again (reorderPending).",
      inputSchema: ownerObj({ item: { type: "string", maxLength: 80, description: "The item as the owner named it. Leave it out for all items." } }),
      async handler(ctx, args, language) {
        return spoken(language, () => {
          const reorderPending = reorder.listOpen(ctx.businessId).map((p) => ({ item: p.item?.name, quantity: p.quantity, unit: p.unit }));
          if (args.item) {
            const item = items.findByName(ctx.businessId, args.item);
            if (!item) return { item: null, reorderPending, say: say.line("stock_unknown_item", language, { item: args.item.trim() }, { allow: [args.item.trim()] }) };
            return { ...itemLine(ctx.businessId, item, language), reorderPending };
          }
          const { items: all } = stock.summary(ctx.businessId);
          if (!all.length) return { items: [], reorderPending, say: say.line("stock_empty", language) };
          const low = all.filter((i) => i.low);
          return {
            items: all,
            reorderPending,
            say: say.line(
              "stock_all",
              language,
              { count: all.length, low: low.slice(0, LOW_NAMED).map((i) => say.itemWord(i, language)).join(", ") },
              { allow: low.flatMap(allowItem) },
            ),
          };
        });
      },
    },
    {
      name: "mark_order_delivered",
      scopes: SCOPE_OWNER,
      description:
        "When the owner says an order's goods have arrived: marks the purchase order delivered and adds its quantity to stock (once). With no id it uses the one order still awaiting delivery; several are read out for the owner to choose.",
      inputSchema: ownerObj({ orderId: idArg("order", "the one order still awaiting delivery") }),
      async handler(ctx, args, language) {
        const orderId = args.orderId ?? defaultOrder(ctx.businessId, language);
        return spoken(language, () => {
          const r = delivery.markDelivered(ctx.businessId, orderId, { sessionId: ctx.sessionId ?? null, actor: "owner" });
          const vars = {
            po: r.order.po_number,
            sim: Boolean(r.order.simulated),
            item: say.itemWord(r.item, language),
            added: say.qty(r.added, r.item.unit, language),
            left: say.qty(r.on_hand, r.item.unit, language),
          };
          return {
            orderId: r.order.id,
            poNumber: r.order.po_number,
            status: r.order.status,
            simulated: Boolean(r.order.simulated),
            itemId: r.item.id,
            added: r.added,
            on_hand: r.on_hand,
            alreadyDelivered: r.alreadyDelivered,
            say: say.line(r.alreadyDelivered ? "delivered_already" : "delivered", language, vars, { allow: allowItem(r.item) }),
          };
        });
      },
    },
    {
      name: "set_reorder_level",
      scopes: SCOPE_OWNER,
      description:
        "When the owner says at what stock level to buy more of an item (\"tell me when rice is down to 50 kg\"): proposes a reorder_level rule. In a call the server reads the rule out itself; say only `say` and wait, then record the owner's yes or no with confirm_rule. Sahay then asks before buying; it never buys on its own.",
      inputSchema: ownerObj(
        {
          item: { type: "string", maxLength: 80, description: "The item in the owner's own words and script." },
          level: { type: "number", exclusiveMinimum: 0, maximum: 10000000, description: "The stock level at or below which Sahay should ask." },
          unit: { type: "string", maxLength: 40, description: `The unit as the owner said it. Leave it out to use the item's own unit. Stored as one of: ${UNIT_CODES.join(", ")}.` },
        },
        ["item", "level"],
      ),
      async handler(ctx, args, language) {
        const rule = await spoken(language, () => {
          const known = items.findByName(ctx.businessId, args.item);
          const unit = args.unit ? canonicalUnit(args.unit) : known?.unit;
          if (args.unit && !unit) throw stockToolError({ code: "UNKNOWN_UNIT", details: { unit: args.unit } }, language);
          if (!unit) throw new ToolError("UNIT_NEEDED", say.line("unit_needed", language, { item: args.item.trim() }, { allow: [args.item.trim()] }), { status: 400 });
          return agentRules.propose(ctx.businessId, { kind: "reorder_level", params: { item: args.item, level: args.level, unit }, source: "owner_said" }, { sessionId: ctx.sessionId ?? null });
        });
        const sentence = rule.sentence[language];
        const result = { ruleId: rule.id, status: rule.status, sentence };
        if (!ctx.agentId) return { ...result, readbackSpoken: false, say: `${sentence} ${say.line("level_tap", language)}` };
        // The server says the rule itself, so a spoken yes can only answer exactly these words.
        require("../agora/narrator").holdForRule(ctx.businessId, rule.id);
        try {
          await require("../agora/agent").speak(ctx.agentId, sentence, { priority: "APPEND", interruptable: false });
        } catch (err) {
          return { ...result, readbackSpoken: false, say: `${sentence} ${say.line("level_tap", language)}`, message: `The rule could not be read out: ${err.message}` };
        }
        agentRules.recordSpoken(ctx.businessId, rule.id, { agentId: ctx.agentId, text: sentence, sessionId: ctx.sessionId ?? null });
        return { ...result, readbackSpoken: true, next: "confirm_rule", say: say.line("level_question", language) };
      },
    },
    {
      name: "confirm_reorder",
      scopes: SCOPE_OWNER,
      description:
        "The owner's answer to Sahay's question whether to buy more of an item that is low: call it with no item as soon as the owner answers (decision yes on a clear yes, no on a no). If the question was not asked in this call yet, the server asks it now: say only `say` and wait, then call this again. A yes saves the need and starts the vendor search; it never places an order.",
      inputSchema: ownerObj(
        {
          decision: { type: "string", enum: ["yes", "no"] },
          item: { type: "string", maxLength: 80, description: "Only when several items are low and the owner named one." },
        },
        ["decision"],
      ),
      async handler(ctx, args, language) {
        if (!ctx.agentId) throw new ToolError("NO_VOICE_EVIDENCE", say.line("reorder_tap", language), { status: 409 });
        const row = await spoken(language, () => reorder.proposalFor(ctx.businessId, { item: args.item, agentId: ctx.agentId }));
        if (!reorder.askedIn(ctx.businessId, row.id, ctx.agentId)) {
          await spoken(language, () => reorder.speakQuestion(ctx.businessId, row, { agentId: ctx.agentId, sessionId: ctx.sessionId ?? null, language }));
          return { proposalId: row.id, status: "asked", next: "confirm_reorder", say: say.line("reorder_answer", language) };
        }
        const decided = await spoken(language, () =>
          withHistory(ctx, (history) => reorder.decide(ctx.businessId, row.id, args.decision, { via: "voice", agentId: ctx.agentId, history, sessionId: ctx.sessionId ?? null })),
        );
        const item = decided.item;
        const word = say.itemWord(item, language);
        if (decided.status === "declined") return { proposalId: row.id, status: "declined", say: say.line("reorder_declined", language) };
        const requirement = decided.requirement;
        const base = { proposalId: row.id, status: "accepted", requirementId: requirement.id, requirement };
        if (requirement.quantity == null) {
          return { ...base, sourcingStarted: false, missing: ["quantity"], next: "save_requirement with the quantity the owner says (no item, no id)", say: say.line("reorder_how_much", language, { item: word }, { allow: allowItem(item) }) };
        }
        const more = say.qty(requirement.quantity, requirement.unit, language);
        try {
          const started = await require("./registry").callTool({ ...ctx, toolScope: "owner" }, "start_sourcing", { requirementId: requirement.id, reply_language: language });
          return { ...base, sourcingStarted: true, jobId: started.jobId, say: say.line("reorder_searching", language, { item: word, more }, { allow: allowItem(item) }) };
        } catch (err) {
          const why = err instanceof ToolError ? err.say : sayFor("internal", language);
          return { ...base, sourcingStarted: false, sourcingError: err?.code ?? "INTERNAL", say: `${say.line("reorder_saved", language, { item: word }, { allow: allowItem(item) })} ${why}` };
        }
      },
    },
  ];
};

module.exports.stockToolError = stockToolError;
