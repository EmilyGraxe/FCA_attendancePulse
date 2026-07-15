/**
 * cache.service.js — Tiny in-memory TTL cache for AI + DB responses.
 * Cuts repeated Gemini + DB calls for identical/similar questions.
 */
const store = new Map(); // key -> { value, expiresAt }
const DEFAULT_TTL_MS = 60 * 1000;

function _now() { return Date.now(); }

function get(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt < _now()) { store.delete(key); return null; }
  return hit.value;
}
function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: _now() + ttlMs });
  if (store.size > 500) {
    const firstKey = store.keys().next().value;
    store.delete(firstKey);
  }
  return value;
}
async function wrap(key, ttlMs, fn) {
  const cached = get(key);
  if (cached !== null) return cached;
  const value = await fn();
  set(key, value, ttlMs);
  return value;
}
function clear() { store.clear(); }

module.exports = { get, set, wrap, clear };
