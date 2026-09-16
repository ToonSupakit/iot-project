const test = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2");
const { query } = require("../lib/database");
const { migrate } = require("../db/migrate");
test(
  "MySQL migration twice preserves decimal rows and permits null measurements",
  { skip: process.env.TEST_MYSQL !== "1" },
  async (t) => {
    const db = mysql.createConnection({
      host: "127.0.0.1",
      user: "root",
      password: process.env.TEST_MYSQL_PASSWORD,
      database: "airwatch_test",
    });
    t.after(() => db.end());
    await query(
      db,
      `CREATE TABLE sensor_data (id INT PRIMARY KEY AUTO_INCREMENT,in_pm25 DECIMAL(8,2) NOT NULL,in_co2 FLOAT NOT NULL,in_gas INT NOT NULL,out_pm25 FLOAT NOT NULL,out_gas INT NOT NULL,temperature FLOAT NOT NULL,humidity FLOAT NOT NULL,vent_fan_status TINYINT DEFAULT 0,filt_fan_status TINYINT DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    );
    await query(
      db,
      "INSERT INTO sensor_data (in_pm25,in_co2,in_gas,out_pm25,out_gas,temperature,humidity) VALUES (22.75,600,1200,30.5,1300,26.4,55.5)",
    );
    await migrate(db);
    await migrate(db);
    const [row] = await query(db, "SELECT * FROM sensor_data WHERE id=1");
    assert.equal(row.in_pm25, "22.75");
    assert.equal(row.device_id, null);
    await query(
      db,
      "INSERT INTO sensor_data (in_pm25,in_co2,in_gas,out_pm25,out_gas,temperature,humidity) VALUES (NULL,NULL,NULL,NULL,NULL,NULL,NULL)",
    );
    const cols = await query(db, "SHOW COLUMNS FROM sensor_data");
    assert.equal(cols.find((c) => c.Field === "in_pm25").Type, "decimal(8,2)");
  },
);
