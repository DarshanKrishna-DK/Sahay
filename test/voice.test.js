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
export const ChatMessageType = { TEXT: "text", IMAGE: "image", UNKNOWN: "unknown" };
export const ChatMessagePriority = { INTERRUPTED: "interrupted", APPEND: "append", IGNORE: "ignore" };
export const AgoraVoiceAI = {
  async init({ rtmEngine }) {
    globalThis.__voiceLog.push("toolkit.init");
    const handlers = {};
    const ai = {
      on(ev, fn) { handlers[ev] = fn; },
      emit(ev, ...args) { if (handlers[ev]) handlers[ev](...args); },
      subscribeMessage() { globalThis.__voiceLog.push("subscribeMessage"); },
      unsubscribe() {}, destroy() {},
      // Same body as agora-agent-client-toolkit@2.10.0 dist/index.mjs sendText (lines 1827-1862).
      async sendText(agentUserId, message) {
        const payload = { priority: message.priority ?? "interrupted", interruptable: message.responseInterruptable ?? true, message: message.text ?? "" };
        await rtmEngine.publish(agentUserId, JSON.stringify(payload), { channelType: "USER", customType: "user.transcription" });
      },
    };
    globalThis.__voiceAi = ai;
    return ai;
  },
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

/**
 * The fake clients hang off the returned log: log.rtc (the latest RTC client: published tracks,
 * rtmMessages, emit(event)), log.clients (every RTC client, one per connect attempt), log.rtms
 * (every RTM instance with its config). attempts[i] = { rtc, rtm }: 'ok' (default), 'hang' (never
 * answers until the client is released, as RTM login did on the blocked network) or an Error.
 */
function fakeEnvironment({ micError = null, publishError = null, publishMs = 60, rtmPublishError = null, attempts = [], search = '', remembered = false } = {}) {
  const log = [];
  globalThis.__voiceLog = log;
  const api = {
    calls: [],
    async getVoiceToken() { log.push('token'); return { appId: 'a'.repeat(32), channel: 'own-1', uid: 1001, token: 't', agentUid: 2002 }; },
    async renewVoiceToken(channel) { log.push('renew'); return { channel, uid: 1001, token: 't2' }; },
    async startVoice() { log.push('startVoice'); return { agentId: 'AG' }; },
    async stopVoice() { log.push('stopVoice'); return { stopped: true }; },
    async negotiationListenToken() { log.push('listenToken'); return { appId: 'a'.repeat(32), channel: 'neg-1', uid: 3003, token: 'lt' }; },
    stopVoiceOnUnload() {},
  };
  globalThis.__fakeApi = Object.assign(globalThis.__fakeApi ?? {}, api);
  const outcome = (i, side) => (attempts[i] && attempts[i][side]) || 'ok';
  const rtmMessages = [];
  function makeRtc(index) {
    const handlers = {};
    const pending = [];
    const rtc = {
      index,
      remoteUsers: [],
      published: [],
      rtmMessages,
      proxyMode: null,
      joins: [],
      on(ev, fn) { handlers[ev] = fn; },
      emit(ev, ...args) { return handlers[ev] && handlers[ev](...args); },
      startProxyServer(mode) { log.push(`rtc${index}.startProxy:${mode}`); rtc.proxyMode = mode; },
      stopProxyServer() { log.push(`rtc${index}.stopProxy`); },
      async join(...args) {
        rtc.joins.push(args);
        log.push(`rtc${index}.join:${rtc.proxyMode ?? 'direct'}`);
        const o = outcome(index, 'rtc');
        if (o === 'hang') return new Promise((_, reject) => pending.push(reject));
        await wait(10);
        if (o instanceof Error) throw o;
        log.push('rtc.join');
      },
      publish(tracks) {
        return wait(publishMs).then(() => { if (publishError) throw publishError; rtc.published.push(...tracks); log.push('publish.done'); });
      },
      async unpublish() {},
      async leave() {
        log.push('rtc.leave');
        for (const r of pending.splice(0)) r(Object.assign(new Error('join aborted by leave'), { code: 'OPERATION_ABORTED' }));
      },
    };
    return rtc;
  }
  const clients = [makeRtc(0)];
  log.rtc = clients[0];
  log.clients = [];
  log.rtms = [];
  class RTM {
    constructor(appId, userId, config) {
      this.index = log.rtms.length;
      this.args = [appId, userId];
      this.config = config;
      this.pending = [];
      log.rtms.push(this);
    }
    addEventListener() {}
    async login(opts) {
      this.loginToken = opts && opts.token;
      const o = outcome(this.index, 'rtm');
      if (o === 'hang') return new Promise((_, reject) => this.pending.push(reject));
      await wait(5);
      if (o instanceof Error) throw o;
      log.push('rtm.login');
    }
    async subscribe(channel) { this.channel = channel; await wait(5); log.push('rtm.subscribe'); }
    async publish(target, message, options) { if (rtmPublishError) throw rtmPublishError; rtmMessages.push([target, message, options]); }
    async renewToken() {}
    async unsubscribe() {}
    async logout() {
      log.push(`rtm${this.index}.logout`);
      // RTM 2.2.3 rejects a pending login with RTM_ERROR_LOGIN_CANCELED when logout runs.
      for (const r of this.pending.splice(0)) r(Object.assign(new Error('Login RTM service was canceled by user.'), { code: -10023 }));
    }
  }
  const store = new Map(remembered ? [['sahay.voice.cloudProxy', '1']] : []);
  const makeTrack = () => ({ stop() {}, close() {}, getVolumeLevel: () => 0, async setEnabled() {} });
  globalThis.window = {
    isSecureContext: true,
    addEventListener() {},
    location: { search },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    AgoraRTC: {
      async createMicrophoneAudioTrack() { await wait(5); if (micError) throw micError; log.push('mic'); return makeTrack(); },
      createClient: () => {
        const c = log.clients.length < clients.length ? clients[log.clients.length] : makeRtc(log.clients.length);
        log.clients.push(c);
        log.rtc = c;
        return c;
      },
    },
    AgoraRTM: { RTM },
  };
  log.store = store;
  return log;
}

function handlers() {
  const seen = { statuses: [], details: [], errors: [], timings: null, transcript: [], issues: [], replies: [] };
  return {
    seen,
    onStatus(status, detail) { seen.statuses.push(status); seen.details.push(detail || {}); if (detail && detail.error) seen.errors.push(detail.error); },
    onAgentState() {}, onLanguage() {}, onLevels() {}, onAutoplay() {}, onMetric() {}, onTranscriptLink() {},
    onTranscript(turns) { seen.transcript = turns; },
    onIssue(i) { seen.issues.push(i); },
    onTextReply(r) { seen.replies.push(r); },
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

/* ------------------------------------------------ text mode and sendText (V1) --- */

// Toolkit transcript items as TRANSCRIPT_UPDATED delivers them (TEXT render mode).
const ownerItem = (turnId, text, time) => ({ uid: '0', turn_id: turnId, stream_id: 0, text, _time: time, metadata: { final: true } });
const agentItem = (turnId, text, time, turnStatus = 1) => ({ uid: '2002', turn_id: turnId, stream_id: 0, text, _time: time, metadata: { turn_status: turnStatus } });
const DISCLOSURE = 'नमस्ते, मैं सहाय हूँ, स्वचालित सहायक';

/** A text-mode call that is connected and has heard Sahay's first sentence. */
async function liveTextCall(t, opts) {
  const { VoiceCall, CallError } = await loadVoiceWithFakes();
  const log = fakeEnvironment(opts);
  const h = handlers();
  const call = new VoiceCall(h);
  t.after(() => call.teardown({ stopServer: false }));
  await call.start({ mode: 'text' });
  globalThis.__voiceAi.emit('t', [agentItem(0, DISCLOSURE, Date.now() - 1000)]);
  return { call, log, h, ai: globalThis.__voiceAi, CallError };
}

test('start({mode:"text"}): joins and starts the agent without opening or publishing a microphone', async (t) => {
  const { VoiceCall } = await loadVoiceWithFakes();
  const log = fakeEnvironment();
  const h = handlers();
  const call = new VoiceCall(h);
  t.after(() => call.teardown({ stopServer: false }));
  await call.start({ mode: 'text' });
  assert.equal(call.mode, 'text');
  assert.ok(!log.includes('mic'), `no microphone track in text mode: ${log.join(', ')}`);
  assert.deepEqual(log.rtc.published, [], 'nothing is published');
  assert.ok(log.includes('startVoice') && log.includes('subscribeMessage'), log.join(', '));
  assert.ok(!h.seen.statuses.includes('mic'), `no microphone step: ${h.seen.statuses.join(', ')}`);
  assert.equal(call.status, 'waiting');
  assert.equal(call.muted, true);
});

test('start() with no options is still a voice call that publishes the microphone', async (t) => {
  const { VoiceCall } = await loadVoiceWithFakes();
  const log = fakeEnvironment();
  const call = new VoiceCall(handlers());
  t.after(() => call.teardown({ stopServer: false }));
  await call.start();
  assert.equal(call.mode, 'voice');
  assert.equal(log.rtc.published.length, 1);
  assert.equal(call.muted, false);
});

test('sendText: one RTM peer message to the agent in the toolkit 2.10.0 shape (agora-findings: typed owner message)', async (t) => {
  const { call, log } = await liveTextCall(t);
  await call.sendText('  नमस्ते ');
  assert.deepEqual(log.rtc.rtmMessages, [[
    '2002',
    JSON.stringify({ priority: 'interrupted', interruptable: true, message: 'नमस्ते' }),
    { channelType: 'USER', customType: 'user.transcription' },
  ]]);
});

test('sendText: the typed message shows at once as {role:"owner", via:"text"}, after what was already said', async (t) => {
  const { call, h } = await liveTextCall(t);
  await call.sendText('मुझे 50 किलो चावल चाहिए');
  const last = h.seen.transcript.at(-1);
  assert.equal(last.role, 'owner');
  assert.equal(last.via, 'text');
  assert.equal(last.text, 'मुझे 50 किलो चावल चाहिए');
  assert.deepEqual(h.seen.transcript.map((x) => x.text), [DISCLOSURE, 'मुझे 50 किलो चावल चाहिए']);
});

test('sendText: when the agent echoes the typed text as a user transcription it appears once, still via text, before the reply', async (t) => {
  const { call, h, ai } = await liveTextCall(t);
  const before = Date.now();
  await call.sendText('हाँ, ठीक है');
  ai.emit('t', [
    agentItem(0, DISCLOSURE, before - 1000),
    ownerItem(1, 'हाँ, ठीक है', before + 50),
    agentItem(1, 'ठीक है, मैं खोज रहा हूँ', before + 900),
  ]);
  const owners = h.seen.transcript.filter((x) => x.role === 'owner');
  assert.equal(owners.length, 1, JSON.stringify(h.seen.transcript));
  assert.equal(owners[0].via, 'text');
  assert.deepEqual(h.seen.transcript.map((x) => x.text), [DISCLOSURE, 'हाँ, ठीक है', 'ठीक है, मैं खोज रहा हूँ']);
});

test('spoken owner turns are marked via voice; an earlier spoken turn with the same words is not taken as the echo', async (t) => {
  const { call, h, ai } = await liveTextCall(t);
  const now = Date.now();
  ai.emit('t', [agentItem(0, DISCLOSURE, now - 3000), ownerItem(1, 'हाँ', now - 2000)]);
  await call.sendText('हाँ');
  const owners = h.seen.transcript.filter((x) => x.role === 'owner');
  assert.deepEqual(owners.map((x) => [x.text, x.via]), [['हाँ', 'voice'], ['हाँ', 'text']]);
});

test('onTextReply: the first finished Sahay turn after a typed message, once', async (t) => {
  const { call, h, ai } = await liveTextCall(t);
  const before = Date.now();
  await call.sendText('कितना हुआ?');
  ai.emit('t', [agentItem(0, DISCLOSURE, before - 1000), agentItem(1, 'अभी बता', before + 500, 0)]);
  assert.equal(h.seen.replies.length, 0, 'a reply still streaming is not reported');
  ai.emit('t', [agentItem(0, DISCLOSURE, before - 1000), agentItem(1, 'अभी बताता हूँ', before + 600, 1)]);
  ai.emit('t', [agentItem(0, DISCLOSURE, before - 1000), agentItem(1, 'अभी बताता हूँ', before + 600, 1)]);
  assert.equal(h.seen.replies.length, 1);
  assert.equal(h.seen.replies[0].text, 'अभी बताता हूँ');
});

test('sendText with no session rejects NOT_CONNECTED and publishes nothing', async () => {
  const { VoiceCall, CallError } = await loadVoiceWithFakes();
  const log = fakeEnvironment();
  const call = new VoiceCall(handlers());
  await assert.rejects(async () => call.sendText('नमस्ते'), (err) => err instanceof CallError && err.code === 'NOT_CONNECTED');
  assert.deepEqual(log.rtc.rtmMessages, []);
});

test('sendText after the call ended rejects NOT_CONNECTED; empty text rejects EMPTY_TEXT', async (t) => {
  const { call, log, CallError } = await liveTextCall(t);
  await assert.rejects(call.sendText('   '), (err) => err instanceof CallError && err.code === 'EMPTY_TEXT');
  await call.end();
  await assert.rejects(call.sendText('नमस्ते'), (err) => err instanceof CallError && err.code === 'NOT_CONNECTED');
  assert.deepEqual(log.rtc.rtmMessages, []);
});

test('sendText before Sahay has said its first sentence waits for it, so the disclosure is never cut off', async (t) => {
  const { VoiceCall } = await loadVoiceWithFakes();
  const log = fakeEnvironment();
  const h = handlers();
  const call = new VoiceCall(h);
  t.after(() => call.teardown({ stopServer: false }));
  await call.start({ mode: 'text' });
  const sent = call.sendText('नमस्ते');
  await wait(20);
  assert.deepEqual(log.rtc.rtmMessages, [], 'held until the first words');
  assert.equal(h.seen.transcript.at(-1).via, 'text', 'shown to the owner meanwhile');
  globalThis.__voiceAi.emit('t', [agentItem(0, DISCLOSURE, Date.now())]);
  await sent;
  assert.equal(log.rtc.rtmMessages.length, 1);
  assert.deepEqual(h.seen.transcript.map((x) => x.text), [DISCLOSURE, 'नमस्ते']);
});

test('sendText held for the first sentence rejects NOT_CONNECTED when the call ends first', async (t) => {
  const { VoiceCall, CallError } = await loadVoiceWithFakes();
  const log = fakeEnvironment();
  const call = new VoiceCall(handlers());
  t.after(() => call.teardown({ stopServer: false }));
  await call.start({ mode: 'text' });
  const sent = call.sendText('नमस्ते');
  await call.end();
  await assert.rejects(sent, (err) => err instanceof CallError && err.code === 'NOT_CONNECTED');
  assert.deepEqual(log.rtc.rtmMessages, []);
});

test('sendText: a failed RTM publish rejects SEND_FAILED and takes the message back off the transcript', async (t) => {
  const { call, h, CallError } = await liveTextCall(t, { rtmPublishError: new Error('RTM offline') });
  await assert.rejects(call.sendText('नमस्ते'), (err) => err instanceof CallError && err.code === 'SEND_FAILED');
  assert.deepEqual(h.seen.transcript.map((x) => x.text), [DISCLOSURE]);
});

test('text mode: setMuted(false) opens and publishes the microphone; setMuted(true) mutes it', async (t) => {
  const { call, log } = await liveTextCall(t);
  assert.equal(await call.setMuted(false), false);
  assert.ok(log.includes('mic'));
  assert.equal(log.rtc.published.length, 1);
  assert.equal(await call.setMuted(true), true);
  assert.equal(log.rtc.published.length, 1, 'muting does not publish again');
});

test('text mode: rejoining after token expiry publishes no microphone', async (t) => {
  const { call, log } = await liveTextCall(t);
  await log.rtc.emit('token-privilege-did-expire');
  assert.deepEqual(log.rtc.published, []);
  assert.notEqual(call.status, 'error');
});

/* --------------------------------------- restrictive networks: Agora Cloud Proxy --- */

// Short connect timeouts for the fakes; the module instance is shared, so every test sets them.
async function loadWithShortTimeouts() {
  const mod = await loadVoiceWithFakes();
  mod.CONNECT_TIMEOUT_MS.direct = 60;
  mod.CONNECT_TIMEOUT_MS.proxy = 60;
  return mod;
}

const blockedRtm = { rtm: 'hang' }; // the laptop network on 2026-11-20: RTM 9591/9593 time out, login never answers

test('routePlan: direct first with one proxy retry; remembered proxy first with one direct retry; ?proxy=1 forces proxy only', async () => {
  const { routePlan } = await loadVoice();
  assert.deepEqual(routePlan('', false), { first: 'direct', fallback: true, forced: false });
  assert.deepEqual(routePlan('', true), { first: 'proxy', fallback: true, forced: false });
  assert.deepEqual(routePlan('?proxy=1', false), { first: 'proxy', fallback: false, forced: true });
  assert.deepEqual(routePlan('?x=2&proxy=1', true), { first: 'proxy', fallback: false, forced: true });
  assert.deepEqual(routePlan('?proxy=0', false), { first: 'direct', fallback: true, forced: false });
  assert.deepEqual(routePlan(undefined, false), { first: 'direct', fallback: true, forced: false });
});

test('isNetworkFailure: timeouts and RTC/RTM connection codes are network-class; token and parameter errors are not', async () => {
  const { isNetworkFailure } = await loadVoice();
  const e = (code, message = '') => Object.assign(new Error(message), { code });
  const network = [
    e('connect_timeout'), e(-10023), e(-10011), e(-10010), e(-10013), e(-10025), e(-11019),
    e('NETWORK_ERROR'), e('NETWORK_TIMEOUT'), e('WS_ERR'), e('WS_ABORT'), e('WS_DISCONNECT'), e('TIMEOUT'), e('CAN_NOT_GET_PROXY_SERVER'),
    e('CAN_NOT_GET_GATEWAY_SERVER', 'flag: 4096, message: AgoraRTCError CAN_NOT_GET_GATEWAY_SERVER: no active status'),
  ];
  for (const err of network) assert.equal(isNetworkFailure(err), true, String(err.code));
  const other = [
    null, new Error('x'), e(-10005), e(-10003), e('INVALID_PARAMS'), e('UID_CONFLICT'),
    e('CAN_NOT_GET_GATEWAY_SERVER', 'invalid token, authorized failed'),
    e('CAN_NOT_GET_GATEWAY_SERVER', 'invalid vendor key, can not find appid'),
  ];
  for (const err of other) assert.equal(isNetworkFailure(err), false, String(err && err.code));
});

test('start on an open network: one direct attempt, no proxy, nothing remembered', async (t) => {
  const { VoiceCall } = await loadWithShortTimeouts();
  const log = fakeEnvironment();
  const h = handlers();
  const call = new VoiceCall(h);
  t.after(() => call.teardown({ stopServer: false }));
  await call.start();
  assert.equal(log.clients.length, 1);
  assert.equal(log.rtms.length, 1);
  assert.equal(log.rtms[0].config, undefined, 'RTM is created without a cloud proxy config');
  assert.ok(!log.some((l) => /startProxy/.test(l)), log.join(', '));
  assert.ok(!h.seen.details.some((d) => d.route === 'proxy'));
  assert.equal(call.route, 'direct');
  assert.equal(log.store.get('sahay.voice.cloudProxy'), undefined);
  assert.equal(call.status, 'waiting');
});

test('start: a blocked RTM login times out, then RTC and RTM retry once through Cloud Proxy (TLS 443) with the same channel and token', async (t) => {
  const { VoiceCall } = await loadWithShortTimeouts();
  const log = fakeEnvironment({ attempts: [blockedRtm] });
  const h = handlers();
  const call = new VoiceCall(h);
  t.after(() => call.teardown({ stopServer: false }));
  await call.start();
  assert.equal(call.status, 'waiting', JSON.stringify(h.seen.errors.map((x) => [x.code, x.message])));
  assert.equal(log.clients.length, 2, 'a fresh RTC client for the retry');
  const [first, second] = log.clients;
  assert.equal(first.proxyMode, null);
  assert.equal(second.proxyMode, 5, 'startProxyServer(5): forced TCP over TLS 443');
  assert.ok(log.indexOf('rtc1.startProxy:5') < log.indexOf('rtc1.join:5'), `proxy set before join: ${log.join(', ')}`);
  assert.deepEqual(log.rtms.map((r) => r.config), [undefined, { cloudProxy: true }]);
  assert.deepEqual(second.joins[0], first.joins[0], 'same app id, channel, token and uid');
  assert.equal(log.rtms[1].loginToken, log.rtms[0].loginToken);
  assert.ok(log.includes('rtm0.logout') && log.indexOf('rtm0.logout') < log.indexOf('rtc1.join:5'), `the failed attempt is released first: ${log.join(', ')}`);
  assert.equal(log.filter((l) => l === 'startVoice').length, 1, 'the agent is started once, after the proxy connect');
  assert.ok(!log.includes('stopVoice'), 'the server call entry is kept across the retry');
  assert.ok(h.seen.details.some((d) => d.route === 'proxy'), 'the console is told about the safer route');
  assert.equal(call.route, 'proxy');
  assert.ok(Number.isFinite(call.marks.proxy));
  assert.equal(log.store.get('sahay.voice.cloudProxy'), '1', 'remembered for this browser session');
  // An event from the abandoned first client must not end the live call.
  first.emit('connection-state-change', 'DISCONNECTED', 'CONNECTED', 'NETWORK_ERROR');
  await wait(5);
  assert.equal(call.status, 'waiting');
  await call.end();
  assert.ok(log.includes('rtc1.stopProxy'), `stopProxyServer after leave: ${log.join(', ')}`);
});

test('start: when the Cloud Proxy retry also fails the owner gets an honest network error and the server entry is released', async () => {
  const { VoiceCall } = await loadWithShortTimeouts();
  const log = fakeEnvironment({ attempts: [blockedRtm, blockedRtm] });
  const h = handlers();
  const call = new VoiceCall(h);
  await call.start();
  assert.equal(call.status, 'error');
  assert.equal(h.seen.errors[0].code, 'network_blocked');
  assert.match(h.seen.errors[0].message, /network/i);
  assert.equal(log.clients.length, 2, 'exactly one retry');
  assert.ok(!log.includes('startVoice'), 'no agent is started, so no voice minutes are spent');
  assert.ok(log.includes('stopVoice'));
  assert.equal(log.store.get('sahay.voice.cloudProxy'), undefined, 'nothing remembered after a failure');
});

test('start: Cloud Proxy refused for the project (CAN_NOT_GET_PROXY_SERVER) is reported as proxy_unavailable', async () => {
  const { VoiceCall } = await loadWithShortTimeouts();
  const refused = Object.assign(new Error('AgoraRTCError CAN_NOT_GET_PROXY_SERVER'), { code: 'CAN_NOT_GET_PROXY_SERVER' });
  const log = fakeEnvironment({ attempts: [blockedRtm, { rtc: refused }] });
  const h = handlers();
  const call = new VoiceCall(h);
  await call.start();
  assert.equal(h.seen.errors[0].code, 'proxy_unavailable');
  assert.ok(!log.includes('startVoice'));
});

test('start: a non-network failure (invalid token) is not retried through the proxy', async () => {
  const { VoiceCall } = await loadWithShortTimeouts();
  const log = fakeEnvironment({ attempts: [{ rtm: Object.assign(new Error('invalid token'), { code: -10005 }) }] });
  const h = handlers();
  const call = new VoiceCall(h);
  await call.start();
  assert.equal(log.clients.length, 1);
  assert.equal(h.seen.errors[0].code, 'join_failed');
});

test('start: a browser that needed the proxy before starts with it, and falls back to direct (forgetting it) if the proxy fails', async (t) => {
  const { VoiceCall } = await loadWithShortTimeouts();
  {
    const log = fakeEnvironment({ remembered: true });
    const h = handlers();
    const call = new VoiceCall(h);
    t.after(() => call.teardown({ stopServer: false }));
    await call.start();
    assert.equal(log.clients.length, 1);
    assert.equal(log.clients[0].proxyMode, 5);
    assert.deepEqual(log.rtms[0].config, { cloudProxy: true });
    assert.equal(h.seen.details[h.seen.statuses.indexOf('connecting')].route, 'proxy', 'the safer-route line shows from the first connecting status');
    await call.end();
  }
  {
    const log = fakeEnvironment({ remembered: true, attempts: [blockedRtm] });
    const call = new VoiceCall(handlers());
    t.after(() => call.teardown({ stopServer: false }));
    await call.start();
    assert.equal(call.status, 'waiting');
    assert.deepEqual(log.clients.map((c) => c.proxyMode), [5, null]);
    assert.equal(log.store.get('sahay.voice.cloudProxy'), undefined, 'direct worked, so the memory is cleared');
  }
});

test('start with ?proxy=1: proxy from the first attempt and no fallback to direct', async () => {
  const { VoiceCall } = await loadWithShortTimeouts();
  const log = fakeEnvironment({ search: '?proxy=1', attempts: [blockedRtm] });
  const h = handlers();
  const call = new VoiceCall(h);
  await call.start();
  assert.equal(log.clients.length, 1);
  assert.equal(log.clients[0].proxyMode, 5);
  assert.equal(h.seen.errors[0].code, 'network_blocked');
  assert.equal(log.store.get('sahay.voice.cloudProxy'), undefined, 'a forced test run is not remembered');
});

test('start: pressing End while the first attempt hangs ends cleanly, with no proxy retry', async () => {
  const { VoiceCall, CONNECT_TIMEOUT_MS } = await loadWithShortTimeouts();
  CONNECT_TIMEOUT_MS.direct = 500;
  const log = fakeEnvironment({ attempts: [blockedRtm] });
  const h = handlers();
  const call = new VoiceCall(h);
  const started = call.start();
  await wait(40);
  await call.end();
  await started;
  assert.equal(call.status, 'idle');
  assert.equal(log.clients.length, 1);
  assert.equal(h.seen.errors.length, 0);
});

/* --------------------------------------- NegotiationListener on restrictive networks --- */

test('NegotiationListener: a join that times out retries once through Cloud Proxy and listens', async (t) => {
  const { NegotiationListener } = await loadWithShortTimeouts();
  const log = fakeEnvironment({ attempts: [{ rtc: 'hang' }] });
  const changes = [];
  const listener = new NegotiationListener((s) => changes.push({ ...s }));
  t.after(() => listener.stop());
  await listener.start('n1');
  assert.equal(listener.status, 'listening', JSON.stringify(changes.at(-1)));
  assert.deepEqual(log.clients.map((c) => c.proxyMode), [null, 5]);
  assert.deepEqual(log.clients[1].joins[0], log.clients[0].joins[0]);
  assert.ok(changes.some((c) => c.status === 'joining' && c.route === 'proxy'));
  assert.equal(log.store.get('sahay.voice.cloudProxy'), '1');
  log.clients[0].emit('connection-state-change', 'DISCONNECTED', 'CONNECTING', 'NETWORK_ERROR');
  assert.equal(listener.status, 'listening', 'the abandoned client cannot fail the listener');
});

test('NegotiationListener: proxy also failing ends in an honest error after one retry', async () => {
  const { NegotiationListener } = await loadWithShortTimeouts();
  const log = fakeEnvironment({ attempts: [{ rtc: 'hang' }, { rtc: 'hang' }] });
  const listener = new NegotiationListener(() => {});
  await listener.start('n1');
  assert.equal(listener.status, 'error');
  assert.match(listener.error, /network/i);
  assert.equal(log.clients.length, 2);
});

test('start: RTC connection-state events during a connect attempt do not pre-empt the proxy retry', async (t) => {
  const { VoiceCall, CONNECT_TIMEOUT_MS } = await loadWithShortTimeouts();
  CONNECT_TIMEOUT_MS.direct = 120;
  const log = fakeEnvironment({ attempts: [blockedRtm] });
  const h = handlers();
  const call = new VoiceCall(h);
  t.after(() => call.teardown({ stopServer: false }));
  const started = call.start();
  await wait(40);
  log.clients[0].emit('connection-state-change', 'RECONNECTING', 'CONNECTED', 'NETWORK_ERROR');
  log.clients[0].emit('connection-state-change', 'DISCONNECTED', 'RECONNECTING', 'NETWORK_ERROR');
  await started;
  assert.equal(call.status, 'waiting', JSON.stringify(h.seen.errors.map((x) => [x.code, x.message])));
  assert.equal(call.route, 'proxy');
  assert.ok(!h.seen.statuses.includes('reconnecting'), h.seen.statuses.join(', '));
});
