const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const DB_URL =
  process.env.DATABASE_URL ||
  "mysql://Xuper_fairlyleaf:5ff8226cca4857e7d7112cb66aa782d0f500c76b@g8mjw7.h.filess.io:3307/Xuper_fairlyleaf";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

let pool;

async function initDb() {
  pool = mysql.createPool(DB_URL);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS flow_accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      flow_user VARCHAR(100) NOT NULL,
      flow_pass VARCHAR(100) NOT NULL,
      note VARCHAR(255) DEFAULT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_name VARCHAR(120) NOT NULL,
      phone VARCHAR(50) DEFAULT NULL,
      expires_at DATETIME NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_id INT NOT NULL,
      flow_account_id INT NOT NULL,
      device_label VARCHAR(80) DEFAULT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX(client_id),
      INDEX(flow_account_id)
    )
  `);

  console.log("DB OK");
}

async function refreshExpired() {
  await pool.query(`
    UPDATE clients
    SET status = 'expired'
    WHERE expires_at < NOW() AND status <> 'expired'
  `);
}

async function getFlowUsedSlots(flowId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM assignments
     WHERE flow_account_id = ? AND active = 1`,
    [flowId]
  );
  return Number(rows[0]?.c || 0);
}

async function getClientFirstFlow(clientId) {
  const [rows] = await pool.query(
    `SELECT flow_account_id
     FROM assignments
     WHERE client_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [clientId]
  );
  return rows[0]?.flow_account_id || null;
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    await refreshExpired();

    const [[flowRow]] = await pool.query(
      "SELECT COUNT(*) AS c FROM flow_accounts WHERE active = 1"
    );
    const [[clientRow]] = await pool.query("SELECT COUNT(*) AS c FROM clients");
    const [[activeRow]] = await pool.query(
      "SELECT COUNT(*) AS c FROM clients WHERE status = 'active'"
    );
    const [[expiredRow]] = await pool.query(
      "SELECT COUNT(*) AS c FROM clients WHERE status = 'expired'"
    );

    res.json({
      flow: flowRow.c,
      clients: clientRow.c,
      active: activeRow.c,
      expired: expiredRow.c,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/flow", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        f.*,
        (
          SELECT COUNT(*)
          FROM assignments a
          WHERE a.flow_account_id = f.id AND a.active = 1
        ) AS used_slots
      FROM flow_accounts f
      ORDER BY f.id DESC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/flow", async (req, res) => {
  try {
    const { flow_user, flow_pass, note } = req.body;

    if (!flow_user || !flow_pass) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    await pool.query(
      `INSERT INTO flow_accounts (flow_user, flow_pass, note)
       VALUES (?, ?, ?)`,
      [flow_user.trim(), flow_pass.trim(), (note || "").trim()]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/flow/import", async (req, res) => {
  try {
    const { bulk } = req.body;
    if (!bulk) {
      return res.status(400).json({ error: "No hay líneas para importar" });
    }

    const lines = bulk.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    let ok = 0;
    let fail = 0;

    for (const line of lines) {
      const parts = line.split("|");
      const flow_user = (parts[0] || "").trim();
      const flow_pass = (parts[1] || "").trim();
      const note = (parts[2] || "").trim();

      if (!flow_user || !flow_pass) {
        fail++;
        continue;
      }

      try {
        await pool.query(
          `INSERT INTO flow_accounts (flow_user, flow_pass, note)
           VALUES (?, ?, ?)`,
          [flow_user, flow_pass, note]
        );
        ok++;
      } catch {
        fail++;
      }
    }

    res.json({ ok, fail });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/flow/:id", async (req, res) => {
  try {
    const flowId = Number(req.params.id);
    if (!flowId) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const used = await getFlowUsedSlots(flowId);

    // borra asignaciones de ese flow y luego la cuenta flow
    await pool.query(`DELETE FROM assignments WHERE flow_account_id = ?`, [flowId]);
    await pool.query(`DELETE FROM flow_accounts WHERE id = ?`, [flowId]);

    res.json({ ok: true, usedSlots: used });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/flow/available", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        f.id,
        f.flow_user,
        (
          SELECT COUNT(*)
          FROM assignments a
          WHERE a.flow_account_id = f.id AND a.active = 1
        ) AS used_slots
      FROM flow_accounts f
      WHERE f.active = 1
      HAVING used_slots < 2
      ORDER BY used_slots ASC, f.id ASC
    `);

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/clients", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await refreshExpired();

    const {
      client_name,
      phone,
      flow_account_id,
      device_label,
      days,
    } = req.body;

    const safeDays = Math.max(1, Math.min(Number(days || 30), 31));
    const flowId = Number(flow_account_id);

    if (!client_name || !flowId) {
      conn.release();
      return res.status(400).json({ error: "Faltan datos" });
    }

    const used = await getFlowUsedSlots(flowId);
    if (used >= 2) {
      conn.release();
      return res.status(400).json({ error: "Sin Disp.: cuenta Flow ocupada (2/2)" });
    }

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO clients (client_name, phone, expires_at, status)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), 'active')`,
      [client_name.trim(), (phone || "").trim(), safeDays]
    );

    const clientId = result.insertId;

    await conn.query(
      `INSERT INTO assignments (client_id, flow_account_id, device_label, active)
       VALUES (?, ?, ?, 1)`,
      [clientId, flowId, (device_label || "Disp 1").trim()]
    );

    await conn.commit();
    conn.release();

    res.json({ ok: true, clientId });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    conn.release();
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/clients", async (req, res) => {
  try {
    await refreshExpired();

    const warnDays = Math.max(1, Number(req.query.warnDays || 3));

    const [running] = await pool.query(
      `SELECT *
       FROM clients
       WHERE status = 'active'
         AND expires_at >= DATE_ADD(NOW(), INTERVAL ? DAY)
       ORDER BY expires_at ASC`,
      [warnDays]
    );

    const [warning] = await pool.query(
      `SELECT *
       FROM clients
       WHERE status = 'active'
         AND expires_at < DATE_ADD(NOW(), INTERVAL ? DAY)
       ORDER BY expires_at ASC`,
      [warnDays]
    );

    const [expired] = await pool.query(
      `SELECT *
       FROM clients
       WHERE status = 'expired'
       ORDER BY expires_at DESC`
    );

    res.json({ running, warning, expired });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/clients/:id", async (req, res) => {
  try {
    await refreshExpired();

    const clientId = Number(req.params.id);

    const [[client]] = await pool.query(
      `SELECT * FROM clients WHERE id = ?`,
      [clientId]
    );

    if (!client) {
      return res.status(404).json({ error: "Cliente no existe" });
    }

    const [assignments] = await pool.query(
      `SELECT
         a.*,
         f.flow_user,
         f.flow_pass
       FROM assignments a
       JOIN flow_accounts f ON f.id = a.flow_account_id
       WHERE a.client_id = ?
       ORDER BY a.id ASC`,
      [clientId]
    );

    const flowId = await getClientFirstFlow(clientId);
    let used = 0;
    if (flowId) used = await getFlowUsedSlots(flowId);

    res.json({
      client,
      assignments,
      canAddDevice: client.status === "active" && flowId && used < 2,
      usedSlots: used,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/clients/:id/device", async (req, res) => {
  try {
    await refreshExpired();

    const clientId = Number(req.params.id);
    const deviceLabel = (req.body.device_label || "Disp 2").trim();

    const [[client]] = await pool.query(
      `SELECT * FROM clients WHERE id = ?`,
      [clientId]
    );

    if (!client) {
      return res.status(404).json({ error: "Cliente no existe" });
    }

    if (client.status !== "active") {
      return res.status(400).json({ error: "Cliente vencido" });
    }

    const flowId = await getClientFirstFlow(clientId);
    if (!flowId) {
      return res.status(400).json({ error: "Cliente sin cuenta Flow asignada" });
    }

    const used = await getFlowUsedSlots(flowId);
    if (used >= 2) {
      return res.status(400).json({ error: "Sin Disp.: cuenta Flow ocupada (2/2)" });
    }

    await pool.query(
      `INSERT INTO assignments (client_id, flow_account_id, device_label, active)
       VALUES (?, ?, ?, 1)`,
      [clientId, flowId, deviceLabel]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/clients/:id/extend", async (req, res) => {
  try {
    const clientId = Number(req.params.id);

    await pool.query(
      `UPDATE clients
       SET expires_at = DATE_ADD(expires_at, INTERVAL 30 DAY)
       WHERE id = ? AND status = 'active'`,
      [clientId]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/clients/:id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const clientId = Number(req.params.id);

    const [[client]] = await conn.query(
      `SELECT * FROM clients WHERE id = ?`,
      [clientId]
    );

    if (!client) {
      conn.release();
      return res.status(404).json({ error: "Cliente no existe" });
    }

    await conn.beginTransaction();
    await conn.query(`DELETE FROM assignments WHERE client_id = ?`, [clientId]);
    await conn.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    await conn.commit();
    conn.release();

    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    conn.release();
    res.status(500).json({ error: e.message });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor en http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("Error iniciando DB:", e.message);
    process.exit(1);
  });