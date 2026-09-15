const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const { config, query } = require("../lib/database");
const valid = require("../lib/validation");
async function seedAdmin(db, env, resetPassword = false) {
  const email = env.ADMIN_EMAIL,
    username = env.ADMIN_USERNAME,
    password = env.ADMIN_PASSWORD;
  if (
    !valid.email(email) ||
    !valid.password(password) ||
    (!resetPassword && !valid.text(username, 3, 50))
  )
    throw new Error(
      "Set ADMIN_EMAIL, ADMIN_USERNAME (3–50 chars) and ADMIN_PASSWORD (12+ chars, max 72 UTF-8 bytes)",
    );
  const hash = await bcrypt.hash(password, 10);
  if (resetPassword) {
    // Explicit recovery action; never changes the role or prints the password.
    const result = await query(
      db,
      "UPDATE users SET password_hash = ? WHERE email = ?",
      [hash, email.trim().toLowerCase()],
    );
    if (result.affectedRows !== 1) throw new Error("Account not found");
  } else {
    try {
      await query(
        db,
        "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
        [username.trim(), email.trim().toLowerCase(), hash],
      );
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY")
        throw new Error(
          "Account already exists. Nothing was overwritten. Use --reset-password explicitly to reset its password.",
        );
      throw err;
    }
  }
}
async function main() {
  const db = mysql.createConnection(config());
  try {
    await seedAdmin(db, process.env, process.argv.includes("--reset-password"));
    console.log("Requested account operation completed.");
  } finally {
    db.end();
  }
}
module.exports = { seedAdmin };
if (require.main === module)
  main().catch((err) => {
    console.error("Account setup failed:", err.message);
    process.exitCode = 1;
  });
