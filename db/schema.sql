-- Optional database bootstrap. Run npm run migrate afterwards.
CREATE DATABASE IF NOT EXISTS smart_air_db;
USE smart_air_db;

CREATE TABLE IF NOT EXISTS sensor_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    in_pm25 FLOAT NULL,
    in_co2 FLOAT NULL,
    in_gas INT NULL,
    out_pm25 FLOAT NULL,
    out_gas INT NULL,
    vent_fan_status TINYINT(1) NOT NULL DEFAULT 0,
    filt_fan_status TINYINT(1) NOT NULL DEFAULT 0,
    temperature FLOAT NULL,
    humidity FLOAT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sensor_created_at (created_at)
);

