// =====================================================================
// ไฟล์: server.js
// คำอธิบาย: เซิร์ฟเวอร์หลังบ้าน (Backend) ทำหน้าที่ 3 อย่าง:
//   1. รับข้อมูลจาก ESP32 แล้วบันทึกลงฐานข้อมูล MySQL
//   2. ส่งข้อมูลต่อไปยังหน้าเว็บแบบเรียลไทม์ผ่าน Socket.IO
//   3. ให้บริการ API สำหรับหน้าเว็บดึงข้อมูลประวัติ
// วิธีรัน: พิมพ์ "node server.js" ใน Terminal
// =====================================================================

// --- นำเข้าไลบรารี (Library) ที่จำเป็น ---
const express = require('express');        // Express = เฟรมเวิร์คสำหรับสร้างเว็บเซิร์ฟเวอร์
const mysql = require('mysql2');           // mysql2 = ไลบรารีสำหรับเชื่อมต่อฐานข้อมูล MySQL
const cors = require('cors');              // CORS = อนุญาตให้เว็บจากที่อื่นเรียกใช้ API ได้
const http = require('http');              // http = โมดูลพื้นฐานสำหรับสร้าง HTTP Server
const { Server } = require('socket.io');   // Socket.IO = ไลบรารีสำหรับส่งข้อมูลแบบเรียลไทม์ (ไม่ต้องรีเฟรชหน้าเว็บ)



// =====================================================================
// สร้างเซิร์ฟเวอร์
// =====================================================================
const app = express();                     // สร้างแอป Express
const server = http.createServer(app);     // ครอบ Express ด้วย HTTP Server เพื่อใช้ร่วมกับ Socket.IO
const io = new Server(server, {
    cors: { origin: '*' }                  // อนุญาตให้ทุก URL เชื่อมต่อ Socket.IO ได้
});

// =====================================================================
// เชื่อมต่อฐานข้อมูล MySQL
// ใช้ Pool แทน Connection เดี่ยว เพื่อรองรับหลายคำขอพร้อมกัน
// =====================================================================
const db = mysql.createPool({
    host: 'localhost',         // ฐานข้อมูลอยู่ในเครื่องเดียวกับเซิร์ฟเวอร์
    user: 'root',              // ชื่อผู้ใช้ MySQL
    password: '',              // รหัสผ่าน (ว่าง = ไม่มีรหัส เหมาะสำหรับการพัฒนา)
    database: 'smart_air_db'   // ชื่อฐานข้อมูลที่จะใช้
});

// =====================================================================
// ตั้งค่า Middleware (ตัวช่วยที่ทำงานก่อนถึง API ทุกครั้ง)
// =====================================================================
app.use(cors());                           // เปิดให้เรียก API ข้ามโดเมนได้
app.use(express.json());                   // แปลงข้อมูล JSON ที่ส่งมาให้อ่านได้อัตโนมัติ
app.use(express.static(__dirname));        // เสิร์ฟไฟล์ HTML, CSS, JS ในโฟลเดอร์เดียวกัน


// =====================================================================
// API ที่ 1: รับข้อมูลจาก ESP32 (POST /api/log)
// ESP32 จะส่งข้อมูลมาที่นี่ทุกๆ 2 วินาที
// =====================================================================
app.post('/api/log', (req, res) => {
    // แกะข้อมูลจาก JSON ที่ ESP32 ส่งมา
    // ตัวอย่าง: {"in_pm":25,"in_co2":400,"in_gas":1500,"out_pm":0,"out_gas":0,"vent":1,"filt":0,"temp":30.5,"humidity":65}
    const { in_pm, in_co2, in_gas, out_pm, out_gas, vent, filt, temp, humidity } = req.body; 
    
    // เขียนคำสั่ง SQL เพื่อบันทึกข้อมูลลงตาราง sensor_data
    // เครื่องหมาย ? คือตัวแทนค่า (Placeholder) เพื่อป้องกัน SQL Injection (การแฮ็กผ่านช่องกรอกข้อมูล)
    const sql = `INSERT INTO sensor_data (in_pm25, in_co2, in_gas, out_pm25, out_gas, vent_fan_status, filt_fan_status, temperature, humidity) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    // สั่งให้ MySQL รันคำสั่ง SQL โดยใส่ค่าจริงแทนเครื่องหมาย ?
    db.query(sql, [in_pm, in_co2, in_gas, out_pm, out_gas, vent, filt, temp, humidity], (err) => {
        if (err) {
            // ถ้าบันทึกไม่สำเร็จ → แสดง Error และตอบกลับ ESP32 ด้วยรหัส 500 (Server Error)
            console.error("DB Error:", err);
            return res.status(500).json(err);
        }
        console.log("Data Saved:", req.body);

        // =====================================================================
        // จุดสำคัญ: กระจายข้อมูลไปหน้าเว็บทันทีผ่าน Socket.IO
        // io.emit() จะส่งข้อมูลไปยัง "ทุกเบราว์เซอร์" ที่เปิดหน้าเว็บอยู่
        // ทำให้หน้าเว็บอัปเดตแบบเรียลไทม์โดยไม่ต้องกดรีเฟรช
        // =====================================================================
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

        // ตอบกลับ ESP32 ว่าบันทึกสำเร็จ
        res.json({ message: "Data logged successfully" });
    });
});

// =====================================================================
// API ที่ 2: ดึงข้อมูลล่าสุด 1 แถว (GET /api/latest)
// หน้าเว็บจะเรียก API นี้ตอนโหลดครั้งแรก เพื่อแสดงข้อมูลทันทีไม่ต้องรอ
// =====================================================================
app.get('/api/latest', (req, res) => {
    // SELECT * = ดึงทุกคอลัมน์, ORDER BY id DESC = เรียงจากใหม่สุด, LIMIT 1 = เอาแค่ 1 แถว
    db.query("SELECT * FROM sensor_data ORDER BY id DESC LIMIT 1", (err, results) => {
        if (err) return res.status(500).json(err);
        // ส่งข้อมูลแถวแรก (ล่าสุด) กลับไป หรือส่งอ็อบเจกต์ว่างถ้าไม่มีข้อมูล
        res.json(results[0] || {});
    });
});

// =====================================================================
// API ที่ 3: ดึงประวัติสำหรับวาดกราฟ (GET /api/history)
// จัดกลุ่มข้อมูลทุกๆ 10 นาที และหาค่าเฉลี่ย เพื่อให้กราฟดูสะอาดตา
// ย้อนหลัง 3 ชั่วโมง = สูงสุด 18 จุดบนกราฟ (180 นาที ÷ 10 = 18)
// =====================================================================
app.get('/api/history', (req, res) => {
    const sql = `
        SELECT 
            ROUND(AVG(in_pm25), 1) as in_pm25,     -- หาค่าเฉลี่ยฝุ่นในบ้าน ปัดทศนิยม 1 ตำแหน่ง
            ROUND(AVG(out_pm25), 1) as out_pm25,    -- หาค่าเฉลี่ยฝุ่นนอกบ้าน
            DATE_FORMAT(
                DATE_SUB(created_at, INTERVAL MINUTE(created_at) % 10 MINUTE),
                '%Y-%m-%d %H:%i:00'
            ) as created_at                          -- จัดกลุ่มเวลาเป็นช่วง 10 นาที (08:00, 08:10, 08:20, ...)
        FROM sensor_data 
        WHERE created_at >= NOW() - INTERVAL 3 HOUR  -- เอาเฉพาะข้อมูลย้อนหลัง 3 ชั่วโมง
        GROUP BY DATE_FORMAT(
            DATE_SUB(created_at, INTERVAL MINUTE(created_at) % 10 MINUTE),
            '%Y-%m-%d %H:%i:00'
        )
        ORDER BY created_at ASC                       -- เรียงจากเก่าไปใหม่ (ซ้ายไปขวาบนกราฟ)
        LIMIT 18                                      -- จำกัดไม่เกิน 18 จุด
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// =====================================================================
// API ที่ 4: ดึงประวัติรายวัน (GET /api/history/daily)
// ใช้ในหน้า history.html สำหรับดูข้อมูลย้อนหลังเป็นรายวัน
// =====================================================================
app.get('/api/history/daily', (req, res) => {
    const sql = `
        SELECT 
            DATE(created_at) as date,                  -- วันที่
            ROUND(AVG(in_pm25), 1) as avg_in_pm,       -- ค่าเฉลี่ยฝุ่นในบ้านทั้งวัน
            ROUND(AVG(out_pm25), 1) as avg_out_pm,     -- ค่าเฉลี่ยฝุ่นนอกบ้านทั้งวัน
            ROUND(AVG(in_co2), 1) as avg_in_co2,       -- ค่าเฉลี่ย CO2 ทั้งวัน
            ROUND(AVG(in_gas), 1) as avg_in_gas,       -- ค่าเฉลี่ยแก๊สในบ้านทั้งวัน
            ROUND(AVG(out_gas), 1) as avg_out_gas      -- ค่าเฉลี่ยแก๊สนอกบ้านทั้งวัน
        FROM sensor_data 
        GROUP BY DATE(created_at)                       -- จัดกลุ่มตามวัน
        ORDER BY date DESC                              -- เรียงจากวันล่าสุด
        LIMIT 30                                        -- เก็บ 30 วันล่าสุด
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// =====================================================================
// Socket.IO: จัดการการเชื่อมต่อจากหน้าเว็บ
// เมื่อผู้ใช้เปิดหน้าเว็บ = เชื่อมต่อ (connect)
// เมื่อปิดหน้าเว็บ = ตัดการเชื่อมต่อ (disconnect)
// =====================================================================
io.on('connection', (socket) => {
    console.log('🌐 Web client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('❌ Web client disconnected:', socket.id);
    });
});

// =====================================================================
// เริ่มต้นเซิร์ฟเวอร์ที่ Port 3000
// หลังจากรันแล้ว สามารถเข้าถึงได้ที่ http://localhost:3000
// =====================================================================
server.listen(3000, () => console.log("🚀 Server + WebSocket running on port 3000"));