// The discovery board (UI v7): what Sahay found for the current need, live, so the owner can see
// and pick a deal while Sahay talks. Home mounts it in its right panel (W2); Buy shows it too.
//   1. The need: item, quantity, city, price cap.
//   2. Sellers found, best first (top 5, then "Show all"): name, city, rating (and how many rated),
//      price, where it came from (IndiaMART / Your supplier / simulated vendor), "View on IndiaMART"
//      (the real listing, new tab) and "Bargain with this seller".
//   3. Bargaining, round by round: the seller's ask, Sahay's counter, the agreed price; the lowest
//      ask highlighted; "simulated vendor" on every round when it is one; Listen in while live.
//   4. Best deal: seller, price, total, and "Choose this deal" (only OPENS the Yes card, yes.js,
//      when an approval is pending) or "Ask Sahay to read it out" (a typed request, never a yes).
//
// Data: GET /api/discovery (src/procurement/board.js), fetched on the events that change it (a
// short debounce, one request at a time); until it answers, or on a server without it, the same
// board is drawn from the store. Rendering never loads, never touches the store (no render loops).
// "Bargain with this seller" is POST /api/negotiations { vendorId }: it only starts bargaining; a
// deal still needs the owner's yes. Refusals show the server's own words (say, else message).
//
//   const board = createDiscoveryBoard();   // -> { el, update(), pause(), destroy() }  pause() stops Listen in
//   panel.append(board.el);                 // it follows the store and the events by itself

import { h, icon, patch, scripted, rupees, amount, button, card, chip, emptyState, loader, errorLine } from "./ui.js";
import { t, unitWord, cityWord, addStrings } from "./i18n.js";
import { state, subscribe, onEvent, agentRequest } from "./store.js";
import { sendText } from "./call.js";
import { NegotiationListener } from "../voice.js";
import { stationsFor, ladderRows } from "./buy-model.js";
import { needCard, sellerCards, bargainRounds, bestDeal, fromDiscovery, refusalWords } from "./discovery-model.js";
import { itemWords } from "./buy-kit.js";

addStrings({
  "dsc.label": ["What Sahay found", "सहाय को क्या मिला", "ಸಹಾಯ್‌ಗೆ ಏನು ಸಿಕ್ಕಿತು"],
  "dsc.need": ["Now buying", "अभी खरीद रहे हैं", "ಈಗ ಖರೀದಿ"],
  "dsc.sellers": ["Sellers found", "मिले विक्रेता", "ಸಿಕ್ಕ ಮಾರಾಟಗಾರರು"],
  "dsc.searching": ["Sahay is searching IndiaMART", "सहाय IndiaMART पर ढूँढ रही है", "ಸಹಾಯ್ IndiaMART ನಲ್ಲಿ ಹುಡುಕುತ್ತಿದೆ"],
  "dsc.noSellers": ["No sellers found yet.", "अभी कोई विक्रेता नहीं मिला।", "ಇನ್ನೂ ಮಾರಾಟಗಾರರು ಸಿಕ್ಕಿಲ್ಲ."],
  "dsc.src.indiamart": ["IndiaMART", "IndiaMART", "IndiaMART"],
  "dsc.src.supplier": ["Your supplier", "आपका सप्लायर", "ನಿಮ್ಮ ಸರಬರಾಜುದಾರ"],
  "dsc.src.vendor": ["Vendor", "विक्रेता", "ಮಾರಾಟಗಾರ"],
  "dsc.view": ["View on IndiaMART", "IndiaMART पर देखें", "IndiaMART ನಲ್ಲಿ ನೋಡಿ"],
  "dsc.viewLong": ["View {name} on IndiaMART (opens a new tab)", "{name} को IndiaMART पर देखें (नया टैब)", "{name} ಅನ್ನು IndiaMART ನಲ್ಲಿ ನೋಡಿ (ಹೊಸ ಟ್ಯಾಬ್)"],
  "dsc.bargainThis": ["Bargain with this seller", "इस विक्रेता से मोलभाव", "ಈ ಮಾರಾಟಗಾರರ ಜೊತೆ ಚೌಕಾಸಿ"],
  "dsc.bargainSay": ["Bargain with {name}.", "{name} से मोलभाव करो।", "{name} ಜೊತೆ ಚೌಕಾಸಿ ಮಾಡು."],
  "dsc.started": ["Asked Sahay to bargain with {name}", "सहाय को {name} से मोलभाव करने को कहा", "{name} ಜೊತೆ ಚೌಕಾಸಿ ಮಾಡಲು ಸಹಾಯ್‌ಗೆ ಹೇಳಿದೆ"],
  "dsc.sent": ["Asked Sahay", "सहाय को कह दिया", "ಸಹಾಯ್‌ಗೆ ಹೇಳಿದೆ"],
  "dsc.sendFail": ["Could not reach Sahay. Try again.", "सहाय तक बात नहीं पहुँची। फिर कोशिश करें।", "ಸಹಾಯ್‌ಗೆ ತಲುಪಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."],
  "dsc.avoided": ["Your rule skips this seller", "आपका नियम इस विक्रेता को छोड़ता है", "ನಿಮ್ಮ ನಿಯಮ ಈ ಮಾರಾಟಗಾರರನ್ನು ಬಿಡುತ್ತದೆ"],
  "dsc.talking": ["Bargaining now", "मोलभाव चल रहा है", "ಚೌಕಾಸಿ ನಡೆಯುತ್ತಿದೆ"],
  "dsc.rating": ["{r} stars", "{r} स्टार", "{r} ನಕ್ಷತ್ರ"],
  "dsc.ratingCount": ["{r} stars ({n})", "{r} स्टार ({n})", "{r} ನಕ್ಷತ್ರ ({n})"],
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
/** Events that change what the board shows (GET /api/discovery is fetched again after them). */
const REFETCH = /^(vendor|negotiation|quote|approval|requirement|job|order|session)\./;
const DEBOUNCE_MS = 450;

function ensureCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(h("link", { rel: "stylesheet", href }));
}

/** The source badge: IndiaMART (info), your supplier (good), simulated vendor (warn, rule 4). */
function sourceChip(source) {
  if (source === "simulated") return chip(t("simulated"), { tone: "warn" });
  if (source === "supplier") return chip(t("dsc.src.supplier"), { tone: "good" });
  if (source === "vendor") return chip(t("dsc.src.vendor"));
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

/** The same board drawn from the store (before the first answer, or on a server without the route). */
function fromStore() {
  const req = state.boot === "ready" ? state.requirement : null;
  if (!req) return { need: null, sellers: [], bargain: null, deal: null, searching: false, searchError: null };
  const m = stationsFor(state, req);
  const lad = ladderRows(m.negotiation);
  const b = bargainRounds(lad);
  const n = m.negotiation;
  const nv = n && n.vendorId !== undefined && n.vendorId !== null ? state.vendors.get(String(n.vendorId)) : null;
  // Only a pending approval is offered for a yes: bestDeal reads approvals with status "pending" only.
  const d = bestDeal({ quotes: state.quotes, approvals: state.approvals, negotiation: n, agreed: lad.agreed, unit: lad.unit }, req);
  const dv = d && d.vendorId !== null ? state.vendors.get(String(d.vendorId)) : null;
  return {
    need: needCard(req),
    sellers: sellerCards(state.vendors, { negotiations: state.negotiations, requirementId: req.id }).map((s) => ({ ...s, ratingCount: null, avoided: false })),
    bargain: n && (b.rounds.length || m.runningNegotiation) ? {
      negotiationId: n.id, vendorId: n.vendorId, vendorName: nv ? nv.name : (n.outcome && n.outcome.vendorName) || null,
      simulated: Boolean((nv && nv.simulated) || n.counterpart === "simulated"), running: Boolean(m.runningNegotiation),
      rounds: b.rounds, agreed: b.agreed, best: b.best, noDeal: b.noDeal, unit: b.unit,
    } : null,
    deal: d ? { ...d, vendorName: dv ? dv.name : null, simulated: Boolean(dv && dv.simulated) } : null,
    searching: m.stations[1].status === "active",
    searchError: m.stations[1].status === "failed" && m.stations[1].job && m.stations[1].job.error ? String(m.stations[1].job.error) : null,
  };
}

export function createDiscoveryBoard() {
  ensureCss("/css/discovery.css");
  const el = h("section", { class: "dsc", "aria-label": t("dsc.label") });
  const ask = new Map(); // vendorId | "readout" -> { busy, done: text, error }
  let showAll = false;
  let alive = true;

  // Listen in (receive-only) to the live bargaining, in the Bargaining card.
  const listen = { status: "idle", error: null, route: null };
  const listener = new NegotiationListener((st) => { Object.assign(listen, st); render(); });

  /* ------------------------------------------------ GET /api/discovery -- */
  const api = { data: null, missing: false, inflight: false, again: false, timer: 0 };
  async function fetchBoard() {
    if (!alive || api.missing || state.boot !== "ready") return;
    if (api.inflight) { api.again = true; return; }
    api.inflight = true;
    try {
      api.data = await agentRequest("GET", "/api/discovery");
    } catch (err) {
      // A server without the route draws from the store; any other failure keeps the last answer.
      if (err && err.status === 404 && err.code !== "NOT_FOUND") api.missing = true;
      if (err && err.status === 404 && err.code === "NOT_FOUND") api.data = null;
    }
    api.inflight = false;
    if (!alive) return;
    render();
    if (api.again) { api.again = false; schedule(); }
  }
  function schedule() {
    clearTimeout(api.timer);
    api.timer = setTimeout(fetchBoard, DEBOUNCE_MS);
  }

  /* ------------------------------------------------------------ actions -- */
  /** "Bargain with this seller": POST /api/negotiations. It only starts bargaining (the yes gate stays). */
  async function pick(s) {
    if ((ask.get(s.id) || {}).busy) return;
    ask.set(s.id, { busy: true });
    render();
    if (api.missing) {
      // A server without the route: the same request as a typed turn to the live call.
      const ok = await sendText(t("dsc.bargainSay", { name: s.name })).catch(() => false);
      ask.set(s.id, ok ? { done: t("dsc.sent") } : { error: t("dsc.sendFail") });
    } else {
      try {
        const r = await agentRequest("POST", "/api/negotiations", { vendorId: s.id });
        ask.set(s.id, { done: t("dsc.started", { name: (r && r.vendorName) || s.name }) });
        schedule();
      } catch (err) {
        ask.set(s.id, { error: refusalWords(err) || t("dsc.sendFail") });
      }
    }
    render();
    const was = ask.get(s.id);
    if (was && was.done) setTimeout(() => { if (ask.get(s.id) === was) { ask.delete(s.id); render(); } }, 6000);
  }

  /** "Ask Sahay to read it out": a typed request to the live call (starts a typed session if none). */
  async function readOut() {
    if ((ask.get("readout") || {}).busy) return;
    ask.set("readout", { busy: true });
    render();
    const ok = await sendText(t("dsc.readOutSay")).catch(() => false);
    ask.set("readout", ok ? { done: t("dsc.sent") } : { error: t("dsc.sendFail") });
    render();
    const was = ask.get("readout");
    if (ok) setTimeout(() => { if (ask.get("readout") === was) { ask.delete("readout"); render(); } }, 4000);
  }

  /* ------------------------------------------------------------- views -- */
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
    const rating = s.rating !== null ? (s.ratingCount !== null ? t("dsc.ratingCount", { r: s.rating, n: s.ratingCount }) : t("dsc.rating", { r: s.rating })) : null;
    return h("li", { class: `dsc-seller${s.live ? " is-live" : ""}${s.avoided ? " is-avoided" : ""}` },
      h("div", { class: "dsc-seller-top" },
        s.rank !== null ? h("span", { class: "dsc-rank", "aria-hidden": "true", text: String(s.rank) }) : null,
        h("div", { class: "dsc-seller-main" },
          scripted("h4", s.name, { class: "dsc-seller-name" }),
          h("p", { class: "dsc-seller-meta" },
            s.city ? scripted("span", cityWord(s.city)) : null,
            rating ? h("span", { class: "dsc-rating" }, icon("star", 16), h("span", { text: rating })) : null)),
        sourceChip(s.source)),
      s.price !== null || s.priceText ? h("p", { class: "dsc-price" },
        s.price !== null ? h("span", { class: "dsc-num", text: rupees(s.price) }) : scripted("span", s.priceText, { class: "dsc-price-text" }),
        s.price !== null && s.unit ? h("span", { class: "dsc-unit", text: `/ ${unitWord(s.unit)}` }) : null) : null,
      s.live ? h("p", { class: "dsc-live", role: "status" }, h("span", { class: "dsc-live-dot", "aria-hidden": "true" }), h("span", { text: t("dsc.talking") })) : null,
      s.avoided ? h("p", { class: "dsc-quiet" }, h("span", { text: t("dsc.avoided") })) : null,
      a.error ? errorLine(a.error) : null,
      h("div", { class: "dsc-seller-acts" },
        s.url ? h("a", { class: "btn btn-secondary btn-sm btn-noarrow dsc-view", href: s.url, target: "_blank", rel: "noopener noreferrer", "aria-label": t("dsc.viewLong", { name: s.name }) },
          icon("external", 18), h("span", { text: t("dsc.view") })) : null,
        a.done
          ? h("p", { class: "dsc-sent", role: "status" }, icon("check", 18), scripted("span", a.done))
          : s.avoided ? null
            : button({ word: t("dsc.bargainThis"), icon: "handshake", kind: "secondary", size: "sm", busy: Boolean(a.busy), cls: "btn-noarrow", onClick: () => pick(s) })));
  }

  function sellersView(sellers, searching, searchError) {
    const shown = showAll ? sellers : sellers.slice(0, 5);
    return h("div", { class: "dsc-block" },
      h("h3", { class: "dsc-title" }, h("span", { text: t("dsc.sellers") }), sellers.length ? h("span", { class: "dsc-count", text: String(sellers.length) }) : null),
      searching ? loader(t("dsc.searching")) : null,
      searchError && !sellers.length ? errorLine(searchError) : null,
      sellers.length ? h("ol", { class: "dsc-sellers" }, ...shown.map(sellerView))
        : searching || searchError ? null : h("p", { class: "dsc-quiet", text: t("dsc.noSellers") }),
      sellers.length > 5 ? h("button", { class: "link-btn show-all", type: "button", on: { click: () => { showAll = !showAll; render(); } } },
        h("span", { text: showAll ? t("dsc.showLess") : t("dsc.showAll", { n: sellers.length }) })) : null);
  }

  function listenControl(b) {
    if (!b.running && listen.status === "idle") return null;
    if (listen.status === "joining") return button({ word: t(listen.route === "proxy" ? "talk.saferRoute" : "b3.listen.connecting"), kind: "secondary", busy: true, cls: "btn-noarrow" });
    if (listen.status === "listening") return button({ word: t("b5.listenStop"), icon: "stop", kind: "secondary", cls: "btn-noarrow", onClick: () => listener.stop() });
    return h("div", { class: "dsc-listen" },
      b.running ? button({ word: t("work.listen"), icon: "headphones", kind: "secondary", cls: "btn-noarrow", onClick: () => listener.start(b.negotiationId) }) : null,
      listen.status === "error" ? errorLine(`${t("work.listenFail")} ${(listen.error && listen.error.message) || ""}`.trim()) : null);
  }

  function bargainView(b) {
    const sim = b.simulated;
    return card({ cls: "dsc-bargain", body: [
      h("div", { class: "dsc-head" },
        h("h3", { class: "dsc-title", text: t("dsc.bargaining") }),
        b.running ? h("span", { class: "dsc-live", role: "status" }, h("span", { class: "dsc-live-dot", "aria-hidden": "true" }), h("span", { text: t("dsc.talking") })) : null),
      b.vendorName ? h("p", { class: "dsc-who" }, icon("store", 18), scripted("span", b.vendorName), sim ? chip(t("simulated"), { tone: "warn" }) : null) : null,
      b.rounds.length ? h("ol", { class: "dsc-rounds" }, ...b.rounds.map((r) => h("li", { class: `dsc-round${b.agreed !== null && (r.ask === b.agreed || r.counter === b.agreed) ? " is-agreed" : ""}` },
        h("span", { class: "dsc-round-n" }, h("span", { text: t("b5.round", { n: r.round }) }), sim ? h("span", { class: "dsc-sim", text: t("simulated") }) : null),
        h("span", { class: "dsc-round-ask" }, h("span", { class: "dsc-hud", text: t("dsc.seller") }),
          h("span", { class: `dsc-num${r.ask !== null && r.ask === b.best ? " is-best" : ""}`, text: r.ask !== null ? rupees(r.ask) : "—" })),
        icon("arrowRight", 16, "dsc-round-arrow"),
        h("span", { class: "dsc-round-counter" }, h("span", { class: "dsc-hud", text: t("b4.lad.sahay") }),
          h("span", { class: "dsc-num", text: r.counter !== null ? rupees(r.counter) : "—" }))))) : loader(t("b3.lad.waitStart")),
      b.agreed !== null ? h("p", { class: "dsc-agreed" }, icon("check", 20), h("span", { text: t("ladder.agreed", { p: perUnit(b.agreed, b.unit) }) }))
        : b.best !== null ? h("p", { class: "dsc-lowest", text: t("dsc.lowest", { p: perUnit(b.best, b.unit) }) }) : null,
      b.noDeal ? errorLine(t("ladder.noDeal")) : null,
      listenControl(b),
    ].filter(Boolean) });
  }

  function dealView(d) {
    const a = ask.get("readout") || {};
    const action = d.approvalId
      // Only OPENS the Yes card; the yes itself is the owner's spoken yes or the card's Yes button.
      ? button({ word: t("dsc.choose"), icon: "check", kind: "primary", block: true, onClick: () => openYes(`approval:${d.approvalId}`) })
      : a.done
        ? h("p", { class: "dsc-sent", role: "status" }, icon("check", 18), h("span", { text: a.done }))
        : button({ word: t("dsc.readOut"), icon: "speaker", kind: "primary", block: true, busy: Boolean(a.busy), onClick: readOut });
    return card({ cls: `dsc-deal${d.approvalId ? " card-needs" : ""}`, body: [
      h("p", { class: "dsc-hud", text: t("dsc.best") }),
      d.vendorName ? h("p", { class: "dsc-who" }, icon("store", 18), scripted("span", d.vendorName), d.simulated ? chip(t("simulated"), { tone: "warn" }) : null) : null,
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

  /* ------------------------------------------------------------ render -- */
  // Draws only; never loads and never touches the store.
  function render() {
    if (!alive) return;
    const fromApi = api.data && !api.missing ? fromDiscovery(api.data) : null;
    const vm = fromApi && fromApi.need && state.requirement && String(fromApi.need.id) === String(state.requirement.id) ? fromApi : fromStore();
    const key = JSON.stringify([langKey(), vm, [...ask.entries()], showAll, listen.status, listen.route, listen.error && listen.error.message]);
    patch(el, key, () => {
      if (!vm.need) return emptyState({ icon: "search", title: t("dsc.empty.title"), text: t("dsc.empty.text") });
      return [
        needView(vm.need),
        sellersView(vm.sellers, vm.searching, vm.searchError),
        vm.bargain ? bargainView(vm.bargain) : null,
        vm.deal ? dealView(vm.deal) : null,
      ].filter(Boolean);
    });
  }

  const PARTS = ["all", "lang", "work", "approvals", "orders", "stream"];
  const offStore = subscribe((_s, parts) => {
    if (parts.has("all")) schedule();          // a fresh snapshot (boot, reconnect): ask the server again
    if (PARTS.some((p) => parts.has(p))) render();
  });
  const offEvents = onEvent((evt) => { if (evt && typeof evt.type === "string" && REFETCH.test(evt.type)) schedule(); });
  render();
  schedule();

  const pause = () => { if (listen.status !== "idle") listener.stop(); };
  return {
    el,
    update: () => render(),
    pause,
    destroy: () => { alive = false; clearTimeout(api.timer); offStore(); offEvents(); pause(); },
  };
}
