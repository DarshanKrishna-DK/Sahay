<p align="center">
  <img src="public/assets/sahay-logo.png" alt="Sahay" width="160" />
</p>

<h1 align="center">Sahay</h1>

<p align="center"><strong>A voice agent that runs a small shop: it buys, sells, keeps the khata and watches stock. Speak in Hindi, Kannada or English (or mix them); nothing involving money happens without your spoken "yes".</strong></p>

<p align="center">
  Hindi · Kannada · English &nbsp;|&nbsp; Agora Conversational AI · Murf Falcon · Model Context Protocol
</p>

---

## What it does

An owner talks (or types) to their Sahay in their own language:

> "मुझे दो सौ किलो बासमती चावल चाहिए, बेंगलुरु में डिलीवरी, नब्बे रुपये किलो से ज़्यादा नहीं।"

1. **Plan.** Sahay saves the need (item, quantity, unit, city, ceiling) after checking each figure against what the owner actually said, and starts a background search at once.
2. **Execute.** It reads real IndiaMART listings for that city, ranks sellers by comparable price per unit, and tells the owner who is best.
3. **Negotiate.** It opens a second Agora channel with a **clearly labelled simulated vendor** (its own Murf voice) and bargains with a concession curve computed in code, never above the owner's ceiling. The owner can listen in live.
4. **Ask.** The server reads the deal aloud. Only the owner's own spoken "yes" heard *after* that readback (or the ✓ button) approves it. Typed text, "maybe", or laughter never counts.
5. **Confirm and follow up.** Sahay raises a purchase order PDF (Devanagari and Kannada fonts bundled), creates a Razorpay **test-mode** checkout, and schedules payment and delivery reminders (in the app and on Telegram).

### Sell, khata and stock
- **Sell:** "रमेश ट्रेडर्स को साठ किलो बासमती, नब्बे रुपये किलो, बिल बना दीजिए।" Sahay drafts the bill, reads it back, and issues it only after a spoken yes (or the Yes card): GST computed in code (CGST+SGST or IGST; plain bill by default, GSTIN when registered), PDF with Indic fonts, a Razorpay test pay page for the customer, and a free WhatsApp share link.
- **Khata:** "रमेश ने दो हज़ार कैश दिए" is read back and recorded on a yes; "किसके पास पैसे बाकी हैं?" answers largest first; reminders go out as WhatsApp links (copy to the owner's Telegram).
- **Stock:** every bill takes stock out and every delivered purchase order puts it in. Below the owner's reorder level Sahay asks on its own "चावल कम है… और मँगाऊँ?" and a yes starts a new purchase search (it never buys by itself).
- **Languages:** the owner can switch language mid-call (Kannada in a Hindi call, Hinglish, Kanglish); Sahay answers in the language just spoken, in its own script, with one multilingual Murf voice.
- **Accounts:** sign up with phone, shop and a 4-digit PIN; log in with fingerprint (passkey) or PIN. Phone numbers are not verified yet (no free SMS OTP in India).

### Your own agent
Owners teach Sahay by talking to it one to one: *"never pay more than ₹80 for rice"*, *"don't buy from that seller again"*, *"bargain harder"*. Sahay reads each rule back and keeps it only after a "yes". Rules are structured and enforced in code (price ceilings, avoided and preferred sellers, bargaining style, usual quantities, reply language). They can only narrow what the agent may do; none can place an order or skip the owner's yes. Sahay also suggests rules from what the owner keeps doing and remembers usual items, liked sellers and last prices.

## How it is built

```
Browser app (public/)  --RTC audio + RTM text/transcripts-->  Agora ConvoAI agent
   |  REST + server-sent events                               | Sarvam ASR · managed LLM · Murf Falcon TTS
   v                                                          | llm.mcp_servers -> /mcp (signed bearer)
Sahay server (Node 22, Express, node:sqlite) <----------------+
   src/tools     one tool registry, served over MCP to the agent
   src/agora     tokens, /join /speak /update /history, narration
   src/negotiation  simulated-vendor negotiation (two Agora agents, two Murf voices)
   src/approvals    the approval gate (readback-then-yes, DB triggers)
   src/orders       PO PDF, Razorpay Orders API test checkout
   src/sell         customers, GST invoices, invoice gate, khata, reminders
   src/stock        items, stock ledger, low-stock reorder proposals
   src/accounts     phone + PIN + passkey accounts
   src/agent        profile, rules, memories, read-aloud
```

- **Agora Conversational AI v2** runs the owner's call and both negotiation voices; tools reach the agent through Sahay's MCP server with a short-lived signed bearer.
- **Murf Falcon** is the voice of Sahay and of the simulated vendor, and reads any card aloud.
- **The server keeps the agent honest:** after any confirmation the server itself speaks the real outcome; if the owner clearly says yes after a readback and the model does not act, the server runs the same gate itself.
- **Safety in code, not prompts:** tenant only from a signed session; an order needs a consumed approval (enforced by SQLite triggers); the approval needs the owner's ASR turn after the server-spoken readback; cost caps and rate limits for a public URL; strict CSP with pinned, integrity-checked scripts; Razorpay test keys only.
- **No sample data.** A failing connector shows an error, never invented vendors or prices.

## Run it

Requirements: Node 22.5+, an HTTPS tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) or a hosted URL, and keys for Agora (App ID + certificate + Customer ID/secret), Murf, Sarvam (via Agora), Razorpay **test** keys, optionally Telegram and Groq. Variable names are in `.env.example`.

```bash
npm install
cp .env.example .env      # fill in values; set PUBLIC_URL to your HTTPS URL
npm test                  # node:test suite
npm start                 # http://localhost:3000  (landing at /, app at /app)
```

On Windows, `run.bat` starts the server and shares it through Tailscale Funnel (a stable public https link; set `PUBLIC_URL` to it) with `TRUST_PROXY=tailscale`, so rate limits and PIN lockouts see each caller's address. With cloudflared set `TRUST_CF_CONNECTING_IP=1` instead; with neither, every caller behind the tunnel shares one global limit.

## Honest limits
- Vendors in a negotiation are **simulated** (labelled everywhere); seller discovery uses **real** public IndiaMART listings.
- Payments are Razorpay **test mode** only; a live key is refused at boot.
- Calling real vendors by phone (Vobiz SIP) is not part of this build.
- Phone numbers are not verified (no free SMS OTP for Indian numbers; Telegram verification is planned).
