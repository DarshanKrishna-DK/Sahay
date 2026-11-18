<p align="center">
  <a href="public/assets/sahay-logo.png">
    <img src="public/assets/sahay-logo.png" alt="Sahay" width="200" />
  </a>
</p>

<h1 align="center">Sahay</h1>

<p align="center">
  <strong>An agent that finds your suppliers, phones them, negotiates in their language, and brings back five deals ranked by what actually leaves your bank account</strong>
</p>

<p align="center">
  Indian MSMEs lose an afternoon a week to the same six-question phone call. Sahay makes those calls instead, in Hindi or any of ten more Indian languages, then raises the purchase order and collects payment. It also watches competitor prices and the compliance calendar, so a rate change or a filing deadline never arrives as a surprise.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/voice-11%20Indian%20languages-E8A33D?style=flat-square" alt="Languages" />
  <img src="https://img.shields.io/badge/Sarvam-STT%20·%20TTS%20·%20translate-1a1a1a?style=flat-square&labelColor=4CB98B" alt="Sarvam" />
  <img src="https://img.shields.io/badge/Anakin-scrape%20·%20search-1a1a1a?style=flat-square&labelColor=E8A33D" alt="Anakin" />
  <img src="https://img.shields.io/badge/Groq-reasoning-1a1a1a?style=flat-square&labelColor=F0863C" alt="Groq" />
  <img src="https://img.shields.io/badge/Telegram-bot-229ED9?style=flat-square&logo=telegram&logoColor=white" alt="Telegram" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.5-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/no%20mock%20data-guaranteed-4CB98B?style=flat-square" alt="No mock data" />
</p>

---

## Features

- **Agentic procurement, end to end.** One sentence in, five negotiated deals out: parse the requirement, discover vendors, call each one, rank by landed cost, raise the purchase order, collect payment.
- **A negotiation, not a form.** The agent works through rate, minimum order, lead time, delivery and payment terms, then makes one polite push toward your target. It discloses that it is an automated assistant in its first sentence, every time, and that is not configurable.
- **Landed cost, not headline rate.** Rankings use the number that actually leaves the account: negotiated rate times quantity plus freight, weighed against MOQ feasibility and lead time.
- **Every figure is traceable.** Each quote is read back out of a recorded transcript with a confidence score, and the audit log stores the exact sentence the vendor said it in. No rate means no quote.
- **Voice-first in 11 Indian languages.** Speak to it, and it answers by voice. Hindi, Kannada, Tamil, Telugu, Marathi, Bengali, Gujarati, Malayalam, Punjabi, Odia and English.
- **Competitor watch** with per-source alert thresholds and variant-aware comparison, so a 100 g reading is never compared against last week's 500 g reading.
- **Compliance tracker** that builds a filing calendar from your category and state, grounded on live portal content, with escalating urgency and official portal links.
- **Telegram as the working surface.** Eight commands plus free-form voice, so the owner runs the business from a phone.
- **No sample-data fallback anywhere.** A broken connector surfaces as an error, because a business decision made on an invented number is worse than no answer.

---

## Architecture


**Sarvam supplies the voice; a telephony carrier supplies the line.** No Sarvam endpoint dials a phone number, so the negotiation agent is written against a channel interface (`open` / `speak` / `listen` / `close`) and knows nothing about transport. Swapping Telegram voice for a real PSTN call is a credentials change, not a rewrite.

---

## The procurement cycle

| Stage | What happens | Services |
| ----- | ------------ | -------- |
| 1 · Requirement | "500 cotton t-shirts, 180 GSM, under Rs.180 a piece, delivered in Bengaluru" becomes a structured RFQ. Only genuinely missing fields are asked for. | Sarvam STT, Groq |
| 2 · Discovery | IndiaMART and comparable B2B sources are searched and scraped; every candidate is extracted into a vendor record. | Anakin search + scraper |
| 3 · Scoring | Price vs target 35%, locality 25%, MOQ feasibility 20%, availability 10%, contactability 10%. A cheap vendor with no phone number cannot be negotiated with, and ranks accordingly. | Groq |
| 4 · Negotiation | A real spoken conversation per vendor, with a transcript. | Sarvam STT + TTS, Groq |
| 5 · Deals | Up to five, ranked by landed cost, each with a one-line rationale and the sentence its rate came from. | Groq |
| 6 · Order | On confirmation only: a PDF purchase order with a sequential reference, sent to the vendor, plus a payment link and order tracking. | PDFKit, Razorpay |

---

## Telegram commands

| Command | What it does |
| ------- | ------------ |
| `/start` | Link the chat to a Sahay workspace |
| `/buy` | Source something, start to finish |
| `/deals` | Negotiated deals waiting on a decision |
| `/orders` | Live orders and their status |
| `/watch` | Competitor and compliance alerts |
| `/summary` | Today's briefing, restricted to orders actually placed |
| `/ask` | Anything else, typed or spoken |
| `/language` | Change the reply language |

A voice note works anywhere a command does. Bot: [@sahaymitra_bot](https://t.me/sahaymitra_bot)

---

## Quick start

```bat
run.bat
```

Checks Node, installs dependencies, creates `.env`, verifies every connector against its live API, then starts the server and opens the browser.

| Surface | URL |
| ------- | --- |
| Landing page | <http://localhost:3000> |
| Dashboard | <http://localhost:3000/app> |
| Live call demo | <http://localhost:3000/app> then the **Live call** tab |
| Telegram | [@sahaymitra_bot](https://t.me/sahaymitra_bot) |

Requires **Node 22.5+**, which ships `node:sqlite`, so there is no native module to compile.

<details>
<summary>Manual setup</summary>

```bash
npm install
cp .env.example .env      # paste your keys
npm run doctor            # verifies every connector live
npm start
```
</details>

---

## Verified live

Every one of these was produced by the running system against real APIs, not written by hand.

| # | What | Result |
| - | ---- | ------ |
| 1 | Vendor discovery for 200 kg sona masoori rice | 17 real candidates scraped and scored; Surabhi Globals at Rs.63/kg, 10% under target, in Vidyaranyapura |
| 2 | Live negotiation for 500 cotton t-shirts | Opened at Rs.210/piece, agent pushed, closed at **Rs.185/piece**, MOQ 300, 8 day lead time, freight Rs.2000 |
| 3 | Quote extraction | Confidence 0.99, traced to "Okay, for you I can do 185 rupees per piece." |
| 4 | Landed cost | Rs.94,500 for 500 pieces including freight, ranked against the field |
| 5 | Purchase order | `SAHAY/2026/005/0001`, PDF with full agreed terms |
| 6 | Payment link | Live Razorpay test link created from the order total |
| 7 | Compliance calendar | 6 filings from 9 live sources, including the real Karnataka labour portal `ekarmika.karnataka.gov.in` |
| 8 | Watch modules | 2/2 modules, 13 live sources, digest translated to Hindi and voiced |

---

## Scripts

| Command | Purpose |
| ------- | ------- |
| `run.bat` | **Full end to end.** Check Node, install, create `.env`, pre-flight, start, open browser. |
| `run.bat doctor` | Connector pre-flight only. |
| `run.bat reset` | Wipe the local database and start fresh. |
| `npm start` | Start the server and the Telegram bot. |
| `npm run dev` | Same, with file watching. |
| `npm run doctor` | Verify Anakin, Groq, Sarvam, Telegram, Razorpay and the negotiation channel against live APIs. |

---

## Repo layout

| Path | Role |
| ---- | ---- |
| `src/procurement.js` | Requirement parsing, vendor discovery, scoring, deal ranking |
| `src/negotiator.js` | The negotiation agent, its brief, and quote extraction |
| `src/live-negotiation.js` | The same negotiation, one turn at a time, for a human counterpart |
| `src/channels/` | `telegram-voice` (live) and `pstn` (carrier drop-in) |
| `src/flow.js` | The procurement cycle, stitched together |
| `src/orders.js` | Purchase orders, Razorpay links, order state machine |
| `src/telegram/` | Bot, API client, and the conversation bus |
| `src/pipeline.js` | Watch modules, change detection, digest ranking |
| `src/compliance.js` | Filing calendar generation and escalation |
| `src/assistant.js` | Conversational agent and its seven tools |
| `src/groq.js` | Rate-limit-aware completion scheduler |
| `src/db.js` | Multi-tenant SQLite schema and queries |
| `public/` | Landing page, dashboard, design system |
| `scripts/doctor.js` | Live pre-flight for every connector |

---

## Trust and safety

- **Disclosure is mandatory.** The agent names itself as automated in its first sentence of every call.
- **Do-not-call is permanent.** A vendor who asks not to be contacted is never dialled again.
- **Nothing autonomous.** No order raised, no rate accepted, no payment requested without explicit human confirmation.
- **Money never moves on its own.** Sahay issues a payment link; a person authorises it.
- **Tenant-isolated.** Negotiated pricing is commercially sensitive, so every route resolves the tenant in one place and no handler can read across tenants.
- **Not a legal authority.** Compliance output always links to the official portal and is framed as a reminder layer, never the system of record.

---

## Known limitations

- **PSTN calling needs a carrier.** Negotiation runs over voice messaging until Exotel, Plivo or Twilio credentials are supplied. See `src/channels/pstn.js`.
- **Razorpay is in test mode.** Links are real and openable; no live settlement until production keys are set.
- **Marketplaces have no ordering API**, so orders happen by purchase order, which is how Indian B2B procurement actually works.
- **Groq's free tier caps tokens per minute per model**, so a full run takes minutes. The scheduler is waiting on budget, not hanging.
- Many scraped listings publish no phone number. Those vendors are recorded but cannot be negotiated with, and the scoring reflects it.
- One user per workspace; multi-user owner and accountant roles are not built.

---

**Languages:** Hindi, Kannada, Tamil, Telugu, Marathi, Bengali, Gujarati, Malayalam, Punjabi, Odia, English. **Store:** SQLite via `node:sqlite`, Postgres-shaped for migration. **Bot:** [@sahaymitra_bot](https://t.me/sahaymitra_bot).
