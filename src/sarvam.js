const { config } = require("./config");

class SarvamError extends Error {
  constructor(message, status) { super(message); this.name = "SarvamError"; this.status = status; }
}

function headers(json = true) {
  if (!config.sarvam.key) throw new SarvamError("SARVAM_API_KEY is not set", 401);
  return { "api-subscription-key": config.sarvam.key, ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function post(path, body) {
  const resp = await fetch(config.sarvam.base + path, {
    method: "POST", headers: headers(), body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) {
    throw new SarvamError(`Sarvam ${path} (${resp.status}): ${data?.error?.message || data?.detail || text.slice(0, 200)}`, resp.status);
  }
  return data;
}

/**
 * Sarvam's translate endpoint caps input length, so long text is split before
 * sending. We split on LINE boundaries first and only fall back to sentence
 * splitting inside an over-long line: the digest is a numbered list, and
 * keeping one line per request preserves its structure through translation.
 */
const CHUNK = 800;
function chunkText(text) {
  const parts = [];
  for (const line of text.split("\n")) {
    if (line.length <= CHUNK) { parts.push(line); continue; }
    let buf = "";
    for (const sentence of line.split(/(?<=[.!?\u0964])\s+/)) {
      if ((buf + " " + sentence).length > CHUNK && buf) { parts.push(buf.trim()); buf = sentence; }
      else buf += (buf ? " " : "") + sentence;
    }
    if (buf.trim()) parts.push(buf.trim());
  }
  return parts;
}

/**
 * sarvam-translate:v1 is LLM-based and occasionally answers conversationally
 * ("Here's the translation of the English text into Hindi:") instead of
 * returning the translation alone. That preamble would be read aloud to the
 * owner by TTS, so it is stripped rather than shipped.
 */
const PREAMBLE = /^\s*(here\s*(?:'|\u2019)?s|here is|below is|the following is|sure|translation|\u0905\u0928\u0941\u0935\u093e\u0926)\b[^\n:]{0,140}:\s*/i;
function stripPreamble(translated, original) {
  let out = translated.replace(PREAMBLE, "").trim();
  // A model that refuses or echoes the instruction is worse than no translation.
  if (!out) return original;
  return out;
}

/**
 * Indic script ranges (Devanagari through Malayalam, plus Bengali/Gujarati etc).
 * If the text is already largely in an Indic script, translating it again with
 * source_language_code "en-IN" produces mangled half-English output - so we
 * detect that case and pass the text through untouched.
 */
const INDIC = /[ऀ-ൿ]/g;
function isAlreadyIndic(text) {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 12) return false;
  return ((text.match(INDIC) || []).length / letters.length) > 0.2;
}

async function translate(text, targetLang = "hi-IN", sourceLang = "en-IN") {
  if (!text || !text.trim()) return "";
  if (targetLang === sourceLang || targetLang === "en-IN") return text;
  if (sourceLang === "en-IN" && isAlreadyIndic(text)) return text;
  const out = [];
  for (const c of chunkText(text)) {
    if (!c.trim()) { out.push(""); continue; }
    const data = await post("/translate", {
      input: c,
      source_language_code: sourceLang,
      target_language_code: targetLang,
      model: config.sarvam.translateModel,
    });
    out.push(stripPreamble(data.translated_text || c, c));
  }
  return out.join("\n").trim();
}

/**
 * Text-to-speech. Returns an array of base64 audio chunks, one per segment, so
 * a long digest still plays end to end.
 *
 * Two codecs, for two different consumers:
 *   wav  - what a browser <audio> plays from a data: URI without fuss.
 *   opus - Ogg Opus, which is the ONLY thing Telegram renders as a real voice
 *          bubble. Sent as WAV it arrives as a file attachment instead, which
 *          is a much weaker thing to hand a shop owner.
 *
 * Opus additionally requires one of Sarvam's supported sample rates; the
 * default 22050 is rejected outright.
 */
async function textToSpeech(text, langCode = "hi-IN", { codec = "wav" } = {}) {
  if (!text || !text.trim()) return [];
  const audios = [];
  for (const c of chunkText(text).slice(0, 6)) {
    const data = await post("/text-to-speech", {
      text: c,
      target_language_code: langCode,
      model: config.sarvam.ttsModel,
      speaker: config.sarvam.ttsSpeaker,
      ...(codec === "opus" ? { output_audio_codec: "opus", speech_sample_rate: 24000 } : {}),
    });
    audios.push(...(data.audios || []));
  }
  return audios;
}

/** Ogg Opus buffers, ready for Telegram's sendVoice. */
async function speak(text, langCode = "hi-IN") {
  const audios = await textToSpeech(text, langCode, { codec: "opus" });
  return audios.map((a) => Buffer.from(a, "base64"));
}

/**
 * Browsers hand back a MediaRecorder mime type with codec parameters attached,
 * e.g. "audio/webm;codecs=opus". Sarvam matches the type string exactly and
 * rejects anything with a suffix, so the parameters are stripped here rather
 * than at each call site.
 */
const EXT_BY_TYPE = {
  "audio/webm": "webm", "video/webm": "webm",
  "audio/ogg": "ogg", "audio/opus": "ogg",
  "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  "audio/aac": "aac", "audio/flac": "flac",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
};

function normaliseAudioType(mimeType) {
  const base = String(mimeType || "audio/wav").split(";")[0].trim().toLowerCase();
  return { type: EXT_BY_TYPE[base] ? base : "application/octet-stream", ext: EXT_BY_TYPE[base] || "bin" };
}

/** Speech-to-text for the owner's spoken question (PRD 6.6 / Phase 5). */
async function speechToText(audioBuffer, mimeType = "audio/wav") {
  const { type, ext } = normaliseAudioType(mimeType);
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type }), `query.${ext}`);
  form.append("model", config.sarvam.sttModel);
  const resp = await fetch(`${config.sarvam.base}/speech-to-text`, {
    method: "POST", headers: headers(false), body: form,
  });
  const text = await resp.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) throw new SarvamError(`Sarvam STT (${resp.status}): ${data?.error?.message || data?.detail || text.slice(0, 200)}`, resp.status);
  return { transcript: data.transcript || "", language: data.language_code || null, confidence: data.language_probability ?? null };
}

module.exports = { translate, textToSpeech, speak, speechToText, SarvamError };
