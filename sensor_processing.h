#pragma once
#include <stdint.h>
#include <math.h>

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
