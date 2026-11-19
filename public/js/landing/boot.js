// Runs before first paint as a classic script (the CSP allows no inline script).
// Applies the saved theme (shared with the app, key "sahay-theme") and the landing language,
// and marks the page as scripted so motion styles may hide elements they will animate in.
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  var lang = null;
  try {
    var theme = localStorage.getItem("sahay-theme");
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    lang = localStorage.getItem("sahay-landing-lang");
  } catch (e) { /* storage blocked: system theme, browser language */ }
  if (lang !== "hi" && lang !== "kn" && lang !== "en") {
    var nav = (navigator.language || "en").toLowerCase();
    lang = nav.indexOf("hi") === 0 ? "hi" : nav.indexOf("kn") === 0 ? "kn" : "en";
  }
  root.lang = lang;
  root.dataset.lang = lang;
})();
