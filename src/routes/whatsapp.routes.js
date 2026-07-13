/**
 * whatsapp.routes.js — Twilio WhatsApp Sandbox
 *   POST /webhook/whatsapp  — Incoming messages (Twilio form-encoded)
 *   GET  /webhook/whatsapp  — Health probe (Twilio has no verify handshake)
 */

const router = require("express").Router();
const db     = require("../config/db");
const gemini = require("../services/gemini.service");
const wa     = require("../services/whatsapp.service");
const memory = require("../services/memory.service");

// Whitelist. Format: E.164 with country code, no +. e.g. 256700123456
const ALLOWED_NUMBERS = (process.env.ALLOWED_WHATSAPP_NUMBERS || "")
  .split(",")
  .map((n) => n.trim().replace(/^\+/, ""))
  .filter(Boolean);

const HELP_TEXT = `
🎓 *FCA AttendancePulse Bot*

Ask me anything about your attendance / kit system.

*Examples:*
📋 Who is absent today?
💻 Which PCs haven't been returned?
👤 Show attendance for John this month
🔍 Who borrowed someone else's PC?
📊 Which student missed the most sessions?

Type *clear* to reset memory.
Type *help* for this message.
`.trim();

router.get("/", (req, res) => {
  res.status(200).send("Twilio WhatsApp webhook is live");
});

router.post("/", async (req, res) => {
  // Ack Twilio immediately with an empty TwiML response so it doesn't retry.
  res.set("Content-Type", "text/xml");
  res.status(200).send("<Response></Response>");

  try {
    // Twilio sends application/x-www-form-urlencoded
    const rawFrom = (req.body.From || "").toString();      // "whatsapp:+256700123456"
    const body    = (req.body.Body || "").toString().trim();
    const type    = req.body.MessageType || "text";

    if (!rawFrom) {
      console.warn("No From on request — is body-parser urlencoded enabled?");
      return;
    }

    // Strip "whatsapp:" and leading +
    const from = rawFrom.replace(/^whatsapp:/i, "").replace(/^\+/, "");

    console.log(`📱 From ${from} [${type}]: ${body}`);

    if (type !== "text" || !body) {
      await wa.sendMessage(from, "⚠️ I can only understand text messages. Please type your question.");
      return;
    }

    if (ALLOWED_NUMBERS.length && !ALLOWED_NUMBERS.includes(from)) {
      console.warn(`Blocked unauthorised number: ${from}`);
      await wa.sendMessage(from, "⛔ You are not authorised to use this system.");
      return;
    }

    if (/^(help|\?|hi|hello|start|join)$/i.test(body)) {
      await wa.sendMessage(from, HELP_TEXT);
      return;
    }

    if (/^clear$/i.test(body)) {
      memory.clearHistory(from);
      await wa.sendMessage(from, "🗑️ Memory cleared. Ask me anything!");
      return;
    }

    await wa.sendMessage(from, "⏳ Looking that up...");

    const context = memory.buildContext(from);
    const fullQuestion = context ? `${context}Current question: ${body}` : body;

    let sql;
    try {
      sql = await gemini.generateSQL(fullQuestion);
      console.log(`🔍 SQL: ${sql}`);
    } catch (err) {
      console.error("SQL gen error:", err.message);
      await wa.sendMessage(from, "❓ I couldn't understand that. Try rephrasing.\n\nType *help* for examples.");
      return;
    }

    let rows;
    try {
      const result = await db.query(sql);
      rows = result.rows;
    } catch (err) {
      console.error("DB error:", err.message);
      await wa.sendMessage(from, `⚠️ Database error.\n\n${err.message.slice(0, 200)}`);
      return;
    }

    const answer = await gemini.formatAnswer(body, rows);
    await wa.sendMessage(from, answer);
    memory.addExchange(from, body, answer);

  } catch (err) {
    console.error("Webhook handler error:", err);
  }
});

module.exports = router;
