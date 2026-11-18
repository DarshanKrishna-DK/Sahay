const { config } = require("./../config");

class TelegramError extends Error {
  constructor(message, code) { super(message); this.name = "TelegramError"; this.code = code; }
}

const base = () => {
  if (!config.telegram.token) throw new TelegramError("TELEGRAM_BOT_TOKEN is not set", 401);
  return `https://api.telegram.org/bot${config.telegram.token}`;
};

async function call(method, payload, { timeout = 30000 } = {}) {
  const resp = await fetch(`${base()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await resp.json().catch(() => ({ ok: false, description: "non-JSON response" }));
  if (!data.ok) throw new TelegramError(`${method}: ${data.description || resp.status}`, data.error_code);
  return data.result;
}

/** Multipart upload, used for voice notes and PO documents. */
async function upload(method, chatId, field, buffer, filename, extra = {}) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  for (const [k, v] of Object.entries(extra)) {
    form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  form.append(field, new Blob([buffer]), filename);
  const resp = await fetch(`${base()}/${method}`, { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
  const data = await resp.json().catch(() => ({ ok: false, description: "non-JSON response" }));
  if (!data.ok) throw new TelegramError(`${method}: ${data.description || resp.status}`, data.error_code);
  return data.result;
}

const getMe = () => call("getMe");

const sendMessage = (chatId, text, extra = {}) =>
  call("sendMessage", {
    chat_id: chatId,
    // Telegram hard-caps a message at 4096 characters.
    text: String(text).slice(0, 4000),
    ...extra,
  });

const sendChatAction = (chatId, action) =>
  call("sendChatAction", { chat_id: chatId, action }).catch(() => null);

/**
 * A real Telegram voice bubble requires Ogg Opus. Anything else (WAV, MP3) is
 * refused by sendVoice and has to go as a file attachment instead, which reads
 * as a document rather than someone speaking to you.
 *
 * So: Ogg goes out as a voice note, and anything else degrades to sendAudio
 * rather than failing.
 */
const sendVoice = (chatId, buffer, caption) => {
  const isOgg = buffer.length > 4 && buffer.slice(0, 4).toString("latin1") === "OggS";
  const extra = caption ? { caption: String(caption).slice(0, 900) } : {};
  return isOgg
    ? upload("sendVoice", chatId, "voice", buffer, "sahay.ogg", extra)
    : upload("sendAudio", chatId, "audio", buffer, "sahay.wav", extra);
};

const sendDocument = (chatId, buffer, filename, caption) =>
  upload("sendDocument", chatId, "document", buffer, filename,
    caption ? { caption: String(caption).slice(0, 900) } : {});

const answerCallbackQuery = (id, text) =>
  call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) }).catch(() => null);

const editMessageReplyMarkup = (chatId, messageId, markup) =>
  call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: markup || { inline_keyboard: [] } })
    .catch(() => null);

const getUpdates = (offset, timeout = 25) =>
  call("getUpdates", { offset, timeout, allowed_updates: ["message", "callback_query"] },
    { timeout: (timeout + 12) * 1000 });

const setMyCommands = (commands) => call("setMyCommands", { commands });

const deleteWebhook = () => call("deleteWebhook", { drop_pending_updates: false }).catch(() => null);

/** Download a file the user sent (voice note, document) as a Buffer. */
async function downloadFile(fileId) {
  const file = await call("getFile", { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!resp.ok) throw new TelegramError(`file download failed (${resp.status})`);
  return Buffer.from(await resp.arrayBuffer());
}

/** Inline keyboard helper: rows of [{ text, data }]. */
const keyboard = (rows) => ({
  inline_keyboard: rows.map((row) => row.map((b) =>
    b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data })),
});

module.exports = {
  call, getMe, sendMessage, sendChatAction, sendVoice, sendDocument,
  answerCallbackQuery, editMessageReplyMarkup, getUpdates, setMyCommands,
  deleteWebhook, downloadFile, keyboard, TelegramError,
};
