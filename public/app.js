/* Sahay dashboard. Talks only to the local API; all intelligence is server-side. */

const $ = (id) => document.getElementById(id);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const money = (n) => n == null ? "-" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const num = (n) => n == null ? "-" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const state = { business: null, modules: [], languages: [], audio: [], rfq: null, recording: null };

/* ------------------------------------------------------------- plumbing --- */

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, kind = "error") {
  const t = el("div", `toast ${kind === "ok" ? "ok" : ""}`, msg);
  $("toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .4s"; setTimeout(() => t.remove(), 420); },
    kind === "ok" ? 3800 : 9000);
}

const LS = "sahay.businessId";
const remember = (id) => { try { localStorage.setItem(LS, String(id)); } catch { /* private mode */ } };
const remembered = () => { try { return Number(localStorage.getItem(LS)) || null; } catch { return null; } };

const linkTo = (url, label) => {
  const a = el("a", null, label || url);
  a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
  return a;
};

/* ----------------------------------------------------------------- boot --- */

async function boot() {
  let health;
  try { health = await api("/health"); }
  catch (err) { toast(`Cannot reach the Sahay server: ${err.message}`); return; }

  state.modules = health.modules;
  state.languages = health.languages;

  fillLanguages($("ob-language"));
  fillLanguages($("lang-switch"));
  fillLanguages($("live-lang"));
  fillModules($("nw-module"));

  const dot = $("conn");
  dot.classList.toggle("bad", !health.ok);
  dot.querySelector("span").textContent = health.ok ? "Live" : "setup incomplete";
  if (!health.ok) toast(`Missing API key(s): ${health.missingKeys.join(", ")}. Sahay makes only live calls, so runs will fail.`);

  api("/channels").then(({ channels, active }) => {
    const ch = channels.find((c) => c.name === active);
    $("channel-note").textContent = ch && ch.available ? "" : "negotiation unavailable";
    if (ch && !ch.available) toast(`Negotiations cannot run right now: ${ch.reason}`);
  }).catch(() => {});

  const { businesses } = await api("/businesses");
  fillBusinesses($("ob-switch"), businesses, "Switch to…");
  fillBusinesses($("biz-switch"), businesses);

  const target = businesses.find((b) => b.id === remembered()) || businesses[0];
  if (target) await openBusiness(target.id);
  else { $("onboard").classList.remove("hidden"); $("app").classList.add("hidden"); }
}

function fillLanguages(sel) {
  sel.innerHTML = "";
  for (const l of state.languages) {
    const o = el("option", null, `${l.label} - ${l.native}`); o.value = l.code; sel.appendChild(o);
  }
  sel.value = "hi-IN";
}
function fillModules(sel) {
  sel.innerHTML = "";
  for (const m of state.modules) { const o = el("option", null, m.name); o.value = m.key; sel.appendChild(o); }
}
function fillBusinesses(sel, list, placeholder) {
  sel.innerHTML = "";
  if (placeholder) { const o = el("option", null, placeholder); o.value = ""; sel.appendChild(o); }
  for (const b of list) { const o = el("option", null, b.name); o.value = b.id; sel.appendChild(o); }
}

async function openBusiness(id) {
  const data = await api(`/businesses/${id}`);
  state.business = data.business;
  remember(id);

  $("onboard").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("biz-switch").value = String(id);
  $("lang-switch").value = data.business.language;

  renderDigest(data.digest);
  renderModuleCards(data.digest);
  renderWatches(data.watches);
  renderCalendar(data.compliance);
  renderDrafts(data.actions);
  // Render the empty states immediately so the procurement view explains
  // itself before a run, rather than showing bare headings.
  renderDeals([], null);
  renderVendors([]);
  loadRFQs(); loadOrders(); loadChat(); loadTrends();
  loadLatestRFQ();
}

/** Re-open the most recent requirement so returning to the dashboard shows work in progress. */
async function loadLatestRFQ() {
  try {
    const { rfqs } = await api(`/businesses/${state.business.id}/rfqs`);
    const latest = rfqs.find((r) => r.dealCount > 0) || rfqs[0];
    if (!latest) return;
    const d = await api(`/businesses/${state.business.id}/rfqs/${latest.id}`);
    state.rfq = d.rfq;
    renderVendors(d.vendors);
    renderDeals(d.deals.filter((q) => q.rank), d.rfq);
  } catch { /* the empty states already stand */ }
}

/* ----------------------------------------------------------------- tabs --- */

function showView(name) {
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === name)));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
}
document.querySelectorAll(".tab").forEach((t) => { t.onclick = () => showView(t.dataset.view); });

/* ---------------------------------------------------------- procurement --- */

const RFQ_STAGES = [
  ["requirement", "Understanding"],
  ["discovery", "Finding suppliers"],
  ["shortlist", "Shortlisting"],
  ["negotiation", "Negotiating"],
  ["ranking", "Comparing"],
  ["deals", "Deals ready"],
];

function resetPipe(stages, stagesEl, barEl, logEl, feedEl) {
  $("pipe").classList.remove("idle");
  stagesEl.innerHTML = "";
  for (const [k, label] of stages) { const n = el("span", "pstage", label); n.dataset.k = k; stagesEl.appendChild(n); }
  barEl.style.width = "0%";
  logEl.textContent = "starting…";
  if (feedEl) feedEl.innerHTML = "";
}

function markStage(stages, stagesEl, barEl, logEl, key, detail) {
  const idx = stages.findIndex(([k]) => k === key);
  [...stagesEl.children].forEach((n, i) => {
    n.classList.toggle("active", i === idx);
    n.classList.toggle("done", idx > -1 && i < idx);
  });
  if (idx > -1) barEl.style.width = `${Math.round(((idx + 1) / stages.length) * 100)}%`;
  if (detail) logEl.textContent = detail;
}

function runRFQ({ negotiate }) {
  const text = $("rfq-text").value.trim();
  if (!text) { toast("Tell Sahay what you need first."); $("rfq-text").focus(); return; }
  if (!state.business) return;

  const btn = negotiate ? $("rfq-go") : $("rfq-find");
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = negotiate ? "Working…" : "Finding…";
  resetPipe(RFQ_STAGES, $("pstages"), $("pbar"), $("plog"), $("feed"));

  const url = `/api/businesses/${state.business.id}/rfq/stream?text=${encodeURIComponent(text)}&negotiate=${negotiate}`;
  const es = new EventSource(url);

  es.addEventListener("progress", (e) => {
    const p = JSON.parse(e.data);
    markStage(RFQ_STAGES, $("pstages"), $("pbar"), $("plog"), p.stage,
      p.detail || (p.vendor ? `${p.vendor}${p.speaker ? ` · ${p.speaker}` : ""}` : p.stage));

    // Live negotiation transcript.
    if (p.speaker && p.text) {
      const u = el("div", `u ${p.speaker}`);
      u.appendChild(el("div", "lbl", p.speaker === "agent" ? "Sahay" : p.vendor || "Vendor"));
      u.appendChild(el("p", null, p.text));
      $("feed").appendChild(u);
      $("feed").scrollTop = $("feed").scrollHeight;
    }
    if (p.stage === "shortlist" && p.vendors) renderVendors(p.vendors);
  });

  es.addEventListener("done", (e) => {
    const r = JSON.parse(e.data);
    [...$("pstages").children].forEach((n) => { n.classList.remove("active"); n.classList.add("done"); });
    $("pbar").style.width = "100%";

    if (r.needsInput) {
      $("plog").textContent = `Need more detail: ${r.missing.join(", ")}`;
      toast(`Sahay needs: ${r.missing.join(" and ")}. Add it and try again.`);
    } else {
      state.rfq = r.rfq;
      $("plog").textContent =
        `${r.vendors?.length || 0} vendors found · ${r.shortlist?.length || 0} shortlisted · ${r.deals?.length || 0} deals`;
      renderVendors(r.vendors || []);
      renderDeals(r.deals || [], r.rfq);
      if (r.warning) toast(r.warning);
      if (r.deals?.length) toast(`${r.deals.length} deal(s) ready.`, "ok");
      loadRFQs();
    }
    es.close(); btn.disabled = false; btn.textContent = label;
  });

  es.addEventListener("error", (e) => {
    let msg = "The stream dropped.";
    try { msg = JSON.parse(e.data).error; } catch { /* network-level */ }
    $("plog").textContent = msg;
    toast(msg);
    es.close(); btn.disabled = false; btn.textContent = label;
  });
}

function renderDeals(deals, rfq) {
  const wrap = $("deals");
  wrap.innerHTML = "";
  $("deals-note").textContent = deals.length ? `ranked by landed cost${rfq ? ` for ${num(rfq.quantity)} ${rfq.unit || ""}` : ""}` : "";
  if (!deals.length) {
    wrap.appendChild(el("p", "empty", "No negotiated deals yet. Describe a requirement above and press “Find & negotiate”."));
    return;
  }

  for (const d of deals) {
    const card = el("div", `panel deal ${d.rank === 1 ? "best" : ""}`);
    const top = el("div", "deal-top");
    top.appendChild(el("div", "rank", String(d.rank ?? "")));
    const name = el("div");
    name.appendChild(el("h3", null, d.vendor_name || "Vendor"));
    name.appendChild(el("div", "muted", [d.vendor_location, d.moq ? `MOQ ${d.moq}` : null].filter(Boolean).join(" · ")));
    top.appendChild(name);
    if (d.confidence != null && d.confidence < 0.6) {
      const p = el("span", "pill high", "low confidence");
      p.style.marginLeft = "auto";
      top.appendChild(p);
    }
    card.appendChild(top);

    const figs = el("div", "figs");
    const addFig = (k, v, good) => {
      const f = el("div", "fig");
      f.appendChild(el("div", "k", k));
      f.appendChild(el("div", `v ${good ? "good" : ""}`, v));
      figs.appendChild(f);
    };
    addFig("Rate", `${money(d.rate)} / ${d.unit || rfq?.unit || "unit"}`);
    if (d.landed_cost != null) addFig("Landed total", money(d.landed_cost), d.rank === 1);
    if (d.lead_time_text || d.lead_time_days) addFig("Lead time", d.lead_time_text || `${d.lead_time_days} days`);
    if (d.payment_terms) addFig("Payment", d.payment_terms);
    card.appendChild(figs);

    if (d.rationale) card.appendChild(el("div", "why", d.rationale));
    if (d.caveat) card.appendChild(el("div", "muted", `Caveat: ${d.caveat}`));

    const acts = el("div", "acts");
    const order = el("button", "btn btn-sm btn-primary", "Raise purchase order");
    order.onclick = () => placeOrder(d.id);
    acts.appendChild(order);
    if (d.negotiation_id) {
      const tr = el("button", "btn btn-sm", "Transcript");
      tr.onclick = () => showTranscript(d.negotiation_id, d.vendor_name);
      acts.appendChild(tr);
    }
    if (d.vendor_url) acts.appendChild(Object.assign(linkTo(d.vendor_url, "Listing"), { className: "btn btn-sm" }));
    card.appendChild(acts);

    wrap.appendChild(card);
  }
}

async function showTranscript(negId, vendorName) {
  try {
    const { transcript } = await api(`/businesses/${state.business.id}/negotiations/${negId}/transcript`);
    if (!transcript.length) { toast("No transcript was recorded for that negotiation."); return; }
    $("pipe").classList.remove("idle");
    $("plog").textContent = `Transcript · ${vendorName || ""}`;
    const feed = $("feed");
    feed.innerHTML = "";
    for (const line of transcript) {
      const u = el("div", `u ${line.speaker}`);
      u.appendChild(el("div", "lbl", line.speaker === "agent" ? "Sahay" : vendorName || "Vendor"));
      u.appendChild(el("p", null, line.text));
      feed.appendChild(u);
    }
    $("pipe").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (err) { toast(err.message); }
}

function renderVendors(vendors) {
  const wrap = $("vendors");
  wrap.innerHTML = "";
  if (!vendors.length) { wrap.appendChild(el("p", "empty", "No vendors discovered yet.")); return; }

  for (const v of vendors) {
    const row = el("div", "vrow");
    const s = el("span", `score ${v.score >= 0.7 ? "hi" : v.score >= 0.45 ? "mid" : ""}`,
      v.score != null ? Number(v.score).toFixed(2) : "-");
    row.appendChild(s);

    const g = el("div", "grow");
    const h = el("h4", null, v.name);
    if (v.shortlisted) { const p = el("span", "pill ok", "shortlisted"); p.style.marginLeft = "8px"; h.appendChild(p); }
    g.appendChild(h);
    g.appendChild(el("div", "meta", [
      v.listed_price != null ? money(v.listed_price) + (v.unit ? `/${v.unit}` : "") : "rate not published",
      v.location, v.moq ? `MOQ ${v.moq}` : null, v.phone ? "contactable" : "no number",
    ].filter(Boolean).join(" · ")));
    if (v.shortlist_reason || v.reason) g.appendChild(el("div", "muted", v.shortlist_reason || v.reason));
    if (v.source_url) g.appendChild(linkTo(v.source_url));
    row.appendChild(g);
    wrap.appendChild(row);
  }
}

async function loadRFQs() {
  try {
    const { rfqs } = await api(`/businesses/${state.business.id}/rfqs`);
    const wrap = $("rfqs");
    wrap.innerHTML = "";
    if (!rfqs.length) { wrap.appendChild(el("p", "empty", "No past requirements.")); return; }
    for (const r of rfqs.slice(0, 10)) {
      const row = el("div", "rowline");
      const g = el("div", "grow");
      g.appendChild(el("h4", null, `${num(r.quantity)} ${r.unit || ""} ${r.material}`.trim()));
      g.appendChild(el("div", "muted", [
        r.target_price ? `target ${money(r.target_price)}` : null,
        r.delivery_city, `${r.vendorCount} vendors`, `${r.dealCount} deals`, r.created_at,
      ].filter(Boolean).join(" · ")));
      row.appendChild(g);
      row.appendChild(el("span", `pill ${r.status === "quoted" ? "ok" : "medium"}`, r.status));
      const open = el("button", "btn btn-sm", "Open");
      open.onclick = async () => {
        const d = await api(`/businesses/${state.business.id}/rfqs/${r.id}`);
        state.rfq = d.rfq;
        renderVendors(d.vendors);
        renderDeals(d.deals.filter((q) => q.rank), d.rfq);
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
      row.appendChild(open);
      wrap.appendChild(row);
    }
  } catch { /* non-critical */ }
}

/* --------------------------------------------------------------- orders --- */

async function placeOrder(quoteId) {
  try {
    const { order } = await api(`/businesses/${state.business.id}/orders`, { method: "POST", body: { quoteId } });
    await api(`/businesses/${state.business.id}/orders/${order.id}/status`, { method: "POST", body: { status: "sent", note: "PO issued to vendor" } });
    toast(`Purchase order ${order.po_number} raised for ${money(order.amount)}.`, "ok");
    loadOrders();
    showView("orders");
  } catch (err) { toast(err.message); }
}

async function loadOrders() {
  try {
    const { orders } = await api(`/businesses/${state.business.id}/orders`);
    const wrap = $("orders");
    wrap.innerHTML = "";
    if (!orders.length) { wrap.appendChild(el("p", "empty", "No orders yet. Raise one from a negotiated deal.")); return; }

    for (const o of orders) {
      const card = el("div", "panel deal");
      const top = el("div", "deal-top");
      const n = el("div");
      n.appendChild(el("h3", null, `${o.material || "Order"} · ${num(o.quantity)} ${o.unit || ""}`));
      n.appendChild(el("div", "muted mono", o.po_number));
      top.appendChild(n);
      const st = el("span", `pill ${o.status}`, o.status.replace(/_/g, " "));
      st.style.marginLeft = "auto";
      top.appendChild(st);
      card.appendChild(top);

      const figs = el("div", "figs");
      const f = (k, v) => { const d = el("div", "fig"); d.appendChild(el("div", "k", k)); d.appendChild(el("div", "v", v)); figs.appendChild(d); };
      f("Supplier", o.vendor_name || "-");
      f("Rate", money(o.rate));
      f("Total", money(o.amount));
      if (o.expected_delivery) f("Expected", o.expected_delivery);
      card.appendChild(figs);

      const acts = el("div", "acts");
      const po = el("button", "btn btn-sm", "Purchase order PDF");
      po.onclick = () => window.open(`/api/businesses/${state.business.id}/orders/${o.id}/po.pdf`, "_blank");
      acts.appendChild(po);

      if (["sent", "confirmed"].includes(o.status)) {
        const pay = el("button", "btn btn-sm btn-primary", "Create payment link");
        pay.onclick = async () => {
          try {
            const { payment } = await api(`/businesses/${state.business.id}/orders/${o.id}/payment`, { method: "POST", body: {} });
            const url = payment.url || payment.short_url;
            window.open(url, "_blank");
            toast("Payment link created. Sahay never moves money on its own.", "ok");
            loadOrders();
          } catch (err) { toast(err.message); }
        };
        acts.appendChild(pay);
      }

      for (const next of ({ sent: ["confirmed"], confirmed: ["paid", "in_transit"], paid: ["in_transit"], in_transit: ["delivered"], delivered: ["closed"] }[o.status] || [])) {
        const b = el("button", "btn btn-sm", `Mark ${next.replace(/_/g, " ")}`);
        b.onclick = async () => {
          try { await api(`/businesses/${state.business.id}/orders/${o.id}/status`, { method: "POST", body: { status: next } }); loadOrders(); }
          catch (err) { toast(err.message); }
        };
        acts.appendChild(b);
      }
      card.appendChild(acts);
      wrap.appendChild(card);
    }
  } catch (err) { toast(err.message); }
}

/* ---------------------------------------------------------------- watch --- */

const WATCH_STAGES = [
  ["fetching", "Reading sources"], ["extracting", "Extracting"],
  ["summarising", "Summarising"], ["ranking", "Ranking"],
  ["localising", "Translating"], ["voicing", "Recording"],
];

function runWatch() {
  const btn = $("run-watch");
  btn.disabled = true; btn.textContent = "Running…";
  $("wpipe").classList.remove("idle");
  resetPipeGeneric($("wstages"), $("wbar"), $("wlog"), WATCH_STAGES);
  document.querySelectorAll("#modules .lamp").forEach((l) => { l.className = "lamp busy"; });

  const es = new EventSource(`/api/businesses/${state.business.id}/run/stream`);
  es.addEventListener("progress", (e) => {
    const p = JSON.parse(e.data);
    markStage(WATCH_STAGES, $("wstages"), $("wbar"), $("wlog"), p.phase, `${p.module ? p.module + " · " : ""}${p.detail}`);
  });
  es.addEventListener("done", (e) => {
    const r = JSON.parse(e.data);
    state.audio = r.audio || [];
    [...$("wstages").children].forEach((n) => { n.classList.remove("active"); n.classList.add("done"); });
    $("wbar").style.width = "100%";
    const ok = r.modules.filter((m) => m.ok).length;
    $("wlog").textContent = `${ok}/${r.modules.length} modules · ${r.modules.reduce((n, m) => n + (m.sources?.length || 0), 0)} live sources`;
    renderDigest({ ...r.digest, items: r.digest.items, text_local: r.digest.textLocal, created_at: new Date().toLocaleString() });
    for (const m of r.modules) {
      const card = $("modules").querySelector(`[data-module="${m.module}"]`);
      if (card) renderModuleResult(card, m);
    }
    loadTrends();
    const failed = r.modules.filter((m) => !m.ok && !m.skipped);
    if (failed.length) toast(`${failed.length} module(s) had trouble: ${failed.map((f) => `${f.module} (${f.error})`).join("; ")}`);
    else toast("Check complete.", "ok");
    es.close(); btn.disabled = false; btn.textContent = "Run check";
  });
  es.addEventListener("error", (e) => {
    let msg = "The run stream dropped.";
    try { msg = JSON.parse(e.data).error; } catch { /* network-level */ }
    toast(msg); $("wlog").textContent = msg;
    document.querySelectorAll("#modules .lamp.busy").forEach((l) => { l.className = "lamp fail"; });
    es.close(); btn.disabled = false; btn.textContent = "Run check";
  });
}

function resetPipeGeneric(stagesEl, barEl, logEl, stages) {
  stagesEl.innerHTML = "";
  for (const [k, label] of stages) { const n = el("span", "pstage", label); n.dataset.k = k; stagesEl.appendChild(n); }
  barEl.style.width = "0%"; logEl.textContent = "starting…";
}

function renderDigest(digest) {
  const wrap = $("ledger");
  wrap.innerHTML = "";
  if (!digest || !digest.items?.length) {
    wrap.appendChild(el("p", "empty", "No digest yet. Press “Run check” to pull your sources live."));
    $("digest-when").textContent = ""; $("voicebar").classList.add("hidden");
    return;
  }
  $("digest-when").textContent = `updated ${digest.created_at || "just now"}`;

  digest.items.forEach((it, i) => {
    const u = (it.urgency || "medium").toLowerCase();
    const entry = el("div", `entry ${u}`);
    entry.style.animationDelay = `${i * 60}ms`;
    entry.appendChild(el("div", "num", String(it.rank ?? i + 1)));
    const b = el("div");
    const head = el("div");
    head.style.display = "flex"; head.style.gap = "9px"; head.style.alignItems = "center"; head.style.flexWrap = "wrap";
    head.appendChild(el("span", `pill ${u}`, u));
    const mod = state.modules.find((m) => m.key === it.module);
    if (mod) head.appendChild(el("span", "eyebrow", mod.name));
    b.appendChild(head);
    b.appendChild(el("h3", null, it.headline || ""));
    if (it.detail) b.appendChild(el("p", "detail", it.detail));
    if (it.action) b.appendChild(el("div", "act", it.action));
    if (it.source_url) { const s = el("div", "src"); s.append("source: ", linkTo(it.source_url)); b.appendChild(s); }
    entry.appendChild(b);
    wrap.appendChild(entry);
  });

  const local = digest.text_local || digest.textLocal;
  if (local) {
    $("voicebar").classList.remove("hidden");
    $("digest-local").textContent = local;
    const lang = digest.language || state.business.language;
    $("voice-lang").textContent = `voice note · ${state.languages.find((l) => l.code === lang)?.label || lang}`;
  }
}

function renderModuleCards(digest) {
  const wrap = $("modules");
  wrap.innerHTML = "";
  for (const m of state.modules) {
    const card = el("div", "panel modcard");
    card.dataset.module = m.key;
    const head = el("div", "modcard-head");
    head.appendChild(el("span", "lamp"));
    head.appendChild(el("h3", null, m.name));
    const b = el("button", "btn btn-sm", "Check");
    b.onclick = () => runSingle(m.key, card);
    head.appendChild(b);
    card.appendChild(head);
    card.appendChild(el("p", "muted", m.blurb));
    wrap.appendChild(card);
  }
  if (digest?.items?.length) {
    for (const it of digest.items) {
      const c = wrap.querySelector(`[data-module="${it.module}"]`);
      if (c) c.querySelector(".lamp").classList.add("ok");
    }
  }
}

function renderModuleResult(card, r) {
  card.innerHTML = "";
  const def = state.modules.find((m) => m.key === r.module);
  const head = el("div", "modcard-head");
  head.appendChild(el("span", `lamp ${r.ok ? "ok" : "fail"}`));
  head.appendChild(el("h3", null, def?.name || r.module));
  const b = el("button", "btn btn-sm", "Re-check");
  b.onclick = () => runSingle(r.module, card);
  head.appendChild(b);
  card.appendChild(head);

  if (r.summary) card.appendChild(el("p", null, r.summary));
  if (r.error) card.appendChild(el("div", "failnote", r.error));

  for (const s of r.sources || []) {
    const item = el("div", "src-item");
    const row = el("div", "row");
    row.appendChild(el("strong", null, s.title || s.label || "Source"));
    const figure = s.price_text || s.due_or_change;
    if (figure) row.appendChild(el("span", "price", figure));
    if (s.availability) row.appendChild(el("span", "eyebrow", s.availability));
    item.appendChild(row);
    if (s.change?.text) {
      const dir = /down/i.test(s.change.text) ? "down" : /up/i.test(s.change.text) ? "up" : "";
      item.appendChild(el("div", `chg ${dir}`, s.change.text));
    }
    if (s.obligation) item.appendChild(el("div", "chg", s.obligation));
    item.appendChild(linkTo(s.url));
    card.appendChild(item);
  }
  for (const f of r.failures || []) card.appendChild(el("div", "failnote", `${f.url} - ${f.error}`));
}

async function runSingle(key, card) {
  const lamp = card.querySelector(".lamp");
  if (lamp) lamp.className = "lamp busy";
  try {
    const r = await api(`/businesses/${state.business.id}/run/${key}`, { method: "POST", body: {} });
    renderModuleResult(card, r);
    loadTrends();
  } catch (err) { if (lamp) lamp.className = "lamp fail"; toast(`${key}: ${err.message}`); }
}

function renderWatches(watches) {
  const list = $("watch-list");
  list.innerHTML = "";
  if (!watches.length) { list.appendChild(el("p", "empty", "No sources yet. Add one below.")); return; }
  for (const w of watches) {
    const row = el("div", "rowline");
    const g = el("div", "grow");
    g.appendChild(el("h4", null, w.label || w.url || w.query));
    const def = state.modules.find((m) => m.key === w.module);
    g.appendChild(el("div", "eyebrow", `${def?.name || w.module} · alert over ${w.threshold_pct}%`));
    if (w.url) g.appendChild(linkTo(w.url));
    else if (w.query) g.appendChild(el("div", "muted", `searches: “${w.query}”`));
    row.appendChild(g);
    const d = el("button", "btn btn-sm", "Remove");
    d.onclick = async () => {
      await api(`/businesses/${state.business.id}/watches/${w.id}`, { method: "DELETE" });
      renderWatches((await api(`/businesses/${state.business.id}/watches`)).watches);
    };
    row.appendChild(d);
    list.appendChild(row);
  }
}

function renderCalendar(events) {
  const wrap = $("calendar");
  wrap.innerHTML = "";
  if (!events?.length) { wrap.appendChild(el("p", "empty", "No calendar yet. Press “Rebuild from live portals”.")); return; }
  for (const e of events) {
    const row = el("div", "rowline");
    const g = el("div", "grow");
    g.appendChild(el("h4", null, e.title));
    g.appendChild(el("div", "eyebrow", [e.authority, e.frequency, e.due_date || "date not published"].filter(Boolean).join(" · ")));
    if (e.checklist?.length) {
      const ul = el("ul", "checklist");
      for (const c of e.checklist) ul.appendChild(el("li", null, c));
      g.appendChild(ul);
    }
    if (e.portal_url) g.appendChild(linkTo(e.portal_url, "Official portal →"));
    row.appendChild(g);
    const right = el("div");
    right.style.display = "grid"; right.style.gap = "7px"; right.style.justifyItems = "end";
    right.appendChild(el("span", `pill ${e.escalation.level}`, e.escalation.label));
    if (e.status !== "filed") {
      const d = el("button", "btn btn-sm", "Mark filed");
      d.onclick = async () => renderCalendar((await api(`/businesses/${state.business.id}/compliance/${e.id}`, { method: "PATCH", body: { status: "filed" } })).events);
      right.appendChild(d);
    } else right.appendChild(el("span", "pill ok", "filed"));
    row.appendChild(right);
    wrap.appendChild(row);
  }
}

async function loadTrends() {
  let data;
  try { data = await api(`/businesses/${state.business.id}/history`); } catch { return; }
  const wrap = $("trends");
  wrap.innerHTML = "";
  const series = data.series.filter((s) => s.points.some((p) => p.price != null));
  if (!series.length) { wrap.appendChild(el("p", "empty", "Trend lines appear once a source has been checked more than once.")); $("trend-note").textContent = ""; return; }
  $("trend-note").textContent = `${data.count} observations`;

  for (const s of series.slice(0, 8)) {
    const vals = s.points.map((p) => p.price).filter((v) => v != null);
    if (!vals.length) continue;
    const card = el("div", "panel trend");
    card.appendChild(el("h4", null, s.title || s.url));
    const latest = vals[vals.length - 1], first = vals[0];
    const delta = vals.length > 1 ? ((latest - first) / (first || 1)) * 100 : 0;
    card.appendChild(el("div", "eyebrow",
      `${money(latest)} · ${vals.length} reading${vals.length > 1 ? "s" : ""}${vals.length > 1 ? ` · ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : ""}`));
    card.appendChild(spark(vals));
    wrap.appendChild(card);
  }
}

/** Inline SVG sparkline - no chart library, so nothing to load or break. */
function spark(values) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 30");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${values.length} readings, latest ${values[values.length - 1]}`);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(28 - ((v - min) / span) * 26).toFixed(2)}`);

  if (values.length === 1) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", "50"); c.setAttribute("cy", "15"); c.setAttribute("r", "2.5"); c.setAttribute("fill", "var(--amber)");
    svg.appendChild(c); return svg;
  }
  const area = document.createElementNS(NS, "polygon");
  area.setAttribute("points", `0,30 ${pts.join(" ")} 100,30`);
  area.setAttribute("fill", "var(--amber)"); area.setAttribute("opacity", ".09");
  svg.appendChild(area);
  const line = document.createElementNS(NS, "polyline");
  line.setAttribute("points", pts.join(" "));
  line.setAttribute("fill", "none"); line.setAttribute("stroke", "var(--amber)");
  line.setAttribute("stroke-width", "1.4"); line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(line);
  const [lx, ly] = pts[pts.length - 1].split(",");
  const dot = document.createElementNS(NS, "circle");
  dot.setAttribute("cx", lx); dot.setAttribute("cy", ly); dot.setAttribute("r", "2"); dot.setAttribute("fill", "var(--amber)");
  svg.appendChild(dot);
  return svg;
}

/* ------------------------------------------------------------- drafts --- */

async function refreshDrafts() {
  try { renderDrafts((await api(`/businesses/${state.business.id}/actions`)).actions); } catch { /* non-critical */ }
}

function renderDrafts(actions) {
  const wrap = $("drafts");
  wrap.innerHTML = "";
  if (!actions?.length) { wrap.appendChild(el("p", "empty", "Nothing waiting.")); return; }
  for (const a of actions) {
    const card = el("div", "panel deal");
    const top = el("div", "deal-top");
    const n = el("div");
    n.appendChild(el("h3", null, a.title || a.type));
    n.appendChild(el("div", "eyebrow", `${a.type.replace(/_/g, " ")}${a.target ? ` · ${a.target}` : ""}`));
    top.appendChild(n);
    const st = el("span", `pill ${a.status === "draft" ? "high" : a.status === "confirmed" ? "ok" : "low"}`, a.status);
    st.style.marginLeft = "auto"; top.appendChild(st);
    card.appendChild(top);
    const body = el("div", null, a.body || "");
    body.style.whiteSpace = "pre-wrap"; body.style.fontSize = "14px";
    card.appendChild(body);

    if (a.status === "draft") {
      const acts = el("div", "acts");
      const copy = el("button", "btn btn-sm", "Copy");
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(a.body || ""); toast("Copied.", "ok"); }
        catch { toast("Clipboard blocked - select the text manually."); }
      };
      const ok = el("button", "btn btn-sm btn-primary", "Approve");
      ok.onclick = () => decide(a.id, "confirm");
      const no = el("button", "btn btn-sm", "Dismiss");
      no.onclick = () => decide(a.id, "dismiss");
      acts.append(copy, ok, no);
      card.appendChild(acts);
    }
    wrap.appendChild(card);
  }
}

async function decide(id, decision) {
  const out = await api(`/businesses/${state.business.id}/actions/${id}/${decision}`, { method: "POST", body: {} });
  renderDrafts(out.actions);
  toast(out.note, "ok");
}

/* ---------------------------------------------------------- assistant --- */

async function loadChat() {
  const chat = $("chat");
  chat.innerHTML = "";
  try {
    const { messages } = await api(`/businesses/${state.business.id}/chat`);
    if (!messages.length) {
      push("sahay", "Ask me anything - “what did we pay for rice last time”, “when is my next GST filing”, “any price drops this week”. I can also draft a message for you to approve.");
    } else for (const m of messages) push(m.role === "user" ? "user" : "sahay", m.content);
  } catch { /* non-critical */ }
}

function push(who, text, extra) {
  const chat = $("chat");
  const m = el("div", `msg ${who}`);
  m.appendChild(el("div", "who", who === "user" ? "You" : "Sahay"));
  const b = el("div", "bubble", text);
  m.appendChild(b);
  if (extra) m.appendChild(el("div", "tools", extra));
  chat.appendChild(m);
  chat.scrollTop = chat.scrollHeight;
  return m;
}

async function sendChat() {
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  push("user", text);
  const thinking = push("sahay", "…looking that up");
  try {
    const out = await api(`/businesses/${state.business.id}/chat`, { method: "POST", body: { message: text } });
    thinking.querySelector(".bubble").textContent = out.answer;
    if (out.answerLocal) {
      const l = el("div", "bubble indic", out.answerLocal);
      l.style.marginTop = "6px";
      thinking.appendChild(l);
    }
    refreshDrafts();
  } catch (err) { thinking.querySelector(".bubble").textContent = `Could not answer: ${err.message}`; }
}

async function toggleMic() {
  const mic = $("mic");
  if (state.recording) { state.recording.stop(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { toast("Microphone permission was denied."); return; }

  const rec = new MediaRecorder(stream);
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    state.recording = null; mic.classList.remove("rec");
    const blob = new Blob(parts, { type: rec.mimeType || "audio/webm" });
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(String(r.result).split(",")[1]);
      r.onerror = rej; r.readAsDataURL(blob);
    });
    const thinking = push("sahay", "…listening");
    try {
      const out = await api(`/businesses/${state.business.id}/voice`, { method: "POST", body: { audioBase64: b64, mimeType: blob.type } });
      thinking.remove();
      push("user", out.transcript);
      const a = push("sahay", out.answer);
      if (out.answerLocal) {
        const l = el("div", "bubble indic", out.answerLocal);
        l.style.marginTop = "6px";
        a.insertBefore(l, a.querySelector(".tools"));
      }
      if (out.audio?.length) playChunks(out.audio);
      refreshDrafts();
    } catch (err) { thinking.querySelector(".bubble").textContent = `Voice failed: ${err.message}`; }
  };
  rec.start();
  state.recording = rec;
  mic.classList.add("rec");
}

function playChunks(chunks) {
  if (!chunks?.length) { toast("No audio was generated."); return; }
  let i = 0;
  const next = () => {
    if (i >= chunks.length) return;
    const a = new Audio(`data:audio/wav;base64,${chunks[i++]}`);
    a.onended = next;
    a.play().catch(() => toast("Playback was blocked - click the page, then press play again."));
  };
  next();
}

/* ------------------------------------------------------------ onboard --- */

const EXAMPLE = {
  name: "Sharma Kirana Store", category: "retail kirana / grocery", state: "Karnataka", city: "Bengaluru",
  watches: [
    { module: "competitor", label: "Amul Butter - Blinkit", url: "https://blinkit.com/prn/amul-salted-butter/prid/159" },
    { module: "competitor", label: "Butter - market", query: "Amul salted butter 500g price online India buy" },
    { module: "compliance", label: "GST deadlines", query: "GSTR-3B GSTR-1 filing due date India small business current month" },
  ],
};

$("ob-example").onclick = () => {
  $("ob-name").value = EXAMPLE.name; $("ob-category").value = EXAMPLE.category;
  $("ob-state").value = EXAMPLE.state; $("ob-city").value = EXAMPLE.city;
};

$("ob-create").onclick = async () => {
  const name = $("ob-name").value.trim();
  if (!name) { toast("Give your business a name first."); $("ob-name").focus(); return; }
  const btn = $("ob-create");
  btn.disabled = true; btn.textContent = "Creating…";
  try {
    const out = await api("/businesses", {
      method: "POST",
      body: {
        name, category: $("ob-category").value.trim(), state: $("ob-state").value.trim(),
        city: $("ob-city").value.trim(), language: $("ob-language").value, cadence: $("ob-cadence").value,
        watches: name === EXAMPLE.name ? EXAMPLE.watches : [],
      },
    });
    const { businesses } = await api("/businesses");
    fillBusinesses($("biz-switch"), businesses);
    fillBusinesses($("ob-switch"), businesses, "Switch to…");
    await openBusiness(out.business.id);
    toast("Workspace created.", "ok");
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; btn.textContent = "Create workspace"; }
};

/* --------------------------------------------------------------- wire --- */

$("ob-switch").onchange = (e) => e.target.value && openBusiness(Number(e.target.value));
$("biz-switch").onchange = (e) => openBusiness(Number(e.target.value));

$("lang-switch").onchange = async (e) => {
  const language = e.target.value;
  await api(`/businesses/${state.business.id}`, { method: "PATCH", body: { language } });
  state.business.language = language;
  try {
    const out = await api(`/businesses/${state.business.id}/digest/voice`, { method: "POST", body: { language } });
    $("digest-local").textContent = out.text;
    $("voice-lang").textContent = `voice note · ${state.languages.find((l) => l.code === language)?.label || language}`;
    $("voicebar").classList.remove("hidden");
    state.audio = out.audio;
    toast("Digest re-voiced.", "ok");
  } catch { toast("Language saved."); }
};

$("rfq-go").onclick = () => runRFQ({ negotiate: true });
$("rfq-find").onclick = () => runRFQ({ negotiate: false });
const EXAMPLES = [
  "500 cotton t-shirts, 180 GSM round neck, under ₹180 a piece, delivered in Bengaluru",
  "200 kg sona masoori rice, under ₹70 a kilo, delivered in Bengaluru",
  "1000 corrugated shipping boxes, 12x9x6 inches, under ₹22 each, delivered in Pune",
  "50 litres of mustard oil, food grade, under ₹150 a litre, delivered in Jaipur",
];
let exampleIdx = 0;
$("rfq-example").onclick = () => { $("rfq-text").value = EXAMPLES[exampleIdx++ % EXAMPLES.length]; };

$("run-watch").onclick = runWatch;
$("play-voice").onclick = () => playChunks(state.audio);
$("refresh-orders").onclick = loadOrders;

$("manage-watches").onclick = async () => {
  const p = $("watch-panel");
  p.classList.toggle("hidden");
  if (!p.classList.contains("hidden")) {
    renderWatches((await api(`/businesses/${state.business.id}/watches`)).watches);
    p.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

$("nw-add").onclick = async () => {
  const v = $("nw-value").value.trim();
  if (!v) return;
  const isUrl = /^https?:\/\//i.test(v);
  try {
    await api(`/businesses/${state.business.id}/watches`, {
      method: "POST",
      body: { module: $("nw-module").value, label: $("nw-label").value.trim() || undefined, [isUrl ? "url" : "query"]: v },
    });
    $("nw-value").value = ""; $("nw-label").value = "";
    renderWatches((await api(`/businesses/${state.business.id}/watches`)).watches);
    toast("Source added.", "ok");
  } catch (err) { toast(err.message); }
};

$("build-cal").onclick = async () => {
  const b = $("build-cal");
  b.disabled = true; b.textContent = "Reading portals…";
  try {
    const out = await api(`/businesses/${state.business.id}/compliance/build`, { method: "POST", body: {} });
    renderCalendar(out.events);
    toast(`Calendar built from ${out.sources.length} live source(s).`, "ok");
  } catch (err) { toast(err.message); }
  finally { b.disabled = false; b.textContent = "Rebuild from live portals"; }
};

const dl = (p) => window.open(`/api/businesses/${state.business.id}${p}`, "_blank");
$("dl-pdf").onclick = () => dl("/export/report.pdf");
$("dl-csv").onclick = () => dl("/export/observations.csv");
$("dl-cal").onclick = () => dl("/export/compliance.csv");

$("chat-send").onclick = sendChat;
$("chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
$("mic").onclick = toggleMic;

boot();
