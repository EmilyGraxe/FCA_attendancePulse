/**
 * analytics.service.js — AI insights dashboard data.
 * Pure SQL + formulas. Gemini is optional and only used to write a natural-language summary.
 */
const dbq = require("./dbQuery.service");
const F   = require("./formulas.service");
const gemini = require("../gemini.service");

async function insights({ withNarrative = false } = {}) {
  const [stats, byDay, mostAbsent, mostPresent, borrowed] = await Promise.all([
    dbq.institutionStats(),
    dbq.attendanceByDay(30),
    dbq.mostAbsent(5),
    dbq.mostPresent(5),
    dbq.mostBorrowedPCs(5),
  ]);

  const trend = F.trend(byDay);
  const peaks = F.peakDayOfWeek(byDay);
  const avg   = F.averageAttendance(byDay);

  const payload = {
    generatedAt: new Date().toISOString(),
    stats,
    attendance: {
      last30Days: byDay,
      averagePercent: avg,
      trend,
      peakDay: peaks?.peak || null,
      lowestDay: peaks?.low || null,
    },
    topAbsentees: mostAbsent,
    topAttenders: mostPresent,
    mostBorrowedPCs: borrowed,
    narrative: null,
  };

  if (withNarrative) {
    try {
      const prompt =
        `Write 3-5 short bullet insights (no more than 60 words total) about this college attendance data. ` +
        `Plain text, no markdown. Data: ${JSON.stringify({
          avg, trend, peaks, stats,
          top5Absent: mostAbsent.map(r => ({ name: r.name, absences: Number(r.absences) })),
        })}`;
      payload.narrative = await gemini.formatAnswer("insights", [{ prompt }]).catch(() => null);
    } catch { payload.narrative = null; }
  }

  return payload;
}

module.exports = { insights };
