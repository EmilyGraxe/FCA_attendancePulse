const express = require("express");
const router = require("express").Router();
const db = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../config/db"); // adjust path to your db.js file


router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const userQuery = await db.query(
      "SELECT * FROM users WHERE email=$1 AND (role='lecturer' OR role='admin')",
      [email]
    );

    if (!userQuery.rows.length)
      return res.status(400).json({ message: "Invalid credentials" });

    const user = userQuery.rows[0];

    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(400).json({ message: "Invalid password" });

    const token = jwt.sign(
      { id: user.id, role: user.role , name:user.name},
      process.env.JWT_SECRET,
      { expiresIn: "9h" }
    );

    // ✅ RETURN JSON (no redirect)
    res.json({ token, role: user.role });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


// routes/auth.routes.js (or wherever your auth routes are)
router.post('/logout', (req, res) => {
    // Since JWT is stateless, just tell the client to remove it
    res.json({ message: 'Logged out successfully' });
});

const QRCode = require("qrcode");
const { name } = require("ejs");

// REGISTER STUDENT
router.post("/register-student", async (req, res) => {
  console.log("BODY:", req.body);
  try {
    const { name, email } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Student name is required" });
    }

    const year = new Date().getFullYear();

    // 1️⃣ Insert temporary student to get ID
    const insert = await pool.query(
      `INSERT INTO users (name, email, role, reg_no, qr_token)
       VALUES ($1, $2, 'student', 'temp', 'temp')
       RETURNING id`,
      [name, email || null]
    );

    const studentId = insert.rows[0].id;

    // 2️⃣ Generate registration number → FCA_year-ID
    const reg_no = `FCA_DICE_${year}-${studentId}`;

    // 3️⃣ Generate secure QR token
    const qr_token = crypto.randomBytes(20).toString("hex");

    // 4️⃣ Store final values
    await pool.query(
      `UPDATE users SET reg_no=$1, qr_token=$2 WHERE id=$3`,
      [reg_no, qr_token, studentId]
    );

    // 5️⃣ Generate QR image containing the token
    const qrImage = await QRCode.toDataURL(qr_token);

   res.redirect("/api/auth/students");

  } catch (err) {
    console.error(err);

    // handle duplicate email nicely
    if (err.code === "23505") {
      return res.status(400).json({ message: "Email already exists" });
    }

    res.status(500).json({ message: "Server error" });
  }
});


// Show all students
router.get("/students", async (req, res) => {
  try {
    const { rows: students } = await pool.query(
      `SELECT id, name, email, reg_no FROM users WHERE role='student' ORDER BY id`
    );

    res.render("studentsT.ejs", { students });
  } catch (err) {
    console.error(err);
    res.send("Server error");
  }
});

router.get("/student/:id/qr", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT name, reg_no, qr_token FROM users WHERE id=$1 AND role='student'`,
      [id]
    );

    if (rows.length === 0) return res.send("Student not found");

    const student = rows[0];
    const qrImage = await QRCode.toDataURL(student.qr_token);

    res.render("studentQr.ejs", { student, qrImage });
  } catch (err) {
    console.error(err);
    res.send("Server error");
  }
});

//LECTURER REGISTER
router.post("/register-lecturer", async (req, res) => {
  console.log("BODY:", req.body);
  try {
    const { name, email, password } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Lecturer name is required" });
    }

    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (name, email, role, password)
       VALUES ($1, $2, 'lecturer', $3)`,
      [name, email, hashedPassword]
    );
   req.session.message = "Lecturer registered successfully! Please log in.";
   res.redirect("/");

  } catch (err) {
    console.error(err);

    // handle duplicate email nicely
    if (err.code === "23505") {
      return res.status(400).json({ message: "Email already exists" });
    }

    res.status(500).json({ message: "Server error" });
  }
});





module.exports = router;