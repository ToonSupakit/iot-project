const express = require('express');
const mysql = require('mysql2');
const http = require('node:http');
const path = require('node:path');
const { timingSafeEqual, randomBytes } = require('node:crypto');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
const JWT_EXPIRES = '7d';

// =====================================================================
// Telemetry Validation
// =====================================================================
function validateTelemetry(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const ranges = {
        in_pm: [0, 999, true], out_pm: [0, 999, true],
        in_co2: [0, 65535, true], in_gas: [0, 4095, true],
        out_gas: [0, 4095, true], temp: [-50, 100, false],
        humidity: [0, 100, false]
    };
    for (const [key, [min, max, integer]] of Object.entries(ranges)) {
        const value = body[key];
        if (value === null) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) ||
            value < min || value > max || (integer && !Number.isInteger(value))) return false;
    }
    return [0, 1].includes(body.vent) && [0, 1].includes(body.filt) &&
        !(body.vent === 1 && body.filt === 1);
}

// =====================================================================
// JWT Auth Middleware
// =====================================================================
function authMiddleware(req, res, next) {
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function adminMiddleware(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
}

// =====================================================================
// DB query helper (promise-based)
// =====================================================================
function dbQuery(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) reject(err); else resolve(results);
        });
    });
}

// =====================================================================
// Create Express App
// =====================================================================
function createApp({ db, io, apiKey }) {
    if (!apiKey || apiKey.length < 16) throw new Error('DEVICE_API_KEY must contain at least 16 characters');
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '4kb' }));
    app.use(express.static(path.join(__dirname, 'public')));

    // =================================================================
    // AUTH ROUTES
    // =================================================================
    app.post('/api/auth/register', async (req, res) => {
        try {
            const { username, email, password } = req.body;
            if (!username || !email || !password) {
                return res.status(400).json({ error: 'Username, email, and password are required' });
            }
            if (username.length < 3 || username.length > 50) {
                return res.status(400).json({ error: 'Username must be 3-50 characters' });
            }
            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
            }
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'Invalid email format' });
            }

            const existing = await dbQuery(db, 'SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
            if (existing.length > 0) {
                return res.status(409).json({ error: 'Username or email already exists' });
            }

            const password_hash = await bcrypt.hash(password, 10);
            // First registered user becomes admin
            const countResult = await dbQuery(db, 'SELECT COUNT(*) AS cnt FROM users');
            const role = countResult[0].cnt === 0 ? 'admin' : 'user';

            const result = await dbQuery(db,
                'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
                [username, email, password_hash, role]
            );

            const token = jwt.sign({ id: result.insertId, username, email, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
            res.status(201).json({ message: 'Account created', token, user: { id: result.insertId, username, email, role } });
        } catch (err) {
            console.error('Register error:', err.code || err.message);
            res.status(500).json({ error: 'Registration failed' });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ error: 'Email and password are required' });
            }

            const users = await dbQuery(db, 'SELECT * FROM users WHERE email = ?', [email]);
            if (users.length === 0) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            const user = users[0];
            const valid = await bcrypt.compare(password, user.password_hash);
            if (!valid) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            const token = jwt.sign(
                { id: user.id, username: user.username, email: user.email, role: user.role },
                JWT_SECRET, { expiresIn: JWT_EXPIRES }
            );
            res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
        } catch (err) {
            console.error('Login error:', err.code || err.message);
            res.status(500).json({ error: 'Login failed' });
        }
    });

    app.get('/api/auth/me', authMiddleware, async (req, res) => {
        try {
            const users = await dbQuery(db, 'SELECT id, username, email, role, created_at FROM users WHERE id = ?', [req.user.id]);
            if (users.length === 0) return res.status(404).json({ error: 'User not found' });
            res.json(users[0]);
        } catch (err) {
            console.error('Auth/me error:', err.code || err.message);
            res.status(500).json({ error: 'Failed to fetch user' });
        }
    });

    // =================================================================
    // DEVICE MANAGEMENT ROUTES
    // =================================================================
    app.get('/api/devices', authMiddleware, async (req, res) => {
        try {
            const devices = await dbQuery(db,
                'SELECT id, device_key, device_name, is_online, last_seen_at, created_at FROM devices WHERE owner_id = ?',
                [req.user.id]
            );
            res.json(devices);
        } catch (err) {
            console.error('Devices error:', err.code || err.message);
            res.status(500).json({ error: 'Failed to fetch devices' });
        }
    });

    app.post('/api/devices/claim', authMiddleware, async (req, res) => {
        try {
            const { device_key, device_name } = req.body;
            if (!device_key || device_key.length < 16) {
                return res.status(400).json({ error: 'Device key must be at least 16 characters' });
            }

            const existing = await dbQuery(db, 'SELECT * FROM devices WHERE device_key = ?', [device_key]);
            if (existing.length > 0) {
                const dev = existing[0];
                if (dev.owner_id && dev.owner_id !== req.user.id) {
                    return res.status(409).json({ error: 'Device is already claimed by another user' });
                }
                if (dev.owner_id === req.user.id) {
                    return res.json({ message: 'Device already bound to your account', device: dev });
                }
                // Unclaimed device → claim it
                await dbQuery(db, 'UPDATE devices SET owner_id = ?, device_name = ? WHERE id = ?',
                    [req.user.id, device_name || dev.device_name, dev.id]);
                return res.json({ message: 'Device claimed successfully' });
            }

            // New device → create and claim
            await dbQuery(db,
                'INSERT INTO devices (device_key, device_name, owner_id) VALUES (?, ?, ?)',
                [device_key, device_name || 'AirWatch Device', req.user.id]
            );
            res.status(201).json({ message: 'Device registered and claimed' });
        } catch (err) {
            console.error('Claim error:', err.code || err.message);
            res.status(500).json({ error: 'Failed to claim device' });
        }
    });

    // =================================================================
    // ADMIN ROUTES
    // =================================================================
    app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const [users] = await dbQuery(db, 'SELECT COUNT(*) AS cnt FROM users');
            const [devices] = await dbQuery(db, 'SELECT COUNT(*) AS total, SUM(is_online) AS online FROM devices');
            const [logs] = await dbQuery(db, 'SELECT COUNT(*) AS cnt FROM sensor_data');
            res.json({
                totalUsers: users.cnt,
                totalDevices: devices.total || 0,
                onlineDevices: devices.online || 0,
                totalLogs: logs.cnt
            });
        } catch (err) {
            console.error('Admin stats error:', err.code || err.message);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });

    app.get('/api/admin/devices', authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const devices = await dbQuery(db,
                `SELECT d.id, d.device_key, d.device_name, d.is_online, d.last_seen_at, d.created_at,
                 u.username AS owner_username
                 FROM devices d LEFT JOIN users u ON d.owner_id = u.id
                 ORDER BY d.last_seen_at DESC`
            );
            res.json(devices);
        } catch (err) {
            console.error('Admin devices error:', err.code || err.message);
            res.status(500).json({ error: 'Failed to fetch devices' });
        }
    });

    app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const users = await dbQuery(db,
                'SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC'
            );
            res.json(users);
        } catch (err) {
            console.error('Admin users error:', err.code || err.message);
            res.status(500).json({ error: 'Failed to fetch users' });
        }
    });

    // =================================================================
    // TELEMETRY ROUTE (ESP32 → Server)
    // =================================================================
    app.post('/api/log', async (req, res) => {
        const received = Buffer.from(req.get('X-Device-Key') || '');
        const expected = Buffer.from(apiKey);
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
            return res.status(401).json({ error: 'Unauthorized device' });
        }
        if (!validateTelemetry(req.body)) {
            return res.status(400).json({ error: 'Invalid telemetry: provide all sensor fields as numbers or null, and fan states as 0 or 1' });
        }
        const { in_pm, in_co2, in_gas, out_pm, out_gas, vent, filt, temp, humidity } = req.body;
        const deviceKey = req.get('X-Device-Key');

        try {
            // Find or auto-create device entry
            let deviceId = null;
            const devices = await dbQuery(db, 'SELECT id FROM devices WHERE device_key = ?', [deviceKey]);
            if (devices.length > 0) {
                deviceId = devices[0].id;
                await dbQuery(db, 'UPDATE devices SET is_online = 1, last_seen_at = NOW() WHERE id = ?', [deviceId]);
            } else {
                const result = await dbQuery(db,
                    'INSERT INTO devices (device_key, device_name, is_online, last_seen_at) VALUES (?, ?, 1, NOW())',
                    [deviceKey, 'AirWatch Device']
                );
                deviceId = result.insertId;
            }

            const sql = `INSERT INTO sensor_data
                (device_id, in_pm25, in_co2, in_gas, out_pm25, out_gas, vent_fan_status, filt_fan_status, temperature, humidity)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            await dbQuery(db, sql, [deviceId, in_pm, in_co2, in_gas, out_pm, out_gas, vent, filt, temp, humidity]);

            io.emit('sensorData', {
                in_pm25: in_pm, in_co2, in_gas, out_pm25: out_pm, out_gas,
                vent_fan_status: vent, filt_fan_status: filt,
                temperature: temp, humidity, created_at: new Date().toISOString()
            });
            res.status(201).json({ message: 'Data logged successfully' });
        } catch (err) {
            console.error('Database insert failed:', err.code || err.message);
            res.status(500).json({ error: 'Unable to save telemetry' });
        }
    });

    // =================================================================
    // QUERY ROUTES
    // =================================================================
    function queryRows(res, sql, latest = false) {
        db.query(sql, (err, rows) => {
            if (err) {
                console.error('Database read failed:', err.code);
                return res.status(500).json({ error: 'Unable to read telemetry' });
            }
            res.json(latest ? (rows[0] || {}) : rows);
        });
    }
    app.get('/api/latest', (req, res) => {
        queryRows(res, 'SELECT * FROM sensor_data ORDER BY id DESC LIMIT 1', true);
    });
    app.get('/api/history', (req, res) => {
        queryRows(res, `SELECT * FROM (
            SELECT ROUND(AVG(in_pm25), 1) AS in_pm25,
                   ROUND(AVG(out_pm25), 1) AS out_pm25,
                   FLOOR(UNIX_TIMESTAMP(created_at) / 600) * 600000 AS bucket_ms
            FROM sensor_data
            WHERE created_at >= NOW() - INTERVAL 3 HOUR
            GROUP BY FLOOR(UNIX_TIMESTAMP(created_at) / 600)
            ORDER BY bucket_ms DESC LIMIT 18
        ) AS recent ORDER BY bucket_ms ASC`);
    });
    app.get('/api/history/daily', (req, res) => {
        queryRows(res, `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date,
            ROUND(AVG(in_pm25), 1) AS avg_in_pm,
            ROUND(AVG(out_pm25), 1) AS avg_out_pm,
            ROUND(AVG(in_co2), 1) AS avg_in_co2,
            ROUND(AVG(in_gas), 1) AS avg_in_gas,
            ROUND(AVG(out_gas), 1) AS avg_out_gas
            FROM sensor_data
            WHERE created_at >= NOW() - INTERVAL 30 DAY
            GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
            ORDER BY date DESC LIMIT 30`);
    });

    // =================================================================
    // ERROR HANDLING
    // =================================================================
    app.use((err, req, res, next) => {
        if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
        if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
        console.error('Request failed:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    });
    return app;
}

// =====================================================================
// Start Server
// =====================================================================
function startServer() {
    const apiKey = process.env.DEVICE_API_KEY;
    if (!apiKey || apiKey.length < 16) throw new Error('Set DEVICE_API_KEY (at least 16 characters) before starting');
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
    const db = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'smart_air_db',
        timezone: 'local'
    });

    // Mark devices offline if no data received for 30 seconds
    setInterval(() => {
        db.query('UPDATE devices SET is_online = 0 WHERE is_online = 1 AND last_seen_at < NOW() - INTERVAL 30 SECOND',
            err => { if (err) console.error('Device offline check failed:', err.code); });
    }, 15000);

    let io;
    const app = createApp({ db, io: { emit: (...args) => io.emit(...args) }, apiKey });
    const server = http.createServer(app);
    io = new Server(server);
    const udp = require('node:dgram').createSocket('udp4');
    udp.on('error', err => console.error('UDP discovery unavailable:', err.message));
    udp.on('message', (msg, rinfo) => {
        if (msg.toString() !== 'AIRWATCH_DISCOVER') return;
        udp.send(Buffer.from('AIRWATCH_SERVER_HERE:' + port), rinfo.port, rinfo.address,
            err => { if (err) console.error('UDP response failed:', err.message); });
    });
    const prune = () => db.query(
        'DELETE FROM sensor_data WHERE created_at < NOW() - INTERVAL 30 DAY',
        err => { if (err) console.error('Database pruning failed:', err.code); }
    );
    server.listen(port, () => {
        console.log('AirWatch listening on port ' + port);
        udp.bind(41234);
        prune();
    });
    const timer = setInterval(prune, 24 * 60 * 60 * 1000);
    timer.unref();
    return { server, io, db, udp };
}

module.exports = { createApp, validateTelemetry };
if (require.main === module) startServer();
