"use strict";

/**
 * src/agora/agent.js speech lanes: at most one server-initiated /speak line in flight per
 * business (Murf Falcon: 2 concurrent streams outside US-East; live check 129a071 stall).
 */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const agent = require("../src/agora/agent");

function fakeSpeak(t) {
  const sent = [];
  agent.setFetch(async (url, init) => {
    sent.push({ agent: /agents\/([^/]+)\/speak$/.exec(url)?.[1], body: init.body ? JSON.parse(init.body) : null, at: Date.now() });
    return new Response("{}", { status: 200 });
  });
  agent.setTimingLog(() => {});
  t.after(() => {
    agent.setFetch(null);
    agent.setTimingLog(null);
    agent.configureSpeechPacing({ msPerChar: 75, minLineMs: 1500, maxWaitMs: 5000 });
  });
  return sent;
}

let n = 0;
const ids = () => {
  n += 1;
  return { biz: `biz-lane-${n}`, a: `AGa${n}`, b: `AGb${n}` };
};

test("two agents of one business: the second line waits until the first is expected to have finished", async (t) => {
  const sent = fakeSpeak(t);
  agent.configureSpeechPacing({ msPerChar: 0, minLineMs: 250, maxWaitMs: 2000 });
  const { biz, a, b } = ids();
  agent.bindLane(a, biz);
  agent.bindLane(b, biz);
  await Promise.all([agent.speak(a, "पहली लाइन।"), agent.speak(b, "दूसरी लाइन।")]);
  assert.deepEqual(sent.map((s) => s.agent), [a, b], "in order");
  assert.ok(sent[1].at - sent[0].at >= 230, `gap ${sent[1].at - sent[0].at} ms`);
});

test("different businesses do not wait for each other", async (t) => {
  const sent = fakeSpeak(t);
  agent.configureSpeechPacing({ msPerChar: 0, minLineMs: 1000, maxWaitMs: 2000 });
  const one = ids();
  const two = ids();
  agent.bindLane(one.a, one.biz);
  agent.bindLane(two.a, two.biz);
  await Promise.all([agent.speak(one.a, "one"), agent.speak(two.a, "two")]);
  assert.ok(Math.abs(sent[1].at - sent[0].at) < 300);
});

test("pieces of one long line are paced too; INTERRUPT never waits; the wait is bounded by maxWaitMs", async (t) => {
  const sent = fakeSpeak(t);
  agent.configureSpeechPacing({ msPerChar: 0, minLineMs: 200, maxWaitMs: 2000 });
  const { biz, a } = ids();
  agent.bindLane(a, biz);
  await agent.speak(a, "यह एक लंबा वाक्य है जिसमें बहुत सारे शब्द हैं। ".repeat(15));
  assert.ok(sent.length > 1);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i].at - sent[i - 1].at >= 180, `piece ${i} gap`);

  const before = Date.now();
  await agent.speak(a, "रुकिए", { priority: "INTERRUPT", interruptable: false });
  assert.ok(Date.now() - before < 150, "INTERRUPT goes at once");

  agent.configureSpeechPacing({ msPerChar: 0, minLineMs: 5000, maxWaitMs: 150 });
  await agent.speak(a, "one");
  const start = Date.now();
  await agent.speak(a, "two");
  const waited = Date.now() - start;
  assert.ok(waited >= 120 && waited < 1000, `waited ${waited} ms`);
});

test("releaseLane: once the owner has answered, the next line goes at once; laneBusyMs reports the wait", async (t) => {
  fakeSpeak(t);
  agent.configureSpeechPacing({ msPerChar: 0, minLineMs: 3000, maxWaitMs: 5000 });
  const { biz, a } = ids();
  agent.bindLane(a, biz);
  await agent.speak(a, "read-back");
  assert.ok(agent.laneBusyMs(a) > 2000);
  agent.releaseLane(a);
  assert.equal(agent.laneBusyMs(a), 0);
  const start = Date.now();
  await agent.speak(a, "result");
  assert.ok(Date.now() - start < 300);
});

test("a stopped agent is unbound from its business lane", async (t) => {
  fakeSpeak(t);
  agent.configureSpeechPacing({ msPerChar: 0, minLineMs: 3000, maxWaitMs: 5000 });
  const { biz, a, b } = ids();
  agent.bindLane(a, biz);
  agent.bindLane(b, biz);
  await agent.speak(a, "x");
  assert.ok(agent.laneBusyMs(b) > 2000, "b shares a's lane");
  await agent.stopAgent(b);
  assert.equal(agent.laneBusyMs(b), 0, "after /leave b has its own lane");
});

test("MURF_REGION us-east is the documented US-East stream-input URL; default unchanged", () => {
  assert.equal(agent.MURF_BASE_URLS["us-east"], "wss://us-east.api.murf.ai/v1/speech/stream-input");
  assert.equal(agent.MURF_BASE_URLS.global, "wss://global.api.murf.ai/v1/speech/stream-input");
});
