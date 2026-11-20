// Runs before first paint as a classic script (the CSP allows no inline script).
// Picks the landing language (saved choice, else the browser's) and marks the page as scripted.
// The landing is dark only, so no theme is read here.
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  var lang = null;
  try {
    lang = localStorage.getItem("sahay-landing-lang");
  } catch (e) { /* storage blocked: browser language */ }
  if (lang !== "hi" && lang !== "kn" && lang !== "en") {
    var nav = (navigator.language || "en").toLowerCase();
    lang = nav.indexOf("hi") === 0 ? "hi" : nav.indexOf("kn") === 0 ? "kn" : "en";
  }
  root.lang = lang;
  root.dataset.lang = lang;
})();
