"use strict";
(async () => {
  const { $, api } = App;
  if (!(await App.ready)) return;
  let busy = false;
  async function load() {
    if (busy) return;
    busy = true;
    $("refresh").disabled = true;
    App.error("");
    try {
      const [stats, devices, users] = await Promise.all([
        api("/api/admin/stats"),
        api("/api/admin/devices"),
        api("/api/admin/users"),
      ]);
      for (const [id, key] of [
        ["total-users", "totalUsers"],
        ["total-devices", "totalDevices"],
        ["online-devices", "onlineDevices"],
        ["total-logs", "totalLogs"],
      ]) {
        $(id).textContent = Number(stats[key]).toLocaleString("th-TH");
        $(id + "-note").textContent =
          "อัปเดต " +
          new Date().toLocaleTimeString("th-TH", {
            hour: "2-digit",
            minute: "2-digit",
          });
      }
      $("admin-devices").replaceChildren();
      for (const d of devices) {
        const tr = document.createElement("tr"),
          state = App.cell(""),
          action = App.cell(""),
          link = document.createElement("a");
        state.append(
          App.badge(
            d.is_online ? "ออนไลน์" : "ออฟไลน์",
            d.is_online ? "good" : "",
          ),
        );
        link.className = "button small";
        link.href = "/?device_id=" + Number(d.id);
        link.textContent = "ดูข้อมูล";
        action.append(link);
        tr.append(
          App.cell(d.device_name),
          App.cell(d.owner_username || "ยังไม่มีเจ้าของ"),
          state,
          App.cell(App.time(d.last_seen_at)),
          action,
        );
        $("admin-devices").append(tr);
      }
      if (!devices.length)
        App.emptyRow($("admin-devices"), 5, "ยังไม่มีอุปกรณ์ในระบบ");
      $("admin-users").replaceChildren();
      for (const u of users) {
        const tr = document.createElement("tr"),
          role = App.cell("");
        role.append(
          App.badge(
            u.role === "admin" ? "ผู้ดูแลระบบ" : "สมาชิก",
            u.role === "admin" ? "good" : "",
          ),
        );
        tr.append(
          App.cell(u.username),
          App.cell(u.email),
          role,
          App.cell(App.time(u.created_at)),
        );
        $("admin-users").append(tr);
      }
      if (!users.length) App.emptyRow($("admin-users"), 4, "ยังไม่มีสมาชิก");
    } catch (err) {
      App.error(err.message);
      for (const [id, cols] of [
        ["admin-devices", 5],
        ["admin-users", 4],
      ])
        App.emptyRow(
          $(id),
          cols,
          "โหลดข้อมูลไม่สำเร็จ กดรีเฟรชเพื่อลองอีกครั้ง",
        );
    } finally {
      busy = false;
      $("refresh").disabled = false;
    }
  }
  $("refresh").addEventListener("click", load);
  await load();
  setInterval(() => {
    if (!document.hidden) void load();
  }, 30000);
})();
