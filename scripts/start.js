const { createPool, query } = require('../lib/database');
const { migrate } = require('../db/migrate');
const { seedAdmin } = require('../db/seed');
(async () => {
  const db = createPool();
  try {
    await migrate(db);
    const [row] = await query(db, "SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
    if (!row.count) {
      await seedAdmin(db, { ...process.env, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD_B64 ? Buffer.from(process.env.ADMIN_PASSWORD_B64, 'base64').toString('utf8') : process.env.ADMIN_PASSWORD });
    }
  } finally { await new Promise(resolve => db.end(resolve)); }
  delete process.env.ADMIN_PASSWORD; delete process.env.ADMIN_PASSWORD_B64;
  await require('../server').startServer();
})().catch(error => { console.error('Unable to start:',error.message); process.exit(1); });
