const token = localStorage.getItem("kp_token");
if (!token) location.href = "/";

const reseller = localStorage.getItem("kp_reseller") || "RESELLER";
document.getElementById("resellerTitle").textContent = `USUARIO DEL RESELLER: ${reseller}`;

document.getElementById("logoutBtn").onclick = () => {
  localStorage.removeItem("kp_token");
  localStorage.removeItem("kp_reseller");
  location.href = "/";
};

const toastEl = document.getElementById("toast");
function toast(t) {
  toastEl.style.display = "block";
  toastEl.textContent = t;
  setTimeout(() => (toastEl.style.display = "none"), 2500);
}

function pickPills(containerId) {
  const box = document.getElementById(containerId);
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-d]");
    if (!b) return;
    [...box.querySelectorAll(".pill")].forEach(x => x.classList.remove("active"));
    b.classList.add("active");
  });
  return () => box.querySelector(".pill.active")?.dataset?.d || "1m";
}

const getCreateDuration = pickPills("durPills");
const getRenewDuration = pickPills("renewPills");

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...(opts.headers || {})
    }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Error");
  return j;
}

function fmtRemaining(ms) {
  if (ms <= 0) return "Vencido";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);

  if (d >= 1) return `${d} día${d === 1 ? "" : "s"}`;
  if (h >= 1) return `${h} hora${h === 1 ? "" : "s"}`;
  if (m >= 1) return `${m} min`;
  return `${s} seg`;
}

let currentRenewId = null;

async function loadUsers() {
  const data = await api("/api/users");
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = "";

  data.users.forEach(u => {
    const tr = document.createElement("tr");

    const tdU = document.createElement("td");
    tdU.textContent = u.username;

    const tdT = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge" + (u.isExpired ? " expired" : "");
    badge.textContent = fmtRemaining(u.remainingMs);
    tdT.appendChild(badge);

    const tdA = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "rowactions";

    const renew = document.createElement("button");
    renew.className = "smallbtn";
    renew.textContent = "Renovar";
    renew.onclick = () => openRenew(u.id);

    const reset = document.createElement("button");
    reset.className = "smallbtn gray";
    reset.textContent = "Cambiar pass";
    reset.onclick = async () => {
      const np = prompt("Nueva contraseña (4-64):");
      if (!np) return;
      try {
        await api(`/api/users/${u.id}/password`, { method: "POST", body: JSON.stringify({ password: np }) });
        toast("Contraseña actualizada");
      } catch (e) { toast(e.message); }
    };

    const del = document.createElement("button");
    del.className = "smallbtn danger";
    del.textContent = "Borrar";
    del.onclick = async () => {
      if (!confirm(`¿Borrar ${u.username}?`)) return;
      try {
        await api(`/api/users/${u.id}`, { method: "DELETE" });
        toast("Usuario borrado");
        loadUsers();
      } catch (e) { toast(e.message); }
    };

    wrap.appendChild(renew);
    wrap.appendChild(reset);
    wrap.appendChild(del);
    tdA.appendChild(wrap);

    tr.appendChild(tdU);
    tr.appendChild(tdT);
    tr.appendChild(tdA);

    tbody.appendChild(tr);
  });
}

function openRenew(id) {
  currentRenewId = id;
  document.getElementById("renewModal").style.display = "block";
}
document.getElementById("closeRenew").onclick = () => {
  document.getElementById("renewModal").style.display = "none";
};

document.getElementById("doRenew").onclick = async () => {
  if (!currentRenewId) return;
  const duration = getRenewDuration();
  try {
    const r = await api(`/api/users/${currentRenewId}/renew`, { method: "POST", body: JSON.stringify({ duration }) });
    toast("Renovado OK");
    document.getElementById("renewModal").style.display = "none";
    loadUsers();
  } catch (e) { toast(e.message); }
};

// Create card toggle (mobile friendly)
const createCard = document.getElementById("createCard");
document.getElementById("openCreate").onclick = () => createCard.scrollIntoView({ behavior: "smooth" });
document.getElementById("closeCreate").onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });

document.getElementById("createBtn").onclick = async () => {
  const username = document.getElementById("newUser").value.trim();
  const password = document.getElementById("newPass").value;
  const duration = getCreateDuration();

  try {
    await api("/api/users", { method: "POST", body: JSON.stringify({ username, password, duration }) });
    toast("Usuario creado");
    document.getElementById("newUser").value = "";
    document.getElementById("newPass").value = "";
    loadUsers();
  } catch (e) { toast(e.message); }
};

loadUsers().catch(e => {
  toast("Sesión inválida, volvé a login");
  localStorage.removeItem("kp_token");
  setTimeout(() => location.href = "/", 1000);
});
