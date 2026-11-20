<p align="center">
  <img src="public/assets/brand/sahay-mark-256.png" alt="Sahay" width="96" />
</p>

<h1 align="center">Sahay</h1>

<p align="center"><strong>A voice-first AI assistant for Indian kirana owners. It buys, sells, keeps the khata and watches stock, in Hindi, Kannada or English, and nothing involving money happens without the owner's "yes".</strong></p>

<p align="center">Agora Conversational AI · Murf Falcon · Sarvam ASR · Model Context Protocol</p>

<p align="center">Live demo: <a href="https://desktop-dgoqd3k.taile99d23.ts.net">desktop-dgoqd3k.taile99d23.ts.net</a> (runs on the owner's laptop, so it is up only while that laptop is on)</p>

---

## What it does

The owner talks (or types) to Sahay in their own language, and can switch language mid-sentence:

> "मुझे दो सौ किलो बासमती चावल चाहिए, बेंगलुरु में डिलीवरी, नब्बे रुपये किलो से ज़्यादा नहीं।"

- **Buy.** Sahay saves the need, finds real sellers on IndiaMART for that city and ranks them by comparable price per unit. It then bargains for the owner, never above the owner's ceiling: either with a **clearly labelled simulated vendor** (its own Murf voice; the owner can listen in), or with the owner's **real suppliers**, who are linked on Telegram and join the negotiation from a link.
- **The owner's yes.** Sahay reads the deal aloud. Only the owner's own spoken "yes" after that readback, or the tick button, approves it. Then it raises a purchase order PDF and a Razorpay **test-mode** checkout, and sends reminders.
- **Sell.** "रमेश ट्रेडर्स को साठ किलो बासमती, नब्बे रुपये किलो, बिल बना दीजिए।" Sahay drafts a GST bill (CGST+SGST or IGST, computed in code), reads it back, and issues it on a yes: a PDF with Devanagari and Kannada fonts, a test pay page for the customer and a free WhatsApp share link.
- **Khata.** Payments are recorded after a read-back and a yes; "who owes me money?" is answered largest first; reminders go out as WhatsApp links.
- **Stock.** Bills take stock out and delivered orders put it in. Below the owner's reorder level Sahay asks whether to buy more; a yes starts a search, never an order.
- **Your own agent.** The owner teaches rules by voice ("never pay more than ₹80 for rice", "don't buy from that seller again"). Rules are kept only after a yes, are enforced in code and can only narrow what Sahay may do.
- **Accounts.** Phone, shop name and a 4-digit PIN; log in with a passkey (fingerprint) or the PIN.

## How Agora, Murf and Sarvam are used

- **Agora Conversational AI** runs the owner's voice call (RTC audio, RTM text and transcripts) and both voices of a negotiation. Sahay's tools reach the agent through Sahay's own MCP server (`/mcp`) with a short-lived signed bearer token.
- **Sarvam ASR** (through Agora) hears Hindi, Kannada, English and mixed speech.
- **Murf Falcon** is the voice of Sahay and of the simulated vendor, with Indic text sent in its native script.
- The server keeps the agent honest: after any confirmation it speaks the real outcome itself, so the model cannot claim an order that did not happen.

## Architecture

```
Browser (public/)  -- RTC audio + RTM text -->  Agora ConvoAI agent (Sarvam ASR, LLM, Murf Falcon TTS)
   | REST + server-sent events                     | tools over MCP (signed bearer)
   v                                               v
Sahay server: Node 22, Express 4, node:sqlite  <---+
```

- `src/tools`: one tool registry, served to the agent over MCP
- `src/agora`: tokens, agent start/update, server-spoken readbacks and narration
- `src/discovery`, `src/procurement`: IndiaMART search, landed-cost scoring
- `src/negotiation`, `src/suppliers`: simulated-vendor and real-supplier negotiation
- `src/approvals.js`: the approval gate (readback, then the owner's yes)
- `src/orders`, `src/sell`, `src/stock`: purchase orders and payments, GST bills and khata, stock ledger
- `src/accounts`, `src/agent`: PIN and passkey accounts; the owner's rules and memories

## Safety rules (enforced in code, not prompts)

- **Approval gate:** no order, accepted rate, bill or payment link without the owner's explicit yes, written to the audit log; an order needs a consumed approval, checked by SQLite triggers.
- **Disclosure:** every call opens by saying Sahay is an automated assistant.
- **Simulated vendors are labelled** "simulated vendor" in the UI, the transcript and the audit log.
- **Payments are Razorpay test mode only;** a live key is refused at boot.
- **No sample data:** a failing connector shows an error, never invented sellers or prices.
- Tenant comes only from a signed session; rate limits and cost caps protect the public URL.

## Run it

Requirements: Node 22.5+, a public HTTPS URL for the server (Agora calls `/mcp` through it), and keys for Agora, Murf, Sarvam and Razorpay test mode (Groq and Telegram are optional). Variable names are in `.env.example`.

```bash
npm ci
cp .env.example .env      # fill in the keys; set PUBLIC_URL to your HTTPS URL
npm start                 # http://localhost:3000 (landing at /, app at /app)
npm test                  # node:test suite
```

On Windows, `run.bat` installs dependencies if needed, starts the server and shares it through Tailscale Funnel.

## Project layout

```
server.js        Express app, security headers, static files
src/             server modules (see Architecture)
public/          landing page, app, pay page, CSS, browser JS, pixel art
assets/fonts/    Noto Sans Devanagari and Kannada for PDFs (SIL OFL)
scripts/         art and footer generators, Sileo bundle build, test tools
test/            node:test suites and fixtures
run.bat          one-click start on Windows with Tailscale Funnel
```

## Licence and credits

MIT, see [LICENSE](LICENSE).

- Pixel and voxel art in `public/art` is our own, drawn from code by `scripts/art`.
- UI components adapted from [uiverse.io](https://uiverse.io) (MIT).
- Icons: [Tabler Icons](https://tabler.io/icons) (MIT).
- Toasts: Sileo (MIT), vendored with its licences in `public/vendor/sileo-0.1.6`.
- Fonts: Noto Sans Devanagari and Noto Sans Kannada (SIL Open Font License).
