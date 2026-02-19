const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Servidor IPTV activo"));

app.get("/lista.m3u", (req, res) => {
  const filePath = path.join(__dirname, "lista.m3u");

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("No se encontró lista.m3u en el servidor");
  }

  res.setHeader("Content-Type", "application/x-mpegURL; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="lista.m3u"');
  res.setHeader("Cache-Control", "no-store");

  res.sendFile(filePath);
});

app.listen(PORT, () => console.log("OK en puerto", PORT));
