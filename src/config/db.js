// db.js
const { Pool } = require("pg");
require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production";

// Use DATABASE_URL_PROD in production, DATABASE_URL locally
const connectionString = isProduction
  ? process.env.DATABASE_URL_PROD
  : process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL is not defined in environment variables!");
  process.exit(1);
}

// Create pool
const pool = new Pool({
  connectionString,
  ssl: isProduction
    ? {
        rejectUnauthorized: false, // Supabase allows this for Node.js clients
      }
    : false,
  max: 50, // can increase for heavy scanning
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // 5 seconds
});

// Test connection immediately
pool
  .connect()
  .then((client) => {
    console.log("✅ Connected to database successfully");
    client.release();
  })
  .catch((err) => {
    console.error("❌ Failed to connect to database");
    console.error(err.message || err);
    process.exit(1); // stop server if DB is unreachable
  });

module.exports = pool;