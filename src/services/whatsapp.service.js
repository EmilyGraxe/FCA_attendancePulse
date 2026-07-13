/**
 * whatsapp.service.js — Twilio WhatsApp REST client
 * Sends outbound messages via Twilio's Messages API.
 */

const fetch = require("node-fetch");

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
// Sandbox default: whatsapp:+14155238886
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

async function sendMessage(to, text) {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    console.error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
    return;
  }

  // Normalise: accept "256700..." or "+256700..." or "whatsapp:+256700..."
  let clean = to.toString().replace(/^whatsapp:/i, "").replace(/^\+/, "");
  const toAddr = `whatsapp:+${clean}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");

  const form = new URLSearchParams({
    From: FROM_NUMBER,
    To:   toAddr,
    Body: text,
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`Twilio send error [${resp.status}]:`, err);
    throw new Error(`Twilio API ${resp.status}`);
  }

  const data = await resp.json();
  console.log(`✅ Sent (sid=${data.sid}) to ${toAddr}`);
  return data;
}

module.exports = { sendMessage };
