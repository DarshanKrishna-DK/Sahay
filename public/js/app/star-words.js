// Words and icons for a rule or a memory in My Sahay (Rules and Memory lists, their sheets).
// A waiting suggestion, a rule Sahay follows and a memory each say which they are in words, never
// by colour alone.
//
//   starWord(item), starIcon(item), starTone(item), sentenceOf(x, langCode)
//   item = { type: "rule"|"memory", data }

import { t } from "./i18n.js";
import { sentenceOf } from "./me-logic.js";
import "./me-strings.js";

const RULE_ICON = { max_price: "rupee", prefer_vendor: "heart", avoid_vendor: "ban", usual_quantity: "box", reply_language: "globe", bargain_style: "gauge" };
const MEM_ICON = { usual_item: "box", liked_vendor: "heart", last_price: "tag" };

export { sentenceOf };

export function starTone(it) {
  if (it.type === "memory") return "memory";
  return it.data.status === "suggested" ? "suggested" : "rule";
}

export function starWord(it) {
  const tone = starTone(it);
  return tone === "memory" ? t("me.memory") : tone === "suggested" ? t("me.suggested") : t("me.rule");
}

export function starIcon(it) {
  const k = it.data && it.data.kind;
  return (it.type === "memory" ? MEM_ICON[k] : RULE_ICON[k]) || (it.type === "memory" ? "box" : "star");
}
