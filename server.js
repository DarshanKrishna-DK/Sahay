"use strict";

/**
 * Sahay server boot: check config (fail loudly), open the database, mount the
 * routes (browser REST + SSE, MCP, vendor join page, static console), start the
 * narrator, the follow-up scheduler and the Telegram link listener. On SIGINT or
 * SIGTERM every running agent is stopped before the process exits.
 */

const path = require("node:path");
const express = require("express");
const { config, missingKeys } = require("./src/config");

/** Basic security headers without a dependency. */
function securityHeaders(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "microphone=(self), camera=(), geolocation=()",
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=15552000");
  next();
}

function createApp() {
  const { createApiRouter, createVendorRouter, errorHandler } = require("./src/routes/api");
  const { createMcpRouter } = require("./src/mcp-server");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback"); // cloudflared runs on this machine and sets X-Forwarded-*
  app.use(securityHeaders);

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/mcp", createMcpRouter());
  app.use(createVendorRouter());
  app.use(createApiRouter());
  app.use("/api", (_req, res) => res.status(404).json({ code: "NOT_FOUND", message: "No such API route." }));
  app.use(express.static(path.join(__dirname, "public"), { index: "index.html", maxAge: "5m" }));
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
  const jobs = require("./src/jobs");
  const failed = jobs.failInterruptedJobs();
  if (failed) console.warn(`[sahay] marked ${failed} interrupted job(s) as failed.`);

  const narrator = require("./src/agora/narrator");
  const followups = require("./src/followups");
  const telegram = require("./src/notify/telegram");
  const negotiation = require("./src/negotiation/session");
  const { stopAllVoice } = require("./src/routes/api");
  const events = require("./src/events");

  const stopNarrator = narrator.start();
  const stopFollowups = followups.start();
  const telegramAbort = new AbortController();
  if (telegram.isConfigured()) telegram.startPolling({ signal: telegramAbort.signal });

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[sahay] listening on ${config.port}${config.publicUrl ? `, public ${config.publicUrl}` : ""}`);
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

if (require.main === module) boot();

module.exports = { createApp, securityHeaders };
