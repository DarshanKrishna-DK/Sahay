"use strict";

/**
 * Telegram as an owner follow-up notifier only (decisions.md D1): order
 * confirmed, PO PDF, payment link, delivery due. Messages go only to a chat the
 * owner linked with a one-time code; the bot answers nothing but `/start <code>`.
 *
 * Bot API (core.telegram.org/bots/api, read 2026-11-19): sendMessage {chat_id, text,
 * link_preview_options: LinkPreviewOptions {is_disabled: true}} (re-read 2026-11-20: every message goes
 * without a link preview; a pay link made a huge card, E2E regress bug 6),
 * sendDocument multipart {chat_id, document}, getUpdates {offset, timeout, allowed_updates}.
 * The bot token is part of every URL, so a URL is never logged.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { config } = require("../config");
const repo = require("../db/repo");
const events = require("../events");

const BOT_USERNAME = "sahaymitra_bot";
const LINK_CODE_SECONDS = 15 * 60;
const POLL_TIMEOUT_SECONDS = 25;
const REQUEST_TIMEOUT_MS = 15000;

class TelegramError extends Error {
  constructor(code, message, { status } = {}) {
    super(message);
    this.name = "TelegramError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

let fetchImpl = (...args) => fetch(...args);
/** Tests replace the network boundary. Pass null to restore the global fetch. */
function setFetch(fn) {
  fetchImpl = fn ?? ((...args) => fetch(...args));
}

function isConfigured() {
  return Boolean(config.telegram?.botToken);
}

async function api(method, { json, form, timeoutMs = REQUEST_TIMEOUT_MS, signal } = {}) {
  if (!isConfigured()) throw new TelegramError("NOT_CONFIGURED", "TELEGRAM_BOT_TOKEN is not set.");
  let res;
  try {
    res = await fetchImpl(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
      method: "POST",
      headers: json ? { "Content-Type": "application/json" } : undefined,
      body: json ? JSON.stringify(json) : form,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new TelegramError("UNREACHABLE", `Telegram ${method} did not answer (${err.name === "TimeoutError" ? "timed out" : err.name}).`);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || !body?.ok) {
    const description = typeof body?.description === "string" ? body.description.slice(0, 200) : `HTTP ${res.status}`;
    throw new TelegramError("REFUSED", `Telegram ${method} refused: ${description}`, { status: res.status });
  }
  return body.result;
}

/**
 * Send a text (and optionally a document) to the business owner's linked chat.
 * Resolves `{sent: false, reason: "not_linked" | "not_configured"}` when there is
 * nowhere to send; throws TelegramError when Telegram refuses.
 */
/** A sendMessage body: never a link preview. */
const textMessage = (chatId, text) => ({ chat_id: chatId, text, link_preview_options: { is_disabled: true } });

async function sendToOwner(businessId, text, { documentPath } = {}) {
  if (!isConfigured()) return { sent: false, reason: "not_configured" };
  const link = repo.getTelegramLink(businessId);
  if (!link) return { sent: false, reason: "not_linked" };
  const message = await api("sendMessage", { json: textMessage(link.chat_id, String(text).slice(0, 4096)) });
  let document = null;
  if (documentPath) {
    const form = new FormData();
    form.append("chat_id", String(link.chat_id));
    form.append("document", await fs.openAsBlob(documentPath, { type: "application/pdf" }), path.basename(documentPath));
    document = await api("sendDocument", { form, timeoutMs: 60000 });
  }
  return { sent: true, messageId: message?.message_id ?? null, documentMessageId: document?.message_id ?? null };
}

/** POST /api/telegram/link-code: a one-time code and the deep link that carries it. */
function createLinkCode(businessId, { now = Date.now() } = {}) {
  const code = crypto.randomBytes(12).toString("base64url"); // 16 chars of [A-Za-z0-9_-], allowed in a start parameter
  const expiresAt = new Date(now + LINK_CODE_SECONDS * 1000).toISOString();
  repo.createLinkCode(businessId, { code, expires_at: expiresAt });
  return { code, deepLink: `https://t.me/${BOT_USERNAME}?start=${code}`, expiresAt };
}

const LINKED = {
  "hi-IN": (name) => `यह चैट ${name} के लिए सहाय की सूचनाओं से जुड़ गई है।`,
  "kn-IN": (name) => `ಈ ಚಾಟ್ ${name} ಗಾಗಿ ಸಹಾಯ್ ಸೂಚನೆಗಳಿಗೆ ಜೋಡಣೆಯಾಗಿದೆ.`,
  "en-IN": (name) => `This chat now receives Sahay notifications for ${name}.`,
};
const BAD_CODE = "This link code is not valid or has expired. Create a new one in the Sahay console.";

/**
 * Handle one Telegram update. Only a private-chat `/start <code>` does anything:
 * it redeems the code and links that chat to the business the code was made for.
 * Returns what happened, for tests and logs.
 */
async function handleUpdate(update) {
  const message = update?.message;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})$/.exec(text);
  if (!match || message?.chat?.type !== "private" || message.chat.id == null) return { handled: false };

  const businessId = repo.system.redeemLinkCode(match[1]);
  if (!businessId) {
    await api("sendMessage", { json: textMessage(message.chat.id, BAD_CODE) });
    return { handled: true, linked: false };
  }
  repo.setTelegramLink(businessId, String(message.chat.id));
  const business = repo.getBusiness(businessId);
  const say = LINKED[business?.language] ?? LINKED["en-IN"];
  events.emit(businessId, "telegram.linked", { linked: true }, { actor: "owner" });
  await api("sendMessage", { json: textMessage(message.chat.id, say(business?.name ?? "")) });
  return { handled: true, linked: true, businessId };
}

/**
 * Long-poll getUpdates until `signal` aborts. Only "message" updates are asked
 * for. A failure waits and retries; a 409 (a webhook is set elsewhere) stops.
 */
async function startPolling({ signal, retryMs = 5000 } = {}) {
  if (!isConfigured()) return;
  let offset = 0;
  while (!signal?.aborted) {
    try {
      const updates = await api("getUpdates", {
        json: { offset, timeout: POLL_TIMEOUT_SECONDS, allowed_updates: ["message"] },
        timeoutMs: (POLL_TIMEOUT_SECONDS + 10) * 1000,
        signal,
      });
      for (const update of updates ?? []) {
        offset = Math.max(offset, update.update_id + 1);
        try {
          await handleUpdate(update);
        } catch (err) {
          console.warn(`[telegram] update not handled: ${err.message}`);
        }
      }
    } catch (err) {
      if (signal?.aborted) return;
      if (err.status === 409) {
        console.warn("[telegram] getUpdates conflicts with a webhook; polling stopped.");
        return;
      }
      console.warn(`[telegram] ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, retryMs).unref?.());
    }
  }
}

module.exports = { TelegramError, BOT_USERNAME, setFetch, isConfigured, sendToOwner, createLinkCode, handleUpdate, startPolling };
