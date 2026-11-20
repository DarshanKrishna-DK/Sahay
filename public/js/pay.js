// Sahay pay page (served at /pay/<token> by src/routes/api.js and src/routes/sell.js). Classic
// script, no inline code, so the page runs under its own strict Content-Security-Policy
// (server.js PAY_CSP). The token is read from the URL; the page holds no data until
// GET /api/pay/<token> answers.
// Two kinds of payment use it:
// - a purchase order (Sahay's owner pays a vendor): purchase-order wording, in English, and the
//   "simulated vendor" label when the vendor is simulated; back to the Buy screen;
// - an invoice (kind "invoice": a customer pays the shop's bill): the shop is the merchant and the
//   customer the buyer, in the shop's language. The visitor is the shop's customer, who has no
//   Sahay app, so there is no way "back to Sahay"; a verified payment ends on "Paid. Thank you."
//   with the shop, the bill number and the amount. The bill's PDF is owner-only
//   (/api/invoices/:id/pdf needs the shop's session), so this page offers no download.
// Razorpay Standard Checkout: options key, amount, currency, name, description, order_id and a
// success handler that receives razorpay_payment_id / razorpay_order_id / razorpay_signature,
// which the server verifies before it marks the order or bill paid.
//
// Every state is a value of data-state on #pay-root (styled in public/css/pay.css):
//   loading, ready, opening, verifying, paid (order verified or already paid), thanks (bill paid),
//   partial (bill part paid), closed, failed, expired, invalid, limit, error (could not load: Try again).
(function () {
  "use strict";
  var token = location.pathname.split("/").pop();
  var api = "/api/pay/" + encodeURIComponent(token);
  // Bill links are "inv_" + 22 characters (src/sell/checkout.js); everything else is an order link.
  var billToken = /^inv_/.test(token || "");
  var root = document.getElementById("pay-root");
  var payBtn = document.getElementById("pay");
  var retryBtn = document.getElementById("retry");
  var statusEl = document.getElementById("status");
  var order = null;
  var copy = null;

  var PURCHASE = {
    lang: "en",
    title: "Payment for a purchase order",
    ref: function (n) { return "Purchase order " + n; },
    vendor: "Supplier", item: "Item", buyer: "Buyer", amount: "Amount to pay",
    sim: "Simulated vendor: not a real supplier",
    brand: function () { return "Sahay, an automated procurement assistant"; },
    banner: "Razorpay TEST MODE: no real money moves.",
    pay: "Pay with Razorpay",
    back: "Back to Sahay", backHref: "/app#/buy",
    fine: "This page opens Razorpay Checkout in test mode for the order above. Sahay marks the order paid only after the server has verified Razorpay's payment signature. Use only Razorpay test card or UPI details.",
    loading: "Loading the order.",
    retry: "Try again",
    loadFailed: "The order could not be loaded.",
    unusable: "This payment link cannot be used.",
    expiredTitle: "This payment link has expired",
    expiredText: "Ask Sahay for a new payment link for this order.",
    invalidTitle: "This payment link is not valid",
    invalidText: "Use the Pay button on the order in Sahay to open the right link.",
    limitTitle: "Too many tries",
    limitText: "Wait a few minutes, then open the link again.",
    errorTitle: "The order could not be loaded",
    errorText: "Check the internet connection and try again.",
    isPaid: "This order is paid (Razorpay test mode).",
    verifying: "Verifying the payment with the server.",
    verifyFailed: "The payment could not be verified.",
    verified: function (n) { return "Paid and verified (Razorpay test mode). Order " + n + " is marked paid."; },
    recorded: function (n, s) { return "The payment was recorded, but order " + n + " is " + s + "."; },
    noCheckout: "Razorpay Checkout did not load. Check the connection and reload the page.",
    opening: "Opening Razorpay Checkout (test mode).",
    closed: "Checkout closed. Nothing was paid.",
    failed: function (why) { return "Payment failed: " + (why || "Razorpay did not say why") + "."; },
  };


  // The owner's purchase-order page in Hindi and Kannada (English stays the default; brief v4 item 3).
  var PURCHASE_HI = {
    lang: "hi",
    title: "खरीद ऑर्डर का भुगतान",
    ref: function (n) { return "खरीद ऑर्डर " + n; },
    vendor: "विक्रेता", item: "सामान", buyer: "खरीदार", amount: "चुकाने की रकम",
    sim: "सिम्युलेटेड विक्रेता (simulated vendor): असली सप्लायर नहीं",
    brand: function () { return "सहाय, खरीदारी का स्वचालित सहायक"; },
    banner: "Razorpay टेस्ट मोड: असली पैसा नहीं कटता।",
    pay: "Razorpay से भुगतान करें",
    back: "सहाय पर वापस", backHref: "/app#/buy",
    fine: "यह पन्ना ऊपर वाले ऑर्डर के लिए Razorpay चेकआउट टेस्ट मोड में खोलता है। सर्वर के Razorpay का हस्ताक्षर जाँचने के बाद ही ऑर्डर चुका हुआ माना जाता है। सिर्फ़ Razorpay के टेस्ट कार्ड या यूपीआई की जानकारी डालिए।",
    loading: "ऑर्डर खुल रहा है।",
    retry: "फिर कोशिश करें",
    loadFailed: "ऑर्डर नहीं खुल पाया।",
    unusable: "यह भुगतान लिंक काम नहीं करता।",
    expiredTitle: "इस भुगतान लिंक का समय निकल गया",
    expiredText: "इस ऑर्डर के लिए सहाय से नया भुगतान लिंक माँगिए।",
    invalidTitle: "यह भुगतान लिंक सही नहीं है",
    invalidText: "सहाय में ऑर्डर पर भुगतान बटन से सही लिंक खोलिए।",
    limitTitle: "बहुत बार कोशिश हुई",
    limitText: "कुछ मिनट रुककर लिंक फिर से खोलिए।",
    errorTitle: "ऑर्डर नहीं खुल पाया",
    errorText: "इंटरनेट देखकर फिर कोशिश कीजिए।",
    isPaid: "इस ऑर्डर का भुगतान हो चुका है (Razorpay टेस्ट मोड)।",
    verifying: "सर्वर भुगतान जाँच रहा है।",
    verifyFailed: "भुगतान की जाँच नहीं हो पाई।",
    verified: function (n) { return "भुगतान हो गया और जाँच लिया गया (Razorpay टेस्ट मोड)। ऑर्डर " + n + " चुका दिया गया।"; },
    recorded: function (n, st) { return "भुगतान दर्ज हुआ, पर ऑर्डर " + n + " की स्थिति " + st + " है।"; },
    noCheckout: "Razorpay चेकआउट नहीं खुला। इंटरनेट देखकर पन्ना फिर से खोलिए।",
    opening: "Razorpay चेकआउट खुल रहा है (टेस्ट मोड)।",
    closed: "चेकआउट बंद हुआ। कोई पैसा नहीं कटा।",
    failed: function (why) { return "भुगतान नहीं हुआ" + (why ? ": " + why : "") + "।"; },
  };
  var PURCHASE_KN = {
    lang: "kn",
    title: "ಖರೀದಿ ಆರ್ಡರ್ ಪಾವತಿ",
    ref: function (n) { return "ಖರೀದಿ ಆರ್ಡರ್ " + n; },
    vendor: "ಮಾರಾಟಗಾರ", item: "ಸಾಮಾನು", buyer: "ಖರೀದಿದಾರ", amount: "ಪಾವತಿಸಬೇಕಾದ ಮೊತ್ತ",
    sim: "ಸಿಮ್ಯುಲೇಟೆಡ್ ಮಾರಾಟಗಾರ (simulated vendor): ನಿಜವಾದ ಪೂರೈಕೆದಾರರಲ್ಲ",
    brand: function () { return "ಸಹಾಯ್, ಖರೀದಿಯ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ"; },
    banner: "Razorpay ಟೆಸ್ಟ್ ಮೋಡ್: ನಿಜವಾದ ಹಣ ಹೋಗುವುದಿಲ್ಲ.",
    pay: "Razorpay ಮೂಲಕ ಪಾವತಿಸಿ",
    back: "ಸಹಾಯ್‌ಗೆ ಹಿಂದಿರುಗಿ", backHref: "/app#/buy",
    fine: "ಈ ಪುಟ ಮೇಲಿನ ಆರ್ಡರ್‌ಗೆ Razorpay ಚೆಕ್‌ಔಟ್ ಅನ್ನು ಟೆಸ್ಟ್ ಮೋಡ್‌ನಲ್ಲಿ ತೆರೆಯುತ್ತದೆ. ಸರ್ವರ್ Razorpay ಸಹಿಯನ್ನು ಪರಿಶೀಲಿಸಿದ ನಂತರವೇ ಆರ್ಡರ್ ಪಾವತಿಯಾಗಿದೆ ಎಂದು ಗುರುತಿಸಲಾಗುತ್ತದೆ. Razorpay ಟೆಸ್ಟ್ ಕಾರ್ಡ್ ಅಥವಾ ಯುಪಿಐ ವಿವರಗಳನ್ನು ಮಾತ್ರ ಬಳಸಿ.",
    loading: "ಆರ್ಡರ್ ತೆರೆಯುತ್ತಿದೆ.",
    retry: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
    loadFailed: "ಆರ್ಡರ್ ತೆರೆಯಲು ಆಗಲಿಲ್ಲ.",
    unusable: "ಈ ಪಾವತಿ ಲಿಂಕ್ ಬಳಸಲು ಆಗುವುದಿಲ್ಲ.",
    expiredTitle: "ಈ ಪಾವತಿ ಲಿಂಕ್‌ನ ಸಮಯ ಮುಗಿದಿದೆ",
    expiredText: "ಈ ಆರ್ಡರ್‌ಗೆ ಸಹಾಯ್‌ನಿಂದ ಹೊಸ ಪಾವತಿ ಲಿಂಕ್ ಕೇಳಿ.",
    invalidTitle: "ಈ ಪಾವತಿ ಲಿಂಕ್ ಸರಿಯಿಲ್ಲ",
    invalidText: "ಸಹಾಯ್‌ನಲ್ಲಿ ಆರ್ಡರ್‌ನ ಪಾವತಿ ಬಟನ್‌ನಿಂದ ಸರಿಯಾದ ಲಿಂಕ್ ತೆರೆಯಿರಿ.",
    limitTitle: "ತುಂಬಾ ಬಾರಿ ಪ್ರಯತ್ನಿಸಲಾಗಿದೆ",
    limitText: "ಕೆಲವು ನಿಮಿಷ ಕಾದು ಲಿಂಕ್ ಮತ್ತೆ ತೆರೆಯಿರಿ.",
    errorTitle: "ಆರ್ಡರ್ ತೆರೆಯಲು ಆಗಲಿಲ್ಲ",
    errorText: "ಇಂಟರ್ನೆಟ್ ನೋಡಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    isPaid: "ಈ ಆರ್ಡರ್ ಪಾವತಿಯಾಗಿದೆ (Razorpay ಟೆಸ್ಟ್ ಮೋಡ್).",
    verifying: "ಸರ್ವರ್ ಪಾವತಿಯನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದೆ.",
    verifyFailed: "ಪಾವತಿಯನ್ನು ಪರಿಶೀಲಿಸಲು ಆಗಲಿಲ್ಲ.",
    verified: function (n) { return "ಪಾವತಿಯಾಗಿದೆ ಮತ್ತು ಪರಿಶೀಲಿಸಲಾಗಿದೆ (Razorpay ಟೆಸ್ಟ್ ಮೋಡ್). ಆರ್ಡರ್ " + n + " ಪಾವತಿಯಾಗಿದೆ."; },
    recorded: function (n, st) { return "ಪಾವತಿ ದಾಖಲಾಗಿದೆ, ಆದರೆ ಆರ್ಡರ್ " + n + " ಸ್ಥಿತಿ " + st + "."; },
    noCheckout: "Razorpay ಚೆಕ್‌ಔಟ್ ತೆರೆಯಲಿಲ್ಲ. ಇಂಟರ್ನೆಟ್ ನೋಡಿ ಪುಟವನ್ನು ಮತ್ತೆ ತೆರೆಯಿರಿ.",
    opening: "Razorpay ಚೆಕ್‌ಔಟ್ ತೆರೆಯುತ್ತಿದೆ (ಟೆಸ್ಟ್ ಮೋಡ್).",
    closed: "ಚೆಕ್‌ಔಟ್ ಮುಚ್ಚಲಾಗಿದೆ. ಯಾವ ಹಣವೂ ಹೋಗಿಲ್ಲ.",
    failed: function (why) { return "ಪಾವತಿ ಆಗಲಿಲ್ಲ" + (why ? ": " + why : "") + "."; },
  };
  var PURCHASE_BY = { "en-IN": PURCHASE, "hi-IN": PURCHASE_HI, "kn-IN": PURCHASE_KN };

  // The customer's copy of a shop's bill (Devanagari / Kannada script for hi / kn).
  var BILL = {
    "en-IN": {
      lang: "en",
      title: "Pay your bill",
      ref: function (n) { return "Bill " + n; },
      vendor: "Shop", item: "Items", buyer: "Customer", amount: "Amount to pay",
      brand: function (shop) { return shop ? "Sahay, an automated assistant for " + shop : "Sahay, an automated assistant for the shop"; },
      banner: "Razorpay TEST MODE: no real money moves.",
      pay: "Pay with Razorpay",
      thanks: "Paid. Thank you.", bill: "Bill", paidAmount: "Amount paid",
      fine: "This page opens Razorpay Checkout in test mode for the bill above. The bill is marked paid only after the server has verified Razorpay's payment signature. Use only Razorpay test card or UPI details.",
      loading: "Loading the bill.",
      retry: "Try again",
      loadFailed: "The bill could not be loaded.",
      unusable: "This payment link cannot be used.",
      expiredTitle: "This payment link has expired",
      expiredText: "Ask the shop for a new payment link.",
      invalidTitle: "This payment link is not valid",
      invalidText: "Ask the shop to send the payment link again.",
      limitTitle: "Too many tries",
      limitText: "Wait a few minutes, then open the link again.",
      errorTitle: "The bill could not be loaded",
      errorText: "Check the internet connection and try again.",
      isPaid: "This bill is paid (Razorpay test mode).",
      verifying: "Verifying the payment with the server.",
      verifyFailed: "The payment could not be verified.",
      verified: function (n) { return "Paid and verified (Razorpay test mode). Bill " + n + " is marked paid."; },
      recorded: function (n) { return "The payment was recorded; bill " + n + " still has money due."; },
      noCheckout: "Razorpay Checkout did not load. Check the connection and reload the page.",
      opening: "Opening Razorpay Checkout (test mode).",
      closed: "Checkout closed. Nothing was paid.",
      failed: function (why) { return "Payment failed: " + (why || "Razorpay did not say why") + "."; },
    },
    "hi-IN": {
      lang: "hi",
      title: "बिल का भुगतान",
      ref: function (n) { return "बिल " + n; },
      vendor: "दुकान", item: "सामान", buyer: "ग्राहक", amount: "चुकाने की रकम",
      brand: function (shop) { return shop ? "सहाय, " + shop + " का स्वचालित सहायक" : "सहाय, दुकान का स्वचालित सहायक"; },
      banner: "Razorpay टेस्ट मोड: असली पैसा नहीं कटता।",
      pay: "Razorpay से भुगतान करें",
      thanks: "भुगतान हो गया। धन्यवाद।", bill: "बिल", paidAmount: "चुकाई गई रकम",
      fine: "यह पन्ना ऊपर वाले बिल के लिए Razorpay चेकआउट टेस्ट मोड में खोलता है। सर्वर के Razorpay का हस्ताक्षर जाँचने के बाद ही बिल चुका हुआ माना जाता है। सिर्फ़ Razorpay के टेस्ट कार्ड या यूपीआई की जानकारी डालिए।",
      loading: "बिल खुल रहा है।",
      retry: "फिर कोशिश करें",
      loadFailed: "बिल नहीं खुल पाया।",
      unusable: "यह भुगतान लिंक काम नहीं करता।",
      expiredTitle: "इस भुगतान लिंक का समय निकल गया",
      expiredText: "दुकान से नया भुगतान लिंक माँगिए।",
      invalidTitle: "यह भुगतान लिंक सही नहीं है",
      invalidText: "दुकान से भुगतान लिंक फिर से भेजने को कहिए।",
      limitTitle: "बहुत बार कोशिश हुई",
      limitText: "कुछ मिनट रुककर लिंक फिर से खोलिए।",
      errorTitle: "बिल नहीं खुल पाया",
      errorText: "इंटरनेट देखकर फिर कोशिश कीजिए।",
      isPaid: "यह बिल चुका दिया गया है (Razorpay टेस्ट मोड)।",
      verifying: "सर्वर भुगतान जाँच रहा है।",
      verifyFailed: "भुगतान की जाँच नहीं हो पाई।",
      verified: function (n) { return "भुगतान हो गया और जाँच लिया गया (Razorpay टेस्ट मोड)। बिल " + n + " चुका दिया गया।"; },
      recorded: function (n) { return "भुगतान दर्ज हो गया; बिल " + n + " में अभी पैसा बाकी है।"; },
      noCheckout: "Razorpay चेकआउट नहीं खुला। इंटरनेट देखकर पन्ना फिर से खोलिए।",
      opening: "Razorpay चेकआउट खुल रहा है (टेस्ट मोड)।",
      closed: "चेकआउट बंद हुआ। कोई पैसा नहीं कटा।",
      failed: function (why) { return "भुगतान नहीं हुआ" + (why ? ": " + why : "") + "।"; },
    },
    "kn-IN": {
      lang: "kn",
      title: "ಬಿಲ್ ಪಾವತಿ",
      ref: function (n) { return "ಬಿಲ್ " + n; },
      vendor: "ಅಂಗಡಿ", item: "ಸಾಮಾನು", buyer: "ಗ್ರಾಹಕರು", amount: "ಪಾವತಿಸಬೇಕಾದ ಮೊತ್ತ",
      brand: function (shop) { return shop ? "ಸಹಾಯ್, " + shop + " ಅವರ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ" : "ಸಹಾಯ್, ಅಂಗಡಿಯ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ"; },
      banner: "Razorpay ಟೆಸ್ಟ್ ಮೋಡ್: ನಿಜವಾದ ಹಣ ಹೋಗುವುದಿಲ್ಲ.",
      pay: "Razorpay ಮೂಲಕ ಪಾವತಿಸಿ",
      thanks: "ಪಾವತಿ ಆಯಿತು. ಧನ್ಯವಾದಗಳು.", bill: "ಬಿಲ್", paidAmount: "ಪಾವತಿಸಿದ ಮೊತ್ತ",
      fine: "ಈ ಪುಟ ಮೇಲಿನ ಬಿಲ್‌ಗೆ Razorpay ಚೆಕ್‌ಔಟ್ ಅನ್ನು ಟೆಸ್ಟ್ ಮೋಡ್‌ನಲ್ಲಿ ತೆರೆಯುತ್ತದೆ. ಸರ್ವರ್ Razorpay ಸಹಿಯನ್ನು ಪರಿಶೀಲಿಸಿದ ನಂತರವೇ ಬಿಲ್ ಪಾವತಿಯಾಗಿದೆ ಎಂದು ಗುರುತಿಸಲಾಗುತ್ತದೆ. Razorpay ಟೆಸ್ಟ್ ಕಾರ್ಡ್ ಅಥವಾ ಯುಪಿಐ ವಿವರಗಳನ್ನು ಮಾತ್ರ ಬಳಸಿ.",
      loading: "ಬಿಲ್ ತೆರೆಯುತ್ತಿದೆ.",
      retry: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
      loadFailed: "ಬಿಲ್ ತೆರೆಯಲು ಆಗಲಿಲ್ಲ.",
      unusable: "ಈ ಪಾವತಿ ಲಿಂಕ್ ಬಳಸಲು ಆಗುವುದಿಲ್ಲ.",
      expiredTitle: "ಈ ಪಾವತಿ ಲಿಂಕ್‌ನ ಸಮಯ ಮುಗಿದಿದೆ",
      expiredText: "ಅಂಗಡಿಯಿಂದ ಹೊಸ ಪಾವತಿ ಲಿಂಕ್ ಕೇಳಿ.",
      invalidTitle: "ಈ ಪಾವತಿ ಲಿಂಕ್ ಸರಿಯಿಲ್ಲ",
      invalidText: "ಪಾವತಿ ಲಿಂಕ್ ಮತ್ತೆ ಕಳುಹಿಸಲು ಅಂಗಡಿಗೆ ಹೇಳಿ.",
      limitTitle: "ತುಂಬಾ ಬಾರಿ ಪ್ರಯತ್ನಿಸಲಾಗಿದೆ",
      limitText: "ಕೆಲವು ನಿಮಿಷ ಕಾದು ಲಿಂಕ್ ಮತ್ತೆ ತೆರೆಯಿರಿ.",
      errorTitle: "ಬಿಲ್ ತೆರೆಯಲು ಆಗಲಿಲ್ಲ",
      errorText: "ಇಂಟರ್ನೆಟ್ ನೋಡಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
      isPaid: "ಈ ಬಿಲ್ ಪಾವತಿಯಾಗಿದೆ (Razorpay ಟೆಸ್ಟ್ ಮೋಡ್).",
      verifying: "ಸರ್ವರ್ ಪಾವತಿಯನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದೆ.",
      verifyFailed: "ಪಾವತಿಯನ್ನು ಪರಿಶೀಲಿಸಲು ಆಗಲಿಲ್ಲ.",
      verified: function (n) { return "ಪಾವತಿಯಾಗಿದೆ ಮತ್ತು ಪರಿಶೀಲಿಸಲಾಗಿದೆ (Razorpay ಟೆಸ್ಟ್ ಮೋಡ್). ಬಿಲ್ " + n + " ಪಾವತಿಯಾಗಿದೆ."; },
      recorded: function (n) { return "ಪಾವತಿ ದಾಖಲಾಗಿದೆ; ಬಿಲ್ " + n + " ನಲ್ಲಿ ಇನ್ನೂ ಹಣ ಬಾಕಿ ಇದೆ."; },
      noCheckout: "Razorpay ಚೆಕ್‌ಔಟ್ ತೆರೆಯಲಿಲ್ಲ. ಇಂಟರ್ನೆಟ್ ನೋಡಿ ಪುಟವನ್ನು ಮತ್ತೆ ತೆರೆಯಿರಿ.",
      opening: "Razorpay ಚೆಕ್‌ಔಟ್ ತೆರೆಯುತ್ತಿದೆ (ಟೆಸ್ಟ್ ಮೋಡ್).",
      closed: "ಚೆಕ್‌ಔಟ್ ಮುಚ್ಚಲಾಗಿದೆ. ಯಾವ ಹಣವೂ ಹೋಗಿಲ್ಲ.",
      failed: function (why) { return "ಪಾವತಿ ಆಗಲಿಲ್ಲ" + (why ? ": " + why : "") + "."; },
    },
  };

  function isInvoice(d) { return Boolean(d && d.kind === "invoice"); }

  // Words: English by default; the small switch at the top picks हिन्दी or ಕನ್ನಡ for this device
  // (the same per-device key the app uses, brief v4 item 3). The shop's language does not decide it.
  var LANG_KEY = "sahay-ui-lang";
  var CODE = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };
  function savedLang() {
    var v = null;
    try { v = window.localStorage ? window.localStorage.getItem(LANG_KEY) : null; } catch (e) { v = null; }
    return v === "hi" || v === "kn" || v === "en" ? v : "en";
  }
  var uiLang = savedLang();

  /** The page's words for this payment: purchase-order or bill wording, in the chosen language. */
  function copyFor(d) {
    var code = CODE[uiLang] || "en-IN";
    var bill = d ? isInvoice(d) : billToken;
    if (!bill) return PURCHASE_BY[code] || PURCHASE;
    return BILL[code] || BILL["en-IN"];
  }
  function guessCopy() { return copyFor(null); }

  function el(id) { return document.getElementById(id); }
  function setText(id, text) { var e = el(id); if (e) e.textContent = text; }
  function setHidden(id, hidden) { var e = el(id); if (e) e.hidden = hidden; }
  function focusOn(id) { var e = el(id); if (e && typeof e.focus === "function") e.focus(); }

  function setState(s) {
    if (root) root.setAttribute("data-state", s);
    var card = el("card");
    if (card) card.setAttribute("aria-busy", s === "loading" || s === "verifying" ? "true" : "false");
    var loading = s === "loading";
    setHidden("skeleton", !loading);
    setHidden("loading", !loading);
  }

  // Razorpay Checkout leaves history entries behind (QA: the browser Back hung after it), so the
  // owner's way home is a plain link, always on the page and repeated after checkout. A bill's
  // customer has no Sahay app: no such link for them.
  function showBack() {
    if (!copy || !copy.backHref) return;
    setHidden("done-back", false);
  }

  /**
   * A bill that is paid: the customer's ending. The bill's details and the pay button give way to
   * "Paid. Thank you." with the shop, the bill number and, when known, the amount just paid.
   */
  function showThanks(c, d, paidAmount) {
    setText("thanks-title", c.thanks);
    setText("thanks-label-shop", c.vendor);
    setText("thanks-shop", d.merchant || d.vendor || "");
    setText("thanks-label-bill", c.bill);
    setText("thanks-bill", d.invoiceNumber || d.poNumber || "");
    var known = typeof paidAmount === "number" && paidAmount > 0;
    setText("thanks-label-amount", c.paidAmount);
    setText("thanks-amount", known ? rupees(paidAmount, d.currency, c.lang) : "");
    setHidden("thanks-label-amount", !known);
    setHidden("thanks-amount-row", !known);
    setHidden("details", true);
    setHidden("amount-block", true);
    setHidden("po", true);
    setHidden("title", true);
    payBtn.hidden = true;
    setHidden("thanks", false);
    setState("thanks");
    focusOn("thanks-title");
  }

  function show(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "pay-status" + (kind ? " is-" + kind : "");
  }

  function rupees(amount, currency, lang) {
    try {
      var locale = lang === "hi" ? "hi-IN" : lang === "kn" ? "kn-IN" : "en-IN";
      return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "INR" }).format(amount);
    } catch (e) {
      return String(amount) + " " + (currency || "INR");
    }
  }

  function applyCopy(c, d) {
    copy = c;
    if (document.documentElement) document.documentElement.lang = c.lang;
    if (root) root.setAttribute("data-kind", c.backHref ? "order" : "bill");
    syncLangButtons();
    setText("title", c.title);
    setText("label-vendor", c.vendor);
    setText("label-item", c.item);
    setText("label-buyer", c.buyer);
    setText("label-amount", c.amount);
    setText("brand-text", c.brand(d ? d.merchant || d.vendor || "" : ""));
    setText("banner-text", c.banner);
    setText("fine", c.fine);
    setText("pay-text", c.pay);
    setText("retry-text", c.retry);
    setText("loading", c.loading);
    if (c.sim) setText("sim-text", c.sim);
    if (c.backHref) {
      setText("back-text", c.back);
      setText("done-back-link", c.back);
      el("back").href = c.backHref;
      el("done-back-link").href = c.backHref;
      setHidden("back", false);
    } else {
      // The shop's customer: no link into the owner's app, before or after paying.
      setHidden("back", true);
      setHidden("done-back", true);
    }
  }

  var view = null; // { kind: "data" } | { kind: "problem", which }
  function render(d) {
    order = d;
    view = { kind: "data" };
    var c = copyFor(d);
    applyCopy(c, d);
    setHidden("problem", true);
    retryBtn.hidden = true;
    var number = isInvoice(d) ? d.invoiceNumber || d.poNumber : d.poNumber;
    setText("po", c.ref(number));
    setHidden("po", false);
    setHidden("title", false);
    setText("vendor", isInvoice(d) ? d.merchant || d.vendor : d.vendor);
    setText("item", isInvoice(d) ? d.item : d.quantity + " " + d.unit + " " + d.item);
    setText("buyer", d.buyer || "");
    setHidden("row-buyer", !d.buyer);
    setText("amount", rupees(d.amount, d.currency, c.lang));
    // Only a simulated vendor of a purchase order is labelled; a customer paying the shop's own bill
    // has no vendor at all, whatever the data says.
    el("sim").hidden = isInvoice(d) || !d.simulated;
    el("details").hidden = false;
    setHidden("amount-block", false);
    if (d.paid) {
      payBtn.hidden = true;
      show(c.isPaid, "ok");
      setState("paid");
      // Reopened after paying: nothing is open (the page says 0), so no amount is repeated.
      if (isInvoice(d)) showThanks(c, d, d.paidNow || null);
      else setHidden("amount-block", true);
    } else {
      payBtn.hidden = false;
      payBtn.disabled = false;
      show("");
      setState("ready");
    }
  }

  /** No usable data: expired, not valid, too many tries, or the server did not answer (Try again). */
  function problem(kind) {
    view = { kind: "problem", which: kind };
    var c = guessCopy();
    applyCopy(c, null);
    var words = {
      expired: [c.expiredTitle, c.expiredText],
      invalid: [c.invalidTitle, c.invalidText],
      limit: [c.limitTitle, c.limitText],
    }[kind] || [c.errorTitle, c.errorText];
    setText("problem-title", words[0]);
    setText("problem-text", words[1]);
    setText("po", c.unusable);
    setHidden("po", true);
    setHidden("title", true);
    setHidden("details", true);
    setHidden("amount-block", true);
    setHidden("sim", true);
    payBtn.hidden = true;
    show("");
    setHidden("problem", false);
    retryBtn.hidden = kind !== "error";
    setState(kind);
    focusOn("problem-title");
  }

  function problemKind(status, body) {
    var code = body && body.code;
    if (code === "PAY_LINK_EXPIRED") return "expired";
    if (code === "PAY_LINK_INVALID" || code === "LINK_INVALID" || status === 404) return "invalid";
    if (code === "RATE_LIMITED" || status === 429) return "limit";
    return "error";
  }

  function load() {
    applyCopy(guessCopy(), null);
    setState("loading");
    setHidden("problem", true);
    retryBtn.hidden = true;
    return fetch(api, { cache: "no-store" })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          if (!r.ok) {
            var err = new Error((body && body.message) || PURCHASE.loadFailed);
            err.kind = problemKind(r.status, body);
            throw err;
          }
          return body;
        });
      })
      .then(render)
      .catch(function (e) { problem(e && e.kind ? e.kind : "error"); });
  }

  function verify(response) {
    var c = copy || PURCHASE;
    var number = isInvoice(order) ? order.invoiceNumber || order.poNumber : order.poNumber;
    show(c.verifying);
    setState("verifying");
    return fetch(api + "/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_signature: response.razorpay_signature,
      }),
    })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          if (!r.ok) throw new Error((body && body.message) || c.verifyFailed);
          return body;
        });
      })
      .then(function (body) {
        payBtn.hidden = true;
        var paid = body.status === "paid";
        show(paid ? c.verified(number) : c.recorded(number, body.status), paid ? "ok" : "bad");
        setState(paid ? "paid" : "partial");
        if (paid) order = Object.assign({}, order, { paid: true, paidNow: isInvoice(order) ? order.amount : null });
        if (paid && isInvoice(order)) showThanks(c, order, order.amount);
        showBack();
      })
      .catch(function (e) {
        payBtn.disabled = false;
        show(e.message, "bad");
        setState("failed");
        showBack();
      });
  }

  payBtn.addEventListener("click", function () {
    if (!order) return;
    var c = copy || PURCHASE;
    if (typeof window.Razorpay !== "function") {
      show(c.noCheckout, "bad");
      setState("failed");
      return;
    }
    payBtn.disabled = true;
    show(c.opening);
    setState("opening");
    var invoice = isInvoice(order);
    var checkout = new window.Razorpay({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      // The one being paid: the vendor for a purchase order, the shop for its own bill.
      name: invoice ? order.merchant || order.vendor : order.vendor,
      description: order.description,
      order_id: order.razorpayOrderId,
      notes: invoice
        ? { invoice_number: order.invoiceNumber || order.poNumber }
        : { po_number: order.poNumber, simulated_vendor: order.simulated ? "yes" : "no" },
      theme: { color: "#A8E27C" },
      handler: verify,
      modal: {
        ondismiss: function () {
          payBtn.disabled = false;
          show(c.closed);
          setState("closed");
          showBack();
        },
      },
    });
    checkout.on("payment.failed", function (r) {
      payBtn.disabled = false;
      show(c.failed(r && r.error && r.error.description), "bad");
      setState("failed");
    });
    checkout.open();
  });

  retryBtn.addEventListener("click", function () { load(); });

  /* ------------------------------------------------------------- language switch -- */
  function syncLangButtons() {
    ["en", "hi", "kn"].forEach(function (k) {
      var b = el("lang-" + k);
      if (b) b.setAttribute("aria-pressed", String(k === uiLang));
    });
  }
  function pickLang(k) {
    if (k === uiLang || !CODE[k]) return;
    var st = root ? root.getAttribute("data-state") : "";
    if (st === "opening" || st === "verifying") return; // never change words under an open checkout
    uiLang = k;
    try { if (window.localStorage) window.localStorage.setItem(LANG_KEY, k); } catch (e) { /* storage blocked: this visit only */ }
    if (view && view.kind === "data" && order) render(order);
    else if (view && view.kind === "problem") problem(view.which);
    else applyCopy(guessCopy(), null);
  }
  ["en", "hi", "kn"].forEach(function (k) {
    var b = el("lang-" + k);
    if (b) b.addEventListener("click", function () { pickLang(k); });
  });

  load();
})();
