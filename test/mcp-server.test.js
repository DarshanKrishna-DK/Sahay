"use strict";

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  MURF_VOICE_HI: "hi-IN-khyati",
  MURF_VOICE_EN: "en-IN-isha",
  MURF_VOICE_KN: "kn-IN-harshitha",
});

const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");

const { createMcpRouter, describe } = require("../src/mcp-server");
const auth = require("../src/auth");
const repo = require("../src/db/repo");

async function withServer(run) {
  const lines = [];
  const app = express();
  app.use("/mcp", createMcpRouter({ log: (entry) => lines.push(JSON.stringify(entry)) }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}/mcp`, lines);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function rpc(url, token, body, method = "POST") {
  return fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

const exp = () => Math.floor(Date.now() / 1000) + 600;

function seed(kind = "owner", { language = "hi-IN", status = "active" } = {}) {
  const businessId = repo.newId("biz");
  repo.createBusiness(businessId, { name: "Asha Kirana", city: "Bengaluru", language });
  const session = repo.createSession(businessId, { kind, channel: "ch-1", agent_id: "AG1", status });
  const token = auth.signSession({ businessId, sessionId: session.id, scope: "mcp", exp: exp() });
  return { businessId, session, token };
}

const toolsList = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

test("no bearer, a browser-scope bearer, a forged bearer, an ended session: 401, logged without the token", async () => {
  const { businessId, session, token } = seed();
  const browser = auth.signSession({ businessId, sessionId: session.id, scope: "browser", exp: exp() });
  const ended = seed("owner", { status: "ended" });
  await withServer(async (url, lines) => {
    for (const bad of [null, browser, `${token.slice(0, -2)}xx`, ended.token, "not-a-token"]) {
      const res = await rpc(url, bad, toolsList);
      assert.equal(res.status, 401, String(bad).slice(0, 10));
      assert.equal(res.headers.get("www-authenticate"), "Bearer");
    }
    assert.ok(lines.every((l) => !l.includes(token) && !l.includes(browser)));
    assert.ok(lines.some((l) => l.includes('"method":"tools/list"') && l.includes('"verified":false')));
  });
});

test("initialize answers with the server info and the tools capability", async () => {
  const { token } = seed();
  await withServer(async (url) => {
    const res = await rpc(url, token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.serverInfo.name, "sahay-tools");
    assert.ok(body.result.capabilities.tools);
    assert.equal(res.headers.get("mcp-session-id"), null, "stateless: no session id");
  });
});

test("tools/list follows the session kind: owner tools for an owner call, negotiation tools for a negotiation", async () => {
  await withServer(async (url) => {
    const owner = await (await rpc(url, seed("owner").token, toolsList)).json();
    const names = owner.result.tools.map((t) => t.name);
    assert.deepEqual(names, require("../src/tools/registry").toolNames("owner"), "every owner tool, the stock and selling ones included");
    assert.ok(names.includes("teach_rule") && names.includes("confirm_rule"));
    assert.ok(names.includes("create_order"));
    assert.ok(!names.includes("record_vendor_offer"));
    for (const tool of owner.result.tools) assert.equal(tool.inputSchema.type, "object");

    const neg = await (await rpc(url, seed("negotiation").token, toolsList)).json();
    assert.deepEqual(neg.result.tools.map((t) => t.name), ["get_negotiation_brief", "record_vendor_offer"]);
  });
});

test("tools/call runs with the tenant from the bearer; arguments cannot choose the business", async () => {
  const a = seed("owner", { language: "en-IN" });
  const b = seed("owner");
  await withServer(async (url, lines) => {
    const res = await rpc(url, a.token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_business_profile", arguments: {} },
    });
    const body = await res.json();
    const result = JSON.parse(body.result.content[0].text);
    assert.equal(result.business.id, a.businessId);
    assert.equal(result.say, "This is the account of Asha Kirana in Bengaluru.");
    assert.ok(lines.some((l) => l.includes('"tool":"get_business_profile"') && l.includes('"verified":true')));

    const sneaky = await (await rpc(url, a.token, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_business_profile", arguments: { businessId: b.businessId } },
    })).json();
    assert.equal(sneaky.result.isError, true);
    assert.equal(JSON.parse(sneaky.result.content[0].text).error, "INVALID_ARGUMENTS");
    // The refused argument is named to the model and in the log (never its value).
    assert.equal(JSON.parse(sneaky.result.content[0].text).fix, "Unknown argument businessId.");
    assert.ok(lines.some((l) => l.includes('"code":"INVALID_ARGUMENTS"') && l.includes('"problem":"Unknown argument businessId."') && !l.includes(b.businessId)));
  });
});

test("a refused tool call is an MCP tool error carrying the spoken line, not a transport error", async () => {
  const { token } = seed("owner", { language: "hi-IN" });
  await withServer(async (url) => {
    const body = await (await rpc(url, token, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "create_order", arguments: { approvalId: "apr_missing" } },
    })).json();
    assert.equal(body.result.isError, true);
    const payload = JSON.parse(body.result.content[0].text);
    assert.equal(payload.error, "APPROVAL_NOT_FOUND");
    assert.equal(payload.say, "यह रिकॉर्ड इस व्यापार में नहीं मिला।");

    const crossScope = await (await rpc(url, token, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "record_vendor_offer", arguments: { price_per_unit: 10 } },
    })).json();
    assert.equal(JSON.parse(crossScope.result.content[0].text).error, "UNKNOWN_TOOL");
  });
});

test("every failed tool call tells the model to speak its say now (never silence); a refused argument says how to fix it", async () => {
  const { token } = seed("owner", { language: "en-IN" });
  await withServer(async (url) => {
    const failed = await (await rpc(url, token, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "create_order", arguments: { approvalId: "apr_missing", reply_language: "en-IN" } } })).json();
    const payload = JSON.parse(failed.result.content[0].text);
    assert.ok(payload.say);
    assert.match(payload.hint, /Say `say` to the owner now/);
    assert.match(payload.hint, /never stay silent/);

    const refused = await (await rpc(url, token, { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "get_business_facts", arguments: { topic: "weather", reply_language: "en-IN" } } })).json();
    const why = JSON.parse(refused.result.content[0].text);
    assert.equal(why.error, "INVALID_ARGUMENTS");
    assert.ok(why.fix);
    assert.match(why.hint, /correct it as `fix` says/);
    assert.ok(why.say);
  });
});

test("GET is 405 for a verified caller (stateless server, no stream)", async () => {
  const { token } = seed();
  await withServer(async (url) => {
    const res = await rpc(url, token, null, "GET");
    assert.equal(res.status, 405);
  });
});

test("describe() reads method and tool names from single and batched messages", () => {
  assert.deepEqual(describe({ method: "tools/call", params: { name: "x" } }), [{ method: "tools/call", tool: "x" }]);
  assert.deepEqual(describe([{ method: "initialize" }, { method: "notifications/initialized" }]), [
    { method: "initialize", tool: null },
    { method: "notifications/initialized", tool: null },
  ]);
  assert.deepEqual(describe(null), []);
});
