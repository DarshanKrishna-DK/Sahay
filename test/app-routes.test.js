"use strict";

/**
 * public/js/app/routes.js: the v5 app's destinations and the old links that still land on them.
 * Loaded as is (no DOM, no imports).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const load = () => import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(ROOT, "public/js/app/routes.js"), "utf8"))}`);

test("five tabs plus My Sahay; Home is the default", async () => {
  const { parseRoute, TABS } = await load();
  assert.deepEqual(TABS, ["home", "buy", "sell", "stock", "money"]);
  assert.deepEqual(parseRoute(""), { id: "home", sub: null, canonical: "#/home" });
  for (const id of ["home", "buy", "sell", "stock", "money", "me", "needs", "signup", "login"]) assert.equal(parseRoute(`#/${id}`).id, id);
  assert.equal(parseRoute("#/nowhere").id, "home");
});

test("old links still land: talk and sahay are Home, work and orders are Buy, history is My Sahay, waiting is Needs you", async () => {
  const { parseRoute } = await load();
  assert.equal(parseRoute("#/talk").id, "home");
  assert.equal(parseRoute("#/sahay").id, "home");
  assert.equal(parseRoute("#/work").id, "buy");
  assert.equal(parseRoute("#/orders").id, "buy");
  assert.deepEqual(parseRoute("#/history"), { id: "me", sub: "history", canonical: "#/me/history" });
  assert.equal(parseRoute("#/waiting").id, "needs");
  for (const sub of ["teach", "voice", "shop", "history"]) assert.equal(parseRoute(`#/me/${sub}`).sub, sub);
  assert.equal(parseRoute("#/me/elsewhere").sub, null);
});
