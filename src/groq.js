const { config } = require("./config");

class GroqError extends Error {
  constructor(message, status, retryAfterMs) {
    super(message);
    this.name = "GroqError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Groq's free tier enforces a tokens-per-minute ceiling *per model*
 * (8,000 TPM on gpt-oss-120b at time of writing). A four-module run fires
 * a dozen completions, which exhausts a minute's budget in about a second.
 *
 * This scheduler makes that a scheduling problem instead of a failure:
 *  - one queue per model, so the two models Sahay uses have independent budgets
 *  - a rolling 60s ledger of spent tokens, so we wait *before* being rejected
 *  - self-calibration from the x-ratelimit-* headers Groq returns
 *  - honouring the retry-after hint when we get it wrong anyway
 */
class ModelQueue {
  constructor(model) {
    this.model = model;
    this.limit = 8000;         // conservative default until headers tell us more
    this.spent = [];           // [{ at, tokens }] over the trailing minute
    this.chain = Promise.resolve();
  }

  _trim() {
    const cutoff = Date.now() - 60_000;
    this.spent = this.spent.filter((s) => s.at > cutoff);
  }

  _used() {
    this._trim();
    return this.spent.reduce((n, s) => n + s.tokens, 0);
  }

  /** Block until `estimate` tokens fit inside the trailing-minute budget. */
  async _reserve(estimate) {
    // Keep 12% headroom: our estimate is approximate and Groq counts differently.
    const ceiling = Math.max(1000, Math.floor(this.limit * 0.88));
    for (let i = 0; i < 30; i++) {
      const used = this._used();
      if (used + estimate <= ceiling || !this.spent.length) return;
      const oldest = this.spent[0];
      const waitMs = Math.max(500, 60_000 - (Date.now() - oldest.at) + 250);
      await sleep(Math.min(waitMs, 20_000));
    }
  }

  _record(tokens) {
    this.spent.push({ at: Date.now(), tokens });
  }

  /** Serialise work per model so two callers cannot both spend the last budget. */
  run(task) {
    const next = this.chain.then(task, task);
    // Keep the chain alive even when a task rejects.
    this.chain = next.then(() => {}, () => {});
    return next;
  }
}

const queues = new Map();
const queueFor = (model) => {
  if (!queues.has(model)) queues.set(model, new ModelQueue(model));
  return queues.get(model);
};

/** Rough token estimate: ~4 characters per token, plus the reply allowance. */
function estimateTokens(messages, maxTokens) {
  const chars = messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 200), 0);
  return Math.ceil(chars / 4) + maxTokens + 200;
}

function parseRetryAfter(body, headers) {
  const header = headers.get("retry-after");
  if (header && !Number.isNaN(Number(header))) return Number(header) * 1000;
  const m = /try again in ([\d.]+)s/i.exec(body || "");
  if (m) return Math.ceil(Number(m[1]) * 1000) + 400;
  return 6000;
}

async function callOnce(model, messages, opts) {
  const { json, temperature, tools, maxTokens } = opts;
  const resp = await fetch(`${config.groq.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.groq.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_completion_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      ...(tools ? { tools, tool_choice: "auto" } : {}),
    }),
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  const q = queueFor(model);
  // Calibrate the ceiling from Groq's own accounting whenever it tells us.
  const limitHeader = Number(resp.headers.get("x-ratelimit-limit-tokens"));
  if (Number.isFinite(limitHeader) && limitHeader > 0) q.limit = limitHeader;

  if (!resp.ok) {
    const msg = data?.error?.message || text.slice(0, 300);
    throw new GroqError(`Groq (${resp.status}): ${msg}`, resp.status,
      resp.status === 429 ? parseRetryAfter(msg, resp.headers) : undefined);
  }

  const used = data.usage?.total_tokens;
  if (Number.isFinite(used)) {
    // Replace our estimate with the true cost for this call.
    q.spent.push({ at: Date.now(), tokens: used });
  }
  return data.choices?.[0]?.message || {};
}

/**
 * Chat completion with budgeting, 429 backoff and a model fallback.
 * We never substitute placeholder text for a real answer - a silent mock is
 * far worse than a visible error for a tool people make money decisions on.
 */
async function chat(messages, opts = {}) {
  if (!config.groq.key) throw new GroqError("GROQ_API_KEY is not set", 401);
  const {
    json = false, temperature = 0.25, tools, maxTokens = 1200,
    model = config.groq.model, retries = 3,
  } = opts;
  const callOpts = { json, temperature, tools, maxTokens };
  const estimate = estimateTokens(messages, maxTokens);

  const attemptOn = async (m) => {
    const q = queueFor(m);
    return q.run(async () => {
      let lastErr;
      for (let attempt = 0; attempt <= retries; attempt++) {
        await q._reserve(estimate);
        try {
          return await callOnce(m, messages, callOpts);
        } catch (err) {
          lastErr = err;
          if (err.status === 429) {
            // Groq rejected us: treat the estimate as spent and wait it out.
            q._record(estimate);
            await sleep(err.retryAfterMs ?? 6000);
            continue;
          }
          if (err.status >= 500 && attempt < retries) {
            await sleep(800 * (attempt + 1));
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    });
  };

  try {
    return await attemptOn(model);
  } catch (err) {
    if (err.status === 401 || !config.groq.fallbackModel || model === config.groq.fallbackModel) throw err;
    // A different model has an independent rate-limit bucket, so this is a
    // genuine second chance rather than a retry against the same ceiling.
    return attemptOn(config.groq.fallbackModel);
  }
}

async function chatText(messages, opts = {}) {
  const msg = await chat(messages, opts);
  return (msg.content || "").trim();
}

/**
 * JSON-mode call. Models occasionally wrap JSON in prose even in json_object
 * mode, so we salvage the outermost balanced object before giving up.
 */
async function chatJSON(messages, opts = {}) {
  const raw = await chatText(messages, { ...opts, json: true });
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new GroqError(`Groq did not return valid JSON: ${raw.slice(0, 200)}`);
}

/** High-volume structured extraction runs on the small model's own budget. */
const extract = (messages, opts = {}) =>
  chatJSON(messages, { ...opts, model: opts.model || config.groq.extractModel });

function budgetStatus() {
  return [...queues.values()].map((q) => ({ model: q.model, limitTpm: q.limit, usedLastMinute: q._used() }));
}

module.exports = { chat, chatText, chatJSON, extract, budgetStatus, GroqError };
