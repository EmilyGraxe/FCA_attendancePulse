const express = require('express');
const router = require("express").Router();
const db = require("../config/db");
const ExcelJS = require("exceljs");
const auth = require("../middleware/auth");
const role = require("../middleware/role");





// GET attendance report
router.get("/attendance", async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1; // 1-12
    const year = parseInt(req.query.year) || new Date().getFullYear();

    // Get all sessions in that month
    const sessionsRes = await db.query(
      `SELECT * FROM sessions 
       WHERE EXTRACT(MONTH FROM session_date) = $1
       AND EXTRACT(YEAR FROM session_date) = $2`,
      [month, year]
    );
    const sessions = sessionsRes.rows;

    if (!sessions.length) {
      return res.render("attendance.ejs", { month, year, days: [], students: [], sessions: [] });
    }

    // Get all students
    const studentsRes = await db.query(
      `SELECT id, name FROM users WHERE role='student' ORDER BY name`
    );
    const students = studentsRes.rows;

    // Build days array for calendar
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    // Get attendance records for those sessions
    const sessionIds = sessions.map(s => s.id);
    const attendanceRes = await db.query(
      `SELECT * FROM attendance WHERE session_id = ANY($1::int[])`,
      [sessionIds]
    );
    const attendance = attendanceRes.rows;

    // Map attendance: studentId => day => status
    const attendanceMap = {};
    students.forEach(student => {
      attendanceMap[student.id] = {};
      for (let day of days) {
        attendanceMap[student.id][day] = ""; // empty by default
      }
    });

    sessions.forEach(session => {
      const day = new Date(session.session_date).getDate();
      attendance.forEach(a => {
        if (a.session_id === session.id) {
          attendanceMap[a.student_id][day] = a.status; // 'P' or 'O'
        }
      });
    });

    res.render("attendance.ejs", { month, year, days, students, attendanceMap });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});



module.exports = router;