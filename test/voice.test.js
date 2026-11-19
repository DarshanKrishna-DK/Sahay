'use strict';

/**
 * public/js/voice.js is a browser ES module. Its pure helpers are tested from the real source:
 * the one import (./api.js, which needs a browser) is replaced by an empty object and the rest
 * is loaded as a data: module. Nothing at module level touches the DOM.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadVoice() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'voice.js'), 'utf8');
  const importLine = /^import \* as api from "\.\/api\.js";$/m;
  assert.match(source, importLine, 'voice.js still imports api.js the way this test expects');
  const patched = source.replace(importLine, 'const api = {};');
  return import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`);
}

const turn = (role, turnNo, time, text) => ({ role, turnNo, time, text });
const texts = (turns) => turns.map((t) => t.text);

test('orderTurns: by turn id, owner before Sahay within a turn, the server-spoken disclosure first', async () => {
  const { orderTurns } = await loadVoice();
  // As the E2E run saw them: the "search done" narration listed before the "search started" reply.
  const shuffled = [
    turn('agent', 3, 1700000033000, 'खोज पूरी हुई, 10 विक्रेता मिले'),
    turn('agent', 2, 1700000033000, 'इंडियामार्ट पर खोजना शुरू कर दिया है'),
    turn('owner', 2, 1700000030000, 'मुझे 200 किलो बासमती चावल चाहिए'),
    turn('agent', 0, 1700000001000, 'नमस्ते, मैं सहाय हूँ, स्वचालित सहायक'),
    turn('owner', 1, 1700000010000, 'हाँ'),
    turn('agent', 1, 1700000011000, 'बताइए'),
  ];
  assert.deepEqual(texts(orderTurns(shuffled)), [
    'नमस्ते, मैं सहाय हूँ, स्वचालित सहायक',
    'हाँ',
    'बताइए',
    'मुझे 200 किलो बासमती चावल चाहिए',
    'इंडियामार्ट पर खोजना शुरू कर दिया है',
    'खोज पूरी हुई, 10 विक्रेता मिले',
  ]);
  assert.equal(shuffled[0].text, 'खोज पूरी हुई, 10 विक्रेता मिले', 'the input array is left alone');
});

test('orderTurns: without turn ids it orders by time, and keeps the toolkit order for equal or missing times', async () => {
  const { orderTurns } = await loadVoice();
  const turns = [
    turn('agent', null, 3000, 'third'),
    turn('owner', 7, 1000, 'first'),
    turn('agent', null, null, 'no time, after timed ones'),
    turn('agent', null, 2000, 'second'),
  ];
  assert.deepEqual(texts(orderTurns(turns)), ['first', 'second', 'third', 'no time, after timed ones']);
  assert.deepEqual(orderTurns([]), []);
  const same = [turn('agent', null, 5, 'a'), turn('agent', null, 5, 'b')];
  assert.deepEqual(texts(orderTurns(same)), ['a', 'b']);
});

const sys = (time, key = `s${time}`) => ({ key, role: 'system', time, text: key });

test('withSystemLines (E2E r3 bug 3): a fired follow-up sits before the first turn spoken after it', async () => {
  const { withSystemLines } = await loadVoice();
  const turns = [turn('agent', 1, 1000, 'a'), turn('owner', 2, 2000, 'b'), turn('agent', 2, 3000, 'c')];
  assert.deepEqual(texts(withSystemLines(turns, [sys(2500, 'fu')])), ['a', 'b', 'fu', 'c']);
  assert.deepEqual(texts(withSystemLines(turns, [sys(9000, 'late'), sys(500, 'early')])), ['early', 'a', 'b', 'c', 'late']);
  assert.equal(withSystemLines(turns, []), turns, 'no lines: the same array');
});

test('withSystemLines: turns without a time keep their order; lines with no later turn go last', async () => {
  const { withSystemLines } = await loadVoice();
  const turns = [turn('agent', null, null, 'a'), turn('owner', null, 4000, 'b'), turn('agent', null, null, 'c')];
  assert.deepEqual(texts(withSystemLines(turns, [sys(3000, 'x')])), ['a', 'x', 'b', 'c']);
  assert.deepEqual(texts(withSystemLines([], [sys(1, 'only')])), ['only']);
});

test('formatTimings (E2E r3 bug 8): stages in call order, rounded, unreached ones left out', async () => {
  const { formatTimings, START_STAGES } = await loadVoice();
  assert.equal(START_STAGES[0], 'sdk');
  assert.equal(START_STAGES.at(-1), 'first_words');
  assert.equal(formatTimings({ first_words: 4200.4, sdk: 1.2, token: 300.6, mic: 120 }), 'sdk=1 mic=120 token=301 first_words=4200');
});

test('preloadSdks (E2E r3 bug 8): RTC, RTM and the toolkit are all requested at once, RTC first, in-order execution', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'voice.js'), 'utf8');
  const body = source.slice(source.indexOf('export function preloadSdks'), source.indexOf('// The toolkit\'s dist/index.mjs'));
  assert.match(body, /Promise\.all\(\[\s*window\.AgoraRTC \? null : injectScript\(RTC_SDK\),\s*window\.AgoraRTM \? null : injectScript\(RTM_SDK\),/);
  assert.ok(body.indexOf('loadToolkit()') < body.indexOf('Promise.all'), 'the toolkit fetch starts with the scripts, not after them');
  assert.doesNotMatch(body, /await injectScript/, 'no script waits for the previous one to finish downloading');
  assert.match(source, /el\.async = false;/, 'dynamic scripts still execute in insertion order');
});

/* ------------------------------------------------ VoiceCall.start with fakes --- */

const FAKE_TOOLKIT = `
export const TranscriptHelperMode = { TEXT: "text" };
export const AgoraVoiceAIEvents = { TRANSCRIPT_UPDATED: "t", AGENT_STATE_CHANGED: "s", AGENT_INTERRUPTED: "i", AGENT_ERROR: "e", MESSAGE_ERROR: "m", AGENT_METRICS: "x", AGENT_TURN_FINISHED: "f" };
export const AgoraVoiceAI = {
  async init() { globalThis.__voiceLog.push("toolkit.init"); return { on() {}, subscribeMessage() { globalThis.__voiceLog.push("subscribeMessage"); }, unsubscribe() {}, destroy() {} }; },
  getInstance() { return null; },
};`;

/** voice.js with the api and the CDN toolkit replaced by fakes, and a fake window with Agora SDK globals. */
async function loadVoiceWithFakes() {
  globalThis.__fakeApi = globalThis.__fakeApi ?? {}; // bound once at module evaluation; each test fills it
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'voice.js'), 'utf8');
  const toolkitUrl = `data:text/javascript;base64,${Buffer.from(FAKE_TOOLKIT).toString('base64')}`;
  const patched = source
    .replace(/^import \* as api from "\.\/api\.js";$/m, 'const api = globalThis.__fakeApi;')
    .replace(/const TOOLKIT_URL = "[^"]+";/, `const TOOLKIT_URL = "${toolkitUrl}";`);
  return import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeEnvironment({ micError = null, publishError = null, publishMs = 60 } = {}) {
  const log = [];
  globalThis.__voiceLog = log;
  const api = {
    calls: [],
    async getVoiceToken() { log.push('token'); return { appId: 'a'.repeat(32), channel: 'own-1', uid: 1001, token: 't', agentUid: 2002 }; },
    async startVoice() { log.push('startVoice'); return { agentId: 'AG' }; },
    async stopVoice() { log.push('stopVoice'); return { stopped: true }; },
    stopVoiceOnUnload() {},
  };
  globalThis.__fakeApi = Object.assign(globalThis.__fakeApi ?? {}, api);
  const rtc = {
    remoteUsers: [],
    on() {},
    async join() { await wait(10); log.push('rtc.join'); },
    publish() { return wait(publishMs).then(() => { if (publishError) throw publishError; log.push('publish.done'); }); },
    async unpublish() {},
    async leave() { log.push('rtc.leave'); },
  };
  class RTM {
    addEventListener() {}
    async login() { await wait(5); log.push('rtm.login'); }
    async subscribe() { await wait(5); log.push('rtm.subscribe'); }
    async unsubscribe() {}
    async logout() {}
  }
  const track = { stop() {}, close() {}, getVolumeLevel: () => 0, async setEnabled() {} };
  globalThis.window = {
    isSecureContext: true,
    addEventListener() {},
    AgoraRTC: {
      async createMicrophoneAudioTrack() { await wait(5); if (micError) throw micError; log.push('mic'); return track; },
      createClient: () => rtc,
    },
    AgoraRTM: { RTM },
  };
  return log;
}

function handlers() {
  const seen = { statuses: [], errors: [], timings: null };
  return {
    seen,
    onStatus(status, detail) { seen.statuses.push(status); if (detail && detail.error) seen.errors.push(detail.error); },
    onAgentState() {}, onTranscript() {}, onLanguage() {}, onIssue() {}, onLevels() {}, onAutoplay() {}, onMetric() {}, onTranscriptLink() {},
    onTimings(m) { seen.timings = m; },
  };
}

test('start (E2E r3 bug 8): the agent is started once RTM is subscribed and the toolkit listens, without waiting for the mic to publish', async (t) => {
  const { VoiceCall } = await loadVoiceWithFakes();
  const log = fakeEnvironment({ publishMs: 80 });
  const h = handlers();
  const call = new VoiceCall(h);
  t.after(() => call.teardown({ stopServer: false }));
  await call.start();
  const at = (step) => log.indexOf(step);
  for (const step of ['rtm.subscribe', 'subscribeMessage', 'rtc.join']) assert.ok(at(step) >= 0 && at(step) < at('startVoice'), `${step} before startVoice: ${log.join(', ')}`);
  assert.ok(at('startVoice') < at('publish.done'), `publishing overlaps the agent start: ${log.join(', ')}`);
  assert.ok(at('token') < at('mic') || at('token') >= 0, 'the token is requested alongside the microphone');
  assert.equal(call.status, 'waiting');
  assert.ok(['sdk', 'mic', 'token', 'subscribed', 'toolkit', 'start_sent', 'start_done', 'published'].every((k) => Number.isFinite(call.marks[k])), JSON.stringify(call.marks));
});

test('start: a microphone failure never starts the agent and gives back the call entry the token opened', async () => {
  const { VoiceCall } = await loadVoiceWithFakes();
  const log = fakeEnvironment({ micError: Object.assign(new Error('denied'), { name: 'NotAllowedError' }) });
  const h = handlers();
  const call = new VoiceCall(h);
  await call.start();
  assert.ok(!log.includes('startVoice'), log.join(', ') + JSON.stringify(h.seen.errors.map((e) => [e.code, e.message])));
  assert.ok(log.includes('stopVoice'), `the server's call entry is stopped: ${log.join(', ')}`);
  assert.equal(call.status, 'error');
  assert.equal(h.seen.errors[0].code, 'mic_denied');
});

test('start: a microphone that cannot be published ends the call and stops the agent that was started', async () => {
  const { VoiceCall } = await loadVoiceWithFakes();
  const log = fakeEnvironment({ publishError: new Error('PUBLISH_FAILED') });
  const h = handlers();
  const call = new VoiceCall(h);
  await call.start();
  assert.ok(log.includes('startVoice') && log.includes('stopVoice'), log.join(', '));
  assert.equal(call.status, 'error');
  assert.equal(h.seen.errors[0].code, 'join_failed');
});

test('start: a second click while the first is still loading starts nothing', async (t) => {
  const { VoiceCall } = await loadVoiceWithFakes();
  const log = fakeEnvironment();
  const call = new VoiceCall(handlers());
  t.after(() => call.teardown({ stopServer: false }));
  await Promise.all([call.start(), call.start()]);
  assert.equal(log.filter((s) => s === 'token').length, 1, log.join(', '));
  assert.equal(log.filter((s) => s === 'startVoice').length, 1);
});
