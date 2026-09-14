-- Run once against an existing installation before using the updated firmware.
-- Historical zeros cannot be distinguished from missing measurements; retain them.
USE smart_air_db;
ALTER TABLE sensor_data
    MODIFY in_pm25 INT NULL,
    MODIFY in_co2 INT NULL,
    MODIFY in_gas INT NULL,
    MODIFY out_pm25 INT NULL,
    MODIFY out_gas INT NULL,
    MODIFY temperature FLOAT NULL,
    MODIFY humidity FLOAT NULL;
-- Add once if an equivalent created_at index does not already exist:
-- CREATE INDEX idx_sensor_created_at ON sensor_data (created_at);
