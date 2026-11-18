const groq = require("./groq");
const anakin = require("./anakin");
const db = require("./db");

/**
 * Build a personalised filing calendar from the business's registration type
 * and state (PRD 6.2). We ground the model on live portal content pulled via
 * Anakin Search first, so the calendar cites real pages rather than the model's
 * recollection - the PRD is explicit that Sahay is a reminder layer, never the
 * system of record, and must always link back to the official portal.
 */
async function buildCalendar(business) {
  const queries = [
    `GST return filing due dates ${new Date().getFullYear()} India GSTR-1 GSTR-3B small business`,
    `Udyam MSME registration annual compliance requirements India`,
    `${business.state || "India"} shops and establishments labour licence renewal ${business.category || "small business"}`,
  ];

  const grounding = [];
  const sourceErrors = [];
  const searches = await Promise.allSettled(queries.map((q) => anakin.search(q, 3)));
  searches.forEach((s, i) => {
    if (s.status === "fulfilled") {
      for (const r of s.value) grounding.push({ url: r.url, title: r.title, excerpt: (r.text || "").slice(0, 1500) });
    } else {
      sourceErrors.push({ query: queries[i], error: s.reason?.message || String(s.reason) });
    }
  });

  if (!grounding.length) {
    throw new Error(`Could not pull any live compliance source: ${sourceErrors[0]?.error || "unknown error"}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const result = await groq.chatJSON([
    {
      role: "system",
      content:
        "You build a filing calendar for an Indian MSME from live regulatory page excerpts. " +
        'Return ONLY JSON: {"events":[{"title":"","authority":"","due_date":"YYYY-MM-DD or null","frequency":"monthly|quarterly|annual|one-time","portal_url":"","checklist":["doc 1","doc 2"],"why":"one sentence on why it applies to this business"}]}. ' +
        "Rules: only include obligations the excerpts actually support; set due_date to the NEXT occurrence on or after " +
        `${today}; if the excerpts do not state a date, set due_date null rather than guessing; portal_url must be an ` +
        "official government domain that appears in the excerpts (gst.gov.in, udyamregistration.gov.in, epfindia.gov.in, " +
        "the state labour portal, etc.). Return 4-8 events. Never state a penalty amount that is not in the excerpts.",
    },
    {
      role: "user",
      content: `Today: ${today}\nBusiness: ${business.name}\nCategory: ${business.category || "general small business"}\nState: ${business.state || "unspecified"}\nCity: ${business.city || "unspecified"}\n\nLive source excerpts:\n${JSON.stringify(grounding, null, 1)}`,
    },
  ], { temperature: 0.15, maxTokens: 2200 });

  const events = (result.events || []).filter((e) => e.title);
  db.replaceComplianceEvents(business.id, events);
  db.audit(business.id, "compliance_calendar_built", { count: events.length, sources: grounding.map((g) => g.url) });

  return { events: db.listComplianceEvents(business.id), sources: grounding.map((g) => ({ url: g.url, title: g.title })), sourceErrors };
}

/** Days until a due date; negative means overdue. */
function daysUntil(dueDate) {
  if (!dueDate) return null;
  const d = new Date(dueDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d - new Date(new Date().toISOString().slice(0, 10) + "T00:00:00")) / 86400000);
}

/**
 * Reminders escalate as the deadline approaches (PRD 6.2) rather than firing
 * one flat notification.
 */
function escalationLevel(dueDate) {
  const d = daysUntil(dueDate);
  if (d === null) return { level: "unscheduled", label: "No date found - verify on portal" };
  if (d < 0) return { level: "overdue", label: `Overdue by ${Math.abs(d)} day(s)` };
  if (d <= 3) return { level: "critical", label: `Due in ${d} day(s)` };
  if (d <= 7) return { level: "high", label: `Due in ${d} days` };
  if (d <= 21) return { level: "medium", label: `Due in ${d} days` };
  return { level: "low", label: `Due in ${d} days` };
}

function calendarWithUrgency(businessId) {
  return db.listComplianceEvents(businessId).map((e) => ({
    ...e,
    checklist: safeParse(e.checklist, []),
    daysUntil: daysUntil(e.due_date),
    escalation: escalationLevel(e.due_date),
  }));
}

function safeParse(v, fallback) {
  try { return JSON.parse(v); } catch { return fallback; }
}

module.exports = { buildCalendar, calendarWithUrgency, escalationLevel, daysUntil };
