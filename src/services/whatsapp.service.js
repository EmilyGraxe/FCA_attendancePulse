const fetch = require("node-fetch");

async function sendMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text },
    }),
  });

  const data = await resp.json();
  console.log("📤 WhatsApp API response:", JSON.stringify(data));

  if (!resp.ok) {
    throw new Error(`WhatsApp send failed: ${JSON.stringify(data)}`);
  }
  return data;
}

module.exports = { sendMessage };