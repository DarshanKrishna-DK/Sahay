// Human vendor join page (served by src/routes/api.js at /vendor/:code). Classic script, no
// inline code, so the page runs under the same Content-Security-Policy as the console.
// The join code is read from the URL; the page holds no data until /api/vendor/:code/token answers.
// The first answer for a code carries a renewKey: only the page holding it can get the token again
// (security review r1 #9). It is kept in sessionStorage (this tab only) and sent back in the
// X-Sahay-Renew-Key header, so a reload of this tab and a token renewal keep working.
(function () {
  var code = location.pathname.split("/").pop();
  var tokenUrl = "/api/vendor/" + encodeURIComponent(code) + "/token";
  var storageKey = "sahay-renew-key:" + code;
  var status = document.getElementById("status");
  var joinBtn = document.getElementById("join");
  var leaveBtn = document.getElementById("leave");
  var info = null, client = null, mic = null;
  function show(t) { status.textContent = t; }

  function readKey() {
    try { return sessionStorage.getItem(storageKey); } catch (e) { return null; }
  }
  function keepKey(key) {
    try { sessionStorage.setItem(storageKey, key); } catch (e) { /* private mode: renewal works until reload */ }
  }
  var renewKey = readKey();

  function fetchToken() {
    var headers = renewKey ? { "X-Sahay-Renew-Key": renewKey } : {};
    return fetch(tokenUrl, { headers: headers, cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? "This link is not valid or has expired." : "The server could not prepare the call.");
      return r.json();
    }).then(function (j) {
      if (j.renewKey) {
        renewKey = j.renewKey;
        keepKey(j.renewKey);
      }
      return j;
    });
  }

  fetchToken().then(function (j) {
    info = j;
    document.getElementById("notice").textContent = j.disclosure;
    document.getElementById("what").textContent = "Item: " + j.item;
    joinBtn.disabled = false;
    show("Ready. Press join and allow the microphone.");
  }).catch(function (e) { show(e.message); });

  function renew() {
    fetchToken().then(function (j) {
      info = j;
      return client.renewToken(j.token);
    }).catch(function (e) { show("Could not renew the call: " + e.message); });
  }

  joinBtn.onclick = async function () {
    joinBtn.disabled = true;
    try {
      client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      client.on("user-published", async function (user, type) {
        await client.subscribe(user, type);
        if (type === "audio") user.audioTrack.play();
      });
      client.on("token-privilege-will-expire", renew);
      await client.join(info.appId, info.channel, info.token, Number(info.uid));
      mic = await AgoraRTC.createMicrophoneAudioTrack();
      await client.publish([mic]);
      await fetch("/api/vendor/" + encodeURIComponent(code) + "/joined", { method: "POST" });
      leaveBtn.hidden = false;
      show("Connected. Speak normally.");
    } catch (e) {
      joinBtn.disabled = false;
      show("Could not join: " + e.message);
    }
  };
  leaveBtn.onclick = async function () {
    if (mic) mic.close();
    if (client) await client.leave();
    leaveBtn.hidden = true;
    show("You left the call.");
  };
})();
