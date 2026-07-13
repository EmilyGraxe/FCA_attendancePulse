/**
 * whatsapp.service.js
 * Sends messages back to WhatsApp via Meta Cloud API.
 */

const fetch = require("node-fetch");

const PHONE_NUMBER_ID  = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TOKEN   = process.env.WHATSAPP_TOKEN;
const META_API_VERSION = "v19.0";

async function sendMessage(to, text) {
  // WhatsApp requires the number without + and with country code
  // e.g. 256700123456  (Uganda: 256 prefix)
  const cleanNumber = to.replace(/^\+/, "");

  const url = `https://graph.facebook.com/${META_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to: cleanNumber,
    type: "text",
    text: { body: text },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json();
    console.error("WhatsApp send error:", JSON.stringify(err));
    throw new Error(`WhatsApp API error: ${resp.status}`);
  }

  return await resp.json();
}

module.exports = { sendMessage };
