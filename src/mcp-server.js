"use strict";

/**
 * Sahay's MCP server: stateless streamable HTTP on POST /mcp, JSON responses.
 * Shape verified live in spike S0 (agora-findings.md section 8): Agora's MCP
 * client posts initialize, notifications/initialized, tools/list, tools/call,
 * each with the bearer from llm.mcp_servers[].headers; no Mcp-Session-Id needed.
 *
 * The bearer is a session Sahay signed (auth scope "mcp"). The tenant, the
 * session and the tool scope come only from it: the sessions row kind ("owner"
 * or "negotiation") decides which tools are listed and callable, and the row's
 * agent_id becomes ctx.agentId. Logs carry the method, the tool name and whether
 * the bearer verified - never the token or the arguments.
 */

const express = require("express");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const auth = require("./auth");
const repo = require("./db/repo");
const registry = require("./tools/registry");

const SERVER_INFO = { name: "sahay-tools", version: "2.0.0" };
const BEARER = /^Bearer ([A-Za-z0-9._-]+)$/;

function defaultLog(entry) {
  console.log(`[mcp] ${JSON.stringify(entry)}`);
}

/** JSON-RPC method and tool name of each message, for the log. */
function describe(body) {
  const messages = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
  return messages.map((m) => ({
    method: typeof m?.method === "string" ? m.method : null,
    tool: m?.method === "tools/call" && typeof m?.params?.name === "string" ? m.params.name : null,
  }));
}

/**
 * Verify the bearer and resolve ctx. Returns null when the request is not allowed.
 * A bearer whose sessions row has ended is refused: the agent is gone.
 */
function resolveContext(header) {
  const match = BEARER.exec(String(header ?? ""));
  if (!match) return null;
  let claims;
  try {
    claims = auth.verifySession(match[1], { scope: "mcp" });
  } catch {
    return null;
  }
  const session = repo.getSession(claims.businessId, claims.sessionId);
  if (!session || session.status === "ended" || !registry.SCOPES[session.kind]) return null;
  return {
    businessId: claims.businessId,
    sessionId: session.id,
    agentId: session.agent_id ?? null,
    actor: "agent",
    toolScope: registry.SCOPES[session.kind],
  };
}

function textResult(value, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

/** One MCP server per request (stateless), exposing only the tools of ctx.toolScope. */
function buildServer(ctx, log) {
  const server = new Server(SERVER_INFO, { capabilities: { tools: { listChanged: false } } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.toolsFor(ctx.toolScope).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const started = Date.now();
    try {
      const result = await registry.callTool(ctx, name, request.params.arguments ?? {});
      log({ event: "tool_result", tool: name, ok: true, ms: Date.now() - started });
      return textResult(result);
    } catch (err) {
      log({ event: "tool_result", tool: name, ok: false, code: err.code ?? "INTERNAL", ms: Date.now() - started });
      return textResult({ error: err.code ?? "INTERNAL", say: err.say ?? null }, true);
    }
  });
  return server;
}

/**
 * Express router for POST /mcp. GET and DELETE answer 405 (stateless server,
 * no SSE stream); a missing or bad bearer answers 401 before any MCP handling.
 */
function createMcpRouter({ log = defaultLog } = {}) {
  const router = express.Router();
  router.all("/", express.json({ limit: "256kb" }), async (req, res) => {
    const ctx = resolveContext(req.headers.authorization);
    const calls = describe(req.body);
    for (const c of calls.length ? calls : [{ method: null, tool: null }]) {
      log({ event: "request", http: req.method, method: c.method, tool: c.tool, verified: Boolean(ctx) });
    }
    if (!ctx) {
      res.status(401).set("WWW-Authenticate", "Bearer").json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }
    if (req.method !== "POST") {
      res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
      return;
    }
    const server = buildServer(ctx, log);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log({ event: "error", message: err.message });
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });
  return router;
}

module.exports = { createMcpRouter, resolveContext, describe };
