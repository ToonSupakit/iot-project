const path = require('path');
const mysql = require('mysql2');

const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'smart_air_db'
});

db.connect(err => {
    if (err) {
        console.error('❌ Connection failed:', err.message);
        process.exit(1);
    }
    console.log('✅ Connected to MySQL database!');

    const createUsers = `CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_users_email (email)
    )`;

    const createDevices = `CREATE TABLE IF NOT EXISTS devices (
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
    )`;

    db.query(createUsers, err => {
        if (err) console.error('❌ Users table error:', err.message);
        else console.log('✅ Table `users` is ready');

        db.query(createDevices, err => {
            if (err) console.error('❌ Devices table error:', err.message);
            else console.log('✅ Table `devices` is ready');

            db.query('ALTER TABLE sensor_data ADD COLUMN device_id INT NULL AFTER id', err => {
                if (err && err.code !== 'ER_DUP_FIELDNAME') {
                    console.error('⚠️ Col notice:', err.message);
                } else {
                    console.log('✅ Column `device_id` in `sensor_data` is ready');
                }

                db.query('ALTER TABLE sensor_data ADD INDEX idx_sensor_device (device_id)', err => {
                    if (err && err.code !== 'ER_DUP_KEYNAME') {
                        console.error('⚠️ Index notice:', err.message);
                    } else {
                        console.log('✅ Index `idx_sensor_device` is ready');
                    }
                    console.log('\n🎉 ALL DATABASE MIGRATIONS COMPLETED AUTOMATICALLY!');
                    db.end();
                });
            });
        });
    });
});
