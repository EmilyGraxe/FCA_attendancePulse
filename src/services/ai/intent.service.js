/**
 * intent.service.js — Deterministic intent classifier.
 * Runs BEFORE Gemini. Only unknowns fall through to LLM.
 *
 * classify(text) -> {
 *   intent: string,           // canonical intent id
 *   confidence: number,       // 0..1
 *   entities: object,         // extracted params (name, pcNumber, month...)
 *   raw: string               // normalized text
 * }
 */

const INTENTS = [
  // ── Greetings / small talk ─────────────────────────────
  { id: "greeting", patterns: [/^(hi|hello|hey|yo|hola|good\s*(morning|afternoon|evening)|howdy)\b/i] },
  { id: "thanks",   patterns: [/^(thanks|thank you|thx|asante|webale|good bot)\b/i] },
  { id: "bye",      patterns: [/^(bye|goodbye|see you|later|cheers)\b/i] },

  // ── Meta / help / system ──────────────────────────────
  { id: "help",     patterns: [/^(help|menu|commands|what can you do|options)\b/i, /how do i use/i] },
  { id: "who_am_i", patterns: [/who am i\b/i, /my (profile|details|info)\b/i, /^me$/i] },
  { id: "clear_memory", patterns: [/^(clear|reset|forget)\b/i] },

  // ── Attendance (student self) ─────────────────────────
  { id: "attendance_today",    patterns: [/did i (attend|come|show up)/i, /am i (marked )?present today/i, /my attendance (for )?today/i, /attendance status today/i] },
  { id: "attendance_summary",  patterns: [/^my attendance$/i, /^attendance$/i, /how many (times|sessions) (did|have) i (attend|been present)/i, /show (my )?attendance/i] },
  { id: "attendance_percent",  patterns: [/attendance (percentage|percent|%|rate|score)/i, /what.?s my attendance percent/i] },
  { id: "attendance_absences", patterns: [/how many (absences|absent|missed)/i, /my absences?/i, /sessions i (missed|skipped)/i, /what sessions did i miss/i] },
  { id: "attendance_month",    patterns: [/(this|current) month('s)? attendance/i, /attendance (for )?(this )?month/i] },
  { id: "attendance_week",     patterns: [/(this|current) week('s)? attendance/i, /attendance (for )?(this )?week/i] },
  { id: "attendance_trend",    patterns: [/attendance (trend|pattern|history|over time)/i] },
  { id: "attendance_last",     patterns: [/(when|what) (was )?my last attendance/i, /last time i attended/i] },

  // ── Kit / PC ──────────────────────────────────────────
  { id: "my_pc",         patterns: [/(what|which) pc( am i (assigned|using))?/i, /my (allocated |assigned )?pc\b/i, /^my pc$/i] },
  { id: "my_charger",    patterns: [/my charger/i, /(what|which) charger/i, /allocated charger/i] },
  { id: "my_headset",    patterns: [/my headset/i, /(what|which) headset/i, /allocated headset/i] },
  { id: "my_kit",        patterns: [/my (kit|equipment|allocation|assets)/i, /kit status/i, /what.?s my kit/i] },
  { id: "pc_owner",      patterns: [/who (owns|has|is using|currently has) pc[- ]?(\w+)/i, /where is pc[- ]?(\w+)/i] },
  { id: "pc_returned",   patterns: [/(has|is) my pc (been )?returned/i, /is pc[- ]?(\w+) returned/i] },
  { id: "unreturned_pcs", patterns: [/(pcs|which pcs|what pcs) (that )?(haven.?t|not) been returned/i, /outstanding (pcs|kit)/i, /overdue (returns|pcs)/i] },

  // ── Lecturer info ─────────────────────────────────────
  { id: "my_lecturer", patterns: [/who is my (lecturer|teacher|tutor)/i, /my lecturer/i] },
  { id: "reg_no",      patterns: [/(my|what.?s my) (registration|reg)( no| number)?\b/i] },
  { id: "student_no",  patterns: [/(my|what.?s my) student (no|number|id)/i] },

  // ── Sessions / announcements / timetable ──────────────
  { id: "current_session", patterns: [/(current|active|ongoing) session/i, /any session (now|active)/i] },
  { id: "today_sessions",  patterns: [/(today.?s|todays) (sessions|classes|timetable)/i, /sessions today/i] },
  { id: "announcements",   patterns: [/announcements/i, /any news/i] },

  // ── Lecturer / admin queries ──────────────────────────
  { id: "absent_today",    patterns: [/who (is|are) absent today/i, /absent students today/i, /today.?s absentees/i] },
  { id: "present_today",   patterns: [/who (is|are) present today/i, /today.?s attendance list/i] },
  { id: "most_absent",     patterns: [/most absent students?/i, /students likely to (drop|fail)/i, /worst attendance/i] },
  { id: "most_present",    patterns: [/most (punctual|active) students?/i, /best attendance/i, /top attend/i] },
  { id: "institution_stats", patterns: [/(institution|system|overall) (stats|statistics|summary|overview)/i] },
  { id: "equipment_today", patterns: [/equipment (issued|checked out) today/i, /today.?s loans/i] },
  { id: "most_borrowed_pc", patterns: [/most (borrowed|loaned) pcs?/i] },

  // ── Search ────────────────────────────────────────────
  { id: "search_student", patterns: [/^(find|search|look up|lookup) (student )?(.+)$/i] },
  { id: "search_pc",      patterns: [/(find|search) pc[- ]?(\w+)/i, /pc[- ]?(\w+) info/i] },

  // ── FAQ / knowledge base ──────────────────────────────
  { id: "faq_reset_password", patterns: [/(reset|forgot|change) (my )?password/i] },
  { id: "faq_borrow_pc",      patterns: [/how do i borrow a pc/i, /how to borrow/i] },
  { id: "faq_return_pc",      patterns: [/how do i return (a |my )?pc/i, /how to return/i] },
  { id: "faq_attendance_works", patterns: [/how does attendance work/i, /how is attendance (recorded|tracked)/i] },
  { id: "faq_absentee_calc",  patterns: [/how is (absenteeism|absence) calculated/i] },
  { id: "faq_contact",        patterns: [/who (do i|should i) contact/i, /support contact/i] },
  { id: "faq_lost_equipment", patterns: [/(lost|missing|damaged) (kit|equipment|pc)/i, /what if i lose/i] },
];

function _extractEntities(text) {
  const ent = {};
  const pcMatch = text.match(/pc[- ]?(\w+)/i);        if (pcMatch)   ent.pcNumber = pcMatch[1];
  const chgMatch = text.match(/chg[- ]?(\w+)/i);      if (chgMatch)  ent.chargerNumber = chgMatch[1];
  const hdsMatch = text.match(/hds[- ]?(\w+)/i);      if (hdsMatch)  ent.headsetNumber = hdsMatch[1];
  const nameMatch = text.match(/(?:for|find|search|about|lookup)\s+(?:student\s+)?([A-Za-z][A-Za-z .'-]{1,40})/i);
  if (nameMatch) ent.name = nameMatch[1].trim();
  const monthMatch = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
  if (monthMatch) ent.month = monthMatch[1].toLowerCase();
  if (/this month|current month/i.test(text)) ent.period = "month";
  else if (/this week|current week/i.test(text)) ent.period = "week";
  else if (/today/i.test(text)) ent.period = "today";
  else if (/yesterday/i.test(text)) ent.period = "yesterday";
  return ent;
}

function classify(text) {
  const raw = String(text || "").trim();
  const norm = raw.toLowerCase();

  for (const intent of INTENTS) {
    for (const pat of intent.patterns) {
      if (pat.test(raw)) {
        return {
          intent: intent.id,
          confidence: 0.95,
          entities: _extractEntities(raw),
          raw,
        };
      }
    }
  }
  return { intent: "unknown", confidence: 0, entities: _extractEntities(raw), raw };
}

module.exports = { classify, INTENTS };
