'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The live test needs the real key. Load it without reading or printing it: this checkout's .env,
// else the main checkout's (git worktrees have no .env of their own).
for (const envFile of [path.join(__dirname, '..', '.env'), 'D:\\Sahay\\.env']) {
  if (fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
    break;
  }
}
const liveKey = process.env.GROQ_API_KEY;
const liveModel = process.env.GROQ_EXTRACT_MODEL;

const { completeJSON, LLMError } = require('../src/llm');

const FAKE_KEY = 'gsk_fake-unit-test-key'; // not key-shaped on purpose: the commit hook rejects real-looking keys
const ask = { system: 'Extract the rate.', user: 'Rate is 70 rupees a kilo.' };

const completion = (content, extra = {}) => new Response(
  JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop', ...extra }] }),
  { status: 200, headers: { 'content-type': 'application/json' } },
);
const failure = (status, message, headers = {}) => new Response(JSON.stringify({ error: { message } }), { status, headers });

const realFetch = globalThis.fetch;

/**
 * Replaces global fetch with a scripted sequence of replies until the test ends; returns the
 * recorded calls. Assigned directly, not with t.mock.method: mocking a method twice in one test
 * restores it to the first mock, which would then answer the live test below.
 */
function scriptFetch(t, ...replies) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, at: Date.now() });
    const reply = replies[Math.min(calls.length, replies.length) - 1];
    return typeof reply === 'function' ? reply(init) : reply.clone();
  };
  t.after(() => { globalThis.fetch = realFetch; });
  return calls;
}

test.beforeEach(() => {
  process.env.GROQ_API_KEY = FAKE_KEY;
  delete process.env.GROQ_EXTRACT_MODEL;
});
test.after(() => {
  if (liveKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = liveKey;
});

test('sends one JSON-mode request to Groq and returns the parsed object', async (t) => {
  const calls = scriptFetch(t, completion('{"rate":70,"unit":"kg"}'));
  const result = await completeJSON({ ...ask, schemaHint: '{"rate":0,"unit":""}' });

  assert.deepEqual(result, { rate: 70, unit: 'kg' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'openai/gpt-oss-20b');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
  assert.match(body.messages[0].content, /^Extract the rate\./);
  assert.match(body.messages[0].content, /JSON object only, shaped like: \{"rate":0,"unit":""\}/);
  assert.equal(body.messages[1].content, ask.user);
});

test('model comes from GROQ_EXTRACT_MODEL, or the argument', async (t) => {
  const calls = scriptFetch(t, completion('{}'));
  process.env.GROQ_EXTRACT_MODEL = 'some/other-model';
  await completeJSON(ask);
  await completeJSON({ ...ask, model: 'explicit/model' });
  assert.deepEqual(calls.map((c) => JSON.parse(c.init.body).model), ['some/other-model', 'explicit/model']);
});

test('fails with no_key before any request when GROQ_API_KEY is missing', async (t) => {
  const calls = scriptFetch(t, completion('{}'));
  delete process.env.GROQ_API_KEY;
  await assert.rejects(completeJSON(ask), (err) => err instanceof LLMError && err.code === 'no_key');
  assert.equal(calls.length, 0);
});

test('rejects a call with no instructions or no input', async () => {
  await assert.rejects(completeJSON({ user: 'x' }), TypeError);
  await assert.rejects(completeJSON({ system: 'x', user: '  ' }), TypeError);
  await assert.rejects(completeJSON(), TypeError);
});

test('recovers an object wrapped in prose; anything else is bad_json with a clear message', async (t) => {
  scriptFetch(t, completion('Here you go:\n{"rate":70}\nHope that helps.'));
  assert.deepEqual(await completeJSON(ask), { rate: 70 });

  for (const content of ['the rate is seventy', '{"rate": 70', '[1,2]', '"just a string"']) {
    scriptFetch(t, completion(content));
    await assert.rejects(completeJSON(ask), (err) => {
      assert.ok(err instanceof LLMError);
      assert.equal(err.code, 'bad_json');
      assert.match(err.message, /^Groq reply was not a JSON object: /);
      return true;
    });
  }
});

test('an empty reply and a non-JSON body are distinct errors', async (t) => {
  scriptFetch(t, completion('', { finish_reason: 'length' }));
  await assert.rejects(completeJSON(ask), (err) => err.code === 'empty' && /finish_reason: length/.test(err.message));

  scriptFetch(t, new Response('<html>gateway</html>', { status: 200 }));
  await assert.rejects(completeJSON(ask), (err) => err.code === 'bad_response');
});

test('retries once on 429 after the Retry-After wait', async (t) => {
  const calls = scriptFetch(t, failure(429, 'Rate limit reached', { 'retry-after': '0.08' }), completion('{"ok":true}'));
  assert.deepEqual(await completeJSON(ask), { ok: true });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].at - calls[0].at >= 70, `retried after ${calls[1].at - calls[0].at} ms, before Retry-After elapsed`);
});

test('retries once on a 5xx, and only once', async (t) => {
  const recovered = scriptFetch(t, failure(503, 'unavailable', { 'retry-after': '0' }), completion('{"ok":true}'));
  assert.deepEqual(await completeJSON(ask), { ok: true });
  assert.equal(recovered.length, 2);

  const stillDown = scriptFetch(t, failure(500, 'boom', { 'retry-after': '0' }));
  await assert.rejects(completeJSON(ask), (err) => err.code === 'http' && err.status === 500 && err.message === 'Groq 500: boom');
  assert.equal(stillDown.length, 2);

  const limited = scriptFetch(t, failure(429, 'slow down', { 'retry-after': '0' }));
  await assert.rejects(completeJSON(ask), (err) => err.code === 'rate_limited' && err.status === 429);
  assert.equal(limited.length, 2);
});

test('does not retry a 4xx', async (t) => {
  const calls = scriptFetch(t, failure(400, 'model does not support json mode'));
  await assert.rejects(completeJSON(ask), (err) => err.code === 'http' && err.status === 400 && /json mode/.test(err.message));
  assert.equal(calls.length, 1);
});

test('gives up at once when Retry-After is longer than the time budget', async (t) => {
  const calls = scriptFetch(t, failure(429, 'try again in 60s', { 'retry-after': '60' }), completion('{}'));
  const started = Date.now();
  await assert.rejects(completeJSON({ ...ask, timeoutMs: 500 }), (err) => err.code === 'rate_limited');
  assert.equal(calls.length, 1);
  assert.ok(Date.now() - started < 400);
});

/** A fetch that never answers; it rejects the way fetch does when its signal aborts. */
const hang = (init) => new Promise((_, reject) => {
  init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
});

test('times out as a typed error', async (t) => {
  scriptFetch(t, hang);
  const started = Date.now();
  await assert.rejects(completeJSON({ ...ask, timeoutMs: 60 }), (err) => {
    assert.ok(err instanceof LLMError);
    assert.equal(err.code, 'timeout');
    assert.equal(err.message, 'Groq did not answer within 60 ms');
    return true;
  });
  assert.ok(Date.now() - started < 2000);
});

test('the timeout covers the retry wait as well', async (t) => {
  const calls = scriptFetch(t, failure(503, 'unavailable', { 'retry-after': '0.02' }), hang);
  await assert.rejects(completeJSON({ ...ask, timeoutMs: 150 }), (err) => err.code === 'timeout');
  assert.equal(calls.length, 2);
});

test('a caller abort is rethrown as the caller\'s own reason', async (t) => {
  scriptFetch(t, hang);
  const controller = new AbortController();
  const reason = new Error('job cancelled');
  setTimeout(() => controller.abort(reason), 20);
  await assert.rejects(completeJSON({ ...ask, signal: controller.signal }), (err) => err === reason);
});

test('a network failure is a typed error', async (t) => {
  scriptFetch(t, () => Promise.reject(new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) })));
  await assert.rejects(completeJSON(ask), (err) => err instanceof LLMError && err.code === 'network' && err.message === 'Could not reach Groq: ENOTFOUND');
});

test('the API key never appears in an error message', async (t) => {
  scriptFetch(t, failure(401, `Invalid API Key ${FAKE_KEY}`));
  await assert.rejects(completeJSON(ask), (err) => {
    assert.equal(err.code, 'http');
    assert.doesNotMatch(err.message, new RegExp(FAKE_KEY));
    assert.match(err.message, /gsk_\[redacted\]/);
    return true;
  });

  scriptFetch(t, completion(`not json ${FAKE_KEY}`));
  await assert.rejects(completeJSON(ask), (err) => err.code === 'bad_json' && !err.message.includes(FAKE_KEY));
});

test('LIVE Groq: returns a JSON object for a real extraction', { skip: liveKey ? false : 'live Groq call is opt-in (GROQ_LIVE_TEST=1 with GROQ_API_KEY set)' }, async (t) => {
  assert.equal(globalThis.fetch, realFetch, 'a stub from an earlier test is still installed: this would not be a live result');
  process.env.GROQ_API_KEY = liveKey;
  if (liveModel) process.env.GROQ_EXTRACT_MODEL = liveModel;
  const started = Date.now();
  const reply = await completeJSON({
    system: 'Extract the price per unit from what the vendor said. Use null for anything not stated.',
    user: 'Vendor: Basmati ka rate 80 rupaye kilo padega, minimum 50 kilo lena hoga.',
    schemaHint: '{"unit_price":0,"unit":"kg","moq":0}',
  });
  t.diagnostic(`model ${liveModel || 'openai/gpt-oss-20b'} answered in ${Date.now() - started} ms: ${JSON.stringify(reply)}`);
  assert.equal(typeof reply, 'object');
  assert.equal(Number(reply.unit_price), 80);
  assert.equal(Number(reply.moq), 50);
});
