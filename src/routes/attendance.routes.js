const router = require("express").Router();
const db = require("../config/db");
const auth = require("../middleware/auth");

router.post("/scan", auth, async (req, res) => {
  try {
    const qr_token = (req.body.qr_token || "").trim();
    if (!qr_token) return res.status(400).json({ message: "No QR token provided" });

    const today = new Date().toLocaleDateString("en-CA");
    const sessionRes = await db.query(
      "SELECT * FROM sessions WHERE active=true AND lecturer_id=$1 AND session_date=$2",
      [req.user.id, today],
    );

    if (!sessionRes.rows.length)
      return res.status(400).json({ message: "No active session today" });

    const session = sessionRes.rows[0];

    const studentRes = await db.query(
      "SELECT * FROM users WHERE qr_token = $1 AND role = 'student'",
      [qr_token],
    );
    if (!studentRes.rows.length)
      return res.status(400).json({ message: "Invalid card, please try again" });

    const student = studentRes.rows[0];

    await db.query(
      `INSERT INTO attendance (session_id, student_id, status)
       VALUES ($1, $2, 'P')
       ON CONFLICT (session_id, student_id) DO UPDATE SET status = 'P'`,
      [session.id, student.id],
    );

    res.json({ message: `${student.name} marked Present` });
  } catch (err) {
    console.error("Error in /scan:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
