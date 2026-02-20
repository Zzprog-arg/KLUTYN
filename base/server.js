import express from "express";
import helmet from "helmet";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// URL DIRECTA al APK (GitHub Releases recomendado)
const APK_URL =
  process.env.APK_URL ||
  "https://github.com/Zzprog-arg/KLUTYN/releases/download/v1.0.0/app.apk";

// Tu conexión MySQL (NO la subas a GitHub, va en Render env vars)
const DATABASE_URL = process.env.DATABASE_URL;

// Panel key opcional (si lo dejás vacío, no pide)
const ADMIN_KEY = process.env.ADMIN_KEY || ""; // ej: "1234"

// Config códigos
const CODE_LENGTH = Number(process.env.CODE_LENGTH || 4); // 4 si querés
const MAX_QTY = Number(process.env.MAX_QTY || 200);

// --- paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- static ---
app.use("/", express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

let pool;

// ================== DB ==================
async function initDb() {
  if (!DATABASE_URL) {
    throw new Error("Falta env var DATABASE_URL");
  }
  pool = mysql.createPool({
    uri: DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
  });

  // Crear tabla si no existe
  const sqlPath = path.join(__dirname, "db.sql");
  const schema = fs.readFileSync(sqlPath, "utf8");
  const conn = await pool.getConnection();
  try {
    // db.sql puede tener varios statements
    for (const stmt of schema.split(";")) {
      const s = stmt.trim();
      if (s) await conn.query(s);
    }
  } finally {
    conn.release();
  }
  console.log("DB OK");
}

function adminOk(req) {
  if (!ADMIN_KEY) return true;
  return (req.query.key || req.headers["x-admin-key"] || "") === ADMIN_KEY;
}

function genNumericCode(len) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

async function codeExists(code) {
  const [rows] = await pool.query("SELECT code FROM codes WHERE code = ? LIMIT 1", [code]);
  return rows.length > 0;
}

// ================== API ADMIN ==================
// Generar códigos
app.post("/api/admin/generate", async (req, res) => {
  try {
    if (!adminOk(req)) return res.status(401).json({ error: "No autorizado" });

    let qty = parseInt(req.body.qty ?? 10, 10);
    qty = Math.max(1, Math.min(MAX_QTY, qty));

    const len = Math.max(4, Math.min(12, parseInt(req.body.len ?? CODE_LENGTH, 10)));

    const codes = [];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (let i = 0; i < qty; i++) {
        let code;
        // Evitar colisiones
        do {
          code = genNumericCode(len);
          const [rows] = await conn.query("SELECT code FROM codes WHERE code=? LIMIT 1", [code]);
          if (rows.length === 0) break;
        } while (true);

        await conn.query("INSERT INTO codes(code, used) VALUES(?, 0)", [code]);
        codes.push(code);
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    res.json({ ok: true, qty: codes.length, codes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error servidor" });
  }
});

// Listar últimos
app.get("/api/admin/list", async (req, res) => {
  try {
    if (!adminOk(req)) return res.status(401).json({ error: "No autorizado" });

    const [rows] = await pool.query(
      "SELECT code, used, created_at, used_at FROM codes ORDER BY created_at DESC LIMIT 200"
    );
    res.json({ ok: true, rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error servidor" });
  }
});

// ================== REDEEM ==================
// Canje JSON (para tu JS)
app.post("/api/redeem", async (req, res) => {
  try {
    const code = String(req.body.code || "").trim();

    // Acepta 4–12 dígitos
    if (!/^\d{4,12}$/.test(code)) return res.status(400).json({ error: "Código inválido" });

    // Buscar
    const [rows] = await pool.query("SELECT used FROM codes WHERE code=? LIMIT 1", [code]);
    if (rows.length === 0) return res.status(404).json({ error: "Código inexistente" });
    if (rows[0].used) return res.status(409).json({ error: "Código ya usado" });

    // Marcar como usado de forma atómica
    const [upd] = await pool.query(
      "UPDATE codes SET used=1, used_at=NOW() WHERE code=? AND used=0",
      [code]
    );
    if (upd.affectedRows === 0) return res.status(409).json({ error: "Código ya usado" });

    res.json({ ok: true, redirect: APK_URL });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error servidor" });
  }
});

// Canje por form clásico + redirect (por si lo querés)
app.post("/redeem", async (req, res) => {
  try {
    const code = String(req.body.code || "").trim();
    if (!/^\d{4,12}$/.test(code)) return res.status(400).send("Código inválido");

    const [rows] = await pool.query("SELECT used FROM codes WHERE code=? LIMIT 1", [code]);
    if (rows.length === 0) return res.status(404).send("Código inexistente");
    if (rows[0].used) return res.status(409).send("Código ya usado");

    const [upd] = await pool.query(
      "UPDATE codes SET used=1, used_at=NOW() WHERE code=? AND used=0",
      [code]
    );
    if (upd.affectedRows === 0) return res.status(409).send("Código ya usado");

    res.redirect(302, APK_URL);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error servidor");
  }
});

// ================== BOOT ==================
initDb()
  .then(() => {
    app.listen(PORT, () => console.log("OK on", PORT));
  })
  .catch((e) => {
    console.error("Fallo initDb:", e.message);
    process.exit(1);
  });
