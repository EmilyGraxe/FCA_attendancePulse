/**
 * rules.service.js — Rule engine. Maps intent -> deterministic handler.
 * Handlers may query the DB and use formulas, but must NEVER call Gemini.
 * Returns { text } to send, or null to escalate to Gemini.
 *
 * ctx = { user, phone, entities, memory }
 *   user   : row from users table (may be null for anonymous WhatsApp)
 *   phone  : normalized phone (WhatsApp) or null (in-app)
 *   entities: extracted from intent classifier
 */
const dbq = require("./dbQuery.service");
const F   = require("./formulas.service");
const KB  = require("./knowledgeBase.service");

function needIdentity(user) {
  if (user) return null;
  return {
    text:
      "🙈 I don't know who you are yet.\n" +
      "Please link your WhatsApp: reply *LINK <your reg no>* " +
      "(e.g. LINK FCA_DICE_2025-12), or sign in on the web app.",
  };
}

const HANDLERS = {
  greeting: async ({ user }) => ({
    text: `👋 Hi${user?.name ? " " + user.name.split(" ")[0] : ""}! Ask me about your attendance, PC, or type *help* for options.`,
  }),
  thanks:  async () => ({ text: "🙌 Anytime! Type *help* if you need more." }),
  bye:     async () => ({ text: "👋 Bye! Type *hi* whenever you need me." }),
  help:    async ({ role }) => ({ text: helpFor(role) }),
  clear_memory: async () => ({ text: "🧹 Memory cleared.", _clear: true }),

  who_am_i: async ({ user }) => {
    const gate = needIdentity(user); if (gate) return gate;
    return { text:
      `👤 *Your profile*\n` +
      `• Name: ${user.name}\n` +
      `• Reg no: ${user.reg_no || "—"}\n` +
      `• Student no: ${user.student_no || "—"}\n` +
      `• Role: ${user.role}\n` +
      `• PC: ${user.pc_asset || "—"}` };
  },
  reg_no:      async ({ user }) => needIdentity(user) || { text: `🆔 Reg no: *${user.reg_no || "not set"}*` },
  student_no:  async ({ user }) => needIdentity(user) || { text: `🆔 Student no: *${user.student_no || "not set"}*` },

  // ── Attendance ─────────────────────────
  attendance_today: async ({ user }) => {
    const gate = needIdentity(user); if (gate) return gate;
    const rows = await dbq.attendanceTodayFor(user.id);
    if (!rows.length) return { text: "📅 No session recorded for you today yet." };
    const lines = rows.map((r) => `• ${r.label || "Session"} — ${r.status === "P" ? "✅ Present" : "❌ Absent"}`);
    return { text: `📅 *Today's attendance*\n${lines.join("\n")}` };
  },
  attendance_summary: async ({ user }) => {
    const gate = needIdentity(user); if (gate) return gate;
    const c = await dbq.attendanceCounts(user.id);
    return { text:
      `📊 *Your attendance*\n` +
      `• Present: ${c.present}\n` +
      `• Absent: ${c.absent}\n` +
      `• Total sessions: ${c.total}\n` +
      `• Rate: *${F.attendancePercent({ present: c.present, total: c.total })}%*` };
  },
  attendance_percent: async ({ user }) => {
    const gate = needIdentity(user); if (gate) return gate;
    const c = await dbq.attendanceCounts(user.id);
    return { text: `📈 Attendance: *${F.attendancePercent({ present: c.present, total: c.total })}%* (${c.present}/${c.total})` };
  },
  attendance_absences: async ({ user }) => {
    const gate = needIdentity(user); if (gate) return gate;
    const missed = await dbq.missedSessions(user.id, 10);
    if (!missed.length) return { text: "🎉 No absences on record — great job!" };
    const lines = missed.map((m) => `• ${new Date(m.session_date).toISOString().slice(0,10)} — ${m.label || "Session"}`);
    return { text: `❌ *Missed sessions* (${missed.length})\n${lines.join("\n")}` };
  },
  attendance_month: async ({ user }) => {
    const gate = needIdentity(user); if (gate) return gate;
    const rows = await dbq.attendanceForUser(user.id, { period: "month" });
    const present = rows.filter((r) => r.status === "P").length;
    return { text: `🗓️ *This month*: ${present}/${rows.length} sessions (${F.pct(present, rows.length)}%)` };
  },
  attendance_week: async ({ user }) => {
    const gate = needIdentity(user); if (gate) return gate;
    const rows = await dbq.attendanceForUser(user.id, { period: "week" });
    const present = rows.filter((r) => r.status === "P").length;
    return { text: `📆 *This week*: ${present}/${rows.length} sessions (${F.pct(present, rows.length)}%)` };
  },
  attendance_trend: async ({ user }) => {
    const gate = needIdentity(user); if (gate) return gate;
    const rows = await dbq.attendanceForUser(user.id, {});
    if (rows.length < 2) return { text: "📉 Not enough data for a trend yet." };
    const days = {};
    for (const r of rows) {
      const k = new Date(r.session_date).toISOString().slice(0,10);
      days[k] = days[k] || { day: k, present: 0, total: 0 };
      days[k].total += 1;
      if (r.status === "P") days[k].present += 1;
    }
    const arr = Object.values(days).sort((a,b) => a.day.localeCompare(b.day));
    const t = F.trend(arr);
    const arrow = t.direction === "up" ? "📈" : t.direction === "down" ? "📉" : "➖";
    return { text: `${arrow} Trend: *${t.direction}* (${t.change > 0 ? "+" : ""}${t.change} pts). Avg: ${F.averageAttendance(arr)}%` };
  },
  attendance_last: async ({ user }) => {
    const gate = needIdentity(user); if (gate) return gate;
    const rows = await dbq.attendanceForUser(user.id, {});
    const last = rows.find((r) => r.status === "P");
    return { text: last
      ? `🕒 Last present: ${new Date(last.session_date).toISOString().slice(0,10)} — ${last.label || "Session"}`
      : "No present sessions on record yet." };
  },

  // ── Kit ────────────────────────────────
  my_pc:      async ({ user }) => needIdentity(user) || { text: `💻 Your PC: *${user.pc_asset || "not assigned"}*` },
  my_charger: async ({ user }) => needIdentity(user) || { text: `🔌 Your charger: *${user.charger_asset || "not assigned"}*` },
  my_headset: async ({ user }) => needIdentity(user) || { text: `🎧 Your headset: *${user.headset_asset || "not assigned"}*` },
  my_kit: async ({ user }) => {
    const gate = needIdentity(user); if (gate) return gate;
    return { text:
      `🎒 *Your kit*\n` +
      `• PC: ${user.pc_asset || "—"}\n` +
      `• Charger: ${user.charger_asset || "—"}\n` +
      `• Headset: ${user.headset_asset || "—"}` };
  },
  pc_returned: async ({ user, entities }) => {
    const gate = needIdentity(user); if (gate) return gate;
    const open = await dbq.unreturnedCheckoutsForUser(user.id);
    if (!open.length) return { text: "✅ All your kit is returned." };
    const lines = open.map((c) => `• ${c.label || "Session"} — checked out ${new Date(c.checked_out_at).toISOString().slice(0,10)}`);
    return { text: `⚠️ *Not returned yet* (${open.length})\n${lines.join("\n")}` };
  },
  pc_owner: async ({ entities }) => {
    if (!entities.pcNumber) return null;
    const rows = await dbq.pcHolder(entities.pcNumber);
    if (!rows.length) return { text: `🔍 No records for PC ${entities.pcNumber}.` };
    const latest = rows[0];
    const state = latest.returned_at ? "✅ returned" : "⏳ still out";
    return { text:
      `💻 *PC ${latest.pc_number}*\n` +
      `• Owner: ${latest.owner || "—"}\n` +
      `• Borrower: ${latest.borrower_name || "—"}\n` +
      `• Status: ${state}` };
  },
  unreturned_pcs: async () => {
    const rows = await dbq.unreturnedLoans();
    if (!rows.length) return { text: "🎉 No outstanding PCs — everything returned." };
    const shown = rows.slice(0, 15);
    const lines = shown.map((r) => `• PC ${r.pc_number} — ${r.borrower_name || "?"} (owner: ${r.owner || "—"})`);
    return { text: `📋 *Unreturned PCs* (${rows.length})\n${lines.join("\n")}${rows.length > 15 ? `\n… showing first 15 of ${rows.length}` : ""}` };
  },

  // ── Lecturer / admin ───────────────────
  current_session: async () => {
    const rows = await dbq.currentActiveSession();
    if (!rows.length) return { text: "📴 No active session right now." };
    const lines = rows.map((s) => `• ${s.label || "Session"} — ${s.lecturer || "—"} (started ${new Date(s.start_time).toLocaleTimeString()})`);
    return { text: `🟢 *Active sessions*\n${lines.join("\n")}` };
  },
  today_sessions: async () => {
    const rows = await dbq.todaySessions();
    if (!rows.length) return { text: "📅 No sessions scheduled today." };
    const lines = rows.map((s) => `• ${s.label || "Session"} — ${s.lecturer || "—"} ${s.start_time ? "@ " + new Date(s.start_time).toLocaleTimeString() : ""}`);
    return { text: `📅 *Today's sessions*\n${lines.join("\n")}` };
  },
  absent_today: async ({ user }) => {
    const lecturerId = user?.role === "lecturer" ? user.id : null;
    const rows = await dbq.absentToday(lecturerId);
    if (!rows.length) return { text: "🎉 Nobody absent today." };
    const lines = rows.slice(0, 20).map((r) => `• ${r.name} (${r.reg_no || "—"})`);
    return { text: `❌ *Absent today* (${rows.length})\n${lines.join("\n")}${rows.length > 20 ? `\n… first 20 of ${rows.length}` : ""}` };
  },
  most_absent: async () => {
    const rows = await dbq.mostAbsent(10);
    if (!rows.length) return { text: "No attendance data yet." };
    const lines = rows.map((r, i) => `${i + 1}. ${r.name} — ${r.absences} absences (${F.pct(r.sessions - r.absences, r.sessions)}%)`);
    return { text: `⚠️ *Most absent students*\n${lines.join("\n")}` };
  },
  most_present: async () => {
    const rows = await dbq.mostPresent(10);
    if (!rows.length) return { text: "No attendance data yet." };
    const lines = rows.map((r, i) => `${i + 1}. ${r.name} — ${r.present}/${r.sessions} (${F.pct(r.present, r.sessions)}%)`);
    return { text: `🏅 *Top attendance*\n${lines.join("\n")}` };
  },
  institution_stats: async () => {
    const s = await dbq.institutionStats();
    return { text:
      `🏫 *Institution overview*\n` +
      `• Students: ${s.students}\n` +
      `• Lecturers: ${s.lecturers}\n` +
      `• Sessions: ${s.sessions}\n` +
      `• Attendance rate: ${F.pct(s.attendancePresent, s.attendanceTotal)}% (${s.attendancePresent}/${s.attendanceTotal})\n` +
      `• Open loans: ${s.openLoans}` };
  },
  equipment_today: async () => {
    const rows = await dbq.equipmentIssuedToday();
    if (!rows.length) return { text: "📦 No equipment issued today." };
    const lines = rows.slice(0, 20).map((r) => `• ${r.item_type} ${r.pc_number || ""} → ${r.borrower_name || "?"} (owner: ${r.owner || "—"})`);
    return { text: `📦 *Issued today* (${rows.length})\n${lines.join("\n")}` };
  },
  most_borrowed_pc: async () => {
    const rows = await dbq.mostBorrowedPCs(10);
    if (!rows.length) return { text: "No loan data yet." };
    const lines = rows.map((r, i) => `${i + 1}. PC ${r.pc_number} — ${r.times} loans`);
    return { text: `🔁 *Most borrowed PCs*\n${lines.join("\n")}` };
  },

  // ── Search ─────────────────────────────
  search_student: async ({ entities }) => {
    if (!entities.name) return null;
    const rows = await dbq.findUserByName(entities.name);
    if (!rows.length) return { text: `🔍 No student matching "${entities.name}".` };
    const lines = rows.slice(0, 10).map((r) => `• ${r.name} — ${r.reg_no || "—"} (${r.role})`);
    return { text: `🔍 *Results*\n${lines.join("\n")}` };
  },
  search_pc: async ({ entities }) => HANDLERS.pc_owner({ entities }),

  // ── KB / FAQ ───────────────────────────
  faq_reset_password: async () => ({ text: KB.get("faq_reset_password") }),
  faq_borrow_pc:      async () => ({ text: KB.get("faq_borrow_pc") }),
  faq_return_pc:      async () => ({ text: KB.get("faq_return_pc") }),
  faq_attendance_works: async () => ({ text: KB.get("faq_attendance_works") }),
  faq_absentee_calc:  async () => ({ text: KB.get("faq_absentee_calc") }),
  faq_contact:        async () => ({ text: KB.get("faq_contact") }),
  faq_lost_equipment: async () => ({ text: KB.get("faq_lost_equipment") }),
};

function helpFor(role) {
  const base = [
    "🤖 *What I can do*",
    "",
    "*Attendance*",
    "• my attendance / attendance percentage",
    "• how many absences / what sessions did i miss",
    "• attendance this month / this week / trend",
    "• did i attend today",
    "",
    "*Kit*",
    "• my pc / my charger / my headset / my kit",
    "• who has pc 12 / is pc 12 returned",
    "• pcs not returned",
    "",
    "*Profile*",
    "• who am i / my reg no / my student no",
    "",
    "*FAQ*",
    "• how do i borrow a pc / return a pc",
    "• how does attendance work / how is absenteeism calculated",
    "• reset password",
    "",
    "Type *clear* to reset memory.",
  ];
  if (role === "lecturer" || role === "admin") {
    base.push(
      "",
      "*For you*",
      "• who is absent today",
      "• current session / today's sessions",
      "• most absent / most present students",
      "• equipment issued today",
      "• institution stats"
    );
  }
  return base.join("\n");
}

async function run(intent, ctx) {
  const handler = HANDLERS[intent];
  if (!handler) return null;
  try {
    return await handler(ctx);
  } catch (err) {
    console.error(`[rules] handler ${intent} failed:`, err.message);
    return { text: "⚠️ I hit a snag reading that from the database. Please try again in a moment." };
  }
}

module.exports = { run, helpFor, HANDLERS };
