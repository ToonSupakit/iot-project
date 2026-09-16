const { randomBytes } = require('node:crypto');
const { query } = require('./database');
const valid = require('./validation');
async function provisionBoard(db, env = {}) {
  const rows = await query(db, 'SELECT id, device_key FROM devices ORDER BY id');
  if (env.SINGLE_DEVICE_ID) {
    if (!valid.deviceId(env.SINGLE_DEVICE_ID)) throw new Error('Invalid SINGLE_DEVICE_ID');
    const board = rows.find(row => row.id === Number(env.SINGLE_DEVICE_ID));
    if (!board) throw new Error('SINGLE_DEVICE_ID does not exist');
    return board.id;
  }
  if (rows.length > 1) throw new Error('Multiple existing devices: run npm run configure to choose the board. Existing data is preserved.');
  if (rows.length === 1) return rows[0].id;
  const key = env.DEVICE_API_KEY || randomBytes(24).toString('hex');
  if (!valid.deviceKey(key) || key === 'airwatch-default-secret-key-123456') throw new Error('Replace the public demo DEVICE_API_KEY with a private key');
  const [admin] = await query(db, "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const result = await query(db, 'INSERT INTO devices (device_key, device_name, owner_id) VALUES (?, ?, ?)', [key, 'AirWatch ESP32', admin?.id || null]);
  return result.insertId;
}
module.exports = { provisionBoard };
