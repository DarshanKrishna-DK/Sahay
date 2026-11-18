const tg = require("../telegram/api");
const bus = require("../telegram/bus");
const sarvam = require("../sarvam");
const { config } = require("../config");

/**
 * Telegram-voice channel.
 *
 * A genuine two-way spoken negotiation: the agent's turn is synthesised by
 * Sarvam and delivered as an audio clip, and the vendor's reply - spoken as a
 * voice note - is transcribed by Sarvam on the way back. Text replies are
 * accepted too, because a vendor on a bad connection will type.
 *
 * This is not a simulation of the phone call. It is the same conversation,
 * the same script and the same transcript, over a different wire. When carrier
 * credentials arrive, `pstn` replaces this file and nothing else changes.
 */

const supportsVoice = true;

const isAvailable = () => !!config.telegram.token;
const availabilityReason = () =>
  config.telegram.token
    ? "Live. The vendor negotiates over Telegram voice notes."
    : "TELEGRAM_BOT_TOKEN is not set.";

/**
 * `target` is the vendor's Telegram chat id. A vendor reachable on Telegram is
 * how this channel substitutes for a phone number during pilot.
 */
function create({ target, language = "hi-IN", vendorName, onTurn }) {
  if (!target) throw new Error("telegram-voice needs a vendor Telegram chat id (vendor.phone holds it for this channel).");

  let open = false;

  return {
    name: "telegram-voice",
    supportsVoice,

    async open() {
      // A send that fails here means the vendor never started the bot, which is
      // this channel's equivalent of an unreachable number.
      try {
        await tg.sendChatAction(target, "typing");
        open = true;
      } catch (err) {
        throw new Error(`Vendor chat ${target} is not reachable on Telegram: ${err.message}`);
      }
    },

    async speak(text, lang = language) {
      if (!open) throw new Error("Channel is not open.");
      const localised = lang === "en-IN" ? text : await sarvam.translate(text, lang, "en-IN");

      // Text first so the vendor always has a readable record, then the audio.
      await tg.sendMessage(target, localised);
      try {
        const audio = await sarvam.textToSpeech(localised, lang);
        if (audio.length) await tg.sendVoice(target, Buffer.from(audio[0], "base64"));
      } catch {
        // Voice is a nicety here; losing it must not end a live negotiation.
      }
      onTurn?.({ speaker: "agent", text, textLocal: localised });
      return localised;
    },

    async listen(timeoutMs = 180000) {
      if (!open) throw new Error("Channel is not open.");
      const msg = await bus.waitForMessage(target, timeoutMs);
      if (!msg) return null; // silence == hung up

      // A spoken reply is transcribed; a typed one is taken as-is.
      if (msg.voice || msg.audio) {
        const fileId = (msg.voice || msg.audio).file_id;
        const buf = await tg.downloadFile(fileId);
        const { transcript, language: detected } = await sarvam.speechToText(buf, "audio/ogg");
        if (!transcript.trim()) return { text: "", language: detected || language, empty: true };
        const english = (detected || language).startsWith("en")
          ? transcript
          : await sarvam.translate(transcript, "en-IN", detected || language);
        onTurn?.({ speaker: "vendor", text: english, textLocal: transcript });
        return { text: english, language: detected || language, spoken: true };
      }

      const text = msg.text || msg.caption || "";
      if (!text.trim()) return { text: "", language, empty: true };
      const english = language.startsWith("en") ? text : await sarvam.translate(text, "en-IN", language);
      onTurn?.({ speaker: "vendor", text: english, textLocal: text });
      return { text: english, language, spoken: false };
    },

    async close() {
      bus.cancel(target);
      open = false;
    },

    describe: () => `Telegram voice with ${vendorName || target}`,
  };
}

module.exports = { create, isAvailable, availabilityReason, supportsVoice };
