// redeem.js
const LEN = 4;

const box = document.getElementById("box");
const pinWrap = document.getElementById("pinWrap");
const realInput = document.getElementById("realInput");
const msg = document.getElementById("msg");

let submitting = false;

function setMessage(t) {
  msg.textContent = t || "";
}

function sanitize(v) {
  return (v || "").replace(/\D/g, "").slice(0, LEN);
}

function renderDigits(code) {
  for (let i = 0; i < LEN; i++) {
    document.getElementById("d" + i).textContent = code[i] || "";
  }
}

function setCode(code) {
  const s = sanitize(code);
  realInput.value = s;
  renderDigits(s);
  return s;
}

function reset() {
  submitting = false;
  setMessage("");
  setCode("");
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

/* =========================
   TECLADO NATIVO: BEST EFFORT
   ========================= */

function openKeyboard() {
  try { realInput.focus({ preventScroll: true }); } catch { realInput.focus(); }
}

function attemptAutoKeyboard() {
  // Intento escalonado: algunos TV Box ignoran focus inmediato
  openKeyboard();
  requestAnimationFrame(() => openKeyboard());
  setTimeout(() => openKeyboard(), 200);
  setTimeout(() => openKeyboard(), 600);
  setTimeout(() => openKeyboard(), 1200);
}

// Visual de foco
realInput.addEventListener("focus", () => pinWrap.classList.add("focused"));
realInput.addEventListener("blur",  () => pinWrap.classList.remove("focused"));

// Entrada principal (lo que escriba el IME nativo)
realInput.addEventListener("input", () => {
  if (submitting) return;
  const code = sanitize(realInput.value);
  if (realInput.value !== code) realInput.value = code;
  renderDigits(code);
  if (code.length === LEN) validateAndGo(code);
});

// Click/OK/Enter para fallback
pinWrap.addEventListener("click", openKeyboard);
box.addEventListener("click", openKeyboard);

document.addEventListener("keydown", (e) => {
  if (submitting) return;

  // OK/Enter: fallback para abrir teclado
  if (e.key === "Enter") {
    openKeyboard();
    return;
  }

  // ✅ NÚMEROS DEL CONTROL SIN OK
  // Si el control tiene 0-9, capturamos aunque no esté enfocado.
  if (e.key >= "0" && e.key <= "9") {
    // Si el input ya está enfocado, dejamos que el sistema lo maneje (mejor para IME).
    if (document.activeElement === realInput) return;

    // Si NO está enfocado, hacemos fallback: agregamos nosotros el dígito
    // (esto permite usar control numérico sin abrir teclado).
    const current = sanitize(realInput.value);
    if (current.length >= LEN) return;

    // Evitamos que el número vaya a otro lado
    e.preventDefault();

    setCode(current + e.key);
    openKeyboard(); // por si el sistema decide abrir IME al primer número
    const code = sanitize(realInput.value);
    if (code.length === LEN) validateAndGo(code);
    return;
  }

  // ✅ BORRAR (control / teclado)
  if (e.key === "Backspace" || e.key === "Delete") {
    // Si el input está enfocado, dejamos que borre normal; solo re-render después.
    if (document.activeElement === realInput) {
      setTimeout(() => {
        const code = sanitize(realInput.value);
        if (realInput.value !== code) realInput.value = code;
        renderDigits(code);
      }, 0);
      return;
    }

    // Si NO está enfocado, borramos nosotros (fallback remoto)
    e.preventDefault();
    const current = sanitize(realInput.value);
    setCode(current.slice(0, -1));
    openKeyboard(); // por si el sistema abre IME con interacción
    return;
  }
});

// Si vuelve de background / cambia visibilidad, reintentar auto-teclado
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !submitting) attemptAutoKeyboard();
});

window.addEventListener("load", () => {
  reset();
  // ✅ intento automático (si el TV lo permite, aparece solo)
  attemptAutoKeyboard();
});
