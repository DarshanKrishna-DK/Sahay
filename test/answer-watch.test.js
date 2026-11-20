"use strict";

Object.assign(process.env, { DB_FILE: ":memory:", PUBLIC_URL: "https://sahay.test", TELEGRAM_BOT_TOKEN: "" });

const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const repo = require("../src/db/repo");
const events = require("../src/events");
const toolCalls = require("../src/tools/calls");
const watch = require("../src/agora/answer-watch");

function seedBusiness() {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Stores", city: "Bengaluru", language: "hi-IN" });
  return id;
}

/** A fake call: /history items, /speak lines, a hand-moved clock. */
function fakeCall({ readback = false } = {}) {
  const call = { items: [], spoken: [], now: 1_000_000, readback };
  call.owner = (content, source = "asr") => call.items.push({ role: "user", content, metadata: { source }, turn_id: call.items.length + 1 });
  call.agent = (content, source = "llm") => call.items.push({ role: "assistant", content, metadata: { source }, turn_id: call.items.length + 1 });
  call.tool = (result) => {
    call.items.push({ role: "assistant", tool_calls: [{ id: "c1", name: "sahay__get_business_facts", arguments: "{}" }] });
    call.items.push({ role: "tool", tool_call_id: "c1", content: JSON.stringify(result) });
  };
  watch.configure({
    history: async () => call.items.slice(),
    speak: async (agentId, text) => {
      call.spoken.push(text);
      call.agent(text, "command");
    },
    readback: () => call.readback,
    now: () => call.now,
    answerMs: 8000,
    settleMs: 3000,
  });
  return call;
}

const live = { agentId: "AG1", sessionId: null, language: "hi-IN" };

beforeEach(() => toolCalls.reset());

test("an owner turn the agent never answers gets one apology in the owner's language, after the wait, once", async () => {
  const businessId = seedBusiness();
  const call = fakeCall();
  const seen = [];
  const stop = events.subscribeAll((e) => e.type === "turn.unanswered" && seen.push(e.data));
  call.owner("Who owes me money?");
  assert.equal(await watch.tick(businessId, live), "waiting");
  call.now += 5000;
  assert.equal(await watch.tick(businessId, live), "waiting", "too early");
  call.now += 4000;
  assert.equal(await watch.tick(businessId, live), "spoke");
  assert.deepEqual(call.spoken, [watch.SORRY["en-IN"]], "English turn, English line, though the call is Hindi");
  call.now += 10000;
  assert.equal(await watch.tick(businessId, live), "answered", "the server's line answers it; nothing more is said");
  assert.equal(call.spoken.length, 1);
  assert.deepEqual(seen, [{ turn: "turn:1", said: "sorry", ok: true }]);
  stop();
});

test("a tool answered the turn but the model said nothing: the server speaks that tool's say (also from an error result)", async () => {
  const businessId = seedBusiness();
  const call = fakeCall();
  call.owner("आज कितने बिल बने?");
  assert.equal(await watch.tick(businessId, live), "waiting");
  call.tool({ content: [{ type: "text", text: JSON.stringify({ topic: "sales_today", say: "आज 2 बिल बने, कुल 3 हज़ार रुपये।" }) }] });
  call.now += 9000;
  assert.equal(await watch.tick(businessId, live), "waiting", "history just changed: settle first");
  call.now += 3500;
  assert.equal(await watch.tick(businessId, live), "spoke");
  assert.deepEqual(call.spoken, ["आज 2 बिल बने, कुल 3 हज़ार रुपये।"]);

  const other = seedBusiness();
  const failed = fakeCall();
  failed.owner("ನನ್ನ ಆರ್ಡರ್ ಎಲ್ಲಿದೆ?");
  failed.tool({ error: "INTERNAL", say: "ಏನೋ ತೊಂದರೆಯಾಯಿತು, ಈ ಕೆಲಸ ಈಗ ಮಾಡಲು ಆಗಲಿಲ್ಲ." });
  await watch.tick(other, live);
  failed.now += 12000;
  assert.equal(await watch.tick(other, live), "spoke");
  assert.deepEqual(failed.spoken, ["ಏನೋ ತೊಂದರೆಯಾಯಿತು, ಈ ಕೆಲಸ ಈಗ ಮಾಡಲು ಆಗಲಿಲ್ಲ."]);
});

test("nothing is said when the model answered, while a tool runs, while a read-back waits, or for a filler only", async () => {
  const businessId = seedBusiness();
  const call = fakeCall();
  call.owner("मौसम कैसा है?");
  call.agent("माफ़ कीजिए, इसकी जानकारी मेरे पास नहीं है।");
  call.now += 20000;
  assert.equal(await watch.tick(businessId, live), "answered");

  call.owner("स्टॉक बताओ", "message"); // a typed turn counts as an owner turn
  call.agent("हाँ जी, एक सेकंड।"); // Agora's static filler is not an answer
  await watch.tick(businessId, live);
  const end = toolCalls.begin(businessId, "get_stock");
  call.now += 20000;
  assert.equal(await watch.tick(businessId, live), "tool");
  end();
  call.readback = true;
  assert.equal(await watch.tick(businessId, live), "readback", "a line between a read-back and the owner's answer would void the yes");
  call.readback = false;
  assert.equal(await watch.tick(businessId, live), "spoke");
  assert.deepEqual(call.spoken, [watch.SORRY["hi-IN"]]);
  assert.equal(call.items.filter((i) => i.metadata?.source === "command").length, 1);
});

test("a turn that repeats the agent's own line (its voice heard back) is left alone", async () => {
  const businessId = seedBusiness();
  const call = fakeCall();
  call.agent("और कुछ बताइए?", "command");
  call.owner("और कुछ बताइए?");
  call.now += 20000;
  assert.equal(await watch.tick(businessId, live), "echo");
  call.now += 20000;
  assert.equal(await watch.tick(businessId, live), "done");
  assert.deepEqual(call.spoken, []);
});

test("a /history failure or a failed /speak never throws and is not retried for the same turn", async () => {
  const businessId = seedBusiness();
  const call = fakeCall();
  watch.configure({ history: async () => { throw new Error("timeout"); } });
  assert.equal(await watch.tick(businessId, live), "waiting");
  watch.configure({ history: async () => call.items.slice(), speak: async () => { throw new Error("503"); } });
  call.owner("hello?");
  await watch.tick(businessId, live);
  call.now += 20000;
  const warned = [];
  const original = console.warn;
  console.warn = (line) => warned.push(line);
  try {
    assert.equal(await watch.tick(businessId, live), "failed");
    assert.equal(await watch.tick(businessId, live), "done");
  } finally {
    console.warn = original;
  }
  assert.ok(warned.some((l) => /could not speak/.test(l)));
});

test("toolSay reads the MCP text result and its JSON, and ignores an empty say (the server already spoke)", () => {
  assert.equal(watch.toolSay({ role: "tool", content: JSON.stringify({ say: "ok" }) }), "ok");
  assert.equal(watch.toolSay({ role: "tool", content: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ say: "x" }) }] }) }), "x");
  assert.equal(watch.toolSay({ role: "tool", content: JSON.stringify({ say: "" }) }), null);
  assert.equal(watch.toolSay({ role: "tool", content: "not json" }), null);
  assert.equal(watch.toolSay({ role: "assistant", content: "x" }), null);
});

test("pollAll only looks at the narrator's live calls", async () => {
  const businessId = seedBusiness();
  const call = fakeCall();
  call.owner("hello?");
  watch.configure({ live: () => new Map([[businessId, live]]) });
  await watch.pollAll();
  call.now += 20000;
  await watch.pollAll();
  assert.equal(call.spoken.length, 1);
  watch.configure({ live: () => new Map() });
  call.owner("again?");
  call.now += 20000;
  await watch.pollAll();
  assert.equal(call.spoken.length, 1);
});
