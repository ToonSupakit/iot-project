  // =====================================================================
  // ไฟล์: frimware.ino
  // คำอธิบาย: โปรแกรมหลักของบอร์ด ESP32 ทำหน้าที่อ่านค่าจากเซนเซอร์ต่างๆ
  //           (ฝุ่น, อุณหภูมิ, ความชื้น, CO2, แก๊ส) แล้วส่งข้อมูลขึ้นเซิร์ฟเวอร์
  //           พร้อมระบบ Smart Control ควบคุม 2 พัดลมอัตโนมัติ (Ventilation & Filtration)
  // =====================================================================

  // =====================================================================
  // 🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑
  // 🌟 สวิตช์เปิด-ปิด โหมด 2 พัดลม & เซนเซอร์นอกบ้าน (เตรียมเผื่ออนาคต)
  // 🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑
  //
  // วิธีใช้งานในอนาคต:
  // ค่าเริ่มต้นเปิดโหมดสองพัดลมและเซนเซอร์นอกบ้าน (true)
  //
  // 👉 หากวันไหนคุณซื้อของมาติดครบแล้ว ให้แก้คำว่า "false" เป็น "true"
  // 👉 จากนั้นกด อัปโหลด (Upload) โค้ดลงบอร์ด ESP32 ใหม่
  // 👉 ระบบสมองกล 2 พัดลมสุดฉลาด จะทำงานทันที!
  //
  #define HAS_OUTDOOR_SENSORS true   // เปิดใช้งานเซนเซอร์ทั้ง INDOOR และ OUTDOOR
  //
  // =====================================================================

  // --- นำเข้าไลบรารี (Library) ที่จำเป็น ---
  #include <WiFi.h>            // ไลบรารีสำหรับเชื่อมต่อ WiFi
  #include <WiFiUdp.h>         // ไลบรารี UDP สำหรับระบบค้นหา Server อัตโนมัติ (Auto-Discovery)
  #include <WiFiManager.h>     // ไลบรารีสำหรับตั้งค่า WiFi ผ่านหน้าจอมือถือ (Captive Portal)
  #include <HTTPClient.h>      // ไลบรารีสำหรับส่งข้อมูลผ่าน HTTP (เหมือนเปิดเว็บ)
  #include <Wire.h>            // ไลบรารีสำหรับสื่อสารแบบ I2C (สายสัญญาณ 2 เส้นที่ต่อกับเซนเซอร์)
  #include <Adafruit_AHTX0.h>  // ไลบรารีสำหรับเซนเซอร์ AHT10 (วัดอุณหภูมิและความชื้น)
  #include <SparkFun_ENS160.h>  // ไลบรารีสำหรับเซนเซอร์ ENS160 (วัดก๊าซ CO2)
  #include <PMS.h>              // ไลบรารีสำหรับเซนเซอร์ PMS7003 (วัดฝุ่น PM2.5)
  #include <Preferences.h>      // ไลบรารีสำหรับบันทึกค่า Server IP ลงความจำถาวรของ ESP32
  #include <esp_idf_version.h>
  #include <math.h>
  #include "sensor_processing.h"
  #include <freertos/FreeRTOS.h>
  #include <freertos/queue.h>
  #include <freertos/task.h>
  #include <esp_task_wdt.h>     // ★ ไลบรารี Watchdog Timer ป้องกัน ESP32 ค้าง จะรีสตาร์ทอัตโนมัติ

  // =====================================================================
  // ตัวแปรเก็บ Server IP และระบบ UDP Auto-Discovery
  // =====================================================================
  Preferences preferences;
  char server_ip[40] = "192.168.1.110";
  char deviceKey[65] = ""; // Set in AirWatch-Setup; never commit a real key.
  unsigned int httpFailures = 0;
  bool watchdogReady = false;
  char serverUrl[80] = "http://192.168.1.110:3000/api/log";
  WiFiUDP udp;
  bool serverDiscovered = false;
  unsigned long lastDiscoveryAttempt = 0;

  // ฟังก์ชันยิงค้นหา IP ของคอมพิวเตอร์ในวง WiFi อัตโนมัติ (UDP Broadcast)
  void discoverServerIP() {
    if (WiFi.status() != WL_CONNECTED) return;

    udp.stop();
    udp.begin(41234);
    Serial.println("📡 Auto-Discovery: Broadcast searching for AirWatch Server...");

    udp.beginPacket(IPAddress(255, 255, 255, 255), 41234);
    udp.write((const uint8_t*)"AIRWATCH_DISCOVER", 17);
    udp.endPacket();

    unsigned long startWait = millis();
    while (millis() - startWait < 1000) {
      int packetSize = udp.parsePacket();
      if (packetSize) {
        char replyBuffer[64] = {0};
        udp.read(replyBuffer, sizeof(replyBuffer) - 1);
        unsigned int discoveredPort = 0;
        if (sscanf(replyBuffer, "AIRWATCH_SERVER_HERE:%u", &discoveredPort) == 1 &&
            discoveredPort > 0 && discoveredPort <= 65535) {
          IPAddress serverIP = udp.remoteIP();
          snprintf(serverUrl, sizeof(serverUrl), "http://%s:%u/api/log", serverIP.toString().c_str(), discoveredPort);
          Serial.printf("🎯 Auto-Discovery SUCCESS! Matched Server at: %s\n", serverUrl);
          serverDiscovered = true;
          break;
        }
      }
      delay(20);
    }
  }

  // =====================================================================
  // ตั้งค่าขา (Pin) ที่ต่อกับอุปกรณ์ภายนอก
  // =====================================================================
  #define MQ2_PIN 34           // เซนเซอร์แก๊ส MQ2 ในบ้าน
  #define FAN_VENT_PIN 25      // รีเลย์พัดลมระบายอากาศ (ดึงอากาศเข้า/ออก) ตัวเดิม
  #define FAN_FILT_PIN 26      // รีเลย์พัดลมกรองอากาศ (HEPA Filter) ตัวใหม่

  // ขาสำหรับเซนเซอร์นอกบ้าน (ใช้งานเมื่อ HAS_OUTDOOR_SENSORS เป็น true)
  #if HAS_OUTDOOR_SENSORS
  #define MQ2_OUT_PIN 35       // เซนเซอร์แก๊ส MQ2 นอกบ้าน
  #define PMS_OUT_RX 4         // ขา RX ของเซนเซอร์ฝุ่นนอกบ้าน
  #define PMS_OUT_TX 5         // ขา TX ของเซนเซอร์ฝุ่นนอกบ้าน
  #endif

  #define WDT_TIMEOUT 30   // ตั้ง Watchdog Timer ไว้ 30 วินาที

  // =====================================================================
  // ตั้งค่าเวลาในการทำงานต่างๆ (หน่วยเป็นมิลลิวินาที)
  // =====================================================================
  #define POST_INTERVAL    2500   // ส่งข้อมูลไปเซิร์ฟเวอร์ทุกๆ 2.5 วินาที
  #define HTTP_TIMEOUT     5000   // ★ HTTP timeout 5 วินาที (เพิ่มจาก 2 วิ ป้องกัน Timeout Error)
  #define PM_TIMEOUT       5000   // ถ้าเซนเซอร์ฝุ่นหายไป 5 วินาที ให้ถือว่าหลุด
  #define PMS_REQUEST_INTERVAL 1000  // สั่งขอค่าจากเซนเซอร์ฝุ่นทุกๆ 1 วินาที
  #define MIN_FAN_SWITCH_INTERVAL 5000 // ป้องกันรีเลย์รัว: พัดลมต้องเปิด/ปิดอย่างน้อย 5 วินาทีถึงเปลี่ยนสถานะได้
  #define WIFI_RECONNECT_INTERVAL 10000 // พยายามเชื่อมต่อ WiFi ใหม่ทุก 10 วินาทีหากหลุด
  #define WARMUP_PERIOD 30000            // ★ 30 วินาทีแรกไม่สั่งพัดลม (รอเซนเซอร์อุ่นเครื่อง)
  #define PM_MAX_CAP 999                 // ★ ค่า PM2.5 สูงสุดที่ยอมรับ (ป้องกันค่าเพี้ยน)
  #define I2C_MAX_ERRORS 5               // ★ ถ้า I2C error เกิน 5 ครั้งติด ให้ reset I2C bus

  // =====================================================================
  // สร้างตัวแปร "วัตถุ" (Object) สำหรับเซนเซอร์
  // =====================================================================
  Adafruit_AHTX0 aht;
  SparkFun_ENS160 ens160;
  HardwareSerial SerialPMS(2);    // ช่อง Serial 2 สำหรับเซนเซอร์ฝุ่นในบ้าน
  PMS pms(SerialPMS);
  PMS::DATA data;

  #if HAS_OUTDOOR_SENSORS
  HardwareSerial SerialPMSOut(1); // ช่อง Serial 1 สำหรับเซนเซอร์ฝุ่นนอกบ้าน
  PMS pmsOut(SerialPMSOut);
  PMS::DATA dataOut;
  #endif

  // =====================================================================
  // ตัวแปรสำหรับจับเวลาการทำงานและเก็บข้อมูล
  // =====================================================================
  unsigned long lastPost = 0;
  unsigned long lastPmReadTime = 0;
  unsigned long lastPmOutReadTime = 0;
  unsigned long lastPmsRequest = 0;

  SensorEma pmFilter, pmOutFilter, gasFilter, gasOutFilter;
  int rawPmValue = -1, rawPmOutValue = -1;
  bool pmInRange = false, pmOutInRange = false;
  unsigned long lastDiagnostic = 0;
  uint8_t ensValidity = 3;
  int currentPmValue = 0;              // ค่าฝุ่นในบ้าน
  int currentPmOutValue = 0;           // ค่าฝุ่นนอกบ้าน

  bool pmValid = false, pmOutValid = false;
  bool ahtValid = false;
  unsigned long lastCo2ReadTime = 0;
  bool ahtOnline = false;
  bool ensOnline = false;

  float lastTemp = 0, lastHum = 0;
  int lastCo2 = 0, lastGas = 0;
  int lastGasOut = 0;                  // ค่าแก๊สนอกบ้าน
  unsigned long lastSensorRead = 0;
  unsigned long lastFanSwitch = 0;     // เวลาสลับสถานะพัดลมล่าสุด
  unsigned long lastWifiReconnect = 0; // เวลาพยายามเชื่อมต่อ WiFi ล่าสุด
  #define SENSOR_READ_INTERVAL 1000

  bool isVentOn = false;               // สถานะพัดลมระบายอากาศ (true = กำลังทำงาน, false = ปิด)
  bool isFiltOn = false;               // สถานะพัดลมกรอง HEPA (true = กำลังทำงาน, false = ปิด)

  // ★ ตัวแปรระบบป้องกันความเสถียร
  unsigned long bootTime = 0;          // เวลาที่เปิดเครื่อง (สำหรับ warm-up)
  EnsRecovery ensRecovery;
  uint32_t lastAhtRecovery = 0;
  int i2cErrorCount = 0;               // นับ I2C error ติดต่อกัน

  // ★ ฟังก์ชัน Recovery I2C bus เมื่อเซนเซอร์ค้าง (AHT10/ENS160 แฮงค์)
  void recoverI2C() {
    Serial.println("🔄 I2C Bus Recovery...");
    Wire.end();
    delay(50);
    Wire.begin(21, 22);
    Wire.setTimeOut(500);
    ahtOnline = aht.begin();
    // Preserve ENS160 operating mode and warm-up across host I2C recovery.
    i2cErrorCount = 0;
    Serial.println("✅ I2C Bus Recovered!");
  }

  void configureNetwork() {
    // โหลดค่า Server IP ล่าสุดจากความจำถาวร (ถ้าไม่มีให้ใช้ค่าเริ่มต้น 192.168.1.110)
    preferences.begin("airwatch", false);
    String saved_ip = preferences.getString("server_ip", "192.168.1.110");
    saved_ip.toCharArray(server_ip, sizeof(server_ip));
    preferences.getString("device_key", "").toCharArray(deviceKey, sizeof(deviceKey));
    snprintf(serverUrl, sizeof(serverUrl), "http://%s:3000/api/log", server_ip);

    // เชื่อมต่อ WiFi ผ่านระบบ WiFiManager (Captive Portal)
    WiFiManager wm;
    wm.setConnectTimeout(10);       // ลองพยายามต่อ WiFi เดิม 10 วินาที ถ้าหาไม่เจอให้เด้งปล่อย AirWatch-Setup ทันที
    wm.setConfigPortalTimeout(180); // กำหนดเวลาหน้าป๊อบอัพ 3 นาทีหากไม่มีใครตั้งค่า จบหน้าตั้งค่าโดยไม่รีสตาร์ทบอร์ด

    // เพิ่มช่องกรอก "Server IP" บนหน้าจอมือถือ
    WiFiManagerParameter custom_server_ip("server_ip", "Server IP (เช่น 192.168.1.110)", server_ip, 40);
    wm.addParameter(&custom_server_ip);
    WiFiManagerParameter custom_device_key("device_key", "Device API key (16-64 characters)", deviceKey, 64);
    wm.addParameter(&custom_device_key);

    Serial.println("🌐 Connecting to WiFi via WiFiManager...");
    bool res = strlen(deviceKey) < 16
      ? wm.startConfigPortal("AirWatch-Setup")
      : wm.autoConnect("AirWatch-Setup"); // ถ้าหา WiFi เดิมไม่เจอ จะปล่อย WiFi ชื่อ AirWatch-Setup

    if (!res) {
      Serial.println("❌ Failed to connect to WiFi or hit timeout");
      preferences.end();
    } else {
      // บันทึกค่า Server IP ที่กรอกจากมือถือลงความจำถาวร (ถ้ามี)
      if (strlen(custom_server_ip.getValue()) > 0) {
        snprintf(server_ip, sizeof(server_ip), "%s", custom_server_ip.getValue());
        preferences.putString("server_ip", server_ip);
        snprintf(serverUrl, sizeof(serverUrl), "http://%s:3000/api/log", server_ip);
      }
      if (strlen(custom_device_key.getValue()) >= 16) {
        snprintf(deviceKey, sizeof(deviceKey), "%s", custom_device_key.getValue());
        preferences.putString("device_key", deviceKey);
      }
      preferences.end();
      Serial.println("\n✅ WiFi Connected Successfully!");
      // ยิงค้นหา Server IP อัตโนมัติในวง WiFi ทันที
      discoverServerIP();
    }

  }

  struct TelemetryPacket { char json[256]; unsigned long sampledAt; };
  QueueHandle_t telemetryQueue = nullptr;
  void telemetryWorker(void*) {
    configureNetwork(); // Only this worker owns Wi-Fi setup, credentials and server URL.
    uint32_t lastPortalAttempt = millis();
    bool wasConnected = false;
    TelemetryPacket packet;
    for (;;) {
      if (strlen(deviceKey) < 16 && millis() - lastPortalAttempt >= 30000) {
        configureNetwork();
        lastPortalAttempt = millis();
      }
      bool connected = WiFi.status() == WL_CONNECTED;
      if (connected && !wasConnected) discoverServerIP();
      wasConnected = connected;
      if (!connected && millis() - lastWifiReconnect >= WIFI_RECONNECT_INTERVAL) {
        lastWifiReconnect = millis();
        WiFi.reconnect();
      }
      if (xQueueReceive(telemetryQueue, &packet, pdMS_TO_TICKS(100)) != pdTRUE) continue;
      if (strlen(deviceKey) < 16) continue;
      if (WiFi.status() != WL_CONNECTED || millis() - packet.sampledAt > 10000) continue;
        HTTPClient http;
        http.begin(serverUrl);
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-Device-Key", deviceKey);
        http.setConnectTimeout(HTTP_TIMEOUT);
        http.setTimeout(HTTP_TIMEOUT);
        int httpCode = http.POST(packet.json);
        http.end();
        if (httpCode >= 200 && httpCode < 300) {
          httpFailures = 0;
          Serial.println("Telemetry saved");
        } else {
          if (httpFailures < 3) httpFailures++;
          Serial.printf("Telemetry failed: HTTP %d\n", httpCode);
          if (httpCode == 401) Serial.println("Device API key does not match server configuration");
          // Back off discovery; do not repeatedly discover on payload/auth errors.
          if (httpFailures >= 3 && (httpCode < 0 || httpCode >= 500) &&
              millis() - lastDiscoveryAttempt >= 30000) {
            serverDiscovered = false;
            lastDiscoveryAttempt = millis();
            discoverServerIP();
          }
        }
      // Yield even when a request fails immediately.
      vTaskDelay(pdMS_TO_TICKS(20));
    }
  }

  // ฟังก์ชันควบคุมพัดลมระบายอากาศ (Active-Low: สั่ง LOW = เปิด, HIGH = ปิด)
  void setVentFan(bool enable) {
    isVentOn = enable;
    digitalWrite(FAN_VENT_PIN, enable ? LOW : HIGH);
  }

  // ฟังก์ชันควบคุมพัดลมกรองอากาศ (Active-Low: สั่ง LOW = เปิด, HIGH = ปิด)
  void setFiltFan(bool enable) {
    isFiltOn = enable;
    digitalWrite(FAN_FILT_PIN, enable ? LOW : HIGH);
  }

  // =====================================================================
  // ฟังก์ชัน setup() - ทำงานครั้งเดียวตอนเปิดเครื่อง
  // =====================================================================
  void setup() {
    // Keep the ESP32 core brown-out protection enabled.
    Serial.begin(115200);
    // Subscribe the local control task after hardware initialization.
    if (esp_task_wdt_status(NULL) == ESP_OK) esp_task_wdt_delete(NULL);

    // ตั้งค่าขาพัดลมทั้ง 2 ตัวเป็น Output และสั่งปิดไว้ก่อนอย่างปลอดภัย
    digitalWrite(FAN_VENT_PIN, HIGH);
    digitalWrite(FAN_FILT_PIN, HIGH);
    pinMode(FAN_VENT_PIN, OUTPUT);
    pinMode(FAN_FILT_PIN, OUTPUT);
    setVentFan(false);
    setFiltFan(false);

    // ★ รอ 3 วินาทีให้ไฟเลี้ยงเสถียรก่อน (ป้องกันเซนเซอร์เพี้ยนตอนเพิ่งเสียบไฟ)
    Serial.println("⏳ Waiting 3 seconds for power stabilization...");
    delay(3000);

    // Sensors start before the network worker, including when Wi-Fi is unavailable.

    // ตั้งค่าเซนเซอร์ I2C
    Wire.begin(21, 22);
    Wire.setTimeOut(500); // ขยายเวลา Timeout เป็น 500ms ป้องกันการตัดการเชื่อมต่อเร็วเกินไป

    if (aht.begin()) ahtOnline = true;
    else Serial.println("⚠️ AHT10 Not Found");

    ensRecovery.started(millis());
    if (ens160.begin()) {
      ens160.setOperatingMode(SFE_ENS160_STANDARD);
      ensOnline = true;
    } else {
      Serial.println("⚠️ ENS160 Not Found");
    }

    // Start both UART sensors independently of network setup.
    SerialPMS.begin(9600, SERIAL_8N1, 16, 17);
    while (SerialPMS.available()) SerialPMS.read(); // ล้างขยะใน Buffer ออกให้หมด
    pms.activeMode();

  #if HAS_OUTDOOR_SENSORS
    SerialPMSOut.begin(9600, SERIAL_8N1, PMS_OUT_RX, PMS_OUT_TX);
    while (SerialPMSOut.available()) SerialPMSOut.read(); // ล้างขยะใน Buffer
    pmsOut.activeMode();
  #endif
    // Local warm-up starts now; network setup runs independently.
    bootTime = millis();
    telemetryQueue = xQueueCreate(1, sizeof(TelemetryPacket));
    if (!telemetryQueue) {
      Serial.println("ERROR: telemetry queue allocation failed; local control remains active");
    } else if (xTaskCreate(telemetryWorker, "telemetry", 8192, nullptr, 1, nullptr) != pdPASS) {
      vQueueDelete(telemetryQueue);
      telemetryQueue = nullptr;
      Serial.println("ERROR: telemetry task creation failed; local control remains active");
    }
  #if ESP_IDF_VERSION_MAJOR >= 5
    esp_task_wdt_config_t config = {};
    config.timeout_ms = WDT_TIMEOUT * 1000;
    config.idle_core_mask = 0;
    config.trigger_panic = true;
    esp_err_t err = esp_task_wdt_init(&config);
    if (err == ESP_ERR_INVALID_STATE) err = esp_task_wdt_reconfigure(&config);
  #else
    esp_err_t err = esp_task_wdt_init(WDT_TIMEOUT, true);
  #endif
    if (err == ESP_OK) {
      watchdogReady = esp_task_wdt_status(NULL) == ESP_OK || esp_task_wdt_add(NULL) == ESP_OK;
    }
    if (!watchdogReady) Serial.println("WARNING: Watchdog setup failed");
  }

  // =====================================================================
  // ฟังก์ชัน loop() - ทำงานวนซ้ำไปเรื่อยๆ
  // =====================================================================
  void loop() {
    // ★ เลี้ยง Watchdog Timer ทุกรอบ loop (ป้องกัน ESP32 รีสตาร์ทถ้าโค้ดทำงานปกติ)
    if (watchdogReady) esp_task_wdt_reset();

    // =================================================================
    // ส่วนที่ 1: อ่านค่าเซนเซอร์ฝุ่น (Non-blocking Active Stream)
    // =================================================================
    // รับข้อมูลฝุ่นในบ้าน
    if (pms.read(data)) {
      rawPmValue = data.PM_AE_UG_2_5;
      pmInRange = rawPmValue <= PM_MAX_CAP;
      currentPmValue = lroundf(pmFilter.update(rawPmValue, millis(), PM_TIMEOUT, 0.25f));
      lastPmReadTime = millis();
    }

    // Keep the last measurement separate from whether it is still usable.
    pmValid = pmFilter.fresh(millis(), PM_TIMEOUT);

    // รับข้อมูลฝุ่นนอกบ้าน
  #if HAS_OUTDOOR_SENSORS
    if (pmsOut.read(dataOut)) {
      rawPmOutValue = dataOut.PM_AE_UG_2_5;
      pmOutInRange = rawPmOutValue <= PM_MAX_CAP;
      currentPmOutValue = lroundf(pmOutFilter.update(rawPmOutValue, millis(), PM_TIMEOUT, 0.25f));
      lastPmOutReadTime = millis();
    }

    pmOutValid = pmOutFilter.fresh(millis(), PM_TIMEOUT);
  #endif

    // =================================================================
    // 🧠 ส่วนที่ 2: ระบบควบคุมพัดลมอัจฉริยะ (Smart Fan Logic - มี Hysteresis)
    // =================================================================
    if (millis() - bootTime > WARMUP_PERIOD && millis() - lastFanSwitch > MIN_FAN_SWITCH_INTERVAL) {  // ★ เพิ่มเช็ค warm-up 30 วินาทีแรกไม่สั่งพัดลม
      if (HAS_OUTDOOR_SENSORS) {
        // เกณฑ์ตรวจจับควัน/แก๊สรั่วจริง (MQ-2 ค่าปกติในห้องจะอยู่ที่ 1400-1800, ถ้ามีควันจริงจะพุ่งเกิน 2500)
        bool isGasAlert = (lastGas > 2500);

        if (isGasAlert) {
          // Priority 1: โหมดฉุกเฉิน เจอแก๊สในบ้าน -> เปิดระบายอากาศทิ้งอย่างเดียว
          if (!isVentOn || isFiltOn) {
            setVentFan(true);
            setFiltFan(false);
            lastFanSwitch = millis();
          }
        }
        else if (!pmValid) {
          // Unknown indoor PM: close intake and run the installed filter.
          if (isVentOn || !isFiltOn) {
            setVentFan(false);
            setFiltFan(true);
            lastFanSwitch = millis();
          }
        }
        else if (mustCloseIntake(isVentOn, pmOutValid, currentPmValue, currentPmOutValue)) {
          // Close an unknown or dirtier intake even inside the 30-35 hysteresis band.
          setVentFan(false);
          setFiltFan(true);
          lastFanSwitch = millis();
        }
        else if (currentPmValue > 35) {
          // Priority 2: โหมดสู้ฝุ่น
          if (pmOutValid && currentPmOutValue < currentPmValue) {
            // อากาศนอกบ้านดีกว่า -> เปิดระบายอากาศ (ดึงอากาศดีเข้า)
            if (!isVentOn || isFiltOn) {
              setVentFan(true);
              setFiltFan(false);
              lastFanSwitch = millis();
            }
          } else {
            // อากาศนอกบ้านแย่พอๆกัน หรือแย่กว่า -> เปิดระบบกรองปิด (สู้ฝุ่นด้วย HEPA)
            if (isVentOn || !isFiltOn) {
              setVentFan(false);
              setFiltFan(true);
              lastFanSwitch = millis();
            }
          }
        }
        else if (currentPmValue < 30) {
          // Priority 3: โหมดปกติ อากาศดีอยู่แล้ว -> ปิดพัดลมทั้งหมดเพื่อประหยัดไฟ
          if (isVentOn || isFiltOn) {
            setVentFan(false);
            setFiltFan(false);
            lastFanSwitch = millis();
          }
        }
        // ⬆️⬆️⬆️⬆️⬆️ จบ [โหมดเต็มระบบ] ⬆️⬆️⬆️⬆️⬆️
      }
      else {
        // ⬇️⬇️⬇️⬇️⬇️ [โหมดปัจจุบัน] ทำงานเมื่อยังไม่มีเซนเซอร์นอกบ้าน ⬇️⬇️⬇️⬇️⬇️
        if (!pmValid) {
          // Single fan: retain its last state; do not interpret missing PM as clean.
        } else if (currentPmValue > 35) {
          if (!isVentOn) {
            setVentFan(true);   // เปิดพัดลมระบายอากาศ
            lastFanSwitch = millis();
          }
        } else if (currentPmValue < 30) {
          if (isVentOn) {
            setVentFan(false);  // ปิดพัดลมระบายอากาศ
            lastFanSwitch = millis();
          }
        }
        if (isFiltOn) setFiltFan(false);
        // ⬆️⬆️⬆️⬆️⬆️ จบ [โหมดปัจจุบัน] ⬆️⬆️⬆️⬆️⬆️
      }
    }

    // =================================================================
    // ส่วนที่ 3: อ่านเซนเซอร์ I2C และแก๊ส
    // =================================================================
    if (millis() - lastSensorRead > SENSOR_READ_INTERVAL) {
      lastSensorRead = millis();

      // อ่าน AHT10
      sensors_event_t h_ev, t_ev;
      ahtValid = ahtOnline && aht.getEvent(&h_ev, &t_ev) &&
          validClimate(t_ev.temperature, h_ev.relative_humidity);
      if (ahtValid) {
        lastTemp = t_ev.temperature;
        lastHum = h_ev.relative_humidity;
        i2cErrorCount = 0;  // ★ อ่านสำเร็จ reset ตัวนับ error
      } else {
        i2cErrorCount++;  // ★ นับ error
        if (i2cErrorCount >= I2C_MAX_ERRORS && millis() - lastAhtRecovery >= 30000) {
          lastAhtRecovery = millis();
          recoverI2C();   // ★ error เยอะเกิน → reset I2C bus ทั้งหมด
        }
      }

      // ENS recovery is paced independently; warm-up/initial conditioning get grace.
      if (ensRecovery.due(millis(), ensOnline, ensValidity)) {
        Serial.println("ENS160 recovery: restarting sensor operation");
        lastCo2ReadTime = 0;
        ensValidity = 3;
        ensRecovery.started(millis());
        ensOnline = ens160.begin();
        if (ensOnline) {
          ens160.setOperatingMode(SFE_ENS160_IDLE);
          ens160.setOperatingMode(SFE_ENS160_STANDARD);
        }
      }
      // อ่าน ENS160
      if (ensOnline) {
        // ★ ส่งค่าอุณหภูมิ/ความชื้นจาก AHT10 ให้ ENS160 ชดเชย (ช่วยให้ค่า CO2 แม่นขึ้นมาก!)
        if (ahtValid) {
          ens160.setTempCompensationCelsius(lastTemp);
          ens160.setRHCompensationFloat(lastHum);
        }

        ensValidity = ens160.getFlags();
        if (ensValidity != 0) lastCo2ReadTime = 0;
        if (ens160.checkDataStatus()) {
          uint16_t eco2 = ens160.getECO2();
          if (ensValidity == 0 && eco2 >= 400 && eco2 <= 65000) {
            lastCo2 = eco2;
            lastCo2ReadTime = millis();
            ensRecovery.good(millis());
          } else {
            lastCo2ReadTime = 0;
          }
        }
        ens160.getTVOC();
        ens160.getAQI();
      }

      // อ่านแก๊ส (Multi-sampling 20 ครั้ง + EMA Smoothing ป้องกันนอยส์ขา ADC ESP32)
      long gasSum = 0;
      for (int i = 0; i < 20; i++) {
        gasSum += analogRead(MQ2_PIN);
        delayMicroseconds(150);
      }
      int rawGas = gasSum / 20;
      lastGas = lroundf(gasFilter.update(rawGas, millis(), PM_TIMEOUT, 0.2f));
  #if HAS_OUTDOOR_SENSORS
      long gasOutSum = 0;
      for (int i = 0; i < 20; i++) {
        gasOutSum += analogRead(MQ2_OUT_PIN);
        delayMicroseconds(150);
      }
      int rawGasOut = gasOutSum / 20;
      lastGasOut = lroundf(gasOutFilter.update(rawGasOut, millis(), PM_TIMEOUT, 0.2f));
  #else
      lastGasOut = 0; // บังคับเป็น 0 ถ้ายังไม่มีเซนเซอร์ ป้องกันค่ากวน
  #endif
    }

    // Diagnostics retain raw values, including out-of-range data, without changing calibration.
    if (millis() - lastDiagnostic >= 5000) {
      lastDiagnostic = millis();
      Serial.printf("PMS IN raw=%d filtered=%d fresh=%d inRange=%d ageMs=%lu | OUT raw=%d filtered=%d fresh=%d inRange=%d ageMs=%lu\n",
        rawPmValue, currentPmValue, pmValid, pmInRange, millis()-lastPmReadTime,
        rawPmOutValue, currentPmOutValue, pmOutValid, pmOutInRange, millis()-lastPmOutReadTime);
      Serial.printf("ENS validity=%u eCO2=%d | AHT valid=%d temp=%.2f RH=%.2f | MQ IN=%d OUT=%d\n",
        ensValidity, lastCo2, ahtValid, lastTemp, lastHum, lastGas, lastGasOut);
    }

    // =================================================================
    // ส่วนที่ 4: ส่งข้อมูลไปเซิร์ฟเวอร์
    // =================================================================
    if (millis() - lastPost > POST_INTERVAL) {
      lastPost = millis();

      { // Queue sensor snapshots even when the network worker is configuring Wi-Fi.
        char inPmText[16], outPmText[16], co2Text[16], tempText[24], humText[24], outGasText[16];
        snprintf(inPmText, sizeof(inPmText), (pmValid && pmInRange && currentPmValue <= PM_MAX_CAP) ? "%d" : "null", currentPmValue);
        snprintf(outPmText, sizeof(outPmText), (pmOutValid && pmOutInRange && currentPmOutValue <= PM_MAX_CAP) ? "%d" : "null", currentPmOutValue);
        bool co2Valid = lastCo2ReadTime > 0 && millis() - lastCo2ReadTime <= PM_TIMEOUT;
        snprintf(co2Text, sizeof(co2Text), co2Valid ? "%d" : "null", lastCo2);
        snprintf(tempText, sizeof(tempText), ahtValid ? "%.2f" : "null", lastTemp);
        snprintf(humText, sizeof(humText), ahtValid ? "%.2f" : "null", lastHum);
        snprintf(outGasText, sizeof(outGasText), HAS_OUTDOOR_SENSORS ? "%d" : "null", lastGasOut);
        char jsonBuffer[256];
        int length = snprintf(jsonBuffer, sizeof(jsonBuffer),
          "{\"in_pm\":%s,\"in_co2\":%s,\"in_gas\":%d,\"out_pm\":%s,\"out_gas\":%s,\"vent\":%d,\"filt\":%d,\"temp\":%s,\"humidity\":%s}",
          inPmText, co2Text, lastGas, outPmText, outGasText,
          isVentOn ? 1 : 0, isFiltOn ? 1 : 0, tempText, humText);
        if (length < 0 || length >= (int)sizeof(jsonBuffer)) {
          Serial.println("Telemetry serialization failed");
          return;
        }
        TelemetryPacket packet = {};
        memcpy(packet.json, jsonBuffer, length + 1);
        packet.sampledAt = millis();
        if (telemetryQueue) xQueueOverwrite(telemetryQueue, &packet);

      }
    }
  }
