const { Pool } = require("pg");
require("dotenv").config();
const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString:  isProduction ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 50,              // default 10, increase for heavy scanning
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

module.exports = pool;