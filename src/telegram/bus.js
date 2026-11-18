/**
 * A tiny message bus between the Telegram polling loop and anything that needs
 * to *await* a reply from a specific chat.
 *
 * The negotiation agent is written as a straight-line conversation - say a
 * thing, wait for the answer, say the next thing. Telegram, meanwhile, pushes
 * updates into a single polling loop with no notion of who is waiting for what.
 * This bridges the two: a caller parks a promise against a chat id, and the
 * poller resolves it when that chat next speaks.
 *
 * While a chat has a waiter registered, the normal command handling is skipped
 * for that chat - the conversation owns the channel until it finishes.
 */

const waiters = new Map(); // chatId -> { resolve, timer }

/** True when something is currently awaiting a message from this chat. */
const isWaiting = (chatId) => waiters.has(String(chatId));

/**
 * Wait for the next message from `chatId`.
 * Resolves with the raw Telegram message, or null if nothing arrives in time.
 */
function waitForMessage(chatId, timeoutMs = 180000) {
  const key = String(chatId);
  // A second waiter on the same chat would strand the first; release it.
  cancel(key, null);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(key);
      resolve(null);
    }, timeoutMs);
    waiters.set(key, { resolve, timer });
  });
}

/** Called by the poller. Returns true if the message was consumed by a waiter. */
function deliver(chatId, message) {
  const key = String(chatId);
  const w = waiters.get(key);
  if (!w) return false;
  clearTimeout(w.timer);
  waiters.delete(key);
  w.resolve(message);
  return true;
}

/** Abandon a wait (conversation cancelled, agent hung up). */
function cancel(chatId, value = null) {
  const key = String(chatId);
  const w = waiters.get(key);
  if (!w) return false;
  clearTimeout(w.timer);
  waiters.delete(key);
  w.resolve(value);
  return true;
}

module.exports = { waitForMessage, deliver, cancel, isWaiting };
