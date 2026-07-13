// db.js
const { Pool } = require("pg");
require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production";

const connectionString = isProduction
  ? process.env.DATABASE_URL_PROD
  : process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ Database connection string is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Catch unexpected pool errors
pool.on("error", (err) => {
  console.error("❌ PostgreSQL pool error:", err.message);
});

// Verify connection at startup
(async () => {
  try {
    const result = await pool.query(
      "SELECT NOW() AS now, current_database() AS db"
    );

    console.log(
      `✅ Connected to database: ${result.rows[0].db}`
    );
    console.log(`🕒 Database time: ${result.rows[0].now}`);
  } catch (err) {
    console.error("❌ Failed to connect to database");
    console.error(err.message);
    process.exit(1);
  }
})();

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};