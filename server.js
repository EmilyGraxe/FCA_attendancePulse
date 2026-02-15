require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const path = require("path");
const db = require("./src/config/db");
const pool = require("./src/config/db");
const auth = require("./src/middleware/auth");
const role = require("./src/middleware/role");

const app = express();

const session = require("express-session");

app.use(session({
  secret: process.env.SESSION_SECRET || "supersecret",
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 30000 } // message lasts 1 min
}));

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth", require("./src/routes/auth.routes"));
app.use("/api/session", require("./src/routes/session.routes"));
app.use("/api/attendance", require("./src/routes/attendance.routes"));
app.use("/api/report", require("./src/routes/report.routes"));

app.get("/", (req, res)=> {
  const message = req.session.message || "";
  // Clear the message after displaying
  req.session.message = null;
  res.render("login.ejs", {message});
});




// Serve dashboard page
app.get("/dashboard", async (req, res) => {
  try {
    res.render("dashboard.ejs", { user: req.user });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// API: current user
app.get('/me', auth, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, role: req.user.role });
});

app.get("/total-students", auth, async (req, res) => {
  const result = await db.query("SELECT * FROM users WHERE role = 'student'");
  res.json(result.rows);   // ← THIS is the correct response
});

// API: Monthly attendance chart data
app.get("/chart-data", auth, role("lecturer"), async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;

    // Get sessions of current month for this lecturer
    const sessionsRes = await db.query(
      `SELECT id, session_date FROM sessions
       WHERE EXTRACT(MONTH FROM session_date) = $1
       AND EXTRACT(YEAR FROM session_date) = $2
       AND lecturer_id = $3`,
      [month, year, req.user.id]
    );
    const sessions = sessionsRes.rows;
    const labels = sessions.map(s => { 
      return new Date(s.session_date).toLocaleDateString('en-CA'); // YYYY-MM-DD format
});

    const data = [];

    for (let s of sessions) {
      const totalRes = await db.query(
        "SELECT COUNT(*) FROM attendance WHERE session_id = $1",
        [s.id]
      );
      const presentRes = await db.query(
        "SELECT COUNT(*) FROM attendance WHERE session_id = $1 AND status = 'P'",
        [s.id]
      );

      const total = parseInt(totalRes.rows[0].count);
      const present = parseInt(presentRes.rows[0].count);
      const percent = total > 0 ? Math.round((present / total) * 100) : 0;
      data.push(percent);
    }

    res.json({ labels, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error fetching chart data" });
  }
});


app.get("/admin", (req, res)=>{
  res.render("admin.ejs")
})

app.get("/lecturer", (req, res)=>{
  res.sendFile(path.join(__dirname, "public", "lecturer.html"));
})

app.get("/scanner", (req, res)=>{
  res.sendFile(path.join(__dirname, "public", "scanner.html"));
})

pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ Failed to connect to database");
    console.error(err.message);
    process.exit(1);
  }

  console.log("✅ Database connected successfully");

  // release client back to pool
  release();
});

app.listen(process.env.PORT, () =>
  console.log(`Server running on link http://localhost:${process.env.PORT}`)
);