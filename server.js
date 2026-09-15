const express = require("express");
const http = require("node:http");
const path = require("node:path");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { query, createPool } = require("./lib/database");
const valid = require("./lib/validation");
const DEMO_KEY = "airwatch-default-secret-key-123456";

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("Set a persistent JWT_SECRET of at least 32 characters");
}
function signToken(user, secret) {
  return jwt.sign({ sub: String(user.id) }, secret, {
    algorithm: "HS256",
    expiresIn: "7d",
  });
}
async function verifyUser(db, token, secret) {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  if (!valid.deviceId(payload.sub)) throw new Error("Invalid subject");
  const [user] = await query(
    db,
    "SELECT id, username, email, role FROM users WHERE id = ?",
    [Number(payload.sub)],
  );
  if (!user) throw new Error("Account unavailable");
  return { user, expiresAt: payload.exp * 1000 };
}
function rateLimit(max = 20) {
  const entries = new Map();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, e] of entries) if (e.until <= now) entries.delete(key);
    let e = entries.get(req.ip);
    if (!e) {
      if (entries.size >= 10000)
        return res
          .status(429)
          .json({ error: "ระบบมีคำขอจำนวนมาก กรุณาลองใหม่ภายหลัง" });
      e = { count: 0, until: now + 60000 };
      entries.set(req.ip, e);
    }
    if (++e.count > max) {
      res.set("Retry-After", String(Math.ceil((e.until - now) / 1000)));
      return res
        .status(429)
        .json({ error: "ลองหลายครั้งเกินไป กรุณารอสักครู่" });
    }
    next();
  };
}
function createApp({ db, io, jwtSecret }) {
  requireSecret(jwtSecret);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "4kb" }));
  app.get("/vendor/chart.umd.js", (req, res) =>
    res.sendFile(
      path.join(path.dirname(require.resolve("chart.js")), "chart.umd.js"),
    ),
  );
  app.use(express.static(path.join(__dirname, "public")));
  const auth = async (req, res, next) => {
    const h = req.get("Authorization") || "";
    if (!h.startsWith("Bearer "))
      return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
    try {
      req.user = (await verifyUser(db, h.slice(7), jwtSecret)).user;
    } catch (err) {
      if (err.code) return next(err);
      return res
        .status(401)
        .json({ error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
    }
    next();
  };
  const admin = (req, res, next) =>
    req.user.role === "admin"
      ? next()
      : res.status(403).json({ error: "เฉพาะผู้ดูแลระบบ" });
  const limited = rateLimit();
  app.post("/api/auth/register", limited, async (req, res) => {
    const { username, email, password } = req.body || {};
    if (
      !valid.text(username, 3, 50) ||
      !valid.email(email) ||
      !valid.password(password)
    ) {
      return res
        .status(400)
        .json({
          error:
            "ใช้ชื่อ 3–50 ตัวอักษร อีเมลถูกต้อง และรหัสผ่าน 12 ตัวอักษรขึ้นไป (ไม่เกิน 72 ไบต์)",
        });
    }
    const hash = await bcrypt.hash(password, 10);
    try {
      // Public registration cannot create an admin, even for the first user.
      const r = await query(
        db,
        "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'user')",
        [username.trim(), email.trim().toLowerCase(), hash],
      );
      const user = {
        id: r.insertId,
        username: username.trim(),
        email: email.trim().toLowerCase(),
        role: "user",
      };
      res.status(201).json({ token: signToken(user, jwtSecret), user });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "ชื่อหรืออีเมลนี้ถูกใช้แล้ว" });
      throw err;
    }
  });
  app.post("/api/auth/login", limited, async (req, res) => {
    const { email, password } = req.body || {};
    if (
      !valid.email(email) ||
      typeof password !== "string" ||
      Buffer.byteLength(password) > 72
    )
      return res
        .status(400)
        .json({ error: "กรุณากรอกอีเมลและรหัสผ่านให้ถูกต้อง" });
    const [row] = await query(db, "SELECT * FROM users WHERE email = ?", [
      email.trim().toLowerCase(),
    ]);
    if (!row || !(await bcrypt.compare(password, row.password_hash)))
      return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    const user = {
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
    };
    res.json({ token: signToken(user, jwtSecret), user });
  });
  app.get("/api/auth/me", auth, (req, res) => res.json(req.user));
  const deviceColumns =
    "id, device_name, owner_id, last_seen_at, created_at, (last_seen_at >= NOW() - INTERVAL 15 SECOND) AS is_online";
  app.get("/api/devices", auth, async (req, res) =>
    res.json(
      await query(
        db,
        "SELECT " +
          deviceColumns +
          " FROM devices WHERE owner_id = ? ORDER BY id DESC",
        [req.user.id],
      ),
    ),
  );
  app.post("/api/devices", auth, async (req, res) => {
    const name = req.body?.device_name;
    if (!valid.text(name, 1, 100))
      return res
        .status(400)
        .json({ error: "ชื่ออุปกรณ์ต้องมี 1–100 ตัวอักษร" });
    const key = randomBytes(24).toString("hex");
    const r = await query(
      db,
      "INSERT INTO devices (device_key, device_name, owner_id) VALUES (?, ?, ?)",
      [key, name.trim(), req.user.id],
    );
    res
      .status(201)
      .json({ id: r.insertId, device_name: name.trim(), device_key: key });
  });
  app.post("/api/devices/claim", auth, async (req, res) => {
    const key = req.body?.device_key,
      name = req.body?.device_name;
    if (
      !valid.deviceKey(key) ||
      (name !== undefined && !valid.text(name, 1, 100))
    )
      return res.status(400).json({ error: "รหัสอุปกรณ์หรือชื่อไม่ถูกต้อง" });
    const [d] = await query(
      db,
      "SELECT id, owner_id, device_key FROM devices WHERE device_key = ?",
      [key],
    );
    if (!d || d.device_key !== key)
      return res
        .status(404)
        .json({ error: "ไม่พบอุปกรณ์ กรุณาสร้างอุปกรณ์ใหม่เพื่อรับรหัส" });
    if (d.owner_id === req.user.id)
      return res.json({ id: d.id, message: "อุปกรณ์นี้เป็นของคุณแล้ว" });
    if (d.owner_id !== null)
      return res.status(409).json({ error: "อุปกรณ์มีเจ้าของแล้ว" });
    const r = await query(
      db,
      "UPDATE devices SET owner_id = ?, device_name = COALESCE(?, device_name) WHERE id = ? AND owner_id IS NULL",
      [req.user.id, name?.trim() || null, d.id],
    );
    if (r.affectedRows !== 1)
      return res
        .status(409)
        .json({ error: "อุปกรณ์ถูกผูกกับบัญชีอื่นแล้ว กรุณาโหลดใหม่" });
    res.json({ id: d.id, message: "ผูกอุปกรณ์สำเร็จ" });
  });
  async function device(req, res, id) {
    if (!valid.deviceId(id)) {
      res.status(400).json({ error: "กรุณาเลือกอุปกรณ์" });
      return null;
    }
    const [d] = await query(
      db,
      "SELECT id, device_name, owner_id FROM devices WHERE id = ?",
      [Number(id)],
    );
    if (!d || (d.owner_id !== req.user.id && req.user.role !== "admin")) {
      res.status(404).json({ error: "ไม่พบอุปกรณ์ที่คุณมีสิทธิ์เข้าถึง" });
      return null;
    }
    return d;
  }
  app.get("/api/devices/:id/key", auth, async (req, res) => {
    const d = await device(req, res, req.params.id);
    if (!d) return;
    const [r] = await query(db, "SELECT device_key FROM devices WHERE id = ?", [
      d.id,
    ]);
    res.json(r);
  });
  app.post("/api/devices/:id/rotate-key", auth, async (req, res) => {
    const d = await device(req, res, req.params.id);
    if (!d) return;
    const key = randomBytes(24).toString("hex");
    await query(
      db,
      "UPDATE devices SET device_key = ?, is_online = 0, last_seen_at = NULL WHERE id = ?",
      [key, d.id],
    );
    res.json({ device_key: key });
  });
  app.post("/api/log", async (req, res) => {
    const key = req.get("X-Device-Key") || "";
    if (!valid.deviceKey(key) || key === DEMO_KEY)
      return res.status(401).json({ error: "Unauthorized device" });
    if (!valid.validateTelemetry(req.body))
      return res.status(400).json({ error: "Invalid telemetry" });
    const [d] = await query(
      db,
      "SELECT id, device_key, owner_id FROM devices WHERE device_key = ?",
      [key],
    );
    if (
      !d ||
      Buffer.byteLength(key) !== Buffer.byteLength(d.device_key) ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(d.device_key))
    )
      return res.status(401).json({ error: "Unauthorized device" });
    const {
      in_pm,
      in_co2,
      in_gas,
      out_pm,
      out_gas,
      vent,
      filt,
      temp,
      humidity,
    } = req.body;
    await query(
      db,
      `INSERT INTO sensor_data (device_id,in_pm25,in_co2,in_gas,out_pm25,out_gas,vent_fan_status,filt_fan_status,temperature,humidity) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        d.id,
        in_pm,
        in_co2,
        in_gas,
        out_pm,
        out_gas,
        vent,
        filt,
        temp,
        humidity,
      ],
    );
    await query(
      db,
      "UPDATE devices SET is_online = 1, last_seen_at = NOW() WHERE id = ?",
      [d.id],
    );
    const [owner] = await query(
      db,
      "SELECT owner_id FROM devices WHERE id = ?",
      [d.id],
    );
    const event = {
      device_id: d.id,
      in_pm25: in_pm,
      in_co2,
      in_gas,
      out_pm25: out_pm,
      out_gas,
      vent_fan_status: vent,
      filt_fan_status: filt,
      temperature: temp,
      humidity,
      created_at: new Date().toISOString(),
    };
    let target = io.to("admins");
    if (owner?.owner_id) target = target.to("user:" + owner.owner_id);
    target.emit("sensorData", event);
    res.status(201).json({ message: "Data logged successfully" });
  });
  app.get("/api/latest", auth, async (req, res) => {
    const d = await device(req, res, req.query.device_id);
    if (!d) return;
    const rows = await query(
      db,
      "SELECT * FROM sensor_data WHERE device_id = ? ORDER BY id DESC LIMIT 1",
      [d.id],
    );
    res.json(rows[0] || {});
  });
  app.get("/api/history", auth, async (req, res) => {
    const d = await device(req, res, req.query.device_id);
    if (!d) return;
    res.json(
      await query(
        db,
        `SELECT * FROM (SELECT ROUND(AVG(in_pm25),1) AS in_pm25, ROUND(AVG(out_pm25),1) AS out_pm25,
            FLOOR(UNIX_TIMESTAMP(created_at)/600)*600000 AS bucket_ms FROM sensor_data
            WHERE device_id = ? AND created_at >= NOW() - INTERVAL 3 HOUR
            GROUP BY FLOOR(UNIX_TIMESTAMP(created_at)/600) ORDER BY bucket_ms DESC LIMIT 18) AS recent ORDER BY bucket_ms ASC`,
        [d.id],
      ),
    );
  });
  app.get("/api/history/daily", auth, async (req, res) => {
    const d = await device(req, res, req.query.device_id);
    if (!d) return;
    res.json(
      await query(
        db,
        `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS date, ROUND(AVG(in_pm25),1) AS avg_in_pm,
            ROUND(AVG(out_pm25),1) AS avg_out_pm, ROUND(AVG(in_co2),1) AS avg_in_co2, ROUND(AVG(in_gas),1) AS avg_in_gas
            FROM sensor_data WHERE device_id = ? AND created_at >= NOW() - INTERVAL 30 DAY
            GROUP BY DATE_FORMAT(created_at,'%Y-%m-%d') ORDER BY date DESC LIMIT 30`,
        [d.id],
      ),
    );
  });
  app.get("/api/admin/stats", auth, admin, async (req, res) => {
    const [u] = await query(db, "SELECT COUNT(*) AS cnt FROM users");
    const [d] = await query(
      db,
      "SELECT COUNT(*) AS total, SUM(last_seen_at >= NOW() - INTERVAL 15 SECOND) AS online FROM devices",
    );
    const [s] = await query(db, "SELECT COUNT(*) AS cnt FROM sensor_data");
    res.json({
      totalUsers: u.cnt,
      totalDevices: d.total,
      onlineDevices: Number(d.online || 0),
      totalLogs: s.cnt,
    });
  });
  app.get("/api/admin/devices", auth, admin, async (req, res) =>
    res.json(
      await query(
        db,
        `SELECT d.id,d.device_name,d.owner_id,d.last_seen_at,d.created_at,
        (d.last_seen_at >= NOW() - INTERVAL 15 SECOND) AS is_online,u.username AS owner_username
        FROM devices d LEFT JOIN users u ON u.id=d.owner_id ORDER BY d.id DESC`,
      ),
    ),
  );
  app.get("/api/admin/users", auth, admin, async (req, res) =>
    res.json(
      await query(
        db,
        "SELECT id,username,email,role,created_at FROM users ORDER BY id DESC",
      ),
    ),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "ข้อมูลมีขนาดใหญ่เกินไป" });
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON" });
    console.error("Request failed:", err.code || err.name);
    res.status(500).json({ error: "ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่" });
  });
  return app;
}
function attachSocketAuth(io, { db, jwtSecret }) {
  requireSecret(jwtSecret);
  io.use(async (socket, next) => {
    try {
      const session = await verifyUser(
        db,
        socket.handshake.auth?.token || "",
        jwtSecret,
      );
      socket.data.user = session.user;
      socket.data.expiresAt = session.expiresAt;
      next();
    } catch {
      next(new Error("Authentication required"));
    }
  });
  io.on("connection", (socket) => {
    socket.join("user:" + socket.data.user.id);
    if (socket.data.user.role === "admin") socket.join("admins");
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.expiresAt - Date.now()),
    );
    timer.unref?.();
    socket.on("disconnect", () => clearTimeout(timer));
  });
}
async function startServer() {
  const jwtSecret = process.env.JWT_SECRET;
  requireSecret(jwtSecret);
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  const db = createPool();
  await query(db, "SELECT id,device_id FROM sensor_data LIMIT 0");
  await query(db, "SELECT id,owner_id FROM devices LIMIT 0");
  const key = process.env.DEVICE_API_KEY;
  if (key) {
    if (!valid.deviceKey(key) || key === DEMO_KEY)
      throw new Error(
        "Replace the demo DEVICE_API_KEY with a private 16–64 character key",
      );
    await query(
      db,
      "INSERT INTO devices (device_key,device_name) VALUES (?,'Existing AirWatch') ON DUPLICATE KEY UPDATE id=id",
      [key],
    );
  }
  let io;
  const app = createApp({ db, io: { to: (room) => io.to(room) }, jwtSecret });
  const server = http.createServer(app);
  io = new Server(server);
  attachSocketAuth(io, { db, jwtSecret });
  const udp = require("node:dgram").createSocket("udp4");
  udp.on("error", (err) =>
    console.error("UDP discovery unavailable:", err.message),
  );
  udp.on("message", (msg, rinfo) => {
    if (msg.toString() === "AIRWATCH_DISCOVER")
      udp.send(
        Buffer.from("AIRWATCH_SERVER_HERE:" + port),
        rinfo.port,
        rinfo.address,
        (err) => {
          if (err) console.error(err.message);
        },
      );
  });
  const prune = () =>
    query(
      db,
      "DELETE FROM sensor_data WHERE created_at < NOW() - INTERVAL 30 DAY",
    ).catch((err) => console.error("Pruning failed:", err.code));
  server.listen(port, () => {
    console.log("AirWatch listening on port " + port);
    udp.bind(41234);
    void prune();
  });
  const timer = setInterval(prune, 86400000);
  timer.unref();
  return { server, io, db, udp };
}
module.exports = {
  createApp,
  attachSocketAuth,
  signToken,
  validateTelemetry: valid.validateTelemetry,
};
if (require.main === module)
  startServer().catch((err) => {
    console.error("Startup failed:", err.message);
    process.exit(1);
  });
