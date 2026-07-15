/**
 * responseGenerator.service.js — Orchestrates the priority pipeline:
 *   Intent  →  Rule Engine  →  DB + Formula  →  Knowledge Base  →  Gemini fallback
 *
 * Public API:
 *   answer({ text, user, phone, memory, opts })
 *     -> { text, source, intent, escalated, sql? }
 *
 *   source ∈ 'rules' | 'kb' | 'gemini' | 'system'
 */
const intent = require("./intent.service");
const rules  = require("./rules.service");
const kb     = require("./knowledgeBase.service");
const cache  = require("./cache.service");
const dbq    = require("./dbQuery.service");
const gemini = require("../gemini.service"); // existing service (SQL + format)
const db     = require("../../config/db");

async function _geminiFallback(text, memoryCtx = "") {
  try {
    const sql = await gemini.generateSQL(memoryCtx + text);
    const result = await db.query(sql);
    const answer = await gemini.formatAnswer(text, result.rows);
    return { text: answer, source: "gemini", sql };
  } catch (err) {
    console.error("[responseGen] gemini fallback failed:", err.message);
    return {
      text:
        "🤔 I couldn't find that in the database automatically. " +
        "Try rephrasing, or type *help* for what I can answer.",
      source: "system",
    };
  }
}

async function answer({ text, user, phone, memory, opts = {} }) {
  const raw = String(text || "").trim();
  if (!raw) return { text: "Please send a question.", source: "system", intent: "empty" };

  // Cheap cache — identical question by same identity in last 30s
  const cacheKey = `resp:${user?.id || phone || "anon"}:${raw.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && !opts.noCache) return cached;

  const cls = intent.classify(raw);
  const memCtx = memory?.buildContext ? memory.buildContext(phone || `u:${user?.id || "anon"}`) : "";

  // 1) Try deterministic rule
  const ruleResult = await rules.run(cls.intent, {
    user, phone, entities: cls.entities, role: user?.role, memory,
  });
  if (ruleResult && ruleResult.text) {
    if (ruleResult._clear && memory?.clearHistory) memory.clearHistory(phone || `u:${user?.id || "anon"}`);
    const out = { text: ruleResult.text, source: cls.intent.startsWith("faq_") ? "kb" : "rules", intent: cls.intent };
    return cache.set(cacheKey, out, 30000);
  }

  // 2) KB direct hit (defensive; rules.run also covers these)
  const kbHit = kb.get(cls.intent);
  if (kbHit) {
    const out = { text: kbHit, source: "kb", intent: cls.intent };
    return cache.set(cacheKey, out, 60000);
  }

  // 3) Escalate — but ask permission for unknowns unless the user already opted in
  if (cls.intent === "unknown" && !opts.escalate) {
    const out = {
      text:
        "🤔 I couldn't match that to what I know.\n" +
        "Reply *ai* to let me try with the AI, or type *help* for the menu.",
      source: "system", intent: cls.intent, escalated: false,
    };
    return cache.set(cacheKey, out, 15000);
  }

  // 4) Gemini fallback
  const g = await _geminiFallback(raw, memCtx);
  const out = { ...g, intent: cls.intent, escalated: true };
  return cache.set(cacheKey, out, 20000);
}

module.exports = { answer };
