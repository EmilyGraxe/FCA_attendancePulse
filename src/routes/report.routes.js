const express = require('express');
const router = require("express").Router();
const db = require("../config/db");
const ExcelJS = require("exceljs");
const auth = require("../middleware/auth");
const role = require("../middleware/role");

// GET attendance report
router.get("/attendance", async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const mode  = req.query.mode || 'month'; // 'month' | 'range' | 'days'

    let fromDate, toDate;

    if (mode === 'range' && req.query.from && req.query.to) {
      fromDate = req.query.from; // YYYY-MM-DD
      toDate   = req.query.to;
    } else if (mode === 'days' && req.query.from && req.query.numDays) {
      fromDate = req.query.from;
      const end = new Date(fromDate);
      end.setDate(end.getDate() + parseInt(req.query.numDays) - 1);
      toDate = end.toISOString().slice(0, 10);
    } else {
      // Default: full month
      const last = new Date(year, month, 0).getDate();
      fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
      toDate   = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    }

    // Get all sessions in range
    const sessionsRes = await db.query(
      `SELECT * FROM sessions
       WHERE session_date BETWEEN $1 AND $2
       ORDER BY session_date`,
      [fromDate, toDate]
    );
    const sessions = sessionsRes.rows;

    // Get all students
    const studentsRes = await db.query(
      `SELECT id, name FROM users WHERE role='student' ORDER BY name`
    );
    const students = studentsRes.rows;

    // Build days array as day-numbers (keeps your EJS table working exactly)
    const days = [];
    for (let d = new Date(fromDate); d <= new Date(toDate); d.setDate(d.getDate() + 1)) {
      days.push(d.getDate()); // just the day number, like your original
    }

    // Also build a full ISO date list to key the attendanceMap correctly
    const isoDays = [];
    for (let d = new Date(fromDate); d <= new Date(toDate); d.setDate(d.getDate() + 1)) {
      isoDays.push(d.toISOString().slice(0, 10));
    }

    if (!sessions.length) {
      return res.render("attendance.ejs", {
        month, year, days, students,
        attendanceMap: {}, query: req.query
      });
    }

    const sessionIds = sessions.map(s => s.id);
    const attendanceRes = await db.query(
      `SELECT * FROM attendance WHERE session_id = ANY($1::int[])`,
      [sessionIds]
    );
    const attendance = attendanceRes.rows;

    // Map attendance: studentId => dayNumber => status (same as your original)
    const attendanceMap = {};
    students.forEach(student => {
      attendanceMap[student.id] = {};
      days.forEach(day => { attendanceMap[student.id][day] = ''; });
    });

    sessions.forEach(session => {
      const day = new Date(session.session_date).getDate();
      attendance.forEach(a => {
        if (a.session_id === session.id) {
          attendanceMap[a.student_id][day] = a.status;
        }
      });
    });

    res.render("attendance.ejs", {
      month, year, days, students, attendanceMap, query: req.query
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

module.exports = router;