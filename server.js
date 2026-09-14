const express = require('express');
const mysql = require('mysql2');
const http = require('node:http');
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');
const { Server } = require('socket.io');

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
        // null means unavailable; missing keys are invalid.
        if (value === null) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) ||
            value < min || value > max || (integer && !Number.isInteger(value))) return false;
    }
    return [0, 1].includes(body.vent) && [0, 1].includes(body.filt) &&
        !(body.vent === 1 && body.filt === 1);
}

function createApp({ db, io, apiKey }) {
    if (!apiKey || apiKey.length < 16) throw new Error('DEVICE_API_KEY must contain at least 16 characters');
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '4kb' }));
    app.use(express.static(path.join(__dirname, 'public')));

    app.post('/api/log', (req, res) => {
        const received = Buffer.from(req.get('X-Device-Key') || '');
        const expected = Buffer.from(apiKey);
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
            return res.status(401).json({ error: 'Unauthorized device' });
        }
        if (!validateTelemetry(req.body)) {
            return res.status(400).json({ error: 'Invalid telemetry: provide all sensor fields as numbers or null, and fan states as 0 or 1' });
        }
        const { in_pm, in_co2, in_gas, out_pm, out_gas, vent, filt, temp, humidity } = req.body;
        const sql = `INSERT INTO sensor_data
            (in_pm25, in_co2, in_gas, out_pm25, out_gas, vent_fan_status, filt_fan_status, temperature, humidity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        db.query(sql, [in_pm, in_co2, in_gas, out_pm, out_gas, vent, filt, temp, humidity], (err) => {
            if (err) {
                console.error('Database insert failed:', err.code);
                return res.status(500).json({ error: 'Unable to save telemetry' });
            }
            io.emit('sensorData', {
                in_pm25: in_pm, in_co2, in_gas, out_pm25: out_pm, out_gas,
                vent_fan_status: vent, filt_fan_status: filt,
                temperature: temp, humidity, created_at: new Date().toISOString()
            });
            res.status(201).json({ message: 'Data logged successfully' });
        });
    });

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
    // Unix milliseconds identify buckets without browser/server timezone ambiguity.
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
    app.use((err, req, res, next) => {
        if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
        if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
        console.error('Request failed:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    });
    return app;
}

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
