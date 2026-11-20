"use strict";

/**
 * Sell tools for the owner agent (contract SELL): add_customer, set_item, draft_invoice,
 * request_invoice_approval, confirm_invoice. (record_payment, who_owes_me and send_payment_reminder
 * are KHATA's, src/tools/khata.js.) Registered by one line in src/tools/registry.js, which passes
 * its own helpers in, validates the arguments, resolves `language` (the owner's reply language)
 * and builds ctx from the verified bearer only.
 *
 * Nothing a model says becomes a fact unchecked:
 * - names, quantities, prices, HSN codes and GST rates must be in the owner's own words (the
 *   call's /history ASR turns; off a call, the owner_words the model copied);
 * - an item's HSN + GST rate are read back by the server and saved only on the owner's spoken yes;
 * - an invoice is issued only through src/sell/gate.js: the server speaks the read-back and the
 *   owner's spoken yes to it (never a typed one) issues it.
 * Every `say` is built here from stored data, in the owner's language and its own script.
 */

const repo = require("../db/repo");
const events = require("../events");
const evidence = require("./evidence");
const { ToolError, toToolError, sayFor, langKey } = require("./errors");
const gst = require("../sell/gst");
const customers = require("../sell/customers");
const invoices = require("../sell/invoices");
const itemTax = require("../sell/item-tax");
const gate = require("../sell/gate");
const { SellError } = require("../sell/errors");
const { canonicalUnit, unitWord } = require("../procurement/units");
const outcome = require("../agora/outcome");
/** One /history read inside a tool is bounded, so the tool answers within the MCP timeout_ms. */
const { TOOL_HISTORY_TIMEOUT_MS } = require("../agora/agent");

const items = () => require("../stock/items");

const OWNER = ["owner"];
/** How many of the owner's latest turns may carry one bill ("Ramesh ko..." ... "pachaas kilo basmati, pachaanve rupaye"). */
const INVOICE_TURNS = 4;

/* -------------------------------------------------------------- speech --- */

const PHRASES = {
  customer_saved: {
    "hi-IN": (v) => `${v.name} ${v.created ? "ग्राहक के रूप में जोड़ लिया" : "की जानकारी सहेज ली"}।`,
    "kn-IN": (v) => `${v.name} ${v.created ? "ಅವರನ್ನು ಗ್ರಾಹಕರಾಗಿ ಸೇರಿಸಿದೆ" : "ಅವರ ಮಾಹಿತಿ ಉಳಿಸಿದೆ"}.`,
    "en-IN": (v) => `${v.created ? "Added" : "Saved"} ${v.name}${v.created ? " as a customer" : ""}.`,
  },
  not_heard: {
    "hi-IN": (v) => `माफ़ कीजिए, ${v.what} साफ़ सुनाई नहीं दिया; फिर से बताइए।`,
    "kn-IN": (v) => `ಕ್ಷಮಿಸಿ, ${v.what} ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ; ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ.`,
    "en-IN": (v) => `Sorry, I did not clearly hear ${v.what}; please say it again.`,
  },
  item_saved: {
    "hi-IN": (v) => `${v.item} सहेज लिया${v.price ? `, बिक्री भाव ${v.price} रुपये प्रति ${v.unit}` : ""}।`,
    "kn-IN": (v) => `${v.item} ಉಳಿಸಿದೆ${v.price ? `, ಮಾರಾಟ ಬೆಲೆ ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ` : ""}.`,
    "en-IN": (v) => `Saved ${v.item}${v.price ? `, selling at ${v.price} rupees per ${v.unit}` : ""}.`,
  },
  item_tax_question: {
    "hi-IN": () => "हाँ या ना में बताइए।",
    "kn-IN": () => "ಹೌದು ಅಥವಾ ಇಲ್ಲ ಎಂದು ಹೇಳಿ.",
    "en-IN": () => "Please say yes or no.",
  },
  item_tax_saved: {
    "hi-IN": (v) => `ठीक है, ${v.item} का एचएसएन ${v.hsn} और जीएसटी ${v.rate} प्रतिशत सहेज लिया।`,
    "kn-IN": (v) => `ಸರಿ, ${v.item} ಎಚ್‌ಎಸ್‌ಎನ್ ${v.hsn} ಮತ್ತು ಜಿಎಸ್‌ಟಿ ಶೇಕಡಾ ${v.rate} ಉಳಿಸಿದೆ.`,
    "en-IN": (v) => `Done: ${v.item} is saved with HSN ${v.hsn} and GST ${v.rate} percent.`,
  },
  item_tax_both: {
    "hi-IN": () => "एचएसएन कोड और जीएसटी दर दोनों बताइए, मैं अंदाज़े से नहीं भरूँगी।",
    "kn-IN": () => "ಎಚ್‌ಎಸ್‌ಎನ್ ಕೋಡ್ ಮತ್ತು ಜಿಎಸ್‌ಟಿ ದರ ಎರಡನ್ನೂ ಹೇಳಿ, ನಾನು ಊಹಿಸಿ ತುಂಬುವುದಿಲ್ಲ.",
    "en-IN": () => "Please tell me both the HSN code and the GST rate; I will not guess them.",
  },
  item_tax_in_call: {
    "hi-IN": () => "एचएसएन और जीएसटी मैं कॉल में पढ़कर सुनाती हूँ और आपकी हाँ के बाद ही सहेजती हूँ; कृपया कॉल में बताइए।",
    "kn-IN": () => "ಎಚ್‌ಎಸ್‌ಎನ್ ಮತ್ತು ಜಿಎಸ್‌ಟಿಯನ್ನು ಕರೆಯಲ್ಲಿ ಓದಿ ಹೇಳಿ ನಿಮ್ಮ ಹೌದು ನಂತರವೇ ಉಳಿಸುತ್ತೇನೆ; ದಯವಿಟ್ಟು ಕರೆಯಲ್ಲಿ ಹೇಳಿ.",
    "en-IN": () => "I read the HSN and GST out in the call and save them only after your yes; please tell me in the call.",
  },
  item_tax_unclear: {
    "hi-IN": () => "मुझे साफ़ हाँ सुनाई नहीं दी, इसलिए एचएसएन और जीएसटी नहीं सहेजे।",
    "kn-IN": () => "ಸ್ಪಷ್ಟವಾಗಿ ಹೌದು ಕೇಳಿಸಲಿಲ್ಲ, ಹಾಗಾಗಿ ಎಚ್‌ಎಸ್‌ಎನ್ ಮತ್ತು ಜಿಎಸ್‌ಟಿ ಉಳಿಸಲಿಲ್ಲ.",
    "en-IN": () => "I did not hear a clear yes, so I have not saved the HSN and GST.",
  },
  invoice_drafted: {
    "hi-IN": (v) => `${v.customer} का बिल तैयार है, कुल ${v.total} रुपये। पक्का करने के लिए मैं पढ़कर सुनाऊँ?`,
    "kn-IN": (v) => `${v.customer} ಅವರ ಬಿಲ್ ಸಿದ್ಧವಾಗಿದೆ, ಒಟ್ಟು ${v.total} ರೂಪಾಯಿ. ಖಚಿತಪಡಿಸಲು ಓದಿ ಹೇಳಲೇ?`,
    "en-IN": (v) => `The bill for ${v.customer} is ready, ${v.total} rupees in all. Shall I read it out for your yes?`,
  },
  invoice_question: {
    "hi-IN": () => "बिल बनाऊँ, हाँ या ना?",
    "kn-IN": () => "ಬಿಲ್ ಮಾಡಲೇ, ಹೌದು ಅಥವಾ ಇಲ್ಲ?",
    "en-IN": () => "Shall I make the bill, yes or no?",
  },
  invoice_issued: {
    "hi-IN": (v) => `बिल ${v.number} बन गया, कुल ${v.total} रुपये।${v.pay ? " भुगतान लिंक और व्हाट्सऐप शेयर स्क्रीन पर है।" : ""}`,
    "kn-IN": (v) => `ಬಿಲ್ ${v.number} ಆಯಿತು, ಒಟ್ಟು ${v.total} ರೂಪಾಯಿ.${v.pay ? " ಪಾವತಿ ಲಿಂಕ್ ಮತ್ತು ವಾಟ್ಸಾಪ್ ಹಂಚಿಕೆ ಪರದೆಯ ಮೇಲಿದೆ." : ""}`,
    "en-IN": (v) => `Bill ${v.number} is made, ${v.total} rupees in all.${v.pay ? " The pay link and the WhatsApp share are on the screen." : ""}`,
  },
  invoice_issued_partly: {
    "hi-IN": (v) => `बिल ${v.number} बन गया, पर ${v.what} नहीं बन पाया।`,
    "kn-IN": (v) => `ಬಿಲ್ ${v.number} ಆಯಿತು, ಆದರೆ ${v.what} ಮಾಡಲು ಆಗಲಿಲ್ಲ.`,
    "en-IN": (v) => `Bill ${v.number} is made, but the ${v.what} could not be made.`,
  },
  invoice_rejected: {
    "hi-IN": () => "ठीक है, बिल नहीं बनाया; यह अभी ड्राफ़्ट में है।",
    "kn-IN": () => "ಸರಿ, ಬಿಲ್ ಮಾಡಲಿಲ್ಲ; ಇದು ಇನ್ನೂ ಕರಡಿನಲ್ಲಿದೆ.",
    "en-IN": () => "All right, I have not made the bill; it stays a draft.",
  },
  no_invoice: {
    "hi-IN": () => "अभी कोई बिल तैयार नहीं है; किसको क्या बेचा, बताइए।",
    "kn-IN": () => "ಈಗ ಯಾವ ಬಿಲ್ ಕೂಡ ಸಿದ್ಧವಾಗಿಲ್ಲ; ಯಾರಿಗೆ ಏನು ಮಾರಿದಿರಿ, ಹೇಳಿ.",
    "en-IN": () => "There is no bill ready yet; tell me who bought what.",
  },
};

const WHAT = {
  customer: { "hi-IN": "ग्राहक का नाम", "kn-IN": "ಗ್ರಾಹಕರ ಹೆಸರು", "en-IN": "the customer's name" },
  item: { "hi-IN": "सामान का नाम", "kn-IN": "ವಸ್ತುವಿನ ಹೆಸರು", "en-IN": "the item" },
  quantity: { "hi-IN": "मात्रा", "kn-IN": "ಪ್ರಮಾಣ", "en-IN": "the quantity" },
  rate: { "hi-IN": "भाव", "kn-IN": "ಬೆಲೆ", "en-IN": "the price" },
  phone: { "hi-IN": "फ़ोन नंबर", "kn-IN": "ಫೋನ್ ಸಂಖ್ಯೆ", "en-IN": "the phone number" },
  hsn: { "hi-IN": "एचएसएन कोड", "kn-IN": "ಎಚ್‌ಎಸ್‌ಎನ್ ಕೋಡ್", "en-IN": "the HSN code" },
  gst_rate: { "hi-IN": "जीएसटी दर", "kn-IN": "ಜಿಎಸ್‌ಟಿ ದರ", "en-IN": "the GST rate" },
  pdf: { "hi-IN": "पीडीएफ़", "kn-IN": "ಪಿಡಿಎಫ್", "en-IN": "PDF" },
  pay: { "hi-IN": "भुगतान लिंक", "kn-IN": "ಪಾವತಿ ಲಿಂಕ್", "en-IN": "pay link" },
};

/** Spoken lines for the Sell modules' refusals. Each a complete sentence, no figures. */
const SAY = {
  GSTIN_REQUIRED: {
    "hi-IN": "जीएसटी बिल के लिए पहले बेचने वाले पन्ने की सेटिंग में दुकान का जीएसटी नंबर डालिए।",
    "kn-IN": "ಜಿಎಸ್‌ಟಿ ಬಿಲ್‌ಗೆ ಮೊದಲು ಮಾರಾಟ ಪುಟದ ಸೆಟ್ಟಿಂಗ್‌ನಲ್ಲಿ ಅಂಗಡಿಯ ಜಿಎಸ್‌ಟಿ ಸಂಖ್ಯೆ ಹಾಕಿ.",
    "en-IN": "Add the shop's GST number in the Sell settings before making a GST bill.",
  },
  STATE_REQUIRED: {
    "hi-IN": "बिल के लिए दुकान का राज्य सेटिंग में डालिए।",
    "kn-IN": "ಬಿಲ್‌ಗಾಗಿ ಅಂಗಡಿಯ ರಾಜ್ಯವನ್ನು ಸೆಟ್ಟಿಂಗ್‌ನಲ್ಲಿ ಹಾಕಿ.",
    "en-IN": "Add the shop's state in the settings to make a bill.",
  },
  TAX_NOT_CONFIRMED: {
    "hi-IN": "इस सामान का एचएसएन कोड और जीएसटी दर अभी पक्के नहीं हैं; पहले वो बताइए, मैं पढ़कर सुनाऊँगी।",
    "kn-IN": "ಈ ವಸ್ತುವಿನ ಎಚ್‌ಎಸ್‌ಎನ್ ಕೋಡ್ ಮತ್ತು ಜಿಎಸ್‌ಟಿ ದರ ಇನ್ನೂ ಖಚಿತವಾಗಿಲ್ಲ; ಮೊದಲು ಅವನ್ನು ಹೇಳಿ, ನಾನು ಓದಿ ಹೇಳುತ್ತೇನೆ.",
    "en-IN": "This item's HSN code and GST rate are not confirmed yet; tell me them first and I will read them back.",
  },
  ITEM_UNKNOWN: {
    "hi-IN": "यह सामान अभी सूची में नहीं है; पहले इसका नाम, इकाई और भाव बताइए।",
    "kn-IN": "ಈ ವಸ್ತು ಇನ್ನೂ ಪಟ್ಟಿಯಲ್ಲಿಲ್ಲ; ಮೊದಲು ಅದರ ಹೆಸರು, ಘಟಕ ಮತ್ತು ಬೆಲೆ ಹೇಳಿ.",
    "en-IN": "That item is not in the list yet; tell me its name, unit and price first.",
  },
  RATE_REQUIRED: {
    "hi-IN": "इस सामान का भाव नहीं बताया गया; किस भाव पर बेचा?",
    "kn-IN": "ಈ ವಸ್ತುವಿನ ಬೆಲೆ ಹೇಳಿಲ್ಲ; ಯಾವ ಬೆಲೆಗೆ ಮಾರಿದಿರಿ?",
    "en-IN": "No price was given for this item; at what price was it sold?",
  },
  UNIT_MISMATCH: {
    "hi-IN": "यह सामान दूसरी इकाई में बिकता है; मात्रा उसी इकाई में बताइए।",
    "kn-IN": "ಈ ವಸ್ತು ಬೇರೆ ಘಟಕದಲ್ಲಿ ಮಾರಾಟವಾಗುತ್ತದೆ; ಅದೇ ಘಟಕದಲ್ಲಿ ಪ್ರಮಾಣ ಹೇಳಿ.",
    "en-IN": "This item is sold in another unit; please give the quantity in that unit.",
  },
  UNKNOWN_UNIT: {
    "hi-IN": "यह इकाई मुझे समझ नहीं आई; किलो, लीटर, पीस जैसी इकाई बताइए।",
    "kn-IN": "ಈ ಘಟಕ ಅರ್ಥವಾಗಲಿಲ್ಲ; ಕಿಲೋ, ಲೀಟರ್, ಪೀಸ್ ಹೀಗೆ ಹೇಳಿ.",
    "en-IN": "I did not understand that unit; say one such as kilo, litre or piece.",
  },
  GST_RATE_INVALID: {
    "hi-IN": "यह जीएसटी की कोई दर नहीं है; दरें शून्य, पाँच, अठारह, अट्ठाईस या चालीस प्रतिशत जैसी होती हैं।",
    "kn-IN": "ಇದು ಜಿಎಸ್‌ಟಿ ದರ ಅಲ್ಲ; ದರಗಳು ಸೊನ್ನೆ, ಐದು, ಹದಿನೆಂಟು, ಇಪ್ಪತ್ತೆಂಟು ಅಥವಾ ನಲವತ್ತು ಶೇಕಡಾ ಹೀಗಿರುತ್ತವೆ.",
    "en-IN": "That is not a GST rate; rates are like zero, five, eighteen, twenty-eight or forty percent.",
  },
  HSN_INVALID: {
    "hi-IN": "एचएसएन कोड में चार, छह या आठ अंक होते हैं; फिर से बताइए।",
    "kn-IN": "ಎಚ್‌ಎಸ್‌ಎನ್ ಕೋಡ್‌ನಲ್ಲಿ ನಾಲ್ಕು, ಆರು ಅಥವಾ ಎಂಟು ಅಂಕಿಗಳಿರುತ್ತವೆ; ಮತ್ತೆ ಹೇಳಿ.",
    "en-IN": "An HSN code has four, six or eight digits; please say it again.",
  },
  GSTIN_INVALID: {
    "hi-IN": "यह जीएसटी नंबर सही नहीं लगता; फिर से बताइए।",
    "kn-IN": "ಈ ಜಿಎಸ್‌ಟಿ ಸಂಖ್ಯೆ ಸರಿಯಿಲ್ಲ ಅನ್ನಿಸುತ್ತದೆ; ಮತ್ತೆ ಹೇಳಿ.",
    "en-IN": "That GST number does not look right; please say it again.",
  },
  PHONE_INVALID: {
    "hi-IN": "फ़ोन नंबर दस अंकों का मोबाइल नंबर होना चाहिए।",
    "kn-IN": "ಫೋನ್ ಸಂಖ್ಯೆ ಹತ್ತು ಅಂಕಿಯ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ಆಗಿರಬೇಕು.",
    "en-IN": "The phone number should be a ten-digit mobile number.",
  },
  AMBIGUOUS_CUSTOMER: {
    "hi-IN": "इस नाम के एक से ज़्यादा ग्राहक हैं; पूरा नाम बताइए।",
    "kn-IN": "ಈ ಹೆಸರಿನ ಒಬ್ಬರಿಗಿಂತ ಹೆಚ್ಚು ಗ್ರಾಹಕರಿದ್ದಾರೆ; ಪೂರ್ಣ ಹೆಸರು ಹೇಳಿ.",
    "en-IN": "More than one customer has that name; please say the full name.",
  },
  AMBIGUOUS_ITEM: {
    "hi-IN": "इस नाम के एक से ज़्यादा सामान हैं; पूरा नाम बताइए।",
    "kn-IN": "ಈ ಹೆಸರಿನ ಒಂದಕ್ಕಿಂತ ಹೆಚ್ಚು ವಸ್ತುಗಳಿವೆ; ಪೂರ್ಣ ಹೆಸರು ಹೇಳಿ.",
    "en-IN": "More than one item has that name; please say the full name.",
  },
  COMPOSITION_INTERSTATE: {
    "hi-IN": "कंपोज़िशन वाली दुकान दूसरे राज्य के ग्राहक को बिल नहीं दे सकती।",
    "kn-IN": "ಕಾಂಪೊಸಿಷನ್ ಅಂಗಡಿ ಬೇರೆ ರಾಜ್ಯದ ಗ್ರಾಹಕರಿಗೆ ಬಿಲ್ ಕೊಡಲು ಆಗುವುದಿಲ್ಲ.",
    "en-IN": "A composition shop cannot bill a customer in another state.",
  },
  PURCHASE_APPROVAL_PENDING: {
    "hi-IN": "एक खरीद का सौदा आपकी हाँ या ना का इंतज़ार कर रहा है; पहले उसका जवाब दीजिए।",
    "kn-IN": "ಒಂದು ಖರೀದಿ ವ್ಯವಹಾರ ನಿಮ್ಮ ಉತ್ತರಕ್ಕಾಗಿ ಕಾಯುತ್ತಿದೆ; ಮೊದಲು ಅದಕ್ಕೆ ಉತ್ತರಿಸಿ.",
    "en-IN": "A purchase deal is waiting for your yes or no; please answer it first.",
  },
  INVOICE_STALE: {
    "hi-IN": "बिल बनने के बाद दुकान की सेटिंग या सामान का टैक्स बदल गया है; बिल फिर से बनवाइए।",
    "kn-IN": "ಬಿಲ್ ಮಾಡಿದ ನಂತರ ಅಂಗಡಿ ಸೆಟ್ಟಿಂಗ್ ಅಥವಾ ವಸ್ತುವಿನ ತೆರಿಗೆ ಬದಲಾಗಿದೆ; ಬಿಲ್ ಮತ್ತೆ ಮಾಡಿಸಿ.",
    "en-IN": "The shop settings or an item's tax changed after this bill was drafted; please draft it again.",
  },
  APPROVAL_STALE: {
    "hi-IN": "पढ़कर सुनाने के बाद बिल बदल गया है; मैं फिर से पढ़कर सुनाऊँगी।",
    "kn-IN": "ಓದಿ ಹೇಳಿದ ನಂತರ ಬಿಲ್ ಬದಲಾಗಿದೆ; ಮತ್ತೆ ಓದಿ ಹೇಳುತ್ತೇನೆ.",
    "en-IN": "The bill changed after I read it out; I will read it out again.",
  },
  NOT_AFFIRMATIVE: {
    "hi-IN": "मुझे साफ़ हाँ सुनाई नहीं दी; बिल बनाऊँ, हाँ या ना?",
    "kn-IN": "ಸ್ಪಷ್ಟವಾಗಿ ಹೌದು ಕೇಳಿಸಲಿಲ್ಲ; ಬಿಲ್ ಮಾಡಲೇ, ಹೌದು ಅಥವಾ ಇಲ್ಲ?",
    "en-IN": "I did not hear a clear yes; shall I make the bill, yes or no?",
  },
  TYPED_ANSWER: {
    "hi-IN": "लिखी हुई हाँ से बिल नहीं बनता; हाँ बोलिए या स्क्रीन पर सही का बटन दबाइए।",
    "kn-IN": "ಬರೆದ ಹೌದು ಸಾಕಾಗುವುದಿಲ್ಲ; ಹೌದು ಎಂದು ಹೇಳಿ ಅಥವಾ ಪರದೆಯ ಮೇಲಿನ ಸರಿ ಬಟನ್ ಒತ್ತಿ.",
    "en-IN": "A typed yes does not make a bill; say yes aloud or press the tick on the screen.",
  },
  READBACK_SUPERSEDED: {
    "hi-IN": "बीच में कुछ और पढ़ा गया था; बिल फिर से पढ़कर सुनाऊँ?",
    "kn-IN": "ನಡುವೆ ಬೇರೆ ಏನೋ ಓದಲಾಯಿತು; ಬಿಲ್ ಮತ್ತೆ ಓದಿ ಹೇಳಲೇ?",
    "en-IN": "Something else was read out in between; shall I read the bill out again?",
  },
  INVOICE_ALREADY_ISSUED: {
    "hi-IN": "यह बिल पहले ही बन चुका है।",
    "kn-IN": "ಈ ಬಿಲ್ ಈಗಾಗಲೇ ಆಗಿದೆ.",
    "en-IN": "This bill has already been made.",
  },
  INVOICE_NOT_ISSUED: {
    "hi-IN": "यह बिल आपकी हाँ के बिना नहीं बना है।",
    "kn-IN": "ನಿಮ್ಮ ಹೌದು ಇಲ್ಲದೆ ಈ ಬಿಲ್ ಆಗಿಲ್ಲ.",
    "en-IN": "This bill has not been made with your yes.",
  },
};
// Codes that mean "not heard / not answered yet" from the shared consent check.
for (const code of ["NO_ANSWER_YET", "ANSWER_DURING_READBACK", "NOT_NEGATIVE"]) SAY[code] = SAY.NOT_AFFIRMATIVE;
for (const code of ["READBACK_NOT_SPOKEN", "READBACK_NOT_HEARD", "EVIDENCE_UNORDERED", "EVIDENCE_REQUIRED"]) {
  SAY[code] = {
    "hi-IN": "मैं आपकी आवाज़ में जवाब नहीं पढ़ पाई; स्क्रीन पर बिल के सही वाले बटन से पक्का कीजिए।",
    "kn-IN": "ನಿಮ್ಮ ಧ್ವನಿಯ ಉತ್ತರ ಓದಲು ಆಗಲಿಲ್ಲ; ಪರದೆಯ ಮೇಲೆ ಬಿಲ್‌ನ ಸರಿ ಬಟನ್ ಒತ್ತಿ ಖಚಿತಪಡಿಸಿ.",
    "en-IN": "I could not read your spoken answer; please confirm the bill with the tick on the screen.",
  };
}

const STATUS = { NOT_FOUND: 404, INVOICE_NOT_FOUND: 404, CUSTOMER_NOT_FOUND: 404, APPROVAL_NOT_FOUND: 404, ITEM_NOT_FOUND: 404 };

/** A Sell / GST / stock refusal as a ToolError with a spoken line; anything else as toToolError does. */
function sellToolError(err, language) {
  if (err instanceof ToolError) return err;
  const lines = SAY[err?.code];
  const status = err?.status ?? STATUS[err?.code] ?? (["GstError", "SellError", "StockError"].includes(err?.name) ? 400 : 409);
  if (lines) return new ToolError(err.code, lines[langKey(language)], { status, message: err.message, cause: err, details: err.details });
  if (["SellError", "GstError", "StockError"].includes(err?.name)) {
    return new ToolError(err.code, sayFor(status === 404 ? "not_found" : "invalid", language), { status, message: err.message, cause: err, details: err.details });
  }
  return toToolError(err, language);
}

const phrase = (key, language, vars = {}) => PHRASES[key][langKey(language)](vars);
const money = (paise) => gst.rupeesText(paise);

/* ------------------------------------------------------- owner's words --- */

/** The owner's latest turns: the call's ASR turns, else the owner_words the model copied; null when neither. */
async function ownerTurns(ctx, args, n) {
  if (ctx.agentId) {
    try {
      return evidence.ownerTurns(await require("../agora/agent").history(ctx.agentId, { timeoutMs: TOOL_HISTORY_TIMEOUT_MS }), n);
    } catch {
      // the call history is unavailable: fall back to the model's copy below
    }
  }
  return typeof args.owner_words === "string" && args.owner_words.trim() ? [args.owner_words] : null;
}

const SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Devanagari}/u, /\p{Script=Kannada}/u];
const foldWords = (text) => customers.fold(gst.asciiDigits(text)).split(" ").filter(Boolean);

/** A name is heard when one of its words (of 2+ letters, in a script the turns use) is in them. */
function nameHeard(turns, name) {
  const heard = foldWords(turns.join(" "));
  const words = foldWords(name).filter((w) => w.length >= 2 && !/^\d+$/.test(w));
  const comparable = words.filter((w) => SCRIPTS.some((s) => s.test(w) && heard.some((h) => s.test(h))));
  if (!comparable.length) return true; // another script: nothing can be compared, nothing is refused
  return comparable.some((w) => heard.includes(w));
}

/** Digits of a code (HSN, phone) are in the turns, spaced or not, in any digit script. */
const digitsHeard = (turns, digits) => gst.asciiDigits(turns.join(" ")).replace(/[^0-9]/g, "").includes(String(digits));

/** A number (quantity, price, rate) is in one of the turns, as digits or number words. */
const numberHeard = (turns, n) => turns.some((t) => evidence.numberHeard(t, n));

function refuseUnheard(missing, language, extra = {}) {
  const what = missing.map((m) => WHAT[m][langKey(language)]).join(", ");
  return { saved: false, missing, ...extra, say: phrase("not_heard", language, { what }) };
}

/* ------------------------------------------------------------- helpers --- */

/** The item the owner named, or a refusal the agent can speak. */
function itemNamed(businessId, name) {
  const item = items().findByName(businessId, name);
  if (!item) throw new SellError("ITEM_UNKNOWN", `No item named "${name}".`, { status: 409, details: { item: name } });
  return item;
}

/** The invoice a tool acts on: the one named, else this call's latest open one, else the business's only open one. */
function currentInvoice(ctx, invoiceId, language) {
  if (invoiceId) {
    const invoice = invoices.get(ctx.businessId, invoiceId);
    if (!invoice) throw new ToolError("INVOICE_NOT_FOUND", sayFor("not_found", language), { status: 404 });
    return invoice;
  }
  const open = [...invoices.list(ctx.businessId, { status: "pending" }), ...invoices.list(ctx.businessId, { status: "draft" })];
  const thisCall = ctx.sessionId ? open.filter((i) => i.sessionId === ctx.sessionId) : [];
  const pool = thisCall.length ? thisCall : open;
  if (!pool.length) throw new ToolError("NO_INVOICE", phrase("no_invoice", language), { status: 409 });
  if (pool.length > 1 && !thisCall.length) {
    const names = pool.map((i) => customers.get(ctx.businessId, i.customerId)?.name).filter(Boolean);
    throw new ToolError("AMBIGUOUS", sayFor("invalid", language), { status: 409, message: `Several bills are open: ${names.join(", ")}.`, details: { choices: pool.map((i) => i.id) } });
  }
  return pool.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
}

/** The latest drafted (not yet put to the owner) bill of this call, or the named one; null when none. */
function draftOfThisCall(ctx, invoiceId) {
  const drafts = invoices.list(ctx.businessId, { status: "draft" }).filter((i) => (invoiceId ? i.id === invoiceId : ctx.sessionId && i.sessionId === ctx.sessionId));
  return drafts.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) ?? null;
}

/** A sale and a purchase are never the same turn: how far back a purchase need counts as part of this sale's turn. */
const SALE_TURN_MS = 6000;

/**
 * Purchase needs the model saved in the same turn as this sale (E2E full run: "190 किलो" sold to a
 * customer also became a 190 kg purchase need and a "delivery city?" question). Dismissed: a draft
 * need of this call, saved within SALE_TURN_MS, for one of the bill's items, with no work on it.
 */
function dismissSaleTwins(ctx, lineItems, now = Date.now()) {
  if (!ctx.sessionId) return [];
  const dismissed = [];
  for (const need of repo.listRequirements(ctx.businessId)) {
    if (need.session_id !== ctx.sessionId || need.status !== "draft" || now - Date.parse(need.created_at) > SALE_TURN_MS) continue;
    if (!lineItems.some((item) => item.id === items().findByName(ctx.businessId, need.item)?.id)) continue;
    try {
      const gone = repo.dismissRequirement(ctx.businessId, need.id);
      events.emit(ctx.businessId, "requirement.saved", gone, { sessionId: ctx.sessionId, actor: "system" });
      dismissed.push(gone);
    } catch {
      // work already started on it: leave it, the owner can dismiss it on the screen
    }
  }
  return dismissed;
}

/* --------------------------------------------------------------- tools --- */

/** Gate refusals after which a later clear yes gets the bill read out again (confirm_invoice). */
const REREAD_ON = new Set(["NOT_AFFIRMATIVE", "READBACK_SUPERSEDED", "ANSWER_DURING_READBACK"]);

function sellTools({ ownerObj, idArg, withHistory }) {
  const run = (handler) => async (ctx, args, language) => {
    try {
      return await handler(ctx, args, language);
    } catch (err) {
      throw sellToolError(err, language);
    }
  };
  const OWNER_WORDS = { type: "string", maxLength: 500, description: "The owner's last sentence(s), word for word as you heard them, in the owner's script. Always pass it." };

  /** request_invoice_approval: the server reads the bill out in a call (once, unless repeat) and asks. */
  async function askInvoice(ctx, args, language) {
    const target = currentInvoice(ctx, args.invoiceId, language);
    const { approval, invoice } = gate.requestInvoiceApproval(ctx.businessId, target.id, { sessionId: ctx.sessionId ?? null });
    const readback = gate.buildReadback(ctx.businessId, invoice, langKey(language));
    const result = { approvalId: approval.id, invoiceId: invoice.id, status: approval.status, totalPaise: approval.total_paise };
    if (!ctx.agentId) return { ...result, readback, say: readback };
    const readBefore = gate.readbacksOf(ctx.businessId, approval.id, ctx.agentId).length > 0;
    if (readBefore && !args.repeat) {
      return { ...result, readbackSpoken: true, next: "confirm_invoice", hint: "This bill was already read out. When the owner answers, call confirm_invoice (approve on a clear yes, reject on a no).", say: phrase("invoice_question", language) };
    }
    require("../agora/narrator").holdForApproval(ctx.businessId, `invoice:${approval.id}`);
    try {
      await require("../agora/agent").speak(ctx.agentId, readback, { priority: "APPEND", interruptable: false });
    } catch (err) {
      throw new ToolError("READBACK_NOT_SPOKEN", sayFor("speak_failed", language), { status: 502, message: `The read-back could not be spoken: ${err.message}` });
    }
    gate.recordInvoiceReadbackSpoken(ctx.businessId, approval.id, { agentId: ctx.agentId, text: readback, sessionId: ctx.sessionId ?? null });
    // The read-back ends with its own question: the model says nothing on top of it.
    return outcome.waitForOwner({ ...result, readbackSpoken: true }, "confirm_invoice");
  }

  return [
    {
      name: "add_customer",
      scopes: OWNER,
      description:
        "Saves a customer (someone the shop sells to): when the owner asks to add a customer, call it at once with the name as the owner said it. Phone, GSTIN, state and address are optional: pass them only when the owner said them, and never ask for them before saving. Saying an existing name updates that customer.",
      inputSchema: ownerObj({
        owner_words: OWNER_WORDS,
        name: { type: "string", maxLength: 120 },
        phone: { type: "string", maxLength: 20, description: "10-digit mobile number as said" },
        gstin: { type: "string", maxLength: 20 },
        state: { type: "string", maxLength: 60 },
        address: { type: "string", maxLength: 300 },
      }, ["name"]),
      handler: run(async (ctx, args, language) => {
        const turns = await ownerTurns(ctx, args, INVOICE_TURNS);
        if (turns) {
          const missing = [];
          if (!nameHeard(turns, args.name)) missing.push("customer");
          if (args.phone && !digitsHeard(turns, customers.cleanPhone(args.phone))) missing.push("phone");
          if (missing.length) return refuseUnheard(missing, language);
        }
        const { customer, created } = customers.save(ctx.businessId, args, { sessionId: ctx.sessionId ?? null, actor: "agent" });
        return { saved: true, customerId: customer.id, customer, created, say: phrase("customer_saved", language, { name: customer.name, created }) };
      }),
    },
    {
      name: "set_item",
      scopes: OWNER,
      description:
        "Saves something the shop sells: name, unit and selling price as the owner said them. HSN code and GST rate are never guessed: pass them only when the owner said both; then the server reads them back in the call and you just ask `say`. When the owner answers that read-back, call set_item again with only confirm (true on a clear yes; on a no, do nothing). Never fill an HSN or GST rate yourself.",
      inputSchema: ownerObj({
        owner_words: OWNER_WORDS,
        item: { type: "string", maxLength: 80, description: "The item as the owner named it, in the owner's script." },
        unit: { type: "string", maxLength: 40 },
        sale_price: { type: "number", minimum: 0, description: "Selling price per unit in rupees, as said." },
        hsn: { type: "string", maxLength: 20, description: "Only as the owner said it." },
        gst_rate: { type: "number", minimum: 0, maximum: 40, description: "Percent, only as the owner said it." },
        confirm: { type: "boolean", description: "Only after the owner answered the server's HSN/GST read-back with a clear yes." },
      }),
      handler: run(async (ctx, args, language) => {
        if (args.confirm) {
          if (!ctx.agentId) throw new ToolError("NO_VOICE_EVIDENCE", phrase("item_tax_in_call", language), { status: 409 });
          let done;
          try {
            done = await withHistory(ctx, (history) => itemTax.confirm(ctx.businessId, { agentId: ctx.agentId, history, sessionId: ctx.sessionId ?? null }));
          } catch (err) {
            if (["NOT_AFFIRMATIVE", "NO_ANSWER_YET", "TYPED_ANSWER", "READBACK_SUPERSEDED", "ANSWER_DURING_READBACK"].includes(err?.code)) {
              throw new ToolError(err.code, phrase("item_tax_unclear", language), { status: 409, message: err.message, cause: err });
            }
            throw err;
          }
          const { item } = done;
          return { saved: true, itemId: item.id, item, say: phrase("item_tax_saved", language, { item: item.name, hsn: itemTax.hsnSpoken(item.hsn), rate: item.gst_rate }) };
        }
        if (!args.item) throw new ToolError("INVALID", sayFor("invalid", language), { status: 400, message: "item is required." });
        const turns = await ownerTurns(ctx, args, INVOICE_TURNS);
        const taxGiven = args.hsn != null || args.gst_rate != null;
        if (taxGiven && (args.hsn == null || args.gst_rate == null)) throw new ToolError("TAX_INCOMPLETE", phrase("item_tax_both", language), { status: 400 });
        if (turns) {
          const missing = [];
          if (!evidence.itemHeard(turns, args.item)) missing.push("item");
          if (args.sale_price != null && !numberHeard(turns, args.sale_price)) missing.push("rate");
          if (taxGiven) {
            // The rate must be in the same turn as the HSN digits: a "5" from "5 kg sugar" earlier is not a GST rate.
            const hsnTurn = turns.findLast((turn) => digitsHeard([turn], gst.parseHsn(args.hsn)));
            if (!hsnTurn) missing.push("hsn");
            if (!hsnTurn || !numberHeard([hsnTurn], args.gst_rate)) missing.push("gst_rate");
          }
          if (missing.length) return refuseUnheard(missing, language);
        }
        if (!taxGiven) {
          const item = items().upsert(ctx.businessId, { name: args.item, unit: args.unit ?? undefined, sale_price: args.sale_price ?? undefined }, { sessionId: ctx.sessionId ?? null, actor: "agent" });
          return {
            saved: true,
            itemId: item.id,
            item,
            say: phrase("item_saved", language, { item: item.name_native && language !== "en-IN" ? item.name_native : item.name, price: item.sale_price != null ? String(item.sale_price) : null, unit: unitWord(item.unit, language, false, { short: true }) }),
          };
        }
        // HSN + GST: the server reads them back; only the owner's spoken yes saves them.
        if (!ctx.agentId) throw new ToolError("NO_VOICE_EVIDENCE", phrase("item_tax_in_call", language), { status: 409 });
        const { hsn, gstRate, unit } = itemTax.validate({ hsn: args.hsn, gst_rate: args.gst_rate, unit: args.unit });
        const existing = items().findByName(ctx.businessId, args.item);
        const itemUnit = unit ?? existing?.unit ?? null;
        if (!existing && !itemUnit) throw new SellError("UNKNOWN_UNIT", "unit is required for a new item.");
        const name = existing?.name ?? args.item;
        const text = itemTax.readback(
          { item: name, hsn, gstRate, salePrice: args.sale_price ?? null, unitWord: itemUnit ? unitWord(itemUnit, language, false, { short: true }) : "" },
          langKey(language),
        );
        require("../agora/narrator").holdForApproval(ctx.businessId, null);
        try {
          await require("../agora/agent").speak(ctx.agentId, text, { priority: "APPEND", interruptable: false });
        } catch (err) {
          throw new ToolError("READBACK_NOT_SPOKEN", sayFor("speak_failed", language), { status: 502, message: `The read-back could not be spoken: ${err.message}` });
        }
        itemTax.recordSpoken(ctx.businessId, { itemName: name, unit: itemUnit, salePrice: args.sale_price ?? null, hsn, gstRate, agentId: ctx.agentId, text, sessionId: ctx.sessionId ?? null });
        // The read-back ends with its own question: the model says nothing on top of it.
        return outcome.waitForOwner({ saved: false, readbackSpoken: true }, "set_item with confirm true on a clear yes");
      }),
    },
    {
      name: "draft_invoice",
      scopes: OWNER,
      description:
        "Drafts a bill (sale) from the owner's words: the customer and each line (item, quantity, unit, price per unit if said). Tax is computed by the server. A new customer name is added. Items must already be saved (set_item); an item without a price said uses its saved selling price. Calling it again in the same call for the same customer replaces the draft. Then call request_invoice_approval.",
      inputSchema: ownerObj({
        owner_words: OWNER_WORDS,
        customer: { type: "string", maxLength: 120, description: "Customer name as the owner said it." },
        lines: {
          type: "array",
          maxItems: invoices.MAX_LINES,
          description: "Each line: {item, quantity, unit?, rate?}; rate is rupees per unit, only when the owner said it.",
          items: {
            type: "object",
            properties: { item: { type: "string" }, quantity: { type: "number" }, unit: { type: "string" }, rate: { type: "number" } },
            required: ["item", "quantity"],
          },
        },
      }, ["customer", "lines"]),
      handler: run(async (ctx, args, language) => {
        const lines = Array.isArray(args.lines) ? args.lines : [];
        const shapeOk = lines.length > 0 && lines.length <= invoices.MAX_LINES && lines.every((l) =>
          l && typeof l.item === "string" && l.item.trim() && typeof l.quantity === "number" && l.quantity > 0 &&
          (l.unit == null || typeof l.unit === "string") && (l.rate == null || (typeof l.rate === "number" && l.rate >= 0)));
        if (!shapeOk) throw new ToolError("INVALID_ARGUMENTS", sayFor("invalid", language), { status: 400, message: "lines are [{item, quantity > 0, unit?, rate?}]." });
        const turns = await ownerTurns(ctx, args, INVOICE_TURNS);
        if (!turns) throw new ToolError("NO_OWNER_WORDS", sayFor("invalid", language), { status: 400, message: "owner_words is required off a call." });
        const missing = new Set();
        if (!nameHeard(turns, args.customer)) missing.add("customer");
        for (const l of lines) {
          if (!evidence.itemHeard(turns, l.item)) missing.add("item");
          if (!numberHeard(turns, l.quantity)) missing.add("quantity");
          if (l.rate != null && !numberHeard(turns, l.rate)) missing.add("rate");
        }
        if (missing.size) return refuseUnheard([...missing], language, { invoiceId: null });

        let customer = customers.findByName(ctx.businessId, args.customer);
        if (!customer) customer = customers.save(ctx.businessId, { name: args.customer }, { sessionId: ctx.sessionId ?? null, actor: "agent" }).customer;
        const drafted = lines.map((l) => {
          if (l.unit != null && !canonicalUnit(l.unit)) throw new SellError("UNKNOWN_UNIT", `Unknown unit "${l.unit}".`);
          return { itemId: itemNamed(ctx.businessId, l.item).id, quantity: l.quantity, unit: l.unit ?? null, rate: l.rate ?? null };
        });
        const replace = ctx.sessionId
          ? invoices.list(ctx.businessId, { status: "draft", customer_id: customer.id }).filter((i) => i.sessionId === ctx.sessionId).at(-1)
          : null;
        const invoice = invoices.draft(ctx.businessId, { customerId: customer.id, lines: drafted, invoiceId: replace?.id ?? null }, { sessionId: ctx.sessionId ?? null, actor: "agent" });
        const dismissed = dismissSaleTwins(ctx, drafted.map((l) => ({ id: l.itemId })));
        return {
          saved: true,
          ...(dismissed.length ? { purchaseNeedsDismissed: dismissed.map((r) => r.id) } : {}),
          invoiceId: invoice.id,
          invoice: invoices.summary(invoice, customer),
          next: "request_invoice_approval",
          say: phrase("invoice_drafted", language, { customer: customer.name, total: money(invoice.totals.totalPaise) }),
        };
      }),
    },
    {
      name: "request_invoice_approval",
      scopes: OWNER,
      description:
        "Puts the drafted bill to the owner. In a call the server reads the whole bill out itself (items, tax, total); you then say only `say` and wait. The owner's yes or no is answered with confirm_invoice, never with this tool again. repeat: true only when the owner asks to hear the bill again.",
      inputSchema: ownerObj({
        invoiceId: idArg("invoice", "the bill drafted in this call"),
        repeat: { type: "boolean", description: "Only when the owner asks to hear the bill again." },
      }),
      handler: run((ctx, args, language) => askInvoice(ctx, args, language)),
    },
    {
      name: "confirm_invoice",
      scopes: OWNER,
      description:
        "Records the owner's spoken yes or no to the bill request_invoice_approval read out: call it as soon as the owner answers (decision approve on a clear yes, reject on a no). The server reads the owner's own words from the call; a typed message never counts. On approve the bill is issued: number, PDF, pay link and WhatsApp share.",
      inputSchema: ownerObj({ invoiceId: idArg("invoice", "the bill waiting for the owner"), decision: { type: "string", enum: ["approve", "reject"] } }, ["decision"]),
      handler: run(async (ctx, args, language) => {
        const pending = gate.listApprovals(ctx.businessId, { status: "pending", ...(args.invoiceId ? { invoice_id: args.invoiceId } : {}) });
        if (!pending.length) {
          // A yes to "shall I read it out?" after draft_invoice (E2E full run, bug 5b): a drafted bill of
          // this call is read out now. Reading out decides nothing; only a yes to that read-back issues it.
          const draft = ctx.agentId && args.decision === "approve" ? draftOfThisCall(ctx, args.invoiceId) : null;
          if (!draft) throw new ToolError("NO_PENDING_INVOICE", phrase("no_invoice", language), { status: 409 });
          const asked = await askInvoice(ctx, { invoiceId: draft.id }, language);
          return { ...asked, status: "asked", hint: `The bill was not read out before, so the server has read it out now. ${asked.hint ?? ""}`.trim() };
        }
        if (!ctx.agentId) throw new ToolError("NO_VOICE_EVIDENCE", SAY.EVIDENCE_REQUIRED[langKey(language)], { status: 409 });
        const approval = pending.at(-1);
        let laterYes = false;
        let invoice;
        try {
          ({ invoice } = await withHistory(ctx, (history) => {
            try {
              return gate.confirmInvoice(ctx.businessId, approval.id, { decision: args.decision, via: "voice", agentId: ctx.agentId, history, sessionId: ctx.sessionId ?? null });
            } catch (err) {
              // Security review r2 #3: only the owner's first spoken turn after the read-back answers it.
              // A clear yes that came later is not consent to this bill: the server reads it out again.
              laterYes = args.decision === "approve" && REREAD_ON.has(err?.code) && gate.classifyReply(require("../approvals").lastOwnerWords(history)) === "affirmative";
              throw err;
            }
          }));
        } catch (err) {
          if (!laterYes) throw err;
          const asked = await askInvoice(ctx, { invoiceId: approval.invoice_id, repeat: true }, language);
          return { ...asked, status: "asked", readAgain: true, refused: err.code };
        }
        if (invoice.status !== "issued") return outcome.settle(ctx, phrase("invoice_rejected", language), language, { invoiceId: invoice.id, status: invoice.status });
        const { invoice: done, problems } = await gate.finishIssue(ctx.businessId, invoice.id, { sessionId: ctx.sessionId ?? null });
        const failed = problems.map((p) => WHAT[p.step][langKey(language)]);
        const vars = { number: done.number, total: money(done.totals.totalPaise), pay: Boolean(done.payUrl) };
        const said = failed.length ? phrase("invoice_issued_partly", language, { number: done.number, what: failed.join(", ") }) : phrase("invoice_issued", language, vars);
        return outcome.settle(ctx, said, language, {
          invoiceId: done.id,
          number: done.number,
          status: done.status,
          totals: done.totals,
          pdfUrl: done.pdfUrl,
          payUrl: done.payUrl,
          shareUrl: done.shareUrl,
          testMode: true,
          problems,
        });
      }),
    },
  ];
}

module.exports = sellTools;
module.exports.sellToolError = sellToolError;
module.exports.PHRASES = PHRASES;
module.exports.SAY = SAY;
module.exports.WHAT = WHAT;
module.exports.nameHeard = nameHeard;
