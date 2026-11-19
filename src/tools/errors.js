"use strict";

/**
 * Typed errors for the agent tools.
 *
 * A tool never fails silently and never answers with made-up data: it throws a
 * ToolError whose `say` is one short sentence the agent can speak as is, in the
 * business language and its own script. `toToolError` turns the typed errors of
 * the business modules (approvals, orders, payments, jobs, repo, discovery, llm)
 * into that shape so the MCP layer and REST answer the same way.
 */

class ToolError extends Error {
  /**
   * @param {string} code    stable machine code, e.g. "NOT_APPROVED"
   * @param {string} say     one short spoken sentence (native script)
   * @param {{message?: string, status?: number, cause?: unknown, details?: object}} [options]
   */
  constructor(code, say, { message, status, cause, details } = {}) {
    super(message ?? say, cause ? { cause } : undefined);
    this.name = "ToolError";
    this.code = code;
    this.say = say;
    this.status = status ?? statusFor(code);
    if (details) this.details = details;
  }
}

const LANGS = ["hi-IN", "kn-IN", "en-IN"];
const langKey = (language) => (LANGS.includes(language) ? language : "en-IN");

/** Spoken failure lines. Each one is a complete sentence without numbers. */
const SAY = {
  not_found: {
    "hi-IN": "यह रिकॉर्ड इस व्यापार में नहीं मिला।",
    "kn-IN": "ಈ ದಾಖಲೆ ಈ ವ್ಯಾಪಾರದಲ್ಲಿ ಸಿಗಲಿಲ್ಲ.",
    "en-IN": "I could not find that record for this business.",
  },
  invalid: {
    "hi-IN": "यह जानकारी पूरी या सही नहीं है, कृपया फिर से बताइए।",
    "kn-IN": "ಈ ಮಾಹಿತಿ ಪೂರ್ಣವಾಗಿಲ್ಲ ಅಥವಾ ಸರಿಯಿಲ್ಲ, ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ.",
    "en-IN": "That information is incomplete or not valid, please say it again.",
  },
  not_approved: {
    "hi-IN": "इस सौदे की मंज़ूरी अभी नहीं मिली है, इसलिए मैं ऑर्डर नहीं बना सकती।",
    "kn-IN": "ಈ ವ್ಯವಹಾರಕ್ಕೆ ಇನ್ನೂ ಒಪ್ಪಿಗೆ ಸಿಕ್ಕಿಲ್ಲ, ಹಾಗಾಗಿ ಆರ್ಡರ್ ಮಾಡಲು ಆಗುವುದಿಲ್ಲ.",
    "en-IN": "This deal is not approved yet, so I cannot place the order.",
  },
  approval_used: {
    "hi-IN": "इस मंज़ूरी पर ऑर्डर पहले ही बन चुका है।",
    "kn-IN": "ಈ ಒಪ್ಪಿಗೆಯ ಮೇಲೆ ಈಗಾಗಲೇ ಆರ್ಡರ್ ಆಗಿದೆ.",
    "en-IN": "An order has already been placed on this approval.",
  },
  approval_stale: {
    "hi-IN": "सौदा बदल गया है, मुझे फिर से मंज़ूरी लेनी होगी।",
    "kn-IN": "ವ್ಯವಹಾರ ಬದಲಾಗಿದೆ, ಮತ್ತೆ ಒಪ್ಪಿಗೆ ಪಡೆಯಬೇಕು.",
    "en-IN": "The deal has changed, so I need to ask for approval again.",
  },
  not_affirmative: {
    "hi-IN": "मुझे साफ़ हाँ सुनाई नहीं दी, क्या आप यह ऑर्डर पक्का करना चाहते हैं, हाँ या नहीं?",
    "kn-IN": "ಸ್ಪಷ್ಟವಾಗಿ ಹೌದು ಎಂದು ಕೇಳಿಸಲಿಲ್ಲ, ಈ ಆರ್ಡರ್ ಖಚಿತಪಡಿಸಲೇ, ಹೌದು ಅಥವಾ ಇಲ್ಲ?",
    "en-IN": "I did not hear a clear yes; shall I confirm this order, yes or no?",
  },
  no_voice_evidence: {
    "hi-IN": "मैं आपकी आवाज़ में जवाब नहीं पढ़ पाई, कृपया स्क्रीन पर मंज़ूरी का बटन दबाइए।",
    "kn-IN": "ನಿಮ್ಮ ಧ್ವನಿಯ ಉತ್ತರ ಓದಲು ಆಗಲಿಲ್ಲ, ದಯವಿಟ್ಟು ಪರದೆಯ ಮೇಲೆ ಒಪ್ಪಿಗೆ ಬಟನ್ ಒತ್ತಿ.",
    "en-IN": "I could not read your spoken answer, please press the approve button on the screen.",
  },
  already_decided: {
    "hi-IN": "इस मंज़ूरी पर फ़ैसला पहले ही हो चुका है।",
    "kn-IN": "ಈ ಒಪ್ಪಿಗೆಯ ಬಗ್ಗೆ ಈಗಾಗಲೇ ನಿರ್ಧಾರ ಆಗಿದೆ.",
    "en-IN": "This approval has already been decided.",
  },
  unit_mismatch: {
    "hi-IN": "विक्रेता का भाव दूसरी इकाई में है, इसलिए कुल रकम नहीं निकल सकती।",
    "kn-IN": "ಮಾರಾಟಗಾರರ ಬೆಲೆ ಬೇರೆ ಘಟಕದಲ್ಲಿದೆ, ಹಾಗಾಗಿ ಒಟ್ಟು ಮೊತ್ತ ಲೆಕ್ಕ ಹಾಕಲು ಆಗುವುದಿಲ್ಲ.",
    "en-IN": "The vendor's rate is in a different unit, so the total cannot be worked out.",
  },
  po_failed: {
    "hi-IN": "ऑर्डर बन गया है, पर खरीद आदेश की फ़ाइल नहीं बन पाई।",
    "kn-IN": "ಆರ್ಡರ್ ಆಗಿದೆ, ಆದರೆ ಖರೀದಿ ಆದೇಶದ ಫೈಲ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ.",
    "en-IN": "The order is placed, but the purchase order file could not be made.",
  },
  payment_failed: {
    "hi-IN": "भुगतान लिंक नहीं बन पाया।",
    "kn-IN": "ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ.",
    "en-IN": "The payment link could not be created.",
  },
  payment_link_unavailable: {
    "hi-IN": "भुगतान का यह लिंक अब काम नहीं करता, मुझसे नया लिंक माँगिए।",
    "kn-IN": "ಈ ಪಾವತಿ ಲಿಂಕ್ ಈಗ ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ, ನನ್ನಿಂದ ಹೊಸ ಲಿಂಕ್ ಕೇಳಿ.",
    "en-IN": "That payment link no longer works; ask me for a new one.",
  },
  payment_unverified: {
    "hi-IN": "भुगतान की पुष्टि नहीं हो पाई, इसलिए ऑर्डर अभी भुगतान वाला नहीं माना गया।",
    "kn-IN": "ಪಾವತಿಯನ್ನು ದೃಢಪಡಿಸಲು ಆಗಲಿಲ್ಲ, ಹಾಗಾಗಿ ಆರ್ಡರ್ ಇನ್ನೂ ಪಾವತಿಯಾಗಿಲ್ಲ.",
    "en-IN": "The payment could not be verified, so the order is not marked paid.",
  },
  already_paid: {
    "hi-IN": "इस ऑर्डर का भुगतान पहले ही हो चुका है।",
    "kn-IN": "ಈ ಆರ್ಡರ್‌ಗೆ ಈಗಾಗಲೇ ಪಾವತಿ ಆಗಿದೆ.",
    "en-IN": "This order is already paid.",
  },
  order_step_not_allowed: {
    "hi-IN": "ऑर्डर अभी इस स्थिति में नहीं जा सकता।",
    "kn-IN": "ಆರ್ಡರ್ ಈಗ ಈ ಸ್ಥಿತಿಗೆ ಹೋಗಲು ಆಗುವುದಿಲ್ಲ.",
    "en-IN": "The order cannot move to that status now.",
  },
  busy: {
    "hi-IN": "अभी बहुत लोग इस्तेमाल कर रहे हैं, थोड़ी देर बाद कोशिश कीजिए।",
    "kn-IN": "ಈಗ ತುಂಬಾ ಜನ ಬಳಸುತ್ತಿದ್ದಾರೆ, ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.",
    "en-IN": "A lot of people are using Sahay right now; please try again in a little while.",
  },
  discovery_failed: {
    "hi-IN": "इंडियामार्ट से जानकारी नहीं मिल पाई।",
    "kn-IN": "ಇಂಡಿಯಾಮಾರ್ಟ್‌ನಿಂದ ಮಾಹಿತಿ ಸಿಗಲಿಲ್ಲ.",
    "en-IN": "I could not get the listings from IndiaMART.",
  },
  llm_failed: {
    "hi-IN": "जानकारी निकालने वाली सेवा ने जवाब नहीं दिया।",
    "kn-IN": "ಮಾಹಿತಿ ತೆಗೆಯುವ ಸೇವೆ ಉತ್ತರಿಸಲಿಲ್ಲ.",
    "en-IN": "The extraction service did not answer.",
  },
  internal: {
    "hi-IN": "कुछ गड़बड़ हो गई, मैं यह काम अभी नहीं कर पाई।",
    "kn-IN": "ಏನೋ ತೊಂದರೆಯಾಯಿತು, ಈ ಕೆಲಸ ಈಗ ಮಾಡಲು ಆಗಲಿಲ್ಲ.",
    "en-IN": "Something went wrong and I could not do that just now.",
  },
};

function sayFor(key, language) {
  return (SAY[key] ?? SAY.internal)[langKey(language)];
}

/** Business-module error codes mapped to a spoken line and an HTTP status. */
const CODE_MAP = {
  NOT_FOUND: ["not_found", 404],
  QUOTE_NOT_FOUND: ["not_found", 404],
  APPROVAL_NOT_FOUND: ["not_found", 404],
  ORDER_NOT_FOUND: ["not_found", 404],
  JOB_NOT_FOUND: ["not_found", 404],
  INVALID: ["invalid", 400],
  INVALID_DECISION: ["invalid", 400],
  INVALID_VIA: ["invalid", 400],
  INCOMPLETE_DEAL: ["invalid", 400],
  UNSUPPORTED_LANGUAGE: ["invalid", 400],
  UNIT_MISMATCH: ["unit_mismatch", 409],
  QUOTE_INCONSISTENT: ["approval_stale", 409],
  NOT_APPROVED: ["not_approved", 409],
  ORDER_NOT_APPROVED: ["not_approved", 409],
  APPROVAL_NOT_USABLE: ["not_approved", 409],
  APPROVAL_CONSUMED: ["approval_used", 409],
  ALREADY_ORDERED: ["approval_used", 409],
  APPROVAL_STALE: ["approval_stale", 409],
  ALREADY_DECIDED: ["already_decided", 409],
  NOT_AFFIRMATIVE: ["not_affirmative", 409],
  NOT_NEGATIVE: ["not_affirmative", 409],
  EVIDENCE_REQUIRED: ["no_voice_evidence", 409],
  EVIDENCE_TOO_OLD: ["not_affirmative", 409],
  // The voice-approval gate (approvals.answerToReadback): the yes must answer the read-back the server spoke.
  READBACK_NOT_SPOKEN: ["no_voice_evidence", 409],
  READBACK_NOT_HEARD: ["no_voice_evidence", 409],
  EVIDENCE_UNORDERED: ["no_voice_evidence", 409],
  NO_ANSWER_YET: ["not_affirmative", 409],
  ANSWER_DURING_READBACK: ["not_affirmative", 409],
  READBACK_SUPERSEDED: ["not_affirmative", 409],
  BUSY: ["busy", 503],
  ILLEGAL_TRANSITION: ["order_step_not_allowed", 409],
  PAID_BY_PAYMENT_ONLY: ["order_step_not_allowed", 409],
  PO_NOT_ISSUED: ["po_failed", 502],
  RAZORPAY_REFUSED: ["payment_failed", 502],
  RAZORPAY_BAD_RESPONSE: ["payment_failed", 502],
  RAZORPAY_UNREACHABLE: ["payment_failed", 502],
  RAZORPAY_RATE_LIMITED: ["payment_failed", 503],
  RAZORPAY_NOT_CONFIGURED: ["payment_failed", 503],
  RAZORPAY_LIVE_KEY: ["payment_failed", 503],
  PUBLIC_URL_NOT_SET: ["payment_failed", 503],
  ORDER_NOT_PAYABLE: ["payment_failed", 409],
  ORDER_ALREADY_PAID: ["already_paid", 409],
  PAY_LINK_INVALID: ["payment_link_unavailable", 404],
  PAY_LINK_EXPIRED: ["payment_link_unavailable", 410],
  PAYMENT_DETAILS_INVALID: ["payment_unverified", 400],
  PAYMENT_SIGNATURE_INVALID: ["payment_unverified", 400],
};

/** DiscoveryError and LLMError codes are lower case. */
const NAMED_MAP = {
  DiscoveryError: ["discovery_failed", 502],
  LLMError: ["llm_failed", 502],
};

function statusFor(code) {
  return CODE_MAP[code]?.[1] ?? 500;
}

/**
 * Turn any thrown value into a ToolError. Known business errors keep their code
 * and get a spoken line; anything else becomes INTERNAL with a generic line (the
 * original message stays on `message` for the server log, never for speech).
 */
function toToolError(err, language) {
  if (err instanceof ToolError) return err;
  const code = typeof err?.code === "string" ? err.code : null;
  const named = NAMED_MAP[err?.name];
  if (named) {
    return new ToolError(`${err.name === "LLMError" ? "LLM" : "DISCOVERY"}_${String(code ?? "error").toUpperCase()}`, sayFor(named[0], language), {
      message: err.message,
      status: named[1],
      cause: err,
    });
  }
  const mapped = code ? CODE_MAP[code] : null;
  if (mapped) return new ToolError(code, sayFor(mapped[0], language), { message: err.message, status: mapped[1], cause: err });
  return new ToolError("INTERNAL", sayFor("internal", language), { message: err?.message ?? String(err), status: 500, cause: err });
}

module.exports = { ToolError, toToolError, sayFor, langKey, LANGS };
