"use strict";
window.App = (() => {
  const $ = (id) => document.getElementById(id);
  const page = document.body.dataset.page;
  const paths = {
    wind: "M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h6",
    activity: "M3 12h4l3-7 4 14 3-7h4",
    sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 1.4-1.4M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    device: "M6 3h12v18H6zM10 17h4",
    users:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7a4 4 0 0 1 0 8",
    history: "M3 11a9 9 0 1 1 2.7 7M3 4v7h7m2-5v6l4 2",
    key: "M14 10a5 5 0 1 1-10 0 5 5 0 0 1 10 0m0 0h8m-3 0v3m3-3v3",
    plus: "M12 5v14M5 12h14",
    refresh:
      "M20 7v5h-5m-11 5v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3",
    drop: "M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12",
    temp: "M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0m3-6v10",
    filter: "M3 5h18l-7 8v7l-4-2v-5z",
    close: "m6 6 12 12M6 18 18 6",
  };
  function icons(scope = document) {
    scope.querySelectorAll("[data-icon]").forEach((el) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [key, value] of Object.entries({
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.6",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
      }))
        svg.setAttribute(key, value);
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", paths[el.dataset.icon] || paths.activity);
      svg.append(path);
      el.replaceChildren(svg);
    });
  }
  let user = null,
    devices = [],
    toastTimer;
  const token = () => localStorage.getItem("airwatch_token");
  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(token() ? { Authorization: "Bearer " + token() } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    let data;
    try {
      data = await response.json();
    } catch {
      data = { error: "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง" };
    }
    if (!response.ok) {
      if (
        response.status === 401 &&
        !["/api/auth/login", "/api/auth/register"].includes(url)
      ) {
        localStorage.removeItem("airwatch_token");
        window.location.replace("/login.html");
      }
      const error = new Error(data.error || "ไม่สามารถดำเนินการได้");
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function error(message) {
    if ($("page-error")) {
      $("page-error").textContent = message;
      $("page-error").hidden = !message;
    }
  }
  function toast(message) {
    if (!$("toast")) return;
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
  }
  const cell = (value, className = "") => {
    const td = document.createElement("td");
    td.textContent = value ?? "—";
    td.className = className;
    return td;
  };
  function emptyRow(body, columns, message) {
    const tr = document.createElement("tr"),
      td = cell(message, "table-empty");
    td.colSpan = columns;
    tr.append(td);
    body.replaceChildren(tr);
  }
  function badge(text, tone = "") {
    const span = document.createElement("span");
    span.className = "badge " + tone;
    span.textContent = text;
    return span;
  }
  function time(value, short = false) {
    if (!value) return "ยังไม่มีข้อมูล";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? "—"
      : short
        ? d.toLocaleTimeString("th-TH", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : d.toLocaleString("th-TH", {
            dateStyle: "medium",
            timeStyle: "short",
          });
  }
  function logout() {
    localStorage.removeItem("airwatch_token");
    window.dispatchEvent(new Event("airwatch-logout"));
    window.location.replace("/login.html");
  }
  function shell() {
    if (!$("sidebar")) return;
    $("sidebar").innerHTML =
      '<a class="brand" href="/"><span class="brand-mark" data-icon="wind"></span>AirWatch <small>· smart monitor</small></a><nav class="nav"><a href="/" data-nav="dashboard"><span data-icon="activity"></span>ภาพรวม</a><a href="/history.html" data-nav="history"><span data-icon="history"></span>ประวัติ</a><a href="/admin.html" data-nav="admin" id="admin-nav" hidden><span data-icon="users"></span>ผู้ดูแลระบบ</a></nav><div class="sidebar-foot"><small>ทุกพื้นที่ เริ่มต้นที่อากาศ</small><div class="user"><span class="avatar" id="user-avatar">A</span><div class="user-meta"><div class="user-name" id="user-name">กำลังโหลด…</div><small id="user-role"></small></div></div></div>';
    document
      .querySelector('[data-nav="' + page + '"]')
      ?.setAttribute("aria-current", "page");
    const accountControls = document.querySelector(".top-actions");
    if (accountControls) $("sidebar").append(accountControls);
    document.querySelector(".topline")?.remove();
    $("dialogs").innerHTML =
      `<dialog id="logout-dialog" aria-labelledby="logout-title"><div class="dialog-head"><h2 id="logout-title">ออกจากระบบ?</h2><button class="button icon-button" data-close="logout-dialog" aria-label="ปิด"><span data-icon="close"></span></button></div><p class="dialog-copy">อุปกรณ์ยังทำงานตามปกติ คุณกลับมาเข้าสู่ระบบเพื่อดูข้อมูลได้เสมอ</p><div class="dialog-actions"><button class="button" data-close="logout-dialog">อยู่ต่อ</button><button class="button primary" id="confirm-logout">ออกจากระบบ</button></div></dialog>
        <dialog id="key-dialog" aria-labelledby="key-title"><div class="dialog-head"><h2 id="key-title">เชื่อมต่อ ESP32</h2><button class="button icon-button" data-close="key-dialog" aria-label="ปิด"><span data-icon="close"></span></button></div><p class="dialog-copy">คัดลอกรหัสตั้งค่านี้ไปวางในหน้าตั้งค่า Wi-Fi ของบอร์ดครั้งแรก บอร์ดจะจำการเชื่อมต่อเอง</p><div class="field"><label for="device-key-value">รหัสตั้งค่าบอร์ด</label><input id="device-key-value" class="key-output" readonly spellcheck="false"></div><div class="actions"><button class="button small" id="copy-key">คัดลอกรหัส</button><button class="button quiet small" id="rotate-key">เปลี่ยนรหัสใหม่</button></div><div class="key-note"><strong>เชื่อมต่อบอร์ด</strong><ol><li>เปิดหน้าตั้งค่า AirWatch-Setup</li><li>เลือก Wi-Fi และวางรหัสตั้งค่าบอร์ดนี้ในช่อง Connection code</li><li>บันทึก แล้วกลับมารอข้อมูลบนแดชบอร์ด</li></ol>ต้องการตั้งค่าใหม่: กดปุ่ม BOOT ค้างประมาณ 3 วินาทีขณะบอร์ดทำงาน แล้วเชื่อม AirWatch-Setup</div><div class="dialog-actions"><button class="button primary" data-close="key-dialog">เรียบร้อย</button></div></dialog>
        <dialog id="rotate-dialog" aria-labelledby="rotate-title"><h2 id="rotate-title">เปลี่ยนรหัสอุปกรณ์?</h2><p class="dialog-copy">รหัสเดิมจะใช้ไม่ได้ และบอร์ดจะหยุดส่งข้อมูลจนกว่าคุณจะใส่รหัสใหม่</p><div class="dialog-actions"><button class="button" data-close="rotate-dialog">ยกเลิก</button><button class="button primary" id="confirm-rotate">เปลี่ยนรหัส</button></div></dialog>`;
    document
      .querySelectorAll("[data-close]")
      .forEach((b) =>
        b.addEventListener("click", () => $(b.dataset.close).close()),
      );
    document
      .querySelectorAll("[data-logout]")
      .forEach((b) =>
        b.addEventListener("click", () => $("logout-dialog").showModal()),
      );
    $("confirm-logout").addEventListener("click", logout);
    function showKey(key) {
      const address = location.origin + '/api/log';
      const local = location.protocol !== 'https:';
      $('device-key-value').value = (local ? 'AUTO' : address) + '|' + key;
      $('key-dialog').showModal();
    }
    $("device-key")?.addEventListener("click", async () => {
      try {
        const r = await api("/api/device/key");
        await showKey(r.device_key);
      } catch (err) {
        error(err.message);
      }
    });
    $("copy-key").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("device-key-value").value);
        toast("คัดลอกรหัสแล้ว");
      } catch {
        $("device-key-value").focus();
        $("device-key-value").select();
        toast("เลือกรหัสไว้แล้ว กดคัดลอกด้วยตนเอง");
      }
    });
    $("rotate-key").addEventListener("click", () =>
      $("rotate-dialog").showModal(),
    );
    $("confirm-rotate").addEventListener("click", async () => {
      const b = $("confirm-rotate");
      b.disabled = true;
      try {
        const r = await api("/api/device/rotate-key", {
          method: "POST",
        });
        showKey(r.device_key);
        $("rotate-dialog").close();
        toast("เปลี่ยนรหัสแล้ว กรุณาตั้งค่าใหม่บนบอร์ด");
        window.dispatchEvent(new Event("airwatch-device"));
      } catch (err) {
        toast(err.message);
      } finally {
        b.disabled = false;
      }
    });
    $("key-dialog").addEventListener(
      "close",
      () => ($("device-key-value").value = ""),
    );
  }
  function selected() { return devices[0]?.id || 0; }
  function syncLinks() {
    document.querySelectorAll('[data-nav]').forEach(a => {
      if (a.dataset.nav !== 'admin') a.href = a.dataset.nav === 'history' ? '/history.html' : '/';
    });
  }
  async function loadDevices() {
    const board = await api('/api/device');
    devices = [board];
    if ($('board-name')) $('board-name').textContent = board.device_name;
    if ($('no-devices')) $('no-devices').hidden = true;
    if ($('device-content')) $('device-content').hidden = false;
    if ($('device-key')) { $('device-key').disabled = false; $('device-key').hidden = user.role !== 'admin'; }
    syncLinks();
    return devices;
  }
  function chart(canvas, type = "line") {
    if (!window.Chart) return null;
    return new Chart(canvas, {
      type,
      data: {
        labels: [],
        datasets: [
          {
            label: "ภายใน",
            data: [],
            borderColor: "#3fb950",
            backgroundColor: "#3fb95030",
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.3,
            spanGaps: false,
          },
          {
            label: "ภายนอก",
            data: [],
            borderColor: "#58a6ff",
            backgroundColor: "#58a6ff30",
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.3,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#8e9f96", maxTicksLimit: 6 },
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#8e9f96" },
            grid: { color: "#8e9f9620" },
          },
        },
      },
    });
  }
  shell();
  icons();
  document.querySelectorAll("[data-theme-toggle]").forEach((b) =>
    b.addEventListener("click", () => {
      const next =
        document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("theme", next);
    }),
  );
  const ready = (async () => {
    if (page === "login") return null;
    if (!token()) {
      location.replace("/login.html");
      return null;
    }
    try {
      user = await api("/api/auth/me");
      if (page === "admin" && user.role !== "admin") {
        location.replace("/");
        return null;
      }
      $("user-name").textContent = user.username;
      $("top-user").textContent = user.username;
      $("user-avatar").textContent =
        Array.from(user.username)[0]?.toUpperCase() || "A";
      $("user-role").textContent =
        user.role === "admin" ? "ผู้ดูแลระบบ" : "สมาชิก";
      $("admin-nav").hidden = user.role !== "admin";
      return user;
    } catch (err) {
      error(err.message);
      return null;
    }
  })();
  return {
    $,
    api,
    ready,
    token,
    error,
    toast,
    cell,
    emptyRow,
    badge,
    time,
    selected,
    loadDevices,
    syncLinks,
    chart,
    get user() {
      return user;
    },
    get devices() {
      return devices;
    },
  };
})();
