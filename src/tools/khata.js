"use strict";

/**
 * Khata tools for the owner agent (contract SELL, the khata parts): record_payment, who_owes_me,
 * send_payment_reminder. Registered by one line in src/tools/registry.js, which validates the
 * arguments, resolves `language` (the owner's reply language) and builds ctx from the verified
 * bearer only. Figures in every `say` come from stored data (src/sell/khata.js), never a model.
 *
 * record_payment changes money records, so it is two steps, like a purchase approval:
 *   1. the payment as heard (customer, amount, mode): the server checks the amount and the name
 *      against the owner's own words, reads the payment back into the call itself, and waits;
 *   2. decision "confirm" after the owner's clear spoken yes to that read-back (the server reads
 *      it from the call's /history), or "cancel" on a no. Off a call the owner uses the button.
 */

const khata = require("../sell/khata");
const events = require("../events");
const evidence = require("./evidence");
const outcome = require("../agora/outcome");
/** One /history read inside a tool is bounded, so the tool answers within the MCP timeout_ms. */
const { TOOL_HISTORY_TIMEOUT_MS } = require("../agora/agent");
const { ToolError, toToolError, sayFor, langKey, LANGS } = require("./errors");

const OWNER = ["owner"];
const HISTORY_ATTEMPTS = 3;
const HISTORY_RETRY_MS = 600;
/** Voice evidence that may simply not be in /history yet: looked for again. */
const VOICE_RETRY = new Set(["NO_ANSWER_YET", "READBACK_NOT_HEARD"]);
/** who_owes_me names at most this many customers aloud. */
const SPOKEN_DEBTORS = 3;

/* ------------------------------------------------------------- speech --- */

const PHRASES = {
  payment_question: {
    "hi-IN": () => "क्या मैं यह खाते में लिख दूँ?",
    "kn-IN": () => "ಇದನ್ನು ಖಾತೆಯಲ್ಲಿ ಬರೆಯಲೇ?",
    "en-IN": () => "Shall I write this in the khata?",
  },
  payment_use_button: {
    "hi-IN": (v) => `${v.readback} इसे पैसे वाले पन्ने पर "पैसा मिला" बटन से दर्ज कीजिए।`,
    "kn-IN": (v) => `${v.readback} ಇದನ್ನು ಹಣದ ಪುಟದಲ್ಲಿ "ಹಣ ಬಂತು" ಬಟನ್ ಒತ್ತಿ ದಾಖಲಿಸಿ.`,
    "en-IN": (v) => `${v.readback} Please record it with the "Money received" button on the Money screen.`,
  },
  payment_recorded: {
    "hi-IN": (v) => `लिख लिया: ${v.name} से ${v.amount}। ${v.left ? `अब उनके ${v.left} बाकी हैं।` : "अब उनका कुछ बाकी नहीं है।"}`,
    "kn-IN": (v) => `ಬರೆದುಕೊಂಡೆ: ${v.name} ಅವರಿಂದ ${v.amount}. ${v.left ? `ಈಗ ಅವರ ${v.left} ಬಾಕಿ ಇದೆ.` : "ಈಗ ಅವರ ಬಾಕಿ ಏನೂ ಇಲ್ಲ."}`,
    "en-IN": (v) => `Written down: ${v.amount} from ${v.name}. ${v.left ? `They still owe ${v.left}.` : "They owe nothing now."}`,
  },
  payment_cancelled: {
    "hi-IN": () => "ठीक है, यह भुगतान नहीं लिखा।",
    "kn-IN": () => "ಸರಿ, ಈ ಪಾವತಿಯನ್ನು ಬರೆಯಲಿಲ್ಲ.",
    "en-IN": () => "All right, I have not written that payment down.",
  },
  payment_not_heard: {
    "hi-IN": () => "माफ़ कीजिए, पूरी बात सुनाई नहीं दी; किसने कितने पैसे दिए, फिर से बताइए।",
    "kn-IN": () => "ಕ್ಷಮಿಸಿ, ಪೂರ್ತಿ ಕೇಳಿಸಲಿಲ್ಲ; ಯಾರು ಎಷ್ಟು ಹಣ ಕೊಟ್ಟರು, ಮತ್ತೆ ಹೇಳಿ.",
    "en-IN": () => "Sorry, I did not catch all of that; please tell me again who paid how much.",
  },
  payment_details_needed: {
    "hi-IN": () => "किसने, कितने पैसे, और नकद या यूपीआई से दिए?",
    "kn-IN": () => "ಯಾರು, ಎಷ್ಟು ಹಣ, ನಗದು ಅಥವಾ ಯುಪಿಐ ಮೂಲಕ ಕೊಟ್ಟರು?",
    "en-IN": () => "Who paid, how much, and was it cash or UPI?",
  },
  owed_none: {
    "hi-IN": () => "अभी किसी का पैसा बाकी नहीं है।",
    "kn-IN": () => "ಈಗ ಯಾರದೂ ಹಣ ಬಾಕಿ ಇಲ್ಲ.",
    "en-IN": () => "Nobody owes you anything right now.",
  },
  owed_list: {
    "hi-IN": (v) => `${v.list}। कुल ${v.total} बाकी हैं${v.count > 1 ? `, ${v.count} लोगों से` : ""}।`,
    "kn-IN": (v) => `${v.list}. ಒಟ್ಟು ${v.total} ಬಾಕಿ ಇದೆ${v.count > 1 ? `, ${v.count} ಜನರಿಂದ` : ""}.`,
    "en-IN": (v) => `${v.list}. In all ${v.total} is due${v.count > 1 ? ` from ${v.count} people` : ""}.`,
  },
  owed_one: {
    "hi-IN": (v) => `${v.name} के ${v.amount} बाकी हैं${v.days ? `, ${v.days} दिन से` : ""}।`,
    "kn-IN": (v) => `${v.name} ಅವರ ${v.amount} ಬಾಕಿ ಇದೆ${v.days ? `, ${v.days} ದಿನಗಳಿಂದ` : ""}.`,
    "en-IN": (v) => `${v.name} owes ${v.amount}${v.days ? `, for ${v.days} ${v.days === 1 ? "day" : "days"}` : ""}.`,
  },
  owed_one_none: {
    "hi-IN": (v) => `${v.name} का कुछ बाकी नहीं है।`,
    "kn-IN": (v) => `${v.name} ಅವರ ಬಾಕಿ ಏನೂ ಇಲ್ಲ.`,
    "en-IN": (v) => `${v.name} owes nothing.`,
  },
  reminder_ready: {
    "hi-IN": (v) => `${v.name} के लिए याद दिलाने का संदेश तैयार है, ${v.amount} बाकी; व्हाट्सऐप से भेजने का बटन स्क्रीन पर है।${v.telegram ? " एक कॉपी आपके टेलीग्राम पर भी भेज दी है।" : ""}`,
    "kn-IN": (v) => `${v.name} ಅವರಿಗೆ ನೆನಪಿನ ಸಂದೇಶ ಸಿದ್ಧವಿದೆ, ${v.amount} ಬಾಕಿ; ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸುವ ಬಟನ್ ಪರದೆಯ ಮೇಲಿದೆ.${v.telegram ? " ಒಂದು ಪ್ರತಿ ನಿಮ್ಮ ಟೆಲಿಗ್ರಾಮ್‌ಗೂ ಕಳುಹಿಸಿದ್ದೇನೆ." : ""}`,
    "en-IN": (v) => `The reminder for ${v.name} is ready, ${v.amount} due; the WhatsApp send button is on your screen.${v.telegram ? " I have also sent a copy to your Telegram." : ""}`,
  },
};

/** One line per debtor inside owed_list. */
const DEBTOR = {
  "hi-IN": (v) => `${v.name} ${v.amount}${v.days ? `, ${v.days} दिन से` : ""}`,
  "kn-IN": (v) => `${v.name} ${v.amount}${v.days ? `, ${v.days} ದಿನಗಳಿಂದ` : ""}`,
  "en-IN": (v) => `${v.name} ${v.amount}${v.days ? `, for ${v.days} ${v.days === 1 ? "day" : "days"}` : ""}`,
};
const DEBTOR_JOIN = { "hi-IN": "; ", "kn-IN": "; ", "en-IN": "; " };
const OPENING = { "hi-IN": "सबसे ज़्यादा बाकी: ", "kn-IN": "ಹೆಚ್ಚು ಬಾಕಿ ಇರುವವರು: ", "en-IN": "Largest first: " };

function phrase(key, language, vars = {}) {
  return PHRASES[key][langKey(language)](vars);
}

/** Spoken refusals of the khata and of its voice check, per code. */
const SAY = {
  CUSTOMER_NOT_FOUND: {
    "hi-IN": "इस नाम का कोई ग्राहक नहीं मिला; पहले ग्राहक जोड़िए या नाम फिर से बताइए।",
    "kn-IN": "ಈ ಹೆಸರಿನ ಗ್ರಾಹಕರು ಸಿಗಲಿಲ್ಲ; ಮೊದಲು ಗ್ರಾಹಕರನ್ನು ಸೇರಿಸಿ ಅಥವಾ ಹೆಸರನ್ನು ಮತ್ತೆ ಹೇಳಿ.",
    "en-IN": "I could not find a customer with that name; add the customer first or say the name again.",
  },
  AMBIGUOUS_CUSTOMER: {
    "hi-IN": "इस नाम के एक से ज़्यादा ग्राहक हैं; पूरा नाम बताइए।",
    "kn-IN": "ಈ ಹೆಸರಿನ ಒಬ್ಬರಿಗಿಂತ ಹೆಚ್ಚು ಗ್ರಾಹಕರಿದ್ದಾರೆ; ಪೂರ್ತಿ ಹೆಸರು ಹೇಳಿ.",
    "en-IN": "More than one customer has that name; please say the full name.",
  },
  INVALID_AMOUNT: {
    "hi-IN": "यह रकम सही नहीं लगी, कृपया फिर से बताइए।",
    "kn-IN": "ಈ ಮೊತ್ತ ಸರಿಯಾಗಿಲ್ಲ, ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ.",
    "en-IN": "That amount does not look right; please say it again.",
  },
  INVOICE_NOT_FOUND: {
    "hi-IN": "इस ग्राहक का यह बिल नहीं मिला; मैं इसे उनके खाते में लिख सकती हूँ।",
    "kn-IN": "ಈ ಗ್ರಾಹಕರ ಈ ಬಿಲ್ ಸಿಗಲಿಲ್ಲ; ಇದನ್ನು ಅವರ ಖಾತೆಗೆ ಬರೆಯಬಹುದು.",
    "en-IN": "I could not find that bill for this customer; I can put it on their account instead.",
  },
  INVOICE_NOT_OPEN: {
    "hi-IN": "उस बिल पर अब पैसा नहीं लिया जा सकता।",
    "kn-IN": "ಆ ಬಿಲ್‌ಗೆ ಈಗ ಹಣ ತೆಗೆದುಕೊಳ್ಳಲು ಆಗುವುದಿಲ್ಲ.",
    "en-IN": "That bill cannot take a payment now.",
  },
  AMOUNT_EXCEEDS_INVOICE: {
    "hi-IN": "यह रकम उस बिल की बाकी रकम से ज़्यादा है; बाकी पैसा खाते में लिखूँ?",
    "kn-IN": "ಈ ಮೊತ್ತ ಆ ಬಿಲ್‌ನ ಬಾಕಿಗಿಂತ ಹೆಚ್ಚು; ಉಳಿದದ್ದನ್ನು ಖಾತೆಗೆ ಬರೆಯಲೇ?",
    "en-IN": "That is more than the bill still has open; shall I put the rest on their account?",
  },
  NOTHING_OWED: {
    "hi-IN": "इनका कुछ बाकी नहीं है, इसलिए याद दिलाने की ज़रूरत नहीं।",
    "kn-IN": "ಇವರ ಬಾಕಿ ಏನೂ ಇಲ್ಲ, ಹಾಗಾಗಿ ನೆನಪಿಸುವ ಅಗತ್ಯವಿಲ್ಲ.",
    "en-IN": "They owe nothing, so there is nothing to remind them about.",
  },
  NO_PENDING_PAYMENT: {
    "hi-IN": "अभी कोई भुगतान आपकी हाँ का इंतज़ार नहीं कर रहा; किसने कितने पैसे दिए, बताइए।",
    "kn-IN": "ಈಗ ಯಾವ ಪಾವತಿಯೂ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತಿಲ್ಲ; ಯಾರು ಎಷ್ಟು ಕೊಟ್ಟರು, ಹೇಳಿ.",
    "en-IN": "No payment is waiting for your yes; tell me who paid how much.",
  },
  NOT_AFFIRMATIVE: {
    "hi-IN": "मुझे साफ़ हाँ सुनाई नहीं दी; यह भुगतान खाते में लिख दूँ, हाँ या नहीं?",
    "kn-IN": "ಸ್ಪಷ್ಟವಾಗಿ ಹೌದು ಎಂದು ಕೇಳಿಸಲಿಲ್ಲ; ಈ ಪಾವತಿಯನ್ನು ಖಾತೆಯಲ್ಲಿ ಬರೆಯಲೇ, ಹೌದು ಅಥವಾ ಇಲ್ಲ?",
    "en-IN": "I did not hear a clear yes; shall I write this payment in the khata, yes or no?",
  },
  NOT_NEGATIVE: {
    "hi-IN": "आपने हाँ कहा; क्या मैं यह भुगतान लिख दूँ?",
    "kn-IN": "ನೀವು ಹೌದು ಎಂದಿರಿ; ಈ ಪಾವತಿಯನ್ನು ಬರೆಯಲೇ?",
    "en-IN": "You said yes; shall I write this payment down?",
  },
  NO_VOICE_EVIDENCE: {
    "hi-IN": "मैं आपकी आवाज़ में जवाब नहीं पढ़ पाई; पैसे वाले पन्ने पर बटन से दर्ज कीजिए।",
    "kn-IN": "ನಿಮ್ಮ ಧ್ವನಿಯ ಉತ್ತರ ಓದಲು ಆಗಲಿಲ್ಲ; ಹಣದ ಪುಟದಲ್ಲಿ ಬಟನ್ ಒತ್ತಿ ದಾಖಲಿಸಿ.",
    "en-IN": "I could not read your spoken answer; please record it with the button on the Money screen.",
  },
  READBACK_NOT_SPOKEN: {
    "hi-IN": "मैं यह भुगतान पढ़कर नहीं सुना पाई; पैसे वाले पन्ने पर बटन से दर्ज कीजिए।",
    "kn-IN": "ಈ ಪಾವತಿಯನ್ನು ಓದಿ ಹೇಳಲು ಆಗಲಿಲ್ಲ; ಹಣದ ಪುಟದಲ್ಲಿ ಬಟನ್ ಒತ್ತಿ ದಾಖಲಿಸಿ.",
    "en-IN": "I could not read this payment out; please record it with the button on the Money screen.",
  },
  TYPED_ANSWER: {
    "hi-IN": "लिखा हुआ जवाब हाँ नहीं माना जाता; बोलकर हाँ कहिए या बटन दबाइए।",
    "kn-IN": "ಬರೆದ ಉತ್ತರವನ್ನು ಒಪ್ಪಿಗೆ ಎಂದು ತೆಗೆದುಕೊಳ್ಳುವುದಿಲ್ಲ; ಬಾಯಿಂದ ಹೌದು ಎನ್ನಿ ಅಥವಾ ಬಟನ್ ಒತ್ತಿ.",
    "en-IN": "A typed reply does not count as a yes; say it aloud or press the button.",
  },
};
/** The voice check's codes that mean "no usable yes yet": the same question again. */
for (const code of ["NO_ANSWER_YET", "ANSWER_DURING_READBACK", "READBACK_SUPERSEDED", "EVIDENCE_TOO_OLD"]) SAY[code] = SAY.NOT_AFFIRMATIVE;
for (const code of ["READBACK_NOT_HEARD", "EVIDENCE_UNORDERED", "EVIDENCE_REQUIRED"]) SAY[code] = SAY.NO_VOICE_EVIDENCE;

const STATUS = { CUSTOMER_NOT_FOUND: 404, INVOICE_NOT_FOUND: 404, INVALID_AMOUNT: 400, INVALID_MODE: 400, INVALID: 400 };

/** A khata, Sell or voice-check error as a ToolError with a payment-specific spoken line. */
function khataToolError(err, language) {
  if (err instanceof ToolError) return err;
  const lines = SAY[err?.code];
  if (lines) {
    return new ToolError(err.code, lines[langKey(language)], { status: err.status ?? STATUS[err.code] ?? 409, message: err.message, cause: err, details: err.details });
  }
  if (err?.name === "KhataError" || err?.name === "SellError") {
    return new ToolError(err.code, sayFor(err.status === 404 ? "not_found" : "invalid", language), { status: err.status ?? 400, message: err.message, cause: err, details: err.details });
  }
  return toToolError(err, language);
}

/* ------------------------------------------------------------ helpers --- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** decide(history) on this call's /history; an answer that is not there yet is looked for again. */
async function withHistory(ctx, decide) {
  const agent = require("../agora/agent");
  for (let attempt = 1; ; attempt++) {
    try {
      return decide(await agent.history(ctx.agentId, { timeoutMs: TOOL_HISTORY_TIMEOUT_MS }));
    } catch (err) {
      if (VOICE_RETRY.has(err?.code) && attempt < HISTORY_ATTEMPTS) {
        await sleep(HISTORY_RETRY_MS);
        continue;
      }
      throw err;
    }
  }
}

/** The owner's latest turns: this call's /history, else the `owner_words` the model copied, else null. */
async function ownerTurns(ctx, args) {
  if (ctx.agentId) {
    try {
      return evidence.ownerTurns(await require("../agora/agent").history(ctx.agentId, { timeoutMs: TOOL_HISTORY_TIMEOUT_MS }));
    } catch {
      // the call history is unavailable: fall back to the model's copy below
    }
  }
  return args.owner_words ? [args.owner_words] : null;
}

/**
 * What of a heard payment the owner's own words do not bear out: "amount" when their latest turn
 * that names a number does not name this one, "customer" when no word of the name is in their
 * turns. [] when nothing can be checked (the read-back and the spoken yes still guard it).
 */
async function unheard(ctx, args) {
  const turns = await ownerTurns(ctx, args);
  if (!turns || !turns.length) return [];
  const missing = [];
  if (evidence.notHeard(turns, { quantity: args.amount }).length) missing.push("amount");
  if (!evidence.itemHeard(turns.slice(-evidence.TURNS), args.customer)) missing.push("customer");
  return missing;
}

const spokenAmount = (paise, language) => khata.spokenRupees(paise, language);

/**
 * What one customer owes, as who_owes_me and the Money card's read-aloud say it:
 * `{ row, say }` (row null when they owe nothing). `rows` is khata.owed when the caller has it.
 */
function owedOne(businessId, customer, language, rows = khata.owed(businessId)) {
  const row = rows.find((r) => r.customer.id === customer.id) ?? null;
  if (!row) return { row: null, say: phrase("owed_one_none", language, { name: customer.name }) };
  return { row, say: phrase("owed_one", language, { name: customer.name, amount: spokenAmount(row.amount_paise, language), days: row.days }) };
}

/* ------------------------------------------------------------- schemas --- */

const REPLY_LANGUAGE = {
  type: "string",
  enum: LANGS,
  description: "The language the owner just spoke in: hi-IN (Hindi), kn-IN (Kannada) or en-IN (English). The `say` text comes back in it.",
};
const ownerObj = (properties, required = []) => ({
  type: "object",
  properties: { ...properties, reply_language: REPLY_LANGUAGE },
  required,
  additionalProperties: false,
});
const CUSTOMER = { type: "string", minLength: 1, maxLength: 120, description: "The customer's name exactly as the owner said it, in the owner's script." };

/* --------------------------------------------------------------- tools --- */

async function heardPayment(ctx, args, language) {
  if (!args.customer || args.amount == null || !args.mode) {
    return { recorded: false, status: "need_details", say: phrase("payment_details_needed", language) };
  }
  const missing = await unheard(ctx, args);
  if (missing.length) return { recorded: false, status: "not_heard", missing, say: phrase("payment_not_heard", language) };

  const customer = khata.customerNamed(ctx.businessId, args.customer);
  const invoiceId = args.invoice_number ? invoiceNamed(ctx.businessId, customer.id, args.invoice_number) : null;
  const input = { customerId: customer.id, amount: args.amount, mode: args.mode, invoiceId, note: args.note ?? null, ownerWords: args.owner_words ?? null };

  // No call: nothing can be answered by voice, so the owner records it with the button.
  if (!ctx.agentId) {
    const { readback } = khata.previewReceipt(ctx.businessId, input, { language });
    return { recorded: false, status: "needs_button", customerId: customer.id, readback, say: phrase("payment_use_button", language, { readback }) };
  }

  const { draft } = khata.draftReceipt(ctx.businessId, input, { language });
  // The server speaks the read-back itself, so the yes it later accepts answers exactly these
  // figures; nothing else is narrated between the read-back and the owner's answer.
  require("../agora/narrator").holdForApproval(ctx.businessId, `receipt:${draft.id}`);
  try {
    await require("../agora/agent").speak(ctx.agentId, draft.readback, { priority: "APPEND", interruptable: false });
  } catch (err) {
    throw new ToolError("READBACK_NOT_SPOKEN", SAY.READBACK_NOT_SPOKEN[langKey(language)], { status: 502, message: `The payment read-back could not be spoken: ${err.message}` });
  }
  khata.markDraftSpoken(ctx.businessId, draft.id, { agentId: ctx.agentId, text: draft.readback });
  events.emit(ctx.businessId, "receipt.spoken", { draftId: draft.id, customerId: customer.id, amount: draft.amount, mode: draft.mode, readback: draft.readback }, { sessionId: ctx.sessionId ?? null, actor: "agent" });
  return {
    recorded: false,
    status: "awaiting_answer",
    draftId: draft.id,
    readbackSpoken: true,
    next: "record_payment with decision",
    hint: "The server has read this payment out to the owner. When the owner answers, call record_payment with only decision: confirm on a clear yes, cancel on a no. Do not repeat the figures.",
    say: phrase("payment_question", language),
  };
}

/** The invoice of this customer the owner named by number ("INV/2026-27/0003", or just its last digits "3"). */
function invoiceNamed(businessId, customerId, said) {
  const { KhataError } = khata;
  const digits = String(said).replace(/\D+/g, "");
  const open = khata.owed(businessId).find((row) => row.customer.id === customerId)?.invoices ?? [];
  const hits = open.filter((inv) => inv.number && (inv.number === said || (digits && Number(inv.number.replace(/^.*\D/, "")) === Number(digits))));
  if (hits.length !== 1) throw new KhataError("INVOICE_NOT_FOUND", `No single open invoice "${said}" for this customer.`, { status: 404 });
  return hits[0].id;
}

async function answerPayment(ctx, args, language) {
  const draft = khata.pendingDraft(ctx.businessId);
  if (!draft) throw khataToolError(new khata.KhataError("NO_PENDING_PAYMENT", "No payment is waiting for the owner's yes.", { status: 409 }), language);
  if (!ctx.agentId) throw khataToolError({ code: "NO_VOICE_EVIDENCE", message: "A spoken answer needs this call's history.", status: 409 }, language);
  const out = await withHistory(ctx, (history) =>
    khata.confirmDraft(ctx.businessId, draft.id, { decision: args.decision, agentId: ctx.agentId, history, sessionId: ctx.sessionId ?? null }),
  );
  if (!out.receipt) {
    events.emit(ctx.businessId, "receipt.cancelled", { draftId: draft.id, customerId: draft.customer_id }, { sessionId: ctx.sessionId ?? null, actor: "owner" });
    return outcome.settle(ctx, phrase("payment_cancelled", language), language, { recorded: false, status: "cancelled", draftId: draft.id });
  }
  const left = Math.max(khata.balancePaise(ctx.businessId, out.receipt.customer_id), 0);
  const said = phrase("payment_recorded", language, {
    name: out.receipt.customer_name,
    amount: spokenAmount(out.receipt.amount_paise, language),
    left: left ? spokenAmount(left, language) : null,
  });
  return outcome.settle(ctx, said, language, { recorded: true, status: "recorded", receipt: out.receipt, owed: khata.toRupees(left) });
}

const TOOLS = [
  {
    name: "record_payment",
    scopes: OWNER,
    description:
      "Writes down money a customer paid the shop (the khata). Step 1: as soon as the owner says who paid how much and how (cash or UPI), call it with customer, amount, mode and owner_words: the server checks them against the owner's own words and reads the payment back into the call itself; you then say only `say` (a short question) and wait. Step 2: when the owner answers, call it again with only decision (confirm on a clear yes, cancel on a no). Never repeat the figures yourself and never guess an amount: if `say` asks again, ask the owner.",
    inputSchema: ownerObj({
      customer: CUSTOMER,
      amount: { type: "number", exclusiveMinimum: 0, maximum: 10000000, description: "Rupees exactly as the owner said them (do hazaar -> 2000)." },
      mode: { type: "string", enum: khata.MODES, description: "cash or upi, as the owner said." },
      invoice_number: { type: "string", maxLength: 40, description: "Only if the owner named a bill number. Without it the money goes on the customer's account (oldest bills first)." },
      note: { type: "string", maxLength: 200 },
      owner_words: { type: "string", maxLength: 500, description: "The owner's last sentence, word for word as you heard it, in the owner's script. Always pass it in step 1." },
      decision: { type: "string", enum: ["confirm", "cancel"], description: "Step 2 only: the owner's answer to the payment the server read out." },
    }),
    async handler(ctx, args, language) {
      try {
        return args.decision ? await answerPayment(ctx, args, language) : await heardPayment(ctx, args, language);
      } catch (err) {
        throw khataToolError(err, language);
      }
    },
  },
  {
    name: "who_owes_me",
    scopes: OWNER,
    description:
      "Who owes the shop money and how much, largest first, with how many days the oldest bill has been open. With customer, just that customer. Speak `say` as it is: it has the amounts in the owner's way of counting (lakh, hazaar).",
    inputSchema: ownerObj({ customer: { ...CUSTOMER, description: "Optional: one customer's name as the owner said it." } }),
    async handler(ctx, args, language) {
      try {
        const rows = khata.owed(ctx.businessId);
        if (args.customer) {
          const { row, say } = owedOne(ctx.businessId, khata.customerNamed(ctx.businessId, args.customer), language, rows);
          return { owed: row ? [row] : [], total: row ? row.amount : 0, say };
        }
        if (!rows.length) return { owed: [], total: 0, say: phrase("owed_none", language) };
        const lang = langKey(language);
        const totalPaise = rows.reduce((s, r) => s + r.amount_paise, 0);
        const list =
          OPENING[lang] +
          rows
            .slice(0, SPOKEN_DEBTORS)
            .map((r) => DEBTOR[lang]({ name: r.customer.name, amount: spokenAmount(r.amount_paise, lang), days: r.days }))
            .join(DEBTOR_JOIN[lang]);
        return { owed: rows, total: khata.toRupees(totalPaise), say: phrase("owed_list", lang, { list, total: spokenAmount(totalPaise, lang), count: rows.length }) };
      } catch (err) {
        throw khataToolError(err, language);
      }
    },
  },
  {
    name: "send_payment_reminder",
    scopes: OWNER,
    description:
      "Prepares a polite payment reminder for a customer who owes money: the text and a WhatsApp link the owner taps to send it from their own phone (shown on screen), and a copy to the owner's Telegram if linked. Nothing is sent to the customer automatically. Speak `say`.",
    inputSchema: ownerObj({ customer: CUSTOMER }, ["customer"]),
    async handler(ctx, args, language) {
      try {
        const customer = khata.customerNamed(ctx.businessId, args.customer);
        const out = await khata.remind(ctx.businessId, customer.id, { language, sessionId: ctx.sessionId ?? null, actor: "agent" });
        return {
          customer: { id: out.customer.id, name: out.customer.name },
          amount: out.amount,
          text: out.text,
          shareUrl: out.shareUrl,
          telegram: out.telegram,
          say: phrase("reminder_ready", language, { name: out.customer.name, amount: spokenAmount(out.amount_paise, language), telegram: out.telegram.sent }),
        };
      } catch (err) {
        throw khataToolError(err, language);
      }
    },
  },
];

module.exports = { TOOLS, PHRASES, SAY, DEBTOR, OPENING, khataToolError, owedOne };
