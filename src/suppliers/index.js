"use strict";

/**
 * The owner's own, real suppliers, reached on Telegram (decisions.md, "Real supplier leg").
 *
 *  1. The owner adds a supplier (name, what they sell, language). Sahay makes a one-time start
 *     link https://t.me/<bot>?start=sup_<code>; whoever opens it links that Telegram chat to the
 *     supplier, and the bot answers in the supplier's language that this is Sahay, an automated
 *     assistant for the shop. The same chat may also be the owner's notifier chat.
 *  2. When a need is sourced, every linked supplier whose items cover it joins the shortlist as a
 *     vendor of kind 'human' and is ranked first (ownFirst), marked as the owner's own supplier.
 *  3. start_negotiation with such a vendor negotiates with the real person: the join link of the
 *     negotiation (src/negotiation/session.js, counterpart "human") goes to their chat at once,
 *     disclosure first. Nobody joins in time -> the job fails honestly (VENDOR_DID_NOT_JOIN) and
 *     the owner is told on Telegram that a labelled simulated vendor is the alternative.
 *  4. After the owner's yes places the order (event order.created, written after the approval
 *     gate), the supplier gets a Telegram confirmation. Never before.
 */

const store = require("../db/suppliers");
const repo = require("../db/repo");
const events = require("../events");
const telegram = require("../notify/telegram");
const { unitWord } = require("../procurement/units");
const { langKey } = require("../tools/errors");

/** A supplier's start link stays usable this long (the owner may forward it later). */
const LINK_CODE_DAYS = 7;
/** Same as the join link of a human negotiation (session.js HUMAN_LINK_SECONDS). */
const JOIN_MINUTES = 15;

const registry = () => require("../tools/registry");
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => String(round2(n));

/* ------------------------------------------------------------ messages --- */

/** Every message to a supplier starts with the automated-assistant disclosure (CLAUDE.md rule 2). */
const TEXT = {
  disclosure: {
    "hi-IN": (v) => `नमस्ते, मैं सहाय हूँ, ${v.shop} की ओर से बात करने वाली एक स्वचालित सहायक।`,
    "kn-IN": (v) => `ನಮಸ್ಕಾರ, ನಾನು ಸಹಾಯ್, ${v.shop} ಪರವಾಗಿ ಮಾತನಾಡುವ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ.`,
    "en-IN": (v) => `Hello, this is Sahay, an automated assistant for ${v.shop}.`,
  },
  linked: {
    "hi-IN": (v) => `आप ${v.shop} के सप्लायर के रूप में जुड़ गए हैं। जब दुकान को कुछ खरीदना होगा, आपको यहीं संदेश मिलेगा।`,
    "kn-IN": (v) => `ನೀವು ${v.shop} ಅವರ ಪೂರೈಕೆದಾರರಾಗಿ ಜೋಡಣೆಯಾಗಿದ್ದೀರಿ. ಅಂಗಡಿಗೆ ಏನಾದರೂ ಖರೀದಿಸಬೇಕಾದಾಗ ನಿಮಗೆ ಇಲ್ಲೇ ಸಂದೇಶ ಬರುತ್ತದೆ.`,
    "en-IN": (v) => `You are now linked as a supplier of ${v.shop}. You will get a message here when the shop wants to buy.`,
  },
  invite: {
    "hi-IN": (v) => `${v.shop} को ${v.quantity} ${v.unit} ${v.item} खरीदना है। भाव पर अभी बात करने के लिए नीचे दिया लिंक दबाइए; यह ${JOIN_MINUTES} मिनट तक चलेगा।`,
    "kn-IN": (v) => `${v.shop} ಅವರಿಗೆ ${v.quantity} ${v.unit} ${v.item} ಬೇಕು. ಬೆಲೆಯ ಬಗ್ಗೆ ಈಗಲೇ ಮಾತನಾಡಲು ಕೆಳಗಿನ ಲಿಂಕ್ ಒತ್ತಿ; ಇದು ${JOIN_MINUTES} ನಿಮಿಷ ಮಾನ್ಯ.`,
    "en-IN": (v) => `${v.shop} wants to buy ${v.quantity} ${v.unit} of ${v.item}. Tap the link below to talk about the price now; it works for ${JOIN_MINUTES} minutes.`,
  },
  button: { "hi-IN": () => "अभी बात करें", "kn-IN": () => "ಈಗ ಮಾತನಾಡಿ", "en-IN": () => "Tap to talk now" },
  order: {
    "hi-IN": (v) => `${v.shop} ने आपसे ${v.quantity} ${v.unit} ${v.item} का ऑर्डर पक्का किया है: ${v.price} रुपये प्रति ${v.unitOne}, कुल ${v.amount} रुपये। ऑर्डर नंबर ${v.po}।`,
    "kn-IN": (v) => `${v.shop} ಅವರು ನಿಮ್ಮಿಂದ ${v.quantity} ${v.unit} ${v.item} ಆರ್ಡರ್ ಖಚಿತಪಡಿಸಿದ್ದಾರೆ: ಒಂದು ${v.unitOne}ಗೆ ${v.price} ರೂಪಾಯಿ, ಒಟ್ಟು ${v.amount} ರೂಪಾಯಿ. ಆರ್ಡರ್ ಸಂಖ್ಯೆ ${v.po}.`,
    "en-IN": (v) => `${v.shop} has confirmed the order with you: ${v.quantity} ${v.unit} of ${v.item} at ${v.price} rupees per ${v.unitOne}, ${v.amount} rupees in all. Order number ${v.po}.`,
  },
};

/** Messages to the owner's own chat, in the business language. */
const OWNER_TEXT = {
  forward: {
    "hi-IN": (v) => `${v.name} को यह लिंक भेजिए। वे इसे खोलेंगे तो सहाय उन्हें आपकी ज़रूरत पर टेलीग्राम से बुला सकेगी:\n${v.link}`,
    "kn-IN": (v) => `${v.name} ಅವರಿಗೆ ಈ ಲಿಂಕ್ ಕಳುಹಿಸಿ. ಅವರು ಇದನ್ನು ತೆರೆದರೆ, ನಿಮಗೆ ಬೇಕಾದಾಗ ಸಹಾಯ್ ಅವರನ್ನು ಟೆಲಿಗ್ರಾಮ್ ಮೂಲಕ ಕರೆಯಬಹುದು:\n${v.link}`,
    "en-IN": (v) => `Send this link to ${v.name}. Once they open it, Sahay can reach them on Telegram when you need to buy:\n${v.link}`,
  },
  supplier_linked: {
    "hi-IN": (v) => `${v.name} टेलीग्राम पर जुड़ गए हैं।`,
    "kn-IN": (v) => `${v.name} ಟೆಲಿಗ್ರಾಮ್‌ನಲ್ಲಿ ಜೋಡಣೆಯಾಗಿದ್ದಾರೆ.`,
    "en-IN": (v) => `${v.name} is now linked on Telegram.`,
  },
  no_show: {
    "hi-IN": (v) => `${v.name} ने ${JOIN_MINUTES} मिनट में लिंक नहीं खोला, कोई सौदा नहीं हुआ। चाहें तो मैं एक सिम्युलेटेड विक्रेता से मोल-भाव कर सकती हूँ।`,
    "kn-IN": (v) => `${v.name} ಅವರು ${JOIN_MINUTES} ನಿಮಿಷದಲ್ಲಿ ಲಿಂಕ್ ತೆರೆಯಲಿಲ್ಲ, ಯಾವ ವ್ಯವಹಾರವೂ ಆಗಲಿಲ್ಲ. ಬೇಕಿದ್ದರೆ ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್ ಜೊತೆ ಚೌಕಾಸಿ ಮಾಡಬಹುದು.`,
    "en-IN": (v) => `${v.name} did not open the link within ${JOIN_MINUTES} minutes, so nothing was agreed. If you like, I can negotiate with a simulated vendor instead.`,
  },
};

const text = (table, key, language, vars = {}) => table[key][langKey(language)](vars);

/** The item in the supplier's language; their own words when no translation is known. */
function itemFor(businessId, requirement, language) {
  const said = registry().spokenItem(businessId, requirement, language);
  const unnamed = Object.values(registry().SAY_WORDS.labels.unnamedItem);
  return unnamed.includes(said) ? String(requirement.item) : said;
}

/* ---------------------------------------------------------- owner side --- */

function startLink(code) {
  return `https://t.me/${telegram.BOT_USERNAME}?start=${code}`;
}

/** A fresh one-time start link for a supplier. */
function createInvite(businessId, supplierId, { now = Date.now() } = {}) {
  const expiresAt = new Date(now + LINK_CODE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const code = store.createLinkCode(businessId, supplierId, { expiresAt });
  return { code, deepLink: startLink(code), expiresAt };
}

/**
 * Add a supplier and make its start link. When the owner's own Telegram is linked, the link is
 * sent there too, ready to forward (or to open, when the owner is their own supplier in a demo).
 */
async function addSupplier(businessId, fields, { actor = "owner", sessionId = null } = {}) {
  const supplier = store.createSupplier(businessId, fields);
  const invite = createInvite(businessId, supplier.id);
  events.emit(businessId, "supplier.added", { supplierId: supplier.id, name: supplier.name, items: supplier.items, language: supplier.language }, { sessionId, actor });
  let sentToOwner = false;
  try {
    const language = repo.getBusiness(businessId)?.language;
    const out = await telegram.sendToOwner(businessId, text(OWNER_TEXT, "forward", language, { name: supplier.name, link: invite.deepLink }));
    sentToOwner = Boolean(out?.sent);
  } catch (err) {
    console.warn(`[suppliers] could not send the start link to the owner's Telegram: ${err.message}`);
  }
  return { supplier: publicView(supplier), invite, sentToOwner };
}

function removeSupplier(businessId, supplierId, { actor = "owner", sessionId = null } = {}) {
  const supplier = store.getSupplier(businessId, supplierId);
  if (!supplier || !store.removeSupplier(businessId, supplierId)) return false;
  events.emit(businessId, "supplier.removed", { supplierId, name: supplier.name }, { sessionId, actor });
  return true;
}

/** What the app and tools show: never the chat id. */
function publicView(s) {
  return { id: s.id, name: s.name, items: s.items, language: s.language, phone: s.phone, linked: s.linked, linkedAt: s.linked_at, createdAt: s.created_at, ownSupplier: true, simulated: false };
}

const listSuppliers = (businessId) => store.listSuppliers(businessId).map(publicView);

/* ---------------------------------------------------------- Telegram --- */

/**
 * Bot: `/start sup_<code>` from a private chat. Links that chat to the supplier the code was made
 * for and answers in the supplier's language. Returns { linked, businessId?, supplierId?, reply }.
 */
async function linkChat(code, chatId) {
  const redeemed = store.system.redeemLinkCode(code);
  if (!redeemed) return { linked: false };
  const { businessId, supplierId } = redeemed;
  const supplier = store.setTelegramChat(businessId, supplierId, chatId);
  if (!supplier) return { linked: false };
  const shop = repo.getBusiness(businessId)?.name ?? "";
  const reply = `${text(TEXT, "disclosure", supplier.language, { shop })} ${text(TEXT, "linked", supplier.language, { shop })}`;
  events.emit(businessId, "supplier.linked", { supplierId, name: supplier.name }, { actor: "vendor" });
  try {
    await telegram.sendToOwner(businessId, text(OWNER_TEXT, "supplier_linked", repo.getBusiness(businessId)?.language, { name: supplier.name }));
  } catch (err) {
    console.warn(`[suppliers] could not tell the owner a supplier linked: ${err.message}`);
  }
  return { linked: true, businessId, supplierId, reply };
}

/* ---------------------------------------------------------- shortlist --- */

/** True when one of the supplier's item words covers the need, or the need covers it ("rice" and "basmati rice"). */
function sells(supplier, item) {
  const { covers } = require("../agent/policy");
  return supplier.items.some((word) => covers(word, item) || covers(item, word));
}

/**
 * Put the owner's linked suppliers that sell this need on its shortlist (vendor kind 'human',
 * never simulated). Idempotent per requirement. Returns { added, unlinked } (names of matching
 * suppliers that have not opened their start link, so cannot be reached).
 */
function addToShortlist(businessId, requirement) {
  const already = store.supplierVendorIds(businessId, requirement.id);
  const onList = new Set([...already].map((vendorId) => store.supplierForVendor(businessId, vendorId)?.id).filter(Boolean));
  const added = [];
  const unlinked = [];
  for (const supplier of store.listSuppliers(businessId)) {
    if (!sells(supplier, requirement.item)) continue;
    if (!supplier.linked) {
      unlinked.push(supplier.name);
      continue;
    }
    if (onList.has(supplier.id)) continue;
    const vendor = repo.createVendor(businessId, {
      requirement_id: requirement.id,
      source: "human",
      name: supplier.name,
      item_title: supplier.items.join(", "),
      score_breakdown: { own_supplier: true, supplier_id: supplier.id },
    });
    store.attachVendor(businessId, vendor.id, supplier.id);
    added.push(vendor);
    events.emit(businessId, "vendor.found", { requirementId: requirement.id, vendor: { ...vendor, ownSupplier: true, real: true } }, { actor: "system" });
  }
  return { added, unlinked };
}

/** The owner's own suppliers first (in their ranked order), then everyone else as ranked. */
function ownFirst(businessId, requirementId, ranked) {
  const own = store.supplierVendorIds(businessId, requirementId);
  if (!own.size) return ranked;
  return [...ranked.filter((v) => own.has(v.id)), ...ranked.filter((v) => !own.has(v.id))];
}

/** The supplier a vendor row stands for, or null. */
const supplierForVendor = (businessId, vendorId) => store.supplierForVendor(businessId, vendorId);

/* --------------------------------------------------------- negotiation --- */

/** The invitation text (disclosure first) and its button label, in the supplier's language. */
function inviteMessage(businessId, supplier, requirement) {
  const shop = repo.getBusiness(businessId)?.name ?? "";
  const language = supplier.language;
  const quantity = money(requirement.quantity);
  const body = text(TEXT, "invite", language, {
    shop,
    quantity,
    unit: unitWord(requirement.unit, language, Number(requirement.quantity) !== 1),
    item: itemFor(businessId, requirement, language),
  });
  return { text: `${text(TEXT, "disclosure", language, { shop })} ${body}`, button: text(TEXT, "button", language) };
}

/**
 * Send the negotiation's join link to the supplier's Telegram chat. Throws TelegramError when
 * Telegram refuses or is not set up, or a SupplierError when the supplier has no linked chat.
 */
async function sendInvite({ businessId, supplier, requirement, joinUrl }) {
  if (!supplier.telegram_chat_id) throw new SupplierError("SUPPLIER_NOT_LINKED", `${supplier.name} has not opened their Telegram start link yet.`);
  const message = inviteMessage(businessId, supplier, requirement);
  const sent = await telegram.sendToChat(supplier.telegram_chat_id, `${message.text}\n${joinUrl}`, { button: { text: message.button, url: joinUrl } });
  events.emit(businessId, "supplier.invited", { supplierId: supplier.id, name: supplier.name, requirementId: requirement.id, channel: "telegram" }, { actor: "agent" });
  return sent;
}

class SupplierError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SupplierError";
    this.code = code;
  }
}

/* --------------------------------------------------- after the owner's yes --- */

/** order.created: tell the supplier the order is placed (the approval gate already passed). */
async function confirmOrder(businessId, orderId) {
  const order = repo.getOrder(businessId, orderId);
  if (!order || order.simulated) return { sent: false, reason: "not_a_supplier_order" };
  const quote = repo.getQuote(businessId, order.quote_id);
  const supplier = quote && store.supplierForVendor(businessId, quote.vendor_id);
  if (!supplier?.telegram_chat_id) return { sent: false, reason: "not_a_supplier_order" };
  const requirement = repo.getRequirement(businessId, quote.requirement_id);
  const shop = repo.getBusiness(businessId)?.name ?? "";
  const language = supplier.language;
  const body = text(TEXT, "order", language, {
    shop,
    quantity: money(requirement.quantity),
    unit: unitWord(requirement.unit, language, Number(requirement.quantity) !== 1),
    unitOne: unitWord(requirement.unit, language),
    item: itemFor(businessId, requirement, language),
    price: money(quote.unit_price),
    amount: money(order.amount),
    po: order.po_number,
  });
  await telegram.sendToChat(supplier.telegram_chat_id, `${text(TEXT, "disclosure", language, { shop })} ${body}`);
  events.emit(businessId, "supplier.order_sent", { supplierId: supplier.id, name: supplier.name, orderId, poNumber: order.po_number }, { actor: "system" });
  return { sent: true };
}

/** job.failed of a supplier negotiation nobody joined: tell the owner on Telegram, honestly. */
async function noShow(businessId, jobId) {
  const job = repo.getJob(businessId, jobId);
  if (!job?.requirement_id) return { sent: false };
  // The job row keeps no input: the latest human negotiation of its requirement is the one that waited.
  const negotiation = repo.listNegotiations(businessId, { requirement_id: job.requirement_id }).filter((n) => n.counterpart === "human").at(-1);
  const supplier = negotiation ? store.supplierForVendor(businessId, negotiation.vendor_id) : null;
  if (!supplier) return { sent: false };
  const out = await telegram.sendToOwner(businessId, text(OWNER_TEXT, "no_show", repo.getBusiness(businessId)?.language, { name: supplier.name }));
  return { sent: Boolean(out?.sent) };
}

async function onEvent(event) {
  const d = event.data ?? {};
  if (event.type === "order.created" && d.orderId) await confirmOrder(event.businessId, d.orderId);
  else if (event.type === "job.failed" && d.kind === "negotiation" && d.code === "VENDOR_DID_NOT_JOIN") await noShow(event.businessId, d.jobId);
}

/** Server boot: follow order and job events of every business. Returns the stop function. */
function start() {
  return events.subscribeAll(onEvent);
}

module.exports = {
  JOIN_MINUTES,
  TEXT,
  OWNER_TEXT,
  SupplierError,
  addSupplier,
  removeSupplier,
  listSuppliers,
  createInvite,
  linkChat,
  sells,
  addToShortlist,
  ownFirst,
  supplierForVendor,
  inviteMessage,
  sendInvite,
  confirmOrder,
  noShow,
  onEvent,
  start,
  publicView,
};
