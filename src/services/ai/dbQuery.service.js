/**
 * dbQuery.service.js — All safe DB reads the AI subsystem needs.
 * Uses the existing pg pool at src/config/db.js. Does NOT change schema.
 *
 * Optional table (see migrations/001_user_whatsapp.sql):
 *   user_whatsapp(phone TEXT PRIMARY KEY, user_id INT REFERENCES users(id))
 * If missing, findUserByPhone() returns null and the bot works anonymously.
 */
const db = require("../../config/db");
const cache = require("./cache.service");

async function _safeQuery(sql, params = [], ttl = 15000) {
  const key = `q:${sql}::${JSON.stringify(params)}`;
  return cache.wrap(key, ttl, async () => {
    const r = await db.query(sql, params);
    return r.rows;
  });
}

// ── Identity ────────────────────────────────────────────
async function findUserByPhone(phone) {
  if (!phone) return null;
  try {
    const rows = await _safeQuery(
      `SELECT u.* FROM user_whatsapp uw
       JOIN users u ON u.id = uw.user_id
       WHERE uw.phone = $1 LIMIT 1`,
      [String(phone).replace(/^\+/, "")],
      60000
    );
    return rows[0] || null;
  } catch { return null; /* table may not exist */ }
}
async function findUserById(id) {
  const rows = await _safeQuery(`SELECT * FROM users WHERE id = $1`, [id], 30000);
  return rows[0] || null;
}
async function findUserByName(name) {
  if (!name) return [];
  return _safeQuery(
    `SELECT id, name, reg_no, role, pc_asset FROM users
     WHERE name ILIKE $1 ORDER BY name LIMIT 10`,
    [`%${name}%`], 15000
  );
}

// ── Attendance ─────────────────────────────────────────
async function attendanceForUser(userId, { period } = {}) {
  const where = ["a.student_id = $1"];
  const params = [userId];
  if (period === "today")    where.push("s.session_date = CURRENT_DATE");
  if (period === "week")     where.push("s.session_date >= date_trunc('week', CURRENT_DATE)");
  if (period === "month")    where.push("s.session_date >= date_trunc('month', CURRENT_DATE)");
  if (period === "yesterday") where.push("s.session_date = CURRENT_DATE - INTERVAL '1 day'");
  return _safeQuery(
    `SELECT a.id, a.status, s.session_date, s.label, u.name AS lecturer
       FROM attendance a
       JOIN sessions s ON s.id = a.session_id
       LEFT JOIN users u ON u.id = s.lecturer_id
      WHERE ${where.join(" AND ")}
      ORDER BY s.session_date DESC LIMIT 100`,
    params, 10000
  );
}
async function attendanceCounts(userId) {
  const rows = await _safeQuery(
    `SELECT
        COUNT(*)                              AS total,
        COUNT(*) FILTER (WHERE status='P')    AS present,
        COUNT(*) FILTER (WHERE status='O')    AS absent
       FROM attendance WHERE student_id = $1`,
    [userId], 10000
  );
  return rows[0] || { total: 0, present: 0, absent: 0 };
}
async function attendanceTodayFor(userId) {
  const rows = await _safeQuery(
    `SELECT a.status, s.label, s.session_date
       FROM attendance a JOIN sessions s ON s.id = a.session_id
      WHERE a.student_id = $1 AND s.session_date = CURRENT_DATE
      ORDER BY s.start_time DESC LIMIT 5`,
    [userId], 5000
  );
  return rows;
}
async function missedSessions(userId, limit = 20) {
  return _safeQuery(
    `SELECT s.session_date, s.label, u.name AS lecturer
       FROM attendance a
       JOIN sessions s ON s.id = a.session_id
       LEFT JOIN users u ON u.id = s.lecturer_id
      WHERE a.student_id = $1 AND a.status = 'O'
      ORDER BY s.session_date DESC LIMIT ${limit}`,
    [userId], 10000
  );
}

// ── Kit ────────────────────────────────────────────────
async function myKit(userId) {
  const rows = await _safeQuery(
    `SELECT pc_asset, charger_asset, headset_asset FROM users WHERE id=$1`,
    [userId], 30000
  );
  return rows[0] || null;
}
async function pcHolder(pcNumber) {
  return _safeQuery(
    `SELECT l.pc_number, l.borrower_name, l.loaned_at, l.returned_at, u.name AS owner
       FROM loans l LEFT JOIN users u ON u.id = l.owner_id
      WHERE l.pc_number ILIKE $1
      ORDER BY l.loaned_at DESC LIMIT 5`,
    [`%${pcNumber}%`], 5000
  );
}
async function unreturnedLoans() {
  return _safeQuery(
    `SELECT l.pc_number, l.borrower_name, l.loaned_at, u.name AS owner
       FROM loans l LEFT JOIN users u ON u.id = l.owner_id
      WHERE l.returned_at IS NULL
      ORDER BY l.loaned_at ASC LIMIT 50`, [], 10000
  );
}
async function unreturnedCheckoutsForUser(userId) {
  return _safeQuery(
    `SELECT c.checked_out_at, ks.label
       FROM checkouts c JOIN kit_sessions ks ON ks.id = c.kit_session_id
      WHERE c.student_id = $1 AND c.returned_at IS NULL
      ORDER BY c.checked_out_at DESC`,
    [userId], 10000
  );
}

// ── Sessions ───────────────────────────────────────────
async function currentActiveSession() {
  const rows = await _safeQuery(
    `SELECT s.id, s.label, s.session_date, s.start_time, u.name AS lecturer
       FROM sessions s LEFT JOIN users u ON u.id = s.lecturer_id
      WHERE s.active = true ORDER BY s.start_time DESC LIMIT 5`, [], 5000
  );
  return rows;
}
async function todaySessions() {
  return _safeQuery(
    `SELECT s.id, s.label, s.start_time, s.end_time, u.name AS lecturer
       FROM sessions s LEFT JOIN users u ON u.id = s.lecturer_id
      WHERE s.session_date = CURRENT_DATE
      ORDER BY s.start_time`, [], 15000
  );
}

// ── Lecturer / admin aggregates ────────────────────────
async function absentToday(lecturerId = null) {
  const params = [];
  let filter = "";
  if (lecturerId) { params.push(lecturerId); filter = ` AND s.lecturer_id = $${params.length}`; }
  return _safeQuery(
    `SELECT u.name, u.reg_no, s.label
       FROM attendance a
       JOIN sessions s ON s.id = a.session_id
       JOIN users u ON u.id = a.student_id
      WHERE s.session_date = CURRENT_DATE AND a.status='O' ${filter}
      ORDER BY u.name LIMIT 100`, params, 5000
  );
}
async function mostAbsent(limit = 10) {
  return _safeQuery(
    `SELECT u.name, u.reg_no,
            COUNT(*) FILTER (WHERE a.status='O') AS absences,
            COUNT(*)                              AS sessions
       FROM users u
       JOIN attendance a ON a.student_id = u.id
      WHERE u.role='student'
      GROUP BY u.id ORDER BY absences DESC LIMIT ${limit}`, [], 30000
  );
}
async function mostPresent(limit = 10) {
  return _safeQuery(
    `SELECT u.name, u.reg_no,
            COUNT(*) FILTER (WHERE a.status='P') AS present,
            COUNT(*)                              AS sessions
       FROM users u JOIN attendance a ON a.student_id = u.id
      WHERE u.role='student'
      GROUP BY u.id ORDER BY present DESC LIMIT ${limit}`, [], 30000
  );
}
async function institutionStats() {
  const [students, lecturers, sessions, attendance, loansOpen] = await Promise.all([
    _safeQuery(`SELECT COUNT(*) AS n FROM users WHERE role='student'`, [], 60000),
    _safeQuery(`SELECT COUNT(*) AS n FROM users WHERE role='lecturer'`, [], 60000),
    _safeQuery(`SELECT COUNT(*) AS n FROM sessions`, [], 60000),
    _safeQuery(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='P') AS present FROM attendance`, [], 60000),
    _safeQuery(`SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL`, [], 60000),
  ]);
  return {
    students:  Number(students[0].n),
    lecturers: Number(lecturers[0].n),
    sessions:  Number(sessions[0].n),
    attendanceTotal:   Number(attendance[0].total),
    attendancePresent: Number(attendance[0].present),
    openLoans: Number(loansOpen[0].n),
  };
}
async function equipmentIssuedToday() {
  return _safeQuery(
    `SELECT l.item_type, l.pc_number, l.borrower_name, u.name AS owner, l.loaned_at
       FROM loans l LEFT JOIN users u ON u.id = l.owner_id
      WHERE l.loaned_at::date = CURRENT_DATE
      ORDER BY l.loaned_at DESC LIMIT 100`, [], 5000
  );
}
async function mostBorrowedPCs(limit = 10) {
  return _safeQuery(
    `SELECT pc_number, COUNT(*) AS times
       FROM loans WHERE pc_number IS NOT NULL
      GROUP BY pc_number ORDER BY times DESC LIMIT ${limit}`, [], 60000
  );
}
async function attendanceByDay(days = 30) {
  return _safeQuery(
    `SELECT s.session_date::date AS day,
            COUNT(*)                              AS total,
            COUNT(*) FILTER (WHERE a.status='P') AS present
       FROM sessions s LEFT JOIN attendance a ON a.session_id = s.id
      WHERE s.session_date >= CURRENT_DATE - INTERVAL '${Number(days)} days'
      GROUP BY day ORDER BY day`, [], 60000
  );
}

module.exports = {
  findUserByPhone, findUserById, findUserByName,
  attendanceForUser, attendanceCounts, attendanceTodayFor, missedSessions,
  myKit, pcHolder, unreturnedLoans, unreturnedCheckoutsForUser,
  currentActiveSession, todaySessions,
  absentToday, mostAbsent, mostPresent, institutionStats,
  equipmentIssuedToday, mostBorrowedPCs, attendanceByDay,
};
