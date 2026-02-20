async function fetchCurrent(p) {
  const r = await fetch(`/api/panel/current?p=${encodeURIComponent(p)}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Error");
  return j;
}

function setMsg(text, isErr = false) {
  const el = document.getElementById("msg");
  el.textContent = text || "";
  el.className = isErr ? "err" : "muted";
}

async function loadCode() {
  const p = document.getElementById("pass").value;
  const j = await fetchCurrent(p);
  document.getElementById("code").textContent = j.code || "----";
  document.getElementById("upd").textContent = j.updated_at || "-";
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btn");
  const refresh = document.getElementById("refresh");

  btn.addEventListener("click", async () => {
    try {
      setMsg("Cargando...");
      await loadCode();
      document.getElementById("screen").style.display = "block";
      setMsg("OK");
    } catch (e) {
      document.getElementById("screen").style.display = "none";
      setMsg(e.message, true);
    }
  });

  refresh.addEventListener("click", async () => {
    try {
      setMsg("Actualizando...");
      await loadCode();
      setMsg("OK");
    } catch (e) {
      setMsg(e.message, true);
    }
  });
});
