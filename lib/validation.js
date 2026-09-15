const text = (v, min, max) =>
  typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
const email = (v) =>
  text(v, 3, 100) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const password = (v) =>
  typeof v === "string" && v.length >= 12 && Buffer.byteLength(v, "utf8") <= 72;
const deviceKey = (v) =>
  typeof v === "string" && /^[\x21-\x7e]{16,64}$/.test(v);
const deviceId = (v) =>
  typeof v === "string" &&
  /^[1-9]\d*$/.test(v) &&
  Number.isSafeInteger(Number(v));
function validateTelemetry(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const ranges = {
    in_pm: [0, 999, true],
    out_pm: [0, 999, true],
    in_co2: [0, 65535, true],
    in_gas: [0, 4095, true],
    out_gas: [0, 4095, true],
    temp: [-50, 100, false],
    humidity: [0, 100, false],
  };
  for (const [key, [min, max, integer]] of Object.entries(ranges)) {
    const v = body[key];
    if (v === null) continue;
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (integer && !Number.isInteger(v))
    )
      return false;
  }
  return (
    [0, 1].includes(body.vent) &&
    [0, 1].includes(body.filt) &&
    !(body.vent && body.filt)
  );
}
module.exports = {
  text,
  email,
  password,
  deviceKey,
  deviceId,
  validateTelemetry,
};
