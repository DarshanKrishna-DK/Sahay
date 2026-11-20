"use strict";

/**
 * get_business_facts: the owner agent's one read-only door into what the shop knows ("enterprise
 * knowledge", Track 2 Understand step). Any question about this shop (stock and what is low, who
 * owes money, today's bills, payments received, orders, purchases in progress, past suppliers, the
 * owner's rules and settings, the shop's profile) is answered from the stored records of the one
 * tenant in ctx, with a ready `say` in the owner's language and script built by code from those
 * records. Never sample data: an empty record set is said honestly ("no bills yet today").
 *
 * Topics already covered by an existing tool reuse that tool's handler (get_stock, who_owes_me,
 * get_order_status, get_my_agent, get_business_profile), so both give the same answer.
 */

const repo = require("../db/repo");
const invoices = require("../sell/invoices");
const khata = require("../sell/khata");
const stock = require("../stock");
const stockSay = require("../stock/say");
const agentRules = require("../agent/rules");
const agentProfile = require("../agent/profile");
const { unitWord } = require("../procurement/units");
const { langKey } = require("./errors");

const TOPICS = ["overview", "stock", "low_stock", "khata", "sales_today", "payments", "orders", "purchases", "suppliers", "rules", "settings", "profile"];
/** How many names a spoken line lists before "and more on the screen". */
const NAMED = 3;
const OPEN_ORDER = new Set(["confirmed", "paid", "in_transit"]);
const BILLED = new Set(["issued", "part_paid", "paid"]);

/** YYYY-MM-DD in India for a time (ISO string or ms). */
function dayInIndia(at) {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const rupees = (paise, language) => khata.spokenRupees(Math.round(paise), language);
const num = (n) => String(Math.round(Number(n) * 1000) / 1000);
const SIM = { "hi-IN": " (सिम्युलेटेड विक्रेता)", "kn-IN": " (ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್)", "en-IN": " (simulated vendor)" };
const MORE = { "hi-IN": " बाकी स्क्रीन पर हैं।", "kn-IN": " ಉಳಿದವು ಪರದೆಯ ಮೇಲಿವೆ.", "en-IN": " The rest are on the screen." };
const JOIN = { "hi-IN": ", ", "kn-IN": ", ", "en-IN": ", " };

/** Spoken lines, one per fact, in each language's own script. Figures arrive already spoken. */
const LINES = {
  sales_none: {
    "hi-IN": (v) => `आज अभी तक कोई बिल नहीं बना है।${v.drafts ? ` ${v.drafts} बिल अभी कच्चे हैं।` : ""}`,
    "kn-IN": (v) => `ಇವತ್ತು ಇನ್ನೂ ಯಾವ ಬಿಲ್ಲೂ ಆಗಿಲ್ಲ.${v.drafts ? ` ${v.drafts} ಬಿಲ್ ಇನ್ನೂ ಕರಡು ಇದೆ.` : ""}`,
    "en-IN": (v) => `No bills yet today.${v.drafts ? ` ${v.drafts} ${v.drafts === 1 ? "is" : "are"} still a draft.` : ""}`,
  },
  sales_today: {
    "hi-IN": (v) => `आज ${v.count} बिल बने, कुल ${v.total}।${v.drafts ? ` ${v.drafts} बिल अभी कच्चे हैं।` : ""}`,
    "kn-IN": (v) => `ಇವತ್ತು ${v.count} ಬಿಲ್ ಆಗಿದೆ, ಒಟ್ಟು ${v.total}.${v.drafts ? ` ${v.drafts} ಬಿಲ್ ಇನ್ನೂ ಕರಡು ಇದೆ.` : ""}`,
    "en-IN": (v) => `${v.count} ${v.count === 1 ? "bill" : "bills"} today, ${v.total} in all.${v.drafts ? ` ${v.drafts} more ${v.drafts === 1 ? "is" : "are"} still a draft.` : ""}`,
  },
  payments_none: {
    "hi-IN": () => "अभी तक कोई भुगतान दर्ज नहीं हुआ है।",
    "kn-IN": () => "ಇನ್ನೂ ಯಾವ ಪಾವತಿಯೂ ದಾಖಲಾಗಿಲ್ಲ.",
    "en-IN": () => "No payments have been recorded yet.",
  },
  payments: {
    "hi-IN": (v) => `${v.today ? `आज ${v.today} भुगतान मिले, कुल ${v.todayTotal}।` : "आज कोई भुगतान नहीं मिला।"} आख़िरी भुगतान ${v.who} से ${v.amount} ${v.mode}।`,
    "kn-IN": (v) => `${v.today ? `ಇವತ್ತು ${v.today} ಪಾವತಿ ಬಂದಿದೆ, ಒಟ್ಟು ${v.todayTotal}.` : "ಇವತ್ತು ಯಾವ ಪಾವತಿಯೂ ಬಂದಿಲ್ಲ."} ಕೊನೆಯ ಪಾವತಿ ${v.who} ಅವರಿಂದ ${v.amount} ${v.mode}.`,
    "en-IN": (v) => `${v.today ? `${v.today} ${v.today === 1 ? "payment" : "payments"} came in today, ${v.todayTotal} in all.` : "No payments came in today."} The last one was ${v.amount} from ${v.who} ${v.mode}.`,
  },
  low_none: {
    "hi-IN": () => "कोई सामान कम नहीं है।",
    "kn-IN": () => "ಯಾವ ವಸ್ತುವೂ ಕಡಿಮೆ ಇಲ್ಲ.",
    "en-IN": () => "Nothing is running low.",
  },
  low_unset: {
    "hi-IN": () => "किसी सामान का कम-स्टॉक स्तर तय नहीं है, इसलिए कम क्या है यह नहीं बता सकती; स्तर बताइए तो मैं याद रखूँगी।",
    "kn-IN": () => "ಯಾವ ವಸ್ತುವಿಗೂ ಕಡಿಮೆ-ಸ್ಟಾಕ್ ಮಟ್ಟ ಇಟ್ಟಿಲ್ಲ, ಹಾಗಾಗಿ ಯಾವುದು ಕಡಿಮೆ ಅಂತ ಹೇಳಕ್ಕಾಗಲ್ಲ; ಮಟ್ಟ ಹೇಳಿದರೆ ನೆನಪಿಟ್ಟುಕೊಳ್ಳುತ್ತೇನೆ.",
    "en-IN": () => "No reorder level is set for any item, so I cannot tell what is low; tell me a level and I will keep it.",
  },
  low: {
    "hi-IN": (v) => `${v.count} सामान कम हैं: ${v.list}।${v.more ? MORE["hi-IN"] : ""}`,
    "kn-IN": (v) => `${v.count} ವಸ್ತು ಕಡಿಮೆ ಇದೆ: ${v.list}.${v.more ? MORE["kn-IN"] : ""}`,
    "en-IN": (v) => `${v.count} ${v.count === 1 ? "item is" : "items are"} low: ${v.list}.${v.more ? MORE["en-IN"] : ""}`,
  },
  stock_none: {
    "hi-IN": () => "अभी स्टॉक में कोई सामान दर्ज नहीं है।",
    "kn-IN": () => "ಈಗ ಸ್ಟಾಕ್‌ನಲ್ಲಿ ಯಾವ ವಸ್ತುವೂ ದಾಖಲಾಗಿಲ್ಲ.",
    "en-IN": () => "No stock is recorded yet.",
  },
  purchases_none: {
    "hi-IN": () => "अभी कोई ख़रीद चालू नहीं है।",
    "kn-IN": () => "ಈಗ ಯಾವ ಖರೀದಿಯೂ ನಡೆಯುತ್ತಿಲ್ಲ.",
    "en-IN": () => "No purchase is in progress right now.",
  },
  purchases: {
    "hi-IN": (v) => `अभी की ख़रीद: ${v.need}; ${v.state}।${v.others ? ` ${v.others} और ज़रूरतें खुली हैं।` : ""}`,
    "kn-IN": (v) => `ಈಗಿನ ಖರೀದಿ: ${v.need}; ${v.state}.${v.others ? ` ಇನ್ನೂ ${v.others} ಅಗತ್ಯಗಳು ತೆರೆದಿವೆ.` : ""}`,
    "en-IN": (v) => `Current purchase: ${v.need}; ${v.state}.${v.others ? ` ${v.others} more ${v.others === 1 ? "need is" : "needs are"} open.` : ""}`,
  },
  suppliers_none: {
    "hi-IN": () => "अभी तक किसी विक्रेता से ख़रीद नहीं हुई है।",
    "kn-IN": () => "ಇನ್ನೂ ಯಾವ ಮಾರಾಟಗಾರರಿಂದಲೂ ಖರೀದಿ ಆಗಿಲ್ಲ.",
    "en-IN": () => "No purchases from any vendor yet.",
  },
  suppliers: {
    "hi-IN": (v) => `पिछली ख़रीद ${v.list} से हुई।${v.more ? MORE["hi-IN"] : ""}`,
    "kn-IN": (v) => `ಹಿಂದಿನ ಖರೀದಿ ${v.list} ಅವರಿಂದ ಆಗಿದೆ.${v.more ? MORE["kn-IN"] : ""}`,
    "en-IN": (v) => `Past purchases were from ${v.list}.${v.more ? MORE["en-IN"] : ""}`,
  },
  settings: {
    "hi-IN": (v) => `मोलभाव का तरीका ${v.style}, बोलने की रफ़्तार ${v.speed}, ${v.gst}। ऑर्डर से पहले मैं हमेशा आपकी हाँ लेती हूँ।`,
    "kn-IN": (v) => `ಚೌಕಾಸಿ ರೀತಿ ${v.style}, ಮಾತಿನ ವೇಗ ${v.speed}, ${v.gst}. ಆರ್ಡರ್ ಮೊದಲು ಯಾವಾಗಲೂ ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಕೇಳುತ್ತೇನೆ.`,
    "en-IN": (v) => `Bargaining is ${v.style}, speaking speed ${v.speed}, ${v.gst}. I always ask for your yes before any order.`,
  },
  overview: {
    "hi-IN": (v) => `आज ${v.bills}; उधार में ${v.owed}; ${v.low}; ${v.orders}।`,
    "kn-IN": (v) => `ಇವತ್ತು ${v.bills}; ಬಾಕಿ ${v.owed}; ${v.low}; ${v.orders}.`,
    "en-IN": (v) => `Today ${v.bills}; ${v.owed} owed to you; ${v.low}; ${v.orders}.`,
  },
};

const WORDS = {
  cash: { "hi-IN": "नकद", "kn-IN": "ನಗದು", "en-IN": "in cash" },
  upi: { "hi-IN": "यूपीआई से", "kn-IN": "ಯುಪಿಐ ಮೂಲಕ", "en-IN": "by UPI" },
  gentle: { "hi-IN": "नरम", "kn-IN": "ಮೃದು", "en-IN": "gentle" },
  balanced: { "hi-IN": "संतुलित", "kn-IN": "ಸಮತೋಲನ", "en-IN": "balanced" },
  tough: { "hi-IN": "सख़्त", "kn-IN": "ಗಟ್ಟಿ", "en-IN": "tough" },
  slow: { "hi-IN": "धीमी", "kn-IN": "ನಿಧಾನ", "en-IN": "slow" },
  normal: { "hi-IN": "सामान्य", "kn-IN": "ಸಾಮಾನ್ಯ", "en-IN": "normal" },
  gst_on: { "hi-IN": "बिल GST के साथ बनते हैं", "kn-IN": "ಬಿಲ್ GST ಜೊತೆ ಆಗುತ್ತವೆ", "en-IN": "bills carry GST" },
  gst_off: { "hi-IN": "बिल बिना GST के बनते हैं", "kn-IN": "ಬಿಲ್ GST ಇಲ್ಲದೆ ಆಗುತ್ತವೆ", "en-IN": "bills are plain, without GST" },
  bills_none: { "hi-IN": "कोई बिल नहीं", "kn-IN": "ಯಾವ ಬಿಲ್ಲೂ ಇಲ್ಲ", "en-IN": "no bills" },
  bills: { "hi-IN": (n, t) => `${n} बिल, कुल ${t}`, "kn-IN": (n, t) => `${n} ಬಿಲ್, ಒಟ್ಟು ${t}`, "en-IN": (n, t) => `${n} ${n === 1 ? "bill" : "bills"} for ${t}` },
  owed_none: { "hi-IN": "किसी पर कुछ बाकी नहीं", "kn-IN": "ಯಾರ ಮೇಲೂ ಬಾಕಿ ಇಲ್ಲ", "en-IN": "nothing" },
  owed: { "hi-IN": (n, t) => `${n} ग्राहकों पर ${t} बाकी`, "kn-IN": (n, t) => `${n} ಗ್ರಾಹಕರಿಂದ ${t} ಬಾಕಿ`, "en-IN": (n, t) => `${t} from ${n} ${n === 1 ? "customer" : "customers"}` },
  low_none: { "hi-IN": "कोई सामान कम नहीं", "kn-IN": "ಯಾವ ವಸ್ತುವೂ ಕಡಿಮೆ ಇಲ್ಲ", "en-IN": "nothing is low" },
  low: { "hi-IN": (n) => `${n} सामान कम`, "kn-IN": (n) => `${n} ವಸ್ತು ಕಡಿಮೆ`, "en-IN": (n) => `${n} ${n === 1 ? "item" : "items"} low` },
  orders_none: { "hi-IN": "कोई ऑर्डर चालू नहीं", "kn-IN": "ಯಾವ ಆರ್ಡರ್ ನಡೆಯುತ್ತಿಲ್ಲ", "en-IN": "no orders open" },
  orders: { "hi-IN": (n) => `${n} ऑर्डर चालू`, "kn-IN": (n) => `${n} ಆರ್ಡರ್ ನಡೆಯುತ್ತಿದೆ`, "en-IN": (n) => `${n} ${n === 1 ? "order" : "orders"} open` },
  need_searching: { "hi-IN": "विक्रेता खोजे जा रहे हैं", "kn-IN": "ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತಿದ್ದೇನೆ", "en-IN": "vendors are being searched" },
  need_negotiating: { "hi-IN": "मोलभाव चल रहा है", "kn-IN": "ಚೌಕಾಸಿ ನಡೆಯುತ್ತಿದೆ", "en-IN": "a negotiation is running" },
  need_quoted: { "hi-IN": (n) => `${n} भाव मिले हैं, आपकी हाँ बाकी है`, "kn-IN": (n) => `${n} ದರ ಸಿಕ್ಕಿದೆ, ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಬಾಕಿ ಇದೆ`, "en-IN": (n) => `${n} ${n === 1 ? "quote is" : "quotes are"} in, waiting for your yes` },
  need_vendors: { "hi-IN": (n) => `${n} विक्रेता मिले हैं, मोलभाव अभी नहीं हुआ`, "kn-IN": (n) => `${n} ಮಾರಾಟಗಾರರು ಸಿಕ್ಕಿದ್ದಾರೆ, ಚೌಕಾಸಿ ಇನ್ನೂ ಆಗಿಲ್ಲ`, "en-IN": (n) => `${n} ${n === 1 ? "vendor" : "vendors"} found, not negotiated yet` },
  need_new: { "hi-IN": "अभी विक्रेता खोजने बाकी हैं", "kn-IN": "ಇನ್ನೂ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕಬೇಕಿದೆ", "en-IN": "no vendor search yet" },
};

const word = (key, language, ...args) => {
  const w = WORDS[key][langKey(language)];
  return typeof w === "function" ? w(...args) : w;
};
const line = (key, language, vars = {}) => LINES[key][langKey(language)](vars);

/* ------------------------------------------------------------------ facts --- */

function billedToday(businessId, now) {
  const today = dayInIndia(now);
  const all = invoices.list(businessId);
  const billed = all.filter((inv) => BILLED.has(inv.status) && dayInIndia(inv.issuedAt ?? inv.createdAt) === today);
  const drafts = all.filter((inv) => inv.status === "draft" && dayInIndia(inv.createdAt) === today).length;
  return { billed, drafts, totalPaise: billed.reduce((s, inv) => s + inv.totals.totalPaise, 0) };
}

function salesToday(ctx, language, now) {
  const { billed, drafts, totalPaise } = billedToday(ctx.businessId, now);
  const bills = billed.map((inv) => ({ number: inv.number, customer: inv.recipient?.name ?? null, total: inv.totals.total, status: inv.status }));
  if (!billed.length) return { bills, total: 0, drafts, say: line("sales_none", language, { drafts }) };
  return { bills, total: totalPaise / 100, drafts, say: line("sales_today", language, { count: billed.length, total: rupees(totalPaise, language), drafts }) };
}

function payments(ctx, language, now) {
  const today = dayInIndia(now);
  const recent = khata.listReceipts(ctx.businessId, { limit: 50 });
  if (!recent.length) return { receipts: [], todayTotal: 0, say: line("payments_none", language) };
  const todays = recent.filter((r) => dayInIndia(r.created_at) === today);
  const todayPaise = todays.reduce((s, r) => s + r.amount_paise, 0);
  const last = recent[0];
  return {
    receipts: recent.slice(0, 10).map((r) => ({ customer: r.customer_name, amount: r.amount, mode: r.mode, at: r.created_at })),
    todayCount: todays.length,
    todayTotal: todayPaise / 100,
    say: line("payments", language, {
      today: todays.length,
      todayTotal: rupees(todayPaise, language),
      who: last.customer_name ?? "",
      amount: rupees(last.amount_paise, language),
      mode: WORDS[last.mode]?.[langKey(language)] ?? "",
    }),
  };
}

function lowStock(ctx, language) {
  const { items: all } = stock.summary(ctx.businessId);
  if (!all.length) return { items: [], say: line("stock_none", language) };
  const low = all.filter((i) => i.low);
  const facts = low.map((i) => ({ item: i.name, onHand: i.on_hand, unit: i.unit, level: i.level }));
  if (!low.length) return { items: facts, say: line(all.some((i) => i.level != null) ? "low_none" : "low_unset", language) };
  const list = low.slice(0, NAMED).map((i) => `${stockSay.itemWord(i, language)} ${num(i.on_hand)} ${unitWord(i.unit, language, i.on_hand !== 1)}`).join(JOIN[langKey(language)]);
  return { items: facts, say: line("low", language, { count: low.length, list, more: low.length > NAMED }) };
}

/** The newest open purchase need and where it stands, from its jobs, vendors, quotes and orders. */
function purchases(ctx, language) {
  const orderedQuotes = new Set(repo.listOrders(ctx.businessId).filter((o) => o.status !== "cancelled").map((o) => o.quote_id));
  const isOrdered = (r) => repo.listQuotes(ctx.businessId, { requirement_id: r.id }).some((q) => orderedQuotes.has(q.id));
  const open = repo.listRequirements(ctx.businessId).filter((r) => !isOrdered(r));
  if (!open.length) return { requirements: [], say: line("purchases_none", language) };
  const r = open[open.length - 1];
  const jobs = repo.listJobs(ctx.businessId, { requirement_id: r.id });
  const running = (kind) => jobs.some((j) => j.kind === kind && (j.status === "queued" || j.status === "running"));
  const quotes = repo.listQuotes(ctx.businessId, { requirement_id: r.id });
  const vendors = repo.listVendors(ctx.businessId, { requirement_id: r.id });
  const state = running("negotiation")
    ? word("need_negotiating", language)
    : quotes.length
      ? word("need_quoted", language, quotes.length)
      : running("sourcing")
        ? word("need_searching", language)
        : vendors.length
          ? word("need_vendors", language, vendors.length)
          : word("need_new", language);
  const need = [r.quantity != null ? num(r.quantity) : null, r.unit ? unitWord(r.unit, language, r.quantity !== 1) : null, r.item].filter(Boolean).join(" ");
  return {
    requirements: open.map((x) => ({ item: x.item, quantity: x.quantity, unit: x.unit, city: x.city, status: x.status })),
    current: { item: r.item, quantity: r.quantity, unit: r.unit, vendorsFound: vendors.length, quotes: quotes.length },
    say: line("purchases", language, { need, state, others: open.length - 1 }),
  };
}

/** Vendors the shop actually bought from (orders), newest first, with item and price; simulated ones labelled. */
function suppliers(ctx, language) {
  const facts = repo.listOrderFacts(ctx.businessId).reverse();
  if (!facts.length) return { suppliers: [], say: line("suppliers_none", language) };
  const seen = new Map();
  for (const f of facts) if (!seen.has(f.vendor_name)) seen.set(f.vendor_name, f);
  const list = [...seen.values()];
  const lang = langKey(language);
  const spoken = list
    .slice(0, NAMED)
    .map((f) => {
      const price = f.unit_price != null ? (lang === "en-IN" ? ` at ${num(f.unit_price)} rupees a ${unitWord(f.unit, language)}` : lang === "hi-IN" ? ` (${num(f.unit_price)} रुपये ${unitWord(f.unit, language)})` : ` (${num(f.unit_price)} ರೂಪಾಯಿ ${unitWord(f.unit, language)})`) : "";
      return `${f.vendor_name}${f.simulated ? SIM[lang] : ""}${lang === "en-IN" ? `, ${f.item}${price}` : ` ${f.item}${price}`}`;
    })
    .join(JOIN[lang]);
  return {
    suppliers: list.map((f) => ({ vendor: f.vendor_name, simulated: f.simulated, item: f.item, unitPrice: f.unit_price, unit: f.unit, lastOrderAt: f.created_at })),
    say: line("suppliers", language, { list: spoken, more: list.length > NAMED }),
  };
}

function settings(ctx, language) {
  const profile = agentProfile.get(ctx.businessId);
  const sell = require("../sell/settings").get(ctx.businessId);
  const rules = agentRules.active(ctx.businessId);
  return {
    profile,
    gstRegistered: Boolean(sell.gstin),
    askBeforeOrder: true,
    rules: rules.length,
    say: line("settings", language, {
      style: WORDS[profile.bargain_style]?.[langKey(language)] ?? profile.bargain_style,
      speed: WORDS[profile.voice_speed]?.[langKey(language)] ?? profile.voice_speed,
      gst: word(sell.gstin ? "gst_on" : "gst_off", language),
    }),
  };
}

function overview(ctx, language, now) {
  const { billed, totalPaise } = billedToday(ctx.businessId, now);
  const owed = khata.owed(ctx.businessId);
  const owedPaise = owed.reduce((s, r) => s + r.amount_paise, 0);
  const lowCount = stock.summary(ctx.businessId).items.filter((i) => i.low).length;
  const openOrders = repo.listOrders(ctx.businessId).filter((o) => OPEN_ORDER.has(o.status)).length;
  return {
    billsToday: billed.length,
    billedToday: totalPaise / 100,
    owedTotal: owedPaise / 100,
    owedCustomers: owed.length,
    lowStock: lowCount,
    openOrders,
    say: line("overview", language, {
      bills: billed.length ? word("bills", language, billed.length, rupees(totalPaise, language)) : word("bills_none", language),
      owed: owed.length ? word("owed", language, owed.length, rupees(owedPaise, language)) : word("owed_none", language),
      low: lowCount ? word("low", language, lowCount) : word("low_none", language),
      orders: openOrders ? word("orders", language, openOrders) : word("orders_none", language),
    }),
  };
}

/** Topics answered by an existing tool's handler, so both answers are the same. */
const DELEGATED = { stock: "get_stock", khata: "who_owes_me", orders: "get_order_status", rules: "get_my_agent", profile: "get_business_profile" };

/**
 * @param {{ownerObj: Function, run: (name: string, ctx: object, args: object, language: string) => Promise<object>, now?: () => number}} deps
 */
module.exports = function factsTools({ ownerObj, run, now = () => Date.now() }) {
  return [
    {
      name: "get_business_facts",
      scopes: ["owner"],
      description:
        "Answers any question about THIS shop from its own records: overview (today in one line), stock (all items), low_stock (what is running low), khata (who owes money and how much), sales_today (bills made today and their total), payments (payments received), orders (purchase orders and payment state), purchases (what is being bought now and where it stands), suppliers (vendors the shop bought from, with item and price), rules (the owner's buying rules), settings (bargaining style, speaking speed, GST, ask-before-order) or profile (shop name, owner, city). Read only: it never changes anything. Use it for every question about the shop that no other tool answers, then speak `say` as it is. An empty record is said honestly; never fill a gap yourself.",
      inputSchema: ownerObj({ topic: { type: "string", enum: TOPICS, description: "What the owner asked about. Leave it out for the overview." } }),
      async handler(ctx, args, language) {
        const topic = args.topic ?? "overview";
        if (DELEGATED[topic]) return { topic, ...(await run(DELEGATED[topic], ctx, {}, language)) };
        const at = now();
        switch (topic) {
          case "low_stock":
            return { topic, ...lowStock(ctx, language) };
          case "sales_today":
            return { topic, ...salesToday(ctx, language, at) };
          case "payments":
            return { topic, ...payments(ctx, language, at) };
          case "purchases":
            return { topic, ...purchases(ctx, language) };
          case "suppliers":
            return { topic, ...suppliers(ctx, language) };
          case "settings":
            return { topic, ...settings(ctx, language) };
          default:
            return { topic: "overview", ...overview(ctx, language, at) };
        }
      },
    },
  ];
};
module.exports.TOPICS = TOPICS;
module.exports.LINES = LINES;
module.exports.WORDS = WORDS;
module.exports.dayInIndia = dayInIndia;
