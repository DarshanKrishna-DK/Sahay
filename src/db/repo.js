"use strict";

/**
 * Data access. Every exported function takes `businessId` first and filters on
 * it, so a row that belongs to another business is indistinguishable from a row
 * that does not exist. The few operations that are cross-tenant by nature (the
 * follow-up scheduler, one-time link codes, restart recovery) live under
 * `system` and are for server-internal callers only.
 *
 * SQL text is assembled only from the table and column names written in this
 * file; every value is bound as a parameter. Inputs use the column names.
 */

const crypto = require("node:crypto");
const db = require("./index");
const { vendorText, QUOTED_SENTENCE_MAX } = require("./vendor-text");

class RepoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RepoError";
    this.code = code;
  }
}

const JSON_COLUMNS = {
  jobs: ["progress", "result"],
  vendors: ["score_breakdown"],
  negotiations: ["transcript", "outcome"],
  audit_log: ["detail"],
};

/** Approvals and orders read their `simulated` flag from the quote they are about. */
const SELECT = {
  approvals: "SELECT t.*, q.simulated AS simulated FROM approvals t JOIN quotes q ON q.id = t.quote_id",
  orders: "SELECT t.*, q.simulated AS simulated FROM orders t JOIN quotes q ON q.id = t.quote_id",
};

const VENDOR_KIND_BY_SOURCE = { indiamart: "listed", simulated: "simulated", human: "human" };
const SIMULATED_LABEL = "simulated vendor";


const newId = (prefix) => `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
const now = () => new Date().toISOString();

/* ------------------------------------------------------------- helpers --- */

function tenant(businessId) {
  if (typeof businessId !== "string" || businessId === "") {
    throw new RepoError("BUSINESS_REQUIRED", "A business id is required.");
  }
  return businessId;
}

function invalid(message) {
  return new RepoError("INVALID", message);
}

function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw invalid(`${name} is required.`);
  return value.trim();
}

/** A finite number that is not negative (or is above zero when `positive`); null when absent and `optional`. */
function number(value, name, { positive = false, optional = true, integer = false } = {}) {
  if (value == null) {
    if (optional) return null;
    throw invalid(`${name} is required.`);
  }
  const inRange = positive ? value > 0 : value >= 0;
  if (typeof value !== "number" || !Number.isFinite(value) || !inRange || (integer && !Number.isInteger(value))) {
    throw invalid(`${name} must be ${integer ? "a whole number" : "a number"} ${positive ? "above zero" : "of zero or more"}.`);
  }
  return value;
}

function pick(source, allowed) {
  const out = {};
  for (const key of allowed) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

const toParam = (value) => (value === undefined ? null : typeof value === "boolean" ? Number(value) : value);
const toJson = (value) => (value == null ? null : JSON.stringify(value));

function hydrate(table, row) {
  if (!row) return null;
  const out = { ...row };
  for (const column of JSON_COLUMNS[table] ?? []) {
    if (out[column] != null) out[column] = JSON.parse(out[column]);
  }
  if (table === "vendors") out.simulated = out.kind === "simulated";
  else if (table === "negotiations") out.simulated = out.counterpart === "simulated";
  else if ("simulated" in out) out.simulated = out.simulated === 1;
  return out;
}

const selectFrom = (table) => SELECT[table] ?? `SELECT t.* FROM ${table} t`;

function getRow(table, businessId, id) {
  if (typeof id !== "string" || id === "") return null;
  const row = db.prepare(`${selectFrom(table)} WHERE t.business_id = ? AND t.id = ?`).get(tenant(businessId), id);
  return hydrate(table, row);
}

function listRows(table, businessId, filters = {}, { orderBy = "t.created_at, t.rowid", limit } = {}) {
  const where = ["t.business_id = ?"];
  const params = [tenant(businessId)];
  for (const [column, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    where.push(`t.${column} = ?`);
    params.push(toParam(value));
  }
  let sql = `${selectFrom(table)} WHERE ${where.join(" AND ")} ORDER BY ${orderBy}`;
  if (limit !== undefined) {
    sql += " LIMIT ?";
    params.push(number(limit, "limit", { positive: true, optional: false, integer: true }));
  }
  return db.prepare(sql).all(...params).map((row) => hydrate(table, row));
}

function insertRow(table, row) {
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(
    ...columns.map((column) => toParam(row[column])),
  );
}

/** Update the named columns of one row of this business. Returns true when a row changed. */
function updateRow(table, businessId, id, patch, guard = {}) {
  const columns = Object.keys(patch);
  if (!columns.length) throw invalid("Nothing to update.");
  const where = ["business_id = ?", "id = ?"];
  const params = [...columns.map((column) => toParam(patch[column])), tenant(businessId), id];
  for (const [column, value] of Object.entries(guard)) {
    where.push(`${column} = ?`);
    params.push(value);
  }
  const sql = `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE ${where.join(" AND ")}`;
  return db.prepare(sql).run(...params).changes === 1;
}

/** The row, or a NOT_FOUND error that reads the same for "missing" and "someone else's". */
function owned(table, businessId, id, what) {
  const row = getRow(table, businessId, id);
  if (!row) throw new RepoError("NOT_FOUND", `No ${what} ${id} for this business.`);
  return row;
}

/* ---------------------------------------------------------- businesses --- */

const BUSINESS_FIELDS = ["name", "owner_name", "city", "state", "language"];

function checkLanguage(language) {
  if (language !== undefined && !/^[a-z]{2}-[A-Z]{2}$/.test(language)) {
    throw invalid("language must look like hi-IN.");
  }
}

function createBusiness(businessId, fields) {
  checkLanguage(fields.language);
  insertRow("businesses", {
    id: tenant(businessId),
    ...pick(fields, BUSINESS_FIELDS),
    name: requireText(fields.name, "name"),
    created_at: now(),
  });
  return getBusiness(businessId);
}

function getBusiness(businessId) {
  const row = db.prepare("SELECT * FROM businesses WHERE id = ?").get(tenant(businessId));
  return row ? { ...row } : null;
}

function updateBusiness(businessId, fields) {
  const patch = pick(fields, BUSINESS_FIELDS);
  checkLanguage(patch.language);
  if (patch.name !== undefined) patch.name = requireText(patch.name, "name");
  const columns = Object.keys(patch);
  if (!columns.length) throw invalid("Nothing to update.");
  db.prepare(`UPDATE businesses SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`).run(
    ...columns.map((column) => toParam(patch[column])),
    tenant(businessId),
  );
  return getBusiness(businessId);
}

/* ------------------------------------------------------------ sessions --- */

function createSession(businessId, { kind, channel, agent_id, status = "active" }) {
  const id = newId("ses");
  insertRow("sessions", { id, business_id: tenant(businessId), kind, channel, agent_id, status, started_at: now() });
  return getSession(businessId, id);
}

const getSession = (businessId, sessionId) => getRow("sessions", businessId, sessionId);

function listSessions(businessId, { kind, status } = {}) {
  return listRows("sessions", businessId, { kind, status }, { orderBy: "t.started_at, t.rowid" });
}

function updateSession(businessId, sessionId, fields) {
  updateRow("sessions", businessId, sessionId, pick(fields, ["channel", "agent_id", "status", "ended_at"]));
  return getSession(businessId, sessionId);
}

/* -------------------------------------------------------- requirements --- */

const REQUIREMENT_FIELDS = ["item", "quantity", "unit", "target_price", "max_price", "city", "delivery_by", "notes", "status"];

function checkRequirement(fields) {
  number(fields.quantity, "quantity", { positive: true });
  number(fields.target_price, "target_price", { positive: true });
  number(fields.max_price, "max_price", { positive: true });
}

function createRequirement(businessId, fields) {
  checkRequirement(fields);
  if (fields.session_id != null) owned("sessions", businessId, fields.session_id, "session");
  const id = newId("req");
  insertRow("requirements", {
    id,
    business_id: tenant(businessId),
    session_id: fields.session_id,
    status: "draft",
    ...pick(fields, REQUIREMENT_FIELDS),
    created_at: now(),
  });
  return getRequirement(businessId, id);
}

const getRequirement = (businessId, requirementId) => getRow("requirements", businessId, requirementId);

const DISMISSED = "dismissed";

/** A need the owner dismissed is left out unless asked for (by its status or includeDismissed). */
function listRequirements(businessId, { status, includeDismissed = false } = {}) {
  const rows = listRows("requirements", businessId, { status });
  return status !== undefined || includeDismissed ? rows : rows.filter((r) => r.status !== DISMISSED);
}

/**
 * The owner drops a need (a garbled turn saved junk). Only a need with no queued or running job
 * and no order; dismissing again returns it unchanged. Throws NOT_FOUND, REQUIREMENT_BUSY or
 * REQUIREMENT_ORDERED.
 */
function dismissRequirement(businessId, requirementId) {
  const need = owned("requirements", businessId, requirementId, "requirement");
  if (need.status === DISMISSED) return need;
  const busy = db
    .prepare("SELECT 1 FROM jobs WHERE business_id = ? AND requirement_id = ? AND status IN ('queued', 'running') LIMIT 1")
    .get(tenant(businessId), requirementId);
  if (busy) throw new RepoError("REQUIREMENT_BUSY", "Sahay is still working on this need.");
  const ordered = db
    .prepare("SELECT 1 FROM orders o JOIN quotes q ON q.id = o.quote_id WHERE o.business_id = ? AND q.requirement_id = ? LIMIT 1")
    .get(tenant(businessId), requirementId);
  if (ordered) throw new RepoError("REQUIREMENT_ORDERED", "This need already has an order.");
  updateRow("requirements", businessId, requirementId, { status: DISMISSED });
  return getRequirement(businessId, requirementId);
}

function updateRequirement(businessId, requirementId, fields) {
  const patch = pick(fields, REQUIREMENT_FIELDS);
  checkRequirement(patch);
  updateRow("requirements", businessId, requirementId, patch);
  return getRequirement(businessId, requirementId);
}

/* ---------------------------------------------------------------- jobs --- */

function createJob(businessId, { kind, requirement_id }) {
  if (requirement_id != null) owned("requirements", businessId, requirement_id, "requirement");
  const id = newId("job");
  const at = now();
  insertRow("jobs", { id, business_id: tenant(businessId), requirement_id, kind, status: "queued", created_at: at, updated_at: at });
  return getJob(businessId, id);
}

const getJob = (businessId, jobId) => getRow("jobs", businessId, jobId);

function listJobs(businessId, { requirement_id, kind, status } = {}) {
  return listRows("jobs", businessId, { requirement_id, kind, status });
}

/** Move a job from one status to another. Returns false when the job was not in `from`. */
function transitionJob(businessId, jobId, from, to, { result, error } = {}) {
  return updateRow(
    "jobs",
    businessId,
    jobId,
    { status: to, result: toJson(result), error: error ?? null, updated_at: now() },
    { status: from },
  );
}

function appendJobProgress(businessId, jobId, entry) {
  const changed = db
    .prepare("UPDATE jobs SET progress = json_insert(progress, '$[#]', json(?)), updated_at = ? WHERE business_id = ? AND id = ?")
    .run(JSON.stringify(entry), now(), tenant(businessId), jobId).changes;
  if (changed !== 1) throw new RepoError("NOT_FOUND", `No job ${jobId} for this business.`);
}

/* ------------------------------------------------------------- vendors --- */

const VENDOR_FIELDS = [
  "name", "city", "phone", "item_title", "listed_price_text", "listed_price", "listed_unit",
  "rating", "rating_count", "source_url", "score",
];

function createVendor(businessId, fields) {
  const kind = VENDOR_KIND_BY_SOURCE[fields.source];
  if (!kind) throw invalid("source must be indiamart, simulated or human.");
  if (fields.kind !== undefined && fields.kind !== kind) {
    throw invalid(`A vendor from source "${fields.source}" is of kind "${kind}", not "${fields.kind}".`);
  }
  if (kind !== "listed" && (fields.phone != null || fields.source_url != null)) {
    throw invalid("Only a listed vendor has a published phone number or listing URL.");
  }
  owned("requirements", businessId, fields.requirement_id, "requirement");
  number(fields.listed_price, "listed_price");
  const id = newId("ven");
  insertRow("vendors", {
    id,
    business_id: tenant(businessId),
    requirement_id: fields.requirement_id,
    source: fields.source,
    kind,
    ...pick(fields, VENDOR_FIELDS),
    // Seller-controlled text: cleaned once here, so no prompt, line, PDF or message gets it raw.
    name: requireText(vendorText(fields.name) ?? "", "name"),
    city: vendorText(fields.city),
    item_title: vendorText(fields.item_title),
    listed_price_text: vendorText(fields.listed_price_text),
    score_breakdown: toJson(fields.score_breakdown),
    created_at: now(),
  });
  return getVendor(businessId, id);
}

const getVendor = (businessId, vendorId) => getRow("vendors", businessId, vendorId);

/** Best score first; unscored vendors last. */
function listVendors(businessId, { requirement_id, kind } = {}, { limit } = {}) {
  return listRows("vendors", businessId, { requirement_id, kind }, { orderBy: "t.score IS NULL, t.score DESC, t.created_at, t.rowid", limit });
}

function setVendorScore(businessId, vendorId, { score, score_breakdown }) {
  updateRow("vendors", businessId, vendorId, { score: number(score, "score", { optional: false }), score_breakdown: toJson(score_breakdown) });
  return getVendor(businessId, vendorId);
}

/* -------------------------------------------------------- negotiations --- */

function createNegotiation(businessId, { requirement_id, vendor_id, session_id, counterpart, status = "open" }) {
  const vendor = owned("vendors", businessId, vendor_id, "vendor");
  if (vendor.requirement_id !== requirement_id) throw invalid("That vendor was not found for this requirement.");
  if (vendor.kind === "simulated" && counterpart !== "simulated") {
    throw invalid("A simulated vendor can only be negotiated with as a simulated counterpart.");
  }
  if (session_id != null) owned("sessions", businessId, session_id, "session");
  const id = newId("neg");
  insertRow("negotiations", {
    id, business_id: tenant(businessId), requirement_id, vendor_id, session_id, counterpart, status, created_at: now(),
  });
  return getNegotiation(businessId, id);
}

const getNegotiation = (businessId, negotiationId) => getRow("negotiations", businessId, negotiationId);

function listNegotiations(businessId, { requirement_id, vendor_id, status } = {}) {
  return listRows("negotiations", businessId, { requirement_id, vendor_id, status });
}

/** Append one turn to the transcript. Turns of a simulated negotiation are stamped as such. */
function appendNegotiationTurn(businessId, negotiationId, turn) {
  const negotiation = owned("negotiations", businessId, negotiationId, "negotiation");
  const entry = negotiation.simulated ? { ...turn, simulated: true, counterpart_label: SIMULATED_LABEL } : turn;
  db.prepare("UPDATE negotiations SET transcript = json_insert(transcript, '$[#]', json(?)) WHERE business_id = ? AND id = ?").run(
    JSON.stringify(entry),
    businessId,
    negotiationId,
  );
  return entry;
}

function updateNegotiation(businessId, negotiationId, fields) {
  const patch = pick(fields, ["status", "session_id", "ended_at"]);
  if (fields.outcome !== undefined) patch.outcome = toJson(fields.outcome);
  if (patch.session_id != null) owned("sessions", businessId, patch.session_id, "session");
  updateRow("negotiations", businessId, negotiationId, patch);
  return getNegotiation(businessId, negotiationId);
}

/* -------------------------------------------------------------- quotes --- */

/**
 * Record a quote. `simulated` is never taken from the caller: it is derived from
 * the vendor and the negotiation the quote came out of. A negotiation yields one
 * quote; recording it again returns the first one.
 */
function createQuote(businessId, fields) {
  const vendor = owned("vendors", businessId, fields.vendor_id, "vendor");
  if (vendor.requirement_id !== fields.requirement_id) throw invalid("That vendor was not found for this requirement.");

  let negotiation = null;
  if (fields.negotiation_id != null) {
    negotiation = owned("negotiations", businessId, fields.negotiation_id, "negotiation");
    if (negotiation.vendor_id !== vendor.id) throw invalid("That negotiation was with a different vendor.");
    const existing = listRows("quotes", businessId, { negotiation_id: negotiation.id })[0];
    if (existing) return existing;
  }

  const id = newId("quo");
  insertRow("quotes", {
    id,
    business_id: tenant(businessId),
    requirement_id: fields.requirement_id,
    vendor_id: vendor.id,
    negotiation_id: negotiation?.id,
    unit_price: number(fields.unit_price, "unit_price", { positive: true, optional: false }),
    unit: fields.unit,
    moq: number(fields.moq, "moq"),
    lead_time_days: number(fields.lead_time_days, "lead_time_days", { integer: true }),
    freight: number(fields.freight, "freight"),
    payment_terms: vendorText(fields.payment_terms),
    quoted_sentence: vendorText(fields.quoted_sentence, QUOTED_SENTENCE_MAX),
    confidence: number(fields.confidence, "confidence"),
    simulated: vendor.simulated || negotiation?.simulated === true,
    landed_cost: number(fields.landed_cost, "landed_cost"),
    created_at: now(),
  });
  return getQuote(businessId, id);
}

const getQuote = (businessId, quoteId) => getRow("quotes", businessId, quoteId);

function listQuotes(businessId, { requirement_id, vendor_id } = {}) {
  return listRows("quotes", businessId, { requirement_id, vendor_id });
}

/** Store the landed cost; null means freight is unknown, never zero. */
function setQuoteLandedCost(businessId, quoteId, landedCost) {
  updateRow("quotes", businessId, quoteId, { landed_cost: number(landedCost, "landed_cost") });
  return getQuote(businessId, quoteId);
}

/* ----------------------------------------------------------- approvals --- */

function createApproval(businessId, { quote_id, readback, total_amount }) {
  owned("quotes", businessId, quote_id, "quote");
  const id = newId("apr");
  insertRow("approvals", {
    id,
    business_id: tenant(businessId),
    quote_id,
    status: "pending",
    readback: requireText(readback, "readback"),
    total_amount: number(total_amount, "total_amount", { positive: true, optional: false }),
    requested_at: now(),
  });
  return getApproval(businessId, id);
}

const getApproval = (businessId, approvalId) => getRow("approvals", businessId, approvalId);

function listApprovals(businessId, { quote_id, status } = {}) {
  return listRows("approvals", businessId, { quote_id, status }, { orderBy: "t.requested_at, t.rowid" });
}

/** Decide a pending approval. Returns false when it was not pending any more. */
function decideApproval(businessId, approvalId, { status, decided_via, evidence_utterance }) {
  if (status !== "approved" && status !== "rejected") throw invalid("An approval is decided as approved or rejected.");
  return updateRow(
    "approvals",
    businessId,
    approvalId,
    { status, decided_via: decided_via ?? null, evidence_utterance: evidence_utterance ?? null, decided_at: now() },
    { status: "pending" },
  );
}

/**
 * Withdraw an approval that has not been used: pending or approved becomes rejected.
 * Returns false when it was already rejected or consumed.
 */
function withdrawApproval(businessId, approvalId) {
  return (
    db
      .prepare(
        "UPDATE approvals SET status = 'rejected', decided_at = COALESCE(decided_at, ?) " +
          "WHERE business_id = ? AND id = ? AND status IN ('pending', 'approved')",
      )
      .run(now(), tenant(businessId), approvalId).changes === 1
  );
}

/**
 * Record that the server spoke this approval's read-back into the call of `agent_id`.
 * Only for a pending approval of this business (DB trigger approval_readbacks_need_pending).
 */
function recordApprovalReadback(businessId, approvalId, { agent_id, spoken_text }) {
  const id = newId("rbk");
  insertRow("approval_readbacks", {
    id,
    business_id: tenant(businessId),
    approval_id: requireText(approvalId, "approval_id"),
    agent_id: requireText(agent_id, "agent_id"),
    spoken_text: requireText(spoken_text, "spoken_text"),
    spoken_at: now(),
  });
  return { ...db.prepare("SELECT * FROM approval_readbacks WHERE id = ?").get(id) };
}

/** Read-backs the server spoke for this business, oldest first; narrowed by approval or agent. */
function listApprovalReadbacks(businessId, { approval_id, agent_id } = {}) {
  return listRows("approval_readbacks", businessId, { approval_id, agent_id }, { orderBy: "t.spoken_at, t.rowid" });
}

/* -------------------------------------------------------------- orders --- */

/**
 * The business's code inside its purchase-order numbers (SAHAY/2026/AB12-0001): every business
 * counts its own orders from 0001 (E2E r4 bug 7), and the code keeps the numbers unique across
 * businesses (orders.po_number is UNIQUE). The code is the start of a hash of the business id,
 * 4 hex digits, longer only when another business already uses that code under this prefix; a
 * business keeps the code its earlier orders under the prefix have. Runs inside the order transaction.
 */
function poCode(businessId, poPrefix) {
  const own = db
    .prepare("SELECT po_number FROM orders WHERE business_id = ? AND substr(po_number, 1, ?) = ? ORDER BY rowid DESC")
    .all(businessId, poPrefix.length, poPrefix)
    .map((row) => /^([0-9A-F]+)-\d+$/.exec(row.po_number.slice(poPrefix.length))?.[1])
    .find(Boolean);
  if (own) return own;
  const hash = crypto.createHash("sha256").update(businessId).digest("hex").toUpperCase();
  const taken = db.prepare("SELECT 1 FROM orders WHERE business_id <> ? AND substr(po_number, 1, ?) = ? LIMIT 1");
  for (let length = 4; length <= hash.length; length += 2) {
    const code = hash.slice(0, length);
    const prefix = `${poPrefix}${code}-`;
    if (!taken.get(businessId, prefix.length, prefix)) return code;
  }
  throw new RepoError("PO_CODE_EXHAUSTED", "No free purchase-order code for this business.");
}

/**
 * The only way an order row comes to exist: consume an approved approval of this
 * business and create the order for the quote and amount that approval names.
 * Both happen in one transaction; the approval cannot be used a second time.
 */
function createOrderFromApproval(businessId, approvalId, { status, po_prefix }) {
  requireText(status, "status");
  requireText(po_prefix, "po_prefix");
  return db.transaction(() => {
    const approval = getApproval(businessId, approvalId);
    const consumed = approval && updateRow("approvals", businessId, approvalId, { status: "consumed" }, { status: "approved" });
    if (!consumed) {
      throw new RepoError("APPROVAL_NOT_USABLE", "There is no approved, unused approval with that id for this business.");
    }

    const prefix = `${po_prefix}${poCode(businessId, po_prefix)}-`;
    const { last } = db
      .prepare("SELECT MAX(CAST(substr(po_number, ?) AS INTEGER)) AS last FROM orders WHERE business_id = ? AND substr(po_number, 1, ?) = ?")
      .get(prefix.length + 1, businessId, prefix.length, prefix);
    const id = newId("ord");
    insertRow("orders", {
      id,
      business_id: businessId,
      quote_id: approval.quote_id,
      approval_id: approval.id,
      po_number: `${prefix}${String((last ?? 0) + 1).padStart(4, "0")}`,
      status,
      amount: approval.total_amount,
      created_at: now(),
    });
    return getOrder(businessId, id);
  });
}

const getOrder = (businessId, orderId) => getRow("orders", businessId, orderId);

function listOrders(businessId, { status, quote_id } = {}) {
  return listRows("orders", businessId, { status, quote_id });
}

function updateOrder(businessId, orderId, fields) {
  updateRow("orders", businessId, orderId, pick(fields, ["pdf_path", "payment_link_id", "payment_link_url"]));
  return getOrder(businessId, orderId);
}

/** An order with everything it rests on, for the purchase order and the payment link. Null when not this business's. */
function getOrderDocument(businessId, orderId) {
  const order = getOrder(businessId, orderId);
  if (!order) return null;
  const quote = getQuote(businessId, order.quote_id);
  return {
    order,
    quote,
    business: getBusiness(businessId),
    approval: getApproval(businessId, order.approval_id),
    vendor: getVendor(businessId, quote.vendor_id),
    requirement: getRequirement(businessId, quote.requirement_id),
    negotiation: getNegotiation(businessId, quote.negotiation_id),
  };
}

/** Move an order from one status to another. Returns false when it was not in `from`. */
function transitionOrder(businessId, orderId, from, to) {
  return updateRow("orders", businessId, orderId, { status: to }, { status: from });
}

/* --------------------------------------------------- payment checkouts --- */

/** The pay page of an order (src/orders/payments.js). One per order (UNIQUE order_id). */
function createCheckout(businessId, { order_id, razorpay_order_id, token_hash, expires_at }) {
  owned("orders", businessId, order_id, "order");
  const id = newId("chk");
  insertRow("payment_checkouts", {
    id,
    business_id: tenant(businessId),
    order_id,
    razorpay_order_id: requireText(razorpay_order_id, "razorpay_order_id"),
    token_hash: requireText(token_hash, "token_hash"),
    expires_at: requireText(expires_at, "expires_at"),
    created_at: now(),
  });
  return getRow("payment_checkouts", businessId, id);
}

function getCheckoutForOrder(businessId, orderId) {
  return listRows("payment_checkouts", businessId, { order_id: orderId })[0] ?? null;
}

/** A new token for an unpaid checkout (the old one stops working). Returns false when it is paid. */
function renewCheckoutToken(businessId, checkoutId, { token_hash, expires_at }) {
  return db
    .prepare("UPDATE payment_checkouts SET token_hash = ?, expires_at = ? WHERE business_id = ? AND id = ? AND paid_at IS NULL")
    .run(requireText(token_hash, "token_hash"), requireText(expires_at, "expires_at"), tenant(businessId), checkoutId).changes === 1;
}

/** Record the verified payment once. Returns false when the checkout was already paid. */
function markCheckoutPaid(businessId, checkoutId, { razorpay_payment_id }) {
  return db
    .prepare("UPDATE payment_checkouts SET paid_at = ?, razorpay_payment_id = ? WHERE business_id = ? AND id = ? AND paid_at IS NULL")
    .run(now(), requireText(razorpay_payment_id, "razorpay_payment_id"), tenant(businessId), checkoutId).changes === 1;
}

/* ----------------------------------------------------------- followups --- */

function createFollowup(businessId, { order_id, kind, due_at, message }) {
  if (order_id != null) owned("orders", businessId, order_id, "order");
  const id = newId("fol");
  insertRow("followups", {
    id,
    business_id: tenant(businessId),
    order_id,
    kind: requireText(kind, "kind"),
    due_at: requireText(due_at, "due_at"),
    status: "scheduled",
    message,
  });
  return getFollowup(businessId, id);
}

const getFollowup = (businessId, followupId) => getRow("followups", businessId, followupId);

function listFollowups(businessId, { status, order_id } = {}) {
  return listRows("followups", businessId, { status, order_id }, { orderBy: "t.due_at, t.rowid" });
}

/** Mark a scheduled follow-up fired or cancelled. Returns false when it was no longer scheduled. */
function settleFollowup(businessId, followupId, status) {
  if (status !== "fired" && status !== "cancelled") throw invalid("A follow-up is settled as fired or cancelled.");
  const patch = status === "fired" ? { status, fired_at: now() } : { status };
  return updateRow("followups", businessId, followupId, patch, { status: "scheduled" });
}

/* ----------------------------------------------------------- audit log --- */

function appendAudit(businessId, { session_id, actor, type, detail }) {
  const ts = now();
  const { lastInsertRowid } = db
    .prepare("INSERT INTO audit_log (business_id, session_id, ts, actor, type, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .run(tenant(businessId), session_id ?? null, ts, actor, requireText(type, "type"), JSON.stringify(detail ?? {}));
  return { id: Number(lastInsertRowid), business_id: businessId, session_id: session_id ?? null, ts, actor, type, detail: detail ?? {} };
}

/** Audit rows in the order they were written; `after_id` resumes a stream. */
function listAudit(businessId, { after_id = 0, type, newest_first = false, limit = 200 } = {}) {
  const where = ["business_id = ?", "id > ?"];
  const params = [tenant(businessId), number(after_id, "after_id", { optional: false, integer: true })];
  if (type !== undefined) {
    where.push("type = ?");
    params.push(type);
  }
  params.push(number(limit, "limit", { positive: true, optional: false, integer: true }));
  return db
    .prepare(`SELECT * FROM audit_log WHERE ${where.join(" AND ")} ORDER BY id ${newest_first ? "DESC" : "ASC"} LIMIT ?`)
    .all(...params)
    .map((row) => hydrate("audit_log", row));
}

/* ------------------------------------------------------------ telegram --- */

function setTelegramLink(businessId, chatId) {
  db.prepare(
    "INSERT INTO telegram_links (business_id, chat_id, linked_at) VALUES (?, ?, ?) " +
      "ON CONFLICT (business_id) DO UPDATE SET chat_id = excluded.chat_id, linked_at = excluded.linked_at",
  ).run(tenant(businessId), requireText(String(chatId ?? ""), "chat_id"), now());
  return getTelegramLink(businessId);
}

function getTelegramLink(businessId) {
  const row = db.prepare("SELECT * FROM telegram_links WHERE business_id = ?").get(tenant(businessId));
  return row ? { ...row } : null;
}

function removeTelegramLink(businessId) {
  return db.prepare("DELETE FROM telegram_links WHERE business_id = ?").run(tenant(businessId)).changes === 1;
}

function createLinkCode(businessId, { code, expires_at }) {
  insertRow("link_codes", { code: requireText(code, "code"), business_id: tenant(businessId), expires_at: requireText(expires_at, "expires_at") });
}

/* --------------------------------------------------------------- agent --- */

/** The stored profile row, or null when the business still has the defaults. */
function getAgentProfile(businessId) {
  const row = db.prepare("SELECT * FROM agent_profiles WHERE business_id = ?").get(tenant(businessId));
  return row ? { ...row } : null;
}

function saveAgentProfile(businessId, { voice_speed, bargain_style }) {
  db.prepare(
    "INSERT INTO agent_profiles (business_id, voice_speed, bargain_style, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (business_id) DO UPDATE SET voice_speed = excluded.voice_speed, bargain_style = excluded.bargain_style, updated_at = excluded.updated_at",
  ).run(tenant(businessId), voice_speed, bargain_style, now());
  return getAgentProfile(businessId);
}

/** Rule rows keep `params` as JSON text; callers get it parsed. */
const hydrateRule = (row) => (row ? { ...row, params: JSON.parse(row.params) } : null);

/** Insert a suggested rule. Sentences and params are built and checked by src/agent/rules.js. */
function createRule(businessId, { kind, scope_key, params, sentence, why, source }) {
  const id = newId("rul");
  insertRow("agent_rules", {
    id,
    business_id: tenant(businessId),
    kind,
    scope_key: requireText(scope_key, "scope_key"),
    params: JSON.stringify(params),
    sentence_hi: requireText(sentence["hi-IN"], "sentence"),
    sentence_kn: requireText(sentence["kn-IN"], "sentence"),
    sentence_en: requireText(sentence["en-IN"], "sentence"),
    why_hi: why?.["hi-IN"] ?? null,
    why_kn: why?.["kn-IN"] ?? null,
    why_en: why?.["en-IN"] ?? null,
    status: "suggested",
    source,
    created_at: now(),
  });
  return getRule(businessId, id);
}

function getRule(businessId, ruleId) {
  if (typeof ruleId !== "string" || ruleId === "") return null;
  return hydrateRule(db.prepare("SELECT * FROM agent_rules WHERE business_id = ? AND id = ?").get(tenant(businessId), ruleId));
}

/** Oldest first; narrowed by status, kind or scope. */
function listRules(businessId, { status, kind, scope_key } = {}, { limit = 500 } = {}) {
  const where = ["business_id = ?"];
  const params = [tenant(businessId)];
  for (const [column, value] of Object.entries({ status, kind, scope_key })) {
    if (value === undefined) continue;
    where.push(`${column} = ?`);
    params.push(value);
  }
  params.push(number(limit, "limit", { positive: true, optional: false, integer: true }));
  return db
    .prepare(`SELECT * FROM agent_rules WHERE ${where.join(" AND ")} ORDER BY created_at, rowid LIMIT ?`)
    .all(...params)
    .map(hydrateRule);
}

/** Move a rule from one status to another. Returns false when it was not in `from`. */
function transitionRule(businessId, ruleId, from, to, { decided_via = null } = {}) {
  return (
    db
      .prepare("UPDATE agent_rules SET status = ?, decided_via = COALESCE(?, decided_via), decided_at = ? WHERE business_id = ? AND id = ? AND status = ?")
      .run(to, decided_via, now(), tenant(businessId), ruleId, from).changes === 1
  );
}

/** Record that the server spoke this rule's sentence into the call of `agent_id` (suggested rules only). */
function recordRuleReadback(businessId, ruleId, { agent_id, spoken_text }) {
  const id = newId("rrb");
  insertRow("rule_readbacks", {
    id,
    business_id: tenant(businessId),
    rule_id: requireText(ruleId, "rule_id"),
    agent_id: requireText(agent_id, "agent_id"),
    spoken_text: requireText(spoken_text, "spoken_text"),
    spoken_at: now(),
  });
  return { ...db.prepare("SELECT * FROM rule_readbacks WHERE id = ?").get(id) };
}

function listRuleReadbacks(businessId, { rule_id, agent_id } = {}) {
  return listRows("rule_readbacks", businessId, { rule_id, agent_id }, { orderBy: "t.spoken_at, t.rowid" });
}

const hydrateMemory = (row) => (row ? { ...row, data: JSON.parse(row.data) } : null);

function listMemories(businessId) {
  return db
    .prepare("SELECT * FROM agent_memories WHERE business_id = ? ORDER BY kind, key")
    .all(tenant(businessId))
    .map(hydrateMemory);
}

/**
 * Insert or replace the memory of (kind, key). Returns `{ memory, changed }`: `changed` is false
 * when the stored data and sentences were already exactly these.
 */
function saveMemory(businessId, { kind, key, data, sentence }) {
  const row = {
    data: JSON.stringify(data),
    sentence_hi: requireText(sentence["hi-IN"], "sentence"),
    sentence_kn: requireText(sentence["kn-IN"], "sentence"),
    sentence_en: requireText(sentence["en-IN"], "sentence"),
  };
  const existing = db.prepare("SELECT * FROM agent_memories WHERE business_id = ? AND kind = ? AND key = ?").get(tenant(businessId), kind, key);
  if (existing && Object.keys(row).every((column) => existing[column] === row[column])) {
    return { memory: hydrateMemory(existing), changed: false };
  }
  const id = existing?.id ?? newId("mem");
  db.prepare(
    "INSERT INTO agent_memories (id, business_id, kind, key, data, sentence_hi, sentence_kn, sentence_en, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT (business_id, kind, key) DO UPDATE SET data = excluded.data, sentence_hi = excluded.sentence_hi, " +
      "sentence_kn = excluded.sentence_kn, sentence_en = excluded.sentence_en, updated_at = excluded.updated_at",
  ).run(id, businessId, kind, requireText(key, "key"), row.data, row.sentence_hi, row.sentence_kn, row.sentence_en, now());
  return { memory: hydrateMemory(db.prepare("SELECT * FROM agent_memories WHERE id = ?").get(id)), changed: true };
}

function deleteMemory(businessId, memoryId) {
  return db.prepare("DELETE FROM agent_memories WHERE business_id = ? AND id = ?").run(tenant(businessId), memoryId).changes === 1;
}

/**
 * Everything memories are derived from: each order that is not cancelled, with the item, unit and
 * quantity it was for and the vendor and price it was at. Oldest first.
 */
function listOrderFacts(businessId) {
  return db
    .prepare(
      "SELECT o.id AS order_id, o.created_at, o.status, r.item, r.unit, r.quantity, q.unit_price, q.simulated, v.name AS vendor_name " +
        "FROM orders o JOIN quotes q ON q.id = o.quote_id AND q.business_id = o.business_id " +
        "JOIN requirements r ON r.id = q.requirement_id AND r.business_id = o.business_id " +
        "JOIN vendors v ON v.id = q.vendor_id AND v.business_id = o.business_id " +
        "WHERE o.business_id = ? AND o.status <> 'cancelled' ORDER BY o.created_at, o.rowid",
    )
    .all(tenant(businessId))
    .map((row) => ({ ...row, simulated: row.simulated === 1 }));
}

/* ------------------------------------------------------ simulated flag --- */

/**
 * Whether a record that points at any of these ids concerns a simulated vendor
 * or a simulated negotiation. Ids of another business resolve to nothing.
 */
function isSimulated(businessId, { orderId, approvalId, quoteId, negotiationId, vendorId } = {}) {
  const quote =
    getQuote(businessId, quoteId) ??
    getQuote(businessId, getOrder(businessId, orderId)?.quote_id) ??
    getQuote(businessId, getApproval(businessId, approvalId)?.quote_id);
  return Boolean(
    quote?.simulated || getNegotiation(businessId, negotiationId)?.simulated || getVendor(businessId, vendorId)?.simulated,
  );
}

/* -------------------------------------------------------------- system --- */

const system = {
  /** Follow-ups of every business that are due. For the scheduler only. */
  listDueFollowups(nowIso = now()) {
    return db
      .prepare("SELECT t.* FROM followups t WHERE t.status = 'scheduled' AND t.due_at <= ? ORDER BY t.due_at, t.id")
      .all(nowIso)
      .map((row) => hydrate("followups", row));
  },

  /** Jobs that were queued or running when the process last stopped. For restart recovery only. */
  listUnfinishedJobs() {
    return db
      .prepare("SELECT t.* FROM jobs t WHERE t.status IN ('queued', 'running') ORDER BY t.created_at, t.id")
      .all()
      .map((row) => hydrate("jobs", row));
  },

  /**
   * The checkout a pay-page token opens, with nothing else of its business. For the public pay
   * page only: the token (its SHA-256 here) is the payer's whole credential.
   */
  findCheckoutByTokenHash(tokenHash) {
    if (typeof tokenHash !== "string" || tokenHash === "") return null;
    return db.prepare("SELECT t.* FROM payment_checkouts t WHERE t.token_hash = ?").get(tokenHash) ?? null;
  },

  /** Use a one-time link code. Returns the business it was issued for, or null. */
  redeemLinkCode(code, nowIso = now()) {
    return db.transaction(() => {
      db.prepare("DELETE FROM link_codes WHERE expires_at <= ?").run(nowIso);
      const row = db.prepare("DELETE FROM link_codes WHERE code = ? RETURNING business_id").get(String(code ?? ""));
      return row ? row.business_id : null;
    });
  },
};

module.exports = {
  RepoError, SIMULATED_LABEL, newId,
  createBusiness, getBusiness, updateBusiness,
  createSession, getSession, listSessions, updateSession,
  createRequirement, getRequirement, listRequirements, updateRequirement, dismissRequirement,
  createJob, getJob, listJobs, transitionJob, appendJobProgress,
  createVendor, getVendor, listVendors, setVendorScore,
  createNegotiation, getNegotiation, listNegotiations, appendNegotiationTurn, updateNegotiation,
  createQuote, getQuote, listQuotes, setQuoteLandedCost,
  createApproval, getApproval, listApprovals, decideApproval, withdrawApproval,
  recordApprovalReadback, listApprovalReadbacks,
  createOrderFromApproval, getOrder, getOrderDocument, listOrders, updateOrder, transitionOrder,
  createCheckout, getCheckoutForOrder, renewCheckoutToken, markCheckoutPaid,
  createFollowup, getFollowup, listFollowups, settleFollowup,
  appendAudit, listAudit,
  setTelegramLink, getTelegramLink, removeTelegramLink, createLinkCode,
  getAgentProfile, saveAgentProfile,
  createRule, getRule, listRules, transitionRule, recordRuleReadback, listRuleReadbacks,
  listMemories, saveMemory, deleteMemory, listOrderFacts,
  isSimulated,
  system,
};
