"use strict";
(() => {
  const { $, api } = App;
  let register = false;
  $("switch-auth").addEventListener("click", () => {
    register = !register;
    $("auth-form").reset();
    $("auth-error").hidden = true;
    $("username-field").hidden = !register;
    $("username").required = register;
    $("confirm-field").hidden = !register;
    $("confirm-password").required = register;
    $("password-hint").hidden = !register;
    $("password").minLength = register ? 12 : 1;
    $("password").autocomplete = register ? "new-password" : "current-password";
    $("auth-title").textContent = register
      ? "เริ่มต้นพื้นที่ของคุณ"
      : "ยินดีต้อนรับกลับ";
    $("auth-subtitle").textContent = register
      ? "สร้างบัญชีเพื่อเชื่อมต่อและติดตามอุปกรณ์"
      : "เข้าสู่ระบบเพื่อดูพื้นที่และอุปกรณ์ของคุณ";
    $("auth-submit").textContent = register ? "สร้างบัญชี" : "เข้าสู่ระบบ";
    $("switch-label").textContent = register
      ? "มีบัญชีอยู่แล้ว?"
      : "ยังไม่มีบัญชี?";
    $("switch-auth").textContent = register ? "เข้าสู่ระบบ" : "สร้างบัญชีใหม่";
  });
  $("show-password").addEventListener("click", () => {
    const show = $("password").type === "password";
    $("password").type = show ? "text" : "password";
    $("show-password").textContent = show ? "ซ่อน" : "แสดง";
    $("show-password").setAttribute("aria-pressed", String(show));
  });
  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("auth-error").hidden = true;
    const password = $("password").value;
    if (register && password !== $("confirm-password").value) {
      $("auth-error").textContent = "รหัสผ่านทั้งสองช่องไม่ตรงกัน";
      $("auth-error").hidden = false;
      return;
    }
    const b = $("auth-submit");
    b.disabled = true;
    b.textContent = "กำลังดำเนินการ…";
    try {
      const data = await api("/api/auth/" + (register ? "register" : "login"), {
        method: "POST",
        body: JSON.stringify({
          email: $("email").value.trim(),
          password,
          ...(register ? { username: $("username").value.trim() } : {}),
        }),
      });
      localStorage.setItem("airwatch_token", data.token);
      location.replace(data.user.role === "admin" ? "/admin.html" : "/");
    } catch (err) {
      $("auth-error").textContent = err.message;
      $("auth-error").hidden = false;
    } finally {
      b.disabled = false;
      b.textContent = register ? "สร้างบัญชี" : "เข้าสู่ระบบ";
    }
  });
})();
