const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const DB_SCHEMA = `
You are a PostgreSQL expert assistant for FCA AttendancePulse — a student
attendance and laptop/kit asset tracking system at a Ugandan college.

DATABASE TABLES:

users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR,
  email         VARCHAR,
  reg_no        VARCHAR,
  role          VARCHAR,        -- 'student' | 'lecturer' | 'admin'
  phone         VARCHAR,
  pc_asset      VARCHAR,        -- PC number assigned to student
  charger_asset VARCHAR,
  headset_asset VARCHAR,
  qr_token      VARCHAR
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
  status     VARCHAR    -- 'P' = Present, 'O' = Absent
)

kit_sessions (
  id          SERIAL PRIMARY KEY,
  label       VARCHAR,
  lecturer_id INTEGER REFERENCES users(id),
  started_at  TIMESTAMP,
  closed_at   TIMESTAMP   -- NULL means still open
)

checkouts (
  id             SERIAL PRIMARY KEY,
  kit_session_id INTEGER REFERENCES kit_sessions(id),
  student_id     INTEGER REFERENCES users(id),
  checked_out_at TIMESTAMP,
  returned_at    TIMESTAMP   -- NULL means NOT yet returned
)

loans (
  id             SERIAL PRIMARY KEY,
  kit_session_id INTEGER REFERENCES kit_sessions(id),
  owner_id       INTEGER REFERENCES users(id),
  borrower_id    INTEGER REFERENCES users(id),
  item_type      VARCHAR,
  pc_number      VARCHAR,
  borrower_name  VARCHAR,
  loaned_at      TIMESTAMP,
  returned_at    TIMESTAMP   -- NULL means still on loan
)

TODAY = CURRENT_DATE (Uganda time UTC+3)

RULES:
- ONLY generate SELECT statements. NEVER INSERT, UPDATE, DELETE, DROP, ALTER.
- Return ONLY the raw SQL. No explanation. No markdown. No backticks. No semicolons.
- Use ILIKE for name searches (case-insensitive).
- Limit to 50 rows unless user asks for all.
- For "today" use CURRENT_DATE.
- For "this week" use date_trunc('week', CURRENT_DATE).
- For "this month" use date_trunc('month', CURRENT_DATE).
- For "absent" filter status = 'O', for "present" filter status = 'P'.
- For "not returned" filter returned_at IS NULL.
`;

async function generateSQL(question) {
  const prompt = `${DB_SCHEMA}\n\nUser question: ${question}\n\nSQL query:`;
  const result = await model.generateContent(prompt);
  const sql    = result.response.text().trim().replace(/```sql|```/gi, "").trim();

  if (!/^\s*SELECT/i.test(sql)) {
    throw new Error("Non-SELECT query blocked for safety");
  }
  return sql;
}

async function formatAnswer(question, rows) {
  if (!rows || rows.length === 0) {
    return "✅ No records found for that query.";
  }

  const prompt = `
You are a friendly WhatsApp assistant for FCA AttendancePulse, a school system in Uganda.
The user asked: "${question}"
The database returned ${rows.length} row(s):
${JSON.stringify(rows.slice(0, 30), null, 2)}

Format a clear WhatsApp reply:
- Use emoji where helpful (✅ ❌ 📋 👤 💻 📅)
- Use *asterisks* for bold (WhatsApp style)
- List items with a dash or number
- If more than 10 results, show first 10 and say "showing 10 of ${rows.length}"
- End with a short summary stat if useful
- Keep under 1500 characters
- Reply directly, do not say "Based on the data"
`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

module.exports = { generateSQL, formatAnswer };