/**
 * The two watch modules (PRD v2). Every module is a *lens* on the same pipeline
 * (scrape -> extract -> compare -> summarise), differing only in the extraction
 * schema and the prompting. This is the "one agent, not five apps" principle
 * expressed in code: adding another watch module is a data change, not a new pipeline.

 * Reputation and passive supplier tracking were cut in v2. Supplier pricing is
 * now handled by src/procurement.js, which does not watch a listed price but
 * calls the vendor and negotiates a real one - listed B2B rates are indicative,
 * the actual number comes from a phone call.
 */

const MODULES = {
  competitor: {
    key: "competitor",
    name: "Competitor Watch",
    icon: "target",
    blurb: "Price, stock and new-product changes across the storefronts you compete with.",
    // Fields the LLM must pull out of each scraped page.
    fields: ["title", "price_text", "price_value", "currency", "availability", "seller", "key_attribute"],
    extractionSystem:
      "You extract competitor pricing facts from a scraped retail/marketplace page for an Indian small-business owner. " +
      "Return ONLY JSON with keys: title (product or store name), price_text (price exactly as shown, e.g. '₹310'), " +
      "price_value (the number only, no symbol/commas, null if absent), currency (default 'INR'), " +
      "availability ('in stock' | 'out of stock' | 'limited' | 'unknown'), seller (site or brand name), " +
      "key_attribute (one short differentiator: pack size, offer, rating), " +
      "confidence (0-1 for how clearly the page stated the price). " +
      "A listing page often shows several pack sizes or variants. Report the PRIMARY variant - the one the page " +
      "presents as selected or lists first - and put its pack size in key_attribute, so readings taken on different " +
      "days stay comparable. Ignore struck-through, 'out of stock' and unrelated-product prices. " +
      "Never invent a price. If the page does not state one, set price_text and price_value to null and confidence to 0.",
    summarySystem:
      "You are Sahay, advising an Indian small-business owner on competitor pricing. Given extracted facts from the " +
      "sources plus any detected change since the last check, write 2-4 sentences of plain, concrete advice: who is " +
      "cheapest right now, what changed, and what the owner should do this week. Quote actual numbers. " +
      "No markdown symbols, no preamble.",
    urgencyHint: "A competitor undercutting the owner, or a stockout the owner could capture, is high urgency.",
  },

  compliance: {
    key: "compliance",
    name: "Compliance Tracker",
    icon: "shield",
    blurb: "GST, Udyam, labour and state filings relevant to your registration - with deadlines and portal links.",
    fields: ["title", "authority", "obligation", "due_or_change", "who_it_applies_to", "portal_url"],
    extractionSystem:
      "You extract regulatory/compliance facts from an Indian government or advisory page for a small-business owner. " +
      "Return ONLY JSON with keys: title (what the notice/rule is), authority (e.g. 'CBIC/GST', 'Udyam/MSME', " +
      "'Labour Dept', 'State PCB'), obligation (what a business must actually do, one sentence), " +
      "due_or_change (any date, deadline or rate change stated on the page, else null), " +
      "who_it_applies_to (which businesses this affects), portal_url (the official portal link if the page names one, else null), " +
      "confidence (0-1). " +
      "This is regulatory information: never state a deadline or rate the page does not contain. If unsure, set the field null.",
    summarySystem:
      "You are Sahay, summarising compliance information for an Indian MSME owner who is not a tax professional. " +
      "Write 2-4 plain sentences: what applies to this business, what the date is if one was found, and the next " +
      "concrete step. Always frame this as a reminder to verify on the official portal - never as legal certainty. " +
      "No markdown symbols.",
    urgencyHint: "A filing deadline inside 14 days is critical. A rate change affecting the business category is high.",
  },

};

const MODULE_KEYS = Object.keys(MODULES);

module.exports = { MODULES, MODULE_KEYS };
