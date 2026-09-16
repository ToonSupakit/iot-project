"use strict";
(async () => {
  const { $, api } = App;
  if (!(await App.ready)) return;
  const plot = App.chart($("history-chart"), "bar");
  let rows = [],
    epoch = 0,
    controller;
  async function load() {
    const ticket = ++epoch;
    controller?.abort();
    controller = new AbortController();
    rows = [];
    App.syncLinks();
    App.error("");
    $("export-csv").disabled = true;
    App.emptyRow($("history-body"), 5, "กำลังโหลด…");
    if (plot) {
      plot.data.labels = [];
      plot.data.datasets.forEach((d) => (d.data = []));
      plot.update();
    }
    if (!App.selected()) return;
    try {
      const data = await api("/api/history/daily?device_id=" + App.selected(), {
        signal: controller.signal,
      });
      if (ticket !== epoch) return;
      rows = data;
      $("history-body").replaceChildren();
      for (const row of rows) {
        const tr = document.createElement("tr");
        tr.append(
          App.cell(
            new Date(row.date + "T00:00:00").toLocaleDateString("th-TH", {
              dateStyle: "medium",
            }),
          ),
        );
        for (const key of [
          "avg_in_pm",
          "avg_out_pm",
          "avg_in_co2",
          "avg_in_gas",
        ])
          tr.append(App.cell(AirModel.number(row[key]) ?? "—", "numeric"));
        $("history-body").append(tr);
      }
      if (!rows.length)
        App.emptyRow($("history-body"), 5, "ยังไม่มีข้อมูลของอุปกรณ์นี้");
      if (plot) {
        const sorted = rows.slice().reverse();
        plot.data.labels = sorted.map((r) =>
          new Date(r.date + "T00:00:00").toLocaleDateString("th-TH", {
            day: "numeric",
            month: "short",
          }),
        );
        plot.data.datasets[0].data = sorted.map((r) =>
          AirModel.number(r.avg_in_pm),
        );
        plot.data.datasets[1].data = sorted.map((r) =>
          AirModel.number(r.avg_out_pm),
        );
        plot.update();
      }
      $("history-note").textContent = rows.length
        ? rows.length + " วันมีข้อมูล · หน่วย PM2.5: µg/m³"
        : "ยังไม่มีข้อมูลย้อนหลัง";
      $("export-csv").disabled = !rows.length;
    } catch (err) {
      if (err.name !== "AbortError" && ticket === epoch) {
        App.error(err.message);
        App.emptyRow(
          $("history-body"),
          5,
          "โหลดข้อมูลไม่สำเร็จ กดรีเฟรชเพื่อลองอีกครั้ง",
        );
        $("history-note").textContent = "โหลดข้อมูลไม่สำเร็จ";
      }
    }
  }
  window.addEventListener("airwatch-device", load);
  $("refresh").addEventListener("click", async () => {
    const b = $("refresh");
    b.disabled = true;
    try {
      await App.loadDevices(App.selected());
      await load();
    } catch (err) {
      App.error(err.message);
    } finally {
      b.disabled = false;
    }
  });
  $("export-csv").addEventListener("click", () => {
    const data = [
      ["date", "indoor_pm25", "outdoor_pm25", "eco2_ppm", "gas_adc"],
      ...rows.map((r) => [
        r.date,
        ...["avg_in_pm", "avg_out_pm", "avg_in_co2", "avg_in_gas"].map(
          (k) => AirModel.number(r[k]) ?? "",
        ),
      ]),
    ];
    const text =
      "\uFEFF" +
      data
        .map((row) =>
          row.map((x) => '"' + String(x).replaceAll('"', '""') + '"').join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "airwatch-device-" + App.selected() + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  try {
    await App.loadDevices();
    await load();
  } catch (err) {
    App.error(err.message);
  }
})();
