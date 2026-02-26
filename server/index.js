require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { initDb, getPool } = require("./db");
const { auth, validateUsername, validatePassword, addDurationMs } = require("./middleware");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// ---- Static web (login + panel) ----
app.use("/", express.static(path.join(__dirname, "..", "web")));

// =====================
// API AUTH
// =====================
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!validateUsername(username) || typeof password !== "string") {
      return res.status(400).json({ error: "Credenciales invalidas" });
    }

    const pool = getPool();
    const [rows] = await pool.execute(
      "SELECT id, username, password_hash FROM resellers WHERE username=?",
      [username]
    );

    if (rows.length === 0) return res.status(401).json({ error: "Usuario o contrasena incorrectos" });

    const r = rows[0];
    const ok = bcrypt.compareSync(password, r.password_hash);
    if (!ok) return res.status(401).json({ error: "Usuario o contrasena incorrectos" });

    const token = jwt.sign(
      { resellerId: r.id, username: r.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, reseller: { id: r.id, username: r.username } });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

// =====================
// API USERS (PANEL)
// =====================
app.get("/api/users", auth(JWT_SECRET), async (req, res) => {
  try {
    const resellerId = req.auth.resellerId;
    const pool = getPool();

    const [rows] = await pool.execute(
      "SELECT id, username, password_plain, phone, expires_at, created_at, updated_at FROM users WHERE reseller_id=? ORDER BY expires_at ASC",
      [resellerId]
    );

    const now = Date.now();
    const mapped = rows.map((u) => {
      const remainingMs = Number(u.expires_at) - now;
      return { ...u, remainingMs, isExpired: remainingMs <= 0 };
    });

    res.json({ users: mapped });
  } catch (e) {
    console.error("GET users error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/users", auth(JWT_SECRET), async (req, res) => {
  try {
    const resellerId = req.auth.resellerId;
    const { username, password, duration, phone } = req.body || {};

    if (!validateUsername(username)) {
      return res.status(400).json({ error: "Nombre invalido (3-24, letras/numeros/_-)" });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({ error: "Contrasena invalida (4-64)" });
    }

    const add = addDurationMs(duration);
    if (!add) return res.status(400).json({ error: "Caducidad invalida" });

    const pool = getPool();

    const [exists] = await pool.execute(
      "SELECT id FROM users WHERE reseller_id=? AND username=?",
      [resellerId, username]
    );
    if (exists.length > 0) return res.status(409).json({ error: "Ese usuario ya existe" });

    const hash = bcrypt.hashSync(password, 10);
    const now = Date.now();
    const expiresAt = now + add;

    const cleanPhone = (phone || "").replace(/[^0-9+]/g, "");

    const [result] = await pool.execute(
      "INSERT INTO users (reseller_id, username, password_hash, password_plain, phone, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [resellerId, username, hash, password, cleanPhone, expiresAt, now, now]
    );

    res.status(201).json({ ok: true, id: result.insertId });
  } catch (e) {
    console.error("POST users error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/users/:id/renew", auth(JWT_SECRET), async (req, res) => {
  try {
    const resellerId = req.auth.resellerId;
    const id = Number(req.params.id);
    const { duration } = req.body || {};

    const add = addDurationMs(duration);
    if (!add) return res.status(400).json({ error: "Caducidad invalida" });

    const pool = getPool();

    const [rows] = await pool.execute(
      "SELECT id, expires_at FROM users WHERE id=? AND reseller_id=?",
      [id, resellerId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    const u = rows[0];
    const now = Date.now();
    const base = Number(u.expires_at) > now ? Number(u.expires_at) : now;
    const newExpires = base + add;

    await pool.execute(
      "UPDATE users SET expires_at=?, updated_at=? WHERE id=? AND reseller_id=?",
      [newExpires, now, id, resellerId]
    );

    res.json({ ok: true, expires_at: newExpires });
  } catch (e) {
    console.error("Renew error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/users/:id/password", auth(JWT_SECRET), async (req, res) => {
  try {
    const resellerId = req.auth.resellerId;
    const id = Number(req.params.id);
    const { password } = req.body || {};

    if (!validatePassword(password)) {
      return res.status(400).json({ error: "Contrasena invalida (4-64)" });
    }

    const hash = bcrypt.hashSync(password, 10);
    const now = Date.now();
    const pool = getPool();

    const [result] = await pool.execute(
      "UPDATE users SET password_hash=?, password_plain=?, updated_at=? WHERE id=? AND reseller_id=?",
      [hash, password, now, id, resellerId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Password error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.put("/api/users/:id", auth(JWT_SECRET), async (req, res) => {
  try {
    const resellerId = req.auth.resellerId;
    const id = Number(req.params.id);
    const { username, password, phone } = req.body || {};
    const pool = getPool();

    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE id=? AND reseller_id=?",
      [id, resellerId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    const now = Date.now();

    if (typeof phone === "string") {
      const cleanPhone = phone.replace(/[^0-9+]/g, "");
      await pool.execute(
        "UPDATE users SET phone=?, updated_at=? WHERE id=? AND reseller_id=?",
        [cleanPhone, now, id, resellerId]
      );
    }

    if (username) {
      if (!validateUsername(username)) {
        return res.status(400).json({ error: "Nombre invalido (3-24, letras/numeros/_-)" });
      }
      const [dup] = await pool.execute(
        "SELECT id FROM users WHERE reseller_id=? AND username=? AND id!=?",
        [resellerId, username, id]
      );
      if (dup.length > 0) return res.status(409).json({ error: "Ese nombre de usuario ya existe" });

      await pool.execute(
        "UPDATE users SET username=?, updated_at=? WHERE id=? AND reseller_id=?",
        [username, now, id, resellerId]
      );
    }

    if (password) {
      if (!validatePassword(password)) {
        return res.status(400).json({ error: "Contrasena invalida (4-64)" });
      }
      const hash = bcrypt.hashSync(password, 10);
      await pool.execute(
        "UPDATE users SET password_hash=?, password_plain=?, updated_at=? WHERE id=? AND reseller_id=?",
        [hash, password, now, id, resellerId]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("Edit error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.delete("/api/users/:id", auth(JWT_SECRET), async (req, res) => {
  try {
    const resellerId = req.auth.resellerId;
    const id = Number(req.params.id);
    const pool = getPool();

    const [result] = await pool.execute(
      "DELETE FROM users WHERE id=? AND reseller_id=?",
      [id, resellerId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ ok: true });
  } catch (e) {
    console.error("Delete error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

// =====================
// IPTV: M3U POR USUARIO/PASS
// =====================
app.get("/:username/lista.m3u", async (req, res) => {
  try {
    const { username } = req.params;
    const pool = getPool();

    const [rows] = await pool.execute(
      "SELECT expires_at FROM users WHERE username=?",
      [username]
    );

    if (rows.length === 0) return res.status(401).send("Usuario invalido");

    const user = rows[0];
    if (Date.now() > Number(user.expires_at)) return res.status(403).send("Cuenta vencida");

    const filePath = path.join(process.cwd(), "lista.m3u");

    if (!fs.existsSync(filePath)) {
      return res.status(404).send("No se encontro lista.m3u en la raiz del proyecto");
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="lista.m3u"');
    res.setHeader("Cache-Control", "no-store");
    return res.sendFile(filePath);
  } catch (e) {
    console.error("M3U error:", e);
    res.status(500).send("Error interno");
  }
});

// =====================
// DEBUG: lista.m3u check
// =====================
app.get("/debug-m3u", (req, res) => {
  const filePath = path.join(process.cwd(), "lista.m3u");
  res.json({
    cwd: process.cwd(),
    filePath,
    exists: fs.existsSync(filePath),
  });
});

// =====================
// STARTUP
// =====================
async function start() {
  try {
    await initDb(path.join(__dirname, "schema.sql"));
    console.log("MySQL conectado OK");

    // Seed admin reseller
    const pool = getPool();
    const [rows] = await pool.execute("SELECT id FROM resellers WHERE username=?", [ADMIN_USER]);
    if (rows.length === 0) {
      const hash = bcrypt.hashSync(ADMIN_PASS, 10);
      await pool.execute(
        "INSERT INTO resellers (username, password_hash, created_at) VALUES (?, ?, ?)",
        [ADMIN_USER, hash, Date.now()]
      );
      console.log("Admin reseller creado:", ADMIN_USER);
    }

    app.listen(PORT, () => console.log("Klutyn Panel OK:", PORT));
  } catch (e) {
    console.error("Error al iniciar:", e);
    process.exit(1);
  }
}

start();
