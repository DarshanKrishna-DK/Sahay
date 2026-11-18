const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const { config } = require("./config");

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new DatabaseSync(config.dbFile);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

/**
 * Multi-tenant schema. Every row holding business intelligence carries a
 * business_id and every read path filters on it - PRD section 7 requires that
 * one tenant's supplier list or watch list is never visible to another, even
 * within the same trade category.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  state TEXT,
  city TEXT,
  language TEXT NOT NULL DEFAULT 'hi-IN',
  cadence TEXT NOT NULL DEFAULT 'weekly',
  channel TEXT NOT NULL DEFAULT 'in-app',
  tier TEXT NOT NULL DEFAULT 'growth',
  whatsapp TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  label TEXT,
  url TEXT,
  query TEXT,
  threshold_pct REAL NOT NULL DEFAULT 5,
  active INTEGER NOT NULL DEFAULT 1,
  monitor_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_watches_biz ON watches(business_id, module);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS module_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  ok INTEGER NOT NULL,
  summary TEXT,
  error TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  run_id INTEGER,
  module TEXT NOT NULL,
  watch_id INTEGER,
  url TEXT,
  title TEXT,
  price_value REAL,
  price_text TEXT,
  currency TEXT DEFAULT 'INR',
  availability TEXT,
  rating REAL,
  review_count INTEGER,
  sentiment TEXT,
  moq TEXT,
  extra TEXT,
  observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_obs_biz ON observations(business_id, module, observed_at);

CREATE TABLE IF NOT EXISTS digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  run_id INTEGER,
  language TEXT,
  text_en TEXT,
  text_local TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS digest_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digest_id INTEGER NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  rank INTEGER,
  module TEXT,
  urgency TEXT,
  headline TEXT,
  detail TEXT,
  action TEXT,
  source_url TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT,
  body TEXT,
  target TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS compliance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  authority TEXT,
  due_date TEXT,
  frequency TEXT,
  portal_url TEXT,
  checklist TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER,
  event TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================== Procurement (PRD v2) ==============================
-- A requirement the owner stated, in structured form.
CREATE TABLE IF NOT EXISTS rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  material TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  target_price REAL,
  currency TEXT DEFAULT 'INR',
  delivery_city TEXT,
  delivery_pincode TEXT,
  needed_by TEXT,
  quality_notes TEXT,
  raw_request TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rfq_biz ON rfqs(business_id, status);

-- A vendor discovered for an RFQ, with the score that got it shortlisted.
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rfq_id INTEGER REFERENCES rfqs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  listed_price REAL,
  listed_price_text TEXT,
  unit TEXT,
  moq TEXT,
  moq_value REAL,
  location TEXT,
  phone TEXT,
  source_url TEXT,
  availability TEXT,
  certifications TEXT,
  score REAL,
  score_breakdown TEXT,
  shortlist_reason TEXT,
  shortlisted INTEGER NOT NULL DEFAULT 0,
  do_not_call INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vendor_rfq ON vendors(rfq_id, shortlisted);

-- One negotiation attempt against one vendor, over one channel.
CREATE TABLE IF NOT EXISTS negotiations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  language TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  turns INTEGER DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);

-- Every utterance, so any quoted term can be traced back to what was said.
CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  negotiation_id INTEGER NOT NULL REFERENCES negotiations(id) ON DELETE CASCADE,
  turn INTEGER,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  text_local TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The structured outcome of a negotiation.
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  negotiation_id INTEGER REFERENCES negotiations(id) ON DELETE SET NULL,
  rate REAL,
  rate_text TEXT,
  unit TEXT,
  moq TEXT,
  lead_time_days INTEGER,
  lead_time_text TEXT,
  delivery_terms TEXT,
  payment_terms TEXT,
  freight REAL,
  landed_cost REAL,
  total_cost REAL,
  confidence REAL,
  caveat TEXT,
  rationale TEXT,
  rank INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quote_rfq ON quotes(rfq_id, rank);

-- An order the owner explicitly confirmed.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rfq_id INTEGER REFERENCES rfqs(id) ON DELETE SET NULL,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  po_number TEXT UNIQUE NOT NULL,
  material TEXT,
  quantity REAL,
  unit TEXT,
  rate REAL,
  amount REAL,
  currency TEXT DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'draft',
  expected_delivery TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_biz ON orders(business_id, status);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_ref TEXT,
  short_url TEXT,
  amount REAL,
  currency TEXT DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

-- Telegram account <-> workspace link, and per-chat conversation state.
CREATE TABLE IF NOT EXISTS telegram_links (
  chat_id TEXT PRIMARY KEY,
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  username TEXT,
  first_name TEXT,
  language TEXT,
  state TEXT,
  state_data TEXT,
  voice INTEGER NOT NULL DEFAULT 1,
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Questions the agent could not answer immediately and promised to follow up on.
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  chat_id TEXT,
  question TEXT NOT NULL,
  context TEXT,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
`);


// Older databases predate the voice preference column.
try { db.exec("ALTER TABLE telegram_links ADD COLUMN voice INTEGER NOT NULL DEFAULT 1"); }
catch { /* already present */ }

const q = (sql) => db.prepare(sql);

const api = {
  raw: db,

  audit(businessId, event, detail) {
    q("INSERT INTO audit_log (business_id, event, detail) VALUES (?,?,?)")
      .run(businessId ?? null, event, detail ? JSON.stringify(detail) : null);
  },

  createBusiness(b) {
    const r = q(`INSERT INTO businesses (name, category, state, city, language, cadence, channel, tier, whatsapp)
                 VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(b.name, b.category ?? null, b.state ?? null, b.city ?? null,
        b.language ?? "hi-IN", b.cadence ?? "weekly", b.channel ?? "in-app",
        b.tier ?? "growth", b.whatsapp ?? null);
    return Number(r.lastInsertRowid);
  },
  updateBusiness(id, b) {
    q(`UPDATE businesses SET name=COALESCE(?,name), category=COALESCE(?,category), state=COALESCE(?,state),
        city=COALESCE(?,city), language=COALESCE(?,language), cadence=COALESCE(?,cadence),
        channel=COALESCE(?,channel), tier=COALESCE(?,tier), whatsapp=COALESCE(?,whatsapp) WHERE id=?`)
      .run(b.name ?? null, b.category ?? null, b.state ?? null, b.city ?? null, b.language ?? null,
        b.cadence ?? null, b.channel ?? null, b.tier ?? null, b.whatsapp ?? null, id);
    return api.getBusiness(id);
  },
  getBusiness: (id) => q("SELECT * FROM businesses WHERE id=?").get(id),
  listBusinesses: () => q("SELECT * FROM businesses ORDER BY id DESC").all(),
  deleteBusiness: (id) => q("DELETE FROM businesses WHERE id=?").run(id),

  addWatch(w) {
    const r = q(`INSERT INTO watches (business_id, module, label, url, query, threshold_pct, monitor_id)
                 VALUES (?,?,?,?,?,?,?)`)
      .run(w.business_id, w.module, w.label ?? null, w.url ?? null, w.query ?? null,
        w.threshold_pct ?? 5, w.monitor_id ?? null);
    return Number(r.lastInsertRowid);
  },
  listWatches: (businessId, module) => module
    ? q("SELECT * FROM watches WHERE business_id=? AND module=? AND active=1 ORDER BY id").all(businessId, module)
    : q("SELECT * FROM watches WHERE business_id=? AND active=1 ORDER BY module, id").all(businessId),
  deleteWatch: (businessId, id) => q("DELETE FROM watches WHERE id=? AND business_id=?").run(id, businessId),

  startRun(businessId) {
    return Number(q("INSERT INTO runs (business_id) VALUES (?)").run(businessId).lastInsertRowid);
  },
  finishRun(runId, status, error) {
    q("UPDATE runs SET status=?, finished_at=datetime('now'), error=? WHERE id=?").run(status, error ?? null, runId);
  },
  saveModuleResult(r) {
    q(`INSERT INTO module_results (run_id, business_id, module, ok, summary, error, payload)
       VALUES (?,?,?,?,?,?,?)`)
      .run(r.run_id, r.business_id, r.module, r.ok ? 1 : 0, r.summary ?? null, r.error ?? null,
        JSON.stringify(r.payload ?? {}));
  },

  addObservation(o) {
    q(`INSERT INTO observations (business_id, run_id, module, watch_id, url, title, price_value, price_text,
        availability, rating, review_count, sentiment, moq, extra)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(o.business_id, o.run_id ?? null, o.module, o.watch_id ?? null, o.url ?? null, o.title ?? null,
        o.price_value ?? null, o.price_text ?? null, o.availability ?? null, o.rating ?? null,
        o.review_count ?? null, o.sentiment ?? null, o.moq ?? null, JSON.stringify(o.extra ?? {}));
  },
  /** Most recent observation for a URL BEFORE the current run - the change-detection baseline. */
  previousObservation: (businessId, url, runId) =>
    q(`SELECT * FROM observations WHERE business_id=? AND url=? AND (run_id IS NULL OR run_id<>?)
       ORDER BY observed_at DESC LIMIT 1`).get(businessId, url, runId ?? -1),
  observationHistory: (businessId, module, limit = 200) =>
    q(`SELECT * FROM observations WHERE business_id=? AND module=? ORDER BY observed_at ASC LIMIT ?`)
      .all(businessId, module, limit),
  allObservations: (businessId, limit = 500) =>
    q("SELECT * FROM observations WHERE business_id=? ORDER BY observed_at DESC LIMIT ?").all(businessId, limit),

  saveDigest(d) {
    const id = Number(q("INSERT INTO digests (business_id, run_id, language, text_en, text_local) VALUES (?,?,?,?,?)")
      .run(d.business_id, d.run_id ?? null, d.language, d.text_en, d.text_local).lastInsertRowid);
    const ins = q(`INSERT INTO digest_items (digest_id, rank, module, urgency, headline, detail, action, source_url)
                   VALUES (?,?,?,?,?,?,?,?)`);
    (d.items || []).forEach((it, i) =>
      ins.run(id, it.rank ?? i + 1, it.module ?? null, it.urgency ?? "medium",
        it.headline ?? "", it.detail ?? "", it.action ?? "", it.source_url ?? null));
    return id;
  },
  latestDigest(businessId) {
    const d = q("SELECT * FROM digests WHERE business_id=? ORDER BY id DESC LIMIT 1").get(businessId);
    if (!d) return null;
    d.items = q("SELECT * FROM digest_items WHERE digest_id=? ORDER BY rank").all(d.id);
    return d;
  },
  digestHistory: (businessId, limit = 20) =>
    q("SELECT id, created_at, language, text_en FROM digests WHERE business_id=? ORDER BY id DESC LIMIT ?")
      .all(businessId, limit),

  addMessage: (businessId, role, content) =>
    q("INSERT INTO messages (business_id, role, content) VALUES (?,?,?)").run(businessId, role, content),
  recentMessages: (businessId, limit = 14) =>
    q("SELECT role, content FROM messages WHERE business_id=? ORDER BY id DESC LIMIT ?")
      .all(businessId, limit).reverse(),

  addAction(a) {
    return Number(q(`INSERT INTO actions (business_id, type, title, body, target, source_url)
                     VALUES (?,?,?,?,?,?)`)
      .run(a.business_id, a.type, a.title ?? null, a.body ?? null, a.target ?? null, a.source_url ?? null)
      .lastInsertRowid);
  },
  listActions: (businessId, status) => status
    ? q("SELECT * FROM actions WHERE business_id=? AND status=? ORDER BY id DESC").all(businessId, status)
    : q("SELECT * FROM actions WHERE business_id=? ORDER BY id DESC LIMIT 50").all(businessId),
  resolveAction: (businessId, id, status) =>
    q("UPDATE actions SET status=?, resolved_at=datetime('now') WHERE id=? AND business_id=?")
      .run(status, id, businessId),

  replaceComplianceEvents(businessId, events) {
    q("DELETE FROM compliance_events WHERE business_id=? AND status='pending'").run(businessId);
    const ins = q(`INSERT INTO compliance_events (business_id, title, authority, due_date, frequency, portal_url, checklist)
                   VALUES (?,?,?,?,?,?,?)`);
    for (const e of events) {
      ins.run(businessId, e.title, e.authority ?? null, e.due_date ?? null, e.frequency ?? null,
        e.portal_url ?? null, JSON.stringify(e.checklist ?? []));
    }
  },
  listComplianceEvents: (businessId) =>
    q("SELECT * FROM compliance_events WHERE business_id=? ORDER BY COALESCE(due_date,'9999') ASC").all(businessId),
  setComplianceStatus: (businessId, id, status) =>
    q("UPDATE compliance_events SET status=? WHERE id=? AND business_id=?").run(status, id, businessId),


  /* ------------------------------------------------- procurement (v2) --- */

  createRFQ(r) {
    return Number(q(`INSERT INTO rfqs (business_id, material, quantity, unit, target_price, delivery_city,
        delivery_pincode, needed_by, quality_notes, raw_request)
       VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(r.business_id, r.material, r.quantity ?? null, r.unit ?? null, r.target_price ?? null,
        r.delivery_city ?? null, r.delivery_pincode ?? null, r.needed_by ?? null,
        r.quality_notes ?? null, r.raw_request ?? null).lastInsertRowid);
  },
  getRFQ: (businessId, id) => q("SELECT * FROM rfqs WHERE id=? AND business_id=?").get(id, businessId),
  listRFQs: (businessId, status) => status
    ? q("SELECT * FROM rfqs WHERE business_id=? AND status=? ORDER BY id DESC").all(businessId, status)
    : q("SELECT * FROM rfqs WHERE business_id=? ORDER BY id DESC LIMIT 50").all(businessId),
  setRFQStatus: (businessId, id, status) =>
    q("UPDATE rfqs SET status=? WHERE id=? AND business_id=?").run(status, id, businessId),

  addVendor(v) {
    return Number(q(`INSERT INTO vendors (business_id, rfq_id, name, listed_price, listed_price_text, unit,
        moq, moq_value, location, phone, source_url, availability, certifications, score, score_breakdown,
        shortlist_reason, shortlisted)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(v.business_id, v.rfq_id ?? null, v.name, v.listed_price ?? null, v.listed_price_text ?? null,
        v.unit ?? null, v.moq ?? null, v.moq_value ?? null, v.location ?? null, v.phone ?? null,
        v.source_url ?? null, v.availability ?? null,
        JSON.stringify(v.certifications ?? []), v.score ?? null,
        JSON.stringify(v.score_breakdown ?? {}), v.shortlist_reason ?? null,
        v.shortlisted ? 1 : 0).lastInsertRowid);
  },
  listVendors: (rfqId, onlyShortlisted) => onlyShortlisted
    ? q("SELECT * FROM vendors WHERE rfq_id=? AND shortlisted=1 ORDER BY score DESC").all(rfqId)
    : q("SELECT * FROM vendors WHERE rfq_id=? ORDER BY score DESC").all(rfqId),
  getVendor: (id) => q("SELECT * FROM vendors WHERE id=?").get(id),
  markDoNotCall: (id) => q("UPDATE vendors SET do_not_call=1 WHERE id=?").run(id),

  startNegotiation(n) {
    return Number(q(`INSERT INTO negotiations (business_id, rfq_id, vendor_id, channel, language)
                     VALUES (?,?,?,?,?)`)
      .run(n.business_id, n.rfq_id, n.vendor_id, n.channel, n.language ?? null).lastInsertRowid);
  },
  endNegotiation: (id, status, turns, error) =>
    q("UPDATE negotiations SET status=?, turns=?, error=?, ended_at=datetime('now') WHERE id=?")
      .run(status, turns ?? 0, error ?? null, id),
  addTranscriptLine: (negotiationId, turn, speaker, text, textLocal) =>
    q("INSERT INTO transcripts (negotiation_id, turn, speaker, text, text_local) VALUES (?,?,?,?,?)")
      .run(negotiationId, turn, speaker, text, textLocal ?? null),
  getTranscript: (negotiationId) =>
    q("SELECT * FROM transcripts WHERE negotiation_id=? ORDER BY turn, id").all(negotiationId),
  listNegotiations: (rfqId) =>
    q(`SELECT n.*, v.name AS vendor_name FROM negotiations n
       JOIN vendors v ON v.id = n.vendor_id WHERE n.rfq_id=? ORDER BY n.id`).all(rfqId),

  addQuote(qt) {
    return Number(q(`INSERT INTO quotes (business_id, rfq_id, vendor_id, negotiation_id, rate, rate_text, unit,
        moq, lead_time_days, lead_time_text, delivery_terms, payment_terms, freight, landed_cost, total_cost,
        confidence, caveat, rationale, rank)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(qt.business_id, qt.rfq_id, qt.vendor_id, qt.negotiation_id ?? null, qt.rate ?? null,
        qt.rate_text ?? null, qt.unit ?? null, qt.moq ?? null, qt.lead_time_days ?? null,
        qt.lead_time_text ?? null, qt.delivery_terms ?? null, qt.payment_terms ?? null,
        qt.freight ?? null, qt.landed_cost ?? null, qt.total_cost ?? null, qt.confidence ?? null,
        qt.caveat ?? null, qt.rationale ?? null, qt.rank ?? null).lastInsertRowid);
  },
  listQuotes: (rfqId) =>
    q(`SELECT q.*, v.name AS vendor_name, v.location AS vendor_location, v.phone AS vendor_phone,
              v.source_url AS vendor_url
       FROM quotes q JOIN vendors v ON v.id = q.vendor_id
       WHERE q.rfq_id=? ORDER BY COALESCE(q.rank, 999), q.landed_cost`).all(rfqId),
  getQuote: (businessId, id) =>
    q(`SELECT q.*, v.name AS vendor_name, v.phone AS vendor_phone, v.location AS vendor_location
       FROM quotes q JOIN vendors v ON v.id = q.vendor_id
       WHERE q.id=? AND q.business_id=?`).get(id, businessId),
  setQuoteRank: (id, rank, rationale, landed) =>
    q("UPDATE quotes SET rank=?, rationale=?, landed_cost=COALESCE(?,landed_cost) WHERE id=?")
      .run(rank, rationale ?? null, landed ?? null, id),

  nextPONumber(businessId) {
    const n = q("SELECT COUNT(*) AS c FROM orders WHERE business_id=?").get(businessId).c;
    return `SAHAY/${new Date().getFullYear()}/${String(businessId).padStart(3, "0")}/${String(n + 1).padStart(4, "0")}`;
  },
  createOrder(o) {
    const id = Number(q(`INSERT INTO orders (business_id, rfq_id, quote_id, vendor_id, po_number, material,
        quantity, unit, rate, amount, expected_delivery, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(o.business_id, o.rfq_id ?? null, o.quote_id ?? null, o.vendor_id ?? null, o.po_number,
        o.material ?? null, o.quantity ?? null, o.unit ?? null, o.rate ?? null, o.amount ?? null,
        o.expected_delivery ?? null, o.notes ?? null).lastInsertRowid);
    q("INSERT INTO order_events (order_id, status, note) VALUES (?,?,?)").run(id, "draft", "Purchase order created");
    return id;
  },
  getOrder: (businessId, id) =>
    q(`SELECT o.*, v.name AS vendor_name, v.phone AS vendor_phone, v.location AS vendor_location
       FROM orders o LEFT JOIN vendors v ON v.id = o.vendor_id
       WHERE o.id=? AND o.business_id=?`).get(id, businessId),
  getOrderByPO: (poNumber) => q("SELECT * FROM orders WHERE po_number=?").get(poNumber),
  listOrders: (businessId, status) => status
    ? q(`SELECT o.*, v.name AS vendor_name FROM orders o LEFT JOIN vendors v ON v.id=o.vendor_id
         WHERE o.business_id=? AND o.status=? ORDER BY o.id DESC`).all(businessId, status)
    : q(`SELECT o.*, v.name AS vendor_name FROM orders o LEFT JOIN vendors v ON v.id=o.vendor_id
         WHERE o.business_id=? ORDER BY o.id DESC LIMIT 60`).all(businessId),
  /** Orders the owner has actually committed to - what the daily summary reports on. */
  listActiveOrders: (businessId) =>
    q(`SELECT o.*, v.name AS vendor_name FROM orders o LEFT JOIN vendors v ON v.id=o.vendor_id
       WHERE o.business_id=? AND o.status IN ('sent','confirmed','paid','in_transit')
       ORDER BY COALESCE(o.expected_delivery,'9999'), o.id`).all(businessId),
  setOrderStatus(businessId, id, status, note) {
    q("UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=? AND business_id=?")
      .run(status, id, businessId);
    q("INSERT INTO order_events (order_id, status, note) VALUES (?,?,?)").run(id, status, note ?? null);
  },
  orderEvents: (orderId) => q("SELECT * FROM order_events WHERE order_id=? ORDER BY id").all(orderId),

  addPayment(p) {
    return Number(q(`INSERT INTO payments (business_id, order_id, provider, provider_ref, short_url, amount, status)
                     VALUES (?,?,?,?,?,?,?)`)
      .run(p.business_id, p.order_id, p.provider ?? "razorpay", p.provider_ref ?? null,
        p.short_url ?? null, p.amount ?? null, p.status ?? "created").lastInsertRowid);
  },
  getPaymentForOrder: (orderId) =>
    q("SELECT * FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1").get(orderId),
  setPaymentStatus: (id, status) =>
    q("UPDATE payments SET status=?, paid_at=CASE WHEN ?='paid' THEN datetime('now') ELSE paid_at END WHERE id=?")
      .run(status, status, id),

  /* --------------------------------------------------------- telegram --- */

  linkTelegram(chatId, data) {
    q(`INSERT INTO telegram_links (chat_id, business_id, username, first_name, language)
       VALUES (?,?,?,?,?)
       ON CONFLICT(chat_id) DO UPDATE SET business_id=excluded.business_id,
         username=excluded.username, first_name=excluded.first_name,
         language=COALESCE(excluded.language, language), last_seen=datetime('now')`)
      .run(String(chatId), data.business_id ?? null, data.username ?? null,
        data.first_name ?? null, data.language ?? null);
  },
  getTelegramLink: (chatId) => q("SELECT * FROM telegram_links WHERE chat_id=?").get(String(chatId)),
  listTelegramLinks: () => q("SELECT * FROM telegram_links WHERE business_id IS NOT NULL").all(),
  setTelegramState(chatId, state, data) {
    q("UPDATE telegram_links SET state=?, state_data=?, last_seen=datetime('now') WHERE chat_id=?")
      .run(state ?? null, data ? JSON.stringify(data) : null, String(chatId));
  },
  setTelegramLanguage: (chatId, language) =>
    q("UPDATE telegram_links SET language=? WHERE chat_id=?").run(language, String(chatId)),
  setTelegramVoice: (chatId, on) =>
    q("UPDATE telegram_links SET voice=? WHERE chat_id=?").run(on ? 1 : 0, String(chatId)),

  addFollowup(f) {
    return Number(q("INSERT INTO followups (business_id, chat_id, question, context) VALUES (?,?,?,?)")
      .run(f.business_id, f.chat_id ?? null, f.question, f.context ?? null).lastInsertRowid);
  },
  openFollowups: (businessId) =>
    q("SELECT * FROM followups WHERE business_id=? AND status='open' ORDER BY id").all(businessId),
  resolveFollowup: (id, answer) =>
    q("UPDATE followups SET answer=?, status='answered', resolved_at=datetime('now') WHERE id=?")
      .run(answer, id),

  auditTrail: (businessId, limit = 100) =>
    q("SELECT * FROM audit_log WHERE business_id=? ORDER BY id DESC LIMIT ?").all(businessId, limit),
};

module.exports = api;
