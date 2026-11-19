"use strict";

/**
 * What Sahay remembers about how this business buys, shown on "My Sahay": the last price paid for
 * each item, items bought again and again, vendors bought from again and again. Derived in code
 * from the business's own orders (never from a model or a vendor's words) and kept in
 * agent_memories so the owner sees the same thing until an order changes it.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const { unitWord } = require("../procurement/units");
const { fold } = require("./rules");

/** Orders of the same item (or from the same vendor) before it counts as "usual". */
const USUAL_AFTER = 2;

const SIM_LABEL = { "hi-IN": "सिम्युलेटेड विक्रेता", "kn-IN": "ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್", "en-IN": repo.SIMULATED_LABEL };
const money = (n) => String(Math.round(n * 100) / 100);
const vendorIn = (name, simulated, language) => (simulated ? `${name} (${SIM_LABEL[language]})` : name);
const simulatedFields = (simulated) => (simulated ? { simulated: true, vendorLabel: repo.SIMULATED_LABEL } : { simulated: false });

const SENTENCES = {
  last_price: (d) => {
    const v = (language) => vendorIn(d.vendor, d.simulated, language);
    return {
      "hi-IN": `${d.item} का पिछला भाव: प्रति ${unitWord(d.unit, "hi-IN")} ${money(d.price)} रुपये, ${v("hi-IN")} से।`,
      "kn-IN": `${d.item} ಕೊನೆಯ ಬೆಲೆ: ಪ್ರತಿ ${unitWord(d.unit, "kn-IN")} ${money(d.price)} ರೂಪಾಯಿ, ${v("kn-IN")} ಅವರಿಂದ.`,
      "en-IN": `Last price for ${d.item}: ${money(d.price)} rupees per ${unitWord(d.unit, "en-IN")}, from ${v("en-IN")}.`,
    };
  },
  usual_item: (d) => {
    const many = d.quantity !== 1;
    return {
      "hi-IN": `आप अक्सर ${d.item} खरीदते हैं: अब तक ${d.orders} ऑर्डर, पिछली बार ${money(d.quantity)} ${unitWord(d.unit, "hi-IN", many)}।`,
      "kn-IN": `ನೀವು ಆಗಾಗ ${d.item} ಖರೀದಿಸುತ್ತೀರಿ: ಇದುವರೆಗೆ ${d.orders} ಆರ್ಡರ್, ಕಳೆದ ಬಾರಿ ${money(d.quantity)} ${unitWord(d.unit, "kn-IN", many)}.`,
      "en-IN": `You often buy ${d.item}: ${d.orders} orders so far, last time ${money(d.quantity)} ${unitWord(d.unit, "en-IN", many)}.`,
    };
  },
  liked_vendor: (d) => ({
    "hi-IN": `आपने ${vendorIn(d.name, d.simulated, "hi-IN")} से ${d.orders} बार खरीदा है।`,
    "kn-IN": `ನೀವು ${vendorIn(d.name, d.simulated, "kn-IN")} ಅವರಿಂದ ${d.orders} ಬಾರಿ ಖರೀದಿಸಿದ್ದೀರಿ.`,
    "en-IN": `You have bought from ${vendorIn(d.name, d.simulated, "en-IN")} ${d.orders} times.`,
  }),
};

/** {kind, key, data} for everything the orders say, oldest order first so the latest wins. */
function derive(businessId) {
  const items = new Map();
  const vendors = new Map();
  for (const f of repo.listOrderFacts(businessId)) {
    const itemKey = fold(f.item);
    const item = items.get(itemKey) ?? { orders: 0 };
    items.set(itemKey, { orders: item.orders + 1, last: f });
    // A simulated vendor never shares a memory with a real one of the same name.
    const vendorKey = `${fold(f.vendor_name)}${f.simulated ? "|simulated" : ""}`;
    const vendor = vendors.get(vendorKey) ?? { orders: 0 };
    vendors.set(vendorKey, { orders: vendor.orders + 1, last: f });
  }

  const out = [];
  for (const [key, { orders, last }] of items) {
    out.push({
      kind: "last_price",
      key,
      data: { item: last.item, unit: last.unit, price: last.unit_price, vendor: last.vendor_name, orderId: last.order_id, at: last.created_at, ...simulatedFields(last.simulated) },
    });
    if (orders >= USUAL_AFTER) out.push({ kind: "usual_item", key, data: { item: last.item, unit: last.unit, quantity: last.quantity, orders } });
  }
  for (const [key, { orders, last }] of vendors) {
    if (orders >= USUAL_AFTER) out.push({ kind: "liked_vendor", key, data: { name: last.vendor_name, orders, ...simulatedFields(last.simulated) } });
  }
  return out;
}

/** The contract shape (plan "Contract": Memory). */
function toMemory(row) {
  return {
    id: row.id,
    kind: row.kind,
    sentence: { "hi-IN": row.sentence_hi, "kn-IN": row.sentence_kn, "en-IN": row.sentence_en },
    data: row.data,
    updated_at: row.updated_at,
  };
}

const list = (businessId) => repo.listMemories(businessId).map(toMemory);

/**
 * Re-derive the memories from the orders. Emits memory.updated for each memory that is new or
 * changed; memories the orders no longer support are removed. Returns the full list.
 */
function refresh(businessId, { sessionId = null } = {}) {
  return db.transaction(() => {
    const keep = new Set();
    for (const { kind, key, data } of derive(businessId)) {
      const { memory, changed } = repo.saveMemory(businessId, { kind, key, data, sentence: SENTENCES[kind](data) });
      keep.add(memory.id);
      if (changed) events.emit(businessId, "memory.updated", { memory: toMemory(memory) }, { sessionId, actor: "system" });
    }
    for (const stale of repo.listMemories(businessId)) if (!keep.has(stale.id)) repo.deleteMemory(businessId, stale.id);
    return list(businessId);
  });
}

module.exports = { list, refresh, toMemory, USUAL_AFTER };
