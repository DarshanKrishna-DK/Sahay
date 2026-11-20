// Runs before first paint as a classic script (the CSP allows no inline script).
// Picks the landing language and marks the page as scripted. English unless this device chose
// otherwise; the key "sahay-lang" is shared with the app, so the choice carries into /app.
// The landing is dark only, so no theme is read here.
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  var lang = null;
  try {
    lang = localStorage.getItem("sahay-lang");
  } catch (e) { /* storage blocked: English */ }
  if (lang !== "hi" && lang !== "kn" && lang !== "en") lang = "en";
  root.lang = lang;
  root.dataset.lang = lang;
})();
