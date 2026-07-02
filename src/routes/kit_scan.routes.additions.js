// Add to src/routes/kit_scan.routes.js (Express + pg + bcrypt + your auth middleware).
// These three endpoints back the kit_scan_addon.js helpers.

const bcrypt = require('bcryptjs');

module.exports = function (router, db, requireAuth) {

  // ---- POST /kit-scan/authorise-return ----
  // Verifies the LOGGED-IN user's password before letting them flip to PC-Return mode.
  router.post('/kit-scan/authorise-return', requireAuth, async (req, res) => {
    try {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ ok: false, message: 'Password required' });

      const { rows } = await db.query(
        `SELECT password_hash, role FROM users WHERE id = $1`,
        [req.user.id]
      );
      const u = rows[0];
      if (!u) return res.status(401).json({ ok: false, message: 'User not found' });

      if (!['admin', 'lecturer'].includes(u.role)) {
        return res.status(403).json({ ok: false, message: 'Only lecturers or admins can authorise PC Return' });
      }

      const ok = await bcrypt.compare(password, u.password_hash);
      if (!ok) return res.status(401).json({ ok: false, message: 'Incorrect password' });

      return res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, message: 'Server error' });
    }
  });

  // ---- GET /pc-share/search?q=... ----
  // Live autocomplete for the PC Share laptop-number field.
  router.get('/pc-share/search', requireAuth, async (req, res) => {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);
    try {
      const { rows } = await db.query(
        `SELECT ps.pc_number,
                s.full_name AS borrower_name,
                ps.returned_at
           FROM pc_shares ps
           LEFT JOIN students s ON s.id = ps.borrower_id
          WHERE ps.pc_number ILIKE $1
          ORDER BY (ps.returned_at IS NULL) DESC, ps.borrowed_at DESC
          LIMIT 10`,
        [q + '%']
      );
      // borrower_name only meaningful if still open
      res.json(rows.map(r => ({
        pc_number: r.pc_number,
        borrower_name: r.returned_at ? null : r.borrower_name
      })));
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Search failed' });
    }
  });

  // ---- POST /attendance/auto-mark ----
  // Marks the student present in the active kit-session-linked attendance session.
  router.post('/attendance/auto-mark', requireAuth, async (req, res) => {
    const { studentId, source } = req.body || {};
    if (!studentId) return res.status(400).json({ message: 'studentId required' });

    try {
      // find an open attendance session linked to the active kit session
      const { rows: sessRows } = await db.query(
        `SELECT a.id
           FROM sessions a
           JOIN kit_sessions k ON k.id = a.kit_session_id
          WHERE k.closed_at IS NULL
            AND a.active = TRUE
          ORDER BY a.started_at DESC
          LIMIT 1`
      );
      const session = sessRows[0];
      if (!session) return res.json({ ok: true, skipped: 'no active attendance session' });

      await db.query(
        `INSERT INTO attendance (session_id, student_id, status, source, marked_at)
         VALUES ($1, $2, 'present', $3, NOW())
         ON CONFLICT (session_id, student_id)
         DO UPDATE SET status = 'present', marked_at = NOW(), source = EXCLUDED.source`,
        [session.id, studentId, source || 'kitscan']
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Auto-mark failed' });
    }
  });
};
