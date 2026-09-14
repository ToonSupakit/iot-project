# Smart Air Quality Monitoring & Automated Dual-Fan Control System (IoT)

> **Context for AI Assistants & Developers:**  
> This project is a Dual-Zone (Indoor & Outdoor) Environmental Air Quality Monitoring and Automated Control System. It utilizes an **ESP32 microcontroller** to acquire telemetry from multiple sensors, evaluates a **Comparative Decision Algorithm** to actuate 5V DC relay-controlled fans (Filtration vs. Ventilation), and transmits structured data via **HTTP POST / JSON** to a **Node.js Express backend** with **MySQL database archiving** and **Socket.IO low-latency real-time web telemetry**.

---

## 🏗 System Architecture & Telemetry Pipeline

```
[ Indoor Sensors ] ──┐
 (PMS, ENS, AHT, MQ) ├──► [ ESP32 Microcontroller ] ──(HTTP POST JSON)──► [ Node.js / Express Backend ]
[ Outdoor Sensors ] ──┘          │                                               │              │
 (PMS, MQ-2)                     ▼                                               ▼              ▼
                       [ Relay Actuators ]                              [ MySQL Database ] [ Socket.IO ]
                    (Vent Fan / Filt Fan)                                      │                │
                                                                               └───────► ┌──────┴──────┐
                                                                                         │ Web Dashboard│
                                                                                         └──────────────┘
```

---

## 🛠 System Components & Technical Specifications

### 1. Hardware & Sensor Specs
- **Microcontroller:** ESP32 Development Board (Wi-Fi 802.11 b/g/n, Dual-Core 240MHz).
- **Indoor Sensors:**
  - **PMS5003:** Laser scattering PM2.5 particle sensor (UART interface).
  - **ENS160:** MOX Multi-Gas & eCO₂/TVOC sensor (I2C interface).
  - **AHT10 / AHT20:** High-precision Temperature & Relative Humidity sensor (I2C interface).
  - **MQ-2:** Combustible gas, LPG, and smoke sensor (Analog pin).
- **Outdoor Sensors:**
  - **PMS5003:** Outdoor laser dust sensor (UART interface).
  - **MQ-2:** Outdoor gas/smoke sensor (Analog pin).
- **Actuators & Relays:**
  - **2-Channel 5V Relay Module:** Optocoupler isolated to switch 5V DC brushless fans.
  - **Filtration Fan:** 5V DC axial fan coupled with a HEPA filter (air recirculation).
  - **Ventilation Fan:** 5V DC axial fan for fresh outdoor air intake.
  - **Test Enclosure:** Scaled residential room chamber (35 × 45 × 25 cm, ~39.4L volume).

---

### 2. Comparative Control Logic & Decision Algorithm

The ESP32 runs a continuous non-blocking loop to evaluate indoor vs. outdoor air quality:

| Condition | Indoor Air Status | Outdoor Air Status | Actuation Mode | Active Fan |
| :--- | :--- | :--- | :--- | :--- |
| **All Normal** | PM2.5 ≤ 35, CO₂ ≤ 1000, Gas Normal | N/A | **Standby Mode** | None (Fans OFF) |
| **Polluted Indoor** | PM2.5 > 35 or CO₂ > 1000 or Gas High | **Cleaner than Indoor** (Outdoor PM < Indoor PM) | **Ventilation Mode** | Ventilation Fan ON (Fresh Air Intake) |
| **Polluted Indoor** | PM2.5 > 35 or CO₂ > 1000 or Gas High | **More Polluted** (Outdoor PM ≥ Indoor PM) | **Filtration Mode** | Filtration Fan ON (HEPA Recirculation) |

---

## 📡 API Payload & Database Schema

### 1. HTTP POST Payload Contract (`POST /api/log`)
The ESP32 sends a JSON payload every 2 seconds to the backend server:

```json
{
  "in_pm": 38,
  "in_co2": 460,
  "in_gas": 1198,
  "out_pm": 87,
  "out_gas": 476,
  "vent": 0,
  "filt": 1,
  "temp": 29.7,
  "humidity": 79.43
}
```

### 2. MySQL Database Schema (`smart_air_db.sensor_data`)

```sql
CREATE TABLE IF NOT EXISTS sensor_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    in_pm25 INT NOT NULL,
    in_co2 INT NOT NULL,
    in_gas INT NOT NULL,
    out_pm25 INT DEFAULT 0,
    out_gas INT DEFAULT 0,
    vent_fan_status TINYINT(1) DEFAULT 0,
    filt_fan_status TINYINT(1) DEFAULT 0,
    temperature FLOAT DEFAULT 0,
    humidity FLOAT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 📁 Repository Directory Structure

```
project_iot/
├── firmware.ino        # ESP32 C++ firmware (Sensor acquisition, Control logic, HTTP Client)
├── server.js           # Node.js Express Server, MySQL Pool, Socket.IO WebSockets provider
├── index.html          # Real-time Web Dashboard (Live Gauges, Telemetry Cards, Status)
├── history.html        # Historical Analysis Page (Chart.js Time-series graphs & Data Tables)
├── style.css           # Modern CSS styling (Glassmorphism, Dark/Light theme, Responsiveness)
├── package.json        # Node.js Dependencies (express, mysql2, socket.io, cors)
├── db/                 # SQL init scripts and database setup files
└── images/             # Documentation diagrams and hardware photos
```

---

## 🚀 Execution & Setup Instructions

### 1. Local Database & Server Setup
```bash
# 1. Start MySQL (e.g. XAMPP or Standalone MySQL) and create database 'smart_air_db'
# 2. Install dependencies
npm install

# 3. Start the backend server
npm start
# Server listens on http://localhost:3000
```

### 2. Firmware Flashing (ESP32)
1. Open `firmware.ino` in Arduino IDE.
2. Ensure libraries `Adafruit AHTX0`, `SparkFun ENS160`, `PMS Library` are installed.
3. Configure `ssid`, `password`, and `serverUrl` (e.g. `http://<SERVER_IP>:3000/api/log`).
4. Upload to ESP32.

### 3. Cloud Deployment (Render.com + Aiven MySQL)
- **Backend:** Host `server.js` on **Render.com** (Web Service, Node.js environment).
- **Database:** Connect `mysql2.createPool()` to **Aiven Cloud Managed MySQL**.
- **HTTPS URL:** Update `serverUrl` in `firmware.ino` to `https://<YOUR_RENDER_APP>.onrender.com/api/log`.

---

## 💡 Information for AI Assistants
When assisting with this codebase:
- **Firmware (`firmware.ino`):** Uses active streaming non-blocking reads for PMS sensors. Pins: Vent Fan (GPIO 25), Filt Fan (GPIO 26), Indoor PMS Serial (UART2 RX 16, TX 17).
- **Backend (`server.js`):** Routes `POST /api/log` for incoming telemetry, emits `sensor_update` via Socket.IO, and provides `GET /api/history` for querying historical records.
- **Frontend (`index.html` & `history.html`):** Renders real-time metrics, dynamically toggles fan status badges, and renders interactive Chart.js line charts.
