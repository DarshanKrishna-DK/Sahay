const { config } = require("../config");

/**
 * PSTN channel - a real outbound phone call to a vendor's number.
 *
 * Sarvam supplies the voice (STT, TTS, Indic language understanding) but not
 * the line: no Sarvam endpoint dials a phone number. Carriage therefore needs
 * a telephony provider. This adapter is the seam.
 *
 * Turning it on is credentials plus one env var:
 *
 *   TELEPHONY_PROVIDER=exotel|plivo|twilio
 *   TELEPHONY_ACCOUNT_SID=...
 *   TELEPHONY_AUTH_TOKEN=...
 *   TELEPHONY_CALLER_ID=+91XXXXXXXXXX     (registered outbound caller id)
 *   NEGOTIATION_CHANNEL=pstn
 *
 * The negotiation script, transcript capture and quote extraction are shared
 * with `telegram-voice`, so nothing above this layer changes when it flips.
 *
 * Implementation note for whoever wires the carrier: all three providers work
 * the same way. You place a call via their REST API pointing at a webhook you
 * host; the carrier streams caller audio to that webhook; you push audio back.
 * `speak()` maps to "play this synthesised clip", `listen()` maps to "collect
 * the next utterance until a speech-end event". The media bridge is the only
 * real work - everything conversational already exists.
 */

const supportsVoice = true;

const isAvailable = () =>
  !!(config.telephony.provider && config.telephony.accountSid
     && config.telephony.authToken && config.telephony.callerId);

function availabilityReason() {
  if (isAvailable()) return `Ready via ${config.telephony.provider}.`;
  const missing = [];
  if (!config.telephony.provider) missing.push("TELEPHONY_PROVIDER");
  if (!config.telephony.accountSid) missing.push("TELEPHONY_ACCOUNT_SID");
  if (!config.telephony.authToken) missing.push("TELEPHONY_AUTH_TOKEN");
  if (!config.telephony.callerId) missing.push("TELEPHONY_CALLER_ID");
  return `Needs ${missing.join(", ")}. Sarvam provides the voice; a carrier provides the line.`;
}

function create({ target, language = "hi-IN", vendorName }) {
  if (!isAvailable()) {
    // Fail loudly and specifically rather than pretending a call happened.
    throw new Error(
      `Cannot place a real call: ${availabilityReason()} ` +
      `Set NEGOTIATION_CHANNEL=telegram-voice to negotiate over Telegram instead.`,
    );
  }
  throw new Error(
    `Telephony provider "${config.telephony.provider}" is configured but its media bridge is not implemented in this build. ` +
    `Sahay will not fabricate a call transcript.`,
  );
}

module.exports = { create, isAvailable, availabilityReason, supportsVoice };
