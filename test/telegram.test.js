"use strict";

const { FAKE } = require("./_env");

Object.assign(process.env, {
  DB_FILE: ":memory:",
  TELEGRAM_BOT_TOKEN: FAKE.TELEGRAM_BOT_TOKEN,
});

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const telegram = require("../src/notify/telegram");
const repo = require("../src/db/repo");

/** Fake the Telegram Bot API at the network boundary; records method + parsed body. */
function fakeTelegram(t, reply = () => ({ ok: true, result: { message_id: 7 } })) {
  const calls = [];
  telegram.setFetch(async (url, init) => {
    const method = String(url).split("/").pop();
    assert.ok(String(url).startsWith(`https://api.telegram.org/bot${FAKE.TELEGRAM_BOT_TOKEN}/`));
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method, body });
    const out = reply(method, body);
    return new Response(JSON.stringify(out), { status: out.ok ? 200 : 400 });
  });
  t.after(() => telegram.setFetch(null));
  return calls;
}

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

const startUpdate = (text, chatId = 555, type = "private") => ({ update_id: 1, message: { message_id: 1, text, chat: { id: chatId, type } } });

test("sendToOwner sends nothing when no chat is linked", async (t) => {
  const calls = fakeTelegram(t);
  const out = await telegram.sendToOwner(seedBusiness(), "hello");
  assert.deepEqual(out, { sent: false, reason: "not_linked" });
  assert.equal(calls.length, 0);
});

test("link flow: a one-time code links the chat that sends /start <code>, once", async (t) => {
  const calls = fakeTelegram(t);
  const businessId = seedBusiness("hi-IN");
  const { code, deepLink } = telegram.createLinkCode(businessId);
  assert.equal(deepLink, `https://t.me/sahaymitra_bot?start=${code}`);

  const out = await telegram.handleUpdate(startUpdate(`/start ${code}`));
  assert.deepEqual(out, { handled: true, linked: true, businessId });
  assert.equal(repo.getTelegramLink(businessId).chat_id, "555");
  assert.equal(calls[0].method, "sendMessage");
  assert.equal(calls[0].body.chat_id, 555);
  assert.match(calls[0].body.text, /Asha Kirana/);
  assert.match(calls[0].body.text, /सहाय/);

  // The code is used up: a second chat cannot take over the link.
  const reuse = await telegram.handleUpdate(startUpdate(`/start ${code}`, 999));
  assert.deepEqual(reuse, { handled: true, linked: false });
  assert.equal(repo.getTelegramLink(businessId).chat_id, "555");
});

test("an expired code does not link", async (t) => {
  fakeTelegram(t);
  const businessId = seedBusiness();
  const { code } = telegram.createLinkCode(businessId, { now: Date.now() - 60 * 60 * 1000 });
  const out = await telegram.handleUpdate(startUpdate(`/start ${code}`));
  assert.equal(out.linked, false);
  assert.equal(repo.getTelegramLink(businessId), null);
});

test("the bot ignores everything except a private /start <code>", async (t) => {
  const calls = fakeTelegram(t);
  for (const update of [startUpdate("hello"), startUpdate("/start"), startUpdate("/help"), startUpdate("/start abc", 1, "group"), { update_id: 3 }, { update_id: 4, edited_message: { text: "/start x" } }]) {
    assert.deepEqual(await telegram.handleUpdate(update), { handled: false });
  }
  assert.equal(calls.length, 0, "no replies");
});

test("sendToOwner sends the text, then the document as multipart", async (t) => {
  const calls = fakeTelegram(t);
  const businessId = seedBusiness();
  repo.setTelegramLink(businessId, "777");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sahay-tg-"));
  const pdf = path.join(dir, "SAHAY-2026-0001.pdf");
  fs.writeFileSync(pdf, "%PDF-1.4 test");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const out = await telegram.sendToOwner(businessId, "ऑर्डर पक्का", { documentPath: pdf });
  assert.deepEqual(out, { sent: true, messageId: 7, documentMessageId: 7 });
  assert.deepEqual(calls[0], { method: "sendMessage", body: { chat_id: "777", text: "ऑर्डर पक्का" } });
  assert.equal(calls[1].method, "sendDocument");
  assert.ok(calls[1].body instanceof FormData);
  assert.equal(calls[1].body.get("chat_id"), "777");
  assert.equal(calls[1].body.get("document").name, "SAHAY-2026-0001.pdf");
});

test("a Telegram refusal is a TelegramError without the bot token", async (t) => {
  fakeTelegram(t, () => ({ ok: false, description: "Bad Request: chat not found" }));
  const businessId = seedBusiness();
  repo.setTelegramLink(businessId, "1");
  await assert.rejects(telegram.sendToOwner(businessId, "x"), (err) => {
    assert.equal(err.name, "TelegramError");
    assert.equal(err.code, "REFUSED");
    assert.ok(!err.message.includes(FAKE.TELEGRAM_BOT_TOKEN));
    return true;
  });
});

test("startPolling asks only for messages, advances the offset, and stops on abort", async (t) => {
  const businessId = seedBusiness("en-IN");
  const { code } = telegram.createLinkCode(businessId);
  const abort = new AbortController();
  let polls = 0;
  const calls = fakeTelegram(t, (method, body) => {
    if (method !== "getUpdates") return { ok: true, result: { message_id: 1 } };
    polls += 1;
    if (polls === 1) {
      assert.deepEqual(body, { offset: 0, timeout: 25, allowed_updates: ["message"] });
      return { ok: true, result: [{ update_id: 41, message: { text: `/start ${code}`, chat: { id: 42, type: "private" } } }] };
    }
    assert.equal(body.offset, 42);
    abort.abort();
    return { ok: true, result: [] };
  });
  await telegram.startPolling({ signal: abort.signal });
  assert.equal(repo.getTelegramLink(businessId).chat_id, "42");
  assert.ok(calls.some((c) => c.method === "sendMessage"));
});
