const LEN = 4;

const box = document.getElementById("box");
const realInput = document.getElementById("realInput");
const msg = document.getElementById("msg");

let digits = ["", "", "", ""];
let cursor = 0;
let submitting = false;

function render() {
  for (let i = 0; i < LEN; i++) {
    document.getElementById("d" + i).textContent = digits[i];
    const el = document.querySelector(`.pin-box[data-idx="${i}"]`);
    el.classList.toggle("focused", i === cursor);
  }
}

function setMessage(t) {
  msg.textContent = t || "";
}

function hardFocus() {
  // clave para Android TV: intentar foco en input invisible y en contenedor
  try { realInput.focus({ preventScroll: true }); } catch {}
  try { box.focus({ preventScroll: true }); } catch {}
}

function reset() {
  digits = ["", "", "", ""];
  cursor = 0;
  submitting = false;
  render();
  hardFocus();
}

function addDigit(n) {
  if (submitting) return;
  if (cursor >= LEN) return;
  digits[cursor] = String(n);
  cursor = Math.min(LEN - 1, cursor + 1);
  render();

  if (digits.join("").length === LEN) validateAndGo();
}

function backspaceLike() {
  if (submitting) return;

  // borra donde estés; si está vacío, retrocede y borra
  if (digits[cursor]) {
    digits[cursor] = "";
  } else if (cursor > 0) {
    cursor--;
    digits[cursor] = "";
  }
  render();
}

function moveLeftAndDelete() {
  if (submitting) return;
  if (cursor > 0) cursor--;
  digits[cursor] = "";
  render();
}

async function validateAndGo() {
  if (submitting) return;
  const code = digits.join("");
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
      // reset rápido para reintentar
      setTimeout(() => reset(), 200);
      return;
    }

    window.location.href = j.redirect;
  } catch (e) {
    setMessage("Error de conexión");
    submitting = false;
  }
}

// Captura teclas en DOCUMENT (más compatible TV)
document.addEventListener("keydown", (e) => {
  // números
  if (e.key >= "0" && e.key <= "9") {
    e.preventDefault();
    addDigit(e.key);
    return;
  }

  // borrar (backspace/delete)
  if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    backspaceLike();
    return;
  }

  // flecha izq = borrar retrocediendo (como pediste)
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    moveLeftAndDelete();
    return;
  }

  // enter por si un remoto manda enter
  if (e.key === "Enter") {
    e.preventDefault();
    if (digits.join("").length === LEN) validateAndGo();
    return;
  }
});

// Por si el TV abre teclado y escribe en input
realInput.addEventListener("input", () => {
  if (submitting) return;
  const v = (realInput.value || "").replace(/\D/g, "").slice(0, LEN);
  for (let i = 0; i < LEN; i++) digits[i] = v[i] || "";
  cursor = Math.min(LEN - 1, v.length ? v.length - 1 : 0);
  render();
  if (v.length === LEN) validateAndGo();
});

// Click/tap
document.getElementById("pinRow").addEventListener("click", (e) => {
  const boxEl = e.target.closest(".pin-box");
  if (!boxEl) return;
  cursor = Number(boxEl.dataset.idx || 0);
  render();
  hardFocus();
});

// Reforzar foco siempre que vuelva a la página o se toque el contenedor
box.addEventListener("click", hardFocus);
window.addEventListener("load", () => { render(); hardFocus(); });
setInterval(() => { if (!submitting) hardFocus(); }, 1500);
