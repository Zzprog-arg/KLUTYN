const LEN = 4;

const box = document.getElementById("box");
const pinWrap = document.getElementById("pinWrap");
const realInput = document.getElementById("realInput");
const msg = document.getElementById("msg");

let submitting = false;

function setMessage(t) {
  msg.textContent = t || "";
}

function renderFromValue(v) {
  const s = (v || "").replace(/\D/g, "").slice(0, LEN);
  for (let i = 0; i < LEN; i++) {
    document.getElementById("d" + i).textContent = s[i] || "";
  }
  return s;
}

function reset() {
  submitting = false;
  realInput.value = "";
  renderFromValue("");
  setMessage("");
}

async function validateAndGo(code) {
  if (submitting) return;
  if (!/^\d{4}$/.test(code)) return;

  submitting = true;
  setMessage("");

  try {
    const r = await fetch("/api/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok) {
      setMessage(j.error || "Código incorrecto");
      setTimeout(() => reset(), 200);
      return;
    }

    window.location.href = j.redirect;
  } catch {
    setMessage("Error de conexión");
    submitting = false;
  }
}

/* ✅ Foco “con gesto del usuario” = más chances de que se abra el teclado */
function openKeyboard() {
  try { realInput.focus({ preventScroll: true }); } catch { realInput.focus(); }
}

/* Cuando el input toma foco, marcamos estado visual */
realInput.addEventListener("focus", () => pinWrap.classList.add("focused"));
realInput.addEventListener("blur",  () => pinWrap.classList.remove("focused"));

/* ✅ Entrada principal: lo que escribe el teclado del TV Box */
realInput.addEventListener("input", () => {
  if (submitting) return;

  const code = renderFromValue(realInput.value);

  // mantener el value saneado (solo dígitos, max 4)
  if (realInput.value !== code) realInput.value = code;

  if (code.length === LEN) validateAndGo(code);
});

/* ✅ Permitir abrir teclado con OK/Enter desde remoto */
box.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    // algunos remotos mandan Enter para “OK”
    openKeyboard();
  }
});

/* ✅ Click en la zona = foco al input */
pinWrap.addEventListener("click", openKeyboard);
box.addEventListener("click", () => {
  // click en la caja -> abre teclado
  openKeyboard();
});

/* ✅ Borrado extra con teclas del remoto (si las manda).
   OJO: no bloqueamos números para no romper el IME. */
document.addEventListener("keydown", (e) => {
  if (submitting) return;

  if (e.key === "Backspace" || e.key === "Delete") {
    // dejar que el input maneje borrado, pero aseguramos render
    // (algunos remotos no modifican el value si no hay foco)
    if (document.activeElement !== realInput) openKeyboard();
    // no preventDefault: el IME/ input debe borrar
    setTimeout(() => renderFromValue(realInput.value), 0);
  }
});

/* Inicial */
window.addEventListener("load", () => {
  renderFromValue("");
  // NO auto-focus fuerte: muchos TV Box no abren teclado sin gesto.
  // Dejamos listo para que con OK/Enter se abra.
});
