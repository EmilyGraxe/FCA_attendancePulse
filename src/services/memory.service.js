/**
 * memory.service.js — extended, backward-compatible.
 * Adds role-aware keys for the in-app assistant while keeping the
 * original getHistory/addExchange/clearHistory/buildContext API.
 *
 * Keys can be:
 *   • WhatsApp phone (e.g. "256700123456")
 *   • "u:<userId>"   (in-app assistant)
 */
const store = new Map();
const TTL_MS = 30 * 60 * 1000;
const MAX_TURNS = 8;

function _fresh(entry) { return entry && (Date.now() - entry.lastAt <= TTL_MS); }

function getHistory(key) {
  const entry = store.get(key);
  if (!_fresh(entry)) { store.delete(key); return []; }
  return entry.history;
}
function addExchange(key, question, answer, meta = {}) {
  const history = getHistory(key);
  history.push({ q: question, a: answer, at: Date.now(), ...meta });
  while (history.length > MAX_TURNS) history.shift();
  store.set(key, { history, lastAt: Date.now() });
}
function clearHistory(key) { store.delete(key); }
function buildContext(key) {
  const history = getHistory(key);
  if (!history.length) return "";
  const lines = history
    .map((h, i) => `Turn ${i + 1}:\nUser: ${h.q}\nBot: ${h.a}`)
    .join("\n\n");
  return `\n\nPREVIOUS CONVERSATION (for context only):\n${lines}\n\n`;
}
function stats() {
  return { conversations: store.size };
}

module.exports = { getHistory, addExchange, clearHistory, buildContext, stats };
