(function (root) {
  const number = (value) =>
    value == null || !Number.isFinite(Number(value)) ? null : Number(value);
  const level = (pm) => (pm == null ? null : pm > 50 ? 2 : pm > 35 ? 1 : 0);
  function acceptSample(selectedId, sample) {
    return (
      Number(selectedId) > 0 && Number(sample.device_id) === Number(selectedId)
    );
  }
  function fresh(timestamp, now = Date.now()) {
    const age = now - Date.parse(timestamp);
    return Number.isFinite(age) && age >= -5000 && age < 15000;
  }
  function nextAlert(state, pm) {
    const next = level(pm);
    const trigger =
      next !== null && next > 0 && (state.level === 0 || next > state.level);
    return {
      level: next === null ? state.level : next,
      count: state.count + (trigger ? 1 : 0),
      trigger,
    };
  }
  const model = { number, level, acceptSample, fresh, nextAlert };
  if (typeof module !== "undefined") module.exports = model;
  else root.AirModel = model;
})(typeof window !== "undefined" ? window : this);
