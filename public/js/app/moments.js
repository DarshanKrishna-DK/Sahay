// Owner-facing moments as toasts (toast.js), in the owner's language. Driven by live server events
// (never by the replay before a snapshot) plus the device's own network and call state. Only the
// moments an owner acts on or wants to hear about; everything else stays on its screen.
//
//   order.created          Order placed (PO number, seller; a simulated vendor is labelled)
//   invoice.issued         Bill issued (bill number, customer, total)
//   receipt.recorded       Payment recorded (customer, amount, what is still owed)
//   stock.low              Running low (item, on hand)
//   stock.reorder_decided  accepted, then its sourcing job.started: Sahay is looking for sellers
//   rule.decided           a rule kept (active)
//   payment.link           Payment link ready (test mode)
//   followup.fired         Follow-up due
//   error                  the server's own `say`, or the few failures an owner must know about
//                          (a bill's failed PDF / pay link is said on its "Bill issued" toast)
//   call ended unexpectedly (off the Talk screen; Talk shows it on the orb), offline / online
//
// A button path that already knows the result (money pad, stock yes/no) calls notify() with the
// same id as the live event, so the moment is shown once.

import { t, has, addStrings, lang } from "./i18n.js";
import * as store from "./store.js";
import { state } from "./store.js";
import { stock, rupeesOf } from "./store-sell.js";
import { call } from "./call.js";
import { money, qtyText, itemName } from "./sell-kit.js";
import { safeUrl, num } from "./dom.js";
import { notify, dismiss, preloadToasts } from "./toast.js";

addStrings({
  "toast.order.title": ["Order placed", "ऑर्डर हो गया", "ಆರ್ಡರ್ ಆಯಿತು"],
  "toast.order.body": ["Purchase order {po} for {vendor}, {amt}.", "{vendor} के लिए खरीद ऑर्डर {po}, {amt}।", "{vendor} ಅವರಿಗೆ ಖರೀದಿ ಆರ್ಡರ್ {po}, {amt}."],
  "toast.order.bodyNoAmt": ["Purchase order {po} for {vendor}.", "{vendor} के लिए खरीद ऑर्डर {po}।", "{vendor} ಅವರಿಗೆ ಖರೀದಿ ಆರ್ಡರ್ {po}."],
  "toast.order.see": ["See order", "ऑर्डर देखें", "ಆರ್ಡರ್ ನೋಡಿ"],
  "toast.bill.title": ["Bill issued", "बिल बन गया", "ಬಿಲ್ ಆಯಿತು"],
  "toast.bill.body": ["Bill {no} for {name}: {amt}.", "{name} का बिल {no}: {amt}।", "{name} ಅವರ ಬಿಲ್ {no}: {amt}."],
  "toast.bill.see": ["See bill", "बिल देखें", "ಬಿಲ್ ನೋಡಿ"],
  "toast.paid.title": ["Payment recorded", "पैसा लिख लिया", "ಹಣ ಬರೆದಿದೆ"],
  "toast.paid.body": ["{name} paid {amt}.", "{name} ने {amt} दिए।", "{name} {amt} ಕೊಟ್ಟರು."],
  "toast.paid.owes": ["Still owes {amt}.", "अभी {amt} बाकी है।", "ಇನ್ನೂ {amt} ಬಾಕಿ ಇದೆ."],
  "toast.paid.clear": ["Nothing left to pay.", "अब कुछ बाकी नहीं।", "ಇನ್ನು ಏನೂ ಬಾಕಿ ಇಲ್ಲ."],
  "toast.low.title": ["Running low: {item}", "कम हो रहा है: {item}", "ಕಡಿಮೆ ಆಗುತ್ತಿದೆ: {item}"],
  "toast.low.body": ["{q} left. You asked to reorder at {level}.", "{q} बचा है। आपने {level} पर फिर मँगाने को कहा था।", "{q} ಉಳಿದಿದೆ. {level} ಆದಾಗ ಮತ್ತೆ ತರಿಸಲು ಹೇಳಿದ್ದೀರಿ."],
  "toast.low.bodyNoLevel": ["{q} left.", "{q} बचा है।", "{q} ಉಳಿದಿದೆ."],
  "toast.low.see": ["See stock", "माल देखें", "ದಾಸ್ತಾನು ನೋಡಿ"],
  "toast.search.title": ["Finding sellers", "विक्रेता ढूँढ रही है", "ಮಾರಾಟಗಾರರ ಹುಡುಕಾಟ"],
  "toast.search.body": ["Sahay started looking for sellers of {item}. Nothing is ordered without your yes.", "सहाय ने {item} के विक्रेता ढूँढना शुरू किया। आपकी हाँ के बिना कुछ नहीं मँगाया जाएगा।", "ಸಹಾಯ್ {item} ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕಲು ಶುರು ಮಾಡಿದೆ. ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಏನೂ ತರಿಸುವುದಿಲ್ಲ."],
  "toast.search.bodyNoItem": ["Sahay started looking for sellers. Nothing is ordered without your yes.", "सहाय ने विक्रेता ढूँढना शुरू किया। आपकी हाँ के बिना कुछ नहीं मँगाया जाएगा।", "ಸಹಾಯ್ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕಲು ಶುರು ಮಾಡಿದೆ. ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಏನೂ ತರಿಸುವುದಿಲ್ಲ."],
  "toast.search.see": ["See search", "खोज देखें", "ಹುಡುಕಾಟ ನೋಡಿ"],
  "toast.need.title": ["Need saved", "ज़रूरत लिख ली", "ಅಗತ್ಯ ಬರೆದಿದೆ"],
  "toast.need.body": ["Tell Sahay how much {item} to buy; then it looks for sellers.", "सहाय को बताइए कितना {item} लेना है; फिर वह विक्रेता ढूँढेगी।", "ಎಷ್ಟು {item} ಬೇಕು ಎಂದು ಸಹಾಯ್‌ಗೆ ಹೇಳಿ; ನಂತರ ಅದು ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತದೆ."],
  "toast.search.failed": ["Search did not start", "खोज शुरू नहीं हुई", "ಹುಡುಕಾಟ ಶುರುವಾಗಲಿಲ್ಲ"],
  "toast.search.failedBody": ["The need is saved. Ask Sahay to look for sellers again.", "ज़रूरत लिख ली गई है। सहाय से फिर विक्रेता ढूँढने को कहिए।", "ಅಗತ್ಯ ಬರೆದಿದೆ. ಮತ್ತೆ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕಲು ಸಹಾಯ್‌ಗೆ ಹೇಳಿ."],
  "toast.rule.title": ["Rule kept", "नियम याद रखा", "ನಿಯಮ ನೆನಪಿಟ್ಟಿದೆ"],
  "toast.link.title": ["Payment link ready", "भुगतान लिंक तैयार", "ಪಾವತಿ ಲಿಂಕ್ ಸಿದ್ಧ"],
  "toast.link.body": ["Order {po}, {amt}. Test mode: no real money moves.", "ऑर्डर {po}, {amt}। टेस्ट मोड: असली पैसा नहीं जाता।", "ಆರ್ಡರ್ {po}, {amt}. ಪರೀಕ್ಷಾ ಮೋಡ್: ನಿಜವಾದ ಹಣ ಹೋಗುವುದಿಲ್ಲ."],
  "toast.link.open": ["Open link", "लिंक खोलें", "ಲಿಂಕ್ ತೆರೆಯಿರಿ"],
  "toast.followup.title": ["Follow-up due", "याद दिलाने का समय", "ನೆನಪಿಸುವ ಸಮಯ"],
  "toast.err.title": ["Could not finish", "पूरा नहीं हो सका", "ಪೂರ್ಣವಾಗಲಿಲ್ಲ"],
  "toast.err.billPdf": ["Bill {no} is issued, but its PDF could not be made.", "बिल {no} बन गया, पर उसकी PDF नहीं बन सकी।", "ಬಿಲ್ {no} ಆಯಿತು, ಆದರೆ ಅದರ PDF ಆಗಲಿಲ್ಲ."],
  "toast.err.billPay": ["Bill {no} is issued, but its payment link could not be made.", "बिल {no} बन गया, पर भुगतान लिंक नहीं बन सका।", "ಬಿಲ್ {no} ಆಯಿತು, ಆದರೆ ಪಾವತಿ ಲಿಂಕ್ ಆಗಲಿಲ್ಲ."],
  "toast.err.poPdf": ["Order {po} is placed, but its PDF could not be made.", "ऑर्डर {po} हो गया, पर उसकी PDF नहीं बन सकी।", "ಆರ್ಡರ್ {po} ಆಯಿತು, ಆದರೆ ಅದರ PDF ಆಗಲಿಲ್ಲ."],
  "toast.err.badSignature": ["A payment confirmation was refused: its signature was wrong. No money was recorded.", "एक भुगतान की पुष्टि ठुकराई गई: उसका हस्ताक्षर गलत था। कोई पैसा नहीं लिखा गया।", "ಒಂದು ಪಾವತಿ ದೃಢೀಕರಣ ತಿರಸ್ಕರಿಸಲಾಯಿತು: ಅದರ ಸಹಿ ತಪ್ಪಾಗಿತ್ತು. ಯಾವ ಹಣವೂ ಬರೆದಿಲ್ಲ."],
  "toast.err.unpayable": ["A payment came for order {po}, which cannot take one now. Check the order.", "ऑर्डर {po} के लिए भुगतान आया, पर वह अभी भुगतान नहीं ले सकता। ऑर्डर देखें।", "ಆರ್ಡರ್ {po} ಗೆ ಪಾವತಿ ಬಂತು, ಆದರೆ ಅದು ಈಗ ಪಾವತಿ ಪಡೆಯುವಂತಿಲ್ಲ. ಆರ್ಡರ್ ನೋಡಿ."],
  "toast.call.title": ["Call ended", "कॉल खत्म हुई", "ಕರೆ ಮುಗಿಯಿತು"],
  "toast.call.again": ["Talk again", "फिर बात करें", "ಮತ್ತೆ ಮಾತಾಡಿ"],
  "toast.offline.title": ["No internet", "इंटरनेट नहीं है", "ಇಂಟರ್ನೆಟ್ ಇಲ್ಲ"],
  "toast.offline.body": ["Your work is kept. Updates come back with the internet.", "आपका काम सुरक्षित है। इंटरनेट आते ही ताज़ा खबर लौटेगी।", "ನಿಮ್ಮ ಕೆಲಸ ಉಳಿದಿದೆ. ಇಂಟರ್ನೆಟ್ ಬಂದಾಗ ತಾಜಾ ಸುದ್ದಿ ಮರಳುತ್ತದೆ."],
  "toast.online.title": ["Back online", "इंटरनेट वापस आ गया", "ಇಂಟರ್ನೆಟ್ ಮರಳಿ ಬಂತು"],
  "toast.notNow": ["Okay, not now", "ठीक है, अभी नहीं", "ಸರಿ, ಈಗ ಬೇಡ"],
});

const LANG_CODE = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };
const go = (hash) => () => { location.hash = hash; };
const vendorWord = (name, simulated) => {
  const v = name || "";
  return simulated ? (v ? `${v} (${t("simulated")})` : t("simulated")) : v;
};

/** An item row from an event ({ name, name_native, unit }) as the screens name it. */
const itemWord = (raw) => (raw && typeof raw === "object"
  ? itemName({ name: raw.name, nameNative: raw.name_native ?? raw.nameNative })
  : "");

/* ----------------------------------------------------- shared moments -- */

/** Payment recorded: the money pad's button and the live event share this. */
export function notifyPaid({ receiptId, customerId, name, amount, owed }) {
  const parts = [t("toast.paid.body", { name: name || "", amt: money(amount) })];
  if (owed !== null && owed !== undefined) parts.push(owed > 0 ? t("toast.paid.owes", { amt: money(owed) }) : t("toast.paid.clear"));
  return notify({
    id: receiptId ? `receipt:${receiptId}` : undefined,
    tone: "success", icon: "cash",
    title: t("toast.paid.title"), body: parts.join(" "),
    speakKey: customerId ? `owed:${customerId}` : undefined,
  });
}

/** Sahay started looking for sellers after the owner's yes to "buy more?". */
export function notifyReorder({ proposalId, itemId, requirementId }) {
  const it = itemId ? stock.items.get(String(itemId)) : null;
  const name = it ? itemName(it) : "";
  return notify({
    id: proposalId ? `reorder:${proposalId}` : undefined,
    tone: "info", icon: "search",
    title: t("toast.search.title"),
    body: name ? t("toast.search.body", { item: name }) : t("toast.search.bodyNoItem"),
    speakKey: requirementId ? `need:${requirementId}` : undefined,
    action: { label: t("toast.search.see"), icon: "cart", run: go("#/buy") },
  });
}

/** "Yes, buy more" saved the need but no search started: Sahay needs the quantity first. */
export function notifyNeedSaved({ proposalId, itemId }) {
  const it = itemId ? stock.items.get(String(itemId)) : null;
  return notify({
    id: proposalId ? `reorder:${proposalId}` : undefined,
    tone: "info", icon: "mic",
    title: t("toast.need.title"),
    body: t("toast.need.body", { item: it ? itemName(it) : "" }),
    action: { label: t("toast.call.again"), icon: "mic", run: go("#/talk") },
  });
}

/** The owner's "no" to "buy more?" on the Stock screen. */
export function notifyNotNow({ proposalId }) {
  return notify({ id: proposalId ? `reorder:${proposalId}` : undefined, tone: "info", icon: "check", title: t("toast.notNow"), duration: 3500 });
}

/* ---------------------------------------------------------- live events -- */

const reorders = new Map(); // requirementId -> { proposalId, itemId }: a "buy more" yes waiting for its search

function onEvent(evt) {
  const d = evt.data && typeof evt.data === "object" ? evt.data : {};
  switch (evt.type) {
    case "order.created": {
      const po = d.poNumber || d.po_number || "";
      const vendor = vendorWord(d.vendor || d.vendorName, Boolean(d.simulated));
      const amt = num(d.amount) !== null ? money(d.amount) : "";
      notify({
        id: `order:${d.orderId}`, tone: "success", icon: "doc",
        title: t("toast.order.title"),
        body: t(amt ? "toast.order.body" : "toast.order.bodyNoAmt", { po, vendor, amt }),
        speakKey: d.orderId ? `order:${d.orderId}` : undefined,
        action: { label: t("toast.order.see"), icon: "doc", run: go("#/buy") },
      });
      break;
    }
    case "invoice.issued": {
      const inv = d.invoice && typeof d.invoice === "object" ? d.invoice : null;
      if (!inv || !inv.id) break;
      const name = (inv.customer && inv.customer.name) || (inv.recipient && inv.recipient.name) || "";
      const total = rupeesOf(inv.totals && typeof inv.totals === "object" ? inv.totals : {}, "total");
      // A PDF or pay link that failed is said on the same toast (its error event is not toasted).
      const steps = new Set((Array.isArray(d.problems) ? d.problems : []).map((p) => p && p.step));
      const parts = [t("toast.bill.body", { no: inv.number || "", name, amt: money(total) })];
      if (steps.has("pdf")) parts.push(t("toast.err.billPdf", { no: inv.number || "" }));
      if (steps.has("pay")) parts.push(t("toast.err.billPay", { no: inv.number || "" }));
      notify({
        id: `invoice:${inv.id}`, tone: steps.size ? "warning" : "success", icon: "receipt",
        title: t("toast.bill.title"),
        body: parts.join(" "),
        speakKey: `invoice:${inv.id}`,
        action: { label: t("toast.bill.see"), icon: "receipt", run: go("#/sell") },
      });
      break;
    }
    case "receipt.recorded": {
      const r = d.receipt && typeof d.receipt === "object" ? d.receipt : {};
      const cust = d.customer && typeof d.customer === "object" ? d.customer : {};
      notifyPaid({
        receiptId: r.id, customerId: cust.id || r.customer_id,
        name: cust.name || r.customer_name, amount: rupeesOf(r, "amount"),
        owed: num(d.owed) ?? (num(d.owed_paise) !== null ? d.owed_paise / 100 : null),
      });
      break;
    }
    case "stock.low": {
      const it = d.item && typeof d.item === "object" ? d.item : {};
      const unit = d.unit || it.unit;
      const q = qtyText(num(d.on_hand ?? d.onHand) ?? 0, unit);
      const level = num(d.level);
      notify({
        id: `low:${it.id}:${d.on_hand ?? d.onHand}`, tone: "warning", icon: "jar",
        title: t("toast.low.title", { item: itemWord(it) }),
        body: level !== null ? t("toast.low.body", { q, level: qtyText(level, unit) }) : t("toast.low.bodyNoLevel", { q }),
        speakKey: it.id ? `item:${it.id}` : undefined,
        action: { label: t("toast.low.see"), icon: "jar", run: go("#/stock") },
      });
      break;
    }
    case "stock.reorder_decided":
      // "Yes, buy more" saves a need; the toast waits for the search itself to start (a need
      // without a quantity is asked about first, so no search starts yet).
      if (d.status === "accepted" && d.requirementId) {
        reorders.set(String(d.requirementId), { proposalId: d.proposalId, itemId: d.itemId });
        if (reorders.size > 20) reorders.delete(reorders.keys().next().value);
      }
      break;
    case "job.started": {
      const input = d.input && typeof d.input === "object" ? d.input : {};
      const rid = input.requirementId !== undefined ? String(input.requirementId) : null;
      const r = d.kind === "sourcing" && rid ? reorders.get(rid) : null;
      if (r) { reorders.delete(rid); notifyReorder({ ...r, requirementId: rid }); }
      break;
    }
    case "rule.decided": {
      const rule = d.rule && typeof d.rule === "object" ? d.rule : null;
      if (!rule || rule.status !== "active" || d.reason) break;
      const sentence = rule.sentence && (rule.sentence[LANG_CODE[lang()]] || rule.sentence["en-IN"]);
      notify({ id: `rule:${rule.id}`, tone: "success", icon: "heart", title: t("toast.rule.title"), body: sentence || "", speakKey: `rule:${rule.id}` });
      break;
    }
    case "payment.link": {
      const url = safeUrl(d.url);
      const o = d.orderId !== undefined ? state.orders.get(String(d.orderId)) : null;
      notify({
        id: `paylink:${d.orderId}:${d.url}`, tone: "action", icon: "rupee",
        title: t("toast.link.title"),
        body: t("toast.link.body", { po: d.poNumber || (o && o.poNumber) || "", amt: money(d.amount ?? (o && o.amount)) }),
        speakKey: d.orderId ? `order:${d.orderId}` : undefined,
        action: url ? { label: t("toast.link.open"), icon: "external", href: url, newTab: true } : undefined,
      });
      break;
    }
    case "followup.fired":
      notify({
        id: `followup:${d.followupId || d.orderId}`, tone: "info", icon: "bell",
        title: t("toast.followup.title"), body: typeof d.message === "string" ? d.message : "",
        speakKey: d.orderId ? `order:${d.orderId}` : undefined,
        action: d.orderId ? { label: t("toast.order.see"), icon: "doc", run: go("#/buy") } : undefined,
      });
      break;
    case "error": {
      const body = errorWords(d);
      if (body) notify({ id: `error:${evt.id ?? `${d.code}:${d.scope}:${d.orderId || d.invoiceId || ""}`}`, tone: "error", icon: "alert", title: t("toast.err.title"), body });
      break;
    }
    default:
      break;
  }
}

/** The owner's words for a server error: its own `say`, or one of the failures that need the owner. */
function errorWords(d) {
  if (typeof d.say === "string" && d.say.trim()) return d.say.trim();
  if (d.code === "PAYMENT_SIGNATURE_INVALID") return t("toast.err.badSignature");
  if (d.code === "PAYMENT_FOR_UNPAYABLE_ORDER") return t("toast.err.unpayable", { po: d.poNumber || d.po_number || "" });
  if (d.scope === "order.po") return t("toast.err.poPdf", { po: d.poNumber || "" });
  // invoice.pdf / invoice.pay are said on the "Bill issued" toast; tool and Telegram errors are
  // spoken on the call or shown where they happen.
  return null;
}

/* ------------------------------------------------------- call and network -- */

let lastEnded = null;
function onTalkScreen() {
  const m = /^#\/([a-z]+)/.exec(location.hash || "");
  return !m || m[1] === "talk";
}
function watchCall() {
  const ended = call.ended;
  if (ended === lastEnded) return;
  lastEnded = ended;
  if (!ended || ended.reason === "offline" || onTalkScreen()) return; // Talk shows it on the orb; offline has its own toast
  const key = ended.reason && has(`call.${ended.reason}`) ? `call.${ended.reason}` : "talk.ended";
  notify({ tone: "warning", icon: "phoneOff", title: t("toast.call.title"), body: t(key),
    action: { label: t("toast.call.again"), icon: "mic", run: go("#/talk") } });
}

let offlineShown = false;
function offline() {
  // D15: the shell's sticky banner under the capsule says it (no toast on top of the titles).
  offlineShown = true;
}
function online() {
  // A short visible "back online" (2.5 s); the offline state itself is the shell's banner.
  offlineShown = false;
  dismiss("net:offline");
  notify({ id: "net:online", replace: true, tone: "success", icon: "wifi", title: t("toast.online.title"), duration: 2500 });
}
window.addEventListener("offline", offline);
window.addEventListener("online", online);
if (navigator.onLine === false) offline();

/* ---------------------------------------------------------------- wiring -- */

store.onEvent(onEvent);
store.subscribe((_s, parts) => {
  if (parts.has("boot") && state.boot === "ready") preloadToasts();
  if (parts.has("call")) watchCall();
});
