'use strict';

/**
 * Groq JSON client for small background extraction (item -> category slug, quote from a
 * transcript). Never on the live voice path: one bounded call, one retry, typed errors.
 *
 * Reads GROQ_API_KEY and GROQ_EXTRACT_MODEL from process.env at call time.
 */

const { setTimeout: sleep } = require('node:timers/promises');

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const MAX_ATTEMPTS = 2;

/** code: no_key | timeout | network | rate_limited | http | bad_response | empty | bad_json */
class LLMError extends Error {
  constructor(code, message, { status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LLMError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

/** Groq error bodies should never echo a key, but nothing key-shaped leaves this module. */
const redact = (text) => String(text).replace(/gsk_[A-Za-z0-9_-]+/g, 'gsk_[redacted]');

/** Retry-After is seconds (Groq sends decimals) or an HTTP date. */
function retryAfterMs(headers) {
  const header = headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  return 1000;
}

function errorMessageFrom(bodyText) {
  try {
    const message = JSON.parse(bodyText)?.error?.message;
    if (typeof message === 'string' && message) return redact(message);
  } catch { /* not JSON: fall through to the raw text */ }
  return redact(bodyText.slice(0, 200));
}

/** The assistant message text out of a chat-completions response body. */
function replyContent(bodyText) {
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new LLMError('bad_response', `Groq returned a non-JSON body: ${redact(bodyText.slice(0, 200))}`);
  }
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new LLMError('empty', `Groq returned no content (finish_reason: ${choice?.finish_reason ?? 'unknown'})`);
  }
  return content;
}

/** The model's reply as an object. JSON mode still occasionally wraps the object in prose. */
function parseReply(content) {
  const candidates = [content];
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(content.slice(start, end + 1));
  for (const text of candidates) {
    try {
      const value = JSON.parse(text);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* try the next candidate */ }
  }
  throw new LLMError('bad_json', `Groq reply was not a JSON object: ${redact(content.slice(0, 200))}`);
}

/**
 * One JSON-mode completion.
 *
 * @param {object} args
 * @param {string} args.system      instructions
 * @param {string} args.user        the text to work on
 * @param {string} [args.schemaHint] example of the JSON shape wanted, appended to the instructions
 * @param {string} [args.model]
 * @param {number} [args.timeoutMs] budget for the whole call, including the retry and its wait
 * @param {AbortSignal} [args.signal] caller cancellation; its abort reason is rethrown as is
 * @returns {Promise<object>} the parsed JSON object
 * @throws {LLMError}
 */
async function completeJSON({
  system,
  user,
  schemaHint,
  model = process.env.GROQ_EXTRACT_MODEL || DEFAULT_MODEL,
  timeoutMs = 20000,
  signal,
} = {}) {
  if (typeof system !== 'string' || !system.trim()) throw new TypeError('completeJSON: system must be a non-empty string');
  if (typeof user !== 'string' || !user.trim()) throw new TypeError('completeJSON: user must be a non-empty string');
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new LLMError('no_key', 'GROQ_API_KEY is not set');

  const deadline = AbortSignal.timeout(timeoutMs);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const startedAt = Date.now();
  const request = {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${system}\n\nReply with one JSON object only${schemaHint ? `, shaped like: ${schemaHint}` : ''}.` },
        { role: 'user', content: user },
      ],
    }),
    signal: abort,
  };

  try {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(GROQ_CHAT_URL, request);
      const bodyText = await response.text();
      if (response.ok) return parseReply(replyContent(bodyText));

      const rateLimited = response.status === 429;
      const failure = new LLMError(
        rateLimited ? 'rate_limited' : 'http',
        `Groq ${response.status}: ${errorMessageFrom(bodyText)}`,
        { status: response.status },
      );
      if ((!rateLimited && response.status < 500) || attempt === MAX_ATTEMPTS) throw failure;

      const waitMs = retryAfterMs(response.headers);
      if (waitMs >= timeoutMs - (Date.now() - startedAt)) throw failure;
      await sleep(waitMs, undefined, { signal: abort });
    }
  } catch (err) {
    if (err instanceof LLMError) throw err;
    if (signal?.aborted) throw signal.reason;
    if (deadline.aborted) throw new LLMError('timeout', `Groq did not answer within ${timeoutMs} ms`, { cause: err });
    throw new LLMError('network', `Could not reach Groq: ${redact(err.cause?.code || err.message)}`, { cause: err });
  }
}

module.exports = { completeJSON, LLMError };
