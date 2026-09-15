try {
  document.documentElement.dataset.theme =
    localStorage.getItem("theme") || "dark";
} catch {}
