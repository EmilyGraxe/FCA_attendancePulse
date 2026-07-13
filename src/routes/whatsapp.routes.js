const router   = require("express").Router();
const db       = require("../config/db");
const gemini   = require("../services/gemini.service");
const wa       = require("../services/whatsapp.service");
const memory   = require("../services/memory.service");

const ALLOWED_NUMBERS = (process.env.ALLOWED_WHATSAPP_NUMBERS || "")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

const HELP_TEXT = `
🎓 *FCA AttendancePulse Bot*

Ask me anything about your system!

*Try these:*
📋 Who is absent today?
💻 Which PCs haven't been returned?
👤 Show attendance for John this month
📅 How many students came this week?
🔍 Who borrowed someone else's PC?

Type *clear* to reset memory.
Type *help* to see this again.
`.trim();

// ── GET — Meta verification ───────────────────────────────────────────────────
router.get("/", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("✅ WhatsApp webhook verified");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── POST — incoming messages ──────────────────────────────────────────────────
router.post("/", async (req, res) => {
  // Always 200 immediately — Meta resends if no response in 20s
  res.sendStatus(200);

  try {
    console.log("📨 Webhook received:", JSON.stringify(req.body, null, 2));

    // ── Parse Meta's structure ────────────────────────────────────────────────
    const entry   = req.body?.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;

    // Ignore status updates (delivered/read receipts — they have no .messages)
    if (!value?.messages?.length) {
      console.log("⏭️  No messages in payload — skipping (probably a status update)");
      return;
    }

    const msg  = value.messages[0];
    const from = msg.from;        // sender's phone number
    const type = msg.type;

    console.log(`📱 Message from ${from}, type: ${type}`);

    // Only handle text
    if (type !== "text") {
      await wa.sendMessage(from, "⚠️ I only understand text messages. Please type your question.");
      return;
    }

    const text = msg.text.body.trim();
    console.log(`💬 Text: ${text}`);

    // ── Whitelist check (comment out during testing) ──────────────────────────
    // if (ALLOWED_NUMBERS.length && !ALLOWED_NUMBERS.includes(from)) {
    //   console.warn(`🚫 Blocked: ${from}`);
    //   await wa.sendMessage(from, "⛔ Not authorised.");
    //   return;
    // }

    // ── Special commands ──────────────────────────────────────────────────────
    if (/^(help|\?|hi|hello|start)$/i.test(text)) {
      await wa.sendMessage(from, HELP_TEXT);
      return;
    }

    if (/^clear$/i.test(text)) {
      memory.clearHistory(from);
      await wa.sendMessage(from, "🗑️ Memory cleared! Ask me anything.");
      return;
    }

    // ── Thinking indicator ────────────────────────────────────────────────────
    await wa.sendMessage(from, "⏳ Looking that up...");

    // ── Build question with conversation context ──────────────────────────────
    const context      = memory.buildContext(from);
    const fullQuestion = context ? `${context}Current question: ${text}` : text;

    // ── Generate SQL via Gemini ───────────────────────────────────────────────
    let sql;
    try {
      sql = await gemini.generateSQL(fullQuestion);
      console.log(`🔍 SQL: ${sql}`);
    } catch (err) {
      console.error("SQL generation error:", err.message);
      await wa.sendMessage(from,
        "❓ I couldn't understand that. Try rephrasing.\n\nType *help* for examples."
      );
      return;
    }

    // ── Run query ─────────────────────────────────────────────────────────────
    let rows;
    try {
      const result = await db.query(sql);
      rows = result.rows;
      console.log(`✅ Query returned ${rows.length} rows`);
    } catch (err) {
      console.error("DB error:", err.message);
      await wa.sendMessage(from,
        `⚠️ Database error:\n${err.message.slice(0, 200)}`
      );
      return;
    }

    // ── Format and reply ──────────────────────────────────────────────────────
    const answer = await gemini.formatAnswer(text, rows);
    await wa.sendMessage(from, answer);
    console.log(`📤 Reply sent to ${from}`);

    // ── Save to memory ────────────────────────────────────────────────────────
    memory.addExchange(from, text, answer);

  } catch (err) {
    console.error("❌ Webhook handler error:", err);
  }
});

module.exports = router;