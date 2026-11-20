// Supplier join page (served by src/routes/api.js at /vendor/:code; the link arrives on Telegram).
// Classic script, no inline code, so the page runs under the same Content-Security-Policy as the app.
// The join code is read from the URL; the page holds no data until /api/vendor/:code/token answers.
// The first answer for a code carries a renewKey: only the page holding it can get the token again,
// read the call state or end the call (security review r1 #9). It is kept in sessionStorage (this
// tab only) and sent back in the X-Sahay-Renew-Key header.
(function () {
  "use strict";
  var code = location.pathname.split("/").pop();
  var base = "/api/vendor/" + encodeURIComponent(code);
  var storageKey = "sahay-renew-key:" + code;
  var POLL_MS = 2000;

  var $ = function (id) { return document.getElementById(id); };
  var el = { state: $("state"), notice: $("notice"), buyer: $("buyer"), shop: $("shop"), what: $("what"), status: $("status"),
    join: $("join"), mute: $("mute"), leave: $("leave"), turns: $("turns"), empty: $("empty"), logTitle: $("log-title"), foot: $("foot") };

  var WORDS = {
    "en-IN": {
      buyer: "Buyer", wants: function (q, u, i) { return "wants to buy " + q + " " + u + " of " + i; },
      join: "Join the call", mute: "Mute", unmute: "Unmute", end: "End", you: "You", log: "What was said",
      empty: "The conversation will appear here.", foot: "Only the shop owner can confirm an order.",
      ready: "Tap Join and allow the microphone.", connecting: "Connecting you to Sahay.", waiting: "You are in. Sahay will speak in a moment.",
      live: "You are live. Speak normally.", muted: "Your microphone is off.", ended: "The call has ended. Thank you.",
      agreed: "The price is noted. The shop owner will confirm the order; you will get a message on Telegram.",
      left: "You ended the call.", mic: "Sahay needs the microphone. Allow it in the browser, then tap Join again.",
      invalid: "This link is not valid or has expired. Please ask the shop for a new one.", failed: "Could not join the call. Check the internet and tap Join again.",
      pill: { loading: "Loading", ready: "Ready", connecting: "Connecting", live: "Live", ended: "Ended", error: "Not available" },
    },
    "hi-IN": {
      buyer: "खरीदार", wants: function (q, u, i) { return q + " " + u + " " + i + " खरीदना चाहते हैं"; },
      join: "कॉल से जुड़ें", mute: "माइक बंद", unmute: "माइक चालू", end: "कॉल ख़त्म", you: "आप", log: "क्या बात हुई",
      empty: "बातचीत यहाँ दिखेगी।", foot: "ऑर्डर केवल दुकान के मालिक पक्का करते हैं।",
      ready: "जुड़ें दबाइए और माइक की अनुमति दीजिए।", connecting: "सहाय से जोड़ रहे हैं।", waiting: "आप जुड़ गए हैं। सहाय अभी बोलेगी।",
      live: "आप लाइव हैं। आराम से बोलिए।", muted: "आपका माइक बंद है।", ended: "कॉल ख़त्म हुई। धन्यवाद।",
      agreed: "भाव नोट हो गया। दुकान के मालिक ऑर्डर पक्का करेंगे; आपको टेलीग्राम पर संदेश मिलेगा।",
      left: "आपने कॉल ख़त्म की।", mic: "सहाय को माइक चाहिए। ब्राउज़र में अनुमति दीजिए, फिर जुड़ें दबाइए।",
      invalid: "यह लिंक सही नहीं है या इसका समय निकल गया है। दुकान से नया लिंक माँगिए।", failed: "कॉल से नहीं जुड़ पाए। इंटरनेट देखिए और फिर जुड़ें दबाइए।",
      pill: { loading: "खुल रहा है", ready: "तैयार", connecting: "जुड़ रहा है", live: "लाइव", ended: "ख़त्म", error: "उपलब्ध नहीं" },
    },
    "kn-IN": {
      buyer: "ಖರೀದಿದಾರರು", wants: function (q, u, i) { return q + " " + u + " " + i + " ಖರೀದಿಸಲು ಬಯಸುತ್ತಾರೆ"; },
      join: "ಕರೆಗೆ ಸೇರಿ", mute: "ಮೈಕ್ ಆಫ್", unmute: "ಮೈಕ್ ಆನ್", end: "ಕರೆ ಮುಗಿಸಿ", you: "ನೀವು", log: "ಏನು ಮಾತಾಯಿತು",
      empty: "ಮಾತುಕತೆ ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ.", foot: "ಆರ್ಡರ್ ಅನ್ನು ಅಂಗಡಿ ಮಾಲೀಕರು ಮಾತ್ರ ಖಚಿತಪಡಿಸುತ್ತಾರೆ.",
      ready: "ಸೇರಿ ಒತ್ತಿ, ಮೈಕ್‌ಗೆ ಅನುಮತಿ ನೀಡಿ.", connecting: "ಸಹಾಯ್ ಜೊತೆ ಜೋಡಿಸುತ್ತಿದ್ದೇವೆ.", waiting: "ನೀವು ಸೇರಿದ್ದೀರಿ. ಸಹಾಯ್ ಈಗ ಮಾತನಾಡುತ್ತದೆ.",
      live: "ನೀವು ಲೈವ್ ಇದ್ದೀರಿ. ಸಹಜವಾಗಿ ಮಾತನಾಡಿ.", muted: "ನಿಮ್ಮ ಮೈಕ್ ಆಫ್ ಆಗಿದೆ.", ended: "ಕರೆ ಮುಗಿಯಿತು. ಧನ್ಯವಾದ.",
      agreed: "ಬೆಲೆ ದಾಖಲಾಗಿದೆ. ಅಂಗಡಿ ಮಾಲೀಕರು ಆರ್ಡರ್ ಖಚಿತಪಡಿಸುತ್ತಾರೆ; ನಿಮಗೆ ಟೆಲಿಗ್ರಾಮ್‌ನಲ್ಲಿ ಸಂದೇಶ ಬರುತ್ತದೆ.",
      left: "ನೀವು ಕರೆ ಮುಗಿಸಿದಿರಿ.", mic: "ಸಹಾಯ್‌ಗೆ ಮೈಕ್ ಬೇಕು. ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಅನುಮತಿ ನೀಡಿ, ನಂತರ ಸೇರಿ ಒತ್ತಿ.",
      invalid: "ಈ ಲಿಂಕ್ ಸರಿಯಿಲ್ಲ ಅಥವಾ ಅವಧಿ ಮುಗಿದಿದೆ. ಅಂಗಡಿಯಿಂದ ಹೊಸ ಲಿಂಕ್ ಕೇಳಿ.", failed: "ಕರೆಗೆ ಸೇರಲು ಆಗಲಿಲ್ಲ. ಇಂಟರ್ನೆಟ್ ನೋಡಿ, ಮತ್ತೆ ಸೇರಿ ಒತ್ತಿ.",
      pill: { loading: "ತೆರೆಯುತ್ತಿದೆ", ready: "ಸಿದ್ಧ", connecting: "ಜೋಡಿಸುತ್ತಿದೆ", live: "ಲೈವ್", ended: "ಮುಗಿದಿದೆ", error: "ಲಭ್ಯವಿಲ್ಲ" },
    },
  };
  var w = WORDS["en-IN"];
  var info = null, client = null, mic = null, muted = false, pollTimer = null, phase = "loading", shown = 0;

  function readKey() { try { return sessionStorage.getItem(storageKey); } catch (e) { return null; } }
  function keepKey(key) { try { sessionStorage.setItem(storageKey, key); } catch (e) { /* private mode: works until reload */ } }
  var renewKey = readKey();
  var keyHeaders = function () { return renewKey ? { "X-Sahay-Renew-Key": renewKey } : {}; };

  function label(btn, text) { btn.querySelector("span").textContent = text; }
  function setPhase(p) {
    phase = p;
    el.state.dataset.state = p;
    el.state.textContent = w.pill[p] || p;
  }
  function say(text, tone) {
    el.status.textContent = text;
    if (tone) el.status.dataset.tone = tone; else delete el.status.dataset.tone;
  }
  function applyLanguage(lang) {
    w = WORDS[lang] || WORDS["en-IN"];
    document.documentElement.lang = (lang || "en-IN").slice(0, 2);
    el.buyer.textContent = w.buyer;
    label(el.join, w.join);
    label(el.mute, muted ? w.unmute : w.mute);
    label(el.leave, w.end);
    el.logTitle.textContent = w.log;
    el.empty.textContent = w.empty;
    el.foot.textContent = w.foot;
    setPhase(phase);
  }

  function fetchToken() {
    return fetch(base + "/token", { headers: keyHeaders(), cache: "no-store" }).then(function (r) {
      if (!r.ok) { var err = new Error("token"); err.kind = r.status === 404 ? "invalid" : "failed"; throw err; }
      return r.json();
    }).then(function (j) {
      if (j.renewKey) { renewKey = j.renewKey; keepKey(j.renewKey); }
      return j;
    });
  }

  function renderTurns(turns) {
    if (!turns || turns.length === shown) return;
    for (var i = shown; i < turns.length; i++) {
      var t = turns[i];
      var li = document.createElement("li");
      li.className = "vj-turn";
      li.dataset.speaker = t.speaker === "vendor" ? "vendor" : "agent";
      var who = document.createElement("b");
      who.textContent = t.speaker === "vendor" ? w.you : "Sahay";
      li.appendChild(who);
      li.appendChild(document.createTextNode(t.text));
      el.turns.appendChild(li);
    }
    shown = turns.length;
    el.empty.hidden = shown > 0;
    el.turns.scrollTop = el.turns.scrollHeight;
  }

  function poll() {
    fetch(base + "/state", { headers: keyHeaders(), cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("gone");
      return r.json();
    }).then(function (s) {
      renderTurns(s.turns);
      if (s.status === "ended") return finish(s.agreed ? w.agreed : w.ended, s.agreed ? "good" : null);
      if (s.status === "live" && phase !== "live") { setPhase("live"); say(muted ? w.muted : w.live); }
      pollTimer = setTimeout(poll, POLL_MS);
    }).catch(function () {
      // The negotiation is gone (ended long ago, or the server restarted): say so, never pretend.
      if (phase === "live" || phase === "connecting") finish(w.ended);
    });
  }

  function hangUp() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    if (mic) { mic.close(); mic = null; }
    var c = client; client = null;
    return c ? c.leave().catch(function () {}) : Promise.resolve();
  }

  function finish(text, tone) {
    hangUp();
    setPhase("ended");
    el.mute.hidden = true;
    el.leave.hidden = true;
    el.join.hidden = true;
    say(text, tone);
  }

  fetchToken().then(function (j) {
    info = j;
    applyLanguage(j.language);
    el.notice.textContent = j.disclosure;
    el.shop.textContent = j.businessName;
    el.what.textContent = w.wants(j.quantity, j.unitSpoken, j.itemSpoken || j.item);
    el.join.disabled = false;
    setPhase("ready");
    say(w.ready);
  }).catch(function (e) {
    setPhase("error");
    el.join.hidden = true;
    say(e.kind === "invalid" ? w.invalid : w.failed, "bad");
  });

  function renew() {
    fetchToken().then(function (j) { info = j; return client && client.renewToken(j.token); }).catch(function () { /* the call goes on until the token lapses */ });
  }

  el.join.onclick = async function () {
    el.join.disabled = true;
    setPhase("connecting");
    say(w.connecting);
    try {
      client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      client.on("user-published", async function (user, type) {
        await client.subscribe(user, type);
        if (type === "audio") user.audioTrack.play();
      });
      client.on("token-privilege-will-expire", renew);
      // The microphone first: a refused permission leaves nobody half-joined.
      mic = await AgoraRTC.createMicrophoneAudioTrack();
      await client.join(info.appId, info.channel, info.token, Number(info.uid));
      await client.publish([mic]);
      await fetch(base + "/joined", { method: "POST" });
      el.join.hidden = true;
      el.mute.hidden = false;
      el.leave.hidden = false;
      say(w.waiting);
      poll();
    } catch (e) {
      await hangUp();
      setPhase("ready");
      el.join.disabled = false;
      var denied = e && (e.name === "NotAllowedError" || /PERMISSION_DENIED|NotAllowed/i.test(String(e.code || e.message)));
      say(denied ? w.mic : w.failed, "bad");
    }
  };

  el.mute.onclick = async function () {
    if (!mic) return;
    muted = !muted;
    await mic.setMuted(muted);
    el.mute.setAttribute("aria-pressed", String(muted));
    label(el.mute, muted ? w.unmute : w.mute);
    if (phase === "live") say(muted ? w.muted : w.live);
  };

  el.leave.onclick = async function () {
    el.leave.disabled = true;
    try { await fetch(base + "/left", { method: "POST", headers: keyHeaders() }); } catch (e) { /* leaving anyway */ }
    finish(w.left);
  };
})();
