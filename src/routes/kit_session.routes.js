const router = require("express").Router();
const db = require("../config/db");
const auth = require("../middleware/auth");
const role = require("../middleware/role");

// GET /kit-sessions — list (page render)
router.get("/", (req, res) => {
  res.render("kit_sessions.ejs");
});

router.get(
  "/api/list",
  auth,
  role(["lecturer", "admin"]),
  async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT
           ks.*,
           COUNT(DISTINCT c.student_id)
             FILTER (WHERE c.id IS NOT NULL) AS scanned,
           COUNT(DISTINCT c.student_id)
             FILTER (WHERE c.returned_at IS NOT NULL) AS returned
         FROM kit_sessions ks
         LEFT JOIN checkouts c
           ON c.kit_session_id = ks.id
         WHERE ks.lecturer_id = $1
            OR ks.lecturer_id IS NULL
         GROUP BY ks.id
         ORDER BY ks.started_at DESC
         LIMIT 40`,
        [req.user.id]
      );

      res.json(rows);
    } catch (err) {
      next(err);
    }
  }
);

// POST /kit-sessions/start
// router.post("/start", auth, role(["lecturer", "admin"]), async (req, res, next) => {
//   try {
//     const active = await db.query(
//       `SELECT * FROM kit_sessions WHERE closed_at IS NULL`,
//     );
//     if (active.rows.length) {
//       return res.status(400).json({
//         message: `A kit session is already in progress ("${active.rows[0].label}"). Close it first.`,
//       });
//     }

//     const label =
//       (req.body.label || "").trim() ||
//       `Kit Session — ${new Date().toLocaleString("en-GB", {
//         dateStyle: "short",
//         timeStyle: "short",
//       })}`;

//     const result = await db.query(
//       `INSERT INTO kit_sessions (label, lecturer_id) VALUES ($1, $2) RETURNING *`,
//       [label, req.user.id],
//     );

//     res.json({ message: "Kit session started", sessionId: result.rows[0].id });
//   } catch (err) {
//     next(err);
//   }
// });
// router.post("/start", auth, role(["lecturer", "admin"]), async (req, res, next) => {
//   try {
//   const active = await db.query(
//     `SELECT * FROM kit_sessions WHERE closed_at IS NULL`,
//   );

//   if (active.rows.length) {
//     return res.status(400).json({
//       message: `A kit session is already in progress ("${active.rows[0].label}"). Close it first.`,
//     });
//   }

//   const label =
//     (req.body.label || "").trim() ||
//     `Kit Session — ${new Date().toLocaleString("en-GB", {
//       dateStyle: "short",
//       timeStyle: "short",
//     })}`;

//   // 🟢 1. CREATE KIT SESSION (UNCHANGED)
//   const result = await db.query(
//     `INSERT INTO kit_sessions (label, lecturer_id)
//      VALUES ($1, $2)
//      RETURNING *`,
//     [label, req.user.id],
//   );

//   const kitSession = result.rows[0];

//   // 🟡 2. ADD OPTIONAL ATTENDANCE SESSION (NEW - SAFE ADDITION)
//   if (req.body.enable_attendance) {
//     await db.query(
//       `INSERT INTO sessions (label, active, lecturer_id, session_date, kit_session_id)
//        VALUES ($1, true, $2, CURRENT_DATE, $3)`,
//       [label, req.user.id, kitSession.id],
//     );
    
//   }

//   res.json({
//     message: "Kit session started",
//     sessionId: kitSession.id,
//   });

// } catch (err) {
//   next(err);
// }
// });


// POST /kit-sessions/:id/close
// router.post("/:id/close", auth, role(["lecturer", "admin"]), async (req, res, next) => {
//   try {
//     await db.query(`UPDATE kit_sessions SET closed_at = NOW() WHERE id = $1`, [
//       req.params.id,
//     ]);
//     res.json({ message: "Kit session closed" });
//   } catch (err) {
//     next(err);
//   }
// });



// GET /kit-sessions
// router.get("/", auth, role(["lecturer", "admin"]), async (req, res, next) => {
//   try {
//     const { rows: sessions } = await db.query(
//       `SELECT
//          ks.*,
//          (ks.closed_at IS NULL) AS active,
//          COUNT(DISTINCT c.student_id) FILTER (WHERE c.id IS NOT NULL)          AS scanned,
//          COUNT(DISTINCT c.student_id) FILTER (WHERE c.returned_at IS NOT NULL) AS returned
//        FROM kit_sessions ks
//        LEFT JOIN checkouts c ON c.kit_session_id = ks.id
//        WHERE ks.lecturer_id = $1 OR ks.lecturer_id IS NULL
//        GROUP BY ks.id
//        ORDER BY ks.started_at DESC
//        LIMIT 40`,
//       [req.user.id],
//     );
//     res.render("kit_sessions.ejs", { sessions });
//   } catch (err) {
//     next(err);
//   }
// });

// POST /kit-sessions/start
router.post("/start", auth, role(["lecturer", "admin"]), async (req, res, next) => {
  try {
    const active = await db.query(`SELECT * FROM kit_sessions WHERE closed_at IS NULL`);
    if (active.rows.length) {
      return res.status(400).json({
        message: `A kit session is already in progress ("${active.rows[0].label}"). Close it first.`,
      });
    }

    const label =
      (req.body.label || "").trim() ||
      `Kit Session — ${new Date().toLocaleString("en-GB", {
        dateStyle: "short",
        timeStyle: "short",
      })}`;

    const result = await db.query(
      `INSERT INTO kit_sessions (label, lecturer_id) VALUES ($1, $2) RETURNING *`,
      [label, req.user.id],
    );

    res.json({ message: "Kit session started", sessionId: result.rows[0].id });
  } catch (err) {
    next(err);
  }
});

// POST /kit-sessions/:id/close
// Closes the kit session AND any paired attendance session it spawned,
// marking remaining students Absent in that attendance session.
router.post("/:id/close", auth, role(["lecturer", "admin"]), async (req, res, next) => {
  try {
    const kitId = req.params.id;

    // 1. Close the kit session
    await db.query(
      `UPDATE kit_sessions SET closed_at = NOW() WHERE id = $1 AND closed_at IS NULL`,
      [kitId],
    );

    // 2. Auto-return any still-open PC shares for this kit session
    await db.query(
      `UPDATE pc_shares SET returned_at = NOW()
       WHERE kit_session_id = $1 AND returned_at IS NULL`,
      [kitId],
    );

    // 3. Find any linked attendance session(s)
    const linked = await db.query(
      `SELECT id, label FROM sessions
       WHERE kit_session_id = $1 AND active = true`,
      [kitId],
    );

    let attendance_closed = 0;
    let marked_absent = 0;
    for (const att of linked.rows) {
      await db.query(
        `UPDATE sessions SET active = false, end_time = NOW() WHERE id = $1`,
        [att.id],
      );
      const r = await db.query(
        `INSERT INTO attendance (session_id, student_id, status)
         SELECT $1, u.id, 'A'
         FROM users u
         WHERE u.role = 'student'
           AND u.id NOT IN (SELECT student_id FROM attendance WHERE session_id = $1)
         ON CONFLICT (session_id, student_id) DO NOTHING
         RETURNING student_id`,
        [att.id],
      );
      attendance_closed++;
      marked_absent += r.rowCount;
    }

    res.json({
      message:
        `Kit session closed.` +
        (attendance_closed
          ? ` Paired attendance session closed; ${marked_absent} student(s) marked Absent.`
          : ""),
      attendance_closed,
      marked_absent,
    });
  } catch (err) {
    next(err);
  }
});



module.exports = router;
