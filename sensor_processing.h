#pragma once
#include <stdint.h>
#include <math.h>

// Allow real sensor conditioning, but never postpone recovery indefinitely.
struct EnsRecovery {
  uint32_t attemptAt = 0, goodAt = 0;
  void started(uint32_t now) { attemptAt = goodAt = now; }
  void good(uint32_t now) { goodAt = now; }
  bool due(uint32_t now, bool online, uint8_t validity) const {
    if (uint32_t(now - attemptAt) < 60000) return false;
    if (!online) return true;
    if (validity == 2) return uint32_t(now - attemptAt) >= 65UL * 60000;
    if (validity == 1) return uint32_t(now - attemptAt) >= 5UL * 60000;
    return uint32_t(now - goodAt) >= 60000;
  }
};

struct SensorEma {
  float value = 0;
  uint32_t sampledAt = 0;
  bool initialized = false;
  bool fresh(uint32_t now, uint32_t timeout) const {
    return initialized && uint32_t(now - sampledAt) <= timeout;
  }
  float update(float raw, uint32_t now, uint32_t timeout, float alpha) {
    if (!fresh(now, timeout)) value = raw;
    else value += alpha * (raw - value);
    sampledAt = now;
    initialized = true;
    return value;
  }
};

inline bool validClimate(float temperature, float humidity) {
  return isfinite(temperature) && isfinite(humidity) &&
    temperature >= -40 && temperature <= 85 && humidity >= 0 && humidity <= 100;
}

inline bool mustCloseIntake(bool ventOn, bool outdoorValid, int indoor, int outdoor) {
  return ventOn && (!outdoorValid || outdoor >= indoor);
}
