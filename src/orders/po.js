"use strict";

/**
 * The purchase order PDF. `poModel` decides every word that goes on the page
 * from database rows; `renderPO` only draws that model and writes the file to
 * <data>/po/<po number>.pdf. A simulated vendor is labelled on the page and in
 * the PDF's own metadata.
 */

const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");
const { config } = require("../config");
const { SIMULATED_LABEL } = require("../db/repo");

class PoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PoError";
    this.code = code;
  }
}

const INK = "#14140f";
const MUTED = "#6b6558";
const ACCENT = "#b4531f";
const RULE = "#ddd6c6";
const MARGIN = 50;

const SIMULATED_NOTICE =
  "The prices and terms on this purchase order came from a simulated vendor (an automated stand-in used for " +
  "demonstration), not from a real supplier. It is not an offer or commitment by any business named here.";

const QUOTE_SOURCE = {
  human: "Quote given by a person who joined the negotiation by invite link.",
  phone: "Quote given on a phone call.",
};

/**
 * PDFKit's built-in Helvetica covers Latin text only (and has no rupee sign,
 * hence "Rs."). Text in an Indic script needs one of these fonts; when none is
 * installed the purchase order is refused rather than printed as garbage.
 */
const ASSET_FONTS = path.join(__dirname, "..", "..", "assets", "fonts");
const INDIC_FONTS = [
  {
    script: "Devanagari",
    pattern: /\p{Script=Devanagari}/u,
    candidates: [
      [path.join(ASSET_FONTS, "NotoSansDevanagari-Regular.ttf")],
      ["C:\\Windows\\Fonts\\Nirmala.ttc", "NirmalaUI"],
      ["/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf"],
    ],
  },
  {
    script: "Kannada",
    pattern: /\p{Script=Kannada}/u,
    candidates: [
      [path.join(ASSET_FONTS, "NotoSansKannada-Regular.ttf")],
      ["C:\\Windows\\Fonts\\Nirmala.ttc", "NirmalaUI"],
      ["/usr/share/fonts/truetype/noto/NotoSansKannada-Regular.ttf"],
    ],
  },
];
const HELVETICA_TEXT = /^[\n\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]*$/;

/** Which font can print this text: "Helvetica", or `{ script, source }` for an installed Indic font. */
function fontFor(text, fonts = INDIC_FONTS) {
  if (HELVETICA_TEXT.test(text)) return "Helvetica";
  const indic = fonts.find((font) => font.pattern.test(text));
  if (!indic) throw new PoError("UNPRINTABLE_TEXT", "The purchase order contains text in a script Sahay cannot print.");
  const source = indic.candidates.find(([file]) => fs.existsSync(file));
  if (!source) {
    throw new PoError(
      "FONT_MISSING",
      `The purchase order contains ${indic.script} text and no ${indic.script} font is installed (expected ${path.basename(indic.candidates[0][0])} in assets/fonts).`,
    );
  }
  return { script: indic.script, source };
}

const money = (n) => `Rs. ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (n) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const dateInIndia = (iso) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

const present = (list) => list.filter(Boolean);

/** Everything the purchase order says, as plain data. */
function poModel({ order, business, vendor, quote, requirement, negotiation, approval }) {
  const simulated = order.simulated === true;
  const goods = quote.unit_price * requirement.quantity;
  return {
    poNumber: order.po_number,
    raisedOn: dateInIndia(order.created_at),
    simulated,
    notice: simulated ? { title: SIMULATED_LABEL.toUpperCase(), body: SIMULATED_NOTICE } : null,
    buyer: { name: business.name, lines: present([business.owner_name, present([business.city, business.state]).join(", ")]) },
    supplier: {
      name: simulated ? `${vendor.name} (${SIMULATED_LABEL})` : vendor.name,
      lines: present([
        vendor.city,
        vendor.kind === "listed" && vendor.phone ? `Published enquiry number: ${vendor.phone}` : null,
        vendor.kind === "listed" && vendor.source_url ? `Listing: ${vendor.source_url}` : null,
        simulated ? null : QUOTE_SOURCE[negotiation?.counterpart],
      ]),
    },
    line: {
      description: requirement.item,
      quantity: `${plain(requirement.quantity)} ${requirement.unit}`,
      rate: `${money(quote.unit_price)} / ${requirement.unit}`,
      amount: money(goods),
    },
    freight: quote.freight == null ? "Not quoted - not included" : money(quote.freight),
    total: money(order.amount),
    terms: present([
      quote.payment_terms && `Payment: ${quote.payment_terms}`,
      quote.lead_time_days != null && `Lead time: ${quote.lead_time_days} ${quote.lead_time_days === 1 ? "day" : "days"}`,
      requirement.delivery_by && `Needed by: ${requirement.delivery_by}`,
      requirement.city && `Deliver to: ${requirement.city}`,
      quote.moq != null && `Vendor minimum order: ${plain(quote.moq)} ${quote.unit}`,
      quote.quoted_sentence && `As quoted: "${quote.quoted_sentence}"`,
    ]),
    approval:
      `Approved by the buyer on ${dateInIndia(approval.decided_at)} by ${approval.decided_via === "voice" ? "spoken confirmation" : "button"} ` +
      `(approval ${approval.id}). Prepared by Sahay, an automated procurement assistant.`,
  };
}

function poFilePath(poNumber) {
  const name = String(poNumber).replaceAll("/", "-");
  if (!/^[A-Z0-9-]+$/.test(name)) throw new PoError("INVALID_PO_NUMBER", "That is not a purchase order number.");
  return path.join(config.poDir, `${name}.pdf`);
}

function draw(doc, model) {
  const width = doc.page.width - MARGIN * 2;
  const half = width / 2;
  const registered = new Set();

  /** Draw text in a font that can print it; `bold` applies to Latin text only. */
  const put = (text, { size, color = INK, bold = false, x, y, ...options } = {}) => {
    const font = fontFor(text);
    if (font === "Helvetica") {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
    } else {
      if (!registered.has(font.script)) {
        doc.registerFont(font.script, ...font.source);
        registered.add(font.script);
      }
      doc.font(font.script);
    }
    doc.fontSize(size).fillColor(color);
    if (x === undefined) doc.text(text, options);
    else doc.text(text, x, y, options);
  };

  put("PURCHASE ORDER", { size: 9, color: ACCENT, characterSpacing: 3 });
  put(model.poNumber, { size: 21, bold: true });
  put(`Raised ${model.raisedOn}`, { size: 9.5, color: MUTED });
  doc.moveDown(1);

  if (model.notice) {
    const top = doc.y;
    put(model.notice.title, { size: 11, color: ACCENT, bold: true, x: MARGIN + 10, y: top + 8, width: width - 20 });
    put(model.notice.body, { size: 9, x: MARGIN + 10, y: doc.y + 2, width: width - 20 });
    const bottom = doc.y + 8;
    doc.rect(MARGIN, top, width, bottom - top).strokeColor(ACCENT).lineWidth(1).stroke();
    doc.y = bottom + 14;
  }

  const partiesTop = doc.y;
  const party = (label, { name, lines }, x) => {
    put(label, { size: 8.5, color: MUTED, x, y: partiesTop, width: half - 12 });
    put(name, { size: 11, bold: true, x, y: doc.y + 2, width: half - 12 });
    for (const line of lines) put(line, { size: 9, color: MUTED, x, y: doc.y + 1, width: half - 12 });
    return doc.y;
  };
  let y = Math.max(party("BUYER", model.buyer, MARGIN), party("SUPPLIER", model.supplier, MARGIN + half)) + 16;

  const rule = (fromX) => doc.moveTo(fromX, y).lineTo(doc.page.width - MARGIN, y).strokeColor(RULE).lineWidth(1).stroke();
  rule(MARGIN);
  y += 12;

  const columns = { description: [MARGIN, 190], quantity: [245, 80], rate: [330, 115], amount: [450, 95] };
  const cell = (key, text, options) =>
    put(text, { x: columns[key][0], y, width: columns[key][1], align: key === "description" ? "left" : "right", ...options });
  for (const [key, heading] of [["description", "DESCRIPTION"], ["quantity", "QTY"], ["rate", "RATE"], ["amount", "AMOUNT"]]) {
    cell(key, heading, { size: 8.5, color: MUTED });
  }
  y += 16;

  let rowBottom = y;
  for (const key of Object.keys(columns)) {
    cell(key, model.line[key], { size: 10.5 });
    rowBottom = Math.max(rowBottom, doc.y);
  }
  y = rowBottom + 12;
  rule(columns.quantity[0]);
  y += 10;

  const summary = (label, value, options) => {
    put(label, { x: columns.quantity[0], y, width: 200, align: "right", ...options });
    put(value, { x: columns.amount[0] - 60, y, width: columns.amount[1] + 60, align: "right", ...options });
    y = doc.y + 6;
  };
  summary("Freight", model.freight, { size: 10, color: MUTED });
  summary("Total", model.total, { size: 13, bold: true });

  doc.x = MARGIN;
  doc.y = y + 24;
  put("AGREED TERMS", { size: 8.5, color: MUTED, x: MARGIN, y: doc.y, width });
  if (model.terms.length) for (const term of model.terms) put(`\u2022 ${term}`, { size: 10, width });
  else put("No further terms were recorded.", { size: 10, color: MUTED, width });

  doc.moveDown(2);
  put(model.approval, { size: 8, color: MUTED, width });
}

/** Refuse before a file is opened if any text on the page has no font that can print it. */
function assertPrintable(value) {
  if (typeof value === "string") fontFor(value);
  else if (value && typeof value === "object") Object.values(value).forEach(assertPrintable);
}

/**
 * Write the purchase order for a loaded order document (repo.getOrderDocument)
 * and return the absolute path of the PDF.
 */
function renderPO(document) {
  const model = poModel(document);
  assertPrintable(model);
  const file = poFilePath(model.poNumber);
  const partial = `${file}.${process.pid}.part`;
  fs.mkdirSync(path.dirname(file), { recursive: true });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGIN,
      info: {
        Title: `Purchase Order ${model.poNumber}`,
        Author: "Sahay",
        Subject: model.simulated ? `Demonstration only - ${SIMULATED_LABEL}` : "Purchase order",
      },
    });
    const out = fs.createWriteStream(partial);
    const fail = (err) => {
      out.destroy();
      fs.rmSync(partial, { force: true });
      reject(err);
    };
    out.on("error", fail);
    out.on("finish", () => {
      try {
        fs.renameSync(partial, file);
        resolve(file);
      } catch (err) {
        fail(err);
      }
    });
    doc.on("error", fail);
    doc.pipe(out);
    try {
      draw(doc, model);
      doc.end();
    } catch (err) {
      doc.unpipe(out);
      fail(err);
    }
  });
}

module.exports = { PoError, renderPO, poModel, poFilePath, fontFor };
