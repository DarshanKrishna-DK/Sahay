"use strict";

/**
 * Procurement path end to end WITHOUT voice (no Agora minutes, no Murf):
 *   need -> real IndiaMART discovery (one live fetch run) -> shortlist -> negotiation with a
 *   simulated vendor (loop mode) -> quote -> approval refused without the owner's yes ->
 *   owner's yes (the Yes-card button path) -> order with PO -> what the agent can now say.
 *
 * Every step goes through the same tool registry the voice agent calls over MCP, with an owner
 * ctx resolved here (as the MCP bearer would). Agora's REST boundary is replaced by an in-process
 * fake (agent.setFetch) so the negotiation's /join and /speak cost nothing; IndiaMART and Groq (slug
 * mapping) are real. In-memory database; Telegram and Razorpay are off. Prints a transcript to
 * stdout; never prints a key.
 *
 *   node scripts/brain-e2e.js "basmati rice" 200 kg Bengaluru > evidence.txt
 *   node scripts/brain-e2e.js --fixture     (offline: IndiaMART answered from the recorded page in
 *                                            test/fixtures, Groq off; used by test/brain-e2e.test.js)
 */

Object.assign(process.env, {
  DB_FILE: ":memory:",
  TELEGRAM_BOT_TOKEN: "",
  RAZORPAY_KEY_ID: "",
  RAZORPAY_KEY_SECRET: "",
  PUBLIC_URL: process.env.PUBLIC_URL || "https://sahay.invalid",
  NEGOTIATION_MODE: "loop",
});

const fixture = process.argv.includes("--fixture");
const [item = "basmati rice", quantityText = "200", unit = "kg", city = "Bengaluru"] = process.argv.slice(2).filter((a) => a !== "--fixture");
if (fixture) {
  process.env.GROQ_API_KEY = "";
  // Agora is faked, so a voice is only an id here (the negotiation needs one per language).
  for (const [name, id] of [["MURF_VOICE_HI", "hi-IN-khyati"], ["MURF_VOICE_EN", "en-IN-anisha"], ["MURF_VOICE_KN", "kn-IN-harshitha"]]) process.env[name] ||= id;
  process.env.MURF_API_KEY ||= "fixture-not-a-key";
  const page = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "test", "fixtures", "indiamart-bengaluru-basmati-rice.html"), "utf8");
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://dir.indiamart.com/bengaluru/basmati-rice.html")) {
      const res = new Response(page, { status: 200 });
      Object.defineProperty(res, "url", { value: String(url) });
      return res;
    }
    return new Response("not found", { status: 404 });
  };
}

const repo = require("../src/db/repo");
const registry = require("../src/tools/registry");
const agent = require("../src/agora/agent");
const approvals = require("../src/approvals");
const orders = require("../src/orders");
const jobs = require("../src/jobs");
const session = require("../src/negotiation/session");

const started = Date.now();
const log = (step, value) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)} s] ${step}${value === undefined ? "" : `: ${typeof value === "string" ? value : JSON.stringify(value)}`}`);

/** Agora's REST boundary, in process: /join gives an agent id, /speak and /leave answer 200, /history is empty. */
let agents = 0;
const fakeAgoraCalls = [];
agent.setFetch(async (url, init) => {
  const path = String(url).replace(/^.*\/projects\/[^/]+/, "");
  fakeAgoraCalls.push(`${init?.method ?? "GET"} ${path.replace(/agents\/[^/]+/, "agents/<id>")}`);
  let json = {};
  if (path.endsWith("/join")) json = { agent_id: `FAKE_AGENT_${++agents}`, create_ts: Date.now(), status: "RUNNING" };
  else if (path.endsWith("/history")) json = { contents: [] };
  else json = { agent_id: "FAKE" };
  return new Response(JSON.stringify(json), { status: 200 });
});
agent.configureSpeechPacing({ msPerChar: 1, minLineMs: 5, maxWaitMs: 50 });
session.configureTiming({ msPerChar: 1, minLineMs: 5, pollMs: 50 });

async function waitForJob(ctx, jobId, maxMs) {
  const until = Date.now() + maxMs;
  for (;;) {
    const job = repo.getJob(ctx.businessId, jobId);
    if (!["queued", "running"].includes(job.status)) return job;
    if (Date.now() > until) return job;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function tool(ctx, name, args) {
  try {
    const out = await registry.callTool(ctx, name, { reply_language: "en-IN", ...args });
    log(`tool ${name} -> say`, out.say);
    return out;
  } catch (err) {
    log(`tool ${name} -> REFUSED ${err.code}`, err.say);
    return { error: err };
  }
}

async function main() {
  const businessId = repo.newId("biz");
  repo.createBusiness(businessId, { name: "E2E Kirana", owner_name: "Owner", city, state: "Karnataka", language: "en-IN" });
  const ctx = { businessId, sessionId: null, agentId: null, actor: "agent", toolScope: registry.SCOPES.owner };
  log("business", { businessId, city, discovery: fixture ? "recorded IndiaMART page (offline)" : "live IndiaMART" });

  // 1. Need
  const need = await tool(ctx, "save_requirement", { item, quantity: Number(quantityText), unit, city, owner_words: `I need ${quantityText} ${unit} of ${item} in ${city}` });
  if (!need.requirementId) throw new Error("save_requirement did not save the need");
  log("requirement", { id: need.requirementId, missing: need.missing, sourcingStarted: need.sourcingStarted ?? false });

  // 2. Discovery: one real IndiaMART run
  let sourcingJobId = need.jobId;
  if (!sourcingJobId) {
    const s = await tool(ctx, "start_sourcing", {});
    sourcingJobId = s.jobId;
  }
  const sourcing = await waitForJob(ctx, sourcingJobId, 90000);
  log("sourcing job", { status: sourcing.status, error: sourcing.error ?? null, progress: sourcing.progress?.message ?? null });
  const vendors = repo.listVendors(businessId, { requirement_id: need.requirementId });
  log("IndiaMART listings stored", vendors.length);
  for (const v of vendors.slice(0, 5)) log("  vendor", { name: v.name, city: v.city, price: v.listed_price_text, score: v.score, source: v.source, url: v.source_url });
  if (sourcing.status !== "done" || !vendors.length) {
    log("RESULT", "discovery did not return listings; stopping (no fallback data)");
    return 1;
  }

  // 3. Shortlist
  const shortlist = await tool(ctx, "get_shortlist", {});
  log("shortlist", (shortlist.vendors ?? []).map((v) => `${v.rank}. ${v.name} ${v.listedPrice ?? ""}`));

  // 4. Negotiation with a simulated vendor (loop mode; Agora boundary faked)
  const neg = await tool(ctx, "start_negotiation", {});
  if (!neg.jobId) {
    log("RESULT", "negotiation did not start");
    return 1;
  }
  const negotiation = await waitForJob(ctx, neg.jobId, 120000);
  log("negotiation job", { status: negotiation.status, error: negotiation.error ?? null, ceiling: negotiation.input?.ceiling ?? null });
  for (const n of repo.listNegotiations(businessId, { requirement_id: need.requirementId })) {
    for (const turn of n.transcript ?? []) log(`  ${turn.speaker}${turn.speaker === "vendor" ? " (simulated vendor)" : ""}`, `${turn.text}${turn.offer != null ? `  [offer ${turn.offer}]` : ""}`);
    log("negotiation outcome", n.outcome);
  }

  // 5. Quote and ranked deals
  const quotes = repo.listQuotes(businessId, { requirement_id: need.requirementId });
  log("quotes", quotes.map((q) => ({ unit_price: q.unit_price, unit: q.unit, landed_cost: q.landed_cost, simulated: q.simulated })));
  await tool(ctx, "get_ranked_deals", {});
  if (!quotes.length) {
    log("RESULT", "no quote; stopping");
    return 1;
  }

  // 6. Approval gate: no order without the owner's explicit yes
  await tool(ctx, "create_order", {}); // must be refused: nothing approved
  const asked = await tool(ctx, "request_approval", {});
  log("approval requested", { approvalId: asked.approvalId, readback: asked.readback });
  await tool(ctx, "confirm_approval", { decision: "approve" }); // off a call there is no spoken yes: refused
  await tool(ctx, "create_order", {}); // still refused
  const pending = repo.listApprovals(businessId, { status: "pending" });
  log("approvals pending after the refusals", pending.length);

  // 7. The owner's yes on the Yes card (POST /api/approvals/:id/decision does exactly this)
  const decided = approvals.confirmApproval(businessId, asked.approvalId, { decision: "approve", via: "button" });
  log("owner yes (button)", { status: decided.status ?? decided.approval?.status, decided_via: "button" });
  const order = await orders.createOrder(businessId, asked.approvalId);
  log("order created", { po: order.po_number ?? order.poNumber, status: order.status, amount: order.amount, simulated: order.simulated ?? null, pdf: Boolean(order.pdf_path ?? order.pdfPath) });
  await tool(ctx, "create_order", {}); // asked again: the order just placed is named, no second order is made
  log("orders for this deal", repo.listOrders(businessId).length);

  // 8. What the agent can say now (business knowledge)
  await tool(ctx, "get_order_status", {});
  await tool(ctx, "get_business_facts", { topic: "suppliers" });
  await tool(ctx, "get_business_facts", { topic: "overview" });
  const audit = repo.listAudit(businessId, { limit: 500 });
  log("audit rows", audit.length);
  log("audit approval/order rows", audit.filter((a) => /^(approval|order)\./.test(a.type)).map((a) => ({ type: a.type, actor: a.actor, via: a.detail?.via ?? null, simulated: a.detail?.simulated ?? null })));
  log("fake Agora calls", fakeAgoraCalls.reduce((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {}));
  log("RESULT", "need -> discovery -> shortlist -> negotiation -> quote -> approval gate -> owner yes -> order: complete");
  return 0;
}

main()
  .then((code) => {
    session.stopAll?.().catch?.(() => {});
    jobs.stopAll?.();
    process.exit(code);
  })
  .catch((err) => {
    log("FAILED", `${err.code ?? err.name}: ${err.message}`);
    process.exit(1);
  });
