const groq = require("./groq");
const sarvam = require("./sarvam");
const anakin = require("./anakin");
const db = require("./db");
const compliance = require("./compliance");
const { MODULES } = require("./modules/definitions");
const { toPlainText } = require("./text");

/**
 * Tools the conversational assistant may call (PRD 6.6).
 *
 * Design rule taken straight from the PRD risk table: read tools execute
 * immediately, but anything that would leave the platform - a reply to a
 * customer, a calendar entry, a message to a supplier - only ever produces a
 * DRAFT that the owner has to confirm. There is no autonomous send in v1.
 */
const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_latest_digest",
      description: "The owner's most recent ranked digest across all monitoring modules, with urgency and source links.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_compliance_calendar",
      description: "The business's personalised filing calendar with due dates, portal links and document checklists.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_price_history",
      description: "Historical observations for one module, to answer questions about trends over time.",
      parameters: {
        type: "object",
        properties: {
          module: { type: "string", enum: Object.keys(MODULES), description: "Which module's history to read." },
        },
        required: ["module"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_watchlist",
      description: "Which competitor, supplier, review and compliance sources this business currently monitors.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the live web for something not already in the business's data, e.g. a new competitor's price.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "The search query." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_watch",
      description: "Add a new source for the business to monitor from now on.",
      parameters: {
        type: "object",
        properties: {
          module: { type: "string", enum: Object.keys(MODULES) },
          url: { type: "string", description: "The page to monitor." },
          label: { type: "string", description: "A short human name for this source." },
        },
        required: ["module", "url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_action",
      description:
        "Draft an action for the owner to review and confirm. Use for review replies, supplier messages, " +
        "calendar reminders and staff to-dos. This NEVER sends anything - it only creates a draft.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["review_reply", "supplier_message", "calendar_reminder", "staff_todo", "whatsapp_message"] },
          title: { type: "string", description: "Short label for the draft." },
          body: { type: "string", description: "The full draft text, in the owner's language where it will be sent to a customer." },
          target: { type: "string", description: "Who or what this is for, e.g. a reviewer name, a supplier, a date." },
          source_url: { type: "string", description: "The page that prompted this, for auditability." },
        },
        required: ["type", "title", "body"],
      },
    },
  },
];

async function executeTool(business, name, args) {
  switch (name) {
    case "get_latest_digest": {
      const d = db.latestDigest(business.id);
      if (!d) return { note: "No digest has been generated yet. Ask the owner to run a check first." };
      return { created_at: d.created_at, items: d.items, summary: d.text_en };
    }
    case "get_compliance_calendar":
      return { events: compliance.calendarWithUrgency(business.id) };
    case "get_price_history": {
      const rows = db.observationHistory(business.id, args.module, 120);
      return {
        module: args.module,
        readings: rows.map((r) => ({
          at: r.observed_at, url: r.url, title: r.title,
          price: r.price_value, availability: r.availability, rating: r.rating, sentiment: r.sentiment,
        })),
      };
    }
    case "get_watchlist":
      return { watches: db.listWatches(business.id).map((w) => ({ id: w.id, module: w.module, label: w.label, url: w.url, query: w.query, threshold_pct: w.threshold_pct })) };
    case "search_web": {
      const results = await anakin.search(args.query, 4);
      return { results: results.map((r) => ({ url: r.url, title: r.title, excerpt: (r.text || "").slice(0, 900) })) };
    }
    case "add_watch": {
      const id = db.addWatch({ business_id: business.id, module: args.module, url: args.url, label: args.label || args.url });
      db.audit(business.id, "watch_added_by_agent", { id, ...args });
      return { added: true, watch_id: id };
    }
    case "draft_action": {
      const id = db.addAction({
        business_id: business.id, type: args.type, title: args.title,
        body: args.body, target: args.target || null, source_url: args.source_url || null,
      });
      db.audit(business.id, "action_drafted", { id, type: args.type });
      return { drafted: true, action_id: id, status: "awaiting owner confirmation", note: "Nothing has been sent. The owner must confirm this draft." };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

function systemPrompt(business) {
  const langName = business.language;
  return [
    `You are Sahay, an agentic business assistant for ${business.name}, a ${business.category || "small business"} in ${business.city || ""} ${business.state || "India"}.`,
    "You already monitor this owner's competitors, compliance obligations, reviews and suppliers. Use your tools to look things up before answering - never guess at a price, a rating or a deadline.",
    "Answer like a trusted, practical advisor talking to a busy shop owner: short, concrete, with actual numbers, and always a clear next step.",
    "Cite the source URL when you state a fact you looked up.",
    "You must never claim to have sent, filed, posted or submitted anything. If the owner asks you to reply to a review, message a supplier, or set a reminder, use draft_action and tell them the draft is ready for their approval.",
    "For compliance questions, always add that they should confirm on the official portal - you are a reminder layer, not the system of record.",
    `The owner reads ${langName}. Reply in English; the platform translates your answer for them.`,
    "Keep answers under 130 words unless the owner asks for detail.",
    // The client renders answers as plain text in a chat bubble, and TTS reads
    // them aloud - markdown syntax would be shown and spoken literally.
    "Write plain conversational text only. No markdown: no asterisks for bold or bullets, no backticks, no code fences, no headings. Use short sentences or a simple numbered list written as '1.' at the start of a line.",
    "When you draft something for the owner to send, put the draft text in the draft_action tool's body and then simply tell them it is ready for approval - do not repeat the whole draft back in your reply.",
  ].join(" ");
}

/**
 * One conversational turn, with multi-turn memory of the business context so
 * the owner never re-explains their business (PRD 6.6).
 */
async function ask(business, userText, { maxToolRounds = 4 } = {}) {
  db.addMessage(business.id, "user", userText);

  const history = db.recentMessages(business.id, 12);
  const messages = [
    { role: "system", content: systemPrompt(business) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const toolTrace = [];

  for (let round = 0; round < maxToolRounds; round++) {
    const msg = await groq.chat(messages, { tools: TOOLS, temperature: 0.3, maxTokens: 1400 });
    const calls = msg.tool_calls || [];

    if (!calls.length) {
      const answer = toPlainText(msg.content) || "I could not produce an answer for that. Try rephrasing?";
      db.addMessage(business.id, "assistant", answer);
      return { answer, toolTrace };
    }

    messages.push({ role: "assistant", content: msg.content || "", tool_calls: calls });

    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* tolerate malformed args */ }
      let result;
      try {
        result = await executeTool(business, call.function.name, args);
      } catch (err) {
        result = { error: err.message };
      }
      toolTrace.push({ tool: call.function.name, args, ok: !result.error });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }

  // Ran out of tool rounds - ask for a final answer with no tools available.
  const final = await groq.chatText([...messages, { role: "user", content: "Answer now using what you have gathered." }], { temperature: 0.3 });
  const answer = toPlainText(final) || "I gathered the data but could not summarise it. Please try again.";
  db.addMessage(business.id, "assistant", answer);
  return { answer, toolTrace };
}

/** Ask by voice: Sarvam STT in, answer + Sarvam TTS out, in the owner's language. */
async function askByVoice(business, audioBuffer, mimeType) {
  const { transcript, language, confidence } = await sarvam.speechToText(audioBuffer, mimeType);
  if (!transcript.trim()) throw new Error("Could not hear anything in that recording.");

  // The owner may speak in any Indic language; translate to English for reasoning.
  const detected = language || business.language;
  const english = detected.startsWith("en") ? transcript : await sarvam.translate(transcript, "en-IN", detected);

  const { answer, toolTrace } = await ask(business, english);
  const localised = await sarvam.translate(answer, business.language, "en-IN");
  let audio = [];
  try { audio = await sarvam.textToSpeech(localised, business.language); } catch { /* text answer still stands */ }

  return { transcript, detectedLanguage: detected, confidence, question: english, answer, answerLocal: localised, audio, toolTrace };
}

module.exports = { ask, askByVoice, TOOLS };
