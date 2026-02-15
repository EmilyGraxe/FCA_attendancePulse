const router = require("express").Router();
const db = require("../config/db");
const auth = require("../middleware/auth");
const role = require("../middleware/role");


router.post("/start", auth, role("lecturer"), async (req, res) => {
  const today = new Date().toLocaleDateString("en-CA");

  try {
    // Check active session today
    const sessionQuery = await db.query(
      "SELECT * FROM sessions WHERE lecturer_id=$1 AND active=true AND session_date=$2",
      [req.user.id, today]
    );

    if (sessionQuery.rows.length) {
      return res.status(400).json({
        message: "A session is already in progress."
      });
    }

    // Create new session
    const newSession = await db.query(
      "INSERT INTO sessions (session_date, start_time, lecturer_id, active) VALUES ($1, $2, $3, true) RETURNING *",
      [today, new Date(), req.user.id]
    );

    res.json({
      message: "Session started successfully",
      sessionId: newSession.rows[0].id,
      startTime: newSession.rows[0].start_time
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error starting session" });
  }
});

router.post("/close", auth, role("lecturer"), async (req, res) => {
  const today = new Date().toLocaleDateString("en-CA");

  try {
    const session = await db.query(
      "SELECT * FROM sessions WHERE active=true AND lecturer_id=$1 AND session_date=$2",
      [req.user.id, today]
    );

    if (!session.rows.length)
      return res.status(400).json({ message: "No active session" });

    const sessionId = session.rows[0].id;

    // Close session
    await db.query(
      "UPDATE sessions SET active=false, end_time=$1 WHERE id=$2",
      [new Date(), sessionId]
    );

    // Insert O only for students never P today
    await db.query(`
      INSERT INTO attendance (session_id, student_id, status)
      SELECT $1, u.id, 'O'
      FROM users u
      WHERE u.role = 'student'
      AND u.id NOT IN (
        SELECT student_id FROM attendance WHERE session_id = $1
      )
      AND u.id NOT IN (
        SELECT a.student_id
        FROM attendance a
        JOIN sessions s ON s.id = a.session_id
        WHERE s.session_date = $2
        AND a.status = 'P'
      )
    `, [sessionId, today]);

    res.json({ message: "Session closed" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error closing session" });
  }
});
module.exports = router;