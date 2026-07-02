const router = require('express').Router();
const db     = require('../config/db');
const auth   = require('../middleware/auth');

router.get('/', async (req, res, next) => {
  try {
    const { rows: [session] } = await db.query(
      `SELECT * FROM kit_sessions WHERE closed_at IS NULL ORDER BY started_at DESC LIMIT 1`
    );

    if (!session) {
      return res.render('kit_dashboard.ejs', {
        session: null, students: [], stats: {}, filter: 'all', search: ''
      });
    }

    const filter = req.query.filter || 'all';
    const search = (req.query.search || '').trim();

    const params = [session.id];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (u.name ILIKE $${params.length} OR u.reg_no ILIKE $${params.length})`;
    }

    const statusFilter = {
      out:      `AND c.id IS NOT NULL AND c.returned_at IS NULL`,
      returned: `AND c.returned_at IS NOT NULL`,
      not_in:   `AND c.id IS NULL`,
    }[filter] || '';

    const { rows: students } = await db.query(`
      SELECT
        u.id, u.name, u.reg_no, u.pc_asset, u.charger_asset, u.headset_asset,
        c.id             AS checkout_id,
        c.checked_out_at,
        c.returned_at,
        CASE
          WHEN c.id IS NULL              THEN 'not_in'
          WHEN c.returned_at IS NOT NULL THEN 'returned'
          ELSE 'out'
        END AS status
      FROM users u
      LEFT JOIN checkouts c
        ON c.student_id = u.id AND c.kit_session_id = $1
      WHERE u.role = 'student' ${where} ${statusFilter}
      ORDER BY
        CASE WHEN c.id IS NULL THEN 2
             WHEN c.returned_at IS NOT NULL THEN 1
             ELSE 0 END,
        u.name ASC
    `, params);

    const { rows: [stats] } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role='student')                                AS total,
        COUNT(c.id) FILTER (WHERE c.returned_at IS NULL)                                AS out,
        COUNT(c.id) FILTER (WHERE c.returned_at IS NOT NULL)                            AS returned,
        (SELECT COUNT(*) FROM users WHERE role='student') - COUNT(c.id)                 AS not_in
      FROM checkouts c
      WHERE c.kit_session_id = $1
    `, [session.id]);

    res.render('kit_dashboard.ejs', { session, students, stats, filter, search });
  } catch (err) { next(err); }
});

module.exports = router;
