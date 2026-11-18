/**
 * Negotiation channels.
 *
 * A channel is the *carriage* for a conversation. The negotiation agent in
 * src/negotiator.js is written once against this interface and has no idea
 * whether it is talking over a phone line or a Telegram voice note:
 *
 *   open()             prepare the session; throw if the vendor is unreachable
 *   speak(text, lang)  say something to the vendor, in their language
 *   listen()           -> { text, language } | null   (null = they hung up / went silent)
 *   close(reason)      end the session
 *   supportsVoice      whether audio is really being exchanged
 *
 * This split exists because Sarvam supplies the voice but not the line: there
 * is no Sarvam endpoint that dials a PSTN number. Swapping `telegram-voice`
 * for `pstn` is therefore a configuration change, not a rewrite - the
 * negotiation script, the transcript, and the extracted quote are identical.
 */

const telegramVoice = require("./telegram-voice");
const pstn = require("./pstn");

const CHANNELS = {
  "telegram-voice": telegramVoice,
  pstn,
};

function getChannel(name) {
  const ch = CHANNELS[name];
  if (!ch) throw new Error(`Unknown negotiation channel "${name}". Available: ${Object.keys(CHANNELS).join(", ")}`);
  return ch;
}

/** Which channels can actually run right now, given current configuration. */
function channelStatus() {
  return Object.entries(CHANNELS).map(([name, ch]) => ({
    name,
    available: ch.isAvailable(),
    reason: ch.availabilityReason(),
    supportsVoice: ch.supportsVoice,
  }));
}

module.exports = { getChannel, channelStatus, CHANNELS };
