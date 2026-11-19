"use strict";
/**
 * Generates the owner's spoken test clips with Murf Falcon (real speech, not recordings of a
 * person) into test/audio/. Used by browser QA to drive the voice console without a microphone.
 * The owner voice is deliberately different from Sahay's voice so transcripts are unambiguous.
 *
 *   node scripts/make-test-audio.js            # all clips
 *   node scripts/make-test-audio.js hi-request # one clip
 */
const fs = require("node:fs");
const path = require("node:path");

const ENV = path.join(__dirname, "..", ".env");
if (fs.existsSync(ENV)) process.loadEnvFile(ENV);

const OUT = path.join(__dirname, "..", "test", "audio");
const CLIPS = {
  "hi-request": { locale: "hi-IN", voiceId: "hi-IN-chirag", text: "नमस्ते, मुझे दो सौ किलो बासमती चावल चाहिए, बेंगलुरु में डिलीवरी, और नब्बे रुपये किलो से ज़्यादा नहीं।" },
  "hi-negotiate": { locale: "hi-IN", voiceId: "hi-IN-chirag", text: "ठीक है, सबसे अच्छे विक्रेता से मोल-भाव कीजिए।" },
  "hi-deals": { locale: "hi-IN", voiceId: "hi-IN-chirag", text: "अब सबसे अच्छी डील कौन सी है?" },
  "hi-change-qty": { locale: "hi-IN", voiceId: "hi-IN-chirag", text: "रुकिए, मात्रा बदलकर ढाई सौ किलो कर दीजिए।" },
  "hi-maybe": { locale: "hi-IN", voiceId: "hi-IN-chirag", text: "शायद, थोड़ा सोचने दीजिए।" },
  "hi-approve": { locale: "hi-IN", voiceId: "hi-IN-chirag", text: "हाँ, यह ऑर्डर कर दीजिए।" },
  "hi-paylink": { locale: "hi-IN", voiceId: "hi-IN-chirag", text: "भुगतान का लिंक भी बना दीजिए।" },
  "hi-status": { locale: "hi-IN", voiceId: "hi-IN-chirag", text: "मेरे ऑर्डर का क्या हाल है?" },
  "hi-teach-rule": { locale: "hi-IN", voiceId: "hi-IN-chirag", text: "एक नियम याद रखिए: बासमती चावल के लिए कभी भी अस्सी रुपये किलो से ज़्यादा मत देना।" },
  "hi-yes": { locale: "hi-IN", voiceId: "hi-IN-chirag", text: "हाँ, ठीक है।" },
  "kn-request": { locale: "kn-IN", voiceId: "hi-IN-chirag", text: "ನನಗೆ ಇನ್ನೂರು ಕಿಲೋ ಬಾಸ್ಮತಿ ಅಕ್ಕಿ ಬೇಕು, ಬೆಂಗಳೂರಿಗೆ ಡೆಲಿವರಿ ಬೇಕು." },
  "en-request": { locale: "en-IN", voiceId: "en-IN-aarav", text: "I need two hundred kilos of basmati rice delivered to Bengaluru, under ninety rupees a kilo." },
  "mix-request": { locale: "hi-IN", voiceId: "hi-IN-chirag", text: "मुझे 500 cotton t-shirts चाहिए, Bengaluru delivery, एक सौ अस्सी rupees per piece तक।" },
};

async function make(name) {
  const c = CLIPS[name];
  if (!c) throw new Error(`unknown clip ${name}`);
  const res = await fetch("https://global.api.murf.ai/v1/speech/stream", {
    method: "POST",
    headers: { "api-key": process.env.MURF_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text: c.text, voiceId: c.voiceId, model: "falcon-2.1", locale: c.locale, format: "WAV", sampleRate: 48000, channelType: "MONO" }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${name}: Murf ${res.status} ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.wav`), buf);
  fs.writeFileSync(path.join(OUT, `${name}.txt`), `${c.locale}\n${c.text}\n`);
  console.log(`${name}.wav ${buf.length} bytes (${c.locale}, ${c.voiceId})`);
}

(async () => {
  if (!process.env.MURF_API_KEY) throw new Error("MURF_API_KEY missing");
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CLIPS);
  for (const n of names) await make(n);
})().catch((e) => { console.error(e.message); process.exit(1); });
