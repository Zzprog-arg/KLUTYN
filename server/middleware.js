const jwt = require("jsonwebtoken");

function auth(jwtSecret) {
  return (req, res, next) => {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "No autorizado" });

    try {
      const payload = jwt.verify(token, jwtSecret);
      req.auth = payload; // { resellerId, username }
      next();
    } catch {
      return res.status(401).json({ error: "Token inválido" });
    }
  };
}

function validateUsername(u) {
  // simple: letras, números, guion, guion bajo, 3-24
  return typeof u === "string" && /^[a-zA-Z0-9_-]{3,24}$/.test(u);
}

function validatePassword(p) {
  return typeof p === "string" && p.length >= 4 && p.length <= 64;
}

function addDurationMs(kind) {
  const H = 60 * 60 * 1000;
  const DAY = 24 * H;

  switch (kind) {
    case "1h": return 1 * H;
    case "1m": return 30 * DAY;   // mes aproximado
    case "2m": return 60 * DAY;
    case "3m": return 90 * DAY;
    default: return null;
  }
}

module.exports = { auth, validateUsername, validatePassword, addDurationMs };
