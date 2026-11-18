const express = require("express");
const db = require("./db");
const anakin = require("./anakin");
const sarvam = require("./sarvam");
const groq = require("./groq");
const pipeline = require("./pipeline");
const compliance = require("./compliance");
const assistant = require("./assistant");
const exporter = require("./export");
const procurement = require("./procurement");
const negotiator = require("./negotiator");
const flowEngine = require("./flow");
const orders = require("./orders");
const live = require("./live-negotiation");
const { channelStatus } = require("./channels");
const { MODULES } = require("./modules/definitions");
const { config, LANGUAGES, missingKeys } = require("./config");

const router = express.Router();

/** Wrap an async handler so a rejection becomes a clean 500 instead of a hang. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Tenant resolution. Every business-scoped route loads the tenant here and
 * hands `req.business` downstream, so no handler can accidentally read across
 * tenants by forgetting a WHERE clause.
 */
function withBusiness(req, res, next) {
  const id = Number(req.params.id || req.body?.businessId || req.query.businessId);
  if (!id) return res.status(400).json({ error: "businessId is required." });
  const business = db.getBusiness(id);
  if (!business) return res.status(404).json({ error: `No business with id ${id}.` });
  req.business = business;
  next();
}

/* ---------------------------------------------------------------- meta --- */

router.get("/health", wrap(async (req, res) => {
  const missing = missingKeys();
  res.json({
    ok: missing.length === 0,
    missingKeys: missing,
    connectors: {
      anakin: { configured: !!config.anakin.key, base: config.anakin.base },
      groq: { configured: !!config.groq.key, model: config.groq.model },
      sarvam: { configured: !!config.sarvam.key, tts: config.sarvam.ttsModel, stt: config.sarvam.sttModel, translate: config.sarvam.translateModel },
    },
    modules: Object.values(MODULES).map((m) => ({ key: m.key, name: m.name, blurb: m.blurb })),
    languages: LANGUAGES,
  });
}));

/** Live end-to-end connector check - proves the three APIs actually answer. */
router.get("/health/live", wrap(async (req, res) => {
  const checks = {};
  await Promise.all([
    (async () => {
      try {
        const r = await anakin.search("GST filing due date India", 1);
        checks.anakin = { ok: r.length > 0, detail: r[0]?.url || "no results" };
      } catch (e) { checks.anakin = { ok: false, detail: e.message }; }
    })(),
    (async () => {
      try {
        const t = await groq.chatText([{ role: "user", content: "Reply with the single word: ready" }], { maxTokens: 20 });
        checks.groq = { ok: /ready/i.test(t), detail: t.slice(0, 60) };
      } catch (e) { checks.groq = { ok: false, detail: e.message }; }
    })(),
    (async () => {
      try {
        const t = await sarvam.translate("Your supplier raised prices.", "hi-IN");
        checks.sarvam = { ok: !!t && t !== "Your supplier raised prices.", detail: t.slice(0, 60) };
      } catch (e) { checks.sarvam = { ok: false, detail: e.message }; }
    })(),
  ]);
  const ok = Object.values(checks).every((c) => c.ok);
  res.status(ok ? 200 : 503).json({ ok, checks, checkedAt: new Date().toISOString() });
}));

/* ------------------------------------------------------------ tenancy --- */

router.get("/businesses", wrap(async (req, res) => res.json({ businesses: db.listBusinesses() })));

router.post("/businesses", wrap(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Business name is required." });
  const id = db.createBusiness(req.body);
  db.audit(id, "business_created", { name });

  // Seed watches supplied at onboarding time.
  for (const w of req.body.watches || []) {
    if (!MODULES[w.module]) continue;
    if (!w.url && !w.query) continue;
    db.addWatch({ business_id: id, ...w });
  }
  res.status(201).json({ business: db.getBusiness(id), watches: db.listWatches(id) });
}));

router.get("/businesses/:id", withBusiness, wrap(async (req, res) => {
  res.json({
    business: req.business,
    watches: db.listWatches(req.business.id),
    digest: db.latestDigest(req.business.id),
    compliance: compliance.calendarWithUrgency(req.business.id),
    actions: db.listActions(req.business.id),
  });
}));

router.patch("/businesses/:id", withBusiness, wrap(async (req, res) => {
  res.json({ business: db.updateBusiness(req.business.id, req.body) });
}));

router.delete("/businesses/:id", withBusiness, wrap(async (req, res) => {
  db.deleteBusiness(req.business.id);
  res.json({ deleted: true });
}));

/* ------------------------------------------------------------ watches --- */

router.get("/businesses/:id/watches", withBusiness, wrap(async (req, res) => {
  res.json({ watches: db.listWatches(req.business.id) });
}));

router.post("/businesses/:id/watches", withBusiness, wrap(async (req, res) => {
  const { module, url, query, label, threshold_pct, monitor } = req.body;
  if (!MODULES[module]) return res.status(400).json({ error: `module must be one of ${Object.keys(MODULES).join(", ")}` });
  if (!url && !query) return res.status(400).json({ error: "Provide a url or a query." });

  let monitor_id = null;
  if (monitor && url) {
    // Register a server-side change monitor with Anakin so long-running
    // watching does not depend on this process staying up.
    try {
      const m = await anakin.createMonitor(url, { name: label || url });
      monitor_id = m.id || m.monitorId || null;
    } catch (err) {
      db.audit(req.business.id, "monitor_create_failed", { url, error: err.message });
    }
  }

  const id = db.addWatch({ business_id: req.business.id, module, url, query, label, threshold_pct, monitor_id });
  db.audit(req.business.id, "watch_added", { id, module, url, query });
  res.status(201).json({ watch: db.listWatches(req.business.id).find((w) => w.id === id), monitorRegistered: !!monitor_id });
}));

router.delete("/businesses/:id/watches/:watchId", withBusiness, wrap(async (req, res) => {
  db.deleteWatch(req.business.id, Number(req.params.watchId));
  res.json({ deleted: true });
}));

/* ---------------------------------------------------------------- run --- */

/** Blocking full run - returns the complete result including audio. */
router.post("/businesses/:id/run", withBusiness, wrap(async (req, res) => {
  const result = await pipeline.runAll(req.business, {
    moduleKeys: req.body.modules,
    withAudio: req.body.withAudio !== false,
  });
  res.json(result);
}));

/**
 * Streaming run (Server-Sent Events). The UI uses this so the owner watches
 * each stage - scraping, extracting, ranking, voicing - happen live, which is
 * also what makes the pipeline legible during a demo.
 */
router.get("/businesses/:id/run/stream", withBusiness, wrap(async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15000);

  try {
    const moduleKeys = req.query.modules ? String(req.query.modules).split(",").filter((k) => MODULES[k]) : undefined;
    send("start", { business: req.business.name, modules: moduleKeys || Object.keys(MODULES) });
    const result = await pipeline.runAll(req.business, {
      moduleKeys,
      withAudio: req.query.audio !== "false",
      emit: (p) => send("progress", p),
    });
    send("done", result);
  } catch (err) {
    send("error", { error: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}));

/** Run a single module on demand. */
router.post("/businesses/:id/run/:module", withBusiness, wrap(async (req, res) => {
  const key = req.params.module;
  if (!MODULES[key]) return res.status(400).json({ error: `Unknown module ${key}` });
  const watches = db.listWatches(req.business.id, key);
  if (!watches.length) return res.status(400).json({ error: `No sources configured for ${MODULES[key].name}.` });
  const runId = db.startRun(req.business.id);
  const result = await pipeline.runModule(req.business, key, watches, runId);
  db.saveModuleResult({ run_id: runId, business_id: req.business.id, module: key, ok: result.ok, summary: result.summary, error: result.error, payload: result });
  db.finishRun(runId, result.ok ? "completed" : "failed", result.error);
  res.json(result);
}));

/* ------------------------------------------------------------- digest --- */

router.get("/businesses/:id/digest", withBusiness, wrap(async (req, res) => {
  const d = db.latestDigest(req.business.id);
  if (!d) return res.status(404).json({ error: "No digest yet. Run a check first." });
  res.json({ digest: d, history: db.digestHistory(req.business.id) });
}));

/** Re-voice an existing digest, e.g. after the owner switches language. */
router.post("/businesses/:id/digest/voice", withBusiness, wrap(async (req, res) => {
  const d = db.latestDigest(req.business.id);
  if (!d) return res.status(404).json({ error: "No digest to voice yet." });
  const lang = req.body.language || req.business.language;
  const text = lang === d.language ? d.text_local : await sarvam.translate(d.text_en, lang, "en-IN");
  const audio = await sarvam.textToSpeech(text, lang);
  res.json({ language: lang, text, audio });
}));

/* --------------------------------------------------------- compliance --- */

router.post("/businesses/:id/compliance/build", withBusiness, wrap(async (req, res) => {
  const out = await compliance.buildCalendar(req.business);
  res.json({ ...out, events: compliance.calendarWithUrgency(req.business.id) });
}));

router.get("/businesses/:id/compliance", withBusiness, wrap(async (req, res) => {
  res.json({ events: compliance.calendarWithUrgency(req.business.id) });
}));

router.patch("/businesses/:id/compliance/:eventId", withBusiness, wrap(async (req, res) => {
  db.setComplianceStatus(req.business.id, Number(req.params.eventId), req.body.status || "filed");
  db.audit(req.business.id, "compliance_status_changed", { eventId: req.params.eventId, status: req.body.status });
  res.json({ events: compliance.calendarWithUrgency(req.business.id) });
}));

/* ------------------------------------------------------------ history --- */

router.get("/businesses/:id/history", withBusiness, wrap(async (req, res) => {
  const module = req.query.module;
  const rows = module
    ? db.observationHistory(req.business.id, module, 400)
    : db.allObservations(req.business.id, 400);

  // Group into one series per source URL so the client can draw trend lines.
  const series = {};
  for (const r of rows) {
    const k = r.url || "unknown";
    (series[k] ||= { url: k, title: r.title, module: r.module, points: [] }).points.push({
      at: r.observed_at, price: r.price_value, rating: r.rating,
      availability: r.availability, sentiment: r.sentiment,
    });
  }
  res.json({ series: Object.values(series), count: rows.length });
}));

router.get("/businesses/:id/audit", withBusiness, wrap(async (req, res) => {
  res.json({ entries: db.auditTrail(req.business.id, 150) });
}));

/* ------------------------------------------------------------ actions --- */

router.get("/businesses/:id/actions", withBusiness, wrap(async (req, res) => {
  res.json({ actions: db.listActions(req.business.id, req.query.status) });
}));

/**
 * Confirming a draft is the only place an action changes state. Even here we
 * mark it confirmed rather than transmitting it: autonomous sending is
 * explicitly out of scope for v1 (PRD section 12).
 */
router.post("/businesses/:id/actions/:actionId/:decision", withBusiness, wrap(async (req, res) => {
  const decision = req.params.decision;
  if (!["confirm", "dismiss"].includes(decision)) return res.status(400).json({ error: "decision must be confirm or dismiss" });
  const status = decision === "confirm" ? "confirmed" : "dismissed";
  db.resolveAction(req.business.id, Number(req.params.actionId), status);
  db.audit(req.business.id, `action_${status}`, { actionId: req.params.actionId });
  res.json({
    actions: db.listActions(req.business.id),
    note: status === "confirmed"
      ? "Marked confirmed and copied for you to send. Sahay does not send on your behalf in v1."
      : "Draft dismissed.",
  });
}));

/* -------------------------------------------------------------- agent --- */

router.post("/businesses/:id/chat", withBusiness, wrap(async (req, res) => {
  const { message, translate = true } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: "message is required." });
  const { answer, toolTrace } = await assistant.ask(req.business, message.trim());
  let answerLocal = null;
  if (translate && req.business.language !== "en-IN") {
    try { answerLocal = await sarvam.translate(answer, req.business.language, "en-IN"); } catch { /* English answer stands */ }
  }
  res.json({ answer, answerLocal, toolTrace });
}));

router.get("/businesses/:id/chat", withBusiness, wrap(async (req, res) => {
  res.json({ messages: db.recentMessages(req.business.id, 40) });
}));

/** Voice question in, spoken answer out. Audio arrives base64 in JSON. */
router.post("/businesses/:id/voice", withBusiness, wrap(async (req, res) => {
  const { audioBase64, mimeType = "audio/webm" } = req.body;
  if (!audioBase64) return res.status(400).json({ error: "audioBase64 is required." });
  const buf = Buffer.from(audioBase64, "base64");
  if (buf.length < 500) return res.status(400).json({ error: "Recording was too short." });
  const out = await assistant.askByVoice(req.business, buf, mimeType);
  res.json(out);
}));

/** Speak arbitrary text in the owner's language (used for reading cards aloud). */
router.post("/businesses/:id/speak", withBusiness, wrap(async (req, res) => {
  const { text, language, translate = true } = req.body;
  if (!text) return res.status(400).json({ error: "text is required." });
  const lang = language || req.business.language;
  const localised = translate && lang !== "en-IN" ? await sarvam.translate(text, lang, "en-IN") : text;
  const audio = await sarvam.textToSpeech(localised, lang);
  res.json({ text: localised, language: lang, audio });
}));


/* -------------------------------------------------------- procurement --- */

/** Parse a free-text requirement without committing to an RFQ. */
router.post("/businesses/:id/rfq/parse", withBusiness, wrap(async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "text is required." });
  res.json({ parsed: await procurement.parseRequirement(req.business, text.trim()) });
}));

router.get("/businesses/:id/rfqs", withBusiness, wrap(async (req, res) => {
  const rfqs = db.listRFQs(req.business.id, req.query.status);
  res.json({
    rfqs: rfqs.map((r) => ({
      ...r,
      vendorCount: db.listVendors(r.id).length,
      dealCount: db.listQuotes(r.id).filter((q) => q.rank).length,
    })),
  });
}));

router.get("/businesses/:id/rfqs/:rfqId", withBusiness, wrap(async (req, res) => {
  const rfq = db.getRFQ(req.business.id, Number(req.params.rfqId));
  if (!rfq) return res.status(404).json({ error: "No such requirement." });
  res.json({
    rfq,
    vendors: db.listVendors(rfq.id),
    shortlist: db.listVendors(rfq.id, true),
    negotiations: db.listNegotiations(rfq.id),
    deals: db.listQuotes(rfq.id),
  });
}));

/**
 * Run a procurement cycle over SSE so the dashboard can narrate discovery,
 * negotiation and ranking as they happen.
 */
router.get("/businesses/:id/rfq/stream", withBusiness, wrap(async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15000);

  try {
    const text = String(req.query.text || "").trim();
    const rfqId = req.query.rfqId ? Number(req.query.rfqId) : null;
    if (!text && !rfqId) throw new Error("Provide text or rfqId.");
    send("start", { text, rfqId });

    const result = await flowEngine.runRFQ(req.business,
      rfqId ? { id: rfqId } : { text },
      {
        negotiate: req.query.negotiate !== "false",
        channel: req.query.channel,
        emit: (e) => send("progress", e),
      });
    send("done", result);
  } catch (err) {
    send("error", { error: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}));

/** Blocking variant, used by the bot and by scripts. */
router.post("/businesses/:id/rfq", withBusiness, wrap(async (req, res) => {
  const { text, rfqId, negotiate = true, channel } = req.body;
  if (!text && !rfqId) return res.status(400).json({ error: "Provide text or rfqId." });
  const result = await flowEngine.runRFQ(req.business, rfqId ? { id: rfqId } : { text }, { negotiate, channel });
  res.json(result);
}));

/** Add a vendor by hand - useful when a listing publishes no contact number. */
router.post("/businesses/:id/rfqs/:rfqId/vendors", withBusiness, wrap(async (req, res) => {
  const rfq = db.getRFQ(req.business.id, Number(req.params.rfqId));
  if (!rfq) return res.status(404).json({ error: "No such requirement." });
  const { name, phone, listed_price, location, moq, source_url } = req.body;
  if (!name) return res.status(400).json({ error: "Vendor name is required." });
  const id = db.addVendor({
    business_id: req.business.id, rfq_id: rfq.id, name, phone, listed_price,
    location, moq, source_url, shortlisted: true, score: 0.5,
    shortlist_reason: "Added manually by the owner",
  });
  res.status(201).json({ vendor: db.getVendor(id) });
}));

/** Negotiate with one vendor on demand. */
router.post("/businesses/:id/vendors/:vendorId/negotiate", withBusiness, wrap(async (req, res) => {
  const vendor = db.getVendor(Number(req.params.vendorId));
  if (!vendor || vendor.business_id !== req.business.id) return res.status(404).json({ error: "No such vendor." });
  const rfq = db.getRFQ(req.business.id, vendor.rfq_id);
  const quote = await negotiator.negotiate(req.business, rfq, vendor, { channel: req.body.channel });
  res.json({ quote, transcript: quote ? db.getTranscript(quote.negotiationId) : [] });
}));

router.get("/businesses/:id/negotiations/:negId/transcript", withBusiness, wrap(async (req, res) => {
  res.json({ transcript: db.getTranscript(Number(req.params.negId)) });
}));

/** Re-rank existing quotes, e.g. after a manual quote was added. */
router.post("/businesses/:id/rfqs/:rfqId/rank", withBusiness, wrap(async (req, res) => {
  const rfq = db.getRFQ(req.business.id, Number(req.params.rfqId));
  if (!rfq) return res.status(404).json({ error: "No such requirement." });
  res.json({ deals: await procurement.rankDeals(req.business, rfq) });
}));


/* --------------------------------------------------- live negotiation --- */

/**
 * A negotiation a human can take part in, one turn at a time.
 * Same agent, same brief, same quote extraction as the automated channels -
 * only the transport differs, so what the demo shows is what the product does.
 */
router.post("/businesses/:id/live/start", withBusiness, wrap(async (req, res) => {
  res.json(await live.start(req.business, req.body));
}));

router.post("/businesses/:id/live/:negId/reply", withBusiness, wrap(async (req, res) => {
  res.json(await live.reply(req.business, Number(req.params.negId), req.body));
}));

router.post("/businesses/:id/live/:negId/end", withBusiness, wrap(async (req, res) => {
  res.json({ result: await live.finish(req.business, Number(req.params.negId)) });
}));

/** Create a requirement without running discovery - the quickest way into a call. */
router.post("/businesses/:id/rfq/create", withBusiness, wrap(async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "text is required." });
  const parsed = await procurement.parseRequirement(req.business, text.trim());
  if (parsed.missing?.length) return res.status(400).json({ error: `Also tell me the ${parsed.missing.join(" and ")}.`, parsed });
  const id = db.createRFQ({
    business_id: req.business.id, material: parsed.material, quantity: parsed.quantity,
    unit: parsed.unit, target_price: parsed.target_price, delivery_city: parsed.delivery_city,
    delivery_pincode: parsed.delivery_pincode, needed_by: parsed.needed_by,
    quality_notes: parsed.quality_notes, raw_request: text.trim(),
  });
  res.status(201).json({ rfq: db.getRFQ(req.business.id, id), parsed });
}));

/* ------------------------------------------------------------- orders --- */

router.get("/businesses/:id/orders", withBusiness, wrap(async (req, res) => {
  res.json({
    orders: db.listOrders(req.business.id, req.query.status),
    active: db.listActiveOrders(req.business.id),
  });
}));

router.get("/businesses/:id/orders/:orderId", withBusiness, wrap(async (req, res) => {
  const order = db.getOrder(req.business.id, Number(req.params.orderId));
  if (!order) return res.status(404).json({ error: "No such order." });
  res.json({ order, events: db.orderEvents(order.id), payment: db.getPaymentForOrder(order.id) });
}));

/** Raise a purchase order from a negotiated quote. Requires explicit intent. */
router.post("/businesses/:id/orders", withBusiness, wrap(async (req, res) => {
  const { quoteId, expectedDelivery, notes } = req.body;
  if (!quoteId) return res.status(400).json({ error: "quoteId is required." });
  const order = orders.createFromQuote(req.business, Number(quoteId), { expectedDelivery, notes });
  res.status(201).json({ order });
}));

router.get("/businesses/:id/orders/:orderId/po.pdf", withBusiness, wrap(async (req, res) => {
  const order = db.getOrder(req.business.id, Number(req.params.orderId));
  if (!order) return res.status(404).json({ error: "No such order." });
  const pdf = await orders.renderPO(req.business, order);
  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `attachment; filename="${order.po_number.replace(/\//g, "-")}.pdf"`);
  res.send(pdf);
}));

router.post("/businesses/:id/orders/:orderId/status", withBusiness, wrap(async (req, res) => {
  const { status, note } = req.body;
  res.json({ order: orders.advance(req.business, Number(req.params.orderId), status, note) });
}));

router.post("/businesses/:id/orders/:orderId/payment", withBusiness, wrap(async (req, res) => {
  const order = db.getOrder(req.business.id, Number(req.params.orderId));
  if (!order) return res.status(404).json({ error: "No such order." });
  const existing = db.getPaymentForOrder(order.id);
  if (existing?.short_url) return res.json({ payment: existing, reused: true });
  res.status(201).json({ payment: await orders.createPaymentLink(req.business, order) });
}));

router.get("/businesses/:id/orders/:orderId/payment", withBusiness, wrap(async (req, res) => {
  const order = db.getOrder(req.business.id, Number(req.params.orderId));
  if (!order) return res.status(404).json({ error: "No such order." });
  res.json({ payment: await orders.refreshPaymentStatus(req.business, order) });
}));

/* ------------------------------------------------------------ channels --- */

router.get("/channels", wrap(async (req, res) => {
  res.json({ channels: channelStatus(), active: config.procurement.channel });
}));

/* ------------------------------------------------------------ exports --- */

router.get("/businesses/:id/export/observations.csv", withBusiness, wrap(async (req, res) => {
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="sahay-${req.business.id}-observations.csv"`);
  res.send(exporter.observationsCSV(req.business.id));
}));

router.get("/businesses/:id/export/compliance.csv", withBusiness, wrap(async (req, res) => {
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="sahay-${req.business.id}-compliance.csv"`);
  res.send(exporter.complianceCSV(req.business.id));
}));

router.get("/businesses/:id/export/report.pdf", withBusiness, wrap(async (req, res) => {
  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `attachment; filename="sahay-${req.business.id}-report.pdf"`);
  exporter.digestPDF(req.business.id, res);
}));

module.exports = router;
