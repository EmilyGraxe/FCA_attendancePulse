// db.js
const { Pool } = require("pg");
require("dotenv").config();


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com")
    ? { rejectUnauthorized: false }
    : false,
});

pool.on("error", (err) => {
  console.error("Unexpected DB pool error:", err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
