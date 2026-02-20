import express from "express";
import Database from "better-sqlite3";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// 👉 Tu APK en GitHub Releases (URL directa al asset)
const APK_URL = process.env.APK_URL || "https://github.com/TUUSER/TUREPO/releases/download/v1.0.0/app.apk";

// Panel sencillo con clave (recomendado). Si no querés clave, poné vacío y listo.
const ADMIN_KEY = process.env.ADMIN_KEY || "1234";

// Dónde guardar la DB. En Render, si usás Disk, poné /var/data
const DB_PATH = process.env.DB_PATH || "./data.sqlite";

const db = new Database(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS codes(
  code TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  used_at TEXT
);
`);

function genCode(len = 6) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

// ---------- Panel HTML (simple) ----------
app.get("/panel", (req, res) => {
  res.type("html").send(`
<!doctype html><html><head><meta charset="utf-8"><title>Panel</title>
<style>
body{font-family:Arial;max-width:780px;margin:30px auto}
input,button{padding:10px;border-radius:8px;border:1px solid #ccc}
.card{border:1px solid #ddd;border-radius:12px;padding:14px;margin:12px 0}
textarea{width:100%;font-size:16px}
</style></head><body>
<h2>Panel de códigos</h2>
<div class="card">
<form id="f">
Clave admin: <input id="k" value="${ADMIN_KEY}" />
Cantidad: <input id="q" type="number" value="10" min="1" max="200"/>
Largo: <input id="l" type="number" value="6" min="4" max="12"/>
<button>Generar</button>
</form>
</div>
<div class="card">
<h3>Generados</h3>
<textarea id="out" rows="8" placeholder="Acá aparecen..."></textarea>
</div>
<div class="card">
<h3>Últimos 50</h3>
<pre id="list">Cargando...</pre>
</div>
<script>
async function refresh(){
  const r = await fetch('/api/admin/list?key=' + encodeURIComponent(document.getElementById('k').value));
  document.getElementById('list').textContent = await r.text();
}
document.getElementById('f').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const key = document.getElementById('k').value;
  const qty = document.getElementById('q').value;
  const len = document.getElementById('l').value;
  const r = await fetch('/api/admin/generate?key='+encodeURIComponent(key),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({qty, len})
  });
  const j = await r.json();
  document.getElementById('out').value = (j.codes||[]).join('\\n');
  await refresh();
});
refresh();
</script>
</body></html>
  `);
});

function adminOk(req) {
  if (!ADMIN_KEY) return true; // si la dejás vacía, no pide clave
  return (req.query.key || "") === ADMIN_KEY;
}

// ---------- Admin: generar ----------
app.post("/api/admin/generate", (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: "No autorizado" });

  let qty = parseInt(req.body.qty ?? 10, 10);
  let len = parseInt(req.body.len ?? 6, 10);
  qty = Math.max(1, Math.min(200, qty));
  len = Math.max(4, Math.min(12, len));

  const insert = db.prepare("INSERT INTO codes(code, used) VALUES(?,0)");
  const exists = db.prepare("SELECT 1 FROM codes WHERE code=?");
  const codes = [];

  const tx = db.transaction(() => {
    for (let i = 0; i < qty; i++) {
      let c;
      do { c = genCode(len); } while (exists.get(c));
      insert.run(c);
      codes.push(c);
    }
  });
  tx();

  res.json({ qty: codes.length, codes });
});

// ---------- Admin: listar ----------
app.get("/api/admin/list", (req, res) => {
  if (!adminOk(req)) return res.status(401).send("No autorizado");
  const rows = db.prepare("SELECT code, used, used_at FROM codes ORDER BY rowid DESC LIMIT 50").all();
  const txt = rows.map(r => `${r.code}  ${r.used ? "USADO" : "LIBRE"}  ${r.used_at ?? ""}`).join("\n");
  res.type("text").send(txt || "Sin códigos todavía");
});

// ---------- Canje: valida y consume ----------
app.post("/api/redeem", (req, res) => {
  const code = String(req.body.code || "").trim();
  if (!/^\d{4,12}$/.test(code)) return res.status(400).json({ error: "Código inválido" });

  const row = db.prepare("SELECT used FROM codes WHERE code=?").get(code);
  if (!row) return res.status(404).json({ error: "Código inexistente" });
  if (row.used) return res.status(409).json({ error: "Código ya usado" });

  const upd = db.prepare("UPDATE codes SET used=1, used_at=datetime('now') WHERE code=? AND used=0").run(code);
  if (!upd.changes) return res.status(409).json({ error: "Código ya usado" });

  // Redirigir al APK
  res.json({ ok: true, redirect: APK_URL });
});

// ---------- Página simple para canje (si querés usar tu redeem_form.html aparte, ignorá esto) ----------
app.get("/", (req, res) => {
  res.type("html").send(`<form method="POST" action="/redeem">
  <input name="code" placeholder="Código">
  <button>Canjear</button></form>`);
});

// helper: canje por form POST y redirect real
app.post("/redeem", async (req, res) => {
  const code = String(req.body.code || "").trim();
  if (!/^\d{4,12}$/.test(code)) return res.status(400).send("Código inválido");

  const row = db.prepare("SELECT used FROM codes WHERE code=?").get(code);
  if (!row) return res.status(404).send("Código inexistente");
  if (row.used) return res.status(409).send("Código ya usado");

  const upd = db.prepare("UPDATE codes SET used=1, used_at=datetime('now') WHERE code=? AND used=0").run(code);
  if (!upd.changes) return res.status(409).send("Código ya usado");

  res.redirect(302, APK_URL);
});

app.listen(PORT, () => console.log("OK on", PORT));
