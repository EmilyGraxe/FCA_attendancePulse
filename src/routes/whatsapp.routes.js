const router = require("express").Router();
const db     = require("../config/db");
const gemini = require("../services/gemini.service");
const wa     = require("../services/whatsapp.service");
const memory = require("../services/memory.service");

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

// ── GET — Twilio/Meta verification ────────────────────────────────────────────
router.get("/", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("✅ WhatsApp webhook verified");
    return res.status(200).send(challenge);
  }
  res.sendStatus(200); // Twilio just needs a 200
});

// ── POST — incoming messages ──────────────────────────────────────────────────
router.post("/", async (req, res) => {
  res.sendStatus(200);

  try {
    console.log("📨 Incoming:", JSON.stringify(req.body));

    // Twilio sends form data — From and Body fields
    const from = (req.body.From || "").replace("whatsapp:+", "").replace("whatsapp:", "");
    const text = (req.body.Body || "").trim();

    if (!from || !text) {
      console.log("⏭️ Empty from or text — skipping");
      return;
    }

    console.log(`📱 From: ${from} | Text: ${text}`);

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

    // ── Build question with context ───────────────────────────────────────────
    const context      = memory.buildContext(from);
    const fullQuestion = context ? `${context}Current question: ${text}` : text;

    // ── Generate SQL via Gemini ───────────────────────────────────────────────
    let sql;
    try {
      sql = await gemini.generateSQL(fullQuestion);
      console.log(`🔍 SQL: ${sql}`);
    } catch (err) {
      console.error("SQL generation error:", err.message);
      await wa.sendMessage(from, "❓ Could not understand that. Try rephrasing.\n\nType *help* for examples.");
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
      await wa.sendMessage(from, `⚠️ Database error:\n${err.message.slice(0, 200)}`);
      return;
    }

    // ── Format and send answer ────────────────────────────────────────────────
    const answer = await gemini.formatAnswer(text, rows);
    await wa.sendMessage(from, answer);
    console.log(`📤 Reply sent to ${from}`);

    // ── Save to memory ────────────────────────────────────────────────────────
    memory.addExchange(from, text, answer);

  } catch (err) {
    console.error("❌ Webhook error:", err);
  }
});

module.exports = router;