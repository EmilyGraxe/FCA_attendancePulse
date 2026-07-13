router.post("/", async (req, res) => {
  res.sendStatus(200);

  try {
    console.log("📨 Incoming:", JSON.stringify(req.body));

    // Twilio sends form data, not JSON
    const from = (req.body.From || "").replace("whatsapp:+", "");
    const type = req.body.MediaUrl0 ? "media" : "text";
    const text = (req.body.Body || "").trim();

    if (!from || !text) return;

    console.log(`📱 From: ${from} | Text: ${text}`);

    // Special commands
    if (/^(help|\?|hi|hello|start)$/i.test(text)) {
      await wa.sendMessage(from, HELP_TEXT);
      return;
    }

    if (/^clear$/i.test(text)) {
      memory.clearHistory(from);
      await wa.sendMessage(from, "🗑️ Memory cleared!");
      return;
    }

    await wa.sendMessage(from, "⏳ Looking that up...");

    const context      = memory.buildContext(from);
    const fullQuestion = context ? `${context}Current question: ${text}` : text;

    let sql;
    try {
      sql = await gemini.generateSQL(fullQuestion);
      console.log(`🔍 SQL: ${sql}`);
    } catch (err) {
      await wa.sendMessage(from, "❓ Could not understand that. Try rephrasing.");
      return;
    }

    let rows;
    try {
      const result = await db.query(sql);
      rows = result.rows;
      console.log(`✅ ${rows.length} rows returned`);
    } catch (err) {
      console.error("DB error:", err.message);
      await wa.sendMessage(from, `⚠️ Database error: ${err.message.slice(0, 200)}`);
      return;
    }

    const answer = await gemini.formatAnswer(text, rows);
    await wa.sendMessage(from, answer);
    memory.addExchange(from, text, answer);

  } catch (err) {
    console.error("❌ Error:", err);
  }
});