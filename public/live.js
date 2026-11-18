/* ==========================================================================
   Live call - a negotiation you can take part in.

   The supplier's seat is yours: the agent speaks, you answer by voice or by
   typing, and whatever you agree to becomes a real quote on the deals board.
   It drives the same negotiation brain the automated channels use, one turn at
   a time, so nothing here is a special demo path that proves nothing.

   Depends on helpers defined in app.js ($, el, api, toast, money, playChunks,
   showView, placeOrder, loadRFQs, loadLatestRFQ, state).
   ========================================================================== */

const liveState = { negId: null, rfq: null, audio: [], recording: null, busy: false };

function liveSay(speaker, text, sub) {
  const u = el("div", `u ${speaker}`);
  u.appendChild(el("div", "lbl", speaker === "agent" ? "Sahay" : "You (supplier)"));
  u.appendChild(el("p", null, text));
  if (sub) {
    const s = el("div", "eyebrow", sub);
    s.style.marginTop = "3px";
    u.appendChild(s);
  }
  const feed = $("live-feed");
  feed.appendChild(u);
  feed.scrollTop = feed.scrollHeight;
  return u;
}

function liveBusy(on, hint) {
  liveState.busy = on;
  $("live-send").disabled = on;
  $("live-mic").disabled = on;
  if (hint) $("live-hint").textContent = hint;
}

async function liveStart() {
  const need = $("live-need").value.trim();
  const vendorName = $("live-vendor").value.trim();
  if (!need) { toast("Say what is being bought."); $("live-need").focus(); return; }
  if (!vendorName) { toast("Give your supplier a name - the agent will address you by it."); $("live-vendor").focus(); return; }

  const btn = $("live-start");
  btn.disabled = true; btn.textContent = "Connecting…";
  $("live-result").innerHTML = "";
  $("live-feed").innerHTML = "";

  try {
    // A requirement first, so the agent knows what it is negotiating for.
    const { rfq } = await api(`/businesses/${state.business.id}/rfq/create`, {
      method: "POST", body: { text: need },
    });
    liveState.rfq = rfq;

    const out = await api(`/businesses/${state.business.id}/live/start`, {
      method: "POST",
      body: {
        rfqId: rfq.id,
        vendorName,
        vendorLocation: $("live-city").value.trim(),
        language: $("live-lang").value,
      },
    });

    liveState.negId = out.negotiationId;
    $("live-stage").classList.remove("hidden");
    $("live-state").textContent = `on a call with ${out.vendor.name}`;
    liveSay("agent", out.turn.text, out.turn.textLocal !== out.turn.text ? out.turn.textLocal : null);
    liveState.audio = out.turn.audio || [];
    playChunks(liveState.audio);
    liveBusy(false, "press the mic and answer as the supplier");
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false; btn.textContent = "Start the call";
  }
}

async function liveReply(body) {
  if (!liveState.negId || liveState.busy) return;
  liveBusy(true, "thinking…");
  try {
    const out = await api(`/businesses/${state.business.id}/live/${liveState.negId}/reply`, { method: "POST", body });
    liveSay("vendor", out.heard.text,
      out.heard.spoken && out.heard.spoken !== out.heard.text ? `heard: ${out.heard.spoken}` : null);
    liveSay("agent", out.turn.text, out.turn.textLocal !== out.turn.text ? out.turn.textLocal : null);
    liveState.audio = out.turn.audio || [];
    playChunks(liveState.audio);

    if (out.done) {
      $("live-state").textContent = "call ended";
      liveBusy(true, "call finished");
      renderLiveResult(out.result);
    } else {
      liveBusy(false, "press the mic and answer as the supplier");
    }
  } catch (err) {
    toast(err.message);
    liveBusy(false, "press the mic and answer as the supplier");
  }
}

async function liveEnd() {
  if (!liveState.negId) { toast("No call is running."); return; }
  const btn = $("live-end");
  btn.disabled = true; btn.textContent = "Reading the terms…";
  try {
    const { result } = await api(`/businesses/${state.business.id}/live/${liveState.negId}/end`, { method: "POST", body: {} });
    $("live-state").textContent = "call ended";
    liveBusy(true, "call finished");
    renderLiveResult(result);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false; btn.textContent = "End & get the quote";
  }
}

/** What the conversation actually produced. */
function renderLiveResult(result) {
  const wrap = $("live-result");
  wrap.innerHTML = "";
  if (!result) return;

  // No rate means no quote. Saying so plainly is the whole point.
  if (!result.quote) {
    const p = el("div", "panel");
    p.style.padding = "20px 22px";
    p.appendChild(el("h3", null, "No quote from that call"));
    p.appendChild(el("p", "muted", result.reason || "No rate was agreed."));
    wrap.appendChild(p);
    toast(result.reason || "No rate was agreed on that call.", "ok");
    return;
  }

  const q = result.quote;
  const card = el("div", "panel deal best");
  const top = el("div", "deal-top");
  top.appendChild(el("div", "rank", "✓"));
  const n = el("div");
  n.appendChild(el("h3", null, `Quote captured from ${q.vendor_name}`));
  n.appendChild(el("div", "muted", "Read back from what was actually said on the call"));
  top.appendChild(n);
  card.appendChild(top);

  const figs = el("div", "figs");
  const f = (k, v, good) => {
    const d = el("div", "fig");
    d.appendChild(el("div", "k", k));
    d.appendChild(el("div", `v ${good ? "good" : ""}`, v));
    figs.appendChild(d);
  };
  f("Rate", `${money(q.rate)} / ${q.unit || liveState.rfq?.unit || "unit"}`, true);
  if (q.landed_cost != null) f("Order total", money(q.landed_cost), true);
  if (q.moq) f("MOQ", q.moq);
  if (q.lead_time_text || q.lead_time_days) f("Lead time", q.lead_time_text || `${q.lead_time_days} days`);
  if (q.payment_terms) f("Payment", q.payment_terms);
  if (q.confidence != null) f("Confidence", `${Math.round(q.confidence * 100)}%`);
  card.appendChild(figs);

  // Provenance: the sentence the rate came out of.
  if (result.quotedSentence) card.appendChild(el("div", "why", `“${result.quotedSentence}”`));
  if (q.caveat) card.appendChild(el("div", "muted", `Caveat: ${q.caveat}`));

  const acts = el("div", "acts");
  const order = el("button", "btn btn-sm btn-primary", "Raise purchase order");
  order.onclick = () => placeOrder(q.id);
  acts.appendChild(order);
  const board = el("button", "btn btn-sm", "See it on the deals board");
  board.onclick = () => { showView("procure"); loadLatestRFQ(); };
  acts.appendChild(board);
  card.appendChild(acts);

  wrap.appendChild(card);
  toast("Quote captured from the call.", "ok");
  loadRFQs();
}

/** Voice capture for the live call. */
async function liveMic() {
  const mic = $("live-mic");
  if (liveState.recording) { liveState.recording.stop(); return; }

  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { toast("Microphone permission was denied. You can type your answer instead."); return; }

  const rec = new MediaRecorder(stream);
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    liveState.recording = null;
    mic.classList.remove("rec");
    const blob = new Blob(parts, { type: rec.mimeType || "audio/webm" });
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(String(r.result).split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    liveReply({ audioBase64: b64, mimeType: blob.type });
  };
  rec.start();
  liveState.recording = rec;
  mic.classList.add("rec");
  $("live-hint").textContent = "listening… press the mic again to send";
}

$("live-start").onclick = liveStart;
$("live-end").onclick = liveEnd;
$("live-mic").onclick = liveMic;
$("live-replay").onclick = () => playChunks(liveState.audio);
$("live-send").onclick = () => {
  const t = $("live-type").value.trim();
  if (!t) return;
  $("live-type").value = "";
  liveReply({ text: t });
};
$("live-type").addEventListener("keydown", (e) => { if (e.key === "Enter") $("live-send").click(); });
