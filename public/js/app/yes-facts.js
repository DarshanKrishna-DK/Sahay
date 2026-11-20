// What a Yes card says, as plain facts (UI v5, screens.md section 03): WHAT, WHO, HOW MUCH, the
// "simulated vendor" words, the read-back, one footnote, and the row Home's "Needs you" card shows.
// No DOM and no imports: yes.js resolves the data from the stores and passes formatters in `fmt`,
// so node:test checks every kind with plain values (test/yes-facts.test.js).
//
//   cardFacts(card, data, fmt) -> { kind, askKey, footKey, labelKey, what: string[], who, simulated,
//                                   amount, amountKind: "money"|"qty"|null, extra: [{ labelKey, text|textKey }], readback }
//   needsRow(card, facts)      -> { key, kind, icon, phase, line, lineKey, meta, simulated, amount, amountKind, live }
//   hostPlan(cards, wanted)    -> { mode: "none"|"card"|"list", key }   which view the Needs host shows
//
// Spec 03: three definition rows only (What, Who, How much). Rate, delivery and tax are in the
// read-back the owner can unfold; a reorder shows what is left, a rule shows why. No "A · B" strings:
// a bill's lines are separate lines.

const KIND_ICON = { buy: "cart", bill: "receipt", reorder: "box", rule: "spark" };
export const iconOf = (kind) => KIND_ICON[kind] || "bell";

const has = (v) => v !== null && v !== undefined && v !== "";
const LIVE = new Set(["waiting", "error"]);

/**
 * data per kind (resolved by yes.js from the stores):
 *   buy:     { view: approvalView(a) }  (vendor, simulated, quantity, unit, item, total, approval.readback)
 *   bill:    { invoice, customerName }
 *   reorder: { item, proposal, question }   question = the server's own sentence in the owner's language, if any
 *   rule:    { rule, langCode }
 * fmt: { money(n), qty(n, unit), itemName(item), lineName(line) }
 */
export function cardFacts(card, data = {}, fmt = {}) {
  const kind = card.kind;
  const base = {
    kind, askKey: `wt.ask.${kind}`, footKey: `wt.foot.${kind}`, labelKey: `wt.kind.${kind}`,
    what: [], who: null, simulated: false, amount: null, amountKind: null, extra: [], readback: null,
  };
  if (kind === "buy") {
    const v = data.view || {};
    const what = [has(v.item) ? v.item : null, has(v.quantity) ? fmt.qty(v.quantity, v.unit) : null].filter(Boolean).join(", ");
    return {
      ...base, what: what ? [what] : [], who: v.vendor || null, simulated: Boolean(v.simulated),
      amount: has(v.total) ? v.total : null, amountKind: has(v.total) ? "money" : null,
      readback: (v.approval && v.approval.readback) || null,
    };
  }
  if (kind === "bill") {
    const inv = data.invoice || {};
    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const MAX = 3;
    const what = lines.slice(0, MAX).map((l) => [fmt.lineName(l), has(l.qty) ? fmt.qty(l.qty, l.unit) : null].filter(Boolean).join(", ")).filter(Boolean);
    const tot = inv.totals || {};
    return {
      ...base, what, more: lines.length > MAX ? lines.length - MAX : 0,
      who: data.customerName || null, simulated: Boolean(inv.simulated),
      amount: has(tot.total) ? tot.total : null, amountKind: has(tot.total) ? "money" : null,
      readback: inv.readback || null,
    };
  }
  if (kind === "reorder") {
    const it = data.item || {};
    const p = data.proposal || {};
    const name = fmt.itemName(it) || null;
    const extra = [];
    if (has(it.onHand)) extra.push(it.onHand <= 0 ? { labelKey: "wt.leftNow", textKey: "wt.outOf" } : { labelKey: "wt.leftNow", text: fmt.qty(it.onHand, it.unit) });
    return {
      ...base, what: name ? [name] : [],
      amount: has(p.quantity) ? fmt.qty(p.quantity, p.unit || it.unit) : null, amountKind: has(p.quantity) ? "qty" : null,
      extra, readback: data.question || null,
    };
  }
  if (kind === "rule") {
    const r = data.rule || {};
    const pickLang = (o) => (o && typeof o === "object" ? (o[data.langCode] || o["en-IN"] || o["hi-IN"] || o["kn-IN"] || null) : null);
    const sentence = pickLang(r.sentence);
    const why = pickLang(r.why);
    return { ...base, what: sentence ? [sentence] : [], extra: why ? [{ labelKey: "wt.why", text: why }] : [] };
  }
  return base;
}

/** Home's "Needs you" row: the first WHAT line, WHO as the meta line, the figure. */
export function needsRow(card, facts) {
  const f = facts || {};
  const what = Array.isArray(f.what) ? f.what : [];
  const line = what.length ? what[0] + (what.length > 1 || f.more ? ` +${what.length - 1 + (f.more || 0)}` : "") : null;
  return {
    key: card.key, kind: card.kind, icon: iconOf(card.kind), phase: card.phase,
    line, lineKey: line ? null : `wt.ask.${card.kind}`, meta: f.who || null,
    simulated: Boolean(f.simulated), amount: f.amount === undefined ? null : f.amount, amountKind: f.amountKind || null,
    live: LIVE.has(card.phase),
  };
}

/**
 * What the Needs host shows. `wanted` is a key the owner or the server asked for (Check on Home, a
 * fresh read-back). One card -> that card; several -> the list, unless one was asked for.
 */
export function hostPlan(cards, wanted = null) {
  const list = Array.isArray(cards) ? cards : [];
  if (wanted && list.some((c) => c.key === wanted)) return { mode: "card", key: wanted };
  if (!list.length) return { mode: "none", key: null };
  if (list.length === 1) return { mode: "card", key: list[0].key };
  return { mode: "list", key: null };
}
