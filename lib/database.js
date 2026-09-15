const mysql = require("mysql2");
function config() {
  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "smart_air_db",
    timezone: "local",
  };
}
function query(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))),
  );
}
module.exports = {
  config,
  query,
  createPool: () => mysql.createPool(config()),
};
