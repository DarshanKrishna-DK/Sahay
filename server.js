"use strict";

/**
 * Sahay server boot: check config (fail loudly), open the database, mount the
 * routes (browser REST + SSE, MCP, vendor join page, static console), start the
 * narrator, the follow-up scheduler and the Telegram link listener. On SIGINT or
 * SIGTERM every running agent is stopped before the process exits.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { config, missingKeys } = require("./src/config");

const PUBLIC_DIR = path.join(__dirname, "public");

/**
 * The landing page's motion libraries: GSAP 3.13.0 core + ScrollTrigger and Lenis 1.3.27, exact
 * jsDelivr files. Each sha384 was computed from the downloaded file (openssl dgst -sha384 -binary).
 * public/index.html carries the same values in its integrity attributes (test/server.test.js).
 */
const LANDING_SCRIPTS = {
  "https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js": "sha384-HOvlOYPIs/zjoIkWUGXkVmXsjr8GuZLV+Q+rcPwmJOVZVpvTSXQChiN4t9Euv9Vc",
  "https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollTrigger.min.js": "sha384-P8VzCVnT9NBUkMrpcIZrJbA7EBjJvh/fJS6PmP+4nLIM284DtsImIv8D0fFjIkeh",
  "https://cdn.jsdelivr.net/npm/lenis@1.3.27/dist/lenis.min.js": "sha384-R18XzqnxvVLEF+BYfhpmDx30v7eP83fAckyfoRzK7/Uf6nGqufcmsk0eAKo7S3RU",
};

/**
 * Third-party scripts, each an exact pinned file that the page also checks with Subresource
 * Integrity (public/js/voice.js, the import map in public/app.html, the vendor page, and the
 * landing page's <script> tags in public/index.html).
 */
const CDN_SCRIPTS = [
  "https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.24.3/AgoraRTC_N-production.js",
  "https://cdn.jsdelivr.net/npm/agora-rtm@2.2.3/agora-rtm.js",
  "https://cdn.jsdelivr.net/npm/agora-agent-client-toolkit@2.10.0/dist/index.mjs",
  ...Object.keys(LANDING_SCRIPTS),
];

/** HTML pages whose inline scripts (import maps) the CSP allows by hash. Missing files are skipped. */
const HTML_PAGES = ["index.html", "app.html"];

/**
 * 'sha256-...' sources for the inline <script> blocks of an HTML file (the app's import map).
 * The HTML parser turns CRLF and CR into LF before the browser hashes a script, so this does too.
 */
function inlineScriptHashes(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => {
    const body = m[1].replace(/\r\n?/g, "\n");
    return `'sha256-${crypto.createHash("sha256").update(body, "utf8").digest("base64")}'`;
  });
}

/**
 * Content-Security-Policy for every response (security review r1 #11).
 * - script-src: our files, the pinned CDN files, the app's import map by hash, and
 *   'wasm-unsafe-eval' because the Agora RTM SDK instantiates WebAssembly.
 *   No 'unsafe-eval' (E2E r4: 2 CSP reports from agora-rtm@2.2.3/agora-rtm.js). The bundle's only
 *   eval is protobufjs's @protobufjs/inquire, `eval("quire".replace(/^/,"re"))(name)`, called twice:
 *   inquire("buffer") and inquire("long"). It looks for Node's require, runs inside try/catch and
 *   returns null when blocked; protobufjs then uses Uint8Array and its own LongBits. So the two
 *   reports are expected and harmless; nothing in RTM depends on eval in a browser.
 * - worker-src blob:: the RTC and RTM SDKs start workers from blob: URLs.
 * - connect-src https: wss:: Agora's RTC/RTM gateways, edge and log hosts are many and not one
 *   documented list we could verify, so any TLS origin is allowed for connections (never for scripts).
 * - style-src 'unsafe-inline': the console sets a few style attributes and the vendor page has a
 *   <style> block; fonts come from Google Fonts.
 */
function contentSecurityPolicy(publicDir = PUBLIC_DIR) {
  const hashes = new Set();
  for (const page of HTML_PAGES) {
    const file = path.join(publicDir, page);
    if (fs.existsSync(file)) for (const h of inlineScriptHashes(fs.readFileSync(file, "utf8"))) hashes.add(h);
  }
  return [
    "default-src 'self'",
    `script-src 'self' ${CDN_SCRIPTS.join(" ")}${hashes.size ? ` ${[...hashes].join(" ")}` : ""} 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    "connect-src 'self' https: wss: data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Content-Security-Policy of the pay page (/pay/<token>, public/pay.html) only: Razorpay Standard
 * Checkout. checkout.js comes from https://checkout.razorpay.com/v1/checkout.js (Razorpay docs,
 * Standard Checkout integration steps) and opens the payment form in an iframe served by
 * api.razorpay.com. Razorpay publishes no CSP list, so the other origins below are the ones
 * Checkout was seen to need in a real browser (docs/build/evidence/pay-csp-check.txt): every
 * one is a razorpay.com host, and only Sahay's own files and Razorpay's script may run.
 * cdn.razorpay.com is Razorpay's own static CDN: checkout.js loads its risk-detection script
 * from https://cdn.razorpay.com/static/cx/razorpay-risk-detection/bundle.js (blocked in the
 * E2E run of 2026-11-19), so it is allowed for scripts only.
 */
const PAY_CSP = [
  "default-src 'self'",
  "script-src 'self' https://checkout.razorpay.com https://cdn.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self' https://api.razorpay.com",
  "frame-ancestors 'none'",
].join("; ");

const isPayPage = (req) => req.method === "GET" && req.path.startsWith("/pay/");

/** Basic security headers without a dependency. The CSP is built once (createApp refreshes it). */
function securityHeaders(req, res, next) {
  securityHeaders.csp ??= contentSecurityPolicy();
  const pay = isPayPage(req);
  res.set({
    "Content-Security-Policy": pay ? PAY_CSP : securityHeaders.csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    // Checkout may open a bank or 3-D Secure window that must be able to report back.
    "Cross-Origin-Opener-Policy": pay ? "same-origin-allow-popups" : "same-origin",
    "Permissions-Policy": pay ? "microphone=(), camera=(), geolocation=(), payment=(self \"https://api.razorpay.com\")" : "microphone=(self), camera=(), geolocation=()",
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=15552000");
  next();
}

/**
 * `publicDir` is only for tests (a scratch folder with its own pages); the server uses public/.
 * Routes: `/` is the landing page (public/index.html, served by express.static), `/app` the app.
 */
function createApp({ publicDir = PUBLIC_DIR } = {}) {
  const { createApiRouter, createVendorRouter, createPayRouter, errorHandler } = require("./src/routes/api");
  const { createMcpRouter } = require("./src/mcp-server");
  const app = express();
  securityHeaders.csp = contentSecurityPolicy(publicDir);
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback"); // cloudflared runs on this machine and sets X-Forwarded-*
  app.use(securityHeaders);

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/mcp", createMcpRouter());
  app.use(require("./src/routes/auth").createAuthRouter()); // before /vendor/:code and the api router's requireSession
  app.use(createVendorRouter());
  app.use(require("./src/routes/sell").createSellRouter()); // SELL: /api/sell, /api/invoices/*, invoice pay tokens (before the purchase pay router)
  app.use(createPayRouter());
  app.use(require("./src/routes/stock").createStockRouter()); // STK: /api/stock, delivered, reorder decision
  app.use(require("./src/routes/khata").createKhataRouter()); // KHATA: POST /api/receipts, /api/customers/:id/remind
  app.use(require("./src/routes/suppliers").createSupplierRouter()); // SUPPLIERS: the owner's own suppliers, reached on Telegram
  app.use(createApiRouter());
  app.use("/api", (_req, res) => res.status(404).json({ code: "NOT_FOUND", message: "No such API route." }));
  const sendApp = (_req, res, next) => res.sendFile(path.join(publicDir, "app.html"), { maxAge: "5m" }, (err) => err && next(err.status === 404 ? undefined : err));
  app.get(["/app", "/app/"], sendApp);
  app.use(express.static(publicDir, { index: "index.html", maxAge: "5m" }));
  app.use(errorHandler);
  return app;
}

function boot() {
  const missing = missingKeys();
  if (missing.length) {
    console.error(`[sahay] cannot start: missing environment variables: ${missing.join(", ")}. See .env.example.`);
    process.exit(1);
  }
  if (!/^https:\/\//.test(config.publicUrl)) {
    console.warn("[sahay] PUBLIC_URL is not https: Agora cannot reach /mcp, so voice calls will refuse to start.");
  }

  require("./src/db").getDb();
  const stale = endStaleSessions();
  if (stale.ended) {
    console.warn(`[sahay] ended ${stale.ended} session(s) a previous run left open; stopping ${stale.agentIds.length} agent(s).`);
    const agent = require("./src/agora/agent");
    Promise.allSettled(stale.agentIds.map((id) => agent.stopAgent(id))).then((results) => {
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed) console.warn(`[sahay] ${failed} leftover agent(s) did not answer /leave; their idle timeout ends them.`);
    });
  }
  const jobs = require("./src/jobs");
  const failed = jobs.failInterruptedJobs();
  if (failed) console.warn(`[sahay] marked ${failed} interrupted job(s) as failed.`);
  require("./src/approvals").startExpiry(); // a deal waiting for a yes that no longer stands leaves Needs-you

  const narrator = require("./src/agora/narrator");
  const followups = require("./src/followups");
  const telegram = require("./src/notify/telegram");
  const negotiation = require("./src/negotiation/session");
  const { stopAllVoice } = require("./src/routes/api");
  const events = require("./src/events");

  const stopNarrator = narrator.start();
  require("./src/agora/answer-watch").start(); // an owner turn left unanswered gets a spoken line from the server
  const stopFollowups = followups.start();
  const stopLearning = require("./src/agent").start(); // learned rule suggestions and memories
  require("./src/stock/reorder").start(); // STK: low-stock watcher (asks the owner; never buys)
  const stopSuppliers = require("./src/suppliers").start(); // SUPPLIERS: order confirmation and no-show notice on Telegram
  const telegramAbort = new AbortController();
  if (telegram.isConfigured()) telegram.startPolling({ signal: telegramAbort.signal });

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(`[sahay] listening on ${config.host}:${config.port}${config.publicUrl ? `, public ${config.publicUrl}` : ""}`);
  });

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    console.log(`[sahay] ${signal}: stopping agents and closing.`);
    const force = setTimeout(() => process.exit(1), 15000);
    force.unref();
    telegramAbort.abort();
    stopFollowups();
    stopLearning();
    stopSuppliers();
    await Promise.allSettled([stopAllVoice(), negotiation.stopAll()]);
    stopNarrator();
    events.closeStreams();
    server.close(() => {
      require("./src/db").close();
      process.exit(0);
    });
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  return server;
}

/**
 * A process that crashed left its sessions open, and an open session keeps its 2 h MCP bearer
 * valid (security review r1 #12). No agent of a previous process is tracked any more, so every
 * session not yet ended is ended now. Returns the agent ids to stop.
 */
function endStaleSessions(now = new Date().toISOString()) {
  const db = require("./src/db").getDb();
  const agentIds = db.prepare("SELECT agent_id FROM sessions WHERE status <> 'ended' AND agent_id IS NOT NULL").all().map((r) => r.agent_id);
  const { changes } = db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE status <> 'ended'").run(now);
  return { ended: Number(changes), agentIds };
}

if (require.main === module) boot();

module.exports = { createApp, securityHeaders, contentSecurityPolicy, inlineScriptHashes, endStaleSessions, CDN_SCRIPTS, LANDING_SCRIPTS, PAY_CSP };
