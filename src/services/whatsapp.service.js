const fetch = require("node-fetch");

async function sendMessage(to, text) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;
  const toNumber   = `whatsapp:+${to}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const body = new URLSearchParams({
    From: from,
    To:   toNumber,
    Body: text,
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await resp.json();
  console.log("📤 Twilio response:", JSON.stringify(data));

  if (!resp.ok) throw new Error(`Twilio error: ${JSON.stringify(data)}`);
  return data;
}

module.exports = { sendMessage };