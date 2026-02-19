const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Servidor IPTV activo");
});

app.get("/lista.m3u", (req, res) => {
  res.sendFile(path.join(__dirname, "lista.m3u"));
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
