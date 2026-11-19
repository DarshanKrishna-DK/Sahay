"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const language = require("../src/agora/language");

const { detectLanguage, templateLanguage, ownerLanguage } = language;
const lang = (text) => detectLanguage(text).language;

const asr = (content, timestamp) => ({ role: "user", content, metadata: { source: "asr" }, timestamp });
const typed = (content, timestamp) => ({ role: "user", content, metadata: { source: "message" }, timestamp });
const said = (content, timestamp) => ({ role: "assistant", content, metadata: { source: "llm" }, timestamp });
const spoken = (content, timestamp) => ({ role: "assistant", content, metadata: { source: "command" }, timestamp });
const toolCall = (timestamp) => ({ role: "assistant", content: "", tool_calls: [{ id: "c1", name: "who_owes_me", arguments: "{}" }], timestamp });

test("native script decides: Hindi in Devanagari, Kannada in Kannada script, English in Latin", () => {
  assert.equal(lang("मुझे दो सौ किलो बासमती चावल चाहिए, बेंगलुरु में।"), "hi-IN");
  assert.equal(lang("ನನಗೆ 200 ಕಿಲೋ ಬಾಸ್ಮತಿ ಅಕ್ಕಿ ಬೇಕು. ಬೆಂಗಳೂರಿಗೆ ಡೆಲಿವರಿ ಬೇಕು."), "kn-IN", "the exact Sarvam transcript of test/audio/kn-request.wav");
  assert.equal(lang("I need 200 kilos of Basmati rice delivered to Bengaluru under 90 rupees a kilo."), "en-IN");
  assert.equal(lang("Who owes me money right now?"), "en-IN");
});

test("Hinglish as Sarvam writes it (all Devanagari, or codemix with English words in Latin) is Hindi", () => {
  assert.equal(lang("मुझे 500 कॉटन टी-शर्ट्स चाहिए, बेंगलुरु डिलीवरी 180 रुपीस पर पीस तक।"), "hi-IN");
  assert.equal(lang("मुझे 500 cotton T-shirts चाहिए, Bengaluru delivery 180 rupees per piece तक।"), "hi-IN");
  assert.equal(lang("मेरा order कब तक deliver होगा?"), "hi-IN");
});

test("the live-check clips, as Sarvam (language unknown) actually transcribed them, land in the right language", () => {
  // test/audio/{kanglish-stock,hinglish-owes,en-owes}.wav through Sarvam REST STT, 2026-11-20 (agora-findings.md).
  assert.equal(lang("ನನ್ನ ಸ್ಟಾಕ್ ಎಷ್ಟು ಇದೆ? ಬಸಮಟಿ ರೈಸ್ ಎಷ್ಟು ಉಳಿದಿದೆ?"), "kn-IN");
  assert.equal(lang("भाई मेरे पैसे किसके पास बाकी हैं? टोटल बताओ।"), "hi-IN");
  assert.equal(lang("Who owes me money right now?"), "en-IN");
});

test("Kanglish (Kannada grammar, English nouns) is Kannada", () => {
  assert.equal(lang("ನನ್ನ stock ಎಷ್ಟು ಇದೆ, basmati rice?"), "kn-IN");
  assert.equal(lang("ನನಗೆ 50 kilo sugar ಬೇಕು, delivery Mysore ಗೆ."), "kn-IN");
});

test("romanised Hindi and romanised Kannada (typed or transliterated) are Hindi and Kannada, not English", () => {
  assert.equal(lang("mujhe 200 kilo basmati chawal chahiye Bengaluru mein"), "hi-IN");
  assert.equal(lang("mere kitne paise baaki hain?"), "hi-IN");
  assert.equal(lang("kya haal hai bhai"), "hi-IN");
  assert.equal(lang("nanage eradu nooru kilo akki beku"), "kn-IN");
  assert.equal(lang("nanna stock eshtu ide?"), "kn-IN");
  assert.equal(lang("houdu, maadi"), "kn-IN");
  assert.equal(lang("stock check karo"), "hi-IN", "an English verb with a Hindi light verb is Hinglish");
  assert.equal(lang("stock check maadi"), "kn-IN");
  assert.equal(lang("Please check my stock"), "en-IN");
  assert.equal(lang("what is the price bhai"), "en-IN", "one Hindi tag word does not outweigh an English sentence");
});

test("Hindi and Kannada short answers are decisive; a bare ok, yes, number or name is not", () => {
  assert.equal(lang("हाँ"), "hi-IN");
  assert.equal(lang("ಹೌದು"), "kn-IN");
  assert.equal(lang("haan ji"), "hi-IN");
  for (const neutral of ["ok", "Okay.", "yes", "hmm", "200", "Ramesh Traders", "", null]) assert.equal(lang(neutral), null, String(neutral));
  assert.equal(lang("Yes, go ahead and place the order."), "en-IN", "a whole English sentence is English");
});

test("other Indian languages are recognised by script (Marathi by its own words in Devanagari)", () => {
  assert.equal(lang("मला दोनशे किलो तांदूळ पाहिजे."), "mr-IN");
  assert.equal(lang("எனக்கு இருநூறு கிலோ அரிசி வேண்டும்"), "ta-IN");
  assert.equal(lang("నాకు రెండు వందల కిలోల బియ్యం కావాలి"), "te-IN");
  assert.equal(lang("എനിക്ക് ഇരുനൂറ് കിലോ അരി വേണം"), "ml-IN");
  assert.equal(lang("আমার দুশো কেজি চাল চাই"), "bn-IN");
  assert.equal(lang("મને બસો કિલો ચોખા જોઈએ"), "gu-IN");
  assert.equal(lang("ਮੈਨੂੰ ਦੋ ਸੌ ਕਿਲੋ ਚੌਲ ਚਾਹੀਦੇ ਹਨ"), "pa-IN");
  assert.equal(lang("ମୋତେ ଦୁଇଶହ କିଲୋ ଚାଉଳ ଦରକାର"), "or-IN");
});

test("templateLanguage: the language a tool's say can be written in (hi, kn, en), null for the rest", () => {
  assert.equal(templateLanguage("hi-IN"), "hi-IN");
  assert.equal(templateLanguage("kn-IN"), "kn-IN");
  assert.equal(templateLanguage("en-IN"), "en-IN");
  assert.equal(templateLanguage("ta-IN"), null);
  assert.equal(templateLanguage(null), null);
});

test("ownerLanguage: the latest owner turn decides, spoken or typed; a neutral latest turn keeps the one before", () => {
  const contents = [spoken("नमस्ते, मैं सहाय हूँ", 1), asr("मुझे चीनी चाहिए", 2), said("जी, कितनी?", 3), asr("ನನ್ನ stock ಎಷ್ಟು ಇದೆ?", 4)];
  assert.deepEqual(ownerLanguage(contents), { language: "kn-IN", text: "ನನ್ನ stock ಎಷ್ಟು ಇದೆ?", latest: true, answered: false });
  const thenOk = [...contents, said("ಸರಿ, ನೋಡ್ತೀನಿ", 5), asr("ok", 6)];
  assert.deepEqual(ownerLanguage(thenOk), { language: "kn-IN", text: "ನನ್ನ stock ಎಷ್ಟು ಇದೆ?", latest: false, answered: false });
  assert.equal(ownerLanguage([...contents, typed("Who owes me money?", 5)]).language, "en-IN");
  assert.equal(ownerLanguage([spoken("नमस्ते", 1)]), null);
  assert.equal(ownerLanguage(null), null);
});

test("ownerLanguage marks a turn the agent already answered in words (the newer turn may not be in /history yet)", () => {
  assert.equal(ownerLanguage([asr("मुझे चीनी चाहिए", 1), said("जी, कितनी?", 2)]).answered, true);
  assert.equal(ownerLanguage([asr("मुझे चीनी चाहिए", 1), toolCall(2), spoken("चीनी के 3 विक्रेता मिले", 3)]).answered, false, "a tool call or a /speak line is not an answer");
});

/** resolveReplyLanguage without the /history contents it read. */
const resolved = async (ctx, model) => {
  const { language: chosen, source } = await language.resolveReplyLanguage(ctx, model);
  return { language: chosen, source };
};

/** A fake /history per agent id; counts reads. */
function fakeHistory(byAgent) {
  const reads = [];
  return {
    reads,
    history: async (agentId) => {
      reads.push(agentId);
      const value = byAgent[agentId];
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

test("resolveReplyLanguage: the owner's own latest words beat the model's reply_language", async (t) => {
  const fake = fakeHistory({ AG1: [spoken("नमस्ते", 1), asr("ನನಗೆ 200 ಕಿಲೋ ಬಾಸ್ಮತಿ ಅಕ್ಕಿ ಬೇಕು", 2)] });
  language.configure({ history: fake.history });
  t.after(() => language.configure(null));
  const got = await resolved({ businessId: "biz_a", agentId: "AG1" }, "hi-IN");
  assert.deepEqual(got, { language: "kn-IN", source: "owner" });
  assert.deepEqual(language.lastOwnerLanguage("biz_a"), { language: "kn-IN", template: "kn-IN" }, "remembered for the narrator");
});

test("resolveReplyLanguage: no call, an answered turn, a neutral turn or a failed read fall back to the model, then to what was remembered", async (t) => {
  const fake = fakeHistory({
    ANSWERED: [asr("मुझे चीनी चाहिए", 1), said("जी, कितनी?", 2)],
    NEUTRAL: [asr("ok", 1)],
    DOWN: Object.assign(new Error("timed out"), { code: "AGORA_UNREACHABLE" }),
    TAMIL: [asr("எனக்கு இருநூறு கிலோ அரிசி வேண்டும்", 1)],
  });
  language.configure({ history: fake.history });
  t.after(() => language.configure(null));
  assert.deepEqual(await resolved({ businessId: "biz_b", agentId: null }, "en-IN"), { language: "en-IN", source: "model" });
  assert.equal(fake.reads.length, 0, "no /history read outside a call");
  assert.deepEqual(await resolved({ businessId: "biz_b", agentId: "ANSWERED" }, "en-IN"), { language: "en-IN", source: "model" }, "the model saw a newer turn");
  assert.deepEqual(await resolved({ businessId: "biz_b", agentId: "ANSWERED" }, null), { language: "hi-IN", source: "owner" });
  assert.deepEqual(await resolved({ businessId: "biz_b", agentId: "NEUTRAL" }, "en-IN"), { language: "en-IN", source: "model" });
  assert.deepEqual(await resolved({ businessId: "biz_b", agentId: "DOWN" }, "kn-IN"), { language: "kn-IN", source: "model" });
  assert.deepEqual(await resolved({ businessId: "biz_b", agentId: "DOWN" }, null), { language: "hi-IN", source: "remembered" }, "the last language heard in this business");
  assert.deepEqual(await resolved({ businessId: "biz_c", agentId: "DOWN" }, null), { language: null, source: null });
  assert.deepEqual(await resolved({ businessId: "biz_b", agentId: "TAMIL" }, "en-IN"), { language: "en-IN", source: "model" }, "no Tamil say templates: the model's choice stands");
  assert.deepEqual(language.lastOwnerLanguage("biz_b"), { language: "ta-IN", template: null }, "but the narrator still learns the owner spoke Tamil");
});

test("resolveReplyLanguage: tool calls that start together share one /history read; a later call reads afresh", async (t) => {
  const items = [asr("Who owes me money?", 1)];
  const fake = fakeHistory({ AG1: items, AG2: [asr("किसके पैसे बाकी हैं?", 1)] });
  language.configure({ history: fake.history });
  t.after(() => language.configure(null));
  const ctx1 = { businessId: "biz_d", agentId: "AG1" };
  const [a, b] = await Promise.all([resolved(ctx1, "hi-IN"), resolved(ctx1, "hi-IN")]);
  assert.equal(a.language, "en-IN");
  assert.equal(b.language, "en-IN");
  assert.equal((await resolved({ businessId: "biz_e", agentId: "AG2" }, "en-IN")).language, "hi-IN");
  assert.deepEqual(fake.reads, ["AG1", "AG2"]);
  items.push(said("Ramesh owes 2000 rupees.", 2), asr("ಸರಿ, ಅವರಿಗೆ ರಿಮೈಂಡರ್ ಕಳಿಸಿ", 3));
  assert.equal((await resolved(ctx1, "en-IN")).language, "kn-IN", "the owner switched to Kannada mid-call");
  assert.deepEqual(fake.reads, ["AG1", "AG2", "AG1"]);
});

test("the default /history read is bounded well under the 10 s MCP tool timeout", () => {
  assert.ok(language.HISTORY_TIMEOUT_MS <= 1500, String(language.HISTORY_TIMEOUT_MS));
});
