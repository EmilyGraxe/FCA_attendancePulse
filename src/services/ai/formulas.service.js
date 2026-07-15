/**
 * formulas.service.js — Reusable pure JS metrics/formulas.
 * Never calls Gemini. Given rows, returns numbers/strings.
 */
function pct(part, total) {
  if (!total || total <= 0) return 0;
  return Math.round((Number(part) / Number(total)) * 1000) / 10; // 1 dp
}
function attendancePercent({ present, total }) { return pct(present, total); }
function absenceCount({ total, present }) { return Math.max(0, Number(total || 0) - Number(present || 0)); }

function borrowingDurationHours(loan) {
  if (!loan?.loaned_at) return 0;
  const end = loan.returned_at ? new Date(loan.returned_at) : new Date();
  return Math.round(((end - new Date(loan.loaned_at)) / 36e5) * 10) / 10;
}
function averageAttendance(rowsByDay) {
  if (!rowsByDay?.length) return 0;
  const rates = rowsByDay.map((r) => pct(r.present, r.total));
  return Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10;
}
function trend(rowsByDay) {
  if (!rowsByDay || rowsByDay.length < 2) return { direction: "flat", change: 0 };
  const half = Math.floor(rowsByDay.length / 2);
  const first = averageAttendance(rowsByDay.slice(0, half));
  const second = averageAttendance(rowsByDay.slice(half));
  const change = Math.round((second - first) * 10) / 10;
  return { direction: change > 1 ? "up" : change < -1 ? "down" : "flat", change, first, second };
}
function peakDayOfWeek(rowsByDay) {
  const buckets = new Array(7).fill(0).map(() => ({ present: 0, total: 0 }));
  for (const r of rowsByDay || []) {
    const d = new Date(r.day).getDay();
    buckets[d].present += Number(r.present || 0);
    buckets[d].total   += Number(r.total   || 0);
  }
  const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const rated = buckets.map((b, i) => ({ day: names[i], rate: pct(b.present, b.total), total: b.total }));
  const active = rated.filter((r) => r.total > 0);
  if (!active.length) return null;
  active.sort((a, b) => b.rate - a.rate);
  return { peak: active[0], low: active[active.length - 1] };
}
module.exports = {
  pct, attendancePercent, absenceCount, borrowingDurationHours,
  averageAttendance, trend, peakDayOfWeek,
};
