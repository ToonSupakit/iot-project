const test = require("node:test");
const assert = require("node:assert/strict");
const { migrate } = require("../db/migrate");
const { seedAdmin } = require("../db/seed");
test("migration preserves existing numeric types and propagates failures", async () => {
  const columns = [
    "in_pm25",
    "in_co2",
    "in_gas",
    "out_pm25",
    "out_gas",
    "temperature",
    "humidity",
  ].map((Field) => ({
    Field,
    Null: "NO",
    Type: Field === "in_pm25" ? "decimal(8,2)" : "float",
  }));
  const sqls = [];
  const db = {
    query(sql, p, cb) {
      sqls.push(sql);
      cb(
        null,
        sql.startsWith("SHOW COLUMNS")
          ? columns
          : sql.startsWith("SHOW INDEX")
            ? []
            : {},
      );
    },
  };
  await migrate(db);
  assert.ok(
    sqls.includes(
      "ALTER TABLE sensor_data MODIFY `in_pm25` decimal(8,2) NULL DEFAULT NULL",
    ),
  );
  assert.ok(!sqls.some((s) => /DROP|TRUNCATE|UPDATE sensor_data/.test(s)));
  await assert.rejects(
    migrate({
      query(s, p, cb) {
        cb(new Error("offline"));
      },
    }),
    /offline/,
  );
});
test("seed never overwrites existing credentials implicitly", async () => {
  const env = {
    ADMIN_USERNAME: "testadmin",
    ADMIN_EMAIL: "test@example.invalid",
    ADMIN_PASSWORD: "private-test-password",
  };
  let last;
  await assert.rejects(
    seedAdmin(
      {
        query(s, p, cb) {
          last = s;
          cb({ code: "ER_DUP_ENTRY" });
        },
      },
      env,
    ),
    /Nothing was overwritten/,
  );
  assert.match(last, /^INSERT/);
  await seedAdmin(
    {
      query(s, p, cb) {
        last = s;
        cb(null, { affectedRows: 1 });
      },
    },
    env,
    true,
  );
  assert.match(last, /^UPDATE users SET password_hash/);
  assert.doesNotMatch(last, /role/);
});
