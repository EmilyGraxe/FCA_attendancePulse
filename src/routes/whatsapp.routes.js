/**
 * whatsapp.routes.js
 * Two endpoints:
 *   GET  /webhook/whatsapp  — Meta verification handshake
 *   POST /webhook/whatsapp  — Incoming messages from users
 */

const router   = require("express").Router();
const db       = require("../config/db");
const gemini   = require("../services/gemini.service");
const wa       = require("../services/whatsapp.service");
const memory   = require("../services/memory.service");

// ── Whitelist: only these numbers can use the bot ─────────────────────────────
// Add your number and any co-admins. Format: country code + number, no +
// Uganda example: 256700123456
const ALLOWED_NUMBERS = (process.env.ALLOWED_WHATSAPP_NUMBERS || "")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

// ── Help message ──────────────────────────────────────────────────────────────
const HELP_TEXT = `
🎓 *FCA AttendancePulse Bot*

I can answer questions about your system. Just ask naturally!

*Examples:*
📋 Who is absent today?
💻 Which PCs haven't been returned?
👤 Show me attendance for John this month
📅 How many students came this week?
🔍 Who borrowed someone else's PC?
📊 Which student has missed the most sessions?
📈 Attendance summary for June

Type *clear* to reset conversation memory.
Type *help* to see this message again.
`.trim();

// ── GET /webhook/whatsapp — Meta verification ─────────────────────────────────
router.get("/", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("✅ WhatsApp webhook verified by Meta");
    return res.status(200).send(challenge);
  }
  console.warn("❌ WhatsApp webhook verification failed");
  res.sendStatus(403);
});

// ── POST /webhook/whatsapp — incoming messages ────────────────────────────────
router.post("/", async (req, res) => {
  // Always acknowledge immediately — Meta resends if no 200 within 20s
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value  = change?.value;

    // Ignore status updates (delivered/read receipts)
    if (!value?.messages?.length) return;

    const msg  = value.messages[0];
    const from = msg.from; // sender's phone number
    const type = msg.type;

    // Only handle text messages
    if (type !== "text") {
      await wa.sendMessage(from, "⚠️ I can only understand text messages. Please type your question.");
      return;
    }

    const text = msg.text.body.trim();

    // ── Security check ──────────────────────────────────────────────────────
    if (ALLOWED_NUMBERS.length && !ALLOWED_NUMBERS.includes(from)) {
      console.warn(`Blocked unauthorised number: ${from}`);
      await wa.sendMessage(from, "⛔ You are not authorised to use this system.");
      return;
    }

    console.log(`📱 Message from ${from}: ${text}`);

    // ── Special commands ────────────────────────────────────────────────────
    if (/^(help|\?|hi|hello|start)$/i.test(text)) {
      await wa.sendMessage(from, HELP_TEXT);
      return;
    }

    if (/^clear$/i.test(text)) {
      memory.clearHistory(from);
      await wa.sendMessage(from, "🗑️ Conversation memory cleared. Ask me anything!");
      return;
    }

    // ── Typing indicator ────────────────────────────────────────────────────
    await wa.sendMessage(from, "⏳ Looking that up...");

    // ── Build question with conversation context ─────────────────────────────
    const context  = memory.buildContext(from);
    const fullQuestion = context
      ? `${context}Current question: ${text}`
      : text;

    // ── Generate SQL ─────────────────────────────────────────────────────────
    let sql;
    try {
      sql = await gemini.generateSQL(fullQuestion);
      console.log(`🔍 Generated SQL: ${sql}`);
    } catch (err) {
      console.error("SQL generation error:", err.message);
      await wa.sendMessage(from,
        "❓ I couldn't understand that question. Try rephrasing it.\n\nType *help* for examples."
      );
      return;
    }

    // ── Run query ────────────────────────────────────────────────────────────
    let rows;
    try {
      const result = await db.query(sql);
      rows = result.rows;
    } catch (err) {
      console.error("DB query error:", err.message);
      await wa.sendMessage(from,
        `⚠️ Database error running that query.\n\nError: ${err.message.slice(0, 200)}`
      );
      return;
    }

    // ── Format and send answer ───────────────────────────────────────────────
    const answer = await gemini.formatAnswer(text, rows);
    await wa.sendMessage(from, answer);

    // ── Save to memory ───────────────────────────────────────────────────────
    memory.addExchange(from, text, answer);

  } catch (err) {
    console.error("Webhook handler error:", err);
    // Don't crash — Meta needs the 200 we already sent
  }
});

module.exports = router;
