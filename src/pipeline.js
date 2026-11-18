const anakin = require("./anakin");
const groq = require("./groq");
const sarvam = require("./sarvam");
const db = require("./db");
const { MODULES } = require("./modules/definitions");
const { toPlainText } = require("./text");

/** Pull the first plausible rupee figure out of a string the model returned. */
function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * A short signature for which product variant a reading is about, so two
 * readings of the same URL can be told apart. Built from the pack size in the
 * title or key_attribute ("500 g", "1 kg", "250ml") rather than the whole
 * title, which drifts between scrapes.
 */
function variantOf(row) {
  const extra = typeof row.extra === "string" ? safeJSON(row.extra) : row.extra || {};
  const hay = [row.title, row.key_attribute, extra.key_attribute, extra.unit, row.moq]
    .filter(Boolean).join(" ");
  const m = hay.match(/(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|ml|l|ltr|litre|piece|pc|pack)\b/i);
  return m ? `${m[1]}${m[2].toLowerCase()}` : null;
}

function safeJSON(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * Compare this reading against the last stored reading for the same URL and
 * describe what actually changed. This is the difference between a scraper
 * (here is a page) and a monitor (here is what moved, and by how much) - and
 * it is what the alert-threshold feature in PRD 6.1 needs.
 */
function detectChange(moduleKey, current, previous, thresholdPct) {
  if (!previous) return { isNew: true, significant: false, text: "First reading for this source - no baseline yet." };

  const notes = [];
  let significant = false;

  const curPrice = toNumber(current.price_value);
  const prevPrice = toNumber(previous.price_value);
  if (curPrice !== null && prevPrice !== null && prevPrice !== 0) {
    // A listing page shows several pack sizes, and the extractor may land on a
    // different one between runs. Comparing a 100g price against last week's
    // 500g price produces a spectacular, entirely fictional "79% price drop".
    // Only compare like for like; otherwise say the variant moved, not the price.
    const curVariant = variantOf(current);
    const prevVariant = variantOf(previous);
    const comparable = !curVariant || !prevVariant || curVariant === prevVariant;

    if (comparable) {
      const pct = ((curPrice - prevPrice) / prevPrice) * 100;
      const dir = pct > 0 ? "up" : "down";
      notes.push(`Price ${dir} ${Math.abs(pct).toFixed(1)}% (was ${prevPrice}, now ${curPrice}).`);
      if (Math.abs(pct) >= (thresholdPct ?? 5)) significant = true;
    } else {
      notes.push(`Now listing "${curVariant}" at ${curPrice}; last reading was "${prevVariant}" at ${prevPrice}, so the two prices are not comparable.`);
    }
  }

  const curAvail = (current.availability || "").toLowerCase();
  const prevAvail = (previous.availability || "").toLowerCase();
  if (curAvail && prevAvail && curAvail !== prevAvail) {
    notes.push(`Availability changed: ${prevAvail} -> ${curAvail}.`);
    // Stockouts and restocks are always actionable regardless of threshold.
    if (curAvail.includes("out") || prevAvail.includes("out")) significant = true;
  }

  const curRating = toNumber(current.rating);
  const prevRating = toNumber(previous.rating);
  if (curRating !== null && prevRating !== null) {
    const delta = curRating - prevRating;
    if (Math.abs(delta) >= 0.1) {
      notes.push(`Rating ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} (was ${prevRating}, now ${curRating}).`);
      if (delta <= -0.2) significant = true;
    }
  }

  if (moduleKey === "reputation" && current.sentiment && previous.sentiment
      && current.sentiment !== previous.sentiment && current.sentiment === "negative") {
    notes.push("Sentiment turned negative since the last check.");
    significant = true;
  }

  return {
    isNew: false,
    significant,
    since: previous.observed_at,
    text: notes.length ? notes.join(" ") : "No material change since the last check.",
  };
}

/**
 * Reduce one extracted source to just the fields the summariser reasons over.
 * Passing the whole object wastes a meaningful slice of the token budget on
 * provenance the model does not need.
 */
function compactFacts(e) {
  const out = {
    source: e.url,
    title: e.title,
    change: e.change?.text,
  };
  for (const k of ["price_text", "price_value", "availability", "seller", "key_attribute",
    "rating", "review_count", "sentiment", "top_praise", "top_complaint",
    "authority", "obligation", "due_or_change", "portal_url",
    "supplier", "unit", "moq", "location"]) {
    if (e[k] !== undefined && e[k] !== null && e[k] !== "") out[k] = e[k];
  }
  return out;
}

/** Fetch the raw content behind one watch, via URL scrape or web search. */
async function fetchWatch(watch) {
  if (watch.url) {
    const s = await anakin.scrape(watch.url);
    if (!s.text || s.text.length < 40) {
      // Some storefronts only render prices under a real browser session.
      const retry = await anakin.scrape(watch.url, { useBrowser: true });
      if (retry.text && retry.text.length > s.text.length) return [retry];
    }
    return [s];
  }
  if (watch.query) return anakin.search(watch.query, 3);
  return [];
}

/**
 * Run one module for one business, end to end.
 * Returns per-source structured facts, detected changes, and a summary.
 */
async function runModule(business, moduleKey, watches, runId, emit = () => {}) {
  const def = MODULES[moduleKey];
  if (!def) throw new Error(`Unknown module: ${moduleKey}`);
  if (!watches.length) return { module: moduleKey, name: def.name, ok: false, skipped: true, error: "No sources configured." };

  emit({ module: moduleKey, phase: "fetching", detail: `Pulling ${watches.length} source(s) via Anakin` });

  const sources = [];
  const failures = [];
  for (const w of watches) {
    try {
      const fetched = await fetchWatch(w);
      for (const f of fetched) sources.push({ ...f, watch_id: w.id, label: w.label, threshold_pct: w.threshold_pct });
    } catch (err) {
      // Reliability requirement: a failed fetch is surfaced, never silently dropped.
      failures.push({ url: w.url || w.query, error: err.message });
      db.audit(business.id, "fetch_failed", { module: moduleKey, target: w.url || w.query, error: err.message });
    }
  }

  if (!sources.length) {
    return {
      module: moduleKey, name: def.name, ok: false, sources: [], failures,
      error: failures.length ? `All sources failed: ${failures[0].error}` : "No content returned.",
    };
  }

  emit({ module: moduleKey, phase: "extracting", detail: `Groq structuring ${sources.length} page(s)` });

  const extracted = [];
  for (const s of sources) {
    if (!s.text || s.text.length < 30) {
      failures.push({ url: s.url, error: "Page returned no readable text." });
      continue;
    }
    let facts;
    try {
      facts = await groq.extract([
        { role: "system", content: def.extractionSystem },
        // Page text is trimmed hard here: extraction only needs the part of the
        // page carrying the price/rating, and a smaller prompt means many more
        // pages fit inside Groq's per-minute token budget.
        { role: "user", content: `Business: ${business.name} (${business.category || "general"}, ${business.state || "India"})\nSource URL: ${s.url}\n\nPage content:\n${s.text.slice(0, 3000)}` },
      ]);
    } catch (err) {
      failures.push({ url: s.url, error: `Extraction failed: ${err.message}` });
      continue;
    }

    const price_value = toNumber(facts.price_value ?? facts.price_text);
    const rating = toNumber(facts.rating);
    const previous = db.previousObservation(business.id, s.url, runId);
    const change = detectChange(moduleKey, { ...facts, price_value, rating }, previous, s.threshold_pct);

    db.addObservation({
      business_id: business.id, run_id: runId, module: moduleKey, watch_id: s.watch_id,
      url: s.url, title: facts.title || s.title || s.url,
      price_value, price_text: facts.price_text ?? null, availability: facts.availability ?? null,
      rating, review_count: toNumber(facts.review_count), sentiment: facts.sentiment ?? null,
      moq: facts.moq ?? null, extra: facts,
    });

    extracted.push({
      url: s.url, label: s.label || null, connector: s.connector, fetchedAt: s.fetchedAt,
      ...facts, price_value, rating, change,
    });
  }

  if (!extracted.length) {
    return { module: moduleKey, name: def.name, ok: false, sources: [], failures, error: "No source yielded usable facts." };
  }

  emit({ module: moduleKey, phase: "summarising", detail: "Groq writing the owner-facing note" });

  const summary = await groq.chatText([
    { role: "system", content: def.summarySystem },
    {
      role: "user",
      content: `Business: ${business.name} (${business.category || "general"}, ${business.city || ""} ${business.state || "India"})\n\n` +
        `Extracted facts and detected changes:\n${JSON.stringify(extracted.map(compactFacts), null, 1)}`,
    },
  ], { temperature: 0.3 });

  const alerts = extracted.filter((e) => e.change.significant).map((e) => ({
    url: e.url, title: e.title, text: e.change.text,
  }));

  return { module: moduleKey, name: def.name, ok: true, sources: extracted, failures, summary: toPlainText(summary), alerts };
}

/**
 * Cross-module ranking. This is the step that makes Sahay a platform rather
 * than four scrapers: one list, ordered by what actually needs the owner's
 * attention first, regardless of which module surfaced it.
 */
async function rankDigest(business, results) {
  const usable = results.filter((r) => r.ok);
  if (!usable.length) return { items: [], text: "" };

  const context = usable.map((r) => ({
    module: r.module,
    module_name: r.name,
    urgency_guidance: MODULES[r.module].urgencyHint,
    summary: r.summary,
    significant_changes: r.alerts.map((a) => a.text),
    sources: r.sources.map((s) => ({ url: s.url, title: s.title, price: s.price_text, availability: s.availability, rating: s.rating, change: s.change.text })),
  }));

  const ranked = await groq.chatJSON([
    {
      role: "system",
      content:
        "You are Sahay's digest engine for an Indian SME owner. You receive summaries from several monitoring modules. " +
        "Produce ONE ranked action list across all modules - most urgent and most actionable first. " +
        'Return ONLY JSON: {"items":[{"rank":1,"module":"competitor|compliance|reputation|supplier","urgency":"critical|high|medium|low","headline":"<=12 words, concrete","detail":"1-2 sentences with the actual numbers","action":"the single next step the owner should take","source_url":"the URL this came from"}]}. ' +
        "Rank a deadline or a reputation drop above a routine price move. Include 3-6 items. " +
        "Every item must be traceable to a source_url from the input - never invent one.",
    },
    { role: "user", content: `Business: ${business.name} (${business.category || "general"}, ${business.state || "India"})\n\n${JSON.stringify(context, null, 1)}` },
  ], { temperature: 0.2, maxTokens: 2000 });

  const items = (ranked.items || []).slice(0, 8).map((it, i) => ({
    ...it,
    rank: it.rank ?? i + 1,
    headline: toPlainText(it.headline),
    detail: toPlainText(it.detail),
    action: toPlainText(it.action),
  }));
  const text = items
    .map((it) => `${it.rank}. [${(it.urgency || "medium").toUpperCase()}] ${it.headline}. ${it.detail} Next step: ${it.action}`)
    .join("\n");
  return { items, text };
}

/**
 * Full run: every configured module, then rank, then localise and voice.
 * `emit` streams progress so the UI can show the pipeline working rather than
 * a single opaque spinner.
 */
async function runAll(business, { moduleKeys, withAudio = true, emit = () => {} } = {}) {
  const runId = db.startRun(business.id);
  db.audit(business.id, "run_started", { runId });

  const keys = moduleKeys && moduleKeys.length ? moduleKeys : Object.keys(MODULES);
  const results = [];

  try {
    // Modules run concurrently - a slow supplier site must not delay compliance.
    const settled = await Promise.allSettled(keys.map(async (k) => {
      const watches = db.listWatches(business.id, k);
      if (!watches.length) return { module: k, name: MODULES[k].name, ok: false, skipped: true, error: "No sources configured for this module." };
      return runModule(business, k, watches, runId, emit);
    }));

    settled.forEach((s, i) => {
      const key = keys[i];
      const r = s.status === "fulfilled"
        ? s.value
        : { module: key, name: MODULES[key].name, ok: false, error: s.reason?.message || String(s.reason) };
      results.push(r);
      db.saveModuleResult({
        run_id: runId, business_id: business.id, module: key, ok: r.ok,
        summary: r.summary, error: r.error, payload: { sources: r.sources, alerts: r.alerts, failures: r.failures },
      });
    });

    emit({ phase: "ranking", detail: "Ranking everything into one digest" });
    const { items, text } = await rankDigest(business, results);

    let localised = text;
    let audio = [];
    if (text) {
      emit({ phase: "localising", detail: `Sarvam translating to ${business.language}` });
      localised = await sarvam.translate(text, business.language, "en-IN");
      if (withAudio) {
        emit({ phase: "voicing", detail: "Sarvam generating the voice note" });
        try {
          audio = await sarvam.textToSpeech(localised, business.language);
        } catch (err) {
          db.audit(business.id, "tts_failed", { error: err.message });
        }
      }
    }

    const digestId = db.saveDigest({
      business_id: business.id, run_id: runId, language: business.language,
      text_en: text, text_local: localised, items,
    });

    db.finishRun(runId, "completed");
    db.audit(business.id, "run_completed", { runId, digestId, modules: results.map((r) => ({ m: r.module, ok: r.ok })) });

    return {
      runId, digestId, business,
      modules: results,
      digest: { items, textEn: text, textLocal: localised, language: business.language },
      audio,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    db.finishRun(runId, "failed", err.message);
    db.audit(business.id, "run_failed", { runId, error: err.message });
    throw err;
  }
}

module.exports = { runModule, runAll, rankDigest, detectChange, toNumber };
