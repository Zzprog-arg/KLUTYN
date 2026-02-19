const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

function initDb(dbPath, schemaPath) {
  const abs = path.resolve(dbPath);
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(abs);
  db.pragma("journal_mode = WAL");

  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  // Migration: add password_plain column if missing (for existing databases)
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const hasPlain = cols.some(c => c.name === "password_plain");
  if (!hasPlain) {
    db.exec("ALTER TABLE users ADD COLUMN password_plain TEXT NOT NULL DEFAULT ''");
  }

  return db;
}

module.exports = { initDb };
