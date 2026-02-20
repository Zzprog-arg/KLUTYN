const Panel = (() => {
  async function api(path, opts = {}) {
    const r = await fetch(path, opts);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Error");
    return j;
  }

  async function refreshList() {
    const key = document.getElementById("key").value.trim();
    const url = key ? `/api/admin/list?key=${encodeURIComponent(key)}` : `/api/admin/list`;
    const j = await api(url);
    const tbody = document.getElementById("tbody");
    tbody.innerHTML = "";

    for (const row of j.rows) {
      const tr = document.createElement("tr");

      const tdCode = document.createElement("td");
      tdCode.textContent = row.code;

      const tdState = document.createElement("td");
      tdState.innerHTML = row.used ? `<span class="used">USADO</span>` : `<span class="free">LIBRE</span>`;

      const tdCreated = document.createElement("td");
      tdCreated.textContent = row.created_at || "";

      const tdUsedAt = document.createElement("td");
      tdUsedAt.textContent = row.used_at || "";

      tr.appendChild(tdCode);
      tr.appendChild(tdState);
      tr.appendChild(tdCreated);
      tr.appendChild(tdUsedAt);

      tbody.appendChild(tr);
    }

    document.getElementById("status").textContent = "OK";
  }

  async function generate(e) {
    e.preventDefault();
    const key = document.getElementById("key").value.trim();
    const qty = Number(document.getElementById("qty").value || 10);
    const len = Number(document.getElementById("len").value || 4);

    const url = key ? `/api/admin/generate?key=${encodeURIComponent(key)}` : `/api/admin/generate`;

    const j = await api(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ qty, len })
    });

    document.getElementById("out").value = (j.codes || []).join("\n");
    await refreshList();
  }

  function init() {
    document.getElementById("genForm").addEventListener("submit", generate);
    refreshList().catch(err => {
      document.getElementById("status").textContent = "Error: " + err.message;
    });
  }

  return { init };
})();
