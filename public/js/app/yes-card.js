// The Yes card is waiting.js now (UX v3 D6-D8): one tray and one card for purchase, bill, reorder
// and rule decisions. This file only keeps the old mount point main.js knew
// ({ el, update(parts), openFirst() }) while the v3 shell lands; the card itself, its states and
// its button paths live in waiting.js and waiting-model.js.

import { legacyLayer, openTray, renderCard, waitingItems, onCount, typedYesHint } from "./waiting.js";

export function createYesLayer() {
  return {
    el: legacyLayer(),
    // waiting.js follows the store itself; nothing to do per update.
    update() {},
    openFirst() { openTray(); },
  };
}

export { openTray, renderCard, waitingItems, onCount, typedYesHint };
