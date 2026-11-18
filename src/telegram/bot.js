const tg = require("./api");
const bus = require("./bus");
const db = require("../db");
const sarvam = require("../sarvam");
const flow = require("../flow");
const orders = require("../orders");
const assistant = require("../assistant");
const procurement = require("../procurement");
const { config, LANGUAGES } = require("../config");
const { toPlainText } = require("../text");

/**
 * The Telegram bot.
 *
 * Long polling by default, so it runs on a laptop with no public URL and
 * behaves identically to a webhook deployment. Every handler is wrapped so one
 * bad update can never kill the loop.
 */

let running = false;
let offset = 0;

const COMMANDS = [
  { command: "start", description: "Link this chat to your Sahay workspace" },
  { command: "buy", description: "Source something - find vendors and negotiate" },
  { command: "deals", description: "Negotiated deals waiting for your decision" },
  { command: "orders", description: "Your live orders and their status" },
  { command: "watch", description: "Competitor and compliance alerts" },
  { command: "summary", description: "Today's briefing on placed orders" },
  { command: "ask", description: "Ask anything - type or send a voice note" },
  { command: "language", description: "Change the language Sahay replies in" },
  { command: "voice", description: "Turn spoken replies on or off" },
  { command: "help", description: "What Sahay can do" },
];

/* ------------------------------------------------------------- helpers --- */

const fmt = (n) => n == null ? "-" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function linkFor(chatId) {
  return db.getTelegramLink(chatId);
}

/**
 * Send a reply in the owner's language, spoken by default.
 *
 * Voice is opt-OUT rather than opt-in. The whole point of this product is an
 * owner who would rather listen than read; making them send a voice note first
 * to earn a spoken reply gets that backwards. `/voice off` turns it off.
 *
 * Text always goes out too, so there is a readable record and so a failed TTS
 * call can never swallow the answer.
 */
async function reply(chatId, english, { lang, voice, extra } = {}) {
  const text = toPlainText(english);
  const link = linkFor(chatId);
  const language = lang || link?.language || "en-IN";
  const wantVoice = voice !== undefined ? voice : link?.voice !== 0;

  let out = text;
  if (language !== "en-IN") {
    try { out = await sarvam.translate(text, language, "en-IN"); } catch { out = text; }
  }
  await tg.sendMessage(chatId, out, extra);

  if (wantVoice) {
    try {
      await tg.sendChatAction(chatId, "record_voice");
      const clips = await sarvam.speak(out, language);
      for (const clip of clips.slice(0, 3)) await tg.sendVoice(chatId, clip);
    } catch (err) {
      // The text is already delivered, so a TTS failure is a downgrade, not a
      // loss - but it should be visible rather than silent.
      console.error("[telegram] voice failed:", err.message);
    }
  }
  return out;
}

/** Resolve the workspace behind a chat, prompting to link if there is none. */
async function requireBusiness(chatId) {
  const link = linkFor(chatId);
  if (link?.business_id) {
    const business = db.getBusiness(link.business_id);
    if (business) return business;
  }
  const all = db.listBusinesses();
  if (!all.length) {
    await tg.sendMessage(chatId, "No Sahay workspace exists yet. Create one on the dashboard first, then send /start here.");
    return null;
  }
  await tg.sendMessage(chatId, "Which business is this?", {
    reply_markup: tg.keyboard(all.slice(0, 8).map((b) => [{ text: b.name, data: `link:${b.id}` }])),
  });
  return null;
}

/* ------------------------------------------------------------ commands --- */

async function cmdStart(chatId, msg) {
  db.linkTelegram(chatId, {
    business_id: linkFor(chatId)?.business_id ?? null,
    username: msg.from?.username, first_name: msg.from?.first_name,
    language: linkFor(chatId)?.language || "hi-IN",
  });
  await reply(chatId,
    `Namaste ${msg.from?.first_name || ""}. I am Sahay.\n\n` +
    "I find suppliers, call and negotiate with them for you, and bring back the best deals. " +
    "I also watch your competitors' prices and your filing deadlines.\n\n" +
    "Talk to me however you like - send a voice note in your own language, or just type. " +
    "I answer out loud by default.");
  await requireBusiness(chatId);
}

async function cmdHelp(chatId) {
  await reply(chatId,
    "What I can do:\n\n" +
    "/buy - tell me what you need and I will find vendors, negotiate, and bring you 5 deals\n" +
    "/deals - the deals waiting for your decision\n" +
    "/orders - your live orders\n" +
    "/watch - competitor and compliance alerts\n" +
    "/summary - today's briefing on orders you have placed\n" +
    "/ask - anything else, typed or spoken\n" +
    "/language - change my reply language\n" +
    "/voice - turn my spoken replies on or off\n\n" +
    "You can send me a voice note at any time instead of typing. I reply out loud by default.",
    { voice: false });
}

/** Turn spoken replies on or off. */
async function cmdVoice(chatId, arg) {
  const want = /off|band|nahi|no/i.test(arg) ? 0 : /on|chalu|haan|yes/i.test(arg) ? 1 : null;
  if (want === null) {
    const now = linkFor(chatId)?.voice !== 0;
    await tg.sendMessage(chatId, `My spoken replies are currently ${now ? "ON" : "OFF"}.`, {
      reply_markup: tg.keyboard([[{ text: "Voice on", data: "voice:1" }, { text: "Voice off", data: "voice:0" }]]),
    });
    return;
  }
  db.setTelegramVoice(chatId, want);
  await reply(chatId, want ? "I will speak my replies from now on." : "I will reply in text only from now on.",
    { voice: !!want });
}

async function cmdLanguage(chatId) {
  await tg.sendMessage(chatId, "Which language should I reply in?", {
    reply_markup: tg.keyboard(
      chunk(LANGUAGES.map((l) => ({ text: l.native, data: `lang:${l.code}` })), 3),
    ),
  });
}

const chunk = (arr, n) => arr.reduce((rows, x, i) => {
  if (i % n === 0) rows.push([]);
  rows[rows.length - 1].push(x);
  return rows;
}, []);

/**
 * /buy - the procurement conversation.
 * Anything after the command is treated as the requirement; otherwise we ask.
 */
async function cmdBuy(chatId, argText) {
  const business = await requireBusiness(chatId);
  if (!business) return;

  if (!argText.trim()) {
    db.setTelegramState(chatId, "awaiting_requirement");
    await reply(chatId,
      "What do you need to buy? Tell me the material, how much, and your target price if you have one.\n\n" +
      "For example: 200 kg sona masoori rice, under 70 rupees a kilo, delivered in Bengaluru.\n\n" +
      "You can send this as a voice note.");
    return;
  }
  await runBuy(chatId, business, argText);
}

/** Run the full procurement cycle, narrating each stage into the chat. */
async function runBuy(chatId, business, requirementText) {
  db.setTelegramState(chatId, null);
  await tg.sendChatAction(chatId, "typing");

  const parsed = await procurement.parseRequirement(business, requirementText);
  if (parsed.missing?.length) {
    db.setTelegramState(chatId, "awaiting_requirement", { partial: requirementText });
    await reply(chatId, `I need a little more: ${parsed.missing.join(" and ")}. Could you tell me?`);
    return;
  }

  await reply(chatId,
    `Got it: ${parsed.quantity ?? ""} ${parsed.unit || ""} of ${parsed.material}` +
    `${parsed.target_price ? `, target ₹${parsed.target_price} per ${parsed.unit || "unit"}` : ""}` +
    `${parsed.delivery_city ? `, delivered to ${parsed.delivery_city}` : ""}.\n\nLet me find suppliers.`);

  let last = "";
  const result = await flow.runRFQ(business, { parsed, text: requirementText }, {
    emit: async (e) => {
      // Narrate meaningfully, without spamming a message per event.
      const notable = {
        discovery: e.detail,
        shortlist: e.detail,
        negotiation: e.vendor && e.speaker === "agent" ? `Asking ${e.vendor}...` : e.detail,
        ranking: e.detail,
      }[e.stage];
      if (notable && notable !== last) {
        last = notable;
        await tg.sendMessage(chatId, notable).catch(() => {});
      }
    },
  }).catch(async (err) => {
    await reply(chatId, `I could not complete that: ${err.message}`);
    return null;
  });

  if (!result) return;

  if (result.warning) await reply(chatId, result.warning);
  if (!result.deals.length) {
    await reply(chatId,
      "I found suppliers but could not get a firm rate from any of them. " +
      "Their listed prices are on the dashboard, and I can try again later.");
    return;
  }
  await presentDeals(chatId, business, result.rfq, result.deals);
}

/** Present ranked deals as cards with a choose button on each. */
async function presentDeals(chatId, business, rfq, deals) {
  await reply(chatId, `Here are the ${deals.length} best deals for ${rfq.material}. Ranked by what actually leaves your account, not just the headline rate.`, { voice: true });

  for (const d of deals) {
    const lines = [
      `${d.rank}. ${d.vendor_name}`,
      `₹${fmt(d.rate)} per ${d.unit || rfq.unit || "unit"}` +
        (d.landed_cost ? `  ·  total ₹${fmt(d.landed_cost)}` : ""),
      d.vendor_location ? `Location: ${d.vendor_location}` : null,
      d.moq ? `MOQ: ${d.moq}` : null,
      (d.lead_time_text || d.lead_time_days) ? `Lead time: ${d.lead_time_text || `${d.lead_time_days} days`}` : null,
      d.payment_terms ? `Payment: ${d.payment_terms}` : null,
      d.rationale ? `\n${d.rationale}` : null,
      d.confidence != null && d.confidence < 0.6 ? "\n(I am not fully confident of these terms - worth confirming.)" : null,
    ].filter(Boolean);

    await tg.sendMessage(chatId, lines.join("\n"), {
      reply_markup: tg.keyboard([[
        { text: `Place order with ${d.vendor_name.slice(0, 18)}`, data: `order:${d.id}` },
        { text: "Transcript", data: `script:${d.negotiation_id}` },
      ]]),
    });
  }
}

async function cmdDeals(chatId) {
  const business = await requireBusiness(chatId);
  if (!business) return;
  const open = db.listRFQs(business.id).filter((r) => r.status === "quoted");
  if (!open.length) { await reply(chatId, "No deals are waiting. Send /buy to source something."); return; }
  for (const rfq of open.slice(0, 3)) {
    const deals = db.listQuotes(rfq.id).filter((q) => q.rank);
    if (deals.length) await presentDeals(chatId, business, rfq, deals);
  }
}

async function cmdOrders(chatId) {
  const business = await requireBusiness(chatId);
  if (!business) return;
  const list = db.listOrders(business.id);
  if (!list.length) { await reply(chatId, "You have no orders yet."); return; }

  const text = list.slice(0, 10).map((o) =>
    `${o.po_number}\n${o.material} · ${fmt(o.quantity)} ${o.unit || ""} · ₹${fmt(o.amount)}\n` +
    `${o.vendor_name || "-"} · ${o.status.replace(/_/g, " ")}` +
    (o.expected_delivery ? ` · due ${o.expected_delivery}` : "")).join("\n\n");
  await tg.sendMessage(chatId, text);
}

/**
 * /summary - deliberately narrow.
 * Reports only on orders actually placed, so the owner can start the day's
 * work. Market and compliance noise lives in /watch.
 */
async function cmdSummary(chatId) {
  const business = await requireBusiness(chatId);
  if (!business) return;
  const active = db.listActiveOrders(business.id);

  if (!active.length) {
    await reply(chatId, "Nothing is in flight today. No orders are awaiting delivery or payment.", { voice: true });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines = active.map((o) => {
    const due = o.expected_delivery
      ? (o.expected_delivery < today ? `overdue since ${o.expected_delivery}`
        : o.expected_delivery === today ? "due today" : `due ${o.expected_delivery}`)
      : "no delivery date";
    const needsPay = o.status === "confirmed" || o.status === "sent";
    return `${o.material} · ${fmt(o.quantity)} ${o.unit || ""} from ${o.vendor_name || "supplier"} - ${due}` +
      (needsPay ? " · payment pending" : "");
  });

  await reply(chatId,
    `You have ${active.length} order${active.length > 1 ? "s" : ""} in progress today.\n\n${lines.join("\n")}`,
    { voice: true });

  // Anything the agent promised to find out and has since resolved.
  const open = db.openFollowups(business.id);
  if (open.length) {
    await reply(chatId, `I am still chasing ${open.length} thing${open.length > 1 ? "s" : ""} for you: ${open.map((f) => f.question).join("; ")}`);
  }
}

async function cmdWatch(chatId) {
  const business = await requireBusiness(chatId);
  if (!business) return;
  const digest = db.latestDigest(business.id);
  if (!digest?.items?.length) { await reply(chatId, "No alerts yet. Run a check from the dashboard and I will report back."); return; }

  const text = digest.items.map((i) =>
    `${i.rank}. [${(i.urgency || "").toUpperCase()}] ${i.headline}\n${i.detail || ""}\n→ ${i.action || ""}`).join("\n\n");
  await tg.sendMessage(chatId, text);
  if (digest.text_local) {
    try {
      const clips = await sarvam.speak(digest.text_local, digest.language || "hi-IN");
      for (const clip of clips.slice(0, 3)) await tg.sendVoice(chatId, clip);
    } catch (err) { console.error("[telegram] digest voice failed:", err.message); }
  }
}

/** /ask and every free-form message route into the agent. */
async function handleQuestion(chatId, business, question, { spoken = false, spokenLang = null } = {}) {
  await tg.sendChatAction(chatId, "typing");
  const link = linkFor(chatId);
  // Answer in the language they actually spoke, falling back to their setting.
  const lang = spokenLang || link?.language || business.language || "hi-IN";

  try {
    const { answer } = await assistant.ask(business, question);
    await reply(chatId, answer, { lang });
  } catch (err) {
    // An honest deferral beats an invented answer.
    db.addFollowup({ business_id: business.id, chat_id: String(chatId), question, context: err.message });
    await reply(chatId,
      "I could not get that answer right now. I have noted it and will come back to you on it.", { lang });
  }
}

/* ------------------------------------------------------------ dispatch --- */

async function onCallback(cb) {
  const chatId = cb.message.chat.id;
  const [action, arg] = String(cb.data || "").split(":");
  await tg.answerCallbackQuery(cb.id);

  if (action === "link") {
    db.linkTelegram(chatId, { business_id: Number(arg), username: cb.from?.username, first_name: cb.from?.first_name });
    const b = db.getBusiness(Number(arg));
    await tg.sendMessage(chatId, `Linked to ${b.name}. Send /buy to source something, or just talk to me.`);
    return;
  }

  if (action === "voice") {
    db.setTelegramVoice(chatId, Number(arg));
    await reply(chatId, Number(arg) ? "I will speak my replies from now on." : "I will reply in text only from now on.",
      { voice: !!Number(arg) });
    return;
  }

  if (action === "lang") {
    db.setTelegramLanguage(chatId, arg);
    const l = LANGUAGES.find((x) => x.code === arg);
    await reply(chatId, `I will reply in ${l?.label || arg} from now on.`, { lang: arg, voice: true });
    return;
  }

  const business = await requireBusiness(chatId);
  if (!business) return;

  if (action === "script") {
    const lines = db.getTranscript(Number(arg));
    if (!lines.length) { await tg.sendMessage(chatId, "No transcript recorded for that negotiation."); return; }
    await tg.sendMessage(chatId, "Here is exactly what was said:\n\n" +
      lines.map((l) => `${l.speaker === "agent" ? "Sahay" : "Vendor"}: ${l.text}`).join("\n\n").slice(0, 3800));
    return;
  }

  if (action === "order") {
    await tg.sendChatAction(chatId, "upload_document");
    try {
      const order = orders.createFromQuote(business, Number(arg));
      const pdf = await orders.renderPO(business, order);
      await tg.sendDocument(chatId, pdf, `${order.po_number.replace(/\//g, "-")}.pdf`,
        `Purchase order ${order.po_number} for ₹${fmt(order.amount)}`);
      orders.advance(business, order.id, "sent", "PO issued to vendor");

      await tg.sendMessage(chatId,
        `Order raised with ${order.vendor_name}.\n\n` +
        `${order.material} · ${fmt(order.quantity)} ${order.unit || ""}\nTotal ₹${fmt(order.amount)}` +
        (order.expected_delivery ? `\nExpected ${order.expected_delivery}` : ""),
        { reply_markup: tg.keyboard([[{ text: "Pay now", data: `pay:${order.id}` }]]) });
    } catch (err) {
      await reply(chatId, `I could not raise that order: ${err.message}`);
    }
    return;
  }

  if (action === "pay") {
    try {
      const order = db.getOrder(business.id, Number(arg));
      const existing = db.getPaymentForOrder(order.id);
      const link = existing?.short_url
        ? { url: existing.short_url, amount: order.amount }
        : await orders.createPaymentLink(business, order);
      await tg.sendMessage(chatId,
        `Payment for ${order.po_number} - ₹${fmt(link.amount)}.\n\n` +
        "Opening this link completes the payment. Sahay never moves money on its own.",
        { reply_markup: tg.keyboard([[{ text: `Pay ₹${fmt(link.amount)}`, url: link.url }]]) });
    } catch (err) {
      await reply(chatId, `Could not create the payment link: ${err.message}`);
    }
  }
}

async function onMessage(msg) {
  const chatId = msg.chat.id;

  // A live negotiation owns this chat until it finishes.
  if (bus.deliver(chatId, msg)) return;

  db.linkTelegram(chatId, {
    business_id: linkFor(chatId)?.business_id ?? null,
    username: msg.from?.username, first_name: msg.from?.first_name,
    language: linkFor(chatId)?.language || "hi-IN",
  });

  // Voice note -> Sarvam STT -> treat exactly like typed text.
  let text = msg.text || msg.caption || "";
  let spoken = false;
  let spokenLang = null;
  if (msg.voice || msg.audio) {
    spoken = true;
    await tg.sendChatAction(chatId, "typing");
    try {
      const buf = await tg.downloadFile((msg.voice || msg.audio).file_id);
      const { transcript, language } = await sarvam.speechToText(buf, "audio/ogg");
      if (!transcript.trim()) { await tg.sendMessage(chatId, "I could not hear anything in that. Try again?"); return; }
      if (language) db.setTelegramLanguage(chatId, language);
      text = language && !language.startsWith("en")
        ? await sarvam.translate(transcript, "en-IN", language)
        : transcript;
      await tg.sendMessage(chatId, `“${transcript}”`);
    } catch (err) {
      await tg.sendMessage(chatId, `I could not understand that recording: ${err.message}`);
      return;
    }
  }

  if (!text.trim()) return;

  const cmdMatch = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
  if (cmdMatch) {
    const [, cmd, rest] = cmdMatch;
    switch (cmd) {
      case "start": return cmdStart(chatId, msg);
      case "help": return cmdHelp(chatId);
      case "language": return cmdLanguage(chatId);
      case "buy": return cmdBuy(chatId, rest);
      case "deals": return cmdDeals(chatId);
      case "orders": return cmdOrders(chatId);
      case "summary": return cmdSummary(chatId);
      case "watch": return cmdWatch(chatId);
      case "voice": return cmdVoice(chatId, rest);
      case "ask": {
        const business = await requireBusiness(chatId);
        if (!business) return;
        if (!rest.trim()) { db.setTelegramState(chatId, "awaiting_question"); await reply(chatId, "Go ahead - what would you like to know?"); return; }
        return handleQuestion(chatId, business, rest, { spoken, spokenLang });
      }
      default:
        await tg.sendMessage(chatId, `I do not know /${cmd}. Send /help to see what I can do.`);
        return;
    }
  }

  const business = await requireBusiness(chatId);
  if (!business) return;

  // Continue whatever conversation is in progress.
  const state = linkFor(chatId)?.state;
  if (state === "awaiting_requirement") return runBuy(chatId, business, text);
  if (state === "awaiting_question") { db.setTelegramState(chatId, null); return handleQuestion(chatId, business, text, { spoken, spokenLang }); }

  return handleQuestion(chatId, business, text, { spoken, spokenLang });
}

/* ---------------------------------------------------------------- loop --- */

async function poll() {
  while (running) {
    try {
      const updates = await tg.getUpdates(offset, 25);
      for (const u of updates) {
        offset = u.update_id + 1;
        try {
          if (u.message) await onMessage(u.message);
          else if (u.callback_query) await onCallback(u.callback_query);
        } catch (err) {
          console.error("[telegram] update failed:", err.message);
          const chatId = u.message?.chat?.id || u.callback_query?.message?.chat?.id;
          if (chatId) await tg.sendMessage(chatId, `Something went wrong on my side: ${err.message}`).catch(() => {});
        }
      }
    } catch (err) {
      if (!/aborted|timeout/i.test(err.message)) console.error("[telegram] poll error:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function start() {
  if (!config.telegram.token) {
    console.log("  Telegram  no token - bot disabled");
    return null;
  }
  const me = await tg.getMe();
  await tg.deleteWebhook();
  await tg.setMyCommands(COMMANDS).catch(() => {});
  running = true;
  poll();
  console.log(`  Telegram  @${me.username} polling`);
  return me;
}

function stop() { running = false; }

module.exports = { start, stop, onMessage, onCallback, COMMANDS };
