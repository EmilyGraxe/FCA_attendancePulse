require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
const db = require("./src/config/db");
const auth = require("./src/middleware/auth");
const role = require("./src/middleware/role");

const app = express();

app.use(
  session({
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8h
  }),
);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api/auth", require("./src/routes/auth.routes"));
app.use("/api/session", require("./src/routes/session.routes"));
app.use("/api/attendance", require("./src/routes/attendance.routes"));
app.use("/api/report", require("./src/routes/report.routes"));
app.use("/kit-sessions", require("./src/routes/kit_session.routes"));
app.use("/kit-scan", require("./src/routes/kit_scan.routes"));
app.use("/kit-dashboard", require("./src/routes/kit_dashboard.routes"));

// ── Page routes ───────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const message = req.session.message || "";
  req.session.message = null;
  res.render("login.ejs", { message });
});

app.get("/dashboard", (req, res) => res.render("dashboard.ejs", {}));
app.get("/admin", (req, res) => res.render("admin.ejs"));
app.get("/lecturer", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "lecturer.html")),
);
app.get("/kitSession", (req, res) => res.redirect("/kit-sessions"));
app.get("/scanner", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "scanner.html")),
);

// Friendly aliases
app.get("/students", (req, res) => res.redirect("/api/auth/students"));
app.get("/qr-sheet", (req, res) => res.redirect("/api/auth/students/qr-sheet"));

// ── API helpers ───────────────────────────────────────────────────────────────
app.get("/me", auth, (req, res) =>
  res.json({ id: req.user.id, name: req.user.name, role: req.user.role }),
);

app.get("/total-students", auth, async (req, res) => {
  const result = await db.query("SELECT id FROM users WHERE role = 'student'");
  res.json(result.rows);
});

app.get("/chart-data", auth, async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    // Admins see all sessions; lecturers see their own
    const params = [month, year];
    let clause = "";
    if (req.user.role === "lecturer") {
      clause = " AND lecturer_id = $3";
      params.push(req.user.id);
    }
    const sessionsRes = await db.query(
      `SELECT id, session_date FROM sessions
       WHERE EXTRACT(MONTH FROM session_date) = $1
         AND EXTRACT(YEAR FROM session_date) = $2 ${clause}
       ORDER BY session_date`,
      params,
    );
    const sessions = sessionsRes.rows;
    const labels = sessions.map((s) =>
      new Date(s.session_date).toLocaleDateString("en-CA"),
    );
    const data = [];
    for (const s of sessions) {
      const totalRes = await db.query(
        "SELECT COUNT(*) FROM attendance WHERE session_id = $1",
        [s.id],
      );
      const presentRes = await db.query(
        "SELECT COUNT(*) FROM attendance WHERE session_id = $1 AND status = 'P'",
        [s.id],
      );
      const total = parseInt(totalRes.rows[0].count, 10);
      const present = parseInt(presentRes.rows[0].count, 10);
      data.push(total > 0 ? Math.round((present / total) * 100) : 0);
    }
    res.json({ labels, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error fetching chart data" });
  }
});

// 404
app.use((req, res) => res.status(404).send("Not found"));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Server error: " + err.message);
});

app.listen(process.env.PORT || 5000, () =>
  console.log(
    `✅ FCA System running → http://localhost:${process.env.PORT || 5000}`,
  ),
);
