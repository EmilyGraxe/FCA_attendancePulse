// db.js
const { Pool } = require("pg");
require("dotenv").config();

const connectionString =
  process.env.NODE_ENV === "production"
    ? process.env.DATABASE_URL_PROD
    : process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL is not defined in environment variables!");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Supabase always needs SSL
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.connect()
  .then((c) => { console.log("✅ Connected to database successfully"); c.release(); })
  .catch((err) => { console.error("❌ DB connect failed:", err.message); process.exit(1); });

module.exports = pool;
