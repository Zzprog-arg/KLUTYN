import express from "express";
import helmet from "helmet";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helmet con CSP que NO bloquea scripts externos (self)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'"], // OK porque usamos .js externos
      },
    },
  })
);

const PORT = process.env.PORT || 3000;

// ✅ Tu DB URL (ponela en Render env var, NO en GitHub)
const DATABASE_URL = process.env.DATABASE_URL;

// ✅ APK directo (GitHub Releases)
const APK_URL =
  process.env.APK_URL ||
  "https://github.com/Zzprog-arg/KLUTYN/releases/download/v1.0.0/app.apk";

// ✅ Clave del panel (solo para VER el código)
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || "1234";

// Largo del código actual
const CODE_LENGTH = Number(process.env.CODE_LENGTH || 4);

// Paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/", express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

let pool;

function genNumericCode(len) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

async function initDb() {
  if (!DATABASE_URL) throw new Error("Falta env var DATABASE_URL");

  pool = mysql.createPool({
    uri: DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 5,
  });

  const schema = fs.readFileSync(path.join(__dirname, "db.sql"), "utf8");
  const conn = await pool.getConnection();
  try {
    for (const part of schema.split(";")) {
      const stmt = part.trim();
      if (stmt) await conn.query(stmt);
    }

    // asegurar que exista current_code
    const [rows] = await conn.query("SELECT v FROM settings WHERE k='current_code' LIMIT 1");
    if (rows.length === 0) {
      const first = genNumericCode(CODE_LENGTH);
      await conn.query("INSERT INTO settings(k,v) VALUES('current_code',?)", [first]);
      console.log("Init current_code:", first);
    }
  } finally {
    conn.release();
  }
  console.log("DB OK");
}

// ===================== PANEL (solo ver) =====================
// Autenticación simple por header o query (?p=)
function panelAuthOk(req) {
  const p = req.query.p || req.headers["x-panel-password"] || "";
  return String(p) === String(PANEL_PASSWORD);
}

// Devuelve el código actual (solo panel)
app.get("/api/panel/current", async (req, res) => {
  try {
    if (!panelAuthOk(req)) return res.status(401).json({ error: "No autorizado" });

    const [rows] = await pool.query("SELECT v, updated_at FROM settings WHERE k='current_code' LIMIT 1");
    res.json({ ok: true, code: rows?.[0]?.v || "", updated_at: rows?.[0]?.updated_at || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error servidor" });
  }
});

// ===================== REDEEM (rota código) =====================
app.post("/api/redeem", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || null;
  const ua = req.headers["user-agent"] || null;

  try {
    const code = String(req.body.code || "").trim();
    const re = new RegExp(`^\\d{${CODE_LENGTH}}$`);
    if (!re.test(code)) return res.status(400).json({ error: "Código inválido" });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // lock del row para evitar doble canje simultáneo
      const [rows] = await conn.query(
        "SELECT v FROM settings WHERE k='current_code' LIMIT 1 FOR UPDATE"
      );
      const current = rows?.[0]?.v;

      if (!current) {
        await conn.rollback();
        return res.status(500).json({ error: "Código no inicializado" });
      }

      if (code !== current) {
        await conn.rollback();
        return res.status(401).json({ error: "Código incorrecto" });
      }

      // rotar a nuevo código (distinto al actual)
      let next;
      do { next = genNumericCode(CODE_LENGTH); } while (next === current);

      await conn.query("UPDATE settings SET v=? WHERE k='current_code'", [next]);
      await conn.query("INSERT INTO redeems(code_used, ip, ua) VALUES(?,?,?)", [code, ip, ua]);

      await conn.commit();

      // ok: redirigir al APK
      res.json({ ok: true, redirect: APK_URL });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error servidor" });
  }
});

initDb()
  .then(() => app.listen(PORT, () => console.log("OK on", PORT)))
  .catch((e) => {
    console.error("Fallo initDb:", e.message);
    process.exit(1);
  });
