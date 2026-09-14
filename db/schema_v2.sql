-- =====================================================================
-- AirWatch v2 Schema Migration
-- Adds: users, devices tables + links sensor_data to devices
-- Run AFTER schema.sql on existing databases
-- =====================================================================

USE smart_air_db;

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_users_email (email)
);

-- Devices table for multi-tenant device management
CREATE TABLE IF NOT EXISTS devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_key VARCHAR(64) NOT NULL UNIQUE,
    device_name VARCHAR(100) NOT NULL DEFAULT 'AirWatch Device',
    owner_id INT NULL,
    is_online TINYINT(1) NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_devices_owner (owner_id),
    INDEX idx_devices_key (device_key)
);

-- Add device_id column to sensor_data (nullable for backwards compatibility)
ALTER TABLE sensor_data ADD COLUMN device_id INT NULL AFTER id;
ALTER TABLE sensor_data ADD INDEX idx_sensor_device (device_id);
