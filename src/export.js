const PDFDocument = require("pdfkit");
const db = require("./db");
const compliance = require("./compliance");

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows, columns) {
  const head = columns.map((c) => csvEscape(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(c.get(r))).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

/** Full observation history - the sheet an accountant or partner would want. */
function observationsCSV(businessId) {
  const rows = db.allObservations(businessId, 5000);
  return toCSV(rows, [
    { header: "Observed At", get: (r) => r.observed_at },
    { header: "Module", get: (r) => r.module },
    { header: "Title", get: (r) => r.title },
    { header: "Price (INR)", get: (r) => r.price_value },
    { header: "Price Shown", get: (r) => r.price_text },
    { header: "Availability", get: (r) => r.availability },
    { header: "Rating", get: (r) => r.rating },
    { header: "Reviews", get: (r) => r.review_count },
    { header: "Sentiment", get: (r) => r.sentiment },
    { header: "MOQ", get: (r) => r.moq },
    { header: "Source URL", get: (r) => r.url },
  ]);
}

function complianceCSV(businessId) {
  const rows = compliance.calendarWithUrgency(businessId);
  return toCSV(rows, [
    { header: "Filing", get: (r) => r.title },
    { header: "Authority", get: (r) => r.authority },
    { header: "Due Date", get: (r) => r.due_date },
    { header: "Days Until", get: (r) => r.daysUntil },
    { header: "Urgency", get: (r) => r.escalation.level },
    { header: "Frequency", get: (r) => r.frequency },
    { header: "Status", get: (r) => r.status },
    { header: "Official Portal", get: (r) => r.portal_url },
    { header: "Checklist", get: (r) => (r.checklist || []).join(" | ") },
  ]);
}

const RUPEE = "Rs. ";
const INK = "#1a1a1a";
const MUTED = "#6b6b6b";
const ACCENT = "#b8410f";

/**
 * Owner/accountant-facing PDF report. Streamed straight to the response so a
 * large history never has to be buffered in memory.
 */
function digestPDF(businessId, res) {
  const business = db.getBusiness(businessId);
  const digest = db.latestDigest(businessId);
  const events = compliance.calendarWithUrgency(businessId);
  const observations = db.allObservations(businessId, 60);

  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Sahay report - ${business.name}` } });
  doc.pipe(res);

  doc.fillColor(ACCENT).fontSize(9).text("SAHAY", { characterSpacing: 3 });
  doc.moveDown(0.3);
  doc.fillColor(INK).fontSize(22).text(business.name);
  doc.fillColor(MUTED).fontSize(9.5)
    .text([business.category, business.city, business.state].filter(Boolean).join(" · ") || "Business report");
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}`);
  doc.moveDown(1.2);

  const rule = () => {
    doc.moveTo(doc.x, doc.y).lineTo(547, doc.y).strokeColor("#e0ddd6").lineWidth(1).stroke().moveDown(0.6);
  };

  doc.fillColor(INK).fontSize(13).text("What needs attention");
  rule();
  if (digest && digest.items.length) {
    for (const it of digest.items) {
      doc.fillColor(ACCENT).fontSize(8).text(`${(it.urgency || "medium").toUpperCase()} · ${it.module || ""}`);
      doc.fillColor(INK).fontSize(11).text(`${it.rank}. ${it.headline}`);
      doc.fillColor(MUTED).fontSize(9.5).text(it.detail || "");
      if (it.action) doc.fillColor(INK).fontSize(9.5).text(`Next step: ${it.action}`);
      if (it.source_url) doc.fillColor(MUTED).fontSize(8).text(it.source_url, { link: it.source_url });
      doc.moveDown(0.7);
    }
  } else {
    doc.fillColor(MUTED).fontSize(10).text("No digest generated yet.");
    doc.moveDown(0.7);
  }

  doc.moveDown(0.4).fillColor(INK).fontSize(13).text("Compliance calendar");
  rule();
  if (events.length) {
    for (const e of events) {
      doc.fillColor(INK).fontSize(10.5).text(`${e.title}${e.authority ? ` - ${e.authority}` : ""}`);
      doc.fillColor(MUTED).fontSize(9)
        .text(`${e.due_date || "date not published"} · ${e.escalation.label} · ${e.frequency || ""}`);
      if (e.portal_url) doc.fontSize(8).fillColor(MUTED).text(e.portal_url, { link: e.portal_url });
      doc.moveDown(0.45);
    }
    doc.moveDown(0.2).fillColor(MUTED).fontSize(8)
      .text("Sahay is a reminder layer, not the system of record. Confirm every date on the official portal before filing.");
  } else {
    doc.fillColor(MUTED).fontSize(10).text("No compliance calendar built yet.");
  }

  doc.moveDown(0.9).fillColor(INK).fontSize(13).text("Recent observations");
  rule();
  if (observations.length) {
    for (const o of observations.slice(0, 30)) {
      doc.fillColor(INK).fontSize(9)
        .text(`${o.observed_at} · ${o.module} · ${(o.title || "").slice(0, 60)}`, { continued: false });
      doc.fillColor(MUTED).fontSize(8.5)
        .text([o.price_text && `Price ${String(o.price_text).replace(/₹/g, RUPEE)}`, o.availability, o.rating && `Rating ${o.rating}`, o.sentiment]
          .filter(Boolean).join(" · ") || "-");
      doc.moveDown(0.3);
    }
  } else {
    doc.fillColor(MUTED).fontSize(10).text("No observations recorded yet.");
  }

  doc.end();
}

module.exports = { observationsCSV, complianceCSV, digestPDF };
