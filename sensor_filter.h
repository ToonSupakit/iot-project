#ifndef AIRWATCH_SENSOR_FILTER_H
#define AIRWATCH_SENSOR_FILTER_H
// Keep fractional state; round only the result used for telemetry/control.
class SensorFilter {
 public:
  explicit SensorFilter(float alpha) : alpha_(alpha), value_(0), ready_(false) {}
  float update(float sample, bool reset = false) {
    if (!ready_ || reset) { value_ = sample; ready_ = true; }
    else value_ += alpha_ * (sample - value_);
    return value_;
  }
 private:
  float alpha_, value_;
  bool ready_;
};
#endif
