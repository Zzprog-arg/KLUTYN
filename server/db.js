const mysql = require("mysql2/promise");
const fs = require("fs");

let pool;

async function initDb(schemaPath) {
  pool = mysql.createPool({
    host: process.env.DB_HOST || "cehxlr.h.filess.io",
    port: Number(process.env.DB_PORT || 3307),
    user: process.env.DB_USER || "Klutyn_tongueson",
    password: process.env.DB_PASS || "88e47fd6501b9438440ffa02a7d5353884fd4d8d",
    database: process.env.DB_NAME || "Klutyn_tongueson",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  // Run schema statements one by one (CREATE TABLE IF NOT EXISTS)
  const schema = fs.readFileSync(schemaPath, "utf-8");
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await pool.execute(stmt);
  }

  // Migration: add password_plain column if missing
  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM users LIKE 'password_plain'");
    if (cols.length === 0) {
      await pool.execute("ALTER TABLE users ADD COLUMN password_plain VARCHAR(255) NOT NULL DEFAULT ''");
    }
  } catch (e) {
    // table may not exist yet on first run, ignore
  }

  return pool;
}

function getPool() {
  return pool;
}

module.exports = { initDb, getPool };
