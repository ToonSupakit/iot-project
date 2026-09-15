"use strict";
(async () => {
  const { $, api } = App,
    user = await App.ready;
  if (!user) return;
  let epoch = 0,
    liveSequence = 0,
    timer,
    controller,
    chartController,
    chartBusy = false,
    lastChartFetch = 0,
    currentData = null,
    socket;
  const plot = App.chart($("pm-chart"));
  function alerts() {
    const day = new Date().toLocaleDateString("en-CA"),
      key = "airwatch-alerts:" + user.id + ":" + App.selected() + ":" + day;
    let state;
    try {
      state = JSON.parse(localStorage.getItem(key));
    } catch {}
    return {
      key,
      state:
        state &&
        Number.isFinite(state.count) &&
        [0, 1, 2].includes(state.level) &&
        Array.isArray(state.logs)
          ? state
          : { level: 0, count: 0, logs: [] },
    };
  }
  function renderAlerts() {
    const { state } = alerts();
    $("alert-count").textContent = state.count;
    $("alert-list").replaceChildren();
    for (const log of state.logs.slice(0, 100)) {
      const li = document.createElement("li"),
        text = document.createElement("span"),
        time = document.createElement("small");
      text.textContent = "PM2.5 ภายใน " + log.pm + " µg/m³ · เกินเกณฑ์โครงการ";
      time.textContent = App.time(log.at, true);
      li.append(text, time);
      $("alert-list").append(li);
    }
    $("alerts-empty").hidden = state.logs.length > 0;
  }
  function track(pm) {
    const { key, state } = alerts();
    const next = AirModel.nextAlert(state, pm);
    state.level = next.level;
    state.count = next.count;
    if (next.trigger) state.logs.unshift({ pm, at: new Date().toISOString() });
    state.logs = state.logs.slice(0, 100);
    localStorage.setItem(key, JSON.stringify(state));
    renderAlerts();
  }
  function status(text, tone = "") {
    $("live-status").textContent = text;
    $("live-status").className = "badge " + tone;
  }
  function offline(text = "ออฟไลน์") {
    clearTimeout(timer);
    currentData = null;
    $("in-meter").value = 0;
    $("out-meter").value = 0;
    status(text, "warn");
    for (const id of [
      "in-pm",
      "out-pm",
      "temp",
      "humidity",
      "co2",
      "gas",
      "out-gas",
    ])
      $(id).textContent = "—";
    for (const id of ["vent", "filt"]) {
      $(id).textContent = "ไม่ทราบ";
      $(id).className = "badge";
    }
    for (const id of ["temp", "humidity", "co2", "gas"])
      $(id + "-note").textContent = "ไม่มีข้อมูลล่าสุด";
    $("pm-status").textContent = "ไม่มีข้อมูลล่าสุด";
    $("out-status").textContent = "ไม่มีข้อมูลล่าสุด";
    $("pollution-banner").hidden = true;
  }
  function render(d) {
    if (!AirModel.acceptSample(App.selected(), d)) return;
    const timestamp = d.created_at;
    if (!AirModel.fresh(timestamp)) {
      offline();
      $("last-seen").textContent = App.time(timestamp, true);
      return;
    }
    currentData = d;
    clearTimeout(timer);
    timer = setTimeout(
      () => offline(),
      Math.max(0, 15000 - (Date.now() - Date.parse(timestamp))),
    );
    status("ออนไลน์", "good");
    const pm = AirModel.number(d.in_pm25),
      out = AirModel.number(d.out_pm25);
    $("in-pm").textContent = pm ?? "—";
    $("out-pm").textContent = out ?? "—";
    $("in-meter").value = Math.min(100, Math.max(0, pm ?? 0));
    $("out-meter").value = Math.min(100, Math.max(0, out ?? 0));
    $("pm-status").textContent =
      pm == null
        ? "เซนเซอร์ไม่มีข้อมูล"
        : pm > 35
          ? "เกินเกณฑ์โครงการ"
          : "ไม่เกินเกณฑ์โครงการ";
    $("out-status").textContent =
      out == null
        ? "ไม่มีเซนเซอร์หรือไม่มีข้อมูล"
        : pm == null
          ? "มีข้อมูลภายนอก"
          : out < pm
            ? "ฝุ่นต่ำกว่าภายใน"
            : "ฝุ่นสูงกว่าหรือเท่าภายใน";
    for (const [id, key, places] of [
      ["temp", "temperature", 1],
      ["humidity", "humidity", 0],
      ["co2", "in_co2", 0],
      ["gas", "in_gas", 0],
    ]) {
      const value = AirModel.number(d[key]);
      $(id).textContent = value == null ? "—" : value.toFixed(places);
      $(id + "-note").textContent =
        value == null
          ? "เซนเซอร์ไม่มีข้อมูล"
          : id === "co2"
            ? "ค่าประมาณจาก ENS160"
            : id === "gas"
              ? "ค่าดิบจาก MQ-2"
              : "ข้อมูลล่าสุดจากเซนเซอร์";
    }
    const gas = AirModel.number(d.out_gas);
    $("out-gas").textContent = gas == null ? "ไม่มีข้อมูล" : gas + " ADC";
    for (const [id, key] of [
      ["vent", "vent_fan_status"],
      ["filt", "filt_fan_status"],
    ]) {
      const known = d[key] === 0 || d[key] === 1;
      $(id).textContent = known
        ? d[key]
          ? "กำลังทำงาน"
          : "หยุดทำงาน"
        : "ไม่ทราบ";
      $(id).className = "badge " + (known && d[key] ? "good" : "");
    }
    $("last-seen").textContent = App.time(timestamp, true);
    $("pollution-banner").hidden = !(pm > 35);
    $("pollution-banner").textContent =
      "PM2.5 ภายใน " + pm + " µg/m³ สูงกว่าเกณฑ์โครงการ 35 µg/m³";
    track(pm);
  }
  async function history(force = false) {
    const id = App.selected();
    if (!id || (!force && (chartBusy || Date.now() - lastChartFetch < 60000)))
      return;
    if (!plot) {
      $("chart-note").textContent = "ไม่สามารถโหลดกราฟได้ กรุณารีเฟรชหน้า";
      return;
    }
    chartController?.abort();
    const abort = new AbortController();
    chartController = abort;
    chartBusy = true;
    const ticket = epoch;
    lastChartFetch = Date.now();
    try {
      const rows = await api("/api/history?device_id=" + id, {
        signal: abort.signal,
      });
      if (ticket !== epoch) return;
      plot.data.labels = rows.map((r) =>
        new Date(Number(r.bucket_ms)).toLocaleTimeString("th-TH", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      plot.data.datasets[0].data = rows.map((r) => AirModel.number(r.in_pm25));
      plot.data.datasets[1].data = rows.map((r) => AirModel.number(r.out_pm25));
      plot.update("none");
      $("chart-note").textContent = rows.length
        ? "ค่าเฉลี่ยจากเซิร์ฟเวอร์ · อัปเดตทุก 1 นาที · ช่องว่างคือไม่มีข้อมูล"
        : "ยังไม่มีข้อมูลย้อนหลัง กราฟจะเริ่มเมื่ออุปกรณ์ส่งข้อมูล";
    } catch (err) {
      if (err.name !== "AbortError" && ticket === epoch)
        $("chart-note").textContent = err.message;
    } finally {
      if (chartController === abort) chartBusy = false;
    }
  }
  async function selectDevice() {
    epoch++;
    liveSequence = 0;
    controller?.abort();
    chartController?.abort();
    chartBusy = false;
    clearTimeout(timer);
    offline("รอข้อมูล");
    $("last-seen").textContent = "ยังไม่มีข้อมูล";
    App.syncLinks();
    renderAlerts();
    if (plot) {
      plot.data.labels = [];
      plot.data.datasets.forEach((d) => (d.data = []));
      plot.update("none");
    }
    if (!App.selected()) return;
    const id = App.selected(),
      ticket = epoch,
      sequence = liveSequence;
    controller = new AbortController();
    App.error("");
    void history(true);
    try {
      const d = await api("/api/latest?device_id=" + id, {
        signal: controller.signal,
      });
      if (ticket !== epoch || sequence !== liveSequence) return;
      if (!d.id) {
        offline("ยังไม่เคยส่งข้อมูล");
        return;
      }
      render(d);
    } catch (err) {
      if (err.name !== "AbortError" && ticket === epoch) {
        offline();
        App.error(err.message);
      }
    }
  }
  $("device-select").addEventListener("change", selectDevice);
  window.addEventListener("airwatch-device", selectDevice);
  $("refresh").addEventListener("click", async () => {
    const b = $("refresh");
    b.disabled = true;
    try {
      await App.loadDevices(App.selected());
      await selectDevice();
    } catch (err) {
      App.error(err.message);
    } finally {
      b.disabled = false;
    }
  });
  $("clear-alerts").addEventListener("click", () => {
    const { key, state } = alerts();
    state.logs = [];
    localStorage.setItem(key, JSON.stringify(state));
    renderAlerts();
  });
  try {
    await App.loadDevices();
    await selectDevice();
  } catch (err) {
    App.error(err.message);
    $("device-select").replaceChildren(new Option("โหลดอุปกรณ์ไม่สำเร็จ", ""));
    return;
  }
  socket = io({ auth: { token: App.token() } });
  socket.on("sensorData", (d) => {
    if (!AirModel.acceptSample(App.selected(), d)) return;
    liveSequence++;
    App.error("");
    render(d);
    void history();
  });
  socket.on("disconnect", () => {
    offline();
  });
  socket.on("connect", () => {
    if (App.selected()) void selectDevice();
  });
  socket.on("connect_error", (err) => {
    offline();
    if (err.message === "Authentication required") {
      localStorage.removeItem("airwatch_token");
      location.replace("/login.html");
    } else App.error("การเชื่อมต่อข้อมูลสดขัดข้อง กำลังเชื่อมต่อใหม่…");
  });
  window.addEventListener("airwatch-logout", () => socket.disconnect());
  window.addEventListener("pagehide", () => {
    socket.disconnect();
    controller?.abort();
    chartController?.abort();
    clearTimeout(timer);
  });
  setInterval(() => {
    if (currentData && !AirModel.fresh(currentData.created_at)) offline();
    renderAlerts();
  }, 5000);
})();
