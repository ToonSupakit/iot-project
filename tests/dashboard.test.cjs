const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const model = require("../public/js/model");
const flush = () => new Promise((r) => setImmediate(r));
test("measurement model preserves zero/null and deduplicates alert episodes", () => {
  assert.equal(model.number(null), null);
  assert.equal(model.number(0), 0);
  assert.equal(model.number("42.1"), 42.1);
  assert.equal(model.acceptSample(1, { device_id: 2 }), false);
  assert.equal(model.fresh(new Date(Date.now() - 16000).toISOString()), false);
  let s = { level: 0, count: 0 };
  for (const pm of [60, 60, null, 60]) s = model.nextAlert(s, pm);
  assert.equal(s.count, 1);
  s = model.nextAlert(s, 0);
  s = model.nextAlert(s, 60);
  assert.equal(s.count, 2);
});
test("single-board dashboard ignores unrelated telemetry and late refresh results", async () => {
  const dom = new JSDOM(fs.readFileSync("public/index.html", "utf8"), {
    url: "http://localhost/",
    runScripts: "outside-only",
  });
  const w = dom.window,
    $ = (id) => w.document.getElementById(id),
    handlers = {},
    pending = [];
  const chart = {
    data: { labels: [], datasets: [{ data: [] }, { data: [] }] },
    update() {},
  };
  w.AirModel = model;
  w.io = () => ({ on: (e, fn) => (handlers[e] = fn), disconnect() {} });
  w.App = {
    $,
    ready: Promise.resolve({ id: 1 }),
    chart: () => chart,
    selected: () => 1,
    syncLinks() {},
    loadDevices: async () => {},
    token: () => "",
    error() {},
    time: String,
    api: (url) =>
      url.startsWith("/api/history")
        ? Promise.resolve([])
        : new Promise((resolve) => pending.push({ url, resolve })),
  };
  w.eval(fs.readFileSync("public/js/dashboard.js", "utf8"));
  await flush();
  const sample = (id) => ({
    id: 1,
    device_id: id,
    in_pm25: id * 10,
    out_pm25: null,
    temperature: 0,
    humidity: 0,
    in_co2: null,
    in_gas: 0,
    vent_fan_status: 0,
    filt_fan_status: 0,
    created_at: new Date().toISOString(),
  });
  pending[0].resolve(sample(1));
  await flush();
  assert.equal($("in-pm").textContent, "10");
  handlers.connect();
  await flush();
  handlers.sensorData({...sample(1),in_pm25:28});
  pending[1].resolve(sample(1));
  await flush();
  assert.equal($('in-pm').textContent,'28');
  handlers.sensorData(sample(2));
  assert.equal($("in-pm").textContent, "28");
  handlers.sensorData({ ...sample(1), in_pm25: 0 });
  assert.equal($("in-pm").textContent, "0");
  assert.equal($("co2").textContent, "—");
  handlers.disconnect();
  assert.equal($("vent").textContent, "ไม่ทราบ");
  dom.window.close();
});
test("pages share CSS, local scripts and no inline handlers", () => {
  for (const page of ["index", "history", "admin", "login"]) {
    const dom = new JSDOM(fs.readFileSync("public/" + page + ".html", "utf8"));
    const d = dom.window.document;
    assert.ok(d.querySelector('link[href="/style.css"]'));
    assert.equal(d.querySelectorAll("[data-add-device],#device-select").length,0);
    for (const node of d.querySelectorAll("*"))
      for (const attr of node.attributes) assert.ok(!/^on/i.test(attr.name));
    for (const s of d.scripts)
      assert.ok(s.src, "scripts must be local external files");
    dom.window.close();
  }
});
test("admin renders stored markup as text and shared dialogs open correctly", async () => {
  const dom = new JSDOM(fs.readFileSync("public/admin.html", "utf8"), {
    url: "http://localhost/",
    runScripts: "outside-only",
  });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const attack = '<img src=x onerror="alert(1)">';
  w.localStorage.setItem("airwatch_token", "test-only");
  w.fetch = async (url) => ({
    ok: true,
    json: async () =>
      url === "/api/auth/me"
        ? { id: 1, username: attack, role: "admin" }
        : url === "/api/admin/stats"
          ? { totalUsers: 1, totalDevices: 1, onlineDevices: 0, totalLogs: 0 }
          : url === "/api/admin/devices"
            ? [{ id: 1, device_name: attack, owner_username: attack }]
            : [{ id: 1, username: attack, email: attack, role: "user" }],
  });
  w.eval(fs.readFileSync("public/js/common.js", "utf8"));
  await w.App.ready;
  w.eval(fs.readFileSync("public/js/admin.js", "utf8"));
  await flush();
  assert.equal(w.document.querySelectorAll("img").length, 0);
  assert.ok(
    w.document.getElementById("admin-devices").textContent.includes(attack),
  );
  w.document.querySelector("[data-logout]").click();
  assert.equal(w.document.getElementById("logout-dialog").open, true);
  w.document.querySelector('[data-close="logout-dialog"]').click();
  assert.equal(w.document.getElementById("logout-dialog").open, false);
  w.document.querySelector("[data-theme-toggle]").click();
  assert.equal(w.document.documentElement.dataset.theme, "light");
  dom.window.close();
});
