#!/usr/bin/env node
/**
 * Pre-flight check. Verifies the three connectors against the LIVE APIs and,
 * where a model name is wrong, tells you which models the key can actually use.
 *
 * This exists because the failure that costs the most time here is silent:
 * a wrong model id or a changed endpoint looks exactly like "the app is broken".
 */
const { config, missingKeys } = require("../src/config");

const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const fail = (m) => console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
const info = (m) => console.log(`        \x1b[90m${m}\x1b[0m`);

let failures = 0;

async function checkGroq() {
  process.stdout.write("\nGroq (reasoning)\n");
  if (!config.groq.key) { fail("GROQ_API_KEY is not set"); failures++; return; }

  const listResp = await fetch(`${config.groq.base}/models`, { headers: { Authorization: `Bearer ${config.groq.key}` } });
  if (!listResp.ok) { fail(`cannot list models (${listResp.status}) - is the key valid?`); failures++; return; }
  const models = (await listResp.json()).data.map((m) => m.id);
  pass(`key valid, ${models.length} models available`);

  for (const [role, id] of [["chat", config.groq.model], ["extraction", config.groq.extractModel], ["fallback", config.groq.fallbackModel]]) {
    if (models.includes(id)) pass(`${role} model "${id}" is available`);
    else {
      fail(`${role} model "${id}" is NOT available on this key`);
      const chat = models.filter((m) => /gpt-oss|qwen|llama-3|compound/.test(m) && !/guard|whisper|orpheus/.test(m));
      info(`try one of: ${chat.join(", ")}`);
      failures++;
    }
  }

  const r = await fetch(`${config.groq.base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.groq.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.groq.model, max_completion_tokens: 12, messages: [{ role: "user", content: "say ready" }] }),
  });
  if (r.ok) {
    const limit = r.headers.get("x-ratelimit-limit-tokens");
    pass("completion succeeded");
    if (limit) info(`rate limit: ${limit} tokens/min on ${config.groq.model} - Sahay schedules around this automatically`);
  } else { fail(`completion failed (${r.status}): ${(await r.text()).slice(0, 160)}`); failures++; }
}

async function checkAnakin() {
  process.stdout.write("\nAnakin (ingestion)\n");
  if (!config.anakin.key) { fail("ANAKIN_API_KEY is not set"); failures++; return; }

  const s = await fetch(`${config.anakin.base}/search`, {
    method: "POST",
    headers: { "X-API-Key": config.anakin.key, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "GST filing due date India", limit: 1 }),
  });
  if (!s.ok) { fail(`search failed (${s.status}): ${(await s.text()).slice(0, 160)}`); failures++; return; }
  const results = (await s.json()).results || [];
  pass(`search returned ${results.length} result(s)`);
  if (results[0]) info(results[0].url);

  const sub = await fetch(`${config.anakin.base}/url-scraper`, {
    method: "POST",
    headers: { "X-API-Key": config.anakin.key, "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com", formats: ["markdown"], country: config.anakin.country }),
  });
  if (!sub.ok) { fail(`scrape submit failed (${sub.status})`); failures++; return; }
  const { jobId } = await sub.json();
  pass(`scrape job accepted (${jobId})`);

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const j = await (await fetch(`${config.anakin.base}/url-scraper/${jobId}`, { headers: { "X-API-Key": config.anakin.key } })).json();
    if (j.status === "completed") { pass("scrape job polled to completion"); return; }
    if (j.status === "failed") { fail(`scrape job failed: ${j.error}`); failures++; return; }
  }
  fail("scrape job did not complete in 30s"); failures++;
}

async function checkSarvam() {
  process.stdout.write("\nSarvam (localisation)\n");
  if (!config.sarvam.key) { fail("SARVAM_API_KEY is not set"); failures++; return; }
  const H = { "api-subscription-key": config.sarvam.key, "Content-Type": "application/json" };

  const t = await fetch(`${config.sarvam.base}/translate`, {
    method: "POST", headers: H,
    body: JSON.stringify({ input: "Your competitor cut prices this week.", source_language_code: "en-IN", target_language_code: "hi-IN", model: config.sarvam.translateModel }),
  });
  if (t.ok) { pass(`translate (${config.sarvam.translateModel})`); info((await t.json()).translated_text); }
  else { fail(`translate failed (${t.status}): ${(await t.text()).slice(0, 200)}`); failures++; }

  const v = await fetch(`${config.sarvam.base}/text-to-speech`, {
    method: "POST", headers: H,
    body: JSON.stringify({ text: "नमस्ते", target_language_code: "hi-IN", model: config.sarvam.ttsModel, speaker: config.sarvam.ttsSpeaker }),
  });
  if (v.ok) pass(`text-to-speech (${config.sarvam.ttsModel} / ${config.sarvam.ttsSpeaker})`);
  else {
    const body = (await v.text()).slice(0, 260);
    fail(`text-to-speech failed (${v.status}): ${body}`);
    info("the error above usually names the valid models or speakers - copy one into SARVAM_TTS_SPEAKER");
    failures++;
  }
}

async function checkTelegram() {
  process.stdout.write("\nTelegram (owner interface)\n");
  if (!config.telegram.token) {
    info("TELEGRAM_BOT_TOKEN not set - the bot is disabled, the dashboard still works");
    return;
  }
  const r = await fetch(`https://api.telegram.org/bot${config.telegram.token}/getMe`);
  const d = await r.json();
  if (d.ok) pass(`bot @${d.result.username} reachable`);
  else { fail(`getMe failed: ${d.description}`); failures++; }
}

async function checkRazorpay() {
  process.stdout.write("\nRazorpay (payments)\n");
  if (!config.razorpay.keyId || !config.razorpay.keySecret) {
    info("Razorpay keys not set - orders still work, payment links will not");
    return;
  }
  const auth = "Basic " + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64");
  const r = await fetch(`${config.razorpay.base}/payment_links?count=1`, { headers: { Authorization: auth } });
  if (r.ok) pass(`keys valid (${config.razorpay.keyId.startsWith("rzp_test") ? "test mode" : "LIVE mode"})`);
  else { fail(`payment link API rejected the keys (${r.status})`); failures++; }
}

/**
 * Which negotiation channel can actually carry a call right now. This is the
 * check that catches the most confusing possible failure: everything green,
 * but nothing to talk over.
 */
function checkChannels() {
  process.stdout.write("\nNegotiation channel\n");
  const { channelStatus } = require("../src/channels");
  const statuses = channelStatus();
  for (const c of statuses) {
    const mark = c.name === config.procurement.channel ? " (active)" : "";
    if (c.available) pass(`${c.name}${mark} - ${c.reason}`);
    else info(`${c.name}${mark} - ${c.reason}`);
  }
  const active = statuses.find((c) => c.name === config.procurement.channel);
  if (active && !active.available) {
    fail(`the active channel "${config.procurement.channel}" cannot run a negotiation`);
    failures++;
  }
}

(async () => {
  console.log("\n\x1b[1mSahay pre-flight\x1b[0m");
  const missing = missingKeys();
  if (missing.length) console.log(`\n  Missing from .env: ${missing.join(", ")}`);

  for (const check of [checkGroq, checkAnakin, checkSarvam, checkTelegram, checkRazorpay]) {
    try { await check(); } catch (err) { fail(err.message); failures++; }
  }

  try { checkChannels(); } catch (err) { fail(err.message); failures++; }

  console.log("");
  if (failures) {
    console.log(`\x1b[31m${failures} check(s) failed.\x1b[0m Sahay will not invent data to cover a broken connector, so fix these before running.\n`);
    process.exit(1);
  }
  console.log("\x1b[32mAll connectors live.\x1b[0m  Start with: npm start\n");
})();
