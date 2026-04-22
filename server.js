const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');



const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', 
    database: 'smart_air_db'
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));


// 1. API สำหรับ ESP32 ส่งข้อมูล (POST)
app.post('/api/log', (req, res) => {
    const { in_pm, in_co2, in_gas, out_pm, out_gas, vent, filt, temp, humidity } = req.body; 
    
    const sql = `INSERT INTO sensor_data (in_pm25, in_co2, in_gas, out_pm25, out_gas, vent_fan_status, filt_fan_status, temperature, humidity) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    db.query(sql, [in_pm, in_co2, in_gas, out_pm, out_gas, vent, filt, temp, humidity], (err) => {
        if (err) {
            console.error("DB Error:", err);
            return res.status(500).json(err);
        }
        console.log("Data Saved:", req.body);

        // ส่งข้อมูลไปหน้าเว็บทันทีผ่าน Socket.io
        io.emit('sensorData', {
            in_pm25: in_pm,
            in_co2: in_co2,
            in_gas: in_gas,
            out_pm25: out_pm,
            out_gas: out_gas,
            vent_fan_status: vent,
            filt_fan_status: filt,
            temperature: temp,
            humidity: humidity
        });

        res.json({ message: "Data logged successfully" });
    });
});

// 2. API สำหรับหน้าเว็บดึงค่าล่าสุด (GET)
app.get('/api/latest', (req, res) => {
    db.query("SELECT * FROM sensor_data ORDER BY id DESC LIMIT 1", (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results[0] || {});
    });
});

// 3. API สำหรับดึงประวัติไปวาดกราฟ (GET)
app.get('/api/history', (req, res) => {
    const sql = "SELECT in_pm25, out_pm25, created_at FROM sensor_data ORDER BY id DESC LIMIT 20";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results.reverse());
    });
});

// 4. API สำหรับประวัติรายวัน (GET)
app.get('/api/history/daily', (req, res) => {
    const sql = `
        SELECT 
            DATE(created_at) as date,
            ROUND(AVG(in_pm25), 1) as avg_in_pm,
            ROUND(AVG(out_pm25), 1) as avg_out_pm,
            ROUND(AVG(in_co2), 1) as avg_in_co2,
            ROUND(AVG(in_gas), 1) as avg_in_gas,
            ROUND(AVG(out_gas), 1) as avg_out_gas
        FROM sensor_data 
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// Socket.io connection
io.on('connection', (socket) => {
    console.log('🌐 Web client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('❌ Web client disconnected:', socket.id);
    });
});

server.listen(3000, () => console.log("🚀 Server + WebSocket running on port 3000"));