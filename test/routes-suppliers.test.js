"use strict";

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  TELEGRAM_BOT_TOKEN: "",
  SAHAY_ACCESS_CODE: "",
});

const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { createApp } = require("../server");
const events = require("../src/events");
const limits = require("../src/limits");
const store = require("../src/db/suppliers");
const { VENDOR_PAGE } = require("../src/routes/api");

beforeEach(() => limits.reset());

async function withApp(run) {
  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    events.closeStreams();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function call(base, method, path, { cookie, body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  return { res, status: res.status, json: type.includes("json") ? await res.json() : null };
}

async function signUp(base, details = { name: "Asha Kirana", city: "Bengaluru", language: "hi-IN" }) {
  const out = await call(base, "POST", "/api/session", { body: details });
  assert.equal(out.status, 200);
  return { cookie: out.res.headers.get("set-cookie").split(";")[0], businessId: out.json.business.id };
}

test("supplier routes need a session and use only the session's business", async () => {
  await withApp(async (base) => {
    assert.equal((await call(base, "GET", "/api/suppliers")).status, 401);
    assert.equal((await call(base, "POST", "/api/suppliers", { body: { name: "Ramesh", items: ["rice"] } })).status, 401);

    const a = await signUp(base);
    const b = await signUp(base, { name: "Bharat Stores", city: "Mysuru", language: "kn-IN" });
    // A business id in the body is ignored: the supplier belongs to the session's business.
    const added = await call(base, "POST", "/api/suppliers", { cookie: a.cookie, body: { name: "Ramesh Traders", items: ["rice", "dal"], business_id: b.businessId } });
    assert.equal(added.status, 201);
    assert.equal(added.json.supplier.name, "Ramesh Traders");
    assert.equal(added.json.supplier.language, "hi-IN", "the business language by default");
    assert.equal(added.json.supplier.linked, false);
    assert.equal(added.json.supplier.ownSupplier, true);
    assert.equal(added.json.supplier.simulated, false);
    assert.equal(added.json.sentToOwner, false, "Telegram is not configured here");
    assert.match(added.json.deepLink, /^https:\/\/t\.me\/sahaymitra_bot\?start=sup_[A-Za-z0-9_-]{16}$/);
    assert.equal(JSON.stringify(added.json).includes("telegram_chat_id"), false);
    assert.equal(store.listSuppliers(a.businessId).length, 1);
    assert.equal(store.listSuppliers(b.businessId).length, 0);

    const listA = await call(base, "GET", "/api/suppliers", { cookie: a.cookie });
    assert.deepEqual(listA.json.suppliers.map((s) => s.name), ["Ramesh Traders"]);
    assert.deepEqual((await call(base, "GET", "/api/suppliers", { cookie: b.cookie })).json.suppliers, []);

    const id = added.json.supplier.id;
    assert.equal((await call(base, "POST", `/api/suppliers/${id}/link-code`, { cookie: b.cookie })).status, 404, "another business cannot make its link");
    assert.equal((await call(base, "DELETE", `/api/suppliers/${id}`, { cookie: b.cookie })).status, 404, "or remove it");
    const fresh = await call(base, "POST", `/api/suppliers/${id}/link-code`, { cookie: a.cookie });
    assert.equal(fresh.status, 200);
    assert.notEqual(fresh.json.code, added.json.deepLink.split("=").pop());

    assert.equal((await call(base, "DELETE", `/api/suppliers/${id}`, { cookie: a.cookie })).json.removed, true);
    assert.deepEqual((await call(base, "GET", "/api/suppliers", { cookie: a.cookie })).json.suppliers, []);
  });
});

test("bad supplier input is a 400 with the reason, not a server error", async () => {
  await withApp(async (base) => {
    const { cookie } = await signUp(base);
    for (const body of [{ items: ["rice"] }, { name: "Ramesh" }, { name: "Ramesh", items: [] }, { name: "Ramesh", items: ["rice"], language: "fr-FR" }, { name: "Ramesh", items: [42] }]) {
      const out = await call(base, "POST", "/api/suppliers", { cookie, body });
      assert.equal(out.status, 400, JSON.stringify(body));
      assert.equal(out.json.code, "INVALID");
    }
  });
});

test("the supplier join page: phone-first, disclosure visible, no inline script; state and End need a live code and its key", async () => {
  assert.match(VENDOR_PAGE, /width=device-width/);
  assert.match(VENDOR_PAGE, /automated assistant/);
  assert.match(VENDOR_PAGE, /\/css\/vendor-join\.css/);
  assert.match(VENDOR_PAGE, /id="mute"/);
  assert.match(VENDOR_PAGE, /id="leave"/);
  assert.match(VENDOR_PAGE, /id="turns"/);
  assert.doesNotMatch(VENDOR_PAGE, /<script>/);
  await withApp(async (base) => {
    const page = await fetch(`${base}/vendor/whatever`);
    assert.equal(page.status, 200);
    const css = await fetch(`${base}/css/vendor-join.css`);
    assert.equal(css.status, 200);
    assert.match(await css.text(), /#0F0D0E/);
    assert.equal((await call(base, "GET", "/api/vendor/not-a-code/state", { headers: { "X-Sahay-Renew-Key": "k" } })).status, 404);
    assert.equal((await call(base, "POST", "/api/vendor/not-a-code/left", { headers: { "X-Sahay-Renew-Key": "k" } })).status, 404);
  });
});
