/**
 * whatsapp.routes.js — Twilio WhatsApp webhook.
 *
 * Pipeline (Gemini is the LAST resort):
 *   Intent classifier → Rule engine → DB + Formula → Knowledge base → Gemini
 *
 * Also supports:
 *   • LINK <reg_no>   — links this WhatsApp number to a student profile
 *                       (requires optional table user_whatsapp; see migrations/)
 *   • AI              — after a "couldn't match" reply, force Gemini fallback
 *   • CLEAR           — reset conversation memory
 *   • HELP            — role-aware menu
 *
 * Fully backward-compatible: same route path, same env vars, same Twilio flow.
 */
const router  = require("express").Router();
const db      = require("../config/db");
const wa      = require("../services/whatsapp.service");
const memory  = require("../services/memory.service");
const respgen = require("../services/ai/responseGenerator.service");
const dbq     = require("../services/ai/dbQuery.service");
const rules   = require("../services/ai/rules.service");

const ALLOWED_NUMBERS = (process.env.ALLOWED_WHATSAPP_NUMBERS || "")
  .split(",")
  .map((n) => n.trim().replace(/^\+/, ""))
  .filter(Boolean);

router.get("/", (_req, res) => res.status(200).send("Twilio WhatsApp webhook is live"));

router.post("/", async (req, res) => {
  // Ack Twilio immediately
  res.set("Content-Type", "text/xml").status(200).send("<Response></Response>");

  try {
    const rawFrom = (req.body.From || "").toString();
    const body    = (req.body.Body || "").toString().trim();
    const type    = req.body.MessageType || "text";
    if (!rawFrom) return;

    const from = rawFrom.replace(/^whatsapp:/i, "").replace(/^\+/, "");
    console.log(`📱 From ${from} [${type}]: ${body}`);

    if (type !== "text" || !body) {
      await wa.sendMessage(from, "⚠️ I can only understand text messages. Type your question in words.");
      return;
    }

    if (ALLOWED_NUMBERS.length && !ALLOWED_NUMBERS.includes(from)) {
      await wa.sendMessage(from, "🚫 This number isn't authorised to use the bot. Contact your admin.");
      return;
    }

    const upper = body.toUpperCase();

    // ── LINK <reg_no> ──────────────────────────
    if (upper.startsWith("LINK ")) {
      const reg = body.slice(5).trim();
      if (!reg) { await wa.sendMessage(from, "Usage: *LINK <your reg no>* e.g. LINK FCA_DICE_2025-12"); return; }
      try {
        const found = await db.query(`SELECT id, name FROM users WHERE reg_no ILIKE $1 LIMIT 1`, [reg]);
        if (!found.rows.length) { await wa.sendMessage(from, `❌ No student found with reg no "${reg}".`); return; }
        await db.query(
          `INSERT INTO user_whatsapp(phone, user_id) VALUES ($1, $2)
             ON CONFLICT (phone) DO UPDATE SET user_id = EXCLUDED.user_id`,
          [from, found.rows[0].id]
        );
        await wa.sendMessage(from, `✅ Linked to *${found.rows[0].name}*. Try: *my attendance*`);
      } catch (err) {
        console.error("LINK error:", err.message);
        await wa.sendMessage(from,
          "⚠️ Linking is not available yet. Ask your admin to run migrations/001_user_whatsapp.sql.");
      }
      return;
    }

    // ── CLEAR ──────────────────────────────────
    if (upper === "CLEAR" || upper === "RESET") {
      memory.clearHistory(from);
      await wa.sendMessage(from, "🧹 Conversation memory cleared.");
      return;
    }

    // ── HELP ───────────────────────────────────
    if (upper === "HELP" || upper === "MENU") {
      const user = await dbq.findUserByPhone(from);
      await wa.sendMessage(from, rules.helpFor(user?.role));
      return;
    }

    // ── Fallback opt-in: "AI <question>" or plain "AI" after a rejection ──
    let escalate = false;
    let questionText = body;
    if (upper === "AI" || upper.startsWith("AI ")) {
      escalate = true;
      questionText = body.slice(2).trim();
      if (!questionText) {
        const hist = memory.getHistory(from);
        const lastUser = [...hist].reverse().find((h) => h.q && !/^ai\b/i.test(h.q));
        questionText = lastUser?.q || "";
      }
      if (!questionText) { await wa.sendMessage(from, "🤖 Send *AI <your question>*."); return; }
    }

    // Optional: quick typing indicator for long lookups
    // await wa.sendMessage(from, "⏳ Looking that up…"); // uncomment if you prefer

    const user = await dbq.findUserByPhone(from);
    const result = await respgen.answer({
      text: questionText,
      user, phone: from,
      memory,
      opts: { escalate },
    });

    await wa.sendMessage(from, result.text);
    memory.addExchange(from, body, result.text, { intent: result.intent, source: result.source });

    console.log(`✅ Replied via ${result.source} (${result.intent})`);
  } catch (err) {
    console.error("Webhook handler error:", err);
  }
});

module.exports = router;
