/**
 * memory.service.js
 * In-memory conversation history per phone number.
 * Keeps last 6 exchanges so the bot understands "them", "those", "same ones" etc.
 * Resets after 30 minutes of inactivity.
 */

const store = new Map(); // phone -> { history: [], lastAt: Date }
const TTL_MS = 30 * 60 * 1000; // 30 minutes

function getHistory(phone) {
  const entry = store.get(phone);
  if (!entry) return [];
  // Expire stale sessions
  if (Date.now() - entry.lastAt > TTL_MS) {
    store.delete(phone);
    return [];
  }
  return entry.history;
}

function addExchange(phone, question, answer) {
  const history = getHistory(phone);
  history.push({ q: question, a: answer });
  // Keep only last 6 exchanges to stay within token limits
  if (history.length > 6) history.shift();
  store.set(phone, { history, lastAt: Date.now() });
}

function clearHistory(phone) {
  store.delete(phone);
}

/**
 * Build a context string to prepend to Gemini prompts
 * so it knows what was discussed before.
 */
function buildContext(phone) {
  const history = getHistory(phone);
  if (!history.length) return "";
  const lines = history
    .map((h, i) => `Turn ${i + 1}:\nUser: ${h.q}\nBot: ${h.a}`)
    .join("\n\n");
  return `\n\nPREVIOUS CONVERSATION (for context only):\n${lines}\n\n`;
}

module.exports = { getHistory, addExchange, clearHistory, buildContext };
