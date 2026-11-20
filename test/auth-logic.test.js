"use strict";

/**
 * public/js/app/auth-logic.js: the rules behind Sign up and Log in (UI v3, W5). D13 auto-advance
 * at 10 valid digits, PIN steps, text answers checked like the server, PIN_LOCKED minutes from
 * Retry-After, and what each server refusal sends the owner back to.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

// The module is a browser ES module with no imports; node loads its source as a data: URL (the
// package is CommonJS, so a file: import would parse it as a script).
const load = () => import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, "..", "public", "js", "app", "auth-logic.js")).toString("base64")}`);

test("the phone step moves on by itself at 10 valid digits and never on an invalid number (D13)", async () => {
  const L = await load();
  assert.equal(L.padOutcome("phone", "98765"), null);
  assert.equal(L.padOutcome("phone", "9876543210"), "advance");
  assert.equal(L.padOutcome("phone", "1234567890"), "invalid", "Indian mobiles start 6-9");
  assert.equal(L.padOutcome("pin", "123"), null);
  assert.equal(L.padOutcome("pin", "1234"), "advance");
  assert.equal(L.padOutcome("pinEnter", "0000"), "advance");
  assert.equal(L.padOutcome("name", "x"), null, "text steps never auto-advance");
});

test("sign-up asks one thing per screen, the access code only when the server needs it", async () => {
  const L = await load();
  assert.deepEqual(L.signupSteps(), ["lang", "phone", "name", "city", "pin", "pin2"]);
  assert.deepEqual(L.signupSteps({ accessCodeRequired: true }).slice(-1), ["code"]);
  assert.deepEqual(L.loginSteps(), ["phone", "pinEnter"]);
  assert.ok(L.isPadStep("pin2") && !L.isPadStep("city"));
  assert.ok(L.isTextStep("city") && !L.isTextStep("lang"));
});

test("shop name and city follow the server's character rule; native script is fine", async () => {
  const L = await load();
  assert.equal(L.textProblem("name", "  "), "err.nameEmpty");
  assert.equal(L.textProblem("city", ""), "err.cityEmpty");
  assert.equal(L.textProblem("name", "लक्ष्मी किराना"), null);
  assert.equal(L.textProblem("name", "ಶ್ರೀ ಸ್ಟೋರ್ಸ್"), null);
  assert.equal(L.textProblem("name", "Shop <b>"), "err.chars");
  assert.equal(L.textProblem("name", "a".repeat(81)), "err.long");
  assert.equal(L.textProblem("code", ""), "err.codeEmpty");
  assert.equal(L.textProblem("code", "x"), null);
});

test("a PIN lock shows whole minutes from Retry-After, at least one", async () => {
  const L = await load();
  assert.equal(L.retryAfterSeconds("900"), 900);
  assert.equal(L.retryAfterSeconds(null), null);
  assert.equal(L.retryAfterSeconds(new Date(Date.UTC(2026, 0, 1, 0, 10)).toUTCString(), Date.UTC(2026, 0, 1, 0, 0)), 600);
  assert.equal(L.lockMinutes(900), 15);
  assert.equal(L.lockMinutes(3600), 60);
  assert.equal(L.lockMinutes(5), 1);
  assert.equal(L.lockMinutes(0), null);
  assert.deepEqual(L.loginRefusal({ status: 429, code: "PIN_LOCKED", retryAfterSeconds: 3540 }), { kind: "locked", minutes: 59 });
  assert.deepEqual(L.loginRefusal({ status: 401, code: "WRONG_PIN" }), { kind: "wrong" });
  assert.equal(L.loginRefusal({ status: 0 }).key, "err.network");
  assert.equal(L.loginRefusal({ status: 404 }).kind, "noAccounts");
});

test("a refused sign-up sends the owner back to the step that needs fixing", async () => {
  const L = await load();
  assert.deepEqual(L.signupRefusal({ code: "INVALID_PHONE", status: 400 }), { kind: "field", step: 1, key: "auth.badPhone" });
  assert.equal(L.signupRefusal({ code: "INVALID_PIN", status: 400 }).step, 4);
  assert.equal(L.signupRefusal({ code: "INVALID_PIN", status: 400 }).clearPin, true);
  const code = L.signupRefusal({ code: "ACCESS_CODE_REQUIRED", status: 403 });
  assert.equal(code.step, 6);
  assert.equal(code.needsCode, true);
  assert.deepEqual(L.signupRefusal({ code: "PHONE_TAKEN", status: 409 }), { kind: "form", action: "login", key: "err.save" });
  assert.equal(L.signupRefusal({ status: 404 }).kind, "noAccounts");
  assert.equal(L.signupRefusal({ status: 500 }).kind, "form");
});

test("the first screen: chooser on a fresh device, Log in where an account was used, the hash wins", async () => {
  const L = await load();
  assert.equal(L.startMode("", false), "choose");
  assert.equal(L.startMode("", true), "login");
  assert.equal(L.startMode("#/signup", true), "signup");
  assert.equal(L.startMode("#/login", false), "login");
});

test("phone numbers read in two groups with +91", async () => {
  const L = await load();
  assert.equal(L.fmtPhone("9876543210"), "98765 43210");
  assert.equal(L.phoneLine("+919876543210"), "+91 98765 43210");
  assert.equal(L.phoneLine("9876543210"), "+91 98765 43210");
});
