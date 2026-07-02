const express = require("express");
const router = express.Router();
const db = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const QRCode = require("qrcode");
const auth = require("../middleware/auth");
const role = require("../middleware/role");

// ─── LOGIN ───────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const userQuery = await db.query(
      "SELECT * FROM users WHERE email=$1 AND (role='lecturer' OR role='admin')",
      [email],
    );
    if (!userQuery.rows.length)
      return res.status(400).json({ message: "Invalid credentials" });

    const user = userQuery.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: "Invalid password" });

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: "9h" },
    );
    res.json({ token, role: user.role, name: user.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/logout", (req, res) => res.json({ message: "Logged out" }));

// ─── REGISTER STUDENT ────────────────────────────────────────────────────────
router.post("/register-student", async (req, res) => {
  const client = await db.connect();

  try {
    const { name, email, pc_asset, charger_asset, headset_asset } = req.body;

    if (!name) {
      const { rows: students } = await client.query(
        `SELECT id, name, email, reg_no, pc_asset, charger_asset, headset_asset
         FROM users WHERE role='student' ORDER BY name`
      );

      return res.status(400).render("admin.ejs", {
        students,
        msg: "Student name is required.",
        formData: req.body,
      });
    }

    const year = new Date().getFullYear();
    const qr_token = crypto.randomBytes(20).toString("hex");

    await client.query("BEGIN");

    // Check duplicate email FIRST
    if (email?.trim()) {
      const existing = await client.query(
        "SELECT 1 FROM users WHERE email=$1",
        [email.trim()]
      );

      if (existing.rows.length) {
        await client.query("ROLLBACK");

        const { rows: students } = await client.query(
          `SELECT id, name, email, reg_no, pc_asset, charger_asset, headset_asset
           FROM users WHERE role='student' ORDER BY name`
        );

        return res.status(400).render("admin.ejs", {
          students,
          msg: "Email already exists.",
          formData: req.body,
        });
      }
    }

    // Get student number
    const {
      rows: [{ student_no }],
    } = await client.query(
      "SELECT nextval('student_no_seq') AS student_no"
    );

    const reg_no = `FCA_DICE_${year}-${String(student_no).padStart(2, "0")}`;

    await client.query(
      `INSERT INTO users
        (name, email, role, student_no, reg_no, qr_token,
         pc_asset, charger_asset, headset_asset)
       VALUES ($1,$2,'student',$3,$4,$5,$6,$7,$8)`,
      [
        name.trim(),
        email?.trim() || null,
        student_no,
        reg_no,
        qr_token,
        pc_asset?.trim() || null,
        charger_asset === "yes"
          ? req.body.charger_tag?.trim() || "yes"
          : null,
        headset_asset?.trim() || null,
      ]
    );

    await client.query("COMMIT");

    return res.redirect("/students");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);

    const { rows: students } = await client.query(
      `SELECT id, name, email, reg_no, pc_asset, charger_asset, headset_asset
       FROM users WHERE role='student' ORDER BY name`
    );

    return res.status(500).render("admin.ejs", {
      students,
      msg: "Server error occurred.",
      formData: req.body,
    });
  } finally {
    client.release();
  }
});

// ─── UPDATE STUDENT ASSETS ───────────────────────────────────────────────────
router.post("/student/:id/assets", async (req, res) => {
  try {
    const { pc_asset, charger_asset, headset_asset } = req.body;
    await db.query(
      `UPDATE users SET pc_asset=$1, charger_asset=$2, headset_asset=$3 WHERE id=$4`,
      [
        pc_asset?.trim() || null,
        charger_asset?.trim() || null,
        headset_asset?.trim() || null,
        req.params.id,
      ],
    );
    res.redirect("/students?msg=Assets+updated");
  } catch (err) {
    console.error(err);
    res.redirect("/students?msg=Error+updating+assets");
  }
});

// ─── DELETE STUDENT ──────────────────────────────────────────────────────────
router.post("/student/:id/delete", async (req, res) => {
  try {
    await db.query(`DELETE FROM users WHERE id = $1 AND role='student'`, [
      req.params.id,
    ]);
    res.redirect("/students?msg=Student+removed");
  } catch (err) {
    console.error(err);
    res.redirect("/students?msg=Error+removing+student");
  }
});

// ─── LIST STUDENTS (page) ────────────────────────────────────────────────────
router.get("/students", async (req, res) => {
  try {
    const { rows: students } = await db.query(
      `SELECT id, name, email, reg_no, pc_asset, charger_asset, headset_asset
       FROM users WHERE role='student' ORDER BY name`,
    );
    res.render("studentsT.ejs", { students, msg: req.query.msg || null });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// ─── STUDENT QR PAGE ─────────────────────────────────────────────────────────
router.get("/student/:id/qr", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT name, reg_no, qr_token, pc_asset, charger_asset, headset_asset
       FROM users WHERE id=$1 AND role='student'`,
      [req.params.id],
    );
    if (!rows.length) return res.send("Student not found");
    const student = rows[0];
    const qrImage = await QRCode.toDataURL(student.qr_token, { margin: 1, width: 220 });
    res.render("studentQr.ejs", { student, qrImage });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// ─── ALL-STUDENT QR SHEET (printable grid) ───────────────────────────────────
router.get("/students/qr-sheet", async (req, res) => {
  try {
    const cols = Math.min(8, Math.max(2, parseInt(req.query.cols, 10) || 4));
    const { rows: students } = await db.query(
      `SELECT id, name, reg_no, qr_token, pc_asset
       FROM users WHERE role='student' AND qr_token IS NOT NULL AND qr_token <> 'temp'
       ORDER BY name`,
    );
    const withQr = await Promise.all(
      students.map(async (s) => ({
        ...s,
        qrImage: await QRCode.toDataURL(s.qr_token, { margin: 1, width: 180 }),
      })),
    );
    res.render("qr_sheet.ejs", { students: withQr, cols });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// ─── REGISTER LECTURER / ADMIN ───────────────────────────────────────────────
router.post("/register-lecturer", async (req, res) => {
  try {
    const { name, email, password, role: requestedRole } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "Name, email, and password required" });

    const r = requestedRole === "admin" ? "admin" : "lecturer";
    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      `INSERT INTO users (name, email, role, password) VALUES ($1, $2, $3, $4)`,
      [name.trim(), email.trim(), r, hashed],
    );
    req.session.message = `${r === "admin" ? "Admin" : "Lecturer"} registered. Please log in.`;
    res.redirect("/");
  } catch (err) {
    console.error(err);
    if (err.code === "23505")
      return res.status(400).json({ message: "Email already exists" });
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
