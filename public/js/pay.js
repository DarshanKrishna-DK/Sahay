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
(function () {
  "use strict";
  var token = location.pathname.split("/").pop();
  var api = "/api/pay/" + encodeURIComponent(token);
  var payBtn = document.getElementById("pay");
  var statusEl = document.getElementById("status");
  var order = null;
  var copy = null;

  var PURCHASE = {
    lang: "en",
    title: "Payment for a purchase order",
    ref: function (n) { return "Purchase order " + n; },
    vendor: "Supplier", item: "Item", buyer: "Buyer", amount: "Amount",
    brand: function () { return "Sahay, an automated procurement assistant"; },
    banner: "Razorpay TEST MODE: no real money moves. Use only Razorpay test card or UPI details.",
    pay: "Pay with Razorpay (test mode)",
    back: "Back to Sahay", backHref: "/app#/buy",
    fine: "This page opens Razorpay Checkout in test mode for the order above. Sahay marks the order paid only after the server has verified Razorpay's payment signature.",
    loadFailed: "The order could not be loaded.",
    unusable: "This payment link cannot be used.",
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

  // The customer's copy of a shop's bill, in the shop's language (Devanagari / Kannada script).
  var BILL = {
    "en-IN": {
      lang: "en",
      title: "Pay your bill",
      ref: function (n) { return "Bill " + n; },
      vendor: "Shop", item: "Items", buyer: "Customer", amount: "Amount",
      brand: function (shop) { return "Sahay, an automated assistant for " + shop; },
      banner: "Razorpay TEST MODE: no real money moves. Use only Razorpay test card or UPI details.",
      pay: "Pay with Razorpay (test mode)",
      thanks: "Paid. Thank you.", bill: "Bill", paidAmount: "Amount paid",
      fine: "This page opens Razorpay Checkout in test mode for the bill above. The bill is marked paid only after the server has verified Razorpay's payment signature.",
      loadFailed: "The bill could not be loaded.",
      unusable: "This payment link cannot be used.",
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
      vendor: "दुकान", item: "सामान", buyer: "ग्राहक", amount: "रकम",
      brand: function (shop) { return "सहाय, " + shop + " का स्वचालित सहायक"; },
      banner: "Razorpay टेस्ट मोड: असली पैसा नहीं कटता। सिर्फ़ Razorpay के टेस्ट कार्ड या यूपीआई की जानकारी डालिए।",
      pay: "Razorpay से भुगतान करें (टेस्ट मोड)",
      thanks: "भुगतान हो गया। धन्यवाद।", bill: "बिल", paidAmount: "चुकाई गई रकम",
      fine: "यह पन्ना ऊपर वाले बिल के लिए Razorpay चेकआउट टेस्ट मोड में खोलता है। सर्वर के Razorpay का हस्ताक्षर जाँचने के बाद ही बिल चुका हुआ माना जाता है।",
      loadFailed: "बिल नहीं खुल पाया।",
      unusable: "यह भुगतान लिंक काम नहीं करता।",
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
      vendor: "ಅಂಗಡಿ", item: "ಸಾಮಾನು", buyer: "ಗ್ರಾಹಕರು", amount: "ಮೊತ್ತ",
      brand: function (shop) { return "ಸಹಾಯ್, " + shop + " ಅವರ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ"; },
      banner: "Razorpay ಟೆಸ್ಟ್ ಮೋಡ್: ನಿಜವಾದ ಹಣ ಹೋಗುವುದಿಲ್ಲ. Razorpay ಟೆಸ್ಟ್ ಕಾರ್ಡ್ ಅಥವಾ ಯುಪಿಐ ವಿವರಗಳನ್ನು ಮಾತ್ರ ಬಳಸಿ.",
      pay: "Razorpay ಮೂಲಕ ಪಾವತಿಸಿ (ಟೆಸ್ಟ್ ಮೋಡ್)",
      thanks: "ಪಾವತಿ ಆಯಿತು. ಧನ್ಯವಾದಗಳು.", bill: "ಬಿಲ್", paidAmount: "ಪಾವತಿಸಿದ ಮೊತ್ತ",
      fine: "ಈ ಪುಟ ಮೇಲಿನ ಬಿಲ್‌ಗೆ Razorpay ಚೆಕ್‌ಔಟ್ ಅನ್ನು ಟೆಸ್ಟ್ ಮೋಡ್‌ನಲ್ಲಿ ತೆರೆಯುತ್ತದೆ. ಸರ್ವರ್ Razorpay ಸಹಿಯನ್ನು ಪರಿಶೀಲಿಸಿದ ನಂತರವೇ ಬಿಲ್ ಪಾವತಿಯಾಗಿದೆ ಎಂದು ಗುರುತಿಸಲಾಗುತ್ತದೆ.",
      loadFailed: "ಬಿಲ್ ತೆರೆಯಲು ಆಗಲಿಲ್ಲ.",
      unusable: "ಈ ಪಾವತಿ ಲಿಂಕ್ ಬಳಸಲು ಆಗುವುದಿಲ್ಲ.",
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

  /** The page's words for this payment: purchase-order wording, or the shop's bill in its language. */
  function copyFor(d) {
    if (!isInvoice(d)) return PURCHASE;
    return BILL[d.language] || BILL["en-IN"];
  }

  // Razorpay Checkout leaves history entries behind (QA: the browser Back hung after it), so the
  // owner's way home is a plain link, always on the page and repeated after checkout. A bill's
  // customer has no Sahay app: no such link for them.
  function showBack() {
    if (!copy || !copy.backHref) return;
    var b = document.getElementById("done-back");
    if (b) b.hidden = false;
  }

  function setHidden(id, hidden) {
    var el = document.getElementById(id);
    if (el) el.hidden = hidden;
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
    setHidden("po", true);
    setHidden("title", true);
    payBtn.hidden = true;
    setHidden("thanks", false);
    var heading = document.getElementById("thanks-title");
    if (heading && typeof heading.focus === "function") heading.focus();
  }

  function show(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind || "";
  }

  function rupees(amount, currency, lang) {
    try {
      var locale = lang === "hi" ? "hi-IN" : lang === "kn" ? "kn-IN" : "en-IN";
      return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "INR" }).format(amount);
    } catch (e) {
      return String(amount) + " " + (currency || "INR");
    }
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function applyCopy(c, d) {
    copy = c;
    if (document.documentElement) document.documentElement.lang = c.lang;
    setText("title", c.title);
    setText("label-vendor", c.vendor);
    setText("label-item", c.item);
    setText("label-buyer", c.buyer);
    setText("label-amount", c.amount);
    setText("brand-text", c.brand(d.merchant || d.vendor || ""));
    setText("banner", c.banner);
    setText("fine", c.fine);
    setText("pay", c.pay);
    if (c.backHref) {
      setText("back-text", c.back);
      setText("done-back-link", c.back);
      document.getElementById("back").href = c.backHref;
      document.getElementById("done-back-link").href = c.backHref;
    } else {
      // The shop's customer: no link into the owner's app, before or after paying.
      setHidden("back", true);
      setHidden("done-back", true);
    }
  }

  function render(d) {
    order = d;
    var c = copyFor(d);
    applyCopy(c, d);
    var number = isInvoice(d) ? d.invoiceNumber || d.poNumber : d.poNumber;
    setText("po", c.ref(number));
    setText("vendor", isInvoice(d) ? d.merchant || d.vendor : d.vendor);
    setText("item", isInvoice(d) ? d.item : d.quantity + " " + d.unit + " " + d.item);
    setText("buyer", d.buyer || "");
    setText("amount", rupees(d.amount, d.currency, c.lang));
    // Only a simulated counterpart is labelled; a real shop's bill never is.
    document.getElementById("sim").hidden = !d.simulated;
    document.getElementById("details").hidden = false;
    if (d.paid) {
      payBtn.hidden = true;
      show(c.isPaid, "ok");
      // Reopened after paying: nothing is open (the page says 0), so no amount is repeated.
      if (isInvoice(d)) showThanks(c, d, null);
    } else {
      payBtn.disabled = false;
      show("");
    }
  }

  function errorText(body, fallback) {
    return (body && body.message) || fallback;
  }

  fetch(api, { cache: "no-store" })
    .then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        if (!r.ok) throw new Error(errorText(body, PURCHASE.loadFailed));
        return body;
      });
    })
    .then(render)
    .catch(function (e) {
      setText("po", (copy || PURCHASE).unusable);
      show(e.message, "bad");
    });

  function verify(response) {
    var c = copy || PURCHASE;
    var number = isInvoice(order) ? order.invoiceNumber || order.poNumber : order.poNumber;
    show(c.verifying);
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
          if (!r.ok) throw new Error(errorText(body, c.verifyFailed));
          return body;
        });
      })
      .then(function (body) {
        payBtn.hidden = true;
        show(body.status === "paid" ? c.verified(number) : c.recorded(number, body.status), body.status === "paid" ? "ok" : "bad");
        if (body.status === "paid" && isInvoice(order)) showThanks(c, order, order.amount);
        showBack();
      })
      .catch(function (e) {
        payBtn.disabled = false;
        show(e.message, "bad");
        showBack();
      });
  }

  payBtn.addEventListener("click", function () {
    if (!order) return;
    var c = copy || PURCHASE;
    if (typeof window.Razorpay !== "function") {
      show(c.noCheckout, "bad");
      return;
    }
    payBtn.disabled = true;
    show(c.opening);
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
      theme: { color: "#1f6f5c" },
      handler: verify,
      modal: {
        ondismiss: function () {
          payBtn.disabled = false;
          show(c.closed);
          showBack();
        },
      },
    });
    checkout.on("payment.failed", function (r) {
      payBtn.disabled = false;
      show(c.failed(r && r.error && r.error.description), "bad");
    });
    checkout.open();
  });
})();
