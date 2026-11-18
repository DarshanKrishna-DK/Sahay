const { config } = require("./config");

class AnakinError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "AnakinError";
    this.status = status;
  }
}

async function request(method, path, body) {
  if (!config.anakin.key) throw new AnakinError("ANAKIN_API_KEY is not set", 401);
  const resp = await fetch(config.anakin.base + path, {
    method,
    headers: {
      "X-API-Key": config.anakin.key,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) {
    const msg = data?.error?.message || data?.message || data?.detail || text.slice(0, 200);
    throw new AnakinError(`Anakin ${method} ${path} failed (${resp.status}): ${msg}`, resp.status);
  }
  return data;
}

/**
 * Async job endpoints return 202 + { jobId }. We poll until terminal state.
 * This is the single most important detail about the Anakin API - treating
 * these as synchronous returns a jobId where the caller expects content.
 */
async function pollJob(path, jobId, onTick) {
  for (let i = 0; i < config.anakin.pollMaxAttempts; i++) {
    const job = await request("GET", `${path}/${jobId}`);
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new AnakinError(`Anakin job failed: ${job.error || "unknown"}`);
    if (onTick) onTick(i, job.status);
    await new Promise((r) => setTimeout(r, config.anakin.pollIntervalMs));
  }
  throw new AnakinError("Anakin job timed out");
}

/** Best-effort extraction of readable text from a completed scrape job. */
function jobToText(job) {
  if (job.markdown) return job.markdown;
  if (job.data?.markdown) return job.data.markdown;
  const html = job.cleanedHtml || job.html || "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8377;|&rupee;/g, "\u20b9")
    .replace(/\s+/g, " ")
    .trim();
}

/** Scrape a single URL. Returns readable text plus provenance for auditability. */
async function scrape(url, { useBrowser = false, maxChars = 9000 } = {}) {
  const submitted = await request("POST", "/url-scraper", {
    url,
    formats: ["markdown"],
    country: config.anakin.country,
    useBrowser,
    generateJson: false,
    forceFresh: false,
  });
  const job = await pollJob("/url-scraper", submitted.jobId);
  const text = jobToText(job);
  return {
    url,
    text: text.slice(0, maxChars),
    chars: text.length,
    jobId: submitted.jobId,
    fetchedAt: new Date().toISOString(),
    connector: "Anakin URL Scraper",
  };
}

/** Synchronous web search. Used when the owner names a topic instead of a URL. */
async function search(prompt, limit = 4) {
  const data = await request("POST", "/search", { prompt, limit });
  return (data.results || []).map((r) => ({
    url: r.url,
    title: r.title || r.url,
    text: (r.snippet || r.content || "").slice(0, 6000),
    chars: (r.snippet || r.content || "").length,
    fetchedAt: new Date().toISOString(),
    connector: "Anakin Search API",
    searchId: data.id,
  }));
}

/** Crawl a site (used for supplier catalogues / multi-page storefronts). */
async function crawl(url, { maxPages = 5, depth = 1 } = {}) {
  const submitted = await request("POST", "/crawl", {
    url, maxPages, depth, country: config.anakin.country, useBrowser: false,
  });
  const job = await pollJob("/crawl", submitted.jobId);
  const pages = job.pages || job.results || job.data || [];
  return pages.map((p) => ({
    url: p.url || url,
    text: (p.markdown || jobToText(p) || "").slice(0, 6000),
    fetchedAt: new Date().toISOString(),
    connector: "Anakin Crawl",
  }));
}

/** Create a persistent change-monitor on a URL (PRD 6.1 website monitoring). */
async function createMonitor(url, { name, intervalMinutes = 1440 } = {}) {
  return request("POST", "/monitors", { url, name: name || url, intervalMinutes });
}
async function listMonitors() {
  return request("GET", "/monitors");
}

module.exports = { scrape, search, crawl, createMonitor, listMonitors, AnakinError };
