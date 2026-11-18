const express = require("express");
const cors = require("cors");
const path = require("path");
const { config, missingKeys } = require("./src/config");
const routes = require("./src/routes");
const telegramBot = require("./src/telegram/bot");

const app = express();
app.use(cors());
// Voice recordings arrive base64-encoded inside JSON, so the body cap is generous.
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.use("/api", routes);

// Unmatched API routes must 404 as JSON, not fall through to the SPA shell.
app.use("/api", (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err.message);
  res.status(err.status && err.status < 600 ? err.status : 500).json({ error: err.message });
});

const missing = missingKeys();
const server = app.listen(config.port, () => {
  console.log("");
  console.log("  Sahay is running");
  console.log(`  ->  http://localhost:${config.port}`);
  console.log("");
  console.log(`  Anakin  ${config.anakin.key ? "configured" : "MISSING KEY"}`);
  console.log(`  Groq    ${config.groq.key ? `configured (${config.groq.model})` : "MISSING KEY"}`);
  console.log(`  Sarvam  ${config.sarvam.key ? `configured (${config.sarvam.ttsModel})` : "MISSING KEY"}`);
  if (missing.length) {
    console.log("");
    console.log(`  WARNING: ${missing.join(", ")} not set in .env - live calls will fail.`);
    console.log("  Sahay deliberately does not fall back to sample data: a business");
    console.log("  decision made on invented numbers is worse than no answer.");
  }
  console.log("");

  // The bot shares this process and this database, so a deal negotiated on
  // Telegram is the same row the dashboard renders.
  if (config.telegram.enabled) {
    telegramBot.start().catch((err) => console.error("  Telegram  failed to start:", err.message));
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { telegramBot.stop(); server.close(() => process.exit(0)); });
}

module.exports = app;
