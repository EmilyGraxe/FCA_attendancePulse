/**
 * gemini.service.js
 * Handles all AI calls to Google Gemini.
 * Two jobs:
 *   1. generateSQL  — turn plain English into a safe PostgreSQL query
 *   2. formatAnswer — turn raw DB rows into a friendly WhatsApp message
 */

const fetch = require("node-fetch");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

// ── DB schema Gemini needs to know about ─────────────────────────────────────
const DB_SCHEMA = `
You are a PostgreSQL expert assistant for FCA AttendancePulse — a student
attendance and laptop/kit asset tracking system at a Ugandan college.

DATABASE TABLES:

users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR,
  email       VARCHAR,
  reg_no      VARCHAR,           -- e.g. FCA_DICE_2025-12
  role        VARCHAR,           -- 'student' | 'lecturer' | 'admin'
  phone       VARCHAR,
  pc_asset    VARCHAR,           -- PC number assigned to student
  charger_asset VARCHAR,
  headset_asset VARCHAR,
  qr_token    VARCHAR
)

sessions (
  id           SERIAL PRIMARY KEY,
  session_date DATE,
  start_time   TIMESTAMP,
  end_time     TIMESTAMP,
  active       BOOLEAN,
  label        VARCHAR,
  lecturer_id  INTEGER REFERENCES users(id)
)

attendance (
  id         SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  student_id INTEGER REFERENCES users(id),
  status     VARCHAR   -- 'P' = Present, 'O' = Absent
)

kit_sessions (
  id          SERIAL PRIMARY KEY,
  label       VARCHAR,
  lecturer_id INTEGER REFERENCES users(id),
  started_at  TIMESTAMP,
  closed_at   TIMESTAMP     -- NULL means still open
)

checkouts (
  id             SERIAL PRIMARY KEY,
  kit_session_id INTEGER REFERENCES kit_sessions(id),
  student_id     INTEGER REFERENCES users(id),
  checked_out_at TIMESTAMP,
  returned_at    TIMESTAMP  -- NULL means NOT yet returned
)

loans (
  id             SERIAL PRIMARY KEY,
  kit_session_id INTEGER REFERENCES kit_sessions(id),
  owner_id       INTEGER REFERENCES users(id),  -- whose PC it is
  borrower_id    INTEGER REFERENCES users(id),  -- actual user (if scanned)
  item_type      VARCHAR,   -- 'pc' | 'charger' | 'headset'
  pc_number      VARCHAR,
  borrower_name  VARCHAR,
  loaned_at      TIMESTAMP,
  returned_at    TIMESTAMP  -- NULL means still on loan
)

TODAY = CURRENT_DATE  (Uganda time, UTC+3)

RULES:
- ONLY generate SELECT statements. NEVER INSERT, UPDATE, DELETE, DROP, ALTER.
- Return ONLY the raw SQL query. No explanation. No markdown. No semicolons at end.
- Use table aliases. Use ILIKE for name searches (case-insensitive).
- Limit results to 50 rows unless user asks for all.
- For "today" use CURRENT_DATE.
- For "this week" use date_trunc('week', CURRENT_DATE).
- For "this month" use date_trunc('month', CURRENT_DATE).
- For "absent" filter status = 'O', for "present" filter status = 'P'.
- For "not returned" filter returned_at IS NULL.
- For "overdue" / "not returned" on checkouts also check kit_sessions.closed_at IS NOT NULL.
`;

// ── Call Gemini ────────────────────────────────────────────────────────────────
async function callGemini(systemText, userText) {
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${systemText}\n\nUser question: ${userText}` }],
      },
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  };

  const resp = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

// ── 1. Generate SQL from natural language ─────────────────────────────────────
async function generateSQL(question) {
  const sql = await callGemini(DB_SCHEMA, question);
  // Safety: strip any non-SELECT that slips through
  const clean = sql.replace(/```sql|```/gi, "").trim();
  if (!/^\s*SELECT/i.test(clean)) {
    throw new Error("AI returned a non-SELECT query — blocked for safety.");
  }
  return clean;
}

// ── 2. Format DB results into a WhatsApp-friendly message ─────────────────────
async function formatAnswer(question, rows) {
  if (!rows || rows.length === 0) {
    return "✅ No records found for that query.";
  }

  const formatPrompt = `
You are a friendly assistant replying on WhatsApp for FCA AttendancePulse.
The user asked: "${question}"
The database returned ${rows.length} row(s):
${JSON.stringify(rows.slice(0, 30), null, 2)}

Format a clear, concise WhatsApp reply:
- Use emoji where helpful (✅ ❌ 📋 👤 💻 📅)
- Use plain text, no markdown bold (**) — WhatsApp uses *asterisks* for bold
- List items with a dash or number
- If more than 10 results, summarise and say "showing first 10 of ${rows.length}"
- End with a one-line summary stat if useful
- Keep it under 1500 characters total
- Do NOT say "Based on the data" — just give the answer directly
`;

  return await callGemini(formatPrompt, "Format this response now.");
}

module.exports = { generateSQL, formatAnswer };
