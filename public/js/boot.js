// Runs before first paint, as a classic script (the page allows no inline script).
// agora-agent-client-toolkit 2.10.0 dist/index.mjs reads process.env.NODE_ENV unguarded
// (verified in spike S0), so the shim must exist before any module runs.
window.process = window.process || { env: { NODE_ENV: "production" } };
// Apply a saved theme before first paint. Storage may be blocked; the page works without it.
try {
  var savedTheme = localStorage.getItem("sahay-theme");
  if (savedTheme === "light" || savedTheme === "dark") document.documentElement.dataset.theme = savedTheme;
} catch (e) { /* storage blocked */ }
