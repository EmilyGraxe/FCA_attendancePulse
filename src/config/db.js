// db.js
const { Pool } = require("pg");
require("dotenv").config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL is not defined in environment variables!");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: false,
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
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
    process.exit(1);
  });

module.exports = pool;