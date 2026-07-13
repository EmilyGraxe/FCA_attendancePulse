const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendMessage(to, text) {
  const result = await client.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to:   `whatsapp:+${to}`,
    body: text,
  });
  console.log(`📤 Sent to ${to} — SID: ${result.sid}`);
  return result;
}

module.exports = { sendMessage };