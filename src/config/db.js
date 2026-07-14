const { Pool } = require("pg");
require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production";

const connectionString = isProduction
  ? process.env.DATABASE_URL_PROD
  : process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ Database URL is missing");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: isProduction
    ? { rejectUnauthorized: false }
    : false,
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected DB pool error:", err);
});

pool.connect()
  .then(client => {
    console.log("✅ Connected to PostgreSQL");
    client.release();
  })
  .catch(err => {
    console.error("❌ Failed to connect to database");
    console.error(err.message || err);
    process.exit(1);
  });

module.exports = pool;