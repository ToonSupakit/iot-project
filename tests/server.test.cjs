const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { Server } = require("socket.io");
const { io: client } = require("socket.io-client");
const {
  createApp,
  attachSocketAuth,
  signToken,
  validateTelemetry,
} = require("../server");
const secret = "test-only-secret-".repeat(3);
const sample = {
  in_pm: 0,
  in_co2: null,
  in_gas: 0,
  out_pm: null,
  out_gas: null,
  vent: 0,
  filt: 0,
  temp: 0,
  humidity: 0,
};
function fixture() {
  const users = [1, 2, 3].map((id) => ({
    id,
    username: "user" + id,
    email: id + "@test.invalid",
    role: id === 3 ? "admin" : "user",
  }));
  const devices = [1, 2, 3].map((id) => ({
    id,
    owner_id: id === 3 ? null : id,
    device_name: "device" + id,
    device_key: "test-private-device-key-" + id,
  }));
  const writes = [];
  const db = {
    query(sql, p, cb) {
      try {
        let result = [];
        if (sql.startsWith("SELECT id, username"))
          result = users.filter((u) => u.id === p[0]);
        else if (sql.includes("FROM devices WHERE device_key"))
          result = devices
            .filter((d) => d.device_key === p[0])
            .map((d) => ({ ...d }));
        else if (sql.includes("FROM devices WHERE id"))
          result = devices.filter((d) => d.id === p[0]);
        else if (sql.startsWith("UPDATE devices SET owner_id")) {
          const d = devices.find((d) => d.id === p[2]);
          result = { affectedRows: d.owner_id === null ? 1 : 0 };
          if (result.affectedRows) d.owner_id = p[0];
        } else if (sql.startsWith("INSERT INTO users")) {
          assert.match(sql, /'user'/);
          result = { insertId: users.length + 1 };
          users.push({ id: result.insertId, username: p[0], role: "user" });
        } else if (sql.startsWith("INSERT INTO sensor_data")) {
          writes.push(p);
          result = { insertId: writes.length };
        } else if (sql.includes("FROM sensor_data")) {
          assert.match(sql, /WHERE device_id = \?/);
          result = [];
        }
        queueMicrotask(() => cb(null, result));
      } catch (e) {
        cb(e);
      }
    },
  };
  return { db, users, devices, writes };
}
async function start(t) {
  const f = fixture();
  let io;
  const app = createApp({
    db: f.db,
    jwtSecret: secret,
    singleDeviceId: 1,
    io: { to: (r) => io.to(r) },
  });
  const server = app.listen(0, "127.0.0.1");
  io = new Server(server);
  attachSocketAuth(io, { db: f.db, jwtSecret: secret });
  await once(server, "listening");
  t.after(
    () => new Promise((resolve) => io.close(() => server.close(resolve))),
  );
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (path, user, body, key) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(user
          ? { Authorization: "Bearer " + signToken(f.users[user - 1], secret) }
          : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "X-Device-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { ...f, base, request };
}
test("zero, missing, invalid and conflicting telemetry", () => {
  assert.equal(validateTelemetry(sample), true);
  for (const v of [
    null,
    {},
    [],
    { ...sample, in_pm: "4" },
    { ...sample, in_co2: undefined },
    { ...sample, humidity: 101 },
    { ...sample, vent: 1, filt: 1 },
  ])
    assert.equal(validateTelemetry(v), false);
  assert.throws(() => createApp({ jwtSecret: "" }), /JWT_SECRET/);
});
test("read and key endpoints enforce ownership; only public files served", async (t) => {
  const { request } = await start(t);
  for (const path of ["/api/latest", "/api/history", "/api/history/daily"]) {
    assert.equal((await request(path + "?device_id=1")).status, 401);
    assert.equal((await request(path + "?device_id=2", 1)).status, 404);
    assert.equal((await request(path, 1)).status, 200);
    assert.equal((await request(path, 2)).status, 404);
    assert.equal((await request(path + "?device_id=2", 3)).status, 404);
  }
  assert.equal((await request("/api/devices/2/key", 1)).status, 404);
  assert.equal((await request("/api/devices/2/rotate-key", 1, {})).status, 404);
  assert.equal((await request("/api/admin/users", 1)).status, 403);
  assert.equal((await request("/api/device/key", 1)).status, 403);
  assert.equal((await request("/api/device/key", 3)).status, 200);
  assert.equal((await request("/api/device/rotate-key", 1, {})).status, 403);
  assert.equal((await request("/api/device", 1)).status, 200);
  assert.equal((await request("/api/device", 2)).status, 404);
  for (const p of [
    "/server.js",
    "/db/schema.sql",
    "/package.json",
    "/.git/config",
  ])
    assert.equal((await request(p)).status, 404);
  for (const p of [
    "/",
    "/login.html",
    "/history.html",
    "/admin.html",
    "/vendor/chart.umd.js",
  ])
    assert.equal((await request(p)).status, 200);
  assert.match(
    (await request("/")).headers.get("content-security-policy"),
    /script-src 'self'/,
  );
});
test("public registration never grants admin and multi-device creation is removed", async (t) => {
  const { request, devices } = await start(t);
  const regs = await Promise.all(
    [1, 2].map((i) =>
      request("/api/auth/register", null, {
        username: "new" + i,
        email: "new" + i + "@test.invalid",
        password: "long-test-password",
        role: "admin",
      }),
    ),
  );
  for (const r of regs) {
    assert.equal(r.status, 201);
    assert.equal((await r.json()).user.role, "user");
  }
  for (const path of ['/api/devices','/api/devices/claim']) {
    assert.equal((await request(path, 3, {device_key:devices[2].device_key})).status,404);
  }
});
test("device credentials and socket rooms isolate telemetry", async (t) => {
  const { request, base, users, writes, devices } = await start(t);
  const bad = client(base, { reconnection: false });
  t.after(() => bad.close());
  assert.match((await once(bad, "connect_error"))[0].message, /Authentication/);
  const sockets = users.map((u) =>
    client(base, {
      auth: { token: signToken(u, secret) },
      reconnection: false,
    }),
  );
  t.after(() => sockets.forEach((s) => s.close()));
  await Promise.all(sockets.map((s) => once(s, "connect")));
  const received = [[], [], []];
  sockets.forEach((s, i) => s.on("sensorData", (d) => received[i].push(d)));
  assert.equal(
    (await request("/api/log", null, sample, "unknown-test-private-key"))
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        "/api/log",
        null,
        sample,
        "airwatch-default-secret-key-123456",
      )
    ).status,
    401,
  );
  for (const d of devices.slice(0, 1)) {
    const delivered = once(sockets[d.id - 1], "sensorData");
    assert.equal(
      (await request("/api/log", null, sample, d.device_key)).status,
      201,
    );
    await delivered;
  }
  assert.equal((await request("/api/log", null, sample, devices[1].device_key)).status,401);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(
    received.map((a) => a.map((d) => d.device_id)),
    [[1], [], [1]],
  );
  assert.deepEqual(
    writes.map((a) => a[0]),
    [1],
  );
  assert.equal(writes[0][2], null);
});
