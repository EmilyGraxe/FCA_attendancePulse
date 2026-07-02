const router = require("express").Router();
const bcrypt = require("bcrypt");
const db = require("../config/db");
const auth = require("../middleware/auth");

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getActiveKitSession() {
  const r = await db.query(
    `SELECT * FROM kit_sessions WHERE closed_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  );
  return r.rows[0] || null;
}

async function findStudentByQr(qr_token) {
  const r = await db.query(
    `SELECT * FROM users WHERE qr_token = $1 AND role = 'student'`,
    [qr_token],
  );
  return r.rows[0] || null;
}

// Find or auto-create an attendance session bound to this kit session.
// The attendance session inherits the kit session's label so the two are
// clearly paired. Returns the attendance session row, or null if none exists
// and `autoCreate` is false.
async function getOrCreateAttendanceSessionForKit(kit, lecturerId, autoCreate) {
  // Already linked?
  const linked = await db.query(
    `SELECT * FROM sessions
     WHERE kit_session_id = $1 AND active = true
     ORDER BY start_time DESC LIMIT 1`,
    [kit.id],
  );
  if (linked.rows.length) return linked.rows[0];

  if (!autoCreate) return null;

  const today = new Date().toLocaleDateString("en-CA");
  const ins = await db.query(
    `INSERT INTO sessions (session_date, start_time, lecturer_id, active, label, kit_session_id)
     VALUES ($1, NOW(), $2, true, $3, $4)
     RETURNING *`,
    [today, lecturerId || kit.lecturer_id, kit.label, kit.id],
  );
  return ins.rows[0];
}

async function markPresent(sessionId, studentId) {
  await db.query(
    `INSERT INTO attendance (session_id, student_id, status)
     VALUES ($1, $2, 'P')
     ON CONFLICT (session_id, student_id) DO UPDATE SET status = 'P'`,
    [sessionId, studentId],
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

router.get("/", async (req, res, next) => {
  try {
    const session = await getActiveKitSession();
    let openShares = [];
    if (session) {
      const r = await db.query(
        `SELECT ps.*, u.name AS borrower_full, o.name AS owner_full
         FROM pc_shares ps
         LEFT JOIN users u ON u.id = ps.borrower_id
         LEFT JOIN users o ON o.id = ps.owner_id
         WHERE ps.kit_session_id = $1 AND ps.returned_at IS NULL
         ORDER BY ps.started_at DESC`,
        [session.id],
      );
      openShares = r.rows;
    }
    res.render("kit_scan.ejs", { session, openShares });
  } catch (err) {
    next(err);
  }
});

// ─── MODE 1: KIT OUT (asset scan) ────────────────────────────────────────────
// Body: { qr_token }
//
// Kit Out only issues a PC/kit to a student. No attendance is recorded here.
//   - First scan of a student → record a checkout.
//   - If they already have an open checkout → reject (use PC Return).
//   - If they previously returned and scan again → open a new checkout cycle.
//   - If the student has NO assigned kit assets → reject (nothing to issue).
router.post("/kit-out", auth, async (req, res, next) => {
  try {
    const qr_token = (req.body.qr_token || "").trim();
    if (!qr_token) return res.json({ ok: false, error: "Empty scan" });

    const session = await getActiveKitSession();
    if (!session)
      return res.json({ ok: false, error: "No active kit session — start one first." });

    const student = await findStudentByQr(qr_token);
    if (!student) return res.json({ ok: false, error: "QR code not recognised" });

    const hasAsset = !!(student.pc_asset || student.charger_asset || student.headset_asset);
    if (!hasAsset) {
      return res.json({
        ok: false,
        error: `${student.name} has no kit assigned. Nothing to issue.`,
        student: publicStudent(student),
      });
    }

    const existing = await db.query(
      `SELECT * FROM checkouts
       WHERE kit_session_id = $1 AND student_id = $2`,
      [session.id, student.id],
    );
    const checkout = existing.rows[0];

    if (checkout && !checkout.returned_at) {
      return res.json({
        ok: false,
        error: `${student.name} already has kit checked out. Use "PC Return" to bring it back.`,
        student: publicStudent(student),
      });
    }

    if (!checkout) {
      await db.query(
        `INSERT INTO checkouts (kit_session_id, student_id) VALUES ($1, $2)`,
        [session.id, student.id],
      );
    } else {
      await db.query(
        `UPDATE checkouts
         SET returned_at = NULL, checked_out_at = NOW()
         WHERE id = $1`,
        [checkout.id],
      );
    }

    res.json({
      ok: true,
      action: "checkout",
      student: publicStudent(student),
    });
  } catch (err) {
    next(err);
  }
});


// ─── MODE 2: PC SHARE — start ────────────────────────────────────────────────
// Body: { pc_no, borrower_qr_token, authorizer_qr_token?, note? }
// PC owner is resolved automatically from users.pc_asset = pc_no when possible.
router.post("/pc-share", auth, async (req, res, next) => {
  try {
    const pc_no = (req.body.pc_no || "").trim();
    const borrower_qr = (req.body.borrower_qr_token || "").trim();
    const authorizer_qr = (req.body.authorizer_qr_token || "").trim();
    const note = (req.body.note || "").trim() || null;

    if (!pc_no) return res.json({ ok: false, error: "PC number required" });
    if (!borrower_qr) return res.json({ ok: false, error: "Borrower scan required" });

    const session = await getActiveKitSession();
    if (!session) return res.json({ ok: false, error: "No active kit session" });

    const borrower = await findStudentByQr(borrower_qr);
    if (!borrower) return res.json({ ok: false, error: "Borrower card not recognised" });

    // Look up the registered owner of this PC (if any)
    const ownerRes = await db.query(
      `SELECT id, name FROM users
       WHERE LOWER(pc_asset) = LOWER($1) AND role='student' LIMIT 1`,
      [pc_no],
    );
    const owner = ownerRes.rows[0] || null;
    if (owner && owner.id === borrower.id) {
      return res.json({
        ok: false,
        error: `${borrower.name} is the registered owner of ${pc_no}. Use Kit Out instead.`,
      });
    }

    let authorized_by = null;
    if (authorizer_qr) {
      const a = await db.query(`SELECT id FROM users WHERE qr_token = $1`, [authorizer_qr]);
      if (!a.rows.length)
        return res.json({ ok: false, error: "Authorizer card not recognised" });
      authorized_by = a.rows[0].id;
    }

    const dupe = await db.query(
      `SELECT id FROM pc_shares
       WHERE kit_session_id = $1 AND LOWER(pc_no) = LOWER($2) AND returned_at IS NULL`,
      [session.id, pc_no],
    );
    if (dupe.rows.length)
      return res.json({
        ok: false,
        error: `${pc_no} already has an open share. Return it first.`,
      });

    const ins = await db.query(
      `INSERT INTO pc_shares
         (kit_session_id, pc_no, owner_id, borrower_id, borrower_name, authorized_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [session.id, pc_no, owner?.id || null, borrower.id, borrower.name, authorized_by, note],
    );
    const share = ins.rows[0];
    res.json({
      ok: true,
      share: {
        ...share,
        borrower_full: borrower.name,
        owner_full: owner?.name || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Resolve open PC for a scanned student (no password yet) ─────────────────
// Body: { qr_token }
// Looks for, in priority order:
//   1. An open pc_share where this student is the borrower.
//   2. An open checkout of this student's own assigned PC.
// Used by the scanner UI to show a confirmation before prompting for password.
router.post("/pc-return/lookup", auth, async (req, res, next) => {
  try {
    const qr_token = (req.body.qr_token || "").trim();
    if (!qr_token) return res.json({ ok: false, error: "Empty scan" });

    const session = await getActiveKitSession();
    if (!session) return res.json({ ok: false, error: "No active kit session" });

    const student = await findStudentByQr(qr_token);
    if (!student) return res.json({ ok: false, error: "QR code not recognised" });

    // 1) borrowed PC (open share)
    const shareRes = await db.query(
      `SELECT * FROM pc_shares
       WHERE kit_session_id = $1 AND borrower_id = $2 AND returned_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [session.id, student.id],
    );
    if (shareRes.rows.length) {
      const s = shareRes.rows[0];
      return res.json({
        ok: true,
        kind: "share",
        share_id: s.id,
        pc_no: s.pc_no,
        student: publicStudent(student),
      });
    }

    // 2) own kit checkout
    const coRes = await db.query(
      `SELECT * FROM checkouts
       WHERE kit_session_id = $1 AND student_id = $2 AND returned_at IS NULL
       ORDER BY checked_out_at DESC LIMIT 1`,
      [session.id, student.id],
    );
    if (coRes.rows.length) {
      return res.json({
        ok: true,
        kind: "checkout",
        checkout_id: coRes.rows[0].id,
        pc_no: student.pc_asset || null,
        student: publicStudent(student),
      });
    }

    return res.json({
      ok: false,
      error: `${student.name} has no open PC to return.`,
      student: publicStudent(student),
    });
  } catch (err) {
    next(err);
  }
});

// ─── PC Return: one-time password unlock ─────────────────────────────────────
// Body: { password }
// Verifies the password belongs to the logged-in user. The client caches the
// password in memory for the session and sends it silently with each return
// scan via /kit-scan/pc-return/scan.
router.post("/pc-return/unlock", auth, async (req, res, next) => {
  try {
    const password = (req.body.password || "").trim();
    if (!password) return res.json({ ok: false, error: "Password required" });
    const me = await db.query(`SELECT password FROM users WHERE id = $1`, [req.user.id]);
    if (!me.rows.length) return res.json({ ok: false, error: "Account not found" });
    const ok = await bcrypt.compare(password, me.rows[0].password);
    if (!ok) return res.json({ ok: false, error: "Incorrect password" });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── PC Return: scan-driven return (uses cached password) ────────────────────
// Body: { qr_token, password, record_attendance? }
// Combines lookup + return in one call. If the student has no open PC AND
// record_attendance is true, marks attendance only and returns
// kind = 'attendance_only' so the UI can notify the user.
router.post("/pc-return/scan", auth, async (req, res, next) => {
  try {
    const qr_token = (req.body.qr_token || "").trim();
    const password = (req.body.password || "").trim();
    const recordAtt = !!req.body.record_attendance;
    if (!qr_token) return res.json({ ok: false, error: "Empty scan" });
    if (!password) return res.json({ ok: false, error: "Locked — unlock returns first", code: "BAD_PASSWORD" });

    // Verify cached password each call (cheap; bcrypt) — protects against
    // stale tokens or password changes mid-session.
    const me = await db.query(`SELECT password FROM users WHERE id = $1`, [req.user.id]);
    if (!me.rows.length) return res.json({ ok: false, error: "Account not found" });
    const pwOk = await bcrypt.compare(password, me.rows[0].password);
    if (!pwOk) return res.json({ ok: false, error: "Incorrect password", code: "BAD_PASSWORD" });

    const session = await getActiveKitSession();
    if (!session) return res.json({ ok: false, error: "No active kit session" });

    const student = await findStudentByQr(qr_token);
    if (!student) return res.json({ ok: false, error: "QR code not recognised" });

    // 1) open share where this student is borrower
    const shareRes = await db.query(
      `SELECT * FROM pc_shares
       WHERE kit_session_id = $1 AND borrower_id = $2 AND returned_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [session.id, student.id],
    );

    // 2) open checkout
    const coRes = shareRes.rows.length ? { rows: [] } : await db.query(
      `SELECT * FROM checkouts
       WHERE kit_session_id = $1 AND student_id = $2 AND returned_at IS NULL
       ORDER BY checked_out_at DESC LIMIT 1`,
      [session.id, student.id],
    );

    let kind = null, pcNo = null, shareId = null;

    if (shareRes.rows.length) {
      const s = shareRes.rows[0];
      await db.query(`UPDATE pc_shares SET returned_at = NOW() WHERE id = $1`, [s.id]);
      kind = "share"; pcNo = s.pc_no; shareId = s.id;
    } else if (coRes.rows.length) {
      const co = coRes.rows[0];
      await db.query(`UPDATE checkouts SET returned_at = NOW() WHERE id = $1`, [co.id]);
      kind = "checkout"; pcNo = student.pc_asset || null;
    } else if (recordAtt) {
      // No PC to return, but user wants attendance recorded → attendance only
      kind = "attendance_only";
    } else {
      return res.json({
        ok: false,
        error: `${student.name} has no open PC to return.`,
        student: publicStudent(student),
      });
    }

    // Optional / automatic attendance
    let attendance_marked = false;
    let attendance_session_label = null;
    if (recordAtt) {
      const att = await getOrCreateAttendanceSessionForKit(session, req.user.id, true);
      if (att) {
        await markPresent(att.id, student.id);
        attendance_marked = true;
        attendance_session_label = att.label;
      }
    }

    res.json({
      ok: true,
      kind,
      pc_no: pcNo,
      share_id: shareId,
      student: publicStudent(student),
      attendance_marked,
      attendance_session_label,
    });
  } catch (err) { next(err); }
});

// ─── MODE 3: PC RETURN — requires logged-in user's password ──────────────────
// Body: { share_id?, checkout_id?, pc_no?, password, record_attendance? }
// Returns the open share OR closes the open checkout. Optionally marks
// the student present in the paired attendance session.
router.post("/pc-return", auth, async (req, res, next) => {
  try {
    const password = (req.body.password || "").trim();
    if (!password)
      return res.json({ ok: false, error: "Your password is required to confirm a return." });

    // Verify password against the logged-in user
    const me = await db.query(
      `SELECT id, password FROM users WHERE id = $1`,
      [req.user.id],
    );
    if (!me.rows.length) return res.json({ ok: false, error: "Account not found" });
    const ok = await bcrypt.compare(password, me.rows[0].password);
    if (!ok) return res.json({ ok: false, error: "Incorrect password" });

    const session = await getActiveKitSession();
    if (!session) return res.json({ ok: false, error: "No active kit session" });

    const recordAtt = !!req.body.record_attendance;
    let studentId = null;
    let pcNo = null;
    let kind = null;

    // Path A: close an open pc_share
    if (req.body.share_id) {
      const r = await db.query(
        `SELECT * FROM pc_shares WHERE id = $1 AND returned_at IS NULL`,
        [req.body.share_id],
      );
      if (!r.rows.length) return res.json({ ok: false, error: "No open share found" });
      const share = r.rows[0];
      await db.query(`UPDATE pc_shares SET returned_at = NOW() WHERE id = $1`, [share.id]);
      studentId = share.borrower_id;
      pcNo = share.pc_no;
      kind = "share";
    }
    // Path B: close an open checkout
    else if (req.body.checkout_id) {
      const r = await db.query(
        `SELECT c.*, u.pc_asset, u.id AS student_id
         FROM checkouts c JOIN users u ON u.id = c.student_id
         WHERE c.id = $1 AND c.returned_at IS NULL`,
        [req.body.checkout_id],
      );
      if (!r.rows.length) return res.json({ ok: false, error: "No open checkout found" });
      const co = r.rows[0];
      await db.query(`UPDATE checkouts SET returned_at = NOW() WHERE id = $1`, [co.id]);
      studentId = co.student_id;
      pcNo = co.pc_asset;
      kind = "checkout";
    }
    // Path C (legacy): close share by pc_no
    else if (req.body.pc_no) {
      const r = await db.query(
        `SELECT * FROM pc_shares
         WHERE kit_session_id = $1 AND LOWER(pc_no) = LOWER($2) AND returned_at IS NULL
         ORDER BY started_at DESC LIMIT 1`,
        [session.id, (req.body.pc_no || "").trim()],
      );
      if (!r.rows.length) return res.json({ ok: false, error: "No open share found for that PC" });
      const share = r.rows[0];
      await db.query(`UPDATE pc_shares SET returned_at = NOW() WHERE id = $1`, [share.id]);
      studentId = share.borrower_id;
      pcNo = share.pc_no;
      kind = "share";
    } else {
      return res.json({ ok: false, error: "Nothing to return — scan a student first." });
    }

    // Optional attendance
    let attendance_marked = false;
    let attendance_session_label = null;
    if (recordAtt && studentId) {
      const att = await getOrCreateAttendanceSessionForKit(session, req.user.id, true);
      if (att) {
        await markPresent(att.id, studentId);
        attendance_marked = true;
        attendance_session_label = att.label;
      }
    }

    res.json({
      ok: true,
      kind,
      pc_no: pcNo,
      attendance_marked,
      attendance_session_label,
    });
  } catch (err) {
    next(err);
  }
});


// Search PCs (by pc_no in pc_shares OR users.pc_asset) for autocomplete
router.get("/pc-search", auth, async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ ok: true, results: [] });

    const session = await getActiveKitSession();
    const results = [];

    // Open shares matching the query
    if (session) {
      const r = await db.query(
        `SELECT ps.id AS share_id, ps.pc_no, ps.borrower_name,
                u.name AS owner_name
         FROM pc_shares ps
         LEFT JOIN users u ON u.id = ps.owner_id
         WHERE ps.kit_session_id = $1
           AND ps.returned_at IS NULL
           AND LOWER(ps.pc_no) LIKE LOWER($2)
         ORDER BY ps.pc_no LIMIT 10`,
        [session.id, `%${q}%`],
      );
      r.rows.forEach((row) =>
        results.push({
          type: "open_share",
          share_id: row.share_id,
          pc_no: row.pc_no,
          owner: row.owner_name,
          borrower: row.borrower_name,
        }),
      );
    }

    // Registered PCs (users.pc_asset) — match by pc_asset OR assigned student name
    const r2 = await db.query(
      `SELECT id, name, pc_asset FROM users
       WHERE role='student' AND pc_asset IS NOT NULL
         AND (LOWER(pc_asset) LIKE LOWER($1) OR LOWER(name) LIKE LOWER($1))
       ORDER BY pc_asset LIMIT 10`,
      [`%${q}%`],
    );
    r2.rows.forEach((row) =>
      results.push({
        type: "registered_pc",
        pc_no: row.pc_asset,
        owner: row.name,
        owner_id: row.id,
      }),
    );

    res.json({ ok: true, results });
  } catch (err) {
    next(err);
  }
});

// List open + recent shares (still used by polling clients)
router.get("/pc-shares", auth, async (req, res, next) => {
  try {
    const session = await getActiveKitSession();
    if (!session) return res.json({ ok: true, shares: [] });
    const r = await db.query(
      `SELECT ps.*, u.name AS borrower_full, o.name AS owner_full
       FROM pc_shares ps
       LEFT JOIN users u ON u.id = ps.borrower_id
       LEFT JOIN users o ON o.id = ps.owner_id
       WHERE ps.kit_session_id = $1
       ORDER BY (ps.returned_at IS NULL) DESC, ps.started_at DESC`,
      [session.id],
    );
    res.json({ ok: true, shares: r.rows });
  } catch (err) {
    next(err);
  }
});

// ── Cross-student loan endpoints (kept from v2) ──────────────────────────────
router.post("/loan", auth, async (req, res, next) => {
  try {
    const { owner_qr_token, item_type, borrower_name } = req.body;
    const session = await getActiveKitSession();
    if (!session) return res.json({ ok: false, error: "No active kit session" });
    const owner = await findStudentByQr((owner_qr_token || "").trim());
    if (!owner) return res.json({ ok: false, error: "Owner card not found" });
    const exists = await db.query(
      `SELECT id FROM loans
       WHERE owner_id=$1 AND item_type=$2 AND kit_session_id=$3 AND returned_at IS NULL`,
      [owner.id, item_type, session.id],
    );
    if (exists.rows.length)
      return res.json({ ok: false, error: `${owner.name}'s ${item_type} is already on loan.` });
    await db.query(
      `INSERT INTO loans (kit_session_id, owner_id, item_type, borrower_name)
       VALUES ($1,$2,$3,$4)`,
      [session.id, owner.id, item_type, (borrower_name || "").trim()],
    );
    res.json({ ok: true, owner: owner.name, item_type, borrower_name });
  } catch (err) {
    next(err);
  }
});

router.post("/loan/:id/return", auth, async (req, res, next) => {
  try {
    await db.query(`UPDATE loans SET returned_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

function publicStudent(s) {
  return {
    id: s.id,
    name: s.name,
    reg_no: s.reg_no,
    pc: s.pc_asset,
    charger: s.charger_asset,
    headset: s.headset_asset,
  };
}

module.exports = router;
