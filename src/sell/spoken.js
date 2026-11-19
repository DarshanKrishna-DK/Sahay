"use strict";

/**
 * What else the server read out in a call. approvals.answerAfterSpoken already refuses a yes when
 * a purchase approval's or a rule's read-back was spoken after the one being answered; the Sell
 * read-backs (invoices, item tax) and the stock reorder questions live in their own tables, so the
 * Sell gate checks those here as well: a yes answers only the last thing the server asked.
 */

const db = require("../db");
const { SellError } = require("./errors");

const collapse = (text) => String(text ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const isServerLine = (item) => item?.role === "assistant" && item?.metadata?.source === "command" && typeof item.content === "string";
const isOwnerAsr = (item) => item?.role === "user" && item?.metadata?.source === "asr" && typeof item.content === "string" && item.content.trim() !== "";

const pieces = (text) => require("../agora/agent").splitUtf8(text).map(collapse);

/**
 * Throws READBACK_SUPERSEDED when a piece of any `others` text was spoken by the server between
 * the last line of the `own` read-back and the owner's last ASR turn.
 */
function assertNothingBetween(contents, own, others) {
  if (!Array.isArray(contents)) return;
  const ownPieces = own.map(pieces);
  const ownSet = new Set(ownPieces.flat());
  const lastPieces = new Set(ownPieces.map((p) => p[p.length - 1]));
  let anchor = -1;
  for (let i = contents.length - 1; i >= 0 && anchor < 0; i--) if (isServerLine(contents[i]) && lastPieces.has(collapse(contents[i].content))) anchor = i;
  let answer = -1;
  for (let i = contents.length - 1; i >= 0 && answer < 0; i--) if (isOwnerAsr(contents[i])) answer = i;
  if (anchor < 0 || answer <= anchor) return; // answerAfterSpoken has already refused these cases
  const otherSet = new Set(others.flatMap(pieces).filter((p) => !ownSet.has(p)));
  for (let i = anchor + 1; i < answer; i++) {
    if (isServerLine(contents[i]) && otherSet.has(collapse(contents[i].content))) {
      throw new SellError("READBACK_SUPERSEDED", "Something else was read out after this one.", { status: 409 });
    }
  }
}

const tableExists = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

/**
 * Texts the server spoke for other Sell / stock subjects of this business.
 * @param {{invoiceApprovalId?: string, itemTaxId?: string}} exclude  the subject being answered
 */
function otherSpoken(businessId, { invoiceApprovalId = null, itemTaxId = null } = {}) {
  const texts = [
    ...db.prepare("SELECT spoken_text FROM invoice_readbacks WHERE business_id = ? AND approval_id IS NOT ?").all(businessId, invoiceApprovalId),
    ...db.prepare("SELECT spoken_text FROM item_tax_readbacks WHERE business_id = ? AND id IS NOT ?").all(businessId, itemTaxId),
  ];
  if (tableExists("reorder_readbacks")) texts.push(...db.prepare("SELECT spoken_text FROM reorder_readbacks WHERE business_id = ?").all(businessId));
  return texts.map((r) => r.spoken_text);
}

module.exports = { assertNothingBetween, otherSpoken };
