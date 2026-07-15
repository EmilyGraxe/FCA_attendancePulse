/**
 * knowledgeBase.service.js — Static FAQ answers. Zero Gemini calls.
 * Add new entries here; nothing else needs to change.
 */
const KB = {
  faq_reset_password: `🔐 *Password reset*\n1. Go to the login page\n2. Tap "Forgot password"\n3. Follow the email link\n\nIf you don't get the email, contact your admin.`,
  faq_borrow_pc: `💻 *Borrowing a PC*\n1. Visit the kit scanner\n2. Scan your student QR\n3. Scan the PC / charger / headset QR\n4. Confirm on screen\n\nA loan record is created automatically.`,
  faq_return_pc: `↩️ *Returning a PC*\n1. Open the kit scanner\n2. Scan your QR and then the item QR\n3. Return will be recorded and the loan closed.`,
  faq_attendance_works: `📋 *How attendance works*\nYour lecturer opens a session, you scan your QR at the scanner, and the system marks you *Present*. Missed sessions are auto-marked *Absent* when the lecturer closes the session.`,
  faq_absentee_calc: `📊 *Absenteeism*\nAbsences = total sessions − present sessions.\nAttendance % = present ÷ total × 100.\nOnly sessions you were rostered for count against you.`,
  faq_contact: `📞 *Support*\nFor account or attendance issues, contact your lecturer first, then the FCA IT admin.`,
  faq_lost_equipment: `⚠️ *Lost or damaged equipment*\nReport it to your lecturer immediately. The loan record stays open until the item is returned or a replacement is logged.`,
};
function get(intent) { return KB[intent] || null; }
function all() { return { ...KB }; }
module.exports = { get, all };
