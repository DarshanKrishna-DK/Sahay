// The discovery board (UI v7): what Sahay found for the current need, live, so the owner can see
// and pick a deal while Sahay talks. Home mounts it in its right panel (W2); Buy may reuse it.
//   1. The need: item, quantity, city, price cap.
//   2. Sellers found, best first (top 5, then "Show all"): name, city, rating, listed price, where
//      it came from (IndiaMART / Your supplier / simulated vendor), "View on IndiaMART" (the real
//      listing, new tab) and "Bargain with this seller".
//   3. Bargaining, round by round: the seller's ask, Sahay's counter, the agreed price; the lowest
//      ask highlighted.
//   4. Best deal: seller, price, total, and "Choose this deal" (opens the Yes card, yes.js, when an
//      approval waits) or "Ask Sahay to read it out" (a typed request: it never says yes).
// Picking a seller is a typed turn to the live call ("Bargain with <name>") through the existing
// typed-session path (call.js sendText starts one if none); the approval gate is untouched:
// "Choose this deal" only OPENS the Yes card; the yes itself is the owner's spoken yes or Yes button.
// "simulated vendor" shows on the seller card, on every bargaining round and on the best deal.
// Data shaping is discovery-model.js (tested); every figure comes from the store.
//
//   const board = createDiscoveryBoard();   // -> { el, update(), destroy() }
//   panel.append(board.el);                 // it follows the store by itself; destroy() when unmounted

import { h, icon, patch, scripted, rupees, amount, button, card, chip, emptyState, loader, errorLine } from "./ui.js";
import { t, unitWord, cityWord, addStrings } from "./i18n.js";
import { state, subscribe } from "./store.js";
import { sendText } from "./call.js";
import { stationsFor, ladderRows } from "./buy-model.js";
import { needCard, sellerCards, bargainRounds, bestDeal } from "./discovery-model.js";
import { itemWords } from "./buy-kit.js";

addStrings({
  "dsc.label": ["What Sahay found", "सहाय को क्या मिला", "ಸಹಾಯ್‌ಗೆ ಏನು ಸಿಕ್ಕಿತು"],
  "dsc.need": ["Now buying", "अभी खरीद रहे हैं", "ಈಗ ಖರೀದಿ"],
  "dsc.sellers": ["Sellers found", "मिले विक्रेता", "ಸಿಕ್ಕ ಮಾರಾಟಗಾರರು"],
  "dsc.searching": ["Sahay is searching IndiaMART", "सहाय IndiaMART पर ढूँढ रही है", "ಸಹಾಯ್ IndiaMART ನಲ್ಲಿ ಹುಡುಕುತ್ತಿದೆ"],
  "dsc.noSellers": ["No sellers found yet.", "अभी कोई विक्रेता नहीं मिला।", "ಇನ್ನೂ ಮಾರಾಟಗಾರರು ಸಿಕ್ಕಿಲ್ಲ."],
  "dsc.src.indiamart": ["IndiaMART", "IndiaMART", "IndiaMART"],
  "dsc.src.supplier": ["Your supplier", "आपका सप्लायर", "ನಿಮ್ಮ ಸರಬರಾಜುದಾರ"],
  "dsc.view": ["View on IndiaMART", "IndiaMART पर देखें", "IndiaMART ನಲ್ಲಿ ನೋಡಿ"],
  "dsc.viewLong": ["View {name} on IndiaMART (opens a new tab)", "{name} को IndiaMART पर देखें (नया टैब)", "{name} ಅನ್ನು IndiaMART ನಲ್ಲಿ ನೋಡಿ (ಹೊಸ ಟ್ಯಾಬ್)"],
  "dsc.bargainThis": ["Bargain with this seller", "इस विक्रेता से मोलभाव", "ಈ ಮಾರಾಟಗಾರರ ಜೊತೆ ಚೌಕಾಸಿ"],
  "dsc.bargainSay": ["Bargain with {name}.", "{name} से मोलभाव करो।", "{name} ಜೊತೆ ಚೌಕಾಸಿ ಮಾಡು."],
  "dsc.sent": ["Asked Sahay", "सहाय को कह दिया", "ಸಹಾಯ್‌ಗೆ ಹೇಳಿದೆ"],
  "dsc.sendFail": ["Could not reach Sahay. Try again.", "सहाय तक बात नहीं पहुँची। फिर कोशिश करें।", "ಸಹಾಯ್‌ಗೆ ತಲುಪಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."],
  "dsc.talking": ["Bargaining now", "मोलभाव चल रहा है", "ಚೌಕಾಸಿ ನಡೆಯುತ್ತಿದೆ"],
  "dsc.rating": ["{r} stars", "{r} स्टार", "{r} ನಕ್ಷತ್ರ"],
  "dsc.bargaining": ["Bargaining", "मोलभाव", "ಚೌಕಾಸಿ"],
  "dsc.seller": ["Seller", "विक्रेता", "ಮಾರಾಟಗಾರ"],
  "dsc.lowest": ["Lowest ask {p}", "सबसे कम माँग {p}", "ಕನಿಷ್ಠ ಬೇಡಿಕೆ {p}"],
  "dsc.best": ["Best deal", "सबसे अच्छा सौदा", "ಉತ್ತಮ ವ್ಯವಹಾರ"],
  "dsc.choose": ["Choose this deal", "यह सौदा चुनें", "ಈ ವ್ಯವಹಾರ ಆರಿಸಿ"],
  "dsc.readOut": ["Ask Sahay to read it out", "सहाय से पढ़वाएँ", "ಸಹಾಯ್‌ಗೆ ಓದಲು ಹೇಳಿ"],
  "dsc.readOutSay": ["Read out the best deal for my yes.", "सबसे अच्छा सौदा मेरी हाँ के लिए पढ़ो।", "ಉತ್ತಮ ವ್ಯವಹಾರವನ್ನು ನನ್ನ ಒಪ್ಪಿಗೆಗಾಗಿ ಓದು."],
  "dsc.waiting": ["Waiting for your yes", "आपकी हाँ का इंतज़ार", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತಿದೆ"],
  "dsc.noTotal": ["Total not worked out yet", "कुल अभी तय नहीं", "ಒಟ್ಟು ಇನ್ನೂ ಲೆಕ್ಕವಾಗಿಲ್ಲ"],
  "dsc.showAll": ["Show all ({n})", "सब देखें ({n})", "ಎಲ್ಲಾ ನೋಡಿ ({n})"],
  "dsc.showLess": ["Show fewer", "कम दिखाएँ", "ಕಡಿಮೆ ತೋರಿಸಿ"],
  "dsc.empty.title": ["Nothing being bought right now", "अभी कुछ नहीं खरीदा जा रहा", "ಈಗ ಏನೂ ಖರೀದಿಸುತ್ತಿಲ್ಲ"],
  "dsc.empty.text": [
    "When you ask Sahay to buy, the sellers it finds and the best deals show here.",
    "जब आप सहाय से खरीदने को कहेंगे, मिले विक्रेता और सबसे अच्छे सौदे यहाँ दिखेंगे।",
    "ಸಹಾಯ್‌ಗೆ ಖರೀದಿಸಲು ಹೇಳಿದಾಗ, ಸಿಕ್ಕ ಮಾರಾಟಗಾರರು ಮತ್ತು ಉತ್ತಮ ವ್ಯವಹಾರಗಳು ಇಲ್ಲಿ ಕಾಣುತ್ತವೆ.",
  ],
});

const perUnit = (p, unit) => `${rupees(p)}${unit ? ` / ${unitWord(unit)}` : ""}`;
const langKey = () => document.documentElement.lang;

function ensureCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(h("link", { rel: "stylesheet", href }));
}

/** The source badge: IndiaMART (info), your supplier (good), simulated vendor (warn, rule 4). */
function sourceChip(source) {
  if (source === "simulated") return chip(t("simulated"), { tone: "warn" });
  if (source === "supplier") return chip(t("dsc.src.supplier"), { tone: "good" });
  return chip(t("dsc.src.indiamart"), { tone: "info" });
}

/** Open W3's Yes card for a deal (yes.js), or the shell's Needs you host while it loads. */
async function openYes(key) {
  try {
    const m = await import("./yes.js");
    if (m && typeof m.openNeeds === "function") { m.openNeeds(key); return; }
  } catch { /* the shell's host below */ }
  document.dispatchEvent(new CustomEvent("sahay:open-needs"));
}

export function createDiscoveryBoard() {
  ensureCss("/css/discovery.css");
  const el = h("section", { class: "dsc", "aria-label": t("dsc.label") });
  const ask = new Map(); // vendorId | "readout" -> { busy, sent, error }
  let showAll = false;

  /** A typed turn to Sahay (starts a typed session when no call is on). It asks; it never says yes. */
  async function say(key, text) {
    if ((ask.get(key) || {}).busy) return;
    ask.set(key, { busy: true });
    render(true);
    const ok = await sendText(text).catch(() => false);
    ask.set(key, ok ? { sent: true } : { error: t("dsc.sendFail") });
    render(true);
    if (ok) setTimeout(() => { if ((ask.get(key) || {}).sent) { ask.delete(key); render(true); } }, 4000);
  }

  function needView(n) {
    const facts = [
      n.city ? h("span", { class: "dsc-fact" }, icon("pin", 18), scripted("span", cityWord(n.city))) : null,
      n.maxPrice !== null ? h("span", { class: "dsc-fact" }, icon("tag", 18), h("span", { text: t("work.upTo", { p: perUnit(n.maxPrice, n.unit) }) })) : null,
    ].filter(Boolean);
    return card({ cls: "dsc-need", body: [
      h("p", { class: "dsc-hud", text: t("dsc.need") }),
      h("p", { class: "dsc-need-line" },
        n.quantity !== null ? h("span", { class: "dsc-num", text: amount(n.quantity) }) : null,
        n.unit ? h("span", { class: "dsc-unit", text: unitWord(n.unit) }) : null,
        scripted("span", itemWords(n.item), { class: "dsc-item" })),
      facts.length ? h("p", { class: "dsc-facts" }, ...facts) : null,
    ].filter(Boolean) });
  }

  function sellerView(s) {
    const a = ask.get(s.id) || {};
    return h("li", { class: `dsc-seller${s.live ? " is-live" : ""}` },
      h("div", { class: "dsc-seller-top" },
        s.rank !== null ? h("span", { class: "dsc-rank", "aria-hidden": "true", text: String(s.rank) }) : null,
        h("div", { class: "dsc-seller-main" },
          scripted("h4", s.name, { class: "dsc-seller-name" }),
          h("p", { class: "dsc-seller-meta" },
            s.city ? scripted("span", cityWord(s.city)) : null,
            s.rating !== null ? h("span", { class: "dsc-rating" }, icon("star", 16), h("span", { text: t("dsc.rating", { r: s.rating }) })) : null)),
        sourceChip(s.source)),
      s.price !== null || s.priceText ? h("p", { class: "dsc-price" },
        s.price !== null ? h("span", { class: "dsc-num", text: rupees(s.price) }) : scripted("span", s.priceText, { class: "dsc-price-text" }),
        s.price !== null && s.unit ? h("span", { class: "dsc-unit", text: `/ ${unitWord(s.unit)}` }) : null) : null,
      s.live ? h("p", { class: "dsc-live", role: "status" }, h("span", { class: "dsc-live-dot", "aria-hidden": "true" }), h("span", { text: t("dsc.talking") })) : null,
      a.error ? errorLine(a.error) : null,
      h("div", { class: "dsc-seller-acts" },
        s.url ? h("a", { class: "btn btn-secondary btn-sm btn-noarrow dsc-view", href: s.url, target: "_blank", rel: "noopener noreferrer", "aria-label": t("dsc.viewLong", { name: s.name }) },
          icon("external", 18), h("span", { text: t("dsc.view") })) : null,
        a.sent
          ? h("p", { class: "dsc-sent", role: "status" }, icon("check", 18), h("span", { text: t("dsc.sent") }))
          : button({ word: t("dsc.bargainThis"), icon: "handshake", kind: "secondary", size: "sm", busy: Boolean(a.busy), cls: "btn-noarrow",
            onClick: () => say(s.id, t("dsc.bargainSay", { name: s.name })) })));
  }

  function sellersView(sellers, searching) {
    const shown = showAll ? sellers : sellers.slice(0, 5);
    return h("div", { class: "dsc-block" },
      h("h3", { class: "dsc-title" }, h("span", { text: t("dsc.sellers") }), sellers.length ? h("span", { class: "dsc-count", text: String(sellers.length) }) : null),
      searching ? loader(t("dsc.searching")) : null,
      sellers.length ? h("ol", { class: "dsc-sellers" }, ...shown.map(sellerView))
        : searching ? null : h("p", { class: "dsc-quiet", text: t("dsc.noSellers") }),
      sellers.length > 5 ? h("button", { class: "link-btn show-all", type: "button", on: { click: () => { showAll = !showAll; render(true); } } },
        h("span", { text: showAll ? t("dsc.showLess") : t("dsc.showAll", { n: sellers.length }) })) : null);
  }

  function bargainView(m, b) {
    const n = m.negotiation;
    const v = n && n.vendorId !== undefined && n.vendorId !== null ? state.vendors.get(String(n.vendorId)) : null;
    const sim = Boolean((v && v.simulated) || (n && n.counterpart === "simulated"));
    return card({ cls: "dsc-bargain", body: [
      h("div", { class: "dsc-head" },
        h("h3", { class: "dsc-title", text: t("dsc.bargaining") }),
        m.runningNegotiation ? h("span", { class: "dsc-live", role: "status" }, h("span", { class: "dsc-live-dot", "aria-hidden": "true" }), h("span", { text: t("dsc.talking") })) : null),
      v ? h("p", { class: "dsc-who" }, icon("store", 18), scripted("span", v.name), sim ? chip(t("simulated"), { tone: "warn" }) : null) : null,
      h("ol", { class: "dsc-rounds" }, ...b.rounds.map((r) => h("li", { class: `dsc-round${b.agreed !== null && (r.ask === b.agreed || r.counter === b.agreed) ? " is-agreed" : ""}` },
        h("span", { class: "dsc-round-n" }, h("span", { text: t("b5.round", { n: r.round }) }), sim ? h("span", { class: "dsc-sim", text: t("simulated") }) : null),
        h("span", { class: "dsc-round-ask" }, h("span", { class: "dsc-hud", text: t("dsc.seller") }),
          h("span", { class: `dsc-num${r.ask !== null && r.ask === b.best ? " is-best" : ""}`, text: r.ask !== null ? rupees(r.ask) : "—" })),
        icon("arrowRight", 16, "dsc-round-arrow"),
        h("span", { class: "dsc-round-counter" }, h("span", { class: "dsc-hud", text: t("b4.lad.sahay") }),
          h("span", { class: "dsc-num", text: r.counter !== null ? rupees(r.counter) : "—" }))))),
      b.agreed !== null ? h("p", { class: "dsc-agreed" }, icon("check", 20), h("span", { text: t("ladder.agreed", { p: perUnit(b.agreed, b.unit) }) }))
        : b.best !== null ? h("p", { class: "dsc-lowest", text: t("dsc.lowest", { p: perUnit(b.best, b.unit) }) }) : null,
      b.noDeal ? errorLine(t("ladder.noDeal")) : null,
    ].filter(Boolean) });
  }

  function dealView(d) {
    const v = d.vendorId !== null ? state.vendors.get(String(d.vendorId)) : null;
    const sim = Boolean(v && v.simulated);
    const a = ask.get("readout") || {};
    const action = d.approvalId
      ? button({ word: t("dsc.choose"), icon: "check", kind: "primary", block: true, onClick: () => openYes(`approval:${d.approvalId}`) })
      : a.sent
        ? h("p", { class: "dsc-sent", role: "status" }, icon("check", 18), h("span", { text: t("dsc.sent") }))
        : button({ word: t("dsc.readOut"), icon: "speaker", kind: "primary", block: true, busy: Boolean(a.busy), onClick: () => say("readout", t("dsc.readOutSay")) });
    return card({ cls: `dsc-deal${d.approvalId ? " card-needs" : ""}`, body: [
      h("p", { class: "dsc-hud", text: t("dsc.best") }),
      v ? h("p", { class: "dsc-who" }, icon("store", 18), scripted("span", v.name), sim ? chip(t("simulated"), { tone: "warn" }) : null) : null,
      d.unitPrice !== null ? h("p", { class: "dsc-price" }, h("span", { class: "dsc-num", text: rupees(d.unitPrice) }), d.unit ? h("span", { class: "dsc-unit", text: `/ ${unitWord(d.unit)}` }) : null,
        d.quantity !== null ? h("span", { class: "dsc-unit", text: `× ${amount(d.quantity)} ${unitWord(d.unit)}`.trim() }) : null) : null,
      d.total !== null
        ? h("p", { class: "dsc-total" }, h("span", { class: "dsc-hud", text: t("b4.total") }), h("span", { class: "dsc-big", text: rupees(d.total) }))
        : h("p", { class: "dsc-quiet", text: t("dsc.noTotal") }),
      d.approvalId ? h("p", { class: "dsc-waiting" }, icon("alert", 18), h("span", { text: t("dsc.waiting") })) : null,
      a.error ? errorLine(a.error) : null,
      action,
    ].filter(Boolean) });
  }

  function render(force = false) {
    if (force) el.__key = null;
    const req = state.boot === "ready" ? state.requirement : null;
    const m = req ? stationsFor(state, req) : null;
    const sellers = req ? sellerCards(state.vendors, { negotiations: state.negotiations, requirementId: req.id }) : [];
    const lad = m ? ladderRows(m.negotiation) : null;
    const b = lad ? bargainRounds(lad) : null;
    const deal = req ? bestDeal({ quotes: state.quotes, approvals: state.approvals, negotiation: m.negotiation, agreed: lad.agreed, unit: lad.unit }, req) : null;
    const searching = Boolean(m && m.stations[1].status === "active");
    const key = JSON.stringify([langKey(), req, sellers, b, deal, searching, Boolean(m && m.runningNegotiation), [...ask.entries()], showAll, state.vendors.size]);
    patch(el, key, () => {
      if (!req) return emptyState({ icon: "search", title: t("dsc.empty.title"), text: t("dsc.empty.text") });
      return [
        needView(needCard(req)),
        sellersView(sellers, searching),
        b && (b.rounds.length || m.runningNegotiation) ? bargainView(m, b) : null,
        deal ? dealView(deal) : null,
      ].filter(Boolean);
    });
  }

  const PARTS = ["all", "lang", "work", "approvals", "orders", "stream"];
  const off = subscribe((_s, parts) => { if (PARTS.some((p) => parts.has(p))) render(); });
  render();
  return { el, update: () => render(), destroy: () => off() };
}
