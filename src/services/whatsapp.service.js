/**
 * whatsapp.service.js — Twilio WhatsApp client
 */

const twilio = require("twilio");

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER =
  process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function sendMessage(to, text) {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  }

  let clean = String(to)
    .replace(/^whatsapp:/i, "")
    .replace(/^\+/, "");

  const toAddr = `whatsapp:+${clean}`;

  try {
    console.log("FROM:", FROM_NUMBER);
    console.log("TO:", toAddr);
    const message = await client.messages.create({
      from: FROM_NUMBER,
      to: toAddr,
      body: text,
    });

    console.log(`✅ Sent (sid=${message.sid}) to ${toAddr}`);
    return message;
  } catch (err) {
    console.error("Twilio Error:", err.message);
    throw err;
  }
}

module.exports = { sendMessage };