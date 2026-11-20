"use strict";

/**
 * Owner tools for the owner's own, real suppliers (src/suppliers): add_supplier, list_suppliers.
 * Registered by one line in src/tools/registry.js, which validates the arguments, resolves
 * `language` (the owner's reply language) and builds ctx from the verified bearer only; the
 * tenant is never an argument. Removing a supplier is a button in the app (DELETE
 * /api/suppliers/:id), not a voice tool.
 */

const suppliers = require("../suppliers");
const store = require("../db/suppliers");
const repo = require("../db/repo");
const { ToolError, sayFor, langKey, LANGS } = require("./errors");

const OWNER = ["owner"];

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

const PHRASES = {
  supplier_added: {
    "hi-IN": (v) => `${v.name} को आपके सप्लायर के रूप में जोड़ दिया। ${v.sent ? "उनका टेलीग्राम लिंक आपके टेलीग्राम पर भेज दिया है, उन्हें आगे भेज दीजिए" : "उनका टेलीग्राम लिंक स्क्रीन पर है, उन्हें भेज दीजिए"}; वे उसे खोलेंगे तो मैं उनसे बात कर सकूँगी।`,
    "kn-IN": (v) => `${v.name} ಅವರನ್ನು ನಿಮ್ಮ ಪೂರೈಕೆದಾರರಾಗಿ ಸೇರಿಸಿದೆ. ${v.sent ? "ಅವರ ಟೆಲಿಗ್ರಾಮ್ ಲಿಂಕ್ ನಿಮ್ಮ ಟೆಲಿಗ್ರಾಮ್‌ಗೆ ಕಳುಹಿಸಿದ್ದೇನೆ, ಅದನ್ನು ಅವರಿಗೆ ಕಳುಹಿಸಿ" : "ಅವರ ಟೆಲಿಗ್ರಾಮ್ ಲಿಂಕ್ ಪರದೆಯ ಮೇಲಿದೆ, ಅದನ್ನು ಅವರಿಗೆ ಕಳುಹಿಸಿ"}; ಅವರು ಅದನ್ನು ತೆರೆದರೆ ನಾನು ಅವರ ಜೊತೆ ಮಾತನಾಡಬಹುದು.`,
    "en-IN": (v) => `I've added ${v.name} as your supplier. ${v.sent ? "Their Telegram link is in your Telegram; please forward it to them" : "Their Telegram link is on the screen; please send it to them"}. Once they open it, I can talk to them.`,
  },
  supplier_link_again: {
    "hi-IN": (v) => `${v.name} पहले से आपके सप्लायर हैं; ${v.sent ? "नया टेलीग्राम लिंक आपके टेलीग्राम पर भेज दिया है" : "नया टेलीग्राम लिंक स्क्रीन पर है"}।`,
    "kn-IN": (v) => `${v.name} ಈಗಾಗಲೇ ನಿಮ್ಮ ಪೂರೈಕೆದಾರರು; ${v.sent ? "ಹೊಸ ಟೆಲಿಗ್ರಾಮ್ ಲಿಂಕ್ ನಿಮ್ಮ ಟೆಲಿಗ್ರಾಮ್‌ಗೆ ಕಳುಹಿಸಿದ್ದೇನೆ" : "ಹೊಸ ಟೆಲಿಗ್ರಾಮ್ ಲಿಂಕ್ ಪರದೆಯ ಮೇಲಿದೆ"}.`,
    "en-IN": (v) => `${v.name} is already your supplier; ${v.sent ? "I've sent a new Telegram link to your Telegram" : "a new Telegram link is on the screen"}.`,
  },
  suppliers_none: {
    "hi-IN": () => "अभी आपका कोई अपना सप्लायर जुड़ा नहीं है। नाम और वे क्या बेचते हैं, बताइए, मैं जोड़ दूँगी।",
    "kn-IN": () => "ಇನ್ನೂ ನಿಮ್ಮ ಯಾವ ಪೂರೈಕೆದಾರರನ್ನೂ ಸೇರಿಸಿಲ್ಲ. ಹೆಸರು ಮತ್ತು ಅವರು ಏನು ಮಾರುತ್ತಾರೆ ಹೇಳಿ, ನಾನು ಸೇರಿಸುತ್ತೇನೆ.",
    "en-IN": () => "You have no suppliers of your own yet. Tell me a name and what they sell, and I will add them.",
  },
  suppliers_list: {
    "hi-IN": (v) => `आपके ${v.count} सप्लायर हैं: ${v.list}।`,
    "kn-IN": (v) => `ನಿಮ್ಮ ${v.count} ಪೂರೈಕೆದಾರರು ಇದ್ದಾರೆ: ${v.list}.`,
    "en-IN": (v) => `You have ${v.count} supplier${v.count === 1 ? "" : "s"}: ${v.list}.`,
  },
  supplier_row: {
    "hi-IN": (v) => `${v.name}, ${v.linked ? "टेलीग्राम पर जुड़े हुए" : "अभी टेलीग्राम पर नहीं जुड़े"}`,
    "kn-IN": (v) => `${v.name}, ${v.linked ? "ಟೆಲಿಗ್ರಾಮ್‌ನಲ್ಲಿ ಜೋಡಣೆಯಾಗಿದ್ದಾರೆ" : "ಇನ್ನೂ ಟೆಲಿಗ್ರಾಮ್‌ನಲ್ಲಿ ಜೋಡಣೆಯಾಗಿಲ್ಲ"}`,
    "en-IN": (v) => `${v.name}, ${v.linked ? "linked on Telegram" : "not linked on Telegram yet"}`,
  },
};
const LIST_JOIN = { "hi-IN": "; ", "kn-IN": "; ", "en-IN": "; " };

const phrase = (key, language, vars = {}) => PHRASES[key][langKey(language)](vars);

/** A supplier the owner already has under this name (case and spacing ignored), or null. */
function sameName(businessId, name) {
  const fold = (s) => String(s ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  return store.listSuppliers(businessId).find((s) => fold(s.name) === fold(name)) ?? null;
}

function invalid(err, language) {
  return new ToolError("INVALID_SUPPLIER", sayFor("invalid", language), { status: 400, message: err.message });
}

const TOOLS = [
  {
    name: "add_supplier",
    scopes: OWNER,
    description:
      "Adds one of the owner's own, real suppliers (a person or shop they already buy from) so Sahay can reach them on Telegram when the owner needs what they sell. Call it when the owner names a supplier and what they sell. items are the things they sell, in the owner's words. language is the language the supplier speaks (ask if unclear; default the owner's). Returns a one-time Telegram link for the supplier (shown on screen and sent to the owner's Telegram when linked). Saying the same name again makes a new link. Speak `say`; never read the link aloud.",
    inputSchema: ownerObj(
      {
        name: { type: "string", minLength: 1, maxLength: 80, description: "The supplier's name as the owner said it." },
        items: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 40 }, description: "What they sell, e.g. [\"rice\", \"dal\"]." },
        language: { type: "string", enum: LANGS, description: "The language the supplier speaks: hi-IN, kn-IN or en-IN." },
        phone: { type: "string", maxLength: 16, description: "Optional phone number, only if the owner said it." },
      },
      ["name", "items"],
    ),
    async handler(ctx, args, language) {
      const existing = sameName(ctx.businessId, args.name);
      if (existing) {
        const invite = suppliers.createInvite(ctx.businessId, existing.id);
        let sent = false;
        try {
          sent = Boolean((await require("../notify/telegram").sendToOwner(ctx.businessId, suppliers.OWNER_TEXT.forward[langKey(repo.getBusiness(ctx.businessId)?.language)]({ name: existing.name, link: invite.deepLink })))?.sent);
        } catch (err) {
          console.warn(`[suppliers] could not send the start link to the owner's Telegram: ${err.message}`);
        }
        return { supplier: suppliers.publicView(existing), deepLink: invite.deepLink, expiresAt: invite.expiresAt, sentToOwner: sent, already: true, say: phrase("supplier_link_again", language, { name: existing.name, sent }) };
      }
      let out;
      try {
        out = await suppliers.addSupplier(
          ctx.businessId,
          { name: args.name, items: args.items, language: args.language ?? repo.getBusiness(ctx.businessId)?.language ?? "hi-IN", phone: args.phone ?? null },
          { actor: "agent", sessionId: ctx.sessionId ?? null },
        );
      } catch (err) {
        if (err?.code === "INVALID") throw invalid(err, language);
        throw err;
      }
      return {
        supplier: out.supplier,
        deepLink: out.invite.deepLink,
        expiresAt: out.invite.expiresAt,
        sentToOwner: out.sentToOwner,
        say: phrase("supplier_added", language, { name: out.supplier.name, sent: out.sentToOwner }),
      };
    },
  },
  {
    name: "list_suppliers",
    scopes: OWNER,
    description: "The owner's own, real suppliers: name, what they sell, and whether they are linked on Telegram (only linked suppliers can be reached). Speak `say`.",
    inputSchema: ownerObj({}),
    async handler(ctx, _args, language) {
      const list = suppliers.listSuppliers(ctx.businessId);
      if (!list.length) return { suppliers: [], say: phrase("suppliers_none", language) };
      const lang = langKey(language);
      const spoken = list.slice(0, 5).map((s) => phrase("supplier_row", lang, { name: s.name, linked: s.linked })).join(LIST_JOIN[lang]);
      return { suppliers: list, say: phrase("suppliers_list", lang, { count: list.length, list: spoken }) };
    },
  },
];

module.exports = { TOOLS, PHRASES };
