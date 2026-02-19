require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { initDb } = require("./db");
const { auth, validateUsername, validatePassword, addDurationMs } = require("./middleware");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";
const DB_PATH = process.env.DB_PATH || "./data/klutyn.sqlite";

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// ---- DB init ----
const db = initDb(DB_PATH, path.join(__dirname, "schema.sql"));

function seedAdmin() {
  const row = db.prepare("SELECT id FROM resellers WHERE username=?").get(ADMIN_USER);
  if (row) return;

  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  db.prepare("INSERT INTO resellers (username, password_hash, created_at) VALUES (?, ?, ?)")
    .run(ADMIN_USER, hash, Date.now());

  console.log("Admin reseller creado:", ADMIN_USER);
}
seedAdmin();

// ---- Static web (login + panel) ----
app.use("/", express.static(path.join(__dirname, "..", "web")));

// =====================
// API AUTH
// =====================
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};

  if (!validateUsername(username) || typeof password !== "string") {
    return res.status(400).json({ error: "Credenciales inválidas" });
  }

  const r = db
    .prepare("SELECT id, username, password_hash FROM resellers WHERE username=?")
    .get(username);

  if (!r) return res.status(401).json({ error: "Usuario o contraseña incorrectos" });

  const ok = bcrypt.compareSync(password, r.password_hash);
  if (!ok) return res.status(401).json({ error: "Usuario o contraseña incorrectos" });

  const token = jwt.sign(
    { resellerId: r.id, username: r.username },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token, reseller: { id: r.id, username: r.username } });
});

// =====================
// API USERS (PANEL)
// =====================
app.get("/api/users", auth(JWT_SECRET), (req, res) => {
  const resellerId = req.auth.resellerId;

  const rows = db.prepare(`
    SELECT id, username, password_plain, expires_at, created_at, updated_at
    FROM users
    WHERE reseller_id=?
    ORDER BY expires_at ASC
  `).all(resellerId);

  const now = Date.now();
  const mapped = rows.map(u => {
    const remainingMs = u.expires_at - now;
    return { ...u, remainingMs, isExpired: remainingMs <= 0 };
  });

  res.json({ users: mapped });
});

app.post("/api/users", auth(JWT_SECRET), (req, res) => {
  const resellerId = req.auth.resellerId;
  const { username, password, duration } = req.body || {};

  if (!validateUsername(username)) {
    return res.status(400).json({ error: "Nombre inválido (3-24, letras/números/_-)" });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: "Contraseña inválida (4-64)" });
  }

  const add = addDurationMs(duration);
  if (!add) return res.status(400).json({ error: "Caducidad inválida" });

  const exists = db
    .prepare("SELECT id FROM users WHERE reseller_id=? AND username=?")
    .get(resellerId, username);

  if (exists) return res.status(409).json({ error: "Ese usuario ya existe" });

  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const expiresAt = now + add;

  const info = db.prepare(`
    INSERT INTO users (reseller_id, username, password_hash, password_plain, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(resellerId, username, hash, password, expiresAt, now, now);

  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

app.post("/api/users/:id/renew", auth(JWT_SECRET), (req, res) => {
  const resellerId = req.auth.resellerId;
  const id = Number(req.params.id);
  const { duration } = req.body || {};

  const add = addDurationMs(duration);
  if (!add) return res.status(400).json({ error: "Caducidad inválida" });

  const u = db
    .prepare("SELECT id, expires_at FROM users WHERE id=? AND reseller_id=?")
    .get(id, resellerId);

  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });

  const now = Date.now();
  const base = u.expires_at > now ? u.expires_at : now;
  const newExpires = base + add;

  db.prepare("UPDATE users SET expires_at=?, updated_at=? WHERE id=? AND reseller_id=?")
    .run(newExpires, now, id, resellerId);

  res.json({ ok: true, expires_at: newExpires });
});

app.post("/api/users/:id/password", auth(JWT_SECRET), (req, res) => {
  const resellerId = req.auth.resellerId;
  const id = Number(req.params.id);
  const { password } = req.body || {};

  if (!validatePassword(password)) {
    return res.status(400).json({ error: "Contraseña inválida (4-64)" });
  }

  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();

  const info = db.prepare(`
    UPDATE users
    SET password_hash=?, password_plain=?, updated_at=?
    WHERE id=? AND reseller_id=?
  `).run(hash, password, now, id, resellerId);

  if (info.changes === 0) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json({ ok: true });
});

app.put("/api/users/:id", auth(JWT_SECRET), (req, res) => {
  const resellerId = req.auth.resellerId;
  const id = Number(req.params.id);
  const { username, password } = req.body || {};

  const u = db.prepare("SELECT id FROM users WHERE id=? AND reseller_id=?").get(id, resellerId);
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });

  const now = Date.now();

  if (username) {
    if (!validateUsername(username)) {
      return res.status(400).json({ error: "Nombre invalido (3-24, letras/numeros/_-)" });
    }
    const dup = db.prepare("SELECT id FROM users WHERE reseller_id=? AND username=? AND id!=?").get(resellerId, username, id);
    if (dup) return res.status(409).json({ error: "Ese nombre de usuario ya existe" });

    db.prepare("UPDATE users SET username=?, updated_at=? WHERE id=? AND reseller_id=?")
      .run(username, now, id, resellerId);
  }

  if (password) {
    if (!validatePassword(password)) {
      return res.status(400).json({ error: "Contrasena invalida (4-64)" });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET password_hash=?, password_plain=?, updated_at=? WHERE id=? AND reseller_id=?")
      .run(hash, password, now, id, resellerId);
  }

  res.json({ ok: true });
});

app.delete("/api/users/:id", auth(JWT_SECRET), (req, res) => {
  const resellerId = req.auth.resellerId;
  const id = Number(req.params.id);

  const info = db.prepare("DELETE FROM users WHERE id=? AND reseller_id=?").run(id, resellerId);
  if (info.changes === 0) return res.status(404).json({ error: "Usuario no encontrado" });

  res.json({ ok: true });
});

// =====================
// IPTV: M3U POR USUARIO/PASS
// =====================
// URL: /get/hola/hola123/lista.m3u
app.get("/get/:username/:password/lista.m3u", (req, res) => {
  const { username, password } = req.params;

  // NOTA: por ahora no filtramos por reseller_id, porque el acceso es "público por link".
  // Luego, si querés, lo hacemos /get/:reseller/:user/:pass/lista.m3u
  const user = db.prepare(`
    SELECT password_hash, expires_at
    FROM users
    WHERE username = ?
  `).get(username);

  if (!user) return res.status(401).send("Usuario inválido");

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).send("Contraseña incorrecta");

  if (Date.now() > user.expires_at) return res.status(403).send("Cuenta vencida");

  // ✅ Busca lista.m3u desde la raíz real del deploy
  const filePath = path.join(process.cwd(), "lista.m3u");

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("No se encontró lista.m3u en la raíz del proyecto");
  }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="lista.m3u"');
    res.setHeader("Cache-Control", "no-store");
    return res.sendFile(filePath);

});

// =====================
// DEBUG: ¿Existe lista.m3u en Render?
// (borrarlo cuando ya funcione)
// =====================
app.get("/debug-m3u", (req, res) => {
  const filePath = path.join(process.cwd(), "lista.m3u");
  res.json({
    cwd: process.cwd(),
    filePath,
    exists: fs.existsSync(filePath)
  });
});

app.listen(PORT, () => console.log("Klutyn Panel OK:", PORT));
