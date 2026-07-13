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
  // Always respond 200 first
  res.sendStatus(200);
  
  // Log everything
  console.log("=== WHATSAPP POST HIT ===");
  console.log("BODY:", JSON.stringify(req.body, null, 2));
});


module.exports = router;
