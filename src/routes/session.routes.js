const router = require("express").Router();
const db = require("../config/db");
const auth = require("../middleware/auth");
const role = require("../middleware/role");

router.post("/start", auth, role(["lecturer", "admin"]), async (req, res) => {
  const today = new Date().toLocaleDateString("en-CA");
  try {
    const sessionQuery = await db.query(
      "SELECT * FROM sessions WHERE lecturer_id=$1 AND active=true AND session_date=$2",
      [req.user.id, today],
    );
    if (sessionQuery.rows.length)
      return res.status(400).json({ message: "A session is already in progress." });

    const label =
      (req.body.label || "").trim() ||
      `Attendance — ${new Date().toLocaleString("en-GB", {
        dateStyle: "short",
        timeStyle: "short",
      })}`;

    const newSession = await db.query(
      `INSERT INTO sessions (session_date, start_time, lecturer_id, active, label)
       VALUES ($1, $2, $3, true, $4) RETURNING *`,
      [today, new Date(), req.user.id, label],
    );
    res.json({
      message: "Session started: " + label,
      sessionId: newSession.rows[0].id,
      startTime: newSession.rows[0].start_time,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error starting session" });
  }
});

router.post("/close", auth, role(["lecturer", "admin"]), async (req, res) => {
  const today = new Date().toLocaleDateString("en-CA");
  try {
    const session = await db.query(
      "SELECT * FROM sessions WHERE active=true AND lecturer_id=$1 AND session_date=$2",
      [req.user.id, today],
    );
    if (!session.rows.length)
      return res.status(400).json({ message: "No active session" });

    const sessionId = session.rows[0].id;
    await db.query("UPDATE sessions SET active=false, end_time=$1 WHERE id=$2", [
      new Date(),
      sessionId,
    ]);

    // Mark every student not already marked Present as Absent ('A')
    const result = await db.query(
      `INSERT INTO attendance (session_id, student_id, status)
       SELECT $1, u.id, 'A'
       FROM users u
       WHERE u.role = 'student'
         AND u.id NOT IN (SELECT student_id FROM attendance WHERE session_id = $1)
       ON CONFLICT (session_id, student_id) DO NOTHING
       RETURNING student_id`,
      [sessionId],
    );

    res.json({ message: `Session closed. ${result.rowCount} student(s) marked Absent.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error closing session" });
  }
});

module.exports = router;
