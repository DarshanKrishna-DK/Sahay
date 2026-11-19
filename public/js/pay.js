// Sahay pay page (served at /pay/<token> by src/routes/api.js). Classic script, no inline code,
// so the page runs under its own strict Content-Security-Policy (server.js PAY_CSP).
// The token is read from the URL; the page holds no data until GET /api/pay/<token> answers.
// Razorpay Standard Checkout: options key, amount, currency, name, description, order_id and a
// success handler that receives razorpay_payment_id / razorpay_order_id / razorpay_signature,
// which the server verifies before it marks the order paid.
(function () {
  "use strict";
  var token = location.pathname.split("/").pop();
  var api = "/api/pay/" + encodeURIComponent(token);
  var payBtn = document.getElementById("pay");
  var statusEl = document.getElementById("status");
  var order = null;

  // Razorpay Checkout leaves history entries behind (QA: the browser Back hung after it), so the
  // way home is a plain link to the Buy screen, always on the page and repeated after checkout.
  function showBack() {
    var b = document.getElementById("done-back");
    if (b) b.hidden = false;
  }

  function show(text, kind) {
    statusEl.textContent = text;
    statusEl.className = kind || "";
  }

  function rupees(amount, currency) {
    try {
      return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR" }).format(amount);
    } catch (e) {
      return String(amount) + " " + (currency || "INR");
    }
  }

  function setText(id, text) {
    document.getElementById(id).textContent = text;
  }

  function render(d) {
    order = d;
    setText("po", "Purchase order " + d.poNumber);
    setText("vendor", d.vendor);
    setText("item", d.quantity + " " + d.unit + " " + d.item);
    setText("buyer", d.buyer);
    setText("amount", rupees(d.amount, d.currency));
    document.getElementById("sim").hidden = !d.simulated;
    document.getElementById("details").hidden = false;
    if (d.paid) {
      payBtn.hidden = true;
      show("This order is paid (Razorpay test mode).", "ok");
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
        if (!r.ok) throw new Error(errorText(body, "The order could not be loaded."));
        return body;
      });
    })
    .then(render)
    .catch(function (e) {
      setText("po", "This payment link cannot be used.");
      show(e.message, "bad");
    });

  function verify(response) {
    show("Verifying the payment with the server.");
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
          if (!r.ok) throw new Error(errorText(body, "The payment could not be verified."));
          return body;
        });
      })
      .then(function (body) {
        payBtn.hidden = true;
        show(body.status === "paid"
          ? "Paid and verified (Razorpay test mode). Order " + order.poNumber + " is marked paid."
          : "The payment was recorded, but order " + order.poNumber + " is " + body.status + ".", body.status === "paid" ? "ok" : "bad");
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
    if (typeof window.Razorpay !== "function") {
      show("Razorpay Checkout did not load. Check the connection and reload the page.", "bad");
      return;
    }
    payBtn.disabled = true;
    show("Opening Razorpay Checkout (test mode).");
    var checkout = new window.Razorpay({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      name: order.vendor,
      description: order.description,
      order_id: order.razorpayOrderId,
      notes: { po_number: order.poNumber, simulated_vendor: order.simulated ? "yes" : "no" },
      theme: { color: "#1f6f5c" },
      handler: verify,
      modal: {
        ondismiss: function () {
          payBtn.disabled = false;
          show("Checkout closed. Nothing was paid.");
          showBack();
        },
      },
    });
    checkout.on("payment.failed", function (r) {
      payBtn.disabled = false;
      show("Payment failed: " + ((r && r.error && r.error.description) || "Razorpay did not say why") + ".", "bad");
    });
    checkout.open();
  });
})();
