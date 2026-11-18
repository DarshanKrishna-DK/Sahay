/**
 * Strip markdown to plain text.
 *
 * Every model-written string in Sahay ends up in one of two places: a plain
 * text node in the UI, or Sarvam's text-to-speech. Neither renders markdown -
 * asterisks would be shown and read aloud literally. The prompts ask for plain
 * text; this is what guarantees it.
 */
function toPlainText(text) {
  return String(text || "")
    .replace(/```[a-z]*\n?/gi, "")                 // fenced code blocks
    .replace(/`([^`]+)`/g, "$1")                   // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1")             // bold
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1")  // italics
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")            // headings
    .replace(/^\s*[-*+]\s+/gm, "\u2022 ")          // bullets -> a real bullet
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { toPlainText };
