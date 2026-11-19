// Money (khata): who owes me, largest first, amounts big, each with a bar against the largest and
// how long the oldest bill has waited; "Got paid" opens a number pad (cash / UPI, POST
// /api/receipts); "Remind" asks the server for the WhatsApp share URL (POST
// /api/customers/:id/remind) and opens it. Totals on top; payments written down below.

import { h, icon, patch, safeUrl, toDate } from "./dom.js";
import { t, when } from "./i18n.js";
import { state as appState } from "./store.js";
import { stateView } from "./empty.js";
import { keycapButton } from "./ui.js";
import { sell, loadSell, customerOf, remindCustomer } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { ensureCss, money, scriptedText, readButton, partState, agentAction, sectionHead, buttonError, ask, daysSince, daysWord, count } from "./sell-kit.js";
import { openPayPad } from "./money-pad.js";

const MODE_ICON = { cash: "cash", upi: "phone", razorpay_test: "wallet" };

function nameOf(o) {
  const c = o.customer || customerOf(o.customerId);
  return (c && c.name) || st("sell.walkin");
}

function initial(name) {
  const text = String(name || "").trim();
  if (!text) return "";
  try { return [...new Intl.Segmenter().segment(text)][0].segment; } catch { return text.slice(0, 1); }
}

/* ---------------------------------------------------------------- totals -- */

function totals() {
  const owed = sell.owed.reduce((s, o) => s + (o.amount || 0), 0);
  const got = sell.receipts.reduce((s, r) => s + (r.amount || 0), 0);
  return h("section", { class: "mb-totals", "aria-label": st("money.owedTotal") },
    h("div", { class: "mb-total mb-total-owed" },
      h("div", { class: "mb-total-head" },
        h("span", { class: "mb-total-word" }, icon("moneyIn", 22), h("span", { text: st("money.owedTotal") })),
        readButton("khata", () => st("say.totals", { amt: money(owed) || "₹0" }))),
      h("span", { class: "mb-total-num", text: money(owed) || "₹0" }),
      h("span", { class: "mb-total-sub", text: count("money.people", sell.owed.length) })),
    h("div", { class: "mb-total mb-total-got" },
      h("span", { class: "mb-total-word" }, icon("wallet", 22), h("span", { text: st("money.got") })),
      h("span", { class: "mb-total-num", text: money(got) || "₹0" }),
      h("span", { class: "mb-total-sub", text: count("money.payments", sell.receipts.length) })));
}

/* ---------------------------------------------------------------- ladder -- */

function rung(o, max, ui, handlers) {
  const id = String(o.customerId);
  const u = ui.get(id) || {};
  const name = nameOf(o);
  const days = daysSince(o.oldestDue);
  const pct = max > 0 ? Math.max(6, Math.round((o.amount / max) * 100)) : 0;
  const c = customerOf(o.customerId) || o.customer;
  return h("li", { class: "mb-rung", style: `--share:${pct}%` },
    h("span", { class: "mb-bar", "aria-hidden": "true" }),
    h("div", { class: "mb-who" },
      scriptedText("span", initial(name), { class: "sb-avatar", "aria-hidden": "true" }),
      h("span", { class: "mb-who-main" },
        scriptedText("span", name, { class: "mb-name" }),
        days !== null ? h("span", { class: `mb-age${days >= 30 ? " is-old" : ""}` }, icon("history", 18), h("span", { text: st("money.oldest", { d: daysWord(days) }) })) : null),
      readButton(`owed:${id}`)),
    h("p", { class: "mb-amt", text: money(o.amount) }),
    h("div", { class: "mb-acts" },
      keycapButton({ icon: "cash", word: st("money.gotPaid"), label: st("money.gotPaidLong", { name }), tone: "leaf", size: "md", onClick: (e) => handlers.paid(o, name, e.currentTarget) }),
      c && !c.phone ? h("span", { class: "mb-nophone" }, icon("phone", 18), h("span", { text: st("sell.noPhone") })) : h("button", {
        class: "btn btn-ghost mb-remind", type: "button", disabled: u.busy ? true : undefined,
        "aria-label": st("money.remindLong", { name }), dataset: { tip: st("money.remindLong", { name }) },
        on: { click: () => handlers.remind(id) },
      }, u.busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("share", 22), h("span", { text: st("money.remind") }))),
    u.link ? h("p", { class: "sb-ok mb-note", role: "status" }, icon("checkCircle", 20), h("span", { text: st("money.reminded") }),
      h("a", { class: "btn btn-primary btn-sm", href: u.link, target: "_blank", rel: "noopener noreferrer" }, icon("external", 20), h("span", { text: st("money.openWhatsapp") }))) : null,
    u.error ? h("p", { class: "sb-error mb-note", role: "alert" }, icon("alert", 20), h("span", { text: u.error })) : null);
}

/* -------------------------------------------------------------- receipts -- */

function receiptRow(r) {
  const name = nameOf({ customerId: r.customerId });
  const d = toDate(r.createdAt);
  return h("li", { class: "mb-got" },
    h("span", { class: "mb-got-ico", "aria-hidden": "true" }, icon(MODE_ICON[r.mode] || "rupee", 22)),
    h("span", { class: "mb-got-main" },
      scriptedText("span", name, { class: "mb-got-name" }),
      h("span", { class: "mb-got-meta" },
        h("span", { text: st(`money.${r.mode}`) !== `money.${r.mode}` ? st(`money.${r.mode}`) : (r.mode || "") }),
        d ? h("span", { text: when(d, { day: "numeric", month: "short" }) }) : null)),
    h("span", { class: "mb-got-amt", text: money(r.amount) }));
}

/* ---------------------------------------------------------------- screen -- */

export function createMoney() {
  ensureCss();
  const el = h("section", { class: "money sb-screen", "aria-labelledby": "money-title" });
  const title = h("h1", { class: "screen-title", id: "money-title" });
  const topAct = h("div", { class: "sb-top-act" });
  const body = h("div", { class: "sb-body" });
  el.append(h("header", { class: "sb-top" }, title, topAct), body);
  const ui = new Map(); // customerId -> { busy, error, link }

  const handlers = {
    paid(o, name, opener) {
      openPayPad({ customerId: o.customerId, name, owed: o.amount, opener });
    },
    async remind(id) {
      // Open the tab inside the tap so a popup blocker lets it through; fill it when the link comes.
      let win = null;
      try { win = window.open("", "_blank"); } catch { win = null; }
      ui.set(id, { busy: true });
      render(true);
      try {
        const url = safeUrl(await remindCustomer(id));
        if (!url || !/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(url)) throw Object.assign(new Error(st("sell.noPhone")), { status: 422 });
        if (win && !win.closed) { try { win.opener = null; } catch { /* ignore */ } win.location.href = url; ui.set(id, {}); } else ui.set(id, { link: url });
      } catch (err) {
        if (win && !win.closed) win.close();
        ui.set(id, { error: err.status === 422 ? err.message : buttonError(err) });
      }
      render(true);
    },
  };

  function render(force = false) {
    title.textContent = t("nav.money");
    const s = partState(sell, { which: "money", reload: () => loadSell() });
    const empty = sell.status === "ready" && !sell.owed.length && !sell.receipts.length;
    patch(topAct, JSON.stringify([document.documentElement.lang, empty, sell.status]), () =>
      (empty || sell.status !== "ready" ? [] : [agentAction({ word: st("money.act"), hint: "money.hint" })]));
    if (force) body.__key = null;
    const key = JSON.stringify([document.documentElement.lang, sell.status, sell.owed, sell.receipts, [...sell.customers.values()], [...ui.entries()]]);
    patch(body, key, () => {
      if (s) return s;
      if (empty) {
        return stateView({ kind: "empty", icon: "wallet", title: st("money.empty.title"), text: st("money.empty.text"),
          action: { label: st("money.act"), icon: "mic", run: () => ask({ hint: "money.hint" }) } });
      }
      const max = sell.owed.length ? sell.owed[0].amount : 0;
      return [
        totals(),
        h("section", { class: "mb-ladder", "aria-labelledby": "mb-ladder-h" },
          sectionHead("mb-ladder-h", "users", st("money.ladder"), sell.owed.length || null),
          sell.owed.length
            ? h("ol", { class: "mb-rungs" }, ...sell.owed.map((o) => rung(o, max, ui, handlers)))
            : h("p", { class: "sb-quiet", text: st("money.empty.title") })),
        h("section", { class: "mb-recent", "aria-labelledby": "mb-recent-h" },
          sectionHead("mb-recent-h", "wallet", st("money.recent"), sell.receipts.length || null),
          sell.receipts.length
            ? h("ul", { class: "mb-gots" }, ...sell.receipts.slice(0, 20).map(receiptRow))
            : h("p", { class: "sb-quiet", text: st("money.noRecent") })),
      ];
    });
  }

  return {
    el,
    update: (_s, parts) => {
      if (sell.status === "idle" && appState.boot === "ready") loadSell();
      if (parts.has("all") || parts.has("lang") || parts.has("sell")) render(parts.has("lang"));
    },
    enter: () => { if (sell.status === "idle" || sell.status === "error" || sell.status === "missing") loadSell(); },
  };
}
