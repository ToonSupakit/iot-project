const mysql = require("mysql2");
const { config, query } = require("../lib/database");
async function migrate(db) {
  await query(
    db,
    `CREATE TABLE IF NOT EXISTS sensor_data (
        id INT AUTO_INCREMENT PRIMARY KEY, device_id INT NULL,
        in_pm25 FLOAT NULL, in_co2 FLOAT NULL, in_gas INT NULL, out_pm25 FLOAT NULL, out_gas INT NULL,
        vent_fan_status TINYINT(1) DEFAULT 0, filt_fan_status TINYINT(1) DEFAULT 0,
        temperature FLOAT NULL, humidity FLOAT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sensor_created_at (created_at), INDEX idx_sensor_device (device_id)
    )`,
  );
  await query(
    db,
    `CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(100) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL,
        role ENUM('user', 'admin') NOT NULL DEFAULT 'user', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  await query(
    db,
    `CREATE TABLE IF NOT EXISTS devices (
        id INT AUTO_INCREMENT PRIMARY KEY, device_key VARCHAR(64) NOT NULL UNIQUE,
        device_name VARCHAR(100) NOT NULL DEFAULT 'AirWatch Device', owner_id INT NULL,
        is_online TINYINT(1) NOT NULL DEFAULT 0, last_seen_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_devices_owner (owner_id)
    )`,
  );
  const columns = await query(db, "SHOW COLUMNS FROM sensor_data");
  if (!columns.some((c) => c.Field === "device_id"))
    await query(
      db,
      "ALTER TABLE sensor_data ADD COLUMN device_id INT NULL AFTER id",
    );
  for (const name of [
    "in_pm25",
    "in_co2",
    "in_gas",
    "out_pm25",
    "out_gas",
    "temperature",
    "humidity",
  ]) {
    const column = columns.find((c) => c.Field === name);
    if (!column) throw new Error("Missing sensor column: " + name);
    if (column.Null === "YES") continue;
    // Preserve FLOAT/DECIMAL/INT types and historical precision. Names come from the fixed allowlist.
    if (
      !/^(?:tinyint|smallint|mediumint|int|bigint|float|double|decimal)(?:\([\d,]+\))?(?: unsigned)?(?: zerofill)?$/i.test(
        column.Type,
      )
    )
      throw new Error("Unexpected sensor column type: " + name);
    await query(
      db,
      "ALTER TABLE sensor_data MODIFY `" +
        name +
        "` " +
        column.Type +
        " NULL DEFAULT NULL",
    );
  }
  const indexes = await query(db, "SHOW INDEX FROM sensor_data");
  if (
    !indexes.some((i) => i.Column_name === "device_id" && i.Seq_in_index === 1)
  )
    await query(
      db,
      "ALTER TABLE sensor_data ADD INDEX idx_sensor_device (device_id)",
    );
  if (
    !indexes.some((i) => i.Column_name === "created_at" && i.Seq_in_index === 1)
  )
    await query(
      db,
      "ALTER TABLE sensor_data ADD INDEX idx_sensor_created_at (created_at)",
    );
}
async function main() {
  const db = mysql.createConnection(config());
  try {
    await migrate(db);
    console.log(
      "Migration completed. Existing data and numeric types preserved.",
    );
  } finally {
    db.end();
  }
}
module.exports = { migrate };
if (require.main === module)
  main().catch((err) => {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  });
