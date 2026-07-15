/**
 * ai.routes.js — In-app AI Assistant API.
 * Mount in server.js:
 *   app.use("/api/ai", require("./src/routes/ai.routes"));
 *
 * Uses the existing JWT auth middleware so responses are role-aware.
 * Endpoints:
 *   POST /api/ai/chat        { message, escalate? }  -> { text, source, intent }
 *   POST /api/ai/clear                                -> { ok: true }
 *   GET  /api/ai/history                              -> { history: [...] }
 *   GET  /api/ai/insights?narrative=1                 -> analytics payload
 *   GET  /api/ai/suggestions                          -> role-aware prompts
 */
const router  = require("express").Router();
const auth    = require("../middleware/auth");
const dbq     = require("../services/ai/dbQuery.service");
const memory  = require("../services/memory.service");
const respgen = require("../services/ai/responseGenerator.service");
const rules   = require("../services/ai/rules.service");
const analytics = require("../services/ai/analytics.service");

function keyFor(user) { return `u:${user.id}`; }

router.post("/chat", auth, async (req, res) => {
  try {
    const { message, escalate = false } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }
    const user = await dbq.findUserById(req.user.id);
    if (!user) return res.status(401).json({ error: "user not found" });

    const key = keyFor(user);
    const result = await respgen.answer({
      text: message, user, phone: key, memory,
      opts: { escalate: Boolean(escalate) },
    });

    memory.addExchange(key, message, result.text, { intent: result.intent, source: result.source });
    res.json(result);
  } catch (err) {
    console.error("[/api/ai/chat]", err);
    res.status(500).json({ error: err.message || "chat failed" });
  }
});

router.post("/clear", auth, (req, res) => {
  memory.clearHistory(`u:${req.user.id}`);
  res.json({ ok: true });
});

router.get("/history", auth, (req, res) => {
  res.json({ history: memory.getHistory(`u:${req.user.id}`) });
});

router.get("/insights", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin" && req.user.role !== "lecturer") {
      return res.status(403).json({ error: "forbidden" });
    }
    const payload = await analytics.insights({
      withNarrative: String(req.query.narrative || "") === "1",
    });
    res.json(payload);
  } catch (err) {
    console.error("[/api/ai/insights]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/suggestions", auth, (req, res) => {
  const student = [
    "📊 My attendance",
    "📈 Attendance percentage",
    "💻 My PC",
    "🎧 My kit",
    "📅 This month",
    "❌ How many absences?",
  ];
  const lecturer = [
    "❌ Who is absent today?",
    "🟢 Current session",
    "📦 Equipment issued today",
    "🏅 Most present students",
    "⚠️ Most absent students",
    "📅 Today's sessions",
  ];
  const admin = [
    "🏫 Institution stats",
    "📉 Attendance trend",
    "🔁 Most borrowed PCs",
    "❌ Most absent students",
    "📊 Insights",
    "📦 Equipment issued today",
  ];
  const role = req.user.role;
  const list = role === "admin" ? admin : role === "lecturer" ? lecturer : student;
  res.json({ role, suggestions: list, help: rules.helpFor(role) });
});

module.exports = router;
